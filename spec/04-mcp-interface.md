# 04. MCP Interface: Tools, Resources, Prompts e Adapter

## 1. Filosofia de Design e Mudança de Paradigma

O plugin **Mesa de Discussão** não será um servidor MCP standalone (stdio/SSE). Ele será um **servidor MCP embarcado** dentro do runtime Node.js do OpenCode, expondo contratos padronizados de ferramentas (tools), recursos (resources) e prompts via uma camada de Adapter que traduz chamadas internas MCP para a API nativa do host. Essa estratégia garante **portabilidade futura** (se o OpenCode expuser um bridge MCP nativo, o contrato já está padronizado) e **testabilidade isolada** (podemos instanciar o servidor MCP em testes unitários sem carregar o host inteiro).

### Princípios Não Negociáveis

| Princípio | Justificativa | Consequência de Violação |
|-----------|--------------|--------------------------|
| **Statelessness por Tool Call** | Cada ferramenta deve ser idempotente e auto-contida, recebendo `discussion_id` explicitamente. | O agente não consegue paralelizar discussões; recuperação após crash é impossível. |
| **Descrição como "UI Copy"** | O agente escolhe ferramentas apenas pelo nome e descrição. A descrição deve dizer **quando** usar, não apenas **o que** faz. | Hallucinação de ferramentas: agente chama `cast_vote` durante análise porque a descrição era genérica. |
| **Validação Programática de Fase** | Nunca confiar em instruções negativas ("Não use a menos que...") no texto da descrição. O código valida o estado e retorna `isError: true`. | Prompt injection anula proibições textuais; o agente executa ações em fase errada. |
| **Event Sourcing como Fonte de Verdade** | O estado da discussão é um log append-only de eventos JSONL. Resources MCP são **projeções CQRS** sobre esse log. | Estado mutável em RAM ou JSON solto sem histórico impossibilita replay, audit e debug. |
| **Gateway de Capabilities na Delegação** | A ferramenta `delegate_to_specialist` deve validar `required_tools` estruturalmente contra o catálogo antes de repassar a instrução ao LLM. | Especialista executa `terminal_run` fora do escopo via ambiguidade linguística na instrução. |

## 2. Arquitetura da Interface MCP

### 2.1. Diagrama de Camadas

```
┌─────────────────────────────────────────────────────────────┐
│ OpenCode Host                                               │
│  • file_write, terminal_run, MCPs nativos                   │
│  • Chat UI / Prompt Context                                 │
├─────────────────────────────────────────────────────────────┤
│ Adapter Layer (OpenCode Bridge)                             │
│  • Registra tools/resources no host via API interna         │
│  • Traduz chamadas nativas do host para formato MCP         │
│  • Enfileira efeitos impuros (Pending Effect Ledger)        │
├─────────────────────────────────────────────────────────────┤
│ MCP Server Embarcado (TypeScript / Zod)                     │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Tool Registry (ações de orquestração)               │    │
│  │ Resource Provider (projeções CQRS)                  │    │
│  │ Prompt Templates (state guards)                     │    │
│  └─────────────────────────────────────────────────────┘    │
│  ┌─────────────────────────────────────────────────────┐    │
│  │ Security Pipeline (sanitização entre fronteiras)    │    │
│  │ Event Store Writer (.tabla/events/*.jsonl)          │    │
│  └─────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────┘
```

### 2.2. Fluxo de Dados: Tool Call → Evento → Projeção

1. **Tool Call**: Agente OpenCode invoca `open_discussion_round(...)`.
2. **Validação**: Zod valida entrada; state machine verifica se a transição é legal.
3. **Segurança**: Input sanitizado; se contiver padrões de prompt injection, rejeita antes de persistir.
4. **Persistência**: Evento `DiscussionOpened` é serializado em `.tabla/events/discussion-{id}.jsonl` com HMAC-SHA256.
5. **Efeito**: Se necessário, Effect Interpreter emite `file_write` nativo do host (via Adapter) para criar workspace.
6. **Projeção**: Resource `discussion://{id}/state` é computado sob demanda lendo o event log (ou lendo um snapshot cacheado).
7. **Resposta**: Tool retorna `discussion_id` + `phase: "analysis"` para o agente.

