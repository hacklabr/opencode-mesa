import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, closeStorage } from "../state.js"
import { openDatabase } from "../db/driver.js"
import {
  memoryStoreTool,
  memoryRecallTool,
  memoryForgetTool,
} from "../tools/memory-tools.js"
import type { ToolResult } from "@opencode-ai/plugin/tool"

// Type-safe metadata accessor for ToolResult
function getMeta<T = Record<string, unknown>>(result: ToolResult): T {
  if (typeof result === "string") return {} as T
  return (result.metadata ?? {}) as T
}

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "memory-integration")

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

function openTestDb() {
  return openDatabase(getDbPath(), { create: true })
}

function countActiveMemories(): number {
  const db = openTestDb()
  try {
    const row = db
      .query(
        "SELECT COUNT(*) as cnt FROM mesa_memory WHERE workspace_id = ? AND status = 'active'"
      )
      .get(TEST_DIR) as { cnt: number }
    return row.cnt
  } finally {
    db.close()
  }
}

function getMemoryById(id: number): Record<string, unknown> | null {
  const db = openTestDb()
  try {
    return db
      .query("SELECT * FROM mesa_memory WHERE id = ?")
      .get(id) as Record<string, unknown> | null
  } finally {
    db.close()
  }
}

function getMemoryByHash(hash: string): Record<string, unknown> | null {
  const db = openTestDb()
  try {
    return db
      .query("SELECT * FROM mesa_memory WHERE content_hash = ?")
      .get(hash) as Record<string, unknown> | null
  } finally {
    db.close()
  }
}

// ---------------------------------------------------------------------------
// Cross-session persistence
// ---------------------------------------------------------------------------

describe("memory integration: cross-session persistence", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "session-a")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("stores in session A and recalls in session B on same workspace", async () => {
    const storeResult = await memoryStoreTool.execute(
      {
        content:
          "Cross-session memory: this project uses bun runtime with ESM modules exclusively for all scripts",
        category: "convention",
      } as any,
      makeContext("session-a")
    )
    expect(storeResult).toHaveProperty("title", "Memory Stored")
    const memoryId = getMeta<{ id: number }>(storeResult).id

    // Close session A, simulate a new session
    closeStorage(TEST_DIR)
    await loadState(TEST_DIR, "session-b")

    // Recall with session B — memory should persist across sessions
    const recallResult = await memoryRecallTool.execute(
      {} as any,
      makeContext("session-b")
    )
    expect(recallResult).toHaveProperty("title", "Memories Recalled")
    expect(getMeta<{ count: number }>(recallResult).count).toBe(1)
    expect((recallResult as { output: string }).output).toContain(
      "bun runtime with ESM"
    )

    const row = getMemoryById(memoryId)
    expect(row).not.toBeNull()
    expect(row!.status).toBe("active")
  })
})

// ---------------------------------------------------------------------------
// Dedup
// ---------------------------------------------------------------------------

describe("memory integration: content-hash deduplication", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("identical content returns same ID via exact content-hash dedup", async () => {
    const content =
      "Exact dedup test: storing this exact content twice must return same memory ID always"
    const first = await memoryStoreTool.execute(
      { content, category: "observation" } as any,
      makeContext()
    )
    const second = await memoryStoreTool.execute(
      { content, category: "observation" } as any,
      makeContext()
    )

    const firstId = getMeta<{ id: number }>(first).id
    const secondId = getMeta<{ id: number }>(second).id
    expect(secondId).toBe(firstId)
    expect(second).toHaveProperty("title", "Memory Exists (Idempotent)")

    expect(countActiveMemories()).toBe(1)
  })

  test("similar but not identical content returns different IDs", async () => {
    const content1 =
      "Similar content first version with slight wording difference from second entry"
    const content2 =
      "Similar content second version with slight wording difference from first entry"

    const first = await memoryStoreTool.execute(
      { content: content1, category: "observation" } as any,
      makeContext()
    )
    const second = await memoryStoreTool.execute(
      { content: content2, category: "observation" } as any,
      makeContext()
    )

    expect(getMeta<{ id: number }>(second).id).not.toBe(
      getMeta<{ id: number }>(first).id
    )
    expect(countActiveMemories()).toBe(2)
  })
})

// ---------------------------------------------------------------------------
// Anti-noise: hard cap smoke test
// ---------------------------------------------------------------------------

describe("memory integration: anti-noise hard cap", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("storing many entries does not crash — volume stress test", async () => {
    const categories: Array<"lesson" | "observation" | "preference" | "architecture" | "pitfall" | "convention"> = [
      "lesson", "observation", "preference", "architecture", "pitfall", "convention",
    ]

    for (let i = 0; i < 15; i++) {
      await memoryStoreTool.execute(
        {
          content: `Anti-noise volume test entry ${i}: unique content for cap validation ${i} padding`,
          category: categories[i % categories.length],
        } as any,
        makeContext()
      )
    }

    expect(countActiveMemories()).toBe(15)

    const result = await memoryRecallTool.execute({ limit: 20 }, makeContext())
    expect(result).toHaveProperty("title", "Memories Recalled")
    expect(getMeta<{ count: number }>(result).count).toBe(15)
  })
})

// ---------------------------------------------------------------------------
// Soft-delete lifecycle
// ---------------------------------------------------------------------------

