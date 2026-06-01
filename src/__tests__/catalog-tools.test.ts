import { describe, expect, test } from "vitest"
import { listSpecialistsTool, getSpecialistTool } from "../tools/catalog-tools"

function makeContext() {
  return {
    sessionID: "test-session",
    messageID: "test-msg",
    agent: "test",
    directory: "/tmp/catalog-tools-test",
    worktree: "/tmp/catalog-tools-test",
    abort: new AbortController().signal,
    metadata: () => {},
    ask: async () => {},
  }
}

describe("list_specialists tool", () => {
  test("returns formatted output with all specialists", async () => {
    const result = await listSpecialistsTool.execute({}, makeContext())

    expect(result).toHaveProperty("title", "Available Specialists")
    const output = (result as { output: string }).output
    expect(output).toContain("specialists")
    expect(output).toContain("|")
    expect(output).toContain("Name")

    const metadata = (result as { metadata: Record<string, unknown> }).metadata
    expect(metadata.total).toBeGreaterThan(0)
    expect(metadata.page).toBe(1)
  })

  test("filters by division", async () => {
    const result = await listSpecialistsTool.execute(
      { division: "engineering" },
      makeContext()
    )

    const output = (result as { output: string }).output
    expect(output).toContain("engineering")
    const metadata = (result as { metadata: Record<string, unknown> }).metadata
    expect(metadata.divisionFilter).toBe("engineering")
  })

  test("filters by search term", async () => {
    const result = await listSpecialistsTool.execute(
      { search: "backend" },
      makeContext()
    )

    const output = (result as { output: string }).output
    expect(output).toContain("backend")

    const metadata = (result as { metadata: Record<string, unknown> }).metadata
    expect(metadata.total).toBeGreaterThan(0)
  })

  test("returns empty for non-matching search", async () => {
    const result = await listSpecialistsTool.execute(
      { search: "zzz-nonexistent-term-xyz" },
      makeContext()
    )

    const metadata = (result as { metadata: Record<string, unknown> }).metadata
    expect(metadata.total).toBe(0)
  })

  test("respects pagination parameters", async () => {
    const result = await listSpecialistsTool.execute(
      { page: 1, page_size: 5 },
      makeContext()
    )

    const metadata = (result as { metadata: Record<string, unknown> }).metadata
    expect(metadata.pageSize).toBe(5)
    expect(metadata.page).toBe(1)
  })
})

describe("get_specialist tool", () => {
  test("returns full specialist details for valid ID", async () => {
    const result = await getSpecialistTool.execute(
      { id: "engineering-backend-architect" },
      makeContext()
    )

    expect(result).toHaveProperty("title")
    expect((result as { title: string }).title).toContain("Backend Architect")
    const output = (result as { output: string }).output
    const parsed = JSON.parse(output.split("\n\n").slice(1).join("\n"))
    expect(parsed.id).toBe("engineering-backend-architect")
    expect(parsed.name).toBeTruthy()
    expect(parsed.division).toBe("engineering")
    expect(parsed.systemPrompt).toBeTruthy()
    expect(parsed.systemPrompt.length).toBeGreaterThan(10)
  })

  test("returns error for invalid ID", async () => {
    const result = await getSpecialistTool.execute(
      { id: "nonexistent-specialist-xyz" },
      makeContext()
    )

    expect(typeof result).toBe("string")
    expect(result).toContain("Specialist not found")
  })
})
