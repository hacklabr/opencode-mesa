import { tool, type ToolDefinition, type ToolContext } from "@opencode-ai/plugin/tool"
import type { Info as V2ToolInfo, ToolContext as V2ToolContext, Result as V2ToolResult } from "@opencode/plugin/promise/tool"

/**
 * Converts a V1 tool definition ({description, args: ZodRawShape, execute})
 * into a V2 `editor.add` definition:
 *
 * - `input` becomes a self-contained JSON Schema via the SAME zod namespace
 *   the args were built with (`tool.schema` — zod 4 ships toJSONSchema).
 *   JSON Schema is the canonical V2 tool input format; passing the zod
 *   object itself would validate via Standard Schema but risks a degraded
 *   model-facing schema, since the V2 runtime only derives JSON Schema
 *   from schemas it knows.
 * - The execute wrapper re-validates through zod (defaults, coercion — same
 *   semantics the V1 host applied) and adapts context/result shapes.
 */

type V1ToolResult = string | { title?: string; output: string; metadata?: Record<string, unknown> }

const z = tool.schema

export function toV2Result(result: V1ToolResult): V2ToolResult {
  if (typeof result === "string") return { content: result }
  const content = result.title ? `${result.title}\n\n${result.output}` : result.output
  return result.metadata !== undefined ? { content, metadata: result.metadata } : { content }
}

function argsToJsonSchema(name: string, shape: Parameters<typeof z.object>[0]): V2ToolInfo["input"] {
  try {
    return z.toJSONSchema(z.object(shape)) as unknown as V2ToolInfo["input"]
  } catch (err) {
    // Unrepresentable construct — degrade to a permissive object rather
    // than losing the tool entirely; zod still validates at execute time.
    void err
    return { type: "object", properties: {}, additionalProperties: true } as unknown as V2ToolInfo["input"]
  }
}

export function buildV2Tool(
  name: string,
  def: ToolDefinition,
  directory: string
): V2ToolInfo {
  const schema = z.object(def.args)
  const input = argsToJsonSchema(name, def.args)

  return {
    name,
    description: def.description,
    input,
    async execute(rawInput, v2Context: V2ToolContext): Promise<V2ToolResult> {
      let args: Record<string, unknown>
      try {
        args = schema.parse(rawInput) as Record<string, unknown>
      } catch (err) {
        const detail = err instanceof Error ? err.message : String(err)
        return { content: `Error: invalid arguments for ${name} — ${detail}` }
      }

      // The V2 tool context has no `directory`; reinject the plugin
      // location's directory so shared executors keep V1 context semantics.
      const context = {
        ...v2Context,
        directory,
        worktree: directory,
      } as unknown as ToolContext

      const result = await def.execute(
        args as Parameters<typeof def.execute>[0],
        context
      )
      return toV2Result(result as V1ToolResult)
    },
  }
}
