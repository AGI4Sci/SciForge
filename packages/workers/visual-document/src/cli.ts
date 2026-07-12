import { runVisualDocumentMcpServerFromArgv } from './visual-document-mcp-server.js'

const handled = await runVisualDocumentMcpServerFromArgv(process.argv)
if (!handled) {
  console.error('[sciforge-visual-document] missing MCP launch flag')
  process.exit(1)
}
