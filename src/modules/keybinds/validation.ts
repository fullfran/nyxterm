/**
 * validation.ts — Semantic validation of parsed config entries.
 *
 * This layer runs BETWEEN the parser (config-loader.ts) and the resolver
 * (resolver.ts). Its purpose is to enforce semantic rules that the parser
 * intentionally defers:
 *
 *  1. Reserved chord rejection (REQ-KB-032):
 *     Any ConfigEntry whose chord is in RESERVED_CHORDS is rejected.
 *     These chords MUST pass through to the PTY untouched (SIGINT, SIGTSTP,
 *     VT sequences, etc.). No user config can override them.
 *
 *  2. Unknown ActionId rejection (REQ-KB-033):
 *     Any ConfigEntry whose target is not "unbind" and whose target is not
 *     a member of the ActionId union is rejected.
 *
 *  3. Per REQ-KB-034: rejection of one entry does NOT abort the rest.
 *     All valid entries in the same file are returned and applied normally.
 *
 * Design §4.6 (two-layer validation: parse vs register), §3.9 (reserved
 * enforcement layers).
 *
 * NOTE: The resolver (resolver.ts) also has a runtime VALID_ACTION_IDS check.
 * After T4.2, the validation layer runs first, so the resolver's check is
 * defense-in-depth (it will not see invalid entries). Both are kept to ensure
 * no duplicate warnings: validation filters before resolver, so resolver only
 * sees pre-validated entries and its own VALID_ACTION_IDS check will not fire.
 */

import type { ActionId } from "./types";
import type { ConfigEntry } from "./config-loader";
import { RESERVED_CHORDS } from "./reserved";

// ---------------------------------------------------------------------------
// RejectedEntry — carries the original entry + rejection reason
// ---------------------------------------------------------------------------

/**
 * An entry that failed semantic validation.
 *
 * Consumers (engine.ts) log these as warnings and do NOT pass them to the
 * resolver. Toast aggregation for UI display is deferred to PR5/docs.
 */
export interface RejectedEntry {
  /** The config entry that was rejected */
  readonly entry: ConfigEntry;
  /** Human-readable description of why it was rejected */
  readonly reason: string;
}

// ---------------------------------------------------------------------------
// Runtime ActionId set — kept in sync with resolver.ts VALID_ACTION_IDS.
// Intentional duplication: validation and resolver are separate layers.
// ---------------------------------------------------------------------------

const VALID_ACTION_IDS = new Set<ActionId>([
  // Group A — terminal
  "terminal.copy_to_clipboard",
  "terminal.paste_from_clipboard",
  "terminal.scroll_page_up",
  "terminal.scroll_page_down",
  "terminal.scroll_to_top",
  "terminal.scroll_to_bottom",
  "terminal.font_size_inc",
  "terminal.font_size_dec",
  "terminal.font_size_reset",
  "terminal.clear_screen",
  "terminal.reload_config",
  // Group B — pane
  "pane.split_right",
  "pane.split_down",
  "pane.navigate_left",
  "pane.navigate_down",
  "pane.navigate_up",
  "pane.navigate_right",
  "pane.kill_pane",
  "pane.zoom_pane",
  // Group C — tab
  "tab.new_tab",
  "tab.next_tab",
  "tab.previous_tab",
  "tab.kill_tab",
  // Group C — session
  "session.new_session",
  "session.rename_session",
  "session.switch_last_session",
  "session.picker",
  "session.kill_session",
  "session.detach",
  // Group C — app
  "app.popup_git",
  "app.popup_ai",
  "app.copy_mode_enter",
]);

/**
 * Type guard — returns true if id is a known ActionId at runtime.
 * Exported for programmatic use (e.g., tests).
 */
export function isKnownActionId(id: string): id is ActionId {
  return VALID_ACTION_IDS.has(id as ActionId);
}

// ---------------------------------------------------------------------------
// validateConfigEntries
// ---------------------------------------------------------------------------

/**
 * Filter a list of parsed config entries into valid and rejected sets.
 *
 * Rules (applied in order; first match determines rejection reason):
 *  1. Entry chord is in RESERVED_CHORDS → rejected (REQ-KB-032)
 *  2. Entry target is not "unbind" AND not a known ActionId → rejected (REQ-KB-033)
 *  3. Otherwise → valid
 *
 * Per REQ-KB-034: validation never aborts on first rejection.
 * All entries are inspected; all valid ones are returned.
 *
 * @param entries - Output of parseConfigText().entries
 * @returns { valid, rejected }
 */
export function validateConfigEntries(entries: ConfigEntry[]): {
  valid: ConfigEntry[];
  rejected: RejectedEntry[];
} {
  const valid: ConfigEntry[] = [];
  const rejected: RejectedEntry[] = [];

  for (const entry of entries) {
    // Rule 1: reserved chord
    if (RESERVED_CHORDS.has(entry.chord)) {
      rejected.push({
        entry,
        reason: `reserved chord "${entry.chord}" — passes through to PTY (REQ-KB-032); binding rejected`,
      });
      continue;
    }

    // Rule 2: unknown action_id (unbind is always valid as a special directive)
    if (entry.target !== "unbind" && !isKnownActionId(entry.target)) {
      rejected.push({
        entry,
        reason: `unknown action_id "${entry.target}" — not a member of the ActionId union (REQ-KB-033); binding rejected`,
      });
      continue;
    }

    // Valid entry
    valid.push(entry);
  }

  return { valid, rejected };
}
