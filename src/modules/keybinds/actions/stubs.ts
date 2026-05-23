/**
 * actions/stubs.ts — Group B/C stub action handlers.
 *
 * Registers all Group B (pane.*) and Group C (tab.*, session.*, app.*) action
 * IDs with deduplicated console.warn handlers so that:
 *  - Their default bindings are consumed (not forwarded to PTY) from day one.
 *  - A helpful warning is emitted the first time each action fires per session.
 *  - No crash or unhandled error occurs when the chord is pressed.
 *
 * REQ-KB-052: all Group B/C IDs present in ActionId union (already in types.ts).
 * REQ-KB-053: stub handlers registered at engine initialization.
 * REQ-KB-054: warning deduplicated per action_id per session.
 *
 * Design §1.1: actions/stubs.ts — Group B/C action IDs registered with log-only handlers.
 */

import type { ActionId, IDisposable } from "../types";
import type { KeybindsEngine } from "../engine";

// ---------------------------------------------------------------------------
// Stub IDs — all Group B and Group C action IDs
// ---------------------------------------------------------------------------

const STUB_ACTION_IDS: ActionId[] = [
  // Group B — pane (epic #2)
  "pane.split_right",
  "pane.split_down",
  "pane.navigate_left",
  "pane.navigate_down",
  "pane.navigate_up",
  "pane.navigate_right",
  "pane.kill_pane",
  "pane.zoom_pane",
  // Group C — tab (epic #2)
  "tab.new_tab",
  "tab.next_tab",
  "tab.previous_tab",
  "tab.kill_tab",
  // Group C — session (epic #2)
  "session.new_session",
  "session.rename_session",
  "session.switch_last_session",
  "session.picker",
  "session.kill_session",
  "session.detach",
  // Group C — app (epics #12, #16)
  "app.popup_git",
  "app.popup_ai",
  "app.copy_mode_enter",
];

// ---------------------------------------------------------------------------
// Stub factory
// ---------------------------------------------------------------------------

/**
 * Create a stub handler for a given action ID.
 * Uses a Set<ActionId> to deduplicate warnings per session (REQ-KB-054).
 */
function makeStub(id: ActionId, warned: Set<ActionId>) {
  return () => {
    if (!warned.has(id)) {
      warned.add(id);
      console.warn(
        `[keybinds] not yet implemented: ${id} (epic #2/#6/#12/#16)`,
      );
    }
  };
}

// ---------------------------------------------------------------------------
// Registration helper
// ---------------------------------------------------------------------------

/**
 * Register all Group B/C stub handlers with the engine.
 * Returns a composite IDisposable that unregisters all stubs on dispose.
 *
 * Called from TerminalPane useEffect alongside registerTerminalActions.
 * Design §2.1: registerStubs runs BEFORE engine.attach.
 */
export function registerStubs(engine: KeybindsEngine): IDisposable {
  // One shared warned Set per registerStubs call (one per TerminalPane mount).
  const warned = new Set<ActionId>();

  const disposables = STUB_ACTION_IDS.map((id) =>
    engine.registerAction(id, makeStub(id, warned)),
  );

  return {
    dispose() {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}
