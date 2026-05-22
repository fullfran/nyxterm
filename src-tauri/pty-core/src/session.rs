use std::{
    io::Write,
    sync::{atomic::AtomicBool, Arc, Condvar, Mutex},
    thread::JoinHandle,
};

use portable_pty::ChildKiller;

// ─── Constants ────────────────────────────────────────────────────────────────

/// PTY read buffer size — 16 KiB per design §2.1.
pub const READ_CHUNK: usize = 16 * 1024;

/// Flusher coalesce window — 4 ms per design §2.1.
pub const FLUSH_COALESCE: std::time::Duration = std::time::Duration::from_millis(4);

/// Flusher max idle before forced flush — 50 ms per design §2.1.
pub const FLUSH_MAX_IDLE: std::time::Duration = std::time::Duration::from_millis(50);

/// Pending buffer ceiling — 4 MiB per design §2.1, §2.6.
pub const MAX_PENDING: usize = 4 * 1024 * 1024;

/// DA filter internal buffer cap — prevents adversarial unterminated CSI growth.
pub const DA_BUFFER_CAP: usize = 256;

/// Sentinel injected when the 4 MiB cap is exceeded. Includes VT reset
/// (`\x1bc`) so xterm.js doesn't render half-drawn escape sequences.
pub const OVERFLOW_NOTICE: &[u8] =
    b"\x1bc\x1b[2m[nyxterm: dropped output due to backpressure]\x1b[0m\r\n";

/// DA1 reply — VT102-compatible terminal identification.
pub const DA1_REPLY: &[u8] = b"\x1b[?1;2c";

/// DA2 reply — secondary device attributes.
pub const DA2_REPLY: &[u8] = b"\x1b[>0;276;0c";

// ─── Session threads ──────────────────────────────────────────────────────────

/// Thread handles kept by the Session for clean shutdown.
///
/// Slice 2 shutdown ordering (design §2.4):
///   reader exits (EOF) → waiter joins reader → waiter sets done
///   → flusher drains → Drop joins flusher + waiter.
///
/// The reader JoinHandle is NOT stored here — it is moved directly into the
/// waiter thread closure so the waiter can join it synchronously as step 3.
/// Drop therefore only needs to join flusher and waiter.
pub struct SessionThreads {
    pub flusher: JoinHandle<()>,
    pub waiter: JoinHandle<()>,
}

// ─── Session ──────────────────────────────────────────────────────────────────

/// One active PTY session.
///
/// Lock-ordering rule (ADR-2): `writer` Mutex and `pending` Mutex are
/// INDEPENDENT. Neither is ever acquired while holding the other.
///
/// Slice 2 adds: `killer`, `done`, `on_exit` alongside the existing fields.
pub struct Session {
    pub id: u32,
    /// Serialises concurrent `pty_write` calls (NFR-005). Independent of `pending`.
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// Coalescing buffer shared reader → flusher. Independent of `writer`.
    pub pending: Arc<(Mutex<Vec<u8>>, Condvar)>,
    /// Sends coalesced byte chunks to the frontend. Called by the flusher thread.
    pub on_data: Arc<dyn Fn(Vec<u8>) + Send + Sync>,
    /// Kill guard: used by `pty_close` (and Drop) to terminate the child if
    /// it hasn't already exited. Obtained via `child.clone_killer()`.
    pub killer: Arc<Mutex<Box<dyn ChildKiller + Send + Sync>>>,
    /// Set `true` by the waiter thread once the child has exited and the reader
    /// has been joined. The flusher observes this flag to know when to drain
    /// and exit. Using `Acquire`/`Release` ordering.
    pub done: Arc<AtomicBool>,
    /// Delivers the exit code (or −signal) to the frontend. Called once by the
    /// waiter thread after all output has been flushed.
    pub on_exit: Arc<dyn Fn(i32) + Send + Sync>,
    /// Thread handles; `Drop` joins them for clean shutdown.
    pub threads: Mutex<Option<SessionThreads>>,
}

