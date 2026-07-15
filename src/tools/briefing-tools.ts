import { tool } from "@opencode-ai/plugin/tool"
import { loadState, saveState, getSessionId, getDb } from "../state.js"
import { join, resolve } from "node:path"
import { promises as fs } from "node:fs"
import { logAction } from "../audit.js"
import { formatPhaseHeader } from "../workflow/transitions.js"
import { isValidSlug } from "../utils/slug.js"
import { successResponse, errorResponse } from "../utils/responses.js"
import {
  buildBriefingPath,
  ensureSessionInput,
  resolveAbsolutePath,
} from "../utils/paths.js"
import { ValidationError } from "../errors.js"
import type { BriefingMetadata, ScopeDimension, ScopeMagnitude } from "../types.js"

/**
 * Builds the human/LLM-readable metadata projection block prepended to the
 * briefing markdown body (spec-fb0ba2d7, Decision 5). State is authoritative;
 * this block is derived display only.
 */
function buildMetadataProjection(metadata: BriefingMetadata): string {
  const dimensionsText = metadata.nonTechnicalDimensions.length > 0
    ? metadata.nonTechnicalDimensions.join(", ")
    : "none detected"
  return [
    `> **Scope:** ${metadata.scopeMagnitude.toUpperCase()} — ${metadata.classificationReason}`,
    `> **Non-technical dimensions:** ${dimensionsText}`,
    "",
  ].join("\n")
}

