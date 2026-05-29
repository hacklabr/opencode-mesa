# Plano de Execucao: Plugin Mesa de Discussao para OpenCode

## 1. Visao Geral da Abordagem

O plugin sera desenvolvido como **plugin nativo do OpenCode** (Node.js/TypeScript), seguindo a arquitetura de hooks e tools documentada em `@opencode-ai/plugin`. O prototipo Go (tabla-go) serve como referencia funcional de fluxo, mas a arquitetura final sera inteiramente baseada nos padroes do ecossistema OpenCode.

### Principios Arquiteturais

- **Nao reinventar ferramentas**: Usar APIs nativas do OpenCode (file system via `Bun.file`/`Bun.write`, terminal via `PluginInput.$`, MCPs via agentes nativos).
- **Agentes via system prompts**: Os agentes (Briefing Writer, Gestor, Especialistas) serao definidos como perfis de agente do OpenCode (arquivos `.md` em `.opencode/agent/` ou config em `opencode.json`), nao como entidades code-heavy.
- **Orquestracao via tools**: O plugin registrara tools que o Gestor invoca para abrir rodadas, solicitar consenso, gerar especificacao e delegar tarefas.
- **Estado em arquivo**: O estado da discussao sera persistido em arquivos JSON no workspace (`mesa-de-discussao/state.json`), nao em banco de dados, para manter simplicidade e transparencia.
- **Aprovacao humana via tool context**: As aprovacoes obrigatorias serao implementadas via `context.ask()` dentro das tools de transicao de fase.

---

## 2. Estrutura de Diretorios do Plugin

```
opencode-tabula/
├── package.json
├── tsconfig.json
├── src/
│   ├── index.ts                    # Entry point: exporta o Plugin
│   ├── plugin.ts                   # Funcao principal do plugin, registra hooks
│   ├── config.ts                   # Tipos e defaults de configuracao
│   ├── state.ts                    # Gerenciamento de estado (JSON no workspace)
│   ├── catalog/
│   │   ├── loader.ts               # Carrega especialistas do agency-agents
│   │   ├── types.ts                # Tipos: Persona, Especialista, Divisao
│   │   └── agency-agents/          # Git submodule com os especialistas
│   ├── agents/
│   │   ├── briefing-writer.md      # System prompt do Briefing Writer
│   │   ├── gestor.md               # System prompt do Gestor (Gerente)
│   │   └── especialista-base.md    # System prompt base para especialistas
│   ├── tools/
│   │   ├── briefing-tools.ts       # Tools do Briefing Writer
│   │   ├── gestor-tools.ts         # Tools do Gestor (orquestracao)
│   │   └── discussion-tools.ts     # Tools da mesa de discussao
│   ├── discussion/
│   │   ├── engine.ts               # Maquina de estados da discussao
│   │   ├── analysis.ts             # Logica de rodadas de analise
│   │   ├── consensus.ts            # Logica de votacao e debate
│   │   ├── specification.ts        # Geracao do documento de especificacao
│   │   └── delegation.ts           # Delegacao direta de tarefas
│   └── utils/
│       ├── prompts.ts              # Helpers de construcao de prompts
│       └── files.ts                # Helpers de I/O de arquivo
├── skills/
│   └── mesa-discussao/             # Skill para uso via opencode skill system
│       └── SKILL.md
├── docs/
│   └── PLANO_EXECUCAO.md           # Este documento
└── dist/                           # Output de build (gerado)
```

---

## 3. Fases de Implementacao

### Fase 1: Fundacao e Setup do Plugin

**Objetivo**: Ter a estrutura base do plugin compilando e carregavel pelo OpenCode.

