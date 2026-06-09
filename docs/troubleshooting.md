# Troubleshooting

Common issues and solutions for the Mesa plugin.

## Mesa tools not appearing

**Symptom**: After installing Mesa, none of the 21 tools (e.g. `mesa_status`, `create_briefing`) are available in OpenCode.

**Solution**: Verify plugin registration in your project's `opencode.json`:

```json
{
  "plugin": ["file:///home/YOURUSER/.local/share/opencode-mesa/dist/index.js"]
}
```

- Ensure the path points to `dist/index.js` (not `src/index.ts`).
- Restart OpenCode after editing `opencode.json`.
- Run `mesa_status` to confirm the plugin is loaded.

## Agent not switching after briefing delivery

**Symptom**: After calling `deliver_briefing`, the active agent is still `briefing-writer` instead of `manager`.

**Solution**: This is expected behavior. `deliver_briefing` transitions the state to `PLANNING` but does not auto-switch agents. Manually switch with:

```
/agent manager
```

The Manager agent will then pick up the briefing and proceed with team proposal.

## State file corrupted

**Symptom**: Tools fail with parse errors or unexpected state, or `.mesa/state.json` contains malformed JSON.

**Solution**: Mesa automatically creates a backup (`.mesa/state.json.bak`) on every state save. On load, if `state.json` is corrupted, Mesa recovers from the backup automatically.

- Check `.mesa/state.json.bak` — if it exists and is valid, Mesa will use it.
- If both files are corrupted, delete `.mesa/state.json` and `.mesa/state.json.bak`. Mesa will create a fresh state on the next tool call.
- `.tmp` files from interrupted writes are cleaned up on startup.

## Discussion stuck in wrong phase

**Symptom**: A tool call fails with a phase mismatch error, or the discussion appears stuck.

**Solution**:

1. Run `mesa_status` to see the current phase and state summary.
2. If you need to step back, use `pause_discussion` to pause.
3. Then use `resume_discussion(target_phase="TARGET_PHASE")` to resume at the desired phase.
4. As a last resort, use `cancel_discussion` to reset (preserves briefing and team, clears analyses).

## Cannot restart after cancellation

**Symptom**: After calling `cancel_discussion`, you want to restart but are unsure how.

**Solution**: `CANCELLED` state now transitions to `PLANNING` on restart. Use `resume_discussion(target_phase="PLANNING")` or call any PLANNING-phase tool (e.g. `open_analysis_round` with `force=true`). The briefing and team are preserved from the previous run.

## Specialist not found in team

**Symptom**: `delegate_task` fails because the specialist was not part of the summoned team.

**Solution**: In `EXECUTION` phase, `delegate_task` supports a **catalog fallback** — it accepts any specialist from the full catalog, not just those on the summoned team. If the `personaId` matches a catalog entry, the tool will succeed even if the specialist was not part of the original team proposal.

## Tests failing

**Symptom**: Test suite fails with import errors or missing modules.

**Solution**:

```bash
# Ensure dependencies are installed
bun install

# Run tests
~/.bun/bin/bun test src/__tests__/

# Or via npm script
bun test
```

Common issues:
- **Import errors**: Ensure `bun run build` has been run at least once.
- **State file conflicts**: Tests use a temporary directory under `/tmp/`. If tests fail with permission errors, check `/tmp` write access.
- **Snapshot mismatches**: Delete `src/__tests__/__snapshots__/` and re-run.

## Phase analysis issues

### No phases detected in approved specification

**Symptom**: `check_execution_phases` reports "No Execution Plan Detected" even though the specification clearly contains phases.

**Solution**: Phase detection uses a three-tier strategy:

1. **YAML frontmatter**: Add an `execution_plan` key to the spec's frontmatter for reliable detection:
   ```yaml
   ---
   execution_plan:
     - "Foundation"
     - "Core Tools"
     - "Manager Integration"
   ---
   ```

2. **Markdown headings**: Use `## Phase N: Name` syntax:
   ```markdown
   ## Phase 1: Foundation
   ## Phase 2: Core Tools
   ```

3. **Heuristics**: Ensure "Phase N" or "Step N" appears in headings or bold text.

If the spec is analysis-only (keywords: "audit report", "recommendations", "assessment only"), phase detection is intentionally bypassed.

### Appendix not found during task delegation

**Symptom**: `delegate_task` with `phase_name` does not prepend the appendix to the specialist's context.

**Solution**:

1. Verify the appendix exists: check `.mesa/specifications/appendices/` for files matching the phase slug.
2. Verify the appendix is indexed: `mesa_status` should show `appendices` in the state summary.
3. Check the phase name slugification: `delegate_task` converts the phase name to a slug (lowercase, hyphens). Ensure the appendix filename contains this slug.

The resolution order is:
1. `state.appendices` array
2. Scan `.mesa/specifications/appendices/` directory

### Phase analysis round fails to open

**Symptom**: `open_phase_analysis_round` returns "Phase analysis can only be opened during EXECUTION phase."

**Solution**: Phase analysis is a sub-workflow within `EXECUTION`. Ensure:

1. The specification has been approved (`approve_specification(approved=true)`).
2. The current phase is `EXECUTION` (check with `mesa_status`).
3. If stuck in a different phase, use `resume_discussion(target_phase="EXECUTION")` or restart.

### Consensus not reached for a phase

**Symptom**: `request_phase_consensus` returns "Phase Consensus Not Reached".

**Solution**: This is expected behavior when specialists disagree. The Manager should:

1. Review the vote summary to identify points of disagreement.
2. Open a debate round by asking dissenting specialists for additional analysis.
3. Call `register_analysis` for the dissenting specialists.
4. Call `request_phase_consensus` again with the new votes.

If consensus remains elusive after multiple rounds, the Manager may proceed with the majority view and document reservations in the appendix's `Consensus Outcome` section.

### State version mismatch after update

**Symptom**: `loadState` logs a warning: "State version mismatch: db=1, current=2."

**Solution**: This is a normal message after upgrading Mesa. The automatic migration (`migrate_v1_to_v2`) should handle it. If tools fail:

1. Check that `.mesa/state.db` exists and is writable.
2. Verify the `mesa_phase_context` table exists:
   ```bash
   sqlite3 .mesa/state.db ".tables"
   ```
3. If the table is missing, the migration may have failed. Delete `.mesa/state.db` and `.mesa/state.db.bak` — Mesa will recreate the database with the correct schema on the next tool call. Note: this clears state but preserves briefings and specifications.

## Performance

### Phase analysis is slow

**Symptom**: Iterative phase analysis takes a long time, especially in guided mode.

**Mitigation**:

- Use **automatic mode** for straightforward phases.
- Select only the phases that truly need deep analysis (e.g., "1, 3" instead of "all").
- Phases are analyzed **sequentially** by design. This reduces cost unpredictability and state complexity.
- The p95 latency target for a single phase analysis round is 5 minutes. If consistently exceeded, instrument with `audit.log` timestamps and consider parallel execution in a future release.
