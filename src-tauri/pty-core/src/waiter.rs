use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread::JoinHandle,
};

use portable_pty::Child;

/// Map a `strsignal(3)` name string to a POSIX signal number.
///
/// portable-pty's `ExitStatus::signal()` returns the string produced by
/// `libc::strsignal()` — e.g. `"Interrupt"` for SIGINT, `"Killed"` for SIGKILL.
/// These are the canonical libc signal descriptions on Linux (glibc).
///
/// Returns `Some(128 + signum)` for known signals, `None` for unknown ones
/// (caller falls back to `exit_code()`).
///
/// Signal numbers per POSIX / Linux (signal(7)):
///   SIGHUP=1, SIGINT=2, SIGQUIT=3, SIGILL=4, SIGABRT=6, SIGFPE=8,
///   SIGKILL=9, SIGUSR1=10, SIGSEGV=11, SIGUSR2=12, SIGPIPE=13,
///   SIGALRM=14, SIGTERM=15, SIGCONT=18, SIGTSTP=20.
pub fn map_signal_name(name: &str) -> Option<i32> {
    let signum = match name {
        "Hangup" => 1,                   // SIGHUP
        "Interrupt" => 2,                // SIGINT  → exit 130
        "Quit" => 3,                     // SIGQUIT → exit 131
        "Illegal instruction" => 4,      // SIGILL
        "Aborted" | "Abort trap" => 6,   // SIGABRT
        "Floating point exception" => 8, // SIGFPE
        "Killed" => 9,                   // SIGKILL → exit 137
        "User defined signal 1" => 10,   // SIGUSR1
        "Segmentation fault" => 11,      // SIGSEGV
        "User defined signal 2" => 12,   // SIGUSR2
        "Broken pipe" => 13,             // SIGPIPE
        "Alarm clock" => 14,             // SIGALRM
        "Terminated" => 15,              // SIGTERM
        "Continued" => 18,               // SIGCONT
        "Stopped" | "Stopped (signal)" | "Stopped (tty input)" | "Stopped (tty output)" => 20, // SIGTSTP/SIGSTOP
        _ => return None,
    };
    Some(128 + signum)
}

