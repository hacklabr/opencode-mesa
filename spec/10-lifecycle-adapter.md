# 10. Lifecycle do Plugin e Adapter Layer

## 11.1. Plugin Lifecycle Adapter

```typescript
// src/lifecycle/adapter.ts
class PluginLifecycleAdapter {
  async onActivate(): Promise<void> {
    // 1. Derivar chave HMAC
    this.securityLayer.initializeKey(await this.host.getWorkspaceSecret?.() || generateEphemeralKey());
    
    // 2. Recuperar discussions interrompidas
    await this.workflowEngine.recoverDiscussions();
    
    // 3. Registrar tools no host
    await this.opencodeBridge.registerTools(this.toolRegistry.getDefinitions());
  }
  
  async onDeactivate(): Promise<void> {
    // 1. Cancelar AbortControllers pendentes
    this.workflowEngine.abortAllRunning();
    
    // 2. Persistir checkpoints
    for (const [id, machine] of this.workflowEngine.machines) {
      await this.eventStore.append(id, {
        type: 'CheckpointSaved',
        phase: machine.state.phase,
        operationStatus: machine.state.operation?.status,
        timestamp: Date.now(),
        _integrity: await this.securityLayer.sign({ id, phase: machine.state.phase }),
      });
    }
    
    // 3. Secure wipe de chaves em memória
    this.securityLayer.destroyKeys();
  }
}
```

## 11.2. Reconciliação de Estado Externo

O operador humano pode editar arquivos manualmente durante uma discussão. Antes de transições críticas (`APPROVAL`, `EXECUTION`), o Workflow Engine executa `reconcileExternalState()`:

```typescript
async function reconcileDocumentState(discussion: Discussion): Promise<void> {
  if (!discussion.document?.path) return;
  
  const currentHash = await hashFile(discussion.document.path);
  if (currentHash !== discussion.document.contentHash) {
    await eventStore.append(discussion.id, {
      type: 'DocumentDiverged',
      expectedHash: discussion.document.contentHash,
      actualHash: currentHash,
      timestamp: Date.now(),
    });
    throw new DocumentDivergedError('Document was modified externally. Regeneration required.');
  }
}
```

## 7. Integração com OpenCode: Adapter Layer

### 7.1. Princípio do Adapter

A camada de Adapter isola o domínio do contrato externo do OpenCode. Se o OpenCode mudar sua API de registro de ferramentas (ex: de hooks para middleware), apenas o Adapter muda; o Domain e o Workflow permanecem intactos.

```typescript
// src/adapters/opencode-tools.ts
interface OpenCodeToolBridge {
  fileWrite(path: string, content: string): Promise<void>;
  terminalRun(command: string, cwd?: string): Promise<TerminalResult>;
  notifyUser(message: string): Promise<void>;
  // Abstração genérica para qualquer tool nativa
  executeNative(toolName: string, params: Record<string, unknown>): Promise<unknown>;
}

// Implementação real varia conforme APIs expostas pelo host
class OpenCodeNativeBridge implements OpenCodeToolBridge {
  async fileWrite(path: string, content: string): Promise<void> {
    // Traduz para a tool call nativa do host
    return this.host.callTool('file_write', { file_path: path, content });
  }
  
  async terminalRun(command: string, cwd?: string): Promise<TerminalResult> {
    return this.host.callTool('terminal_run', { command, cwd });
  }
}
```

### 7.2. Registro de Tools do Plugin

O plugin expõe ferramentas de alta intenção para o agente OpenCode. O Adapter traduz o registro interno (MCP-style) para o formato nativo do host.

**Tools expostas:**

| Tool Name | Quando Usar | Schema Zod |
|-----------|-------------|------------|
| `open_discussion_round` | Iniciar análise colaborativa | `{ topic: string, participants: string[], max_turns?: number, briefing_content: string }` |
| `request_consensus` | Solicitar votação após análise completa | `{ discussion_id: string }` |
| `cast_vote` | Registrar voto em consenso ativo | `{ discussion_id: string, vote: 0\|1\|2, justification: string }` |
| `generate_specification` | Gerar documento pós-consenso | `{ discussion_id: string, output_path?: string }` |
| `delegate_to_specialist` | Delegar tarefa de implementação | `{ persona_id: string, instruction: string, discussion_id: string }` |
| `pause_discussion` | Pausar operação em andamento | `{ discussion_id: string }` |
| `cancel_discussion` | Cancelar e limpar recursos | `{ discussion_id: string }` |
| `resume_discussion` | Retomar após pausa/crash | `{ discussion_id: string }` |

### 7.3. Dynamic Tool Availability (Restrição de Fase)

Se o host permitir, tools como `cast_vote` devem ser **desregistradas ou mascaradas** quando a fase atual não for `consensus`. Se o host não suportar schema mutável, a validação programática retorna `isError: true`:

```typescript
// src/adapters/tool-gatekeeper.ts
function validateToolCall(discussionId: string, toolName: string, state: DiscussionState): ValidationResult {
  const allowedTools = getToolsForPhase(state.phase);
  if (!allowedTools.includes(toolName)) {
    return {
      isError: true,
      message: `Tool '${toolName}' is not available in phase '${state.phase}'. Available: ${allowedTools.join(', ')}`,
    };
  }
  return { isError: false };
}
```
