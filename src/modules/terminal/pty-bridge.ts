import { Channel, invoke } from "@tauri-apps/api/core";

export type SessionId = number;

export interface PtyHandlers {
  onData: (bytes: Uint8Array) => void;
  onExit: (code: number) => void;
}

/**
 * Open a new PTY session running $SHELL.
 *
 * The `on_data` Channel delivers raw ArrayBuffer frames (no base64).
 * See REQ-PTY-012.
 */
export async function ptyOpen(
  cols: number,
  rows: number,
  cwd: string | null,
  handlers: PtyHandlers,
): Promise<SessionId> {
  const onData = new Channel<ArrayBuffer>();
  onData.onmessage = (buf) => handlers.onData(new Uint8Array(buf));

  const onExit = new Channel<number>();
  onExit.onmessage = (code) => handlers.onExit(code);

  const id = await invoke<number>("pty_open", {
    cols,
    rows,
    cwd,
    onData,
    onExit,
  });
  return id;
}

/** Write bytes (keystrokes, signal chars) to an active PTY session. */
export async function ptyWrite(id: SessionId, data: string): Promise<void> {
  await invoke<void>("pty_write", { sessionId: id, data });
}

/** Close an active PTY session and release all resources. */
export async function ptyClose(id: SessionId): Promise<void> {
  await invoke<void>("pty_close", { sessionId: id });
}
