import {
  getLocalRuntimeSettings,
  resolveRuntimeModelRouterSettings,
  type AppSettingsV1
} from '../shared/app-settings'
import { RuntimeInspectorToolNames } from '../../packages/workers/runtime-inspector/src/contract'
import { GUI_RUNTIME_INSPECTOR_MCP_LAUNCH_FLAG } from './runtime-inspector-mcp-server'
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

export const GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME = 'gui_runtime_inspector'
const GUI_RUNTIME_INSPECTOR_MCP_NODE_ENTRY = 'out/main/runtime-inspector-mcp-node-entry.js'
export const RUNTIME_INSPECTOR_MCP_TIMEOUT_MS = 30_000
const RUNTIME_INSPECTOR_ALLOWED_ENV_NAMES = new Set([
  'ELECTRON_RUN_AS_NODE',
  'PATH',
  'SCIFORGE_RUNTIME_INSPECTOR_WORKSPACE_ROOT',
  'GUI_RUNTIME_INSPECTOR_WORKSPACE_ROOT',
  'SCIFORGE_RUNTIME_INSPECTOR_MODEL_ROUTER_BASE_URL',
  'GUI_MODEL_ROUTER_BASE_URL',
  'SCIFORGE_RUNTIME_INSPECTOR_RUNTIME_BASE_URL',
  'GUI_RUNTIME_BASE_URL',
  'SCIFORGE_RUNTIME_INSPECTOR_TIMEOUT_MS'
])

export type RuntimeInspectorMcpLaunchConfig = ManagedGuiMcpLaunchConfig

type RuntimeInspectorMcpConfigPaths = {
  mcpJsonPath?: string
}

export const GUI_RUNTIME_INSPECTOR_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME,
  nodeEntry: GUI_RUNTIME_INSPECTOR_MCP_NODE_ENTRY,
  launchFlag: GUI_RUNTIME_INSPECTOR_MCP_LAUNCH_FLAG,
  timeoutMs: RUNTIME_INSPECTOR_MCP_TIMEOUT_MS,
  enabledTools: runtimeInspectorMcpEnabledTools
}

export function resolveRuntimeInspectorMcpNodeEntryPath(launch: RuntimeInspectorMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_RUNTIME_INSPECTOR_MCP_NODE_ENTRY)
}

export function resolveRuntimeInspectorMcpCommand(
  launch: RuntimeInspectorMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildRuntimeInspectorMcpArgs(
  settings: AppSettingsV1,
  launch: RuntimeInspectorMcpLaunchConfig
): string[] {
  const runtime = getLocalRuntimeSettings(settings)
  const modelRouter = resolveRuntimeModelRouterSettings(settings)
  const args = [
    resolveRuntimeInspectorMcpNodeEntryPath(launch),
    GUI_RUNTIME_INSPECTOR_MCP_LAUNCH_FLAG,
    '--model-router-base-url',
    modelRouter.baseUrl,
	    '--runtime-base-url',
	    localRuntimeBaseUrl(runtime.port)
  ]
  const workspaceRoot = settings.workspaceRoot.trim()
  if (workspaceRoot) args.push('--workspace-root', workspaceRoot)
  return args
}

export function runtimeInspectorMcpEnv(existingEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...allowedRuntimeInspectorEnv(existingEnv),
    ...ELECTRON_RUN_AS_NODE_ENV
  }
}

export function runtimeInspectorMcpEnabledTools(): string[] {
  return [...RuntimeInspectorToolNames]
}

export function buildRuntimeInspectorMcpServerConfig(
  settings: AppSettingsV1,
  launch: RuntimeInspectorMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_RUNTIME_INSPECTOR_MCP_DESCRIPTOR,
    launch,
    args: buildRuntimeInspectorMcpArgs(settings, launch),
    env: runtimeInspectorMcpEnv(env),
    existing
  })
}

export function buildRuntimeInspectorLocalRuntimeMcpServerConfig(
  settings: AppSettingsV1,
  launch: RuntimeInspectorMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_RUNTIME_INSPECTOR_MCP_DESCRIPTOR,
    launch,
    args: buildRuntimeInspectorMcpArgs(settings, launch),
    env: runtimeInspectorMcpEnv(env),
    existing
  })
}

export function buildSyncedRuntimeInspectorMcpJson(
  existing: unknown,
  settings: AppSettingsV1,
  launch: RuntimeInspectorMcpLaunchConfig
): JsonRecord {
  void settings
  void launch
  return buildExternalLocalRuntimeMcpJson(existing, managedGuiMcpNames(GUI_RUNTIME_INSPECTOR_MCP_DESCRIPTOR))
}

export async function syncRuntimeInspectorMcpConfig(
  settings: AppSettingsV1,
  launch: RuntimeInspectorMcpLaunchConfig,
  paths: RuntimeInspectorMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveLocalRuntimeMcpJsonPath()
  void settings
  void launch
  await syncExternalLocalRuntimeMcpJson(mcpJsonPath, managedGuiMcpNames(GUI_RUNTIME_INSPECTOR_MCP_DESCRIPTOR))
}

function localRuntimeBaseUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

function allowedRuntimeInspectorEnv(env: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [key, value] of Object.entries(env)) {
    if (RUNTIME_INSPECTOR_ALLOWED_ENV_NAMES.has(key)) out[key] = value
  }
  return out
}
