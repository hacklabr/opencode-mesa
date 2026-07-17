import { join } from "node:path"
import { createHash } from "node:crypto"
import {
  mkdirSync,
  existsSync,
  readFileSync,
  readdirSync,
  openSync,
  writeSync,
  fsyncSync,
  closeSync,
  renameSync,
  unlinkSync,
  statSync,
} from "node:fs"
import type { IDatabase } from "../db/driver.js"
import type { MemoryEntry, MemoryCategory, MemoryStatus } from "../types.js"
import { PLUGIN_STATE_DIR } from "../config.js"
import { logAction } from "../audit.js"

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function computeContentHash(content: string): string {
  return createHash("sha256").update(content.trim().toLowerCase()).digest("hex")
}

function escapeYamlString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"')
}

function yamlLine(key: string, value: string | number | null): string {
  if (value === null) return `${key}: null`
  if (typeof value === "number") return `${key}: ${value}`
  return `${key}: "${escapeYamlString(value)}"`
}

function serializeFrontmatter(row: MemoryEntry): string {
  const lines: string[] = ["---"]
  lines.push(yamlLine("id", row.id))
  lines.push(yamlLine("category", row.category))
  lines.push(yamlLine("scope", row.scope))
  lines.push(yamlLine("source_agent", row.source_agent))
  lines.push(yamlLine("source_session", row.source_session))
  lines.push(yamlLine("content_hash", row.content_hash))
  lines.push(yamlLine("access_count", row.access_count))
  lines.push(yamlLine("relevance_score", row.relevance_score))
  lines.push(yamlLine("status", row.status))
  lines.push(yamlLine("created_at", row.created_at))
  lines.push(yamlLine("updated_at", row.updated_at))
  lines.push(yamlLine("expires_at", row.expires_at))
  lines.push(yamlLine("synced_at", row.synced_at))
  lines.push("---")
  return lines.join("\n")
}

function parseYamlValue(raw: string): string | number | null {
  const trimmed = raw.trim()
  if (trimmed === "null") return null
  if (trimmed.startsWith('"') && trimmed.endsWith('"') && trimmed.length >= 2) {
    return trimmed.slice(1, -1).replace(/\\(.)/g, "$1")
  }
  if (trimmed !== "" && !isNaN(Number(trimmed))) {
    return Number(trimmed)
  }
  return trimmed
}

function parseFrontmatter(
  content: string,
): { frontmatter: Record<string, string | number | null>; body: string } | null {
  const lines = content.split("\n")
  if (lines[0] !== "---") return null

  let closingIdx = -1
  for (let i = 1; i < lines.length; i++) {
    if (lines[i] === "---") {
      closingIdx = i
      break
    }
  }
  if (closingIdx === -1) return null

  const frontmatter: Record<string, string | number | null> = {}
  for (const line of lines.slice(1, closingIdx)) {
    const colonIdx = line.indexOf(":")
    if (colonIdx === -1) continue
    const key = line.slice(0, colonIdx).trim()
    const rawValue = line.slice(colonIdx + 1)
    frontmatter[key] = parseYamlValue(rawValue)
  }

  let bodyStart = closingIdx + 1
  if (bodyStart < lines.length && lines[bodyStart] === "") {
    bodyStart++
  }
  const body = lines.slice(bodyStart).join("\n")

  return { frontmatter, body }
}

function buildFileContent(row: MemoryEntry): string {
  return serializeFrontmatter(row) + "\n\n" + row.content
}

function atomicWrite(targetPath: string, content: string): void {
  const tmpPath = `${targetPath}.tmp-${process.pid}-${Date.now()}`
  const fd = openSync(tmpPath, "w", 0o644)
  try {
    writeSync(fd, content)
    fsyncSync(fd)
  } catch (e) {
    try { closeSync(fd) } catch { /* ignore */ }
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
    throw e
  }
  closeSync(fd)

  try {
    renameSync(tmpPath, targetPath)
  } catch (e) {
    try { unlinkSync(tmpPath) } catch { /* ignore */ }
    throw e
  }
}

function cleanupTmpDebris(dir: string): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000
  for (const name of entries) {
    if (!name.includes(".tmp-")) continue
    const filePath = join(dir, name)
    try {
      const stat = statSync(filePath)
      if (stat.mtimeMs < fiveMinutesAgo) {
        unlinkSync(filePath)
      }
    } catch {
      // gone
    }
  }
}

// ---------------------------------------------------------------------------
// Exported API
// ---------------------------------------------------------------------------

export function memoryFilePath(category: string, contentHash: string): string {
  return join("memories", `${category}--${contentHash}.md`)
}

