import { describe, it, expect, vi, beforeEach } from "vitest"
import type { UpdateCheckResult, UpdateResult } from "../updater/types.js"
import { mesaCheckUpdateTool, mesaUpdateTool } from "../tools/update-tools.js"

// Mock dependencies before importing the module under test
const mockCheckForUpdate = vi.fn<() => Promise<UpdateCheckResult>>()
const mockRunUpdate = vi.fn<(tag: string) => Promise<UpdateResult>>()

vi.mock("../updater/checker", () => ({
  checkForUpdate: () => mockCheckForUpdate(),
}))

vi.mock("../updater/runner", () => ({
  runUpdate: (tag: string) => mockRunUpdate(tag),
}))

// Note: we intentionally do NOT mock @opencode-ai/plugin/tool.
// Mocking it with vi.mock leaks to other test files in this Vitest version,
// breaking memory-tools tests that rely on tool.schema at module load time.
// The tests below work with the real tool() wrapper.

// Type the execute function for our tests
type ExecuteFn = (args: Record<string, never>, context: unknown) => Promise<unknown>
const checkExecute = mesaCheckUpdateTool.execute as unknown as ExecuteFn
const updateExecute = mesaUpdateTool.execute as unknown as ExecuteFn

// Minimal mock context
const mockCtx = {} as unknown

function isErrorString(result: unknown): result is string {
  return typeof result === "string" && result.startsWith("Error:")
}

describe("tools/update-tools", () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe("mesaCheckUpdateTool", () => {
    it("reports update available", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.2.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
        checkedAt: new Date().toISOString(),
        cacheHit: false,
      })

      const result = await checkExecute({}, mockCtx)

      expect(result).toHaveProperty("title", "Mesa Update Check")
      expect(result).toHaveProperty("output")
      const output = (result as { output: string }).output
      expect(output).toContain("Update available")
      expect(output).toContain("1.2.0")
      expect(output).toContain("2.0.0")
    })

    it("reports already on latest version", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.2.0",
        latestVersion: "1.2.0",
        hasUpdate: false,
        checkedAt: new Date().toISOString(),
        cacheHit: false,
      })

      const result = await checkExecute({}, mockCtx)

      expect(result).toHaveProperty("title", "Mesa Update Check")
      const output = (result as { output: string }).output
      expect(output).toContain("latest version")
      expect(output).toContain("1.2.0")
    })

    it("handles errors gracefully", async () => {
      mockCheckForUpdate.mockRejectedValue(new Error("network failure"))

      const result = await checkExecute({}, mockCtx)

      expect(isErrorString(result)).toBe(true)
      expect(result).toContain("network failure")
    })

    it("handles non-Error throws", async () => {
      mockCheckForUpdate.mockRejectedValue("weird error")

      const result = await checkExecute({}, mockCtx)

      expect(isErrorString(result)).toBe(true)
    })

    it("includes metadata in success response", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.2.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
        checkedAt: "2024-01-01T00:00:00Z",
        cacheHit: true,
      })

      const result = await checkExecute({}, mockCtx)

      expect(result).toHaveProperty("metadata")
      const metadata = (result as { metadata: Record<string, unknown> }).metadata
      expect(metadata).toMatchObject({
        currentVersion: "1.2.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
        cacheHit: true,
      })
    })
  })

  describe("mesaUpdateTool", () => {
    it("runs update successfully when update available", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.2.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
        checkedAt: new Date().toISOString(),
        cacheHit: false,
      })
      mockRunUpdate.mockResolvedValue({
        success: true,
        previousVersion: "1.2.0",
        newVersion: "2.0.0",
        message: "Updated to 2.0.0",
      })

      const result = await updateExecute({ tag: "" } as never, mockCtx)

      expect(result).toHaveProperty("title", "Mesa Update")
      const output = (result as { output: string }).output
      expect(output).toContain("Updated to 2.0.0")
      expect(mockRunUpdate).toHaveBeenCalledWith("2.0.0")
    })

    it("reports already on latest version", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.2.0",
        latestVersion: "1.2.0",
        hasUpdate: false,
        checkedAt: new Date().toISOString(),
        cacheHit: false,
      })

      const result = await updateExecute({ tag: "" } as never, mockCtx)

      expect(result).toHaveProperty("title", "Mesa Update")
      const output = (result as { output: string }).output
      expect(output).toContain("latest version")
      expect(mockRunUpdate).not.toHaveBeenCalled()
    })

    it("handles update failure", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.2.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
        checkedAt: new Date().toISOString(),
        cacheHit: false,
      })
      mockRunUpdate.mockResolvedValue({
        success: false,
        previousVersion: "1.2.0",
        newVersion: "1.2.0",
        message: "Update failed",
      })

      const result = await updateExecute({ tag: "" } as never, mockCtx)

      expect(isErrorString(result)).toBe(true)
      expect(result).toContain("Update failed")
    })

    it("handles thrown errors", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.2.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
        checkedAt: new Date().toISOString(),
        cacheHit: false,
      })
      mockRunUpdate.mockRejectedValue(new Error("disk full"))

      const result = await updateExecute({ tag: "" } as never, mockCtx)

      expect(isErrorString(result)).toBe(true)
      expect(result).toContain("disk full")
    })

    it("handles non-Error throws from runUpdate", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.2.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
        checkedAt: new Date().toISOString(),
        cacheHit: false,
      })
      mockRunUpdate.mockRejectedValue(123)

      const result = await updateExecute({ tag: "" } as never, mockCtx)

      expect(isErrorString(result)).toBe(true)
    })

    it("handles checkForUpdate throwing in update tool", async () => {
      mockCheckForUpdate.mockRejectedValue(new Error("check failed"))

      const result = await updateExecute({ tag: "" } as never, mockCtx)

      expect(isErrorString(result)).toBe(true)
      expect(result).toContain("check failed")
    })
  })
})
