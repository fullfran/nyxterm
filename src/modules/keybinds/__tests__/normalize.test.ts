/**
 * normalize.test.ts — Unit tests for normalizeKeyEvent and normalizeChord.
 *
 * Covers:
 *  - Modifier sort order: ctrl < alt < shift < meta
 *  - "+" key → "plus" alias + shift stripping (REQ-KB-025)
 *  - "-" key → "minus" alias (REQ-KB-026)
 *  - isComposing passthrough → returns null (REQ-KB-029)
 *  - keyCode 229 passthrough → returns null
 *  - Case normalization (Ctrl+Shift+C → "ctrl+shift+c")
 *  - Arrow keys, function keys, special keys
 *  - FullFran chord samples
 *  - normalizeChord() utility
 */

import { describe, it, expect } from "vitest";
import { normalizeKeyEvent, normalizeChord } from "../normalize";
import type { Chord } from "../types";

// ---------------------------------------------------------------------------
// Helper: build a mock KeyboardEvent
// ---------------------------------------------------------------------------

function makeEvent(overrides: {
  key: string;
  keyCode?: number;
  ctrlKey?: boolean;
  altKey?: boolean;
  shiftKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}): KeyboardEvent {
  const {
    key,
    keyCode = 0,
    ctrlKey = false,
    altKey = false,
    shiftKey = false,
    metaKey = false,
    isComposing = false,
  } = overrides;

  return {
    key,
    keyCode,
    ctrlKey,
    altKey,
    shiftKey,
    metaKey,
    isComposing,
  } as unknown as KeyboardEvent;
}

// ---------------------------------------------------------------------------
// IME guard
// ---------------------------------------------------------------------------

