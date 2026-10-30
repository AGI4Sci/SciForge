import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import {
  createResearchSearchService,
  researchSearchConfigFromEnv
} from '../../packages/workers/search/src/research-service'
import { startResearchSearchMcpServer } from '../../packages/workers/search/src/mcp-server'

export const GUI_RESEARCH_MCP_LAUNCH_FLAG = '--gui-research-mcp-server'
export const GUI_RESEARCH_ENV_FILE_ENV = 'SCIFORGE_RESEARCH_ENV_FILE'

export async function runResearchSearchMcpServerFromArgv(argv: string[]): Promise<boolean> {
  if (!argv.includes(GUI_RESEARCH_MCP_LAUNCH_FLAG)) return false
  const config = researchSearchConfigFromEnv(researchSearchEnvForGuiMcp(process.env, argv))
  await startResearchSearchMcpServer(createResearchSearchService(config))
  return true
}

export function researchSearchEnvForGuiMcp(
  baseEnv: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv
): NodeJS.ProcessEnv {
  const envFile = resolveResearchSearchEnvFile(baseEnv, argv)
  if (!envFile) return { ...baseEnv }
  return {
    ...baseEnv,
    ...parseResearchSearchEnvFile(readFileSync(envFile, 'utf8'))
  }
}

export function resolveResearchSearchEnvFile(
  baseEnv: NodeJS.ProcessEnv = process.env,
  argv: readonly string[] = process.argv
): string | undefined {
  const explicit = baseEnv[GUI_RESEARCH_ENV_FILE_ENV]?.trim()
  const candidates = [
    ...(explicit ? [resolve(explicit)] : []),
    ...researchSearchEnvFileCandidates(argv)
  ]
  return candidates.find((candidate) => existsSync(candidate))
}

export function parseResearchSearchEnvFile(text: string): Record<string, string> {
  const env: Record<string, string> = {}
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) continue
    const match = /^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/.exec(line)
    if (!match) continue
    env[match[1]] = unquoteEnvValue(match[2].trim())
  }
  return env
}

function researchSearchEnvFileCandidates(argv: readonly string[]): string[] {
  const candidates: string[] = []
  const entryPath = argv.find((item) => item.includes('research-search-mcp-node-entry'))
  if (entryPath) {
    const appRoot = dirname(dirname(dirname(resolve(entryPath))))
    candidates.push(join(appRoot, 'packages', 'workers', 'search', '.env'))
  }
  candidates.push(join(process.cwd(), 'packages', 'workers', 'search', '.env'))
  return [...new Set(candidates)]
}

function unquoteEnvValue(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}
