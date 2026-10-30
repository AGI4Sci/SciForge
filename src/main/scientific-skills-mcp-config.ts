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
  SCIENTIFIC_SKILLS_MCP_FLAG,
  SCIENTIFIC_SKILLS_TOOL_SIDE_EFFECTS
} from '../../packages/workers/scientific-plotting/src/contract'

export const GUI_SCIENTIFIC_SKILLS_MCP_SERVER_NAME = 'scientific_skills'
const GUI_SCIENTIFIC_SKILLS_MCP_NODE_ENTRY = 'out/main/scientific-skills-mcp-node-entry.js'
export const GUI_SCIENTIFIC_SKILLS_MCP_TIMEOUT_MS = 30_000
export const GUI_SCIENTIFIC_SKILLS_MCP_LAUNCH_FLAG = SCIENTIFIC_SKILLS_MCP_FLAG

export type ScientificSkillsMcpLaunchConfig = ManagedGuiMcpLaunchConfig

export const GUI_SCIENTIFIC_SKILLS_MCP_DESCRIPTOR: ManagedGuiMcpDescriptor = {
  serverName: GUI_SCIENTIFIC_SKILLS_MCP_SERVER_NAME,
  nodeEntry: GUI_SCIENTIFIC_SKILLS_MCP_NODE_ENTRY,
  launchFlag: GUI_SCIENTIFIC_SKILLS_MCP_LAUNCH_FLAG,
  timeoutMs: GUI_SCIENTIFIC_SKILLS_MCP_TIMEOUT_MS,
  enabledTools: scientificSkillsMcpEnabledTools
}

export function buildScientificSkillsMcpArgs(
  launch: ScientificSkillsMcpLaunchConfig,
  workspaceRoot?: string
): string[] {
  const args = [
    resolveScientificSkillsMcpNodeEntryPath(launch),
    GUI_SCIENTIFIC_SKILLS_MCP_LAUNCH_FLAG
  ]
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  if (normalizedWorkspaceRoot) args.push('--workspace-root', normalizedWorkspaceRoot)
  const skillsRoot = process.env.SCIFORGE_KDENSE_SKILLS_ROOT?.trim()
  if (skillsRoot) args.push('--skills-root', skillsRoot)
  return args
}

export function resolveScientificSkillsMcpNodeEntryPath(launch: ScientificSkillsMcpLaunchConfig): string {
  return resolveManagedGuiMcpNodeEntryPath(launch, GUI_SCIENTIFIC_SKILLS_MCP_NODE_ENTRY)
}

export function resolveScientificSkillsMcpCommand(
  launch: ScientificSkillsMcpLaunchConfig,
  platform: NodeJS.Platform = process.platform
): string {
  return resolveManagedGuiMcpCommand(launch, platform)
}

export function buildScientificSkillsMcpServerConfig(
  launch: ScientificSkillsMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  const normalizedWorkspaceRoot = workspaceRoot?.trim()
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_SCIENTIFIC_SKILLS_MCP_DESCRIPTOR,
    launch,
    args: buildScientificSkillsMcpArgs(launch, normalizedWorkspaceRoot),
    env: workerMcpEnv(launch),
    existing: normalizedWorkspaceRoot ? {
      trustScope: 'workspace',
      trustedWorkspaceRoots: [normalizedWorkspaceRoot]
    } : undefined
  })
}

export function buildScientificSkillsLocalRuntimeMcpServerConfig(
  launch: ScientificSkillsMcpLaunchConfig,
  existing: unknown = {},
  workspaceRoot?: string
): JsonRecord {
  return buildManagedGuiLocalRuntimeMcpServerConfig({
    descriptor: GUI_SCIENTIFIC_SKILLS_MCP_DESCRIPTOR,
    launch,
    args: buildScientificSkillsMcpArgs(launch, workspaceRoot?.trim()),
    env: workerMcpEnv(launch),
    existing
  })
}

export function buildScientificSkillsMcpJsonServerConfig(
  launch: ScientificSkillsMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return buildManagedGuiMcpJsonServerConfig({
    descriptor: GUI_SCIENTIFIC_SKILLS_MCP_DESCRIPTOR,
    launch,
    args: buildScientificSkillsMcpArgs(launch, workspaceRoot?.trim()),
    env: workerMcpEnv(launch)
  })
}

export function buildScientificSkillsMcpConfigFragment(
  launch: ScientificSkillsMcpLaunchConfig,
  workspaceRoot?: string
): JsonRecord {
  return {
    servers: {
      [GUI_SCIENTIFIC_SKILLS_MCP_SERVER_NAME]: buildScientificSkillsMcpServerConfig(launch, workspaceRoot)
    }
  }
}

export function scientificSkillsMcpEnabledTools(): string[] {
  return Object.keys(SCIENTIFIC_SKILLS_TOOL_SIDE_EFFECTS)
}

function workerMcpEnv(launch: ScientificSkillsMcpLaunchConfig): Record<string, string> {
  void launch
  return { ...ELECTRON_RUN_AS_NODE_ENV }
}
