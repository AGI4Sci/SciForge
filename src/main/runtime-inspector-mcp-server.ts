import {
  createRuntimeInspectorService,
  runtimeInspectorConfigFromEnv,
  startRuntimeInspectorMcpServer,
  type RuntimeInspectorServiceOptions
} from '../../packages/workers/runtime-inspector/src'

export const GUI_RUNTIME_INSPECTOR_MCP_LAUNCH_FLAG = '--gui-runtime-inspector-mcp-server'

export async function runRuntimeInspectorMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(GUI_RUNTIME_INSPECTOR_MCP_LAUNCH_FLAG)) return false
  const serviceOptions = runtimeInspectorServiceOptionsFromArgv(argv)
  await startRuntimeInspectorMcpServer(createRuntimeInspectorService(serviceOptions))
  return true
}

function runtimeInspectorServiceOptionsFromArgv(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): RuntimeInspectorServiceOptions {
  const serviceOptions = runtimeInspectorConfigFromEnv(env)

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--workspace-root') {
      const value = argv[index + 1]
      if (value) {
        serviceOptions.workspaceRoot = value
        index += 1
      }
      continue
    }
    if (arg === '--model-router-base-url') {
      const value = argv[index + 1]
      if (value) {
        serviceOptions.modelRouterBaseUrl = value
        index += 1
      }
      continue
    }
    if (arg === '--runtime-base-url') {
      const value = argv[index + 1]
      if (value) {
        serviceOptions.runtimeBaseUrl = value
        index += 1
      }
      continue
    }
    if (arg === '--runtime-token') {
      const value = argv[index + 1]
      if (value) {
        serviceOptions.runtimeToken = value
        index += 1
      }
      continue
    }
    if (arg === '--timeout-ms') {
      const value = argv[index + 1]
      if (value) {
        const parsed = Number.parseInt(value, 10)
        if (Number.isFinite(parsed)) serviceOptions.timeoutMs = parsed
        index += 1
      }
    }
  }

  return serviceOptions
}