| ID | Tarefa | Descricao | Criterio de Aceitacao |
|---|---|---|---|
| F1-T1 | Inicializar projeto Node.js/Bun | Criar `package.json` com `type: "module"`, dependencia `@opencode-ai/plugin`, TypeScript, configurar scripts `build` e `lint`. | `bun install` funciona; `bun run build` gera `dist/index.js`. |
| F1-T2 | Configurar TypeScript | Criar `tsconfig.json` com `target: "ESNext"`, `module: "ESNext"`, `moduleResolution: "bundler"`, `strict: true`. | Build sem erros de tipo. |
| F1-T3 | Criar entry point do plugin | Implementar `src/index.ts` exportando a funcao `Plugin` conforme contrato `@opencode-ai/plugin`. | Plugin e detectado pelo OpenCode (`opencode.json` com `plugin: ["file:///..."]`). |
| F1-T4 | Implementar hook `config` | Registrar a skill embutida via hook `config`, apontando para `skills/mesa-discussao/SKILL.md`. | Skill aparece na lista de skills do OpenCode. |
| F1-T5 | Implementar hook `tool` de health-check | Criar tool `mesa_status` que retorna versao e estado do plugin. | Tool executa e retorna JSON valido. |
| F1-T6 | Configurar ambiente de desenvolvimento | Criar `opencode.jsonc` local apontando para o plugin em desenvolvimento, adicionar ao `.gitignore`. | Desenvolvedor pode testar o plugin localmente com `opencode`. |

**Entregavel**: Plugin estrutural funcional, carregavel, com um health-check tool operacional.

---

### Fase 2: Catalogo de Especialistas (agency-agents)

**Objetivo**: Integrar o catalogo agency-agents como referencia embutida de especialistas disponiveis.

| ID | Tarefa | Descricao | Criterio de Aceitacao |
|---|---|---|---|
| F2-T1 | Adicionar agency-agents como submodule | `git submodule add https://github.com/msitarzewski/agency-agents.git src/catalog/agency-agents/`. | Pasta clonada com as divisoes e personas. |
| F2-T2 | Implementar parser de personas | Criar `src/catalog/loader.ts` que le arquivos `.md` com YAML frontmatter (`name`, `description`, `emoji`, etc.) e extrai `systemPrompt` do corpo. | Parser consegue ler todas as personas do catalogo sem erros. |
| F2-T3 | Definir tipos do catalogo | Criar `src/catalog/types.ts` com interfaces `Persona`, `Division`, `CatalogEntry`. | Tipos cobrem todos os campos do YAML frontmatter. |
| F2-T4 | Implementar tool `listar_especialistas` | Tool que lista todas as personas disponiveis, com filtros opcionais por divisao e busca por texto. | Retorna array JSON com id, nome, divisao, descricao. |
| F2-T5 | Implementar tool `obter_especialista` | Tool que retorna detalhes completos de uma persona por ID. | Retorna YAML frontmatter + system prompt. |
| F2-T6 | Criar cache em memoria | Cachear o catalogo em memoria no startup do plugin para evitar re-leitura a cada tool call. | Tool calls subsequentes usam cache; reload via `recarregar_catalogo`. |

**Entregavel**: Catalogo de 144+ especialistas carregavel via tools, com parser robusto de YAML frontmatter.

---

### Fase 3: Agente Briefing Writer

**Objetivo**: Implementar o agente Briefing Writer com fluxo de descoberta estruturada.

| ID | Tarefa | Descricao | Criterio de Aceitacao |
|---|---|---|---|
| F3-T1 | Criar system prompt do Briefing Writer | Em `src/agents/briefing-writer.md`, definir o persona do Briefing Writer com a metodologia de 5 passos (Discovery, Write, Approve, Save, Deliver). | Prompt injetado via `experimental.chat.system.transform` quando agente for identificado como `briefing-writer`. |
| F3-T2 | Implementar tool `criar_briefing` | Tool que salva um briefing aprovado em `mesa-de-discussao/briefings/{slug}.md` com frontmatter padronizado (titulo, data, status, autor). | Arquivo criado com conteudo e frontmatter corretos. |
| F3-T3 | Implementar tool `aprovar_briefing` | Tool que marca o briefing como `status: aprovado` no frontmatter e notifica o Gestor. | Status atualizado; notificacao enviada ao canal do Gestor. |
| F3-T4 | Implementar tool `entregar_briefing_ao_gestor` | Tool que copia o briefing aprovado para `mesa-de-discussao/briefing-atual.md` e registra no estado que a fase mudou para `PLANEJAMENTO`. | Estado atualizado; Gestor tem acesso ao briefing. |
| F3-T5 | Implementar hook de injecao de prompt | Usar `experimental.chat.system.transform` para injetar o prompt do Briefing Writer quando `input.agent === "briefing-writer"`. | Prompt injetado em todas as mensagens do agente. |
| F3-T6 | Validar fluxo de descoberta | Testar manualmente o fluxo completo: iniciar conversa com Briefing Writer, responder perguntas, aprovar briefing, entregar ao Gestor. | Briefing gerado, aprovado e entregue sem erros. |

