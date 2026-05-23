/**
 * engine.test.ts — Unit tests for the keybinds engine.
 *
 * Covers (T1.4 — skeleton):
 *  - listBindings() returns 29 entries after loadDefaults()
 *  - Custom key handler returns true (passthrough) for unmatched chords
 *  - Custom key handler returns false (consume) for matched chords
 *  - IME events return true (passthrough)
 *  - registerAction / dispose cycle
 *
 * Covers (T2.3 — IDisposable completeness + dispatch):
 *  - After dispose(), handler NOT invoked on chord
 *  - Late registration: registered AFTER attach, invoked on next chord
 *  - listBindings() count unchanged after handler dispose (bindings independent)
 *  - Matched chord with no handler → console.warn + consume (REQ-KB-020)
 *  - Warn-once: second press does NOT re-warn (REQ-KB-020 deduplicated)
 *  - getActionContext: handler receives ctx on invocation
 *
 * Covers (T3.4 — loadConfig + hot reload):
 *  - loadConfig with mocked invoke → engine.listBindings shows user overrides applied
 *  - loadConfig with empty string (no file) → defaults preserved unchanged
 *  - hot reload event via "keybinds-changed" → re-resolves without remount
 *  - listBindings() source field: defaults="default", overrides="override"
 */

import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { createKeybindsEngine } from "../engine";
import type { ActionContext } from "../types";

// ---------------------------------------------------------------------------
// console.warn spy teardown
// ---------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Minimal ActionContext mock
// ---------------------------------------------------------------------------

function makeCtx(): ActionContext {
  return {
    term: {} as ActionContext["term"],
    fit: {} as ActionContext["fit"],
    ptyWrite: vi.fn().mockResolvedValue(undefined),
    sessionId: 1,
  };
}

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
    // Guards may call preventDefault — provide a no-op so tests don't crash
    preventDefault: vi.fn(),
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
    const ctx = makeCtx();
    const engine = createKeybindsEngine({ getActionContext: () => ctx });
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
    const ctx = makeCtx();
    const engine = createKeybindsEngine({ getActionContext: () => ctx });
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

  // T2.3 — Late registration: registered AFTER attach, invoked on next chord
  it("late registration: handler registered after attach is invoked on next chord", () => {
    const ctx = makeCtx();
    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();

    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    // Register handler AFTER attach
    const handler = vi.fn();
    engine.registerAction("terminal.copy_to_clipboard", handler);

    // Next chord should invoke the late-registered handler
    term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }));
    expect(handler).toHaveBeenCalledOnce();
  });

  // T2.3 — listBindings count unchanged after handler dispose
  it("listBindings() count unchanged after handler dispose", () => {
    const ctx = makeCtx();
    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();

    const disposable = engine.registerAction("terminal.copy_to_clipboard", vi.fn());
    const bindingsBefore = engine.listBindings().length;

    disposable.dispose();

    const bindingsAfter = engine.listBindings().length;
    // Bindings (chord→actionId map) are independent of handlers (actionId→handler map)
    expect(bindingsAfter).toBe(bindingsBefore);
  });
});

// ---------------------------------------------------------------------------
// T2.3 — REQ-KB-020: matched chord with no handler → warn once + consume
// ---------------------------------------------------------------------------