## 3. Especificação do Tool Registry

Toda ferramenta segue a convenção `verbo_substantivo`, usa Zod para schema, e retorna estruturas JSON. **Nenhuma ferramenta modifica estado implícito**: todas exigem `discussion_id`.

### 3.1. `open_discussion_round`
**Descrição para o agente**:  
> "Start a structured analysis round with specialists from the agency catalog. Use this when you need collaborative input on architecture, design, security, or complex technical decisions before committing to an implementation plan. Do not use this if a discussion is already active for the same topic."

**Schema Zod**:
```typescript
const OpenDiscussionRoundSchema = z.object({
  topic: z.string().min(5).max(500)
    .describe("Clear, specific topic or question for the specialists to analyze"),
  
  participants: z.array(z.string().min(1)).min(1).max(8)
    .describe("Ordered array of persona IDs from the agency-agents catalog. Order defines speaking sequence."),
  
  max_turns: z.number().int().min(1).max(5).default(2)
    .describe("Maximum analysis turns per specialist"),
  
  briefing_content: z.string().min(10).max(50000)
    .describe("Context, code, requirements, or documents to be analyzed by the specialists"),
  
  require_dissent: z.boolean().default(true)
    .describe("If true, consensus cannot proceed until a dissenting opinion is registered or explicitly waived"),
  
  quorum_ratio: z.number().min(0.5).max(1.0).default(0.6)
    .describe("Minimum ratio of participants that must vote for consensus to be valid")
});
```

**Retorno**:
```typescript
{
  content: [{
    type: "text",
    text: JSON.stringify({
      discussion_id: "disc_abc123",
      phase: "analysis",
      status: "running",
      turns_total: participants.length * max_turns,
      turns_completed: 0,
      expected_duration_ms: 120000,
      operation_id: "op_xyz" // para polling async
    }, null, 2)
  }]
}
```

**Erros**:
- `discussion_already_active`: já existe discussão em andamento para o workspace.
- `invalid_participant`: ID não encontrado no `agency-agents` catalog.
- `prompt_injection_detected`: briefing contém padrões suspeitos de injeção.

### 3.2. `cast_vote`
**Descrição para o agente**:  
> "Cast your vote in an active consensus round. Use ONLY after the discussion has entered consensus phase and you have reviewed the analysis transcript. Returns the current vote tally."

**Schema Zod**:
```typescript
const CastVoteSchema = z.object({
  discussion_id: z.string().regex(/^disc_[a-z0-9]{8,}$/),
  
  vote: z.union([z.literal(0), z.literal(1), z.literal(2)])
    .describe("0 = DISAGREE, 1 = AGREE, 2 = AGREE_WITH_RESERVATIONS"),
  
  justification: z.string().min(20).max(2000)
    .describe("Detailed reasoning for your vote. Must reference specific points from the analysis."),
  
  voter_persona_id: z.string()
    .describe("Your persona ID from the agency catalog")
});
```

**Retorno**:
```typescript
{
  content: [{
    type: "text",
    text: JSON.stringify({
      discussion_id: "disc_abc123",
      vote_registered: true,
      current_tally: { agree: 2, disagree: 0, reservations: 1 },
      quorum_required: 3,
      quorum_met: true,
      next_phase: "documentation"
    })
  }]
}
```

**Erros**:
- `invalid_phase`: discussão não está em `consensus`.
- `duplicate_vote`: este `voter_persona_id` já votou nesta rodada.
- `justification_too_short`: abaixo de 20 caracteres.
- `quorum_not_met`: votos computados mas quórum ainda não alcançado (não é erro, mas `isError: false` com flag).

**Integridade**: internamente, o evento `VoteCast` é persistido com HMAC (`vote`, `justification`, `nonce`, `timestamp`).

### 3.3. `request_consensus`
**Descrição para o agente**:  
> "Request consensus voting for a structured discussion that has completed its analysis phase. Use after all specialists have finished their turns and you believe the analysis is sufficient for a decision."

