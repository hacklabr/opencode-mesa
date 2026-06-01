# Plugin Mesa (opencode-tabula)

## Stack

- Runtime: Bun
- Linguagem: TypeScript (ESNext, ESM)
- Plugin API: `@opencode-ai/plugin`
- Testes: `vitest`

## Versionamento (INEGOCIÁVEL)

**ANTES de criar qualquer tag git, atualize a versão em TODOS os lugares:**

1. `package.json` → campo `"version"` (fonte principal — o código lê daqui)
2. `CHANGELOG.md` → adicionar seção `## [X.Y.Z] - YYYY-MM-DD` no topo
3. `README.md` → atualizar badge de versão, se existir
4. Qualquer outro arquivo que referencie a versão explicitamente

**Checklist pré-tag:**
```bash
# 1. Atualizar package.json
# 2. Atualizar CHANGELOG.md
# 3. Verificar se README.md tem badge de versão
# 4. Rodar lint + typecheck + testes
~/.bun/bin/bun run lint && ~/.bun/bin/bun run typecheck && ~/.bun/bin/bun test src/__tests__/
# 5. Commit (selecione APENAS os arquivos alterados — NUNCA use git add -A)
git add package.json CHANGELOG.md AGENTS.md && git commit -m "release: vX.Y.Z"
# 6. Tag
git tag vX.Y.Z -m "Mesa vX.Y.Z"
```

**A versão é SEMPRE lida do `package.json`** — `src/config.ts` faz `readFileSync("../package.json")`. Nunca hardcode a versão no código.

## Commits (INEGOCIÁVEL)

- NUNCA commite código que não foi você que criou/alterou. Use `git add -p` (patch mode) para selecionar apenas suas alterações quando o arquivo existir previamente.
- Sempre ao final de uma tarefa: faça commit + tag seguindo **versionamento semântico** (MAJOR.MINOR.PATCH).
- Mensagens de commit em EN, concisas, imperativo presente (ex: `feat: add catalog loader`, `fix: handle missing frontmatter`).
- Commits atômicos: uma tarefa lógica = um commit. Nada de "bagunceiros".
- Rodar `bun run lint` e `bun run typecheck` ANTES de todo commit. Se falhar, não commite.

## Testes

- Todo novo código deve ter testes unitários.
- Fluxos de negócio (briefing → consenso → especificação) devem ter testes de integração.
- Rodar `bun test` antes de todo commit. Se falhar, não commite.

## Código

- Idioma: PT-BR para comunicacao com o usuario, EN para código (variáveis, funções, tipos, comentários).
- Documentação técnica: toda em EN, na pasta `docs/`.
- Interface (strings de tool, mensagens de sistema, outputs): em EN, internacionalizável (i18n). Nunca hardcoded em PT-BR.
- Nenhum comentario desnecessário. Código deve ser auto-explicativo. Comente APENAS o "porquê" quando não óbvio.
- Tipos fortes: `strict: true` no tsconfig. Nenhum `any` sem justificativa explícita em comentário.
- Seguir padrões do ecossistema OpenCode: plugins como funcao que retorna hooks, tools via `tool()` helper.
- Nada de secrets hardcoded. Nunca commitar tokens, API keys ou credenciais.

## Convenções

- Arquivos de tool: um por domínio (`briefing-tools.ts`, `manager-tools.ts`, `discussion-tools.ts`).
- System prompts de agentes: arquivos `.md` em `src/agents/`.
- Estado persistido em JSON simples dentro do workspace (`.mesa/`).
- Nenhum `console.log` em produção. Usar mecanismo de logging do plugin quando disponível.

## Regra Crítica de Edição

NUNCA sobrescrever blocos de código sem verificar o conteúdo COMPLETO do que está sendo substituído.

- O usuário pode ter feito correções manuais não commitadas.
- Preferir múltiplas edições pequenas a uma edição grande.
- Quando em dúvida, perguntar ao usuário antes de sobrescrever.

## Plano de Execução

Ver `.opencode/plans/plano-execucao-plugin-mesa-discussao.md` para o plano completo de fases e tarefas.