describe("matched chord with no handler (REQ-KB-020)", () => {
  it("returns false (consumed) when chord is matched but no handler registered", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const result = term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }));
    expect(result).toBe(false);
  });

  it("emits console.warn when matched chord has no handler", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }));
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("no handler registered for"),
      "terminal.copy_to_clipboard",
    );
  });

  it("does NOT re-warn on second press of same chord (deduplication)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }));
    term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }));
    term.fireKey(keyEvent({ key: "C", ctrlKey: true, shiftKey: true }));

    const keybindWarns = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("no handler registered for"),
    );
    expect(keybindWarns).toHaveLength(1);
  });

  it("handler invoked on chord receives (event, ctx)", () => {
    const ctx = makeCtx();
    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();
    const handler = vi.fn();
    engine.registerAction("terminal.copy_to_clipboard", handler);

    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const ev = keyEvent({ key: "C", ctrlKey: true, shiftKey: true });
    term.fireKey(ev);

    // Handler should have been called with (event, ctx)
    expect(handler).toHaveBeenCalledWith(ev, ctx);
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

// ---------------------------------------------------------------------------
// T3.4 — loadConfig + hot reload (REQ-KB-003, REQ-KB-037..040)
// ---------------------------------------------------------------------------

// Mock @tauri-apps/api/core so tests can run without a Tauri runtime
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

// Mock @tauri-apps/api/event so subscribeHotReload works in test env
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

describe("loadConfig (T3.4)", () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    invokeMock = invoke as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("empty config string (file absent) preserves all 29 defaults unchanged", async () => {
    invokeMock.mockResolvedValue("");
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();
    const bindings = engine.listBindings();
    expect(bindings).toHaveLength(29);
    for (const b of bindings) {
      expect(b.source).toBe("default");
    }
  });

  it("user override replaces source to 'override' for overridden chord", async () => {
    // Override ctrl+shift+c → terminal.paste_from_clipboard
    invokeMock.mockResolvedValue(
      "keybind = ctrl+shift+c = terminal.paste_from_clipboard\n",
    );
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    const bindings = engine.listBindings();
    const overridden = bindings.find((b) => b.chord === "ctrl+shift+c");
    expect(overridden).toBeDefined();
    expect(overridden!.actionId).toBe("terminal.paste_from_clipboard");
    expect(overridden!.source).toBe("override");
  });

  it("unbind removes the binding from listBindings()", async () => {
    invokeMock.mockResolvedValue("keybind = ctrl+shift+c = unbind\n");
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    const bindings = engine.listBindings();
    const unbound = bindings.find((b) => b.chord === "ctrl+shift+c");
    expect(unbound).toBeUndefined();
    expect(bindings).toHaveLength(28);
  });

  it("extend adds a new binding not in defaults", async () => {
    invokeMock.mockResolvedValue(
      "keybind = ctrl+shift+q = terminal.copy_to_clipboard\n",
    );
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    const bindings = engine.listBindings();
    const ext = bindings.find((b) => b.chord === "ctrl+shift+q");
    expect(ext).toBeDefined();
    expect(ext!.actionId).toBe("terminal.copy_to_clipboard");
    expect(ext!.source).toBe("override");
    // Total = 29 defaults + 1 extension
    expect(bindings).toHaveLength(30);
  });

  it("second loadConfig call with empty content restores defaults (reload after config delete)", async () => {
    invokeMock.mockResolvedValueOnce(
      "keybind = ctrl+shift+c = terminal.paste_from_clipboard\n",
    );
    invokeMock.mockResolvedValueOnce("");

    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();
    // First load: override applied
    expect(
      engine.listBindings().find((b) => b.chord === "ctrl+shift+c")?.actionId,
    ).toBe("terminal.paste_from_clipboard");

    await engine.loadConfig();
    // Second load with empty: back to default
    const after = engine.listBindings().find((b) => b.chord === "ctrl+shift+c");
    expect(after?.actionId).toBe("terminal.copy_to_clipboard");
    expect(after?.source).toBe("default");
  });
});

describe("hot reload via keybinds-changed event (T3.4)", () => {
  let listenMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { listen } = await import("@tauri-apps/api/event");
    listenMock = listen as ReturnType<typeof vi.fn>;
    listenMock.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("subscribeHotReload registers a Tauri event listener", async () => {
    // listen mock: store the callback and return an unlisten fn
    listenMock.mockImplementation((_event: string, _cb: unknown) => {
      return Promise.resolve(vi.fn());
    });

    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const disposable = await engine.subscribeHotReload();

    expect(listenMock).toHaveBeenCalledWith(
      "keybinds-changed",
      expect.any(Function),
    );
    expect(disposable).toHaveProperty("dispose");
  });

  it("keybinds-changed event triggers re-resolve and updates listBindings()", async () => {
    let capturedCallback: ((event: { payload: string }) => void) | null = null;

    listenMock.mockImplementation(
      (_event: string, cb: (event: { payload: string }) => void) => {
        capturedCallback = cb;
        return Promise.resolve(vi.fn());
      },
    );

    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.subscribeHotReload();

    // Before event: ctrl+shift+c → copy_to_clipboard (default)
    expect(
      engine.listBindings().find((b) => b.chord === "ctrl+shift+c")?.actionId,
    ).toBe("terminal.copy_to_clipboard");

    // Fire "keybinds-changed" with override content
    capturedCallback!({
      payload: "keybind = ctrl+shift+c = terminal.paste_from_clipboard\n",
    });

    // After event: ctrl+shift+c → paste_from_clipboard (override)
    const binding = engine.listBindings().find((b) => b.chord === "ctrl+shift+c");
    expect(binding?.actionId).toBe("terminal.paste_from_clipboard");
    expect(binding?.source).toBe("override");
  });

  it("dispose() removes the Tauri listener", async () => {
    const unlistenFn = vi.fn();
    listenMock.mockResolvedValue(unlistenFn);

    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const disposable = await engine.subscribeHotReload();
    disposable.dispose();

    expect(unlistenFn).toHaveBeenCalledOnce();
  });
});
