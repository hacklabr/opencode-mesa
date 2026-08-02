import type { Config } from "@opencode-ai/plugin"

/**
 * Per-agent tool visibility filtering (spec D8, spike verdict path a —
 * named-agent permission allowlist).
 *
 * OpenCode removes permission-denied tools from the LLM request payload at
 * request-build time (`resolveTools`, refs/opencode session/llm/request.ts),
 * so deny rules here are a real token saving (~5.3k per specialist session),
 * not just execution blocking. The plugin `config` hook applies these rules
 * at load time — self-healing, derived from the live tool registry, no
 * hardcoded deny list to drift.
 */

export const SPECIALIST_AGENT = "mesa/specialist"

/**
 * The specialist seam — the only Mesa tools a mesa/specialist session needs.
 * Everything else the plugin registers is orchestration surface (Manager
 * territory) and is denied at the definition level.
 */
export const SPECIALIST_ALLOWED_TOOLS: readonly string[] = [
  "register_analysis",
  "get_peer_analyses",
  "ask_peer",
  "memory_store",
  "memory_recall",
  "memory_forget",
  "mesa_status",
]

type PermissionAction = "ask" | "allow" | "deny"
type MutableRuleset = Record<string, PermissionAction | Record<string, PermissionAction>>

/**
 * Injects deny rules for every registered Mesa tool that is not in the
 * specialist allowlist into `agent["mesa/specialist"].permission`.
 *
 * Named agents NOT listed here (manager, briefing-writer) are left untouched
 * — they need the full kernel. Explicit pre-existing rules (e.g. a user
 * override in opencode.json) are never clobbered.
 */
export function applySpecialistToolPermissions(
  config: Config,
  registeredToolNames: string[]
): void {
  const deniedTools = registeredToolNames.filter(
    (name) => !SPECIALIST_ALLOWED_TOOLS.includes(name)
  )

  const agents = (config.agent ??= {})
  const specialist = (agents[SPECIALIST_AGENT] ??= {})
  const permission = (specialist.permission ??= {}) as unknown as MutableRuleset

  for (const toolName of deniedTools) {
    if (!(toolName in permission)) {
      permission[toolName] = "deny"
    }
  }
}
