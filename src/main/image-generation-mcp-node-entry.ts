import { runImageGenerationMcpServerFromArgv } from './image-generation-mcp-server'

void runImageGenerationMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[image-generation-mcp] missing MCP launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[image-generation-mcp] server failed:', error)
    process.exit(1)
  })
