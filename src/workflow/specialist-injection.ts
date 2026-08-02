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

const INLINE_PERSONA_REGEX = /<specialist-persona\s[^>]*id="([^"]+)"/

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
 * Extracts the persona id from an inline `<specialist-persona id="...">` block
 * already present in the delegation prompt. Returns null when absent.
 */
export function extractInlinePersonaId(prompt: string): string | null {
  const match = prompt.match(INLINE_PERSONA_REGEX)
  return match ? match[1] : null
}

/**
 * Builds the task prompt for the generic `mesa/specialist` subagent with the
 * persona system prompt injected. Returns null when the call should pass
 * through untouched.
 *
 * Persona resolution order (spec D10.2/D10.3):
 * 1. Session resumption (task_id="ses_...") — persona is already in history.
 * 2. INLINE persona block in the prompt — the PRIMARY path. Runtimes that
 *    reject non-"ses_" task_ids force the Manager to inline the persona;
 *    the block is self-contained, so the prompt passes through untouched.
 * 3. task_id slug ("mesa-{personaId}") — for runtimes that accept it; the
 *    hook injects the persona block from the catalog.
 *
 * The setup-error notice fires ONLY when no persona exists anywhere
 * (neither inline nor slug) or when the resolved persona id is unknown.
 */
export async function buildSpecialistPrompt(
  args: TaskToolArgs,
  lookup: PersonaLookup = getPersonaById
): Promise<string | null> {
  if (args.subagent_type !== SPECIALIST_SUBAGENT_TYPE) return null

  const originalPrompt = typeof args.prompt === "string" ? args.prompt : ""
  const taskId = typeof args.task_id === "string" ? args.task_id : ""

  // Path 1: resuming an existing specialist session — persona is already in history.
  if (taskId.startsWith(SESSION_ID_PREFIX)) return null

  // Path 2: inline persona block (primary). Validate the id against the
  // catalog as a sanity check, but never re-inject — the block already
  // carries the full persona content.
  const inlinePersonaId = extractInlinePersonaId(originalPrompt)
  if (inlinePersonaId) {
    const persona = await lookup(inlinePersonaId)
    if (!persona) {
      return errorNotice(
        `Persona "${inlinePersonaId}" (inline <specialist-persona> block) not found in the Mesa catalog. Use list_specialists to find a valid persona ID and retry.`,
        originalPrompt
      )
    }
    return null
  }

  // Path 3: task_id slug.
  if (!taskId.startsWith(PERSONA_TASK_ID_PREFIX)) {
    return errorNotice(
      `No persona specified. Provide the specialist persona either inline (a <specialist-persona id="..."> block in the prompt) or via task_id="mesa-{personaId}" (got task_id=${JSON.stringify(taskId || undefined)}).`,
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
