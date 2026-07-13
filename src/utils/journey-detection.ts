import type { JourneyWorkshop } from "../types.js"

/**
 * Lexical signals that strongly indicate user journeys need to be created or
 * refactored. These words are intentionally broad because journeys can be
 * described in many ways across briefings.
 */
const JOURNEY_KEYWORDS: Array<[string[], string]> = [
  [["jornada", "jornadas", "journey", "journeys"], "explicit journey mention"],
  [["fluxo do usuário", "user flow", "fluxos do usuário", "user flows"], "user flow mention"],
  [["onboarding", "primeiro acesso", "first-run"], "onboarding flow"],
  [["cadastro", "registro", "signup", "sign-up", "login", "autenticação"], "authentication/registration flow"],
  [["checkout", "pagamento", "carrinho"], "transaction/checkout flow"],
  [["tela", "telas", "screen", "screens", "página", "páginas"], "screen/page mentions"],
  [["interface", "interfaces", "ux", "experiência do usuário", "user experience"], "UX/interface focus"],
  [["passo a passo", "step-by-step", "etapas", "steps"], "step-by-step flow"],
  [["redesenhar", "refatorar", "reformular", "redesign", "refactor"], "redesign/refactor intent"],
  [["novo fluxo", "novos fluxos", "new flow", "new workflow"], "new flow creation"],
  [["interação", "interações", "interaction"], "interaction design"],
  [["persona", "personas", "usuário final", "end user"], "user persona focus"],
]

/**
 * Phrase patterns that combine a journey keyword with creation/refactoring intent.
 * Matches are case-insensitive and allow whitespace variations.
 */
const JOURNEY_PATTERNS: RegExp[] = [
  /(?:criar|criação|definir|desenvolver|implementar|novo|nova)\s+(?:uma\s+)?(?:jornada|fluxo|tela|interface|experiência|onboarding|checkout|cadastro)/iu,
  /(?:refatorar|refatoração|redesenhar|reformular|rever|rework|atualizar)\s+(?:uma\s+)?(?:jornada|fluxo|tela|interface|experiência|onboarding|checkout|cadastro)/iu,
  /(?:jornada|fluxo|tela|interface|experiência)\s+(?:do\s+|de\s+|para\s+)?(?:usuário|cliente|admin|gestor|visitante)/iu,
  /(?:user\s+story|história\s+de\s+usuário|caso\s+de\s+uso)\s+(?:nova|novo|atualizada|refatorada)/iu,
]

export interface JourneyDetectionResult {
  hasUserJourneys: boolean
  confidence: JourneyWorkshop["confidence"]
  signals: string[]
  suggestedJourneys: string[]
}

/**
 * Scans briefing text for evidence that user journeys need to be created or
 * refactored. Combines lexical keyword counting with phrase-pattern matching.
 *
 * Confidence rules:
 * - high: explicit "jornada/journey" OR creation/refactor pattern AND multiple UX signals
 * - medium: creation/refactor pattern OR multiple strong UX signals
 * - low: a few isolated signals
 */
export function detectUserJourneys(text: string): JourneyDetectionResult {
  const lower = text.toLowerCase()
  const signals: string[] = []
  const suggestedJourneys: string[] = []

  for (const [keywords, label] of JOURNEY_KEYWORDS) {
    const found = keywords.some((k) => lower.includes(k.toLowerCase()))
    if (found) signals.push(label)
  }

  let patternMatches = 0
  for (const pattern of JOURNEY_PATTERNS) {
    const matches = lower.match(pattern)
    if (matches) {
      patternMatches += matches.length
      signals.push(`matched pattern: ${matches[0].slice(0, 80)}`)
    }
  }

  // Extract a few concrete journey hints from headings/bullet lines
  const lines = text.split(/\r?\n/)
  for (const line of lines) {
    const lowerLine = line.toLowerCase()
    const isJourneyLine =
      /^(#{1,4}\s+|\s*[-*]\s+)/.test(line) &&
      (lowerLine.includes("jornada") ||
        lowerLine.includes("journey") ||
        lowerLine.includes("fluxo") ||
        lowerLine.includes("flow") ||
        lowerLine.includes("tela") ||
        lowerLine.includes("screen"))
    if (isJourneyLine) {
      const cleaned = line.replace(/^(#{1,4}\s+|\s*[-*]\s+)/, "").trim()
      if (cleaned && cleaned.length > 3 && !suggestedJourneys.includes(cleaned)) {
        suggestedJourneys.push(cleaned)
      }
    }
  }

  const hasExplicitJourney = signals.some((s) =>
    s.toLowerCase().includes("journey") || s.toLowerCase().includes("jornada")
  )
  const hasStrongFlowSignal = signals.some((s) =>
    s.includes("user flow") || s.includes("onboarding") || s.includes("checkout")
  )
  const hasPattern = patternMatches > 0

  let confidence: JourneyWorkshop["confidence"] = "low"
  if (hasExplicitJourney && (hasPattern || signals.length >= 3)) {
    confidence = "high"
  } else if (hasPattern || (hasStrongFlowSignal && signals.length >= 2) || signals.length >= 4) {
    confidence = "medium"
  }

  const hasUserJourneys = confidence === "high" || confidence === "medium" || signals.length >= 2

  return {
    hasUserJourneys,
    confidence,
    signals: signals.slice(0, 12),
    suggestedJourneys: suggestedJourneys.slice(0, 8),
  }
}
