import { runPptMasterMcpServerFromArgv } from './ppt-master-mcp-server'

void runPptMasterMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[ppt-master-mcp] missing MCP launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[ppt-master-mcp] server failed:', error)
    process.exit(1)
  })
