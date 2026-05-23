# Keybinds Reference

Keybinds in nyxterm follow a ghostty-style config grammar at `~/.config/nyxterm/config`.
Defaults are baked in (29 bindings). Override, extend, or unbind any chord without rebuilding the app.

Press `Ctrl+Shift+,` to reload config without restarting.

---

## Grammar (ABNF)

```abnf
config        = *( comment / blank-line / keybind-line / unrecognized-line )

keybind-line  = "keybind" 1*WSP "=" 1*WSP chord 1*WSP "=" 1*WSP target *WSP EOL
chord         = modifier *( "+" modifier ) "+" key
modifier      = "ctrl" / "shift" / "alt" / "super"
key           = letter / digit / special-key / symbol-alias
letter        = %x61-7A                 ; a-z (lowercase only)
digit         = %x30-39                 ; 0-9
special-key   = "escape" / "return" / "enter" / "tab" / "space" / "backspace"
              / "delete" / "insert" / "home" / "end" / "pageup" / "pagedown"
              / "up" / "down" / "left" / "right"
              / "f1" / "f2" / "f3" / "f4" / "f5" / "f6"
              / "f7" / "f8" / "f9" / "f10" / "f11" / "f12"
symbol-alias  = "plus" / "minus" / "comma" / "period" / "slash" / "backslash"
target        = action-ref / "unbind"
action-ref    = [domain "."] identifier
domain        = 1*( letter / digit )
identifier    = 1*( letter / digit / "_" )
comment       = "#" *non-newline EOL
blank-line    = *WSP EOL
WSP           = SP / HTAB
EOL           = LF / CRLF
```

**Case rules**: All chord tokens must be lowercase. Action IDs are case-sensitive and must match the canonical form exactly. Whitespace around `=` is tolerated. Trailing whitespace is stripped.

---

## Examples

### Valid config lines

```
# Override: remap ctrl+shift+c to paste instead of copy
keybind = ctrl+shift+c = terminal.paste_from_clipboard

# Unbind: let ctrl+shift+t fall through to the PTY
keybind = ctrl+shift+t = unbind

# Extend: add a new chord not in the defaults
keybind = ctrl+shift+q = terminal.copy_to_clipboard

# Font size with symbol aliases
keybind = ctrl+plus = terminal.font_size_inc
keybind = ctrl+minus = terminal.font_size_dec

# Reload config (also the default — shown for documentation)
keybind = ctrl+shift+comma = terminal.reload_config
```

### Invalid config lines (rejected with a warning)

```
keybind = ctrl+c = terminal.copy_to_clipboard
# REJECTED: ctrl+c is a reserved chord — passes Ctrl+C / SIGINT to the PTY.

keybind = ctrl+shift+c = nonexistent.action
# REJECTED: nonexistent.action is not a member of the ActionId list.

keybind garbage line
# REJECTED: does not match grammar (missing "keybind = chord = target" structure).
```

---

## ActionId List

All 32 action IDs grouped by domain. Pass one as the target in your config file.

### `terminal.*` — Group A (fully implemented)

| Action ID | Default Chord | Description |
|-----------|---------------|-------------|
| `terminal.copy_to_clipboard` | `ctrl+shift+c` | Copy xterm selection to system clipboard |
| `terminal.paste_from_clipboard` | `ctrl+shift+v` | Paste from system clipboard to PTY (bracketed) |
| `terminal.scroll_page_up` | `ctrl+shift+up` | Scroll viewport one page up |
| `terminal.scroll_page_down` | `ctrl+shift+down` | Scroll viewport one page down |
| `terminal.scroll_to_top` | `ctrl+shift+home` | Scroll viewport to top of scrollback |
| `terminal.scroll_to_bottom` | `ctrl+shift+end` | Scroll viewport to bottom (current output) |
| `terminal.font_size_inc` | `ctrl+plus` | Increase font size by 1; refit; SIGWINCH |
| `terminal.font_size_dec` | `ctrl+minus` | Decrease font size by 1; refit; SIGWINCH |
| `terminal.font_size_reset` | `ctrl+0` | Reset font size to BASE_FONT_SIZE; refit |
| `terminal.clear_screen` | _(unbound)_ | Clear terminal viewport only (no PTY) |
| `terminal.reload_config` | `ctrl+shift+comma` | Re-read config file and hot-reload bindings |

### `pane.*` — Group B (stubs — implemented by epic #2)

| Action ID | Default Chord | Description |
|-----------|---------------|-------------|
| `pane.split_right` | `ctrl+shift+r` | Split current pane horizontally (new pane right) |
| `pane.split_down` | `ctrl+shift+f` | Split current pane vertically (new pane below) |
| `pane.navigate_left` | `ctrl+shift+h` | Focus pane to the left |
| `pane.navigate_down` | `ctrl+shift+j` | Focus pane below |
| `pane.navigate_right` | `ctrl+shift+l` | Focus pane to the right |
| `pane.kill_pane` | `ctrl+shift+w` | Close focused pane (with confirmation) |
| `pane.zoom_pane` | `ctrl+shift+z` | Toggle zoom on focused pane |

