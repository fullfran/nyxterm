/**
 * reserved.ts — Reserved chords and WebKit hijack list.
 *
 * RESERVED_CHORDS: chords that MUST NOT be bound by config files or
 * registerAction(). They pass through to the PTY untouched.
 *
 * WEBKIT_HIJACK: chords that MUST receive ev.preventDefault() regardless
 * of binding status. Prevents WebKitGTK from reloading the page or
 * opening DevTools, which would kill the PTY session.
 *
 * REQ-KB-031 (ctrl+r in WEBKIT_HIJACK), REQ-KB-032 (reserved rejection),
 * spec §7 (reserved list), spec §8 (WebKit hijack list).
 */

// ---------------------------------------------------------------------------
// Reserved chords (spec §7)
// ---------------------------------------------------------------------------

/**
 * Bare Ctrl+letter (a–z) — map to ASCII control characters.
 * These MUST NOT be bound; they carry SIGINT, EOF, SIGTSTP, etc.
 */
const CTRL_LETTERS: string[] = [
  "ctrl+a", "ctrl+b", "ctrl+c", "ctrl+d", "ctrl+e", "ctrl+f",
  "ctrl+g", "ctrl+h", "ctrl+i", "ctrl+j", "ctrl+k", "ctrl+l",
  "ctrl+m", "ctrl+n", "ctrl+o", "ctrl+p", "ctrl+q", "ctrl+r",
  "ctrl+s", "ctrl+t", "ctrl+u", "ctrl+v", "ctrl+w", "ctrl+x",
  "ctrl+y", "ctrl+z",
];

/**
 * Bare navigation and editing keys — VT sequences.
 * Note: normalized form uses aliases (up/down/left/right, pageup/pagedown).
 */
const BARE_NAV_KEYS: string[] = [
  "up", "down", "left", "right",
  "home", "end", "pageup", "pagedown",
  "insert", "delete",
  "backspace", "tab", "escape", "enter",
];

/**
 * Bare function keys.
 */
const BARE_FUNCTION_KEYS: string[] = [
  "f1", "f2", "f3", "f4", "f5", "f6",
  "f7", "f8", "f9", "f10", "f11", "f12",
];

/**
 * Set of all reserved chord strings.
 *
 * A chord that is in this set MUST NOT be captured by the engine.
 * Config entries referencing a reserved chord are rejected at load time
 * with a warning (REQ-KB-032). Programmatic registerAction() with a
 * reserved chord throws TypeError (REQ-KB-035).
 */
export const RESERVED_CHORDS: ReadonlySet<string> = new Set<string>([
  ...CTRL_LETTERS,
  ...BARE_NAV_KEYS,
  ...BARE_FUNCTION_KEYS,
]);

// ---------------------------------------------------------------------------
// WebKit hijack list (spec §8)
// ---------------------------------------------------------------------------

/**
 * Set of chords that MUST receive ev.preventDefault() before any binding
 * lookup. This prevents WebKitGTK from handling them at the browser level.
 *
 * Note: ctrl+0, ctrl+plus, ctrl+minus are bound to font actions but ALSO
 * need preventDefault to prevent WebKit zoom handling.
 *
 * REQ-KB-030, REQ-KB-031.
 */
export const WEBKIT_HIJACK: ReadonlySet<string> = new Set<string>([
  "ctrl+r",           // Page reload — CRITICAL: kills PTY session
  "ctrl+shift+r",     // Hard reload — CRITICAL: kills PTY session
  "ctrl+w",           // Close window/tab
  "ctrl+f",           // Browser find bar
  "ctrl+0",           // Reset zoom (also bound to font_size_reset)
  "ctrl+plus",        // Zoom in (also bound to font_size_inc)
  "ctrl+minus",       // Zoom out (also bound to font_size_dec)
  "f5",               // Page reload (same risk as ctrl+r)
  "ctrl+shift+i",     // Open DevTools (prevent in production)
  "f12",              // Open DevTools
]);
