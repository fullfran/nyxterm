pub mod modules;

use modules::pty::{pty_close, pty_open, pty_write, PtyState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyState::new())
        .invoke_handler(tauri::generate_handler![pty_open, pty_write, pty_close])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