export const createBriefingTool = tool({
  description:
    "Creates and saves a new briefing document in the workspace. The briefing is stored in the .mesa directory.",
  args: {
    slug: tool.schema
      .string()
      .describe(
        "URL-friendly identifier for the briefing (e.g. 'ecommerce-platform'). NEVER use generic names."
      ),
    title: tool.schema.string().describe("The briefing title"),
    content: tool.schema.string().describe("The full briefing content in Markdown"),
    scope_magnitude: tool.schema
      .enum(["simple", "composite"])
      .optional()
      .describe(
        "Adaptive scope classification (spec-fb0ba2d7, Decision 1). " +
        "Provide when the briefing-writer has classified the scope during discovery."
      ),
    classification_reason: tool.schema
      .string()
      .optional()
      .describe(
        "Human-readable evidence for the classification " +
        "(e.g. 'domains: gamification, docs; users: admins, end-users; novel: real-time collaboration')."
      ),
    sub_areas: tool.schema
      .array(tool.schema.string())
      .optional()
      .describe("Composite scope decomposition (e.g. ['gamification', 'document collaboration'])."),
    non_technical_dimensions: tool.schema
      .array(
        tool.schema.enum([
          "technical", "human-social", "cultural",
          "political", "economic", "educational", "behavioral",
        ])
      )
      .optional()
      .describe(
        "Detected non-technical dimensions (spec-fb0ba2d7, Decision 4). " +
        "Empty array if scope is technical-only."
      ),
    non_technical_flag: tool.schema
      .boolean()
      .optional()
      .describe(
        "Derived flag: true when non_technical_dimensions is non-empty. " +
        "May be passed explicitly; otherwise derived from the dimensions array."
      ),
  },
  async execute(args, context) {
    try {
      if (!isValidSlug(args.slug)) {
        throw new ValidationError("Invalid slug. Use lowercase letters, numbers, and hyphens only.")
      }

      if (!args.content || !args.content.trim()) {
        throw new ValidationError("Briefing content cannot be empty.")
      }

      const state = await loadState(context.directory, context.sessionID)
      state.briefing.slug = args.slug

      const sessionId = getSessionId(context.directory, context.sessionID)
      if (!sessionId) {
        throw new Error("No active session. Ensure loadState() was called.")
      }

      // Compute session-scoped briefing path (spec-6886df4f, TD2).
      // Store as RELATIVE to the workspace; prepend context.directory for I/O.
      const input = await ensureSessionInput(
        context.directory, state, sessionId, getDb
      )
      const briefingRelPath = buildBriefingPath(input)
      const filePath = join(context.directory, briefingRelPath)

      // Path-traversal guard: slug-derived path must stay inside the workspace.
      const resolved = resolve(filePath)
      const wsResolved = resolve(context.directory)
      if (!resolved.startsWith(wsResolved)) {
        throw new ValidationError("Invalid slug — path traversal detected.")
      }
      const now = new Date().toISOString()

      // Construct metadata when classification args are provided (spec-fb0ba2d7, Decision 5).
      // All-or-nothing on the required trio: scopeMagnitude, classificationReason, nonTechnicalDimensions.
      let metadata: BriefingMetadata | null = null
      const hasClassification = args.scope_magnitude !== undefined
      if (hasClassification) {
        if (!args.classification_reason) {
          throw new ValidationError(
            "classification_reason is required when scope_magnitude is provided."
          )
        }
        const dimensions: ScopeDimension[] = args.non_technical_dimensions ?? []
        const flag = args.non_technical_flag ?? dimensions.length > 0
        metadata = {
          scopeMagnitude: args.scope_magnitude as ScopeMagnitude,
          classificationReason: args.classification_reason,
          subAreas: args.sub_areas,
          nonTechnicalDimensions: dimensions,
          nonTechnicalFlag: flag,
        }
      }

      const frontmatter = [
        "---",
        `title: "${args.title.replace(/"/g, '\\"')}"`,
        `slug: "${args.slug}"`,
        `date: "${now}"`,
        "status: draft",
        "---",
        "",
      ].join("\n")

      // Dual-write: prepend the metadata projection block when metadata is present
      // so the manager LLM sees it via analyze_briefing (which reads the markdown file).
      const projectionBlock = metadata ? buildMetadataProjection(metadata) : ""
      await fs.mkdir(join(filePath, ".."), { recursive: true })
      await fs.writeFile(filePath, frontmatter + projectionBlock + args.content, "utf-8")

      state.briefing.path = briefingRelPath
      state.briefing.status = "draft"
      state.briefing.metadata = metadata
      await saveState(context.directory, state, context.sessionID)

      return successResponse(
        "Briefing Created",
        `${formatPhaseHeader(state.currentPhase)}\n\nBriefing saved to ${briefingRelPath}`,
        { slug: args.slug, path: briefingRelPath }
      )
    } catch (err) {
      return errorResponse(`Error creating briefing: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const approveBriefingTool = tool({
  description:
    "Marks the current briefing as approved and updates the state. Must be called after human approval.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      if (!state.briefing.path) {
        return errorResponse("No briefing found. Create a briefing first.")
      }

      state.briefing.status = "approved"

      // Paths stored in state are RELATIVE to the workspace (spec-6886df4f, TD3).
      // Prepend context.directory for all filesystem I/O.
      const filePath = resolveAbsolutePath(context.directory, state.briefing.path)
      let content = await fs.readFile(filePath, "utf-8")
      const updated = content.replace(/status:\s*['"]?draft['"]?/g, "status: approved")
      if (updated === content) {
        return errorResponse("Briefing file does not contain 'status: draft'. It may have already been approved or the frontmatter is malformed.")
      }
      content = updated
      await fs.writeFile(filePath, content, "utf-8")

      await saveState(context.directory, state, context.sessionID)
      await logAction(context.directory, "briefing_approved", state.currentPhase, { slug: state.briefing.slug })

      return successResponse(
        "Briefing Approved",
        `${formatPhaseHeader(state.currentPhase)}\n\nBriefing "${state.briefing.slug}" approved. Ready for delivery to Manager.`
      )
    } catch (err) {
      return errorResponse(`Error approving briefing: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const importBriefingTool = tool({
  description:
    "Imports an existing briefing file into the Mesa workflow. Use when the user provides a briefing directly instead of going through the briefing-writer. Treats the file as pre-approved and sets phase to PLANNING. Can be called from any phase to restart with a new briefing.",
  args: {
    file_path: tool.schema.string().describe("Absolute path to the existing briefing file"),
    slug: tool.schema.string().describe("URL-friendly identifier for the briefing (lowercase, numbers, hyphens only)"),
    title: tool.schema.string().optional().describe("Title for the briefing (defaults to filename)"),
  },
  async execute(args, context) {
    try {
      if (!isValidSlug(args.slug)) {
        throw new ValidationError("Invalid slug. Use lowercase letters, numbers, and hyphens only.")
      }

      try {
        await fs.access(args.file_path)
      } catch {
        return errorResponse(`File not found: ${args.file_path}`)
      }

      const content = await fs.readFile(args.file_path, "utf-8")
      if (!content.trim()) {
        return errorResponse("Briefing file is empty.")
      }

      const state = await loadState(context.directory, context.sessionID)
      state.briefing.slug = args.slug

      const sessionId = getSessionId(context.directory, context.sessionID)
      if (!sessionId) {
        throw new Error("No active session. Ensure loadState() was called.")
      }

      // Compute session-scoped briefing path (spec-6886df4f, TD2).
      const input = await ensureSessionInput(
        context.directory, state, sessionId, getDb
      )
      const destRelPath = buildBriefingPath(input)
      const destPath = join(context.directory, destRelPath)

      // Path-traversal guard
      if (!resolve(destPath).startsWith(resolve(context.directory))) {
        return errorResponse("Invalid path detected.")
      }

      // Best-effort: if a briefing already exists at the session path, surface
      // a helpful error. (Session folders are unique per workspace, so a
      // collision here means the same session already created a briefing.)
      try {
        await fs.access(destPath)
        return errorResponse(
          `A briefing already exists for this session at ${destRelPath}. ` +
          `Use create_briefing to replace it, or start a new session.`
        )
      } catch {
        // File doesn't exist, proceed
      }

      await fs.mkdir(join(destPath, ".."), { recursive: true })
      await fs.copyFile(args.file_path, destPath)

      state.briefing = {
        path: destRelPath,
        status: "approved",
        slug: args.slug,
        // Imported briefings bypass discovery — default to composite so the
        // manager doesn't under-treat the scope (spec-fb0ba2d7, Decision 6).
        metadata: {
          scopeMagnitude: "composite",
          classificationReason: "imported — human-provided briefing",
          nonTechnicalDimensions: [],
          nonTechnicalFlag: false,
        },
      }

      state.currentPhase = "PLANNING"
      state.team = []
      state.discussion = {
        ...state.discussion,
        analyses: [],
        votes: [],
        currentTurn: 0,
        consensusRound: 0,
      }
      state.specification = {
        path: null,
        overviewPath: null,
        status: "pending",
      }
      state.previousPhase = null

      await saveState(context.directory, state, context.sessionID)

      return successResponse(
        "Briefing Imported",
        `${formatPhaseHeader(state.currentPhase)}\n\nExisting briefing imported from ${args.file_path}.\n\nSlug: ${args.slug}\nStatus: approved (pre-approved)\nPhase: PLANNING\n\nThe workflow has been reset. The Manager can now analyze the briefing and propose a team.`
      )
    } catch (err) {
      return errorResponse(`Error importing briefing: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const deliverBriefingTool = tool({
  description:
    "Delivers the approved briefing to the Manager. Updates the state phase to PLANNING. The Manager reads briefing.md directly from the session folder — no delivery copy is created.",
  args: {},
  async execute(_args, context) {
    try {
      const state = await loadState(context.directory, context.sessionID)
      if (state.briefing.status !== "approved") {
        return errorResponse("Briefing must be approved before delivery. Use approve_briefing first.")
      }
      if (!state.briefing.path) {
        return errorResponse("No briefing path found.")
      }

      // Decision M4 (spec-6886df4f): ELIMINATE briefing-current-{sessionId}.md.
      // The Manager reads briefing.md directly from state.briefing.path.
      // This tool now only updates state — no file copy is created.

      state.currentPhase = "PLANNING"
      state.briefing.status = "delivered"
      // Composite-default-on-unknown: if the briefing-writer never classified
      // the scope, default to composite so the manager doesn't under-treat it
      // (spec-fb0ba2d7, Decision 6).
      if (state.briefing.metadata === null) {
        state.briefing.metadata = {
          scopeMagnitude: "composite",
          classificationReason: "default — no explicit classification during discovery",
          nonTechnicalDimensions: [],
          nonTechnicalFlag: false,
        }
      }
      await saveState(context.directory, state, context.sessionID)
      await logAction(context.directory, "briefing_delivered", state.currentPhase, { slug: state.briefing.slug })

      return successResponse(
        "Briefing Delivered to Manager",
        `${formatPhaseHeader(state.currentPhase)}\n\nBriefing is ready for the Manager at ${state.briefing.path}.\n\nNext step: analyze the briefing and propose a team. If you are not already acting as the Manager agent, switch by typing \`/agent manager\`.`,
        { briefingPath: state.briefing.path }
      )
    } catch (err) {
      return errorResponse(`Error delivering briefing: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
