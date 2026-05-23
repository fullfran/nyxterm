// keybinds module — Tauri commands for keybind config file I/O.
// Parsing and validation live in the frontend (TypeScript). Rust does file I/O only.
// REQ-KB-010, REQ-KB-011, REQ-KB-037.
pub mod config;

pub use config::{config_path, config_read, config_reload};
