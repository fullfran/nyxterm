/**
 * config.rs — Tauri commands for keybind config file I/O.
 *
 * The frontend owns ALL parsing and validation; Rust does file I/O only.
 * REQ-KB-010: config_read returns raw file content as a string.
 * REQ-KB-011: missing file → Ok("") — engine treats empty as "no overrides".
 * REQ-KB-037: config_reload re-reads file + emits "keybinds-changed" Tauri event.
 *
 * File location (cross-platform via `dirs` crate):
 *   Linux/XDG: $XDG_CONFIG_HOME/nyxterm/config  (usually ~/.config/nyxterm/config)
 *   macOS:     ~/Library/Application Support/nyxterm/config
 *   Windows:   %APPDATA%/nyxterm/config
 *   Fallback:  ~/.config/nyxterm/config (when dirs::config_dir() returns None)
 */
use std::path::PathBuf;
use tauri::Emitter;

// ---------------------------------------------------------------------------
// Internal helpers — testable without a Tauri app handle
// ---------------------------------------------------------------------------

/// Return the canonical config file path.
///
/// Uses `dirs::config_dir()` for cross-platform XDG / App Support resolution.
/// Falls back to `~/.config/nyxterm/config` if `config_dir()` returns None.
pub(crate) fn config_file_path() -> Result<PathBuf, String> {
    if let Some(config) = dirs::config_dir() {
        Ok(config.join("nyxterm").join("config"))
    } else {
        let home = dirs::home_dir().ok_or_else(|| "no home directory found".to_string())?;
        Ok(home.join(".config").join("nyxterm").join("config"))
    }
}

/// Read the config file contents. Pure I/O — no Tauri handle required.
///
/// Returns:
///   Ok("") — file does not exist (REQ-KB-011)
///   Ok(content) — file read successfully
///   Err(msg) — I/O error (permission denied, etc.)
pub(crate) fn read_config_file() -> Result<String, String> {
    let path = config_file_path()?;
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(String::new()),
        Err(e) => Err(format!("read {}: {}", path.display(), e)),
    }
}

// ---------------------------------------------------------------------------
// Tauri commands
// ---------------------------------------------------------------------------

/// Return the canonical config file path as a string.
///
/// Useful for user-facing diagnostics and the welcome toast.
/// Optional command — not required by the boot sequence.
#[tauri::command]
pub async fn config_path() -> Result<String, String> {
    config_file_path().map(|p| p.to_string_lossy().into_owned())
}

/// Read the keybind config file and return its raw contents.
///
/// Returns Ok("") when the file is absent (REQ-KB-011).
/// Returns Err(...) only on permission denied or other I/O error.
/// The frontend owns all parsing and validation.
/// REQ-KB-010, REQ-KB-011.
#[tauri::command]
pub async fn config_read() -> Result<String, String> {
    read_config_file()
}

/// Re-read the keybind config file and emit a "keybinds-changed" Tauri event.
///
/// The frontend engine listens for "keybinds-changed" and rebuilds its active
/// binding map (REQ-KB-037, REQ-KB-038). Returns the file contents on success so
/// the caller can display diagnostics without a separate config_read call.
///
/// Event payload: raw file content string (same as config_read return value).
/// REQ-KB-037.
#[tauri::command]
pub async fn config_reload(app: tauri::AppHandle) -> Result<String, String> {
    let contents = read_config_file()?;
    app.emit("keybinds-changed", &contents)
        .map_err(|e: tauri::Error| e.to_string())?;
    Ok(contents)
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::path::PathBuf;

    /// Helper: create a temp dir and point XDG_CONFIG_HOME at it.
    /// Returns the temp dir path so tests can create files inside.
    fn setup_temp_config_dir() -> tempfile::TempDir {
        let dir = tempfile::tempdir().expect("create temp dir");
        std::env::set_var("XDG_CONFIG_HOME", dir.path());
        dir
    }

    #[test]
    fn config_path_ends_with_nyxterm_config() {
        let _dir = setup_temp_config_dir();
        let path = config_file_path().expect("config_file_path");
        assert!(
            path.ends_with(PathBuf::from("nyxterm").join("config")),
            "expected path to end with nyxterm/config, got: {}",
            path.display()
        );
    }

    #[test]
    fn config_read_returns_empty_when_file_absent() {
        let _dir = setup_temp_config_dir();
        // File does not exist — must return Ok("")
        let result = read_config_file();
        assert_eq!(result, Ok(String::new()), "expected Ok(\"\") for missing file");
    }

    #[test]
    fn config_read_returns_file_contents() {
        let dir = setup_temp_config_dir();
        // Create the config file with test content
        let config_dir = dir.path().join("nyxterm");
        fs::create_dir_all(&config_dir).expect("create nyxterm dir");
        let config_file = config_dir.join("config");
        let content = "keybind = ctrl+shift+c = terminal.copy_to_clipboard\n";
        fs::write(&config_file, content).expect("write config file");

        let result = read_config_file();
        assert_eq!(result, Ok(content.to_string()));
    }
}
