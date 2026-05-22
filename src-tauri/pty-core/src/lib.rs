// PTY core library — no Tauri dependency.
// Contains all PTY logic that can be unit-tested without a webview.
pub mod backend;
pub mod error;
pub mod flusher;
pub mod reader;
pub mod session;
pub mod state;
pub mod waiter;
