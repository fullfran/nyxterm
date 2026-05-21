import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";

/**
 * Create a configured xterm.js Terminal with the FitAddon loaded.
 *
 * Slice 1: fit addon only. WebGL and WebLinks addons arrive in PR Slice 7.
 * Theme: stub (monospace + size 14 + xterm defaults). Tokyo Night arrives
 * in the theming epic.
 *
 * Instantiation order (must be preserved):
 *   createTerm() → term.open(container) → fit.fit() → [attachWebgl in Slice 7]
 */
export function createTerm(): { term: Terminal; fit: FitAddon } {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: "monospace",
    fontSize: 14,
    scrollback: 5000,
    allowProposedApi: true, // required for WebglAddon in v6
  });

  const fit = new FitAddon();
  term.loadAddon(fit);

  return { term, fit };
}
