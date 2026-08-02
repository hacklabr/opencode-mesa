# Troubleshooting

Common issues and solutions for the Mesa plugin.

## Mesa tools not appearing

**Symptom**: After installing Mesa, none of the 24 tools (e.g. `mesa_status`, `create_briefing`) are available in OpenCode.

**Solution**: Verify plugin registration in your project's `opencode.json`:

```json
{
  "plugin": ["file:///home/YOURUSER/.local/share/opencode-mesa/dist/index.js"]
}
```

- Ensure the path points to `dist/index.js` (not `src/index.ts`).
- Restart OpenCode after editing `opencode.json`.
- Run `mesa_status` to confirm the plugin is loaded.

## Agent not switching after briefing approval

**Symptom**: After calling `approve_briefing`, the active agent is still `briefing-writer` instead of `manager`.

**Solution**: This is expected behavior. `approve_briefing` approves the briefing and hands it to the Manager, but Mesa never switches agents for you. Manually switch with:

```
/agent manager
```

The Manager agent will then pick up the briefing and proceed with team proposal.

## `open_round` refuses: no approved workflow plan

**Symptom**: `open_round` fails with a plan-gate error, or `mesa_status` shows a "No approved workflow plan" instruction.

**Solution**: The plan gate (gate 0) has not been satisfied. The Manager must:

1. Write `workflow-plan.md` in the session folder (`.mesa/sessions/<id>/`).
2. Present it to the human for approval.
3. Record the approval:

```
record_decision(type="gate", target="plan",
  reason="Human approved workflow plan",
  payload={path: ".mesa/sessions/<id>/workflow-plan.md"})
```

This is the **only** path to an approved plan. Verbal approval in chat is not sufficient — `open_round` reads the plan pointer in state, not the conversation.

If the plan needs to change mid-flight, edit the file and record `record_decision(type="plan-amendment", target="plan", payload={version: <n+1>})`. The version must strictly increase — silent replanning is a violation, and version bumps make unlogged amendments detectable.

## LEGACY SESSION — no approved plan

**Symptom**: `mesa_status` or `open_round` shows:

```
LEGACY SESSION — no approved plan.
This session was migrated from the old pipeline; its workflow was approved under rules that no longer exist.
```

**Cause**: The session was created before the flexibilization refactor (state migrated to v14/v15 — its `rounds[]` contains a `legacy-*` round). The old phase-pipeline workflow was approved under rules that no longer exist, so Mesa will not silently adopt a synthesized plan — that would violate the plan gate retroactively.

**Solution**: The Manager must:

1. Synthesize a `workflow-plan.md` mapping existing artifacts (rounds, analyses, deliverables) to the remaining steps — no perfect phase translation is required, just the next steps.
2. **Present it to the human as a plan gate** — the workflow agreement changed mid-flight, so human consent is required again.
3. Record the approval via `record_decision(type="gate", target="plan", payload={path})`.

After that, `open_round` works normally.

## Specialist gets a `<specialist-setup-error>` notice

**Symptom**: A delegated specialist responds that it received a setup error instead of a persona.

**Cause**: The persona was not resolved by the `tool.execute.before` hook. Persona resolution order:

1. `task_id="ses_..."` — session resumption (persona already in history).
2. **Inline persona block (primary path)** — a `<specialist-persona id="...">` block in the prompt. Required on runtimes that reject non-`ses_` task IDs.
3. `task_id="mesa-{personaId}"` — the slug path; the hook injects the persona from the catalog on runtimes that accept it.

**Solution**:

- If the runtime rejects `task_id="mesa-..."`, the Manager must **inline the persona**: include the full `<specialist-persona id="..." name="...">...</specialist-persona>` block (from `get_specialist`) directly in the task prompt.
- If the error says the persona ID was not found, run `list_specialists` to get a valid ID and retry.
- Note: if the specialist session shows both a setup-error banner **and** an injected persona, the injection actually succeeded — the banner is a stale artifact of the fallback path; the specialist should proceed.

## `close_round` refuses: declared POSITION missing

**Symptom**: `close_round` fails with "declared POSITION missing for: ...".

**Solution**: Every participant must have ≥1 analysis **self-registered from its own session** whose file contains a lexical block:

```
POSITION: agree | agree-with-reservations | disagree — [reason]
```

Common causes:

- The analysis was registered with `registered_by_manager=true` — these **never** satisfy the gate (that would let the Manager write the specialist's position). Re-invoke the specialist and have it self-register.
- The analysis content was registered inline but no `file_path` was set, or the file lacks the POSITION block. Ensure the specialist's final artifact ends with the block.
- If the human decides to close anyway, call `close_round` with `humanOverride: true` (recorded in the audit log). Note: `humanOverride` does **not** bypass the `evidencePaths[]` requirement.

## `close_round` refuses: "converged" vetoed by declared disagree

**Symptom**: `close_round(decision="converged", ...)` fails because a participant declared `disagree`.

**Solution**: This is a load-bearing rule, not a bug. Three legal moves:

1. Open a **subset round** with exactly the dissenting participants: `open_round(topic=..., participants=["dissenter-id"])`.
2. Close as `converged-with-open-tensions`, copying the tension **verbatim** into `tensions[]` so it reaches the deliverable and the human.
3. Close as `escalated` — the human is the only judge of content.

## `produce_deliverable` refuses: no closed round

**Symptom**: `produce_deliverable` fails with "no closed round with at least one analysis exists".

**Solution**: Close a round first (`close_round`). Deliverables must trace to executed deliberation. If the human authorizes skipping this, pass `humanOverride: true` — the override is audit-logged.

## State database issues

**Symptom**: Tools fail with state errors, or `.mesa/state.db` appears corrupted.

**Solution**:

1. Check that `.mesa/state.db` exists and is writable.
2. Inspect the schema:
   ```bash
   sqlite3 .mesa/state.db ".tables"
   ```
3. As a last resort, delete `.mesa/state.db` — Mesa recreates it with the current schema (v15) on the next tool call. This clears session state but preserves Markdown artifacts (briefings, plans, analyses, deliverables) under `.mesa/sessions/`.

Legacy `.mesa/state.json` files are migrated to SQLite automatically on first load.

## Session inactive after pause/cancel

**Symptom**: Tool calls fail with `Operation not allowed when discussion status is "paused"` (or `"cancelled"`).

**Solution**: All mutating tools require status `active`.

- If paused: call `resume_discussion()`. The Manager should then follow the resume ritual — re-read the plan and round trace, and declare its position ("Plan v2: r1–r3 closed, r4 open. Next: X") before any other action.
- If cancelled: analysis data was cleared, but briefing, team, and deliverables are preserved. Start a new session to continue.

## Tests failing

**Symptom**: Test suite fails with import errors or missing modules.

**Solution**:

```bash
bun install
bun run build   # at least once
bun test
```

Common issues:

- **Import errors**: Ensure `bun run build` has been run at least once.
- **State file conflicts**: Tests use a temporary directory under `/tmp/`. If tests fail with permission errors, check `/tmp` write access.
- **Snapshot mismatches**: Delete `src/__tests__/__snapshots__/` and re-run.
