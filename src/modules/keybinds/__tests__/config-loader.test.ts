/**
 * config-loader.test.ts — Unit tests for parseConfigText and parseChordString.
 *
 * Fixture-driven tests covering:
 *  - Valid binding line → correct ConfigEntry
 *  - Comment lines skipped (no warning)
 *  - Blank lines skipped (no warning)
 *  - Malformed grammar → warning with line number, no entry
 *  - Multiple bindings, one malformed → 1 entry + 1 warning
 *  - Unbind directive → entry with target="unbind"
 *  - Symbol aliases (plus, minus, comma, up)
 *  - Whitespace tolerance (extra spaces, tabs)
 *  - Case normalization (Ctrl+SHIFT+R → ctrl+shift+r)
 *  - parseChordString utility
 *
 * REQ-KB-012, REQ-KB-013, spec §4.
 */

import { describe, it, expect } from "vitest";
import { parseConfigText, parseChordString } from "../config-loader";

// ---------------------------------------------------------------------------
// parseChordString
// ---------------------------------------------------------------------------

describe("parseChordString", () => {
  it("parses a simple chord with modifiers", () => {
    const result = parseChordString("ctrl+shift+c");
    expect(result).toBe("ctrl+shift+c");
  });

  it("lowercases the raw chord", () => {
    const result = parseChordString("Ctrl+SHIFT+R");
    expect(result).toBe("ctrl+shift+r");
  });

  it("returns null for an empty string", () => {
    expect(parseChordString("")).toBeNull();
  });

  it("returns null for a whitespace-only string", () => {
    expect(parseChordString("   ")).toBeNull();
  });

  it("returns null for an unknown modifier", () => {
    expect(parseChordString("win+c")).toBeNull();
  });

  it("returns null for an unknown key token", () => {
    expect(parseChordString("ctrl+tilde")).toBeNull();
  });

  it("handles symbol alias 'plus'", () => {
    expect(parseChordString("ctrl+plus")).toBe("ctrl+plus");
  });

  it("handles symbol alias 'minus'", () => {
    expect(parseChordString("ctrl+minus")).toBe("ctrl+minus");
  });

  it("handles symbol alias 'comma'", () => {
    expect(parseChordString("ctrl+shift+comma")).toBe("ctrl+shift+comma");
  });

  it("handles special key 'up'", () => {
    expect(parseChordString("ctrl+up")).toBe("ctrl+up");
  });

  it("handles special key 'escape'", () => {
    expect(parseChordString("ctrl+shift+escape")).toBe("ctrl+shift+escape");
  });

  it("handles digit key", () => {
    expect(parseChordString("ctrl+0")).toBe("ctrl+0");
  });

  it("handles function key", () => {
    expect(parseChordString("ctrl+shift+f5")).toBe("ctrl+shift+f5");
  });

  it("handles bare letter key (no modifiers)", () => {
    expect(parseChordString("a")).toBe("a");
  });

  it("returns null when key token is missing", () => {
    // Only modifiers, no final key
    expect(parseChordString("ctrl+shift+")).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// parseConfigText
// ---------------------------------------------------------------------------

describe("parseConfigText", () => {
  // -------------------------------------------------------------------------
  // Valid lines
  // -------------------------------------------------------------------------

  it("parses a single valid binding line", () => {
    const { entries, warnings } = parseConfigText(
      "keybind = ctrl+shift+c = terminal.copy_to_clipboard",
    );

    expect(warnings).toHaveLength(0);
    expect(entries).toHaveLength(1);
    expect(entries[0].chord).toBe("ctrl+shift+c");
    expect(entries[0].target).toBe("terminal.copy_to_clipboard");
    expect(entries[0].lineNumber).toBe(1);
    expect(entries[0].source).toBe("user");
  });

  it("reports correct lineNumber for the entry", () => {
    const text = [
      "# comment",
      "",
      "keybind = ctrl+shift+v = terminal.paste_from_clipboard",
    ].join("\n");

    const { entries } = parseConfigText(text);
    expect(entries).toHaveLength(1);
    expect(entries[0].lineNumber).toBe(3);
  });

  // -------------------------------------------------------------------------
  // Comments and blank lines
  // -------------------------------------------------------------------------

  it("skips comment lines without warning", () => {
    const { entries, warnings } = parseConfigText("# this is a comment");
    expect(entries).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("skips comment with leading whitespace", () => {
    const { entries, warnings } = parseConfigText("   # indented comment");
    expect(entries).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("skips blank lines without warning", () => {
    const text = "\n\n   \n";
    const { entries, warnings } = parseConfigText(text);
    expect(entries).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("handles CRLF line endings", () => {
    const { entries, warnings } = parseConfigText(
      "keybind = ctrl+shift+c = terminal.copy_to_clipboard\r\n",
    );
    expect(warnings).toHaveLength(0);
    expect(entries).toHaveLength(1);
  });

  // -------------------------------------------------------------------------
  // Malformed grammar
  // -------------------------------------------------------------------------

  it("emits warning for line missing 'keybind' keyword", () => {
    const { entries, warnings } = parseConfigText(
      "ctrl+shift+c = terminal.copy_to_clipboard",
    );
    expect(entries).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].lineNumber).toBe(1);
    expect(warnings[0].reason).toMatch(/keybind/);
  });

  it("emits warning for line missing second '='", () => {
    const { entries, warnings } = parseConfigText(
      "keybind = ctrl+shift+c terminal.copy_to_clipboard",
    );
    expect(entries).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toMatch(/second/i);
  });

  it("emits warning for line with no '=' at all", () => {
    const { entries, warnings } = parseConfigText("keybind garbage line");
    expect(entries).toHaveLength(0);
    expect(warnings).toHaveLength(1);
  });

  it("emits warning for line with invalid chord", () => {
    const { entries, warnings } = parseConfigText(
      "keybind = win+c = terminal.copy_to_clipboard",
    );
    expect(entries).toHaveLength(0);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].reason).toMatch(/chord/i);
  });

  it("includes the raw line in the warning", () => {
    const rawLine = "keybind garbage line";
    const { warnings } = parseConfigText(rawLine);
    expect(warnings[0].line).toBe(rawLine);
  });

  // -------------------------------------------------------------------------
  // Mixed valid + malformed
  // -------------------------------------------------------------------------

  it("returns valid entry AND warning when one line is malformed", () => {
    const text = [
      "keybind = ctrl+shift+c = terminal.copy_to_clipboard",
      "this is garbage",
    ].join("\n");

    const { entries, warnings } = parseConfigText(text);
    expect(entries).toHaveLength(1);
    expect(warnings).toHaveLength(1);
    expect(entries[0].chord).toBe("ctrl+shift+c");
    expect(warnings[0].lineNumber).toBe(2);
  });

  it("processes all valid lines even when surrounded by invalid ones", () => {
    const text = [
      "garbage line 1",
      "keybind = ctrl+shift+c = terminal.copy_to_clipboard",
      "garbage line 3",
      "keybind = ctrl+shift+v = terminal.paste_from_clipboard",
    ].join("\n");

    const { entries, warnings } = parseConfigText(text);
    expect(entries).toHaveLength(2);
    expect(warnings).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Unbind directive
  // -------------------------------------------------------------------------

  it("parses unbind directive correctly", () => {
    const { entries, warnings } = parseConfigText(
      "keybind = ctrl+shift+t = unbind",
    );
    expect(warnings).toHaveLength(0);
    expect(entries).toHaveLength(1);
    expect(entries[0].chord).toBe("ctrl+shift+t");
    expect(entries[0].target).toBe("unbind");
  });

  // -------------------------------------------------------------------------
  // Symbol aliases
  // -------------------------------------------------------------------------

  it("parses ctrl+plus chord", () => {
    const { entries, warnings } = parseConfigText(
      "keybind = ctrl+plus = terminal.font_size_inc",
    );
    expect(warnings).toHaveLength(0);
    expect(entries).toHaveLength(1);
    expect(entries[0].chord).toBe("ctrl+plus");
  });

  it("parses ctrl+minus chord", () => {
    const { entries, warnings } = parseConfigText(
      "keybind = ctrl+minus = terminal.font_size_dec",
    );
    expect(warnings).toHaveLength(0);
    expect(entries[0].chord).toBe("ctrl+minus");
  });

  it("parses ctrl+shift+comma chord", () => {
    const { entries, warnings } = parseConfigText(
      "keybind = ctrl+shift+comma = terminal.reload_config",
    );
    expect(warnings).toHaveLength(0);
    expect(entries[0].chord).toBe("ctrl+shift+comma");
  });

  it("parses ctrl+up chord", () => {
    const { entries, warnings } = parseConfigText(
      "keybind = ctrl+up = terminal.scroll_page_up",
    );
    expect(warnings).toHaveLength(0);
    expect(entries[0].chord).toBe("ctrl+up");
  });

  // -------------------------------------------------------------------------
  // Whitespace tolerance
  // -------------------------------------------------------------------------

  it("tolerates extra spaces around '=' separators", () => {
    const { entries, warnings } = parseConfigText(
      "keybind   =   ctrl+shift+c   =   terminal.copy_to_clipboard",
    );
    expect(warnings).toHaveLength(0);
    expect(entries).toHaveLength(1);
    expect(entries[0].chord).toBe("ctrl+shift+c");
    expect(entries[0].target).toBe("terminal.copy_to_clipboard");
  });

  it("tolerates tabs around '=' separators", () => {
    const { entries, warnings } = parseConfigText(
      "keybind\t=\tctrl+shift+c\t=\tterminal.copy_to_clipboard",
    );
    expect(warnings).toHaveLength(0);
    expect(entries).toHaveLength(1);
  });

  it("tolerates no spaces around '=' separators", () => {
    const { entries, warnings } = parseConfigText(
      "keybind=ctrl+shift+c=terminal.copy_to_clipboard",
    );
    expect(warnings).toHaveLength(0);
    expect(entries).toHaveLength(1);
    expect(entries[0].chord).toBe("ctrl+shift+c");
  });

  it("strips trailing whitespace from target", () => {
    const { entries, warnings } = parseConfigText(
      "keybind = ctrl+shift+c = terminal.copy_to_clipboard   ",
    );
    expect(warnings).toHaveLength(0);
    expect(entries[0].target).toBe("terminal.copy_to_clipboard");
  });

  // -------------------------------------------------------------------------
  // Case normalization
  // -------------------------------------------------------------------------

  it("normalizes chord tokens to lowercase", () => {
    const { entries, warnings } = parseConfigText(
      "keybind = Ctrl+SHIFT+R = pane.split_right",
    );
    expect(warnings).toHaveLength(0);
    expect(entries[0].chord).toBe("ctrl+shift+r");
  });

  it("normalizes mixed-case modifiers in various positions", () => {
    const { entries, warnings } = parseConfigText(
      "keybind = CTRL+ALT+shift+F = pane.split_down",
    );
    expect(warnings).toHaveLength(0);
    expect(entries[0].chord).toBe("ctrl+alt+shift+f");
  });

  // -------------------------------------------------------------------------
  // Multi-line config fixture (realistic)
  // -------------------------------------------------------------------------

  it("parses a realistic multi-line config fixture", () => {
    const config = `
# clipboard
keybind = ctrl+shift+c = terminal.copy_to_clipboard
keybind = ctrl+shift+v = terminal.paste_from_clipboard

# remove a binding
keybind = ctrl+shift+t = unbind

# font size
keybind = ctrl+plus = terminal.font_size_inc
keybind = ctrl+minus = terminal.font_size_dec
`.trim();

    const { entries, warnings } = parseConfigText(config);
    expect(warnings).toHaveLength(0);
    expect(entries).toHaveLength(5);
    expect(entries.map((e) => e.chord)).toEqual([
      "ctrl+shift+c",
      "ctrl+shift+v",
      "ctrl+shift+t",
      "ctrl+plus",
      "ctrl+minus",
    ]);
    expect(entries[2].target).toBe("unbind");
  });

  it("returns empty results for empty string input", () => {
    const { entries, warnings } = parseConfigText("");
    expect(entries).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });

  it("returns empty results for whitespace-only input", () => {
    const { entries, warnings } = parseConfigText("   \n\n\t\n   ");
    expect(entries).toHaveLength(0);
    expect(warnings).toHaveLength(0);
  });
});