describe("memory integration: soft-delete lifecycle", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("store → forget → recall finds nothing → verify status is deleted in DB", async () => {
    const storeResult = await memoryStoreTool.execute(
      { content: "Lifecycle test: memory goes through store-forget-recall-verify status check cycle", category: "lesson" } as any,
      makeContext()
    )
    const id = getMeta<{ id: number }>(storeResult).id

    // Verify active
    expect(getMemoryById(id)!.status).toBe("active")
    expect(countActiveMemories()).toBe(1)

    // Forget
    const forgetResult = await memoryForgetTool.execute({ id }, makeContext())
    expect(forgetResult).toHaveProperty("title", "Memory Deleted")

    // Recall finds nothing
    const recallResult = await memoryRecallTool.execute({} as any, makeContext())
    expect(recallResult).toHaveProperty("title", "No Memories Found")

    // Row still exists with status='deleted' (soft-delete, not hard-delete)
    const row = getMemoryById(id)
    expect(row).not.toBeNull()
    expect(row!.status).toBe("deleted")
    expect(countActiveMemories()).toBe(0)
  })
})

// ---------------------------------------------------------------------------
// Maintenance sweep
// ---------------------------------------------------------------------------

describe("memory integration: maintenance sweep", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("TTL expiration: entry with expires_at in the past is marked deleted by sweep", async () => {
    const now = new Date().toISOString()
    const pastExpiresAt = new Date(
      Date.now() - 10 * 24 * 60 * 60 * 1000
    ).toISOString()

    // Insert memory with expired TTL directly into DB
    const db = openTestDb()
    db.run(
      `INSERT INTO mesa_memory (
        workspace_id, scope, category, content, source_agent, source_session,
        access_count, last_accessed, relevance_score, expires_at, status, content_hash,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 1.0, ?, 'active', ?, ?, ?)`,
      [
        TEST_DIR,
        "project",
        "observation",
        "Expired TTL test memory that should be marked deleted during maintenance sweep",
        "sweep-test-agent",
        null,
        pastExpiresAt,
        "hash-ttl-expired-test",
        now,
        now,
      ]
    )
    db.close()

    // Verify active before sweep
    expect(getMemoryByHash("hash-ttl-expired-test")!.status).toBe("active")

    // Trigger maintenance sweep via loadState (getDb → maintenanceSweep)
    closeStorage(TEST_DIR)
    await loadState(TEST_DIR, "test-session")

    // Verify now deleted
    const row = getMemoryByHash("hash-ttl-expired-test")
    expect(row).not.toBeNull()
    expect(row!.status).toBe("deleted")
  })

  test("hard purge: soft-deleted entry older than 7 days is removed by sweep", async () => {
    const eightDaysAgo = new Date(
      Date.now() - 8 * 24 * 60 * 60 * 1000
    ).toISOString()
    const thirtyDaysAgo = new Date(
      Date.now() - 30 * 24 * 60 * 60 * 1000
    ).toISOString()

    // Insert soft-deleted memory with updated_at 8 days ago
    const db = openTestDb()
    db.run(
      `INSERT INTO mesa_memory (
        workspace_id, scope, category, content, source_agent, source_session,
        access_count, last_accessed, relevance_score, expires_at, status, content_hash,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 1.0, NULL, 'deleted', ?, ?, ?)`,
      [
        TEST_DIR,
        "project",
        "pitfall",
        "Old soft-deleted memory that should be hard-purged by the maintenance sweep process",
        "purge-test-agent",
        null,
        "hash-hard-purge-test",
        thirtyDaysAgo,
        eightDaysAgo,
      ]
    )
    db.close()

    // Verify row exists before sweep
    expect(getMemoryByHash("hash-hard-purge-test")).not.toBeNull()

    // Trigger maintenance sweep
    closeStorage(TEST_DIR)
    await loadState(TEST_DIR, "test-session")

    // Verify row is hard-purged (completely removed)
    expect(getMemoryByHash("hash-hard-purge-test")).toBeNull()
  })

  test("recently soft-deleted entry within 7 days is NOT purged by sweep", async () => {
    const twoDaysAgo = new Date(
      Date.now() - 2 * 24 * 60 * 60 * 1000
    ).toISOString()
    const fiveDaysAgo = new Date(
      Date.now() - 5 * 24 * 60 * 60 * 1000
    ).toISOString()

    // Insert soft-deleted memory with updated_at 2 days ago (within recovery window)
    const db = openTestDb()
    db.run(
      `INSERT INTO mesa_memory (
        workspace_id, scope, category, content, source_agent, source_session,
        access_count, last_accessed, relevance_score, expires_at, status, content_hash,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 0, NULL, 1.0, NULL, 'deleted', ?, ?, ?)`,
      [
        TEST_DIR,
        "project",
        "lesson",
        "Recent deleted memory still within the 7 day recovery window of the sweep",
        "recent-purge-agent",
        null,
        "hash-recent-deleted-test",
        fiveDaysAgo,
        twoDaysAgo,
      ]
    )
    db.close()

    // Trigger maintenance sweep
    closeStorage(TEST_DIR)
    await loadState(TEST_DIR, "test-session")

    // Row should still exist (not purged)
    const row = getMemoryByHash("hash-recent-deleted-test")
    expect(row).not.toBeNull()
    expect(row!.status).toBe("deleted")
  })
})
