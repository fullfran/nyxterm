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
