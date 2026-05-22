use std::{
    sync::{
        atomic::{AtomicBool, Ordering},
        Arc, Condvar, Mutex,
    },
    thread,
};

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use tauri::ipc::Channel;

use nyxterm_pty_core::{
    flusher::flusher_thread,
    reader::reader_thread,
    session::{Session, SessionThreads},
    state::PtyState,
};

use super::PtyError;

/// Open a new PTY session running `$SHELL` (falls back to `/bin/sh`).
///
/// Returns the session ID that must be passed to `pty_write` and `pty_close`.
///
/// Slice 1: no `on_exit` channel yet (added in PR Slice 2).
#[tauri::command]
pub async fn pty_open(
    state: tauri::State<'_, PtyState>,
    cols: u16,
    rows: u16,
    cwd: Option<String>,
    on_data: Channel<tauri::ipc::Response>,
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

    let _child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| PtyError::Spawn(e.to_string()))?;

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
    let reader_done = Arc::new(AtomicBool::new(false));

    // Wrap on_data in a Send+Sync closure for flusher_thread.
    let on_data_fn: Arc<dyn Fn(Vec<u8>) + Send + Sync> = {
        let ch = on_data.clone();
        Arc::new(move |bytes: Vec<u8>| {
            // `tauri::ipc::Response::new(vec)` routes through InvokeResponseBody::Raw
            // — arrives as ArrayBuffer on the JS side, no base64. REQ-PTY-012.
            let _ = ch.send(tauri::ipc::Response::new(bytes));
        })
    };

    let session = Arc::new(Session::new(
        0, // placeholder; real ID assigned by PtyState::insert below
        master_writer,
        Arc::clone(&pending),
        Arc::clone(&on_data_fn),
    ));

    // Spawn reader thread.
    let reader_pending = Arc::clone(&pending);
    let reader_writer = Arc::clone(&session.writer);
    let reader_done_clone = Arc::clone(&reader_done);
    let reader_handle = thread::spawn(move || {
        reader_thread(master_reader, reader_writer, reader_pending);
        // Signal flusher that reader has exited.
        reader_done_clone.store(true, Ordering::Release);
        // Notify condvar so flusher wakes.
        // (pending's condvar is inaccessible here; flusher will poll via reader_done)
    });

    // Spawn flusher thread.
    let flusher_pending = Arc::clone(&pending);
    let flusher_on_data = Arc::clone(&on_data_fn);
    let flusher_handle = thread::spawn(move || {
        flusher_thread(flusher_pending, reader_done, flusher_on_data);
    });

    // Store thread handles in the session.
    {
        let mut guard = session.threads.lock().unwrap();
        *guard = Some(SessionThreads {
            reader: reader_handle,
            flusher: flusher_handle,
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
    writer
        .write_all(data.as_bytes())
        .map_err(PtyError::Io)?;
    writer.flush().map_err(PtyError::Io)?;
    Ok(())
}

/// Close an active PTY session.
///
/// Removes the session from the map; `Session::drop` joins the reader and
/// flusher threads. The child receives SIGHUP when the master fd closes.
///
/// Slice 1: no explicit killer (added in PR Slice 2).
#[tauri::command]
pub async fn pty_close(
    state: tauri::State<'_, PtyState>,
    session_id: u32,
) -> Result<(), String> {
    state
        .remove(session_id)
        .ok_or_else(|| PtyError::NotFound(session_id).to_string())?;
    // Session is dropped here; Drop impl joins threads.
    Ok(())
}

// Needed in commands.rs for pty_write / pty_close
use std::io::Write;
