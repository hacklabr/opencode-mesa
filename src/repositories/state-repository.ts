import { z } from "zod"

export const PhaseContextSchema = z.object({
  workspaceId: z.string(),
  sessionId: z.string(),
  phase: z.string(),
  context: z.record(z.unknown()),
  schemaVersion: z.number().default(1),
  updatedAt: z.string(),
})

export type PhaseContextRecord = z.infer<typeof PhaseContextSchema>

export interface StateRepository {
  getPhaseContext(
    workspaceId: string,
    sessionId: string,
    phase: string
  ): Promise<PhaseContextRecord | null>

  savePhaseContext(record: PhaseContextRecord): Promise<void>

  deletePhaseContext(
    workspaceId: string,
    sessionId: string,
    phase: string
  ): Promise<void>

  listPhaseContexts(
    workspaceId: string,
    sessionId: string
  ): Promise<PhaseContextRecord[]>

  close(): void
}
