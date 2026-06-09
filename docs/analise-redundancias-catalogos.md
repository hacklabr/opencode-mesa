
# RELATÓRIO COMPLETO: ANÁLISE DE REDUNDÂNCIAS ENTRE CATÁLOGOS DE AGENTES

> **Metodologia**: Extração de frontmatter (name, description) de todos os 386 perfis (232 externos + 154 locais). Agrupamento por nome normalizado + similaridade semântica de descrições. Leitura completa dos arquivos dos pares identificados para análise de conteúdo.

---

## 1. DIFERENÇAS ESTRUTURAIS ENTRE CATÁLOGOS

| Aspecto | Catálogo Externo (`agency-agents`) | Catálogo Local (`catalog/`) |
|---------|-----------------------------------|----------------------------|
| **Tom** | Roleplay / Personagem ("You are...", "Your Identity") | Especificação técnica profissional |
| **Seções** | Identity & Memory, Core Mission, Critical Rules, Communication Style, Learning & Memory | Role, Behavioral Principles, Tools & Knowledge, Constraints, Output Format, Self-Check, Examples |
| **Foco** | Vibes, personalidade, memória persistente | Comportamento, ferramentas, constraints, exemplos práticos |
| **Tecnologias** | Muito específicas (Laravel, FluxUI, Brevo, etc.) | Genérico / framework-agnostic |
| **Tamanho** | Altamente variável (200–3.400 palavras) | Consistente (900–2.100 palavras) |
| **Frontmatter** | name, description, color, emoji, vibe (+ tools às vezes) | name, description, color (hex), emoji, vibe |
| **Exemplos** | Poucos ou nenhum | Sempre inclui 3 exemplos práticos (Thought→Action→Observation) |

**Conclusão**: O catálogo local é significativamente mais maduro como especificação técnica. O externo é mais voltado para "personality prompts".

---

## 2. REDUNDÂNCIAS POR CATEGORIA

### 2.1 SOFTWARE DEVELOPMENT / ENGINEERING (10 pares)

| # | Externo | Local | Similaridade | Avaliação de Conteúdo | Recomendação |
|---|---------|-------|-------------|----------------------|--------------|
| 1 | `engineering-backend-architect` | `software-development/backend-architect` | 0.32 | **Local é melhor**. Local cobre CQRS, Saga, Strangler Fig, exemplos de migração monolith→microservices. Externo foca mais em padrões genéricos. | Manter local |
| 2 | `engineering-code-reviewer` | `software-development/code-reviewer` | 0.53 | **Local é melhor**. Local tem formato de saída detalhado (🔴🟡🔵), exemplos de SQL injection, N+1 query, test coverage. Externo é mais curto (460 vs 888 palavras). | Manter local |
| 3 | `engineering-data-engineer` | `software-development/data-engineer` | 0.48 | **Complementares**. Externo foca em pipelines/ETL/lakehouse. Local cobre streaming, data mesh, ML ops. Ambos têm valor. | Merge: incorporar pipelines do externo ao local |
| 4 | `engineering-frontend-developer` | `software-development/frontend-developer` | 0.33 | **Complementares**. Externo foca em "premium experiences" e Three.js. Local é mais genérico com acessibilidade, i18n, PWA. | Merge: incorporar Three.js do externo ao local |
| 5 | `engineering-software-architect` | `software-development/software-architect` | nome igual | **Local é melhor**. Local aborda trade-offs decisórios, modernização de sistemas legados, visão de longo prazo. | Manter local |
| 6 | `engineering-technical-writer` | `software-development/technical-writer` | 0.62 | **Externo é mais completo**. Externo tem 1.890 vs 862 palavras, inclui API docs, tutorials, style guides. Local é bom mas curto. | Merge: expandir local com conteúdo do externo |
| 7 | `gis-gis-qa-engineer` | `software-development/qa-engineer` | nome igual | **Local é melhor**. Local tem 1.236 vs 732 palavras, cobre testes exploratórios, automação, regressão. | Manter local |
| 8 | `engineering-devops-automator` | `software-development/devops-engineer` | 0.33 | **Local é melhor**. Local inclui GitOps, SRE practices, constraints de segurança (nunca expor secrets). Externo foca mais em automação genérica. | Manter local |
| 9 | `engineering-mobile-app-builder` | `software-development/mobile-app-developer` | 0.56 | **Complementares**. Externo foca em no-code/low-code. Local em nativo/cross-platform (iOS, Android, React Native, Flutter). | Manter local (mais abrangente) |
| 10 | `engineering-sre` | `software-development/site-reliability-engineer` | 0.28 | **Local é MUITO melhor**. Local é completo: SLOs, incident response, chaos engineering, post-mortems, toil reduction. Externo é curto (90 linhas). | Manter local |

