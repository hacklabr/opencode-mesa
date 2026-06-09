# PLANO DE MIGRAÇÃO - ESTRUTURA FINAL DO CATÁLOGO

> **Versão**: 1.0 | **Data**: 2026-06-09
> **Objetivo**: Refatorar `src/catalog/agency-agents/` para estrutura do catálogo local com merges e melhorias
> **Status**: Aguardando revisão

---

## ESTRUTURA FINAL COMPLETA

```
src/catalog/agency-agents/
│
├── software-development/
│   ├── software-development-ai-engineer.md                    [MERGE: local ML-Engineer + externo AI-Engineer]
│   ├── software-development-ai-data-remediation-engineer.md   [externo - mover]
│   ├── software-development-api-designer.md                   [NOVO do local]
│   ├── software-development-autonomous-optimization-architect.md [externo - mover]
│   ├── software-development-backend-architect.md              [SOBRESCREVER: conteúdo do local]
│   ├── software-development-cloud-architect.md                [NOVO do local]
│   ├── software-development-code-reviewer.md                  [SOBRESCREVER: conteúdo do local]
│   ├── software-development-cms-developer.md                  [externo - mover]
│   ├── software-development-database-administrator.md         [NOVO do local]
│   ├── software-development-database-optimizer.md             [externo - mover]
│   ├── software-development-data-engineer.md                  [MERGE: local + externo]
│   ├── software-development-devops-engineer.md                [SOBRESCREVER: conteúdo do local]
│   ├── software-development-drupal-shopping-cart.md           [externo - mover]
│   ├── software-development-embedded-firmware-engineer.md     [externo - mover]
│   ├── software-development-embedded-systems-engineer.md      [NOVO do local]
│   ├── software-development-email-intelligence-engineer.md    [externo - mover]
│   ├── software-development-feishu-integration-developer.md   [externo - mover]
│   ├── software-development-filament-optimization-specialist.md [externo - mover]
│   ├── software-development-file-systems-specialist.md        [NOVO do local]
│   ├── software-development-firmware-engineer.md              [NOVO do local]
│   ├── software-development-frontend-architect.md             [NOVO do local]
│   ├── software-development-frontend-developer.md             [MERGE: local + externo]
│   ├── software-development-full-stack-developer.md           [NOVO do local]
│   ├── software-development-game-audio-engineer.md            [externo game-dev - fundir]
│   ├── software-development-game-blender-addon-engineer.md    [externo game-dev - fundir]
│   ├── software-development-game-designer.md                  [externo game-dev - fundir]
│   ├── software-development-game-godot-gameplay-scripter.md   [externo game-dev - fundir]
│   ├── software-development-game-godot-multiplayer-engineer.md [externo game-dev - fundir]
│   ├── software-development-game-godot-shader-developer.md    [externo game-dev - fundir]
│   ├── software-development-game-level-designer.md            [externo game-dev - fundir]
│   ├── software-development-game-narrative-designer.md        [externo game-dev - fundir]
│   ├── software-development-game-roblox-avatar-creator.md     [externo game-dev - fundir]
│   ├── software-development-game-roblox-experience-designer.md [externo game-dev - fundir]
│   ├── software-development-game-roblox-systems-scripter.md   [externo game-dev - fundir]
│   ├── software-development-game-technical-artist.md          [externo game-dev - fundir]
│   ├── software-development-game-unity-architect.md           [externo game-dev - fundir]
│   ├── software-development-game-unity-editor-tool-developer.md [externo game-dev - fundir]
│   ├── software-development-game-unity-multiplayer-engineer.md [externo game-dev - fundir]
│   ├── software-development-game-unity-shader-graph-artist.md [externo game-dev - fundir]
│   ├── software-development-game-unreal-multiplayer-architect.md [externo game-dev - fundir]
│   ├── software-development-game-unreal-systems-engineer.md   [externo game-dev - fundir]
│   ├── software-development-game-unreal-technical-artist.md   [externo game-dev - fundir]
│   ├── software-development-game-unreal-world-builder.md      [externo game-dev - fundir]
│   ├── software-development-gis-3d-scene-developer.md         [externo GIS - fundir]
│   ├── software-development-gis-analyst.md                    [externo GIS - fundir]
│   ├── software-development-gis-bim-specialist.md             [externo GIS - fundir]
│   ├── software-development-gis-cartography-designer.md       [externo GIS - fundir]
│   ├── software-development-gis-drone-reality-mapping.md      [externo GIS - fundir]
│   ├── software-development-gis-geoai-ml-engineer.md          [externo GIS - fundir]
│   ├── software-development-gis-geoprocessing-specialist.md   [externo GIS - fundir]
│   ├── software-development-gis-qa-engineer.md                [SOBRESCREVER: conteúdo do local]
│   ├── software-development-gis-solution-engineer.md          [externo GIS - fundir]
│   ├── software-development-gis-spatial-data-engineer.md      [externo GIS - fundir]
│   ├── software-development-gis-spatial-data-scientist.md     [externo GIS - fundir]
│   ├── software-development-gis-technical-consultant.md       [externo GIS - fundir]
│   ├── software-development-gis-web-gis-developer.md          [externo GIS - fundir]
│   ├── software-development-git-workflow-master.md            [externo - mover]
│   ├── software-development-incident-response-commander.md    [externo - mover]
│   ├── software-development-it-service-manager.md             [externo - mover]
│   ├── software-development-kernel-developer.md               [NOVO do local]
│   ├── software-development-machine-learning-engineer.md      [NOVO do local]
│   ├── software-development-minimal-change-engineer.md        [externo - mover]
│   ├── software-development-mobile-app-builder.md             [MERGE: local + externo]
│   ├── software-development-mobile-app-developer.md           [NOVO do local]
│   ├── software-development-multi-agent-systems-architect.md  [externo - mover]
│   ├── software-development-orgscript-engineer.md             [externo - mover]
│   ├── software-development-performance-benchmarker.md        [externo testing - fundir]
│   ├── software-development-performance-engineer.md           [NOVO do local]
│   ├── software-development-prompt-engineer.md                [externo - mover]
│   ├── software-development-qa-engineer.md                    [SOBRESCREVER: conteúdo do local]
│   ├── software-development-rapid-prototyper.md               [externo - mover]
│   ├── software-development-security-appsec-engineer.md       [externo security - fundir]
│   ├── software-development-security-architect.md             [externo security - fundir]
│   ├── software-development-security-blockchain-auditor.md    [externo security - fundir]
│   ├── software-development-security-cloud-security-architect.md [externo security - fundir]
│   ├── software-development-security-compliance-auditor.md    [externo security - fundir]
│   ├── software-development-security-engineer.md              [NOVO do local]
│   ├── software-development-security-incident-responder.md    [externo security - fundir]
│   ├── software-development-security-penetration-tester.md    [externo security - fundir]
│   ├── software-development-security-senior-secops.md         [externo security - fundir]
│   ├── software-development-security-threat-detection.md      [externo security - fundir]
│   ├── software-development-security-threat-intelligence.md   [externo security - fundir]
│   ├── software-development-senior-developer.md               [NOVO - genérico stack-agnostic]
│   ├── software-development-site-reliability-engineer.md      [SOBRESCREVER: conteúdo do local]
│   ├── software-development-software-architect.md             [SOBRESCREVER: conteúdo do local]
│   ├── software-development-solidity-smart-contract.md        [externo - mover]
│   ├── software-development-technical-writer.md               [MERGE: local + externo]
│   ├── software-development-test-automation-engineer.md       [NOVO do local]
│   ├── software-development-testing-accessibility-auditor.md  [externo testing - fundir]
│   ├── software-development-testing-api-tester.md             [externo testing - fundir]
│   ├── software-development-testing-evidence-collector.md     [externo testing - fundir]
│   ├── software-development-testing-reality-checker.md        [externo testing - fundir]
│   ├── software-development-testing-test-results-analyzer.md  [externo testing - fundir]
│   ├── software-development-testing-tool-evaluator.md         [externo testing - fundir]
│   ├── software-development-testing-workflow-optimizer.md     [externo testing - fundir]
│   ├── software-development-ux-writer.md                      [NOVO do local]
│   ├── software-development-voice-ai-integration.md           [externo - mover]
│   ├── software-development-wechat-mini-program.md            [externo - mover]
│   ├── software-development-wordpress-shopping-cart.md        [externo - mover]
│   ├── software-development-electronic-invoice-specialist.md  [NOVO do local]
│   ├── software-development-brazilian-software-compliance.md  [NOVO do local]
│   ├── software-development-geospatial-engineer.md            [NOVO do local]
│   ├── software-development-agentic-identity-trust.md         [externo specialized]
│   ├── software-development-agents-orchestrator.md            [externo specialized]
│   ├── software-development-automation-governance.md          [externo specialized]
│   ├── software-development-codebase-onboarding.md            [externo specialized]
│   ├── software-development-data-consolidation.md             [externo specialized]
│   ├── software-development-developer-advocate.md             [externo specialized]
│   ├── software-development-document-generator.md             [externo specialized]
│   ├── software-development-identity-graph-operator.md        [externo specialized]
│   ├── software-development-lsp-index-engineer.md             [externo specialized]
│   ├── software-development-mcp-builder.md                    [externo specialized]
│   ├── software-development-model-qa.md                       [externo specialized]
│   ├── software-development-report-distribution.md            [externo specialized]
│   ├── software-development-sales-data-extraction.md          [externo specialized]
│   ├── software-development-workflow-architect.md             [externo specialized]
│   ├── software-development-zk-steward.md                     [externo specialized]
│
├── social-engagement/
│   ├── social-engagement-brand-guardian.md                    [externo design - fundir]
│   ├── social-engagement-brand-manager.md                     [NOVO do local]
│   ├── social-engagement-community-manager.md                 [NOVO do local]
│   ├── social-engagement-content-creator.md                   [SOBRESCREVER: conteúdo do local]
│   ├── social-engagement-email-marketing-specialist.md        [MERGE: local + externo]
│   ├── social-engagement-growth-hacker.md                     [SOBRESCREVER: conteúdo do local]
│   ├── social-engagement-influencer-relations.md              [NOVO do local]
│   ├── social-engagement-lgpd-marketing-compliance.md         [NOVO do local]
│   ├── social-engagement-paid-media-specialist.md             [NOVO do local]
│   ├── social-engagement-seo-specialist.md                    [MERGE: local + externo]
│   ├── social-engagement-social-media-strategist.md           [SOBRESCREVER: conteúdo do local]
│   ├── social-engagement-social-media-analytics.md            [NOVO do local]
│   ├── social-engagement-advertising-law-specialist.md        [NOVO do local]
│   ├── social-engagement-aeo-foundations.md                   [externo marketing]
│   ├── social-engagement-agentic-search-optimizer.md          [externo marketing]
│   ├── social-engagement-ai-citation-strategist.md            [externo marketing]
│   ├── social-engagement-app-store-optimizer.md               [externo marketing]
│   ├── social-engagement-chinese-baidu-seo.md                 [externo marketing]
│   ├── social-engagement-chinese-bilibili-content.md          [externo marketing]
│   ├── social-engagement-chinese-book-co-author.md            [externo marketing]
│   ├── social-engagement-chinese-carousel-growth.md           [externo marketing]
│   ├── social-engagement-chinese-china-ecommerce.md           [externo marketing]
│   ├── social-engagement-chinese-china-market-localization.md [externo marketing]
│   ├── social-engagement-chinese-content-creator.md           [externo marketing]
│   ├── social-engagement-chinese-cross-border-ecommerce.md    [externo marketing]
│   ├── social-engagement-chinese-douyin-strategist.md         [externo marketing]
│   ├── social-engagement-chinese-email-strategist.md          [externo marketing]
│   ├── social-engagement-chinese-global-podcast.md            [externo marketing]
│   ├── social-engagement-chinese-growth-hacker.md             [externo marketing]
│   ├── social-engagement-chinese-instagram-curator.md         [externo marketing]
│   ├── social-engagement-chinese-kuaishou-strategist.md       [externo marketing]
│   ├── social-engagement-chinese-linkedin-content.md          [externo marketing]
│   ├── social-engagement-chinese-livestream-commerce.md       [externo marketing]
│   ├── social-engagement-chinese-multi-platform-publisher.md  [externo marketing]
│   ├── social-engagement-chinese-podcast-strategist.md        [externo marketing]
│   ├── social-engagement-chinese-pr-communications.md         [externo marketing]
│   ├── social-engagement-chinese-private-domain.md            [externo marketing]
│   ├── social-engagement-chinese-reddit-community.md          [externo marketing]
│   ├── social-engagement-chinese-seo-specialist.md            [externo marketing]
│   ├── social-engagement-chinese-short-video-editing.md       [externo marketing]
│   ├── social-engagement-chinese-social-media-strategist.md   [externo marketing]
│   ├── social-engagement-chinese-tiktok-strategist.md         [externo marketing]
│   ├── social-engagement-chinese-twitter-engager.md           [externo marketing]
│   ├── social-engagement-chinese-video-optimization.md        [externo marketing]
│   ├── social-engagement-chinese-wechat-official.md           [externo marketing]
│   ├── social-engagement-chinese-weibo-strategist.md          [externo marketing]
│   ├── social-engagement-chinese-xiaohongshu.md               [externo marketing]
│   ├── social-engagement-chinese-x-twitter-intelligence.md    [externo marketing]
│   ├── social-engagement-chinese-zhihu-strategist.md          [externo marketing]
│   ├── social-engagement-paid-media-auditor.md                [externo paid-media]
│   ├── social-engagement-paid-media-creative-strategist.md    [externo paid-media]
│   ├── social-engagement-paid-media-paid-social.md            [externo paid-media]
│   ├── social-engagement-paid-media-ppc-strategist.md         [externo paid-media]
│   ├── social-engagement-paid-media-programmatic-buyer.md     [externo paid-media]
│   ├── social-engagement-paid-media-search-query.md           [externo paid-media]
│   ├── social-engagement-paid-media-tracking-specialist.md    [externo paid-media]
│
├── finance/
│   ├── finance-bookkeeper-controller.md                       [MERGE: local + externo]
│   ├── finance-financial-analyst.md                           [MERGE: local + externo]
│   ├── finance-fpa-analyst.md                                 [MERGE: local + externo]
│   ├── finance-investment-researcher.md                       [MERGE: local + externo]
│   ├── finance-tax-strategist.md                              [MERGE: local + externo]
│   ├── finance-budget-analyst.md                              [NOVO do local]
│   ├── finance-brazilian-banking-regulation.md                [NOVO do local]
│   ├── finance-financial-controller.md                        [NOVO do local]
│   ├── finance-open-finance-specialist.md                     [NOVO do local]
│   ├── finance-pix-integration-specialist.md                  [NOVO do local]
│   ├── finance-risk-manager.md                                [NOVO do local]
│   ├── finance-rural-credit-analyst.md                        [NOVO do local]
│   ├── finance-portfolio-manager.md                           [NOVO do local]
│   ├── finance-treasury-analyst.md                            [NOVO do local]
│   ├── finance-ma-analyst.md                                  [NOVO do local]
│   ├── finance-private-pension-specialist.md                  [NOVO do local]
│   ├── finance-chief-financial-officer.md                     [externo specialized]
│   ├── finance-loan-officer-assistant.md                      [externo specialized]
│   ├── finance-ma-integration-manager.md                      [externo specialized]
│   ├── finance-pricing-analyst.md                             [externo specialized]
│
├── accounting/
│   ├── accounting-accountant.md                               [NOVO do local]
│   ├── accounting-auditor.md                                  [NOVO do local]
│   ├── accounting-bookkeeper.md                               [NOVO do local]
│   ├── accounting-brazilian-tax-accounting-specialist.md      [NOVO do local]
│   ├── accounting-compliance-accountant.md                    [NOVO do local]
│   ├── accounting-cost-accountant.md                          [NOVO do local]
│   ├── accounting-esocial-specialist.md                       [NOVO do local]
│   ├── accounting-fiscal-compliance-analyst.md                [NOVO do local]
│   ├── accounting-forensic-accountant.md                      [NOVO do local]
│   ├── accounting-payroll-specialist.md                       [NOVO do local]
│   ├── accounting-public-accountant.md                        [NOVO do local]
│   ├── accounting-tax-accountant.md                           [NOVO do local]
│   ├── accounting-accounts-payable-agent.md                   [externo specialized]
│   ├── accounting-medical-billing-coding.md                   [externo specialized]
│
├── administrative/
│   ├── administrative-administrative-assistant.md             [NOVO do local]
│   ├── administrative-corporate-governance-expert.md          [NOVO do local]
│   ├── administrative-executive-assistant.md                  [NOVO do local]
│   ├── administrative-facilities-manager.md                   [NOVO do local]
│   ├── administrative-hr-manager.md                           [NOVO do local]
│   ├── administrative-process-analyst.md                      [NOVO do local]
│   ├── administrative-procurement-specialist.md               [NOVO do local]
│   ├── administrative-public-administrator.md                 [NOVO do local]
│   ├── administrative-business-strategist.md                  [externo specialized]
│   ├── administrative-change-management-consultant.md         [externo specialized]
│   ├── administrative-customer-service.md                     [externo specialized]
│   ├── administrative-customer-success-manager.md             [externo specialized]
│   ├── administrative-government-digital-presales.md          [externo specialized]
│   ├── administrative-healthcare-customer-service.md          [externo specialized]
│   ├── administrative-hospitality-guest-services.md           [externo specialized]
│   ├── administrative-hr-onboarding.md                        [externo specialized]
│   ├── administrative-operations-manager.md                   [externo specialized]
│   ├── administrative-real-estate-buyer-seller.md             [externo specialized]
│   ├── administrative-recruitment-specialist.md               [externo specialized]
│   ├── administrative-retail-customer-returns.md              [externo specialized]
│   ├── administrative-sales-outreach.md                       [externo specialized]
│   ├── administrative-chief-of-staff.md                       [externo specialized]
│   ├── administrative-french-consulting-market.md             [externo specialized]
│   ├── administrative-korean-business-navigator.md            [externo specialized]
│   ├── administrative-strategy-duel-agent.md                  [externo specialized]
│   ├── administrative-supply-chain-strategist.md              [externo specialized]
│   ├── administrative-sales-account-strategist.md             [externo sales]
│   ├── administrative-sales-coach.md                          [externo sales]
│   ├── administrative-sales-deal-strategist.md                [externo sales]
│   ├── administrative-sales-discovery-coach.md                [externo sales]
│   ├── administrative-sales-engineer.md                       [externo sales]
│   ├── administrative-sales-offer-lead-gen.md                 [externo sales]
│   ├── administrative-sales-outbound-strategist.md            [externo sales]
│   ├── administrative-sales-pipeline-analyst.md               [externo sales]
│   ├── administrative-sales-proposal-strategist.md            [externo sales]
│   ├── administrative-project-management-experiment-tracker.md [externo project-mgmt]
│   ├── administrative-project-management-jira-workflow.md     [externo project-mgmt]
│   ├── administrative-project-management-meeting-notes.md     [externo project-mgmt]
│   ├── administrative-project-management-project-shepherd.md  [externo project-mgmt]
│   ├── administrative-project-management-studio-operations.md [externo project-mgmt]
│   ├── administrative-project-management-studio-producer.md   [externo project-mgmt]
│   ├── administrative-project-manager-senior.md               [externo project-mgmt]
│   ├── administrative-support-analytics-reporter.md           [externo support]
│   ├── administrative-support-executive-summary.md            [externo support]
│   ├── administrative-support-finance-tracker.md              [externo support]
│   ├── administrative-support-infrastructure-maintainer.md    [externo support]
│   ├── administrative-support-legal-compliance.md             [externo support]
│   ├── administrative-support-support-responder.md            [externo support]
│
├── design/
│   ├── design-brand-guardian.md                               [externo]
│   ├── design-image-prompt-engineer.md                        [externo]
│   ├── design-inclusive-visuals-specialist.md                 [externo]
│   ├── design-persona-walkthrough.md                          [externo]
│   ├── design-ui-designer.md                                  [externo]
│   ├── design-ux-architect.md                                 [externo]
│   ├── design-ux-researcher.md                                [externo]
│   ├── design-visual-storyteller.md                           [externo]
│   ├── design-whimsy-injector.md                              [externo]
│
├── product/
│   ├── product-behavioral-nudge-engine.md                     [externo]
│   ├── product-feedback-synthesizer.md                        [externo]
│   ├── product-manager.md                                     [externo]
│   ├── product-sprint-prioritizer.md                          [externo]
│   ├── product-trend-researcher.md                            [externo]
│
├── culture/
│   ├── culture-anthropologist.md                              [NOVO do local]
│   ├── culture-archaeologist.md                               [NOVO do local]
│   ├── culture-cultural-curator.md                            [NOVO do local]
│   ├── culture-heritage-preservationist.md                    [NOVO do local]
│   ├── culture-historian.md                                   [NOVO do local]
│   ├── culture-literary-critic.md                             [NOVO do local]
│   ├── culture-museum-director.md                             [NOVO do local]
│   ├── culture-musicologist.md                                [NOVO do local]
│   ├── culture-theater-director.md                            [NOVO do local]
│   ├── culture-academic-anthropologist.md                     [externo academic]
│   ├── culture-academic-geographer.md                         [externo academic]
│   ├── culture-academic-historian.md                          [externo academic]
│   ├── culture-academic-narratologist.md                      [externo academic]
│   ├── culture-academic-psychologist.md                       [externo academic]
│   ├── culture-grant-writer.md                                [externo specialized]
│   ├── culture-language-translator.md                         [externo specialized]
│   ├── culture-cultural-intelligence-strategist.md            [externo specialized]
│
├── education/
│   ├── education-career-counselor.md                          [NOVO do local]
│   ├── education-educational-psychologist.md                  [NOVO do local]
│   ├── education-educational-technologist.md                  [NOVO do local]
│   ├── education-instructional-designer.md                    [NOVO do local]
│   ├── education-pedagogical-coordinator.md                   [NOVO do local]
│   ├── education-professor.md                                 [NOVO do local]
│   ├── education-school-principal.md                          [NOVO do local]
│   ├── education-special-needs-educator.md                    [NOVO do local]
│   ├── education-corporate-training-designer.md               [externo specialized]
│   ├── education-organizational-psychologist.md               [externo specialized]
│   ├── education-personal-growth-mentor.md                    [externo specialized]
│   ├── education-study-abroad-advisor.md                      [externo specialized]
│
├── legal/
│   ├── legal-administrative-law-specialist.md                 [NOVO do local]
│   ├── legal-arbitration-specialist.md                        [NOVO do local]
│   ├── legal-compliance-officer.md                            [NOVO do local]
│   ├── legal-constitutional-law-scholar.md                    [NOVO do local]
│   ├── legal-contract-specialist.md                           [NOVO do local]
│   ├── legal-corporate-lawyer.md                              [NOVO do local]
│   ├── legal-criminal-defense-attorney.md                     [NOVO do local]
│   ├── legal-digital-law-specialist.md                        [NOVO do local]
│   ├── legal-environmental-law-attorney.md                    [NOVO do local]
│   ├── legal-general-lawyer.md                                [NOVO do local]
│   ├── legal-intellectual-property-attorney.md                [NOVO do local]
│   ├── legal-labor-law-attorney.md                            [NOVO do local]
│   ├── legal-lgpd-compliance-specialist.md                    [NOVO do local]
│   ├── legal-public-prosecutor.md                             [NOVO do local]
│   ├── legal-tax-law-attorney.md                              [NOVO do local]
│   ├── legal-data-privacy-officer.md                          [externo specialized]
│   ├── legal-healthcare-marketing-compliance.md               [externo specialized]
│   ├── legal-legal-billing-time-tracking.md                   [externo specialized]
│   ├── legal-legal-client-intake.md                           [externo specialized]
│   ├── legal-legal-document-review.md                         [externo specialized]
│
├── environment/
│   ├── environment-climate-change-analyst.md                  [NOVO do local]
│   ├── environment-ecologist.md                               [NOVO do local]
│   ├── environment-environmental-consultant.md                [NOVO do local]
│   ├── environment-environmental-educator.md                  [NOVO do local]
│   ├── environment-environmental-licensing-specialist.md      [NOVO do local]
│   ├── environment-environmental-manager.md                   [NOVO do local]
│   ├── environment-renewable-energy-specialist.md             [NOVO do local]
│   ├── environment-restoration-ecologist.md                   [NOVO do local]
│   ├── environment-waste-management-specialist.md             [NOVO do local]
│   ├── environment-water-resources-engineer.md                [NOVO do local]
│   ├── environment-esg-sustainability-officer.md              [externo specialized]
│
├── urban-planning/
│   ├── urban-planning-city-manager.md                         [NOVO do local]
│   ├── urban-planning-environmental-urban-planner.md          [NOVO do local]
│   ├── urban-planning-gis-specialist.md                       [NOVO do local]
│   ├── urban-planning-housing-policy-specialist.md            [NOVO do local]
│   ├── urban-planning-participatory-planning-facilitator.md   [NOVO do local]
│   ├── urban-planning-public-works-engineer.md                [NOVO do local]
│   ├── urban-planning-smart-city-specialist.md                [NOVO do local]
│   ├── urban-planning-transportation-planner.md               [NOVO do local]
│   ├── urban-planning-urban-economist.md                      [NOVO do local]
│   ├── urban-planning-urban-planner.md                        [NOVO do local]
│   ├── urban-planning-civil-engineer.md                       [externo specialized]
│
├── electronics/
│   ├── electronics-analog-circuit-designer.md                 [NOVO do local]
│   ├── electronics-digital-circuit-designer.md                [NOVO do local]
│   ├── electronics-electronics-engineer.md                    [NOVO do local]
│   ├── electronics-embedded-hardware-engineer.md              [NOVO do local]
│   ├── electronics-fpga-engineer.md                           [NOVO do local]
│   ├── electronics-microelectronics-engineer.md               [NOVO do local]
│   ├── electronics-pcb-designer.md                            [NOVO do local]
│   ├── electronics-power-electronics-engineer.md              [NOVO do local]
│   ├── electronics-rf-engineer.md                             [NOVO do local]
│   ├── electronics-semiconductor-process-engineer.md          [NOVO do local]
│   ├── electronics-signal-processing-engineer.md              [NOVO do local]
│   ├── electronics-vlsi-designer.md                           [NOVO do local]
│
├── mechatronics/
│   ├── mechatronics-actuator-specialist.md                    [NOVO do local]
│   ├── mechatronics-automation-engineer.md                    [NOVO do local]
│   ├── mechatronics-cnc-programmer.md                         [NOVO do local]
│   ├── mechatronics-control-systems-engineer.md               [NOVO do local]
│   ├── mechatronics-industrial-vision-engineer.md             [NOVO do local]
│   ├── mechatronics-mechatronics-engineer.md                  [NOVO do local]
│   ├── mechatronics-motion-control-engineer.md                [NOVO do local]
│   ├── mechatronics-plc-programmer.md                         [NOVO do local]
│   ├── mechatronics-robotics-engineer.md                      [NOVO do local]
│   ├── mechatronics-sensor-integration-specialist.md          [NOVO do local]
│
├── politics/
│   ├── politics-campaign-strategist.md                        [NOVO do local]
│   ├── politics-diplomat.md                                   [NOVO do local]
│   ├── politics-government-relations.md                       [NOVO do local]
│   ├── politics-legislative-analyst.md                        [NOVO do local]
│   ├── politics-policy-researcher.md                          [NOVO do local]
│   ├── politics-political-analyst.md                          [NOVO do local]
│   ├── politics-government-digital-presales.md                [externo specialized]
│
└── README.md                                                  [NOVO - documentação]
```