**Schema Zod**:
```typescript
const RequestConsensusSchema = z.object({
  discussion_id: z.string(),
  force: z.boolean().default(false)
    .describe("If true, bypasses the dissent requirement (Manager override)")
});
```

**Pré-condições validadas**:
1. `phase === "analysis_complete"`
2. `analysis_turns_completed === true`
3. Se `require_dissent === true` e `force === false`: deve existir evento `DissentRegistered` ou `DissentWaived`.
4. `status !== "cancelled"`

**Retorno**: `{ phase: "consensus", voting_deadline: "<ISO>", ... }`

**Erros**:
- `preconditions_not_met`: lista quais pré-condições falharam.
- `insufficient_analysis`: nenhuma mensagem de análise registrada.

### 3.4. `generate_specification`
**Descrição para o agente**:  
> "Generate the collaborative specification document after consensus is reached. Triggers the documentation phase where approved decisions are compiled into a markdown spec. Use only when consensus phase has succeeded."

**Schema Zod**:
```typescript
const GenerateSpecificationSchema = z.object({
  discussion_id: z.string(),
  output_path: z.string().optional().default(".tabla/spec-{id}.md")
});
```

**Retorno**: `{ document_path: "...", content_hash: "sha256:...", phase: "approval" }`

**Erros**:
- `consensus_failed`: não há consenso para gerar documento.
- `document_already_exists`: especificação já foi gerada (idempotente se hash bater).

### 3.5. `delegate_to_specialist`
**Descrição para o agente**:  
> "Assign a concrete implementation task to a specific specialist. Use after a specification has been approved by the human. The instruction will be validated against the specialist's tool capabilities before execution."

**Schema Zod**:
```typescript
const DelegateToSpecialistSchema = z.object({
  discussion_id: z.string(),
  
  persona_id: z.string()
    .describe("Target specialist from agency-agents catalog"),
  
  instruction: z.string().min(10).max(10000)
    .describe("Plain-text instruction describing what to implement"),
  
  required_tools: z.array(z.string()).min(1)
    .describe("Explicit list of native tool names the specialist will need (e.g., ['file_write', 'terminal_run']). Must match the specialist's capabilities."),
  
  timeout_ms: z.number().default(300000)
});
```

**Gateway de Capabilities**:
Antes de aceitar, o plugin consulta `agents://{persona_id}/profile` e valida se `required_tools ⊆ profile.tools_whitelist`. Se não: retorna erro listando as ferramentas não autorizadas.

**Retorno**: `{ delegation_id: "del_...", status: "queued", estimated_completion: "..." }`

**Erros**:
- `specialist_not_found`
- `capability_mismatch`: lista tools não autorizadas.
- `discussion_not_approved`: fase diferente de `approved`.
- `unsafe_instruction_detected`: classificador de segurança encontrou padrão destrutivo na string.

### 3.6. `cancel_discussion`
**Descrição para o agente**:  
> "Cancel an active structured discussion. Use when the discussion is no longer needed, the human decided to abort, or you need to restart with different parameters. Triggers cleanup of pending operations."

**Schema Zod**:
```typescript
const CancelDiscussionSchema = z.object({
  discussion_id: z.string(),
  reason: z.enum(["user_request", "timeout", "error", "strategy_change"]),
  cleanup_artifacts: z.boolean().default(true)
});
```

**Comportamento**:
1. AbortController associado à discussão é sinalizado.
2. Evento `DiscussionCancelled` é append-only no log.
3. Se `cleanup_artifacts === true`, Effect Interpreter executa compensações (Compensating Transactions/Saga) em ordem LIFO.
4. Pending Effect Ledger é atualizado.

**Retorno**: `{ cancelled: true, operations_aborted: 3, artifacts_removed: 2 }`

### 3.7. `resume_discussion`
**Descrição para o agente**:  
> "Resume a paused structured discussion from where it stopped. Use when a discussion was paused awaiting human input or after a plugin reload."

