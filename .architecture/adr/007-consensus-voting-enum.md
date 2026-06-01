# ADR-007: Consensus Voting as Structured Enum

**Status**: Accepted
**Date**: 2026-06-01
**Context**: Plugin Mesa v1.0.0

## Context

After specialists complete their analysis, Mesa needs to determine whether the team has reached consensus. Each specialist votes on the collective analysis, and the system must evaluate the results to decide whether to proceed to specification or trigger a debate round.

The voting mechanism must be:
- Machine-parseable (no free-text interpretation).
- Expressive enough to capture nuanced positions.
- Simple enough for LLM agents to produce reliably.

## Decision

Votes use a numeric enum with three values:

| Value | Meaning | Description |
|-------|---------|-------------|
| `0` | DISAGREE | Specialist disagrees with the analysis and wants changes. |
| `1` | AGREE | Specialist fully agrees with the analysis. |
| `2` | AGREE_WITH_RESERVATIONS | Specialist agrees but has concerns or caveats. |

**Schema enforcement:**
- The `request_consensus` tool accepts votes as `tool.schema.union([tool.schema.literal(0), tool.schema.literal(1), tool.schema.literal(2)])` — an explicit union of literal values.
- The Zod schema in `src/state.ts` mirrors this: `ConsensusVoteEnum = z.union([z.literal(0), z.literal(1), z.literal(2)])`.
- The type alias `ConsensusVote = 0 | 1 | 2` in `src/config.ts` provides TypeScript type safety.

**Mandatory reason field:**
- Every vote must include a `reason` string explaining the specialist's position.
- This ensures accountability and provides context for debate rounds.

**Consensus evaluation:**
- If all votes are `1` (AGREE) or `2` (AGREE_WITH_RESERVATIONS): consensus is reached.
- If any vote is `0` (DISAGREE): consensus is not reached, debate is required.

## Consequences

**Positive:**
- No ambiguity — agents return structured numeric values, not free-text that requires parsing.
- The three-value enum captures the most common positions: full agreement, partial agreement, and disagreement.
- The mandatory reason field ensures every vote is explainable.
- Zod validation rejects invalid vote values at the schema level.
- Consensus evaluation is a simple predicate: `votes.every(v => v.vote === 1 || v.vote === 2)`.

**Negative:**
- Three options may be too coarse for complex disagreements. There is no way to express "I agree with X but disagree with Y" in the vote itself — the reason field handles this.
- The system does not track which specific parts of the analysis each specialist agrees or disagrees with. Granularity is at the analysis level, not the section level.
- `AGREE_WITH_RESERVATIONS` (2) counts as consensus, which means the system may proceed even when specialists have significant concerns.
