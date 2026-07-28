import type { AppSettingsV1 } from '../shared/app-settings'
import {
  buildScheduleMcpArgs,
  scheduleMcpEnabledTools,
  GUI_SCHEDULE_INTERNAL_SECRET_ENV,
  GUI_SCHEDULE_MCP_SERVER_NAME,
  GUI_SCHEDULE_MCP_TIMEOUT_MS,
  resolveScheduleMcpCommand,
  type ScheduleMcpLaunchConfig
} from './schedule-mcp-config'
import {
  buildComputerUseMcpArgs,
  computerUseMcpEnabledTools,
  computerUseMcpEnv,
  COMPUTER_USE_MCP_TIMEOUT_MS,
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  isComputerUseMcpConfigured,
  resolveComputerUseMcpCommand,
  type ComputerUseMcpLaunchConfig
} from './computer-use-mcp-config'
import {
  buildResearchSearchMcpArgs,
  GUI_RESEARCH_MCP_SERVER_NAME,
  RESEARCH_SEARCH_MCP_TIMEOUT_MS,
  researchSearchMcpEnabledTools,
  researchSearchMcpEnv,
  resolveResearchSearchMcpCommand,
  type ResearchSearchMcpLaunchConfig
} from './research-search-mcp-config'
import {
  buildRuntimeInspectorMcpArgs,
  GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME,
  resolveRuntimeInspectorMcpCommand,
  RUNTIME_INSPECTOR_MCP_TIMEOUT_MS,
  runtimeInspectorMcpEnabledTools,
  runtimeInspectorMcpEnv,
  type RuntimeInspectorMcpLaunchConfig
} from './runtime-inspector-mcp-config'
import {
  buildWorkspaceIntelMcpArgs,
  GUI_WORKSPACE_INTEL_MCP_SERVER_NAME,
  resolveWorkspaceIntelMcpCommand,
  WORKSPACE_INTEL_MCP_TIMEOUT_MS,
  workspaceIntelMcpEnabledTools,
  workspaceIntelMcpEnv,
  type WorkspaceIntelMcpLaunchConfig
} from './workspace-intel-mcp-config'
import {
  buildRemoteExecutorMcpArgs,
  GUI_REMOTE_EXECUTOR_MCP_SERVER_NAME,
  GUI_REMOTE_EXECUTOR_MCP_TIMEOUT_MS,
  remoteExecutorMcpEnabledTools,
  remoteExecutorMcpEnv,
  resolveRemoteExecutorMcpCommand,
  type RemoteExecutorMcpLaunchConfig
} from './remote-executor-mcp-config'
import {
  buildWriteAssistMcpArgs,
  GUI_WRITE_ASSIST_MCP_SERVER_NAME,
  resolveWriteAssistMcpCommand,
  WRITE_ASSIST_MCP_TIMEOUT_MS,
  writeAssistMcpEnabledTools,
  writeAssistMcpEnv,
  type WriteAssistMcpLaunchConfig
} from './write-assist-mcp-config'
import {
  buildScientificSkillsMcpArgs,
  buildScientificSkillsMcpJsonServerConfig,
  GUI_SCIENTIFIC_SKILLS_MCP_SERVER_NAME,
  GUI_SCIENTIFIC_SKILLS_MCP_TIMEOUT_MS,
  resolveScientificSkillsMcpCommand,
  scientificSkillsMcpEnabledTools,
  type ScientificSkillsMcpLaunchConfig
} from './scientific-skills-mcp-config'
import {
  buildScientificPlottingMcpArgs,
  buildScientificPlottingMcpJsonServerConfig,
  GUI_SCIENTIFIC_PLOTTING_MCP_SERVER_NAME,
  GUI_SCIENTIFIC_PLOTTING_MCP_TIMEOUT_MS,
  resolveScientificPlottingMcpCommand,
  scientificPlottingMcpEnabledTools,
  type ScientificPlottingMcpLaunchConfig
} from './scientific-plotting-mcp-config'
import {
  buildBgcDiscoveryMcpArgs,
  GUI_BGC_DISCOVERY_MCP_SERVER_NAME,
  GUI_BGC_DISCOVERY_MCP_TIMEOUT_MS,
  resolveBgcDiscoveryMcpCommand,
  bgcDiscoveryMcpEnabledTools,
  type BgcDiscoveryMcpLaunchConfig
} from './bgc-discovery-mcp-config'
import {
  buildImageGenerationMcpArgs,
  buildImageGenerationMcpJsonServerConfig,
  GUI_IMAGE_GENERATION_MCP_SERVER_NAME,
  GUI_IMAGE_GENERATION_MCP_TIMEOUT_MS,
  resolveImageGenerationMcpCommand,
  imageGenerationMcpEnabledTools,
  type ImageGenerationMcpLaunchConfig
} from './image-generation-mcp-config'
import {
  buildPptMasterMcpArgs,
  buildPptMasterMcpJsonServerConfig,
  GUI_PPT_MASTER_MCP_SERVER_NAME,
  GUI_PPT_MASTER_MCP_TIMEOUT_MS,
  resolvePptMasterMcpCommand,
  pptMasterMcpEnabledTools,
  type PptMasterMcpLaunchConfig
} from './ppt-master-mcp-config'
import { internalSecretEnv } from './internal-http-secret'

