// PTY core library — no Tauri dependency.
// Contains all PTY logic that can be tested without a webview.
//
// T1.2: error, backend, session, state
// T1.3: reader, flusher (added below after T1.2 commit)
pub mod backend;
pub mod error;
pub mod session;
pub mod state;
