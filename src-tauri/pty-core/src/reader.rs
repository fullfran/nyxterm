use std::{
    io::{Read, Write},
    sync::{Arc, Condvar, Mutex},
};

use crate::{
    da_filter::DaFilter,
    session::{MAX_PENDING, OVERFLOW_NOTICE, READ_CHUNK},
};

/// Reader thread body.
///
/// Reads from the PTY master in 16 KiB chunks, feeds each chunk through
/// `DaFilter`, writes any DA replies back to the PTY master, and appends
/// the surviving bytes to the shared `pending` buffer.
///
/// Lock-ordering rule (ADR-2 / design §2.1):
///   The `writer` lock and the `pending` lock are INDEPENDENT. DA replies are
///   written via `writer.lock()` BEFORE `pending.lock()` is acquired in the
///   same iteration. Neither lock is ever held while acquiring the other.
///
/// Termination: `Ok(0)` or any `Err` from `read()` breaks the loop. A final
/// `cv.notify_one()` is sent so the flusher wakes for a last drain pass.
///
/// Note: the reader does NOT set `done`. That is the waiter thread's
/// responsibility (design §2.4 shutdown ordering).
pub fn reader_thread(
    mut master_reader: Box<dyn Read + Send>,
    writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pending: Arc<(Mutex<Vec<u8>>, Condvar)>,
) {
    let mut buf = [0u8; READ_CHUNK];
    let mut da = DaFilter::new();

    loop {
        match master_reader.read(&mut buf) {
            Ok(0) => break, // EOF — child closed the master
            Ok(n) => {
                let (filtered, replies) = da.process(&buf[..n]);

                // Step 1: write DA replies to PTY master (lock writer, then release).
                // Must happen BEFORE touching `pending` (lock-ordering rule).
                if !replies.is_empty() {
                    if let Ok(mut w) = writer.lock() {
                        for r in &replies {
                            let _ = w.write_all(r);
                        }
                        let _ = w.flush();
                    }
                }

                // Step 2: append filtered bytes to pending, enforce 4 MiB cap.
                // `pending` lock is acquired here — writer lock is already released.
                {
                    let (m, cv) = &*pending;
                    let mut g = m.lock().unwrap();
                    if g.len() + filtered.len() > MAX_PENDING {
                        // Backpressure cap exceeded (design §2.6):
                        // clear the buffer and inject the VT-reset + notice.
                        // Slice 4 will add the explicit cap enforcement branch;
                        // this guard already matches the design contract.
                        g.clear();
                        g.extend_from_slice(OVERFLOW_NOTICE);
                    } else {
                        g.extend_from_slice(&filtered);
                    }
                    cv.notify_one();
                }
            }
            Err(_) => break, // master closed / error
        }
    }

    // Final notify so the flusher wakes one last time and can drain remaining bytes.
    let (_, cv) = &*pending;
    cv.notify_one();
}
