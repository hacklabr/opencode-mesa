import type { Plugin } from "@opencode-ai/plugin"
import { mesaStatusTool } from "./tools/mesa-tools"
import { listarEspecialistasTool, obterEspecialistaTool } from "./tools/catalog-tools"
import { criarBriefingTool, aprovarBriefingTool, entregarBriefingTool } from "./tools/briefing-tools"

export const mesaDeDiscussao: Plugin = async () => {
  return {
    tool: {
      mesa_status: mesaStatusTool,
      listar_especialistas: listarEspecialistasTool,
      obter_especialista: obterEspecialistaTool,
      criar_briefing: criarBriefingTool,
      aprovar_briefing: aprovarBriefingTool,
      entregar_briefing: entregarBriefingTool,
    },
  }
}

export default mesaDeDiscussao
