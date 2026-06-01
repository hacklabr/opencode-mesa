# ADR-002: State Machine with Validated Transitions

**Status**: Accepted
**Date**: 2026-06-01
**Context**: Plugin Mesa v1.0.0

## Context

The Mesa workflow progresses through distinct phases — from briefing creation to specialist analysis, consensus, specification, and execution. Without strict phase validation, tools could be invoked out of order, leading to inconsistent state (e.g., requesting consensus before analysis, or generating a specification without a team).

The workflow must also support pause/resume and cancellation from any active phase.

## Decision

Mesa implements a finite state machine with an explicit `VALID_TRANSITIONS` table in `src/workflow/transitions.ts`. Every phase change goes through the `canTransition()` function, which checks the table before allowing the transition.

**Defined phases:**
```
PLANNING → ANALYSIS → CONSENSUS → DOCUMENTATION → APPROVAL → EXECUTION
                                                ↕ PAUSED
                                                ↕ CANCELLED
```

**Transition rules** (from `VALID_TRANSITIONS`):
- `PLANNING` → `ANALYSIS`, `PAUSED`, `CANCELLED`
- `ANALYSIS` → `CONSENSUS`, `PAUSED`, `CANCELLED`
- `CONSENSUS` → `DOCUMENTATION`, `ANALYSIS` (re-debate), `PAUSED`, `CANCELLED`
- `DOCUMENTATION` → `APPROVAL`, `PAUSED`, `CANCELLED`
- `APPROVAL` → `EXECUTION`, `DOCUMENTATION` (rejected), `PAUSED`, `CANCELLED`
- `EXECUTION` → `PLANNING` (new cycle), `PAUSED`, `CANCELLED`
- `PAUSED` → any active phase, `CANCELLED`
- `CANCELLED` → `PLANNING` (restart)

The `requirePhase()` helper provides a concise guard at the top of each tool handler to verify the current phase matches the tool's requirements. No implicit phase changes exist — every transition is explicit and validated.

## Consequences

**Positive:**
- Impossible to invoke tools out of order — the transition table is the single source of truth.
- Easy to reason about workflow state — the current phase determines exactly which operations are legal.
- `requirePhase()` provides clear error messages when tools are invoked in the wrong phase.
- Pause and cancel are available from any phase, ensuring graceful interruption.

**Negative:**
- The transition table must be kept in sync with tool implementations — a new phase or transition requires updating both.
- The linear phase sequence (PLANNING → ANALYSIS → ...) may feel rigid for workflows that need iterative refinement between non-adjacent phases. The current workaround is `PAUSED` as a gateway to any phase.
- `CONSENSUS → ANALYSIS` allows re-debate, but there is no explicit "iteration counter" to prevent infinite loops.
