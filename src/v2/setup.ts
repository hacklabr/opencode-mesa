import { Plugin } from "@opencode/plugin"
import { mesaTools } from "../tools/registry.js"
import { buildV2Tool } from "./tool-adapter.js"
import { applySpecialistToolPermissionsV2 } from "../workflow/tool-visibility.js"
import { buildSpecialistPrompt, type TaskToolArgs } from "../workflow/specialist-injection.js"
import { buildMesaSystemBlocks } from "../workflow/system-blocks.js"
import { setSdkClient } from "../tools/peer-transport.js"
import { setStateSdkClient } from "../state.js"
import { checkForUpdate } from "../updater/checker.js"
import { trackSessionEvent, type TrackedSessionEvent } from "../tools/peer-busy.js"

/** V2 renamed the subagent launcher: V1 `task` → V2 `subagent`. */
export const SUBAGENT_TOOL_NAME = "subagent"

export async function setup(ctx: Plugin.Context): Promise<Plugin.Cleanup> {
  setSdkClient(ctx)
  setStateSdkClient(ctx)

  // Fire-and-forget update check — populates cache for tools
  checkForUpdate().catch(() => {})

  const directory = ctx.location.directory

  await ctx.tool.transform((editor) => {
    for (const [name, def] of Object.entries(mesaTools)) {
      editor.add(buildV2Tool(name, def, directory))
    }
  })

  // Spec D8: per-agent tool visibility. V2 replaces the V1 `config` hook
  // with an agent transform editing the ruleset of mesa/specialist.
  await ctx.agent.transform((editor) => {
    applySpecialistToolPermissionsV2(editor, Object.keys(mesaTools))
  })

  // Persona injection at delegation time (spec D10.2/D10.3).
  await ctx.tool.hook("execute.before", async (event) => {
    if (event.tool !== SUBAGENT_TOOL_NAME) return

    const args = event.input as TaskToolArgs | undefined
    if (!args) return

    try {
      const injected = await buildSpecialistPrompt(args)
      if (injected !== null) {
        args.prompt = injected
      }
    } catch {
      // Persona injection is best-effort — never block the subagent call
    }
  })

  // Mesa context + memory hint on every agent-loop model request.
  await ctx.session.hook("context", (event) => {
    for (const block of buildMesaSystemBlocks(directory)) {
      event.system.push({ type: "text", text: block })
    }
  })

  // Busy tracking for ask_peer (V2 has no session.status bulk endpoint).
  const controller = new AbortController()
  void (async () => {
    try {
      for await (const event of ctx.event.subscribe({ signal: controller.signal })) {
        trackSessionEvent(event as unknown as TrackedSessionEvent)
      }
    } catch {
      // Stream aborted during plugin unload
    }
  })()

  return () => controller.abort()
}