**Entregavel**: Briefing Writer funcional, capaz de conduzir descoberta e produzir briefings aprovados entregues ao Gestor.

---

### Fase 4: Agente Gestor (Gerente)

**Objetivo**: Implementar o Gestor com capacidade de analisar briefings, propor equipe e solicitar aprovacoes.

| ID | Tarefa | Descricao | Criterio de Aceitacao |
|---|---|---|---|
| F4-T1 | Criar system prompt do Gestor | Em `src/agents/gestor.md`, definir o persona do Gestor como "Chief of Staff AI" — nao-tecnico, orquestrador, proibido de escrever/revisar codigo. | Prompt injetado via `experimental.chat.system.transform` quando `input.agent === "gestor"`. |
| F4-T2 | Implementar tool `analisar_briefing` | Tool que le o briefing atual e produz um resumo estruturado com escopo, objetivos, criterios de sucesso. | Retorna JSON com analise estruturada. |
| F4-T3 | Implementar tool `propor_equipe` | Tool que recebe array de IDs de especialistas e justificativas, salva proposta em `mesa-de-discussao/proposta-equipe.json`. | Proposta salva com campos: especialistas, justificativas, timestamp. |
| F4-T4 | Implementar tool `convocar_equipe` | Tool que, apos aprovacao humana, marca os especialistas como convocados no estado e cria sessoes individuais para cada um via `client.session.create()`. | Estado atualizado; sessoes criadas; especialistas "online". |
| F4-T5 | Implementar tool `delegar_tarefa` | Tool que permite ao Gestor enviar uma instrucao direta a um especialista especifico sem abrir rodada formal. | Mensagem enviada ao especialista; resposta registrada. |
| F4-T6 | Implementar aprovacao humana para equipe | Usar `context.ask()` dentro de `convocar_equipe` para exibir proposta e exigir confirmacao explicita. | Humano pode aprovar ou rejeitar; rejeicao cancela convocacao. |
| F4-T7 | Implementar tool `definir_fases` | Tool que define as fases do workflow no estado (`PLANEJAMENTO`, `ANALISE`, `CONSENSO`, `DOCUMENTACAO`, `APROVACAO`, `EXECUCAO`). | Estado com fases definidas; transicoes controladas. |

**Entregavel**: Gestor funcional capaz de receber briefing, propor equipe (com aprovacao humana obrigatoria) e convocar especialistas.

---

### Fase 5: Mesa de Discussao Estruturada

**Objetivo**: Implementar o coracao do plugin — rodadas de analise, consenso e geracao de especificacao.

