import { tool } from "@opencode-ai/plugin/tool"
import { openDatabase, type IDatabase } from "../db/driver.js"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { successResponse, errorResponse } from "../utils/responses.js"
import { PLUGIN_STATE_DIR } from "../config.js"
import { logAction } from "../audit.js"
import type { MemoryCategory, MemoryScope } from "../types.js"

const MEMORY_TTL_DAYS = 90
const MAX_CONTENT_LENGTH = 500
const MIN_CONTENT_LENGTH = 20

function openMemoryDb(directory: string): IDatabase {
  const dbPath = join(directory, PLUGIN_STATE_DIR, "state.db")
  const db = openDatabase(dbPath, { create: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA busy_timeout = 5000")
  return db
}

function computeContentHash(content: string): string {
  return createHash("sha256").update(content.trim().toLowerCase()).digest("hex")
}

function computeExpiresAt(scope: MemoryScope): string | null {
  if (scope === "global") return null
  const d = new Date()
  d.setDate(d.getDate() + MEMORY_TTL_DAYS)
  return d.toISOString()
}

export const memoryStoreTool = tool({
  description:
    "Stores a new memory entry for cross-session knowledge persistence. " +
    "Content is deduplicated via SHA-256 hash — calling with identical content returns the existing entry (idempotent). " +
    "Project-scope memories have a 90-day TTL by default.",
  args: {
    content: tool.schema
      .string()
      .min(MIN_CONTENT_LENGTH)
      .max(MAX_CONTENT_LENGTH)
      .describe(
        `The memory content to store (${MIN_CONTENT_LENGTH}-${MAX_CONTENT_LENGTH} characters). ` +
        "Be specific and actionable — 'use bun for runtime' is too vague; " +
        "'this project uses bun runtime with ESM — never use require()' is good."
      ),
    category: tool.schema
      .enum(["lesson", "observation", "preference", "architecture", "pitfall", "convention"])
      .describe("Memory category for filtering"),
    scope: tool.schema
      .enum(["project", "global"])
      .optional()
      .default("project")
      .describe("Memory scope — 'project' (default, workspace-local) or 'global' (cross-workspace)"),
  },
  async execute(args, context) {
    try {
      const db = openMemoryDb(context.directory)
      try {
        const workspaceId = context.directory
        const scope: MemoryScope = args.scope ?? "project"
        const contentHash = computeContentHash(args.content)
        const now = new Date().toISOString()

        // Source agent: use session ID as proxy when agent identity is unavailable
        const sourceAgent = context.sessionID ?? "unknown"
        const sourceSession = context.sessionID ?? null

        // Dedup check
        const existing = db
          .query(
            "SELECT id FROM mesa_memory WHERE workspace_id = ? AND scope = ? AND category = ? AND source_agent = ? AND content_hash = ? AND status = 'active'"
          )
          .get(workspaceId, scope, args.category, sourceAgent, contentHash) as { id: number } | null

        if (existing) {
          return successResponse(
            "Memory Exists (Idempotent)",
            `An identical memory entry already exists (id=${existing.id}). No duplicate created.`,
            { id: existing.id, deduplicated: true }
          )
        }

        const expiresAt = computeExpiresAt(scope)

        const result = db.run(
          `INSERT INTO mesa_memory (
            workspace_id, scope, category, content,
            source_agent, source_session,
            access_count, last_accessed, relevance_score, expires_at,
            status, content_hash, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 1.0, ?, 'active', ?, ?, ?)`,
          [
            workspaceId, scope, args.category, args.content,
            sourceAgent, sourceSession,
            expiresAt, contentHash, now, now,
          ]
        )

        const memoryId = result.lastInsertRowid as number

        await logAction(context.directory, "memory_stored", "MEMORY", {
          id: memoryId,
          category: args.category,
          scope,
          contentLength: args.content.length,
        })

        const preview = args.content.length > 80
          ? args.content.slice(0, 80) + "..."
          : args.content

        return successResponse(
          "Memory Stored",
          `Stored memory entry (id=${memoryId}).\n\n**Preview:** ${preview}`,
          { id: memoryId, category: args.category, scope }
        )
      } finally {
        db.close()
      }
    } catch (err) {
      return errorResponse(`Error storing memory: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const memoryRecallTool = tool({
  description:
    "Recalls memories from the project memory store. Filters by category and/or query substring. " +
    "Increments access_count on each returned entry for relevance ranking. " +
    "Use this to check for relevant project knowledge before starting analysis or implementation.",
  args: {
    category: tool.schema
      .enum(["lesson", "observation", "preference", "architecture", "pitfall", "convention"])
      .optional()
      .describe("Filter by memory category"),
    query: tool.schema
      .string()
      .optional()
      .describe("Substring search on memory content (case-insensitive)"),
    limit: tool.schema
      .number()
      .min(1)
      .max(20)
      .optional()
      .default(10)
      .describe("Maximum number of memories to return (default 10, max 20)"),
  },
  async execute(args, context) {
    try {
      const db = openMemoryDb(context.directory)
      try {
        const workspaceId = context.directory
        const limit = Math.min(args.limit ?? 10, 20)
        const now = new Date().toISOString()

        // Build dynamic WHERE clause
        const conditions: string[] = ["workspace_id = ?", "status = 'active'"]
        const params: unknown[] = [workspaceId]

        if (args.category) {
          conditions.push("category = ?")
          params.push(args.category)
        }

        if (args.query) {
          conditions.push("content LIKE ?")
          params.push(`%${args.query}%`)
        }

        const whereClause = conditions.join(" AND ")
        const sql = `SELECT * FROM mesa_memory WHERE ${whereClause} ORDER BY access_count DESC, updated_at DESC LIMIT ?`
        const rows = db.query(sql).all(...params, limit) as Array<Record<string, unknown>>

        if (rows.length === 0) {
          return successResponse(
            "No Memories Found",
            "No matching memories found. Use memory_store to persist knowledge across sessions."
          )
        }

        // Increment access_count and update last_accessed for each returned entry
        for (const row of rows) {
          db.run(
            "UPDATE mesa_memory SET access_count = access_count + 1, last_accessed = ? WHERE id = ?",
            [now, row.id]
          )
        }

        const formatted = rows.map((row) => {
          const content = row.content as string
          const preview = content.length > 120 ? content.slice(0, 120) + "..." : content
          return [
            `**[${row.id}]** [${row.category}] (accessed: ${row.access_count ?? 0}x)`,
            preview,
            `  _scope=${row.scope} | score=${row.relevance_score} | ${row.updated_at}_`,
          ].join("\n")
        })

        const output = [
          `Found ${rows.length} memories.`,
          "",
          ...formatted,
        ].join("\n")

        return successResponse(
          "Memories Recalled",
          output,
          { count: rows.length, categories: rows.map((r) => r.category) }
        )
      } finally {
        db.close()
      }
    } catch (err) {
      return errorResponse(`Error recalling memories: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const memoryForgetTool = tool({
  description:
    "Soft-deletes a memory entry by ID. Marks as status='deleted' with a 7-day recovery window. " +
    "Use this to remove noisy or incorrect observations. Deleted entries can be re-created with memory_store.",
  args: {
    id: tool.schema
      .number()
      .int()
      .positive()
      .describe("The memory entry ID to delete (from memory_recall output)"),
  },
  async execute(args, context) {
    try {
      const db = openMemoryDb(context.directory)
      try {
        const workspaceId = context.directory
        const now = new Date().toISOString()

        const result = db.run(
          "UPDATE mesa_memory SET status = 'deleted', updated_at = ? WHERE id = ? AND workspace_id = ? AND status = 'active'",
          [now, args.id, workspaceId]
        )

        if (result.changes === 0) {
          return errorResponse(
            `Memory entry not found or already deleted (id=${args.id}). ` +
            "Check the ID from memory_recall output."
          )
        }

        await logAction(context.directory, "memory_forgotten", "MEMORY", {
          id: args.id,
        })

        return successResponse(
          "Memory Deleted",
          `Memory entry ${args.id} soft-deleted. It will be permanently purged after 7 days.\n\nTo undo: re-store the content with memory_store.`,
          { id: args.id }
        )
      } finally {
        db.close()
      }
    } catch (err) {
      return errorResponse(`Error deleting memory: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
