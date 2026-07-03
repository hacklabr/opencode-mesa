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
import { tool as toolHelper } from "@opencode-ai/plugin/tool"
import type { ToolResult } from "@opencode-ai/plugin/tool"

// Use the same Zod instance as the tools (tool.schema) to avoid cross-instance incompatibility
const z = toolHelper.schema

// Type-safe metadata accessor for ToolResult
function getMeta<T = Record<string, unknown>>(result: ToolResult): T {
  if (typeof result === "string") return {} as T
  return (result.metadata ?? {}) as T
}

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "memory-tools")

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

function queryMemoryById(id: number): Record<string, unknown> | null {
  const db = openDatabase(getDbPath(), { create: true })
  try {
    return db
      .query("SELECT * FROM mesa_memory WHERE id = ?")
      .get(id) as Record<string, unknown> | null
  } finally {
    db.close()
  }
}

function countActiveMemories(): number {
  const db = openDatabase(getDbPath(), { create: true })
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

// ---------------------------------------------------------------------------
// memory_store
// ---------------------------------------------------------------------------

describe("memory_store tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("stores a valid memory entry and returns ID and preview", async () => {
    const result = await memoryStoreTool.execute(
      {
        content:
          "This project uses bun runtime with ESM — never use require() for importing modules in this codebase",
        category: "convention",
      } as any,
      makeContext()
    )

    expect(result).toHaveProperty("title", "Memory Stored")
    expect((result as { output: string }).output).toContain("Stored memory entry")
    expect((result as { output: string }).output).toContain("Preview:")
    expect((result as { output: string }).output).toContain("bun runtime with ESM")

    const metadata = getMeta<{ id: number; category: string; scope: string }>(result)
    expect(metadata.id).toBeGreaterThan(0)
    expect(metadata.category).toBe("convention")
    expect(metadata.scope).toBe("project")
  })

  test("stores with all fields specified and persists correctly in DB", async () => {
    const content =
      "Global architecture insight: WAL mode is required for safe concurrent read access in SQLite databases"
    const result = await memoryStoreTool.execute(
      { content, category: "architecture", scope: "global" },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Memory Stored")
    const { id, scope } = getMeta<{ id: number; scope: string }>(result)
    expect(scope).toBe("global")

    const row = queryMemoryById(id)
    expect(row).not.toBeNull()
    expect(row!.content).toBe(content)
    expect(row!.scope).toBe("global")
    expect(row!.category).toBe("architecture")
    expect(row!.status).toBe("active")
    expect(row!.content_hash).toBeTruthy()
    expect(row!.source_agent).toBe("test-session")
    expect(row!.access_count).toBe(0)
    expect(row!.relevance_score).toBe(1.0)
    expect(row!.expires_at).toBeNull()
  })

  test("defaults scope to project when not specified", async () => {
    const result = await memoryStoreTool.execute(
      {
        content:
          "Scope defaults to project when not explicitly provided in the memory store call args",
        category: "observation",
      } as any,
      makeContext()
    )

    const metadata = getMeta<{ scope: string; id: number }>(result)
    expect(metadata.scope).toBe("project")

    const row = queryMemoryById(metadata.id)
    expect(row!.scope).toBe("project")
    expect(row!.expires_at).toBeTruthy()
  })

  test("content below 20 chars fails schema validation", () => {
    const schema = z.object(memoryStoreTool.args)
    const result = schema.safeParse({ content: "way too short", category: "lesson" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("content")
    }
  })

  test("content above 500 chars fails schema validation", () => {
    const schema = z.object(memoryStoreTool.args)
    const result = schema.safeParse({ content: "x".repeat(501), category: "lesson" })
    expect(result.success).toBe(false)
    if (!result.success) {
      expect(result.error.issues[0].path).toContain("content")
    }
  })

  test("invalid category fails schema validation", () => {
    const schema = z.object(memoryStoreTool.args)
    const result = schema.safeParse({
      content: "Valid content that is at least twenty characters",
      category: "invalid_category",
    })
    expect(result.success).toBe(false)
  })

  test("schema accepts content at exactly 20 characters", () => {
    const schema = z.object(memoryStoreTool.args)
    const result = schema.safeParse({ content: "a".repeat(20), category: "lesson" })
    expect(result.success).toBe(true)
  })

  test("schema accepts content at exactly 500 characters", () => {
    const schema = z.object(memoryStoreTool.args)
    const result = schema.safeParse({ content: "a".repeat(500), category: "lesson" })
    expect(result.success).toBe(true)
  })

  test("dedup: storing identical content twice returns existing ID", async () => {
    const content =
      "Dedup test: this exact content must not be duplicated on the second store call execution"
    const first = await memoryStoreTool.execute(
      { content, category: "lesson" } as any,
      makeContext()
    )
    expect(first).toHaveProperty("title", "Memory Stored")
    const firstId = getMeta<{ id: number }>(first).id

    const second = await memoryStoreTool.execute(
      { content, category: "lesson" } as any,
      makeContext()
    )
    expect(second).toHaveProperty("title", "Memory Exists (Idempotent)")
    expect(getMeta<{ deduplicated: boolean; id: number }>(second).deduplicated).toBe(true)
    expect(getMeta<{ id: number }>(second).id).toBe(firstId)
  })

  test("dedup: different scope creates separate entries", async () => {
    const content =
      "Same content but different scope should create separate dedup entries in the DB"
    const first = await memoryStoreTool.execute(
      { content, category: "convention" } as any,
      makeContext()
    )
    const second = await memoryStoreTool.execute(
      { content, category: "convention", scope: "global" },
      makeContext()
    )

    expect(first).toHaveProperty("title", "Memory Stored")
    expect(second).toHaveProperty("title", "Memory Stored")
    expect(getMeta<{ id: number }>(second).id).not.toBe(
      getMeta<{ id: number }>(first).id
    )
  })

  test("dedup: different category creates separate entries", async () => {
    const content =
      "Same content different category should bypass dedup and create new memory entry"
    const first = await memoryStoreTool.execute(
      { content, category: "lesson" } as any,
      makeContext()
    )
    const second = await memoryStoreTool.execute(
      { content, category: "pitfall" } as any,
      makeContext()
    )

    expect(getMeta<{ id: number }>(second).id).not.toBe(
      getMeta<{ id: number }>(first).id
    )
  })

  test("dedup is case-insensitive via trimmed lowercased content hash", async () => {
    const first = await memoryStoreTool.execute(
      { content: "Case insensitive dedup test content for memory store validation", category: "observation" } as any,
      makeContext()
    )
    const second = await memoryStoreTool.execute(
      { content: "  CASE INSENSITIVE DEDUP TEST CONTENT FOR MEMORY STORE VALIDATION  ", category: "observation" } as any,
      makeContext()
    )

    expect(second).toHaveProperty("title", "Memory Exists (Idempotent)")
    expect(getMeta<{ id: number }>(second).id).toBe(
      getMeta<{ id: number }>(first).id
    )
  })
})

