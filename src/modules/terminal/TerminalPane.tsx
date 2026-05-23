import { useEffect, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { createTerm, attachWebgl } from "./xterm-setup";
import { ptyOpen, ptyWrite, ptyResize, kickPty, ptyClose } from "./pty-bridge";
import type { SessionId } from "./pty-bridge";
import { createKeybindsEngine } from "../keybinds";

/**
 * Full-bleed terminal pane.
 *
 * Lifecycle:
 *   mount: create term → open → attachKeybinds → fit → attachWebgl → ptyOpen
 *   resize: fit.fit() → ptyResize(real size) → kickPty(+1/restore)
 *   unmount: keybinds.detach → ptyClose → term.dispose()
 *
 * Slice 5 adds:
 *   - window 'resize' listener with 50 ms debounce → kickPty
 *   - term.onResize() → ptyResize (delivers real cols/rows after fit.fit())
 *
 * Slice 7 adds:
 *   - WebGL addon via attachWebgl() — GPU rendering, 250 ms context-loss re-attach
 *
 * Epic #26 (keybinds PR1) adds:
 *   - createKeybindsEngine + loadDefaults after term.open(), before fit.fit()
 *   - detach before term.dispose() on unmount (design §4.2)
 */
export function TerminalPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<SessionId | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    console.log("[nyxterm] TerminalPane mount");
    const { term, fit } = createTerm();
    // open() must come before attachWebgl() — WebGL requires the canvas in the DOM.
    term.open(containerRef.current!);

    // Attach keybinds engine AFTER open(), BEFORE fit.fit() (design §4.2).
    // Epic #26 PR1: skeleton — matched chords log + consume; real handlers in PR2.
    const engine = createKeybindsEngine();
    engine.loadDefaults();
    engine.attachToTerminal(term);

    fit.fit();
    // Attach WebGL renderer after open+fit. Falls back to canvas silently on failure.
    // Addresses Wayland sluggishness (nyxterm/dev-environment). Design §4.3.
    attachWebgl(term);
    termRef.current = term;
    fitRef.current = fit;
    console.log("[nyxterm] xterm opened", { cols: term.cols, rows: term.rows });

    let disposed = false;

    (async () => {
      try {
        const id = await ptyOpen(term.cols, term.rows, null, {
          onData: (bytes) => term.write(bytes),
          onExit: (code) => {
            // Display exit code per REQ-PTY-002; REQ-PTY-012 (§4.1).
            term.write(`\r\n[exit ${code}]`);
            // Clean up the session map entry on the backend (REQ-PTY-002).
            // Guard against calling ptyClose twice if unmount also fires.
            const sid = sessionIdRef.current;
            if (sid != null) {
              sessionIdRef.current = null;
              void ptyClose(sid).catch((e) =>
                console.warn("[nyxterm] ptyClose on exit failed:", e),
              );
            }
          },
        });
        console.log("[nyxterm] pty_open returned id=", id);

        if (disposed) {
          await ptyClose(id);
          return;
        }

        sessionIdRef.current = id;
        term.onData((data) => {
          void ptyWrite(id, data).catch((e) =>
            console.error("[nyxterm] pty_write failed", e),
          );
        });
        // Forward xterm resize events (triggered by fit.fit()) to the backend.
        // This delivers the real dimensions after every FitAddon layout pass.
        // REQ-PTY-007 / design §4.1.
        term.onResize(({ cols, rows }) => {
          void ptyResize(id, cols, rows).catch((e) =>
            console.warn("[nyxterm] ptyResize failed", e),
          );
        });
      } catch (e) {
        console.error("[nyxterm] pty_open failed:", e);
        term.writeln(`\r\n\x1b[31m[nyxterm] pty_open failed: ${e}\x1b[0m`);
      }
    })();

    // Window resize handler: reflow xterm, forward new dimensions, then kickPty.
    // Debounced at 50 ms to avoid flooding pty_resize during continuous resize.
    // Design §4.1, §5: fit.fit() → ptyResize → kickPty ordering.
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const onWindowResize = () => {
      if (resizeTimer !== null) clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        const fit = fitRef.current;
        const term = termRef.current;
        const id = sessionIdRef.current;
        if (!fit || !term || id == null) return;
        fit.fit();
        // kickPty guarantees two SIGWINCH events even if dims are unchanged.
        // The +1/restore pattern satisfies REQ-PTY-007 Scenario 2.
        void kickPty(id, term.cols, term.rows).catch((e) =>
          console.warn("[nyxterm] kickPty failed", e),
        );
      }, 50);
    };
    window.addEventListener("resize", onWindowResize);

    return () => {
      console.log("[nyxterm] TerminalPane unmount");
      disposed = true;
      window.removeEventListener("resize", onWindowResize);
      if (resizeTimer !== null) {
        clearTimeout(resizeTimer);
        resizeTimer = null;
      }
      const id = sessionIdRef.current;
      if (id != null) {
        ptyClose(id).catch((e) =>
          console.warn("[nyxterm] ptyClose on unmount failed:", e),
        );
      }
      // Detach keybinds engine BEFORE term.dispose() (design §4.2, REQ-KB-005).
      engine.detach(term);
      term.dispose();
    };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", overflow: "hidden" }}
    />
  );
}
