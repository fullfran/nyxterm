/**
 * index.ts — Public API for the keybinds module.
 *
 * Re-exports the engine factory, types, and constants needed by
 * consumers (TerminalPane, settings UI, future epics).
 *
 * Design §1.1 (index.ts — createKeybindsEngine + types re-export).
 */

export { createKeybindsEngine } from "./engine";
export type { KeybindsEngine } from "./engine";

export type {
  ActionId,
  TerminalActionId,
  PaneActionId,
  TabActionId,
  SessionActionId,
  AppActionId,
  Chord,
  Binding,
  ActionHandler,
  IDisposable,
  ActiveBinding,
  KeybindsState,
  EngineDeps,
  ActionContext,
} from "./types";

export { DEFAULT_BINDINGS } from "./defaults";
export { normalizeKeyEvent, normalizeChord } from "./normalize";
export { RESERVED_CHORDS, WEBKIT_HIJACK } from "./reserved";
export { ActionRegistry } from "./registry";
