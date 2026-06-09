# PLANO DE MESCLAGEM: Catálogo Externo + Local

> **Objetivo**: Refatorar `src/catalog/agency-agents/` para seguir a estrutura do catálogo local, incorporando melhorias, merges e novos perfis.

---

## FASE 1: REFATORAÇÃO DA ESTRUTURA DE PASTAS

### 1.1 Novas Divisões (baseadas no catálogo local)

```
src/catalog/agency-agents/
  software-development/    # engenharia + segurança + testing + parte do specialized
  marketing/               # marketing + paid-media
  finance/                 # finance
  accounting/              # nova (do local)
  administrative/          # project-management + sales + support + parte do specialized
  legal/                   # parte do specialized
  culture/                 # academic + parte do specialized
  design/                  # design
  product/                 # product
  education/               # parte do specialized
  game-development/        # game-development
  gis/                     # gis
  spatial-computing/       # spatial-computing
  environment/             # parte do specialized (ESG)
  urban-planning/          # parte do specialized (civil engineer)
  electronics/             # NOVA: do local
  mechatronics/            # NOVA: do local
  politics/                # NOVA: do local
```

### 1.2 Mapeamento de Movimentação

#### software-development/ (merge de 3 pastas + specialized)

| Origem (externo) | Destino |
|------------------|---------|
| `engineering/*.md` | `software-development/software-development-*.md` |
| `security/*.md` | `software-development/software-development-*.md` |
| `testing/*.md` | `software-development/software-development-*.md` |
| `specialized/*developer*` | `software-development/software-development-*.md` |
| `specialized/*engineer*` | `software-development/software-development-*.md` |
| `specialized/*architect*` | `software-development/software-development-*.md` |
| `specialized/*mcp*` | `software-development/software-development-*.md` |
| `specialized/*data*` | `software-development/software-development-*.md` |
| `specialized/*workflow*` | `software-development/software-development-*.md` |
| `specialized/*document*` | `software-development/software-development-*.md` |
| `specialized/*lsp*` | `software-development/software-development-*.md` |
| `specialized/*model-qa*` | `software-development/software-development-*.md` |
| `specialized/*report*` | `software-development/software-development-*.md` |
| `specialized/*identity*` | `software-development/software-development-*.md` |
| `specialized/*agentic*` | `software-development/software-development-*.md` |
| `specialized/*agents*` | `software-development/software-development-*.md` |
| `specialized/*automation*` | `software-development/software-development-*.md` |
| `specialized/*zk*` | `software-development/software-development-*.md` |

#### marketing/ (merge de 2 pastas)

| Origem (externo) | Destino |
|------------------|---------|
| `marketing/*.md` | `marketing/marketing-*.md` |
| `paid-media/*.md` | `marketing/marketing-*.md` |

#### administrative/ (merge de 3 pastas + specialized)

| Origem (externo) | Destino |
|------------------|---------|
| `project-management/*.md` | `administrative/administrative-*.md` |
| `sales/*.md` | `administrative/administrative-*.md` |
| `support/*.md` | `administrative/administrative-*.md` |
| `specialized/*business*` | `administrative/administrative-*.md` |
| `specialized/*change*` | `administrative/administrative-*.md` |
| `specialized/*customer*` | `administrative/administrative-*.md` |
| `specialized/*operations*` | `administrative/administrative-*.md` |
| `specialized/*recruitment*` | `administrative/administrative-*.md` |
| `specialized/*real-estate*` | `administrative/administrative-*.md` |
| `specialized/*retail*` | `administrative/administrative-*.md` |
| `specialized/*sales*` | `administrative/administrative-*.md` |
| `specialized/*chief*` | `administrative/administrative-*.md` |
| `specialized/*french*` | `administrative/administrative-*.md` |
| `specialized/*korean*` | `administrative/administrative-*.md` |
| `specialized/*strategy*` | `administrative/administrative-*.md` |
| `specialized/*supply*` | `administrative/administrative-*.md` |

#### Outras movimentações

| Origem | Destino |
|--------|---------|
| `academic/*.md` | `culture/culture-*.md` |
| `specialized/accounts-payable*` | `accounting/accounting-*.md` |
| `specialized/medical-billing*` | `accounting/accounting-*.md` |
| `specialized/data-privacy*` | `legal/legal-*.md` |
| `specialized/healthcare-marketing*` | `legal/legal-*.md` |
| `specialized/legal-*` | `legal/legal-*.md` |
| `specialized/grant-writer*` | `culture/culture-*.md` |
| `specialized/language*` | `culture/culture-*.md` |
| `specialized/cultural*` | `culture/culture-*.md` |
| `specialized/corporate-training*` | `education/education-*.md` |
| `specialized/organizational*` | `education/education-*.md` |
| `specialized/personal-growth*` | `education/education-*.md` |
| `specialized/study-abroad*` | `education/education-*.md` |
| `specialized/esg*` | `environment/environment-*.md` |
| `specialized/civil*` | `urban-planning/urban-planning-*.md` |

---

## FASE 2: SOBRESCRIÇÃO (Local > Externo)

