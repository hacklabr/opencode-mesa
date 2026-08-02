# Workflow Reference

Detailed reference for the Mesa workflow: the flexible kernel model — briefings, teams, workflow plans, discussion rounds, and deliverables.

> **Diátaxis category**: Reference

## The Flexible Model

Mesa is an **adaptive orchestrator**, not a fixed pipeline. The old 8-phase state machine (PLANNING → ANALYSIS → CONSENSUS → DOCUMENTATION → APPROVAL → EXECUTION) is gone. In its place:

1. The **Manager reads the briefing and designs a workflow** tailored to the scope, writing it to `workflow-plan.md`.
2. The **human approves the plan** (gate 0).
3. The Manager executes the plan using **one universal primitive — the discussion round** — composing parallel/sequential rounds with variable casts as it sees fit.
4. Rounds produce **deliverables**, which the human approves.

There are no named phases and no structured voting. Sequencing is the Manager's judgment; integrity is protected by a small set of **data preconditions** enforced in code (see [Architecture Reference](architecture.md)).

The session has a simple lifecycle status: `active` / `paused` / `cancelled`. All mutating tools require `active`.

## End-to-End Flow

```mermaid
flowchart TD
    Start([/agent briefing-writer]) --> B1[create_briefing\nor import_briefing]
    B1 --> B2{Human reviews}
    B2 -->|changes| B1
    B2 -->|approved| B3[approve_briefing\nonly path to approved]

    B3 --> M1[/agent manager]
    M1 --> M2[propose_team]
    M2 --> M3{Human reviews}
    M3 -->|changes| M2
    M3 -->|approved| M4[summon_team]

    M4 --> P1[Manager writes\nworkflow-plan.md]
    P1 --> P2{Gate 0:\nhuman approves plan}
    P2 -->|changes| P1
    P2 -->|approved| P3["record_decision(type='gate', target='plan')"]

    P3 --> R1[open_round\ntopic + participants ⊆ team]
    R1 --> R2[register_analysis × N\nvia specialist sessions]
    R2 --> R3{close_round}
    R3 -->|converged| D1
    R3 -->|converged-with-open-tensions| D1
    R3 -->|disagree| R4[subset round with\ndissenters only]
    R4 --> R2
    R3 -->|escalated| H[Human judges]

    D1[produce_deliverable] --> D2{Human reviews}
    D2 -->|rejected| D1
    D2 -->|approved| D3[approve_deliverable]
    D3 --> More{More rounds\nin plan?}
    More -->|yes| R1
    More -->|no| Done([Done])
```

## 1. Briefing

**Goal**: capture the scope, constraints, and success criteria as a durable artifact.

| Step | Tool | Notes |
|------|------|-------|
| Draft | `create_briefing(slug, title, content)` | Created by the Briefing Writer after a structured discovery interview. Refused if the session already has a briefing whose status is not `rejected`. |
| Import (alternative) | `import_briefing(file_path, slug, title?)` | Imports an existing Markdown file as a pre-drafted briefing — skips the interview. |
| Approve | `approve_briefing()` | The **only** path to status `approved`. Call after explicit human approval. Also hands the briefing to the Manager (absorbs the old `deliver_briefing` step). |

After approval, switch agents: `/agent manager`. Agent switching is manual — Mesa never switches agents for you.

## 2. Team

**Goal**: assemble the human-approved cast. Only team members can speak in rounds — the team boundary is the foundation of declared positions.

| Step | Tool | Notes |
|------|------|-------|
| Browse | `list_specialists(division?, search?)`, `get_specialist(id)` | Read-only catalog access. |
| Propose | `propose_team(specialists=[{personaId, name, division, justification}])` | Saves the proposal for human review. Requires an approved briefing. |
| Summon | `summon_team()` | Human gate (K3). Marks each specialist as summoned. Requires a pending proposal. |

## 3. Workflow Plan (Gate 0)

Before the first round, the Manager writes `workflow-plan.md` in the session folder. The plan is stored in **three layers**:

| Layer | What | Where |
|-------|------|-------|
| **Intention** | The plan document: deliverable, scope class, planned rounds, gates, explicit `Skipped:` line for every optional step | `workflow-plan.md` (human-readable file — humans approve documents, not state dumps) |
| **Fact** | A pointer: `{path, version, status, approvedAt}` | Session state (`state.plan`) |
| **Trace** | The rounds actually executed | `state.rounds[]` (append-only) |

**Gate 0**: the human approves the plan, and the Manager records it:

```
record_decision(type="gate", target="plan",
  reason="Human approved workflow plan v1",
  payload={path: ".mesa/sessions/<id>/workflow-plan.md"})
```

This is the **only** way a plan becomes approved. `open_round` refuses to run without an approved plan pointer.

**Amendments**: changing the plan mid-flight requires a new file version plus `record_decision(type="plan-amendment", target="plan", reason=...)`. The version must strictly increase — unlogged amendments are detectable. *Silent replanning is the cardinal sin of this system.*

**Resume ritual**: after `resume_discussion`, the Manager re-reads the plan and the round trace, and declares its position out loud ("Plan v2: r1–r3 closed, r4 open. Next: X") before any other action.

## 4. Rounds — the Universal Primitive

A round is the only deliberation primitive. Topic, cast, and topology (parallel/sequential) are Manager execution decisions, not state schema.

### Opening

```
open_round(
  topic="API design for order management",
  participants=["engineering-backend-architect", "security-specialist"],
  briefing_content="..."   // optional — written to the session folder
)
```

Preconditions (all data-checkable, each error message explains recovery):

- Session status is `active`.
- Briefing is `approved`.
- At least one team member is `summoned`.
- Plan is `approved` (gate 0).
- No other round is open (one open round at a time).
- Round budget available (`rounds.length < 12`).
- All `participants` are members of the summoned team (**hard error** otherwise).

### Analyzing

The Manager invokes each participant via OpenCode's native `task` tool (see [Delegation](#delegation-inline-persona-vs-task_id-slug)). Each specialist self-registers from its own session:

```
register_analysis(agent_id="...", agent_name="...", content="...", turn=1, file_path="...")
```

**POSITION blocks**: every participant's final artifact for a round must end with a declared position:

```
POSITION: agree | agree-with-reservations | disagree — [reason]
```

Positions are **declared by specialists, never inferred by the Manager**.

`get_peer_analyses` lists registered analyses (read-only) so the Manager can cite file paths and build follow-up delegation prompts.

### Closing — Emergent Consensus

```
close_round(
  decision="converged" | "converged-with-open-tensions" | "escalated",
  summary="...",
  tensions=["<verbatim from declared positions>"],
  evidencePaths=[".mesa/sessions/<id>/analysis-....md", ...]
)
```

The Manager decides **WHETHER the process converged — never WHO is right**. Rules:

