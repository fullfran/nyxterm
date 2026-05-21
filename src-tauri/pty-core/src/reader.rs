use std::{
    io::{Read, Write},
    sync::{Arc, Condvar, Mutex},
};

use crate::session::{DA_BUFFER_CAP, MAX_PENDING, OVERFLOW_NOTICE, READ_CHUNK};

/// Reader thread body.
///
/// Reads from the PTY master in 16 KiB chunks, appends filtered bytes to the
/// shared `pending` buffer, and notifies the flusher condvar after each write.
///
/// Slice 1: no DA filter (slice 3), no 4 MiB cap enforcement (slice 4 adds
/// the cap branch). The constants `MAX_PENDING` and `DA_BUFFER_CAP` are
/// defined here for documentation — they will be wired in slices 3 and 4.
///
/// Termination: `Ok(0)` or any `Err` from `read()` breaks the loop. Reader
/// sends a final `cv.notify_one()` so the flusher wakes for a last drain.
///
/// Lock-ordering rule: `writer` lock (for DA replies) is NEVER held while
/// `pending` lock is held — they are always acquired separately.
pub fn reader_thread(
    mut master_reader: Box<dyn Read + Send>,
    _writer: Arc<Mutex<Box<dyn Write + Send>>>,
    pending: Arc<(Mutex<Vec<u8>>, Condvar)>,
) {
    // Suppress unused constant warnings — these will be actively used in slice 3/4.
    let _ = MAX_PENDING;
    let _ = DA_BUFFER_CAP;
    let _ = OVERFLOW_NOTICE;

    let mut buf = [0u8; READ_CHUNK];
    loop {
        match master_reader.read(&mut buf) {
            Ok(0) => break, // EOF — child closed the master
            Ok(n) => {
                // Slice 1: pass bytes through without DA filter or cap.
                // Slices 3 and 4 will add da.process() and the cap branch here.
                let (m, cv) = &*pending;
                {
                    let mut g = m.lock().unwrap();
                    g.extend_from_slice(&buf[..n]);
                }
                cv.notify_one();
            }
            Err(_) => break, // master closed / error
        }
    }
    // Final notify so flusher wakes one last time and can drain any remaining bytes.
    let (_, cv) = &*pending;
    cv.notify_one();
}
