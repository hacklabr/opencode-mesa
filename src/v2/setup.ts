import { Plugin } from "@opencode/plugin"
import { mesaTools } from "../tools/registry.js"
import { buildV2Tool } from "./tool-adapter.js"
import { applySpecialistToolPermissionsV2, SPECIALIST_AGENT } from "../workflow/tool-visibility.js"
import {
  checkSpecialistDelegation,
  SESSION_ID_PREFIX,
} from "../workflow/specialist-injection.js"
import { buildMesaSystemBlocks } from "../workflow/system-blocks.js"
import { setSdkClient } from "../tools/peer-transport.js"
import { setStateSdkClient } from "../state.js"
import { checkForUpdate } from "../updater/checker.js"
import { trackSessionEvent, type TrackedSessionEvent } from "../tools/peer-busy.js"

/** V2 renamed the subagent launcher: V1 `task` → V2 `subagent`. */
export const SUBAGENT_TOOL_NAME = "subagent"

interface SubagentToolInput {
  agent?: string
  sessionID?: string
  prompt?: string
}

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

  // Persona guard at delegation time (spec D10.2/D10.3). OpenCode V2
  // freezes the subagent input against mutation (both property writes and
  // full replacement are ignored) and does not propagate prompt-hook
  // rewrites for subagent child sessions — so the V2 guard BLOCKS invalid
  // delegations with an instructive error instead of rewriting the prompt.
  // The Manager sees the error and re-sends with the inline persona block.
  await ctx.tool.hook("execute.before", async (event) => {
    if (event.tool !== SUBAGENT_TOOL_NAME) return

    const input = event.input as SubagentToolInput | undefined
    if (!input || input.agent !== SPECIALIST_AGENT) return

    // Resuming an existing specialist — persona already in history.
    if (typeof input.sessionID === "string" && input.sessionID.startsWith(SESSION_ID_PREFIX)) return

    const prompt = typeof input.prompt === "string" ? input.prompt : ""
    const problem = await checkSpecialistDelegation(prompt)
    if (problem) throw new Error(problem)
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
