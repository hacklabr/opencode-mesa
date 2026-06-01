# ADR-004: Embedded Specialist Catalog

**Status**: Accepted
**Date**: 2026-06-01
**Context**: Plugin Mesa v1.0.0

## Context

Mesa's core value is orchestrating diverse AI specialists to analyze a project from multiple perspectives. Each specialist has a persona definition (name, description, division, system prompt). The catalog must be available at runtime for the Manager to discover, select, and invoke specialists.

The specialist definitions come from the [agency-agents](https://github.com/meso-suite/agency-agents) open-source catalog — a community-maintained collection of persona `.md` files organized by division.

## Decision

The agency-agents catalog is bundled directly inside the plugin at `src/catalog/agency-agents/`. Each specialist is a Markdown file with YAML frontmatter (metadata) and body (system prompt).

**Catalog structure:**
```
src/catalog/agency-agents/
├── engineering/
│   ├── engineering-backend-architect.md
│   ├── engineering-frontend-developer.md
│   └── ...
├── design/
│   ├── design-ui-designer.md
│   └── ...
├── product/
│   └── ...
└── (18 divisions, 207 persona files)
```

**Loader** (`src/catalog/loader.ts`):
- `parseFrontmatter()` extracts YAML key-value pairs from `---` delimited blocks.
- `parsePersonaFile()` combines frontmatter metadata with the body (system prompt).
- `loadCatalogFromDirectory()` recursively reads all `.md` files across division subdirectories.

**Caching** (`src/tools/catalog-tools.ts`):
- Personas are loaded once and cached in module-level variables (`cachedPersonas`, `cachedSummary`).
- Subsequent calls to `loadCatalog()` return the cached result without filesystem access.

**Build integration:**
- The build script (`bun run build`) compiles TypeScript and copies the catalog directory to `dist/catalog/agency-agents`.

## Consequences

**Positive:**
- Zero network dependency — the catalog is always available, even offline.
- Fast startup — cached after first load, no filesystem hits for subsequent queries.
- Predictable — catalog contents are version-locked to the plugin release.
- Simple — Markdown files with frontmatter require no database or complex parsing.

**Negative:**
- Plugin package size increases with the catalog (~207 files).
- Catalog updates require a new plugin release — users cannot update specialists independently.
- The custom frontmatter parser is simpler than a full YAML parser but may break with complex YAML (nested objects, multiline strings). This is acceptable because the catalog format is intentionally flat.
- Adding custom specialists (beyond the embedded catalog) is not supported in v1.0. The `source` field (`"embedded" | "custom"`) in the `Persona` type is reserved for future use.
