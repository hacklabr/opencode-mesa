# 08. Efeitos Colaterais, Idempotência e Compensação

## 10.1. Pending Effect Ledger

Antes de chamar qualquer tool nativa do host, o plugin registra a intenção:

```typescript
// src/effects/ledger.ts
interface PendingEffect {
  id: string;                    // ef_<uuid>
  discussionId: string;
  type: 'native_tool_call' | 'llm_inference';
  toolName?: string;
  params: object;
  idempotencyKey: string;        // disc_{id}_step_{index}
  status: 'intent' | 'committed' | 'compensated';
  createdAt: number;
}

async function recordIntent(effect: PendingEffect): Promise<void> {
  await fs.writeJson(`.tabla/effects/pending-${effect.id}.json`, effect);
}
```

## 10.2. Efeitos Puros vs. Impuros

| Tipo | Exemplo | Re-executável? | Reconciliação |
|------|---------|----------------|---------------|
| **Puro** | `llm_inference` (com cache) | Sim (determinístico com cache) | Re-executar com idempotency key |
| **Impuro** | `file_write`, `git_commit` | Não | Verificar se efeito já foi aplicado antes de re-executar |

## 10.3. Compensating Transactions (Saga Pattern)

Se uma fase falha após efeitos já aplicados, o Workflow Engine executa compensações na ordem inversa (LIFO):

```typescript
// src/workflow/compensation.ts
interface CompensationAction {
  originalEffectId: string;
  type: 'delete_file' | 'delete_note' | 'revert_git';
  params: object;
}

async function compensate(discussionId: string, failureStep: number): Promise<void> {
  const ledger = await loadEffectLedger(discussionId);
  const effectsToUndo = ledger
    .filter(e => e.stepIndex <= failureStep && e.status === 'committed')
    .reverse(); // LIFO
  
  for (const effect of effectsToUndo) {
    const comp = getCompensation(effect);
    await executeCompensation(comp);
    await markCompensated(effect.id);
  }
}
```

**Restrição de Segurança**: O plugin só pode compensar (deletar/reverter) artefatos que constem no `Provenance Registry` do event log. `file_delete` de arquivos não criados pela mesa é bloqueado.

## 6. Abort, Cleanup & Compensation (Saga) (Workflow Architect)

When any phase fails, the engine must restore the workspace to a consistent state. The prototype had no cleanup. This specification implements a **Compensation Stack** (LIFO) paired with a **Cleanup Inventory**.

### 6.1 Cleanup Inventory

Every effect that creates a workspace resource must register a compensating action at the moment the `EffectCommitted` event is appended.

| Resource | Created By | Compensated By | Condition |
|---|---|---|---|
| `docs/spec-{id}.md` | `DOCUMENTATION` phase | `file_delete` | If not human-approved |
| `Task` (via OpenCode task system) | `DELEGATION` step | `delete_task` | If task incomplete |
| `Note` (via OpenCode notes) | `SETUP` / `ANALYSIS` | `delete_note` | If discussion cancelled |
| `Git commit` | `EXECUTION` step | `git_revert` | If execution fails post-commit |
| File written by delegated specialist | `EXECUTION` step | `file_delete` | If recorded in provenance registry |

### 6.2 Compensation Algorithm

```typescript
// src/workflow/compensator.ts
class CompensationStack {
  private stack: CompensationRecord[] = [];

  push(record: CompensationRecord): void {
    this.stack.push(record);
  }

  async executeAll(context: EffectContext): Promise<CompensationResult> {
    // LIFO order
    const reversed = [...this.stack].reverse();
    for (const record of reversed) {
      try {
        await context.interpreter.compensate(record);
        await context.eventStore.append({
          type: 'EffectCompensated',
          payload: { record }
        } as WorkflowEvent);
      } catch (err) {
        await context.eventStore.append({
          type: 'CompensationFailed',
          payload: { record, error: String(err) }
        } as WorkflowEvent);
        throw new CompensationFailureError(record);
      }
    }
  }
}
```

**Failure Mode**: If a compensation fails (e.g., file already deleted by human), the workflow transitions to `CLEANUP_FAILED` (terminal). The operator must intervene manually. The engine **never** silently ignores a failed compensation.

## 8. Effect Interpreter & Native Tool Call Idempotency

The Effect Interpreter is the **only** module allowed to invoke OpenCode native tools. It guarantees exactly-once semantics for impure effects via a **Pending Effect Ledger**.

### 8.1 Effect Classification

| Type | Example | Idempotency Strategy |
|---|---|---|
| **Pure** | LLM inference (analysis turn) | Inference Cache keyed by `(prompt_hash, model, seed)` (see AI Engineer spec) |
| **Impure: Idempotent** | `create_task` with unique id | Idempotency key derived from discussion/step |
| **Impure: Non-Idempotent** | `git_commit`, `file_delete` | Ledgered with pre-commit intent + post-commit verification |

### 8.2 Pending Effect Ledger

Before executing an impure effect, the interpreter writes an intent file. After host confirmation, it appends a committed event.

```typescript
// src/workflow/effect-interpreter.ts
interface PendingEffect {
  effect_id: string;
  discussion_id: string;
  type: 'native_tool_call';
  tool_name: string;
  idempotency_key: string;       // sha256(discussion_id:phase:step_index:attempt)
  params_hash: string;
  status: 'intent' | 'committed' | 'compensated';
  created_at: number;
}

class EffectInterpreter {
  async execute(effect: EffectRequest): Promise<EffectResult> {
    const idempotencyKey = this.deriveKey(effect);
    const existing = await this.ledger.findByKey(idempotencyKey);

    if (existing?.status === 'committed') {
      return { status: 'already_committed', result: existing.result };
    }

    // Write intent BEFORE calling host
    await this.ledger.write({ ...effect, idempotency_key: idempotencyKey, status: 'intent' });
    await this.eventStore.append({ type: 'EffectIntended', payload: { idempotencyKey } } as WorkflowEvent);

    const result = await this.host.executeTool(effect.tool_name, effect.params, { idempotencyKey });

    await this.ledger.write({ ...effect, status: 'committed', result });
    await this.eventStore.append({ type: 'EffectCommitted', payload: { idempotencyKey, result } } as WorkflowEvent);

    return { status: 'committed', result };
  }
}
```

### 8.3 Crash Recovery of Pending Effects

On plugin activation, the `RecoveryService` scans `.tabla/effects/pending-*.json`:

```typescript
// src/workflow/recovery.ts
async reconcilePendingEffects(): Promise<void> {
  const intents = await this.ledger.listByStatus('intent');
  for (const intent of intents) {
    if (await this.host.verifyEffectCommitted(intent.idempotency_key)) {
      // Host already executed before crash; just project state forward
      await this.ledger.promoteToCommitted(intent.effect_id);
    } else {
      // Safe to re-execute because idempotency key is identical
      await this.interpreter.reExecute(intent);
    }
  }
}
```
