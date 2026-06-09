# 02. Modelo de Domínio e Eventos

## 4.1. Bounded Contexts

O plugin possui **dois bounded contexts** principais:

1. **`Discussion Management`**: Ciclo de vida da mesa (fases, turnos, votos, aprovação)
2. **`Agency Integration`**: Resolução e validação de especialistas do catálogo externo

A comunicação entre eles é unidirecional: `Discussion Management` consome `SpecialistProfile` do contexto `Agency`, mas nunca expõe estado interno de discussão para o catálogo.

## 4.2. Aggregate Roots

### `Discussion` (Aggregate Root)

```typescript
// src/domain/aggregates.ts
interface Discussion {
  id: string;                    // disc_<uuid>
  status: DiscussionStatus;      // open | paused | cancelled | completed
  phase: DiscussionPhase;        // setup | analysis | analysis_complete | consensus | documentation | approval | execution | done
  config: DiscussionConfig;
  participants: SpecialistRef[]; // refs resolvidas via ACL
  analysis: AnalysisBlock;
  consensus: ConsensusBlock | null;
  document: DocumentBlock | null;
  approval: ApprovalRecord | null;
  budget: TimeBudgetTree;
  createdAt: number;
  updatedAt: number;
}

interface DiscussionConfig {
  maxTurns: number;              // padrão: 2
  maxDepth: number;              // padrão: 1 (prevenção de reentrancy)
  requireDissent: boolean;       // true: exige evento DISSENT antes de consensus
  quorumMin: number;             // padrão: 0.6 (60% dos participantes únicos)
  autoAdvance: boolean;          // se true, engine avança fase automaticamente quando precondições satisfeitas
}
```

### `Delegation` (Aggregate Associado)

```typescript
// src/domain/delegation.ts
interface Delegation {
  id: string;                    // del_<uuid>
  discussionId: string;
  specialistId: string;
  instruction: string;           // payload textual
  requiredTools: string[];       // ferramentas declaradas; validadas contra whitelist do especialista
  status: DelegationStatus;      // pending | running | completed | failed | compensated
  timeoutMs: number;
  createdAt: number;
  completedAt: number | null;
}
```

## 4.3. Domain Events (Event Sourcing)

Todo mutação de estado é representada como um evento imutável no log `.tabla/events/discussion-{id}.jsonl`.

```typescript
// src/domain/events.ts
type DomainEvent = 
  | DiscussionOpened
  | SpecialistResolved
  | AnalysisTurnStarted
  | AgentOutputReceived
  | AgentOutputQuarantined      // sanitização pré-commit rejeitou output
  | AnalysisTurnCompleted
  | DissentRegistered
  | DissentWaived
  | ConsensusRequested
  | VoteCommitted               // commitment scheme: hash do voto primeiro
  | VoteRevealed                // voto em si
  | ConsensusReached
  | ConsensusFailed             // quorum não atingido
  | DocumentationGenerated
  | DocumentDiverged            // hash do arquivo no disco diverge do event log
  | ApprovalGranted
  | ApprovalRejected
  | DelegationCreated
  | DelegationCompleted
  | PhaseTimeout
  | DiscussionCancelled
  | CheckpointSaved;

// Exemplo concreto de evento
interface VoteRevealed {
  type: 'VoteRevealed';
  eventId: string;              // uuid v4
  discussionId: string;
  turn: number;
  personaId: string;
  vote: 0 | 1 | 2;              // DISAGREE | AGREE | AGREE_WITH_RESERVATIONS
  justification: string;
  nonce: string;                // prevenção de replay
  timestamp: number;
  _integrity: string;           // HMAC-SHA256 dos campos acima
}
```

## 4.4. Read Models (Projeções CQRS)

O estado atual não é lido diretamente do event log em tempo real para o LLM (seria lento e verboso). O `Persistence Layer` mantém **projeções materializadas** em `.tabla/state/discussion-{id}.snapshot.json`, derivadas do event log. Estas projeções correspondem aos Resources MCP discutidos:

- `discussion://{id}/state` → `DiscussionSnapshot`
- `discussion://{id}/transcript` → `TranscriptProjection`
- `discussion://{id}/audit` → `AuditProjection`

```typescript
// src/persistence/projections.ts
interface DiscussionSnapshot {
  id: string;
  phase: DiscussionPhase;
  status: DiscussionStatus;
  currentTurn: number;
  pendingApprovals: PendingApproval[];
  lastEventId: string;          // para optimistic concurrency control
  projectedAt: number;
}
```

## 8. Modelos de Dados TypeScript (MCP Builder)

### 8.1. Event Store Schema

