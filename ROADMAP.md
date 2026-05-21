# Roadmap

`nyxterm` is built in phases. Each phase has a milestone; each epic is an issue under that milestone.

> Live state: [Issues filtered by `epic` label](https://github.com/FullFran/nyxterm/issues?q=label%3Aepic).

## Phase 1 — MVP terminal puro

Outcome: a terminal you can use as a daily driver. PTY, multiplexing, theme, shell integration. No AI yet.

1. **Core PTY emulator** — portable-pty + xterm.js + Tauri shell, ANSI/OSC handling, signals (SIGWINCH/SIGINT/Ctrl+C)
2. **Native multiplexing** — windows/splits/panes nativo (absorber tmux), prefix configurable default `Ctrl+Space`, vi copy-mode
3. **Session persistence** — resurrect/continuum-style autosave a Engram o local sqlite
4. **Tokyo Night theme engine** — tema único, exportable a fzf/bat/lazygit/btop vía emit
5. **Shell integration** — OSC 7 (cwd), OSC 133 (prompt marks), hooks `before_exec`/`after_exec`
6. **Settings UI + Nix module** — settings GUI + declarativo desde `home.nix`

## Phase 1.5 — Productivity (subsumir dotfiles)

Outcome: replace the daily tools that today live as separate processes (fzf, atuin UI, zoxide, ble.sh suggestions).

7. **Fuzzy picker built-in** — files/commands/dirs en un solo modal (reemplaza fzf+fd+zoxide UI)
8. **Atuin-style command palette** — history search nativo, sync opcional con server Atuin
9. **Inline suggestions** — gray underlay estilo ble.sh/fish, sin shell plugin
10. **Git status caching** — branch + dirty en tab title, cacheado 2s, sin fork-per-prompt
11. **Project/worktree switcher** — integrado con `gwt`, lista persistida en Engram

## Phase 2 — AI nativa (Pi-style harness embebido)

Outcome: AI as a first-class panel, minimalist, multi-provider, memory-aware.

12. **Embedded Pi-style harness** — 4 tools (`Read`, `Write`, `Edit`, `Bash`), TypeScript extensions, prompt templates, themes
13. **Multi-provider LLM** — Anthropic/OpenAI/Ollama/MLX vía AI SDK unificada
14. **Engram first-class** — memoria como módulo nativo, fallback a MCP si servidor remoto
15. **MCP client built-in** — context7, playwright, gestionado desde Settings
16. **AI command palette** — `Ctrl+;` abre prompt → traduce NL a bash, explica output, sugiere fix

## Phase 3 — Web panes (el dolor real)

Outcome: depender menos del navegador. YouTube + WhatsApp + cualquier sitio como paneles.

17. **Webview pane genérico** — cualquier sitio como pane, OAuth via system browser fallback
18. **libmpv integration** — YouTube/streams sin webview, ~25MB via yt-dlp + libmpv binding
19. **WhatsApp Web pane** — QR session persistente, cookie isolation cuando Tauri lo soporte
20. **Pane orchestration** — PTY + webview + mpv conviven en el mismo layout grid

## Transversales (paralelo a todas las fases)

21. **Plugin/extension API** — TypeScript, hot-reload, sandbox
22. **Cross-platform** — Linux first (Nix flake), después macOS + Windows
23. **Performance budget** — <50MB idle, <250ms startup, 7MB binary, instrumentación
24. **Benchmarks & CI** — medir RAM/CPU/startup en cada PR, gate sobre regresiones

---

## Cuándo una épica está "ready"

Una épica pasa de `status:needs-spec` a `status:ready` cuando tiene:

- Problema y outcome claros en el body
- Sub-tasks dividida en PRs ≤400 líneas
- Acceptance criteria concretos (test-checkable)
- Dependencies linkeadas a otras épicas/issues

Solo épicas `status:ready` se pueden empezar a implementar.
