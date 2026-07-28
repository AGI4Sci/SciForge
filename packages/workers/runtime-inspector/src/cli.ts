import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

import { startRuntimeInspectorMcpServer } from './mcp-server.js'
import {
  createRuntimeInspectorService,
  runtimeInspectorConfigFromEnv,
  type RuntimeInspectorServiceOptions
} from './service.js'

export type RuntimeInspectorCliOptions = {
  quiet: boolean
  serviceOptions: RuntimeInspectorServiceOptions
}

export async function main(argv: string[] = process.argv.slice(2), env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const options = resolveRuntimeInspectorCliOptions(argv, env)
  const service = createRuntimeInspectorService(options.serviceOptions)
  if (!options.quiet) {
    console.error('[sciforge-runtime-inspector] starting MCP stdio server')
    if (options.serviceOptions.workspaceRoot) {
      console.error(`[sciforge-runtime-inspector] workspaceRoot=${options.serviceOptions.workspaceRoot}`)
    }
  }
  await startRuntimeInspectorMcpServer(service)
}

export function resolveRuntimeInspectorCliOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): RuntimeInspectorCliOptions {
  const serviceOptions = runtimeInspectorConfigFromEnv(env)
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

  return { quiet, serviceOptions }
}

function isDirectRun(metaUrl: string, argvEntry: string | undefined): boolean {
  if (!argvEntry) return false
  return resolve(fileURLToPath(metaUrl)) === resolve(argvEntry)
}

if (isDirectRun(import.meta.url, process.argv[1])) {
  await main()
}
