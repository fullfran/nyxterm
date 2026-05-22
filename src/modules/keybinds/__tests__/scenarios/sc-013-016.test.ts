/**
 * sc-013-016.test.ts — Acceptance scenarios SC-013 through SC-016.
 *
 * SC-013: Copy (chord matched, navigator.clipboard.writeText called with selection)
 * SC-014: Paste bracketed (chord matched, ptyWrite called with \x1b[200~...\x1b[201~)
 * SC-015: Font size triggers SIGWINCH (fitAddon.fit() called after fontSize change)
 * SC-016: Malformed config tolerance (mixed valid + malformed, valid applied)
 *
 * Spec §9, design §5, tasks T4.3.
 * REQ-KB-041 (copy), REQ-KB-042 (paste bracketed), REQ-KB-047 (font SIGWINCH),
 * REQ-KB-012 (malformed lines → warning, valid lines applied).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createKeybindsEngine } from "../../engine";
import { registerTerminalActions } from "../../actions/terminal";
import type { ActionContext } from "../../types";

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
}): KeyboardEvent {
  return {
    key: overrides.key,
    keyCode: 0,
    ctrlKey: overrides.ctrlKey ?? false,
    shiftKey: overrides.shiftKey ?? false,
    altKey: overrides.altKey ?? false,
    metaKey: overrides.metaKey ?? false,
    isComposing: overrides.isComposing ?? false,
    preventDefault: vi.fn(),
  } as unknown as KeyboardEvent;
}

function makeMockTerminal(overrides?: {
  getSelection?: () => string;
  hasSelection?: () => boolean;
  fontSize?: number;
}) {
  let currentHandler: ((ev: KeyboardEvent) => boolean) | null = null;
  const terminal = {
    attachCustomKeyEventHandler: vi.fn((h: (ev: KeyboardEvent) => boolean) => {
      currentHandler = h;
    }),
    dispose: vi.fn(),
    getSelection: vi.fn().mockReturnValue(overrides?.getSelection?.() ?? ""),
    hasSelection: vi.fn().mockReturnValue(overrides?.hasSelection?.() ?? false),
    scrollPages: vi.fn(),
    scrollToTop: vi.fn(),
    scrollToBottom: vi.fn(),
    clear: vi.fn(),
    options: { fontSize: overrides?.fontSize ?? 14 },
    fireKey: (ev: KeyboardEvent): boolean => {
      if (!currentHandler) throw new Error("No handler attached");
      return currentHandler(ev);
    },
  };
  return terminal;
}

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// SC-013: Copy action copies xterm selection
// ---------------------------------------------------------------------------

describe("SC-013: Copy action copies xterm selection", () => {
  it("writeText called with selected text when ctrl+shift+c pressed", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      writable: true,
      configurable: true,
    });

    const ptyWrite = vi.fn().mockResolvedValue(undefined);
    const term = makeMockTerminal({ getSelection: () => "selected text" });
    (term.getSelection as ReturnType<typeof vi.fn>).mockReturnValue("selected text");

    const fitAddon = { fit: vi.fn() };
    const ctx: ActionContext = {
      term: term as never,
      fit: fitAddon as never,
      ptyWrite,
      sessionId: 1,
    };

    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();
    registerTerminalActions(engine);

    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "C", ctrlKey: true, shiftKey: true });
    const result = term.fireKey(ev);

    // Allow microtasks to flush (clipboard write is async)
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("selected text");
    });

    // Handler returns false (key consumed)
    expect(result).toBe(false);
  });

  it("writeText NOT called when selection is empty (no-op per REQ-KB-041)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { writeText } },
      writable: true,
      configurable: true,
    });

    const term = makeMockTerminal({ getSelection: () => "" });
    (term.getSelection as ReturnType<typeof vi.fn>).mockReturnValue("");

    const ctx: ActionContext = {
      term: term as never,
      fit: { fit: vi.fn() } as never,
      ptyWrite: vi.fn().mockResolvedValue(undefined),
      sessionId: 1,
    };

    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();
    registerTerminalActions(engine);

    engine.attachToTerminal(term as never);

    term.fireKey(makeEvent({ key: "C", ctrlKey: true, shiftKey: true }));

    // Wait briefly for async handlers
    await new Promise((r) => setTimeout(r, 10));

    expect(writeText).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// SC-014: Paste action wraps in bracketed paste
// ---------------------------------------------------------------------------

describe("SC-014: Paste action wraps in bracketed paste sequences", () => {
  it("ptyWrite called with \\x1b[200~...\\x1b[201~ wrapper", async () => {
    const readText = vi.fn().mockResolvedValue("hello\nworld");
    Object.defineProperty(globalThis, "navigator", {
      value: { clipboard: { readText } },
      writable: true,
      configurable: true,
    });

    const ptyWrite = vi.fn().mockResolvedValue(undefined);
    const term = makeMockTerminal();
    const ctx: ActionContext = {
      term: term as never,
      fit: { fit: vi.fn() } as never,
      ptyWrite,
      sessionId: 1,
    };

    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();
    registerTerminalActions(engine);

    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "V", ctrlKey: true, shiftKey: true });
    const result = term.fireKey(ev);
    expect(result).toBe(false);

    await vi.waitFor(() => {
      expect(ptyWrite).toHaveBeenCalledWith("\x1b[200~hello\nworld\x1b[201~");
    });
  });
});

// ---------------------------------------------------------------------------
// SC-015: Font size inc triggers fitAddon.fit() (SIGWINCH path)
// ---------------------------------------------------------------------------

describe("SC-015: Font size inc triggers fitAddon.fit() (SIGWINCH)", () => {
  it("ctrl+plus increases fontSize by 1 and calls fit()", async () => {
    const fitFn = vi.fn();
    const term = makeMockTerminal({ fontSize: 14 });
    const ctx: ActionContext = {
      term: term as never,
      fit: { fit: fitFn } as never,
      ptyWrite: vi.fn().mockResolvedValue(undefined),
      sessionId: 1,
    };

    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();
    registerTerminalActions(engine);

    engine.attachToTerminal(term as never);

    // ctrl+plus (key "+" with shift implicit in the "+" key event on US layout)
    const ev = makeEvent({ key: "+", ctrlKey: true, shiftKey: true });
    const result = term.fireKey(ev);

    await vi.waitFor(() => {
      expect(fitFn).toHaveBeenCalled();
    });

    expect(result).toBe(false);
    expect(term.options.fontSize).toBe(15);
  });

  it("ctrl+minus decreases fontSize by 1 and calls fit()", async () => {
    const fitFn = vi.fn();
    const term = makeMockTerminal({ fontSize: 14 });
    const ctx: ActionContext = {
      term: term as never,
      fit: { fit: fitFn } as never,
      ptyWrite: vi.fn().mockResolvedValue(undefined),
      sessionId: 1,
    };

    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();
    registerTerminalActions(engine);

    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "-", ctrlKey: true });
    const result = term.fireKey(ev);

    await vi.waitFor(() => {
      expect(fitFn).toHaveBeenCalled();
    });

    expect(result).toBe(false);
    expect(term.options.fontSize).toBe(13);
  });

  it("ctrl+0 resets fontSize to 14 (BASE_FONT_SIZE) and calls fit()", async () => {
    const fitFn = vi.fn();
    const term = makeMockTerminal({ fontSize: 20 });
    const ctx: ActionContext = {
      term: term as never,
      fit: { fit: fitFn } as never,
      ptyWrite: vi.fn().mockResolvedValue(undefined),
      sessionId: 1,
    };

    const engine = createKeybindsEngine({ getActionContext: () => ctx });
    engine.loadDefaults();
    registerTerminalActions(engine);

    engine.attachToTerminal(term as never);

    const ev = makeEvent({ key: "0", ctrlKey: true });
    const result = term.fireKey(ev);

    await vi.waitFor(() => {
      expect(fitFn).toHaveBeenCalled();
    });

    expect(result).toBe(false);
    expect(term.options.fontSize).toBe(14);
  });
});

// ---------------------------------------------------------------------------
// SC-016: Malformed config tolerance
// ---------------------------------------------------------------------------

describe("SC-016: Malformed config tolerance", () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    invokeMock = invoke as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
  });

  it("valid binding applied even when same file contains malformed lines", async () => {
    invokeMock.mockResolvedValue(
      "this is garbage\n" +
      "keybind = ctrl+shift+q = terminal.copy_to_clipboard\n" +
      "also garbage without keybind keyword\n",
    );
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    // Malformed lines warned about
    expect(warnSpy).toHaveBeenCalled();

    // Valid binding registered
    const binding = engine.listBindings().find((b) => b.chord === "ctrl+shift+q");
    expect(binding?.actionId).toBe("terminal.copy_to_clipboard");
  });

  it("engine completes initialization normally with malformed + valid config", async () => {
    invokeMock.mockResolvedValue(
      "not_a_keybind_line\n" +
      "keybind = ctrl+shift+q = terminal.clear_screen\n",
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const engine = createKeybindsEngine();
    engine.loadDefaults();
    await engine.loadConfig();

    // Engine still lists 29 defaults + 1 override = 30 total
    expect(engine.listBindings().length).toBeGreaterThanOrEqual(29);
    // The valid binding is present
    const binding = engine.listBindings().find((b) => b.chord === "ctrl+shift+q");
    expect(binding).toBeDefined();
  });
});