Para estes pares, **copiar o conteúdo do local** para o arquivo externo renomeado:

### software-development/

| Externo (origem) | Local (fonte) | Arquivo Final |
|------------------|---------------|---------------|
| `engineering/engineering-backend-architect.md` | `software-development/backend-architect.md` | `software-development/software-development-backend-architect.md` |
| `engineering/engineering-code-reviewer.md` | `software-development/code-reviewer.md` | `software-development/software-development-code-reviewer.md` |
| `engineering/engineering-software-architect.md` | `software-development/software-architect.md` | `software-development/software-development-software-architect.md` |
| `gis/gis-qa-engineer.md` | `software-development/qa-engineer.md` | `software-development/software-development-qa-engineer.md` |
| `engineering/engineering-devops-automator.md` | `software-development/devops-engineer.md` | `software-development/software-development-devops-engineer.md` |
| `engineering/engineering-sre.md` | `software-development/site-reliability-engineer.md` | `software-development/software-development-sre.md` |

**Nota**: Para o SRE, renomear o arquivo local de `site-reliability-engineer` para `sre` para manter compatibilidade com o nome externo.

### marketing/

| Externo (origem) | Local (fonte) | Arquivo Final |
|------------------|---------------|---------------|
| `marketing/marketing-content-creator.md` | `social-engagement/content-creator.md` | `marketing/marketing-content-creator.md` |
| `marketing/marketing-growth-hacker.md` | `social-engagement/growth-hacker.md` | `marketing/marketing-growth-hacker.md` |
| `marketing/marketing-social-media-strategist.md` | `social-engagement/social-media-strategist.md` | `marketing/marketing-social-media-strategist.md` |

### finance/

| Externo (origem) | Local (fonte) | Arquivo Final |
|------------------|---------------|---------------|
| `finance/finance-bookkeeper-controller.md` | `finance/financial-controller.md` | `finance/finance-bookkeeper-controller.md` |

**Nota**: Manter o nome do externo (`bookkeeper-controller`) ou usar o do local (`financial-controller`)? Recomendo manter o nome do externo e incorporar o conteúdo do local.

---

## FASE 3: MERGE (Combinar conteúdo)

Para estes, o arquivo final deve conter **conteúdo combinado** de ambos:

### software-development/

| Externo | Local | Estratégia de Merge |
|---------|-------|---------------------|
| `engineering/engineering-data-engineer.md` | `software-development/data-engineer.md` | Manter estrutura do local. Adicionar seções de pipelines/ETL/lakehouse do externo em "Tools & Knowledge". |
| `engineering/engineering-frontend-developer.md` | `software-development/frontend-developer.md` | Manter estrutura do local. Adicionar seção sobre Three.js e animações avançadas do externo. |
| `engineering/engineering-technical-writer.md` | `software-development/technical-writer.md` | Manter estrutura do local. Expandir com conteúdo do externo (API docs, tutorials, style guides). |
| `engineering/engineering-ai-engineer.md` | `software-development/machine-learning-engineer.md` | Renomear para `engineering-ai-engineer.md`. Usar estrutura do local (mais completa), adicionar detalhes do externo. |
| `engineering/engineering-mobile-app-builder.md` | `software-development/mobile-app-developer.md` | Manter estrutura do local. Adicionar nota sobre no-code/low-code do externo em "Tools & Knowledge". |

### marketing/

| Externo | Local | Estratégia de Merge |
|---------|-------|---------------------|
| `marketing/marketing-seo-specialist.md` | `social-engagement/seo-specialist.md` | Manter estrutura do local. Adicionar technical SEO avançado, link building, content clusters do externo. |
| `marketing/marketing-email-strategist.md` | `social-engagement/email-marketing-specialist.md` | Manter estrutura do local (com LGPD). Adicionar deliverability técnico, segmentação avançada, CRM-ESP sync do externo. |

### finance/

| Externo | Local | Estratégia de Merge |
|---------|-------|---------------------|
| `finance/finance-financial-analyst.md` | `finance/financial-analyst.md` | Manter estrutura do local. Adicionar templates de valuation, LBO, M&A, real options do externo. |
| `finance/finance-fpa-analyst.md` | `finance/fpa-analyst.md` | Manter estrutura do local. Adicionar modelos avançados de FP&A do externo. |
| `finance/finance-investment-researcher.md` | `finance/investment-researcher.md` | Manter estrutura do local. Adicionar equity research, credit analysis, ESG do externo. |
| `finance/finance-tax-strategist.md` | `finance/tax-strategist.md` | Manter estrutura do local. Adicionar transfer pricing, international tax do externo. |

---

## FASE 4: MANTER AMBOS (Funções Complementares)

Estes pares representam **funções diferentes** e devem coexistir na mesma pasta:

### software-development/
- `security-appsec-engineer.md` (externo) + `security-engineer.md` (local)
- `cloud-security-architect.md` (externo) + `cloud-architect.md` (local)
- `database-optimizer.md` (externo) + `database-administrator.md` (local)
- `performance-benchmarker.md` (externo) + `performance-engineer.md` (local)
- `model-qa.md` (externo) + `qa-engineer.md` (local)

