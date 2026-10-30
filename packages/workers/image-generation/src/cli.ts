import { runImageGenerationMcpServerFromArgv } from './mcp-server.js'

const handled = await runImageGenerationMcpServerFromArgv(process.argv)

if (!handled) {
  console.error('[image-generation] missing MCP launch flag')
  process.exit(1)
}
