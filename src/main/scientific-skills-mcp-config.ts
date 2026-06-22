import { join, posix } from 'node:path'
import { resolveClawScheduleMcpCommand, type ClawScheduleMcpLaunchConfig } from './claw-schedule-mcp-config'

type JsonRecord = Record<string, unknown>

export type ScientificSkillsMcpLaunchConfig = ClawScheduleMcpLaunchConfig

export const SCIENTIFIC_SKILLS_MCP_SERVER_NAME = 'scientific_skills'
export const SCIENTIFIC_SKILLS_MCP_FLAG = '--scientific-skills-mcp-server'

const SCIENTIFIC_SKILLS_MCP_NODE_ENTRY = 'out/main/scientific-skills-mcp-node-entry.js'
const ELECTRON_RUN_AS_NODE_ENV = { ELECTRON_RUN_AS_NODE: '1' }

export function resolveScientificSkillsMcpNodeEntryPath(
  launch: ScientificSkillsMcpLaunchConfig
): string {
  if (launch.appPath.includes('/') && !launch.appPath.includes('\\')) {
    return posix.join(launch.appPath, SCIENTIFIC_SKILLS_MCP_NODE_ENTRY)
  }
  return join(launch.appPath, SCIENTIFIC_SKILLS_MCP_NODE_ENTRY)
}

export function resolveScientificSkillsMcpCommand(
  launch: ScientificSkillsMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveClawScheduleMcpCommand(launch, platform)
}

export function buildScientificSkillsMcpArgs(
  launch: ScientificSkillsMcpLaunchConfig,
  workspaceRoot?: string
): string[] {
  const args = [
    resolveScientificSkillsMcpNodeEntryPath(launch),
    SCIENTIFIC_SKILLS_MCP_FLAG
  ]
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (normalizedWorkspaceRoot) {
    args.push('--workspace-root', normalizedWorkspaceRoot)
  }
  return args
}

export function buildScientificSkillsMcpServerConfig(
  launch: ScientificSkillsMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  const trustScope = normalizedWorkspaceRoot ? 'workspace' : 'user'
  return {
    enabled: true,
    transport: 'stdio',
    command: resolveScientificSkillsMcpCommand(launch),
    args: buildScientificSkillsMcpArgs(launch, normalizedWorkspaceRoot),
    env: ELECTRON_RUN_AS_NODE_ENV,
    trustScope,
    ...(normalizedWorkspaceRoot ? { trustedWorkspaceRoots: [normalizedWorkspaceRoot] } : {}),
    timeoutMs: 30_000
  }
}

export function buildScientificSkillsMcpConfigFragment(
  launch: ScientificSkillsMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return {
    servers: {
      [SCIENTIFIC_SKILLS_MCP_SERVER_NAME]: buildScientificSkillsMcpServerConfig(launch, workspaceRoot)
    }
  }
}
