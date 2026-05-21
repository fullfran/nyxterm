# Contributing to nyxterm

Thanks for being here. nyxterm follows a deliberate workflow — read this once and you'll know how every PR moves through the repo.

## Philosophy

- **Concepts before code.** If you don't know *why* a change matters, don't open the PR yet.
- **Pi-minimalism.** If a feature can live as a plugin/skill, it does not belong in the core binary.
- **AI-first, human-led.** Coding agents (Claude, opencode, Codex, Gemini) help draft and verify. Humans approve and merge.

## Workflow: SDD (Spec-Driven Development)

Every non-trivial change moves through these phases:

```
proposal → spec → design → tasks → apply → verify → archive
                  ↑
              (parallel)
```

For small fixes (docs, typos, single-line bug fix), skip directly to a PR. For everything else, an issue (epic or feature) is the entry point. See [`AGENTS.md`](./AGENTS.md) and [`.agents/skills/`](./.agents/skills/) for the agent-side detail.

## Branches

Naming convention: `<type>/<short-kebab-slug>`.

Examples:
- `feat/native-multiplex`
- `fix/pty-resize-race`
- `chore/bump-tauri`
- `docs/readme-quickstart`

Always branch from `main`. Rebase before opening a PR.

## Commits

**Conventional Commits**. No `Co-Authored-By` lines, no AI attribution.

```
feat(pty): add SIGWINCH propagation for tmux-less resize
fix(theme): emit theme to webgl renderer after context restore
chore: bump portable-pty to 0.9.1
docs: explain the OSC 7 trust window
refactor(multiplex): extract pane grid into its own module
perf(buffer): coalesce 4ms PTY flushes
test(pty): cover backpressure overflow path
```

Mensajes en presente imperativo. Scope opcional pero recomendado.

### Work-unit commits

Un commit = un cambio coherente. Tests + docs + código del mismo work-unit van juntos. No mezcles refactor con feature.

## Pull Requests

- PRs **≤400 líneas** preferidas. Si el cambio es grande, abrí **chained PRs** (stacked).
- Cada PR linkea al issue/epic correspondiente con `Closes #N` o `Refs #N`.
- Description usa este template:

```markdown
## Summary
- [1-3 bullets of what changed and why]

## Test plan
- [ ] Manual test step 1
- [ ] Manual test step 2
- [ ] `cargo test` / `pnpm test`
- [ ] `cargo clippy --all -- -D warnings`
```

- Squash merge a `main`. Mensaje de squash = PR title (Conventional).

## Issues

Tres templates en `.github/ISSUE_TEMPLATE/`:

- **Epic** — visión grande, multi-PR. Tiene sub-tasks como checklist.
- **Feature** — change concreto, 1-2 PRs.
- **Bug** — repro steps + expected/actual.

Labels obligatorios: tipo (`epic`/`feature`/`bug`), fase (`phase-1-mvp`, ...), área (`area:pty`, ...).

## Style & checks

- **Rust**: `cargo fmt`, `cargo clippy --all -- -D warnings`. Edition 2021+.
- **TS/React**: Biome o ESLint + Prettier (TBD en épica #6).
- **Nix**: `nixfmt` (configurado en flake).

CI corre en cada PR. No mergeás con CI roja.

## Agent contributions

Si trabajaste con un agent (Claude, opencode, Codex), revisá el diff antes de pushear. El humano firma el commit. No `Co-Authored-By` aunque tu cliente lo agregue por defecto.

## Code of Conduct

Be excellent to each other. Asume buena fe. Disagreements técnicos > ataques personales. Si algo se pone tóxico, abrí un issue privado al maintainer.
