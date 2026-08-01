import { describe, expect, test } from "vitest"
import {
  buildSpecialistPrompt,
  SPECIALIST_SUBAGENT_TYPE,
  type PersonaLookup,
} from "../workflow/specialist-injection.js"

const fakePersona = {
  id: "engineering-backend-architect",
  name: "Backend Architect",
  systemPrompt: "You are a backend architect.\n\n---\n\nGlobal rules.",
}

const foundLookup: PersonaLookup = async (id) =>
  id === fakePersona.id ? fakePersona : null

const notFoundLookup: PersonaLookup = async () => null

describe("buildSpecialistPrompt", () => {
  test("returns null for non-specialist subagent types", async () => {
    const result = await buildSpecialistPrompt(
      { subagent_type: "general", task_id: "mesa-anything", prompt: "do work" },
      foundLookup
    )
    expect(result).toBeNull()
  })

  test("returns null when resuming a session via ses_ task_id", async () => {
    const result = await buildSpecialistPrompt(
      { subagent_type: SPECIALIST_SUBAGENT_TYPE, task_id: "ses_abc123", prompt: "turn 2" },
      foundLookup
    )
    expect(result).toBeNull()
  })

  test("injects the persona system prompt ahead of the original prompt", async () => {
    const result = await buildSpecialistPrompt(
      {
        subagent_type: SPECIALIST_SUBAGENT_TYPE,
        task_id: "mesa-engineering-backend-architect",
        prompt: "Analyze the briefing.",
      },
      foundLookup
    )

    expect(result).not.toBeNull()
    expect(result).toContain(`<specialist-persona id="${fakePersona.id}" name="${fakePersona.name}">`)
    expect(result).toContain(fakePersona.systemPrompt)
    expect(result).toContain("</specialist-persona>")
    expect(result!.endsWith("Analyze the briefing.")).toBe(true)
    // Persona block comes before the original prompt
    expect(result!.indexOf("<specialist-persona")).toBeLessThan(
      result!.indexOf("Analyze the briefing.")
    )
  })

  test("injects an error notice when task_id has no persona prefix", async () => {
    const result = await buildSpecialistPrompt(
      { subagent_type: SPECIALIST_SUBAGENT_TYPE, prompt: "do work" },
      foundLookup
    )

    expect(result).toContain("<specialist-setup-error>")
    expect(result).toContain('task_id="mesa-{personaId}"')
    expect(result!.endsWith("do work")).toBe(true)
  })

  test("injects an error notice when the persona is not in the catalog", async () => {
    const result = await buildSpecialistPrompt(
      {
        subagent_type: SPECIALIST_SUBAGENT_TYPE,
        task_id: "mesa-no-such-persona",
        prompt: "do work",
      },
      notFoundLookup
    )

    expect(result).toContain("<specialist-setup-error>")
    expect(result).toContain('"no-such-persona" not found')
    expect(result!.endsWith("do work")).toBe(true)
  })
})
