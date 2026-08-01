import { getPersonaById } from "../tools/catalog-tools.js"

export const SPECIALIST_SUBAGENT_TYPE = "mesa/specialist"
export const PERSONA_TASK_ID_PREFIX = "mesa-"
export const SESSION_ID_PREFIX = "ses_"

export interface TaskToolArgs {
  subagent_type?: unknown
  task_id?: unknown
  prompt?: unknown
  [key: string]: unknown
}

export type PersonaLookup = (
  personaId: string
) => Promise<{ id: string; name: string; systemPrompt: string } | null>

function errorNotice(message: string, originalPrompt: string): string {
  return [
    `<specialist-setup-error>`,
    `SETUP ERROR: ${message}`,
    `Report this error to the Manager in your response and do NOT attempt the task.`,
    `</specialist-setup-error>`,
    ``,
    originalPrompt,
  ].join("\n")
}

/**
 * Builds the task prompt for the generic `mesa/specialist` subagent with the
 * persona system prompt injected. Returns null when the call should pass
 * through untouched (non-specialist subagent or session resumption).
 */
export async function buildSpecialistPrompt(
  args: TaskToolArgs,
  lookup: PersonaLookup = getPersonaById
): Promise<string | null> {
  if (args.subagent_type !== SPECIALIST_SUBAGENT_TYPE) return null

  const originalPrompt = typeof args.prompt === "string" ? args.prompt : ""
  const taskId = typeof args.task_id === "string" ? args.task_id : ""

  // Resuming an existing specialist session — persona is already in history.
  if (taskId.startsWith(SESSION_ID_PREFIX)) return null

  if (!taskId.startsWith(PERSONA_TASK_ID_PREFIX)) {
    return errorNotice(
      `No persona specified. Invoke this subagent with task_id="mesa-{personaId}" (got task_id=${JSON.stringify(taskId || undefined)}).`,
      originalPrompt
    )
  }

  const personaId = taskId.slice(PERSONA_TASK_ID_PREFIX.length)
  const persona = await lookup(personaId)

  if (!persona) {
    return errorNotice(
      `Persona "${personaId}" not found in the Mesa catalog. Use list_specialists to find a valid persona ID and retry.`,
      originalPrompt
    )
  }

  return [
    `<specialist-persona id="${persona.id}" name="${persona.name}">`,
    persona.systemPrompt.trim(),
    `</specialist-persona>`,
    ``,
    originalPrompt,
  ].join("\n")
}
