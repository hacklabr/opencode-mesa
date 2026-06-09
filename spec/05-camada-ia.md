# 05. Camada de IA: Inferência, Contexto, Consenso e Segurança de Conteúdo

## 1. Visão Geral e Escopo da Camada de IA

Esta seção define a arquitetura de inteligência artificial do plugin **Mesa de Discussão** para OpenCode. O escopo abrange o ciclo completo de orquestração de múltiplos agentes de linguagem (LLMs): desde a adaptação de capacidades do modelo hospedeiro, passando pela gestão de contexto, compressão seletiva, segurança de conteúdo multi-agente, detecção de alucinação, até métricas de qualidade do consenso e determinismo de replay.

**Premissa fundamental**: O plugin não executa inferência diretamente. O OpenCode é o runtime de LLM. O plugin atua como **orquestrador de prompts e políticas de inferência**, controlando *quem* recebe *qual* contexto, *como* as respostas são filtradas, e *quando* o estado cognitivo da mesa deve ser compactado ou recuperado.

## 2. Arquitetura da Camada de Inferência

### 2.1. Model Capability Adapter

O OpenCode pode operar com diferentes modelos (GPT-4, Claude, Llama, etc.) e nem todas as capacidades de inferência são expostas igualmente aos plugins. Construir uma arquitetura de especialistas assumindo controle total de `temperature`, `top_p`, `system_prompt` separado por agente ou `seed` leva a uma falsa especialização — na prática, todos os especialistas colapsam no mesmo comportamento se o host não expõe esses knobs.

**Decisão arquitetural**: Implementar um `ModelCapabilityAdapter` que sonda o host no momento da ativação do plugin (`onActivate`) e mapeia um **capability profile**.

```typescript
// src/ai/capability-adapter.ts
export interface ModelCapabilityProfile {
  supportsPerCallSystemPrompt: boolean;  // Pode alterar system prompt entre turns?
  supportsTemperature: boolean;
  supportsTopP: boolean;
  supportsSeed: boolean;
  supportsMaxTokens: boolean;
  supportsMultiModal: boolean;
  contextWindowSize: number;               // Ex: 128000, 200000
  nativeToolCalling: boolean;              // Function calling nativo vs parsing manual
  provider: string;                        // "openai", "anthropic", etc.
}

export class ModelCapabilityAdapter {
  private profile: ModelCapabilityProfile | null = null;

  async probe(host: OpenCodeHost): Promise<ModelCapabilityProfile> {
    // Estratégia: executar uma tool call de diagnóstico controlada
    // que retorna metadados do ambiente, nunca inferir por comportamento.
    const manifest = await host.getCapabilityManifest();
    this.profile = {
      supportsPerCallSystemPrompt: manifest.features?.separateSystemPrompt ?? false,
      supportsTemperature: manifest.features?.temperature ?? false,
      supportsSeed: manifest.features?.seed ?? false,
      contextWindowSize: manifest.limits?.contextWindow ?? 128000,
      nativeToolCalling: manifest.features?.functionCalling ?? true,
      // ...
    };
    return this.profile;
  }

  getEffectiveConfig(requested: InferenceConfig): InferenceConfig {
    if (!this.profile) throw new Error('Adapter not probed');
    return {
      temperature: this.profile.supportsTemperature ? requested.temperature : undefined,
      max_tokens: this.profile.supportsMaxTokens ? requested.max_tokens : undefined,
      // Se não suporta system prompt separado, injetar como user message prefix
      systemPrompt: this.profile.supportsPerCallSystemPrompt 
        ? requested.systemPrompt 
        : undefined,
    };
  }
}
```

**Justificativa**: Evita falha silenciosa de especialização. Se o host não suporta múltiplos system prompts, o plugin emula personas via **few-shot exemplars** e **role prefixes** no conteúdo da mensagem, garantindo que a arquitetura de especialistas funcione mesmo em hosts monolíticos.

### 2.2. Inference Cache Layer (Deterministic Replay)

O Software Architect propôs Event Sourcing para recuperação de estado. Para que o replay seja determinístico, o mesmo prompt deve produzir o mesmo output. Como LLMs com `temperature > 0` são estocásticos, a camada de IA deve implementar cache de inferência persistente.

```typescript
// src/ai/inference-cache.ts
interface CacheKey {
  promptHash: string;      // SHA-256 do prompt serializado
  modelFingerprint: string; // provider/model/version/timestamp de deploy
  configHash: string;      // temperatura, seed, etc.
}

interface CacheEntry {
  key: CacheKey;
  output: string;
  tokenUsage: { prompt: number; completion: number };
  timestamp: number;
}

export class InferenceCache {
  constructor(private store: CacheStore) {}

  async get(key: CacheKey): Promise<CacheEntry | null> {
    return this.store.get(this.serializeKey(key));
  }

  async set(key: CacheKey, entry: CacheEntry): Promise<void> {
    await this.store.set(this.serializeKey(key), entry);
  }

  // Modo replay: se entry existe, retorna sem chamar LLM
  // Modo production: sempre escreve, lê apenas em retry idempotente
}
```

