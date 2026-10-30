import { runScientificPlottingMcpServerFromArgv as runWorkerMcpServerFromArgv } from '../../packages/workers/scientific-plotting/src/scientific-plotting-mcp-server'
import { SCIENTIFIC_PLOTTING_MCP_FLAG } from '../../packages/workers/scientific-plotting/src/contract'

export const GUI_SCIENTIFIC_PLOTTING_MCP_LAUNCH_FLAG = SCIENTIFIC_PLOTTING_MCP_FLAG

export async function runScientificPlottingMcpServerFromArgv(argv: string[]): Promise<boolean> {
  return runWorkerMcpServerFromArgv(argv)
}
