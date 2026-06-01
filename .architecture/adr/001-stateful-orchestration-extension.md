# ADR-001: Plugin as Stateful Orchestration Extension

**Status**: Accepted
**Date**: 2026-06-01
**Context**: Plugin Mesa v1.0.0

## Context

Mesa needs to operate inside OpenCode as a guest plugin, providing structured multi-specialist discussion capabilities without modifying the host platform. The plugin must register its own tools, inject context into agent conversations, and persist workflow state — all through the APIs exposed by `@opencode-ai/plugin`.

The core challenge is that Mesa is not a standalone application. It runs within OpenCode's plugin lifecycle and must coordinate with OpenCode's existing agent system, tool execution framework, and conversation model.

## Decision

Mesa operates as a stateful orchestration extension using the `@opencode-ai/plugin` API. The plugin entry point (`src/index.ts`) exports a single `Plugin` function that registers:

1. **Tools** — 19 tools registered via the `tool` property, covering the full Mesa workflow (briefing, team management, discussion, specification, and status).
2. **System prompt injection** — The `experimental.chat.system.transform` hook injects a `<mesa-plugin>` context block into every agent conversation, ensuring any agent can recognize Mesa-related requests and route users appropriately.
3. **Tool definition augmentation** — The `tool.definition` hook appends a usage notice to Mesa tool descriptions, discouraging the default agent from invoking them directly.

Mesa uses only host-provided primitives: the `tool()` helper for tool registration, the plugin hooks for system prompt transformation, and OpenCode's native `task()` tool for specialist invocation.

## Consequences

**Positive:**
- Zero modification to OpenCode core — Mesa is fully self-contained as a plugin.
- Any OpenCode installation can add Mesa by installing the plugin.
- System prompt injection ensures Mesa-awareness across all agents without configuration.
- Tool definition augmentation prevents accidental misuse by the default agent.

**Negative:**
- Mesa depends on the `@opencode-ai/plugin` API surface, which includes experimental hooks (`experimental.chat.system.transform`) that may change.
- The plugin has no control over which agent is active — it can only suggest agent switches via injected system prompt instructions.
- Tool registration is static at plugin load time — dynamic tool registration per-phase is not supported.