**Armazenamento**: Os caches são salvos em `.tabla/cache/inference/{discussion_id}/` como JSON. Em modo `TEST` ou `REPLAY`, o `Effect Interpreter` consulta o cache antes de emitir uma tool call nativa de LLM. Isso permite benchmarks de regressão: uma discussão de 20 turnos pode ser re-executada em milissegundos para validar mudanças na lógica de consenso.

**Justificativa**: Sem cache, testes de regressão de workflow custariam tokens e tempo. Com cache, a camada de IA torna-se testável unitariamente.

## 3. Gestão de Contexto e Memória (Context Budget Manager)

### 3.1. O Problema: Explosão de Contexto em Multi-Turno

Com 5 especialistas, 3 turnos e briefing extenso, o contexto excede facilmente 100k tokens. A qualidade de síntese degrada após ~70% da janela. O protótipo Go provavelmente passava transcripts completos entre turnos.

**Decisão**: Implementar `ContextBudgetManager` que opera como orçamentista de tokens entre o `Event Store` bruto e o `prompt` efetivo enviado ao LLM.

### 3.2. Estrutura de Orçamento

```typescript
// src/ai/context-budget.ts
export interface ContextBudget {
  totalTokens: number;           // Ex: 128000
  reservedSystem: number;        // 10% para system prompt + anchor
  reservedTools: number;         // 15% para descrições de tools disponíveis
  availableForHistory: number;   // 75% restante
  maxHistoryTokens: number;      // hard cap para transcript bruto
  compressionThreshold: number;  // quando atingir 80% do available, disparar compressão
}
```

### 3.3. RAG Seletivo sobre o Event Stream

Em vez de serializar todo o `.jsonl` no prompt, o `ContextBudgetManager` indexa eventos semanticamente e recupera apenas os relevantes para o turno atual.

```typescript
// src/ai/event-retriever.ts
export class EventContextRetriever {
  constructor(
    private eventStore: EventStore,
    private embedder: LightweightEmbedder, // all-MiniLM ou similar via onnxruntime-node
    private vectorIndex: VectorIndex       // FAISS ou HNSW em memória/disco
  ) {}

  async buildContextForTurn(
    discussionId: string,
    currentTurn: number,
    specialistRole: string,
    budget: number
  ): Promise<RetrievedContext> {
    // 1. Recuperar todos os eventos do tipo AgentOutputReceived
    const events = await this.eventStore.getByDiscussion(discussionId);

    // 2. Gerar embeddings para cada evento (feito uma única vez no ingest)
    // 3. Embedding da query = objetivo atual do turno + role do especialista
    const queryEmbedding = await this.embedder.embed(
      `Turn ${currentTurn} for ${specialistRole}: ${events[0].payload.topic}`
    );

    // 4. Buscar top-k eventos semanticamente próximos, respeitando budget
    const relevant = await this.vectorIndex.search(queryEmbedding, {
      topK: 20,
      tokenBudget: budget,
    });

    // 5. Incluir obrigatoriamente eventos críticos não-negociáveis
    const mandatory = events.filter(e => 
      e.type === 'ConsensusVoteCast' || e.type === 'DissentRegistered'
    );

    return { segments: [...mandatory, ...relevant], totalTokens: estimateTokens(...) };
  }
}
```

**Justificativa**: FAISS/Qdrant local em Node.js (via `faiss-node` ou `vectra`) é leve o suficiente para rodar dentro do processo do plugin sem GPU. A alternativa — passar todo o histórico — garante degradação de qualidade em discussões complexas.

### 3.4. Compressão Hierárquica de Turnos

Para eventos não recuperados pelo RAG mas que precisam ser preservados para consistência, aplicar compressão hierárquica:

```typescript
// src/ai/compression-engine.ts
export class TurnCompressionEngine {
  async compressTurn(events: AgentOutputEvent[]): Promise<CompressedTurn> {
    // Prompt estruturado ao LLM host (ou modelo local leve) para sumarização
    const summaryPrompt = `
      Condense the following specialist outputs into:
      1. agreed_facts: bullet points of factual consensus
      2. open_divergences: list of disagreements with author and core argument
      3. action_items: pending decisions or validations
      Max 300 tokens.
    `;

    const rawText = events.map(e => `${e.payload.persona}: ${e.payload.output}`).join('\n');
    const summary = await this.llm.summarize(summaryPrompt + '\n' + rawText);

    return {
      turnNumber: events[0].payload.turn,
      agreedFacts: summary.agreed_facts,
      divergences: summary.open_divergences,
      actionItems: summary.action_items,
      originalTokenCount: estimateTokens(rawText),
      compressedTokenCount: estimateTokens(JSON.stringify(summary)),
    };
  }
}
```

