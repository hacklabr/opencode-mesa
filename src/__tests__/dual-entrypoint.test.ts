import { describe, expect, test } from "vitest"
import { default as pluginEntry, mesa, setup } from "../index.js"
import { mesaTools } from "../tools/registry.js"
import { buildMesaSystemBlocks } from "../workflow/system-blocks.js"

function makeHookRegistry() {
  const hooks = new Map<string, Array<(event: never) => Promise<void> | void>>()
  return {
    register: (name: string, cb: (event: never) => Promise<void> | void) => {
      const list = hooks.get(name) ?? []
      list.push(cb)
      hooks.set(name, list)
    },
    async dispatch(name: string, event: unknown) {
      for (const cb of hooks.get(name) ?? []) await cb(event as never)
    },
  }
}

function makeCtx() {
  const hookRegistry = makeHookRegistry()
  const registeredTools: string[] = []

  const sessions = new Map<string, { agent: string; history: unknown[] }>()

  const ctx = {
    location: { directory: "/tmp/mesa-v2-setup" },
    tool: {
      transform: async (cb: (editor: unknown) => void) => {
        cb({
          add: (t: { name: string }) => {
            registeredTools.push(t.name)
          },
        })
        return { dispose: async () => {} }
      },
      hook: (name: string, cb: (event: never) => Promise<void> | void) => {
        hookRegistry.register(name, cb)
        return Promise.resolve({ dispose: async () => {} })
      },
    },
    agent: {
      transform: async (cb: (editor: unknown) => void) => {
        cb({ get: () => undefined, update: () => {} })
        return { dispose: async () => {} }
      },
    },
    session: {
      hook: (name: string, cb: (event: never) => Promise<void> | void) => {
        hookRegistry.register(name, cb)
        return Promise.resolve({ dispose: async () => {} })
      },
      get: async ({ sessionID }: { sessionID: string }) => sessions.get(sessionID),
      context: async ({ sessionID }: { sessionID: string }) => sessions.get(sessionID)?.history ?? [],
    },
    event: {
      subscribe: async function* () {},
    },
  }

  return { ctx, registeredTools, hookRegistry, sessions }
}

describe("dual-host entrypoint", () => {
  test("default export satisfies both hosts: V2 definition + V1 server()", () => {
    expect(pluginEntry.id).toBe("mesa")
    expect(typeof pluginEntry.setup).toBe("function")
    expect(typeof pluginEntry.server).toBe("function")
  })

  test("named `mesa` export is the V1 plugin function", async () => {
    expect(typeof mesa).toBe("function")
    const hooks = await mesa({ client: {}, directory: "/tmp/mesa-dual-test" } as never)
    expect(Object.keys(hooks.tool!)).toEqual(Object.keys(mesaTools))
    expect(typeof hooks.config).toBe("function")
  })

  test("V2 setup: registers all tools, system blocks, and a cleanup function", async () => {
    const { ctx, registeredTools, hookRegistry } = makeCtx()

    const cleanup = await setup(ctx as never)
    expect(typeof cleanup).toBe("function")

    expect(registeredTools.sort()).toEqual(Object.keys(mesaTools).sort())

    const contextEvent = { system: [] as { type: string; text: string }[], sessionID: "ses_x", agent: "build" }
    await hookRegistry.dispatch("context", contextEvent)
    expect(contextEvent.system.length).toBeGreaterThanOrEqual(1)
    expect(contextEvent.system[0]).toMatchObject({ type: "text" })
    expect(contextEvent.system[0].text).toContain("<mesa-plugin>")

    await (cleanup as () => Promise<void>)()
  })

  test("V2 prompt guard is gone (input frozen) — execute.before guards delegations", async () => {
    const { ctx, hookRegistry } = makeCtx()
    await setup(ctx as never)

    // No persona → throws with instructions
    await expect(
      hookRegistry.dispatch("execute.before", {
        tool: "subagent",
        sessionID: "ses_parent",
        input: { agent: "mesa/specialist", description: "d", prompt: "do work" },
      })
    ).rejects.toThrow(/specialist-persona/)

    // Unknown persona id → throws with the catalog hint
    await expect(
      hookRegistry.dispatch("execute.before", {
        tool: "subagent",
        sessionID: "ses_parent",
        input: {
          agent: "mesa/specialist",
          description: "d",
          prompt: '<specialist-persona id="no-such-persona">x</specialist-persona>\ndo work',
        },
      })
    ).rejects.toThrow(/not found in the Mesa catalog/)

    // Valid inline persona → passes
    await expect(
      hookRegistry.dispatch("execute.before", {
        tool: "subagent",
        sessionID: "ses_parent",
        input: {
          agent: "mesa/specialist",
          description: "d",
          prompt: '<specialist-persona id="software-development-backend-architect">x</specialist-persona>\ndo work',
        },
      })
    ).resolves.toBeUndefined()

    // Resumption (sessionID ses_) → persona already in history, passes
    await expect(
      hookRegistry.dispatch("execute.before", {
        tool: "subagent",
        sessionID: "ses_parent",
        input: { agent: "mesa/specialist", description: "d", sessionID: "ses_child123", prompt: "turn 2" },
      })
    ).resolves.toBeUndefined()

    // Other agents' subagent calls → untouched
    await expect(
      hookRegistry.dispatch("execute.before", {
        tool: "subagent",
        sessionID: "ses_parent",
        input: { agent: "general", description: "d", prompt: "explore" },
      })
    ).resolves.toBeUndefined()

    // Non-subagent tools → untouched
    await expect(
      hookRegistry.dispatch("execute.before", {
        tool: "read",
        sessionID: "ses_parent",
        input: { path: "/tmp/x" },
      })
    ).resolves.toBeUndefined()
  })
})

describe("buildMesaSystemBlocks (shared by both hosts)", () => {
  test("always includes the mesa context block; skips memory hint when no DB", () => {
    const blocks = buildMesaSystemBlocks("/tmp/mesa-no-state")
    expect(blocks.length).toBeGreaterThanOrEqual(1)
    expect(blocks[0]).toContain("<mesa-plugin>")
    expect(blocks[0]).toContain("`briefing-writer`")
  })
})
