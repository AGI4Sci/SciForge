import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  buildManagedGuiLocalRuntimeMcpServerConfig,
  buildManagedGuiMcpJsonServerConfig,
  ELECTRON_RUN_AS_NODE_ENV,
  resolveManagedGuiMcpCommand,
  resolveManagedGuiMcpNodeEntryPath,
  type JsonRecord,
  type ManagedGuiMcpDescriptor,
  type ManagedGuiMcpLaunchConfig
} from './managed-gui-mcp-config'
import {
  PPT_MASTER_MCP_FLAG,
  PPT_MASTER_TOOL_SIDE_EFFECTS
} from '../../packages/workers/ppt-master/src/contract'

export const GUI_PPT_MASTER_MCP_SERVER_NAME = 'ppt_master'
const GUI_PPT_MASTER_MCP_NODE_ENTRY = 'out/main/ppt-master-mcp-node-entry.js'
export const GUI_PPT_MASTER_MCP_TIMEOUT_MS = 120_000
export const GUI_PPT_MASTER_MCP_LAUNCH_FLAG = PPT_MASTER_MCP_FLAG

export type PptMasterMcpLaunchConfig = ManagedGuiMcpLaunchConfig & { homeDir?: string }

export const GUI_PPT_MASTER_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_PPT_MASTER_MCP_SERVER_NAME,
  nodeEntry: GUI_PPT_MASTER_MCP_NODE_ENTRY,
  launchFlag: GUI_PPT_MASTER_MCP_LAUNCH_FLAG,
  timeoutMs: GUI_PPT_MASTER_MCP_TIMEOUT_MS,
  enabledTools: pptMasterMcpEnabledTools
}

export function buildPptMasterMcpArgs(
  launch: PptMasterMcpLaunchConfig,
  workspaceRoot?: string
): string[] {
  const args = [
    resolvePptMasterMcpNodeEntryPath(launch),
    GUI_PPT_MASTER_MCP_LAUNCH_FLAG
  ]
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (normalizedWorkspaceRoot) args.push('--workspace-root', normalizedWorkspaceRoot)

  return args
}

export function resolvePptMasterMcpNodeEntryPath(launch: PptMasterMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_PPT_MASTER_MCP_NODE_ENTRY)
}

export function resolvePptMasterMcpCommand(
  launch: PptMasterMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildPptMasterMcpServerConfig(
  launch: PptMasterMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_PPT_MASTER_MCP_DESCRIPTOR,
    launch,
    args: buildPptMasterMcpArgs(launch, normalizedWorkspaceRoot),
    env: pptMasterMcpEnv(launch),
    existing: normalizedWorkspaceRoot ? {
      trustScope: 'workspace',
      trustedWorkspaceRoots: [normalizedWorkspaceRoot]
    } : undefined
  })
}

export function buildPptMasterLocalRuntimeMcpServerConfig(
  launch: PptMasterMcpLaunchConfig,
  existing: unknown = {},
  workspaceRoot?: string
): JsonRecord {
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_PPT_MASTER_MCP_DESCRIPTOR,
    launch,
    args: buildPptMasterMcpArgs(launch, workspaceRoot?.trim()),
    env: pptMasterMcpEnv(launch),
    existing
  })
}

export function buildPptMasterMcpJsonServerConfig(
  launch: PptMasterMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_PPT_MASTER_MCP_DESCRIPTOR,
    launch,
    args: buildPptMasterMcpArgs(launch, workspaceRoot?.trim()),
    env: pptMasterMcpEnv(launch)
  })
}

export function buildPptMasterMcpConfigFragment(
  launch: PptMasterMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return {
    servers: {
      [GUI_PPT_MASTER_MCP_SERVER_NAME]: buildPptMasterMcpServerConfig(launch, workspaceRoot)
    }
  }
}

export function pptMasterMcpEnabledTools(): string[] {
  return Object.keys(PPT_MASTER_TOOL_SIDE_EFFECTS)
}

function pptMasterMcpEnv(launch: PptMasterMcpLaunchConfig): Record<string, string> {
  const homeDir = launch.homeDir ?? homedir()
  const bundledPython = join(
    homeDir,
    '.cache',
    'codex-runtimes',
    'codex-primary-runtime',
    'dependencies',
    'python',
    'bin',
    'python3'
  )
  return {
    ...ELECTRON_RUN_AS_NODE_ENV,
    ...(existsSync(bundledPython) ? { PPT_MASTER_PYTHON: bundledPython } : {})
  }
}