**Invariante**: O `CompressedTurn` é persistido como evento `TurnCompressed` no log. O transcript bruto permanece no `Event Store`, mas o prompt do turno N+1 usa apenas o `CompressedTurn` dos turnos antigos + eventos recentes em bruto.

## 4. Multi-Agent Orchestration & Context Assembly

### 4.1. Assembly do Prompt por Especialista

Cada especialista recebe um prompt montado dinamicamente a partir do estado da discussão. O assembly segue estrita ordem de prioridade:

```typescript
// src/ai/prompt-assembler.ts
export function assembleSpecialistPrompt(
  specialist: SpecialistProfile,
  discussion: DiscussionProjection,
  capabilityProfile: ModelCapabilityProfile
): AssembledPrompt {
  const segments: PromptSegment[] = [];

  // 1. SYSTEM: Instrução base da persona (do agency-agents)
  if (capabilityProfile.supportsPerCallSystemPrompt && specialist.systemPrompt) {
    segments.push({ role: 'system', content: specialist.systemPrompt });
  } else {
    // Fallback: injetar como prefixo da primeira mensagem user
    segments.push({ role: 'user', content: `[Persona: ${specialist.name}]\n${specialist.systemPrompt}` });
  }

  // 2. MEMORY ANCHOR: bloco imutável de contexto da mesa
  // Conforme análise de AI Engineer, isso previne "esquecimento" em async
  segments.push({
    role: 'system',
    content: buildMemoryAnchor(discussion), // ver seção 4.2
  });

  // 3. BRIEFING: Contexto da tarefa (resumido após turno 1)
  segments.push({
    role: 'user',
    content: discussion.turnCount === 0 
      ? discussion.originalBriefing 
      : discussion.compressedBriefing,
  });

  // 4. HISTÓRICO: Contexto recuperado via RAG + turnos comprimidos
  segments.push(...buildHistorySegments(discussion));

  // 5. INSTRUÇÃO DE TURNO: O que este especialista deve fazer agora
  segments.push({
    role: 'user',
    content: `It is your turn (turn ${discussion.currentTurn}/${discussion.maxTurns}). Provide your analysis.`,
  });

  return { segments, estimatedTokens: estimateTokens(segments) };
}
```

### 4.2. Memory Anchor

O **Memory Anchor** é um artefato de IA crítico para operações assíncronas. Quando um turno de análise retorna imediatamente (async pattern do MCP Builder) e o agente polla por `operation://{id}/status`, o Gerente corre risco de perder o thread cognitivo. O anchor é um bloco de texto imutável, gerado uma única vez no setup e preservado até o fim da discussão.

```typescript
function buildMemoryAnchor(disc: DiscussionProjection): string {
  return `
<TABLA_CONTEXT>
  Discussion ID: ${disc.id}
  Topic: ${disc.topic}
  Phase: ${disc.phase}
  Active Participants: ${disc.participants.map(p => p.id).join(', ')}
  Current Turn: ${disc.currentTurn} / ${disc.maxTurns}
  Objective: ${disc.objective}
  Constraints: ${disc.constraints.join('; ')}
</TABLA_CONTEXT>
  `.trim();
}
```

**Regra de segurança**: O Memory Anchor é gerado a partir do estado projetado no momento da criação da discussão e **nunca modificado** por eventos subsequentes. Se o estado mudar (ex: adicionar participante), um novo anchor é gerado e versionado, mas o antigo permanece no cache para turns em andamento. Isso evita o vetor de prompt injection persistente identificado pelo Security Engineer (Seção 8.8 do turno 2 de Security).

## 5. Qualidade do Consenso e Mitigação de Viés

### 5.1. Randomização de Ordem e Apresentação Anônima

O protótipo Go sofre de **recency bias** e **primacy bias**: o especialista que fala por último tem maior influência. A camada de IA deve ofuscar a ordem durante a fase de consenso.

```typescript
// src/ai/consensus-bias-mitigation.ts
export function shuffleConsensusPresentation(
  analyses: AnalysisOutput[],
  seed: string
): ShuffledPresentation[] {
  // Fisher-Yates determinístico usando seed derivada do discussion_id
  const rng = seededRNG(seed);
  const shuffled = [...analyses].sort(() => rng.next() - 0.5);

  return shuffled.map((analysis, idx) => ({
    anonymousId: `Specialist_${String.fromCharCode(65 + idx)}`, // A, B, C...
    originalPersonaId: analysis.personaId, // mascarado no prompt, registrado no log
    content: analysis.content,
  }));
}
```

**Justificativa**: Estudos em LLM judgment mostram que a ordem de apresentação pode alterar o resultado de votação em até 30% em tarefas subjetivas. A anonimização elimina o viés de autoridade ("o arquiteto sênior disse...").

### 5.2. Devil's Advocate e Persuasion Delta

Conforme proposto na análise, o Devil's Advocate não pode ser apenas presença — precisa ter **impacto mensurável**. Implementar `PersuasionDeltaMetric`.

