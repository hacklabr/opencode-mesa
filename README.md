# Mesa — OpenCode Plugin

Structured discussion tables with specialized AI agents for OpenCode.

## Overview

Mesa enables a team of AI specialists to discuss, analyze, and produce technical specifications through a structured workflow — eliminating low-quality vibecoding by requiring multi-specialist consensus before implementation.

Each specialist runs as a **real subagent** with its own system prompt, session, and domain expertise. The Gestor orchestrates the team via OpenCode's native `task` tool, ensuring every specialist analyzes from their unique perspective.

## Installation

### Quick install

```bash
curl -fsSL https://raw.githubusercontent.com/hacklabr/opencode-mesa/main/install.sh | bash
```

This clones, builds, generates all agents, and prints the plugin path to add to your `opencode.json`.

### Manual install

```bash
git clone https://github.com/hacklabr/opencode-mesa.git ~/.local/share/opencode-mesa
cd ~/.local/share/opencode-mesa
npm install && npm run build && npm run setup:agents
```

Then add to your project's `opencode.json`:

```json
{
  "plugin": ["file:///home/YOURUSER/.local/share/opencode-mesa/dist/index.js"]
}
```

Restart opencode to load the agents.

### Custom install location

```bash
curl -fsSL https://raw.githubusercontent.com/hacklabr/opencode-mesa/main/install.sh | bash -s -- https://github.com/hacklabr/opencode-mesa /path/to/install
```

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

Each specialist is registered as a hidden subagent in the `mesa/` namespace with `mode: subagent` and their own system prompt. OpenCode automatically injects the specialist's system prompt when invoked — the Gestor must NOT include it in the task prompt. The Gestor invokes them via:

```
task(subagent_type="mesa/engineering-backend-architect", prompt="<task details only>", description="...")
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
| `list_specialists` | Lists available specialists (filter by division/search) |
| `get_specialist` | Gets full details of a specialist by ID |

### Briefing

| Tool | Description |
|------|-------------|
| `create_briefing` | Saves a new briefing document |
| `approve_briefing` | Marks the current briefing as approved |
| `deliver_briefing` | Delivers the approved briefing to the Gestor |

### Gestor (Manager)

| Tool | Description |
|------|-------------|
| `analyze_briefing` | Reads the current briefing for analysis |
| `propose_team` | Proposes a team of specialists with justifications |
| `summon_team` | Summons approved team members |
| `delegate_task` | Defines a task for a specialist (Gestor then invokes via `task`) |
| `define_phases` | Defines the workflow phases |

### Discussion

| Tool | Description |
|------|-------------|
| `open_analysis_round` | Opens a structured analysis round |
| `register_analysis` | Registers a specialist's analysis |
| `request_consensus` | Initiates consensus voting |
| `generate_specification` | Generates the specification document |
| `approve_specification` | Approves or rejects the specification |
| `pause_discussion` | Pauses the current discussion |
| `resume_discussion` | Resumes a paused discussion |
| `cancel_discussion` | Cancels the current discussion |

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
