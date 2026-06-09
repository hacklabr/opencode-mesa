/**
 * Generates 4 targeted mini-briefing questions for a phase analysis round.
 * Questions are adapted based on the phase name and master spec context.
 */
export function build_mini_briefing_questions(phaseName: string, _masterSpecContext: string): string[] {
  const normalized = phaseName.toLowerCase().trim()

  // Keyword-based question templates
  const hasKeyword = (kw: string): boolean => normalized.includes(kw)

  const isInfra = hasKeyword("infra") || hasKeyword("deploy") || hasKeyword("docker") || hasKeyword("k8s") || hasKeyword("kubernetes")
  const isData = hasKeyword("data") || hasKeyword("database") || hasKeyword("migration") || hasKeyword("schema")
  const isApi = hasKeyword("api") || hasKeyword("endpoint") || hasKeyword("rest") || hasKeyword("grpc")
  const isUi = hasKeyword("ui") || hasKeyword("frontend") || hasKeyword("design") || hasKeyword("component")
  const isTest = hasKeyword("test") || hasKeyword("qa") || hasKeyword("quality") || hasKeyword("validation")
  const isSecurity = hasKeyword("security") || hasKeyword("auth") || hasKeyword("audit") || hasKeyword("compliance")
  const isIntegration = hasKeyword("integration") || hasKeyword("migrate") || hasKeyword("refactor") || hasKeyword("extract")

  const q1 = isInfra
    ? `What infrastructure constraints (cloud provider, region, cost limits) must ${phaseName} respect?`
    : isData
      ? `What data integrity risks or rollback requirements apply to ${phaseName}?`
      : isApi
        ? `What backward-compatibility or versioning requirements must ${phaseName} maintain?`
        : isUi
          ? `What accessibility, responsive, or design-system constraints apply to ${phaseName}?`
          : isTest
            ? `What coverage thresholds or test environments are required for ${phaseName}?`
            : isSecurity
              ? `What compliance standards (OWASP, GDPR, SOC2) must ${phaseName} satisfy?`
              : isIntegration
                ? `What existing systems does ${phaseName} touch, and what are their failure modes?`
                : `What are the exact boundaries of ${phaseName}? What should be explicitly excluded?`

  const q2 = isInfra
    ? `Which services need monitoring, alerting, or auto-scaling as part of ${phaseName}?`
    : isData
      ? `How will ${phaseName} handle large datasets or concurrent writes?`
      : isApi
        ? `What rate-limiting, caching, or authentication patterns apply to ${phaseName}?`
        : isUi
          ? `What browser or device support matrix must ${phaseName} cover?`
          : isTest
            ? `Which critical user journeys must be covered by tests in ${phaseName}?`
            : isSecurity
              ? `What secrets management or encryption requirements apply to ${phaseName}?`
              : isIntegration
                ? `What is the rollback strategy if ${phaseName} causes regressions?`
                : `What external dependencies or integration points could derail ${phaseName}?`

  const q3 = isInfra
    ? `Are there any secrets, certificates, or IAM policies that ${phaseName} depends on?`
    : isData
      ? `Are there any schema versioning or migration tooling constraints for ${phaseName}?`
      : isApi
        ? `What observability (logging, tracing, metrics) must ${phaseName} implement?`
        : isUi
          ? `What state management or performance budgets apply to ${phaseName}?`
          : isTest
            ? `What mocking or stubbing strategy should ${phaseName} use for external services?`
            : isSecurity
              ? `What input validation or sanitization rules are critical for ${phaseName}?`
              : isIntegration
                ? `What contract tests or compatibility gates must ${phaseName} pass?`
                : `Are there hard technical constraints (performance, compatibility, compliance) specific to ${phaseName}?`

  const q4 = `What does "done" look like for ${phaseName}? What are the acceptance criteria and how will success be validated?`

  return [q1, q2, q3, q4]
}
