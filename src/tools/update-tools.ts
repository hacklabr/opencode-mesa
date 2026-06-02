import { tool } from "@opencode-ai/plugin/tool"
import { successResponse, errorResponse } from "../utils/responses"
import { checkForUpdate } from "../updater/checker"
import { runUpdate } from "../updater/runner"

export const mesaCheckUpdateTool = tool({
  description: "Check if a newer version of the Mesa plugin is available.",
  args: {},
  async execute() {
    try {
      const result = await checkForUpdate()

      const status = result.hasUpdate
        ? `Update available: v${result.currentVersion} → v${result.latestVersion}`
        : `You are on the latest version: v${result.currentVersion}`

      const output = [
        `Current version: v${result.currentVersion}`,
        `Latest version: v${result.latestVersion}`,
        status,
        `Checked at: ${new Date(result.checkedAt).toLocaleString()}${result.cacheHit ? " (cached)" : ""}`,
      ].join("\n")

      return successResponse("Mesa Update Check", output, {
        currentVersion: result.currentVersion,
        latestVersion: result.latestVersion,
        hasUpdate: result.hasUpdate,
        checkedAt: result.checkedAt,
        cacheHit: result.cacheHit,
      })
    } catch (err) {
      return errorResponse(`Failed to check for updates: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})

export const mesaUpdateTool = tool({
  description: "Update the Mesa plugin to the latest version. Requires restart after completion.",
  args: {},
  async execute() {
    try {
      const check = await checkForUpdate()

      if (!check.hasUpdate) {
        return successResponse(
          "Mesa Update",
          `Already on the latest version: v${check.currentVersion}`,
          { currentVersion: check.currentVersion },
        )
      }

      const result = await runUpdate(check.latestVersion)

      if (result.success) {
        return successResponse("Mesa Update", [
          result.message,
          "Restart opencode to apply the update.",
        ].join("\n"), {
          previousVersion: result.previousVersion,
          newVersion: result.newVersion,
          success: true,
        })
      }

      return errorResponse(result.message)
    } catch (err) {
      return errorResponse(`Update failed: ${err instanceof Error ? err.message : String(err)}`)
    }
  },
})
