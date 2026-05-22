/**
 * engine.test.ts — Unit tests for the keybinds engine skeleton.
 *
 * Covers:
 *  - listBindings() returns 29 entries after loadDefaults()
 *  - Custom key handler returns true (passthrough) for unmatched chords
 *  - Custom key handler returns false (consume) for matched chords
 *  - IME events return true (passthrough)
 *  - registerAction / dispose cycle
 *
 * T1.4 acceptance criteria per tasks artifact.
 */

import { describe, it, expect, vi } from "vitest";
import { createKeybindsEngine } from "../engine";

// ---------------------------------------------------------------------------
// Minimal Terminal mock (xterm.js Terminal interface subset)
// ---------------------------------------------------------------------------

function makeMockTerminal() {
  let currentHandler: ((ev: KeyboardEvent) => boolean) | null = null;

  return {
    attachCustomKeyEventHandler: vi.fn((handler: (ev: KeyboardEvent) => boolean) => {
      currentHandler = handler;
    }),
    dispose: vi.fn(),
    /** Fire a keyboard event through the attached handler */
    fireKey: (ev: Partial<KeyboardEvent>): boolean => {
      if (!currentHandler) throw new Error("No handler attached");
      return currentHandler(ev as KeyboardEvent);
    },
  };
}

// ---------------------------------------------------------------------------
// Event builders
// ---------------------------------------------------------------------------

function keyEvent(overrides: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): Partial<KeyboardEvent> {
  return {
    key: overrides.key,
    keyCode: overrides.keyCode ?? 0,
    ctrlKey: overrides.ctrlKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    altKey: overrides.altKey ?? false,
    metaKey: overrides.metaKey ?? false,
    isComposing: overrides.isComposing ?? false,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createKeybindsEngine", () => {
  it("listBindings() returns empty before loadDefaults()", () => {
    const engine = createKeybindsEngine();
    expect(engine.listBindings()).toHaveLength(0);
  });

  it("listBindings() returns 29 entries after loadDefaults()", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    expect(engine.listBindings()).toHaveLength(29);
  });

  it("all bindings have source 'default' after loadDefaults()", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    for (const b of engine.listBindings()) {
      expect(b.source).toBe("default");
    }
  });
});

describe("attachToTerminal", () => {
  it("calls term.attachCustomKeyEventHandler once on attach", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);
    expect(term.attachCustomKeyEventHandler).toHaveBeenCalledTimes(1);
  });

  it("re-attaching calls attachCustomKeyEventHandler again (replaces, not duplicates)", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);
    engine.attachToTerminal(term as never);
    expect(term.attachCustomKeyEventHandler).toHaveBeenCalledTimes(2);
  });
});

describe("custom key handler — passthrough", () => {
  it("returns true for unmatched chord", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    // 'a' alone is not bound
    const result = term.fireKey(keyEvent({ key: "a" }));
    expect(result).toBe(true);
  });

  it("returns true for plain letter with no modifiers", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const result = term.fireKey(keyEvent({ key: "z" }));
    expect(result).toBe(true);
  });

  it("returns true for IME composing event (isComposing=true)", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const result = term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true, isComposing: true }));
    expect(result).toBe(true);
  });

  it("returns true for keyCode 229 (dead key / IME)", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const result = term.fireKey(keyEvent({ key: "Process", keyCode: 229 }));
    expect(result).toBe(true);
  });
});

describe("custom key handler — consume matched chord", () => {
  it("returns false for ctrl+shift+c (matched default binding)", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const result = term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }));
    expect(result).toBe(false);
  });

  it("returns false for ctrl+shift+v (paste)", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const result = term.fireKey(keyEvent({ key: "V", ctrlKey: true, shiftKey: true }));
    expect(result).toBe(false);
  });

  it("returns false for ctrl+plus (font_size_inc)", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    // "+" with shiftKey → normalized to "ctrl+plus" (shift stripped)
    const result = term.fireKey(keyEvent({ key: "+", ctrlKey: true, shiftKey: true }));
    expect(result).toBe(false);
  });

  it("invokes onStub callback when matched chord has no handler", () => {
    const onStub = vi.fn();
    const engine = createKeybindsEngine({ onStub });
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }));
    expect(onStub).toHaveBeenCalledWith("terminal.copy_to_clipboard");
  });
});

describe("registerAction / dispose", () => {
  it("registered handler is invoked when chord matches", () => {
    const handler = vi.fn();
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    engine.registerAction("terminal.copy_to_clipboard", handler);

    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    // onStub should NOT be called when real handler is registered
    term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }));
    expect(handler).toHaveBeenCalledOnce();
  });

  it("disposed handler is NOT invoked after dispose()", () => {
    const handler = vi.fn();
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const disposable = engine.registerAction("terminal.copy_to_clipboard", handler);

    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    // Fire before dispose — handler called
    term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }));
    expect(handler).toHaveBeenCalledTimes(1);

    // Dispose — then fire again
    disposable.dispose();

    // Re-attach to get a fresh handler closure that sees the updated registry
    engine.attachToTerminal(term as never);
    term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }));

    // handler should still be at 1 (not called again after dispose)
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("detach", () => {
  it("replaces handler with passthrough on detach", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    // Before detach: matched chord is consumed
    expect(term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }))).toBe(false);

    // Detach
    engine.detach(term as never);

    // After detach: all chords pass through
    expect(term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }))).toBe(true);
  });
});
