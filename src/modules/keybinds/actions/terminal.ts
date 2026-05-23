/**
 * actions/terminal.ts — Group A terminal action handlers.
 *
 * Implements all terminal.* action IDs declared in types.ts:
 *   copy_to_clipboard, paste_from_clipboard, scroll_{page_up,page_down,to_top,to_bottom},
 *   font_size_{inc,dec,reset}, clear_screen, reload_config (stub for PR2).
 *
 * Each handler signature: (event: KeyboardEvent, ctx: ActionContext) => void | Promise<void>
 * Design §3.3 (handler signature), §4.5 (bracketed paste always-wrap).
 * REQ-KB-041 through REQ-KB-051 (behaviors), REQ-KB-018, REQ-KB-021.
 */

import type { ActionHandler, ActionId, IDisposable } from "../types";
import type { KeybindsEngine } from "../engine";

// ---------------------------------------------------------------------------
// Font size constants
// ---------------------------------------------------------------------------

const FONT_MIN = 6;
const FONT_MAX = 36;
/** Must match xterm-setup.ts fontSize: 14 */
export const DEFAULT_FONT_SIZE = 14;

// ---------------------------------------------------------------------------
// Group A handlers
// ---------------------------------------------------------------------------

/**
 * Copy xterm selection to system clipboard.
 * REQ-KB-041: no-op if selection is empty.
 */
const copyToClipboard: ActionHandler = (_event, ctx) => {
  const sel = ctx.term.getSelection();
  if (!sel) return;
  navigator.clipboard.writeText(sel).catch((err) => {
    console.warn("[keybinds] clipboard write failed:", err);
  });
};

/**
 * Paste from system clipboard to PTY, wrapped in bracketed paste sequences.
 * REQ-KB-042: always wrap unconditionally (xterm.js v5 does not expose
 * bracketedPasteMode publicly; always-wrap is safe for modern shells).
 * Design §4.5: bracketed paste always-wrap decision.
 */
const pasteFromClipboard: ActionHandler = async (_event, ctx) => {
  const text = await navigator.clipboard.readText().catch(() => "");
  if (!text || ctx.sessionId == null) return;
  const wrapped = `\x1b[200~${text}\x1b[201~`;
  await ctx.ptyWrite(wrapped);
};

/**
 * Scroll viewport one page up.
 * REQ-KB-043: calls term.scrollPages(-1); does NOT write to PTY.
 */
const scrollPageUp: ActionHandler = (_event, ctx) => {
  ctx.term.scrollPages(-1);
};

/**
 * Scroll viewport one page down.
 * REQ-KB-044: calls term.scrollPages(1); does NOT write to PTY.
 */
const scrollPageDown: ActionHandler = (_event, ctx) => {
  ctx.term.scrollPages(1);
};

/**
 * Scroll viewport to top of scrollback buffer.
 * REQ-KB-045: calls term.scrollToTop(); does NOT write to PTY.
 */
const scrollToTop: ActionHandler = (_event, ctx) => {
  ctx.term.scrollToTop();
};

/**
 * Scroll viewport to bottom (current output).
 * REQ-KB-046: calls term.scrollToBottom(); does NOT write to PTY.
 */
const scrollToBottom: ActionHandler = (_event, ctx) => {
  ctx.term.scrollToBottom();
};

/**
 * Increase font size by 1, clamped at FONT_MAX (36). Then refit.
 * REQ-KB-047: fitAddon.fit() propagates SIGWINCH via term.onResize listener.
 */
const fontSizeInc: ActionHandler = (_event, ctx) => {
  const cur = ctx.term.options.fontSize ?? DEFAULT_FONT_SIZE;
  ctx.term.options.fontSize = Math.min(cur + 1, FONT_MAX);
  ctx.fit.fit();
};

/**
 * Decrease font size by 1, floored at FONT_MIN (6). Then refit.
 * REQ-KB-048: minimum is 6; fitAddon.fit() propagates SIGWINCH.
 */
const fontSizeDec: ActionHandler = (_event, ctx) => {
  const cur = ctx.term.options.fontSize ?? DEFAULT_FONT_SIZE;
  ctx.term.options.fontSize = Math.max(cur - 1, FONT_MIN);
  ctx.fit.fit();
};

/**
 * Reset font size to DEFAULT_FONT_SIZE (14). Then refit.
 * REQ-KB-049: restores to compile-time default; fitAddon.fit() propagates SIGWINCH.
 */
const fontSizeReset: ActionHandler = (_event, ctx) => {
  ctx.term.options.fontSize = DEFAULT_FONT_SIZE;
  ctx.fit.fit();
};

/**
 * Clear the terminal viewport.
 * REQ-KB-050: calls term.clear() only — does NOT send bytes to PTY.
 */
const clearScreen: ActionHandler = (_event, ctx) => {
  ctx.term.clear();
};

/**
 * Reload keybind config. Stub for PR2 — real implementation lands in PR3
 * with the config-loader and Tauri keybinds_reload command.
 * REQ-KB-051: behavior fully specified by REQ-KB-036..040 (PR3 scope).
 */
const reloadConfig: ActionHandler = () => {
  // PR2 stub: real implementation in PR3 (config-loader epic).
  console.log("[keybinds] reload_config — not yet implemented (PR3)");
  return Promise.resolve();
};

// ---------------------------------------------------------------------------
// Handler map (actionId → handler)
// ---------------------------------------------------------------------------

const TERMINAL_HANDLERS: Array<[ActionId, ActionHandler]> = [
  ["terminal.copy_to_clipboard", copyToClipboard],
  ["terminal.paste_from_clipboard", pasteFromClipboard],
  ["terminal.scroll_page_up", scrollPageUp],
  ["terminal.scroll_page_down", scrollPageDown],
  ["terminal.scroll_to_top", scrollToTop],
  ["terminal.scroll_to_bottom", scrollToBottom],
  ["terminal.font_size_inc", fontSizeInc],
  ["terminal.font_size_dec", fontSizeDec],
  ["terminal.font_size_reset", fontSizeReset],
  ["terminal.clear_screen", clearScreen],
  ["terminal.reload_config", reloadConfig],
];

// ---------------------------------------------------------------------------
// Registration helper
// ---------------------------------------------------------------------------

/**
 * Register all Group A terminal action handlers with the engine.
 * Returns a composite IDisposable that unregisters all handlers on dispose.
 *
 * Called from TerminalPane useEffect after engine.attachToTerminal.
 * Design §2.1: registerTerminalActions runs BEFORE engine.attach so Group A
 * handlers exist before the first keypress. (Current TerminalPane wiring
 * already calls attachToTerminal in the same useEffect — handlers registered
 * here will be live on the next keypress regardless of ordering.)
 */
export function registerTerminalActions(engine: KeybindsEngine): IDisposable {
  const disposables = TERMINAL_HANDLERS.map(([id, handler]) =>
    engine.registerAction(id, handler),
  );

  return {
    dispose() {
      for (const d of disposables) {
        d.dispose();
      }
    },
  };
}
