import type { AppSettingsV1 } from '../shared/app-settings'
import { GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG } from './workspace-intel-mcp-server'
import { WorkspaceIntelToolNames } from '../../packages/workers/workspace-intel/src/contract'
import {
  MODEL_ROUTER_BASE_URL_ENV,
  MODEL_ROUTER_RUNTIME_API_KEY_ENV,
  MODEL_ROUTER_VISUAL_MODEL_ENV
} from '../../packages/workers/workspace-intel/src/visual-inspection'
import { resolveRuntimeModelRouterSettings } from '../shared/app-settings-model-router'
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

export const GUI_WORKSPACE_INTEL_MCP_SERVER_NAME = 'gui_workspace_intel'
const GUI_WORKSPACE_INTEL_MCP_NODE_ENTRY = 'out/main/workspace-intel-mcp-node-entry.js'
export const WORKSPACE_INTEL_MCP_TIMEOUT_MS = 120_000

export type WorkspaceIntelMcpLaunchConfig = ManagedGuiMcpLaunchConfig & {
  visibleContextPath?: string
}

type WorkspaceIntelMcpConfigPaths = {
  mcpJsonPath?: string
}

export const GUI_WORKSPACE_INTEL_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_WORKSPACE_INTEL_MCP_SERVER_NAME,
  nodeEntry: GUI_WORKSPACE_INTEL_MCP_NODE_ENTRY,
  launchFlag: GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG,
  timeoutMs: WORKSPACE_INTEL_MCP_TIMEOUT_MS,
  enabledTools: workspaceIntelMcpEnabledTools
}

export function resolveWorkspaceIntelMcpNodeEntryPath(launch: WorkspaceIntelMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_WORKSPACE_INTEL_MCP_NODE_ENTRY)
}

export function resolveWorkspaceIntelMcpCommand(
  launch: WorkspaceIntelMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildWorkspaceIntelMcpArgs(
  settings: AppSettingsV1,
  launch: WorkspaceIntelMcpLaunchConfig
): string[] {
  void settings
  const args = [
    resolveWorkspaceIntelMcpNodeEntryPath(launch),
    GUI_WORKSPACE_INTEL_MCP_LAUNCH_FLAG,
    '--include-global-skills'
  ]
  if (launch.visibleContextPath) {
    args.push('--visible-context-path', launch.visibleContextPath)
  }
  return args
}

export function workspaceIntelMcpEnv(
  existingEnv: Record<string, string> = {},
  settings?: AppSettingsV1
): Record<string, string> {
  const env = {
    ...existingEnv,
    ...ELECTRON_RUN_AS_NODE_ENV
  }
  if (!settings) return env
  const router = resolveRuntimeModelRouterSettings(settings)
  if (!router.baseUrl || !router.apiKey || !router.model) return env
  return {
    ...env,
    [MODEL_ROUTER_BASE_URL_ENV]: router.baseUrl,
    [MODEL_ROUTER_RUNTIME_API_KEY_ENV]: router.apiKey,
    [MODEL_ROUTER_VISUAL_MODEL_ENV]: router.model
  }
}

export function workspaceIntelMcpEnabledTools(): string[] {
  return [...WorkspaceIntelToolNames]
}

export function buildWorkspaceIntelMcpServerConfig(
  settings: AppSettingsV1,
  launch: WorkspaceIntelMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_WORKSPACE_INTEL_MCP_DESCRIPTOR,
    launch,
    args: buildWorkspaceIntelMcpArgs(settings, launch),
    env: workspaceIntelMcpEnv(env, settings),
    existing
  })
}

export function buildWorkspaceIntelLocalRuntimeMcpServerConfig(
  settings: AppSettingsV1,
  launch: WorkspaceIntelMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_WORKSPACE_INTEL_MCP_DESCRIPTOR,
    launch,
    args: buildWorkspaceIntelMcpArgs(settings, launch),
    env: workspaceIntelMcpEnv(env, settings),
    existing
  })
}

export function buildSyncedWorkspaceIntelMcpJson(
  existing: unknown,
  settings: AppSettingsV1,
  launch: WorkspaceIntelMcpLaunchConfig
): JsonRecord {
  void settings
  void launch
  return buildExternalLocalRuntimeMcpJson(existing, managedGuiMcpNames(GUI_WORKSPACE_INTEL_MCP_DESCRIPTOR))
}

export async function syncWorkspaceIntelMcpConfig(
  settings: AppSettingsV1,
  launch: WorkspaceIntelMcpLaunchConfig,
  paths: WorkspaceIntelMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveLocalRuntimeMcpJsonPath()
  void settings
  void launch
  await syncExternalLocalRuntimeMcpJson(mcpJsonPath, managedGuiMcpNames(GUI_WORKSPACE_INTEL_MCP_DESCRIPTOR))
}
