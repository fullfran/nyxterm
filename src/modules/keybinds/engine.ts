/**
 * engine.ts — Keybinds engine.
 *
 * createKeybindsEngine(deps?) returns an engine instance that:
 *  - Loads the 29-binding FullFran default factory
 *  - Attaches to a Terminal via term.attachCustomKeyEventHandler
 *  - Returns true (passthrough) for unmatched chords
 *  - Returns false (consume) for matched chords; dispatches to registered handler
 *  - Detaches cleanly on unmount
 *
 * PR2 scope: adds Group A handler dispatch via deps.getActionContext().
 *   Matched chord with handler → handler(event, ctx) (fire-and-forget)
 *   Matched chord without handler → console.warn once + consume (REQ-KB-020)
 *   Unmatched chords → return true (pass to PTY)
 *
 * Design §3.3 (handler dispatch), §4.2 (attach timing), §4.3 (default factory),
 * §4.4 (action ID namespace).
 * REQ-KB-001, REQ-KB-002, REQ-KB-004, REQ-KB-005, REQ-KB-008, REQ-KB-018,
 * REQ-KB-020, REQ-KB-021, REQ-KB-022.
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
  // Warn-once set for matched-but-unhandled actions (REQ-KB-020)
  // -------------------------------------------------------------------------

  // Tracks action IDs that have already emitted a "no handler" warning this
  // session. Cleared on detach so that after a remount warnings re-fire once.
  const warnedNoHandler = new Set<ActionId>();

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
      const handler = registry.get(actionId);
      if (handler !== undefined) {
        // Real handler registered — dispatch fire-and-forget with context.
        // Design §3.3: pass (event, ctx) to the handler.
        const ctx = deps.getActionContext?.() ?? null;
        if (ctx !== null) {
          try {
            const result = handler(event, ctx);
            if (result && typeof (result as Promise<void>).then === "function") {
              (result as Promise<void>).catch((err) => {
                console.error(`[keybinds] action ${actionId} threw:`, err);
              });
            }
          } catch (err) {
            console.error(`[keybinds] action ${actionId} threw:`, err);
          }
        } else {
          // No context yet (e.g., PTY not open) — still consume the key.
          console.debug(`[keybinds] no action context for ${actionId} — key consumed`);
        }
      } else {
        // REQ-KB-020: matched chord with no registered handler.
        // Consume the key (return false) and warn once per action per session.
        if (!warnedNoHandler.has(actionId)) {
          warnedNoHandler.add(actionId);
          console.warn("[keybinds] no handler registered for", actionId);
        }
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
    // Clear warn-once set so warnings re-fire correctly on remount.
    warnedNoHandler.clear();

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
