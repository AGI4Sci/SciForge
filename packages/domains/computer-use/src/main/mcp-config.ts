import { join, posix } from 'node:path'
import { resolveElectronRunAsNodeExecutable } from '@sciforge/domain-sdk/node/electron-node-executable'

export type AgentRuntimeId = 'codex' | 'claude'
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
export const GUI_COMPUTER_USE_MCP_SERVER_NAME = 'gui_owl_computer_use'
export const COMPUTER_USE_MCP_TOOL_NAME = 'computer_use'
export const COMPUTER_USE_GET_CAPABILITIES_TOOL_NAME = 'computer_use_get_capabilities'
export const COMPUTER_USE_LIST_TARGETS_TOOL_NAME = 'computer_use_list_targets'
export const COMPUTER_USE_BIND_TARGET_TOOL_NAME = 'computer_use_bind_target'
export const COMPUTER_USE_RELEASE_SESSION_TOOL_NAME = 'computer_use_release_session'
const GUI_COMPUTER_USE_MCP_NODE_ENTRY = 'out/main/computer-use-mcp-node-entry.js'
export const COMPUTER_USE_MCP_LAUNCH_FLAG = '--gui-owl-computer-use-mcp-server'
export const COMPUTER_USE_MCP_TIMEOUT_MS = 600_000

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

function isComputerUseEnabledForRuntime(
  settings: AppSettingsLike,
  runtimeId: AgentRuntimeId
): boolean {
  return settings.computerUse?.enabled !== false &&
    settings.computerUse?.runtimeEnabled?.[runtimeId] !== false
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
