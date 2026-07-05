import { createRemoteExecutorService } from './service.js'
import { startRemoteExecutorMcpServer } from './mcp-server.js'
import type { RemoteTargetInput } from './contract.js'

const quiet = process.argv.includes('--quiet')

if (!quiet) {
  console.error('[sciforge-remote-executor] starting MCP stdio server')
}

await startRemoteExecutorMcpServer(createRemoteExecutorService({
  targets: parseTargetsArg(process.argv)
}))

function parseTargetsArg(argv: string[]): RemoteTargetInput[] | undefined {
  const value = parseArgValue(argv, '--targets-json')
  if (!value) return undefined
  const parsed = JSON.parse(value) as unknown
  if (!Array.isArray(parsed)) {
    throw new Error('--targets-json must be a JSON array')
  }
  return parsed as RemoteTargetInput[]
}

function parseArgValue(argv: string[], flag: string): string | undefined {
  const index = argv.indexOf(flag)
  const value = index >= 0 ? argv[index + 1] : undefined
  return value?.trim() || undefined
}
