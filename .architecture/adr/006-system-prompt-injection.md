# ADR-006: System Prompt Injection for Mesa Awareness

**Status**: Accepted
**Date**: 2026-06-01
**Context**: Plugin Mesa v1.0.0

## Context

Mesa's tools should only be invoked by the `briefing-writer` or `manager` agents, not by OpenCode's default agent. However, users often interact with the default agent first and may request tasks that require the Mesa workflow (e.g., "analyze my project", "create a specification"). Without intervention, the default agent would attempt these tasks alone, producing lower-quality output.

The challenge is making every OpenCode agent aware of Mesa's existence and routing rules, without requiring per-agent configuration.

## Decision

Mesa uses the `experimental.chat.system.transform` hook to inject a `<mesa-plugin>` context block into every agent conversation. This hook fires on every chat interaction, regardless of which agent is active.

**Injected block contents:**
1. **WHEN to use Mesa** — a list of trigger scenarios (creating briefings, generating specifications, structured analysis).
2. **WHAT to do** — instruct the agent to tell the user "This requires the Mesa workflow" and suggest switching to `briefing-writer` via `/agent briefing-writer` or `/briefing`.
3. **WHY it exists** — explains the multi-specialist quality guarantee.
4. **EXCEPTION** — only skip Mesa if the user explicitly says "do it yourself" or "skip the discussion table".

**Tool definition augmentation** via the `tool.definition` hook:
- Appends an `IMPORTANT` notice to all 19 Mesa tool descriptions, stating they should be used by `manager` or `briefing-writer`, not the default agent.

## Consequences

**Positive:**
- Any agent becomes Mesa-aware without configuration changes.
- Users are guided to the correct workflow agent automatically.
- The exception clause preserves user autonomy — they can override the routing.
- Tool descriptions reinforce correct usage patterns.

**Negative:**
- The injected block adds ~20 lines to every conversation's system prompt, increasing token consumption on every message.
- The `experimental.chat.system.transform` hook may change or be removed in future OpenCode versions.
- Some agents may ignore or override the injected instructions, especially if their own system prompt is strongly directive.
- The routing is advisory, not enforced — a determined agent can still call Mesa tools directly. The `tool.definition` notice is a soft guard, not a hard block.
