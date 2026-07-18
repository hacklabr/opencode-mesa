# Global Execution Guidelines

These rules apply to every task you receive, regardless of your specialty. They govern *how* you deliver work, not *what* you deliver.

## Default to Parallel Execution

When you receive a multi-step task, first ask: "Can these steps run in parallel?"

- **If yes**: split the work into independent subtasks and delegate each one to a focused subagent via the `task` tool. Run the delegations in the same turn. Do not wait for one to finish before starting the next.
- **If no**: document the dependency chain explicitly and execute only the dependent steps sequentially.

## Split Work by Boundary, Not by Layer

Divide tasks so that each subagent owns a clear, non-overlapping boundary:

- **File boundary** — one subagent edits `auth.ts`, another edits `billing.ts`, never both editing the same file.
- **Module boundary** — one subagent owns the API layer, another owns the database layer, another owns the UI layer.
- **Feature boundary** — one subagent implements user registration, another implements password reset.
- **Region boundary** — one subagent refactors the northern-region report, another refactors the southern-region report.

Avoid splits where two subagents must later merge changes in the same function, component, or configuration block.

## Define Interfaces Before Parallel Work Starts

Before delegating parallel subtasks, specify:

1. **Inputs** — what each subagent receives (file paths, schemas, contracts).
2. **Outputs** — what each subagent must produce (file paths, formats, tests).
3. **Invariants** — what no subagent is allowed to change (shared constants, public APIs, database conventions).
4. **Integration point** — who combines the results and how conflicts are resolved.

If you cannot define these interfaces, the work is not ready to be parallelized.

## Avoid Editing Collisions

- Never assign two subagents to modify the same file, function, class, table, route, or configuration key at the same time.
- If a shared file must change, designate a single owner for that file and have other subagents produce snippets or specifications that the owner integrates.
- Before writing, check whether another subagent is already touching the same area. If unsure, ask the Manager or serialize the work.

## Prefer Independent `task` Calls

When delegating parallel work, issue multiple `task` calls in a single response. Each call should be self-contained and able to proceed without waiting for the others.

Example:

```
task(subagent_type="mesa/software-development-backend-architect", task_id="mesa-api-design", prompt="Design the REST contract for /orders...")
task(subagent_type="mesa/software-development-database-administrator", task_id="mesa-db-schema", prompt="Design the PostgreSQL schema for orders...")
task(subagent_type="mesa/software-development-frontend-developer", task_id="mesa-ui-orders", prompt="Build the order list UI component...")
```

After all parallel tasks complete, integrate their outputs in a follow-up step.

## When You Are the Subagent

If you receive a task that is large enough to split:

1. Propose the split to the Manager (or execute it directly if the split is obvious and safe).
2. Identify which parts are independent.
3. Delegate each independent part to the most appropriate specialist.
4. Collect results, verify consistency, and integrate.

Do not try to do everything yourself when parallel help is available.

## Final Integration Is a Separate Step

Parallel work always ends with one agent — usually you or the Manager — reviewing all outputs and merging them into a coherent result. This step is not optional. Verify that:

- No two subagents changed the same file.
- Contracts and interfaces align.
- Tests pass for the combined work.
- No invariant was violated.

## Document Deviations

If you cannot parallelize work that looks parallelizable, record why. The Manager needs this information to improve the execution plan.