---

## ESTATÍSTICAS DA ESTRUTURA FINAL

| Divisão | Origem Externo | Origem Local | Novos | Total |
|---------|---------------|--------------|-------|-------|
| software-development | 95 | 20 | 1 | 116 |
| social-engagement | 48 | 12 | 0 | 60 |
| finance | 5 | 11 | 4 | 20 |
| accounting | 0 | 12 | 2 | 14 |
| administrative | 19 | 8 | 15 | 42 |
| design | 9 | 0 | 0 | 9 |
| product | 5 | 0 | 0 | 5 |
| culture | 5 | 9 | 3 | 17 |
| education | 0 | 8 | 4 | 12 |
| legal | 0 | 16 | 4 | 20 |
| environment | 0 | 10 | 1 | 11 |
| urban-planning | 0 | 10 | 1 | 11 |
| electronics | 0 | 12 | 0 | 12 |
| mechatronics | 0 | 10 | 0 | 10 |
| politics | 0 | 6 | 1 | 7 |
| **TOTAL** | **186** | **144** | **36** | **366** |

**Nota**: Os 366 incluem merges (contados uma vez) e excluem arquivos que serão eliminados.

---

## ARQUIVOS QUE SERÃO ELIMINADOS

As seguintes pastas serão removidas após a migração:

- `academic/` → fundida em `culture/`
- `engineering/` → fundida em `software-development/`
- `game-development/` → fundida em `software-development/`
- `gis/` → fundida em `software-development/`
- `marketing/` → fundida em `social-engagement/`
- `paid-media/` → fundida em `social-engagement/`
- `project-management/` → fundida em `administrative/`
- `sales/` → fundida em `administrative/`
- `security/` → fundida em `software-development/`
- `specialized/` → distribuída entre várias divisões
- `support/` → fundida em `administrative/`
- `testing/` → fundida em `software-development/`

---

## DETALHAMENTO DAS AÇÕES POR ARQUIVO

### LEGENDA:
- **[MANTER]** = Arquivo externo movido para nova localização (sem alteração de conteúdo)
- **[SOBRESCREVER]** = Conteúdo do local substitui o do externo (mantém nome do externo)
- **[MERGE]** = Combinação de conteúdo dos dois (mantém nome do externo)
- **[NOVO]** = Copiado do catálogo local (não existe no externo)
- **[FUNDIR]** = Movido de outra pasta para cá (sem alteração)

### ARQUIVOS DE MERGE (9 arquivos - prioridade alta)

1. **software-development-ai-engineer.md**
   - Base: local `machine-learning-engineer.md` (estrutura mais madura)
   - Adicionar: conteúdo específico do externo `engineering-ai-engineer.md`
   - Decisão: manter nome do externo (`ai-engineer`) por compatibilidade

