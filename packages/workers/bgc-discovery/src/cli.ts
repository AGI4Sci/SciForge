import { startBgcDiscoveryMcpServer } from './mcp-server.js'
import { createBgcDiscoveryService } from './service.js'

const workspaceRoot = argValue(process.argv, '--workspace-root') ?? process.env.SCIFORGE_WORKSPACE_ROOT

console.error('[sciforge-bgc-discovery] starting MCP stdio server')
if (workspaceRoot) console.error(`[sciforge-bgc-discovery] workspaceRoot=${workspaceRoot}`)

await startBgcDiscoveryMcpServer(createBgcDiscoveryService({ workspaceRoot }))

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  if (index < 0) return undefined
  return argv[index + 1]
}