### marketing/
- `brand-guardian.md` (externo) + `brand-manager.md` (local)

### culture/
- `academic-anthropologist.md` (externo) + `anthropologist.md` (local)
- `academic-historian.md` (externo) + `historian.md` (local)

---

## FASE 5: NOVOS PERFIS (Do Local para o Externo)

Copiar estes perfis do local para o externo (não existem no externo):

### software-development/
- `api-designer.md`
- `cloud-architect.md` (já existe como cloud-security-architect, mas este é genérico)
- `database-administrator.md`
- `embedded-systems-engineer.md`
- `file-systems-specialist.md`
- `firmware-engineer.md`
- `full-stack-developer.md`
- `kernel-developer.md`
- `frontend-architect.md`
- `machine-learning-engineer.md` (já existe como ai-engineer, mas este é mais completo)
- `mobile-app-developer.md` (já existe como mobile-app-builder, mas este é mais completo)
- `security-engineer.md` (já existe como appsec-engineer, mas este é mais genérico)
- `performance-engineer.md`
- `test-automation-engineer.md`
- `ux-writer.md`
- `electronic-invoice-specialist.md`
- `brazilian-software-compliance-engineer.md`
- `geospatial-engineer.md`

### finance/
- `budget-analyst.md`
- `brazilian-banking-regulation-specialist.md`
- `open-finance-specialist.md`
- `pix-integration-specialist.md`
- `risk-manager.md`
- `rural-credit-analyst.md`
- `private-pension-specialist.md`

### NOVAS PASTAS (do local)
- `accounting/` — 12 perfis
- `legal/` — 16 perfis brasileiros
- `education/` — 8 perfis
- `electronics/` — 12 perfis
- `mechatronics/` — 10 perfis
- `environment/` — 10 perfis
- `politics/` — 6 perfis
- `urban-planning/` — 10 perfis

---

## FASE 6: CASO ESPECIAL

### `engineering-senior-developer.md`

**Problema**: O externo é focado em Laravel/Livewire/FluxUI. Não há equivalente no local.

**Solução**: Criar `software-development/software-development-senior-developer.md` com conteúdo genérico (stack-agnostic):
- Arquitetura limpa, design patterns
- Code review, mentoria técnica
- Decisões de tecnologia, liderança técnica
- SOLID, DRY, KISS (sem assumir framework)
- Revisão de arquitetura, definição de padrões

---

## FASE 7: PADRONIZAÇÃO DO FRONTMATTER

Todos os arquivos devem ter o frontmatter padronizado:

```yaml
---
name: [Nome do Perfil]
description: [Descrição curta]
color: "#[HEX]"
emoji: "[EMOJI]"
vibe: [Frase curta de personalidade]
---
```

**Regras**:
- `color` sempre em formato hex `"#3182CE"`
- `emoji` sempre entre aspas
- `description` máximo 120 caracteres

---

## ORDEM DE EXECUÇÃO SUGERIDA

1. **Criar novas pastas** (accounting, education, electronics, etc.)
2. **Mover arquivos do externo** para novas localizações (com renomeação)
3. **Sobrescrever** arquivos indicados (copiar conteúdo do local)
4. **Merge** arquivos indicados (combinar conteúdo)
5. **Copiar novos perfis** do local
6. **Criar senior-developer** genérico
7. **Padronizar frontmatters**
8. **Remover pastas antigas vazias**
9. **Atualizar tests** do loader se necessário
10. **Commit** atômico com mensagem descritiva

---

## ESTATÍSTICAS ESTIMADAS

| Ação | Quantidade |
|------|-----------|
| Arquivos renomeados/movidos | ~230 |
| Arquivos sobrescritos | ~10 |
| Arquivos mergeados | ~9 |
| Novos perfis copiados | ~120 |
| Novos perfis criados | 1 (senior-developer) |
| Pastas removidas | ~8 (specialized, testing, security, sales, support, project-management, paid-media, academic) |
| Pastas criadas | ~8 (accounting, education, electronics, mechatronics, environment, politics, urban-planning) |

---

## RISCOS E MITIGAÇÕES

| Risco | Mitigação |
|-------|-----------|
| IDs mudam, quebrando referências | Fazer commit atômico; documentar mudanças no CHANGELOG |
| Perda de conteúdo durante merge | Sempre preservar o arquivo original até confirmar o merge |
| Duplicatas após movimentação | Verificar se o arquivo já existe no destino antes de mover |
| Quebra de testes | Atualizar `catalog.test.ts` após a migração |
| Decisões subjetivas de categoria | Documentar critérios no README do catálogo |

---

## PRÓXIMOS PASSOS

1. **Você valida este plano** e faz ajustes nas categorias que acha necessário
2. **Eu implemento** a migração seguindo o plano aprovado
3. **Verificamos** se todos os arquivos estão no lugar correto
4. **Atualizamos** os testes
5. **Commit** com mensagem: `refactor: reorganize agent catalog structure and merge local improvements`
