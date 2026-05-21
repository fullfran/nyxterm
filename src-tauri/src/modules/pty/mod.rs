// Re-export core types for Tauri state management.
pub use nyxterm_pty_core::{error::PtyError, state::PtyState};

mod commands;
pub use commands::{pty_close, pty_open, pty_write};
