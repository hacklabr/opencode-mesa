import { describe, it, expect, vi, beforeEach } from "vitest"
import type { UpdateCheckResult, UpdateResult } from "../updater/types"

// Mock dependencies before importing the module under test
const mockCheckForUpdate = vi.fn<() => Promise<UpdateCheckResult>>()
const mockRunUpdate = vi.fn<(tag: string) => Promise<UpdateResult>>()

vi.mock("../updater/checker", () => ({
  checkForUpdate: () => mockCheckForUpdate(),
}))

vi.mock("../updater/runner", () => ({
  runUpdate: (tag: string) => mockRunUpdate(tag),
}))

// Mock the tool helper — return a plain object for testing
vi.mock("@opencode-ai/plugin/tool", () => ({
  tool: (def: Record<string, unknown>) => def,
}))

import { mesaCheckUpdateTool, mesaUpdateTool } from "../tools/update-tools"

// Type the execute function for our tests
type ExecuteFn = (args: Record<string, never>, context: unknown) => Promise<unknown>
const checkExecute = mesaCheckUpdateTool.execute as unknown as ExecuteFn
const updateExecute = mesaUpdateTool.execute as unknown as ExecuteFn

// Minimal mock context
const mockCtx = {} as unknown

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

    it("reports already up to date", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.2.0",
        latestVersion: "1.2.0",
        hasUpdate: false,
        checkedAt: new Date().toISOString(),
        cacheHit: true,
      })

      const result = await checkExecute({}, mockCtx)

      expect(result).toHaveProperty("title", "Mesa Update Check")
      const output = (result as { output: string }).output
      expect(output).toContain("latest version")
      expect(output).toContain("1.2.0")
      expect(output).toContain("(cached)")
    })

    it("handles errors gracefully", async () => {
      mockCheckForUpdate.mockRejectedValue(new Error("Something broke"))

      const result = await checkExecute({}, mockCtx)

      expect(result).toBeTypeOf("string")
      expect(result as string).toContain("Failed to check for updates")
      expect(result as string).toContain("Something broke")
    })

    it("handles non-Error throws", async () => {
      mockCheckForUpdate.mockRejectedValue("string error")

      const result = await checkExecute({}, mockCtx)

      expect(result).toBeTypeOf("string")
      expect(result as string).toContain("Failed to check for updates")
    })

    it("includes metadata in success response", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.0.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
        checkedAt: "2025-06-01T00:00:00.000Z",
        cacheHit: false,
      })

      const result = await checkExecute({}, mockCtx) as { metadata?: Record<string, unknown> }

      expect(result.metadata).toBeDefined()
      expect(result.metadata).toHaveProperty("hasUpdate", true)
      expect(result.metadata).toHaveProperty("currentVersion", "1.0.0")
      expect(result.metadata).toHaveProperty("latestVersion", "2.0.0")
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
        previousVersion: "abc1234",
        newVersion: "2.0.0",
        message: "Successfully updated to v2.0.0.",
      })

      const result = await updateExecute({}, mockCtx)

      expect(result).toHaveProperty("title", "Mesa Update")
      expect(mockRunUpdate).toHaveBeenCalledWith("2.0.0")
      const output = (result as { output: string }).output
      expect(output).toContain("Successfully updated")
    })

    it("reports already on latest version", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.2.0",
        latestVersion: "1.2.0",
        hasUpdate: false,
        checkedAt: new Date().toISOString(),
        cacheHit: true,
      })

      const result = await updateExecute({}, mockCtx)

      expect(result).toHaveProperty("title", "Mesa Update")
      const output = (result as { output: string }).output
      expect(output).toContain("Already on the latest version")
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
        previousVersion: "abc1234",
        newVersion: "2.0.0",
        message: "Update to v2.0.0 failed (exit 1).",
      })

      const result = await updateExecute({}, mockCtx)

      expect(result).toBeTypeOf("string")
      expect(result as string).toContain("failed")
    })

    it("handles thrown errors", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.2.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
        checkedAt: new Date().toISOString(),
        cacheHit: false,
      })

      mockRunUpdate.mockRejectedValue(new Error("Install exploded"))

      const result = await updateExecute({}, mockCtx)

      expect(result).toBeTypeOf("string")
      expect(result as string).toContain("Update failed")
      expect(result as string).toContain("Install exploded")
    })

    it("handles non-Error throws from runUpdate", async () => {
      mockCheckForUpdate.mockResolvedValue({
        currentVersion: "1.2.0",
        latestVersion: "2.0.0",
        hasUpdate: true,
        checkedAt: new Date().toISOString(),
        cacheHit: false,
      })

      mockRunUpdate.mockRejectedValue("unknown failure")

      const result = await updateExecute({}, mockCtx)

      expect(result).toBeTypeOf("string")
      expect(result as string).toContain("Update failed")
    })

    it("handles checkForUpdate throwing in update tool", async () => {
      mockCheckForUpdate.mockRejectedValue(new Error("Check failed"))

      const result = await updateExecute({}, mockCtx)

      expect(result).toBeTypeOf("string")
      expect(result as string).toContain("Update failed")
    })
  })
})
