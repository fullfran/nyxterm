/**
 * normalize.ts — KeyboardEvent → Chord normalization.
 *
 * Algorithm:
 *   1. If event.isComposing or keyCode === 229 → return null (IME pass-through).
 *   2. Collect active modifiers in canonical sort order: ctrl < alt < shift < meta.
 *   3. Get key string from event.key, lowercase it.
 *   4. Apply special aliases (space, +, -, arrow keys, function keys, etc.).
 *   5. For "+" (plus): strip "shift" from modifiers (US layout shift-artifact).
 *   6. Join modifiers + key with "+".
 *
 * REQ-KB-023 (sync handler, bool return), REQ-KB-024 (modifier sort, lowercase),
 * REQ-KB-025 (+ → plus, shift strip), REQ-KB-026 (- → minus),
 * REQ-KB-029 (isComposing guard).
 */

import type { Chord } from "./types";

// ---------------------------------------------------------------------------
// Special key aliases
// ---------------------------------------------------------------------------

const KEY_ALIAS: Record<string, string> = {
  " ": "space",
  "+": "plus",
  "-": "minus",
  ",": "comma",
  ".": "period",
  "/": "slash",
  "\\": "backslash",
  Escape: "escape",
  Enter: "enter",
  Return: "enter",
  Tab: "tab",
  Backspace: "backspace",
  Delete: "delete",
  Insert: "insert",
  Home: "home",
  End: "end",
  PageUp: "pageup",
  PageDown: "pagedown",
  ArrowUp: "up",
  ArrowDown: "down",
  ArrowLeft: "left",
  ArrowRight: "right",
  F1: "f1",
  F2: "f2",
  F3: "f3",
  F4: "f4",
  F5: "f5",
  F6: "f6",
  F7: "f7",
  F8: "f8",
  F9: "f9",
  F10: "f10",
  F11: "f11",
  F12: "f12",
};

// ---------------------------------------------------------------------------
// normalizeKeyEvent
// ---------------------------------------------------------------------------

/**
 * Normalize a DOM KeyboardEvent into a canonical Chord string.
 *
 * Returns null for IME composition events (caller should pass to PTY).
 *
 * @param event - The keyboard event from xterm.js custom key handler
 * @returns Normalized Chord string, or null for IME events
 */
export function normalizeKeyEvent(event: KeyboardEvent): Chord | null {
  // Guard 1: IME composition (isComposing or keyCode 229 dead key)
  if (event.isComposing || event.keyCode === 229) {
    return null;
  }

  // Collect modifiers in canonical sort order: ctrl < alt < shift < meta
  const modifiers: string[] = [];
  if (event.ctrlKey) modifiers.push("ctrl");
  if (event.altKey) modifiers.push("alt");
  if (event.shiftKey) modifiers.push("shift");
  if (event.metaKey) modifiers.push("meta");

  // Resolve key token
  let key = event.key;

  // Apply alias table first
  const aliased = KEY_ALIAS[key];
  if (aliased !== undefined) {
    key = aliased;
  } else {
    // Lowercase for regular letters (Ctrl+Shift+C → event.key is "C" → "c")
    key = key.toLowerCase();
  }

  // Special rule: "+" (plus) on US layout requires Shift, but we don't want
  // the chord to include "shift" since ghostty uses "ctrl+plus" not "ctrl+shift+plus".
  // REQ-KB-025.
  if (key === "plus") {
    const shiftIdx = modifiers.indexOf("shift");
    if (shiftIdx !== -1) {
      modifiers.splice(shiftIdx, 1);
    }
  }

  // Build chord string: [modifiers joined by +] + key
  const parts = modifiers.length > 0 ? [...modifiers, key] : [key];
  return parts.join("+") as Chord;
}

// ---------------------------------------------------------------------------
// normalizeChord
// ---------------------------------------------------------------------------

/**
 * Normalize a chord given as a string array of parts (from config parsing).
 * e.g. ["ctrl", "shift", "c"] → "ctrl+shift+c" as Chord
 *
 * Parts are lowercased and joined with "+". No modifier-sort is applied
 * here since config files must already use canonical modifier order per spec §4.
 *
 * This is used by the config-loader (PR3) when parsing config file lines.
 */
export function normalizeChord(parts: string[]): Chord {
  return parts.map((p) => p.toLowerCase()).join("+") as Chord;
}
