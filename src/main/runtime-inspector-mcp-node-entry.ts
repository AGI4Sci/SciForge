import { runRuntimeInspectorMcpServerFromArgv } from './runtime-inspector-mcp-server'

void runRuntimeInspectorMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[runtime-inspector-mcp] missing --gui-runtime-inspector-mcp-server launch flag')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[runtime-inspector-mcp] server failed:', error)
    process.exit(1)
  })