2. **software-development-data-engineer.md**
   - Base: local `data-engineer.md` (estrutura mais madura)
   - Adicionar: seções de pipelines/ETL/lakehouse do externo

3. **software-development-frontend-developer.md**
   - Base: local `frontend-developer.md` (estrutura mais madura)
   - Adicionar: seção Three.js/premium experiences do externo

4. **software-development-technical-writer.md**
   - Base: local `technical-writer.md` (estrutura mais madura)
   - Adicionar: conteúdo expandido do externo (1.890 vs 862 palavras)

5. **software-development-mobile-app-builder.md**
   - Base: local `mobile-app-developer.md` (estrutura mais madura)
   - Adicionar: nota sobre no-code/low-code do externo
   - Decisão: manter nome do externo ou mudar para `mobile-app-developer`?

6. **social-engagement-seo-specialist.md**
   - Base: local `seo-specialist.md` (estrutura mais madura)
   - Adicionar: technical SEO avançado, link building, content clusters do externo

7. **social-engagement-email-marketing-specialist.md**
   - Base: local `email-marketing-specialist.md` (estrutura mais madura, LGPD)
   - Adicionar: deliverability técnico, segmentação avançada, CRM-ESP sync do externo

8. **finance-financial-analyst.md**
   - Base: local `financial-analyst.md` (estrutura mais madura)
   - Adicionar: templates LBO, M&A, real options do externo

