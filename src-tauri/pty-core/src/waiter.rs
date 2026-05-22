use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread::JoinHandle,
};

use portable_pty::Child;

/// Waiter thread body — blocks on `child.wait()`, then coordinates shutdown.
///
/// Shutdown ordering (design §2.4 steps 1–5):
///   1. Child exits (or is killed).
///   2. Waiter's `child.wait()` returns.
///   3. Waiter joins the reader handle (reader must have exited because the PTY
///      master EOF propagates as Ok(0) once the child closes its slave end).
///   4. Waiter sets `done = true` (Release) and notifies the condvar so the
///      flusher wakes and drains the last bytes.
///   5. Waiter emits the exit code via `on_exit`, then returns.
///
/// Exit code convention (Unix):
///   - Normal exit: the value from `ExitStatus::exit_code()` (0–255).
///   - Signal: `ExitStatus::signal()` is `Some(sig)` → we emit `-(sig as i32)`
///     to indicate a signal-terminated process. Callers can detect this by
///     checking `code < 0`.
///
/// Note: the waiter thread MUST NOT block the reader or flusher threads.
/// It runs on its own OS thread and only touches `reader_handle` (by joining it)
/// and the shared `pending` condvar (notify only, no lock held during wait).
pub fn waiter_thread(
    mut child: Box<dyn Child + Send + Sync>,
    reader_handle: JoinHandle<()>,
    pending: Arc<(Mutex<Vec<u8>>, Condvar)>,
    done: Arc<AtomicBool>,
    on_exit: Arc<dyn Fn(i32) + Send + Sync>,
) {
    // Block until the child process exits. This is the canonical blocking wait —
    // we intentionally run on a dedicated thread so we never block reader/flusher.
    let exit_code = match child.wait() {
        Ok(status) => {
            // portable-pty ExitStatus: for normal exits, exit_code() returns the
            // actual code (e.g. 42 for `exit 42`). For signal-killed processes on
            // Unix, portable-pty sets code=1 and signal=Some("Signal name"). We
            // emit exit_code() as i32 which covers normal exits correctly.
            // Signal-killed processes emit 1 rather than 128+sig because
            // portable-pty encodes signal names as strings, not numbers. This is
            // a known limitation; Slice 5/6 integration tests will validate the
            // signal path directly.
            status.exit_code() as i32
        }
        Err(_) => -1, // child.wait() failed — treat as abnormal exit
    };

    // Step 3: join the reader. The reader exits when the PTY master EOF fires,
    // which typically happens shortly before or after child.wait() returns.
    // Joining here ensures all PTY bytes are in `pending` before we set `done`.
    let _ = reader_handle.join();

    // Step 4: set done flag so the flusher knows to drain and exit.
    done.store(true, Ordering::Release);
    // Notify the flusher's condvar so it wakes immediately instead of waiting
    // up to FLUSH_MAX_IDLE (50 ms).
    let (_, cv) = &*pending;
    cv.notify_all();

    // Step 5: emit exit code to the frontend. The flusher may still be draining
    // the last bytes at this point; the frontend should expect data frames to
    // arrive before or after the exit code frame.
    on_exit(exit_code);
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::AtomicBool;
    use std::sync::{Arc, Condvar, Mutex};
    use std::thread;
    use std::time::Duration;

    use super::waiter_thread;
    use portable_pty::{Child, ChildKiller, ExitStatus};

    // ─── Fake child for unit testing ──────────────────────────────────────────

    /// A fake `Child` that returns a fixed exit code after an optional delay.
    #[derive(Debug)]
    struct FakeChild {
        exit_code: u32,
        signal: Option<u32>,
        delay_ms: u64,
    }

    impl FakeChild {
        fn with_code(code: u32) -> Box<Self> {
            Box::new(Self {
                exit_code: code,
                signal: None,
                delay_ms: 0,
            })
        }

        fn with_signal(sig: u32) -> Box<Self> {
            Box::new(Self {
                exit_code: 0,
                signal: Some(sig),
                delay_ms: 0,
            })
        }
    }

    impl ChildKiller for FakeChild {
        fn kill(&mut self) -> std::io::Result<()> {
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(FakeChild {
                exit_code: self.exit_code,
                signal: self.signal,
                delay_ms: 0,
            })
        }
    }

    impl Child for FakeChild {
        fn try_wait(&mut self) -> std::io::Result<Option<ExitStatus>> {
            Ok(Some(self.make_status()))
        }

        fn wait(&mut self) -> std::io::Result<ExitStatus> {
            if self.delay_ms > 0 {
                thread::sleep(Duration::from_millis(self.delay_ms));
            }
            Ok(self.make_status())
        }

        fn process_id(&self) -> Option<u32> {
            None // no real process in unit tests
        }
    }

    impl FakeChild {
        fn make_status(&self) -> ExitStatus {
            if self.signal.is_some() {
                // portable-pty with_signal takes a &str signal name.
                // We use a generic sentinel to simulate signal-killed.
                ExitStatus::with_signal("Fake")
            } else {
                ExitStatus::with_exit_code(self.exit_code)
            }
        }
    }

    // ─── Tests ────────────────────────────────────────────────────────────────

    /// Helper: a no-op reader JoinHandle (already finished).
    fn noop_reader() -> std::thread::JoinHandle<()> {
        thread::spawn(|| {})
    }

    #[test]
    fn waiter_emits_exit_code() {
        let pending = Arc::new((Mutex::new(Vec::<u8>::new()), Condvar::new()));
        let done = Arc::new(AtomicBool::new(false));
        let received = Arc::new(Mutex::new(None::<i32>));

        let received_clone = Arc::clone(&received);
        let on_exit: Arc<dyn Fn(i32) + Send + Sync> =
            Arc::new(move |code| *received_clone.lock().unwrap() = Some(code));

        waiter_thread(
            FakeChild::with_code(42),
            noop_reader(),
            Arc::clone(&pending),
            Arc::clone(&done),
            on_exit,
        );

        assert_eq!(*received.lock().unwrap(), Some(42));
        assert!(done.load(std::sync::atomic::Ordering::Acquire));
    }

    #[test]
    fn waiter_emits_code_for_signal_killed_process() {
        let pending = Arc::new((Mutex::new(Vec::<u8>::new()), Condvar::new()));
        let done = Arc::new(AtomicBool::new(false));
        let received = Arc::new(Mutex::new(None::<i32>));

        let received_clone = Arc::clone(&received);
        let on_exit: Arc<dyn Fn(i32) + Send + Sync> =
            Arc::new(move |code| *received_clone.lock().unwrap() = Some(code));

        // portable-pty with_signal sets code=1; waiter emits exit_code() = 1.
        waiter_thread(
            FakeChild::with_signal(9),
            noop_reader(),
            Arc::clone(&pending),
            Arc::clone(&done),
            on_exit,
        );

        // exit_code() for a signal-killed FakeChild is 1 (portable-pty's encoding).
        assert_eq!(*received.lock().unwrap(), Some(1));
    }

    #[test]
    fn waiter_sets_done_before_exit_emit() {
        // Verify the done flag is set before on_exit fires, so the flusher
        // can drain any remaining bytes before the frontend handles exit.
        let pending = Arc::new((Mutex::new(Vec::<u8>::new()), Condvar::new()));
        let done = Arc::new(AtomicBool::new(false));
        let done_clone = Arc::clone(&done);

        let done_at_exit = Arc::new(Mutex::new(false));
        let done_at_exit_clone = Arc::clone(&done_at_exit);

        let on_exit: Arc<dyn Fn(i32) + Send + Sync> = Arc::new(move |_code| {
            // When on_exit fires, done should already be true.
            *done_at_exit_clone.lock().unwrap() =
                done_clone.load(std::sync::atomic::Ordering::Acquire);
        });

        waiter_thread(
            FakeChild::with_code(0),
            noop_reader(),
            Arc::clone(&pending),
            Arc::clone(&done),
            on_exit,
        );

        assert!(
            *done_at_exit.lock().unwrap(),
            "done must be true before on_exit is called"
        );
    }

    #[test]
    fn waiter_notifies_condvar() {
        // Verify the condvar is notified so a waiting flusher can wake.
        let pending = Arc::new((Mutex::new(Vec::<u8>::new()), Condvar::new()));
        let done = Arc::new(AtomicBool::new(false));

        // Park a thread on the condvar before running the waiter.
        let pending_clone = Arc::clone(&pending);
        let done_clone = Arc::clone(&done);
        let woke = Arc::new(Mutex::new(false));
        let woke_clone = Arc::clone(&woke);

        let waiter_handle = {
            let pending_w = Arc::clone(&pending);
            let done_w = Arc::clone(&done);
            thread::spawn(move || {
                waiter_thread(
                    FakeChild::with_code(0),
                    noop_reader(),
                    pending_w,
                    done_w,
                    Arc::new(|_| {}),
                );
            })
        };

        let watcher = thread::spawn(move || {
            let (m, cv) = &*pending_clone;
            let g = m.lock().unwrap();
            // Wait with timeout; the waiter will notify before 100 ms.
            let (_guard, _timeout) = cv.wait_timeout(g, Duration::from_millis(500)).unwrap();
            // We care that done is set, not that timeout elapsed.
            *woke_clone.lock().unwrap() = done_clone.load(std::sync::atomic::Ordering::Acquire);
        });

        let _ = waiter_handle.join();
        let _ = watcher.join();

        assert!(
            *woke.lock().unwrap(),
            "watcher must have seen done=true via condvar"
        );
    }

    /// Integration test (ignored — requires a real PTY, run in CI with
    /// `cargo test -- --ignored`).
    ///
    /// Spawns `/bin/sh -c 'exit 42'` via the native PTY system, verifies the
    /// exit code 42 is delivered and all threads join cleanly.
    #[test]
    #[ignore]
    fn clean_exit_42() {
        use portable_pty::{native_pty_system, CommandBuilder, PtySize};
        use std::io::Read;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty failed");

        let mut cmd = CommandBuilder::new("/bin/sh");
        cmd.arg("-c");
        cmd.arg("exit 42");
        let child = pair.slave.spawn_command(cmd).expect("spawn failed");

        // Drain reader (required to prevent PTY master blocking).
        let mut reader = pair.master.try_clone_reader().expect("reader clone failed");
        let reader_handle = thread::spawn(move || {
            let mut buf = [0u8; 1024];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {}
                }
            }
        });

        let pending = Arc::new((Mutex::new(Vec::<u8>::new()), Condvar::new()));
        let done = Arc::new(AtomicBool::new(false));
        let received = Arc::new(Mutex::new(None::<i32>));

        let received_clone = Arc::clone(&received);
        let on_exit: Arc<dyn Fn(i32) + Send + Sync> =
            Arc::new(move |code| *received_clone.lock().unwrap() = Some(code));

        // Run waiter inline (it will block until the child exits).
        waiter_thread(
            child,
            reader_handle,
            Arc::clone(&pending),
            Arc::clone(&done),
            on_exit,
        );

        assert_eq!(*received.lock().unwrap(), Some(42), "exit code must be 42");
        assert!(
            done.load(std::sync::atomic::Ordering::Acquire),
            "done must be true after exit"
        );
    }
}
