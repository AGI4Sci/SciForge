import { runScientificPlottingMcpServerFromArgv } from './scientific-plotting-mcp-server'

void runScientificPlottingMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[scientific-plotting-mcp] missing MCP launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[scientific-plotting-mcp] server failed:', error)
    process.exit(1)
  })
