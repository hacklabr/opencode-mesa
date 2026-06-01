# Contributing to Mesa

Thank you for your interest in contributing to Mesa! This guide covers everything you need to set up a development environment and submit quality contributions.

## Prerequisites

- [Bun](https://bun.sh/) runtime (latest stable)
- TypeScript 5+ (installed as devDependency)
- Git

## Development Setup

```bash
# Clone the repository
git clone https://github.com/hacklabr/opencode-mesa.git
cd opencode-mesa

# Install dependencies
bun install

# Build the plugin
bun run build

# Generate specialist subagents from the catalog
bun run setup:agents
```

## Development Commands

| Command | Description |
|---------|-------------|
| `bun install` | Install all dependencies |
| `bun run build` | Compile TypeScript and copy catalog to `dist/` |
| `bun run lint` | Type-check without emitting (alias for `typecheck`) |
| `bun run typecheck` | Type-check without emitting |
| `~/.bun/bin/bun test src/__tests__/` | Run the test suite |
| `bun run dev` | Watch mode for TypeScript compilation |
| `bun run setup:agents` | Generate `.opencode/agents/` from the specialist catalog |

## Running Tests

Tests use [Vitest](https://vitest.dev/) and live in `src/__tests__/`:

```bash
~/.bun/bin/bun test src/__tests__/
```

Test files are organized by domain:

- `state.test.ts` — State persistence, atomic writes, Zod validation, backup recovery
- `catalog.test.ts` — Catalog loader, frontmatter parsing, persona parsing
- `engine.test.ts` — State machine transitions, phase validation
- `integration.test.ts` — Full workflow tests (briefing → consensus → specification → approval)

Every new feature or bug fix must include corresponding tests. Pull requests without tests will not be merged.

## Before Every Commit

Run these checks before committing. If any fail, fix the issue before committing:

```bash
~/.bun/bin/bun run lint        # Type-check
~/.bun/bin/bun run typecheck   # Type-check (same as lint)
~/.bun/bin/bun test src/__tests__/  # Run all tests
```

## Commit Conventions

Mesa follows [Conventional Commits](https://www.conventionalcommits.org/) with these rules:

- **Language**: English only.
- **Tense**: Imperative present (e.g., `feat: add catalog loader`, not `feat: added catalog loader`).
- **Atomic commits**: One logical change per commit. Do not bundle unrelated changes.
- **Format**: `type: description`

**Types:**

| Type | Usage |
|------|-------|
| `feat` | New feature or tool |
| `fix` | Bug fix |
| `refactor` | Code restructuring without behavior change |
| `test` | Adding or updating tests |
| `docs` | Documentation changes |
| `chore` | Build, config, or dependency updates |
| `ci` | CI/CD changes |

**Examples:**

```
feat: add import_briefing tool for external documents
fix: handle missing frontmatter in catalog loader
test: add integration tests for consensus voting
docs: update tool reference with new parameters
```

## Code Style

### TypeScript

- **Strict mode** is enabled (`strict: true` in `tsconfig.json`). No `any` without explicit justification.
- **ESNext modules** — use ESM imports (`import/export`), no `require()`.
- **Self-documenting code** — prefer descriptive names over comments. Comment only the "why" when it is not obvious.
- **No `console.log`** in production code. Use the plugin's logging mechanism when available.
- **No unnecessary comments** — the code should explain itself.

### File Organization

```
src/
├── index.ts              # Plugin entry point (tool registration, hooks)
├── config.ts             # Types, constants, initial state factory
├── state.ts              # State persistence (load, save, atomic writes)
├── audit.ts              # Append-only NDJSON audit logging
├── tools/                # Tool definitions (one file per domain)
│   ├── mesa-tools.ts
│   ├── catalog-tools.ts
│   ├── briefing-tools.ts
│   ├── manager-tools.ts
│   └── discussion-tools.ts
├── workflow/
│   └── transitions.ts    # State machine: phases, transitions, validation
├── catalog/
│   ├── loader.ts         # Catalog parser and loader
│   ├── types.ts          # Catalog type definitions
│   └── agency-agents/    # Embedded specialist catalog (Markdown + frontmatter)
├── agents/               # Agent system prompts (Markdown)
│   ├── briefing-writer.md
│   └── manager.md
├── setup/                # Build/setup utilities
│   ├── generate-agents.js
│   └── add-plugin.cjs
└── __tests__/            # Test files
```

### Naming Conventions

- **External tool names**: `snake_case` English (e.g., `analyze_briefing`, `propose_team`).
- **Internal TypeScript**: `camelCase` (e.g., `analyzeBriefingTool`, `proposeTeamTool`).
- **Tool arguments**: `snake_case` (e.g., `agent_id`, `max_turns`).
- **Files**: `kebab-case` (e.g., `briefing-tools.ts`, `catalog-loader.ts`).

### Language

- **Code**: English for variables, functions, types, and comments.
- **Documentation**: English for all technical documentation (`docs/`, `.architecture/`, code comments).
- **Interface strings**: English for tool descriptions, system prompts, and user-facing output. Designed for i18n — never hardcode in another language.

## Pull Request Guidelines

1. **Create a feature branch** from `main`: `git checkout -b feat/my-feature`
2. **Make atomic commits** following the commit conventions above.
3. **Add tests** for every new feature or bug fix.
4. **Run all checks** before pushing:
   ```bash
   ~/.bun/bin/bun run lint
   ~/.bun/bin/bun run typecheck
   ~/.bun/bin/bun test src/__tests__/
   ```
5. **Push and open a PR** with a clear description of what changed and why.
6. **Ensure CI passes** — lint, typecheck, and tests must all be green.

### PR Checklist

- [ ] Lint passes (`bun run lint`)
- [ ] Type-check passes (`bun run typecheck`)
- [ ] All tests pass (`~/.bun/bin/bun test src/__tests__/`)
- [ ] New code has tests
- [ ] Commits are atomic and follow conventional commit format
- [ ] No `console.log` in production code
- [ ] No `any` types without explicit justification
- [ ] No secrets, tokens, or API keys in the code

## Architecture Decisions

Significant architectural decisions are documented as ADRs (Architecture Decision Records) in `.architecture/adr/`. When making a decision that affects the plugin's architecture:

1. Create a new ADR following the format in `.architecture/README.md`.
2. Include Context, Decision, and Consequences sections.
3. Reference related ADRs when applicable.

## Additional References

- [AGENTS.md](AGENTS.md) — Full project conventions and rules
- [README.md](README.md) — Plugin overview, installation, and usage
- [CHANGELOG.md](CHANGELOG.md) — Version history
- [.architecture/](.architecture/) — Architecture Decision Records

## License

By contributing to Mesa, you agree that your contributions will be licensed under the [MIT License](LICENSE).
