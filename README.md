# nyxterm

> AI-native terminal emulator. Tauri 2 + Rust. Tokyo Night. Pi-style AI harness. Built for Nix homies.

![status](https://img.shields.io/badge/status-early--development-orange)
![license](https://img.shields.io/badge/license-MIT-blue)
![phase](https://img.shields.io/badge/phase-0%20bootstrap-purple)

## Why

Today my terminal workflow is fragmented across:

- **Ghostty** for the PTY surface
- **tmux** for workspace multiplexing
- **opencode / claude-code** for AI assistance
- **Chrome** for YouTube and WhatsApp Web sitting next to my terminal

That's four moving parts to keep in sync. `nyxterm` collapses them into one cohesive surface: native multiplexing, AI nativa as a first-class panel, and (eventually) embedded web panes for the handful of sites I always have open alongside code.

Built around three principles:

1. **Concepts > Code.** Get the architecture right before optimizing keybinds.
2. **Pi philosophy.** Minimalism wins. 4 core tools (Read/Write/Edit/Bash), everything else is a skill.
3. **AI-first, human-led.** The agent suggests; the human directs.

## Stack

- **Backend**: Rust + [`portable-pty`](https://crates.io/crates/portable-pty) + Tauri 2
- **Frontend**: React + TypeScript + [xterm.js](https://xtermjs.org/) (with `fit`, `search`, `webgl`, `web-links`, `serialize` addons)
- **AI layer**: [Vercel AI SDK](https://sdk.vercel.ai/) v6+ with Anthropic / OpenAI / Ollama / MLX
- **Memory**: [Engram](https://github.com/FullFran/engram) embedded, with MCP fallback
- **Packaging**: Nix flake (Linux first), AppImage, then macOS + Windows

## Roadmap

See [`ROADMAP.md`](./ROADMAP.md) for the full phase breakdown and the [Issues](https://github.com/FullFran/nyxterm/issues?q=label%3Aepic) page for live epics.

| Phase | Focus | Milestone |
|---|---|---|
| **1** | MVP terminal puro (PTY, multiplexing, theme, shell integration) | [Phase 1 — MVP](https://github.com/FullFran/nyxterm/milestones) |
| **1.5** | Productivity (fuzzy picker, atuin palette, inline suggestions, project switcher) | [Phase 1.5](https://github.com/FullFran/nyxterm/milestones) |
| **2** | Pi-style AI harness, multi-provider LLM, Engram first-class, MCP client | [Phase 2](https://github.com/FullFran/nyxterm/milestones) |
| **3** | Web panes — generic webview, libmpv for media, WhatsApp Web pane | [Phase 3](https://github.com/FullFran/nyxterm/milestones) |

## Inspirations

- [crynta/terax-ai](https://github.com/crynta/terax-ai) — architecture reference for Tauri 2 + xterm.js PTY wiring
- [Pi (earendil-works/pi)](https://github.com/earendil-works/pi) — AI harness philosophy
- [Ghostty](https://github.com/ghostty-org/ghostty) — daily driver, keybind ergonomics
- [Wave Terminal](https://github.com/wavetermdev/waveterm) — block system, mixed-content panes

## Contributing

See [`CONTRIBUTING.md`](./CONTRIBUTING.md). The repo follows Spec-Driven Development (SDD): proposal → spec → design → tasks → apply → verify → archive.

Agent context is in [`AGENTS.md`](./AGENTS.md). Skills live under [`.agents/skills/`](./.agents/skills/).

## License

MIT — see [`LICENSE`](./LICENSE).
