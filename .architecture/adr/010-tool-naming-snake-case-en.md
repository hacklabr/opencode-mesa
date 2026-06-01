# ADR-010: Tool Naming Convention — snake_case English

**Status**: Accepted
**Date**: 2026-06-01
**Context**: Plugin Mesa v1.0.0

## Context

Mesa registers 19 tools with OpenCode, each identified by a unique tool name. These names appear in tool listings, LLM tool-selection prompts, and error messages. The naming convention affects discoverability, consistency, and the ability of LLM agents to correctly select and invoke tools.

During early development (pre-v0.3.0), some tool names used Portuguese (PT-BR), reflecting the primary developer's language. This created inconsistency and made the tool interface harder to reason about for English-oriented LLMs.

## Decision

All Mesa tool names use English `snake_case` consistently. This applies to the external tool interface — tool names registered with OpenCode.

**Naming convention:**
- All lowercase, words separated by underscores.
- Verb-noun pattern for actions: `create_briefing`, `approve_briefing`, `deliver_briefing`.
- Noun-noun pattern for queries: `mesa_status`, `list_specialists`.
- Domain-grouped prefixes: `briefing_`, `team_`, `discussion_`, etc.

**Internal vs. external naming:**
- External (tool name): `snake_case` English — e.g., `analyze_briefing`, `propose_team`.
- Internal (TypeScript): `camelCase` — e.g., `analyzeBriefingTool`, `proposeTeamTool`.
- Tool arguments: `snake_case` — e.g., `agent_id`, `max_turns`, `context_info`.

**Historical note:**
PT-BR tool names were migrated to EN in v0.3.0–v0.4.0. No PT-BR names remain in the v1.0 codebase.

**Complete tool registry:**
```
mesa_status, list_specialists, get_specialist,
create_briefing, approve_briefing, deliver_briefing, import_briefing,
analyze_briefing, propose_team, summon_team,
delegate_task, define_phases,
open_analysis_round, register_analysis, request_consensus,
generate_specification, approve_specification,
pause_discussion, resume_discussion, cancel_discussion
```

## Consequences

**Positive:**
- Consistent, predictable naming — LLM agents can infer tool purpose from the name.
- English names align with the broader OpenCode ecosystem and LLM training data.
- `snake_case` matches the OpenCode tool naming convention.
- Internal `camelCase` follows TypeScript/JavaScript conventions — separation of concerns.
- No language mixing in the tool interface.

**Negative:**
- The migration from PT-BR to EN (pre-v1.0) may have broken any existing configurations or scripts that referenced old tool names.
- Tool arguments use `snake_case` (`agent_id`, `max_turns`) while the internal TypeScript code uses `camelCase` (`agentId`, `maxTurns`) — this requires careful mapping in tool schemas.
- The 19 tools create a large surface area. Future tool additions must follow the established patterns to maintain consistency.
