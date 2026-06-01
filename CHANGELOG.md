# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-06-01

### Added
- **Multi-turn enforcement (Option C Hybrid)**: Code now enforces turn ordering, participant validation, and completeness gates — multi-turn discussions can no longer be skipped
- **participants[] in state**: Participants are now persisted in discussion state, enabling accurate progress tracking and validation
- **Completeness gate on consensus**: `request_consensus` blocks if any participant hasn't completed all turns
- **Agent ID suffix matching**: Subagents returning partial IDs (e.g., `ux-researcher` vs `design-ux-researcher`) are now correctly matched
- **Rich phase headers**: `formatPhaseHeader` now shows topic, turn progress, and analysis count when context is available
- **Content preview in register_analysis**: Tool responses now include a 300-char analysis preview for human observability
- **Next-step hints**: `register_analysis` responses guide the Manager on what to do next
- **Soft ordering warnings**: Advisory note when specialists register out of the suggested order
- **Debate round state tracking**: `debateNeeded` flag set when consensus fails with disagreements
- **Enhanced Manager prompt**: Turn 2+ quality guidelines (convergence signaling, depth-over-breadth, synthesis narration, voice markers, turn summary templates)
- **13 new tests** covering all validation gates (106 total, 0 failures)

### Fixed
- **BUG-01**: `currentTurn` was a dead field — turn progression now derived from analyses
- **BUG-02**: `maxTurns` was never enforced — turn overflow now rejected
- **BUG-03**: Participants were ephemeral — now persisted in state
- **BUG-04**: No completeness gate on consensus — now blocks incomplete rounds
- **BUG-05**: Non-participants could register analyses and votes — now validated
- **BUG-06**: Atomic save could corrupt state with aggressive `.tmp` cleanup — now only cleans stale files (>60s)
- **BUG-08**: `open_analysis_round` accepted unknown participants — now validates against team
- **BUG-09**: `generate_specification` did phantom double-transition — now clean sequential transitions
- **BUG-10**: `force=true` destroyed data with no audit trail — now logged
- **BUG-11**: Debate round had zero state representation — `debateNeeded` flag added
- **BUG-12**: Orphan `briefing-for-discussion.md` never cleaned up — now removed on new round
- **BUG-13**: Agent ID mismatch between task invocation and register_analysis — suffix matching added
- **BUG-15**: Progress counter showed nonsensical numbers — now uses participants[]

## [1.0.3] - 2026-06-01

### Fixed
- Manager prompt now explicitly instructs multi-turn analysis (turn 2 = peer review with cross-pollination)
- Added mandatory deliberation round before consensus — specialists must explain their thinking
- Consensus votes must include substantive reasoning, not just "I agree"

## [1.0.2] - 2026-06-01

### Fixed
- PLUGIN_VERSION now reads from package.json instead of hardcoded value
- Version mismatch between package.json and runtime status display

## [1.0.0] - 2026-06-01

### Added
- Professional README.md with 3 Mermaid diagrams (workflow, architecture, state machine)
- Complete tool parameter reference for all 21 tools
- CONTRIBUTING.md with development guidelines
- 10 Architecture Decision Records (ADRs) in .architecture/adr/
- Troubleshooting guide in docs/troubleshooting.md
- Workflow reference in docs/workflow.md
- Architecture reference in docs/architecture.md
- Unit tests for all tool execute() functions (94 tests total)
- src/workflow/transitions.ts — extracted state machine as single source of truth
- src/types.ts — centralized type definitions
- src/errors.ts — typed error classes (MesaError, PhaseError, StateError, ValidationError, CatalogError)
- src/utils/responses.ts — standardized tool response helpers with ok/error pattern
- src/utils/slug.ts — shared slug validation
- .bak auto-recovery in loadState for corrupted state files
- Deduplication in register_analysis and request_consensus
- Phase context header in all tool responses
- Handoff instructions in deliver_briefing output
- Catalog fallback in delegate_task (allows ad-hoc specialists in EXECUTION)
- CANCELLED → PLANNING restart capability
- Force parameter on open_analysis_round to prevent accidental data loss
- Pagination and markdown formatting in list_specialists output
- Human-readable summary in mesa_status output
- Atomic backup using rename() in saveState
- .tmp cleanup on startup
- Briefing content validation (rejects empty content)
- stateVersion migration check

### Changed
- Renamed "Gestor" to "Manager" across all files, agents, and user-facing strings
- Renamed gestor-tools.ts → manager-tools.ts
- Renamed gestor.md → manager.md (agent prompt)
- Renamed "especificacoes/" → "specifications/" directory
- Renamed "briefing-atual.md" → "briefing-current.md"
- Fixed definePhasesTool to actually save phase configuration
- Fixed generate_specification double-transition atomicity
- Replaced dynamic fs import with static import in manager-tools.ts
- Fixed audit.ts import extension (.js → extensionless)
- Split config.ts into config.ts (constants) + types.ts (types)
- Replaced non-null assertion with proper null check in catalog-tools.ts

### Fixed
- definePhasesTool was a no-op — now properly saves custom phases
- Specification state not reset when opening new analysis round
- mesa_status had no error handling
- Unsafe type casts in resume_discussion and request_consensus
- Duplicate analysis/vote registration (dedup added)
- State file corruption (now auto-recovers from .bak)

## [0.6.0] - 2026-05-29

### Added
- Integration tests for full workflow (briefing → consensus → specification → approval)
- Tests for pause/resume, cancel, specification rejection, and state recovery

## [0.5.0] - 2026-05-29

### Added
- System prompt injection via `experimental.chat.system.transform` hook
- Agent prompt loader utility with caching
- Agent-to-prompt mapping for `briefing-writer` and `gestor` agents

## [0.4.0] - 2026-05-29

### Added
- Gestor tools: `analisar_briefing`, `propor_equipe`, `convocar_equipe`, `delegar_tarefa`, `definir_fases`
- Discussion engine with 5-phase state machine (PLANNING → ANALYSIS → CONSENSUS → DOCUMENTATION → APPROVAL → EXECUTION)
- Discussion tools: `abrir_rodada_analise`, `registrar_analise`, `solicitar_consenso`, `gerar_especificacao`, `aprovar_especificacao`, `pausar_discussao`, `retomar_discussao`, `cancelar_discussao`
- State machine transition validation tests

## [0.3.0] - 2026-05-29

### Added
- Specialist catalog loader with YAML frontmatter parser
- 144+ specialists from agency-agents catalog (embedded)
- Catalog tools: `listar_especialistas`, `obter_especialista`
- Briefing tools: `criar_briefing`, `aprovar_briefing`, `entregar_briefing`
- Agent system prompts: `briefing-writer.md`, `gestor.md`
- Catalog parser tests (7 tests)

## [0.2.0] - 2026-05-29

### Added
- Plugin foundation with TypeScript (strict mode, ESNext, ESM)
- Core types and state management (`config.ts`, `state.ts`)
- Health-check tool (`mesa_status`)
- State persistence tests (6 tests)
- Vitest configuration with `refs/` exclusion

## [0.1.0] - 2026-05-29

### Added
- Project AGENTS.md with coding conventions and commit rules
- Execution plan document (`.opencode/plans/`)
