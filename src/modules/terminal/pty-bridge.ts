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

/**
 * Resize the PTY to the given dimensions.
 *
 * Issues `ioctl(TIOCSWINSZ)` on the backend (via `MasterPty::resize`),
 * which delivers SIGWINCH to the child's foreground process group.
 * REQ-PTY-007 / design §3 IPC, §5 resize handling.
 *
 * Call this after `fit.fit()` to deliver the real window dimensions, then
 * call `kickPty` to guarantee SIGWINCH even on a same-size resize.
 */
export async function ptyResize(
  id: SessionId,
  cols: number,
  rows: number,
): Promise<void> {
  await invoke<void>("pty_resize", { sessionId: id, cols, rows });
}

/**
 * Guarantee SIGWINCH delivery even when the new size matches the old one.
 *
 * Pattern (design §4.4, pty-handling skill): call `pty_resize` with
 * `rows + 1` first, then restore to the real `rows`. This issues two
 * distinct `ioctl(TIOCSWINSZ)` calls, producing two SIGWINCH events,
 * so shell programs (vim, less, htop) always repaint at the correct size.
 *
 * REQ-PTY-007 Scenario 2 — acceptance criterion #5.
 */
export async function kickPty(
  id: SessionId,
  cols: number,
  rows: number,
): Promise<void> {
  await ptyResize(id, cols, rows + 1);
  await ptyResize(id, cols, rows);
}

/** Close an active PTY session and release all resources. */
export async function ptyClose(id: SessionId): Promise<void> {
  await invoke<void>("pty_close", { sessionId: id });
}
