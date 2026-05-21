# .agents/

This directory is the canonical home for agent context and skills used in this repo.

## Layout

```
.agents/
├── README.md              # this file
└── skills/
    ├── <topic>/
    │   ├── SKILL.md       # frontmatter + body
    │   └── [extra files]  # optional: examples, references, fixtures
    └── ...
```

## Why `.agents/` and not `.claude/`

We're agent-agnostic. `.agents/` is the source of truth. `.claude/` is a symlink to it so Claude Code reads the same content. Other agents (opencode, Codex, Gemini) read [`AGENTS.md`](../AGENTS.md) (root) directly — most modern coding agents already look for `AGENTS.md` as their canonical context file.

```
.claude/ → .agents/        (symlink)
CLAUDE.md → AGENTS.md      (symlink, root)
```

## How skills work

Each skill is a folder with a `SKILL.md`. The frontmatter signals when an agent should load it:

```yaml
---
name: skill-name
description: One-line summary used by agents to decide relevance.
triggers:
  - keyword1
  - "file extension or path"
  - "task pattern"
---
```

The body of `SKILL.md` is plain Markdown. Keep it under ~200 lines — focused, actionable, no rambling. Link to other skills with `[[skill-name]]` (or normal Markdown links).

## Adding a new skill

1. Create `.agents/skills/<topic>/SKILL.md` with frontmatter.
2. Update the skills table in [`AGENTS.md`](../AGENTS.md).
3. Commit with `docs(agents): add <topic> skill`.

## Updating an existing skill

Just edit. Skills evolve with the codebase. If a skill becomes wrong, update or delete it — don't leave stale guidance in the repo.

## Skills today

See the table in [`AGENTS.md`](../AGENTS.md#skills-index).
