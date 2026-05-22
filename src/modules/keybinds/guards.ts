/**
 * guards.ts — IME guard and WebKit hijack prevention.
 *
 * Two guards run at the TOP of createCustomKeyHandler, before any binding lookup:
 *
 *  1. imeGuard(event)
 *     Returns true if the event is an IME composition event. The engine MUST
 *     return true immediately (pass through to PTY) without any lookup or action.
 *     REQ-KB-029.
 *
 *  2. webkitHijackPrevent(event, chord)
 *     Calls event.preventDefault() if the chord is in WEBKIT_HIJACK. This
 *     prevents WebKitGTK from handling chords like Ctrl+R (page reload) at the
 *     browser level. The engine STILL passes the chord to PTY if no binding
 *     exists (e.g., Ctrl+R → readline reverse-search). Returns true if the
 *     chord is in the hijack list.
 *     REQ-KB-030, REQ-KB-031.
 *
 * Design §3.9 (reserved enforcement layers), §3.10 (WebKit handling), §3.11 (IME).
 */

import type { Chord } from "./types";
import { WEBKIT_HIJACK } from "./reserved";

// ---------------------------------------------------------------------------
// IME guard
// ---------------------------------------------------------------------------

/**
 * Returns true if the event is an IME composition event.
 *
 * When true, the engine MUST return true immediately — pass through to PTY.
 * No binding lookup, no preventDefault, no action dispatch.
 *
 * Two signals to check per browser compat:
 *  - event.isComposing (W3C standard) — true during IME composition
 *  - event.keyCode === 229 — legacy IME signal (WebKit / older engines)
 *
 * REQ-KB-029.
 */
export function imeGuard(event: KeyboardEvent): boolean {
  return event.isComposing || event.keyCode === 229;
}

// ---------------------------------------------------------------------------
// WebKit hijack prevention
// ---------------------------------------------------------------------------

/**
 * Calls event.preventDefault() if the chord is in WEBKIT_HIJACK.
 *
 * Returns true if preventDefault was called (chord is in hijack list).
 *
 * Side effect: calls event.preventDefault() on match. This is intentional —
 * the call MUST happen before any binding lookup so the browser action is
 * unconditionally blocked even if no binding exists for the chord.
 *
 * Behaviour after calling this:
 *  - If a binding exists for the chord → engine dispatches the action (returns false)
 *  - If no binding exists → engine falls through to PTY (returns true)
 *    e.g., Ctrl+R (not bound in defaults) → still sends reverse-search to readline
 *
 * REQ-KB-030, REQ-KB-031.
 *
 * @param event - The keyboard event (needed to call preventDefault())
 * @param chord - The already-normalized chord string, or null if normalization failed
 */
export function webkitHijackPrevent(
  event: KeyboardEvent,
  chord: Chord | null,
): boolean {
  if (chord === null) return false;
  if (WEBKIT_HIJACK.has(chord)) {
    event.preventDefault();
    return true;
  }
  return false;
}
