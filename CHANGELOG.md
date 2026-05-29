# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