```typescript
// src/ai/metrics/persuasion-delta.ts
export class PersuasionDeltaMetric {
  constructor(private embedder: LightweightEmbedder) {}

  async compute(
    preDissentVotes: Vote[],
    postDissentVotes: Vote[],
    dissentContent: string
  ): Promise<PersuasionDelta> {
    // Embedding da posição média pré-dissidência
    const preEmbedding = await this.embedder.embed(
      preDissentVotes.map(v => v.justification).join(' || ')
    );

    // Embedding da posição média pós-dissidência
    const postEmbedding = await this.embedder.embed(
      postDissentVotes.map(v => v.justification).join(' || ')
    );

    // Embedding do conteúdo do dissidente
    const dissentEmbedding = await this.embedder.embed(dissentContent);

    const delta = cosineSimilarity(preEmbedding, postEmbedding);
    const dissentInfluence = cosineSimilarity(dissentEmbedding, postEmbedding) 
                           - cosineSimilarity(dissentEmbedding, preEmbedding);

    return {
      consensusShift: 1 - delta,        // 0 = nada mudou, 1 = mudou completamente
      dissentInfluence,                 // positivo = dissidente puxou para sua posição
      recommendation: consensusShift < 0.1 
        ? 'REOPEN_ANALYSIS'             // dissidência não teve efeito, discutir mais
        : 'PROCEED_TO_VOTE',
    };
  }
}
```

**Integração com Workflow**: O Workflow Engine consome esse evento como **Gateway Condition** (conforme Workflow Architect). Se `recommendation === 'REOPEN_ANALYSIS'`, a transição `analysis_complete → consensus` é bloqueada automaticamente.

### 5.3. Commitment Scheme para Votação (Byzantine Fault Tolerance)

Para evitar que especialistas adaptem seus votos ao verem os votos alheios (voto estratégico ou colusão tardia), implementar **commit-reveal**:

```typescript
// src/ai/consensus-commitment.ts
interface VoteCommit {
  personaId: string;
  voteHash: string;      // SHA-256(vote + justification + nonce)
  nonce: string;
  timestamp: number;
}

interface VoteReveal {
  personaId: string;
  vote: 0 | 1 | 2;
  justification: string;
  nonce: string;
}

export class CommitmentScheme {
  async commitPhase(voters: string[]): Promise<VoteCommit[]> {
    // Cada especialista recebe prompt: "Emita seu hash de voto. Não revele o voto ainda."
    // Em nossa implementação, como controlamos as chamadas, geramos os commits
    // via tool call separada `commit_vote` antes de `reveal_vote`.
    return Promise.all(voters.map(async (v) => {
      const nonce = crypto.randomUUID();
      // O LLM gera o voto internamente, mas apenas o hash é exposto
      const internalVote = await this.generateInternalVote(v);
      const voteHash = sha256(`${internalVote.vote}:${internalVote.justification}:${nonce}`);
      return { personaId: v, voteHash, nonce, timestamp: Date.now() };
    }));
  }

  async revealPhase(commits: VoteCommit[]): Promise<VoteReveal[]> {
    // Só após todos os commits estarem no event log, emitir reveals
    // Qualquer reveal que não corresponda ao commit é invalidado (INTEGRITY_FAILURE)
  }
}
```

**Justificativa**: Em orquestração multi-agente onde o mesmo modelo pode atuar como múltiplos especialistas, o voto adaptativo é um risco real de integridade decisória. O commitment scheme é um algoritmo clássico de sistemas distribuídos adaptado para LLMs.

## 6. Pipeline de Segurança para I/O de LLM (Content Security Pipeline)

### 6.1. Arquitetura de Filtros por Fronteira

Cada output de especialista passa por uma pipeline de filtros **antes** de ser persistido no Event Store (pre-commit sanitization). Um evento contaminado nunca entra no log, prevenindo replay de jailbreak.

```typescript
// src/ai/security/content-security-pipeline.ts
export class ContentSecurityPipeline {
  constructor(
    private jailbreakDetector: JailbreakDetector,
    private piiRedactor: PIIRedactor,
    private toolInjectionScanner: ToolInjectionScanner,
    private promptLeakageFilter: PromptLeakageFilter
  ) {}

  async process(output: string, metadata: TurnMetadata): Promise<SecurityResult> {
    // Paralelizar scans independentes
    const [jailbreak, toolInjection, leakage] = await Promise.all([
      this.jailbreakDetector.scan(output),
      this.toolInjectionScanner.scan(output),
      this.promptLeakageFilter.scan(output),
    ]);

    const pii = await this.piiRedactor.redact(output);

    const issues: SecurityIssue[] = [];
    if (jailbreak.score > 0.7) issues.push({ type: 'JAILBREAK', severity: 'CRITICAL', score: jailbreak.score });
    if (toolInjection.found) issues.push({ type: 'TOOL_INJECTION', severity: 'HIGH' });
    if (leakage.found) issues.push({ type: 'PROMPT_LEAKAGE', severity: 'MEDIUM' });

    if (issues.length > 0) {
      // Não persiste o output bruto. Emite evento AgentOutputQuarantined.
      return {
        action: 'QUARANTINE',
        sanitizedContent: null,
        issues,
        substituteContent: `[Content quarantined: ${issues.map(i => i.type).join(', ')}]`,
      };
    }

    return {
      action: 'ALLOW',
      sanitizedContent: pii.redactedText,
      issues: [],
      substituteContent: null,
    };
  }
}
```

