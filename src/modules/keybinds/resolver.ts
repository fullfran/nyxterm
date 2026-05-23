/**
 * resolver.ts — Override resolution for the keybinds engine.
 *
 * resolveBindings(defaults, overrides) merges user config entries on top of the
 * default factory using last-write-wins semantics. Returns the active Binding[]
 * plus any diagnostic warnings.
 *
 * Design §3.7 pseudocode:
 *  1. Seed a Map<Chord, Binding> from defaults (copy — never mutate input)
 *  2. Apply overrides in document order
 *     a. target == "unbind"     → map.delete(chord)
 *     b. target is valid ActionId → map.set(chord, { chord, actionId, source: "override" })
 *     c. unknown target          → ResolverWarning, skip
 *  3. Duplicate chord in overrides → last-write-wins, emit warning for the earlier one
 *  4. Return { active: Array.from(map.values()), warnings }
 *
 * Key invariants:
 *  - DEFAULT_BINDINGS is NEVER mutated (verified by tests)
 *  - source === "override" for any user-supplied override (Binding.source union member)
 *  - Original source tag preserved for unchanged defaults
 *
 * REQ-KB-014 (extend with new chord), REQ-KB-015 (unbind removes),
 * REQ-KB-016 (last-write-wins + warning), REQ-KB-017 (no DEFAULT_BINDINGS mutation),
 * spec §4.5 (last-write-wins).
 */

import type { ActionId, Binding, Chord } from "./types";
import type { ConfigEntry } from "./config-loader";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Warning emitted by the resolver when an override cannot be applied cleanly.
 *
 * Reasons:
 *  - unknown ActionId (target string not in ActionId union)
 *  - duplicate chord in overrides (earlier occurrence overwritten by later one)
 */
export interface ResolverWarning {
  /** Chord that triggered the warning */
  readonly chord: Chord;
  /** Human-readable description of the problem */
  readonly reason: string;
  /** 1-based line number of the offending config entry (if available) */
  readonly lineNumber?: number;
}

// ---------------------------------------------------------------------------
// Runtime set of all valid ActionId values
// ---------------------------------------------------------------------------
// This is the ONLY place that enumerates ActionId at runtime. Keep in sync
// with the ActionId union in types.ts. TypeScript compile-time and runtime
// checks are complementary: the union catches wrong literals at build time,
// this set catches unknown strings coming from parsed config text at runtime.

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

function isValidActionId(s: string): s is ActionId {
  return VALID_ACTION_IDS.has(s as ActionId);
}

// ---------------------------------------------------------------------------
// resolveBindings
// ---------------------------------------------------------------------------

/**
 * Merge default bindings with user config overrides.
 *
 * @param defaults - The immutable DEFAULT_BINDINGS constant (or any Binding[]).
 *   This array is NEVER mutated; a new Map is built from its contents.
 * @param overrides - Parsed config entries from parseConfigText().
 *   Applied in document order (index 0 first).
 * @returns { active, warnings }
 *   active: final resolved Binding[] — one entry per chord
 *   warnings: diagnostics for skipped or overwritten entries
 */
export function resolveBindings(
  defaults: readonly Binding[],
  overrides: ConfigEntry[],
): { active: Binding[]; warnings: ResolverWarning[] } {
  const warnings: ResolverWarning[] = [];

  // Step 1: Seed the map from defaults — copy only, do not touch the input array
  // Map key is the chord string (Chord brand is a string at runtime)
  const activeMap = new Map<Chord, Binding>();
  for (const b of defaults) {
    activeMap.set(b.chord, b);
  }

  // Step 2: Track chords seen in this override pass for last-write-wins detection
  const seenChords = new Map<Chord, number>(); // chord → lineNumber of first occurrence

  for (const entry of overrides) {
    const { chord, target, lineNumber } = entry;

    if (target === "unbind") {
      // REQ-KB-015: remove binding for this chord
      activeMap.delete(chord);

      // Track for duplicate detection
      const prev = seenChords.get(chord);
      if (prev !== undefined) {
        warnings.push({
          chord,
          reason: `chord "${chord}" bound on line ${prev} is overwritten (unbind) on line ${lineNumber} — last-write-wins`,
          lineNumber,
        });
      }
      seenChords.set(chord, lineNumber);
      continue;
    }

    // Validate ActionId
    if (!isValidActionId(target)) {
      warnings.push({
        chord,
        reason: `unknown action_id "${target}" — not a member of ActionId union; entry skipped`,
        lineNumber,
      });
      continue;
    }

    // Duplicate chord in overrides — emit warning before overwriting
    // REQ-KB-016: last occurrence wins
    const prev = seenChords.get(chord);
    if (prev !== undefined) {
      warnings.push({
        chord,
        reason: `chord "${chord}" bound on line ${prev} is overwritten on line ${lineNumber} — last-write-wins`,
        lineNumber,
      });
    }

    // Step 3: Apply override (replace existing or add new — REQ-KB-014)
    const newBinding: Binding = {
      chord,
      actionId: target,
      source: "override",
    };
    activeMap.set(chord, newBinding);
    seenChords.set(chord, lineNumber);
  }

  // Step 4: Return stable array
  return { active: Array.from(activeMap.values()), warnings };
}
