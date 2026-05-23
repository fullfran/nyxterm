/**
 * acceptance.test.ts — Integration-style acceptance scenarios SC-001 through SC-012.
 *
 * These tests use the full keybinds engine with mocked Tauri invoke + mocked
 * xterm Terminal + jsdom KeyboardEvent.
 *
 * Spec §9, design §5 acceptance criteria, tasks T4.3.
 * REQ-KB-029, REQ-KB-030, REQ-KB-031, REQ-KB-032, REQ-KB-033, REQ-KB-034.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createKeybindsEngine } from "../engine";
import type { ActionContext } from "../types";

// ---------------------------------------------------------------------------
// Module-level Tauri mocks (must be top-level per vitest hoisting)
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
// SC-001: Engine attaches exactly once
// ---------------------------------------------------------------------------

describe("SC-001: Engine attaches and intercepts", () => {
  it("attachCustomKeyEventHandler called exactly once on attach", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);
    expect(term.attachCustomKeyEventHandler).toHaveBeenCalledTimes(1);
  });

  it("listBindings() returns 29 entries (full FullFran factory)", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    expect(engine.listBindings()).toHaveLength(29);
  });

  it("plain character 'a' falls through to PTY (not consumed)", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);
    const result = term.fireKey(makeEvent({ key: "a" }));
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SC-002: Default factory loaded at boot
// ---------------------------------------------------------------------------

describe("SC-002: Default factory loaded at boot", () => {
  it("returns exactly 29 entries after loadDefaults()", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    expect(engine.listBindings()).toHaveLength(29);
  });

  it("each entry has source 'default'", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    for (const b of engine.listBindings()) {
      expect(b.source).toBe("default");
    }
  });

  it("ctrl+shift+c maps to terminal.copy_to_clipboard", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const binding = engine.listBindings().find((b) => b.chord === "ctrl+shift+c");
    expect(binding?.actionId).toBe("terminal.copy_to_clipboard");
  });
});

// ---------------------------------------------------------------------------
// SC-003: User config overrides a default binding
// ---------------------------------------------------------------------------

describe("SC-003: User config overrides a default binding", () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    invokeMock = invoke as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
  });

  it("ctrl+shift+c override shows paste_from_clipboard with source override", async () => {
    invokeMock.mockResolvedValue(
      "keybind = ctrl+shift+c = terminal.paste_from_clipboard\n",
    );
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    const binding = engine.listBindings().find((b) => b.chord === "ctrl+shift+c");
    expect(binding?.actionId).toBe("terminal.paste_from_clipboard");
    expect(binding?.source).toBe("override");
  });

  it("pressing ctrl+shift+c now invokes paste handler (not copy)", async () => {
    invokeMock.mockResolvedValue(
      "keybind = ctrl+shift+c = terminal.paste_from_clipboard\n",
    );
    const pasteHandler = vi.fn();
    const copyHandler = vi.fn();
    const ctx = makeCtx();
    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();
    engine.registerAction("terminal.paste_from_clipboard", pasteHandler);
    engine.registerAction("terminal.copy_to_clipboard", copyHandler);
    await engine.loadConfig();

    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    term.fireKey(makeEvent({ key: "C", ctrlKey: true, shiftKey: true }));
    expect(pasteHandler).toHaveBeenCalledTimes(1);
    expect(copyHandler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SC-004: Unbind removes a binding
// ---------------------------------------------------------------------------

describe("SC-004: Unbind removes a binding", () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    invokeMock = invoke as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
  });

  it("unbound chord falls through to PTY (handler returns true)", async () => {
    invokeMock.mockResolvedValue("keybind = ctrl+shift+t = unbind\n");
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const result = term.fireKey(makeEvent({ key: "T", ctrlKey: true, shiftKey: true }));
    expect(result).toBe(true);
  });

  it("unbound chord not in listBindings()", async () => {
    invokeMock.mockResolvedValue("keybind = ctrl+shift+t = unbind\n");
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    const binding = engine.listBindings().find((b) => b.chord === "ctrl+shift+t");
    expect(binding).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// SC-005: Hot reload updates bindings without restart
// ---------------------------------------------------------------------------

describe("SC-005 / SC-006: Hot reload updates bindings without restart", () => {
  let listenMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { listen } = await import("@tauri-apps/api/event");
    listenMock = listen as ReturnType<typeof vi.fn>;
    listenMock.mockReset();
  });

  it("keybinds-changed event updates listBindings() without engine remount", async () => {
    let capturedCb: ((e: { payload: string }) => void) | null = null;
    listenMock.mockImplementation((_evt: string, cb: (e: { payload: string }) => void) => {
      capturedCb = cb;
      return Promise.resolve(vi.fn());
    });

    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.subscribeHotReload();

    // Before: no ctrl+shift+q binding
    expect(engine.listBindings().find((b) => b.chord === "ctrl+shift+q")).toBeUndefined();

    // Fire hot reload event
    capturedCb!({ payload: "keybind = ctrl+shift+q = terminal.copy_to_clipboard\n" });

    // After: ctrl+shift+q → copy_to_clipboard
    const binding = engine.listBindings().find((b) => b.chord === "ctrl+shift+q");
    expect(binding?.actionId).toBe("terminal.copy_to_clipboard");
    expect(binding?.source).toBe("override");
  });
});

// ---------------------------------------------------------------------------
// SC-007: IME composition preserved
// ---------------------------------------------------------------------------

describe("SC-007: IME composition preserved", () => {
  it("isComposing=true → handler returns true (passthrough)", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "C", ctrlKey: true, shiftKey: true, isComposing: true });
    const result = term.fireKey(ev);
    expect(result).toBe(true);
  });

  it("no action handler invoked during IME composition", () => {
    const handler = vi.fn();
    const ctx = makeCtx();
    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();
    engine.registerAction("terminal.copy_to_clipboard", handler);

    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "C", ctrlKey: true, shiftKey: true, isComposing: true });
    term.fireKey(ev);
    expect(handler).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SC-008: WebKit Ctrl+R prevented (REQ-KB-030, REQ-KB-031)
// ---------------------------------------------------------------------------

describe("SC-008: WebKit Ctrl+R prevented", () => {
  it("ctrl+r → preventDefault called", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "r", ctrlKey: true });
    term.fireKey(ev);
    expect(ev.preventDefault).toHaveBeenCalledTimes(1);
  });

  it("ctrl+r falls through to PTY (no binding in defaults) → handler returns true", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "r", ctrlKey: true });
    const result = term.fireKey(ev);
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SC-009: Reserved chord rejected at config load (REQ-KB-032)
// ---------------------------------------------------------------------------

describe("SC-009: Reserved chord rejected at config load", () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    invokeMock = invoke as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
  });

  it("ctrl+c binding is rejected and not registered", async () => {
    invokeMock.mockResolvedValue(
      "keybind = ctrl+c = terminal.copy_to_clipboard\n",
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    // ctrl+c must NOT be in listBindings()
    const binding = engine.listBindings().find((b) => b.chord === "ctrl+c");
    expect(binding).toBeUndefined();

    // Warning logged
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("ctrl+c"),
    );
  });

  it("ctrl+c falls through to PTY (returns true) after rejected config", async () => {
    invokeMock.mockResolvedValue(
      "keybind = ctrl+c = terminal.copy_to_clipboard\n",
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const result = term.fireKey(makeEvent({ key: "c", ctrlKey: true }));
    expect(result).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// SC-010: Invalid action_id rejected at config load (REQ-KB-033)
// ---------------------------------------------------------------------------

describe("SC-010: Invalid action_id rejected at config load", () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    invokeMock = invoke as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
  });

  it("unknown action_id rejected; warning logged", async () => {
    invokeMock.mockResolvedValue(
      "keybind = ctrl+shift+x = foo.nonexistent\n",
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    expect(engine.listBindings().find((b) => b.chord === "ctrl+shift+x")).toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("foo.nonexistent"),
    );
  });

  it("valid entries in same file still applied (REQ-KB-034)", async () => {
    invokeMock.mockResolvedValue(
      "keybind = ctrl+shift+x = foo.nonexistent\n" +
      "keybind = ctrl+shift+q = terminal.copy_to_clipboard\n",
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    // Invalid entry rejected
    expect(engine.listBindings().find((b) => b.chord === "ctrl+shift+x")).toBeUndefined();
    // Valid entry applied
    const valid = engine.listBindings().find((b) => b.chord === "ctrl+shift+q");
    expect(valid?.actionId).toBe("terminal.copy_to_clipboard");
  });
});

// ---------------------------------------------------------------------------
// SC-011: Group B/C stub fires warning, key consumed (not passed to PTY)
// ---------------------------------------------------------------------------

describe("SC-011: Group B/C stub fires warning, does not pass through", () => {
  it("ctrl+shift+r (pane.split_right stub) → returns false (consumed)", () => {
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "R", ctrlKey: true, shiftKey: true });
    const result = term.fireKey(ev);
    // ctrl+shift+r is bound to pane.split_right (stub) → consumed
    expect(result).toBe(false);
  });

  it("stub warning emitted at most once (deduplicated)", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    const term = makeMockTerminal();
    engine.attachToTerminal(term as never);

    const ev1 = makeEvent({ key: "R", ctrlKey: true, shiftKey: true });
    const ev2 = makeEvent({ key: "R", ctrlKey: true, shiftKey: true });
    term.fireKey(ev1);
    term.fireKey(ev2);

    // "no handler registered for" warn fires only once per session
    const calls = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("no handler registered for"),
    );
    expect(calls).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// SC-012: Last-write-wins on duplicate chord in config
// ---------------------------------------------------------------------------

describe("SC-012: Last-write-wins on duplicate chord in config", () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    invokeMock = invoke as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
  });

  it("last occurrence of duplicate chord wins; warning for earlier occurrence", async () => {
    invokeMock.mockResolvedValue(
      "keybind = ctrl+shift+q = terminal.copy_to_clipboard\n" +
      "keybind = ctrl+shift+q = terminal.paste_from_clipboard\n",
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    const binding = engine.listBindings().find((b) => b.chord === "ctrl+shift+q");
    expect(binding?.actionId).toBe("terminal.paste_from_clipboard");

    // Warning emitted for the overwrite
    const overwriteWarnings = warnSpy.mock.calls.filter((args) =>
      typeof args[0] === "string" && args[0].includes("ctrl+shift+q"),
    );
    expect(overwriteWarnings.length).toBeGreaterThan(0);
  });
});