export type GuiMcpRuntimeServerConfig = {
  id: string
  command: string
  args?: string[]
  env?: Record<string, string>
  timeoutMs?: number
  enabledTools?: string[]
}

export type GuiMcpRegistryInput = {
  settings?: AppSettingsV1
  scheduleMcp?: {
    settings?: AppSettingsV1
    launch: ScheduleMcpLaunchConfig
  }
  researchMcp?: {
    launch: ResearchSearchMcpLaunchConfig
  }
  workspaceIntelMcp?: {
    settings?: AppSettingsV1
    launch: WorkspaceIntelMcpLaunchConfig
  }
  remoteExecutorMcp?: {
    settings?: AppSettingsV1
    launch: RemoteExecutorMcpLaunchConfig
    enabled?: boolean
  }
  writeAssistMcp?: {
    settings?: AppSettingsV1
    launch: WriteAssistMcpLaunchConfig
  }
  runtimeInspectorMcp?: {
    settings?: AppSettingsV1
    launch: RuntimeInspectorMcpLaunchConfig
  }
  scientificSkillsMcp?: {
    settings?: AppSettingsV1
    launch: ScientificSkillsMcpLaunchConfig
  }
  scientificPlottingMcp?: {
    settings?: AppSettingsV1
    launch: ScientificPlottingMcpLaunchConfig
  }
  bgcDiscoveryMcp?: {
    settings?: AppSettingsV1
    launch: BgcDiscoveryMcpLaunchConfig
  }
  imageGenerationMcp?: {
    settings?: AppSettingsV1
    launch: ImageGenerationMcpLaunchConfig
  }
  pptMasterMcp?: {
    settings?: AppSettingsV1
    launch: PptMasterMcpLaunchConfig
  }
  computerUseMcp?: {
    settings?: AppSettingsV1
    launch: ComputerUseMcpLaunchConfig
  }
}

export function buildManagedGuiMcpServers(
  input: GuiMcpRegistryInput
): GuiMcpRuntimeServerConfig[] {
  return managedRuntimeServerConfigs(input)
}

