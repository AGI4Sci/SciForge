import { runDatasetApiMcpServerFromArgv } from './dataset-api-mcp-server'

void runDatasetApiMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[dataset-api-mcp] missing MCP launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[dataset-api-mcp] server failed:', error)
    process.exit(1)
  })
