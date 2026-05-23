/**
 * defaults.test.ts — Unit tests for the FullFran default binding factory.
 *
 * Covers:
 *  - Exactly 29 entries (REQ-KB-008, spec §6)
 *  - Known chord → actionId mappings (spot checks)
 *  - All actionId values are valid ActionId members (compile-time + runtime check)
 *  - All chords are unique (no duplicate chord in the factory)
 *  - source tags are present and valid
 */

import { describe, it, expect } from "vitest";
import { DEFAULT_BINDINGS } from "../defaults";
import type { ActionId } from "../types";

// Runtime set of all valid ActionId values for exhaustive validation
const VALID_ACTION_IDS = new Set<ActionId>([
  // Group A
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
  // Group B
  "pane.split_right",
  "pane.split_down",
  "pane.navigate_left",
  "pane.navigate_down",
  "pane.navigate_up",
  "pane.navigate_right",
  "pane.kill_pane",
  "pane.zoom_pane",
  // Group C — tabs
  "tab.new_tab",
  "tab.next_tab",
  "tab.previous_tab",
  "tab.kill_tab",
  // Group C — sessions
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

describe("DEFAULT_BINDINGS", () => {
  it("contains exactly 29 entries (spec §6)", () => {
    expect(DEFAULT_BINDINGS.length).toBe(29);
  });

  it("ctrl+shift+c maps to terminal.copy_to_clipboard", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+shift+c");
    expect(b).toBeDefined();
    expect(b?.actionId).toBe("terminal.copy_to_clipboard");
  });

  it("ctrl+shift+v maps to terminal.paste_from_clipboard", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+shift+v");
    expect(b?.actionId).toBe("terminal.paste_from_clipboard");
  });

  it("ctrl+plus maps to terminal.font_size_inc", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+plus");
    expect(b?.actionId).toBe("terminal.font_size_inc");
  });

  it("ctrl+minus maps to terminal.font_size_dec", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+minus");
    expect(b?.actionId).toBe("terminal.font_size_dec");
  });

  it("ctrl+0 maps to terminal.font_size_reset", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+0");
    expect(b?.actionId).toBe("terminal.font_size_reset");
  });

  it("ctrl+shift+comma maps to terminal.reload_config", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+shift+comma");
    expect(b?.actionId).toBe("terminal.reload_config");
  });

  it("ctrl+tab maps to tab.next_tab", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+tab");
    expect(b?.actionId).toBe("tab.next_tab");
  });

  it("ctrl+shift+tab maps to tab.previous_tab", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+shift+tab");
    expect(b?.actionId).toBe("tab.previous_tab");
  });

  it("ctrl+shift+k maps to session.kill_session (not pane.navigate_up)", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+shift+k");
    expect(b?.actionId).toBe("session.kill_session");
  });

  it("ctrl+shift+escape maps to app.copy_mode_enter", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+shift+escape");
    expect(b?.actionId).toBe("app.copy_mode_enter");
  });

  it("ctrl+shift+r maps to pane.split_right", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+shift+r");
    expect(b?.actionId).toBe("pane.split_right");
  });

  it("ctrl+shift+up maps to terminal.scroll_page_up", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+shift+up");
    expect(b?.actionId).toBe("terminal.scroll_page_up");
  });

  it("ctrl+shift+home maps to terminal.scroll_to_top", () => {
    const b = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+shift+home");
    expect(b?.actionId).toBe("terminal.scroll_to_top");
  });

  it("all actionId values are valid members of the ActionId union", () => {
    for (const b of DEFAULT_BINDINGS) {
      expect(VALID_ACTION_IDS.has(b.actionId)).toBe(true);
    }
  });

  it("all chords are unique (no duplicate)", () => {
    const chords = DEFAULT_BINDINGS.map((b) => b.chord);
    const uniqueChords = new Set(chords);
    expect(uniqueChords.size).toBe(chords.length);
  });

  it("all source tags are valid ('ghostty' or 'tmux')", () => {
    const validSources = new Set(["ghostty", "tmux", "nyxterm", "default", "override"]);
    for (const b of DEFAULT_BINDINGS) {
      expect(validSources.has(b.source)).toBe(true);
    }
  });

  it("terminal bindings have source 'ghostty'", () => {
    const terminalBindings = DEFAULT_BINDINGS.filter((b) =>
      b.actionId.startsWith("terminal."),
    );
    for (const b of terminalBindings) {
      expect(b.source).toBe("ghostty");
    }
  });

  it("pane/tab/session/app bindings have source 'tmux'", () => {
    const nonTerminalBindings = DEFAULT_BINDINGS.filter((b) =>
      !b.actionId.startsWith("terminal."),
    );
    for (const b of nonTerminalBindings) {
      expect(b.source).toBe("tmux");
    }
  });
});
