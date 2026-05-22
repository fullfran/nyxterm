import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

// NOTE: React.StrictMode intentionally NOT used.
// xterm.js + PTY async lifecycle don't survive double mount/unmount cleanly
// (term.dispose() races vs in-flight ptyOpen). We get TDD-equivalent safety
// from integration tests instead.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <App />,
);
