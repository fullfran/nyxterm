use std::{
    io::Write,
    sync::{Arc, Condvar, Mutex},
    thread::JoinHandle,
};

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

/// Thread handles created when a session opens.
///
/// Slice 1: reader + flusher only.
/// Waiter thread arrives in PR Slice 2 (adds `waiter`, `done`, `killer`, `on_exit`).
pub struct SessionThreads {
    pub reader: JoinHandle<()>,
    pub flusher: JoinHandle<()>,
}

// ─── Session ──────────────────────────────────────────────────────────────────

/// One active PTY session.
///
/// Slice 1 minimal shape — fields added in later slices:
///   Slice 2: `killer`, `on_exit`, `done`, `waiter` thread.
///
/// Lock-ordering rule (ADR-2): `writer` Mutex and `pending` Mutex are
/// INDEPENDENT. Neither is ever acquired while holding the other.
pub struct Session {
    pub id: u32,
    /// Serialises concurrent `pty_write` calls (NFR-005). Independent of `pending`.
    pub writer: Arc<Mutex<Box<dyn Write + Send>>>,
    /// Coalescing buffer shared reader → flusher. Independent of `writer`.
    pub pending: Arc<(Mutex<Vec<u8>>, Condvar)>,
    /// Sends coalesced byte chunks to the frontend. Called by the flusher thread.
    pub on_data: Arc<dyn Fn(Vec<u8>) + Send + Sync>,
    /// Thread handles; `Drop` joins them for clean shutdown.
    pub threads: Mutex<Option<SessionThreads>>,
}

impl Session {
    /// Constructs a session ready to have its threads started.
    pub fn new(
        id: u32,
        writer: Box<dyn Write + Send>,
        pending: Arc<(Mutex<Vec<u8>>, Condvar)>,
        on_data: Arc<dyn Fn(Vec<u8>) + Send + Sync>,
    ) -> Self {
        Self {
            id,
            writer: Arc::new(Mutex::new(writer)),
            pending,
            on_data,
            threads: Mutex::new(None),
        }
    }
}

impl Drop for Session {
    /// Join reader and flusher so no threads outlive the Session.
    fn drop(&mut self) {
        if let Ok(mut guard) = self.threads.lock() {
            if let Some(threads) = guard.take() {
                // Wake the flusher so it exits its wait loop.
                let (_, cv) = &*self.pending;
                cv.notify_all();
                let _ = threads.reader.join();
                let _ = threads.flusher.join();
            }
        }
    }
}

// ─── Test helpers ─────────────────────────────────────────────────────────────

#[cfg(test)]
impl Session {
    /// Stub session for unit tests that don't need a real PTY.
    /// `id` is set to `expected_id`; all I/O is a no-op.
    pub fn new_stub(expected_id: u32) -> Self {
        Self {
            id: expected_id,
            writer: Arc::new(Mutex::new(Box::new(std::io::sink()))),
            pending: Arc::new((Mutex::new(Vec::new()), Condvar::new())),
            on_data: Arc::new(|_bytes| {}),
            threads: Mutex::new(None),
        }
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
        assert!(OVERFLOW_NOTICE.starts_with(b"\x1bc"), "OVERFLOW_NOTICE must start with ESC c");
    }
}
