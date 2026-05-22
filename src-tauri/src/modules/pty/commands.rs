use std::{
    io::Write,
    sync::{atomic::AtomicBool, Arc, Condvar, Mutex},
    thread,
};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::ipc::Channel;

use nyxterm_pty_core::{
    flusher::flusher_thread,
    reader::reader_thread,
    session::{Session, SessionThreads},
    state::PtyState,
    waiter::waiter_thread,
};

use super::PtyError;

/// Open a new PTY session running `$SHELL` (falls back to `/bin/sh`).
///
/// Returns the session ID that must be passed to `pty_write`, `pty_resize`,
/// and `pty_close`.
///
/// Slice 2: adds `on_exit` channel, waiter thread, killer, and `done` flag.
/// Shutdown ordering (design §2.4):
///   1. Child exits → reader gets EOF → reader thread returns.
///   2. Waiter's child.wait() returns → joins reader → sets done → notifies flusher.
///   3. Flusher drains remaining bytes → emits tail → exits.
///   4. Session::drop joins flusher + waiter (reader already joined by waiter).
#[tauri::command]
pub async fn pty_open(
    state: tauri::State<'_, PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    on_data: Channel<tauri::ipc::Response>,
    on_exit: Channel<i32>,
) -> Result<u32, String> {
    let size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(size)
        .map_err(|e| PtyError::Spawn(e.to_string()))?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/sh".into());

    let mut cmd = CommandBuilder::new(&shell);
    if let Some(dir) = cwd.or_else(|| dirs::home_dir().map(|d| d.to_string_lossy().into_owned())) {
        cmd.cwd(dir);
    }

    // Spawn the child. Keep the handle — the waiter thread will call child.wait().
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| PtyError::Spawn(e.to_string()))?;

    // Clone the killer BEFORE moving `child` into the waiter thread.
    // The killer allows pty_close / Session::drop to SIGHUP the child without
    // needing the full Child handle (which lives on the waiter thread).
    let killer = child.clone_killer();

    let master_writer = pair
        .master
        .take_writer()
        .map_err(|e| PtyError::Spawn(e.to_string()))?;
    let master_reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| PtyError::Spawn(e.to_string()))?;

    let pending: Arc<(Mutex<Vec<u8>>, Condvar)> =
        Arc::new((Mutex::new(Vec::new()), Condvar::new()));

    // `done` is set by the waiter thread once the child exits and reader is joined.
    // The flusher reads this flag to know when to drain remaining bytes and exit.
    let done = Arc::new(AtomicBool::new(false));

    // Wrap on_data in a Send+Sync closure for flusher_thread.
    let on_data_fn: Arc<dyn Fn(Vec<u8>) + Send + Sync> = {
        let ch = on_data.clone();
        Arc::new(move |bytes: Vec<u8>| {
            // `tauri::ipc::Response::new(vec)` routes through InvokeResponseBody::Raw
            // — arrives as ArrayBuffer on the JS side, no base64. REQ-PTY-012.
            // terax-ai pattern: review on tauri update.
            let _ = ch.send(tauri::ipc::Response::new(bytes));
        })
    };

    // Wrap on_exit in a Send+Sync closure for waiter_thread.
    let on_exit_fn: Arc<dyn Fn(i32) + Send + Sync> = {
        let ch = on_exit.clone();
        Arc::new(move |code: i32| {
            let _ = ch.send(code);
        })
    };

    let session = Arc::new(Session::new(
        master_writer,
        Arc::clone(&pending),
        Arc::clone(&on_data_fn),
        killer,
        Arc::clone(&done),
        Arc::clone(&on_exit_fn),
    ));

    // Spawn reader thread.
    // The reader does NOT set `done` — that is the waiter's responsibility (§2.4).
    // The reader simply exits when the PTY master signals EOF or error.
    let reader_pending = Arc::clone(&pending);
    let reader_writer = Arc::clone(&session.writer);
    let reader_handle = thread::spawn(move || {
        reader_thread(master_reader, reader_writer, reader_pending);
        // Reader returns here; waiter will observe this by joining the handle.
    });

    // Spawn flusher thread.
    // Uses `done` (set by waiter) rather than a separate reader_done flag so the
    // flusher only drains after the reader has fully exited (guaranteed by waiter).
    let flusher_pending = Arc::clone(&pending);
    let flusher_done = Arc::clone(&done);
    let flusher_on_data = Arc::clone(&on_data_fn);
    let flusher_handle = thread::spawn(move || {
        flusher_thread(flusher_pending, flusher_done, flusher_on_data);
    });

    // Spawn waiter thread.
    // Takes ownership of `child` (for child.wait()) and the reader JoinHandle
    // (for step 3 of the shutdown ordering). Sets `done=true` after joining reader.
    let waiter_pending = Arc::clone(&pending);
    let waiter_done = Arc::clone(&done);
    let waiter_handle = thread::spawn(move || {
        waiter_thread(
            child,
            reader_handle,
            waiter_pending,
            waiter_done,
            on_exit_fn,
        );
    });

    // Store flusher + waiter handles in the session.
    // The reader handle was moved into the waiter thread closure above —
    // the waiter joins reader as step 3 of the shutdown sequence (§2.4).
    // Drop only needs to join flusher and waiter.
    {
        let mut guard = session.threads.lock().unwrap();
        *guard = Some(SessionThreads {
            flusher: flusher_handle,
            waiter: waiter_handle,
        });
    }

    let id = state.insert(Arc::clone(&session));
    Ok(id)
}

/// Write bytes to an active PTY session.
///
/// Signal characters (`\x03`, `\x1a`, `\x1c`) are forwarded verbatim to the
/// PTY master so the kernel line discipline delivers the correct signal to the
/// foreground process group. We NEVER call kill() from Rust (REQ-PTY-004).
#[tauri::command]
pub async fn pty_write(
    state: tauri::State<'_, PtyState>,
    session_id: u32,
    data: String,
) -> Result<(), String> {
    let session = state
        .get(session_id)
        .ok_or_else(|| PtyError::NotFound(session_id).to_string())?;

    let mut writer = session.writer.lock().unwrap();
    writer.write_all(data.as_bytes()).map_err(PtyError::Io)?;
    writer.flush().map_err(PtyError::Io)?;
    Ok(())
}

/// Close an active PTY session.
///
/// Removes the session from the map; `Session::drop` fires the killer (SIGHUP)
/// and joins all threads. REQ-PTY-002 Scenario 3.
#[tauri::command]
pub async fn pty_close(state: tauri::State<'_, PtyState>, session_id: u32) -> Result<(), String> {
    state
        .remove(session_id)
        .ok_or_else(|| PtyError::NotFound(session_id).to_string())?;
    // Session is dropped here; Drop impl kills child + joins threads.
    Ok(())
}
