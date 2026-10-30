import { runPptMasterMcpServerFromArgv as runWorkerPptMasterMcpServerFromArgv } from '../../packages/workers/ppt-master/src/server'
import { PPT_MASTER_MCP_FLAG } from '../../packages/workers/ppt-master/src/contract'

export const GUI_PPT_MASTER_MCP_LAUNCH_FLAG = PPT_MASTER_MCP_FLAG

export async function runPptMasterMcpServerFromArgv(argv: string[]): Promise<boolean> {
  return runWorkerPptMasterMcpServerFromArgv(argv)
}
