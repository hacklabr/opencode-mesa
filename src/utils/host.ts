/**
 * Runtime host detection.
 *
 * The plugin runs on both OpenCode plugin APIs:
 * - V1 (`@opencode-ai/plugin`) hands plugins a bare SDK client.
 * - V2 (`@opencode/plugin`) hands a PluginContext that IS the client plus
 *   extension domains (transforms, hooks, events).
 *
 * The V2 context always carries `location` and `tool.transform`; the V1
 * client never does. This is the only reliable structural discriminator.
 */
export interface V2ContextShape {
  location?: { directory?: string }
  tool?: { transform?: unknown; hook?: unknown }
  session?: Record<string, unknown>
  [key: string]: unknown
}

export function isV2Context(client: unknown): client is V2ContextShape {
  const c = client as V2ContextShape | null | undefined
  return (
    typeof c === "object" &&
    c !== null &&
    typeof c.location === "object" &&
    c.location !== null &&
    typeof (c.tool as { transform?: unknown } | undefined)?.transform === "function"
  )
}
