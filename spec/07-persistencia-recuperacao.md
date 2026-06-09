# 07. Event Sourcing, Persistência e Recuperação

## 6.1. Estrutura de Diretórios no Workspace

```
workspace/
└── .tabla/
    ├── events/
    │   └── discussion-{id}.jsonl          # fonte da verdade
    ├── effects/
    │   └── pending-{effect-id}.json       # intenções antes de executar no host
    ├── state/
    │   └── discussion-{id}.snapshot.json  # projeção derivada (deletável, recriável)
    ├── specs/
    │   └── spec-{id}.md                   # artefatos gerados
    └── audit/
        └── discussion-{id}.audit.jsonl    # log append-only de auditoria de segurança
```

## 6.2. Formato do Event Log

Cada linha é um JSON válido (JSON Lines). O arquivo é **append-only**; nunca é editado in-place.

```jsonl
{"type":"DiscussionOpened","eventId":"evt_001","discussionId":"disc_abc123","timestamp":1700000000000,"config":{"maxTurns":2,"quorumMin":0.6},"_integrity":"hmac_sha256_abc..."}
{"type":"SpecialistResolved","eventId":"evt_002","discussionId":"disc_abc123","personaId":"architect","timestamp":1700000001000,"_integrity":"hmac_sha256_def..."}
{"type":"AnalysisTurnStarted","eventId":"evt_003","discussionId":"disc_abc123","turn":1,"personaId":"architect","timestamp":1700000002000,"_integrity":"hmac_sha256_ghi..."}
```

## 6.3. HMAC e Integridade

```typescript
// src/security/hmac.ts
class EventIntegrity {
  constructor(private key: Buffer) {}
  
  async sign(payload: object): Promise<string> {
    const data = canonicalize(payload); // JSON deterministico, chaves ordenadas
    return createHmac('sha256', this.key).update(data).digest('hex');
  }
  
  async verify(payload: object, signature: string): Promise<boolean> {
    const expected = await this.sign(payload);
    return timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  }
}
```

**Geração de Chave**: A chave HMAC é derivada via HKDF a partir de um `workspaceSecret` fornecido pelo OpenCode (se disponível via API de secrets) ou gerada efêmera no `onActivate` e armazenada em memória apenas (nunca em texto plano em disco). Se o host não oferecer vault, o plugin gera uma chave por sessão e aceita que eventos de sessões anteriores não serão verificáveis (mas ainda são auditáveis).

## 6.4. Optimistic Concurrency Control (OCC)

Para prevenir race conditions em cenários de múltiplas janelas ou recarregamento rápido do plugin:

```typescript
// src/persistence/event-store.ts
async append(discussionId: string, event: DomainEvent, expectedLastEventId?: string): Promise<void> {
  const logPath = getLogPath(discussionId);
  
  // Lock consultivo via arquivo .lock (ou atomic rename se filesystem permitir)
  await withFileLock(logPath, async () => {
    const lastLine = await readLastLine(logPath);
    const lastEvent = lastLine ? JSON.parse(lastLine) : null;
    
    if (expectedLastEventId && lastEvent?.eventId !== expectedLastEventId) {
      throw new ConcurrencyConflictError(
        `Expected last event ${expectedLastEventId}, found ${lastEvent?.eventId}`
      );
    }
    
    await appendLine(logPath, JSON.stringify(event));
  });
}
```

## 6.5. Recuperação após Crash (Rehydration)

```typescript
// src/lifecycle/adapter.ts
async onPluginActivate(): Promise<void> {
  const stateFiles = await glob('.tabla/events/discussion-*.jsonl');
  
  for (const file of stateFiles) {
    const discussionId = extractIdFromFilename(file);
    const log = await this.eventStore.readStream(discussionId);
    const lastEvent = log[log.length - 1];
    
    if (lastEvent && lastEvent.type !== 'DiscussionCompleted' && lastEvent.type !== 'DiscussionCancelled') {
      const machine = await this.workflowEngine.loadMachine(discussionId);
      
      // Reconciliar efeitos pendentes
      await this.effectInterpreter.reconcilePendingEffects(discussionId);
      
      // Se havia operação em andamento, notificar UI que retomou
      await this.opencodeBridge.notify(`Discussion ${discussionId} recovered at phase ${machine.state.phase}`);
    }
  }
}
```

## 3. Event Sourcing & Audit Log (Workflow Architect)

All facts are persisted as an append-only stream of typed events in **JSON Lines** format. The event log is the sole source of truth; the `DiscussionState` object is a **projection**.

### 3.1 File Layout

```
${workspaceRoot}/.tabla/
  events/
    discussion-{id}.jsonl       # canonical event store
  snapshots/
    discussion-{id}.snapshot    # periodic snapshot for fast rehydration
  effects/
    pending-{effect-id}.json    # intent ledger for native tool calls
  state/
    discussion-{id}.json        # deprecated; do not use (legacy from prototype)
```

**Rationale**: Keeping events, snapshots, and effect ledgers in separate subdirectories prevents accidental corruption of the write-ahead log during snapshot I/O.

### 3.2 Event Schema (Canonical)