function managedRuntimeServerConfigs(
  input: GuiMcpRegistryInput
): GuiMcpRuntimeServerConfig[] {
  const servers: GuiMcpRuntimeServerConfig[] = []
  const settings = input.settings
  const scheduleSettings = input.scheduleMcp?.settings ?? settings
  if (input.scheduleMcp && scheduleSettings) {
    servers.push({
      id: GUI_SCHEDULE_MCP_SERVER_NAME,
      command: resolveScheduleMcpCommand(input.scheduleMcp.launch),
      args: buildScheduleMcpArgs(scheduleSettings, input.scheduleMcp.launch),
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        ...internalSecretEnv(GUI_SCHEDULE_INTERNAL_SECRET_ENV, scheduleSettings.schedule.internal.secret)
      },
      timeoutMs: GUI_SCHEDULE_MCP_TIMEOUT_MS,
      enabledTools: scheduleMcpEnabledTools()
    })
  }
  if (input.researchMcp) {
    servers.push({
      id: GUI_RESEARCH_MCP_SERVER_NAME,
      command: resolveResearchSearchMcpCommand(input.researchMcp.launch),
      args: buildResearchSearchMcpArgs(input.researchMcp.launch),
      env: researchSearchMcpEnv(process.env),
      timeoutMs: RESEARCH_SEARCH_MCP_TIMEOUT_MS,
      enabledTools: researchSearchMcpEnabledTools()
    })
  }
  const workspaceIntelSettings = input.workspaceIntelMcp?.settings ?? settings
  if (input.workspaceIntelMcp && workspaceIntelSettings) {
    servers.push({
      id: GUI_WORKSPACE_INTEL_MCP_SERVER_NAME,
      command: resolveWorkspaceIntelMcpCommand(input.workspaceIntelMcp.launch),
      args: buildWorkspaceIntelMcpArgs(workspaceIntelSettings, input.workspaceIntelMcp.launch),
      env: workspaceIntelMcpEnv({}, workspaceIntelSettings),
      timeoutMs: WORKSPACE_INTEL_MCP_TIMEOUT_MS,
      enabledTools: workspaceIntelMcpEnabledTools()
    })
  }
  if (input.remoteExecutorMcp?.launch && input.remoteExecutorMcp.enabled !== false) {
    const remoteExecutorSettings = input.remoteExecutorMcp.settings ?? settings
    servers.push({
      id: GUI_REMOTE_EXECUTOR_MCP_SERVER_NAME,
      command: resolveRemoteExecutorMcpCommand(input.remoteExecutorMcp.launch),
      args: buildRemoteExecutorMcpArgs(input.remoteExecutorMcp.launch),
      env: remoteExecutorMcpEnv({}, remoteExecutorSettings),
      timeoutMs: GUI_REMOTE_EXECUTOR_MCP_TIMEOUT_MS,
      enabledTools: remoteExecutorMcpEnabledTools()
    })
  }
  const writeAssistSettings = input.writeAssistMcp?.settings ?? settings
  if (input.writeAssistMcp && writeAssistSettings) {
    servers.push({
      id: GUI_WRITE_ASSIST_MCP_SERVER_NAME,
      command: resolveWriteAssistMcpCommand(input.writeAssistMcp.launch),
      args: buildWriteAssistMcpArgs(writeAssistSettings, input.writeAssistMcp.launch),
      env: writeAssistMcpEnv(),
      timeoutMs: WRITE_ASSIST_MCP_TIMEOUT_MS,
      enabledTools: writeAssistMcpEnabledTools()
    })
  }
  const runtimeInspectorSettings = input.runtimeInspectorMcp?.settings ?? settings
  if (input.runtimeInspectorMcp && runtimeInspectorSettings) {
    servers.push({
      id: GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME,
      command: resolveRuntimeInspectorMcpCommand(input.runtimeInspectorMcp.launch),
      args: buildRuntimeInspectorMcpArgs(runtimeInspectorSettings, input.runtimeInspectorMcp.launch),
      env: runtimeInspectorMcpEnv(),
      timeoutMs: RUNTIME_INSPECTOR_MCP_TIMEOUT_MS,
      enabledTools: runtimeInspectorMcpEnabledTools()
    })
  }
  const scientificSkillsSettings = input.scientificSkillsMcp?.settings ?? settings
  if (input.scientificSkillsMcp && scientificSkillsSettings) {
    servers.push({
      id: GUI_SCIENTIFIC_SKILLS_MCP_SERVER_NAME,
      command: resolveScientificSkillsMcpCommand(input.scientificSkillsMcp.launch),
      args: buildScientificSkillsMcpArgs(
        input.scientificSkillsMcp.launch,
        scientificSkillsSettings.workspaceRoot
      ),
      env: { ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: GUI_SCIENTIFIC_SKILLS_MCP_TIMEOUT_MS,
      enabledTools: scientificSkillsMcpEnabledTools()
    })
  }
  const scientificPlottingSettings = input.scientificPlottingMcp?.settings ?? settings
  if (input.scientificPlottingMcp && scientificPlottingSettings) {
    servers.push({
      id: GUI_SCIENTIFIC_PLOTTING_MCP_SERVER_NAME,
      command: resolveScientificPlottingMcpCommand(input.scientificPlottingMcp.launch),
      args: buildScientificPlottingMcpArgs(
        input.scientificPlottingMcp.launch,
        scientificPlottingSettings.workspaceRoot
      ),
      env: { ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: GUI_SCIENTIFIC_PLOTTING_MCP_TIMEOUT_MS,
      enabledTools: scientificPlottingMcpEnabledTools()
    })
  }
  const bgcDiscoverySettings = input.bgcDiscoveryMcp?.settings ?? settings
  if (input.bgcDiscoveryMcp && bgcDiscoverySettings) {
    servers.push({
      id: GUI_BGC_DISCOVERY_MCP_SERVER_NAME,
      command: resolveBgcDiscoveryMcpCommand(input.bgcDiscoveryMcp.launch),
      args: buildBgcDiscoveryMcpArgs(
        input.bgcDiscoveryMcp.launch,
        bgcDiscoverySettings.workspaceRoot
      ),
      env: { ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: GUI_BGC_DISCOVERY_MCP_TIMEOUT_MS,
      enabledTools: bgcDiscoveryMcpEnabledTools()
    })
  }
  const imageGenerationSettings = input.imageGenerationMcp?.settings ?? settings
  if (input.imageGenerationMcp && imageGenerationSettings) {
    const config = buildImageGenerationMcpJsonServerConfig(
      input.imageGenerationMcp.launch,
      imageGenerationSettings.workspaceRoot,
      imageGenerationSettings
    )
    servers.push(runtimeServerConfigFromJson(
      GUI_IMAGE_GENERATION_MCP_SERVER_NAME,
      config,
      GUI_IMAGE_GENERATION_MCP_TIMEOUT_MS,
      imageGenerationMcpEnabledTools()
    ))
  }
  const pptMasterSettings = input.pptMasterMcp?.settings ?? settings
  if (input.pptMasterMcp && pptMasterSettings) {
    const config = buildPptMasterMcpJsonServerConfig(
      input.pptMasterMcp.launch,
      pptMasterSettings.workspaceRoot
    )
    servers.push(runtimeServerConfigFromJson(GUI_PPT_MASTER_MCP_SERVER_NAME, config, GUI_PPT_MASTER_MCP_TIMEOUT_MS, pptMasterMcpEnabledTools()))
  }
  const computerUseSettings = input.computerUseMcp?.settings ?? settings
  if (
    input.computerUseMcp
    && computerUseSettings
    && (
      isComputerUseMcpConfigured(computerUseSettings, 'codex')
      || isComputerUseMcpConfigured(computerUseSettings, 'claude')
    )
  ) {
    servers.push({
      id: GUI_COMPUTER_USE_MCP_SERVER_NAME,
      command: resolveComputerUseMcpCommand(input.computerUseMcp.launch),
      args: buildComputerUseMcpArgs(input.computerUseMcp.launch),
      env: computerUseMcpEnv(),
      timeoutMs: COMPUTER_USE_MCP_TIMEOUT_MS,
      enabledTools: computerUseMcpEnabledTools()
    })
  }
  return servers
}

function runtimeServerConfigFromJson(
  id: string,
  config: Record<string, unknown>,
  timeoutMs: number,
  enabledTools: string[]
): GuiMcpRuntimeServerConfig {
  return {
    id,
    command: typeof config.command === 'string' ? config.command : '',
    args: Array.isArray(config.args) ? config.args.filter((item): item is string => typeof item === 'string') : [],
    env: stringRecord(config.env),
    timeoutMs,
    enabledTools
  }
}

function stringRecord(value: unknown): Record<string, string> {
  const record = objectValue(value)
  const out: Record<string, string> = {}
  for (const [key, item] of Object.entries(record)) {
    if (typeof item === 'string') out[key] = item
  }
  return out
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}
