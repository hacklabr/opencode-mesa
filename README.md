# Mesa — OpenCode Plugin

Structured discussion tables with specialized AI agents for OpenCode.

## Overview

This plugin enables a team of AI specialists to discuss, analyze, and produce technical specifications through a structured workflow — eliminating low-quality vibecoding by requiring multi-specialist consensus before implementation.

## Installation

### Local Development

1. Clone this repository
2. Install dependencies: `npm install`
3. Build: `npm run build`
4. Add to your `opencode.json`:

```json
{
  "plugin": [
    "file:///absolute/path/to/opencode-tabula/dist/index.js"
  ]
}
```

### From npm (future)

```json
{
  "plugin": ["opencode-mesa"]
}
```

## Workflow

```
Human → Briefing Writer → Gestor → Specialists → Consensus → Specification → Execution
```

1. **Briefing Writer** conducts structured discovery with the human
2. **Gestor** analyzes the briefing, proposes a team, waits for approval
3. **Specialists** analyze in sequential turns, building on each other's insights
4. **Consensus** — specialists vote (AGREE / AGREE_WITH_RESERVATIONS / DISAGREE)
5. **Specification** — compiled into a Markdown document
6. **Execution** — Gestor delegates implementation tasks

## Agents

Configure in `opencode.json`:

```json
{
  "agent": {
    "briefing-writer": {
      "description": "Briefing Writer - Conducts structured discovery sessions",
      "model": "kimi-k2.6"
    },
    "gestor": {
      "description": "Gestor - Orchestrates specialist teams for discussions",
      "model": "kimi-k2.6"
    }
  },
  "plugin": [
    "file:///path/to/opencode-tabula/dist/index.js"
  ]
}
```

## Available Tools

### General

| Tool | Description |
|------|-------------|
| `mesa_status` | Returns current plugin state, phase, and counts |

### Catalog

| Tool | Description |
|------|-------------|
| `listar_especialistas` | Lists available specialists (filter by division/search) |
| `obter_especialista` | Gets full details of a specialist by ID |

### Briefing

| Tool | Description |
|------|-------------|
| `criar_briefing` | Saves a new briefing document |
| `aprovar_briefing` | Marks the current briefing as approved |
| `entregar_briefing` | Delivers the approved briefing to the Gestor |

### Gestor (Manager)

| Tool | Description |
|------|-------------|
| `analisar_briefing` | Reads the current briefing for analysis |
| `propor_equipe` | Proposes a team of specialists with justifications |
| `convocar_equipe` | Summons approved team members |
| `delegar_tarefa` | Delegates a task directly to a specialist |
| `definir_fases` | Defines the workflow phases |

### Discussion

| Tool | Description |
|------|-------------|
| `abrir_rodada_analise` | Opens a structured analysis round |
| `registrar_analise` | Registers a specialist's analysis |
| `solicitar_consenso` | Initiates consensus voting |
| `gerar_especificacao` | Generates the specification document |
| `aprovar_especificacao` | Approves or rejects the specification |
| `pausar_discussao` | Pauses the current discussion |
| `retomar_discussao` | Resumes a paused discussion |
| `cancelar_discussao` | Cancels the current discussion |

## Specialist Catalog

The plugin includes 144+ specialists from [agency-agents](https://github.com/msitarzewski/agency-agents), organized in 16 divisions:

- academic, design, engineering, finance, game-development
- integrations, marketing, paid-media, product, project-management
- sales, spatial-computing, specialized, strategy, support, testing

## State Persistence

All discussion state is stored in `.mesa/` within the workspace:

```
.mesa/
├── state.json              # Current discussion state
├── briefing-atual.md       # Active briefing
├── briefings/              # Saved briefings
│   └── briefing-{slug}.md
└── especificacoes/         # Generated specifications
    └── spec-{id}.md
```

## Development

```bash
npm install          # Install dependencies
npm run build        # Build the plugin
npm run lint         # Type-check without emitting
npm test             # Run test suite
npm run dev          # Watch mode
```

## License

See [agency-agents](https://github.com/msitarzewski/agency-agents) for specialist catalog license.