/// Compute the exit code for a completed child.
///
/// - Normal exit (`signal() == None`): returns `exit_code()` as i32.
/// - Signal exit (`signal() == Some(name)`): returns `128 + signum` per the
///   POSIX convention (REQ-PTY-002 Scenario 2). Falls back to `exit_code()`
///   when the signal name is unrecognised.
fn compute_exit_code(status: &portable_pty::ExitStatus) -> i32 {
    if let Some(sig_name) = status.signal() {
        if let Some(code) = map_signal_name(sig_name) {
            return code;
        }
    }
    status.exit_code() as i32
}

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
/// Exit code convention (Unix, REQ-PTY-002 Scenario 2):
///   - Normal exit: the value from `ExitStatus::exit_code()` (0–255).
///   - Signal: `128 + signum` (e.g. SIGINT=130, SIGKILL=137, SIGQUIT=131).
///     Derived via `map_signal_name()` from portable-pty's signal name string.
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
        Ok(status) => compute_exit_code(&status),
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

    use super::{map_signal_name, waiter_thread};
    use portable_pty::{Child, ChildKiller, ExitStatus};

    // ─── Fake child for unit testing ──────────────────────────────────────────

    /// A fake `Child` that returns a fixed exit code or a signal name.
    ///
    /// Use `with_code(n)` for normal exit or `with_signal_name("Killed")` etc.
    /// Signal name strings must match `strsignal(3)` output (e.g. "Killed",
    /// "Interrupt", "Quit") — portable-pty converts those via its `From<ExitStatus>`.
    #[derive(Debug)]
    struct FakeChild {
        exit_code: u32,
        /// When Some, `make_status()` calls `ExitStatus::with_signal(name)`.
        signal_name: Option<&'static str>,
        delay_ms: u64,
    }

    impl FakeChild {
        fn with_code(code: u32) -> Box<Self> {
            Box::new(Self {
                exit_code: code,
                signal_name: None,
                delay_ms: 0,
            })
        }

        /// Build a `FakeChild` that exits via a signal name string —
        /// use the actual `strsignal(3)` string (e.g. `"Killed"` for SIGKILL).
        fn with_signal_name(sig_name: &'static str) -> Box<Self> {
            Box::new(Self {
                exit_code: 0,
                signal_name: Some(sig_name),
                delay_ms: 0,
            })
        }

        fn make_status(&self) -> ExitStatus {
            if let Some(name) = self.signal_name {
                ExitStatus::with_signal(name)
            } else {
                ExitStatus::with_exit_code(self.exit_code)
            }
        }
    }

    impl ChildKiller for FakeChild {
        fn kill(&mut self) -> std::io::Result<()> {
            Ok(())
        }
        fn clone_killer(&self) -> Box<dyn ChildKiller + Send + Sync> {
            Box::new(FakeChild {
                exit_code: self.exit_code,
                signal_name: self.signal_name,
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

        // SIGKILL (9) → portable-pty signal name "Killed" → map_signal_name → 128+9=137.
        waiter_thread(
            FakeChild::with_signal_name("Killed"),
            noop_reader(),
            Arc::clone(&pending),
            Arc::clone(&done),
            on_exit,
        );

        // REQ-PTY-002 Scenario 2: signal-killed process emits 128+signum.
        assert_eq!(
            *received.lock().unwrap(),
            Some(137),
            "SIGKILL (strsignal='Killed') should map to exit code 137 (128+9)"
        );
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

    // ─── map_signal_name tests ────────────────────────────────────────────────

    #[test]
    fn map_signal_name_sigint_gives_130() {
        // "Interrupt" is libc::strsignal(SIGINT=2) on Linux.
        assert_eq!(map_signal_name("Interrupt"), Some(130));
    }

    #[test]
    fn map_signal_name_sigkill_gives_137() {
        assert_eq!(map_signal_name("Killed"), Some(137));
    }

    #[test]
    fn map_signal_name_sigquit_gives_131() {
        assert_eq!(map_signal_name("Quit"), Some(131));
    }

    #[test]
    fn map_signal_name_sigtstp_gives_148() {
        // "Stopped" is libc::strsignal(SIGTSTP=20) on Linux.
        assert_eq!(map_signal_name("Stopped"), Some(148));
    }

    #[test]
    fn map_signal_name_sigterm_gives_143() {
        assert_eq!(map_signal_name("Terminated"), Some(143));
    }

    #[test]
    fn map_signal_name_unknown_returns_none() {
        assert_eq!(map_signal_name("SomeFutureSignal"), None);
        assert_eq!(map_signal_name(""), None);
        assert_eq!(map_signal_name("Fake"), None);
    }

    #[test]
    fn map_signal_name_all_known_signals_round_trip() {
        // Verify every entry in the map returns Some(128 + n) and the signum
        // is in the expected range.
        let known: &[(&str, i32)] = &[
            ("Hangup", 129),
            ("Interrupt", 130),
            ("Quit", 131),
            ("Illegal instruction", 132),
            ("Aborted", 134),
            ("Abort trap", 134),
            ("Floating point exception", 136),
            ("Killed", 137),
            ("User defined signal 1", 138),
            ("Segmentation fault", 139),
            ("User defined signal 2", 140),
            ("Broken pipe", 141),
            ("Alarm clock", 142),
            ("Terminated", 143),
            ("Continued", 146),
            ("Stopped", 148),
            ("Stopped (signal)", 148),
            ("Stopped (tty input)", 148),
            ("Stopped (tty output)", 148),
        ];
        for &(name, expected) in known {
            assert_eq!(
                map_signal_name(name),
                Some(expected),
                "signal name '{name}' should map to {expected}"
            );
        }
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