Every event carries an integrity field for tamper detection (see Section 8).

```typescript
// src/workflow/types.ts
type WorkflowEvent =
  | DiscussionOpened
  | AnalysisTurnStarted
  | AnalysisTurnCompleted
  | AgentOutputReceived
  | DissentRegistered
  | DissentWaived
  | ConsensusRequested
  | VoteCommitted          // Hash commitment (Security requirement)
  | VoteRevealed           // Actual vote payload
  | ConsensusReached
  | ConsensusFailed
  | DocumentGenerated
  | DocumentHashVerified
  | ApprovalGranted
  | ApprovalRejected
  | ExecutionStarted
  | TaskDelegated
  | TaskCompleted
  | TaskFailed
  | EffectIntended
  | EffectCommitted
  | EffectCompensated
  | CompensationFailed
  | CheckpointSaved
  | DiscussionCancelled
  | StateReconciled;

interface BaseEvent {
  event_id: string;          // ulid
  discussion_id: string;
  type: string;
  timestamp: number;         // epoch ms
  _integrity: {
    hmac: string;            // HMAC-SHA256 of canonical JSON payload
    alg: 'HS256';
  };
}

interface DiscussionOpened extends BaseEvent {
  type: 'DiscussionOpened';
  payload: {
    topic: string;
    participants: string[];
    max_turns: number;
    config: DiscussionConfig;
  };
}
```

### 3.3 Snapshotting & Projection

To avoid replaying thousands of events on every read, the engine writes snapshots every `N` events or on graceful deactivation.

```typescript
// src/workflow/event-store.ts
class EventStore {
  async append(event: WorkflowEvent): Promise<void> {
    const line = JSON.stringify(event);
    await this.host.file_write(
      `.tabla/events/discussion-${event.discussion_id}.jsonl`,
      line + '\n',
      { append: true }
    );
  }

  async getProjectedState(discussionId: string): Promise<DiscussionState> {
    const snapshot = await this.loadLatestSnapshot(discussionId);
    const events = await this.loadEventsAfter(discussionId, snapshot?.event_id);
    return this.projector.fold(snapshot?.state ?? this.emptyState(discussionId), events);
  }
}
```

**Justification**: Event stores are append-only and small per discussion; snapshots keep rehydration under 100ms even for long discussions.

## 12. Crash Recovery & Plugin Lifecycle (Workflow Architect)

The OpenCode host may unload/reload the plugin at any time. The engine must survive with zero data loss.

### 12.1 Checkpoint Event

On `onDeactivate` (if exposed by OpenCode lifecycle hooks), or before any expensive native tool call:

```typescript
await eventStore.append({
  type: 'CheckpointSaved',
  payload: {
    phase: state.phase,
    operation_checkpoint: state.operation?.checkpoint,
    pending_effect_ids: Array.from(pendingEffects.keys()),
  },
} as WorkflowEvent);
```

### 12.2 Rehydration Sequence on `onActivate`

```typescript
// src/workflow/recovery.ts
async onPluginActivate(): Promise<void> {
  // 1. Scan for unfinished discussions
  const discussions = await this.store.listUnfinished();

  for (const id of discussions) {
    // 2. Re-project state from events
    const state = await this.engine.rehydrate(id);

    // 3. Reconcile pending effects
    await this.effectInterpreter.reconcile(state.id);

    // 4. Reconstruct AbortControllers (fresh instances; old ones are lost)
    if (state.operation?.status === 'running') {
      // Prompt user or auto-resume based on config
      await this.promptForResume(state);
    }
  }
}
```

### 12.3 Pure vs. Impure Re-execution

| Effect Type | Recovery Action |
|---|---|
| Pure (LLM inference) | Re-execute safely using Inference Cache; deterministic if cache hit. |
| Impure with idempotency key | Verify with host; re-execute only if missing. |
| Impure without host verification | Mark as `RECONCILIATION_REQUIRED` and pause for operator. |

## 13. State Reconciliation Against External Modifications

Humans and other plugins can modify the workspace during a discussion. Before critical transitions, the engine verifies workspace reality against the event log.

### 13.1 Reconciliation Points

| Transition | Check | Action on Divergence |
|---|---|---|
| `DOC_PENDING → APPROVAL` | Hash `docs/spec-{id}.md` vs `DocumentGenerated.contentHash` | Transition to `DOCUMENT_DIVERGED` |
| `APPROVAL → EXECUTION` | Re-hash document; compare with `ApprovalGranted.document_hash` | Invalidate approval; return to `REVISION` |
| `EXECUTION → DONE` | Verify delegated task status matches `TaskCompleted` event | Transition to `EXECUTION` with reconciliation alert |

```typescript
// src/workflow/reconciliation.ts
class ReconciliationService {
  async verifyDocument(discussion: DiscussionState): Promise<ReconcileResult> {
    const currentHash = await this.host.hashFile(discussion.document.path);
    if (currentHash !== discussion.document.contentHash) {
      return { status: 'DIVERGED', expected: discussion.document.contentHash, actual: currentHash };
    }
    return { status: 'MATCH' };
  }
}
```