### 2.2 SECURITY (2 pares)

| # | Externo | Local | Similaridade | Avaliação de Conteúdo | Recomendação |
|---|---------|-------|-------------|----------------------|--------------|
| 1 | `security-appsec-engineer` | `software-development/security-engineer` | 0.28 | **Externo é mais completo**. Externo tem 491 linhas com código real (OWASP patterns em TypeScript, scanner Python, threat model STRIDE). Local tem 141 linhas, mais genérico. | **Manter AMBOS** — funções diferentes: AppSec (código) vs Security Engineer (infra+app) |
| 2 | `security-cloud-security-architect` | `software-development/cloud-architect` | 0.25 | **Funções diferentes**. Cloud Security Architect foca em zero-trust, IAM, compliance. Cloud Architect foca em serverless, multi-region, cost optimization. | Manter ambos — complementares |

### 2.3 MARKETING / SOCIAL ENGAGEMENT (6 pares)

| # | Externo | Local | Similaridade | Avaliação de Conteúdo | Recomendação |
|---|---------|-------|-------------|----------------------|--------------|
| 1 | `marketing-content-creator` | `social-engagement/content-creator` | 0.68 | **Local é MUITO melhor**. Local: 1.620 vs 386 palavras, frameworks (AIDA, PAS, BAB), exemplos de LinkedIn, Instagram, email sequences. | Manter local |
| 2 | `marketing-growth-hacker` | `social-engagement/growth-hacker` | 0.52 | **Local é melhor**. Local: 1.116 vs 392 palavras, cobre AARRR, viral loops, experimentação. | Manter local |
| 3 | `marketing-seo-specialist` | `social-engagement/seo-specialist` | 0.63 | **Externo é mais completo**. Externo: 2.515 vs 1.293 palavras, technical SEO avançado, link building, content clusters. | Merge: incorporar technical SEO do externo ao local |
| 4 | `marketing-social-media-strategist` | `social-engagement/social-media-strategist` | nome igual | **Local é melhor**. Local: 1.231 vs 915 palavras, calendário editorial, métricas, gestão de crises. | Manter local |
| 5 | `marketing-email-strategist` | `social-engagement/email-marketing-specialist` | 0.62 | **Complementares**. Externo foca em CRM-ESP sync, segmentação avançada, deliverability técnico. Local foca em LGPD/compliance brasileiro, automação workflows. | **Merge**: ambos têm valor único. Local precisa de mais conteúdo técnico de deliverability |
| 6 | `design-brand-guardian` | `social-engagement/brand-manager` | 0.50 | **Funções diferentes**. Brand Guardian = consistência visual, guidelines, proteção de marca. Brand Manager = estratégia de posicionamento, arquitetura de marca, métricas de brand health. | Manter ambos — complementares |

### 2.4 FINANCE (5 pares)

| # | Externo | Local | Similaridade | Avaliação de Conteúdo | Recomendação |
|---|---------|-------|-------------|----------------------|--------------|
| 1 | `finance-financial-analyst` | `finance/financial-analyst` | 0.48 | **Externo é mais completo**. Externo: 2.045 vs 946 palavras, templates de valuation, LBO, M&A, real options. Local é bom mas curto. | Merge: incorporar templates avançados do externo |
| 2 | `finance-fpa-analyst` | `finance/fpa-analyst` | 0.48 | **Externo é mais completo**. Externo: 2.577 vs 1.374 palavras, foco profundo em FP&A corporativo. | Merge: incorporar modelos avançados do externo |
| 3 | `finance-investment-researcher` | `finance/investment-researcher` | 0.50 | **Externo é mais completo**. Externo: 2.250 vs 1.354 palavras, equity research, credit analysis, ESG. | Merge: incorporar análises avançadas |
| 4 | `finance-tax-strategist` | `finance/tax-strategist` | 0.54 | **Externo é mais completo**. Externo: 1.949 vs 1.407 palavras, transfer pricing, international tax. | Merge: incorporar conteúdo internacional |
| 5 | `finance-bookkeeper-controller` | `finance/financial-controller` | 0.54 | **Local é melhor para contexto BR**. Externo: foco em GAAP/US, templates de close. Local: foco em NBC TGs, SPED, ECD, ECF, CVM. | **Manter local** (específico BR é mais valioso) |

### 2.5 CULTURE / ACADEMIC (2 pares)

| # | Externo | Local | Similaridade | Avaliação de Conteúdo | Recomendação |
|---|---------|-------|-------------|----------------------|--------------|
| 1 | `academic-anthropologist` | `culture/anthropologist` | 0.28 | **Complementares**. Externo: pesquisa acadêmica, etnografia, metodologia científica. Local: aplicações culturais, patrimônio, preservação. | Manter ambos — públicos diferentes |
| 2 | `academic-historian` | `culture/historian` | nome igual | **Complementares**. Externo: metodologia acadêmica, historiografia, fontes primárias. Local: narração, preservação, patrimônio cultural. | Manter ambos — públicos diferentes |

