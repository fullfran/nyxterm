import { useEffect, useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";

import { createTerm } from "./xterm-setup";
import { ptyOpen, ptyWrite, ptyClose } from "./pty-bridge";
import type { SessionId } from "./pty-bridge";

/**
 * Full-bleed terminal pane.
 *
 * Lifecycle:
 *   mount: create term → open → fit → ptyOpen → wire onData/onInput
 *   unmount: ptyClose → term.dispose()
 *
 * Slice 2 omissions (added in later slices):
 *   - Resize listener / kickPty (slice 5)
 *   - WebGL addon (slice 7)
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
      } catch (e) {
        console.error("[nyxterm] pty_open failed:", e);
        term.writeln(`\r\n\x1b[31m[nyxterm] pty_open failed: ${e}\x1b[0m`);
      }
    })();

    return () => {
      console.log("[nyxterm] TerminalPane unmount");
      disposed = true;
      const id = sessionIdRef.current;
      if (id != null) void ptyClose(id);
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