**Schema Zod**:
```typescript
const ResumeDiscussionSchema = z.object({
  discussion_id: z.string(),
  from_checkpoint: z.string().optional()
});
```

**Retorno**: `{ phase: "...", next_action: "awaiting_human_approval" | "run_turn_3" }`

### 3.8. `list_active_discussions` (Utility)
**Schema Zod**: `{}` (sem parâmetros)

**Retorno**: Array de `{ discussion_id, topic, phase, status, updated_at }`.

## 4. Especificação de Resources (URI Templates)

Resources são **Read Models** projetados sobre o Event Store. Todos retornam JSON estruturado com `mimeType: "application/json"`, exceto quando notado.

### 4.1. `tabla://active-discussions`
**Projeção**: lê todos os arquivos `.tabla/events/discussion-*.jsonl`, filtra aqueles com último evento diferente de `DiscussionCompleted`/`DiscussionCancelled`, retorna resumo.

```json
{
  "discussions": [
    {
      "id": "disc_abc123",
      "topic": "Authentication architecture",
      "phase": "analysis",
      "status": "running",
      "participants": ["architect", "backend_dev"],
      "updated_at": "2024-01-15T10:00:00Z"
    }
  ]
}
```

**Uso pelo agente**: o agente deve consultar este resource no início de cada turno para descobrir se há mesas ativas.

### 4.2. `discussion://{id}/state`
**Projeção**: reduz o event log para o estado atual da state machine.

```json
{
  "id": "disc_abc123",
  "phase": "consensus",
  "status": "running",
  "transitions": [
    { "from": "analysis", "to": "analysis_complete", "at": 1234567890, "trigger": "turns_completed" },
    { "from": "analysis_complete", "to": "consensus", "at": 1234567891, "trigger": "request_consensus" }
  ],
  "budget": { "analysis": { "consumed": 245000, "total": 600000 } },
  "_integrity": "hmac-sha256=abcdef..."
}
```

### 4.3. `discussion://{id}/transcript`
**Projeção**: lista mensagens trocadas entre especialistas, com redação de PII/secrets aplicada.

```json
{
  "messages": [
    {
      "turn": 1,
      "persona_id": "architect",
      "role": "analysis",
      "content": "I recommend JWT with refresh tokens...",
      "timestamp": "2024-01-15T10:05:00Z",
      "content_hash": "sha256:..."
    }
  ]
}
```

### 4.4. `discussion://{id}/audit`
**Projeção**: eventos brutos com metadado de integridade para verificação.

```json
{
  "events": [
    {
      "type": "VoteCast",
      "payload": { ... },
      "_integrity": "hmac-sha256=...",
      "_redacted": false
    }
  ]
}
```

### 4.5. `agents://catalog`
**Projeção**: espelho do `agency-agents` catalog, normalizado pelo ACL interno.

```json
{
  "agents": [
    {
      "id": "architect",
      "name": "Software Architect",
      "role_type": "analyst",
      "tools_whitelist": ["file_read", "code_grep"],
      "temperature": 0.2
    }
  ]
}
```

### 4.6. `agents://{id}/profile`
Perfil individual com capacidades declarativas.

### 4.7. `operation://{id}/status`
**Async Pattern**: para operações longas (turno de análise, votação paralela).

```json
{
  "operation_id": "op_xyz",
  "discussion_id": "disc_abc123",
  "status": "running", // running | paused | completed | cancelled | failed
  "progress": { "current": 2, "total": 3 },
  "result_uri": null, // preenchido quando completed
  "error": null
}
```

## 5. Prompt Templates (State Guards)

Prompts são injetados no contexto do Gerente **condicionalmente**, baseado no estado da mesa. Eles atuam como barreiras semânticas, mas **nunca substituem** as validações programáticas.

### 5.1. `tabla-orchestrator-active`
**Condição**: `exists active discussion where status === "running"`  
**Conteúdo**:
> "You are currently the Manager of an active structured discussion (ID: {discussion_id}, Phase: {phase}). Before taking any other action, consult the resource `discussion://{id}/state` to understand the current status. Do not start a new discussion until this one reaches 'completed' or 'cancelled'."

