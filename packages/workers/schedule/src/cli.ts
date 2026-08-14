import { createScheduleService } from './service.js'
import { startScheduleMcpServer } from './mcp-server.js'

const quiet = process.argv.includes('--quiet')

if (!quiet) {
  console.error('[sciforge-schedule] starting MCP stdio server')
}

await startScheduleMcpServer(createScheduleService({
  baseUrl: parseArgValue(process.argv, '--base-url'),
  secret: parseArgValue(process.argv, '--secret'),
  timeoutMs: parseOptionalNumberArg(process.argv, '--timeout-ms')
}))

function parseArgValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  const value = index >= 0 ? argv[index + 1] : undefined
  return value?.trim() || undefined
}

function parseOptionalNumberArg(argv: string[], flag: string): number | undefined {
  const value = parseArgValue(argv, flag)
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : undefined
}
