import type { Plugin } from "@opencode-ai/plugin"
import { mesaStatusTool } from "./tools/mesa-tools"

export const mesaDeDiscussao: Plugin = async (input) => {
  return {
    tool: {
      mesa_status: mesaStatusTool,
    },
  }
}

export default mesaDeDiscussao
