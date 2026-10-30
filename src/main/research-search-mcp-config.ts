import {
  GUI_RESEARCH_MCP_LAUNCH_FLAG
} from './research-search-mcp-server'
import {
  buildExternalLocalRuntimeMcpJson,
  buildManagedGuiLocalRuntimeMcpServerConfig,
  buildManagedGuiMcpJsonServerConfig,
  ELECTRON_RUN_AS_NODE_ENV,
  managedGuiMcpNames,
  resolveLocalRuntimeMcpJsonPath,
  resolveManagedGuiMcpCommand,
  resolveManagedGuiMcpNodeEntryPath,
  stringRecord,
  syncExternalLocalRuntimeMcpJson,
  type JsonRecord,
  type ManagedGuiMcpDescriptor,
  type ManagedGuiMcpLaunchConfig
} from './managed-gui-mcp-config'

export const GUI_RESEARCH_MCP_SERVER_NAME = 'gui_research'
export const RETIRED_GUI_RESEARCH_MCP_SERVER_NAMES = ['gui_research_memory'] as const
const GUI_RESEARCH_MCP_NODE_ENTRY = 'out/main/research-search-mcp-node-entry.js'
export const RESEARCH_SEARCH_MCP_TIMEOUT_MS = 30_000
const RESEARCH_ENV_NAMES = [
  'SCIFORGE_RESEARCH_ARXIV_ENABLED',
  'SCIFORGE_RESEARCH_BIORXIV_ENABLED',
  'SCIFORGE_RESEARCH_EUROPE_PMC_ENABLED',
  'SCIFORGE_RESEARCH_SEMANTIC_SCHOLAR_ENABLED',
  'SCIFORGE_RESEARCH_TAVILY_ENABLED',
  'SCIFORGE_RESEARCH_CNS_ENABLED',
  'SCIFORGE_RESEARCH_CNS_DOMAINS',
  'SCIFORGE_RESEARCH_MAX_RESULTS',
  'SCIFORGE_RESEARCH_TIMEOUT_MS',
  'SCIFORGE_RESEARCH_DEFAULT_SINCE_YEAR'
] as const
const RESEARCH_SECRET_ENV_NAMES = new Set([
  'SCIFORGE_RESEARCH_SEMANTIC_SCHOLAR_API_KEY',
  'SCIFORGE_RESEARCH_TAVILY_API_KEY',
  'TAVILY_API_KEY'
])

export type ResearchSearchMcpLaunchConfig = ManagedGuiMcpLaunchConfig

type ResearchSearchMcpConfigPaths = {
  mcpJsonPath?: string
}

export const GUI_RESEARCH_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_RESEARCH_MCP_SERVER_NAME,
  nodeEntry: GUI_RESEARCH_MCP_NODE_ENTRY,
  launchFlag: GUI_RESEARCH_MCP_LAUNCH_FLAG,
  timeoutMs: RESEARCH_SEARCH_MCP_TIMEOUT_MS,
  enabledTools: researchSearchMcpEnabledTools
}

export function resolveResearchSearchMcpNodeEntryPath(launch: ResearchSearchMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_RESEARCH_MCP_NODE_ENTRY)
}

export function resolveResearchSearchMcpCommand(
  launch: ResearchSearchMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildResearchSearchMcpArgs(launch: ResearchSearchMcpLaunchConfig): string[] {
  return [
    resolveResearchSearchMcpNodeEntryPath(launch),
    GUI_RESEARCH_MCP_LAUNCH_FLAG
  ]
}

export function researchSearchMcpEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  existingEnv: Record<string, string> = {}
): Record<string, string> {
  const env: Record<string, string> = {}
  for (const name of RESEARCH_ENV_NAMES) {
    const value = baseEnv[name]
    if (value !== undefined) env[name] = value
  }
  return {
    ...env,
    ...nonSecretEnv(existingEnv),
    ...ELECTRON_RUN_AS_NODE_ENV
  }
}

export function researchSearchMcpEnabledTools(): string[] {
  return ['research_search']
}

export function buildResearchSearchMcpServerConfig(
  launch: ResearchSearchMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_RESEARCH_MCP_DESCRIPTOR,
    launch,
    args: buildResearchSearchMcpArgs(launch),
    env: researchSearchMcpEnv(process.env, env),
    existing
  })
}

export function buildResearchSearchLocalRuntimeMcpServerConfig(
  launch: ResearchSearchMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_RESEARCH_MCP_DESCRIPTOR,
    launch,
    args: buildResearchSearchMcpArgs(launch),
    env: researchSearchMcpEnv(process.env, env),
    existing
  })
}

export function buildSyncedResearchSearchMcpJson(
  existing: unknown,
  launch: ResearchSearchMcpLaunchConfig
): JsonRecord {
  void launch
  return buildExternalLocalRuntimeMcpJson(existing, managedGuiMcpNames(GUI_RESEARCH_MCP_DESCRIPTOR))
}

export async function syncResearchSearchMcpConfig(
  launch: ResearchSearchMcpLaunchConfig,
  paths: ResearchSearchMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveLocalRuntimeMcpJsonPath()
  void launch
  await syncExternalLocalRuntimeMcpJson(mcpJsonPath, managedGuiMcpNames(GUI_RESEARCH_MCP_DESCRIPTOR))
}

function nonSecretEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (!RESEARCH_SECRET_ENV_NAMES.has(key)) out[key] = value
  }
  return out
}
