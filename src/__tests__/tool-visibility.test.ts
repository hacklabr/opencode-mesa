// Tests for per-agent tool visibility filtering (spec D8, spike path a):
// the plugin `config` hook injects permission deny rules for mesa/specialist,
// derived from the live tool registry; the stale tool.definition suffix hook
// is deleted in the same change.

import { describe, expect, test } from "vitest"
import type { Config } from "@opencode-ai/plugin"
import { mesa } from "../index.js"
import {
  applySpecialistToolPermissions,
  SPECIALIST_AGENT,
  SPECIALIST_ALLOWED_TOOLS,
} from "../workflow/tool-visibility.js"

type Ruleset = Record<string, string>

function getPermission(config: Config): Ruleset {
  const agent = config.agent?.[SPECIALIST_AGENT]
  return (agent?.permission ?? {}) as unknown as Ruleset
}

// The orchestration tools specialists must NOT see (spec D8 / T13 list).
const EXPECTED_DENIED = [
  "open_round",
  "close_round",
  "record_decision",
  "produce_deliverable",
  "approve_deliverable",
  "create_briefing",
  "import_briefing",
  "approve_briefing",
  "propose_team",
  "summon_team",
  "mesa_update",
  "mesa_check_update",
  "pause_discussion",
  "resume_discussion",
  "cancel_discussion",
]

describe("plugin hooks shape", () => {
  test("registers a config hook and NO tool.definition hook (suffix deleted)", async () => {
    const hooks = await mesa({
      client: {},
      directory: "/tmp/mesa-tool-visibility-test",
    } as Parameters<typeof mesa>[0])

    expect(typeof hooks.config).toBe("function")
    expect("tool.definition" in hooks).toBe(false)
  })
})

describe("applySpecialistToolPermissions", () => {
  const ALL_TOOLS = [
    ...EXPECTED_DENIED,
    ...SPECIALIST_ALLOWED_TOOLS,
    "list_specialists",
    "get_specialist",
  ]

  test("denies every orchestration tool for mesa/specialist", () => {
    const config = {} as Config
    applySpecialistToolPermissions(config, ALL_TOOLS)

    const permission = getPermission(config)
    for (const tool of EXPECTED_DENIED) {
      expect(permission[tool]).toBe("deny")
    }
  })

  test("keeps the specialist seam tools visible (no deny rule)", () => {
    const config = {} as Config
    applySpecialistToolPermissions(config, ALL_TOOLS)

    const permission = getPermission(config)
    for (const tool of SPECIALIST_ALLOWED_TOOLS) {
      expect(permission[tool]).toBeUndefined()
    }
  })

  test("deny list is derived from the registry — no drift (every tool is allowed or denied)", () => {
    const config = {} as Config
    applySpecialistToolPermissions(config, ALL_TOOLS)

    const permission = getPermission(config)
    for (const tool of ALL_TOOLS) {
      const isAllowed = SPECIALIST_ALLOWED_TOOLS.includes(tool)
      if (isAllowed) {
        expect(permission[tool]).toBeUndefined()
      } else {
        expect(permission[tool]).toBe("deny")
      }
    }
    // catalog tools are Manager-only → denied for specialists
    expect(permission["list_specialists"]).toBe("deny")
    expect(permission["get_specialist"]).toBe("deny")
  })

  test("never clobbers an explicit pre-existing rule (user override)", () => {
    const config = {
      agent: {
        [SPECIALIST_AGENT]: {
          permission: { open_round: "allow" },
        },
      },
    } as unknown as Config
    applySpecialistToolPermissions(config, ALL_TOOLS)

    const permission = getPermission(config)
    expect(permission["open_round"]).toBe("allow")
    expect(permission["close_round"]).toBe("deny")
  })

  test("does not touch manager or briefing-writer agents (full kernel access)", () => {
    const config = {
      agent: {
        manager: { description: "Manager agent" },
        "briefing-writer": { description: "Briefing writer agent" },
      },
    } as unknown as Config
    applySpecialistToolPermissions(config, ALL_TOOLS)

    expect(config.agent?.manager?.permission).toBeUndefined()
    expect(config.agent?.["briefing-writer"]?.permission).toBeUndefined()
  })
})

describe("config hook integration (live registry)", () => {
  test("the plugin's config hook denies every registered tool outside the allowlist", async () => {
    const hooks = await mesa({
      client: {},
      directory: "/tmp/mesa-tool-visibility-test",
    } as Parameters<typeof mesa>[0])

    const registeredTools = Object.keys(hooks.tool!)
    expect(registeredTools.length).toBeGreaterThan(0)

    const config = {} as Config
    await hooks.config!(config)

    const permission = getPermission(config)
    for (const tool of registeredTools) {
      if (SPECIALIST_ALLOWED_TOOLS.includes(tool)) {
        expect(permission[tool]).toBeUndefined()
      } else {
        expect(permission[tool]).toBe("deny")
      }
    }

    // Spec D8 list sanity: the T13-mandated tools are all denied.
    for (const tool of EXPECTED_DENIED) {
      expect(registeredTools).toContain(tool)
      expect(permission[tool]).toBe("deny")
    }
  })
})
