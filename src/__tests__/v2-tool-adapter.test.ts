import { describe, expect, test } from "vitest"
import { tool } from "@opencode-ai/plugin/tool"
import type { ToolContext as V2ToolContext } from "@opencode/plugin/promise/tool"
import { successResponse, errorResponse } from "../utils/responses.js"
import { buildV2Tool, toV2Result } from "../v2/tool-adapter.js"
import { mesaTools } from "../tools/registry.js"

function makeV2Context(): V2ToolContext {
  return {
    sessionID: "ses_test",
    agent: "build",
    messageID: "msg_test",
    id: "call_test",
    signal: new AbortController().signal,
    progress: async () => {},
  } as unknown as V2ToolContext
}

describe("toV2Result", () => {
  test("maps a plain string to { content }", () => {
    expect(toV2Result(errorResponse("boom"))).toEqual({ content: "Error: boom" })
  })

  test("maps SuccessResponse to content with title header + metadata", () => {
    const result = toV2Result(successResponse("Title", "body text", { n: 1 }))
    expect(result.content).toBe("Title\n\nbody text")
    expect(result.metadata).toEqual({ n: 1 })
  })

  test("omits metadata when absent", () => {
    const result = toV2Result({ title: "T", output: "O" })
    expect(result).toEqual({ content: "T\n\nO" })
  })
})

describe("buildV2Tool", () => {
  const def = tool({
    description: "Test tool for adapter coverage",
    args: {
      name: tool.schema.string().describe("the name"),
      count: tool.schema.number().optional().describe("optional count"),
    },
    async execute(args, context) {
      return successResponse("Echo", `dir=${context.directory} name=${args.name}`, { ok: true })
    },
  })

  const v2Tool = buildV2Tool("adapter_probe", def, "/tmp/mesa-adapter-dir")

  test("carries name and description", () => {
    expect(v2Tool.name).toBe("adapter_probe")
    expect(v2Tool.description).toBe("Test tool for adapter coverage")
  })

  test("input is a JSON Schema derived from the zod shape (with descriptions)", () => {
    const input = v2Tool.input as {
      type: string
      properties: Record<string, { type: string; description?: string }>
      required: string[]
    }
    expect(input.type).toBe("object")
    expect(input.properties.name.type).toBe("string")
    expect(input.properties.name.description).toBe("the name")
    expect(input.properties.count.type).toBe("number")
    expect(input.required).toContain("name")
    expect(input.required).not.toContain("count")
  })

  test("execute reinjects the plugin directory into the shared context", async () => {
    const result = await v2Tool.execute({ name: "x" }, makeV2Context())
    expect(result.content).toContain("dir=/tmp/mesa-adapter-dir name=x")
    expect(result.metadata).toEqual({ ok: true })
  })

  test("execute reports invalid arguments as readable content", async () => {
    const result = await v2Tool.execute({ wrong: true }, makeV2Context())
    expect(result.content).toContain("Error: invalid arguments for adapter_probe")
  })
})

describe("registry × V2 adapter (all 24 tools)", () => {
  test("every registry tool converts to a valid V2 definition", () => {
    const names = Object.keys(mesaTools)
    expect(names.length).toBe(24)
    for (const [name, def] of Object.entries(mesaTools)) {
      const converted = buildV2Tool(name, def, "/tmp/mesa-registry")
      expect(converted.name).toBe(name)
      expect(converted.description.length).toBeGreaterThan(0)
      const input = converted.input as { type?: string }
      expect(input.type).toBe("object")
    }
  })

  test("V1 tool map and V2 registration derive from the same source (no drift)", () => {
    // The V1 hook map IS the registry; converting each entry for V2 uses the
    // same objects — asserting identical key sets guards against future drift.
    const v1Names = Object.keys(mesaTools).sort()
    const v2Names = Object.entries(mesaTools)
      .map(([name, def]) => buildV2Tool(name, def, "/tmp").name)
      .sort()
    expect(v2Names).toEqual(v1Names)
  })
})
