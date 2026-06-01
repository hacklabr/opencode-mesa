# ADR-005: Subagent Delegation via Native Task Tool

**Status**: Accepted
**Date**: 2026-06-01
**Context**: Plugin Mesa v1.0.0

## Context

When the Manager orchestrates a discussion, it needs to invoke specialists to perform analysis, debate, and implementation tasks. Each specialist has its own system prompt that shapes its behavior and expertise. The specialist invocation mechanism must preserve these persona definitions and allow the Manager to pass task-specific context.

OpenCode provides a native `task` tool that invokes subagents with their own system prompts and isolated execution contexts. Mesa needed to decide whether to build a custom specialist invocation mechanism or leverage OpenCode's existing subagent infrastructure.

## Decision

Mesa registers each specialist as a hidden subagent in the `mesa/*` namespace and delegates via OpenCode's native `task()` tool.

**Agent generation** (`src/setup/generate-agents.js`):
1. Reads all persona files from the catalog.
2. Generates `.md` files in `.opencode/agents/mesa/` with frontmatter:
   - `mode: subagent` — registers as a subagent.
   - `hidden: true` — not visible in agent selection UI.
   - `permission:` block granting edit, write, and bash access.
3. Persona system prompts become the subagent's system prompt automatically.

**Invocation pattern:**
```
task(subagent_type="mesa/engineering-backend-architect", prompt="...", description="API analysis")
```

OpenCode auto-injects the specialist's system prompt when the `subagent_type` matches a registered agent. The Manager only needs to pass task-specific context in the `prompt` parameter — it must NOT duplicate the system prompt.

**Two primary agents** (not subagents):
- `briefing-writer.md` — conducts discovery interviews.
- `manager.md` — orchestrates the full workflow.

These are registered as primary agents (visible in agent selection).

## Consequences

**Positive:**
- No custom invocation mechanism — Mesa reuses OpenCode's proven subagent infrastructure.
- System prompts are managed as simple `.md` files, not code.
- Specialists have their own permission scopes and execution contexts.
- The `hidden: true` flag prevents cluttering the agent selection UI with 200+ specialists.
- OpenCode handles subagent lifecycle, error handling, and result collection.

**Negative:**
- Mesa depends on OpenCode's `task()` tool implementation and subagent registration format.
- The `task()` denial rule (`task: { "*": "deny" }`) in specialist frontmatter prevents specialists from spawning their own sub-agents, which limits recursive delegation but prevents runaway agent spawning.
- Generating agent files requires running `bun run setup:agents` — the setup is not automatic on plugin install.
- Specialist persona IDs must match exactly between the catalog and the generated agent filenames.