### 5.2. `tabla-pending-approval`
**Condição**: `phase === "approval"`  
**Conteúdo**:
> "A specification document is pending human approval at {document_uri}. Do NOT call `delegate_to_specialist`. Do NOT modify the workspace expecting the specification to be approved. Wait for explicit human confirmation before proceeding."

### 5.3. `tabla-consensus-phase`
**Condição**: `phase === "consensus"`  
**Conteúdo**:
> "The discussion is in consensus phase. Use `cast_vote` ONLY after reviewing `discussion://{id}/transcript`. Each persona may vote once. Consensus requires {quorum_required} votes."

### 5.4. `tabla-max-depth`
**Condição**: `discussion_stack_depth >= 1`  
**Conteúdo**:
> "A discussion is already active. You cannot call `open_discussion_round` until the current discussion reaches 'completed' or 'cancelled'."

## 7. Security Pipeline para Fronteiras Multi-Agente

A comunicação entre Gerente e Especialistas é uma **trust boundary**. O plugin implementa sanitização obrigatória em três fronteiras:

### 7.1. Input Sanitization (Pre-Event)
Antes de qualquer evento ser appendado no `.jsonl`:

```typescript
interface SecurityGateResult {
  action: 'ALLOW' | 'QUARANTINE' | 'REJECT';
  reason?: string;
  sanitizedContent?: string;
}

function sanitizeAgentOutput(raw: string): SecurityGateResult {
  // 1. Detectar padrões de tool call não intencionais
  if (detectToolCallPatterns(raw).length > 0) {
    return { action: 'QUARANTINE', reason: 'Unintended tool call pattern detected' };
  }
  
  // 2. Classificador de jailbreak (regex + heurística)
  const jailbreakScore = classifyJailbreak(raw);
  if (jailbreakScore > 0.8) return { action: 'REJECT', reason: 'Jailbreak detected' };
  
  // 3. Prompt leakage
  if (detectPromptLeakage(raw)) return { action: 'REJECT', reason: 'Prompt leakage attempt' };
  
  // 4. Redação de secrets/PII antes de persistir
  const redacted = redactSecrets(raw);
  
  return { action: 'ALLOW', sanitizedContent: redacted };
}
```

**Regra de ouro**: outputs rejeitados não são perdidos; são persistidos como evento `AgentOutputQuarantined` para audit, mas **nunca** entram no contexto dos próximos turnos.

### 7.2. Vote Integrity
Cada voto carrega `nonce` UUIDv4 e HMAC:

```typescript
const votePayload = JSON.stringify({ discussion_id, vote, justification, nonce, timestamp });
const signature = hmac(workspaceSecret, votePayload);
```

O resource `discussion://{id}/audit` expõe o `signature` para verificação externa.

### 7.3. Delegation Capability ACL
Não usar substring matching na instrução. A autorização é declarativa:

```typescript
const profile = await resolveAgentProfile(persona_id);
const allowed = new Set(profile.tools_whitelist);
const requested = new Set(required_tools);

if (!requested.isSubsetOf(allowed)) {
  return {
    content: [{ type: "text", text: `Capability mismatch. Allowed: [...], Requested: [...]` }],
    isError: true
  };
}
```

## 9. Adapter Layer e Integração com OpenCode

### 9.1. Responsabilidades do Adapter

```typescript
interface OpenCodeAdapter {
  // Registra uma tool no host OpenCode
  registerTool(name: string, schema: ZodSchema, handler: ToolHandler): void;
  
  // Registra um resource template no host
  registerResource(template: string, handler: ResourceHandler): void;
  
  // Registra um prompt condicional no host
  registerPrompt(name: string, condition: PromptCondition, template: string): void;
  
  // Executa tool call nativo do host de forma idempotente
  executeNativeTool<T>(toolName: string, params: T, idempotencyKey: string): Promise<NativeResult>;
  
  // Apresenta diálogo de confirmação bloqueante ao usuário (se suportado)
  requestHumanApproval(prompt: string, nonce: string): Promise<'approved' | 'rejected'>;
}
```

