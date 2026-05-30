# Mesa — OpenCode Plugin

Structured discussion tables with specialized AI agents for OpenCode.

## Overview

Mesa enables a team of AI specialists to discuss, analyze, and produce technical specifications through a structured workflow — eliminating low-quality vibecoding by requiring multi-specialist consensus before implementation.

Each specialist runs as a **real subagent** with its own system prompt, session, and domain expertise. The Gestor orchestrates the team via OpenCode's native `task` tool, ensuring every specialist analyzes from their unique perspective.

## Installation

### 1. Build the plugin

```bash
git clone <repo-url> opencode-mesa
cd opencode-mesa
npm install
npm run build
```

### 2. Generate specialist agents

This creates 2 primary agents (briefing-writer, gestor) and 173 specialist subagents in `.opencode/agents/`:

```bash
npm run setup:agents
```

### 3. Configure OpenCode

Add Mesa to your project's `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "file:///absolute/path/to/opencode-mesa/dist/index.js"
  ]
}
```

### 4. Restart OpenCode

The agents are loaded from `.opencode/agents/` at startup. After restarting, switch agents with `Tab` or `/agent`:

- `/agent briefing-writer` — start a discovery session
- `/agent gestor` — orchestrate a specialist team

## Workflow

```
Human → Briefing Writer → Gestor → Specialists → Consensus → Specification → Execution
```

1. **Briefing Writer** conducts structured discovery with the human
2. **Gestor** analyzes the briefing, proposes a team, waits for approval
3. **Specialists** analyze in parallel via the `task` tool, each in their own session with their own system prompt
4. **Consensus** — specialists vote (AGREE / AGREE_WITH_RESERVATIONS / DISAGREE)
5. **Specification** — compiled into a Markdown document
6. **Execution** — Gestor delegates implementation tasks to specialists

## Agents

### Primary Agents

| Agent | Description |
|-------|-------------|
| `briefing-writer` | Conducts structured discovery sessions to produce professional briefings |
| `gestor` | Orchestrates specialist teams for structured discussion and specification |

### Specialist Subagents (hidden, invoked by Gestor)

173 specialists from the [agency-agents](https://github.com/msitarzewski/agency-agents) catalog, organized in 16+ divisions:

- academic, design, engineering, finance, game-development
- integrations, marketing, paid-media, product, project-management
- sales, spatial-computing, specialized, strategy, support, testing

Each specialist is registered as a hidden subagent with `mode: subagent`. The Gestor invokes them via:

```
task(subagent_type="engineering-backend-architect", prompt="...", description="...")
```

To regenerate after catalog changes: `npm run setup:agents`

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
| `delegar_tarefa` | Defines a task for a specialist (Gestor then invokes via `task`) |
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
npm run setup:agents # Generate .opencode/agents/ from catalog
```

## License

See [agency-agents](https://github.com/msitarzewski/agency-agents) for specialist catalog license.
