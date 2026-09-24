/**
 * In-memory session busy tracking for V2 hosts, fed from the public event
 * stream (`session.execution.started` / `session.idle`). Replaces the V1
 * `client.session.status()` busy check that the V2 API no longer exposes.
 *
 * Best-effort by design: unknown sessions report null and callers proceed.
 */

const sessionStates = new Map<string, boolean>()

export interface TrackedSessionEvent {
  type: string
  data?: { sessionID?: string } | Record<string, unknown> | undefined
}

function eventSessionId(ev: TrackedSessionEvent): string | null {
  const data = ev.data as { sessionID?: string } | undefined
  return typeof data?.sessionID === "string" ? data.sessionID : null
}

export function trackSessionEvent(ev: TrackedSessionEvent): void {
  const sessionId = eventSessionId(ev)
  if (!sessionId) return
  if (ev.type === "session.execution.started") {
    sessionStates.set(sessionId, true)
  } else if (
    ev.type === "session.idle" ||
    ev.type === "session.execution.succeeded" ||
    ev.type === "session.execution.failed" ||
    ev.type === "session.execution.interrupted" ||
    ev.type === "session.deleted"
  ) {
    sessionStates.set(sessionId, false)
    if (ev.type === "session.deleted") sessionStates.delete(sessionId)
  }
}

/** true = known busy, false = known idle, null = never observed. */
export function isSessionBusy(sessionId: string): boolean | null {
  return sessionStates.has(sessionId) ? sessionStates.get(sessionId)! : null
}

export function resetBusyTracker(): void {
  sessionStates.clear()
}
