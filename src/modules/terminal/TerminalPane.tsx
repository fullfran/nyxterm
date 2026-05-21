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
 * Slice 1 omissions (added in later slices):
 *   - Resize listener / kickPty (slice 5)
 *   - onExit handler (slice 2)
 *   - WebGL addon (slice 7)
 */
export function TerminalPane() {
  const containerRef = useRef<HTMLDivElement>(null);
  const sessionIdRef = useRef<SessionId | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    const { term, fit } = createTerm();
    term.open(containerRef.current!);
    fit.fit();
    termRef.current = term;
    fitRef.current = fit;

    let disposed = false;

    void (async () => {
      const id = await ptyOpen(term.cols, term.rows, null, {
        onData: (bytes) => term.write(bytes),
        onExit: (code) => term.writeln(`\r\n[exit ${code}]`),
      });

      if (disposed) {
        await ptyClose(id);
        return;
      }

      sessionIdRef.current = id;
      term.onData((data) => {
        void ptyWrite(id, data);
      });
    })();

    return () => {
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
