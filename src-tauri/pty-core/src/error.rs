/// Errors produced by the PTY subsystem.
///
/// Commands return `Result<T, String>` (Tauri's preferred shape); the
/// `From<PtyError> for String` impl handles the conversion at the command boundary.
#[derive(Debug, thiserror::Error)]
pub enum PtyError {
    #[error("session not found: {0}")]
    NotFound(u32),

    #[error("pty spawn failed: {0}")]
    Spawn(String),

    #[error("pty io error: {0}")]
    Io(#[from] std::io::Error),
}

impl From<PtyError> for String {
    fn from(e: PtyError) -> Self {
        e.to_string()
    }
}
