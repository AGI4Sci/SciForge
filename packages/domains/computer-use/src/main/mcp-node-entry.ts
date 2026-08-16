import { runComputerUseMcpServerFromArgv } from './mcp-server'

void runComputerUseMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[computer-use-mcp] missing MCP launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[computer-use-mcp] server failed:', error)
    process.exit(1)
  })
