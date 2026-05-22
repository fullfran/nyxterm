import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";

/**
 * Create a configured xterm.js Terminal with the FitAddon loaded.
 *
 * Instantiation order (must be preserved):
 *   createTerm() → term.open(container) → fit.fit() → attachWebgl(term)
 *
 * WebGL must be loaded *after* term.open() because it needs the DOM canvas
 * element. Loading before open() throws "Cannot read properties of null"
 * (canvas is not yet attached to the DOM). See design §4.3.
 *
 * Theme: stub (monospace + size 14 + xterm defaults). Tokyo Night lands in
 * the theming epic. No hardcoded colors here per theming skill.
 */
export function createTerm(): { term: Terminal; fit: FitAddon } {
  const term = new Terminal({
    cursorBlink: true,
    fontFamily: "monospace",
    fontSize: 14,
    scrollback: 5000,
    allowProposedApi: true, // required for WebglAddon in v5+
  });

  const fit = new FitAddon();
  term.loadAddon(fit);

  return { term, fit };
}

/**
 * Attach the WebGL renderer to an already-opened Terminal.
 *
 * Must be called AFTER term.open(container) and fit.fit() so the canvas
 * element exists in the DOM. WebGL moves glyph rendering from CPU canvas
 * compositing to the GPU — eliminates the Wayland sluggishness observed
 * when compositing mode is disabled (see nyxterm/dev-environment memory).
 *
 * Context-loss handling (design §4.3 + §4.5):
 *   GPU contexts can be lost on GPU driver restart, tab backgrounding on
 *   some Wayland compositors, or sleep/wake cycles. When loss fires we
 *   dispose the stale addon and re-attach a fresh one after 250 ms.
 *   250 ms is empirical: shorter (e.g. 50 ms) re-attaches before the
 *   context is fully recovered and silently falls back to canvas; longer
 *   leaves a blank terminal visible to the user.
 *
 * Graceful degradation:
 *   If WebGL initialization fails (no GPU acceleration, software-only
 *   environments such as the x11 dev script with LIBGL_ALWAYS_SOFTWARE=1),
 *   xterm.js silently falls back to its canvas renderer. We catch and log
 *   the error so the failure is visible in devtools without crashing.
 *
 * @returns The loaded WebglAddon instance, or null on initialization failure.
 */
export function attachWebgl(term: Terminal): WebglAddon | null {
  try {
    const webgl = new WebglAddon();
    webgl.onContextLoss(() => {
      console.warn("[nyxterm] WebGL context lost — re-attaching in 250 ms");
      webgl.dispose();
      setTimeout(() => {
        attachWebgl(term);
      }, 250);
    });
    term.loadAddon(webgl);
    console.debug("[nyxterm] loaded WebglAddon");
    return webgl;
  } catch (e) {
    // WebGL unavailable (software renderer, headless, old GPU driver).
    // xterm.js falls back to canvas automatically; no user action needed.
    console.warn("[nyxterm] WebglAddon initialization failed, using canvas renderer:", e);
    return null;
  }
}
