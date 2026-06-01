# ADR-008: Human Approval Gates at Critical Transitions

**Status**: Accepted
**Date**: 2026-06-01
**Context**: Plugin Mesa v1.0.0

## Context

Mesa automates multi-specialist orchestration, but certain transitions represent commitment points where human judgment is essential. Without approval gates, AI agents could proceed through the entire workflow autonomously — approving their own briefings, summoning teams, and finalizing specifications without human oversight.

This creates both quality risks (approving a flawed specification) and trust risks (users feeling excluded from decisions about their own project).

## Decision

Mesa enforces three mandatory human approval gates. These gates cannot be bypassed by AI agents — the tools that advance past these gates are designed to be called only after explicit human confirmation.

**Gate 1 — Briefing Approval:**
- After the briefing-writer creates a briefing (`create_briefing`), it presents the content to the human.
- The human must review and explicitly approve it.
- Only then does `approve_briefing` transition the briefing status from `draft` to `approved`.
- `deliver_briefing` checks for `approved` status before delivering to the Manager.

**Gate 2 — Team Approval:**
- After the Manager proposes a specialist team (`propose_team`), it presents the proposal to the human with each specialist's name, division, and justification.
- The tool output explicitly states: "This team requires explicit human approval before summoning."
- Only after human confirmation does `summon_team` transition specialists from `proposed` to `summoned`.

**Gate 3 — Specification Approval:**
- After specification generation (`generate_specification`), the document is presented to the human.
- `approve_specification` accepts a boolean `approved` parameter.
- If approved (`true`): transitions to `EXECUTION` phase.
- If rejected (`false`): transitions back to `DOCUMENTATION` phase for revision, with optional feedback.

## Consequences

**Positive:**
- Humans retain control at every critical commitment point.
- Rejected specifications return to `DOCUMENTATION` phase, enabling iterative refinement.
- The gate pattern is consistent: present → human reviews → explicit approval/rejection → advance/return.
- Prevents AI agents from autonomously committing to implementations the human hasn't validated.

**Negative:**
- The gates rely on social convention, not hard enforcement. An agent could call `approve_briefing` without human consent — the tool has no mechanism to verify the approval came from a human.
- The approval flow adds latency — each gate requires a round-trip with the human.
- There is no "partial approval" mechanism — the team is either fully approved or not. Individual specialist additions/removals must be handled by re-proposing the team.
