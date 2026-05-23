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
 * PR3b scope: adds loadConfig() for boot sequence + hot reload via
 *   "keybinds-changed" Tauri event (REQ-KB-003, REQ-KB-037..040).
 *
 * Design §3.3 (handler dispatch), §4.2 (attach timing), §4.3 (default factory),
 * §4.4 (action ID namespace), §2 lifecycle (boot + hot reload).
 * REQ-KB-001..005, REQ-KB-008, REQ-KB-018, REQ-KB-020..022,
 * REQ-KB-036..040, REQ-KB-051.
 */

import type { Terminal } from "@xterm/xterm";
import { listen } from "@tauri-apps/api/event";
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
import { imeGuard, webkitHijackPrevent } from "./guards";
import { ActionRegistry } from "./registry";
import { parseConfigText } from "./config-loader";
import { resolveBindings } from "./resolver";
import { validateConfigEntries } from "./validation";
import { RESERVED_CHORDS } from "./reserved";

// ---------------------------------------------------------------------------
// Engine interface (public API)
// ---------------------------------------------------------------------------

export interface KeybindsEngine {
  /** Load default bindings into the active map. Called once at init. */
  loadDefaults(): void;

  /**
   * Read user config via Tauri config_read, parse, resolve overrides, and
   * atomically swap the active binding map.
   *
   * Boot sequence (REQ-KB-003 steps 2-5):
   *   1. Invoke Tauri config_read → raw text
   *   2. parseConfigText → ConfigEntry[]
   *   3. resolveBindings(DEFAULT_BINDINGS, entries) → active Binding[]
   *   4. Swap activeMap (synchronous per REQ-KB-040)
   *   5. Log any parse/resolve warnings to console.warn
   *
   * Called from TerminalPane useEffect after attachToTerminal.
   * Also called internally by the hot reload event listener.
   * REQ-KB-003, REQ-KB-040.
   */
  loadConfig(): Promise<void>;