```typescript
type DiscussionEvent =
  | { type: 'DiscussionOpened'; id: string; topic: string; participants: string[]; max_turns: number; timestamp: number }
  | { type: 'AnalysisTurnStarted'; turn: number; persona_id: string; operation_id: string }
  | { type: 'AgentOutputReceived'; persona_id: string; content_hash: string; turn: number }
  | { type: 'AgentOutputQuarantined'; reason: string; persona_id: string }
  | { type: 'VoteCast'; persona_id: string; vote: 0 | 1 | 2; nonce: string; signature: string }
  | { type: 'DissentRegistered'; persona_id: string; persuasion_delta?: number }
  | { type: 'DiscussionCancelled'; reason: string; by: 'user' | 'system' | 'manager' }
  | { type: 'DocumentGenerated'; path: string; content_hash: string }
  | { type: 'HumanApproved'; approved_by: 'human'; nonce: string; document_hash: string }
  | { type: 'Delegated'; delegation_id: string; persona_id: string; required_tools: string[] };

interface StoredEvent<T extends DiscussionEvent = DiscussionEvent> {
  event_id: string;      // ULID para ordenação lexicográfica
  discussion_id: string;
  payload: T;
  _integrity: string;    // HMAC-SHA256 do payload serializado
}
```

### 8.2. Discussion State (Projeção)

```typescript
interface DiscussionState {
  id: string;
  phase: 'setup' | 'analysis' | 'analysis_complete' | 'consensus' | 'documentation' | 'approval' | 'execution' | 'completed' | 'cancelled';
  status: 'open' | 'paused' | 'running';
  config: {
    max_turns: number;
    require_dissent: boolean;
    quorum_ratio: number;
  };
  analysis: {
    turns_completed: number;
    turns_total: number;
    messages: Array<{ persona_id: string; content_hash: string }>;
  };
  consensus: {
    round: number;
    votes: Array<{ persona_id: string; vote: 0|1|2; nonce: string }>;
    quorum_met: boolean;
  };
  document: {
    path: string;
    content_hash: string;
  } | null;
  approval: {
    approved_by: 'human';
    nonce: string;
    approved_at: number;
  } | null;
  budget: {
    analysis: { consumed: number; total: number };
    consensus: { consumed: number; total: number };
  };
  transitions: Array<{ from: string; to: string; at: number; trigger: string }>;
}
```

## 14. Data Models (Workflow Architect)

### 14.1 DiscussionState (Projection)

```typescript
// src/workflow/types.ts
interface DiscussionState {
  id: string;
  phase: DiscussionPhase;
  status: 'open' | 'paused' | 'running' | 'cancelled';
  config: DiscussionConfig;
  participants: string[];
  currentTurn: number;
  maxTurns: number;
  operation?: OperationContext;
  consensus?: ConsensusState;
  document?: {
    path: string;
    contentHash: string;
  };
  approval?: {
    approvedBy: 'human';
    approvedAt: number;
    nonce: string;
  };
  compensationStack: CompensationRecord[];
  budget: TimeBudgetNode;
  transitionHistory: TransitionRecord[];
  createdAt: number;
  updatedAt: number;
}

interface DiscussionConfig {
  topic: string;
  participants: string[];
  max_turns: number;
  require_dissent: boolean;
  dissent_threshold?: number; // Persuasion Delta minimum (AI Engine concern)
  quorum_min: number;         // 0.0 - 1.0
  auto_advance: boolean;      // if false, wait for manager tool call between phases
  time_budget: TimeBudgetNode;
}
```

### 14.2 Event Union (Simplified)

```typescript
type WorkflowEvent =
  | { type: 'DiscussionOpened'; payload: { config: DiscussionConfig } }
  | { type: 'AnalysisTurnStarted'; payload: { turn: number; persona_id: string } }
  | { type: 'AnalysisTurnCompleted'; payload: { turn: number; output_hash: string } }
  | { type: 'AgentOutputReceived'; payload: { persona_id: string; content: string; sanitized: boolean } }
  | { type: 'DissentRegistered'; payload: { persona_id: string; persuasion_delta: number } }
  | { type: 'VoteRevealed'; payload: Vote }
  | { type: 'ConsensusReached'; payload: { tally: Tally; quorum_met: true } }
  | { type: 'DocumentGenerated'; payload: { path: string; content_hash: string } }
  | { type: 'ApprovalGranted'; payload: { nonce: string; document_hash: string } }
  | { type: 'EffectIntended'; payload: { effect_id: string; idempotency_key: string } }
  | { type: 'EffectCommitted'; payload: { effect_id: string; result_hash: string } }
  | { type: 'CheckpointSaved'; payload: { checkpoint: string } }
  | { type: 'DiscussionCancelled'; payload: { reason: string } };
```
