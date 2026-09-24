import { openDatabase } from "../db/driver.js"
import { PLUGIN_STATE_DIR } from "../config.js"
import { join } from "node:path"

const MESA_CONTEXT_BLOCK = [
  "<mesa-plugin>",
  "## MANDATORY RULE — DO NOT VIOLATE",
  "",
  "You have access to the Mesa plugin — a structured workflow for producing",
  "high-quality specifications through multi-specialist AI discussion.",
  "",
  "### IF you are the briefing-writer or manager agent:",
  "You are ALREADY part of the Mesa workflow. Do your job directly.",
  "Do NOT redirect the user to another agent or suggest switching.",
  "",
  "### IF you are any other agent and the user wants ANY of the following,",
  "### you MUST redirect to the Mesa workflow:",
  "- Create a project briefing or scope document",
  "- Analyze a project, codebase, or product and produce improvement suggestions",
  "- Generate a specification, technical document, or improvement plan",
  "- Start a discussion with specialists or a team of agents",
  "- Any request that involves structured analysis before implementation",
  "",
  "### WHAT you MUST do (non-Mesa agents only):",
  "1. Tell the user: \"This requires the Mesa workflow.\"",
  "2. Suggest the user switch to the `briefing-writer` agent by typing: `/agent briefing-writer`",
  "   - Or use the command: `/briefing` to start the workflow automatically.",
  "3. NEVER attempt to produce specifications, improvement plans, or analysis documents",
  "   by yourself. ALWAYS delegate to the Mesa workflow.",
  "",
  "### WHY this exists:",
  "The Mesa workflow ensures that multiple AI specialists analyze, debate, and reach",
  "consensus before producing any specification. Bypassing it produces lower quality output.",
  "",
  "### EXCEPTION: Only skip the Mesa workflow if the user explicitly says",
  "\"do it yourself\" or \"skip the discussion table\".",
  "",
  "Available Mesa agents:",
  "- `briefing-writer`: Conducts structured discovery to create professional briefings.",
  "- `manager`: Orchestrates specialist teams, manages discussion rounds and specifications.",
  "",
  "To start: user types `/agent briefing-writer` or `/briefing`.",
  "</mesa-plugin>",
].join("\n")

function memoryHintBlock(directory: string): string | null {
  const dbPath = join(directory, PLUGIN_STATE_DIR, "state.db")
  const db = openDatabase(dbPath, { readonly: true })
  try {
    const row = db
      .query("SELECT COUNT(*) as count FROM mesa_memory WHERE workspace_id = ? AND status = 'active'")
      .get(directory) as { count: number } | null
    if (row && row.count > 0) {
      return `<mesa-memory-hint>${row.count} project memories stored. Use memory_recall to retrieve relevant ones.</mesa-memory-hint>`
    }
  } finally {
    db.close()
  }
  return null
}

/**
 * System blocks injected into every session's model context: the Mesa
 * redirect rule plus a non-critical memory hint when project memories
 * exist. Shared by the V1 system-transform hook and the V2 session
 * `context` hook.
 */
export function buildMesaSystemBlocks(directory: string): string[] {
  const blocks = [MESA_CONTEXT_BLOCK]
  try {
    const hint = memoryHintBlock(directory)
    if (hint) blocks.push(hint)
  } catch {
    // Silently skip — memory hint is non-critical
  }
  return blocks
}
