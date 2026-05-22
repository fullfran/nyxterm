/**
 * resolver.test.ts — Unit tests for resolveBindings.
 *
 * Covers:
 *  - Default-only (no overrides) → returns DEFAULT_BINDINGS exactly
 *  - Override replaces existing binding
 *  - Unbind removes a chord from active map
 *  - Extend: new chord not in defaults → added to active
 *  - Last-write-wins with warning for duplicate chord in overrides
 *  - DEFAULT_BINDINGS not mutated (snapshot before/after)
 *  - Unknown ActionId-like target → warning, original default unchanged
 *
 * REQ-KB-014, REQ-KB-015, REQ-KB-016, REQ-KB-017, spec §4.5.
 */

import { describe, it, expect } from "vitest";
import { resolveBindings } from "../resolver";
import { DEFAULT_BINDINGS } from "../defaults";
import type { Binding, Chord } from "../types";
import type { ConfigEntry } from "../config-loader";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  chord: string,
  target: string,
  lineNumber = 1,
): ConfigEntry {
  return {
    chord: chord as Chord,
    target,
    lineNumber,
    source: "user",
  };
}

function makeBinding(
  chord: string,
  actionId: string,
  source: Binding["source"] = "default",
): Binding {
  return {
    chord: chord as Chord,
    actionId: actionId as Binding["actionId"],
    source,
  };
}