- **Completeness gate**: every participant must have ≥1 analysis in this round, self-registered (entries with `registered_by_manager=true` do **not** count — that would let the Manager write the specialist's position), whose file contains a lexical POSITION block. Overridable only with `humanOverride: true` (audit-logged; does not bypass `evidencePaths`).
- **A declared `disagree` vetoes `converged`** (load-bearing rule). Three legal moves:
  1. Open a **subset round** with exactly the dissenting participants.
  2. Close as `converged-with-open-tensions`, recording the tension **verbatim** in `tensions[]` so it reaches the deliverable and the human.
  3. Close as `escalated` — the human is the only judge of content.
- **Evidence is mandatory**: `evidencePaths[]` must be non-empty. A decision without cited evidence is undetectable rubber-stamping.
- **Soft check**: a declared `disagree` with empty `tensions[]` produces a warning — surface the tension, don't swallow it.

## 5. Deliverables

Rounds produce canonical artifacts. `produce_deliverable` absorbs the old `generate_specification`, `generate_specification_overview`, and `generate_phase_appendix` tools.

```
produce_deliverable(kind="specification", topic="Order Management API", content="...")
```

Kinds and canonical paths (all inside the session folder):

| Kind | Path |
|------|------|
| `specification` | `specification.md` |
| `overview` | `overview.md` |
| `journeys` | `journeys.md` |
| `appendix` | `appendices/appendix-{slug}-{uuid8}.md` |
| `other` | `deliverables/{slug}.md` |

Rules:

- **Precondition**: ≥1 closed round with ≥1 analysis linked to it — or `humanOverride: true` (audit-logged).
- **Provenance**: each deliverable records the closed round IDs it derives from.
- **Approved artifacts are immutable**: re-producing at a path whose deliverable is `approved` is refused. Drafts are replaced; rejected deliverables may be re-produced as new drafts.

**Approval** is the human gate (K3) and the only path to status `approved`:

```
approve_deliverable(path=".mesa/sessions/<id>/specification.md", approved=true)
approve_deliverable(path="...", approved=false, feedback="Missing error handling section")
```

Verbal approval in chat is not sufficient — the tool must be called to record the decision.

## Delegation: inline persona vs `task_id` slug

Specialists are invoked through OpenCode's native `task` tool against the generic `mesa/specialist` subagent. Persona resolution happens in the plugin's `tool.execute.before` hook, in this order:

1. **Session resumption** (`task_id="ses_..."`): persona already in history — nothing injected.
2. **Inline persona block (PRIMARY path)**: the Manager includes `<specialist-persona id="...">...</specialist-persona>` in the prompt itself. Required on runtimes that reject non-`ses_` task IDs. The hook validates the ID against the catalog and passes the prompt through untouched.
3. **`task_id` slug** (`task_id="mesa-{personaId}"`): on runtimes that accept it, the hook injects the persona block from the catalog. A stable `task_id` also preserves specialist memory across rounds and turns.

If no persona is found by any path, the hook prepends a `<specialist-setup-error>` notice instructing the specialist to report back instead of attempting the task.

## Session Lifecycle

| Tool | Effect |
|------|--------|
| `pause_discussion()` | Status → `paused`. State fully preserved. All mutations are refused while paused. |
| `resume_discussion()` | Status → `active`. Follow with the resume ritual (re-read plan + trace, declare position). |
| `cancel_discussion()` | Status → `cancelled`. Clears analysis data; preserves briefing, team, and deliverables. |

## Memory & Updates

Cross-session knowledge persistence is available to all agents:

- `memory_store(content, category)` — deduplicated (SHA-256); project memories have a 90-day TTL.
- `memory_recall(query?, category?)` — check for relevant project knowledge before analysis or implementation.
- `memory_forget(id)` — soft-delete (7-day recovery window).

Plugin maintenance: `mesa_check_update` and `mesa_update` (requires OpenCode restart after update).

## Common Workflows

### Minimal single-round discussion

```
1. /agent briefing-writer              → discovery interview
2. approve_briefing()                  → human approves briefing
3. /agent manager                      → switch to Manager
4. propose_team([...]) → summon_team() → human approves team
5. (Manager writes workflow-plan.md)
6. record_decision(type="gate", target="plan", payload={path: ...})
7. open_round(topic="...", participants=[...])
8. register_analysis(...) × N          → specialists self-register with POSITION
9. close_round(decision="converged", evidencePaths=[...], ...)
10. produce_deliverable(kind="specification", ...)
11. approve_deliverable(path=..., approved=true)
```

### Handling disagreement

```
9. close_round(...) → refused: declared disagree vetoes "converged"
10. open_round(topic="...", participants=["dissenting-specialist"])   → subset round
11. register_analysis(...) × M
12. close_round(decision="converged-with-open-tensions", tensions=["<verbatim>"])
13. produce_deliverable → approve_deliverable
```

### Plan amendment mid-flight

```
1. (Manager edits workflow-plan.md → v2, stating the reason)
2. record_decision(type="plan-amendment", target="plan",
     reason="Scope narrowed after round r2", payload={version: 2})
3. open_round(...)   → proceeds under v2; amendment is audit-traceable
```
