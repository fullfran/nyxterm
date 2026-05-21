---
name: ai-harness
description: Pi-style embedded AI harness. 4 core tools, multi-provider, no sub-agents in core. Load when touching AI module, MCP client, or chat UI.
triggers:
  - ai
  - llm
  - harness
  - mcp
  - "vercel ai sdk"
  - claude
  - openai
  - ollama
  - "tool call"
---

# AI Harness (Pi-style, embedded)

Inspired by [earendil-works/pi](https://github.com/earendil-works/pi). Minimalist. Extensible. Multi-provider.

## Core tools (4, no more)

Only these live in the binary:

1. **`Read(path)`** — read a file with line numbers. Respects gitignore by default.
2. **`Write(path, content)`** — write a new file. Refuses to overwrite (use Edit).
3. **`Edit(path, old, new)`** — exact-string replace. Errors if `old` is ambiguous.
4. **`Bash(command, cwd?)`** — execute a shell command in the project root or specified cwd. Streams output. Returns exit code.

**Anything else** (web search, image gen, RAG, sub-agents, planning trees) is a **skill** loaded on demand, not a built-in.

## Multi-provider via Vercel AI SDK

Use [`ai` v6+](https://sdk.vercel.ai/). Provider plug-ins:

- `@ai-sdk/anthropic` — Claude (Sonnet/Opus/Haiku 4.5+)
- `@ai-sdk/openai` — GPT-5+
- `@ai-sdk/ollama` (community) — local models
- MLX — via local OpenAI-compatible server (e.g., `mlx_lm.server`)

Provider config in Settings: name, baseURL, modelId, API key (encrypted at rest via OS keychain).

## Context injection

Every LLM call gets prepended with:

```xml
<env>
  <workspace-root>/path/to/project</workspace-root>
  <active-pane-cwd>/path/to/active</active-pane-cwd>
  <git-branch>main</git-branch>
  <git-dirty>true</git-dirty>
  <privacy-mode>off</privacy-mode>
</env>
<project-memory>
  <!-- top relevant Engram observations for current topic, cap 8 KB -->
</project-memory>
```

This is fixed-shape. Don't change without coordinating with skills.

## Streaming

Tool calls and text deltas stream into the chat UI as they arrive. No "wait for full response then render". User sees the agent thinking.

## What we explicitly DON'T do in core

- **Sub-agents / planner trees**: that's a plugin. Pi's lesson: most planners are unused complexity.
- **Auto-mode without confirmation for destructive Bash**: every `rm`, `git reset`, `git push --force` requires user confirm UI.
- **Built-in RAG over the codebase**: a plugin can index, but core doesn't pre-process.
- **Voice / image input**: plugin territory.
- **"Magic" features like inline ghost text in the terminal that's actually AI-driven**: that's [`inline-suggestions`](../../skills/multiplexing/SKILL.md) — based on history, not LLM. Don't conflate.

## MCP client

Built-in. Configurable via Settings (or `home.nix` module). Default servers:

- `engram` (memory)
- `context7` (live docs)
- `playwright` (browser automation, opt-in)

MCP servers run as subprocesses. nyxterm manages lifecycle and surfaces tool catalogs to the LLM.

## UI

- **Chat panel**: side pane (toggleable). Tokyo Night themed. Markdown + code block rendering, tool-call cards, streaming text.
- **Command palette** (`Ctrl+;`): NL → bash. Translates natural language into a shell command, shows the command, runs only on Enter.
- **Output explainer** (Phase 2 stretch): right-click on a block of stderr → "Explain this".

## Safety

- Every `Bash` call goes through a confirm step unless the command matches a user-whitelisted pattern (in Settings).
- No agent can `Write` to paths outside the workspace without explicit user confirm.
- API keys never logged. Stream traces redact known key patterns.
