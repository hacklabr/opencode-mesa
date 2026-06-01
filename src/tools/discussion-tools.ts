import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState } from "../state"
import type { DiscussionPhase, ConsensusVote, AnalysisEntry, ConsensusVoteEntry } from "../types"
import { canTransition, VALID_TRANSITIONS, requirePhase, formatPhaseHeader, ALL_PHASES } from "../workflow/transitions"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { randomUUID } from "node:crypto"
import { PLUGIN_STATE_DIR } from "../config"
import { logAction } from "../audit"
import { successResponse, errorResponse } from "../utils/responses"
import { PhaseError, MesaError } from "../errors"

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
      const phaseError = requirePhase(state, "PLANNING")
      if (phaseError) throw new PhaseError(phaseError)

      const existingAnalyses = state.discussion.analyses.length
      const existingVotes = state.discussion.votes.length
      if ((existingAnalyses > 0 || existingVotes > 0) && !args.force) {
        return errorResponse(
          `Warning: This will clear ${existingAnalyses} existing analyses and ${existingVotes} votes. Set force=true to proceed.`
        )
      }

      const result = transitionPhase(state.currentPhase, "ANALYSIS")
      if (!result.ok) throw new PhaseError(result.error)

      state.currentPhase = result.phase
      state.discussion.topic = args.topic
      state.discussion.currentTurn = 1
      state.discussion.maxTurns = args.max_turns ?? 2
      state.discussion.analyses = []
      state.discussion.votes = []
      state.discussion.consensusRound = 0
      state.specification = { path: null, status: "pending" }

      if (args.briefing_content) {
        const briefingFile = join(
          context.directory,
          PLUGIN_STATE_DIR,
          "briefing-for-discussion.md"
        )
        await fs.writeFile(briefingFile, args.briefing_content, "utf-8")
      }

      await saveState(context.directory, state)
      await logAction(context.directory, "analysis_round_opened", state.currentPhase, { topic: args.topic })

      const participantsWithNames = args.participants.map((id) => {
        const name = state.team.find((t) => t.personaId === id)?.name ?? id
        return { id, name }
      })

      const participantList = participantsWithNames
        .map((p) => `  ${p.name} (subagent_type="${p.id}")`)
        .join("\n")

      const taskInstructions = participantsWithNames
        .map(
          (p, i) =>
            `${i + 1}. Invoke **${p.name}**:\n   \`task(subagent_type="${p.id}", prompt="Analyze the following briefing for ${args.topic}...", description="${p.name} analysis")\``
        )
        .join("\n\n")

      return successResponse(
        "Analysis Round Opened",
        [
          `${formatPhaseHeader(state.currentPhase)}`,
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
          `For each specialist, invoke them via the **task** tool with their persona ID as subagent_type.`,
          `After each specialist returns their analysis, call \`register_analysis\` to record it.`,
          ``,
          taskInstructions,
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

      const existing = state.discussion.analyses.find(
        (a) => a.agentId === args.agent_id && a.turn === args.turn
      )
      if (existing) {
        return errorResponse(`Analysis already registered for ${args.agent_name} turn ${args.turn}.`)
      }

      const entry: AnalysisEntry = {
        agentId: args.agent_id,
        agentName: args.agent_name,
        content: args.content,
        turn: args.turn,
        timestamp: new Date().toISOString(),
      }

      state.discussion.analyses.push(entry)
      await saveState(context.directory, state)

      const total = state.team.filter((s) => s.status === "summoned" || s.status === "active").length
      const current = state.discussion.analyses.filter((a) => a.turn === args.turn).length

      return successResponse(
        `Analysis Registered: ${args.agent_name}`,
        `${formatPhaseHeader(state.currentPhase)}\n\nSpecialist ${args.agent_name} completed turn ${args.turn}.\nProgress: ${current}/${total} analyses for turn ${args.turn}.`
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
          `${formatPhaseHeader(state.currentPhase)}\n\nAll specialists agree.\n\nVotes:\n${voteSummary}\n\nConsensus achieved. Proceed to specification generation.`
        )
      }

      if (hasDisagreement) {
        const disagreeing = args.votes
          .filter((v) => v.vote === 0)
          .map((v) => v.agent_name)
          .join(", ")

        return successResponse(
          "Consensus Not Reached — Debate Required",
          `${formatPhaseHeader(state.currentPhase)}\n\nVotes:\n${voteSummary}\n\nDisagreeing: ${disagreeing}\n\nA debate round is needed. Ask disagreeing specialists to present their concerns and re-vote.`
        )
      }

      return successResponse(
        "Consensus Phase",
        `${formatPhaseHeader(state.currentPhase)}\n\nVotes:\n${voteSummary}`
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error requesting consensus: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const generateSpecificationTool = tool({
  description:
    "Generates the specification document from specialist analyses. Compiles all sections into a single Markdown file.",
  args: {
    sections: tool.schema
      .array(
        tool.schema.object({
          specialist_name: tool.schema.string(),
          specialist_id: tool.schema.string(),
          content: tool.schema.string(),
        })
      )
      .describe("Array of specification sections from each specialist"),
    topic: tool.schema.string().describe("The specification topic/title"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)

      const step1 = transitionPhase(state.currentPhase, "DOCUMENTATION")
      if (!step1.ok) throw new PhaseError(step1.error)

      const step2 = transitionPhase("DOCUMENTATION", "APPROVAL")
      if (!step2.ok) {
        throw new PhaseError(`Cannot transition DOCUMENTATION → APPROVAL: ${step2.error}`)
      }

      state.currentPhase = step1.phase

      const specsDir = join(context.directory, PLUGIN_STATE_DIR, "specifications")
      await fs.mkdir(specsDir, { recursive: true })

      const id = randomUUID().slice(0, 8)
      const specPath = join(specsDir, `spec-${id}.md`)

      const voteLines = state.discussion.votes
        .filter((v) => v.round === state.discussion.consensusRound)
        .map((v) => {
          const icon = v.vote === 0 ? "DISAGREE" : v.vote === 1 ? "AGREE" : "AGREE_WITH_RESERVATIONS"
          return `- **${v.agentName}**: ${icon} — ${v.reason}`
        })
        .join("\n")

      const sectionsMd = args.sections
        .map((s) => `## Section by ${s.specialist_name}\n\n${s.content}`)
        .join("\n\n---\n\n")

      const document = [
        `# Specification: ${args.topic}`,
        ``,
        `**Generated at:** ${new Date().toISOString()}`,
        ``,
        `## Participants`,
        ...state.team
          .filter((t) => t.status === "summoned" || t.status === "active")
          .map((t) => `- ${t.name} (${t.personaId}) — ${t.division}`),
        ``,
        `---`,
        ``,
        sectionsMd,
        ``,
        `---`,
        ``,
        `## Consensus Decisions`,
        voteLines,
        ``,
      ].join("\n")

      await fs.writeFile(specPath, document, "utf-8")

      state.specification.path = specPath
      state.specification.status = "draft"
      state.currentPhase = step2.phase

      await saveState(context.directory, state)
      await logAction(context.directory, "specification_generated", state.currentPhase, { path: specPath })

      return successResponse(
        "Specification Generated",
        `${formatPhaseHeader(state.currentPhase)}\n\nSpecification saved to: ${specPath}\n\nThe specification is now awaiting human approval.`,
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
