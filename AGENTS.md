# AGENTS.md — Context for any coding agent working on nyxterm

> This file is read by Claude Code, opencode, Codex, Gemini CLI, and any other agent operating in this repo.
> `CLAUDE.md` is a symlink to this file. So is anything else agent-flavored that lands.

## What this project is

`nyxterm` is an AI-native terminal emulator. Tauri 2 backend (Rust + `portable-pty`), React + TypeScript frontend with xterm.js, Tokyo Night theme, and a Pi-style embedded AI harness as a first-class panel. Eventually it also embeds non-terminal panes (webviews, libmpv players) so the user can reduce browser dependence.

Read [`README.md`](./README.md) for the user-facing pitch and [`ROADMAP.md`](./ROADMAP.md) for phase planning.

## Cultura

Three principles. Internalize them before writing code.

1. **Concepts > Code.** If you can't explain *why* a change matters in one sentence, don't open the PR yet. Architecture before keybinds.
2. **Pi philosophy.** Minimalism wins. Core has 4 tools (Read/Write/Edit/Bash); everything else lives as a skill or plugin. If a feature can live as a plugin/skill, it does not belong in the core binary. (Reference: [earendil-works/pi](https://github.com/earendil-works/pi).)
3. **AI-first, human-led.** Agents draft and verify. Humans approve and merge. Agents never push to `main` directly.

## Stack snapshot

- **Backend**: Rust 2021+, `portable-pty`, Tauri 2 (unstable feature for multi-webview, gated to Phase 3).
- **Frontend**: React 18+, TypeScript 5+, xterm.js + addons (`fit`, `search`, `webgl`, `web-links`, `serialize`).
- **AI**: Vercel AI SDK v6+, multi-provider (Anthropic, OpenAI, Ollama, MLX).
- **Memory**: Engram, embedded library when possible, MCP fallback.
- **Packaging**: Nix flake first. AppImage. Then macOS / Windows.

## Workflow: SDD (Spec-Driven Development)

Non-trivial changes move through these phases:

```
proposal → spec → design → tasks → apply → verify → archive
                  ↑ (parallel)
```

Engram is the source-of-truth for SDD artifacts when available; `.atl/` for openspec-style fallback.

For trivial changes (docs typos, single-line fixes), skip directly to a PR. The line is: *if you'd have to explain the change to a reviewer, it deserves an issue first.*

## Engram memory protocol (MANDATORY when Engram is available)

This is non-negotiable in this repo:

- **Save proactively**: after every decision, bug fix, convention, or non-obvious discovery → `mem_save` with stable `topic_key` (`nyxterm/architecture`, `nyxterm/pty/sigwinch`, etc.).
- **Search before assuming**: before claiming "X exists" or "Y was decided", run `mem_search`. Use `mem_get_observation` to read full untruncated content.
- **Close sessions**: before saying "done", call `mem_session_summary` with Goal / Discoveries / Accomplished / Next Steps / Relevant Files.

If Engram is offline, fall back to writing to `.atl/changes/<name>/` (openspec-style) and resync to Engram on next session.

## Conventions (the short version)

- **Commits**: Conventional Commits (`feat(pty): ...`, `fix:`, `chore:`, ...). **No `Co-Authored-By`**, no AI attribution.
- **Work-unit commits**: one coherent change per commit. Tests + docs of that change go in the same commit.
- **PRs**: ≤400 líneas. >400 → chained / stacked PRs. Squash merge a `main`.
- **Branches**: `<type>/<short-slug>`. Rebase before opening PR.
- **Style**: `cargo fmt` + `cargo clippy -- -D warnings` (Rust). Biome/Prettier (TS — TBD in epic #6).

Full detail in [`CONTRIBUTING.md`](./CONTRIBUTING.md).

## Skills index

The depth lives in [`.agents/skills/`](./.agents/skills/). Each is a `SKILL.md` with frontmatter (`name`, `description`, `triggers`).

| Skill | When to load it |
|---|---|
| [architecture](./.agents/skills/architecture/SKILL.md) | Tauri 2 + xterm.js wiring, PTY thread model, IPC shape |
| [culture](./.agents/skills/culture/SKILL.md) | Decisions about scope, minimalism, when to plugin vs core |
| [pty-handling](./.agents/skills/pty-handling/SKILL.md) | PTY gotchas: SIGWINCH, ConPTY race, OSC, DA filter, coalescing |
| [theming](./.agents/skills/theming/SKILL.md) | Tokyo Night palette, theme API, no hardcoded colors |
| [multiplexing](./.agents/skills/multiplexing/SKILL.md) | Splits, panes, vi copy-mode, prefix `Ctrl+Space` |
| [ai-harness](./.agents/skills/ai-harness/SKILL.md) | Pi-style 4-tool harness, multi-provider, no sub-agents in core |
| [engram-integration](./.agents/skills/engram-integration/SKILL.md) | Engram embedded + MCP fallback, topic_key conventions |
| [nix-packaging](./.agents/skills/nix-packaging/SKILL.md) | Flake structure, HM module, nixGL wrapper |
| [commit-convention](./.agents/skills/commit-convention/SKILL.md) | Commit message rules, work-unit commits |
| [pr-flow](./.agents/skills/pr-flow/SKILL.md) | Branch naming, chained PRs, PR template |

## What NOT to do

- Don't add `Co-Authored-By` lines or AI attribution to commits.
- Don't ship a feature that could live as a plugin.
- Don't hardcode colors (use the theme API, see `theming` skill).
- Don't bypass SDD for changes that touch architecture.
- Don't `git push --force` to `main`. Ever.
- Don't introduce a new dependency without a sentence justifying it in the PR description.

## Inspirations / prior art

- [crynta/terax-ai](https://github.com/crynta/terax-ai) — concrete reference for Tauri 2 + xterm.js + PTY (see their `src-tauri/src/modules/pty/session.rs` reader/flusher/waiter pattern).
- [Pi (earendil-works/pi)](https://github.com/earendil-works/pi) — AI harness philosophy.
- [Ghostty](https://github.com/ghostty-org/ghostty) — daily driver, keybind ergonomics, Nix packaging via nixGL.
- [Wave Terminal](https://github.com/wavetermdev/waveterm) — block system, mixed-content panes.
