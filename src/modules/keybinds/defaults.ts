/**
 * defaults.ts — FullFran default binding factory.
 *
 * DEFAULT_BINDINGS is an immutable constant containing exactly 29 bindings
 * from the user's canonical Ctrl+Shift+X set (tmux + ghostty dotfiles).
 *
 * Rules:
 *  - Must never require file I/O or async operations (REQ-KB-006)
 *  - Must be type-checked against ActionId union at compile time (REQ-KB-007)
 *  - Must contain exactly the 29 chords from spec §6 (REQ-KB-008)
 *  - Must be loaded even when config file is absent (REQ-KB-009)
 *
 * Source tags:
 *  "ghostty" — originally from ~/dotfiles/ghostty/config
 *  "tmux"    — originally from ~/dotfiles/tmux/tmux.conf
 *
 * TODO (REQ-KB-NFR-004): Add platform switch hook stub for macOS.
 * On macOS, Cmd key (ev.metaKey) should map to ctrl in this factory.
 * Stubbed here; actual normalization deferred to the macOS port.
 *   if (platform === 'darwin') remap ctrl to meta
 *
 * nyxterm/keybinds-canon (engram #5229), spec §6.
 */

import type { Binding, ActionId, Chord } from "./types";

// ---------------------------------------------------------------------------
// Platform normalization hook (REQ-KB-NFR-004)
// ---------------------------------------------------------------------------

/**
 * macOS port hook — no-op for Linux / Phase 1.
 *
 * TODO(macOS-port): when platform === 'darwin', remap ctrl → meta for
 * relevant bindings so that Cmd+Shift+C / Cmd+Shift+V etc. map to the same
 * actions the user expects on macOS. For Phase 1 we target Linux/glibc only;
 * macOS port is future work.
 *
 * Hook point: this is where the platform check would branch the default chord
 * generation — e.g. replace "ctrl+" prefix with "meta+" for ghostty-origin
 * bindings. The tmux-origin bindings (Ctrl+Shift+X) remain ctrl on macOS
 * because Cmd+Shift is not a standard tmux convention there.
 *
 * REQ-KB-NFR-004: The engine must produce identical behavior on Linux/macOS;
 * a platform switch hook in defaults.ts must be stubbed even if not activated.
 */
const PLATFORM_NORMALIZATION_HOOK = false; // no-op for Linux/Phase 1
void PLATFORM_NORMALIZATION_HOOK; // suppress unused-variable warning

// ---------------------------------------------------------------------------
// Type-safe chord builder
// ---------------------------------------------------------------------------

/** Cast a string literal to Chord brand — safe only for canonical strings */
function chord(s: string): Chord {
  return s as Chord;
}

/** Type-safe binding builder — ensures actionId is in the ActionId union */
function binding(
  c: string,
  actionId: ActionId,
  source: Binding["source"],
): Binding {
  return { chord: chord(c), actionId, source };
}

// ---------------------------------------------------------------------------
// FullFran default factory — 29 bindings
// ---------------------------------------------------------------------------

/**
 * The FullFran canonical keybind set.
 *
 * Immutable: never mutate this array. resolveBindings() in PR3 builds a
 * derived map from this constant; DEFAULT_BINDINGS remains recoverable
 * after any config override (REQ-KB-017).
 */
export const DEFAULT_BINDINGS: readonly Binding[] = [
  // --- Clipboard / scroll (ghostty) ---
  binding("ctrl+shift+c",    "terminal.copy_to_clipboard",    "ghostty"),
  binding("ctrl+shift+v",    "terminal.paste_from_clipboard", "ghostty"),
  binding("ctrl+shift+up",   "terminal.scroll_page_up",       "ghostty"),
  binding("ctrl+shift+down", "terminal.scroll_page_down",     "ghostty"),
  binding("ctrl+shift+home", "terminal.scroll_to_top",        "ghostty"),
  binding("ctrl+shift+end",  "terminal.scroll_to_bottom",     "ghostty"),

  // --- Font size / config (ghostty) ---
  binding("ctrl+plus",       "terminal.font_size_inc",        "ghostty"),
  binding("ctrl+minus",      "terminal.font_size_dec",        "ghostty"),
  binding("ctrl+0",          "terminal.font_size_reset",      "ghostty"),
  binding("ctrl+shift+comma","terminal.reload_config",        "ghostty"),

  // --- Pane splits (tmux -n root bindings) ---
  binding("ctrl+shift+r",    "pane.split_right",              "tmux"),
  binding("ctrl+shift+f",    "pane.split_down",               "tmux"),
  binding("ctrl+shift+h",    "pane.navigate_left",            "tmux"),
  binding("ctrl+shift+j",    "pane.navigate_down",            "tmux"),
  binding("ctrl+shift+l",    "pane.navigate_right",           "tmux"),
  binding("ctrl+shift+w",    "pane.kill_pane",                "tmux"),
  binding("ctrl+shift+z",    "pane.zoom_pane",                "tmux"),

  // --- Tabs (tmux) ---
  binding("ctrl+shift+t",    "tab.new_tab",                   "tmux"),
  binding("ctrl+tab",        "tab.next_tab",                  "tmux"),
  binding("ctrl+shift+tab",  "tab.previous_tab",              "tmux"),

  // --- Sessions (tmux) ---
  binding("ctrl+shift+e",    "session.new_session",           "tmux"),
  binding("ctrl+shift+n",    "session.rename_session",        "tmux"),
  binding("ctrl+shift+b",    "session.switch_last_session",   "tmux"),
  binding("ctrl+shift+s",    "session.picker",                "tmux"),
  binding("ctrl+shift+k",    "session.kill_session",          "tmux"),
  binding("ctrl+shift+d",    "session.detach",                "tmux"),

  // --- App popups (tmux) ---
  binding("ctrl+shift+g",    "app.popup_git",                 "tmux"),
  binding("ctrl+shift+a",    "app.popup_ai",                  "tmux"),
  binding("ctrl+shift+escape","app.copy_mode_enter",          "tmux"),
] as const;

// Compile-time assertion: if the count changes, this line fails type check
// (uncomment to enforce exact count via tuple — useful in strict mode)
// type AssertExact29 = typeof DEFAULT_BINDINGS & { length: 29 };