export function writeMemoryFile(directory: string, row: MemoryEntry): void {
  if (row.scope !== "project") return
  if (!row.content_hash) return

  const fileName = `${row.category}--${row.content_hash}.md`
  const targetDir = join(directory, PLUGIN_STATE_DIR, "memories")
  const targetPath = join(targetDir, fileName)

  try {
    mkdirSync(targetDir, { recursive: true })
    const content = buildFileContent(row)
    atomicWrite(targetPath, content)
  } catch (e) {
    logAction(directory, "memory_sync_failed", "MEMORY", {
      error: e instanceof Error ? e.message : String(e),
      path: memoryFilePath(row.category, row.content_hash),
    }).catch(() => {})
  }
}

export function markMemoryDeleted(directory: string, row: MemoryEntry): void {
  if (row.scope !== "project") return
  if (!row.content_hash) return

  const fileName = `${row.category}--${row.content_hash}.md`
  const memoriesDir = join(directory, PLUGIN_STATE_DIR, "memories")
  const activePath = join(memoriesDir, fileName)
  const deletedDir = join(memoriesDir, "deleted")
  const deletedPath = join(deletedDir, fileName)

  if (!existsSync(activePath)) return

  try {
    mkdirSync(deletedDir, { recursive: true })
    const deletedRow: MemoryEntry = { ...row, status: "deleted" as MemoryStatus }
    const content = buildFileContent(deletedRow)
    atomicWrite(deletedPath, content)
    unlinkSync(activePath)
  } catch (e) {
    logAction(directory, "memory_sync_failed", "MEMORY", {
      error: e instanceof Error ? e.message : String(e),
      path: join("memories", "deleted", fileName),
    }).catch(() => {})
  }
}

export function reactivateMemoryFile(directory: string, row: MemoryEntry): void {
  if (row.scope !== "project") return
  if (!row.content_hash) return

  const fileName = `${row.category}--${row.content_hash}.md`
  const memoriesDir = join(directory, PLUGIN_STATE_DIR, "memories")
  const activePath = join(memoriesDir, fileName)
  const deletedPath = join(memoriesDir, "deleted", fileName)

  if (!existsSync(deletedPath)) return

  try {
    mkdirSync(memoriesDir, { recursive: true })
    const activeRow: MemoryEntry = { ...row, status: "active" as MemoryStatus }
    const content = buildFileContent(activeRow)
    atomicWrite(activePath, content)
    unlinkSync(deletedPath)
  } catch (e) {
    logAction(directory, "memory_sync_failed", "MEMORY", {
      error: e instanceof Error ? e.message : String(e),
      path: memoryFilePath(row.category, row.content_hash),
    }).catch(() => {})
  }
}

interface FileInfo {
  path: string
  location: "active" | "deleted"
  frontmatter: Record<string, string | number | null>
  body: string
  category: string
  contentHash: string
  status: string
  updatedAt: string
}

function scanMemoryDir(
  dir: string,
  location: "active" | "deleted",
  fileMap: Map<string, FileInfo>,
): void {
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return
  }

  for (const name of entries) {
    if (!name.endsWith(".md")) continue
    if (name.includes(".tmp-")) continue
    const filePath = join(dir, name)

    let content: string
    try {
      content = readFileSync(filePath, "utf-8")
    } catch (e) {
      process.stderr.write(
        `[Mesa memory-sync] Failed to read ${filePath}: ${(e as Error).message}\n`,
      )
      continue
    }

    const parsed = parseFrontmatter(content)
    if (!parsed) {
      process.stderr.write(
        `[Mesa memory-sync] Invalid frontmatter in ${filePath}, skipping\n`,
      )
      continue
    }

    const fm = parsed.frontmatter
    if (!fm.category || !fm.content_hash || !fm.status) {
      process.stderr.write(
        `[Mesa memory-sync] Missing required keys in ${filePath}, skipping\n`,
      )
      continue
    }
    if (fm.scope !== "project") continue

    const category = String(fm.category)
    const body = parsed.body
    const contentHash = computeContentHash(body)
    const key = `${category}--${contentHash}`

    fileMap.set(key, {
      path: filePath,
      location,
      frontmatter: fm,
      body,
      category,
      contentHash,
      status: String(fm.status),
      updatedAt: String(fm.updated_at ?? new Date().toISOString()),
    })
  }
}

function dbRowToEntry(row: Record<string, unknown>, syncedAt: string | null): MemoryEntry {
  return {
    id: Number(row.id),
    workspace_id: String(row.workspace_id),
    scope: "project",
    category: String(row.category) as MemoryCategory,
    content: String(row.content),
    source_agent: String(row.source_agent ?? "unknown"),
    source_session: (row.source_session as string | null) ?? null,
    access_count: Number(row.access_count ?? 0),
    last_accessed: (row.last_accessed as string | null) ?? null,
    relevance_score: Number(row.relevance_score ?? 1.0),
    expires_at: (row.expires_at as string | null) ?? null,
    status: (row.status as MemoryStatus) ?? "active",
    content_hash: String(row.content_hash),
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
    synced_at: syncedAt,
  }
}

