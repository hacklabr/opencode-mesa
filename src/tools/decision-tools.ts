import { tool } from "@opencode-ai/plugin/tool"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, getSessionId, getDb } from "../state.js"
import { logAction } from "../audit.js"
import { successResponse, errorResponse } from "../utils/responses.js"
import {
  ensureSessionInput,
  buildSessionFolderPath,
  sanitizeSlugForFs,
  validateWorkspacePath,
} from "../utils/paths.js"
import type { DiscussionState, Deliverable, PlanPointer } from "../types.js"

/**
 * Kernel decision/deliverable tools (spec D3/D4/D6).
 *
 * Guards are DATA PRECONDITIONS — no requirePhase/requireMode. The only
 * global guard is `status == "active"` for mutations (spec D6).
 */

function activeGuard(state: DiscussionState): string | null {
  if (state.status !== "active") {
    return `Operation not allowed when session status is "${state.status}". Resume the session before proceeding.`
  }
  return null
}

function payloadString(payload: Record<string, unknown> | undefined, key: string): string | undefined {
  const value = payload?.[key]
  return typeof value === "string" && value.length > 0 ? value : undefined
}

function payloadVersion(payload: Record<string, unknown> | undefined): number | undefined {
  const value = payload?.version
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : undefined
}

// ---------------------------------------------------------------------------
// record_decision — generic audited decision (spec D3/D4). Audit entry ALWAYS;
// plan pointer side effects only for target:"plan".
// ---------------------------------------------------------------------------

