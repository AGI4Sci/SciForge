import { startDatasetApiMcpServer } from './mcp-server.js'
import { createDatasetApiService } from './service.js'

const workspaceRoot = argValue(process.argv, '--workspace-root') ?? process.env.SCIFORGE_WORKSPACE_ROOT

console.error('[sciforge-dataset-api] starting MCP stdio server')
if (workspaceRoot) console.error(`[sciforge-dataset-api] workspaceRoot=${workspaceRoot}`)

await startDatasetApiMcpServer(createDatasetApiService({ workspaceRoot }))

function argValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  return index >= 0 ? argv[index + 1] : undefined
}
