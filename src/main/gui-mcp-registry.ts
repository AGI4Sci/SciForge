import type { AppSettingsV1 } from '../shared/app-settings'
import {
  buildDatasetApiLocalRuntimeMcpServerConfig,
  buildDatasetApiMcpArgs,
  datasetApiMcpEnabledTools,
  GUI_DATASET_API_MCP_DESCRIPTOR,
  GUI_DATASET_API_MCP_SERVER_NAME,
  GUI_DATASET_API_MCP_TIMEOUT_MS,
  resolveDatasetApiMcpCommand,
  type DatasetApiMcpLaunchConfig
} from './dataset-api-mcp-config'
import {
  buildScheduleMcpArgs,
  buildScheduleLocalRuntimeMcpServerConfig,
  scheduleMcpEnabledTools,
  GUI_SCHEDULE_INTERNAL_SECRET_ENV,
  GUI_SCHEDULE_MCP_DESCRIPTOR,
  GUI_SCHEDULE_MCP_SERVER_NAME,
  GUI_SCHEDULE_MCP_TIMEOUT_MS,
  resolveScheduleMcpCommand,
  type ScheduleMcpLaunchConfig
} from './schedule-mcp-config'
import {
  buildComputerUseLocalRuntimeMcpServerConfig,
  buildComputerUseMcpArgs,
  computerUseMcpEnabledTools,
  computerUseMcpEnv,
  COMPUTER_USE_MCP_TIMEOUT_MS,
  GUI_COMPUTER_USE_MCP_DESCRIPTOR,
  GUI_COMPUTER_USE_MCP_SERVER_NAME,
  isComputerUseMcpConfigured,
  resolveComputerUseMcpCommand,
  RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES,
  type ComputerUseMcpLaunchConfig
} from './computer-use-mcp-config'
import {
  buildPaperRadarMcpArgs,
  buildPaperRadarLocalRuntimeMcpServerConfig,
  GUI_PAPER_RADAR_MCP_DESCRIPTOR,
  GUI_PAPER_RADAR_MCP_SERVER_NAME,
  PAPER_RADAR_MCP_TIMEOUT_MS,
  paperRadarMcpEnabledTools,
  paperRadarMcpEnv,
  resolvePaperRadarMcpCommand,
  type PaperRadarMcpLaunchConfig
} from './paper-radar-mcp-config'
import {
  buildResearchSearchMcpArgs,
  buildResearchSearchLocalRuntimeMcpServerConfig,
  GUI_RESEARCH_MCP_DESCRIPTOR,
  GUI_RESEARCH_MCP_SERVER_NAME,
  RESEARCH_SEARCH_MCP_TIMEOUT_MS,
  RETIRED_GUI_RESEARCH_MCP_SERVER_NAMES,
  researchSearchMcpEnabledTools,
  researchSearchMcpEnv,
  resolveResearchSearchMcpCommand,
  type ResearchSearchMcpLaunchConfig
} from './research-search-mcp-config'
import {
  buildRuntimeInspectorMcpArgs,
  buildRuntimeInspectorLocalRuntimeMcpServerConfig,
  GUI_RUNTIME_INSPECTOR_MCP_DESCRIPTOR,
  GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME,
  resolveRuntimeInspectorMcpCommand,
  RUNTIME_INSPECTOR_MCP_TIMEOUT_MS,
  runtimeInspectorMcpEnabledTools,
  runtimeInspectorMcpEnv,
  type RuntimeInspectorMcpLaunchConfig
} from './runtime-inspector-mcp-config'
import {
  buildWorkspaceIntelMcpArgs,
  buildWorkspaceIntelLocalRuntimeMcpServerConfig,
  GUI_WORKSPACE_INTEL_MCP_DESCRIPTOR,
  GUI_WORKSPACE_INTEL_MCP_SERVER_NAME,
  resolveWorkspaceIntelMcpCommand,
  WORKSPACE_INTEL_MCP_TIMEOUT_MS,
  workspaceIntelMcpEnabledTools,
  workspaceIntelMcpEnv,
  type WorkspaceIntelMcpLaunchConfig
} from './workspace-intel-mcp-config'
import {
  buildRemoteExecutorMcpArgs,
  buildRemoteExecutorLocalRuntimeMcpServerConfig,
  GUI_REMOTE_EXECUTOR_MCP_DESCRIPTOR,
  GUI_REMOTE_EXECUTOR_MCP_SERVER_NAME,
  GUI_REMOTE_EXECUTOR_MCP_TIMEOUT_MS,
  remoteExecutorMcpEnabledTools,
  remoteExecutorMcpEnv,
  resolveRemoteExecutorMcpCommand,
  type RemoteExecutorMcpLaunchConfig
} from './remote-executor-mcp-config'
import {
  buildWorkflowMcpArgs,
  buildWorkflowLocalRuntimeMcpServerConfig,
  GUI_WORKFLOW_INTERNAL_SECRET_ENV,
  GUI_WORKFLOW_MCP_DESCRIPTOR,
  GUI_WORKFLOW_MCP_SERVER_NAME,
  resolveWorkflowMcpCommand,
  WORKFLOW_MCP_TIMEOUT_MS,
  workflowMcpEnabledTools,
  workflowMcpEnv,
  type WorkflowMcpLaunchConfig
} from './workflow-mcp-config'
import {
  buildWriteAssistMcpArgs,
  buildWriteAssistLocalRuntimeMcpServerConfig,
  GUI_WRITE_ASSIST_MCP_DESCRIPTOR,
  GUI_WRITE_ASSIST_MCP_SERVER_NAME,
  resolveWriteAssistMcpCommand,
  WRITE_ASSIST_MCP_TIMEOUT_MS,
  writeAssistMcpEnabledTools,
  writeAssistMcpEnv,
  type WriteAssistMcpLaunchConfig
} from './write-assist-mcp-config'
import {
  buildScientificSkillsMcpArgs,
  buildScientificSkillsLocalRuntimeMcpServerConfig,
  buildScientificSkillsMcpJsonServerConfig,
  GUI_SCIENTIFIC_SKILLS_MCP_DESCRIPTOR,
  GUI_SCIENTIFIC_SKILLS_MCP_SERVER_NAME,
  GUI_SCIENTIFIC_SKILLS_MCP_TIMEOUT_MS,
  resolveScientificSkillsMcpCommand,
  scientificSkillsMcpEnabledTools,
  type ScientificSkillsMcpLaunchConfig
} from './scientific-skills-mcp-config'
import {
  buildScientificPlottingMcpArgs,
  buildScientificPlottingLocalRuntimeMcpServerConfig,
  buildScientificPlottingMcpJsonServerConfig,
  GUI_SCIENTIFIC_PLOTTING_MCP_DESCRIPTOR,
  GUI_SCIENTIFIC_PLOTTING_MCP_SERVER_NAME,
  GUI_SCIENTIFIC_PLOTTING_MCP_TIMEOUT_MS,
  resolveScientificPlottingMcpCommand,
  scientificPlottingMcpEnabledTools,
  type ScientificPlottingMcpLaunchConfig
} from './scientific-plotting-mcp-config'
import {
  buildBgcDiscoveryMcpArgs,
  buildBgcDiscoveryLocalRuntimeMcpServerConfig,
  GUI_BGC_DISCOVERY_MCP_DESCRIPTOR,
  GUI_BGC_DISCOVERY_MCP_SERVER_NAME,
  GUI_BGC_DISCOVERY_MCP_TIMEOUT_MS,
  resolveBgcDiscoveryMcpCommand,
  bgcDiscoveryMcpEnabledTools,
  type BgcDiscoveryMcpLaunchConfig
} from './bgc-discovery-mcp-config'
import {
  buildImageGenerationMcpArgs,
  buildImageGenerationLocalRuntimeMcpServerConfig,
  buildImageGenerationMcpJsonServerConfig,
  GUI_IMAGE_GENERATION_MCP_DESCRIPTOR,
  GUI_IMAGE_GENERATION_MCP_SERVER_NAME,
  GUI_IMAGE_GENERATION_MCP_TIMEOUT_MS,
  resolveImageGenerationMcpCommand,
  imageGenerationMcpEnabledTools,
  type ImageGenerationMcpLaunchConfig
} from './image-generation-mcp-config'
import {
  buildPptMasterMcpArgs,
  buildPptMasterLocalRuntimeMcpServerConfig,
  buildPptMasterMcpJsonServerConfig,
  GUI_PPT_MASTER_MCP_DESCRIPTOR,
  GUI_PPT_MASTER_MCP_SERVER_NAME,
  GUI_PPT_MASTER_MCP_TIMEOUT_MS,
  resolvePptMasterMcpCommand,
  pptMasterMcpEnabledTools,
  type PptMasterMcpLaunchConfig
} from './ppt-master-mcp-config'
import {
  buildVisualDocumentMcpArgs,
  buildVisualDocumentLocalRuntimeMcpServerConfig,
  GUI_VISUAL_DOCUMENT_MCP_DESCRIPTOR,
  GUI_VISUAL_DOCUMENT_MCP_SERVER_NAME,
  GUI_VISUAL_DOCUMENT_MCP_TIMEOUT_MS,
  RETIRED_GUI_VISUAL_DOCUMENT_MCP_SERVER_NAMES,
  resolveVisualDocumentMcpCommand,
  visualDocumentMcpEnabledTools,
  type VisualDocumentMcpLaunchConfig
} from './visual-document-mcp-config'
import {
  managedGuiMcpNames,
  resolveLocalRuntimeMcpJsonPath,
  syncExternalLocalRuntimeMcpJson,
  type ManagedGuiMcpDescriptor
} from './managed-gui-mcp-config'
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
  workflowMcp?: {
    settings?: AppSettingsV1
    launch: WorkflowMcpLaunchConfig
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
  paperRadarMcp?: {
    launch: PaperRadarMcpLaunchConfig
  }
  writeAssistMcp?: {
    settings?: AppSettingsV1
    launch: WriteAssistMcpLaunchConfig
  }
  runtimeInspectorMcp?: {
    settings?: AppSettingsV1
    launch: RuntimeInspectorMcpLaunchConfig
  }
  datasetApiMcp?: {
    settings?: AppSettingsV1
    launch: DatasetApiMcpLaunchConfig
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
  visualDocumentMcp?: {
    settings?: AppSettingsV1
    launch: VisualDocumentMcpLaunchConfig
  }
  computerUseMcp?: {
    settings?: AppSettingsV1
    launch: ComputerUseMcpLaunchConfig
  }
}

type LocalRuntimeServerBuilder = () => Record<string, unknown>

export const GUI_MCP_DESCRIPTORS: readonly ManagedGuiMcpDescriptor[] = [
  GUI_SCHEDULE_MCP_DESCRIPTOR,
  GUI_RESEARCH_MCP_DESCRIPTOR,
  GUI_WORKFLOW_MCP_DESCRIPTOR,
  GUI_WORKSPACE_INTEL_MCP_DESCRIPTOR,
  GUI_REMOTE_EXECUTOR_MCP_DESCRIPTOR,
  GUI_PAPER_RADAR_MCP_DESCRIPTOR,
  GUI_WRITE_ASSIST_MCP_DESCRIPTOR,
  GUI_RUNTIME_INSPECTOR_MCP_DESCRIPTOR,
  GUI_DATASET_API_MCP_DESCRIPTOR,
  GUI_SCIENTIFIC_SKILLS_MCP_DESCRIPTOR,
  GUI_SCIENTIFIC_PLOTTING_MCP_DESCRIPTOR,
  GUI_BGC_DISCOVERY_MCP_DESCRIPTOR,
  GUI_IMAGE_GENERATION_MCP_DESCRIPTOR,
  GUI_PPT_MASTER_MCP_DESCRIPTOR,
  GUI_VISUAL_DOCUMENT_MCP_DESCRIPTOR,
  GUI_COMPUTER_USE_MCP_DESCRIPTOR
] as const

export function managedGuiMcpServerNames(): string[] {
  return [
    ...GUI_MCP_DESCRIPTORS.flatMap((descriptor) => managedGuiMcpNames(descriptor)),
    ...RETIRED_GUI_RESEARCH_MCP_SERVER_NAMES,
    ...RETIRED_GUI_VISUAL_DOCUMENT_MCP_SERVER_NAMES,
    ...RETIRED_GUI_COMPUTER_USE_MCP_SERVER_NAMES
  ]
}

export async function syncExternalManagedGuiMcpConfig(path = resolveLocalRuntimeMcpJsonPath()): Promise<void> {
  await syncExternalLocalRuntimeMcpJson(path, managedGuiMcpServerNames())
}

export function buildLocalRuntimeManagedGuiMcpServers(
  input: GuiMcpRegistryInput
): Record<string, unknown> {
  const servers: Record<string, unknown> = {}
  for (const [serverName, build] of localRuntimeServerBuilders(input)) {
    servers[serverName] = build()
  }
  return servers
}

export function hasEnabledManagedGuiMcpServer(servers: Record<string, unknown>): boolean {
  return Object.values(servers).some((server) => objectValue(server).enabled !== false)
}

export function buildCodexManagedGuiMcpServers(
  input: GuiMcpRegistryInput,
  existingServers: readonly GuiMcpRuntimeServerConfig[] = []
): GuiMcpRuntimeServerConfig[] {
  const servers = new Map<string, GuiMcpRuntimeServerConfig>()
  for (const server of existingServers) {
    servers.set(server.id, server)
  }
  for (const server of managedRuntimeServerConfigs(input, 'codex')) {
    if (!servers.has(server.id)) servers.set(server.id, server)
  }
  return [...servers.values()]
}

export function buildClaudeCodeManagedGuiMcpServers(input: GuiMcpRegistryInput = {}): Record<string, {
  type: 'stdio'
  command: string
  args: string[]
  env: Record<string, string>
  timeout: number
  alwaysLoad: true
}> {
  const servers: Record<string, {
    type: 'stdio'
    command: string
    args: string[]
    env: Record<string, string>
    timeout: number
    alwaysLoad: true
  }> = {}
  for (const server of managedRuntimeServerConfigs(input, 'claude')) {
    if (!server.command || !server.args || !server.env || !server.timeoutMs) continue
    servers[server.id] = {
      type: 'stdio',
      command: server.command,
      args: server.args,
      env: server.env,
      timeout: server.timeoutMs,
      alwaysLoad: true
    }
  }
  return servers
}

function localRuntimeServerBuilders(input: GuiMcpRegistryInput): Array<[string, LocalRuntimeServerBuilder]> {
  const builders: Array<[string, LocalRuntimeServerBuilder]> = []
  const settings = input.settings
  const scheduleSettings = input.scheduleMcp?.settings ?? settings
  if (input.scheduleMcp && scheduleSettings) {
    builders.push([
      GUI_SCHEDULE_MCP_SERVER_NAME,
      () => buildScheduleLocalRuntimeMcpServerConfig(scheduleSettings, input.scheduleMcp!.launch)
    ])
  }
  if (input.researchMcp) {
    builders.push([
      GUI_RESEARCH_MCP_SERVER_NAME,
      () => buildResearchSearchLocalRuntimeMcpServerConfig(input.researchMcp!.launch)
    ])
  }
  const workflowSettings = input.workflowMcp?.settings ?? settings
  if (input.workflowMcp && workflowSettings) {
    builders.push([
      GUI_WORKFLOW_MCP_SERVER_NAME,
      () => buildWorkflowLocalRuntimeMcpServerConfig(workflowSettings, input.workflowMcp!.launch)
    ])
  }
  const workspaceIntelSettings = input.workspaceIntelMcp?.settings ?? settings
  if (input.workspaceIntelMcp && workspaceIntelSettings) {
    builders.push([
      GUI_WORKSPACE_INTEL_MCP_SERVER_NAME,
      () => buildWorkspaceIntelLocalRuntimeMcpServerConfig(
        workspaceIntelSettings,
        input.workspaceIntelMcp!.launch
      )
    ])
  }
  if (input.remoteExecutorMcp) {
    const remoteExecutorSettings = input.remoteExecutorMcp.settings ?? settings
    builders.push([
      GUI_REMOTE_EXECUTOR_MCP_SERVER_NAME,
      () => buildRemoteExecutorLocalRuntimeMcpServerConfig(
        input.remoteExecutorMcp!.launch,
        undefined,
        input.remoteExecutorMcp!.enabled !== false,
        remoteExecutorSettings
      )
    ])
  }
  if (input.paperRadarMcp) {
    builders.push([
      GUI_PAPER_RADAR_MCP_SERVER_NAME,
      () => buildPaperRadarLocalRuntimeMcpServerConfig(input.paperRadarMcp!.launch)
    ])
  }
  const writeAssistSettings = input.writeAssistMcp?.settings ?? settings
  if (input.writeAssistMcp && writeAssistSettings) {
    builders.push([
      GUI_WRITE_ASSIST_MCP_SERVER_NAME,
      () => buildWriteAssistLocalRuntimeMcpServerConfig(writeAssistSettings, input.writeAssistMcp!.launch)
    ])
  }
  const runtimeInspectorSettings = input.runtimeInspectorMcp?.settings ?? settings
  if (input.runtimeInspectorMcp && runtimeInspectorSettings) {
    builders.push([
      GUI_RUNTIME_INSPECTOR_MCP_SERVER_NAME,
      () => buildRuntimeInspectorLocalRuntimeMcpServerConfig(
        runtimeInspectorSettings,
        input.runtimeInspectorMcp!.launch
      )
    ])
  }
  const datasetApiSettings = input.datasetApiMcp?.settings ?? settings
  if (input.datasetApiMcp && datasetApiSettings) {
    builders.push([
      GUI_DATASET_API_MCP_SERVER_NAME,
      () => buildDatasetApiLocalRuntimeMcpServerConfig(
        input.datasetApiMcp!.launch,
        undefined,
        datasetApiSettings.workspaceRoot
      )
    ])
  }
  const scientificSkillsSettings = input.scientificSkillsMcp?.settings ?? settings
  if (input.scientificSkillsMcp && scientificSkillsSettings) {
    builders.push([
      GUI_SCIENTIFIC_SKILLS_MCP_SERVER_NAME,
      () => buildScientificSkillsLocalRuntimeMcpServerConfig(
        input.scientificSkillsMcp!.launch,
        undefined,
        scientificSkillsSettings.workspaceRoot
      )
    ])
  }
  const scientificPlottingSettings = input.scientificPlottingMcp?.settings ?? settings
  if (input.scientificPlottingMcp && scientificPlottingSettings) {
    builders.push([
      GUI_SCIENTIFIC_PLOTTING_MCP_SERVER_NAME,
      () => buildScientificPlottingLocalRuntimeMcpServerConfig(
        input.scientificPlottingMcp!.launch,
        undefined,
        scientificPlottingSettings.workspaceRoot
      )
    ])
  }
  const bgcDiscoverySettings = input.bgcDiscoveryMcp?.settings ?? settings
  if (input.bgcDiscoveryMcp && bgcDiscoverySettings) {
    builders.push([
      GUI_BGC_DISCOVERY_MCP_SERVER_NAME,
      () => buildBgcDiscoveryLocalRuntimeMcpServerConfig(
        input.bgcDiscoveryMcp!.launch,
        undefined,
        bgcDiscoverySettings.workspaceRoot
      )
    ])
  }
  const imageGenerationSettings = input.imageGenerationMcp?.settings ?? settings
  if (input.imageGenerationMcp && imageGenerationSettings) {
    builders.push([
      GUI_IMAGE_GENERATION_MCP_SERVER_NAME,
      () => buildImageGenerationLocalRuntimeMcpServerConfig(
        input.imageGenerationMcp!.launch,
        undefined,
        imageGenerationSettings.workspaceRoot,
        imageGenerationSettings
      )
    ])
  }
  const pptMasterSettings = input.pptMasterMcp?.settings ?? settings
  if (input.pptMasterMcp && pptMasterSettings) {
    builders.push([
      GUI_PPT_MASTER_MCP_SERVER_NAME,
      () => buildPptMasterLocalRuntimeMcpServerConfig(
        input.pptMasterMcp!.launch,
        undefined,
        pptMasterSettings.workspaceRoot
      )
    ])
  }
  const visualDocumentSettings = input.visualDocumentMcp?.settings ?? settings
  if (input.visualDocumentMcp && visualDocumentSettings) {
    builders.push([
      GUI_VISUAL_DOCUMENT_MCP_SERVER_NAME,
      () => buildVisualDocumentLocalRuntimeMcpServerConfig(
        input.visualDocumentMcp!.launch,
        undefined,
        visualDocumentSettings.workspaceRoot
      )
    ])
  }
  const computerUseSettings = input.computerUseMcp?.settings ?? settings
  if (input.computerUseMcp && computerUseSettings) {
    builders.push([
      GUI_COMPUTER_USE_MCP_SERVER_NAME,
      () => buildComputerUseLocalRuntimeMcpServerConfig(
        computerUseSettings,
        input.computerUseMcp!.launch
      )
    ])
  }
  return builders
}

function managedRuntimeServerConfigs(
  input: GuiMcpRegistryInput,
  runtime: 'codex' | 'claude'
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
  const workflowSettings = input.workflowMcp?.settings ?? settings
  if (input.workflowMcp && workflowSettings) {
    servers.push({
      id: GUI_WORKFLOW_MCP_SERVER_NAME,
      command: resolveWorkflowMcpCommand(input.workflowMcp.launch),
      args: buildWorkflowMcpArgs(workflowSettings, input.workflowMcp.launch),
      env: workflowMcpEnv(internalSecretEnv(GUI_WORKFLOW_INTERNAL_SECRET_ENV, workflowSettings.workflow.webhookSecret)),
      timeoutMs: WORKFLOW_MCP_TIMEOUT_MS,
      enabledTools: workflowMcpEnabledTools()
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
  if (input.paperRadarMcp) {
    servers.push({
      id: GUI_PAPER_RADAR_MCP_SERVER_NAME,
      command: resolvePaperRadarMcpCommand(input.paperRadarMcp.launch),
      args: buildPaperRadarMcpArgs(input.paperRadarMcp.launch),
      env: paperRadarMcpEnv(),
      timeoutMs: PAPER_RADAR_MCP_TIMEOUT_MS,
      enabledTools: paperRadarMcpEnabledTools()
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
  const datasetApiSettings = input.datasetApiMcp?.settings ?? settings
  if (input.datasetApiMcp && datasetApiSettings) {
    servers.push({
      id: GUI_DATASET_API_MCP_SERVER_NAME,
      command: resolveDatasetApiMcpCommand(input.datasetApiMcp.launch),
      args: buildDatasetApiMcpArgs(
        input.datasetApiMcp.launch,
        datasetApiSettings.workspaceRoot
      ),
      env: { ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: GUI_DATASET_API_MCP_TIMEOUT_MS,
      enabledTools: datasetApiMcpEnabledTools()
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
  const visualDocumentSettings = input.visualDocumentMcp?.settings ?? settings
  if (input.visualDocumentMcp && visualDocumentSettings) {
    servers.push({
      id: GUI_VISUAL_DOCUMENT_MCP_SERVER_NAME,
      command: resolveVisualDocumentMcpCommand(input.visualDocumentMcp.launch),
      args: buildVisualDocumentMcpArgs(
        input.visualDocumentMcp.launch,
        visualDocumentSettings.workspaceRoot
      ),
      env: { ELECTRON_RUN_AS_NODE: '1' },
      timeoutMs: GUI_VISUAL_DOCUMENT_MCP_TIMEOUT_MS,
      enabledTools: visualDocumentMcpEnabledTools()
    })
  }
  const computerUseSettings = input.computerUseMcp?.settings ?? settings
  if (input.computerUseMcp && computerUseSettings && isComputerUseMcpConfigured(computerUseSettings, runtime)) {
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