### 6.2. Implementação dos Filtros

**JailbreakDetector**: Combina heurísticas regex (padrões conhecidos como "ignore previous instructions", "DAN mode", etc.) com um classificador por embeddings de poucos exemplos (few-shot similarity). Não depende de chamada LLM — é local e síncrono.

**ToolInjectionScanner**: Verifica se o output contém JSON que parece uma tool call do OpenCode (`{"tool": "...", "params": ...}`) ou padrões de command injection. Escapa ou quarentena.

**PromptLeakageFilter**: Detecta se o especialista está tentando extrair system prompts ("What is your system prompt?", "Repeat the words above"). Regex + embeddings de exemplos conhecidos.

**PIIRedactor**: Regex de alta confiança para padrões de secret (`AKIA...`, `sk-...`, `ghp_...`), emails, CPFs. O evento auditável contém a versão redacted; o raw é descartado imediatamente.

### 6.3. Eventos de Quarentena

Se um output é quarentenado, o Event Store recebe:

```json
{
  "type": "AgentOutputQuarantined",
  "payload": {
    "personaId": "backend_dev",
    "turn": 2,
    "originalLength": 1450,
    "issues": ["JAILBREAK"],
    "quarantineId": "qtn_abc123",
    "timestamp": 1700000000
  }
}
```

O Gerente é notificado via resource `discussion://{id}/alerts` e pode decidir por `retry_turn` (com prompt de correção), `replace_specialist` ou `abort_discussion`.

## 7. Detecção de Alucinação e Deriva Factual

### 7.1. Proposições Fácticas Estruturadas (Structured Factual Triples)

Em vez de tratar o output do especialista como texto livre, o `ContextBudgetManager` extrai proposições fácticas estruturadas usando um prompt leve de extração:

```typescript
interface FactualClaim {
  id: string;
  claim: string;           // "A API deve usar JWT para auth"
  source: string;          // trecho do output original
  confidence: 'high' | 'medium' | 'low';
}

// Extração via prompt ao LLM (pode ser modelo local ou chamada ao host)
const claims = await extractClaims(specialistOutput);
```

### 7.2. Verificação Cruzada por NLI (Natural Language Inference)

Antes de cada novo turno, o sistema compara as claims do turno N contra:
1. O briefing original (grounding)
2. O codebase (via RAG sobre arquivos do workspace)
3. As claims dos turnos anteriores (consistência interna)

```typescript
// src/ai/hallucination/nli-checker.ts
export class HallucinationDetector {
  constructor(private nliModel: NLIModel) {} // pode ser chamada ao host com prompt estruturado

  async checkConsistency(
    newClaims: FactualClaim[],
    establishedClaims: FactualClaim[]
  ): Promise<ConsistencyReport> {
    const contradictions: Contradiction[] = [];

    for (const newClaim of newClaims) {
      for (const oldClaim of establishedClaims) {
        // NLI: entailment, contradiction, neutral
        const relation = await this.nliModel.classify(newClaim.claim, oldClaim.claim);
        if (relation === 'contradiction') {
          contradictions.push({ newClaim, oldClaim, severity: 'HIGH' });
        }
      }
    }

    return { contradictions, driftScore: contradictions.length / newClaims.length };
  }
}
```

**Integração com Event Sourcing**: Se `driftScore > 0.3` ou contradição HIGH encontrada, emitir evento `FactualDriftDetected` no log. O Gerente recebe este evento como parte do `Memory Anchor` atualizado e pode solicitar esclarecimento antes de prosseguir.

### 7.3. Grounding via Ferramentas Nativas

Para claims sobre código, o especialista deve ser encorajado (via system prompt) a citar arquivos verificáveis. O `RAG Engine` do Context Budget Manager busca os trechos mencionados no workspace via `file_search` / `file_read` nativos do OpenCode e anexa ao contexto como "evidence".

## 8. Integração com Event Sourcing e Efeitos

### 8.1. Separação de Efeitos Puros e Impuros

Conforme identificado pelo Workflow Architect, a camada de IA deve distinguir:

- **Efeitos puros**: Chamadas LLM com cache hit/miss. Determinísticos se cacheados.
- **Efeitos impuros**: Tool calls nativas do OpenCode (`file_write`, `terminal_run`).

O `AI Effect Interpreter` trata apenas os puros. Os impuros são delegados ao `Workflow Effect Interpreter` com `idempotency_key` e `pending ledger`.