### 2.6 FALSOS POSITIVOS — Nome igual, função DIFERENTE

| # | Externo | Local | Problema |
|---|---------|-------|----------|
| 1 | `sales/sales-engineer.md` | `software-development/security-engineer.md` | **NÃO SÃO REDUNDANTES**. Sales Engineer = pré-venda técnica, demos, POCs. Security Engineer = segurança da informação, threat modeling. |
| 2 | `paid-media/paid-media-auditor.md` | `accounting/auditor.md` | **NÃO SÃO REDUNDANTES**. Paid Media Auditor = auditoria de campanhas Google/Meta. Auditor = auditoria contábil/financeira. |

---

## 3. REDUNDÂNCIAS SEMÂNTICAS (funções similares, nomes diferentes)

| Externo | Local | Relação | Avaliação |
|---------|-------|---------|-----------|
| `engineering-ai-engineer` | `software-development/machine-learning-engineer` | 0.59 | **Redundância real**. Ambos são engenheiros de ML/IA. O local é mais completo. |
| `engineering-database-optimizer` | `software-development/database-administrator` | 0.33 | **Complementares**. Optimizer = tuning de performance. DBA = administração geral. |
| `testing-performance-benchmarker` | `software-development/performance-engineer` | 0.33 | **Complementares**. Benchmarker = medição. Performance Engineer = otimização. |
| `specialized-model-qa` | `software-development/qa-engineer` | 0.33 | **Complementares**. Model QA = validação de LLMs. QA Engineer = qualidade de software. |
| `marketing-social-media-strategist` | `social-engagement/social-media-analytics` | 0.33 | **Complementares**. Strategist = estratégia. Analytics = análise de dados. |
| `product-product-trend-researcher` | `finance/investment-researcher` | 0.25 | **Funções diferentes**. Trend Researcher = tendências de produto. Investment Researcher = análise de ações. |
| `specialized-hr-onboarding` | `administrative/hr-manager` | 0.25 | **Complementares**. Onboarding = integração. HR Manager = gestão geral de RH. |
| `security-compliance-auditor` | `legal/compliance-officer` | 0.25 | **Complementares**. Security Compliance = tecnologia. Legal Compliance = regulatório. |
| `testing-api-tester` | `software-development/api-designer` | 0.25 | **Complementares**. Tester = testes. Designer = design de contratos. |

---

## 4. CASO ESPECIAL: engineering-senior-developer

**Arquivo externo**: `engineering/engineering-senior-developer.md`
- **Tamanho**: 3.426 palavras
- **Foco**: Laravel/Livewire/FluxUI/Three.js — extremamente específico para stack PHP
- **Problema**: Não é genérico. Assume Laravel como padrão.
- **Status no local**: **NÃO EXISTE** equivalente

**Recomendação do usuário**: Criar `software-development/senior-developer.md` genérico no catálogo local para substituir/sobrescrever o externo.

**Sugestão de conteúdo para o novo perfil**:
- Combinar princípios do `backend-architect` + `frontend-developer` + `code-reviewer`
- Focar em: arquitetura limpa, design patterns, code review, mentoria técnica, decisões de tecnologia
- Stack-agnostic: mencionar princípios universais (SOLID, DRY, KISS) sem assumir framework
- Incluir: liderança técnica, revisão de arquitetura, mentoria de juniors, definição de padrões

---

## 5. PERFIS EXCLUSIVOS POR CATÁLOGO

### 5.1 Exclusivos do Externo (~195 perfis)

**Áreas inteiras não cobertas pelo local**:
- `game-development/` — 17 perfis (Unity, Unreal, Godot, Roblox, Blender)
- `gis/` — 12 perfis (3D scenes, drone mapping, geoAI, web GIS)
- `spatial-computing/` — 7 perfis (visionOS, XR, Metal)
- `design/` — 8 perfis (UI designer, UX researcher, visual storyteller, etc.)
- `product/` — 5 perfis (product manager, behavioral nudge engine, etc.)
- `project-management/` — 7 perfis (Jira workflow, meeting notes, etc.)
- `sales/` — 9 perfis (account strategist, deal strategist, etc.)
- `support/` — 7 perfis (analytics reporter, finance tracker, etc.)
- `testing/` — 8 perfis (accessibility auditor, API tester, etc.)
- `paid-media/` — 7 perfis (PPC strategist, programmatic buyer, etc.)
- `specialized/` — 60+ perfis diversos (M&A integration, grant writer, translator, etc.)
- `marketing/` — 35+ perfis focados em plataformas chinesas (Douyin, Xiaohongshu, Bilibili, etc.)
- `strategy/` — playbooks e runbooks (não são perfis de agente)
- `integrations/` — documentação de integrações com outras ferramentas

