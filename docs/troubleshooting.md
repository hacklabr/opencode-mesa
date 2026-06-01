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