### 9.2. Pending Effect Ledger

Todo efeito impuro (tool call nativa) passa pelo ledger antes da execução:

```typescript
interface PendingEffect {
  effect_id: string;           // {discussion_id}:{step_index}:{sequence}
  idempotency_key: string;     // determinístico para exactly-once
  type: 'native_tool_call';
  tool_name: string;
  params: unknown;
  status: 'intent' | 'committed' | 'compensated';
  compensation?: { tool_name: string; params: unknown };
}
```

Arquivo: `.tabla/effects/pending-{effect_id}.json`. Na reidratação após crash, o Effect Interpreter reconcilia `intent` vs `committed` verificando o workspace.

## 10. Estratégia de Erros e Resiliência

### 10.1. Padrão de Resposta de Erro
Nunca lançar exceções não tratadas. Sempre retornar:

```typescript
{
  content: [{ type: "text", text: "Actionable error message in Portuguese" }],
  isError: true
}
```

**Mensagens devem ser acionáveis**:
- ❌ `"Error: 500"`  
- ✅ `"Cannot cast vote: discussion 'disc_abc123' is in phase 'analysis', not 'consensus'. Use request_consensus first."`

### 10.2. Retry como Sub-Máquina de Estados
Para falhas transitórias (LLM timeout, API do host):

```
[FAILED] → [RETRY_WAIT] (backoff exponencial: 2^attempt * 1000ms, max 5 tentativas)
         → [RETRY_ATTEMPT]
            → SUCCESS → retorna ao fluxo pai
            → FAILURE & attempt < max → [RETRY_WAIT]
            → FAILURE & attempt >= max → [MAX_RETRIES_EXCEEDED] → ABORT_CLEANUP
```

### 10.3. Time Budget Tree
Orçamento de tempo por fase, configurável:

```typescript
const defaultBudget = {
  analysis: { total: 600_000, per_turn: 120_000 },
  consensus: { total: 300_000, per_vote: 30_000, debate: 60_000 },
  documentation: { total: 120_000 },
  execution: { total: 600_000 }
};
```

Se `budget.analysis.consumed > budget.analysis.total`, transiciona para `PHASE_TIMEOUT`.

## 11. Estrutura de Arquivos do Plugin (MCP Builder)

```
src/
├── mcp-server/
│   ├── server.ts                 # Bootstrap do McpServer embarcado
│   ├── registry/
│   │   ├── tools.ts              # Registro de todas as ferramentas
│   │   ├── resources.ts          # URI templates e handlers
│   │   └── prompts.ts            # Prompt templates condicionais
│   ├── tools/
│   │   ├── openDiscussionRound.ts
│   │   ├── castVote.ts
│   │   ├── requestConsensus.ts
│   │   ├── generateSpecification.ts
│   │   ├── delegateToSpecialist.ts
│   │   ├── cancelDiscussion.ts
│   │   └── resumeDiscussion.ts
│   ├── resources/
│   │   ├── activeDiscussions.ts
│   │   ├── discussionState.ts
│   │   ├── discussionTranscript.ts
│   │   ├── discussionAudit.ts
│   │   ├── operationStatus.ts
│   │   └── agentsCatalog.ts
│   └── prompts/
│       └── stateGuards.ts
├── workflow/
│   ├── engine.ts                 # TablaWorkflowEngine
│   ├── stateMachine.ts           # FSM com transições validadas
│   ├── phases/
│   │   ├── analysisPhase.ts
│   │   ├── consensusPhase.ts
│   │   ├── documentationPhase.ts
│   │   └── executionPhase.ts
│   └── recovery.ts               # Reidratação após crash
├── events/
│   ├── store.ts                  # Append-only JSONL writer
│   ├── projector.ts              # CQRS: evento → state snapshot
│   └── types.ts                  # DiscussionEvent union type
├── security/
│   ├── pipeline.ts               # Sanitização input/output
│   ├── integrity.ts              # HMAC, nonce, checksums
│   └── acl.ts                    # Capability checking
├── adapter/
│   ├── opencode.ts               # Bridge para API nativa do host
│   ├── effectLedger.ts           # Pending Effect Ledger
│   └── compensation.ts           # Saga / compensating transactions
├── catalog/
│   ├── agencyAgents.ts           # Anti-Corruption Layer do agency-agents
│   └── schema.ts                 # Zod schemas para perfil de especialista
└── utils/
    ├── idempotency.ts
    └── errors.ts                 # Factory de respostas isError
```

