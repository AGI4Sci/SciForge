import { runVisualDocumentMcpServerFromArgv } from './visual-document-mcp-server'

void runVisualDocumentMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[visual-document-mcp] missing MCP launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[visual-document-mcp] server failed:', error)
    process.exit(1)
  })
