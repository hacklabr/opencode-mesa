# ADR-009: Audit Logging as Append-Only NDJSON

**Status**: Accepted
**Date**: 2026-06-01
**Context**: Plugin Mesa v1.0.0

## Context

Mesa executes a multi-phase workflow where state transitions, team changes, and specification decisions happen across many tool invocations. When something goes wrong — a phase transition fails, a specialist's analysis is lost, or the state is inconsistent — developers need a way to trace what happened and when.

Traditional logging to stdout is insufficient because Mesa tools execute in OpenCode's tool context, where stdout may be captured, discarded, or interleaved with other tool output.

## Decision

Mesa implements append-only NDJSON (Newline-Delimited JSON) audit logging in `src/audit.ts`.

**Log format:**
Each line is a self-contained JSON object with:
- `timestamp` — ISO 8601 datetime string.
- `action` — the event name (e.g., `briefing_approved`, `team_summoned`, `consensus_requested`).
- `phase` — the current workflow phase when the event occurred.
- `details` — optional key-value object with event-specific metadata.

**Storage:**
- Logs are written to `.mesa/audit.log` in the workspace root.
- The `.mesa/` directory is created on first write if it doesn't exist.
- Uses Node.js `appendFile()` — each write appends a new line without reading or modifying existing content.

**Logged events:**
- `briefing_approved` — human approved the briefing.
- `briefing_delivered` — briefing delivered to Manager.
- `team_summoned` — specialist team summoned.
- `analysis_round_opened` — analysis round started.
- `consensus_requested` — consensus phase initiated.
- `specification_generated` — specification document created.
- `specification_approved` — specification approved by human.
- `specification_rejected` — specification rejected, returned to DOCUMENTATION.
- `discussion_paused` — discussion paused.
- `discussion_resumed` — discussion resumed.
- `discussion_cancelled` — discussion cancelled.

## Consequences

**Positive:**
- Append-only writes are inherently safe — no risk of corrupting existing log entries.
- NDJSON is easy to parse, grep, and stream — one entry per line, no nested document parsing.
- Provides a complete chronological trace of the workflow lifecycle.
- Useful for debugging state transitions and understanding what led to a particular state.
- Minimal performance impact — single `appendFile()` call per event.

**Negative:**
- No log rotation — the audit log grows indefinitely. Long-running workspaces may accumulate large log files.
- No structured querying — finding specific events requires text search (grep/rg).
- Not all tool invocations are logged — only significant state mutations. Routine operations like `mesa_status` or `list_specialists` are not logged.
- No authentication/authorization metadata in log entries — the `actor` field is defined in the `AuditEntry` interface but not populated in v1.0.
