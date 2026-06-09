# Especificação: Plugin Mesa de Discussão (OpenCode)

Este diretório contém a especificação completa do plugin **Mesa de Discussão**, dividida em arquivos temáticos para facilitar a navegação por agentes de IA e desenvolvedores.

> **Diretriz de Leitura:** Não leia todos os arquivos. Identifique sua tarefa e vá direto ao arquivo semântico correspondente. Cada arquivo é auto-contido para seu escopo.

## Índice Semântico

| Arquivo | Escopo | Leia se você está... |
|---------|--------|----------------------|
| [01-visao-arquitetural.md](./01-visao-arquitetural.md) | Princípios de design, ADRs, análise do protótipo tabla-go, riscos arquiteturais | Definindo a estrutura geral do plugin ou tomando decisões arquiteturais |
| [02-modelo-dominio.md](./02-modelo-dominio.md) | Aggregates (`Discussion`, `Delegation`), Domain Events, Read Models (CQRS), bounded contexts | Implementando o núcleo do domínio, eventos e projeções |
| [03-workflow-state-machine.md](./03-workflow-state-machine.md) | State machine hierárquica, `TablaWorkflowEngine`, handoff contracts, retry, time budget, vote collection | Implementando a orquestração de fases, transições e regras de workflow |
| [04-mcp-interface.md](./04-mcp-interface.md) | Tool Registry, Resource Providers, Prompt Templates (State Guards), adapter OpenCode, disponibilidade dinâmica de tools | Implementando o contrato MCP exposto ao agente OpenCode |
| [05-camada-ia.md](./05-camada-ia.md) | Model Capability Adapter, Context Budget, RAG, Prompt Assembly, Memory Anchor, consenso (bias, commitment), hallucination detection, telemetry | Implementando a camada de IA, prompts, orquestração de especialistas e qualidade de consenso |
| [06-seguranca.md](./06-seguranca.md) | Threat Model (STRIDE), criptografia (HMAC/HKDF), integridade de eventos, RBAC, Content Security Pipeline, delegation gate, vote integrity, incident response | Implementando controles de segurança, sanitização e integridade |
| [07-persistencia-recuperacao.md](./07-persistencia-recuperacao.md) | Event Sourcing (append-only JSONL), snapshots, HMAC/Hash chain, OCC, rehydration após crash | Implementando a camada de persistência e recuperação de estado |
| [08-efeitos-compensacao.md](./08-efeitos-compensacao.md) | Pending Effect Ledger, efeitos puros vs impuros, compensating transactions (Saga), idempotência | Implementando o controle de efeitos colaterais e rollback |
| [09-agency-especialistas.md](./09-agency-especialistas.md) | Anti-Corruption Layer do catálogo, `SpecialistProfile`, schema Zod, Devil's Advocate | Implementando a integração com o catálogo de especialistas |
| [10-lifecycle-adapter.md](./10-lifecycle-adapter.md) | Plugin lifecycle (`onActivate`/`onDeactivate`), reconciliação de estado externo, OpenCode Adapter | Implementando o ciclo de vida do plugin e a bridge com o host |
| [11-testes-validacao.md](./11-testes-validacao.md) | Testes unitários, deterministic replay, agent testing, testes de segurança adversariais, SAST | Definindo a estratégia de testes e validação |
| [12-gaps-proximos-passos.md](./12-gaps-proximos-passos.md) | Gap analysis (descartar/reescrever/construir), perguntas críticas pendentes, checklist de implementação | Planejando a implementação ou levantando requisitos do host |

## Convenções

- **Código:** TypeScript / Zod
- **Persistência:** Append-only JSONL em `.tabla/`
- **Idioma:** Português para documentação, Inglês para nomes de tipos e código
- **Decisões arquiteturais:** Prefixadas com `ADR-SA-XXX`

## Decisões de Consenso (Cross-cutting)

- **ADR-SA-001:** Plugin como extensão stateful, não aplicação standalone
- **ADR-SA-002:** Event Sourcing local com projeções CQRS
- **ADR-SA-003:** Motor de workflow único com sub-workflows
- **ADR-SA-004:** Separação Decision Core / Effect Interpreter
- **ADR-SA-005:** Cache de inferência para determinismo de replay (proposta)
- **ADR-SA-006:** ACL versionada para Agency Agents