export const recordDecisionTool = tool({
  description:
    "Records an audited decision. Always appends an audit entry (with planVersion). " +
    "Side effects for target='plan': type='gate' sets and approves the plan pointer (gate 0 — the only way to approve a plan); " +
    "type='plan-amendment' bumps the plan version; type='override' force-approves the plan with an explicit override marking. " +
    "Types 'delegation' and 'note' are audit-only.",
  args: {
    type: tool.schema
      .enum(["gate", "plan-amendment", "override", "delegation", "note"])
      .describe("Decision type"),
    target: tool.schema
      .string()
      .optional()
      .describe("What the decision applies to (e.g. 'plan', a deliverable path, a persona id)"),
    reason: tool.schema.string().describe("Why this decision was made — required, recorded verbatim"),
    payload: tool.schema
      .record(tool.schema.string(), tool.schema.unknown())
      .optional()
      .describe("Free-form details. For target='plan': {path: string, version?: number}"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const guardError = activeGuard(state)
      if (guardError) return errorResponse(guardError)

      const now = new Date().toISOString()
      let planSideEffect = "none (audit-only)"

      if (args.target === "plan") {
        if (args.type === "gate") {
          const path = payloadString(args.payload, "path")
          if (!path) {
            return errorResponse(
              `type="gate" target="plan" requires payload.path (the workflow-plan.md location). ` +
              `Write the plan file first, then record the gate decision with its path.`
            )
          }
          const pathCheck = validateWorkspacePath(context.directory, path)
          if (!pathCheck.valid) return errorResponse(pathCheck.error)

          state.plan = {
            path,
            version: payloadVersion(args.payload) ?? 1,
            status: "approved",
            approvedAt: now,
          } satisfies PlanPointer
          planSideEffect = `plan pointer set and APPROVED at ${path} (v${state.plan.version})`
        } else if (args.type === "plan-amendment") {
          if (!state.plan) {
            return errorResponse(
              `No plan exists to amend. Record the initial plan approval first with type="gate" target="plan".`
            )
          }
          const nextVersion = payloadVersion(args.payload) ?? state.plan.version + 1
          if (nextVersion <= state.plan.version) {
            return errorResponse(
              `Plan amendment must increase the version (current: v${state.plan.version}, got: v${nextVersion}). ` +
              `Silent replanning is the cardinal sin of this system — bump the version and state the reason.`
            )
          }
          const newPath = payloadString(args.payload, "path")
          if (newPath) {
            const pathCheck = validateWorkspacePath(context.directory, newPath)
            if (!pathCheck.valid) return errorResponse(pathCheck.error)
            state.plan.path = newPath
          }
          state.plan.version = nextVersion
          planSideEffect = `plan version bumped to v${nextVersion} (status kept: ${state.plan.status})`
        } else if (args.type === "override") {
          if (state.plan) {
            state.plan.status = "approved"
            state.plan.approvedAt = now
            planSideEffect = `plan force-approved via OVERRIDE at ${state.plan.path} (v${state.plan.version})`
          } else {
            const path = payloadString(args.payload, "path")
            if (!path) {
              return errorResponse(
                `type="override" target="plan" with no existing plan requires payload.path.`
              )
            }
            const pathCheck = validateWorkspacePath(context.directory, path)
            if (!pathCheck.valid) return errorResponse(pathCheck.error)
            state.plan = {
              path,
              version: payloadVersion(args.payload) ?? 1,
              status: "approved",
              approvedAt: now,
            }
            planSideEffect = `plan pointer created and force-approved via OVERRIDE at ${path}`
          }
        }
      }

      await saveState(context.directory, state, context.sessionID)

      // Audit ALWAYS — after side effects so planVersion reflects the
      // resulting plan state (causal ordering, spec D2 sharpening of K5).
      await logAction(
        context.directory,
        "decision_recorded",
        state.currentPhase,
        {
          type: args.type,
          target: args.target ?? null,
          reason: args.reason,
          payload: args.payload ?? null,
          planSideEffect,
          ...(args.type === "override" ? { override: true } : {}),
        },
        state.plan?.version
      )

      return successResponse(
        `Decision Recorded: ${args.type}`,
        [
          `Type: ${args.type} | Target: ${args.target ?? "(none)"}`,
          `Reason: ${args.reason}`,
          `Plan side effect: ${planSideEffect}`,
          state.plan
            ? `Plan pointer: ${state.plan.path} (v${state.plan.version}, ${state.plan.status})`
            : `Plan pointer: (none)`,
        ].join("\n"),
        { plan: state.plan }
      )
    } catch (err) {
      return errorResponse(`Error recording decision: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

// ---------------------------------------------------------------------------
// produce_deliverable — canonical artifact production (spec D2/D6).
// Absorbs generate_specification + generate_specification_overview +
// generate_phase_appendix semantics.
// ---------------------------------------------------------------------------

const DELIVERABLE_KINDS = ["specification", "overview", "journeys", "appendix", "other"] as const
type DeliverableKind = (typeof DELIVERABLE_KINDS)[number]

function buildDeliverablePath(
  sessionFolder: string,
  kind: DeliverableKind,
  topic: string
): string {
  switch (kind) {
    case "specification":
      return join(sessionFolder, "specification.md")
    case "overview":
      return join(sessionFolder, "overview.md")
    case "journeys":
      return join(sessionFolder, "journeys.md")
    case "appendix": {
      const slug = sanitizeSlugForFs(topic) || "appendix"
      const shortUuid = crypto.randomUUID().slice(0, 8)
      return join(sessionFolder, "appendices", `appendix-${slug}-${shortUuid}.md`)
    }
    case "other": {
      const slug = sanitizeSlugForFs(topic) || "deliverable"
      return join(sessionFolder, "deliverables", `${slug}.md`)
    }
  }
}

export const produceDeliverableTool = tool({
  description:
    "Produces a canonical deliverable artifact in the session folder and registers it in state.deliverables[] " +
    "with provenance (closed round ids). Precondition: at least one closed round with at least one analysis, " +
    "OR humanOverride=true (audited). Absorbs generate_specification / generate_specification_overview / generate_phase_appendix.",
  args: {
    kind: tool.schema
      .enum(DELIVERABLE_KINDS)
      .describe("Deliverable kind — determines the canonical path"),
    topic: tool.schema.string().describe("Deliverable topic/title"),
    content: tool.schema.string().describe("The complete deliverable content in Markdown"),
    humanOverride: tool.schema
      .boolean()
      .optional()
      .describe("Bypass the closed-round precondition. Audited as an override."),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const guardError = activeGuard(state)
      if (guardError) return errorResponse(guardError)

      // Data precondition (spec D6): ≥1 closed round with ≥1 analysis
      // linked to it — or an audited human override.
      const closedRounds = state.rounds.filter((r) => r.status === "closed")
      const closedRoundIds = new Set(closedRounds.map((r) => r.id))
      const hasClosedRoundWithAnalysis =
        closedRounds.length > 0 &&
        state.discussion.analyses.some((a) => a.roundId !== undefined && closedRoundIds.has(a.roundId))

      if (!hasClosedRoundWithAnalysis && !args.humanOverride) {
        return errorResponse(
          `Cannot produce a deliverable: no closed round with at least one analysis exists. ` +
          `Close a round first (close_round), or pass humanOverride=true — the override is audit-logged.`
        )
      }

      const sessionId = getSessionId(context.directory, context.sessionID)
      if (!sessionId) {
        throw new Error("No active session. Ensure loadState() was called.")
      }
      const sessionInput = await ensureSessionInput(context.directory, state, sessionId, getDb)
      const sessionFolder = state.sessionFolder ?? buildSessionFolderPath(sessionInput)

      const relPath = buildDeliverablePath(sessionFolder, args.kind, args.topic)

      // Path containment (K2): canonical paths are built inside the session
      // folder by construction — validate defensively anyway.
      const pathCheck = validateWorkspacePath(context.directory, relPath)
      if (!pathCheck.valid) return errorResponse(pathCheck.error)

      // Conflict rules: never silently overwrite an APPROVED artifact (K3);
      // a draft is replaced; a rejected one may be re-produced as a new draft.
      const existing = state.deliverables.find((d) => d.path === relPath)
      if (existing?.status === "approved") {
        return errorResponse(
          `An approved deliverable already exists at ${relPath}. Approved artifacts are immutable — ` +
          `produce a different kind/topic, or record a plan amendment instead.`
        )
      }

      const document = [
        `# ${args.kind[0].toUpperCase()}${args.kind.slice(1)}: ${args.topic}`,
        ``,
        `**Generated at:** ${new Date().toISOString()}`,
        ``,
        args.content,
      ].join("\n")

      const absPath = join(context.directory, relPath)
      await fs.mkdir(join(absPath, ".."), { recursive: true })
      await fs.writeFile(absPath, document, "utf-8")

      const provenanceRoundIds = closedRounds.map((r) => r.id)
      const entry: Deliverable = {
        path: relPath,
        kind: args.kind,
        status: "draft",
        provenance: { roundIds: provenanceRoundIds },
      }
      if (existing) {
        Object.assign(existing, entry)
      } else {
        state.deliverables.push(entry)
      }

      await saveState(context.directory, state, context.sessionID)
      await logAction(
        context.directory,
        "deliverable_produced",
        state.currentPhase,
        {
          path: relPath,
          kind: args.kind,
          topic: args.topic,
          provenanceRoundIds,
          ...(args.humanOverride && !hasClosedRoundWithAnalysis ? { override: true } : {}),
        },
        state.plan?.version
      )

      return successResponse(
        `Deliverable Produced: ${args.kind}`,
        [
          `Saved to: ${relPath}`,
          `Status: draft (approval requires approve_deliverable — the only path to approved)`,
          `Provenance: ${provenanceRoundIds.length > 0 ? `rounds [${provenanceRoundIds.join(", ")}]` : "none (humanOverride)"}`,
        ].join("\n"),
        { path: relPath, kind: args.kind, status: "draft" }
      )
    } catch (err) {
      return errorResponse(`Error producing deliverable: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

// ---------------------------------------------------------------------------
// approve_deliverable — generic human artifact gate (K3). The ONLY path to
// status "approved".
// ---------------------------------------------------------------------------

export const approveDeliverableTool = tool({
  description:
    "Marks a deliverable as approved (or rejected). This is the ONLY path to status 'approved' (K3 human trust boundary). " +
    "Precondition: a deliverable with status 'draft' exists at the given path.",
  args: {
    path: tool.schema.string().describe("Workspace-relative deliverable path (as registered in state.deliverables)"),
    approved: tool.schema.boolean().describe("Whether the human approved the deliverable"),
    feedback: tool.schema.string().optional().describe("Optional feedback/rejection reason"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      const guardError = activeGuard(state)
      if (guardError) return errorResponse(guardError)

      const pathCheck = validateWorkspacePath(context.directory, args.path)
      if (!pathCheck.valid) return errorResponse(pathCheck.error)

      const deliverable = state.deliverables.find((d) => d.path === args.path)
      if (!deliverable) {
        return errorResponse(
          `No deliverable registered at ${args.path}. ` +
          `Registered deliverables: ${state.deliverables.map((d) => `${d.path} (${d.status})`).join(", ") || "(none)"}. ` +
          `Produce it first with produce_deliverable.`
        )
      }
      if (deliverable.status !== "draft") {
        return errorResponse(
          `Deliverable at ${args.path} is already "${deliverable.status}" — only draft deliverables can be approved or rejected.`
        )
      }

      deliverable.status = args.approved ? "approved" : "rejected"
      await saveState(context.directory, state, context.sessionID)
      await logAction(
        context.directory,
        args.approved ? "deliverable_approved" : "deliverable_rejected",
        state.currentPhase,
        { path: args.path, kind: deliverable.kind, feedback: args.feedback ?? null },
        state.plan?.version
      )

      return successResponse(
        args.approved ? "Deliverable Approved" : "Deliverable Rejected",
        [
          `${args.path} is now "${deliverable.status}".`,
          ...(args.feedback ? [`Feedback: ${args.feedback}`] : []),
          ...(args.approved
            ? [`Note: human approval via chat is not sufficient — this tool (approve_deliverable) must be called explicitly to record the decision.`]
            : [`The deliverable may be re-produced as a new draft via produce_deliverable.`]),
        ].join("\n"),
        { path: args.path, status: deliverable.status }
      )
    } catch (err) {
      return errorResponse(`Error approving deliverable: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
