/**
 * engine.ts — Keybinds engine skeleton.
 *
 * createKeybindsEngine(deps?) returns an engine instance that:
 *  - Loads the 29-binding FullFran default factory
 *  - Attaches to a Terminal via term.attachCustomKeyEventHandler
 *  - Returns true (passthrough) for unmatched chords
 *  - Returns false (consume) and logs for matched chords (PR1 — no real handlers yet)
 *  - Detaches cleanly on unmount
 *
 * PR1 scope: skeleton only — no real action handlers.
 *   Matched chords → console.log("[keybinds] matched:", actionId) + return false
 *   Unmatched chords → return true (pass to PTY)
 * Real Group A handlers land in T2.1 (PR Slice 2).
 *
 * Design §4.2 (attach timing), §4.3 (default factory), §4.4 (action ID namespace).
 * REQ-KB-001, REQ-KB-002, REQ-KB-004, REQ-KB-005, REQ-KB-008.
 */

import type { Terminal } from "@xterm/xterm";
import type {
  ActionId,
  ActionHandler,
  ActiveBinding,
  Chord,
  EngineDeps,
  IDisposable,
} from "./types";
import { DEFAULT_BINDINGS } from "./defaults";
import { normalizeKeyEvent } from "./normalize";
import { ActionRegistry } from "./registry";

// ---------------------------------------------------------------------------
// Engine interface (public API)
// ---------------------------------------------------------------------------

export interface KeybindsEngine {
  /** Load default bindings into the active map. Called once at init. */
  loadDefaults(): void;

  /**
   * Attach the custom key event handler to the given Terminal.
   * Must be called AFTER term.open() and BEFORE fit.fit() (design §4.2).
   *
   * REQ-KB-002: attaching twice replaces (not duplicates) the handler.
   */
  attachToTerminal(term: Terminal): void;

  /**
   * Detach the custom key event handler and clean up instance handlers.
   * Must be called BEFORE term.dispose() on unmount.
   *
   * REQ-KB-005: dispose instance handlers; keep binding map (bindings
   * persist across remounts).
   */
  detach(term: Terminal): void;

  /**
   * Register a handler for an action ID.
   * Returns IDisposable that removes the handler when disposed.
   * REQ-KB-018, REQ-KB-021, REQ-KB-022.
   */
  registerAction(id: ActionId, handler: ActionHandler): IDisposable;

  /**
   * Return all currently active bindings.
   * Used by settings UI (epic #6) and snapshot tests.
   * REQ-KB-004.
   */
  listBindings(): ActiveBinding[];

  /** Internal: build the custom key handler function for xterm.js */
  createCustomKeyHandler(): (event: KeyboardEvent) => boolean;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Create a new keybinds engine instance.
 *
 * In PR1 this is a per-TerminalPane singleton (design §4.2 "singleton per
 * terminal"). Future PRs may promote it to app-wide.
 */
export function createKeybindsEngine(deps: EngineDeps = {}): KeybindsEngine {
  // Active chord → actionId map (derived from defaults; never mutates DEFAULT_BINDINGS)
  const activeMap = new Map<string, ActionId>();
  // Registry of action handlers
  const registry = new ActionRegistry();
  // Track per-instance handler disposables for cleanup on detach
  const instanceDisposables: IDisposable[] = [];

  // -------------------------------------------------------------------------
  // loadDefaults
  // -------------------------------------------------------------------------

  function loadDefaults(): void {
    for (const binding of DEFAULT_BINDINGS) {
      activeMap.set(binding.chord, binding.actionId);
    }
  }

  // -------------------------------------------------------------------------
  // createCustomKeyHandler
  // -------------------------------------------------------------------------

  function createCustomKeyHandler(): (event: KeyboardEvent) => boolean {
    return (event: KeyboardEvent): boolean => {
      // Normalize the event to a chord
      const chord: Chord | null = normalizeKeyEvent(event);

      // IME pass-through: return true so xterm.js forwards the event to PTY
      if (chord === null) return true;

      // Look up the chord in the active binding map
      const actionId = activeMap.get(chord);

      // No binding → fall through to PTY
      if (actionId === undefined) return true;

      // Matched chord → consume key (return false)
      // PR1: log only; real handlers land in T2.1
      const handler = registry.get(actionId);
      if (handler !== undefined) {
        // Real handler registered (future PR2+)
        void Promise.resolve(handler());
      } else {
        // Stub: log and consume — no PTY pass-through
        console.log("[keybinds] matched:", actionId);
        deps.onStub?.(actionId);
      }

      // Return false → key consumed, not forwarded to PTY
      return false;
    };
  }

  // -------------------------------------------------------------------------
  // attachToTerminal
  // -------------------------------------------------------------------------

  function attachToTerminal(term: Terminal): void {
    // REQ-KB-002: attaching replaces (not duplicates) the handler.
    // xterm.js attachCustomKeyEventHandler replaces any existing handler.
    term.attachCustomKeyEventHandler(createCustomKeyHandler());
  }

  // -------------------------------------------------------------------------
  // detach
  // -------------------------------------------------------------------------

  function detach(_term: Terminal): void {
    // REQ-KB-005: dispose instance handlers, NOT the binding map.
    // Handlers (Group A actions) are disposed so they don't leak.
    for (const d of instanceDisposables) {
      d.dispose();
    }
    instanceDisposables.length = 0;

    // We cannot fully "un-attach" an xterm.js custom key handler via
    // the public API in v5 — but we CAN replace it with a passthrough.
    // This ensures after unmount no keybind actions fire, even if the
    // Terminal object is briefly alive during cleanup.
    //
    // Note: term.dispose() will be called immediately after detach()
    // in TerminalPane cleanup, making this primarily a safety net.
    _term.attachCustomKeyEventHandler(() => true);
  }

  // -------------------------------------------------------------------------
  // registerAction
  // -------------------------------------------------------------------------

  function registerAction(id: ActionId, handler: ActionHandler): IDisposable {
    const disposable = registry.register(id, handler);
    instanceDisposables.push(disposable);
    return disposable;
  }

  // -------------------------------------------------------------------------
  // listBindings
  // -------------------------------------------------------------------------

  function listBindings(): ActiveBinding[] {
    const results: ActiveBinding[] = [];
    for (const [chord, actionId] of activeMap) {
      // In PR1 all bindings are defaults (override resolution comes in PR3)
      results.push({
        chord: chord as Chord,
        actionId,
        source: "default",
      });
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Return engine
  // -------------------------------------------------------------------------

  return {
    loadDefaults,
    attachToTerminal,
    detach,
    registerAction,
    listBindings,
    createCustomKeyHandler,
  };
}
