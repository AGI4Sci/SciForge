import { startWorkspaceIntelMcpServer } from './mcp-server.js'
import {
  createWorkspaceIntelService,
  workspaceIntelConfigFromEnv,
  type WorkspaceIntelServiceOptions
} from './service.js'

const options = resolveWorkspaceIntelCliOptions(process.argv.slice(2), process.env)
const service = createWorkspaceIntelService(options.serviceOptions)

if (!options.quiet) {
  console.error('[sciforge-workspace-intel] starting MCP stdio server')
  if (options.serviceOptions.workspaceRoot) {
    console.error(`[sciforge-workspace-intel] workspaceRoot=${options.serviceOptions.workspaceRoot}`)
  }
}

await startWorkspaceIntelMcpServer(service)

export function resolveWorkspaceIntelCliOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): { quiet: boolean; serviceOptions: WorkspaceIntelServiceOptions } {
  const serviceOptions = workspaceIntelConfigFromEnv(env)
  let quiet = false

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--quiet') {
      quiet = true
      continue
    }
    if (arg === '--workspace-root') {
      const value = argv[index + 1]
      if (value) {
        serviceOptions.workspaceRoot = value
        index += 1
      }
      continue
    }
    if (arg === '--skill-root') {
      const value = argv[index + 1]
      if (value) {
        serviceOptions.skillRoots = [...(serviceOptions.skillRoots ?? []), value]
        index += 1
      }
      continue
    }
    if (arg === '--include-global-skills') {
      serviceOptions.includeGlobalSkillRoots = true
    }
  }

  return { quiet, serviceOptions }
}
