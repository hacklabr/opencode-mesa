import { describe, expect, test, beforeEach, afterEach } from "vitest"
import { promises as fs } from "node:fs"
import { join } from "node:path"
import { loadState, saveState, closeStorage } from "../state"
import { createInitialState } from "../config"
import {
  generateSpecificationTool,
  generateSpecificationOverviewTool,
  approveSpecificationTool,
} from "../tools/discussion-tools"

const TEST_DIR = join(import.meta.dirname, "__test_fixtures__", "specification-overview")

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

describe("generate_specification_overview tool", () => {
  beforeEach(async () => {
    await fs.mkdir(join(TEST_DIR, ".mesa"), { recursive: true })
  })

  afterEach(async () => {
    closeStorage(TEST_DIR)
    await fs.rm(join(TEST_DIR, ".mesa"), { recursive: true, force: true })
  })

  test("generates overview for an existing draft specification", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.discussion.votes = [
      { agentId: "a", agentName: "Alice", vote: 1, reason: "Agree", round: 1 },
    ]
    state.team = [
      { personaId: "a", name: "Alice", division: "eng", status: "summoned" },
    ]
    await saveState(TEST_DIR, state, "test-session")

    const specResult = await generateSpecificationTool.execute(
      {
        content: "## Executive Summary\n\nBuild a microservices-based system.\n\n## Technical Decisions\n\nUse microservices architecture for scalability.",
        topic: "System Design",
      },
      makeContext()
    )

    expect(specResult).toHaveProperty("title", "Specification Generated")
    const specMetadata = (specResult as { metadata?: { path: string } }).metadata
    expect(specMetadata?.path).toBeTruthy()

    const overviewContent = [
      "## Why it matters",
      "",
      "We need a simpler approval flow that humans can read in minutes.",
      "",
      "```mermaid",
      "graph LR",
      "  A[Human] --> B[Overview]",
      "  B --> C{Approve?}",
      "```",
      "",
      "## Key decisions",
      "",
      "- Microservices architecture for independent scaling.",
      "- Separate overview document for human approval.",
    ].join("\n")

    const result = await generateSpecificationOverviewTool.execute(
      {
        content: overviewContent,
        topic: "System Design",
      },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Specification Overview Generated")
    const metadata = (result as { metadata?: { overviewPath: string; specPath: string } }).metadata
    expect(metadata?.overviewPath).toBeTruthy()
    expect(metadata?.specPath).toBe(specMetadata?.path)

    const overviewFile = await fs.readFile(metadata!.overviewPath, "utf-8")
    expect(overviewFile).toContain("Overview: System Design")
    expect(overviewFile).toContain(specMetadata!.path)
    expect(overviewFile).toContain("```mermaid")

    const loaded = await loadState(TEST_DIR, "test-session")
    expect(loaded.specification.overviewPath).toBe(metadata!.overviewPath)
  })

  test("rejects overview when no draft specification exists", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "SPECIFICATION"
    state.specification = { path: null, overviewPath: null, status: "pending" }
    await saveState(TEST_DIR, state, "test-session")

    const result = await generateSpecificationOverviewTool.execute(
      { content: "Overview content", topic: "Test" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("No draft specification found")
  })

  test("rejects overview exceeding maximum length", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.discussion.votes = [
      { agentId: "a", agentName: "Alice", vote: 1, reason: "Agree", round: 1 },
    ]
    state.team = [
      { personaId: "a", name: "Alice", division: "eng", status: "summoned" },
    ]
    await saveState(TEST_DIR, state, "test-session")

    await generateSpecificationTool.execute(
      { content: "## Spec\n\nTest", topic: "Big Overview" },
      makeContext()
    )

    const result = await generateSpecificationOverviewTool.execute(
      { content: "x".repeat(10001), topic: "Too Long" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("exceeds maximum length")
  })

  test("approve_specification notes the overview path", async () => {
    const state = createInitialState(TEST_DIR)
    state.currentPhase = "DISCUSSION"
    state.discussion.votes = [
      { agentId: "a", agentName: "Alice", vote: 1, reason: "Agree", round: 1 },
    ]
    state.team = [
      { personaId: "a", name: "Alice", division: "eng", status: "summoned" },
    ]
    await saveState(TEST_DIR, state, "test-session")

    await generateSpecificationTool.execute(
      { content: "## Spec\n\nTest", topic: "Approval Flow" },
      makeContext()
    )

    await generateSpecificationOverviewTool.execute(
      { content: "## Overview\n\nReadable summary.", topic: "Approval Flow" },
      makeContext()
    )

    const result = await approveSpecificationTool.execute(
      { approved: true },
      makeContext()
    )

    expect(result).toHaveProperty("title", "Specification Approved")
    const output = (result as { output: string }).output
    expect(output).toContain("Human overview:")
  })
})
