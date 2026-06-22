import { join, posix } from 'node:path'
import { resolveClawScheduleMcpCommand, type ClawScheduleMcpLaunchConfig } from './claw-schedule-mcp-config'

type JsonRecord = Record<string, unknown>

export type ScientificPlottingMcpLaunchConfig = ClawScheduleMcpLaunchConfig

export const SCIENTIFIC_PLOTTING_MCP_SERVER_NAME = 'scientific_plotting'
export const SCIENTIFIC_PLOTTING_MCP_FLAG = '--scientific-plotting-mcp-server'

const SCIENTIFIC_PLOTTING_MCP_NODE_ENTRY = 'out/main/scientific-plotting-mcp-node-entry.js'
const ELECTRON_RUN_AS_NODE_ENV = { ELECTRON_RUN_AS_NODE: '1' }

export function resolveScientificPlottingMcpNodeEntryPath(
  launch: ScientificPlottingMcpLaunchConfig
): string {
  if (launch.appPath.includes('/') && !launch.appPath.includes('\\')) {
    return posix.join(launch.appPath, SCIENTIFIC_PLOTTING_MCP_NODE_ENTRY)
  }
  return join(launch.appPath, SCIENTIFIC_PLOTTING_MCP_NODE_ENTRY)
}

export function resolveScientificPlottingMcpCommand(
  launch: ScientificPlottingMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveClawScheduleMcpCommand(launch, platform)
}

export function buildScientificPlottingMcpArgs(
  launch: ScientificPlottingMcpLaunchConfig,
  workspaceRoot?: string
): string[] {
  const args = [
    resolveScientificPlottingMcpNodeEntryPath(launch),
    SCIENTIFIC_PLOTTING_MCP_FLAG
  ]
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (normalizedWorkspaceRoot) {
    args.push('--workspace-root', normalizedWorkspaceRoot)
  }
  return args
}

export function buildScientificPlottingMcpServerConfig(
  launch: ScientificPlottingMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  const trustScope = normalizedWorkspaceRoot ? 'workspace' : 'user'
  return {
    enabled: true,
    transport: 'stdio',
    command: resolveScientificPlottingMcpCommand(launch),
    args: buildScientificPlottingMcpArgs(launch, normalizedWorkspaceRoot),
    env: ELECTRON_RUN_AS_NODE_ENV,
    trustScope,
    ...(normalizedWorkspaceRoot ? { trustedWorkspaceRoots: [normalizedWorkspaceRoot] } : {}),
    timeoutMs: 60_000
  }
}

export function buildScientificPlottingMcpConfigFragment(
  launch: ScientificPlottingMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return {
    servers: {
      [SCIENTIFIC_PLOTTING_MCP_SERVER_NAME]: buildScientificPlottingMcpServerConfig(launch, workspaceRoot)
    }
  }
}
