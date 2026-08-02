import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state.js"
import { createInitialState } from "../config.js"
import {
  createBriefingTool,
  approveBriefingTool,
  importBriefingTool,
} from "../tools/briefing-tools.js"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "briefing-tools")

function makeContext() {
  return {
    sessionID: "test-session",
    messageID: "test-msg",
    agent: "test",
    directory: TEST_DIR,
    worktree: TEST_DIR,
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

describe("create_briefing tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("creates briefing with valid slug, title, and content", async () => {
    const result = await createBriefingTool.execute(
      { slug: "my-project", title: "My Project", content: "# Briefing\n\nContent here." },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Briefing Created")
    const output = (result as { output: string }).output
    expect(output).toContain("briefing.md")

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.slug).toBe("my-project")
    expect(state.briefing.status).toBe("draft")

    // Paths stored in state are workspace-relative (spec-6886df4f, TD3).
    // Prepend TEST_DIR for filesystem I/O.
    const file = await fs.readFile(
      join(TEST_DIR, state.briefing.path!),
      "utf-8"
    )
    expect(file).toContain("status: draft")
    expect(file).toContain("# Briefing")
  })

  test("rejects invalid slug with special characters", async () => {
    const result = await createBriefingTool.execute(
      { slug: "My Project!", title: "Test", content: "Content" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Invalid slug")
  })

  test("rejects empty slug", async () => {
    const result = await createBriefingTool.execute(
      { slug: "", title: "Test", content: "Content" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Invalid slug")
  })

  test("rejects slug with uppercase", async () => {
    const result = await createBriefingTool.execute(
      { slug: "MyProject", title: "Test", content: "Content" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Invalid slug")
  })

  test("rejects empty content", async () => {
    const result = await createBriefingTool.execute(
      { slug: "test-slug", title: "Test", content: "   " },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("content cannot be empty")
  })

  test("creates briefing file with frontmatter", async () => {
    await createBriefingTool.execute(
      { slug: "test-brief", title: "Test Brief", content: "## Section\n\nDetails." },
      makeContext()
    )

    const state = await loadState(TEST_DIR, "test-session")
    const content = await fs.readFile(
      join(TEST_DIR, state.briefing.path!),
      "utf-8"
    )
    expect(content).toMatch(/^---\n/)
    expect(content).toContain('title: "Test Brief"')
    expect(content).toContain('slug: "test-brief"')
    expect(content).toContain("## Section")
  })
})

describe("approve_briefing tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  async function setupDraftBriefing() {
    await createBriefingTool.execute(
      { slug: "test-approve", title: "Test", content: "# Test" },
      makeContext()
    )
  }

  test("successfully approves a draft briefing", async () => {
    await setupDraftBriefing()

    const result = await approveBriefingTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Briefing Approved")
    const output = (result as { output: string }).output
    expect(output).toContain("test-approve")

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.status).toBe("approved")

    const file = await fs.readFile(
      join(TEST_DIR, state.briefing.path!),
      "utf-8"
    )
    expect(file).toContain("status: approved")
    expect(file).not.toContain("status: draft")
  })

  test("returns error when no briefing exists", async () => {
    const result = await approveBriefingTool.execute({}, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("No briefing found")
  })

  test("returns error when briefing already approved", async () => {
    await setupDraftBriefing()
    await approveBriefingTool.execute({}, makeContext())

    const result = await approveBriefingTool.execute({}, makeContext())

    expect(typeof result).toBe("string")
    expect(result).toContain("status: draft")
  })
})

describe("import_briefing tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
    await fs.rm(join(TEST_DIR, "imports"), { recursive: true, force: true }).catch(() => {})
  })

  test("imports valid briefing file", async () => {
    const importsDir = join(TEST_DIR, "imports")
    await fs.mkdir(importsDir, { recursive: true })
    const srcPath = join(importsDir, "external.md")
    await fs.writeFile(srcPath, "# Imported Briefing\n\nSome content.", "utf-8")

    const result = await importBriefingTool.execute(
      { file_path: srcPath, slug: "imported" },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Briefing Imported")
    const output = (result as { output: string }).output
    expect(output).toContain("imported")
    expect(output).toContain("approved (pre-approved)")
    expect(output).toContain("PLANNING")

    const state = await loadState(TEST_DIR, "test-session")
    expect(state.briefing.status).toBe("approved")
    expect(state.briefing.slug).toBe("imported")
    expect(state.currentPhase).toBe("PLANNING")
    expect(state.team).toEqual([])
    expect(state.discussion.analyses).toEqual([])
  })

  test("returns error for file not found", async () => {
    const result = await importBriefingTool.execute(
      { file_path: "/nonexistent/path.md", slug: "missing" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("File not found")
  })

  test("returns error for empty file", async () => {
    const importsDir = join(TEST_DIR, "imports")
    await fs.mkdir(importsDir, { recursive: true })
    const emptyPath = join(importsDir, "empty.md")
    await fs.writeFile(emptyPath, "   \n  \n  ", "utf-8")

    const result = await importBriefingTool.execute(
      { file_path: emptyPath, slug: "empty" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("empty")
  })

  test("returns error for invalid slug", async () => {
    const importsDir = join(TEST_DIR, "imports")
    await fs.mkdir(importsDir, { recursive: true })
    const srcPath = join(importsDir, "file.md")
    await fs.writeFile(srcPath, "Content", "utf-8")

    const result = await importBriefingTool.execute(
      { file_path: srcPath, slug: "Invalid Slug!" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Invalid slug")
  })

  test("returns error when slug already exists", async () => {
    const importsDir = join(TEST_DIR, "imports")
    await fs.mkdir(importsDir, { recursive: true })
    const srcPath = join(importsDir, "dup.md")
    await fs.writeFile(srcPath, "Content", "utf-8")

    await importBriefingTool.execute(
      { file_path: srcPath, slug: "dup-test" },
      makeContext()
    )

    const result = await importBriefingTool.execute(
      { file_path: srcPath, slug: "dup-test" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("already exists")
  })

  test("resets discussion and workflow state on import", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.discussion.analyses = [
      { agentId: "a", agentName: "A", content: "c", turn: 1, timestamp: new Date().toISOString() },
    ]
    state.rounds = [
      { id: "r1", topic: "old", participants: ["a"], status: "closed", openedAt: new Date().toISOString() },
    ]
    state.plan = { path: ".mesa/x/workflow-plan.md", version: 1, status: "approved" }
    await saveState(TEST_DIR, state, "test-session")

    const importsDir = join(TEST_DIR, "imports")
    await fs.mkdir(importsDir, { recursive: true })
    const srcPath = join(importsDir, "reset.md")
    await fs.writeFile(srcPath, "New briefing", "utf-8")

    await importBriefingTool.execute(
      { file_path: srcPath, slug: "reset-test" },
      makeContext()
    )

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.currentPhase).toBe("PLANNING")
    expect(loaded.discussion.analyses).toEqual([])
    expect(loaded.rounds).toEqual([])
    expect(loaded.deliverables).toEqual([])
    expect(loaded.plan).toBeNull()
  })
})
