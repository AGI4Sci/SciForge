import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { dirname, join, posix } from 'node:path'
import { resolveElectronRunAsNodeExecutable } from '@sciforge/domain-sdk/node/electron-node-executable'

export type AgentRuntimeId = 'sciforge' | 'codex' | 'claude'
export type ComputerUseSettingsLike = Readonly<{
  enabled?: boolean
  runtimeEnabled?: Readonly<Partial<Record<AgentRuntimeId, boolean>>>
}>
export type AppSettingsLike = Readonly<{ computerUse?: ComputerUseSettingsLike }>
export type ComputerUseMcpLaunchConfig = Readonly<{
  appPath: string
  execPath: string
  isPackaged: boolean
}>
export type JsonRecord = Record<string, unknown>
export type ComputerUseCapability =
  | Readonly<{
    available: true
    server: 'mcp'
    toolName: 'computer_use'
    backend: 'legacy-pyautogui'
    inputIsolation: 'host-approved'
    affectsUserInput: true
    requiresHostFocus: true
    usesHostClipboard: true
  }>
  | Readonly<{ available: false; reason: string }>

export const GUI_COMPUTER_USE_MCP_SERVER_NAME = 'gui_owl_computer_use'
export const RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES = ['gui_computer_use', 'computer-use'] as const
export const COMPUTER_USE_MCP_TOOL_NAME = 'computer_use'
export const COMPUTER_USE_GET_CAPABILITIES_TOOL_NAME = 'computer_use_get_capabilities'
export const COMPUTER_USE_LIST_TARGETS_TOOL_NAME = 'computer_use_list_targets'
export const COMPUTER_USE_BIND_TARGET_TOOL_NAME = 'computer_use_bind_target'
export const COMPUTER_USE_RELEASE_SESSION_TOOL_NAME = 'computer_use_release_session'
const GUI_COMPUTER_USE_MCP_NODE_ENTRY = 'out/main/computer-use-mcp-node-entry.js'
export const COMPUTER_USE_MCP_LAUNCH_FLAG = '--gui-owl-computer-use-mcp-server'
export const COMPUTER_USE_MCP_TIMEOUT_MS = 600_000

type ComputerUseMcpConfigPaths = {
  mcpJsonPath?: string
}

export const GUI_COMPUTER_USE_MCP_DESCRIPTOR = {
  serverName: GUI_COMPUTER_USE_MCP_SERVER_NAME,
  legacyServerNames: RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES,
  nodeEntry: GUI_COMPUTER_USE_MCP_NODE_ENTRY,
  launchFlag: COMPUTER_USE_MCP_LAUNCH_FLAG,
  timeoutMs: COMPUTER_USE_MCP_TIMEOUT_MS,
  enabledTools: computerUseMcpEnabledTools
}

export function configuredComputerUseCapability(): ComputerUseCapability {
  return {
    available: true,
    server: 'mcp',
    toolName: COMPUTER_USE_MCP_TOOL_NAME,
    backend: 'legacy-pyautogui',
    inputIsolation: 'host-approved',
    affectsUserInput: true,
    requiresHostFocus: true,
    usesHostClipboard: true
  }
}

export function unavailableComputerUseCapability(
  reason: string
): ComputerUseCapability {
  return { available: false, reason }
}

export function computerUseMcpEnabledTools(): string[] {
  return [
    COMPUTER_USE_GET_CAPABILITIES_TOOL_NAME,
    COMPUTER_USE_LIST_TARGETS_TOOL_NAME,
    COMPUTER_USE_BIND_TARGET_TOOL_NAME,
    COMPUTER_USE_MCP_TOOL_NAME,
    COMPUTER_USE_RELEASE_SESSION_TOOL_NAME
  ]
}

export function isComputerUseMcpConfigured(
  settings: AppSettingsLike | undefined,
  runtimeId: AgentRuntimeId,
  env: NodeJS.ProcessEnv = process.env
): boolean {
  return Boolean(
    settings &&
    isComputerUseEnabledForRuntime(settings, runtimeId) &&
    computerUseServiceUrl(env)
  )
}

