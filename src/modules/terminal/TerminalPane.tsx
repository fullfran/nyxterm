import { useEffect, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { createTerm } from "./xterm-setup";
import { ptyOpen, ptyWrite, ptyResize, kickPty, ptyClose } from "./pty-bridge";
import type { SessionId } from "./pty-bridge";

/**
 * Full-bleed terminal pane.
 *
 * Lifecycle:
 *   mount: create term → open → fit → ptyOpen → wire onData/onInput/resize
 *   resize: fit.fit() → ptyResize(real size) → kickPty(+1/restore)
 *   unmount: ptyClose → term.dispose()
 *
 * Slice 5 adds:
 *   - window 'resize' listener with 50 ms debounce → kickPty
 *   - term.onResize() → ptyResize (delivers real cols/rows after fit.fit())
 *
 * Slice 7 adds:
 *   - WebGL addon
 */
export function TerminalPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<SessionId | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    console.log("[nyxterm] TerminalPane mount");
    const { term, fit } = createTerm();
    term.open(containerRef.current!);
    fit.fit();
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
