import { readFileSync } from "node:fs"
import { join, dirname } from "node:path"
import { fileURLToPath } from "node:url"

export type {
  DiscussionPhase,
  DiscussionStatus,
  BriefingStatus,
  ScopeMagnitude,
  ScopeDimension,
  BriefingMetadata,
  SpecialistStatus,
  AnalysisEntry,
  SpecialistEntry,
  DiscussionState,
} from "./types.js"

const __dirname = dirname(fileURLToPath(import.meta.url))

function readVersion(): string {
  try {
    const pkg = JSON.parse(readFileSync(join(__dirname, "../package.json"), "utf-8"))
    return pkg.version
  } catch {
    return "0.0.0-unknown"
  }
}

export const PLUGIN_VERSION = readVersion()

export const PLUGIN_STATE_DIR = ".mesa"

export const DEFAULT_MAX_TURNS = 2

/**
 * Circuit breakers (spec D6 — the spirit of profiles.ts Tier 1 without the
 * tier apparatus). Values match the legacy "standard" rigor semantics.
 * Overrides require a human-authorized, audited record_decision.
 */
export const MAX_ROUNDS_PER_SESSION = 12
export const MAX_ANALYSES_PER_ROUND = 40
export const PEER_CONSULTATION_CAP = 2

export const CURRENT_STATE_VERSION = 15

import type { DiscussionState } from "./types.js"

export function createInitialState(workspaceId: string): DiscussionState {
  const now = new Date().toISOString()
  return {
    workspaceId,
    currentPhase: "PLANNING",
    status: "active",
    briefing: { path: null, status: "draft", slug: null, metadata: null },
    team: [],
    discussion: {
      topic: "",
      currentTurn: 0,
      maxTurns: DEFAULT_MAX_TURNS,
      analyses: [],
      participants: [],
    },
    // State v14 (spec D2/D4)
    rounds: [],
    deliverables: [],
    plan: null,
    sessionFolder: null,
    createdAt: now,
    updatedAt: now,
    stateVersion: CURRENT_STATE_VERSION,
  }
}