impl Session {
    /// Constructs a session ready to have its threads started.
    #[allow(clippy::too_many_arguments)]
    pub fn new(
        id: u32,
        writer: Box<dyn Write + Send>,
        pending: Arc<(Mutex<Vec<u8>>, Condvar)>,
        on_data: Arc<dyn Fn(Vec<u8>) + Send + Sync>,
        killer: Box<dyn ChildKiller + Send + Sync>,
        done: Arc<AtomicBool>,
        on_exit: Arc<dyn Fn(i32) + Send + Sync>,
    ) -> Self {
        Self {
            id,
            writer: Arc::new(Mutex::new(writer)),
            pending,
            on_data,
            killer: Arc::new(Mutex::new(killer)),
            done,
            on_exit,
            threads: Mutex::new(None),
        }
    }
}

impl Drop for Session {
    /// Join all threads so none outlive the Session.
    ///
    /// Shutdown ordering (design §2.4 steps 1–5):
    ///   1. Killer fires (SIGHUP) so the child exits if still alive.
    ///   2. Reader's read() returns EOF/Err → reader exits.
    ///   3. Waiter's child.wait() returns → joins reader → sets done → notifies flusher.
    ///   4. Flusher wakes, observes done+empty → drains tail → exits.
    ///   5. Drop joins flusher, then waiter (reader was already joined by waiter).
    ///
    /// In Drop we trigger step 1 explicitly; the rest unwind on their own.
    fn drop(&mut self) {
        // Step 1: kill the child if still alive (SIGHUP / SIGKILL depending on OS).
        if let Ok(mut k) = self.killer.lock() {
            let _ = k.kill();
        }
        // Wake the flusher in case it is blocked on the condvar.
        let (_, cv) = &*self.pending;
        cv.notify_all();

        if let Ok(mut guard) = self.threads.lock() {
            if let Some(threads) = guard.take() {
                // Reader is joined by the waiter thread, not here. Joining waiter
                // also guarantees reader has completed (waiter joins reader first).
                let _ = threads.flusher.join();
                let _ = threads.waiter.join();
            }
        }
    }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[cfg(test)]
impl Session {
    /// Stub session for unit tests that don't need a real PTY.
    /// All I/O is a no-op; killer is a stub that always succeeds.
    pub fn new_stub(expected_id: u32) -> Self {
        use std::sync::atomic::AtomicBool;
        Self {
            id: expected_id,
            writer: Arc::new(Mutex::new(Box::new(std::io::sink()))),
            pending: Arc::new((Mutex::new(Vec::new()), Condvar::new())),
            on_data: Arc::new(|_bytes| {}),
            killer: Arc::new(Mutex::new(Box::new(StubKiller))),
            done: Arc::new(AtomicBool::new(false)),
            on_exit: Arc::new(|_code| {}),
            threads: Mutex::new(None),
        }
    }
}

/// No-op killer used in unit tests.
#[cfg(test)]
#[derive(Debug)]
struct StubKiller;

#[cfg(test)]
impl ChildKiller for StubKiller {
    fn kill(&mut self) -> std::io::Result<()> {
        Ok(())
    }
    fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
        Box::new(StubKiller)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn constants_have_correct_values() {
        assert_eq!(READ_CHUNK, 16 * 1024);
        assert_eq!(FLUSH_COALESCE.as_millis(), 4);
        assert_eq!(FLUSH_MAX_IDLE.as_millis(), 50);
        assert_eq!(MAX_PENDING, 4 * 1024 * 1024);
        assert_eq!(DA_BUFFER_CAP, 256);
    }

    #[test]
    fn overflow_notice_starts_with_vt_reset() {
        // The VT full-reset (`\x1bc`) must be the first two bytes so xterm.js
        // is never left interpreting a partial escape sequence.
        assert!(
            OVERFLOW_NOTICE.starts_with(b"\x1bc"),
            "OVERFLOW_NOTICE must start with ESC c"
        );
    }
}
