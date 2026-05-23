/**
 * stubs.test.ts — Unit tests for Group B/C stub action handlers.
 *
 * Covers:
 *  - A stub handler emits console.warn exactly once per action per session
 *  - Pressing the same action again does NOT re-log (deduplication per REQ-KB-054)
 *  - registerStubs registers all 21 Group B/C action IDs
 *  - The stub handler does NOT call ptyWrite (key is consumed, not forwarded)
 *  - dispose() cleans up all registered handlers
 *
 * REQ-KB-052 (IDs in ActionId union — enforced by TypeScript at compile time).
 * REQ-KB-053 (stub handlers registered).
 * REQ-KB-054 (warning deduplicated per action_id per session).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { registerStubs } from "../../actions/stubs";
import type { ActionContext } from "../../types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeCtx(): ActionContext {
  return {
    term: {} as ActionContext["term"],
    fit: {} as ActionContext["fit"],
    ptyWrite: vi.fn().mockResolvedValue(undefined),
    sessionId: 1,
  };
}

function fakeEvent(): KeyboardEvent {
  return {} as KeyboardEvent;
}

/**
 * Build a handler map by collecting registrations from registerStubs.
 * Returns the map and the composite IDisposable.
 */
function buildStubMap() {
  const map = new Map<string, (event: KeyboardEvent, ctx: ActionContext) => void>();
  const fakeEngine = {
    registerAction: (id: string, handler: (event: KeyboardEvent, ctx: ActionContext) => void) => {
      map.set(id, handler);
      return { dispose: vi.fn() };
    },
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const disposable = registerStubs(fakeEngine as any);
  return { map, disposable };
}

// ---------------------------------------------------------------------------
// console.warn spy
// ---------------------------------------------------------------------------

let warnSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Tests — warning deduplication (REQ-KB-054)
// ---------------------------------------------------------------------------

describe("stub handler — warning deduplication", () => {
  it("emits console.warn on first invocation", () => {
    const { map } = buildStubMap();
    const handler = map.get("pane.split_right")!;
    handler(fakeEvent(), fakeCtx());
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("pane.split_right"),
    );
  });

  it("does NOT re-emit console.warn on subsequent invocations", () => {
    const { map } = buildStubMap();
    const handler = map.get("pane.split_right")!;
    handler(fakeEvent(), fakeCtx());
    handler(fakeEvent(), fakeCtx());
    handler(fakeEvent(), fakeCtx());
    // Should only have been called once (first press only)
    const callsForAction = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("pane.split_right"),
    );
    expect(callsForAction).toHaveLength(1);
  });

  it("emits separate warnings for different action IDs", () => {
    const { map } = buildStubMap();
    map.get("pane.split_right")!(fakeEvent(), fakeCtx());
    map.get("tab.new_tab")!(fakeEvent(), fakeCtx());
    const splitRightCalls = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("pane.split_right"),
    );
    const newTabCalls = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("tab.new_tab"),
    );
    expect(splitRightCalls).toHaveLength(1);
    expect(newTabCalls).toHaveLength(1);
  });

  it("different stub instances each have their own dedup set", () => {
    // Two separate registerStubs calls get independent warned sets
    const { map: map1 } = buildStubMap();
    const { map: map2 } = buildStubMap();

    // Both should warn on first call (separate instances = separate warned sets)
    map1.get("pane.split_right")!(fakeEvent(), fakeCtx());
    map1.get("pane.split_right")!(fakeEvent(), fakeCtx()); // suppressed in map1

    map2.get("pane.split_right")!(fakeEvent(), fakeCtx()); // separate instance → warns

    const calls = warnSpy.mock.calls.filter((args) =>
      String(args[0]).includes("pane.split_right"),
    );
    // map1 warns once, map2 warns once = 2 total
    expect(calls).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// Tests — registration completeness
// ---------------------------------------------------------------------------

describe("registerStubs — registration completeness", () => {
  it("registers all 21 Group B/C action IDs", () => {
    const registered: string[] = [];
    const fakeEngine = {
      registerAction: (id: string, _handler: unknown) => {
        registered.push(id);
        return { dispose: vi.fn() };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registerStubs(fakeEngine as any);
    expect(registered).toHaveLength(21);
  });

  it("includes all pane.* IDs", () => {
    const { map } = buildStubMap();
    const paneIds = [
      "pane.split_right",
      "pane.split_down",
      "pane.navigate_left",
      "pane.navigate_down",
      "pane.navigate_up",
      "pane.navigate_right",
      "pane.kill_pane",
      "pane.zoom_pane",
    ];
    for (const id of paneIds) {
      expect(map.has(id), `missing: ${id}`).toBe(true);
    }
  });

  it("includes all tab.* session.* app.* IDs", () => {
    const { map } = buildStubMap();
    const groupCIds = [
      "tab.new_tab",
      "tab.next_tab",
      "tab.previous_tab",
      "tab.kill_tab",
      "session.new_session",
      "session.rename_session",
      "session.switch_last_session",
      "session.picker",
      "session.kill_session",
      "session.detach",
      "app.popup_git",
      "app.popup_ai",
      "app.copy_mode_enter",
    ];
    for (const id of groupCIds) {
      expect(map.has(id), `missing: ${id}`).toBe(true);
    }
  });

  it("dispose() calls dispose on all registered handlers", () => {
    const disposes: ReturnType<typeof vi.fn>[] = [];
    const fakeEngine = {
      registerAction: (_id: string, _handler: unknown) => {
        const d = vi.fn();
        disposes.push(d);
        return { dispose: d };
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const composite = registerStubs(fakeEngine as any);
    composite.dispose();
    for (const d of disposes) {
      expect(d).toHaveBeenCalledOnce();
    }
  });
});

// ---------------------------------------------------------------------------
// Tests — stub does NOT write to PTY
// ---------------------------------------------------------------------------

describe("stub handler — no PTY write", () => {
  it("stub handler does not invoke ptyWrite", () => {
    const { map } = buildStubMap();
    const ctx = fakeCtx();
    map.get("pane.split_right")!(fakeEvent(), ctx);
    expect(ctx.ptyWrite).not.toHaveBeenCalled();
  });
});
