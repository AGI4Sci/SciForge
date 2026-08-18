import { resolveElectronRunAsNodeExecutable } from '@sciforge/domain-sdk/node/electron-node-executable'
import {
  buildDomainRuntimeMcpProcessArgs,
  resolveDomainRuntimeMcpNodeEntryPath,
  type DomainRuntimeMcpLaunchConfig
} from '@sciforge/domain-sdk/node/runtime-mcp-launcher'
import { COMPUTER_USE_RUNTIME_MCP_SERVER_CONTRIBUTION } from '../definition.js'

export type AgentRuntimeId = 'codex' | 'claude'
export type ComputerUseSettingsLike = Readonly<{
  enabled?: boolean
  runtimeEnabled?: Readonly<Partial<Record<AgentRuntimeId, boolean>>>
}>
export type AppSettingsLike = Readonly<{ computerUse?: ComputerUseSettingsLike }>
export type ComputerUseMcpLaunchConfig = DomainRuntimeMcpLaunchConfig & Readonly<{
  execPath: string
}>
export const GUI_COMPUTER_USE_MCP_SERVER_NAME = 'gui_owl_computer_use'
export const COMPUTER_USE_MCP_TOOL_NAME = 'computer_use'
export const COMPUTER_USE_GET_CAPABILITIES_TOOL_NAME = 'computer_use_get_capabilities'
export const COMPUTER_USE_LIST_TARGETS_TOOL_NAME = 'computer_use_list_targets'
export const COMPUTER_USE_BIND_TARGET_TOOL_NAME = 'computer_use_bind_target'
export const COMPUTER_USE_RELEASE_SESSION_TOOL_NAME = 'computer_use_release_session'
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
  return buildDomainRuntimeMcpProcessArgs(
    launch,
    COMPUTER_USE_RUNTIME_MCP_SERVER_CONTRIBUTION.id,
    [COMPUTER_USE_MCP_LAUNCH_FLAG]
  )
}

export function resolveComputerUseMcpNodeEntryPath(launch: ComputerUseMcpLaunchConfig): string {
  return resolveDomainRuntimeMcpNodeEntryPath(launch)
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
