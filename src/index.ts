import type { Plugin } from "@opencode-ai/plugin"
import { mesaStatusTool } from "./tools/mesa-tools"
import { listarEspecialistasTool, obterEspecialistaTool } from "./tools/catalog-tools"
import { criarBriefingTool, aprovarBriefingTool, entregarBriefingTool } from "./tools/briefing-tools"
import {
  analisarBriefingTool,
  proporEquipeTool,
  convocarEquipeTool,
  delegarTarefaTool,
  definirFasesTool,
} from "./tools/gestor-tools"
import {
  abrirRodadaAnaliseTool,
  registrarAnaliseTool,
  solicitarConsensoTool,
  gerarEspecificacaoTool,
  aprovarEspecificacaoTool,
  pausarDiscussaoTool,
  retomarDiscussaoTool,
  cancelarDiscussaoTool,
} from "./tools/discussion-tools"
import { buildSystemPrompt } from "./utils/prompts"

export const mesaDeDiscussao: Plugin = async () => {
  return {
    tool: {
      mesa_status: mesaStatusTool,
      listar_especialistas: listarEspecialistasTool,
      obter_especialista: obterEspecialistaTool,
      criar_briefing: criarBriefingTool,
      aprovar_briefing: aprovarBriefingTool,
      entregar_briefing: entregarBriefingTool,
      analisar_briefing: analisarBriefingTool,
      propor_equipe: proporEquipeTool,
      convocar_equipe: convocarEquipeTool,
      delegar_tarefa: delegarTarefaTool,
      definir_fases: definirFasesTool,
      abrir_rodada_analise: abrirRodadaAnaliseTool,
      registrar_analise: registrarAnaliseTool,
      solicitar_consenso: solicitarConsensoTool,
      gerar_especificacao: gerarEspecificacaoTool,
      aprovar_especificacao: aprovarEspecificacaoTool,
      pausar_discussao: pausarDiscussaoTool,
      retomar_discussao: retomarDiscussaoTool,
      cancelar_discussao: cancelarDiscussaoTool,
    },

    "experimental.chat.system.transform": async (_input, output) => {
      const mesaContext = [
        "<mesa-de-discussao>",
        "## MANDATORY RULE — DO NOT VIOLATE",
        "",
        "You have access to the Mesa de Discussao plugin — a structured workflow for producing",
        "high-quality specifications through multi-specialist AI discussion.",
        "",
        "### WHEN the user wants ANY of the following, you MUST use the Mesa workflow:",
        "- Create a project briefing or scope document",
        "- Analyze a project, codebase, or product and produce improvement suggestions",
        "- Generate a specification, technical document, or improvement plan",
        "- Start a discussion with specialists or a team of agents",
        "- Any request that involves structured analysis before implementation",
        "",
        "### WHAT you MUST do:",
        "1. Tell the user: \"This requires the Mesa de Discussao workflow.\"",
        "2. Suggest the user switch to the `briefing-writer` agent by typing: `/agent briefing-writer`",
        "   - Or use the command: `/mesa` to start the workflow automatically.",
        "3. NEVER attempt to produce specifications, improvement plans, or analysis documents",
        "   by yourself. ALWAYS delegate to the Mesa workflow.",
        "",
        "### WHY this exists:",
        "The Mesa workflow ensures that multiple AI specialists analyze, debate, and reach",
        "consensus before producing any specification. Bypassing it produces lower quality output.",
        "",
        "### EXCEPTION: Only skip the Mesa workflow if the user explicitly says",
        "\"do it yourself\" or \"skip the discussion table\".",
        "",
        "Available agents:",
        "- `briefing-writer`: Conducts structured discovery to create professional briefings.",
        "- `gestor`: Orchestrates specialist teams, manages discussion rounds and specifications.",
        "",
        "To start: user types `/agent briefing-writer` or `/mesa`.",
        "</mesa-de-discussao>",
      ].join("\n")

      output.system.push(mesaContext)
    },

    "tool.definition": async (input, output) => {
      const mesaTools = [
        "mesa_status", "listar_especialistas", "obter_especialista",
        "criar_briefing", "aprovar_briefing", "entregar_briefing",
        "analisar_briefing", "propor_equipe", "convocar_equipe",
        "delegar_tarefa", "definir_fases",
        "abrir_rodada_analise", "registrar_analise", "solicitar_consenso",
        "gerar_especificacao", "aprovar_especificacao",
        "pausar_discussao", "retomar_discussao", "cancelar_discussao",
      ]

      if (mesaTools.includes(input.toolID)) {
        output.description = output.description.replace(
          "$",
          "\n\nIMPORTANT: This tool is part of the Mesa de Discussao structured workflow. It should be used by the `gestor` or `briefing-writer` agents, not by the default agent directly."
        )
      }
    },
  }
}

export default mesaDeDiscussao
