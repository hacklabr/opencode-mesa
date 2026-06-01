# ADR-003: JSON File Persistence over Event Sourcing

**Status**: Accepted
**Date**: 2026-06-01
**Context**: Plugin Mesa v1.0.0

## Context

Mesa needs to persist workflow state across tool invocations. Each tool call is a separate execution context — there is no in-process state between calls. The state includes the current phase, briefing details, team composition, discussion analyses, consensus votes, and specification metadata.

Two primary approaches were considered: (1) event sourcing, where every state mutation is recorded as an immutable event and state is rebuilt by replaying events, and (2) JSON file snapshot, where the entire state is serialized to a JSON file on every mutation.

## Decision

Mesa uses JSON file persistence with atomic writes, implemented in `src/state.ts`.

**Write strategy (atomic):**
1. Serialize state to JSON and write to a `.tmp` file.
2. Copy the current `state.json` to `state.json.bak` as a backup.
3. Rename `.tmp` to `state.json` (atomic on most filesystems).

**Read strategy (with recovery):**
1. Read and parse `state.json`.
2. Validate the parsed object against the Zod `DiscussionStateSchema`.
3. If validation fails (ZodError), attempt to load from `state.json.bak`.
4. If the file doesn't exist (ENOENT), return initial state — this is a new workspace.

**Schema validation** uses Zod with explicit enums for every status field (`DiscussionPhaseEnum`, `BriefingStatusEnum`, `SpecialistStatusEnum`, etc.) ensuring that corrupted or manually-edited state files are caught early.

State is stored in `.mesa/state.json` within the workspace root.

## Consequences

**Positive:**
- Simple to implement and debug — the entire state is a single readable JSON file.
- Atomic writes (tmp → backup → rename) prevent data corruption from incomplete writes.
- Zod validation on every load catches schema drift and corruption.
- `.bak` recovery provides a safety net for corruption scenarios.
- Sufficient for the current single-discussion-per-workspace model.

**Negative:**
- No event history — once state is overwritten, the previous state is only available in the `.bak` file (one level deep).
- Not suitable for concurrent access (multiple Mesa instances in the same workspace). The atomic write strategy assumes single-writer.
- Event sourcing is deferred to post-v1.0. It would provide full audit history and time-travel debugging, but the added complexity is not justified for the current scope.
- The `.bak` file is only one recovery level — if both `state.json` and `.bak` are corrupted, state is lost.