/** Snapshot of DEFAULT_BINDINGS: chord → actionId pairs, stable for comparison */
function snapshotDefaults(): Array<{ chord: string; actionId: string }> {
  return DEFAULT_BINDINGS.map((b) => ({ chord: b.chord, actionId: b.actionId }));
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveBindings", () => {
  // -------------------------------------------------------------------------
  // No overrides
  // -------------------------------------------------------------------------

  it("returns all defaults when no overrides are provided", () => {
    const { active, warnings } = resolveBindings(DEFAULT_BINDINGS, []);

    expect(warnings).toHaveLength(0);
    expect(active).toHaveLength(DEFAULT_BINDINGS.length);

    // Every default binding should appear in active
    for (const def of DEFAULT_BINDINGS) {
      const found = active.find((a) => a.chord === def.chord);
      expect(found).toBeDefined();
      expect(found!.actionId).toBe(def.actionId);
    }
  });

  it("preserves source tag from defaults when no override", () => {
    const { active } = resolveBindings(DEFAULT_BINDINGS, []);
    const copy = active.find((a) => a.chord === "ctrl+shift+c");
    expect(copy).toBeDefined();
    expect(copy!.source).toBe("ghostty"); // preserved from defaults
  });

  // -------------------------------------------------------------------------
  // Override replaces existing binding
  // -------------------------------------------------------------------------

  it("override replaces existing: clear_screen overrides copy_to_clipboard for ctrl+shift+c", () => {
    const override = makeEntry(
      "ctrl+shift+c",
      "terminal.clear_screen",
      1,
    );
    const { active, warnings } = resolveBindings(DEFAULT_BINDINGS, [override]);

    expect(warnings).toHaveLength(0);

    const binding = active.find((a) => a.chord === "ctrl+shift+c");
    expect(binding).toBeDefined();
    expect(binding!.actionId).toBe("terminal.clear_screen");
    expect(binding!.source).toBe("override");
  });

  it("active count stays the same when overriding an existing chord", () => {
    const override = makeEntry("ctrl+shift+c", "terminal.clear_screen");
    const { active } = resolveBindings(DEFAULT_BINDINGS, [override]);
    // Replacing an existing chord should not change count
    expect(active).toHaveLength(DEFAULT_BINDINGS.length);
  });

  // -------------------------------------------------------------------------
  // Unbind removes a chord
  // -------------------------------------------------------------------------

  it("unbind removes the chord from active map", () => {
    const override = makeEntry("ctrl+shift+t", "unbind");
    const { active, warnings } = resolveBindings(DEFAULT_BINDINGS, [override]);

    expect(warnings).toHaveLength(0);

    const found = active.find((a) => a.chord === "ctrl+shift+t");
    expect(found).toBeUndefined();
  });

  it("active count decreases by 1 after unbind of existing chord", () => {
    const override = makeEntry("ctrl+shift+t", "unbind");
    const { active } = resolveBindings(DEFAULT_BINDINGS, [override]);
    expect(active).toHaveLength(DEFAULT_BINDINGS.length - 1);
  });

  it("unbind of non-existent chord does nothing (no warning)", () => {
    const override = makeEntry("ctrl+alt+x", "unbind");
    const { active, warnings } = resolveBindings(DEFAULT_BINDINGS, [override]);

    expect(warnings).toHaveLength(0);
    expect(active).toHaveLength(DEFAULT_BINDINGS.length);
  });

  // -------------------------------------------------------------------------
  // Extend with new chord
  // -------------------------------------------------------------------------

  it("extends active map with a chord not in defaults", () => {
    const override = makeEntry(
      "ctrl+alt+1",
      "terminal.scroll_to_top",
      1,
    );
    const { active, warnings } = resolveBindings(DEFAULT_BINDINGS, [override]);

    expect(warnings).toHaveLength(0);

    const found = active.find((a) => a.chord === "ctrl+alt+1");
    expect(found).toBeDefined();
    expect(found!.actionId).toBe("terminal.scroll_to_top");
    expect(found!.source).toBe("override");
  });

  it("active count increases by 1 after extending with new chord", () => {
    const override = makeEntry("ctrl+alt+1", "terminal.scroll_to_top");
    const { active } = resolveBindings(DEFAULT_BINDINGS, [override]);
    expect(active).toHaveLength(DEFAULT_BINDINGS.length + 1);
  });

  // -------------------------------------------------------------------------
  // Last-write-wins — duplicate chord in overrides
  // -------------------------------------------------------------------------

  it("last-write-wins: second binding for same chord wins", () => {
    const overrides = [
      makeEntry("ctrl+shift+q", "terminal.copy_to_clipboard", 1),
      makeEntry("ctrl+shift+q", "terminal.paste_from_clipboard", 5),
    ];
    const { active, warnings } = resolveBindings(DEFAULT_BINDINGS, overrides);

    // Exactly one warning (for the overwritten line 1)
    expect(warnings).toHaveLength(1);
    expect(warnings[0].chord).toBe("ctrl+shift+q");
    expect(warnings[0].lineNumber).toBe(5);

    // Last binding wins
    const found = active.find((a) => a.chord === "ctrl+shift+q");
    expect(found).toBeDefined();
    expect(found!.actionId).toBe("terminal.paste_from_clipboard");
  });

  it("last-write-wins: three overrides for same chord emits 2 warnings", () => {
    const overrides = [
      makeEntry("ctrl+shift+q", "terminal.copy_to_clipboard", 1),
      makeEntry("ctrl+shift+q", "terminal.paste_from_clipboard", 2),
      makeEntry("ctrl+shift+q", "terminal.clear_screen", 3),
    ];
    const { active, warnings } = resolveBindings(DEFAULT_BINDINGS, overrides);

    expect(warnings).toHaveLength(2);
    const found = active.find((a) => a.chord === "ctrl+shift+q");
    expect(found!.actionId).toBe("terminal.clear_screen");
  });

  // -------------------------------------------------------------------------
  // DEFAULT_BINDINGS immutability
  // -------------------------------------------------------------------------

  it("does NOT mutate DEFAULT_BINDINGS", () => {
    const before = snapshotDefaults();

    const overrides = [
      makeEntry("ctrl+shift+c", "terminal.clear_screen"),
      makeEntry("ctrl+shift+t", "unbind"),
      makeEntry("ctrl+alt+z", "terminal.scroll_to_top"),
    ];
    resolveBindings(DEFAULT_BINDINGS, overrides);

    const after = snapshotDefaults();
    expect(after).toEqual(before);
  });

  it("DEFAULT_BINDINGS length is unchanged after resolve", () => {
    const lenBefore = DEFAULT_BINDINGS.length;
    resolveBindings(DEFAULT_BINDINGS, [
      makeEntry("ctrl+shift+c", "terminal.clear_screen"),
      makeEntry("ctrl+shift+t", "unbind"),
    ]);
    expect(DEFAULT_BINDINGS.length).toBe(lenBefore);
  });

  // -------------------------------------------------------------------------
  // Unknown ActionId target
  // -------------------------------------------------------------------------

  it("emits warning for unknown action_id, skips entry", () => {
    const override = makeEntry("ctrl+shift+x", "foo.nonexistent");
    const { active, warnings } = resolveBindings(DEFAULT_BINDINGS, [override]);

    expect(warnings).toHaveLength(1);
    expect(warnings[0].chord).toBe("ctrl+shift+x");
    expect(warnings[0].reason).toMatch(/unknown action_id/i);
    expect(warnings[0].lineNumber).toBe(1);

    // The chord should NOT appear in active (it was rejected)
    const found = active.find((a) => a.chord === "ctrl+shift+x");
    expect(found).toBeUndefined();
  });

  it("original default binding is unchanged when override has unknown action_id for same chord", () => {
    const override = makeEntry("ctrl+shift+c", "foo.bad_action");
    const { active } = resolveBindings(DEFAULT_BINDINGS, [override]);

    const binding = active.find((a) => a.chord === "ctrl+shift+c");
    expect(binding).toBeDefined();
    // Should still be the original default
    expect(binding!.actionId).toBe("terminal.copy_to_clipboard");
  });

  // -------------------------------------------------------------------------
  // Custom (small) defaults set — unit-isolated tests
  // -------------------------------------------------------------------------

  it("works correctly with a custom defaults array (not DEFAULT_BINDINGS)", () => {
    const customDefaults: Binding[] = [
      makeBinding("ctrl+a", "terminal.copy_to_clipboard", "default"),
      makeBinding("ctrl+b", "terminal.paste_from_clipboard", "default"),
    ];

    const { active, warnings } = resolveBindings(customDefaults, [
      makeEntry("ctrl+a", "terminal.clear_screen", 1),
    ]);

    expect(warnings).toHaveLength(0);
    expect(active).toHaveLength(2);

    const found = active.find((a) => a.chord === "ctrl+a");
    expect(found!.actionId).toBe("terminal.clear_screen");
    expect(found!.source).toBe("override");

    const unchanged = active.find((a) => a.chord === "ctrl+b");
    expect(unchanged!.actionId).toBe("terminal.paste_from_clipboard");
    expect(unchanged!.source).toBe("default");
  });

  it("returns empty active array when all bindings are unbound", () => {
    const customDefaults: Binding[] = [
      makeBinding("ctrl+a", "terminal.copy_to_clipboard"),
    ];

    const { active } = resolveBindings(customDefaults, [
      makeEntry("ctrl+a", "unbind"),
    ]);

    expect(active).toHaveLength(0);
  });
});
