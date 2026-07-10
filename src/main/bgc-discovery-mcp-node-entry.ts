import { runBgcDiscoveryMcpServerFromArgv } from './bgc-discovery-mcp-server'

void runBgcDiscoveryMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[bgc-discovery-mcp] missing MCP launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[bgc-discovery-mcp] server failed:', error)
    process.exit(1)
  })
