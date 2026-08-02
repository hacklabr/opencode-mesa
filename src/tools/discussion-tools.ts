import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState, getSessionId, getDb, findRootSessionId } from "../state.js"
import type { AnalysisEntry, AnalysisKind, AnalysisTurnType } from "../types.js"
import { formatPhaseHeader } from "../workflow/transitions.js"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { logAction } from "../audit.js"
import { successResponse, errorResponse } from "../utils/responses.js"
import {
  buildAnalysisPath,
  ensureSessionInput,
  validateWorkspacePath,
} from "../utils/paths.js"
import { recordAgentSession } from "./peer-tools.js"
import { MesaError } from "../errors.js"
import { MAX_ANALYSES_PER_ROUND } from "../config.js"

/**
 * Surviving discussion kernel tools (spec D5): register_analysis,
 * get_peer_analyses, pause/resume/cancel. Data preconditions only (D6).
 */

function statusGuard(state: { status: string }): string | null {
  if (state.status !== "active") {
    return `Operation not allowed when discussion status is "${state.status}". Resume the discussion before proceeding.`
  }
  return null
}

/**
 * Matches an agent_id against a list of known participants by suffix.
 * Handles cases where subagents return IDs without their division prefix.
 * e.g., "ux-researcher" matches "design-ux-researcher"
 */
function matchParticipant(agentId: string, participants: string[]): string | null {
  if (participants.includes(agentId)) return agentId
  const match = participants.find(p => p.endsWith(agentId) || agentId.endsWith(p))
  return match ?? null
}

