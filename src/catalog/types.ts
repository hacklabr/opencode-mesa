export interface Persona {
  id: string
  source: "embedded" | "custom"
  division: string
  name: string
  description: string
  emoji: string
  color: string
  vibe: string
  tools: string[]
  systemPrompt: string
}

export interface CatalogSummary {
  totalPersonas: number
  divisions: string[]
  personasPerDivision: Record<string, number>
}
