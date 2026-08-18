import { runInstalledDomainRuntimeMcpServerFromArgv } from './modules/installed-domain-runtime-mcp'

void runInstalledDomainRuntimeMcpServerFromArgv(process.argv)
  .then((handled) => {
    if (handled) return
    console.error('[domain-runtime-mcp] missing domain runtime MCP selector')
    process.exit(1)
  })
  .catch((error) => {
    console.error('[domain-runtime-mcp] server failed:', error)
    process.exit(1)
  })
