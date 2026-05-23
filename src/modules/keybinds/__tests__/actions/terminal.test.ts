/**
 * terminal.test.ts — Unit tests for Group A terminal action handlers.
 *
 * Tests are isolated from the engine; handlers are invoked directly with
 * a mocked ActionContext. All external I/O (clipboard, ptyWrite) is mocked.
 *
 * T2.1 acceptance criteria:
 *  - paste wraps in bracketed paste escape sequences
 *  - font_size_dec floors at FONT_MIN (6)
 *  - font_size_inc clamps at FONT_MAX (36)
 *  - copy is no-op when selection is empty
 *  - scroll calls do NOT invoke ptyWrite
 *  - font ops call fitAddon.fit()
 *
 * T3.4 acceptance criteria (reload_config real implementation):
 *  - invokes Tauri config_reload command
 *  - swallows config_reload errors gracefully
 *
 * REQ-KB-041..051 (Group A behaviors), REQ-KB-037.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock @tauri-apps/api/core for reload_config tests
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));
import {
  registerTerminalActions,
  DEFAULT_FONT_SIZE,
} from "../../actions/terminal";
import type { ActionContext } from "../../types";

// ---------------------------------------------------------------------------
// Mock context builder
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type
function makeCtx(overrides: {
  fontSize?: number;
  selection?: string;
  sessionId?: number | null;
} = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const ptyWrite = vi.fn() as any;
  ptyWrite.mockResolvedValue(undefined);

  const fitFit = vi.fn();

  let fontSize = overrides.fontSize ?? DEFAULT_FONT_SIZE;

  const term = {
    getSelection: vi.fn(() => overrides.selection ?? ""),
    scrollPages: vi.fn(),
    scrollToTop: vi.fn(),
    scrollToBottom: vi.fn(),
    clear: vi.fn(),
    options: {
      get fontSize() { return fontSize; },
      set fontSize(v: number) { fontSize = v; },
    },
  };

  const fit = { fit: fitFit };

  const ctx: ActionContext = {
    term: term as unknown as ActionContext["term"],
    fit: fit as unknown as ActionContext["fit"],
    ptyWrite,
    sessionId: overrides.sessionId !== undefined ? overrides.sessionId : 1,
  };

  return { ctx, ptyWrite, fitFit, term };
}

function fakeEvent(): KeyboardEvent {
  return {} as KeyboardEvent;
}

// ---------------------------------------------------------------------------
// Clipboard setup / teardown
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clipboardWriteSpy: ReturnType<typeof vi.fn<any>>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let clipboardReadSpy: ReturnType<typeof vi.fn<any>>;

beforeEach(() => {
  // Provide a minimal navigator.clipboard stub in jsdom
  const writeFn = vi.fn().mockResolvedValue(undefined);
  const readFn = vi.fn().mockResolvedValue("");
  Object.defineProperty(navigator, "clipboard", {
    value: {
      writeText: writeFn,
      readText: readFn,
    },
    writable: true,
    configurable: true,
  });
  clipboardWriteSpy = writeFn;
  clipboardReadSpy = readFn;
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Handler map builder — collects registerAction calls from registerTerminalActions
// ---------------------------------------------------------------------------

function buildHandlerMap(): Map<string, (event: KeyboardEvent, ctx: ActionContext) => void | Promise<void>> {
  const map = new Map<string, (event: KeyboardEvent, ctx: ActionContext) => void | Promise<void>>();
  const fakeEngine = {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerAction: (id: string, handler: any) => {
      map.set(id, handler);
      return { dispose: vi.fn() };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  registerTerminalActions(fakeEngine as any);
  return map;
}

// ---------------------------------------------------------------------------
// Tests — copy_to_clipboard (REQ-KB-041)
// ---------------------------------------------------------------------------

describe("terminal.copy_to_clipboard", () => {
  it("writes selection to clipboard when selection is non-empty", async () => {
    const handlers = buildHandlerMap();
    const { ctx } = makeCtx({ selection: "hello world" });
    await handlers.get("terminal.copy_to_clipboard")!(fakeEvent(), ctx);
    expect(clipboardWriteSpy).toHaveBeenCalledWith("hello world");
  });

  it("does NOT write to clipboard when selection is empty (no-op)", async () => {
    const handlers = buildHandlerMap();
    const { ctx } = makeCtx({ selection: "" });
    await handlers.get("terminal.copy_to_clipboard")!(fakeEvent(), ctx);
    expect(clipboardWriteSpy).not.toHaveBeenCalled();
  });

  it("does NOT call ptyWrite (copy is clipboard-only)", async () => {
    const handlers = buildHandlerMap();
    const { ctx, ptyWrite } = makeCtx({ selection: "text" });
    await handlers.get("terminal.copy_to_clipboard")!(fakeEvent(), ctx);
    expect(ptyWrite).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — paste_from_clipboard (REQ-KB-042)
// ---------------------------------------------------------------------------

describe("terminal.paste_from_clipboard", () => {
  it("wraps clipboard text in bracketed paste sequences", async () => {
    clipboardReadSpy.mockResolvedValue("hello\nworld");
    const handlers = buildHandlerMap();
    const { ctx, ptyWrite } = makeCtx({ sessionId: 1 });
    await handlers.get("terminal.paste_from_clipboard")!(fakeEvent(), ctx);
    expect(ptyWrite).toHaveBeenCalledWith("\x1b[200~hello\nworld\x1b[201~");
  });

  it("does NOT write to PTY when sessionId is null", async () => {
    clipboardReadSpy.mockResolvedValue("hello");
    const handlers = buildHandlerMap();
    const { ctx, ptyWrite } = makeCtx({ sessionId: null });
    await handlers.get("terminal.paste_from_clipboard")!(fakeEvent(), ctx);
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("does NOT write to PTY when clipboard text is empty", async () => {
    clipboardReadSpy.mockResolvedValue("");
    const handlers = buildHandlerMap();
    const { ctx, ptyWrite } = makeCtx({ sessionId: 1 });
    await handlers.get("terminal.paste_from_clipboard")!(fakeEvent(), ctx);
    expect(ptyWrite).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — scroll actions (REQ-KB-043..046)
// ---------------------------------------------------------------------------

describe("scroll actions", () => {
  it("scroll_page_up calls term.scrollPages(-1) and NOT ptyWrite", async () => {
    const handlers = buildHandlerMap();
    const { ctx, ptyWrite, term } = makeCtx();
    await handlers.get("terminal.scroll_page_up")!(fakeEvent(), ctx);
    expect(term.scrollPages).toHaveBeenCalledWith(-1);
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("scroll_page_down calls term.scrollPages(1) and NOT ptyWrite", async () => {
    const handlers = buildHandlerMap();
    const { ctx, ptyWrite, term } = makeCtx();
    await handlers.get("terminal.scroll_page_down")!(fakeEvent(), ctx);
    expect(term.scrollPages).toHaveBeenCalledWith(1);
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("scroll_to_top calls term.scrollToTop() and NOT ptyWrite", async () => {
    const handlers = buildHandlerMap();
    const { ctx, ptyWrite, term } = makeCtx();
    await handlers.get("terminal.scroll_to_top")!(fakeEvent(), ctx);
    expect(term.scrollToTop).toHaveBeenCalledOnce();
    expect(ptyWrite).not.toHaveBeenCalled();
  });

  it("scroll_to_bottom calls term.scrollToBottom() and NOT ptyWrite", async () => {
    const handlers = buildHandlerMap();
    const { ctx, ptyWrite, term } = makeCtx();
    await handlers.get("terminal.scroll_to_bottom")!(fakeEvent(), ctx);
    expect(term.scrollToBottom).toHaveBeenCalledOnce();
    expect(ptyWrite).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — font size actions (REQ-KB-047..049)
// ---------------------------------------------------------------------------

describe("font_size_inc", () => {
  it("increases fontSize by 1 and calls fit()", async () => {
    const handlers = buildHandlerMap();
    const { ctx, fitFit, term } = makeCtx({ fontSize: 14 });
    await handlers.get("terminal.font_size_inc")!(fakeEvent(), ctx);
    expect(term.options.fontSize).toBe(15);
    expect(fitFit).toHaveBeenCalledOnce();
  });

  it("clamps at FONT_MAX (36)", async () => {
    const handlers = buildHandlerMap();
    const { ctx, term } = makeCtx({ fontSize: 36 });
    await handlers.get("terminal.font_size_inc")!(fakeEvent(), ctx);
    expect(term.options.fontSize).toBe(36);
  });
});

describe("font_size_dec", () => {
  it("decreases fontSize by 1 and calls fit()", async () => {
    const handlers = buildHandlerMap();
    const { ctx, fitFit, term } = makeCtx({ fontSize: 14 });
    await handlers.get("terminal.font_size_dec")!(fakeEvent(), ctx);
    expect(term.options.fontSize).toBe(13);
    expect(fitFit).toHaveBeenCalledOnce();
  });

  it("floors at FONT_MIN (6) — does NOT go below 6", async () => {
    const handlers = buildHandlerMap();
    const { ctx, term } = makeCtx({ fontSize: 6 });
    await handlers.get("terminal.font_size_dec")!(fakeEvent(), ctx);
    expect(term.options.fontSize).toBe(6);
  });
});

describe("font_size_reset", () => {
  it("resets fontSize to DEFAULT_FONT_SIZE (14) and calls fit()", async () => {
    const handlers = buildHandlerMap();
    const { ctx, fitFit, term } = makeCtx({ fontSize: 24 });
    await handlers.get("terminal.font_size_reset")!(fakeEvent(), ctx);
    expect(term.options.fontSize).toBe(DEFAULT_FONT_SIZE);
    expect(fitFit).toHaveBeenCalledOnce();
  });
});

// ---------------------------------------------------------------------------
// Tests — clear_screen (REQ-KB-050)
// ---------------------------------------------------------------------------

describe("terminal.clear_screen", () => {
  it("calls term.clear() and NOT ptyWrite", async () => {
    const handlers = buildHandlerMap();
    const { ctx, ptyWrite, term } = makeCtx();
    await handlers.get("terminal.clear_screen")!(fakeEvent(), ctx);
    expect(term.clear).toHaveBeenCalledOnce();
    expect(ptyWrite).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Tests — registerTerminalActions composite IDisposable
// ---------------------------------------------------------------------------

describe("registerTerminalActions", () => {
  it("registers 11 action handlers (one per Group A action)", () => {
    const registered: string[] = [];
    const fakeEngine = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAction: (id: string, _handler: any) => {
        registered.push(id);
        return { dispose: vi.fn() };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerTerminalActions(fakeEngine as any);
    expect(registered).toHaveLength(11);
  });

  it("dispose() calls dispose on each registered handler", () => {
    const disposes: ReturnType<typeof vi.fn>[] = [];
    const fakeEngine = {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      registerAction: (_id: string, _handler: any) => {
        const d = vi.fn();
        disposes.push(d);
        return { dispose: d };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const compositeDisposable = registerTerminalActions(fakeEngine as any);
    compositeDisposable.dispose();
    for (const d of disposes) {
      expect(d).toHaveBeenCalledOnce();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — reload_config real implementation (T3.4, REQ-KB-051, REQ-KB-037)
// ---------------------------------------------------------------------------

describe("terminal.reload_config (T3.4)", () => {
  let invokeMock: ReturnType<typeof vi.fn>;

  beforeEach(async () => {
    const { invoke } = await import("@tauri-apps/api/core");
    invokeMock = invoke as ReturnType<typeof vi.fn>;
    invokeMock.mockReset();
  });

  it("invokes Tauri config_reload command", async () => {
    invokeMock.mockResolvedValue("");
    const handlers = buildHandlerMap();
    await handlers.get("terminal.reload_config")!(fakeEvent(), makeCtx().ctx);
    expect(invokeMock).toHaveBeenCalledWith("config_reload");
  });

  it("does NOT throw when config_reload returns an error (graceful failure)", async () => {
    invokeMock.mockRejectedValue(new Error("config_reload failed"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const handlers = buildHandlerMap();
    // Must NOT throw
    await expect(
      handlers.get("terminal.reload_config")!(fakeEvent(), makeCtx().ctx),
    ).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("config_reload failed"),
      expect.any(Error),
    );
  });
});
