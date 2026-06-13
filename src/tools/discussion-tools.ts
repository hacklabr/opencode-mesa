import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState, getSessionId } from "../state"
import type { DiscussionPhase, ConsensusVote, AnalysisEntry, ConsensusVoteEntry } from "../types"
import { canTransition, VALID_TRANSITIONS, requirePhase, formatPhaseHeader, ALL_PHASES } from "../workflow/transitions"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { PLUGIN_STATE_DIR } from "../config"
import { logAction } from "../audit"
import { successResponse, errorResponse } from "../utils/responses"
import { PhaseError, MesaError } from "../errors"

const MAX_TOTAL_CHARS = 400000

function transitionPhase(
  current: DiscussionPhase,
  target: DiscussionPhase
): { ok: true; phase: DiscussionPhase } | { ok: false; error: string } {
  if (!canTransition(current, target)) {
    return {
      ok: false,
      error: `Invalid transition: ${current} → ${target}. Allowed: ${VALID_TRANSITIONS[current]?.join(", ") ?? "none"}`,
    }
  }
  return { ok: true, phase: target }
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

export const openAnalysisRoundTool = tool({
  description:
    "Opens a structured analysis round. The Manager defines the topic, participants (ordered), max turns, and the briefing content to analyze.",
  args: {
    topic: tool.schema.string().describe("The discussion topic"),
    participants: tool.schema
      .array(tool.schema.string())
      .describe("Ordered array of specialist persona IDs participating in the round"),
    max_turns: tool.schema
      .number()
      .optional()
      .describe("Maximum number of turns per specialist (default: 2)"),
    briefing_content: tool.schema
      .string()
      .optional()
      .describe("Briefing content for specialists to analyze"),
    force: tool.schema
      .boolean()
      .optional()
      .describe("Force re-open even if analyses already exist (default: false)"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)
      const sessionId = getSessionId(context.directory)
      if (!sessionId) {
        throw new Error("No active session. Ensure loadState() was called.")
      }

      const phaseError = requirePhase(state, "PLANNING")
      if (phaseError) throw new PhaseError(phaseError)

      // BUG-12: Clean up orphan briefing file from previous round
      const oldBriefingPath = join(context.directory, PLUGIN_STATE_DIR, `briefing-for-discussion-${sessionId}.md`)
      try {
        await fs.unlink(oldBriefingPath)
      } catch {
        // file may not exist — that's fine
      }

      const existingAnalyses = state.discussion.analyses.length
      const existingVotes = state.discussion.votes.length
      if ((existingAnalyses > 0 || existingVotes > 0) && !args.force) {
        return errorResponse(
          `Warning: This will clear ${existingAnalyses} existing analyses and ${existingVotes} votes. Set force=true to proceed.`
        )
      }

      // BUG-08: Validate participants against summoned team
      const unknownParticipants = args.participants.filter(
        (id) => !state.team.some((t) => t.personaId === id)
      )
      if (unknownParticipants.length > 0) {
        return errorResponse(
          `Unknown participants not in team: ${unknownParticipants.join(", ")}. ` +
          `Summon them first with summon_team.`
        )
      }

      const result = transitionPhase(state.currentPhase, "ANALYSIS")
      if (!result.ok) throw new PhaseError(result.error)

      state.currentPhase = result.phase
      state.discussion.topic = args.topic
      state.discussion.currentTurn = 1
      state.discussion.maxTurns = args.max_turns ?? 2

      if (args.force && (existingAnalyses > 0 || existingVotes > 0)) {
        await logAction(context.directory, "analysis_round_force_cleared", state.currentPhase, {
          clearedAnalyses: existingAnalyses,
          clearedVotes: existingVotes,
          newTopic: args.topic,
        })
      }

      state.discussion.analyses = []
      state.discussion.votes = []
      state.discussion.consensusRound = 0
      state.discussion.participants = args.participants
      state.discussion.debateNeeded = false
      state.specification = { path: null, status: "pending" }

      if (args.briefing_content) {
        const briefingFile = join(
          context.directory,
          PLUGIN_STATE_DIR,
          `briefing-for-discussion-${sessionId}.md`
        )
        await fs.writeFile(briefingFile, args.briefing_content, "utf-8")
        await logAction(context.directory, "briefing_for_discussion_written", state.currentPhase, { path: briefingFile })
      }

      await saveState(context.directory, state)
      await logAction(context.directory, "analysis_round_opened", state.currentPhase, { topic: args.topic })

      const participantsWithNames = args.participants.map((id) => {
        const name = state.team.find((t) => t.personaId === id)?.name ?? id
        return { id, name }
      })

      const briefingFilePath = args.briefing_content
        ? `.mesa/briefing-for-discussion-${sessionId}.md`
        : null

      const participantList = participantsWithNames
        .map((p) => `  ${p.name} (subagent_type="mesa/${p.id}", task_id="mesa-${p.id}")`)
        .join("\n")

      const briefingInstruction = briefingFilePath
        ? `Briefing file: **${briefingFilePath}** — tell each specialist to READ this file. NEVER summarize or excerpt the briefing. Pass the file path so the specialist reads it in full.`
        : `No briefing file provided. Pass relevant context directly to each specialist.`

      const taskInstructions = participantsWithNames
        .map(
          (p, i) =>
            `${i + 1}. Invoke **${p.name}**:\n   \`task(subagent_type="mesa/${p.id}", task_id="mesa-${p.id}", prompt="Read the FULL briefing at ${briefingFilePath}. Analyze it from your ${p.name} perspective for: ${args.topic}. Do NOT ask for a summary — read the file yourself.", description="${p.name} analysis")\``
        )
        .join("\n\n")

      const memoryNote = [
        ``,
        `### Memory Across Turns`,
        `Use \`task_id="mesa-{personaId}"\` when invoking every specialist. This creates a named session that persists across turns.`,
        `When a specialist is invoked again in Turn 2+, the same task_id resumes their session — they recall their prior analysis automatically.`,
        `If the task tool returns a \`ses_...\` session ID instead of accepting the slug, save that ID and pass it as task_id in subsequent turns to preserve memory.`,
      ].join("\n")

      return successResponse(
        "Analysis Round Opened",
        [
          `${formatPhaseHeader(state.currentPhase, { topic: args.topic, currentTurn: 1, maxTurns: state.discussion.maxTurns, participants: args.participants })}`,
          ``,
          `Topic: ${args.topic}`,
          ``,
          `Participants (in order):`,
          participantList,
          ``,
          `Turns: ${state.discussion.maxTurns} | Phase: ANALYSIS`,
          ``,
          `## How to run this round`,
          ``,
          briefingInstruction,
          ``,
          `For each specialist, invoke them via the **task** tool with their persona ID as subagent_type.`,
          `After each specialist returns their analysis, call \`register_analysis\` to record it.`,
          ``,
          taskInstructions,
          memoryNote,
        ].join("\n")
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error opening analysis round: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const registerAnalysisTool = tool({
  description:
    "Registers an analysis from a specialist in the current round. Call after each specialist completes their analysis.",
  args: {
    agent_id: tool.schema.string().describe("Specialist persona ID"),
    agent_name: tool.schema.string().describe("Specialist display name"),
    content: tool.schema.string().describe("The analysis content"),
    turn: tool.schema.number().describe("Current turn number (1-based)"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)
      const phaseError = requirePhase(state, "ANALYSIS")
      if (phaseError) throw new PhaseError(phaseError)

      // BUG-13: Agent ID suffix matching
      const participants = state.discussion.participants
      const matchedId = participants.length > 0
        ? matchParticipant(args.agent_id, participants)
        : args.agent_id

      // BUG-05/08: Participant validation
      if (participants.length > 0 && !matchedId) {
        return errorResponse(
          `${args.agent_name} (${args.agent_id}) is not a participant in this round. ` +
          `Participants: ${participants.join(", ")}`
        )
      }

      // BUG-02: Enforce maxTurns
      if (args.turn > state.discussion.maxTurns) {
        return errorResponse(
          `Turn ${args.turn} exceeds maxTurns (${state.discussion.maxTurns}). ` +
          `All turns completed. Proceed to consensus.`
        )
      }

      // BUG-01: Derive current turn from analyses, validate turn progression
      if (args.turn < 1) {
        return errorResponse(`Turn must be 1 or greater. Got: ${args.turn}.`)
      }

      // Dedup check (existing) — use matchedId
      const effectiveId = matchedId ?? args.agent_id
      const existing = state.discussion.analyses.find(
        (a) => a.agentId === effectiveId && a.turn === args.turn
      )
      if (existing) {
        return errorResponse(`Analysis already registered for ${args.agent_name} turn ${args.turn}.`)
      }

      const entry: AnalysisEntry = {
        agentId: effectiveId,
        agentName: args.agent_name,
        content: args.content,
        turn: args.turn,
        timestamp: new Date().toISOString(),
      }

      state.discussion.analyses.push(entry)
      await saveState(context.directory, state)

      // BUG-15: Calculate progress against participants, not team
      const total = participants.length > 0
        ? participants.length
        : state.team.filter((s) => s.status === "summoned" || s.status === "active").length
      const current = state.discussion.analyses.filter((a) => a.turn === args.turn).length

      // BUG-20: Content preview for human observability
      const contentPreview = args.content.length > 300
        ? args.content.slice(0, 300) + "..."
        : args.content

      // BUG-19: Enriched header
      const header = formatPhaseHeader(state.currentPhase, {
        topic: state.discussion.topic,
        currentTurn: args.turn,
        maxTurns: state.discussion.maxTurns,
        participants,
        analysesCount: current,
      })

      // Soft warning for out-of-order registration
      let warning = ""
      if (participants.length > 0) {
        const participantIndex = participants.indexOf(effectiveId)
        if (participantIndex > 0) {
          const registeredThisTurn = new Set(
            state.discussion.analyses
              .filter((a) => a.turn === args.turn)
              .map((a) => a.agentId)
          )
          const skipped = participants
            .slice(0, participantIndex)
            .filter((id) => !registeredThisTurn.has(id))
            .map((id) => state.team.find((t) => t.personaId === id)?.name ?? id)

          if (skipped.length > 0) {
            warning = `\n\nNote: ${skipped.join(", ")} have not registered yet for turn ${args.turn}. Consider waiting for their analyses.`
          }
        }
      }

      // Next-step hint
      let nextStep = ""
      if (current < total) {
        nextStep = `Next: Register analysis from the next specialist for turn ${args.turn}.`
      } else if (args.turn < state.discussion.maxTurns) {
        nextStep = `Turn ${args.turn} complete! All ${total} analyses received. Proceed to turn ${args.turn + 1}.`
      } else {
        nextStep = `All turns complete (${state.discussion.maxTurns}/${state.discussion.maxTurns}). Call request_consensus to proceed.`
      }

      return successResponse(
        `Analysis Registered: ${args.agent_name}`,
        [
          header,
          ``,
          `Specialist ${args.agent_name} completed turn ${args.turn}.`,
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

export const requestConsensusTool = tool({
  description:
    "Initiates the consensus phase. Specialists vote on the analyses. If disagreements exist, a debate round may follow.",
  args: {
    votes: tool.schema
      .array(
        tool.schema.object({
          agent_id: tool.schema.string(),
          agent_name: tool.schema.string(),
          vote: tool.schema.union([tool.schema.literal(0), tool.schema.literal(1), tool.schema.literal(2)]),
          reason: tool.schema.string(),
        })
      )
      .describe("Array of votes: 0=DISAGREE, 1=AGREE, 2=AGREE_WITH_RESERVATIONS"),
    round: tool.schema.number().describe("Consensus round number (1 for first round)"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)
      const phaseError = requirePhase(state, "ANALYSIS")
      if (phaseError) throw new PhaseError(phaseError)

      const VALID_VOTES = new Set([0, 1, 2])
      for (const v of args.votes) {
        if (!VALID_VOTES.has(v.vote)) {
          return errorResponse(`Invalid vote value ${v.vote} for ${v.agent_name}. Must be 0 (DISAGREE), 1 (AGREE), or 2 (AGREE_WITH_RESERVATIONS).`)
        }
      }

      // BUG-04: Completeness gate — verify all participants completed all turns
      const participants = state.discussion.participants
      if (participants.length > 0) {
        const lastTurn = Math.max(...state.discussion.analyses.map((a) => a.turn), 1)
        const completedForLastTurn = new Set(
          state.discussion.analyses
            .filter((a) => a.turn === lastTurn)
            .map((a) => a.agentId)
        )
        const missing = participants.filter((id) => {
          // Check both exact match and suffix match
          return !completedForLastTurn.has(id) &&
            !Array.from(completedForLastTurn).some(cid => cid.endsWith(id) || id.endsWith(cid))
        })
        if (missing.length > 0) {
          const missingNames = missing.map(
            (id) => state.team.find((t) => t.personaId === id)?.name ?? id
          )
          return errorResponse(
            `Cannot proceed to consensus. Not all analyses complete for turn ${lastTurn}.\n` +
            `Missing: ${missingNames.join(", ")}.\n` +
            `Register their analyses first.`
          )
        }
      }

      const existingVotes = state.discussion.votes.filter((v) => v.round === args.round)
      for (const v of args.votes) {
        if (existingVotes.some((ev) => ev.agentId === v.agent_id)) {
          return errorResponse(`Vote already registered for ${v.agent_name} in round ${args.round}.`)
        }
      }

      const result = transitionPhase(state.currentPhase, "CONSENSUS")
      if (!result.ok) throw new PhaseError(result.error)

      state.currentPhase = result.phase
      state.discussion.consensusRound = args.round

      // BUG-05/13: Validate votes come from participants
      for (const v of args.votes) {
        const matchedVoter = participants.length > 0
          ? matchParticipant(v.agent_id, participants)
          : v.agent_id
        if (participants.length > 0 && !matchedVoter) {
          return errorResponse(
            `${v.agent_name} (${v.agent_id}) is not a participant in this round and cannot vote. ` +
            `Participants: ${participants.join(", ")}`
          )
        }
        // Use matched ID for vote recording
        v.agent_id = matchedVoter ?? v.agent_id
      }

      for (const v of args.votes) {
        const entry: ConsensusVoteEntry = {
          agentId: v.agent_id,
          agentName: v.agent_name,
          vote: v.vote as ConsensusVote,
          reason: v.reason,
          round: args.round,
        }
        state.discussion.votes.push(entry)
      }

      const allAgree = args.votes.every((v) => v.vote === 1 || v.vote === 2)
      const hasDisagreement = args.votes.some((v) => v.vote === 0)

      state.discussion.debateNeeded = hasDisagreement

      await saveState(context.directory, state)
      await logAction(context.directory, "consensus_requested", state.currentPhase, { round: args.round })

      const voteSummary = args.votes
        .map((v) => {
          const label =
            v.vote === 0
              ? "DISAGREE"
              : v.vote === 1
                ? "AGREE"
                : "AGREE_WITH_RESERVATIONS"
          return `  ${v.agent_name}: ${label} — ${v.reason}`
        })
        .join("\n")

      if (allAgree) {
        return successResponse(
          "Consensus Reached",
          `${formatPhaseHeader(state.currentPhase, { topic: state.discussion.topic })}\n\nAll specialists agree.\n\nVotes:\n${voteSummary}\n\nConsensus achieved. Proceed to specification generation.`
        )
      }

      if (hasDisagreement) {
        const disagreeing = args.votes
          .filter((v) => v.vote === 0)
          .map((v) => v.agent_name)
          .join(", ")

        return successResponse(
          "Consensus Not Reached — Debate Required",
          `${formatPhaseHeader(state.currentPhase, { topic: state.discussion.topic })}\n\nVotes:\n${voteSummary}\n\nDisagreeing: ${disagreeing}\n\nA debate round is needed. Ask disagreeing specialists to present their concerns and re-vote.`
        )
      }

      return successResponse(
        "Consensus Phase",
        `${formatPhaseHeader(state.currentPhase, { topic: state.discussion.topic })}\n\nVotes:\n${voteSummary}`
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error requesting consensus: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const generateSpecificationTool = tool({
  description:
    "Generates the specification document. The Manager writes a single coherent document (up to 100k tokens) covering: executive summary, context, technical decisions, execution plan with tasks and priorities. Analyses are stored separately — they do NOT appear in the spec.",
  args: {
    content: tool.schema
      .string()
      .describe("The complete specification document content written by the Manager. This should be a coherent, unified document — not disconnected sections."),
    topic: tool.schema.string().describe("The specification topic/title"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)

      // Transition CONSENSUS → DOCUMENTATION
      const toDoc = transitionPhase(state.currentPhase, "DOCUMENTATION")
      if (!toDoc.ok) throw new PhaseError(toDoc.error)
      state.currentPhase = toDoc.phase

      const specsDir = join(context.directory, PLUGIN_STATE_DIR, "specifications")
      await fs.mkdir(specsDir, { recursive: true })

      const id = randomUUID().slice(0, 8)
      const specPath = join(specsDir, `spec-${id}.md`)

      const document = [
        `# Specification: ${args.topic}`,
        ``,
        `**Generated at:** ${new Date().toISOString()}`,
        ``,
        args.content,
      ].join("\n")

      // Budget Gate: Total document size validation
      if (document.length > MAX_TOTAL_CHARS) {
        // Revert phase change
        state.currentPhase = "CONSENSUS"
        return errorResponse(
          `Specification exceeds total budget: ${document.length} chars (max ${MAX_TOTAL_CHARS}).\n` +
          `Reduce content length to fit within the budget.`
        )
      }

      await fs.writeFile(specPath, document, "utf-8")

      // Save analyses separately
      if (state.discussion.analyses.length > 0) {
        const analysesDir = join(context.directory, PLUGIN_STATE_DIR, "specifications", `analyses-${id}`)
        await fs.mkdir(analysesDir, { recursive: true })
        for (const a of state.discussion.analyses) {
          const analysisFile = join(analysesDir, `analysis-${a.agentId}-turn${a.turn}.md`)
          await fs.writeFile(
            analysisFile,
            [
              `# Analysis: ${a.agentName} — Turn ${a.turn}`,
              ``,
              `**Agent ID:** ${a.agentId}`,
              `**Timestamp:** ${a.timestamp}`,
              ``,
              a.content,
            ].join("\n"),
            "utf-8"
          )
        }
      }

      state.specification.path = specPath
      state.specification.status = "draft"

      // Transition DOCUMENTATION → APPROVAL
      const toApproval = transitionPhase(state.currentPhase, "APPROVAL")
      if (!toApproval.ok) throw new PhaseError(toApproval.error)
      state.currentPhase = toApproval.phase

      await saveState(context.directory, state)
      await logAction(context.directory, "specification_generated", state.currentPhase, { path: specPath })

      return successResponse(
        "Specification Generated",
        `${formatPhaseHeader(state.currentPhase, { topic: args.topic })}\n\nSpecification saved to: ${specPath}\n\nThe specification is now awaiting human approval.`,
        { path: specPath }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error generating specification: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const approveSpecificationTool = tool({
  description:
    "Marks the specification as approved (or rejected). If rejected, returns to DOCUMENTATION phase.",
  args: {
    approved: tool.schema.boolean().describe("Whether the human approved the specification"),
    feedback: tool.schema
      .string()
      .optional()
      .describe("Optional feedback/rejection reason"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)

      if (args.approved) {
        const result = transitionPhase(state.currentPhase, "EXECUTION")
        if (!result.ok) throw new PhaseError(result.error)

        state.currentPhase = result.phase
        state.specification.status = "approved"
        await saveState(context.directory, state)
        await logAction(context.directory, "specification_approved", state.currentPhase)

        return successResponse(
          "Specification Approved",
          `${formatPhaseHeader(state.currentPhase)}\n\nSpecification approved. Phase changed to EXECUTION. The Manager may now delegate implementation tasks.`
        )
      } else {
        const result = transitionPhase(state.currentPhase, "DOCUMENTATION")
        if (!result.ok) throw new PhaseError(result.error)

        state.currentPhase = result.phase
        state.specification.status = "rejected"
        await saveState(context.directory, state)
        await logAction(context.directory, "specification_rejected", state.currentPhase, { feedback: args.feedback })

        return successResponse(
          "Specification Rejected",
          `${formatPhaseHeader(state.currentPhase)}\n\nSpecification rejected.${args.feedback ? ` Feedback: ${args.feedback}` : ""}\n\nReturned to DOCUMENTATION phase for revision.`
        )
      }
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error approving specification: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const pauseDiscussionTool = tool({
  description: "Pauses the current discussion. State is preserved for later resumption.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory)
      state.previousPhase = state.currentPhase
      const result = transitionPhase(state.currentPhase, "PAUSED")
      if (!result.ok) throw new PhaseError(result.error)

      state.currentPhase = result.phase
      await saveState(context.directory, state)
      await logAction(context.directory, "discussion_paused", state.currentPhase, { previousPhase: state.previousPhase })

      return successResponse(
        "Discussion Paused",
        `${formatPhaseHeader(state.currentPhase)}\n\nDiscussion paused. Previous phase: ${state.previousPhase}. Use resume_discussion to resume.`
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error pausing discussion: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const resumeDiscussionTool = tool({
  description: "Resumes a paused discussion, returning to the previous phase.",
  args: {
    target_phase: tool.schema.string().describe("The phase to resume to (e.g. 'ANALYSIS', 'CONSENSUS')"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)
      if (state.currentPhase !== "PAUSED") {
        return errorResponse(`Discussion is not paused. Current phase: ${state.currentPhase}`)
      }

      const allPhasesSet = new Set(ALL_PHASES)
      if (!allPhasesSet.has(args.target_phase as DiscussionPhase)) {
        return errorResponse(`Invalid phase "${args.target_phase}". Valid phases: ${ALL_PHASES.join(", ")}`)
      }

      const target = args.target_phase as DiscussionPhase
      const result = transitionPhase("PAUSED", target)
      if (!result.ok) throw new PhaseError(result.error)

      let warning = ""
      if (state.previousPhase && args.target_phase !== state.previousPhase) {
        warning = `\nWarning: Workflow was paused from ${state.previousPhase}, resuming to ${args.target_phase} instead.`
      }

      state.currentPhase = result.phase
      state.previousPhase = null
      await saveState(context.directory, state)
      await logAction(context.directory, "discussion_resumed", state.currentPhase)

      return successResponse(
        "Discussion Resumed",
        `${formatPhaseHeader(state.currentPhase)}\n\nDiscussion resumed at phase: ${result.phase}.${warning}`
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error resuming discussion: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const cancelDiscussionTool = tool({
  description: "Cancels the current discussion and resets the state.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory)
      const result = transitionPhase(state.currentPhase, "CANCELLED")
      if (!result.ok) throw new PhaseError(result.error)

      state.currentPhase = result.phase
      state.discussion.analyses = []
      state.discussion.votes = []
      state.discussion.currentTurn = 0
      await saveState(context.directory, state)
      await logAction(context.directory, "discussion_cancelled", state.currentPhase)

      return successResponse(
        "Discussion Cancelled",
        `${formatPhaseHeader(state.currentPhase)}\n\nThe discussion has been cancelled and analysis data cleared. You may start a new round.`
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error cancelling discussion: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
