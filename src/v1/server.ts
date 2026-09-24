import type { Plugin } from "@opencode-ai/plugin"
import { mesaTools } from "../tools/registry.js"
import { setSdkClient } from "../tools/peer-transport.js"
import { setStateSdkClient } from "../state.js"
import { checkForUpdate } from "../updater/checker.js"
import { buildSpecialistPrompt, type TaskToolArgs } from "../workflow/specialist-injection.js"
import { applySpecialistToolPermissions } from "../workflow/tool-visibility.js"
import { buildMesaSystemBlocks } from "../workflow/system-blocks.js"

/**
 * V1 host implementation (`@opencode-ai/plugin`). OpenCode 1.x (>= 1.18.29)
 * calls `server()` on the dual default export and consumes the returned
 * hook map.
 */
export const server: Plugin = async (input) => {
  setSdkClient(input.client, input.directory)
  setStateSdkClient(input.client)

  // Fire-and-forget update check — populates cache for tools
  checkForUpdate().catch(() => {})

  return {
    tool: mesaTools,

    // Spec D8: per-agent tool visibility. Denied tools are removed from the
    // LLM request payload (resolveTools) — real token savings per specialist
    // session, not just execution blocking. Derived from the live registry
    // so the deny list can never drift from the registered tools.
    config: async (config) => {
      applySpecialistToolPermissions(config, Object.keys(mesaTools))
    },

    "tool.execute.before": async (toolInput, output) => {
      if (toolInput.tool !== "task") return

      const args = output.args as TaskToolArgs | undefined
      if (!args) return

      try {
        const injected = await buildSpecialistPrompt(args)
        if (injected !== null) {
          args.prompt = injected
        }
      } catch {
        // Persona injection is best-effort — never block the task call
      }
    },

    "experimental.chat.system.transform": async (_input, output) => {
      for (const block of buildMesaSystemBlocks(input.directory)) {
        output.system.push(block)
      }
    },
  }
}