function writeEntryToPath(
  directory: string,
  entry: MemoryEntry,
  asDeleted: boolean,
): void {
  const fileName = `${entry.category}--${entry.content_hash}.md`
  const subDir = asDeleted ? join("memories", "deleted") : "memories"
  const targetDir = join(directory, PLUGIN_STATE_DIR, subDir)
  const targetPath = join(targetDir, fileName)

  mkdirSync(targetDir, { recursive: true })
  const fileContent = buildFileContent(entry)
  atomicWrite(targetPath, fileContent)
}

function writeRowToFile(
  directory: string,
  row: Record<string, unknown>,
  asDeleted: boolean,
): void {
  const scope = String(row.scope)
  if (scope !== "project") return
  if (!row.content_hash) return
  writeEntryToPath(directory, dbRowToEntry(row, (row.synced_at as string | null) ?? null), asDeleted)
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

export function reconcileMemories(directory: string, db: IDatabase): void {
  const memoriesDir = join(directory, PLUGIN_STATE_DIR, "memories")
  const deletedDir = join(memoriesDir, "deleted")

  mkdirSync(memoriesDir, { recursive: true })

  const fileMap = new Map<string, FileInfo>()
  scanMemoryDir(memoriesDir, "active", fileMap)
  scanMemoryDir(deletedDir, "deleted", fileMap)

  const now = new Date().toISOString()
  const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS

  const dbRows = db
    .query("SELECT * FROM mesa_memory WHERE workspace_id = ? AND scope = 'project'")
    .all(directory) as Array<Record<string, unknown>>

  const dbMap = new Map<string, { row: Record<string, unknown>; id: number }>()
  for (const row of dbRows) {
    const category = String(row.category)
    const contentHash = String(row.content_hash ?? "")
    if (!contentHash) continue
    const key = `${category}--${contentHash}`
    dbMap.set(key, { row, id: Number(row.id) })
  }

  const modifiedIds = new Set<number>()

  // Files not in DB
  for (const [key, info] of fileMap) {
    if (dbMap.has(key)) continue

    const fm = info.frontmatter
    const sourceAgent = String(fm.source_agent ?? "unknown")
    const sourceSession = fm.source_session != null ? String(fm.source_session) : null
    const accessCount = Number(fm.access_count ?? 0)
    const relevanceScore = Number(fm.relevance_score ?? 1.0)
    const expiresAt = fm.expires_at != null ? String(fm.expires_at) : null
    const createdAt = String(fm.created_at ?? now)

    if (info.status === "active") {
      try {
        const result = db.run(
          `INSERT INTO mesa_memory (
            workspace_id, scope, category, content,
            source_agent, source_session,
            access_count, last_accessed, relevance_score, expires_at,
            status, content_hash, created_at, updated_at, synced_at
          ) VALUES (?, 'project', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
          [
            directory, info.category, info.body,
            sourceAgent, sourceSession,
            accessCount, relevanceScore, expiresAt,
            "active", info.contentHash,
            createdAt, info.updatedAt, now,
          ],
        )
        modifiedIds.add(Number(result.lastInsertRowid))
      } catch (e) {
        process.stderr.write(
          `[Mesa memory-sync] Failed to import ${info.path}: ${(e as Error).message}\n`,
        )
      }
    } else if (info.status === "deleted") {
      const updatedTime = new Date(info.updatedAt).getTime()
      if (isNaN(updatedTime) || updatedTime < sevenDaysAgo) {
        try {
          unlinkSync(info.path)
        } catch {
          // gone
        }
      } else {
        try {
          const result = db.run(
            `INSERT INTO mesa_memory (
              workspace_id, scope, category, content,
              source_agent, source_session,
              access_count, last_accessed, relevance_score, expires_at,
              status, content_hash, created_at, updated_at, synced_at
            ) VALUES (?, 'project', ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?)`,
            [
              directory, info.category, info.body,
              sourceAgent, sourceSession,
              accessCount, relevanceScore, expiresAt,
              "deleted", info.contentHash,
              createdAt, info.updatedAt, now,
            ],
          )
          modifiedIds.add(Number(result.lastInsertRowid))
        } catch (e) {
          process.stderr.write(
            `[Mesa memory-sync] Failed to import deleted ${info.path}: ${(e as Error).message}\n`,
          )
        }
      }
    }
  }

  // DB rows not in files
  for (const [key, { row, id }] of dbMap) {
    if (fileMap.has(key)) continue
    const status = String(row.status)
    if (status === "deleted") continue

    try {
      writeRowToFile(directory, row, false)
      modifiedIds.add(id)
    } catch (e) {
      process.stderr.write(
        `[Mesa memory-sync] Failed to write file for row ${id}: ${(e as Error).message}\n`,
      )
    }
  }

  // Both in file and DB — compare updated_at
  for (const [key, { row, id }] of dbMap) {
    const info = fileMap.get(key)
    if (!info) continue

    const dbUpdatedAt = String(row.updated_at)
    const fileUpdatedAt = info.updatedAt

    if (fileUpdatedAt > dbUpdatedAt) {
      const fm = info.frontmatter
      const sourceAgent = String(fm.source_agent ?? "unknown")
      const sourceSession = fm.source_session != null ? String(fm.source_session) : null
      const accessCount = Number(fm.access_count ?? 0)
      const relevanceScore = Number(fm.relevance_score ?? 1.0)
      const expiresAt = fm.expires_at != null ? String(fm.expires_at) : null

      try {
        db.run(
          `UPDATE mesa_memory SET
            content = ?, source_agent = ?, source_session = ?,
            access_count = ?, relevance_score = ?, expires_at = ?,
            status = ?, updated_at = ?, synced_at = ?
          WHERE id = ?`,
          [
            info.body, sourceAgent, sourceSession,
            accessCount, relevanceScore, expiresAt,
            info.status as MemoryStatus, info.updatedAt, now,
            id,
          ],
        )
        modifiedIds.add(id)

        const shouldBeDeleted = info.status === "deleted"
        const currentDeleted = info.location === "deleted"
        if (shouldBeDeleted !== currentDeleted) {
          try { unlinkSync(info.path) } catch { /* gone */ }
          const entryFromFm: MemoryEntry = {
            id,
            workspace_id: String(row.workspace_id),
            scope: "project",
            category: info.category as MemoryCategory,
            content: info.body,
            source_agent: String(fm.source_agent ?? "unknown"),
            source_session: fm.source_session != null ? String(fm.source_session) : null,
            access_count: accessCount,
            last_accessed: null,
            relevance_score: relevanceScore,
            expires_at: expiresAt,
            status: info.status as MemoryStatus,
            content_hash: info.contentHash,
            created_at: String(fm.created_at ?? now),
            updated_at: info.updatedAt,
            synced_at: now,
          }
          try {
            writeEntryToPath(directory, entryFromFm, shouldBeDeleted)
          } catch {
            // non-fatal
          }
        }
      } catch (e) {
        process.stderr.write(
          `[Mesa memory-sync] Failed to update row ${id} from file: ${(e as Error).message}\n`,
        )
      }
    } else {
      const shouldBeDeleted = String(row.status) === "deleted"
      const currentDeleted = info.location === "deleted"

      const existingSyncedAt = (row.synced_at as string | null) ?? null

      let expected = ""
      try {
        expected = buildFileContent(dbRowToEntry(row, existingSyncedAt))
      } catch {
        continue
      }

      let actualContent = ""
      try {
        actualContent = readFileSync(info.path, "utf-8")
      } catch {
        // file gone
      }

      if (actualContent !== expected || shouldBeDeleted !== currentDeleted) {
        try {
          if (shouldBeDeleted !== currentDeleted) {
            try { unlinkSync(info.path) } catch { /* gone */ }
          }
          writeEntryToPath(directory, dbRowToEntry(row, now), shouldBeDeleted)
          modifiedIds.add(id)
        } catch (e) {
          process.stderr.write(
            `[Mesa memory-sync] Failed to rewrite file for row ${id}: ${(e as Error).message}\n`,
          )
        }
      }
    }
  }

  for (const id of modifiedIds) {
    db.run("UPDATE mesa_memory SET synced_at = ? WHERE id = ?", [now, id])
  }

  cleanupTmpDebris(memoriesDir)
  cleanupTmpDebris(deletedDir)
}

export function purgeStaleMemoryFiles(directory: string, _db: IDatabase): void {
  const deletedDir = join(directory, PLUGIN_STATE_DIR, "memories", "deleted")
  let entries: string[]
  try {
    entries = readdirSync(deletedDir)
  } catch {
    return
  }

  const sevenDaysAgo = Date.now() - SEVEN_DAYS_MS

  for (const name of entries) {
    if (!name.endsWith(".md")) continue
    if (name.includes(".tmp-")) continue
    const filePath = join(deletedDir, name)

    let content: string
    try {
      content = readFileSync(filePath, "utf-8")
    } catch {
      continue
    }

    const parsed = parseFrontmatter(content)
    if (!parsed) continue
    if (parsed.frontmatter.status !== "deleted") continue

    const updatedAt = parsed.frontmatter.updated_at
    if (updatedAt == null) continue

    const updatedTime = new Date(String(updatedAt)).getTime()
    if (isNaN(updatedTime)) continue
    if (updatedTime < sevenDaysAgo) {
      try {
        unlinkSync(filePath)
      } catch {
        // gone
      }
    }
  }
}