## 13. Gap Analysis: Descartar, Reescrever, Construir (Foco Interface MCP)

| Componente | Ação | Justificativa |
|------------|------|---------------|
| **Tooling nativo Go** (fs, terminal, MCPs shadow) | **DESCARTAR** | Violação de sandbox; host OpenCode já provê via MCP nativo |
| **Nomenclatura e schema de ferramentas** (genéricas, sem Zod) | **REESCREVER COMPLETAMENTE** | Nomes verb_noun, Zod rigoroso, descrições orientadas a "quando usar" |
| **Estado implícito nas ferramentas** ("discussão atual") | **REESCREVER** | `discussion_id` obrigatório; stateless por call |
| **Mecanismo de trigger ao Gerente** (goroutines imperativas) | **REESCREVER** | Event-driven; recursos MCP como sinalização; sem reentrancy |
| **Parsing de voto por substring** | **REESCREVER** | Enum Zod estrito com HMAC |
| **Aprovação humana (boolean)** | **REESCREVER** | Nonce + hash do documento + timestamp |
| **Event Sourcing local (.jsonl)** | **CONSTRUIR DO ZERO** | Fonte da verdade append-only com HMAC |
| **Resources MCP** (projeções CQRS) | **CONSTRUIR DO ZERO** | `discussion://`, `agents://`, `tabla://`, `operation://` |
| **Prompts de State Guard** | **CONSTRUIR DO ZERO** | Injeção contextual condicional para prevenir ações inválidas |
| **Security Pipeline** (sanitização, ACL, quarantine) | **CONSTRUIR DO ZERO** | Fronteira de trust entre agentes multi-LLM |
| **Async Operation Status** | **CONSTRUIR DO ZERO** | Padrão `operation://{id}/status` para turnos longos sem travar tool call |
| **Adapter OpenCode-native** | **CONSTRUIR DO ZERO** | Bridge idempotente com Pending Effect Ledger |
| **Anti-Corruption Layer agency-agents** | **CONSTRUIR DO ZERO** | Isolar schema externo; versionamento interno |
| **Compensating Transactions / Saga** | **CONSTRUIR DO ZERO** | Rollback de efeitos impuros em falhas ou cancelamentos |

## 14. Perguntas Críticas Pendentes para Validação

1. **O OpenCode permite a um plugin registrar ferramentas dinamicamente no runtime?** Ou o schema é estático no momento do load? Isso define se conseguimos implementar Dynamic Tool Availability.
2. **O OpenCode suporta URI templates para resources?** Ou apenas URIs estáticas? Afeta `discussion://{id}/state`.
3. **O OpenCode expõe API para prompts contextuais condicionais?** Ou o plugin deve injetar texto no system prompt manualmente?
4. **Como o plugin acessa múltiplas "personas" ou especialistas?** Eles são instâncias separadas de LLM, ou o plugin apenas estrutura system prompts alternados para o mesmo modelo?
5. **O OpenCode oferece um secrets vault por plugin?** Necessário para derivar chaves HMAC de forma segura.

---

**Conclusão**: O protótipo `tabla-go` validou o modelo de governança multi-agente, mas sua interface era um anti-padrão MCP: shadow tooling, estado implícito, e ausência de contratos tipados. A reconstrução como plugin OpenCode deve seguir o princípio de que **o plugin é um servidor de orquestração, não um executor**. Ele expõe ferramentas de alta intenção, recursos projetados sobre eventos imutáveis, e prompts que guiam o agente — enquanto todo trabalho de baixo nível é delegado ao host via Adapter, com idempotência, compensação e auditabilidade como pilares.
