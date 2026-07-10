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
  BGC_DISCOVERY_MCP_FLAG,
  BGC_DISCOVERY_TOOL_SIDE_EFFECTS
} from '../../packages/workers/bgc-discovery/src/contract'

export const GUI_BGC_DISCOVERY_MCP_SERVER_NAME = 'bgc_discovery'
const GUI_BGC_DISCOVERY_MCP_NODE_ENTRY = 'out/main/bgc-discovery-mcp-node-entry.js'
export const GUI_BGC_DISCOVERY_MCP_TIMEOUT_MS = 120_000
export const GUI_BGC_DISCOVERY_MCP_LAUNCH_FLAG = BGC_DISCOVERY_MCP_FLAG

export type BgcDiscoveryMcpLaunchConfig = ManagedGuiMcpLaunchConfig

export const GUI_BGC_DISCOVERY_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_BGC_DISCOVERY_MCP_SERVER_NAME,
  nodeEntry: GUI_BGC_DISCOVERY_MCP_NODE_ENTRY,
  launchFlag: GUI_BGC_DISCOVERY_MCP_LAUNCH_FLAG,
  timeoutMs: GUI_BGC_DISCOVERY_MCP_TIMEOUT_MS,
  enabledTools: bgcDiscoveryMcpEnabledTools
}

export function buildBgcDiscoveryMcpArgs(
  launch: BgcDiscoveryMcpLaunchConfig,
  workspaceRoot?: string
): string[] {
  const args = [
    resolveBgcDiscoveryMcpNodeEntryPath(launch),
    GUI_BGC_DISCOVERY_MCP_LAUNCH_FLAG
  ]
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (normalizedWorkspaceRoot) args.push('--workspace-root', normalizedWorkspaceRoot)
  return args
}

export function resolveBgcDiscoveryMcpNodeEntryPath(launch: BgcDiscoveryMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_BGC_DISCOVERY_MCP_NODE_ENTRY)
}

export function resolveBgcDiscoveryMcpCommand(
  launch: BgcDiscoveryMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildBgcDiscoveryMcpServerConfig(
  launch: BgcDiscoveryMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  const server = buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_BGC_DISCOVERY_MCP_DESCRIPTOR,
    launch,
    args: buildBgcDiscoveryMcpArgs(launch, normalizedWorkspaceRoot),
    env: bgcDiscoveryMcpEnv()
  })
  return normalizedWorkspaceRoot ? {
    ...server,
    trustScope: 'workspace',
    trustedWorkspaceRoots: [normalizedWorkspaceRoot]
  } : server
}

export function buildBgcDiscoveryLocalRuntimeMcpServerConfig(
  launch: BgcDiscoveryMcpLaunchConfig,
  existing: unknown = {},
  workspaceRoot?: string
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  const server = buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_BGC_DISCOVERY_MCP_DESCRIPTOR,
    launch,
    args: buildBgcDiscoveryMcpArgs(launch, normalizedWorkspaceRoot),
    env: bgcDiscoveryMcpEnv(),
    existing
  })
  return normalizedWorkspaceRoot ? {
    ...server,
    trustScope: 'workspace',
    trustedWorkspaceRoots: [normalizedWorkspaceRoot]
  } : server
}

export function buildBgcDiscoveryMcpJsonServerConfig(
  launch: BgcDiscoveryMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_BGC_DISCOVERY_MCP_DESCRIPTOR,
    launch,
    args: buildBgcDiscoveryMcpArgs(launch, workspaceRoot?.trim()),
    env: bgcDiscoveryMcpEnv()
  })
}

export function buildBgcDiscoveryMcpConfigFragment(
  launch: BgcDiscoveryMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return {
    servers: {
      [GUI_BGC_DISCOVERY_MCP_SERVER_NAME]: buildBgcDiscoveryMcpServerConfig(launch, workspaceRoot)
    }
  }
}

export function bgcDiscoveryMcpEnabledTools(): string[] {
  return Object.keys(BGC_DISCOVERY_TOOL_SIDE_EFFECTS)
}

export function bgcDiscoveryMcpEnv(existingEnv: Record<string, string> = {}): Record<string, string> {
  return {
    ...existingEnv,
    ...ELECTRON_RUN_AS_NODE_ENV
  }
}
