# 12. Gaps, Próximos Passos e Checklist

## 15. Dependências e Próximos Passos Críticos

Para finalizar o design e iniciar a implementação, as seguintes informações sobre o host OpenCode devem ser validadas:

1. **API de Registro de Tools**: O plugin registra tools dinamicamente via objeto/JSON, ou precisa de manifesto estático?
2. **Persistência no Workspace**: O plugin tem acesso garantido de escrita/leitura em subdiretórios do workspace?
3. **Lifecycle Hooks**: Existem callbacks explícitos `onActivate` / `onDeactivate`?
4. **Human Input / Aprovação**: Como o plugin pode apresentar uma escolha bloqueante (Aprovar/Rejeitar) ao operador?
5. **Secrets/Keys**: O OpenCode oferece API para plugins armazenarem/lerem secrets scoped?
6. **Múltiplos Agentes/Models**: O plugin pode solicitar inferências com diferentes system prompts/temperatures, ou o host é monolítico?

**Até que estas questões sejam respondidas**, a camada `adapters/opencode-tools.ts` deve ser implementada como **interface com stub/mock**, permitindo que todo o domínio (`workflow`, `domain`, `security`) seja desenvolvido e testado independentemente da integração final.

## 14. Perguntas Críticas Pendentes para Validação (MCP Builder)

1. **O OpenCode permite a um plugin registrar ferramentas dinamicamente no runtime?** Ou o schema é estático no momento do load? Isso define se conseguimos implementar Dynamic Tool Availability.
2. **O OpenCode suporta URI templates para resources?** Ou apenas URIs estáticas? Afeta `discussion://{id}/state`.
3. **O OpenCode expõe API para prompts contextuais condicionais?** Ou o plugin deve injetar texto no system prompt manualmente?
4. **Como o plugin acessa múltiplas "personas" ou especialistas?** Eles são instâncias separadas de LLM, ou o plugin apenas estrutura system prompts alternados para o mesmo modelo?
5. **O OpenCode oferece um secrets vault por plugin?** Necessário para derivar chaves HMAC de forma segura.

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

## 15. Checklist de Implementação (AI Engineer)

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