// ---------------------------------------------------------------------------
// memory_recall
// ---------------------------------------------------------------------------

describe("memory_recall tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("returns all active memories when no filters provided", async () => {
    await memoryStoreTool.execute(
      { content: "First memory entry for recall test with no filters applied at all here", category: "lesson" } as any,
      makeContext()
    )
    await memoryStoreTool.execute(
      { content: "Second memory entry for recall test with no filters applied at all either", category: "pitfall" } as any,
      makeContext()
    )

    const result = await memoryRecallTool.execute({} as any, makeContext())

    expect(result).toHaveProperty("title", "Memories Recalled")
    expect(getMeta<{ count: number }>(result).count).toBe(2)
    expect((result as { output: string }).output).toContain("2 memories")
  })

  test("filters by category and returns only matching entries", async () => {
    await memoryStoreTool.execute(
      { content: "Architecture memory about database schema design and indexing strategy", category: "architecture" } as any,
      makeContext()
    )
    await memoryStoreTool.execute(
      { content: "Pitfall memory about a common mistake developers make with async code", category: "pitfall" } as any,
      makeContext()
    )

    const result = await memoryRecallTool.execute(
      { category: "architecture" } as any,
      makeContext()
    )

    expect(result).toHaveProperty("title", "Memories Recalled")
    expect(getMeta<{ count: number }>(result).count).toBe(1)
    expect(getMeta<{ categories: string[] }>(result).categories).toEqual(["architecture"])
  })

  test("filters by query substring with case-insensitive matching", async () => {
    await memoryStoreTool.execute(
      { content: "This memory mentions bun runtime specifically as the project runtime choice", category: "convention" } as any,
      makeContext()
    )
    await memoryStoreTool.execute(
      { content: "This memory talks about database migrations and schema evolution patterns", category: "architecture" } as any,
      makeContext()
    )

    const result = await memoryRecallTool.execute({ query: "BUN RUNTIME" } as any, makeContext())

    expect(result).toHaveProperty("title", "Memories Recalled")
    expect(getMeta<{ count: number }>(result).count).toBe(1)
    expect((result as { output: string }).output).toContain("bun runtime")
  })

  test("respects limit parameter", async () => {
    for (let i = 0; i < 5; i++) {
      await memoryStoreTool.execute(
        {
          content: `Memory entry number ${i + 1} for limit test — unique content padding here`,
          category: "observation",
        } as any,
        makeContext()
      )
    }

    const result = await memoryRecallTool.execute({ limit: 2 } as any, makeContext())
    expect(getMeta<{ count: number }>(result).count).toBe(2)
  })

  test("increments access_count on returned entries across successive recalls", async () => {
    await memoryStoreTool.execute(
      { content: "Access count memory that should increment on each successive recall call", category: "observation" } as any,
      makeContext()
    )

    // First recall: access_count is 0 (displayed before increment)
    const first = await memoryRecallTool.execute({} as any, makeContext())
    expect((first as { output: string }).output).toContain("accessed: 0x")

    // Second recall: access_count should now be 1
    const second = await memoryRecallTool.execute({} as any, makeContext())
    expect((second as { output: string }).output).toContain("accessed: 1x")
  })

  test("excludes deleted entries from recall results", async () => {
    const storeResult = await memoryStoreTool.execute(
      { content: "This memory will be forgotten and excluded from all subsequent recall queries", category: "lesson" } as any,
      makeContext()
    )
    const id = getMeta<{ id: number }>(storeResult).id

    await memoryForgetTool.execute({ id }, makeContext())

    const result = await memoryRecallTool.execute({} as any, makeContext())
    expect(result).toHaveProperty("title", "No Memories Found")
  })

  test("returns empty result gracefully when no memories exist", async () => {
    const result = await memoryRecallTool.execute({} as any, makeContext())
    expect(result).toHaveProperty("title", "No Memories Found")
    expect((result as { output: string }).output).toContain(
      "No matching memories found"
    )
  })

  test("combines category and query filters for precise matching", async () => {
    await memoryStoreTool.execute(
      { content: "Convention: always use bun for this project runtime execution tasks", category: "convention" } as any,
      makeContext()
    )
    await memoryStoreTool.execute(
      { content: "Architecture: bun runtime with ESM modules for fast cold start times", category: "architecture" } as any,
      makeContext()
    )

    const result = await memoryRecallTool.execute(
      { category: "convention", query: "bun" } as any,
      makeContext()
    )
    expect(getMeta<{ count: number }>(result).count).toBe(1)
  })
})