describe("IME guard", () => {
  it("returns null when isComposing is true", () => {
    const ev = makeEvent({ key: "c", ctrlKey: true, shiftKey: true, isComposing: true });
    expect(normalizeKeyEvent(ev)).toBeNull();
  });

  it("returns null when keyCode is 229 (dead key)", () => {
    const ev = makeEvent({ key: "Process", keyCode: 229 });
    expect(normalizeKeyEvent(ev)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Modifier sort order
// ---------------------------------------------------------------------------

describe("modifier sort order: ctrl < alt < shift < meta", () => {
  it("orders ctrl before shift", () => {
    const ev = makeEvent({ key: "c", ctrlKey: true, shiftKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+shift+c");
  });

  it("orders ctrl before alt", () => {
    const ev = makeEvent({ key: "x", ctrlKey: true, altKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+alt+x");
  });

  it("orders all four modifiers correctly: ctrl+alt+shift+meta", () => {
    const ev = makeEvent({ key: "x", ctrlKey: true, altKey: true, shiftKey: true, metaKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+alt+shift+meta+x");
  });

  it("orders shift before meta", () => {
    const ev = makeEvent({ key: "a", shiftKey: true, metaKey: true });
    expect(normalizeKeyEvent(ev)).toBe("shift+meta+a");
  });
});

// ---------------------------------------------------------------------------
// Case normalization
// ---------------------------------------------------------------------------

describe("case normalization", () => {
  it("lowercases letter key (Ctrl+Shift+C has event.key='C')", () => {
    const ev = makeEvent({ key: "C", ctrlKey: true, shiftKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+shift+c");
  });

  it("lowercases letter without modifiers", () => {
    const ev = makeEvent({ key: "Z" });
    expect(normalizeKeyEvent(ev)).toBe("z");
  });
});

// ---------------------------------------------------------------------------
// Symbol aliases
// ---------------------------------------------------------------------------

describe("symbol aliases", () => {
  it("maps '+' key to 'plus' and strips implicit shift (REQ-KB-025)", () => {
    // On US layout, '+' requires Shift — the physical key is '='.
    // ghostty uses "ctrl+plus" not "ctrl+shift+plus".
    const ev = makeEvent({ key: "+", ctrlKey: true, shiftKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+plus");
  });

  it("maps '+' key to 'plus' without shift modifier", () => {
    const ev = makeEvent({ key: "+", ctrlKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+plus");
  });

  it("maps '-' key to 'minus' (REQ-KB-026)", () => {
    const ev = makeEvent({ key: "-", ctrlKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+minus");
  });

  it("maps ' ' to 'space'", () => {
    const ev = makeEvent({ key: " ", ctrlKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+space");
  });

  it("maps ',' to 'comma'", () => {
    const ev = makeEvent({ key: ",", ctrlKey: true, shiftKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+shift+comma");
  });
});

// ---------------------------------------------------------------------------
// Special keys
// ---------------------------------------------------------------------------

describe("special keys", () => {
  it("maps Escape to 'escape'", () => {
    const ev = makeEvent({ key: "Escape" });
    expect(normalizeKeyEvent(ev)).toBe("escape");
  });

  it("maps Enter to 'enter'", () => {
    const ev = makeEvent({ key: "Enter" });
    expect(normalizeKeyEvent(ev)).toBe("enter");
  });

  it("maps Tab to 'tab'", () => {
    const ev = makeEvent({ key: "Tab" });
    expect(normalizeKeyEvent(ev)).toBe("tab");
  });

  it("maps Backspace to 'backspace'", () => {
    const ev = makeEvent({ key: "Backspace" });
    expect(normalizeKeyEvent(ev)).toBe("backspace");
  });

  it("maps ArrowUp to 'up'", () => {
    const ev = makeEvent({ key: "ArrowUp" });
    expect(normalizeKeyEvent(ev)).toBe("up");
  });

  it("maps ArrowDown to 'down'", () => {
    const ev = makeEvent({ key: "ArrowDown" });
    expect(normalizeKeyEvent(ev)).toBe("down");
  });

  it("maps ArrowLeft to 'left'", () => {
    const ev = makeEvent({ key: "ArrowLeft" });
    expect(normalizeKeyEvent(ev)).toBe("left");
  });

  it("maps ArrowRight to 'right'", () => {
    const ev = makeEvent({ key: "ArrowRight" });
    expect(normalizeKeyEvent(ev)).toBe("right");
  });

  it("maps F1..F12 to 'f1'..'f12'", () => {
    for (let i = 1; i <= 12; i++) {
      const ev = makeEvent({ key: `F${i}` });
      expect(normalizeKeyEvent(ev)).toBe(`f${i}`);
    }
  });

  it("maps PageUp to 'pageup'", () => {
    const ev = makeEvent({ key: "PageUp" });
    expect(normalizeKeyEvent(ev)).toBe("pageup");
  });

  it("maps PageDown to 'pagedown'", () => {
    const ev = makeEvent({ key: "PageDown" });
    expect(normalizeKeyEvent(ev)).toBe("pagedown");
  });

  it("maps Home to 'home'", () => {
    const ev = makeEvent({ key: "Home" });
    expect(normalizeKeyEvent(ev)).toBe("home");
  });

  it("maps End to 'end'", () => {
    const ev = makeEvent({ key: "End" });
    expect(normalizeKeyEvent(ev)).toBe("end");
  });
});

// ---------------------------------------------------------------------------
// FullFran canonical chord samples
// ---------------------------------------------------------------------------

describe("FullFran canonical chord samples", () => {
  it("Ctrl+Shift+C → ctrl+shift+c (copy)", () => {
    const ev = makeEvent({ key: "C", ctrlKey: true, shiftKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+shift+c");
  });

  it("Ctrl+Shift+V → ctrl+shift+v (paste)", () => {
    const ev = makeEvent({ key: "V", ctrlKey: true, shiftKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+shift+v");
  });

  it("Ctrl+Shift+T → ctrl+shift+t (new tab)", () => {
    const ev = makeEvent({ key: "T", ctrlKey: true, shiftKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+shift+t");
  });

  it("Ctrl+Tab → ctrl+tab (next tab)", () => {
    const ev = makeEvent({ key: "Tab", ctrlKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+tab");
  });

  it("Ctrl+Shift+Tab → ctrl+shift+tab (prev tab)", () => {
    const ev = makeEvent({ key: "Tab", ctrlKey: true, shiftKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+shift+tab");
  });

  it("Ctrl+0 → ctrl+0 (font reset)", () => {
    const ev = makeEvent({ key: "0", ctrlKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+0");
  });

  it("Ctrl+Shift+Up → ctrl+shift+up (scroll page up)", () => {
    const ev = makeEvent({ key: "ArrowUp", ctrlKey: true, shiftKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+shift+up");
  });

  it("Ctrl+Shift+Home → ctrl+shift+home (scroll to top)", () => {
    const ev = makeEvent({ key: "Home", ctrlKey: true, shiftKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+shift+home");
  });

  it("Ctrl+Shift+End → ctrl+shift+end (scroll to bottom)", () => {
    const ev = makeEvent({ key: "End", ctrlKey: true, shiftKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+shift+end");
  });

  it("Ctrl+Shift+Escape → ctrl+shift+escape (copy mode enter)", () => {
    const ev = makeEvent({ key: "Escape", ctrlKey: true, shiftKey: true });
    expect(normalizeKeyEvent(ev)).toBe("ctrl+shift+escape");
  });
});

// ---------------------------------------------------------------------------
// normalizeChord utility
// ---------------------------------------------------------------------------

describe("normalizeChord", () => {
  it("joins parts with + and lowercases each", () => {
    const chord = normalizeChord(["CTRL", "SHIFT", "C"]);
    expect(chord).toBe("ctrl+shift+c");
  });

  it("handles single part", () => {
    const chord = normalizeChord(["escape"]);
    expect(chord).toBe("escape");
  });

  it("returns a Chord type (branded string)", () => {
    const chord: Chord = normalizeChord(["ctrl", "shift", "r"]);
    expect(chord).toBe("ctrl+shift+r");
  });
});