```typescript
// src/ai/effect-interpreter.ts
export class AIEffectInterpreter {
  async interpret(
    event: DiscussionEvent,
    context: TurnContext
  ): Promise<PureEffect[]> {
    switch (event.type) {
      case 'AnalysisTurnStarted': {
        const prompt = assembleSpecialistPrompt(...);
        const cached = await this.inferenceCache.get(cacheKeyFrom(prompt));
        if (cached) return [{ type: 'LLMOutputRecalled', output: cached.output }];

        return [{ 
          type: 'LLMInferenceRequired', 
          prompt,
          idempotencyKey: `${event.discussionId}_turn_${event.turn}_${event.personaId}`,
        }];
      }
      case 'ConsensusRequired': {
        return [{ type: 'ComputeConsensus', votes: event.payload.votes }];
      }
      default:
        return [];
    }
  }
}
```

### 8.2. Deterministic Replay e Testabilidade

Um teste de regressão da camada de IA funciona assim:

```typescript
// tests/ai/regression.spec.ts
test('architecture discussion should reach consensus on microservices', async () => {
  const fixture = loadEventLog('fixtures/discussion_microservices.jsonl');
  const engine = new DiscussionAIEngine({ mode: 'REPLAY', cacheStore });

  // Replay todos os eventos
  for (const event of fixture.events) {
    await engine.replay(event);
  }

  expect(engine.finalPhase).toBe('consensus_reached');
  expect(engine.consensusResult.voteDistribution.agree).toBeGreaterThanOrEqual(3);
  expect(engine.metrics.persuasionDelta).toBeGreaterThan(0.2);
});
```

No modo `REPLAY`, todas as chamadas LLM são atendidas pelo cache. O teste valida apenas a lógica de orquestração, prompts e métricas.

## 9. Performance, Observabilidade e Métricas

### 9.1. Métricas de Qualidade por Discussão

A camada de IA computa automaticamente ao final (ou em tempo real):

| Métrica | Fórmula / Fonte | Threshold de Alerta |
|---------|----------------|---------------------|
| **Participation Rate** | `uniqueContributors / totalParticipants` | < 60% → Alerta |
| **Consensus Strength** | `agreeVotes / totalVotes` | < 0.6 → Weak consensus |
| **Token Efficiency** | `tokensOfValueProduced / totalTokensConsumed` | < 0.1 → Ineficiente |
| **Context Compression Ratio** | `compressedTokens / originalTokens` | > 0.8 → Compressão insuficiente |
| **Factual Drift Rate** | `contradictions / totalClaims` | > 0.2 → Alerta |
| **Persuasion Delta** | `cosineSimilarity(pre, post)` após dissent | < 0.1 → Reopen analysis |
| **Turn Latency P95** | tempo por turno (ms) | > 30000 → Degradação |
| **Quarantine Rate** | `quarantinedOutputs / totalOutputs` | > 0.05 → Segurança comprometida |

### 9.2. Observabilidade Estruturada

```typescript
// src/ai/telemetry.ts
interface InferenceSpan {
  discussionId: string;
  turn: number;
  personaId: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  latencyMs: number;
  cacheHit: boolean;
  safetyIssues: string[];
  hallucinationFlags: number;
}
```

Os spans são escritos em `.tabla/telemetry/inference-spans.ndjson` para análise posterior.

## 10. Especificação de Implementação

### 10.1. Estrutura de Arquivos

```
src/
├── ai/
│   ├── index.ts                      # Exporta AIEngine facade
│   ├── capability-adapter.ts         # ModelCapabilityAdapter
│   ├── inference-cache.ts            # Cache de LLM + modos REPLAY/TEST
│   ├── context-budget/
│   │   ├── manager.ts                # ContextBudgetManager
│   │   ├── retriever.ts              # EventContextRetriever (RAG)
│   │   └── compression-engine.ts     # TurnCompressionEngine
│   ├── prompt-assembler.ts           # Montagem de prompts por especialista
│   ├── memory-anchor.ts              # Geração e versionamento de anchors
│   ├── consensus/
│   │   ├── bias-mitigation.ts        # Shuffle, anonimização
│   │   ├── commitment-scheme.ts      # Commit-reveal de votos
│   │   ├── persuasion-delta.ts       # Métrica de impacto do dissidente
│   │   └── quorum-calculator.ts      # Semântica de quórum configurável
│   ├── security/
│   │   ├── pipeline.ts               # ContentSecurityPipeline
│   │   ├── jailbreak-detector.ts     # Heurística + embeddings
│   │   ├── tool-injection-scanner.ts
│   │   ├── prompt-leakage-filter.ts
│   │   └── pii-redactor.ts
│   ├── hallucination/
│   │   ├── claim-extractor.ts        # Extração de proposições
│   │   ├── nli-checker.ts            # Verificação de consistência
│   │   └── drift-detector.ts         # Emite FactualDriftDetected
│   ├── effects/
│   │   └── interpreter.ts            # AIEffectInterpreter (puros apenas)
│   ├── embeddings/
│   │   ├── interface.ts              # IEmbedder
│   │   └── local-embedder.ts         # Wrapper para onnxruntime + all-MiniLM
│   └── telemetry/
│       └── recorder.ts               # InferenceSpan logging
```

