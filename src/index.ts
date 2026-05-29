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
      // note: the system transform hook does not receive `agent` in input,
      // so we inject a general mesa-de-discussao context that applies
      // when mesa tools are available in the session
      const mesaContext = [
        "<mesa-de-discussao>",
        "You have access to the Mesa de Discussao plugin tools for structured discussion with AI specialists.",
        "If the user asks to start a briefing, create a team, or discuss a project, guide them to use the appropriate agent (briefing-writer or gestor).",
        "Available agents: briefing-writer (for discovery and briefing creation), gestor (for team orchestration and discussion).",
        "</mesa-de-discussao>",
      ].join("\n")

      output.system.push(mesaContext)
    },
  }
}

export default mesaDeDiscussao
