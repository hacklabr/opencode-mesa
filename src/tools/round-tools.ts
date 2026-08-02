import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState, getSessionId, getDb } from "../state.js"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { logAction } from "../audit.js"
import { successResponse, errorResponse } from "../utils/responses.js"
import { MAX_ROUNDS_PER_SESSION } from "../config.js"
import { MesaError } from "../errors.js"
import { buildBriefingPath, ensureSessionInput, resolveAbsolutePath } from "../utils/paths.js"
import type { Round, RoundOutcome, DiscussionState } from "../types.js"

/**
 * Kernel round tools (spec D2/D3/D6) — the universal discussion primitive.
 *
 * These tools use DATA PRECONDITIONS, never requirePhase/requireMode: they
 * check that the artifacts a round depends on exist and are approved, not
 * that the session sits at a particular pipeline position. Every error
 * message is self-documenting (D6: "mensagens de erro ensinam recovery").
 */

// Global mutation guard (D6): paused/cancelled sessions reject all mutations.
function statusGuard(state: DiscussionState): string | null {
  if (state.status !== "active") {
    return `Operation not allowed when discussion status is "${state.status}". Resume the discussion before proceeding.`
  }
  return null
}

// Suffix-tolerant matching (same semantics as legacy matchParticipant):
// subagents sometimes return IDs without their division prefix.
function matchesParticipant(agentId: string, participant: string): boolean {
  return (
    agentId === participant ||
    agentId.endsWith(participant) ||
    participant.endsWith(agentId)
  )
}

// Lexical POSITION block (spec D3). Alternation is deliberately ordered
// longest-first: "(agree|agree-with-reservations|...)" would capture "agree"
// out of "agree-with-reservations" (leftmost match wins).
const POSITION_RE = /POSITION:\s*(agree-with-reservations|disagree|agree)\b/i

function nextRoundId(rounds: Round[]): string {
  let n = rounds.length + 1
  const ids = new Set(rounds.map((r) => r.id))
  while (ids.has(`r${n}`)) n++
  return `r${n}`
}

