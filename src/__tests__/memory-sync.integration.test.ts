import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { loadState, closeStorage } from "../state.js"
import { openDatabase } from "../db/driver.js"
import {
  memoryStoreTool,
  memoryRecallTool,
  memoryForgetTool,
} from "../tools/memory-tools.js"
import {
  reconcileMemories,
  purgeStaleMemoryFiles,
} from "../tools/memory-sync.js"
import type { IDatabase } from "../db/driver.js"
import type { ToolResult } from "@opencode-ai/plugin/tool"

function getMeta<T = Record<string, unknown>>(result: ToolResult): T {
  if (typeof result === "string") return {} as T
  return (result.metadata ?? {}) as T
}

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "memory-sync-integration")

function computeHash(content: string): string {
  return createHash("sha256").update(content.trim().toLowerCase()).digest("hex")
}

function makeContext(sessionId = "test-session") {
  return {
    sessionID: sessionId,
    messageID: "test-msg",
    agent: "test",
    directory: TEST_DIR,
    worktree: TEST_DIR,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

function getDbPath() {
  return join(TEST_DIR, ".mesa", "state.db")
}

function openTestDb(): IDatabase {
  const db = openDatabase(getDbPath(), { create: true })
  db.run("PRAGMA journal_mode = WAL")
  db.run("PRAGMA busy_timeout = 5000")
  return db
}

function countMemories(status?: string): number {
  const db = openTestDb()
  try {
    if (status) {
      const row = db
        .query("SELECT COUNT(*) as cnt FROM mesa_memory WHERE workspace_id = ? AND status = ?")
        .get(TEST_DIR, status) as { cnt: number }
      return row.cnt
    }
    const row = db
      .query("SELECT COUNT(*) as cnt FROM mesa_memory WHERE workspace_id = ?")
      .get(TEST_DIR) as { cnt: number }
    return row.cnt
  } finally {
    db.close()
  }
}

function getMemoryByHash(hash: string): Record<string, unknown> | null {
  const db = openTestDb()
  try {
    return db
      .query("SELECT * FROM mesa_memory WHERE workspace_id = ? AND content_hash = ?")
      .get(TEST_DIR, hash) as Record<string, unknown> | null
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Filesystem sync: store creates .md file
// ---------------------------------------------------------------------------

describe("memory-sync integration: store creates Markdown file", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("store project memory creates .md file with correct frontmatter and body", async () => {
    const content = "This project uses bun runtime with ESM — never use require() for importing"
    const result = await memoryStoreTool.execute(
      { content, category: "convention" } as any,
      makeContext()
    )

    const { id } = getMeta<{ id: number }>(result)
    const hash = computeHash(content)
    const mdPath = join(TEST_DIR, ".mesa", "memories", `convention--${hash}.md`)

    expect(existsSync(mdPath)).toBe(true)
    const fileContent = readFileSync(mdPath, "utf-8")

    expect(fileContent).toContain("---")
    expect(fileContent).toContain('category: "convention"')
    expect(fileContent).toContain('scope: "project"')
    expect(fileContent).toContain(`content_hash: "${hash}"`)
    expect(fileContent).toContain('status: "active"')
    expect(fileContent).toContain("bun runtime with ESM")
  })

  test("store global memory does NOT create a file", async () => {
    const content = "Global architecture insight about WAL mode for concurrent SQLite access"
    await memoryStoreTool.execute(
      { content, category: "architecture", scope: "global" },
      makeContext()
    )

    const hash = computeHash(content)
    const mdPath = join(TEST_DIR, ".mesa", "memories", `architecture--${hash}.md`)
    expect(existsSync(mdPath)).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// Filesystem sync: forget moves file to deleted/
// ---------------------------------------------------------------------------

describe("memory-sync integration: forget moves file to deleted/", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("forget moves file to deleted/ with status: deleted", async () => {
    const content = "Memory to forget in the filesystem sync integration test scenario"
    const storeResult = await memoryStoreTool.execute(
      { content, category: "observation" } as any,
      makeContext()
    )
    const id = getMeta<{ id: number }>(storeResult).id
    const hash = computeHash(content)

    const activePath = join(TEST_DIR, ".mesa", "memories", `observation--${hash}.md`)
    expect(existsSync(activePath)).toBe(true)

    await memoryForgetTool.execute({ id }, makeContext())

    expect(existsSync(activePath)).toBe(false)
    const deletedPath = join(TEST_DIR, ".mesa", "memories", "deleted", `observation--${hash}.md`)
    expect(existsSync(deletedPath)).toBe(true)
    const deletedContent = readFileSync(deletedPath, "utf-8")
    expect(deletedContent).toContain('status: "deleted"')
  })

  test("re-store after forget reactivates the file from deleted/", async () => {
    const content = "Memory that will be forgotten and then restored in the integration test"
    const storeResult = await memoryStoreTool.execute(
      { content, category: "lesson" } as any,
      makeContext()
    )
    const id = getMeta<{ id: number }>(storeResult).id
    const hash = computeHash(content)

    await memoryForgetTool.execute({ id }, makeContext())

    const deletedPath = join(TEST_DIR, ".mesa", "memories", "deleted", `lesson--${hash}.md`)
    expect(existsSync(deletedPath)).toBe(true)

    const restoreResult = await memoryStoreTool.execute(
      { content, category: "lesson" } as any,
      makeContext()
    )
    expect(restoreResult).toHaveProperty("title", "Memory Reactivated")
    const restoreId = getMeta<{ id: number }>(restoreResult).id
    expect(restoreId).toBe(id)

    expect(existsSync(deletedPath)).toBe(false)
    const activePath = join(TEST_DIR, ".mesa", "memories", `lesson--${hash}.md`)
    expect(existsSync(activePath)).toBe(true)
    const activeContent = readFileSync(activePath, "utf-8")
    expect(activeContent).toContain('status: "active"')
  })
})

// ---------------------------------------------------------------------------
// Git-pull simulation: drop .md file, reconcile imports it
// ---------------------------------------------------------------------------

describe("memory-sync integration: git-pull simulation", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("drop a Markdown file into .mesa/memories/, call memory_recall, verify it appears in DB", async () => {
    const content = "Git-pulled memory file about the project using vitest for testing"
    const hash = computeHash(content)
    const now = new Date().toISOString()
    const pastDate = "2026-01-01T00:00:00.000Z"

    const fileContent = [
      "---",
      `id: 999`,
      `category: "convention"`,
      `scope: "project"`,
      `source_agent: "teammate"`,
      `source_session: "ses_teammate"`,
      `content_hash: "${hash}"`,
      `access_count: 0`,
      `relevance_score: 1.0`,
      `status: "active"`,
      `created_at: "${pastDate}"`,
      `updated_at: "${pastDate}"`,
      `expires_at: null`,
      `synced_at: null`,
      "---",
      "",
      content,
    ].join("\n")

    const memoriesDir = join(TEST_DIR, ".mesa", "memories")
    mkdirSync(memoriesDir, { recursive: true })
    writeFileSync(join(memoriesDir, `convention--${hash}.md`), fileContent, "utf-8")

    expect(countMemories("active")).toBe(0)

    const result = await memoryRecallTool.execute({} as any, makeContext())

    expect(result).toHaveProperty("title", "Memories Recalled")
    expect(countMemories("active")).toBe(1)

    const row = getMemoryByHash(hash)
    expect(row).not.toBeNull()
    expect(row!.content).toBe(content)
    expect(row!.category).toBe("convention")
    expect(row!.source_agent).toBe("teammate")
    expect(row!.status).toBe("active")
  })

  test("reconciliation is idempotent (run twice, no duplicates)", async () => {
    const content = "Idempotency test content for reconciliation without any duplication"
    await memoryStoreTool.execute(
      { content, category: "convention" } as any,
      makeContext()
    )

    expect(countMemories()).toBe(1)

    const db = openTestDb()
    try {
      reconcileMemories(TEST_DIR, db)
    } finally {
      db.close()
    }

    expect(countMemories()).toBe(1)

    const db2 = openTestDb()
    try {
      reconcileMemories(TEST_DIR, db2)
    } finally {
      db2.close()
    }

    expect(countMemories()).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// Conflict resolution: file with newer updated_at wins
// ---------------------------------------------------------------------------

describe("memory-sync integration: conflict resolution", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("file with newer updated_at wins over DB", async () => {
    const originalContent = "Original content for the conflict resolution test scenario here"
    const storeResult = await memoryStoreTool.execute(
      { content: originalContent, category: "lesson" } as any,
      makeContext()
    )
    const id = getMeta<{ id: number }>(storeResult).id

    const updatedContent = "Updated content that was edited directly in the markdown file"
    const updatedHash = computeHash(updatedContent)
    const futureDate = "2099-12-31T23:59:59.000Z"

    const fileContent = [
      "---",
      `id: ${id}`,
      `category: "lesson"`,
      `scope: "project"`,
      `source_agent: "editor"`,
      `source_session: null`,
      `content_hash: "${updatedHash}"`,
      `access_count: 5`,
      `relevance_score: 2.0`,
      `status: "active"`,
      `created_at: "2026-01-01T00:00:00.000Z"`,
      `updated_at: "${futureDate}"`,
      `expires_at: null`,
      `synced_at: null`,
      "---",
      "",
      updatedContent,
    ].join("\n")

    const oldHash = computeHash(originalContent)
    const oldPath = join(TEST_DIR, ".mesa", "memories", `lesson--${oldHash}.md`)
    const newPath = join(TEST_DIR, ".mesa", "memories", `lesson--${updatedHash}.md`)
    writeFileSync(newPath, fileContent, "utf-8")

    const db = openTestDb()
    try {
      reconcileMemories(TEST_DIR, db)
    } finally {
      db.close()
    }

    const newRow = getMemoryByHash(updatedHash)
    expect(newRow).not.toBeNull()
    expect(newRow!.content).toBe(updatedContent)
    expect(newRow!.source_agent).toBe("editor")
    expect(Number(newRow!.access_count)).toBe(5)
  })

  test("malformed Markdown is skipped without crash", async () => {
    const garbageDir = join(TEST_DIR, ".mesa", "memories")
    mkdirSync(garbageDir, { recursive: true })
    writeFileSync(
      join(garbageDir, "garbage--notahash.md"),
      "This file has no frontmatter at all, just random text content here",
      "utf-8",
    )
    writeFileSync(
      join(garbageDir, "bad--fakehash.md"),
      "---\nthis is not: valid: yaml: at all\n---\n\nbody",
      "utf-8",
    )

    const db = openTestDb()
    try {
      expect(() => reconcileMemories(TEST_DIR, db)).not.toThrow()
    } finally {
      db.close()
    }

    expect(countMemories()).toBe(0)
  })

  test("synced_at only updated on real diffs", async () => {
    const content = "Content to verify that synced_at is only updated on real diffs not no-ops"
    await memoryStoreTool.execute(
      { content, category: "convention" } as any,
      makeContext()
    )

    const db1 = openTestDb()
    try {
      reconcileMemories(TEST_DIR, db1)
    } finally {
      db1.close()
    }

    const rowAfterFirst = getMemoryByHash(computeHash(content))
    expect(rowAfterFirst).not.toBeNull()
    const firstSynced = rowAfterFirst!.synced_at

    const db2 = openTestDb()
    try {
      reconcileMemories(TEST_DIR, db2)
    } finally {
      db2.close()
    }

    const rowAfterSecond = getMemoryByHash(computeHash(content))
    const secondSynced = rowAfterSecond!.synced_at
    expect(secondSynced).toBe(firstSynced)
  })
})

// ---------------------------------------------------------------------------
// Dedup ignores source_agent for project memories
// ---------------------------------------------------------------------------

describe("memory-sync integration: project dedup ignores source_agent", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("same content from different agents deduplicates for project scope", async () => {
    const content = "Project dedup test: same content from different agents should deduplicate"
    const ctx1 = makeContext("session-alice")
    const ctx2 = makeContext("session-bob")

    const first = await memoryStoreTool.execute(
      { content, category: "convention" } as any,
      ctx1
    )
    const firstId = getMeta<{ id: number }>(first).id

    const second = await memoryStoreTool.execute(
      { content, category: "convention" } as any,
      ctx2
    )
    expect(second).toHaveProperty("title", "Memory Exists (Idempotent)")
    expect(getMeta<{ id: number }>(second).id).toBe(firstId)
  })
})

// ---------------------------------------------------------------------------
// Purge stale memory files
// ---------------------------------------------------------------------------

describe("memory-sync integration: purge stale deleted files", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("purgeStaleMemoryFiles removes deleted files older than 7 days", async () => {
    const oldDate = "2020-01-01T00:00:00.000Z"
    const fileContent = [
      "---",
      `id: 1`,
      `category: "lesson"`,
      `scope: "project"`,
      `source_agent: "old"`,
      `source_session: null`,
      `content_hash: "fakehash"`,
      `access_count: 0`,
      `relevance_score: 1.0`,
      `status: "deleted"`,
      `created_at: "${oldDate}"`,
      `updated_at: "${oldDate}"`,
      `expires_at: null`,
      `synced_at: null`,
      "---",
      "",
      "Old deleted memory that should be purged by the stale file cleanup",
    ].join("\n")

    const deletedDir = join(TEST_DIR, ".mesa", "memories", "deleted")
    mkdirSync(deletedDir, { recursive: true })
    const stalePath = join(deletedDir, "lesson--fakehash.md")
    writeFileSync(stalePath, fileContent, "utf-8")

    expect(existsSync(stalePath)).toBe(true)

    const db = openTestDb()
    try {
      purgeStaleMemoryFiles(TEST_DIR, db)
    } finally {
      db.close()
    }

    expect(existsSync(stalePath)).toBe(false)
  })

  test("purgeStaleMemoryFiles keeps recently deleted files", async () => {
    const recentDate = new Date().toISOString()
    const fileContent = [
      "---",
      `id: 2`,
      `category: "lesson"`,
      `scope: "project"`,
      `source_agent: "recent"`,
      `source_session: null`,
      `content_hash: "recenthash"`,
      `access_count: 0`,
      `relevance_score: 1.0`,
      `status: "deleted"`,
      `created_at: "${recentDate}"`,
      `updated_at: "${recentDate}"`,
      `expires_at: null`,
      `synced_at: null`,
      "---",
      "",
      "Recently deleted memory that should survive the purge cleanup step",
    ].join("\n")

    const deletedDir = join(TEST_DIR, ".mesa", "memories", "deleted")
    mkdirSync(deletedDir, { recursive: true })
    const recentPath = join(deletedDir, "lesson--recenthash.md")
    writeFileSync(recentPath, fileContent, "utf-8")

    const db = openTestDb()
    try {
      purgeStaleMemoryFiles(TEST_DIR, db)
    } finally {
      db.close()
    }

    expect(existsSync(recentPath)).toBe(true)
  })
})