// ---------------------------------------------------------------------------
// memory_forget
// ---------------------------------------------------------------------------

describe("memory_forget tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
    await loadState(TEST_DIR, "test-session")
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("soft-deletes an existing entry by setting status to deleted", async () => {
    const storeResult = await memoryStoreTool.execute(
      { content: "Memory to be forgotten in the soft delete test for the memory forget tool", category: "observation" } as any,
      makeContext()
    )
    const id = getMeta<{ id: number }>(storeResult).id

    expect(queryMemoryById(id)!.status).toBe("active")

    const result = await memoryForgetTool.execute({ id }, makeContext())

    expect(result).toHaveProperty("title", "Memory Deleted")
    expect((result as { output: string }).output).toContain("soft-deleted")
    expect((result as { output: string }).output).toContain("7 days")
    expect(getMeta<{ id: number }>(result).id).toBe(id)

    expect(queryMemoryById(id)!.status).toBe("deleted")
  })

  test("returns error for non-existent ID", async () => {
    const result = await memoryForgetTool.execute({ id: 99999 }, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("Error")
    expect(result).toContain("not found")
  })

  test("returns error for already-deleted entry", async () => {
    const storeResult = await memoryStoreTool.execute(
      { content: "Memory that will be double-forgotten to verify error returned on second call", category: "pitfall" } as any,
      makeContext()
    )
    const id = getMeta<{ id: number }>(storeResult).id

    await memoryForgetTool.execute({ id }, makeContext())

    const result = await memoryForgetTool.execute({ id }, makeContext())
    expect(typeof result).toBe("string")
    expect(result).toContain("Error")
    expect(result).toContain("not found")
  })

  test("double-forget returns error but does not crash — idempotent-safe", async () => {
    const storeResult = await memoryStoreTool.execute(
      { content: "Idempotent safety: forgetting twice should not crash or corrupt DB state", category: "lesson" } as any,
      makeContext()
    )
    const id = getMeta<{ id: number }>(storeResult).id

    // First forget succeeds
    const first = await memoryForgetTool.execute({ id }, makeContext())
    expect(first).toHaveProperty("title", "Memory Deleted")

    // Second forget returns error but does not throw
    const second = await memoryForgetTool.execute({ id }, makeContext())
    expect(typeof second).toBe("string")

    // DB state is still deleted, not corrupted
    expect(queryMemoryById(id)!.status).toBe("deleted")
    expect(countActiveMemories()).toBe(0)
  })

  test("forgotten entry is excluded from subsequent recall results", async () => {
    const storeResult = await memoryStoreTool.execute(
      { content: "Memory that disappears from recall after being forgotten by the forget tool", category: "convention" } as any,
      makeContext()
    )
    const id = getMeta<{ id: number }>(storeResult).id

    // Present before forget
    const before = await memoryRecallTool.execute({} as any, makeContext())
    expect(getMeta<{ count: number }>(before).count).toBe(1)

    // Forget it
    await memoryForgetTool.execute({ id }, makeContext())

    // Gone after forget
    const after = await memoryRecallTool.execute({} as any, makeContext())
    expect(after).toHaveProperty("title", "No Memories Found")
  })
})
