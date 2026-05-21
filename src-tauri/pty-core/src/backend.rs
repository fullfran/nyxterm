use portable_pty::{native_pty_system, PtyPair, PtySize};

use crate::error::PtyError;

/// Thin testability seam around `portable_pty::PtySystem`.
///
/// ADR-1: introduced in epic #1 only as a mock seam for fast unit tests.
/// Not a heavyweight service layer — one method, object-safe, replaces a
/// single line in the spawn path. Production always uses `NativeBackend`.
#[cfg_attr(test, mockall::automock)]
pub trait PtyBackend: Send + Sync {
    fn openpty(&self, size: PtySize) -> Result<PtyPair, PtyError>;
}

/// Production implementation backed by the OS native PTY system.
pub struct NativeBackend;

impl PtyBackend for NativeBackend {
    fn openpty(&self, size: PtySize) -> Result<PtyPair, PtyError> {
        native_pty_system()
            .openpty(size)
            .map_err(|e| PtyError::Spawn(e.to_string()))
    }
}
