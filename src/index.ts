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
  }
}

export default mesaDeDiscussao
