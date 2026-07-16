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
  DATASET_API_MCP_FLAG,
  DATASET_API_TOOL_SIDE_EFFECTS
} from '../../packages/workers/dataset-api/src/contract'

export const GUI_DATASET_API_MCP_SERVER_NAME = 'dataset_api'
const GUI_DATASET_API_MCP_NODE_ENTRY = 'out/main/dataset-api-mcp-node-entry.js'
export const GUI_DATASET_API_MCP_TIMEOUT_MS = 30_000

export type DatasetApiMcpLaunchConfig = ManagedGuiMcpLaunchConfig

export const GUI_DATASET_API_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_DATASET_API_MCP_SERVER_NAME,
  nodeEntry: GUI_DATASET_API_MCP_NODE_ENTRY,
  launchFlag: DATASET_API_MCP_FLAG,
  timeoutMs: GUI_DATASET_API_MCP_TIMEOUT_MS,
  enabledTools: datasetApiMcpEnabledTools
}

export function buildDatasetApiMcpArgs(
  launch: DatasetApiMcpLaunchConfig,
  workspaceRoot?: string
): string[] {
  const args = [
    resolveManagedGuiMcpNodeEntryPath(launch, GUI_DATASET_API_MCP_NODE_ENTRY),
    DATASET_API_MCP_FLAG
  ]
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (normalizedWorkspaceRoot) args.push('--workspace-root', normalizedWorkspaceRoot)
  return args
}

export function resolveDatasetApiMcpCommand(
  launch: DatasetApiMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildDatasetApiMcpServerConfig(
  launch: DatasetApiMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  const server = buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_DATASET_API_MCP_DESCRIPTOR,
    launch,
    args: buildDatasetApiMcpArgs(launch, normalizedWorkspaceRoot),
    env: ELECTRON_RUN_AS_NODE_ENV
  })
  return normalizedWorkspaceRoot ? {
    ...server,
    trustScope: 'workspace',
    trustedWorkspaceRoots: [normalizedWorkspaceRoot]
  } : server
}

export function buildDatasetApiLocalRuntimeMcpServerConfig(
  launch: DatasetApiMcpLaunchConfig,
  existing: unknown = {},
  workspaceRoot?: string
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  const server = buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_DATASET_API_MCP_DESCRIPTOR,
    launch,
    args: buildDatasetApiMcpArgs(launch, normalizedWorkspaceRoot),
    env: ELECTRON_RUN_AS_NODE_ENV,
    existing
  })
  return normalizedWorkspaceRoot ? {
    ...server,
    trustScope: 'workspace',
    trustedWorkspaceRoots: [normalizedWorkspaceRoot]
  } : server
}

export function buildDatasetApiMcpJsonServerConfig(
  launch: DatasetApiMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_DATASET_API_MCP_DESCRIPTOR,
    launch,
    args: buildDatasetApiMcpArgs(launch, workspaceRoot?.trim()),
    env: ELECTRON_RUN_AS_NODE_ENV
  })
}

export function buildDatasetApiMcpConfigFragment(
  launch: DatasetApiMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return {
    servers: {
      [GUI_DATASET_API_MCP_SERVER_NAME]: buildDatasetApiMcpServerConfig(launch, workspaceRoot)
    }
  }
}

export function datasetApiMcpEnabledTools(): string[] {
  return Object.keys(DATASET_API_TOOL_SIDE_EFFECTS)
}
