/**
 * guards.test.ts — Unit tests for imeGuard and webkitHijackPrevent.
 *
 * REQ-KB-029 (IME guard), REQ-KB-030 (WebKit hijack preventDefault),
 * REQ-KB-031 (ctrl+r must prevent page reload), spec §8 (WEBKIT_HIJACK list).
 */

import { describe, it, expect, vi } from "vitest";
import { imeGuard, webkitHijackPrevent } from "../guards";
import type { Chord } from "../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: {
  key?: string;
  keyCode?: number;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
}): KeyboardEvent {
  const mock = {
    key: overrides.key ?? "a",
    keyCode: overrides.keyCode ?? 0,
    ctrlKey: overrides.ctrlKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    altKey: overrides.altKey ?? false,
    metaKey: overrides.metaKey ?? false,
    isComposing: overrides.isComposing ?? false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
  return mock;
}

function chord(s: string): Chord {
  return s as Chord;
}

// ---------------------------------------------------------------------------
// imeGuard
// ---------------------------------------------------------------------------

describe("imeGuard", () => {
  it("returns true when isComposing is true", () => {
    const ev = makeEvent({ key: "c", ctrlKey: true, shiftKey: true, isComposing: true });
    expect(imeGuard(ev)).toBe(true);
  });

  it("returns true when keyCode is 229 (legacy IME dead key)", () => {
    const ev = makeEvent({ key: "Process", keyCode: 229 });
    expect(imeGuard(ev)).toBe(true);
  });

  it("returns false when isComposing is false and keyCode is not 229", () => {
    const ev = makeEvent({ key: "c", ctrlKey: true, shiftKey: true });
    expect(imeGuard(ev)).toBe(false);
  });

  it("returns false for a regular letter key", () => {
    const ev = makeEvent({ key: "a" });
    expect(imeGuard(ev)).toBe(false);
  });

  it("returns false for keyCode 0 (not IME)", () => {
    const ev = makeEvent({ key: "Enter", keyCode: 0 });
    expect(imeGuard(ev)).toBe(false);
  });

  it("returns true when both isComposing and keyCode 229 are set", () => {
    const ev = makeEvent({ key: "Process", keyCode: 229, isComposing: true });
    expect(imeGuard(ev)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// webkitHijackPrevent
// ---------------------------------------------------------------------------

describe("webkitHijackPrevent", () => {
  // REQ-KB-031: ctrl+r MUST be in WEBKIT_HIJACK
  it("calls preventDefault for ctrl+r (page reload — CRITICAL)", () => {
    const ev = makeEvent({ key: "r", ctrlKey: true });
    const result = webkitHijackPrevent(ev, chord("ctrl+r"));
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("calls preventDefault for ctrl+shift+r (hard reload — CRITICAL)", () => {
    const ev = makeEvent({ key: "r", ctrlKey: true, shiftKey: true });
    const result = webkitHijackPrevent(ev, chord("ctrl+shift+r"));
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("calls preventDefault for ctrl+w (close window/tab)", () => {
    const ev = makeEvent({ key: "w", ctrlKey: true });
    const result = webkitHijackPrevent(ev, chord("ctrl+w"));
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("calls preventDefault for ctrl+f (browser find bar)", () => {
    const ev = makeEvent({ key: "f", ctrlKey: true });
    const result = webkitHijackPrevent(ev, chord("ctrl+f"));
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("calls preventDefault for ctrl+0 (browser zoom reset — also bound to font_size_reset)", () => {
    const ev = makeEvent({ key: "0", ctrlKey: true });
    const result = webkitHijackPrevent(ev, chord("ctrl+0"));
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("calls preventDefault for ctrl+plus (browser zoom in — also bound to font_size_inc)", () => {
    const ev = makeEvent({ key: "+", ctrlKey: true });
    const result = webkitHijackPrevent(ev, chord("ctrl+plus"));
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("calls preventDefault for ctrl+minus (browser zoom out — also bound to font_size_dec)", () => {
    const ev = makeEvent({ key: "-", ctrlKey: true });
    const result = webkitHijackPrevent(ev, chord("ctrl+minus"));
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("calls preventDefault for f5 (page reload)", () => {
    const ev = makeEvent({ key: "F5" });
    const result = webkitHijackPrevent(ev, chord("f5"));
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("calls preventDefault for ctrl+shift+i (DevTools)", () => {
    const ev = makeEvent({ key: "i", ctrlKey: true, shiftKey: true });
    const result = webkitHijackPrevent(ev, chord("ctrl+shift+i"));
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("calls preventDefault for f12 (DevTools)", () => {
    const ev = makeEvent({ key: "F12" });
    const result = webkitHijackPrevent(ev, chord("f12"));
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(result).toBe(true);
  });

  it("does NOT call preventDefault for a non-hijack chord", () => {
    const ev = makeEvent({ key: "c", ctrlKey: true, shiftKey: true });
    const result = webkitHijackPrevent(ev, chord("ctrl+shift+c"));
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("does NOT call preventDefault for a plain letter key", () => {
    const ev = makeEvent({ key: "a" });
    const result = webkitHijackPrevent(ev, chord("a"));
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("returns false and does NOT call preventDefault when chord is null", () => {
    const ev = makeEvent({ key: "c" });
    const result = webkitHijackPrevent(ev, null);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(result).toBe(false);
  });

  it("covers all 10 chords in WEBKIT_HIJACK list", () => {
    const hijackChords = [
      "ctrl+r", "ctrl+shift+r", "ctrl+w", "ctrl+f",
      "ctrl+0", "ctrl+plus", "ctrl+minus", "f5",
      "ctrl+shift+i", "f12",
    ];
    for (const c of hijackChords) {
      const ev = makeEvent({ key: "x" });
      const result = webkitHijackPrevent(ev, chord(c));
      expect(result, `Expected true for ${c}`).toBe(true);
      expect(ev.preventDefault, `Expected preventDefault called for ${c}`).toHaveBeenCalled();
    }
  });
});

// ---------------------------------------------------------------------------
// Engine integration: IME guard + WebKit guard in the handler
// ---------------------------------------------------------------------------

describe("engine handler integration with guards", () => {
  it("isComposing=true → handler returns true (no dispatch, no preventDefault)", async () => {
    const { createKeybindsEngine } = await import("../engine");
    const engine = createKeybindsEngine();
    engine.loadDefaults();

    let handlerAttached: ((ev: KeyboardEvent) => boolean) | null = null;
    const term = {
      attachCustomKeyEventHandler: vi.fn((h) => { handlerAttached = h; }),
      dispose: vi.fn(),
    };
    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "C", ctrlKey: true, shiftKey: true, isComposing: true });
    const result = handlerAttached!(ev);

    expect(result).toBe(true);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("keyCode=229 (legacy IME) → handler returns true", async () => {
    const { createKeybindsEngine } = await import("../engine");
    const engine = createKeybindsEngine();
    engine.loadDefaults();

    let handlerAttached: ((ev: KeyboardEvent) => boolean) | null = null;
    const term = {
      attachCustomKeyEventHandler: vi.fn((h) => { handlerAttached = h; }),
      dispose: vi.fn(),
    };
    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "Process", keyCode: 229 });
    const result = handlerAttached!(ev);

    expect(result).toBe(true);
  });

  it("ctrl+r → preventDefault called; handler returns true (passthrough — no binding)", async () => {
    const { createKeybindsEngine } = await import("../engine");
    // Use engine with ONLY defaults. ctrl+r is NOT in defaults (it's reserved),
    // so after preventDefault the chord falls through to PTY (returns true).
    const engine = createKeybindsEngine();
    engine.loadDefaults();

    let handlerAttached: ((ev: KeyboardEvent) => boolean) | null = null;
    const term = {
      attachCustomKeyEventHandler: vi.fn((h) => { handlerAttached = h; }),
      dispose: vi.fn(),
    };
    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "r", ctrlKey: true });
    const result = handlerAttached!(ev);

    // preventDefault called (WebKit hijack guard)
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    // Handler returns true (passthrough — ctrl+r not in defaults)
    expect(result).toBe(true);
  });

  it("ctrl+0 → preventDefault called AND action dispatched (font_size_reset is bound)", async () => {
    const { createKeybindsEngine } = await import("../engine");
    const actionHandler = vi.fn();
    const engine = createKeybindsEngine({
      getActionContext: () => ({
        term: {} as never,
        fit: {} as never,
        ptyWrite: vi.fn().mockResolvedValue(undefined),
        sessionId: 1,
      }),
    });
    engine.loadDefaults();
    engine.registerAction("terminal.font_size_reset", actionHandler);

    let handlerAttached: ((ev: KeyboardEvent) => boolean) | null = null;
    const term = {
      attachCustomKeyEventHandler: vi.fn((h) => { handlerAttached = h; }),
      dispose: vi.fn(),
    };
    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "0", ctrlKey: true });
    const result = handlerAttached!(ev);

    // Both preventDefault (WebKit) AND action dispatch happen
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
    expect(actionHandler).toHaveBeenCalledTimes(1);
    // Returns false (key consumed — binding dispatched)
    expect(result).toBe(false);
  });
});