  /**
   * Subscribe to the "keybinds-changed" Tauri event for hot reload.
   * Returns IDisposable that removes the Tauri listener.
   *
   * When the event fires (after config_reload command), the engine
   * re-parses the payload and atomically swaps the active map without
   * remounting the terminal (REQ-KB-038, REQ-KB-039, REQ-KB-040).
   *
   * Called from TerminalPane useEffect; disposed on unmount.
   * REQ-KB-037, REQ-KB-038, REQ-KB-039.
   */
  subscribeHotReload(): Promise<IDisposable>;

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
  // Active chord → Binding map (derived from defaults + user overrides).
  // Never mutates DEFAULT_BINDINGS. Atomically replaced on config reload.
  const activeMap = new Map<string, ActionId>();
  // Parallel map for source tracking (chord → "default" | "override")
  // so listBindings() can report provenance per REQ-KB-004.
  const sourceMap = new Map<string, ActiveBinding["source"]>();
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
      sourceMap.set(binding.chord, "default");
    }
  }

  // -------------------------------------------------------------------------
  // applyResolvedBindings — atomic swap helper (REQ-KB-040)
  // -------------------------------------------------------------------------

  function applyResolvedBindings(resolved: import("./types").Binding[]): void {
    // Synchronous swap — clear then repopulate both maps atomically.
    // The handler closure captures activeMap by reference, so the next
    // keypress after this function returns sees the updated map.
    // REQ-KB-040: no microtask or macrotask deferral.
    activeMap.clear();
    sourceMap.clear();
    for (const binding of resolved) {
      activeMap.set(binding.chord, binding.actionId);
      // Map resolver sources to ActiveBinding.source union.
      // resolver uses "override" for user overrides; defaults keep their tag.
      const src: ActiveBinding["source"] =
        binding.source === "override" ? "override" : "default";
      sourceMap.set(binding.chord, src);
    }
  }

  // -------------------------------------------------------------------------
  // loadConfig — T3.4 boot sequence (REQ-KB-003 steps 2-5)
  // -------------------------------------------------------------------------

  async function loadConfig(): Promise<void> {
    const { invoke } = await import("@tauri-apps/api/core");
    const text = await invoke<string>("config_read");
    const { entries, warnings: parseWarnings } = parseConfigText(text);
    // Validate: filter out reserved chords + unknown action_ids (REQ-KB-032..034)
    const { valid, rejected } = validateConfigEntries(entries);
    const { active, warnings: resolveWarnings } = resolveBindings(
      DEFAULT_BINDINGS,
      valid,
    );
    applyResolvedBindings(active);
    // Log parse warnings
    for (const w of parseWarnings) {
      console.warn(`[keybinds] config parse warning (line ${w.lineNumber}): ${w.reason}`);
    }
    // Log validation rejections (toast aggregation stub — PR5 scope)
    for (const r of rejected) {
      console.warn(`[keybinds] config validation rejected (line ${r.entry.lineNumber}): ${r.reason}`);
    }
    for (const w of resolveWarnings) {
      console.warn(`[keybinds] config resolve warning: ${w.reason}`);
    }
  }

  // -------------------------------------------------------------------------
  // subscribeHotReload — T3.4 hot reload via Tauri event (REQ-KB-037..040)
  // -------------------------------------------------------------------------

  async function subscribeHotReload(): Promise<IDisposable> {
    const unlisten = await listen<string>("keybinds-changed", (event) => {
      // Synchronous re-resolve on event (REQ-KB-040: no deferral).
      const { entries, warnings: pw } = parseConfigText(event.payload);
      // Validate between parse and resolve (REQ-KB-032..034)
      const { valid, rejected } = validateConfigEntries(entries);
      const { active, warnings: rw } = resolveBindings(DEFAULT_BINDINGS, valid);
      applyResolvedBindings(active);
      for (const w of pw) {
        console.warn(`[keybinds] hot-reload parse warning (line ${w.lineNumber}): ${w.reason}`);
      }
      for (const r of rejected) {
        console.warn(`[keybinds] hot-reload validation rejected (line ${r.entry.lineNumber}): ${r.reason}`);
      }
      for (const w of rw) {
        console.warn(`[keybinds] hot-reload resolve warning: ${w.reason}`);
      }
      // Emit document-level event so settings UI (epic #6) can react.
      // REQ-KB-038 step 5.
      document.dispatchEvent(new CustomEvent("keybinds-reloaded"));
    });

    return { dispose: () => void unlisten() };
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
      // Guard 1: IME composing — pass through to PTY untouched (REQ-KB-029)
      if (imeGuard(event)) return true;

      // Normalize the event to a chord (returns null for composing events,
      // already guarded above, but null can occur for other exotic keys)
      const chord: Chord | null = normalizeKeyEvent(event);
      if (chord === null) return true;

      // Guard 2: WebKit hijack — preventDefault even if no binding exists.
      // e.g. Ctrl+R: browser reload blocked, but chord falls through to PTY
      // for readline reverse-search if no binding is registered. (REQ-KB-030, REQ-KB-031)
      webkitHijackPrevent(event, chord);

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
    // REQ-KB-035: defense-in-depth — if any chord currently bound to this
    // action_id is a reserved chord, throw TypeError. This should never happen
    // after PR4 validation is in place, but catches programmatic misuse.
    for (const [chord, boundId] of activeMap) {
      if (boundId === id && RESERVED_CHORDS.has(chord)) {
        throw new TypeError(
          `registerAction: action "${id}" is bound to reserved chord "${chord}" — reserved chords MUST NOT be captured by the engine (REQ-KB-035)`,
        );
      }
    }
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
      results.push({
        chord: chord as Chord,
        actionId,
        source: sourceMap.get(chord) ?? "default",
      });
    }
    return results;
  }

  // -------------------------------------------------------------------------
  // Return engine
  // -------------------------------------------------------------------------

  return {
    loadDefaults,
    loadConfig,
    subscribeHotReload,
    attachToTerminal,
    detach,
    registerAction,
    listBindings,
    createCustomKeyHandler,
  };
}
