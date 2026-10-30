import { runBgcDiscoveryMcpServerFromArgv as runWorkerMcpServerFromArgv } from '../../packages/workers/bgc-discovery/src/mcp-server'
import { BGC_DISCOVERY_MCP_FLAG } from '../../packages/workers/bgc-discovery/src/contract'

export const GUI_BGC_DISCOVERY_MCP_LAUNCH_FLAG = BGC_DISCOVERY_MCP_FLAG

export async function runBgcDiscoveryMcpServerFromArgv(argv: string[]): Promise<boolean> {
  return runWorkerMcpServerFromArgv(argv)
}