export function buildComputerUseMcpArgs(launch: ComputerUseMcpLaunchConfig): string[] {
  return [
    resolveComputerUseMcpNodeEntryPath(launch),
    COMPUTER_USE_MCP_LAUNCH_FLAG
  ]
}

export function resolveComputerUseMcpNodeEntryPath(launch: ComputerUseMcpLaunchConfig): string {
  return launch.appPath.includes('/') && !launch.appPath.includes('\\')
    ? posix.join(launch.appPath, GUI_COMPUTER_USE_MCP_NODE_ENTRY)
    : join(launch.appPath, GUI_COMPUTER_USE_MCP_NODE_ENTRY)
}

export function resolveComputerUseMcpCommand(
  launch: ComputerUseMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveElectronRunAsNodeExecutable(launch.execPath, platform)
}

export function computerUseMcpEnv(
  baseEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  return {
    ELECTRON_RUN_AS_NODE: '1',
    ...copyEnv(baseEnv, [
      'SCIFORGE_CUA_SERVICE_URL',
      'SCIFORGE_CUA_SERVICE_TOKEN',
      'SCIFORGE_CUA_SERVICE_TIMEOUT_MS',
      'CUA_SERVICE_TOKEN',
      'SCIFORGE_CUA_INVOCATION_SECRET',
      'SCIFORGE_CUA_INVOCATION_PROOF_TTL_MS',
      'CUA_INVOCATION_PROOF_MODE'
    ])
  }
}

export function buildComputerUseLocalRuntimeMcpServerConfig(
  settings: AppSettingsLike,
  launch: ComputerUseMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const record = isJsonRecord(existing) ? existing : {}
  return {
    ...record,
    enabled: isComputerUseMcpConfigured(settings, 'sciforge'),
    transport: 'stdio',
    command: resolveComputerUseMcpCommand(launch),
    args: buildComputerUseMcpArgs(launch),
    env: computerUseMcpEnv(),
    trustScope: 'user',
    timeoutMs: COMPUTER_USE_MCP_TIMEOUT_MS
  }
}

export function buildSyncedComputerUseMcpJson(existing: unknown): JsonRecord {
  const base = isJsonRecord(existing) ? existing : {}
  const servers = isJsonRecord(base.servers) ? base.servers : {}
  const retired = new Set([
    GUI_COMPUTER_USE_MCP_SERVER_NAME,
    ...RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES
  ])
  return {
    ...base,
    servers: Object.fromEntries(
      Object.entries(servers).filter(([name]) => !retired.has(name))
    )
  }
}

export async function syncComputerUseMcpConfig(
  paths: ComputerUseMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? join(homedir(), '.sciforge', 'mcp.json')
  let raw: string
  try {
    raw = await readFile(mcpJsonPath, 'utf8')
  } catch (error) {
    if (isErrnoException(error) && error.code === 'ENOENT') return
    throw error
  }
  const current = JSON.parse(raw) as unknown
  const next = buildSyncedComputerUseMcpJson(current)
  const nextText = `${JSON.stringify(next, null, 2)}\n`
  if (nextText === `${JSON.stringify(current, null, 2)}\n`) return
  await mkdir(dirname(mcpJsonPath), { recursive: true })
  await writeFile(mcpJsonPath, nextText, 'utf8')
}

function isComputerUseEnabledForRuntime(
  settings: AppSettingsLike,
  runtimeId: AgentRuntimeId
): boolean {
  return settings.computerUse?.enabled !== false &&
    settings.computerUse?.runtimeEnabled?.[runtimeId] !== false
}

function isJsonRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isErrnoException(error: unknown): error is NodeJS.ErrnoException {
  return typeof error === 'object' && error !== null
}

function computerUseServiceUrl(env: NodeJS.ProcessEnv): string {
  return (env.SCIFORGE_CUA_SERVICE_URL ?? '').trim()
}

function copyEnv(baseEnv: NodeJS.ProcessEnv, names: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {}
  for (const name of names) {
    const value = baseEnv[name]
    if (typeof value === 'string' && value.trim()) out[name] = value
  }
  return out
}
