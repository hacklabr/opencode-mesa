import { readFile } from "node:fs/promises"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "agents")

const promptCache = new Map<string, string>()

async function loadAgentPrompt(filename: string): Promise<string> {
  if (promptCache.has(filename)) {
    return promptCache.get(filename)!
  }
  try {
    const path = join(AGENTS_DIR, filename)
    const content = await readFile(path, "utf-8")
    promptCache.set(filename, content)
    return content
  } catch {
    return ""
  }
}

const AGENT_PROMPT_MAP: Record<string, string> = {
  "briefing-writer": "briefing-writer.md",
  gestor: "gestor.md",
}

export async function buildSystemPrompt(agent: string): Promise<string> {
  const filename = AGENT_PROMPT_MAP[agent]
  if (!filename) return ""
  return loadAgentPrompt(filename)
}

export function clearPromptCache(): void {
  promptCache.clear()
}
