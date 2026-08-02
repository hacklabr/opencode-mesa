import { describe, expect, test } from "vitest"
import {
  buildSpecialistPrompt,
  extractInlinePersonaId,
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

function inlinePersonaPrompt(personaId = fakePersona.id, name = fakePersona.name): string {
  return [
    `<specialist-persona id="${personaId}" name="${name}">`,
    fakePersona.systemPrompt,
    `</specialist-persona>`,
    ``,
    `Analyze the briefing.`,
  ].join("\n")
}

describe("extractInlinePersonaId", () => {
  test("extracts the id from a well-formed inline block", () => {
    expect(extractInlinePersonaId(inlinePersonaPrompt())).toBe(fakePersona.id)
  })

  test("returns null when no inline block exists", () => {
    expect(extractInlinePersonaId("do work")).toBeNull()
  })
})

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

  // --- Inline persona path (primary, spec D10.2/D10.3) ---

  test("passes through untouched when the prompt already has an inline persona block (no task_id)", async () => {
    const prompt = inlinePersonaPrompt()
    const result = await buildSpecialistPrompt(
      { subagent_type: SPECIALIST_SUBAGENT_TYPE, prompt },
      foundLookup
    )
    // No setup-error, no re-injection — the inline block is self-contained.
    expect(result).toBeNull()
  })

  test("inline persona wins over a mesa- slug (no duplicate injection)", async () => {
    const prompt = inlinePersonaPrompt()
    const result = await buildSpecialistPrompt(
      {
        subagent_type: SPECIALIST_SUBAGENT_TYPE,
        task_id: `mesa-${fakePersona.id}`,
        prompt,
      },
      foundLookup
    )
    expect(result).toBeNull()
  })

  test("injects an error notice when the inline persona id is not in the catalog", async () => {
    const result = await buildSpecialistPrompt(
      {
        subagent_type: SPECIALIST_SUBAGENT_TYPE,
        prompt: inlinePersonaPrompt("no-such-persona", "Ghost"),
      },
      foundLookup
    )
    expect(result).toContain("<specialist-setup-error>")
    expect(result).toContain('"no-such-persona"')
    expect(result).toContain("not found")
  })

  // --- Slug path (runtimes that accept non-ses_ task_ids) ---

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

  test("injects an error notice when the slug persona is not in the catalog", async () => {
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

  // --- Genuine absence: no inline block AND no slug ---

  test("injects an error notice describing BOTH paths when no persona exists anywhere", async () => {
    const result = await buildSpecialistPrompt(
      { subagent_type: SPECIALIST_SUBAGENT_TYPE, prompt: "do work" },
      foundLookup
    )

    expect(result).toContain("<specialist-setup-error>")
    // The message must document the two legitimate resolution paths.
    expect(result).toContain("<specialist-persona id=")
    expect(result).toContain('task_id="mesa-{personaId}"')
    expect(result!.endsWith("do work")).toBe(true)
  })
})
