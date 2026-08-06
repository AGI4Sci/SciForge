import type { AgentRuntimeCapabilities } from '../shared/agent-runtime-contract'
import { isComputerUseEnabledForRuntime, type AgentRuntimeId, type AppSettingsV1 } from '../shared/app-settings'
import {
  buildManagedGuiLocalRuntimeMcpServerConfig,
  buildExternalLocalRuntimeMcpJson,
  ELECTRON_RUN_AS_NODE_ENV,
  managedGuiMcpNames,
  resolveManagedGuiMcpCommand,
  resolveManagedGuiMcpNodeEntryPath,
  resolveLocalRuntimeMcpJsonPath,
  syncExternalLocalRuntimeMcpJson,
  type JsonRecord,
  type ManagedGuiMcpDescriptor,
  type ManagedGuiMcpLaunchConfig
} from './managed-gui-mcp-config'

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

export type ComputerUseMcpLaunchConfig = ManagedGuiMcpLaunchConfig

type ComputerUseMcpConfigPaths = {
  mcpJsonPath?: string
}

export const GUI_COMPUTER_USE_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_COMPUTER_USE_MCP_SERVER_NAME,
  legacyServerNames: RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES,
  nodeEntry: GUI_COMPUTER_USE_MCP_NODE_ENTRY,
  launchFlag: COMPUTER_USE_MCP_LAUNCH_FLAG,
  timeoutMs: COMPUTER_USE_MCP_TIMEOUT_MS,
  enabledTools: computerUseMcpEnabledTools
}

export function configuredComputerUseCapability(): AgentRuntimeCapabilities['tools']['computerUse'] {
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
): AgentRuntimeCapabilities['tools']['computerUse'] {
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
  settings: AppSettingsV1 | undefined,
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
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_COMPUTER_USE_MCP_NODE_ENTRY)
}

export function resolveComputerUseMcpCommand(
  launch: ComputerUseMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function computerUseMcpEnv(
  baseEnv: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  return {
    ...ELECTRON_RUN_AS_NODE_ENV,
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
  settings: AppSettingsV1,
  launch: ComputerUseMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_COMPUTER_USE_MCP_DESCRIPTOR,
    launch,
    args: buildComputerUseMcpArgs(launch),
    env: computerUseMcpEnv(),
    existing,
    enabled: isComputerUseMcpConfigured(settings, 'sciforge')
  })
}

export function buildSyncedComputerUseMcpJson(existing: unknown): JsonRecord {
  return buildExternalLocalRuntimeMcpJson(existing, managedGuiMcpNames(GUI_COMPUTER_USE_MCP_DESCRIPTOR))
}

export async function syncComputerUseMcpConfig(
  paths: ComputerUseMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveLocalRuntimeMcpJsonPath()
  await syncExternalLocalRuntimeMcpJson(mcpJsonPath, managedGuiMcpNames(GUI_COMPUTER_USE_MCP_DESCRIPTOR))
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
