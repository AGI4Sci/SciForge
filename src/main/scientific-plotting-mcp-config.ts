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
  SCIENTIFIC_PLOTTING_MCP_FLAG,
  SCIENTIFIC_PLOTTING_TOOL_SIDE_EFFECTS
} from '../../packages/workers/scientific-plotting/src/contract'

export const GUI_SCIENTIFIC_PLOTTING_MCP_SERVER_NAME = 'scientific_plotting'
const GUI_SCIENTIFIC_PLOTTING_MCP_NODE_ENTRY = 'out/main/scientific-plotting-mcp-node-entry.js'
export const GUI_SCIENTIFIC_PLOTTING_MCP_TIMEOUT_MS = 60_000
export const GUI_SCIENTIFIC_PLOTTING_MCP_LAUNCH_FLAG = SCIENTIFIC_PLOTTING_MCP_FLAG

export type ScientificPlottingMcpLaunchConfig = ManagedGuiMcpLaunchConfig

export const GUI_SCIENTIFIC_PLOTTING_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_SCIENTIFIC_PLOTTING_MCP_SERVER_NAME,
  nodeEntry: GUI_SCIENTIFIC_PLOTTING_MCP_NODE_ENTRY,
  launchFlag: GUI_SCIENTIFIC_PLOTTING_MCP_LAUNCH_FLAG,
  timeoutMs: GUI_SCIENTIFIC_PLOTTING_MCP_TIMEOUT_MS,
  enabledTools: scientificPlottingMcpEnabledTools
}

export function buildScientificPlottingMcpArgs(
  launch: ScientificPlottingMcpLaunchConfig,
  workspaceRoot?: string
): string[] {
  const args = [
    resolveScientificPlottingMcpNodeEntryPath(launch),
    GUI_SCIENTIFIC_PLOTTING_MCP_LAUNCH_FLAG
  ]
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (normalizedWorkspaceRoot) args.push('--workspace-root', normalizedWorkspaceRoot)

  return args
}

export function resolveScientificPlottingMcpNodeEntryPath(launch: ScientificPlottingMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_SCIENTIFIC_PLOTTING_MCP_NODE_ENTRY)
}

export function resolveScientificPlottingMcpCommand(
  launch: ScientificPlottingMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildScientificPlottingMcpServerConfig(
  launch: ScientificPlottingMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_SCIENTIFIC_PLOTTING_MCP_DESCRIPTOR,
    launch,
    args: buildScientificPlottingMcpArgs(launch, normalizedWorkspaceRoot),
    env: workerMcpEnv(launch),
    existing: normalizedWorkspaceRoot ? {
      trustScope: 'workspace',
      trustedWorkspaceRoots: [normalizedWorkspaceRoot]
    } : undefined
  })
}

export function buildScientificPlottingLocalRuntimeMcpServerConfig(
  launch: ScientificPlottingMcpLaunchConfig,
  existing: unknown = {},
  workspaceRoot?: string
): JsonRecord {
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_SCIENTIFIC_PLOTTING_MCP_DESCRIPTOR,
    launch,
    args: buildScientificPlottingMcpArgs(launch, workspaceRoot?.trim()),
    env: workerMcpEnv(launch),
    existing
  })
}

export function buildScientificPlottingMcpJsonServerConfig(
  launch: ScientificPlottingMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_SCIENTIFIC_PLOTTING_MCP_DESCRIPTOR,
    launch,
    args: buildScientificPlottingMcpArgs(launch, workspaceRoot?.trim()),
    env: workerMcpEnv(launch)
  })
}

export function buildScientificPlottingMcpConfigFragment(
  launch: ScientificPlottingMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return {
    servers: {
      [GUI_SCIENTIFIC_PLOTTING_MCP_SERVER_NAME]: buildScientificPlottingMcpServerConfig(launch, workspaceRoot)
    }
  }
}

export function scientificPlottingMcpEnabledTools(): string[] {
  const domainOwned = new Set([
    'scientific_plotting_status',
    'scientific_plotting_map_data',
    'scientific_plotting_render',
    'scientific_plotting_rerun',
    'scientific_plotting_compare'
  ])
  return Object.keys(SCIENTIFIC_PLOTTING_TOOL_SIDE_EFFECTS)
    .filter((tool) => !domainOwned.has(tool))
}

function workerMcpEnv(launch: ScientificPlottingMcpLaunchConfig): Record<string, string> {
  void launch
  return { ...ELECTRON_RUN_AS_NODE_ENV }
}
