import { runWorkspaceIntelMcpServerFromArgv } from './workspace-intel-mcp-server'

void runWorkspaceIntelMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[workspace-intel-mcp] missing --gui-workspace-intel-mcp-server launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[workspace-intel-mcp] server failed:', error)
    process.exit(1)
  })
