# Architecture Reference

Technical architecture of the Mesa plugin — components, data flow, and design decisions.

## Component Overview

```mermaid
graph TB
    subgraph "OpenCode Host"
        User[User]
        Agents[Agent Sessions\nbriefing-writer · manager]
        TaskTool[task tool\nnative]
        SubAgents["Specialist Subagents\nmesa/* namespace"]
    end

    subgraph "Mesa Plugin"
        Tools["21 Tools\nbriefing · manager · discussion\ncatalog · status"]
        State["State Layer\nstate.ts · audit.ts"]
        Catalog["Catalog\nloader.ts · 173 specialists"]
        Hook["System Prompt Hook\ninjects Mesa context"]
    end

    subgraph "Workspace (.mesa/)"
        StateFile[state.json]
        Briefings[briefings/]
        Specs[specifications/]
        AuditFile[audit.log]
    end

    Tools --> State --> StateFile
    Tools --> Catalog
    Hook --> Agents
    Agents --> Tools
    Agents --> TaskTool --> SubAgents
```

## Module Descriptions

### Tools (`src/tools/`)

Five tool modules, each registering tools via the `tool()` helper from `@opencode-ai/plugin`:

| Module | Tools | Purpose |
|--------|-------|---------|
| `mesa-tools.ts` | `mesa_status` | Plugin health and state summary |
| `catalog-tools.ts` | `list_specialists`, `get_specialist` | Browse and retrieve specialist profiles |
| `briefing-tools.ts` | `create_briefing`, `approve_briefing`, `deliver_briefing`, `import_briefing` | Briefing lifecycle management |
| `manager-tools.ts` | `analyze_briefing`, `propose_team`, `summon_team`, `delegate_task`, `define_phases` | Team assembly and task delegation |
| `discussion-tools.ts` | `open_analysis_round`, `register_analysis`, `request_consensus`, `generate_specification`, `approve_specification`, `pause_discussion`, `resume_discussion`, `cancel_discussion` | Structured discussion workflow |

### State (`src/state.ts`, `src/audit.ts`)

**State management** follows a strict load → mutate → save pattern:

1. **Load**: `loadState()` reads `.mesa/state.json`. If corrupted, falls back to `.mesa/state.json.bak`. If neither exists, returns initial state.
2. **Mutate**: The tool handler modifies the state object in memory.
3. **Save**: `saveState()` writes to `.mesa/state.json.tmp`, then atomically renames to `.mesa/state.json`. The previous file is preserved as `.mesa/state.json.bak`.

**Atomic writes** ensure no data loss on crash:
- Write to `.tmp` file
- `rename()` (atomic on POSIX) to final path
- Previous state preserved as `.bak`

**Audit trail**: Every significant action (briefing approved, team summoned, analysis registered, etc.) is appended to `.mesa/audit.log` with a timestamp.

**Schema versioning**: State includes a `stateVersion` field. Future migrations check this field and apply transformations as needed.

### Catalog (`src/catalog/`)

The specialist catalog is loaded from embedded YAML files in `src/catalog/agency-agents/`:

1. **Loader** (`loader.ts`): Reads all `.md` files from the catalog directory, parses YAML frontmatter (delimited by `---`), and extracts specialist metadata (name, description, division, system prompt).
2. **Frontmatter parser**: Simple regex-based parser that extracts YAML key-value pairs between `---` delimiters.
3. **Caching**: The catalog is loaded once and cached in memory for the plugin's lifetime. Subsequent `list_specialists` and `get_specialist` calls read from cache.

Each specialist has:
- `id`: URL-friendly identifier (e.g. `engineering-backend-architect`)
- `name`: Display name
- `description`: Short description
- `division`: Organizational division (e.g. `engineering`, `product`, `design`)
- `systemPrompt`: Full system prompt text (from the body of the `.md` file)

### Workflow (`src/workflow/`)

The state machine is the single source of truth for phase transitions:

- **`transitions.ts`**: Defines the valid transitions map — `{ from_phase: [valid_target_phases] }`. Every tool that transitions state validates against this map.
- Tools call `validateTransition(from, to)` before any state change. Invalid transitions throw a `PhaseError` with a descriptive message.

### Errors (`src/errors.ts`)

Typed error classes for consistent error handling:

| Class | Use |
|-------|-----|
| `MesaError` | Base class for all Mesa errors |
| `PhaseError` | Invalid phase transition or wrong-phase tool call |
| `StateError` | State file corruption, missing state |
| `ValidationError` | Invalid tool parameters |
| `CatalogError` | Specialist not found, catalog load failure |

### Types (`src/types.ts`)

Centralized type definitions used across all modules:

- `MesaPhase` — union type of all valid phases
- `MesaState` — full state object shape
- `TeamProposal`, `Specialist` — team-related types
- `AnalysisEntry`, `VoteEntry` — discussion types
- `ToolResponse` — standardized `{ ok: boolean, data/error }` pattern

### Utilities (`src/utils/`)

- **`responses.ts`**: Standardized tool response helpers (`ok(data)`, `error(message)`) that wrap responses in a consistent format with a phase context header.
- **`slug.ts`**: Shared slug validation regex (lowercase, numbers, hyphens only).

## How Tools Are Registered

The plugin entry point (`src/index.ts`) exports a function that returns a plugin definition:

```typescript
import { tool } from "@opencode-ai/plugin"

export default function mesaPlugin() {
  return {
    name: "mesa",
    tools: [
      tool({ name: "mesa_status", ... }),
      tool({ name: "create_briefing", ... }),
      // ... 19 more tools
    ],
    hooks: {
      "experimental.chat.system.transform": systemPromptHook,
    },
  }
}
```

Each `tool()` call defines:
- `name`: Tool identifier (used by agents)
- `description`: What the tool does (shown to the AI)
- `parameters`: Zod schema for parameter validation
- `execute`: Handler function that implements the tool logic

## How State Is Managed

Every tool follows the same pattern:

```
1. loadState()           → Read .mesa/state.json (with .bak recovery)
2. Validate phase        → Ensure tool is called in the right phase
3. Validate parameters   → Zod handles this at the tool boundary
4. Mutate state          → Update in-memory state object
5. saveState()           → Atomic write (tmp → rename → bak rotation)
6. audit()               → Append action to audit.log
7. Return response       → ok(data) or error(message) with phase header
```

## How Specialists Are Loaded

1. At plugin startup, `loadCatalog()` reads all `.md` files from the bundled `src/catalog/agency-agents/` directory.
2. Each file is parsed for YAML frontmatter (metadata) and body (system prompt).
3. The parsed specialists are stored in an in-memory `Map<string, Specialist>`.
4. `list_specialists` filters and paginates the cached catalog.
5. `get_specialist` retrieves a single specialist by ID.

Specialist subagents are registered separately via `bun run setup:agents`, which generates `.opencode/agents/mesa-*.md` files — one per specialist. OpenCode loads these as hidden subagents in the `mesa/` namespace.
