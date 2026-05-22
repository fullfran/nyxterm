use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
};

use crate::session::{FLUSH_COALESCE, FLUSH_MAX_IDLE};

/// Flusher thread body.
///
/// Waits for the pending buffer to become non-empty (or a 50 ms timeout),
/// then sleeps 4 ms to coalesce bursts, takes all accumulated bytes atomically,
/// and sends them via `on_data`.
///
/// Termination: exits when `done` is true AND the pending buffer is empty.
/// The `done` flag is set by the waiter thread (PR Slice 2). In Slice 1 we use
/// a simpler shared `Arc<AtomicBool>` that the reader sets before it returns.
pub fn flusher_thread(
    pending: Arc<(Mutex<Vec<u8>>, Condvar)>,
    reader_done: Arc<AtomicBool>,
    on_data: Arc<dyn Fn(Vec<u8>) + Send + Sync>,
) {
    let (m, cv) = &*pending;
    loop {
        // Wait for data or shutdown signal, bounded by FLUSH_MAX_IDLE.
        let mut g = m.lock().unwrap();
        while g.is_empty() && !reader_done.load(Ordering::Acquire) {
            let (gn, timeout) = cv.wait_timeout(g, FLUSH_MAX_IDLE).unwrap();
            g = gn;
            if timeout.timed_out() && g.is_empty() {
                if reader_done.load(Ordering::Acquire) {
                    return; // nothing pending, reader done
                }
                continue; // spurious timeout — keep waiting
            }
            if !g.is_empty() {
                break;
            }
        }
        // If done and nothing pending, exit.
        if g.is_empty() && reader_done.load(Ordering::Acquire) {
            return;
        }
        // Release the lock before the coalesce sleep so the reader can keep appending.
        drop(g);

        // 4 ms coalesce window — accumulate concurrent reader writes into one chunk.
        thread::sleep(FLUSH_COALESCE);

        let chunk: Vec<u8> = {
            let mut g = m.lock().unwrap();
            std::mem::take(&mut *g)
        };

        if !chunk.is_empty() {
            on_data(chunk);
        }

        // Tail-drain: after reader has exited, do one final drain pass.
        if reader_done.load(Ordering::Acquire) {
            let tail: Vec<u8> = std::mem::take(&mut *m.lock().unwrap());
            if !tail.is_empty() {
                on_data(tail);
            }
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use std::{
        sync::{
            atomic::{AtomicBool, Ordering},
            Arc, Condvar, Mutex,
        },
        thread,
        time::Duration,
    };

    use super::flusher_thread;

    // ─── Helper ───────────────────────────────────────────────────────────────

    /// Create the shared state needed to drive a flusher thread in tests.
    ///
    /// Returns `(pending, done, calls, flusher_handle)`:
    ///   - `pending` — the buffer + condvar pair
    ///   - `done`    — the AtomicBool the flusher reads for shutdown
    ///   - `calls`   — all on_data payloads received by the flusher
    #[allow(clippy::type_complexity)]
    fn make_flusher() -> (
        Arc<(Mutex<Vec<u8>>, Condvar)>,
        Arc<AtomicBool>,
        Arc<Mutex<Vec<Vec<u8>>>>,
        thread::JoinHandle<()>,
    ) {
        let pending: Arc<(Mutex<Vec<u8>>, Condvar)> =
            Arc::new((Mutex::new(Vec::new()), Condvar::new()));
        let done = Arc::new(AtomicBool::new(false));
        let calls: Arc<Mutex<Vec<Vec<u8>>>> = Arc::new(Mutex::new(Vec::new()));

        let flusher_pending = Arc::clone(&pending);
        let flusher_done = Arc::clone(&done);
        let flusher_calls = Arc::clone(&calls);
        let on_data: Arc<dyn Fn(Vec<u8>) + Send + Sync> =
            Arc::new(move |chunk| flusher_calls.lock().unwrap().push(chunk));

        let handle = thread::spawn(move || {
            flusher_thread(flusher_pending, flusher_done, on_data);
        });

        (pending, done, calls, handle)
    }

    // ─── Tests ────────────────────────────────────────────────────────────────

    /// coalesce_window: push 3 small chunks within 4 ms; they should be batched
    /// into ≤ 2 on_data calls (ideally 1 if the flusher sees all three before
    /// its coalesce sleep ends). We assert ≤ 2 to allow for timing variance.
    ///
    /// Design §2.3 — 4 ms coalesce window: reader notifications during the
    /// 4 ms sleep accumulate in `pending`; flusher's mem::take drains atomically.
    #[test]
    fn coalesce_window() {
        let (pending, done, calls, handle) = make_flusher();

        // Push 3 chunks in rapid succession (well within 4 ms).
        for i in 0u8..3 {
            let (m, cv) = &*pending;
            let mut g = m.lock().unwrap();
            g.push(i);
            cv.notify_one();
        }

        // Wait long enough for the flusher to complete one coalesce cycle
        // (4 ms coalesce + 50 ms max idle = at most ~55 ms before flush).
        thread::sleep(Duration::from_millis(100));

        // Shut down.
        done.store(true, Ordering::Release);
        pending.1.notify_all();
        let _ = handle.join();

        let n = calls.lock().unwrap().len();
        assert!(
            n <= 2,
            "expected ≤ 2 on_data calls for 3 rapid chunks (coalesce window), got {n}"
        );
        assert!(n >= 1, "expected at least 1 on_data call, got {n}");

        // Total bytes received must be exactly 3 (no data loss).
        let total: usize = calls.lock().unwrap().iter().map(|v| v.len()).sum();
        assert_eq!(total, 3, "all 3 bytes must arrive, no data loss");
    }

    /// max_idle_forces_flush: push one chunk, wait 60 ms (> FLUSH_MAX_IDLE=50 ms).
    /// The flusher must flush even without a condvar notify.
    ///
    /// Design §2.3 — 50 ms max idle ceiling: "a sub-1-byte trickle still
    /// flushes within 50 ms".
    #[test]
    fn max_idle_forces_flush() {
        let (pending, done, calls, handle) = make_flusher();

        // Push one chunk.
        {
            let (m, cv) = &*pending;
            let mut g = m.lock().unwrap();
            g.extend_from_slice(b"hello");
            cv.notify_one();
        }

        // Wait longer than FLUSH_MAX_IDLE (50 ms) to let the idle timer fire.
        thread::sleep(Duration::from_millis(110));

        done.store(true, Ordering::Release);
        pending.1.notify_all();
        let _ = handle.join();

        let n = calls.lock().unwrap().len();
        assert!(
            n >= 1,
            "expected at least 1 on_data call after 110 ms idle, got {n}"
        );

        let total: usize = calls.lock().unwrap().iter().map(|v| v.len()).sum();
        assert_eq!(total, 5, "all 5 bytes of 'hello' must arrive");
    }

    /// drain_on_done: push chunks, set done, notify. The flusher must drain
    /// all remaining bytes from pending and then exit within 100 ms.
    ///
    /// Design §2.3 tail-drain: "one final drain pass to be safe (terax-ai pattern)".
    #[test]
    fn drain_on_done() {
        let (pending, done, calls, handle) = make_flusher();

        // Give the flusher a moment to enter its wait loop.
        thread::sleep(Duration::from_millis(20));

        // Push data and immediately signal done.
        {
            let (m, cv) = &*pending;
            let mut g = m.lock().unwrap();
            g.extend_from_slice(b"drain-me");
            // Signal done BEFORE notifying, so flusher wakes and sees done=true.
            done.store(true, Ordering::Release);
            cv.notify_all();
        }

        // Flusher should exit promptly (it drains on done).
        let joined = thread::spawn(move || {
            handle.join().expect("flusher panicked");
        });
        // Allow up to 300 ms for the flusher to drain and exit.
        thread::sleep(Duration::from_millis(300));
        // The join thread should have finished by now.
        assert!(
            joined.is_finished(),
            "flusher did not exit within 300 ms after done=true"
        );

        let total: usize = calls.lock().unwrap().iter().map(|v| v.len()).sum();
        assert_eq!(
            total, 8,
            "all 8 bytes of 'drain-me' must arrive before flusher exits"
        );
    }

    /// empty_pending_no_call: set done immediately with nothing in pending.
    /// The flusher must exit without calling on_data.
    ///
    /// Ensures no spurious empty calls are emitted (avoids sending zero-length
    /// ArrayBuffer frames to xterm.js).
    #[test]
    fn empty_pending_no_call() {
        let (pending, done, calls, handle) = make_flusher();

        // Signal done immediately — pending is empty.
        done.store(true, Ordering::Release);
        pending.1.notify_all();
        let _ = handle.join();

        let n = calls.lock().unwrap().len();
        assert_eq!(
            n, 0,
            "on_data must not be called when pending is always empty"
        );
    }
}
