import { runWriteAssistMcpServerFromArgv } from './write-assist-mcp-server'

void runWriteAssistMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[write-assist-mcp] missing --gui-write-assist-mcp-server launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[write-assist-mcp] server failed:', error)
    process.exit(1)
  })
