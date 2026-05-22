/**
 * ergonomic.test.ts — Full engine lifecycle ergonomic integration test.
 *
 * Covers (T5.2):
 *  - Full boot sequence: loadDefaults → loadConfig(empty) → attachToTerminal
 *  - Keydown simulation for ctrl+shift+c → assert handler dispatched
 *  - Boot performance assertion: createKeybindsEngine + loadDefaults < 50ms
 *    (REQ-KB-NFR-002 says <5ms on warm JS; tests use 50ms for CI tolerance)
 *  - Binding count = 29 at every stage of boot
 *  - Hot reload via simulated "keybinds-changed" event with new config text
 *    → new binding active without terminal remount
 *  - macOS platform hook stub: DEFAULT_BINDINGS unchanged by no-op hook
 *
 * REQ-KB-NFR-002, REQ-KB-NFR-004 (platform hook present), spec §10.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createKeybindsEngine } from "../engine";
import type { ActionContext } from "../types";

// ---------------------------------------------------------------------------
// Module-level Tauri mocks
// ---------------------------------------------------------------------------

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(),
}));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEvent(overrides: {
  key: string;
  ctrlKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  metaKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
}): KeyboardEvent {
  return {
    key: overrides.key,
    keyCode: overrides.keyCode ?? 0,
    ctrlKey: overrides.ctrlKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    altKey: overrides.altKey ?? false,
    metaKey: overrides.metaKey ?? false,
    isComposing: overrides.isComposing ?? false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

function makeMockTerminal() {
  let currentHandler: ((ev: KeyboardEvent) => boolean) | null = null;
  return {
    attachCustomKeyEventHandler: vi.fn((h: (ev: KeyboardEvent) => boolean) => {
      currentHandler = h;
    }),
    dispose: vi.fn(),
    fireKey: (ev: KeyboardEvent): boolean => {
      if (!currentHandler) throw new Error("No handler attached");
      return currentHandler(ev);
    },
  };
}

function makeMockFitAddon() {
  return { fit: vi.fn() };
}

function makeCtx(overrides?: Partial<ActionContext>): ActionContext {
  return {
    term: {} as ActionContext["term"],
    fit: {} as ActionContext["fit"],
    ptyWrite: vi.fn().mockResolvedValue(undefined),
    sessionId: 1,
    ...overrides,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// T5.2 — Ergonomic engine lifecycle test
// ---------------------------------------------------------------------------

describe("ergonomic: full engine lifecycle", () => {
  let term: ReturnType<typeof makeMockTerminal>;
  let fitAddon: ReturnType<typeof makeMockFitAddon>;

  beforeEach(() => {
    term = makeMockTerminal();
    fitAddon = makeMockFitAddon();
  });

  it("boot sequence: 29 bindings after loadDefaults", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    expect(engine.listBindings()).toHaveLength(29);
  });

  it("boot sequence: 29 bindings after loadDefaults + empty loadConfig", async () => {
    const invokeMod = await import("@tauri-apps/api/core");
    (invokeMod.invoke as ReturnType<typeof vi.fn>).mockResolvedValue(""); // no config file

    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();
    expect(engine.listBindings()).toHaveLength(29);
    // All sources remain "default" when no overrides are present
    for (const b of engine.listBindings()) {
      expect(b.source).toBe("default");
    }
  });

  it("boot sequence: 29 bindings after attachToTerminal", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    engine.attachToTerminal(term as never);
    expect(engine.listBindings()).toHaveLength(29);
    expect(term.attachCustomKeyEventHandler).toHaveBeenCalledTimes(1);
  });

  it("ctrl+shift+c dispatches terminal.copy_to_clipboard handler", () => {
    const ctx = makeCtx({
      term: term as unknown as ActionContext["term"],
      fit: fitAddon as unknown as ActionContext["fit"],
    });

    // Inject context via deps.getActionContext so the engine can dispatch
    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();

    let handlerInvoked = false;
    const disposable = engine.registerAction("terminal.copy_to_clipboard", () => {
      handlerInvoked = true;
    });

    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "C", ctrlKey: true, shiftKey: true });
    const result = term.fireKey(ev);

    // Handler consumed the key (returns false) and was invoked
    expect(result).toBe(false);
    expect(handlerInvoked).toBe(true);

    disposable.dispose();
  });

  it("regular key 'a' falls through to PTY (not consumed)", () => {
    const ctx = makeCtx();
    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();
    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "a" });
    const result = term.fireKey(ev);

    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// T5.2 — Boot performance assertion (REQ-KB-NFR-002)
// ---------------------------------------------------------------------------

describe("ergonomic: boot performance", () => {
  it("createKeybindsEngine + loadDefaults completes in under 50ms", () => {
    // REQ-KB-NFR-002 requires <5ms on a warm JS engine.
    // CI runners may be slower; 50ms is a generous threshold that catches
    // pathological regressions (e.g. blocking I/O, synchronous regex loops
    // over the 29-binding set) without flaking on slow VMs.
    const start = performance.now();

    const engine = createKeybindsEngine();
    engine.loadDefaults();

    const elapsed = performance.now() - start;

    expect(engine.listBindings()).toHaveLength(29);
    expect(elapsed).toBeLessThan(50);
  });
});

// ---------------------------------------------------------------------------
// T5.2 — Hot reload via simulated keybinds-changed event
// ---------------------------------------------------------------------------

describe("ergonomic: hot reload lifecycle", () => {
  let listenMock: ReturnType<typeof vi.fn>;
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    const { listen } = await import("@tauri-apps/api/event");
    invokeMock = invoke as ReturnType<typeof vi.fn>;
    listenMock = listen as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
    listenMock.mockReset();
  });

  it("new binding active after hot reload — no terminal remount", async () => {
    invokeMock.mockResolvedValue(""); // initial empty config

    // Capture the event listener registered by subscribeHotReload
    let capturedListener: ((event: { payload: string }) => void) | null = null;
    listenMock.mockImplementation(
      (_event: string, cb: (event: { payload: string }) => void) => {
        capturedListener = cb;
        return Promise.resolve(vi.fn());
      },
    );

    const term = makeMockTerminal();

    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();
    await engine.subscribeHotReload();
    engine.attachToTerminal(term as never);

    // Sanity: 29 defaults before reload
    expect(engine.listBindings()).toHaveLength(29);
    const attachCallsBefore = term.attachCustomKeyEventHandler.mock.calls.length;

    // Simulate keybinds-changed event with a new binding
    const newConfigText =
      "keybind = ctrl+shift+q = terminal.copy_to_clipboard\n";
    if (!capturedListener) throw new Error("listen() was never called");
    (capturedListener as (e: { payload: string }) => void)({ payload: newConfigText });

    // New binding is now in the active map
    const bindings = engine.listBindings();
    const newBinding = bindings.find((b) => b.chord === "ctrl+shift+q");
    expect(newBinding).toBeDefined();
    expect(newBinding?.actionId).toBe("terminal.copy_to_clipboard");
    expect(newBinding?.source).toBe("override");

    // Terminal was NOT remounted (attachCustomKeyEventHandler call count unchanged)
    expect(term.attachCustomKeyEventHandler.mock.calls.length).toBe(
      attachCallsBefore,
    );
  });

  it("binding count is 29+1 after reload adds one new chord", async () => {
    invokeMock.mockResolvedValue("");

    let capturedListener: ((event: { payload: string }) => void) | null = null;
    listenMock.mockImplementation(
      (_event: string, cb: (event: { payload: string }) => void) => {
        capturedListener = cb;
        return Promise.resolve(vi.fn());
      },
    );

    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();
    await engine.subscribeHotReload();

    expect(engine.listBindings()).toHaveLength(29);

    const newConfig = "keybind = ctrl+shift+q = terminal.copy_to_clipboard\n";
    if (!capturedListener) throw new Error("listen() was never called");
    (capturedListener as (e: { payload: string }) => void)({ payload: newConfig });

    expect(engine.listBindings()).toHaveLength(30);
  });
});

// ---------------------------------------------------------------------------
// T5.2 — Platform normalization hook stub (REQ-KB-NFR-004)
// ---------------------------------------------------------------------------

describe("ergonomic: macOS platform hook stub", () => {
  it("defaults.ts exports DEFAULT_BINDINGS with 29 entries (platform hook is a no-op)", async () => {
    // Verify the platform normalization hook stub does not alter the binding set.
    // PLATFORM_NORMALIZATION_HOOK is false (Linux/Phase-1); the 29-entry set
    // must be identical to spec §6. This test is the compile-time companion to
    // the TODO(macOS-port) comment in defaults.ts (REQ-KB-NFR-004).
    const { DEFAULT_BINDINGS } = await import("../defaults");
    expect(DEFAULT_BINDINGS).toHaveLength(29);
    // Spot-check: ctrl+shift+c still maps to copy (not remapped to meta+shift+c)
    const copy = DEFAULT_BINDINGS.find((b) => b.chord === "ctrl+shift+c");
    expect(copy?.actionId).toBe("terminal.copy_to_clipboard");
  });
});