### 5.2 Exclusivos do Local (~120 perfis)

**Áreas inteiras não cobertas pelo externo**:
- `accounting/` — 12 perfis (brasileiros: SPED, ECD, eSocial, PIS/COFINS, etc.)
- `administrative/` — 9 perfis (HR manager, executive assistant, facilities, etc.)
- `culture/` — 9 perfis (anthropologist, archaeologist, museum director, musicologist, etc.)
- `education/` — 8 perfis (professor, school principal, educational psychologist, etc.)
- `electronics-microelectronics/` — 12 perfis (VLSI, FPGA, PCB, RF, etc.)
- `environmental/` — 10 perfis (climate change, ecologist, renewable energy, etc.)
- `legal/` — 16 perfis (brasileiros: LGPD, CDC, Lei 14.133/2021, etc.)
- `mechatronics/` — 10 perfis (robotics, PLC, CNC, sensors, actuators)
- `politics/` — 6 perfis (campaign strategist, diplomat, policy researcher, etc.)
- `urban-planning/` — 10 perfis (smart city, transportation, housing policy, etc.)
- `software-development/` — Perfis técnicos genéricos: `api-designer`, `cloud-architect`, `database-administrator`, `embedded-systems-engineer`, `file-systems-specialist`, `firmware-engineer`, `full-stack-developer`, `kernel-developer`, `machine-learning-engineer`, `mobile-app-developer`, `security-engineer`
- `finance/` — Brasileiros: `brazilian-banking-regulation-specialist`, `open-finance-specialist`, `pix-integration-specialist`, `rural-credit-analyst`

---

## 6. RECOMENDAÇÕES FINAIS

### 6.1 Manter no local (versão local é superior ou mais adequada)
- `backend-architect`, `code-reviewer`, `software-architect`, `qa-engineer`
- `devops-engineer`, `site-reliability-engineer`
- `content-creator`, `growth-hacker`, `social-media-strategist`
- `financial-controller` (contexto brasileiro é mais valioso)

### 6.2 Merge / Incorporar conteúdo do externo ao local
- `data-engineer` — adicionar pipelines/lakehouse do externo
- `frontend-developer` — adicionar Three.js/premium experiences do externo
- `technical-writer` — expandir (local é curto demais: 862 vs 1.890 palavras)
- `seo-specialist` — adicionar technical SEO avançado do externo
- `email-marketing-specialist` — adicionar segmentação avançada e deliverability do externo
- `financial-analyst` — adicionar templates LBO/M&A/real options
- `fpa-analyst` — adicionar modelos avançados de FP&A
- `investment-researcher` — adicionar equity research/credit analysis
- `tax-strategist` — adicionar transfer pricing / international tax

### 6.3 Manter ambos (funções complementares ou diferentes)
- `security-engineer` (local) vs `appsec-engineer` (externo)
- `cloud-architect` (local) vs `cloud-security-architect` (externo)
- `brand-manager` (local) vs `brand-guardian` (externo)
- `database-administrator` (local) vs `database-optimizer` (externo)
- `performance-engineer` (local) vs `performance-benchmarker` (externo)
- `qa-engineer` (local) vs `model-qa` (externo)
- `anthropologist` (local) vs `academic-anthropologist` (externo)
- `historian` (local) vs `academic-historian` (externo)

### 6.4 Criar no local (casos especiais)
- **`software-development/senior-developer.md`** — perfil genérico de senior developer para substituir o externo focado em Laravel

### 6.5 Documentar decisões
- Criar `catalog/README.md` documentando quais perfis sobrescrevem o externo
- Documentar o critério: "o local mantém apenas perfis que são (a) exclusivos, (b) melhorados, ou (c) brasileiros"

---

## 7. ESTATÍSTICAS FINAIS

| Métrica | Valor |
|---------|-------|
| Total de perfis no externo | 232 |
| Total de perfis no local | 154 |
| Redundâncias exatas (nome base) | 19 pares |
| Redundâncias semânticas fortes | 9 pares |
| Falsos positivos (funções diferentes) | 2 pares |
| Perfis exclusivos do externo | ~195 |
| Perfis exclusivos do local | ~120 |
| Pares recomendados para merge | 9 |
| Pares recomendados para manter ambos | 8 |
| Novos perfis a criar no local | 1 (senior-developer) |

---

*Relatório gerado em: 2026-06-09*
*Método: análise de frontmatter + similaridade semântica + leitura completa de conteúdo*