### 10.2. Interfaces Principais

```typescript
// src/ai/types.ts
export interface IAIEngine {
  initialize(capabilities: ModelCapabilityProfile): Promise<void>;
  startDiscussion(config: DiscussionConfig): Promise<DiscussionContext>;
  executeTurn(ctx: DiscussionContext): Promise<TurnResult>;
  computeConsensus(ctx: DiscussionContext): Promise<ConsensusResult>;
  getMetrics(discussionId: string): DiscussionMetrics;
}

export interface DiscussionConfig {
  topic: string;
  participants: SpecialistProfile[];
  maxTurns: number;
  requireDissent: boolean;
  dissentThreshold: number;
  contextBudget: ContextBudget;
  groundingSource?: 'briefing_only' | 'workspace_rag';
}

export interface SpecialistProfile {
  id: string;
  name: string;
  roleType: 'analyst' | 'creative' | 'skeptic' | 'executor';
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  toolsWhitelist: string[];
}
```

### 10.3. Configuração Padrão (Sane Defaults)

```typescript
// src/ai/defaults.ts
export const DEFAULT_AI_CONFIG: DiscussionConfig = {
  maxTurns: 2,
  requireDissent: true,
  dissentThreshold: 0.15,       // Persuasion Delta mínimo para considerar válido
  contextBudget: {
    totalTokens: 128000,
    reservedSystem: 0.10,
    reservedTools: 0.15,
    availableForHistory: 0.75,
    compressionThreshold: 0.80,
  },
  groundingSource: 'workspace_rag',
};
```

**Justificativa**: `maxTurns: 2` é o padrão do protótipo. Pesquisas em "panel of experts" com LLMs mostram retornos decrescentes significativos após 2-3 turnos. O `dissentThreshold` de 0.15 (15% de shift semântico) equilibra eficiência com robustez.

## 11. Casos de Borda e Modos de Falha

### 11.1. Context Window Overflow

**Cenário**: Briefing inicial + código anexo excede 85% da janela antes mesmo do primeiro turno.

**Mitigação**:
1. `ContextBudgetManager` detecta overflow no setup e ativa `EmergencyCompression`: o briefing é sumarizado antes do turno 0.
2. Se ainda exceder, retorna erro `BRIEFING_TOO_LARGE` com instrução ao usuário para dividir o escopo ou usar `file_path` references ao invés de inline code.

### 11.2. Modelo Host Indisponível ou Timeout

**Cenário**: Chamada ao LLM via OpenCode nativa retorna 429 ou timeout após 120s.

**Mitigação**:
1. InferenceCache não ajuda (miss). O `AIEffectInterpreter` marca o efeito como `PENDING` e emite `TurnAwaitingRetry`.
2. Sub-state machine de retry (conforme Workflow Architect) com backoff exponencial.
3. Após `maxRetries` (padrão: 3), transiciona para `TURN_FAILED` e permite substituição do especialista ou abort.

### 11.3. Especialista Gerando Apenas Tool Calls

**Cenário**: O especialista, em vez de analisar, emite uma sequência de `file_search` e `file_read` nativas do OpenCode sem síntese.

**Mitigação**:
1. O `ContentSecurityPipeline` detecta padrão de "output vazio de análise + apenas tool calls" via heurística de comprimento mínimo de justificativa.
2. O `prompt-assembler` inclui instrução obrigatória: "You MUST synthesize your findings into a structured analysis. Tool use alone is insufficient."
3. Se persistir, o turno é marcado como `EMPTY_ANALYSIS` e o especialista pode ser substituído.

### 11.4. Consenso Inatingível (Hung Consensus)

**Cenário**: 50% AGREE, 50% DISAGREE após 2 rounds de debate.

**Mitigação**:
1. Workflow Engine detecta `CONSENSUS_FAILED` após `maxDebateRounds` (padrão: 2).
2. O Gerente recebe resource `discussion://{id}/deadlock` com argumentos de ambos os lados.
3. Decisão humana obrigatória: o Gerente (operador) deve emitir `manager_override` com justificativa, que é registrada como evento `ConsensusOverridden` no log.

## 12. Estratégia de Testes

### 12.1. Testes Unitários com Replay Determinístico

```typescript
// tests/ai/persuasion-delta.spec.ts
test('PersuasionDelta should detect ineffective dissent', async () => {
  const metric = new PersuasionDeltaMetric(mockEmbedder);
  const result = await metric.compute(
    [{ justification: 'Use REST' }, { justification: 'Use REST' }],
    [{ justification: 'Use REST' }, { justification: 'Use REST' }],
    'Actually, use GraphQL' // dissent que ninguém seguiu
  );
  expect(result.consensusShift).toBeLessThan(0.05);
  expect(result.recommendation).toBe('REOPEN_ANALYSIS');
});
```

### 12.2. Testes de Integração com Fixture de Eventos

