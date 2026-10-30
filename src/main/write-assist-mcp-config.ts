import type { AppSettingsV1 } from '../shared/app-settings'
import { GUI_WRITE_ASSIST_MCP_LAUNCH_FLAG } from './write-assist-mcp-server'
import { WriteAssistToolNames } from '../../packages/workers/write-assist/src/contract'
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

export const GUI_WRITE_ASSIST_MCP_SERVER_NAME = 'gui_write_assist'
const GUI_WRITE_ASSIST_MCP_NODE_ENTRY = 'out/main/write-assist-mcp-node-entry.js'
export const WRITE_ASSIST_MCP_TIMEOUT_MS = 30_000

export type WriteAssistMcpLaunchConfig = ManagedGuiMcpLaunchConfig

type WriteAssistMcpConfigPaths = {
  mcpJsonPath?: string
}

export const GUI_WRITE_ASSIST_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_WRITE_ASSIST_MCP_SERVER_NAME,
  nodeEntry: GUI_WRITE_ASSIST_MCP_NODE_ENTRY,
  launchFlag: GUI_WRITE_ASSIST_MCP_LAUNCH_FLAG,
  timeoutMs: WRITE_ASSIST_MCP_TIMEOUT_MS,
  enabledTools: writeAssistMcpEnabledTools
}

export function resolveWriteAssistMcpNodeEntryPath(launch: WriteAssistMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_WRITE_ASSIST_MCP_NODE_ENTRY)
}

export function resolveWriteAssistMcpCommand(
  launch: WriteAssistMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildWriteAssistMcpArgs(
  settings: AppSettingsV1,
  launch: WriteAssistMcpLaunchConfig
): string[] {
  const args = [
    resolveWriteAssistMcpNodeEntryPath(launch),
    GUI_WRITE_ASSIST_MCP_LAUNCH_FLAG
  ]
  const workspaceRoot = settings.workspaceRoot.trim()
  if (workspaceRoot) args.push('--workspace-root', workspaceRoot)
  return args
}

export function writeAssistMcpEnv(existingEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...existingEnv,
    ...ELECTRON_RUN_AS_NODE_ENV
  }
}

export function writeAssistMcpEnabledTools(): string[] {
  return [...WriteAssistToolNames]
}

export function buildWriteAssistMcpServerConfig(
  settings: AppSettingsV1,
  launch: WriteAssistMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_WRITE_ASSIST_MCP_DESCRIPTOR,
    launch,
    args: buildWriteAssistMcpArgs(settings, launch),
    env: writeAssistMcpEnv(env),
    existing
  })
}

export function buildWriteAssistLocalRuntimeMcpServerConfig(
  settings: AppSettingsV1,
  launch: WriteAssistMcpLaunchConfig,
  existing: unknown = {}
): JsonRecord {
  const env = stringRecord((existing as { env?: unknown } | null)?.env)
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_WRITE_ASSIST_MCP_DESCRIPTOR,
    launch,
    args: buildWriteAssistMcpArgs(settings, launch),
    env: writeAssistMcpEnv(env),
    existing
  })
}

export function buildSyncedWriteAssistMcpJson(
  existing: unknown,
  settings: AppSettingsV1,
  launch: WriteAssistMcpLaunchConfig
): JsonRecord {
  void settings
  void launch
  return buildExternalLocalRuntimeMcpJson(existing, managedGuiMcpNames(GUI_WRITE_ASSIST_MCP_DESCRIPTOR))
}

export async function syncWriteAssistMcpConfig(
  settings: AppSettingsV1,
  launch: WriteAssistMcpLaunchConfig,
  paths: WriteAssistMcpConfigPaths = {}
): Promise<void> {
  const mcpJsonPath = paths.mcpJsonPath ?? resolveLocalRuntimeMcpJsonPath()
  void settings
  void launch
  await syncExternalLocalRuntimeMcpJson(mcpJsonPath, managedGuiMcpNames(GUI_WRITE_ASSIST_MCP_DESCRIPTOR))
}
