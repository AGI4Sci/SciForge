import { runScientificPlottingMcpServerFromArgv } from './scientific-plotting-mcp-server'
import { SCIENTIFIC_PLOTTING_MCP_FLAG } from './scientific-plotting-mcp-config'

void runScientificPlottingMcpServerFromArgv(process.argv).then((handled) => {
  if (!handled) {
    console.error(`[scientific-plotting-mcp] missing ${SCIENTIFIC_PLOTTING_MCP_FLAG} launch flag`)
    process.exit(1)
  }
}).catch((error) => {
  console.error('[scientific-plotting-mcp] server failed:', error)
  process.exit(1)
})