export const openRoundTool = tool({
  description:
    "Opens a discussion round — the universal deliberation primitive. The Manager defines the topic and " +
    "participants (any subset of the summoned team). Requires: approved briefing, summoned team, approved " +
    "workflow plan (gate 0), no other open round, and session round budget available.",
  args: {
    topic: tool.schema.string().describe("The round topic — what this round must produce clarity on"),
    participants: tool.schema
      .array(tool.schema.string())
      .describe("Participant persona IDs — must be a subset of the summoned team (hard error otherwise)"),
    max_turns: tool.schema
      .number()
      .optional()
      .describe("Hint for expected turns per specialist (declarative only, not enforced)"),
    briefing_content: tool.schema
      .string()
      .optional()
      .describe("Optional enriched briefing written to the session folder for participants to read"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)

      const statusError = statusGuard(state)
      if (statusError) throw new MesaError(statusError, "INACTIVE_SESSION")

      if (state.briefing.status !== "approved" && state.briefing.status !== "delivered") {
        return errorResponse(
          `open_round requires an approved briefing (current status: "${state.briefing.status}"). ` +
          `Path: create_briefing → present to the human → approve_briefing.`
        )
      }

      const summoned = state.team.filter(
        (s) => s.status === "summoned" || s.status === "active"
      )
      if (summoned.length === 0) {
        return errorResponse(
          `open_round requires a summoned team (none found). ` +
          `Path: propose_team → human approval → summon_team.`
        )
      }

      if (state.plan?.status !== "approved") {
        return errorResponse(
          `open_round requires an approved workflow plan (current: ${state.plan ? `v${state.plan.version}, ${state.plan.status}` : "none"}). ` +
          `Path: write workflow-plan.md in the session folder, present it to the human (gate 0), ` +
          `then record the approval with record_decision type:"gate" target:"plan".`
        )
      }

      const openRound = state.rounds.find((r) => r.status === "open")
      if (openRound) {
        return errorResponse(
          `Round "${openRound.id}" ("${openRound.topic}") is still open. ` +
          `Close it with close_round before opening a new one — only one round may be open at a time.`
        )
      }

      if (state.rounds.length >= MAX_ROUNDS_PER_SESSION) {
        return errorResponse(
          `Session round budget exhausted (${state.rounds.length}/${MAX_ROUNDS_PER_SESSION} rounds). ` +
          `This is a circuit breaker against non-converging composition. ` +
          `Escalate to the human with the open tensions enumerated before continuing.`
        )
      }

      const unknown = args.participants.filter(
        (p) => !state.team.some((t) => matchesParticipant(t.personaId, p))
      )
      if (unknown.length > 0) {
        const roster = state.team.map((t) => `  - ${t.personaId} (${t.status})`).join("\n")
        return errorResponse(
          `Unknown participants (not in the summoned team): ${unknown.join(", ")}\n\n` +
          `Current team:\n${roster || "  (none)"}\n\n` +
          `The team is the human-approved cast — only its members can speak in a round. ` +
          `Path: propose_team → human approval → summon_team, then retry.`
        )
      }

      const now = new Date().toISOString()
      const round: Round = {
        id: nextRoundId(state.rounds),
        topic: args.topic,
        participants: args.participants,
        status: "open",
        openedAt: now,
      }
      state.rounds.push(round)

      const sessionId = getSessionId(context.directory, context.sessionID)

      let briefingFilePath: string | null = null
      if (args.briefing_content && sessionId) {
        const sessionInput = await ensureSessionInput(
          context.directory, state, sessionId, getDb
        )
        briefingFilePath = buildBriefingPath(sessionInput).replace(
          /briefing\.md$/,
          "briefing-for-discussion.md"
        )
        const briefingFile = join(context.directory, briefingFilePath)
        await fs.mkdir(join(briefingFile, ".."), { recursive: true })
        await fs.writeFile(briefingFile, args.briefing_content, "utf-8")
        await logAction(context.directory, "round_briefing_written", state.currentPhase, { path: briefingFilePath }, state.plan?.version)
      }

      await saveState(context.directory, state, context.sessionID)
      await logAction(
        context.directory,
        "round_opened",
        state.currentPhase,
        { roundId: round.id, topic: args.topic, participants: args.participants },
        state.plan?.version
      )

      const participantList = args.participants
        .map((id) => {
          const name = state.team.find((t) => t.personaId === id)?.name ?? id
          return `  ${name} (task_id="mesa-${id}")`
        })
        .join("\n")

      return successResponse(
        `Round Opened: ${round.id}`,
        [
          `Round: ${round.id} | Topic: ${args.topic}`,
          ``,
          `Participants:`,
          participantList,
          ``,
          briefingFilePath
            ? `Briefing file: **${briefingFilePath}** — tell each participant to READ this file in full. Never summarize it.`
            : `No briefing file provided. Pass relevant context directly to each participant.`,
          ``,
          `Invoke participants via the task tool with task_id="mesa-{personaId}" (stable task_id preserves memory across rounds).`,
          `Each participant's final artifact must end with a POSITION: agree | agree-with-reservations | disagree block — close_round requires it.`,
        ].join("\n"),
        { roundId: round.id, briefingFilePath }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error opening round: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const closeRoundTool = tool({
  description:
    "Closes the open round with an audited outcome. Requires every participant to have a registered analysis " +
    "(self-registered, not by the Manager) whose file contains a declared POSITION block, and non-empty " +
    "evidencePaths citing the analyses the decision is grounded on. A declared disagree vetoes 'converged'.",
  args: {
    decision: tool.schema
      .enum(["converged", "converged-with-open-tensions", "escalated"])
      .describe("Process outcome: converged (all agree), converged-with-open-tensions (tensions recorded in the deliverable), escalated (human judges)"),
    summary: tool.schema
      .string()
      .describe("Synthesis of the positions — WHAT the round concluded, citing the evidence"),
    tensions: tool.schema
      .array(tool.schema.string())
      .describe("Open tensions copied VERBATIM from the declared positions (empty when fully converged)"),
    evidencePaths: tool.schema
      .array(tool.schema.string())
      .describe("Analysis file paths the decision is grounded on — must be non-empty"),
    humanOverride: tool.schema
      .boolean()
      .optional()
      .describe("Bypass the completeness gate (human decision). Recorded in the audit log. Does NOT bypass evidencePaths."),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)

      const statusError = statusGuard(state)
      if (statusError) throw new MesaError(statusError, "INACTIVE_SESSION")

      const round = state.rounds.find((r) => r.status === "open")
      if (!round) {
        return errorResponse(
          `No open round to close. Open one with open_round first.`
        )
      }

      if (args.evidencePaths.length === 0) {
        return errorResponse(
          `close_round requires evidencePaths[] citing the analysis files this decision is grounded on ` +
          `(spec D3 — a decision without cited evidence is undetectable rubber-stamping). ` +
          `List the participant analysis files (see get_peer_analyses).`
        )
      }

      // Completeness gate (spec D3.5): each participant needs ≥1 analysis in
      // THIS round, self-registered (registeredByManager entries would let the
      // Manager write the specialist's position — corruption window), whose
      // FILE contains a lexical POSITION block.
      const positions: Record<string, string> = {}
      const missing: string[] = []

      for (const participant of round.participants) {
        const candidates = state.discussion.analyses.filter(
          (a) =>
            a.roundId === round.id &&
            matchesParticipant(a.agentId, participant) &&
            a.registeredByManager !== true &&
            a.filePath
        )

        let declared: string | null = null
        // Latest registration wins when several files declare a position.
        for (const analysis of candidates) {
          try {
            const content = await fs.readFile(
              resolveAbsolutePath(context.directory, analysis.filePath!),
              "utf-8"
            )
            const match = content.match(POSITION_RE)
            if (match) declared = match[1].toLowerCase()
          } catch {
            // Unreadable file — cannot count as a declared position.
          }
        }

        if (declared) {
          positions[participant] = declared
        } else {
          missing.push(participant)
        }
      }

      if (missing.length > 0 && !args.humanOverride) {
        return errorResponse(
          `Cannot close round ${round.id}: declared POSITION missing for: ${missing.join(", ")}.\n` +
          `Each participant must register an analysis FROM THEIR OWN SESSION (registered_by_manager entries ` +
          `do not count) whose file contains a "POSITION: agree | agree-with-reservations | disagree" block.\n` +
          `If the human decides to close anyway, call close_round with humanOverride: true (recorded in the audit log).`
        )
      }

      const dissenters = round.participants.filter((p) => positions[p] === "disagree")

      // A declared disagree vetoes "converged" (spec D3.3 — load-bearing rule).
      if (args.decision === "converged" && dissenters.length > 0 && !args.humanOverride) {
        return errorResponse(
          `"converged" is vetoed by a declared disagree from: ${dissenters.join(", ")}.\n` +
          `Legal moves: (1) open a subset round with exactly the dissenting participants, ` +
          `(2) close as "converged-with-open-tensions" recording the tension verbatim in tensions[], or ` +
          `(3) close as "escalated" and let the human judge.`
        )
      }

      const now = new Date().toISOString()
      const outcome: RoundOutcome = {
        decision: args.decision,
        summary: args.summary,
        tensions: args.tensions,
        evidencePaths: args.evidencePaths,
        positions,
      }
      round.closedAt = now
      round.status = "closed"
      round.outcome = outcome

      await saveState(context.directory, state, context.sessionID)
      await logAction(
        context.directory,
        "round_closed",
        state.currentPhase,
        {
          roundId: round.id,
          decision: args.decision,
          tensionsCount: args.tensions.length,
          evidencePaths: args.evidencePaths,
          positions,
          humanOverride: args.humanOverride === true,
        },
        state.plan?.version
      )

      // Soft check (spec D3.5): declared disagree with empty tensions[] is a
      // smell — the tension should be surfaced, not swallowed.
      let warning = ""
      if (dissenters.length > 0 && args.tensions.length === 0) {
        warning =
          `\n\nWarning: ${dissenters.join(", ")} declared disagree but tensions[] is empty. ` +
          `Surface the tension verbatim so it reaches the deliverable and the human.`
      }

      return successResponse(
        `Round Closed: ${round.id} — ${args.decision}`,
        [
          `Round ${round.id} ("${round.topic}") closed with decision: ${args.decision}.`,
          ``,
          `Positions:`,
          ...round.participants.map((p) => `  ${p}: ${positions[p] ?? "(not declared — override)"}`),
          ``,
          args.tensions.length > 0
            ? `Tensions recorded:\n${args.tensions.map((t) => `  - ${t}`).join("\n")}`
            : `No open tensions recorded.`,
          warning,
        ].join("\n"),
        { roundId: round.id, outcome }
      )
    } catch (err) {
      if (err instanceof MesaError) return errorResponse(err.message)
      return errorResponse(`Error closing round: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
