pub mod modules;

use modules::pty::PtyState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(PtyState::new())
        // pty commands registered in T1.3
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