| ID | Tarefa | Descricao | Criterio de Aceitacao |
|---|---|---|---|
| F5-T1 | Implementar maquina de estados | Em `src/discussion/engine.ts`, criar state machine com as 5 fases (ANALISE, CONSENSO, DOCUMENTACAO, APROVACAO, EXECUCAO) e transicoes validas. | Transicoes invalidas rejeitadas; estado sempre consistente. |
| F5-T2 | Implementar tool `abrir_rodada_analise` | Tool do Gestor que inicia a fase ANALISE. Recebe: tema, participantes (ordem), max_turns, briefing_content. Salva no estado. | Estado muda para `ANALISE`; rodada registrada. |
| F5-T3 | Implementar execucao sequencial de turnos | Para cada turno, o Gestor delega sequencialmente a cada especialista via `client.session.prompt()`. Especialista recebe: briefing + analises anteriores + prompt especifico do turno. | Especialistas executam um por vez, na ordem definida. |
| F5-T4 | Implementar diferenciacao de turnos | Turno 1: prompt de analise completa. Turno 2+: prompt que proibe repeticao e exige aprofundamento/resposta a colegas. | Conteudo dos turnos diferenciados e contextualizados. |
| F5-T5 | Implementar tool `registrar_analise` | Tool chamada por cada especialista ao final de sua analise. Persiste a mensagem no estado. | Analise salva com agent_id, conteudo, timestamp, turno. |
| F5-T6 | Implementar notificacoes de progresso | Apos cada analise e ao final de cada turno, emitir evento (ou salvar no estado) para que o Gestor acompanhe progresso. | Gestor tem visibilidade do progresso (X/Y do turno Z/N). |
| F5-T7 | Implementar auto-trigger do Gestor | Ao final da fase ANALISE (todas as analises concluidas), o plugin automaticamente envia mensagem ao Gestor solicitando `solicitar_consenso`. | Gestor e notificado automaticamente para prosseguir. |
| F5-T8 | Implementar tool `solicitar_consenso` | Tool que inicia a fase CONSENSO. Envia prompt de votacao a todos os especialistas em paralelo via `client.session.prompt()`. | Votacao iniciada; estado muda para `CONSENSO`. |
| F5-T9 | Implementar votacao | Especialistas votam: `AGREE` (1), `AGREE_WITH_RESERVATIONS` (2), `DISAGREE` (0). Votos persistidos no estado. | Votos registrados com agent_id, voto, justificativa. |
| F5-T10 | Implementar logica de consenso | Se unanimidade (todos 1 ou 2): consenso atingido. Se discordancias: abrir rodada de debate (Turno 2) com agentes discordantes, depois revotacao. | Logica de consenso e debate implementada. |
| F5-T11 | Implementar tool `gerar_especificacao` | Tool que inicia DOCUMENTACAO. Cada especialista recebe prompt para escrever sua secao da especificacao. Secoes compiladas em um unico documento Markdown. | Documento Markdown gerado e salvo em `mesa-de-discussao/especificacoes/spec-{id}.md`. |
| F5-T12 | Implementar tool `aprovar_especificacao` | Tool que marca especificacao como aprovada (ou rejeitada). Se aprovada, estado muda para `EXECUCAO`. Se rejeitada, volta para `DOCUMENTACAO`. | Aprovacao com `context.ask()`; transicao de estado correta. |

**Entregavel**: Fluxo completo de mesa de discussao operacional, desde abertura de rodada ate especificacao aprovada.

---

### Fase 6: Integracao e Fluxo End-to-End

**Objetivo**: Garantir que todas as fases se conectem corretamente e que o fluxo completo funcione sem gaps.

| ID | Tarefa | Descricao | Criterio de Aceitacao |
|---|---|---|---|
| F6-T1 | Implementar avanco automatico configuravel | No briefing, permitir configurar `avanco_automatico: ["equipe", "especificacao"]` para pular aprovacoes manuais nas etapas indicadas. | Configuracao respeitada; etapas pulam `context.ask()` quando configurado. |
| F6-T2 | Implementar hook `event` para lifecycle | Escutar eventos `session.idle`, `message.updated` para detectar quando especialistas terminam suas tarefas e acionar proximos passos. | Eventos capturados e acionam transicoes corretamente. |
| F6-T3 | Implementar persistencia de estado robusta | Estado salvo em `mesa-de-discussao/state.json` a cada transicao. Funcao de recovery que reconstrói a maquina de estados a partir do arquivo. | Estado recuperavel apos reinicio do OpenCode. |
| F6-T4 | Implementar tool `pausar_discussao` / `retomar_discussao` / `cancelar_discussao` | Tools para controle de fluxo da discussao a qualquer momento. | Estado muda para `PAUSADA`, `EM_ANDAMENTO`, ou e limpo no cancelamento. |
| F6-T5 | Integrar com file system nativo | Todas as operacoes de leitura/escrita devem usar `Bun.file`/`Bun.write` ou `node:fs/promises`. Nenhuma reimplementacao de I/O. | Codigo auditado: zero reimplementacoes de I/O. |
| F6-T6 | Integrar com terminal nativo | Comandos de terminal (ex: verificar existencia de arquivo, listar diretorios) devem usar `PluginInput.$`. | Terminal nativo usado onde aplicavel. |
| F6-T7 | Testar fluxo completo manualmente | Executar o fluxo ponta a ponta: Briefing Writer -> Gestor -> Especialistas -> Consenso -> Especificacao -> Aprovacao. | Fluxo completo executa sem erros bloqueantes. |
| F6-T8 | Tratamento de erros e retry | Implementar retry com backoff para falhas de LLM, timeout de especialistas, e fallback para o Gestor quando um especialista falha. | Falhas sao tratadas gracefulmente; Gestor e notificado. |

