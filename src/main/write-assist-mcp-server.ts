import {
  createWriteAssistService,
  writeAssistConfigFromEnv,
  type WriteAssistServiceOptions
} from '../../packages/workers/write-assist/src/service'
import { startWriteAssistMcpServer } from '../../packages/workers/write-assist/src/mcp-server'

export const GUI_WRITE_ASSIST_MCP_LAUNCH_FLAG = '--gui-write-assist-mcp-server'

export async function runWriteAssistMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(GUI_WRITE_ASSIST_MCP_LAUNCH_FLAG)) return false
  await startWriteAssistMcpServer(createWriteAssistService(writeAssistOptionsFromArgv(argv)))
  return true
}

function writeAssistOptionsFromArgv(argv: string[]): WriteAssistServiceOptions {
  const options = writeAssistConfigFromEnv()
  const workspaceRoot = argValue(argv, '--workspace-root')
  if (workspaceRoot) options.workspaceRoot = workspaceRoot
  const maxTextFileBytes = positiveIntegerArg(argv, '--max-text-file-bytes')
  if (maxTextFileBytes) options.maxTextFileBytes = maxTextFileBytes
  return options
}

function argValue(argv: string[], flag: string): string {
  const index = argv.indexOf(flag)
  if (index < 0) return ''
  return argv[index + 1] ?? ''
}

function positiveIntegerArg(argv: string[], flag: string): number | undefined {
  const value = argValue(argv, flag)
  if (!value) return undefined
  const parsed = Number(value)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : undefined
}