9. **finance-tax-strategist.md**
   - Base: local `tax-strategist.md` (estrutura mais madura)
   - Adicionar: transfer pricing, international tax do externo

---

## PERGUNTAS PENDENTES PARA DECISÃO

1. **Nome do `mobile-app-builder`**: Manter nome externo (`mobile-app-builder`) ou mudar para `mobile-app-developer` (nome do local)?

2. **Nome do `bookkeeper-controller`**: Manter nome externo (`bookkeeper-controller`) ou mudar para `financial-controller` (nome do local)?

3. **Marketing chineses**: Confirma que quer o prefixo `chinese-` nos nomes? Ex: `social-engagement-chinese-douyin-strategist.md`

4. **Game-dev e GIS**: Confirma o prefixo `game-` e `gis-` nos nomes quando dentro de `software-development/`?

5. **Ordem de execução**: Prefere que eu faça em um único commit grande, ou em commits separados por divisão?

---

## CHECKLIST DE IMPLEMENTAÇÃO

- [ ] Criar novas pastas (accounting, education, electronics, mechatronics, environment, urban-planning, politics)
- [ ] Copiar arquivos NOVOS do local para o externo
- [ ] Mover arquivos do externo para novas localizações (com renomeação)
- [ ] SOBRESCREVER arquivos indicados (copiar conteúdo do local)
- [ ] MERGE arquivos indicados (combinar conteúdo)
- [ ] Criar `software-development-senior-developer.md` genérico
- [ ] Padronizar frontmatters (color em hex, emoji entre aspas)
- [ ] Remover pastas antigas vazias
- [ ] Atualizar `src/__tests__/catalog.test.ts` se necessário
- [ ] Criar `README.md` do catálogo
- [ ] Commit com mensagem descritiva

---

**Aguardando sua revisão e aprovação para iniciar a implementação.**
