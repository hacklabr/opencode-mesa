# Briefing: Plugin Mesa de Discussão para OpenCode

## 1. Visão Geral
Construir um plugin para o [OpenCode](https://opencode.ai/) (agente open-source de desenvolvimento IA) que implemente uma **mesa de discussão estruturada para agentes de IA especializados**. O plugin permitirá que humanos transfiram escopos complexos de implementação para uma equipe de agentes especialistas que discutem, consensuam e especificam soluções antes da execução — eliminando o vibecoding de baixa qualidade.

## 2. Estado Atual (Current State)
- O processo de desenvolvimento com IA na equipe hoje é predominantemente **vibecoding**, que frequentemente gera código de baixa qualidade, exigindo retrabalho.
- Existe um protótipo funcional em Go — o **tabla-go** (`/home/rafael/_devel/tabla-go`) — que já implementa o conceito de mesa de discussão com agentes especializados, mas ainda está bugado e não integrado ao ecossistema de trabalho da equipe.
- O protótipo Go possui seu próprio conjunto de ferramentas (leitura/edição de arquivos, terminal, MCPs), que são redundantes porque o OpenCode já oferece essas capacidades nativamente.
- O catálogo de especialistas utilizado é o [agency-agents](https://github.com/msitarzewski/agency-agents), referenciado manualmente.
- Não existe hoje uma maneira de orquestrar múltiplos agentes de IA dentro do OpenCode para análise colaborativa e consenso estruturado.

## 3. Estado Desejado (Future State)
Um plugin nativo do OpenCode que permita:

1. **Briefing profissional assistido**: Um agente *Briefing Writer* conduz o humano através de perguntas de descoberta estruturadas para produzir um briefing de escopo claro e aprovado.
2. **Gestão inteligente de equipe**: Um agente *Gestor (Gerente)* analisa o briefing aprovado, prepara um plano de trabalho, seleciona especialistas do catálogo [agency-agents](https://github.com/msitarzewski/agency-agents) e convoca a equipe para a mesa com aprovação humana.
3. **Discussão estruturada em múltiplos turnos**: O Gestor abre rodadas de análise sequenciais onde cada especialista examina o briefing, o código existente (quando houver), e as análises dos colegas anteriores, construindo uma análise colaborativa.
4. **Consenso e especificação**: Ao final dos turnos, o Gestor coordena o consenso da equipe e a geração de um documento de especificação técnica.
5. **Delegação direta**: O Gestor pode delegar tarefas específicas diretamente a especialistas a qualquer momento, sem necessidade de abrir uma rodada formal de discussão.
6. **Aprovação humana por etapa**: O humano aprova cada etapa do processo (briefing, equipe escolhida, especificação), salvo configuração explícita no briefing para avanço automático.
7. **Qualidade de código elevada**: A equipe de desenvolvimento passa a gerar código com maior qualidade e menor retrabalho, pois escopos são validados por múltiplos especialistas antes da implementação.

## 4. O Gap (O que precisa ser construído)
- **Porte do conceito**: Transformar a lógica e o fluxo do protótipo Go (tabla-go) em um plugin compatível com a arquitetura de plugins do OpenCode (Node.js/TypeScript).
- **Integração nativa**: Substituir as ferramentas proprietárias do protótipo Go pelas capacidades nativas do OpenCode (file system, terminal, MCPs, etc.).
- **Orquestração de agentes**: Implementar o protocolo de comunicação entre o Gestor, o Briefing Writer e os especialistas dentro do runtime do OpenCode.
- **Mecanismo de consenso**: Codificar o processo de votação e geração de especificação colaborativa.
- **Catálogo de especialistas**: Integrar o catálogo agency-agents como referência de especialistas disponíveis para convocação (inicialmente como referência embutida, similar ao modelo do protótipo Go com git submodule).

## 5. Escopo do Projeto

### Incluído no escopo (MVP):
- Agente **Briefing Writer** com fluxo de descoberta estruturada para criação de briefing profissional.
- Agente **Gestor (Gerente)** com capacidade de:
  - Receber e analisar briefings aprovados.
  - Preparar plano de trabalho.
  - Selecionar especialistas do catálogo agency-agents.
  - Solicitar aprovação humana para convocação da equipe.
  - Abrir e conduzir rodadas de análise em múltiplos turnos.
  - Solicitar consenso e geração do documento de especificação.
  - Delegar tarefas diretamente a especialistas.
- Fluxo completo: briefing → aprovação humana → análise por especialistas → consenso → especificação → aprovação humana → próximas etapas.
- Integração com o catálogo agency-agents (lista de repositórios de especialistas).
- Respeito às aprovações humanas obrigatórias em cada etapa, com opção de avanço automático configurável no briefing.

### Fora do escopo (para versões futuras):
- Configuração do catálogo de especialistas via arquivo de configuração do OpenCode.
- Publicação no catálogo [awesome-opencode](https://github.com/awesome-opencode/awesome-opencode).
- Interface gráfica customizada (além do que o OpenCode oferece nativamente para plugins).

## 6. Fluxo de Trabalho Detalhado

1. **Início**: Humano inicia conversa com o Briefing Writer no OpenCode.
2. **Descoberta**: Briefing Writer faz perguntas estruturadas até consolidar um briefing completo.
3. **Aprovação #1**: Humano revisa e aprova o briefing.
4. **Transmissão**: Briefing Writer encaminha o briefing aprovado ao Gestor.
5. **Planejamento**: Gestor analisa o briefing, define plano de trabalho e seleciona especialistas do catálogo agency-agents.
6. **Aprovação #2**: Gestor apresenta equipe escolhida ao humano; humano aprova a convocação.
7. **Convocação**: Gestor convoca os especialistas aprovados para a mesa.
8. **Rodada de Análise**: Gestor abre turnos sequenciais. Cada especialista analisa:
   - O briefing aprovado.
   - Código existente (se aplicável).
   - Análises dos especialistas anteriores.
   - Produz sua própria análise para a mesa.
9. **Consenso**: Ao finalizar os turnos, Gestor solicita que os especialistas cheguem a um consenso e produzam o documento de especificação.
10. **Aprovação #3**: Humano revisa e aprova a especificação.
11. **Continuidade**: Gestor segue com as próximas etapas (execução, delegação, etc.).
12. **Delegação Direta**: A qualquer momento, o Gestor pode delegar tarefas pontuais a especialistas sem abrir rodada de análise formal.

## 7. Requisitos Funcionais

| ID | Requisito |
|---|---|
| RF-01 | O plugin deve disponibilizar um agente Briefing Writer capaz de conduzir descoberta estruturada com o humano. |
| RF-02 | O Briefing Writer deve produzir um briefing em formato padronizado e solicitar aprovação explícita do humano. |
| RF-03 | O Briefing Writer deve encaminhar o briefing aprovado automaticamente ao agente Gestor. |
| RF-04 | O Gestor deve analisar o briefing e propor um plano de trabalho com especialistas do catálogo agency-agents. |
| RF-05 | O Gestor deve solicitar aprovação humana antes de convocar a equipe de especialistas. |
| RF-06 | O Gestor deve ser capaz de abrir rodadas de análise com múltiplos turnos sequenciais. |
| RF-07 | Em cada turno, o especialista deve ter acesso ao briefing, ao código existente (quando houver) e às análises dos especialistas anteriores. |
| RF-08 | Ao final dos turnos, o Gestor deve coordenar o processo de consenso entre especialistas. |
| RF-09 | O consenso deve resultar em um documento de especificação colaborativa. |
| RF-10 | O Gestor deve solicitar aprovação humana da especificação antes de prosseguir. |
| RF-11 | O Gestor deve poder delegar tarefas diretamente a especialistas sem necessidade de rodada de discussão formal. |
| RF-12 | O humano deve poder configurar no briefing que determinadas etapas avancem automaticamente sem aprovação manual. |
| RF-13 | O plugin deve utilizar as ferramentas nativas do OpenCode (file system, terminal, MCPs) em vez de reimplementá-las. |

## 8. Restrições e Premissas

- O plugin deve ser desenvolvido como plugin nativo do OpenCode, seguindo a [documentação de plugins](https://opencode.ai/docs/pt-br/plugins/).
- O catálogo de especialistas será baseado no [agency-agents](https://github.com/msitarzewski/agency-agents).
- O protótipo Go (tabla-go) serve como referência funcional de fluxo, mas não de arquitetura final.
- Ferramentas de leitura/edição de arquivos, execução de comandos de terminal e integração MCPs devem usar as APIs nativas do OpenCode.
- O MVP deve cobrir o fluxo completo (briefing à especificação), sem deixar etapas órfãs.

## 9. Critérios de Sucesso

- O plugin permite executar o fluxo completo de ponta a ponta dentro do OpenCode.
- O Briefing Writer consegue extrair informações suficientes do humano para briefings claros e acionáveis.
- O Gestor consegue orquestrar discussões com múltiplos especialistas e chegar a consensos produtivos.
- A equipe de desenvolvimento percebe melhoria mensurável (subjetiva e objetivamente avaliada) na qualidade do código gerado com IA.
- O tempo de retrabalho e refatoração pós-geração de código diminui em comparação ao modelo anterior de vibecoding puro.

## 10. Timeline
Não há prazo rígido definido. O objetivo é entregar o quanto antes para que a equipe possa deixar de depender do protótipo Go bugado e passar a usar o fluxo integrado ao OpenCode.

## 11. Riscos e Impacto do Não-Entrega
- **Risco principal**: Se o plugin não for concluído, a equipe continuará dependendo do protótipo Go instável ou do vibecoding desestruturado, mantendo a baixa qualidade do código gerado por IA e o retrabalho associado.
