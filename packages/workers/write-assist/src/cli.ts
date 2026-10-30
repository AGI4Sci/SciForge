import { startWriteAssistMcpServer } from './mcp-server.js'
import {
  createWriteAssistService,
  writeAssistConfigFromEnv,
  type WriteAssistServiceOptions
} from './service.js'

const options = resolveWriteAssistCliOptions(process.argv.slice(2), process.env)
const service = createWriteAssistService(options.serviceOptions)

if (!options.quiet) {
  console.error('[sciforge-write-assist] starting MCP stdio server')
  if (options.serviceOptions.workspaceRoot) {
    console.error(`[sciforge-write-assist] workspaceRoot=${options.serviceOptions.workspaceRoot}`)
  }
}

await startWriteAssistMcpServer(service)

export function resolveWriteAssistCliOptions(
  argv: string[],
  env: NodeJS.ProcessEnv = process.env
): { quiet: boolean; serviceOptions: WriteAssistServiceOptions } {
  const serviceOptions = writeAssistConfigFromEnv(env)
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
    if (arg === '--max-text-file-bytes') {
      const value = parsePositiveInteger(argv[index + 1])
      if (value) {
        serviceOptions.maxTextFileBytes = value
        index += 1
      }
      continue
    }
  }

  return { quiet, serviceOptions }
}

function parsePositiveInteger(value: string | undefined): number | undefined {
  if (!value?.trim()) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}
