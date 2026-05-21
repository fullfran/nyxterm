import { TerminalPane } from "./modules/terminal/TerminalPane";

/**
 * Temporary diagnostic banner (remove after first successful run).
 *
 * If you see the banner with "React mounted" text in the window, React is
 * working and the issue is downstream (xterm.js mount, PTY IPC, etc.).
 * If you DO NOT see the banner, the webview is failing to render any HTML
 * (webkit2gtk / EGL problem) — see README "Troubleshooting" section.
 */
export default function App() {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateRows: "auto 1fr",
        width: "100%",
        height: "100%",
      }}
    >
      <div
        style={{
          padding: "4px 8px",
          background: "#7aa2f7",
          color: "#1a1b26",
          fontFamily: "monospace",
          fontSize: 12,
        }}
      >
        [nyxterm] React mounted — webview HTML rendering OK
      </div>
      <TerminalPane />
    </div>
  );
}