**Entregavel**: Plugin integrado, com fluxo end-to-end testado, persistencia robusta e tratamento de erros.

---

### Fase 7: Testes e Qualidade

**Objetivo**: Garantir qualidade, confiabilidade e cobertura de testes.

| ID | Tarefa | Descricao | Criterio de Aceitacao |
|---|---|---|---|
| F7-T1 | Configurar framework de testes | Adicionar `bun:test` (ou vitest) ao projeto, configurar scripts `test` e `test:watch`. | `bun test` executa sem erros. |
| F7-T2 | Testes unitarios do parser de catalogo | Testar `src/catalog/loader.ts` com arquivos de exemplo (YAML valido, invalido, frontmatter incompleto). | Parser coberto; edge cases tratados. |
| F7-T3 | Testes unitarios da maquina de estados | Testar todas as transicoes validas e invalidas do `src/discussion/engine.ts`. | 100% de cobertura das transicoes de fase. |
| F7-T4 | Testes unitarios de tools | Testar tools criticas (criar_briefing, abrir_rodada_analise, solicitar_consenso) com mocks de contexto e filesystem. | Tools testadas isoladamente. |
| F7-T5 | Testes de integracao do fluxo | Testar o fluxo completo com mocks de LLM/respostas de especialistas. | Fluxo end-to-end testavel automaticamente. |
| F7-T6 | Validacao de tipos | `bun run lint` (tsc --noEmit) passa sem erros. | Zero erros de TypeScript. |
| F7-T7 | Auditoria de seguranca | Verificar que nenhuma tool expoe secrets, faz eval, ou executa input nao sanitizado. | Checklist de seguranca passa (OWASP Top 10 para plugins). |

**Entregavel**: Suite de testes automatizados, cobertura de fluxo critico, zero erros de tipo.

---

### Fase 8: Documentacao e Entrega

**Objetivo**: Documentar o plugin para uso da equipe e preparar para publicacao futura.

| ID | Tarefa | Descricao | Criterio de Aceitacao |
|---|---|---|---|
| F8-T1 | Escrever README.md | Instrucoes de instalacao, configuracao em `opencode.json`, uso basico, exemplo de fluxo. | README claro e completo. |
| F8-T2 | Documentar API de tools | Listar todas as tools disponiveis, parametros, retornos e exemplos de uso. | Documentacao de referencia das tools. |
| F8-T3 | Documentar configuracao do briefing | Descrever campos do briefing, opcoes de avanco automatico, formato esperado. | Usuario consegue criar briefing manualmente se desejado. |
| F8-T4 | Documentar catalogo de especialistas | Explicar como adicionar especialistas customizados em `~/.config/opencode/mesa-de-discussao/catalog/`. | Extensibilidade documentada. |
| F8-T5 | Criar exemplo de projeto | Pasta `examples/` com um projeto de exemplo demonstrando o fluxo completo. | Exemplo executavel e didatico. |
| F8-T6 | Empacotar para distribuicao | Configurar `package.json` com `files`, `main`, `types`, preparar para `npm publish` (versao futura). | Pacote npm geravel via `npm pack`. |
| F8-T7 | Criar CHANGELOG.md | Documentar versoes, features e breaking changes. | CHANGELOG inicial com v0.1.0. |

**Entregavel**: Plugin documentado, com exemplos, pronto para uso interno e publicacao futura.

---

## 4. Dependencias entre Fases

```
Fase 1 (Fundacao)
    |
    v
Fase 2 (Catalogo) --------> Fase 4 (Gestor)
    |                            ^
    |                            |
    v                            |
Fase 3 (Briefing Writer) -------+
    |
    v
Fase 5 (Mesa de Discussao) <--- Fase 4 (Gestor)
    |
    v
Fase 6 (Integracao E2E)
    |
    v
Fase 7 (Testes)
    |
    v
Fase 8 (Documentacao)
```

- **Fase 2 e Fase 3 sao independentes** e podem ser desenvolvidas em paralelo apos Fase 1.
- **Fase 4 depende de Fase 2** (catalogo para propor equipe) e **Fase 3** (briefing para analisar).
- **Fase 5 depende de Fase 4** (Gestor para abrir rodadas).
- **Fase 6 depende de Fase 5** (fluxo completo para integrar).
- **Fase 7 e 8 dependem de Fase 6** (codigo completo para testar e documentar).