Fixtures em `tests/fixtures/` contêm logs de discussões reais (com outputs sanitizados). A suíte de integração replaya o log e verifica se o novo código produz o mesmo estado final e as mesmas métricas.

### 12.3. Benchmark de Regressão de Qualidade

Conjunto de 15-20 cenários de arquitetura cobrindo:
- Decisões de API (REST vs GraphQL)
- Padrões de autenticação
- Escolha de banco de dados
- Estratégias de cache

**Critério de aceitação**: A taxa de acordo com o "ground truth" definido por engenheiros sênios deve ser ≥ 85%. O tempo médio de consenso deve ser < 5 minutos em hardware padrão.

## 13. Dependências e Stack Tecnológico

| Componente | Tecnologia | Justificativa |
|------------|-----------|---------------|
| Runtime | Node.js 20+ (OpenCode plugin) | Sandbox do host |
| Embeddings Locais | `onnxruntime-node` + `all-MiniLM-L6-v2` | Sem chamada de rede; privacidade de codebase |
| Vector Store | `vectra` (file-based) ou `hnswlib-node` | Zero config; persistência em `.tabla/vectors/` |
| Schema Validation | Zod | Alinhado com restante do projeto; validação de I/O de agentes |
| Criptografia | Node.js `crypto` (HKDF, HMAC, SHA-256) | Nativo; sem dependências externas |
| Event Processing | EventEmitter nativo + streams | Leve; compatível com lifecycle do plugin |

**Alternativas consideradas**:
- **Chroma/Qdrant**: Requerem servidor separado ou bindings pesados. Descartados para manter o plugin self-contained.
- **OpenAI embeddings API**: Viola privacidade ao enviar código do workspace para API externa. Descartado.
- **LangChain/LlamaIndex**: Abragência excessiva; introduzem abstrações que dificultam controle fino de orçamento de tokens e event sourcing. Descartados em favor de implementação própria focada.

## 14. Contratos com Outras Especialidades

### 14.1. Com Workflow Architect
- Recebe: `DiscussionConfig`, eventos de comando (`StartTurn`, `RequestConsensus`)
- Entrega: Eventos de domínio (`TurnCompleted`, `ConsensusComputed`, `FactualDriftDetected`, `AgentOutputQuarantined`)
- Contrato: Todos os eventos emitidos pela camada de IA são **puros** (sem side effects em filesystem/terminal). Side effects são representados como `PureEffect` objects que o Workflow Engine materializa.

### 14.2. Com Security Engineer
- Recebe: Políticas de redaction, padrões de secret, algoritmo de HMAC para `Vote.signature`
- Entrega: Eventos `SecurityIssueDetected`, versões redacted de outputs
- Contrato: A camada de IA **nunca persiste output bruto sem passar pelo `ContentSecurityPipeline`**. O Event Store só recebe dados sanitizados.

### 14.3. Com MCP Builder
- Recebe: Schema Zod das tools expostas (`open_discussion_round`, `cast_vote`, etc.)
- Entrega: Descrições de tools que incluem **positive instructions** (quando usar) e validação programática de fase
- Contrato: A camada de IA não confia em "negative instructions" no schema. O gatekeeper é a `DiscussionStateMachine` que retorna `isError: true` para tool calls em fase inadequada.

### 14.4. Com Software Architect
- Recebe: Contrato do Event Sourcing (tipos de eventos, projeções CQRS)
- Entrega: Definição de `PureEffect` vs `ImpureEffect`, interface do `AIEffectInterpreter`
- Contrato: O `Decision Core` (IA) é deterministicamente replayável. O `Effect Interpreter` separa decisão de efeito.

## 15. Checklist de Implementação

- [ ] `ModelCapabilityAdapter` com probe no `onActivate`
- [ ] `InferenceCache` com serialização em disco e modos PROD/REPLAY/TEST
- [ ] `ContextBudgetManager` com orçamento hierárquico e compressão automática
- [ ] `EventContextRetriever` com embeddings locais e índice vetorial em arquivo
- [ ] `PromptAssembler` com Memory Anchor imutável e fallback para hosts monolíticos
- [ ] `ConsensusEngine` com randomização, commitment scheme, quorum calculado
- [ ] `PersuasionDeltaMetric` com embedding similarity e gateway condition
- [ ] `ContentSecurityPipeline` com 4 filtros (jailbreak, tool injection, prompt leakage, PII)
- [ ] `HallucinationDetector` com claim extraction e NLI sobre event log
- [ ] `AIEffectInterpreter` separando efeitos puros (LLM) de impuros (tools nativas)
- [ ] `TelemetryRecorder` com spans de inferência em NDJSON
- [ ] Testes de regressão com 15+ fixtures de discussão e validação de métricas

---

*Documento preparado pela perspectiva de Engenharia de IA. Decisões de runtime, persistência em disco e lifecycle do plugin são especificadas nas seções do Software Architect, Workflow Architect e MCP Builder.*
