import { describe, expect, test } from "vitest"
import { applySpecialistToolPermissionsV2, SPECIALIST_AGENT, SPECIALIST_ALLOWED_TOOLS } from "../workflow/tool-visibility.js"

interface Rule {
  action: string
  resource: string
  effect: string
}

interface AgentRecord {
  id: string
  name: string
  permissions: Rule[]
}

function makeEditor(agents: AgentRecord[]) {
  const store = new Map(agents.map((a) => [a.id, { ...a, permissions: a.permissions.map((r) => ({ ...r })) }]))
  return {
    get: (id: string) => store.get(id),
    update(id: string, update: (agent: AgentRecord) => void) {
      const agent = store.get(id)
      if (agent) update(agent)
    },
  }
}

const DENIED_TOOLS = ["open_round", "close_round", "summon_team"]
const ALL_TOOLS = [...DENIED_TOOLS, ...SPECIALIST_ALLOWED_TOOLS, "list_specialists"]

describe("applySpecialistToolPermissionsV2", () => {
  test("appends deny rules for orchestration tools (list form)", () => {
    const editor = makeEditor([{ id: SPECIALIST_AGENT, name: "Specialist", permissions: [] }])
    applySpecialistToolPermissionsV2(editor as never, ALL_TOOLS)

    const specialist = editor.get(SPECIALIST_AGENT)!
    for (const toolName of DENIED_TOOLS) {
      const rule = specialist.permissions.find((r) => r.action === toolName)
      expect(rule).toEqual({ action: toolName, resource: "*", effect: "deny" })
    }
    for (const allowed of SPECIALIST_ALLOWED_TOOLS) {
      expect(specialist.permissions.find((r) => r.action === allowed)).toBeUndefined()
    }
  })

  test("never clobbers an explicit pre-existing rule", () => {
    const editor = makeEditor([
      {
        id: SPECIALIST_AGENT,
        name: "Specialist",
        permissions: [{ action: "open_round", resource: "*", effect: "allow" }],
      },
    ])
    applySpecialistToolPermissionsV2(editor as never, ALL_TOOLS)

    const specialist = editor.get(SPECIALIST_AGENT)!
    expect(specialist.permissions.find((r) => r.action === "open_round")!.effect).toBe("allow")
    expect(specialist.permissions.find((r) => r.action === "close_round")!.effect).toBe("deny")
  })

  test("is a no-op when the specialist agent is not registered", () => {
    const editor = makeEditor([{ id: "manager", name: "Manager", permissions: [] }])
    applySpecialistToolPermissionsV2(editor as never, ALL_TOOLS)

    expect(editor.get("manager")!.permissions).toEqual([])
    expect(editor.get(SPECIALIST_AGENT)).toBeUndefined()
  })

  test("initializes a missing permissions array on an existing agent", () => {
    const editor = makeEditor([{ id: SPECIALIST_AGENT, name: "Specialist", permissions: [] }])
    editor.get(SPECIALIST_AGENT)!.permissions = undefined as never
    applySpecialistToolPermissionsV2(editor as never, ALL_TOOLS)

    expect(editor.get(SPECIALIST_AGENT)!.permissions.length).toBe(DENIED_TOOLS.length + 1)
  })
})