Note: `pane.navigate_up` is intentionally absent from root bindings. `Ctrl+Shift+K` is assigned to `session.kill_session`. Navigate-up remains prefix-mode only (epic #2).

### `tab.*` — Group C (stubs — implemented by epic #2)

| Action ID | Default Chord | Description |
|-----------|---------------|-------------|
| `tab.new_tab` | `ctrl+shift+t` | Open new tab in current session |
| `tab.next_tab` | `ctrl+tab` | Focus next tab |
| `tab.previous_tab` | `ctrl+shift+tab` | Focus previous tab |
| `tab.kill_tab` | _(unbound)_ | Close current tab |

### `session.*` — Group C (stubs — implemented by epic #2)

| Action ID | Default Chord | Description |
|-----------|---------------|-------------|
| `session.new_session` | `ctrl+shift+e` | Create new named session |
| `session.rename_session` | `ctrl+shift+n` | Rename current session |
| `session.switch_last_session` | `ctrl+shift+b` | Switch to previously active session |
| `session.picker` | `ctrl+shift+s` | Open session picker popup |
| `session.kill_session` | `ctrl+shift+k` | Kill current session (with confirmation) |
| `session.detach` | `ctrl+shift+d` | Smart detach from current session |

### `app.*` — Group C (stubs — implemented by epics #12, #16)

| Action ID | Default Chord | Description |
|-----------|---------------|-------------|
| `app.popup_git` | `ctrl+shift+g` | Open git popup overlay |
| `app.popup_ai` | `ctrl+shift+a` | Open AI panel/selector |
| `app.copy_mode_enter` | `ctrl+shift+escape` | Enter copy mode (vi-style) |

---

## FullFran Default Bindings (all 29)

These are the bindings active when no config file is present. Chord format: modifiers sorted `ctrl < alt < shift < meta`, key lowercased, symbols use aliases (`plus`, `minus`, `comma`).

| Chord | Action ID | Source |
|-------|-----------|--------|
| `ctrl+shift+c` | `terminal.copy_to_clipboard` | ghostty |
| `ctrl+shift+v` | `terminal.paste_from_clipboard` | ghostty |
| `ctrl+shift+up` | `terminal.scroll_page_up` | ghostty |
| `ctrl+shift+down` | `terminal.scroll_page_down` | ghostty |
| `ctrl+shift+home` | `terminal.scroll_to_top` | ghostty |
| `ctrl+shift+end` | `terminal.scroll_to_bottom` | ghostty |
| `ctrl+plus` | `terminal.font_size_inc` | ghostty |
| `ctrl+minus` | `terminal.font_size_dec` | ghostty |
| `ctrl+0` | `terminal.font_size_reset` | ghostty |
| `ctrl+shift+comma` | `terminal.reload_config` | ghostty |
| `ctrl+shift+r` | `pane.split_right` | tmux |
| `ctrl+shift+f` | `pane.split_down` | tmux |
| `ctrl+shift+h` | `pane.navigate_left` | tmux |
| `ctrl+shift+j` | `pane.navigate_down` | tmux |
| `ctrl+shift+l` | `pane.navigate_right` | tmux |
| `ctrl+shift+w` | `pane.kill_pane` | tmux |
| `ctrl+shift+z` | `pane.zoom_pane` | tmux |
| `ctrl+shift+t` | `tab.new_tab` | tmux |
| `ctrl+tab` | `tab.next_tab` | tmux |
| `ctrl+shift+tab` | `tab.previous_tab` | tmux |
| `ctrl+shift+e` | `session.new_session` | tmux |
| `ctrl+shift+n` | `session.rename_session` | tmux |
| `ctrl+shift+b` | `session.switch_last_session` | tmux |
| `ctrl+shift+s` | `session.picker` | tmux |
| `ctrl+shift+k` | `session.kill_session` | tmux |
| `ctrl+shift+d` | `session.detach` | tmux |
| `ctrl+shift+g` | `app.popup_git` | tmux |
| `ctrl+shift+a` | `app.popup_ai` | tmux |
| `ctrl+shift+escape` | `app.copy_mode_enter` | tmux |

---

## Reserved Chords

These chords **cannot** be captured by any config file or `registerAction` call. They pass through to the PTY untouched.

- **Bare `Ctrl+letter` (a–z)**: map to ASCII control characters (Ctrl+C = SIGINT, Ctrl+D = EOF, etc.)
- **Bare navigation/editing keys**: arrow keys, Home, End, PageUp, PageDown, Insert, Delete, Backspace, Tab, Escape, Enter
- **Bare function keys**: F1–F12
- **Bare printable characters**: any chord with no modifiers

`Ctrl+Shift+<letter>` combinations are free and are where all FullFran defaults live.

---

## WebKit Hijack Prevention

When running in Tauri's WebKitGTK webview, certain browser shortcuts must be unconditionally blocked with `preventDefault()` to prevent the React app from reloading or closing the window — which would kill your PTY session.

| Chord | Browser Action | Notes |
|-------|---------------|-------|
| `ctrl+r` | Page reload | CRITICAL — kills PTY |
| `ctrl+shift+r` | Hard reload | CRITICAL — kills PTY |
| `ctrl+w` | Close window | Prevented defensively |
| `ctrl+f` | Find bar | Prevented |
| `ctrl+0` | Reset zoom | Bound to `terminal.font_size_reset` |
| `ctrl+plus` | Zoom in | Bound to `terminal.font_size_inc` |
| `ctrl+minus` | Zoom out | Bound to `terminal.font_size_dec` |
| `f5` | Page reload | Same risk as `ctrl+r` |
| `ctrl+shift+i` | DevTools | Prevented in production |
| `f12` | DevTools | Prevented in production |

These chords still reach the PTY if no binding exists for them (except the ones bound to terminal actions above).

---

## Hot Reload

Press `Ctrl+Shift+,` to reload your config file without restarting the app or dropping the PTY session.

The engine re-reads `~/.config/nyxterm/config`, re-validates all entries, and atomically replaces the active binding map. The terminal handler is **not** replaced — it already references the live map.

Bindings declared in the config file override the defaults. After reload, `listBindings()` reflects the new state immediately.