export const registerAnalysisTool = tool({
  description:
    "Registers an analysis from a specialist in the open round. Call after each specialist completes their analysis. " +
    "Accepts optional filePath (canonical .md location), kind (full|delta), and turnType (analysis|discussion). " +
    "Use registered_by_manager=true when the Manager must record the analysis because the specialist failed to self-register.",
  args: {
    agent_id: tool.schema.string().describe("Specialist persona ID"),
    agent_name: tool.schema.string().describe("Specialist display name"),
    content: tool.schema.string().describe("The analysis content (FULL, never truncated)"),
    turn: tool.schema.number().describe("Current turn number (1-based)"),
    file_path: tool.schema.string().optional().describe("Optional: workspace-relative path to the canonical .md file"),
    kind: tool.schema.enum(["full", "delta"]).optional().describe("Analysis kind: 'full' (default) or 'delta'. Delta requires a prior full for the same agent."),
    turn_type: tool.schema.enum(["analysis", "discussion"]).optional().describe("Turn type: 'analysis' (default) or 'discussion'"),
    round: tool.schema.number().optional().describe("Legacy discussion-round number (only when turn_type='discussion')"),
    position_in_turn: tool.schema.number().optional().describe("Speaking order, 1-based (only when turn_type='discussion')"),
    responds_to: tool.schema.string().optional().describe("Agent ID being addressed (discussion only)"),
    session_resumed: tool.schema.boolean().optional().describe("Whether the specialist session was resumed (memory-integrity flag)"),
    session_id: tool.schema
      .string()
      .optional()
      .describe(
        "Optional Manager session ID override. Specialists can pass this to ensure the analysis is stored in the Manager's session folder. " +
        "If omitted, Mesa resolves the Manager session automatically from the subagent's parent session chain."
      ),
    registered_by_manager: tool.schema.boolean().optional().describe(
      "Set to true when the Manager registers the analysis because the specialist failed to call register_analysis. " +
      "Disables ask_peer session capture for this entry and flags the entry as a fallback registration. " +
      "NOTE: such entries do NOT count as declared positions for close_round (spec D3)."
    ),
    reason: tool.schema
      .string()
      .optional()
      .describe("Optional free-form reason recorded in the audit log (e.g., extra turn beyond the plan)."),
  },
  async execute(args, context) {
    try {
      // Determine the session ID that owns the discussion state.
      // 1. Explicit override from the specialist (Manager-provided session_id).
      // 2. Root-session resolution: a subagent's context.sessionID has a
      //    parentID pointing back to the Manager session. Mesa walks that
      //    chain automatically so analyses land in the shared session folder.
      // 3. Fallback to the caller's own context.sessionID.
      const opencodeSessionId = args.session_id ?? context.sessionID
      const state = await loadState(context.directory, opencodeSessionId)

      // Resolve the Manager/root session ID for path computation. This is the
      // ID whose session folder will hold the analysis file.
      let managerSessionID = opencodeSessionId
      if (!args.session_id && opencodeSessionId) {
        try {
          const db = getDb(context.directory)
          try {
            const rootId = await findRootSessionId(db, context.directory, opencodeSessionId)
            if (rootId) managerSessionID = rootId
          } finally {
            db.close()
          }
        } catch {
          // Root resolution failed (e.g. OpenCode rejected the subagent ID).
          // Keep using the caller's own session ID — best-effort behavior.
        }
      }

      const statusError = statusGuard(state)
      if (statusError) throw new MesaError(statusError, "INACTIVE_SESSION")

      // Data precondition (D6): analyses belong to the OPEN round, and only
      // round participants may register.
      const openRound = state.rounds.find((r) => r.status === "open")
      if (!openRound) {
        return errorResponse(
          `No open round to register an analysis into. Open one with open_round first.`
        )
      }

      const participants = openRound.participants
      const matchedId = matchParticipant(args.agent_id, participants)
      if (!matchedId) {
        return errorResponse(
          `${args.agent_name} (${args.agent_id}) is not a participant in round ${openRound.id}. ` +
          `Participants: ${participants.join(", ")}. ` +
          `Only the human-approved cast of the round can speak — ask the human about changing the team.`
        )
      }

      if (args.turn < 1) {
        return errorResponse(`Turn must be 1 or greater. Got: ${args.turn}.`)
      }

      const turnType: AnalysisTurnType = args.turn_type ?? "analysis"

      // Dedup — scoped to the open round (the v15 UNIQUE constraint includes round_id).
      const effectiveId = matchedId
      const existing = state.discussion.analyses.find(
        (a) => a.agentId === effectiveId && a.turn === args.turn
          && (a.turnType ?? "analysis") === turnType
          && a.roundId === openRound.id
      )
      if (existing) {
        return errorResponse(`Analysis already registered for ${args.agent_name} turn ${args.turn} (${turnType}) in round ${openRound.id}.`)
      }

      // Circuit breaker (K4): per-round analysis budget.
      const roundAnalysisCount = state.discussion.analyses.filter(
        (a) => a.roundId === openRound.id
      ).length
      if (roundAnalysisCount >= MAX_ANALYSES_PER_ROUND) {
        return errorResponse(
          `Round analysis budget exhausted (${roundAnalysisCount}/${MAX_ANALYSES_PER_ROUND} in round ${openRound.id}). ` +
          `This is a circuit breaker against runaway turns. Close the round or escalate to the human.`
        )
      }

      // P1-T4: Path-traversal validation for file_path
      // P1-2: If file_path not provided, compute canonical path via buildAnalysisPath
      let validatedFilePath: string | null = null
      if (args.file_path) {
        const pathCheck = validateWorkspacePath(context.directory, args.file_path)
        if (!pathCheck.valid) {
          return errorResponse(pathCheck.error)
        }
        validatedFilePath = args.file_path
      } else {
        // Compute canonical session-scoped path so get_peer_analyses always
        // has a valid filePath (spec-6886df4f).
        const mesaSessionId = getSessionId(context.directory, managerSessionID)
        if (mesaSessionId) {
          const sessionInput = await ensureSessionInput(
            context.directory, state, mesaSessionId, getDb
          )
          validatedFilePath = buildAnalysisPath(sessionInput, args.turn, effectiveId)
        }
      }

      // Determine kind (default "full").
      const kind: AnalysisKind = args.kind ?? "full"

      // P1-T3: Validation gate — kind="delta" requires a prior full for same agentId
      if (kind === "delta") {
        const hasFullPrior = state.discussion.analyses.some(
          (a) => a.agentId === effectiveId && (a.kind ?? "full") === "full"
        )
        if (!hasFullPrior) {
          return errorResponse(
            `Cannot register delta without a prior full analysis for ${args.agent_name}. ` +
            `Register a full analysis first, or use kind="full".`
          )
        }
      }

      const entry: AnalysisEntry = {
        agentId: effectiveId,
        agentName: args.agent_name,
        content: args.content,
        filePath: validatedFilePath,
        kind,
        turn: args.turn,
        turnType,
        round: args.round,
        // v14 (spec D2): analyses always link to the open round.
        roundId: openRound.id,
        positionInTurn: args.position_in_turn,
        respondsTo: args.responds_to,
        sessionResumed: args.session_resumed,
        registeredByManager: args.registered_by_manager ?? false,
        timestamp: new Date().toISOString(),
      }

      state.discussion.analyses.push(entry)

      // Write the analysis content to the FS file — atomic with SQLite insert.
      // This makes register_analysis the single point of truth for both storage layers.
      if (validatedFilePath) {
        const absFilePath = join(context.directory, validatedFilePath)
        try {
          await fs.mkdir(join(absFilePath, ".."), { recursive: true })
          await fs.writeFile(absFilePath, args.content, "utf-8")
        } catch {
          // FS write is best-effort — SQLite is the primary store
        }
      }

      await saveState(context.directory, state, managerSessionID)

      // P1-4: Audit logging for register_analysis
      await logAction(context.directory, "analysis_registered", state.currentPhase, {
        agentId: effectiveId,
        turn: args.turn,
        kind,
        turnType,
        roundId: entry.roundId ?? null,
        filePath: validatedFilePath,
        reason: args.reason,
        registeredByManager: args.registered_by_manager ?? false,
      })

      // Track the specialist's OpenCode session ID for ask_peer contamination.
      // When another specialist calls ask_peer, the question goes to THIS session.
      // Skip when the Manager registered on behalf of the specialist — the
      // Manager's session must not become the peer consultation target.
      if (context.sessionID && !args.registered_by_manager) {
        recordAgentSession(effectiveId, context.sessionID)
      }

      const total = participants.length
      const current = state.discussion.analyses.filter(
        (a) => a.roundId === openRound.id && a.turn === args.turn
      ).length

      // BUG-20: Content preview for human observability
      const contentPreview = args.content.length > 300
        ? args.content.slice(0, 300) + "..."
        : args.content

      const header = formatPhaseHeader(state.currentPhase, {
        topic: openRound.topic,
        currentTurn: args.turn,
        maxTurns: state.discussion.maxTurns,
        participants,
        analysesCount: current,
      })

      // Soft warning for out-of-order registration
      let warning = ""
      const participantIndex = participants.indexOf(effectiveId)
      if (participantIndex > 0) {
        const registeredThisTurn = new Set(
          state.discussion.analyses
            .filter((a) => a.roundId === openRound.id && a.turn === args.turn)
            .map((a) => a.agentId)
        )
        const skipped = participants
          .slice(0, participantIndex)
          .filter((id) => !registeredThisTurn.has(id))

        if (skipped.length > 0) {
          warning = `\n\nNote: ${skipped.join(", ")} have not registered yet for turn ${args.turn}. Consider waiting for their analyses.`
        }
      }

      const nextStep = current < total
        ? `Next: Register analysis from the next participant for turn ${args.turn}.`
        : `All ${total} participants registered for turn ${args.turn}. When the round has converged, call close_round with the outcome (each participant's final artifact must contain a POSITION block).`

      return successResponse(
        `Analysis Registered: ${args.agent_name}`,
        [
          header,
          ``,
          `Specialist ${args.agent_name} completed turn ${args.turn} in round ${openRound.id}.`,
          `Progress: ${current}/${total} analyses for turn ${args.turn}.`,
          warning,
          ``,
          `## Analysis Preview`,
          contentPreview,
          ``,
          nextStep,
        ].join("\n")
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error registering analysis: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

// ---------------------------------------------------------------------------
// get_peer_analyses — read-only tool for discovering analysis file paths
// ---------------------------------------------------------------------------

export const getPeerAnalysesTool = tool({
  description:
    "Returns analysis file paths and metadata. Read-only. " +
    "Use this to discover which peer analyses exist and their file paths before constructing " +
    "delegation prompts for subsequent turns or rounds.",
  args: {
    turn: tool.schema.number().optional().describe("Filter by turn number. If omitted, returns all turns."),
    agent_id: tool.schema.string().optional().describe("Filter by specialist agent ID."),
    round_id: tool.schema.string().optional().describe("Filter by round ID (e.g. 'r1'). Defaults to the open round when one exists, otherwise all rounds."),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)

      let analyses = state.discussion.analyses

      const roundFilter = args.round_id ?? state.rounds.find((r) => r.status === "open")?.id
      if (roundFilter) {
        analyses = analyses.filter((a) => a.roundId === roundFilter)
      }
      if (args.turn !== undefined) {
        analyses = analyses.filter((a) => a.turn === args.turn)
      }
      if (args.agent_id) {
        const matchedId = matchParticipant(args.agent_id, state.discussion.participants)
        const filterId = matchedId ?? args.agent_id
        analyses = analyses.filter((a) => a.agentId === filterId)
      }

      const results = analyses.map((a) => {
        const contentPreview = a.content.length > 300
          ? a.content.slice(0, 300) + "..."
          : a.content
        return {
          agentId: a.agentId,
          agentName: a.agentName,
          filePath: a.filePath,
          kind: a.kind ?? "full",
          turnType: a.turnType ?? "analysis",
          turn: a.turn,
          roundId: a.roundId,
          contentPreview,
          reconciled: false as boolean,
        }
      })

      // P1 security: file-existence validation — flag missing files
      for (const r of results) {
        if (r.filePath) {
          const absPath = join(context.directory, r.filePath)
          try {
            await fs.access(absPath)
          } catch {
            r.reconciled = true // file missing, content falls back to SQLite
          }
        }
      }

      const tableRows = results.map((r) =>
        `| ${r.agentName} | ${r.roundId ?? "-"} | turn ${r.turn} | ${r.kind} | ${r.turnType} | ${r.filePath ?? "(inline)"} |${r.reconciled ? " ⚠️ missing" : ""}|`
      )

      const table = [
        `| Specialist | Round | Turn | Kind | Type | File | Status |`,
        `|------------|-------|------|------|------|------|--------|`,
        ...tableRows,
      ].join("\n")

      const reconciledNote = results.some((r) => r.reconciled)
        ? `\n\n⚠️ Some files are missing. Content preview from SQLite is shown instead. Re-run the specialist or write the file manually.`
        : ""

      return successResponse(
        "Peer Analyses",
        [
          `${formatPhaseHeader(state.currentPhase, { topic: state.discussion.topic })}`,
          ``,
          `Found ${results.length} analysis entry(ies).`,
          ``,
          table,
          reconciledNote,
        ].join("\n"),
        { analyses: results, count: results.length }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error retrieving peer analyses: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

// ---------------------------------------------------------------------------
// Lifecycle: pause / resume / cancel — status-field only (spec: legacy compat)
// ---------------------------------------------------------------------------

export const pauseDiscussionTool = tool({
  description: "Pauses the current session. State is preserved for later resumption.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      if (state.status === "cancelled") {
        return errorResponse("Cannot pause a cancelled session.")
      }
      state.status = "paused"
      await saveState(context.directory, state, context.sessionID)
      await logAction(context.directory, "discussion_paused", state.currentPhase)

      return successResponse(
        "Discussion Paused",
        `${formatPhaseHeader(state.currentPhase)}\n\nSession paused. Use resume_discussion to resume.`
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error pausing discussion: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const resumeDiscussionTool = tool({
  description: "Resumes a paused session.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      if (state.status !== "paused") {
        return errorResponse(`Discussion is not paused. Current status: ${state.status}`)
      }

      state.status = "active"
      await saveState(context.directory, state, context.sessionID)
      await logAction(context.directory, "discussion_resumed", state.currentPhase)

      return successResponse(
        "Discussion Resumed",
        `${formatPhaseHeader(state.currentPhase)}\n\nSession resumed. Re-orient before acting: read the workflow plan and the round trace, and declare your position out loud.`
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error resuming discussion: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const cancelDiscussionTool = tool({
  description: "Cancels the current session and clears analysis data.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      state.status = "cancelled"
      state.discussion.analyses = []
      state.discussion.currentTurn = 0
      await saveState(context.directory, state, context.sessionID)
      await logAction(context.directory, "discussion_cancelled", state.currentPhase)

      return successResponse(
        "Discussion Cancelled",
        `${formatPhaseHeader(state.currentPhase)}\n\nThe session has been cancelled and analysis data cleared.`
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error cancelling discussion: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
