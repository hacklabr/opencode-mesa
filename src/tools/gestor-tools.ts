import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState } from "../state"
import type { DiscussionPhase, SpecialistEntry, SpecialistStatus } from "../config"

const VALID_TRANSITIONS: Record<DiscussionPhase, DiscussionPhase[]> = {
  PLANNING: ["ANALYSIS", "PAUSED", "CANCELLED"],
  ANALYSIS: ["CONSENSUS", "PAUSED", "CANCELLED"],
  CONSENSUS: ["DOCUMENTATION", "ANALYSIS", "PAUSED", "CANCELLED"],
  DOCUMENTATION: ["APPROVAL", "PAUSED", "CANCELLED"],
  APPROVAL: ["EXECUTION", "DOCUMENTATION", "PAUSED", "CANCELLED"],
  EXECUTION: ["PLANNING", "PAUSED", "CANCELLED"],
  PAUSED: ["PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION", "APPROVAL", "EXECUTION", "CANCELLED"],
  CANCELLED: [],
}

export function canTransition(from: DiscussionPhase, to: DiscussionPhase): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false
}

export const analyzeBriefingTool = tool({
  description:
    "Reads the current approved briefing and returns its content for analysis by the Gestor.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory)
      if (!state.briefing.path) {
        return "Error: No briefing found. A briefing must be created and delivered first."
      }

      const { promises: fs } = await import("node:fs")
      const content = await fs.readFile(state.briefing.path, "utf-8")

      return {
        title: "Briefing Analysis",
        output: content,
        metadata: {
          slug: state.briefing.slug,
          status: state.briefing.status,
          phase: state.currentPhase,
        },
      }
    } catch (err) {
      return `Error reading briefing: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const proposeTeamTool = tool({
  description:
    "Proposes a team of specialists for the current project. Saves the proposal to state for human approval.",
  args: {
    specialists: tool.schema
      .array(
        tool.schema.object({
          personaId: tool.schema.string().describe("Specialist persona ID from the catalog"),
          name: tool.schema.string().describe("Specialist display name"),
          division: tool.schema.string().describe("Specialist division"),
          justification: tool.schema.string().describe("Why this specialist is needed"),
        })
      )
      .describe("Array of proposed specialists with justifications"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)

      const team: SpecialistEntry[] = args.specialists.map((s) => ({
        personaId: s.personaId,
        name: s.name,
        division: s.division,
        status: "proposed" as SpecialistStatus,
      }))

      state.team = team
      await saveState(context.directory, state)

      const proposalTable = args.specialists
        .map(
          (s, i) =>
            `${i + 1}. **${s.name}** (${s.personaId}) — ${s.division}\n   Justification: ${s.justification}`
        )
        .join("\n\n")

      return {
        title: "Team Proposal — Awaiting Human Approval",
        output: `The following team has been proposed:\n\n${proposalTable}\n\n**IMPORTANT**: This team requires explicit human approval before summoning. Present this proposal to the human and wait for confirmation.`,
        metadata: { teamSize: team.length },
      }
    } catch (err) {
      return `Error proposing team: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const summonTeamTool = tool({
  description:
    "Summons the proposed team after human approval. Marks each specialist as summoned in the state.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory)

      const proposed = state.team.filter((s) => s.status === "proposed")
      if (proposed.length === 0) {
        return "Error: No proposed specialists found. Use propose_team first."
      }

      for (const member of state.team) {
        if (member.status === "proposed") {
          member.status = "summoned"
        }
      }

      await saveState(context.directory, state)

      const summonedList = state.team
        .filter((s) => s.status === "summoned")
        .map((s) => `  - ${s.name} (${s.personaId}) — ${s.division}`)
        .join("\n")

      return {
        title: "Team Summoned",
        output: `${state.team.filter((s) => s.status === "summoned").length} specialists summoned:\n${summonedList}\n\nTeam is ready for discussion rounds.`,
      }
    } catch (err) {
      return `Error summoning team: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const delegateTaskTool = tool({
  description:
    "Defines a task for a specialist. Records the delegation in Mesa state and returns instructions to invoke the specialist via the task tool.",
  args: {
    personaId: tool.schema.string().describe("The specialist persona ID (also the subagent_type for the task tool)"),
    task: tool.schema.string().describe("Clear description of the task to delegate"),
    context_info: tool.schema
      .string()
      .optional()
      .describe("Additional context (briefing excerpt, code reference, etc.)"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)
      const specialist = state.team.find((s) => s.personaId === args.personaId)

      if (!specialist) {
        return `Error: Specialist "${args.personaId}" not found in the current team. Summon them first.`
      }

      const promptParts = [
        `## Task from Gestor`,
        ``,
        `### Task`,
        args.task,
      ]

      if (args.context_info) {
        promptParts.push(``, `### Context`, args.context_info)
      }

      return {
        title: `Task ready for ${specialist.name}`,
        output: [
          `Task defined for **${specialist.name}** (${args.personaId}).`,
          ``,
          `Now invoke the specialist using the **task** tool:`,
          `\`task(subagent_type="${args.personaId}", prompt="...", description="...")\``,
          ``,
          `### Prompt content for the specialist:`,
          promptParts.join("\n"),
        ].join("\n"),
        metadata: { personaId: args.personaId },
      }
    } catch (err) {
      return `Error delegating task: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})

export const definePhasesTool = tool({
  description:
    "Defines the workflow phases for the current project. Transitions the state accordingly.",
  args: {
    phases: tool.schema
      .array(tool.schema.string())
      .describe("Ordered array of phase names (e.g. ['PLANNING', 'ANALYSIS', 'CONSENSUS'])"),
  },
  async execute(args, context) {
    try {
      const state = await loadState(context.directory)
      const validPhases: DiscussionPhase[] = [
        "PLANNING", "ANALYSIS", "CONSENSUS", "DOCUMENTATION", "APPROVAL", "EXECUTION",
      ]

      const invalid = args.phases.filter((p) => !validPhases.includes(p as DiscussionPhase))
      if (invalid.length > 0) {
        return `Error: Invalid phases: ${invalid.join(", ")}. Valid: ${validPhases.join(", ")}`
      }

      await saveState(context.directory, state)

      return {
        title: "Workflow Phases Defined",
        output: `Phases: ${args.phases.join(" → ")}\n\nCurrent phase: ${state.currentPhase}`,
      }
    } catch (err) {
      return `Error defining phases: ${err instanceof Error ? err.message : String(err)}`
    }
  },
})
