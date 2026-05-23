/**
 * types.ts — Core type definitions for the keybinds engine.
 *
 * ActionId union enumerates ALL planned action IDs across the epic,
 * even though only Group A handlers are implemented in PR1. This gives
 * compile-time safety for defaults.ts and registerAction() calls.
 *
 * REQ-KB-007 (compile-time ActionId check), REQ-KB-018 (registerAction signature),
 * REQ-KB-052 (Group B/C IDs present in union), design §4.4.
 */

// ---------------------------------------------------------------------------
// Chord brand
// ---------------------------------------------------------------------------

/**
 * Branded string representing a normalized keyboard chord.
 * e.g. "ctrl+shift+c", "ctrl+plus", "ctrl+tab"
 *
 * The brand prevents accidental use of un-normalized strings as Chord values.
 * Create via normalizeKeyEvent() or cast `"..." as Chord` only in tests/defaults.
 */
export type Chord = string & { readonly __chord: unique symbol };

// ---------------------------------------------------------------------------
// ActionId union — all planned IDs for the epic (Groups A, B, C)
// ---------------------------------------------------------------------------

/** Group A — terminal: fully implemented in this epic */
export type TerminalActionId =
  | "terminal.copy_to_clipboard"
  | "terminal.paste_from_clipboard"
  | "terminal.scroll_page_up"
  | "terminal.scroll_page_down"
  | "terminal.scroll_to_top"
  | "terminal.scroll_to_bottom"
  | "terminal.font_size_inc"
  | "terminal.font_size_dec"
  | "terminal.font_size_reset"
  | "terminal.clear_screen"
  | "terminal.reload_config";

/** Group B — pane: stubs; implemented by epic #2 */
export type PaneActionId =
  | "pane.split_right"
  | "pane.split_down"
  | "pane.navigate_left"
  | "pane.navigate_down"
  | "pane.navigate_up"
  | "pane.navigate_right"
  | "pane.kill_pane"
  | "pane.zoom_pane";

/** Group C — tab: stubs; implemented by epic #2 */
export type TabActionId =
  | "tab.new_tab"
  | "tab.next_tab"
  | "tab.previous_tab"
  | "tab.kill_tab";

/** Group C — session: stubs; implemented by epic #2 */
export type SessionActionId =
  | "session.new_session"
  | "session.rename_session"
  | "session.switch_last_session"
  | "session.picker"
  | "session.kill_session"
  | "session.detach";

/** Group C — app: stubs; implemented by epics #12, #16 */
export type AppActionId =
  | "app.popup_git"
  | "app.popup_ai"
  | "app.copy_mode_enter";

/** Full ActionId union — 31 IDs total (Groups A + B + C) */
export type ActionId =
  | TerminalActionId
  | PaneActionId
  | TabActionId
  | SessionActionId
  | AppActionId;

// ---------------------------------------------------------------------------
// Binding
// ---------------------------------------------------------------------------

/**
 * A single association of a chord to an action.
 * `source` is used for diagnostics and the future settings UI (epic #6).
 */
export interface Binding {
  readonly chord: Chord;
  readonly actionId: ActionId;
  /** Origin of this binding — aids debug and settings UI */
  readonly source: "ghostty" | "tmux" | "nyxterm" | "default" | "override";
}

// ---------------------------------------------------------------------------
// Action context (passed to handlers at dispatch time)
// ---------------------------------------------------------------------------

/**
 * Runtime context passed to every action handler on invocation.
 * Injected by the engine's dispatch path; Group A handlers receive it to
 * access the terminal, fit addon, and PTY write function.
 *
 * Design §3.3: handler signature is (event, ctx) → void | Promise<void>.
 */
export interface ActionContext {
  /** xterm.js Terminal instance — for getSelection, scroll*, clear, fontSize */
  readonly term: import("@xterm/xterm").Terminal;
  /** FitAddon instance — must call fit() after fontSize changes (SIGWINCH) */
  readonly fit: import("@xterm/addon-fit").FitAddon;
  /**
   * Write data to the active PTY session.
   * Already bound to the current sessionId; callers pass the string only.
   */
  readonly ptyWrite: (data: string) => Promise<void>;
  /** Current PTY session ID; null if no session is active */
  readonly sessionId: import("../terminal/pty-bridge").SessionId | null;
}

// ---------------------------------------------------------------------------
// Action handler
// ---------------------------------------------------------------------------

/**
 * An action handler receives the triggering keyboard event and runtime context.
 * Design §3.3: fire-and-forget at the engine boundary (engine wraps in void Promise).
 */
export type ActionHandler = (
  event: KeyboardEvent,
  ctx: ActionContext,
) => void | Promise<void>;

/** IDisposable contract — returned by registerAction, removes handler on dispose */
export interface IDisposable {
  dispose(): void;
}

// ---------------------------------------------------------------------------
// Engine state
// ---------------------------------------------------------------------------

/** Snapshot of the active binding map returned by listBindings() */
export interface ActiveBinding {
  readonly chord: Chord;
  readonly actionId: ActionId;
  readonly source: "default" | "override";
}

/** Internal runtime state of the keybinds engine */
export interface KeybindsState {
  /** Active chord → actionId map (derived; never mutated from DEFAULT_BINDINGS) */
  readonly activeMap: Map<string, ActionId>;
  /** Whether the engine has been attached to a terminal */
  attached: boolean;
}

// ---------------------------------------------------------------------------
// Dependencies injected into the engine
// ---------------------------------------------------------------------------

/**
 * Dependencies the engine needs at creation time.
 * Using an explicit deps struct makes the engine unit-testable without
 * importing React or Tauri directly.
 */
export interface EngineDeps {
  /** Optional: called when a keybind action is matched and no handler is found */
  onStub?: (actionId: ActionId) => void;
  /**
   * Returns the current ActionContext for the active terminal instance.
   * Called at dispatch time so context reflects live state (e.g., sessionId
   * may change after pty_open resolves). Required for Group A handler dispatch.
   */
  getActionContext?: () => ActionContext | null;
}