---

## 5. Riscos e Mitigacoes

| Risco | Probabilidade | Impacto | Mitigacao |
|---|---|---|---|
| API de plugins do OpenCode mudar | Media | Alto | Manter abstracao interna; isolar chamadas a APIs externas em adaptadores. |
| LLM nao seguir system prompts rigidamente | Alta | Medio | Implementar validacao de saida nas tools; retry com feedback de erro. |
| Sessoes de especialistas expirarem ou falharem | Media | Medio | Implementar timeout e retry; fallback para Gestor notificar humano. |
| Estado do plugin corromper em JSON | Baixa | Medio | Validacao de schema ao carregar; backup automatico do estado anterior. |
| Performance com muitos especialistas | Baixa | Medio | Limitar numero de especialistas por rodada; otimizar prompts. |
| Equipe continuar usando prototipo Go | Baixa | Alto | Entregar MVP funcional rapidamente; migracao gradual com feature parity. |

---

## 6. Criterios de Sucesso do Projeto

- [ ] Plugin carrega sem erros no OpenCode e health-check responde.
- [ ] Briefing Writer conduz descoberta estruturada e produz briefing aprovado.
- [ ] Gestor analisa briefing, propoe equipe (com aprovacao humana obrigatoria) e convoca especialistas.
- [ ] Rodadas de analise executam sequencialmente com contexto adequado.
- [ ] Consenso e alcancado (ou debate e revotacao ocorrem) e especificacao e gerada.
- [ ] Especificacao e aprovada pelo humano antes de prosseguir.
- [ ] Fluxo completo executa ponta a ponta sem intervencao tecnica.
- [ ] Testes automatizados passam; zero erros de TypeScript.
- [ ] Documentacao permite que novo membro da equipe use o plugin sem ajuda.

---

## 7. Notas de Implementacao

### 7.1. Nome dos Agentes no OpenCode

Os agentes serao configurados em `opencode.json` (ou `.opencode/agent/*.md`):

```json
{
  "agent": {
    "briefing-writer": {
      "description": "Briefing Writer - Conduz descoberta estruturada",
      "model": "kimi-k2.6"
    },
    "gestor": {
      "description": "Gestor - Orquestra equipe de especialistas",
      "model": "kimi-k2.6"
    }
  }
}
```

O plugin injeta system prompts especificos via `experimental.chat.system.transform` baseado no `input.agent`.

### 7.2. Sessoes de Especialistas

Cada especialista convocado recebe uma sessao dedicada criada via `client.session.create()`. O Gestor interage com eles via `client.session.prompt()`. Isso mantem o contexto isolado e evita poluicao do chat principal.

### 7.3. Persistencia de Estado

O estado e um unico arquivo JSON:

```json
{
  "workspace_id": "...",
  "fase_atual": "ANALISE",
  "briefing": { "caminho": "...", "status": "aprovado" },
  "equipe": [ { "persona_id": "...", "status": "convocado" } ],
  "discussao": {
    "rodada_atual": 1,
    "max_turnos": 2,
    "analises": [ { "agent_id": "...", "conteudo": "...", "turno": 1 } ],
    "votos": [ { "agent_id": "...", "voto": 1, "justificativa": "..." } ]
  },
  "especificacao": { "caminho": "...", "status": "pendente_aprovacao" }
}
```

### 7.4. Diferencas em Relacao ao Prototipo Go

| Aspecto | tabla-go (Go) | Plugin OpenCode (Node/TS) |
|---|---|---|
| Ferramentas de I/O | Nativas (file_read, file_write) | APIs nativas do OpenCode (`Bun.file`, `Bun.write`) |
| Terminal | Nativo (shell_exec) | `PluginInput.$` (BunShell) |
| MCPs | Configuracao customizada | Via configuracao nativa do OpenCode |
| Banco de dados | SQLite completo | Estado em JSON simples |
| Frontend | Svelte (Wails) | Interface nativa do OpenCode (chat) |
| Agentes | Entidades code-heavy | System prompts + orquestracao via tools |
| Runtime | Wails desktop | Plugin dentro do runtime OpenCode |

---

**Versao**: 1.0  
**Data**: 2026-05-29  
**Autor**: OpenCode / Rafael  
**Status**: Rascunho para aprovacao
