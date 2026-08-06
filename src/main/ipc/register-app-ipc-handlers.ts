import { app, dialog, ipcMain, shell, type BrowserWindow, type IpcMainInvokeEvent, type WebContents } from 'electron'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { z } from 'zod'
import type {
  TraceClearResult,
  TraceExportOptions,
  TraceExportResult,
  TraceReadQuery,
  TraceReadResult,
  TraceSummary,
  TraceSummaryQuery
} from '@sciforge/full-trace'
import { mainPerformanceMonitor } from '../performance-monitor'
import { capabilityAgentCallerId } from '../capabilities/agent-tools'
import {
  type AppSettingsPatch,
  type AppSettingsV1,
  type ScheduleRunResult,
  type ScheduleRuntimeStatus,
  type ScheduleTaskFromTextResult
} from '../../shared/app-settings'
import type {
  ConnectPhoneInstallPollResult,
  ConnectPhoneInstallQrResult,
  ConnectPhoneRuntimeStatus,
  DesktopCommand,
  ModelAccessStatus,
  SystemNotificationResult,
  TurnCompleteNotificationPayload,
  UpstreamModelsResult,
  WorkspacePickResult
} from '../../shared/sciforge-api'
import type { DomainExtensionsApi } from '../../shared/domain-extensions'
import type { RemoteWorkspaceController } from '../workspace-host/controller'
import type { WorkspaceFileWatchResult } from '../../shared/workspace-file'
import type { GuiUpdateDownloadResult, GuiUpdateInfo, GuiUpdateInstallResult, GuiUpdateState } from '../../shared/gui-update'
import {
  agentRuntimeConnectPayloadSchema,
  agentRuntimeAuxiliaryPayloadSchema,
  agentRuntimeApprovalResolvePayloadSchema,
  discordBindChannelPayloadSchema,
  discordConfigureClientPayloadSchema,
  discordConfigureProxyPayloadSchema,
  discordConfigureTokenPayloadSchema,
  discordGuildChannelsPayloadSchema,
  discordSetGuardPayloadSchema,
  discordTestSendPayloadSchema,
  zulipBindChannelPayloadSchema,
  zulipConfigurePayloadSchema,
  zulipSetGuardPayloadSchema,
  zulipStreamTopicsPayloadSchema,
  zulipTestSendPayloadSchema,
  agentRuntimeEventSubscribePayloadSchema,
  agentRuntimeListThreadsPayloadSchema,
  agentRuntimeReadThreadPayloadSchema,
  agentRuntimeReadThreadSidebarProbePayloadSchema,
  agentRuntimeSessionResumePayloadSchema,
  agentRuntimeStartThreadPayloadSchema,
  agentRuntimeStartTurnPayloadSchema,
  agentRuntimeThreadCompactPayloadSchema,
  agentRuntimeThreadDeletePayloadSchema,
  agentRuntimeThreadForkPayloadSchema,
  agentRuntimeThreadRelationPayloadSchema,
  agentRuntimeThreadRenamePayloadSchema,
  agentRuntimeTurnSteerPayloadSchema,
  agentRuntimeTurnTargetPayloadSchema,
  agentRuntimeUsagePayloadSchema,
  agentRuntimeUserInputResolvePayloadSchema,
  connectPhoneInstallPollPayloadSchema,
  connectPhoneInstallQrPayloadSchema,
  computerUsePermissionKindSchema,
  remoteChannelActiveThreadContextPayloadSchema,
  remoteChannelMirrorPayloadSchema,
  remoteChannelTaskFromTextPayloadSchema,
  remoteWorkspaceAttachPayloadSchema,
  remoteWorkspaceSelectPayloadSchema,
  remoteWorkspaceSessionPayloadSchema,
  desktopCommandSchema,
  defaultPathSchema,
  domainExtensionInstallPayloadSchema,
  domainExtensionListPayloadSchema,
  domainExtensionListResultSchema,
  domainExtensionPackagePayloadSchema,
  domainExtensionSetEnabledPayloadSchema,
  domainExtensionSummarySchema,
  visualStyleExtractPayloadSchema,
  visualStyleSaveProfilePayloadSchema,
  pptMasterMcpConfigPayloadSchema,
  scientificPlottingPrepareReferencePayloadSchema,
  scientificPlottingMcpConfigPayloadSchema,
  scientificPlottingStatusPayloadSchema,
  scientificSkillsInstallPayloadSchema,
  scientificSkillsMcpConfigPayloadSchema,
  gitBranchPayloadSchema,
  gitWorkspacePayloadSchema,
  guiUpdateChannelSchema,
  logErrorPayloadSchema,
  notificationPayloadSchema,
  openEditorPathPayloadSchema,
  researchCardArchivePayloadSchema,
  researchCardCreatePayloadSchema,
  researchCardListPayloadSchema,
  researchCardUpdatePayloadSchema,
  traceExportPayloadSchema,
  traceReadPayloadSchema,
  traceSummariesPayloadSchema,
  visibleContextCapturePreviewPayloadSchema,
  visibleContextPublishPayloadSchema,
  visibleContextTargetRefPayloadSchema,
  rootPathSchema,
  scheduleTaskFromTextPayloadSchema,
  shellOpenExternalUrlSchema,
  speechTranscriptionPayloadSchema,
  skillListPayloadSchema,
  skillSaveFilePayloadSchema,
  settingsPatchSchema,
  streamIdSchema,
  workspaceEntryCopyPayloadSchema,
  workspaceDirectoryCreatePayloadSchema,
  workspaceClipboardImageSavePayloadSchema,
  workspaceClipboardPastePayloadSchema,
  workspaceDirectoryTargetPayloadSchema,
  workspaceEntryDeletePayloadSchema,
  workspaceEntryImportPayloadSchema,
  workspaceEntryMovePayloadSchema,
  workspaceEntryRenamePayloadSchema,
  workspacePdfRenameSuggestionPayloadSchema,
  workspaceFileCreatePayloadSchema,
  workspaceFileRangeReadPayloadSchema,
  workspaceFileTargetPayloadSchema,
  workspaceFileWatchPayloadSchema,
  workspaceFileWritePayloadSchema,
  workspaceTextSearchPayloadSchema,
  writeExportPayloadSchema,
  writeInlineCompletionPayloadSchema,
  writeRetrievalPayloadSchema
} from './app-ipc-schemas'
import {
  emptyVisibleContextSnapshot,
  type VisibleContextSnapshot,
  type VisibleContextTargetRefRequest
} from '../../shared/visible-context'
import {
  buildScientificSkillsMcpConfigFragment,
  type ScientificSkillsMcpLaunchConfig
} from '../scientific-skills-mcp-config'
import {
  buildScientificPlottingMcpConfigFragment,
  type ScientificPlottingMcpLaunchConfig
} from '../scientific-plotting-mcp-config'
import {
  buildBgcDiscoveryMcpConfigFragment,
  type BgcDiscoveryMcpLaunchConfig
} from '../bgc-discovery-mcp-config'
import {
  buildImageGenerationMcpConfigFragment,
  type ImageGenerationMcpLaunchConfig
} from '../image-generation-mcp-config'
import {
  buildPptMasterMcpConfigFragment,
  type PptMasterMcpLaunchConfig
} from '../ppt-master-mcp-config'
import {
  getScientificPlottingStatus,
  prepareScientificPlottingReference
} from '../../../packages/workers/scientific-plotting/src/scientific-plotting-engine'
import {
  buildScientificSkillsIndex,
  buildScientificSkillsStatusSummary
} from '../../../packages/workers/scientific-plotting/src/scientific-skills-index'
import {
  installScientificSkills,
  type ScientificSkillsInstallRequest,
  type ScientificSkillsInstallResult
} from '../../../packages/workers/scientific-plotting/src/scientific-skills-installer'
import {
  extractVisualStyleProfile
} from '../../../packages/workers/scientific-plotting/src/visual-style-extractor'
import type {
  VisualStyleExtractRequest,
  VisualStyleExtractResult,
  VisualStyleSaveProfileRequest,
  VisualStyleSaveProfileResult
} from '../../shared/visual-style'
import type {
  ScientificPlottingPrepareReferenceRequest,
  ScientificPlottingPrepareReferenceResult,
  ScientificPlottingStatusResult
} from '../../shared/scientific-plotting'
import type {
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeId,
  AgentRuntimeThread,
  AgentRuntimeThreadDetail,
  AgentRuntimeThreadListInput,
  AgentRuntimeThreadReadInput,
  AgentRuntimeThreadSidebarProbe,
  AgentRuntimeThreadStartInput,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput,
  AgentRuntimeTurnSteerInput,
  AgentRuntimeTurnTargetInput,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse
} from '../../shared/agent-runtime-contract'
import type {
  SpeechTranscriptionRequest,
  SpeechTranscriptionResult
} from '../../shared/speech-to-text'
import type { ResearchCardService } from '../services/research-card-service'
import type { WorkspacePlacementRouter } from '../services/workspace-placement-router'
import type { MainActionGuardEvaluator } from '../modules/runtime-contributions'
import type {
  AgentRuntimeApprovalResolveInput,
  AgentRuntimeEventSubscribeInput,
  AgentRuntimeSessionResumeHandle,
  AgentRuntimeSessionResumeInput,
  AgentRuntimeThreadCompactInput,
  AgentRuntimeThreadDeleteInput,
  AgentRuntimeThreadForkInput,
  AgentRuntimeThreadRelationInput,
  AgentRuntimeThreadRenameInput,
  AgentRuntimeUserInputResolveInput
} from '../runtime/agent-runtime/adapter'
import type { JsonSettingsStore } from '../settings-store'
import type { RemoteChannelRuntime } from '../remote-channel-runtime'
import type { DiscordBotRuntime } from '../discord-bot-runtime'
import type { ZulipBotRuntime } from '../zulip-bot-runtime'
import type { ScheduleRuntime } from '../schedule-runtime'
import {
  expandHomePath,
  listEditorsResult,
  normalizeSkillFolderName,
  openEditorPath,
  openPathWithShell,
  readClipboardImage,
  writeWorkspaceFile
} from '../services/workspace-service'
import {
  clearWriteInlineCompletionDebugEntries,
  listWriteInlineCompletionDebugEntries,
  requestWriteInlineCompletion
} from '../services/write-inline-completion-service'
import { retrieveWriteContext } from '../services/write-retrieval-service'
import { requestSpeechTranscription } from '../services/speech-to-text-service'
import {
  getComputerUsePermissions,
  requestComputerUsePermission
} from '../services/computer-use-permissions'
import { readComputerUseRuntimeStatus } from '../services/computer-use-status'
import type { ComputerUseRuntimeView } from '../services/computer-use-runtime-client'
import { exportWriteDocument } from '../services/write-export-service'
import { listGuiSkills } from '../services/skill-service'
type GuiUpdaterModule = typeof import('../gui-updater')

type WorkspaceFileWatchRecord = {
  sender: AppBridgeSender
}

type AgentRuntimeEventStreamRecord = {
  controller: AbortController
  sender: AppBridgeSender
  onSenderDestroyed: () => void
}

export type AppBridgeSender = {
  id: number
  isDestroyed: () => boolean
  send: (channel: string, ...args: unknown[]) => void
  once: (event: 'destroyed', listener: () => void) => unknown
  removeListener: (event: 'destroyed', listener: () => void) => unknown
}

function visibleContextWindowId(sender: AppBridgeSender): string {
  const nativeCapture = (sender as { capturePage?: unknown }).capturePage
  return `${typeof nativeCapture === 'function' ? 'electron' : 'browser'}:${sender.id}`
}

type AppBridgeInvokeEvent = {
  sender: AppBridgeSender
}

type AppBridgeInvokeHandler = (
  event: AppBridgeInvokeEvent,
  payload?: unknown
) => Promise<unknown> | unknown

export type AppBridgeDispatcher = {
  invoke: (channel: string, payload: unknown, sender: AppBridgeSender) => Promise<unknown>
}

export type RegisterAppIpcHandlersOptions = {
  store: JsonSettingsStore
  actionGuardEvaluator: MainActionGuardEvaluator
  getMainWindow: () => BrowserWindow | null
  isTrustedIpcSender: (event: IpcMainInvokeEvent) => boolean
  applySettingsPatch: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  getModelAccessStatus: (settings: AppSettingsV1) => Promise<ModelAccessStatus>
  getComputerUseRuntimeStatus?: () => Promise<ComputerUseRuntimeView>
  traces?: {
    read: (query?: TraceReadQuery) => Promise<TraceReadResult>
    summaries: (query?: TraceSummaryQuery) => Promise<TraceSummary[]>
    export: (options: TraceExportOptions) => Promise<TraceExportResult>
    clear: () => Promise<TraceClearResult>
  }
  extensions?: DomainExtensionsApi
  agentRuntime?: {
    connect: (runtimeId?: AgentRuntimeId) => Promise<void>
    capabilities: (runtimeId?: AgentRuntimeId) => Promise<AgentRuntimeCapabilities>
    listThreads: (input?: AgentRuntimeThreadListInput) => Promise<AgentRuntimeThread[]>
    startThread: (input: AgentRuntimeThreadStartInput) => Promise<AgentRuntimeThread>
    readThread: (input: AgentRuntimeThreadReadInput) => Promise<AgentRuntimeThreadDetail>
    readThreadSidebarProbe: (input: AgentRuntimeThreadReadInput) => Promise<AgentRuntimeThreadSidebarProbe>
    startTurn: (input: AgentRuntimeTurnStartInput) => Promise<AgentRuntimeTurnHandle>
    interruptTurn: (input: AgentRuntimeTurnTargetInput) => Promise<void>
    steerTurn: (input: AgentRuntimeTurnSteerInput) => Promise<void>
    renameThread: (input: AgentRuntimeThreadRenameInput) => Promise<void>
    deleteThread: (input: AgentRuntimeThreadDeleteInput) => Promise<void>
    compactThread: (input: AgentRuntimeThreadCompactInput) => Promise<void>
    forkThread: (input: AgentRuntimeThreadForkInput) => Promise<AgentRuntimeThread>
    resumeSession: (input: AgentRuntimeSessionResumeInput) => Promise<AgentRuntimeSessionResumeHandle>
    updateThreadRelation: (input: AgentRuntimeThreadRelationInput) => Promise<void>
    usage: (input: AgentRuntimeUsageQuery) => Promise<AgentRuntimeUsageResponse>
    auxiliary: (input: AgentRuntimeAuxiliaryInput) => Promise<unknown>
    subscribeEvents: (input: AgentRuntimeEventSubscribeInput) => AsyncIterable<unknown>
    resolveApproval: (input: AgentRuntimeApprovalResolveInput) => Promise<void>
    resolveUserInput: (input: AgentRuntimeUserInputResolveInput) => Promise<void>
  }
  remoteWorkspace?: RemoteWorkspaceController
  workspacePlacement?: WorkspacePlacementRouter
  fetchUpstreamModels: () => Promise<UpstreamModelsResult>
  getRemoteChannelRuntime: () => RemoteChannelRuntime | null
  getDiscordBotRuntime?: () => DiscordBotRuntime | null
  getZulipBotRuntime?: () => ZulipBotRuntime | null
  visibleContext?: {
    publish: (snapshot: VisibleContextSnapshot) => Promise<VisibleContextSnapshot>
    get: () => Promise<VisibleContextSnapshot>
    registeredTargetRef: (
      windowId: string,
      input: VisibleContextTargetRefRequest
    ) => Promise<string | null>
    readCapturePreview: (path: string) => Promise<{
      ok: true
      path: string
      dataUrl: string
      mimeType: 'image/png'
      size: number
    } | { ok: false; message: string }>
    prepareSurfaceBinding?: (
      callerId: string,
      activeThreadId: string,
      windowId: string
    ) => Promise<Readonly<{ bindingId: string }> | null>
    discardSurfaceBinding?: (callerId: string, bindingId: string) => Promise<void>
  }
  setRemoteChannelActiveThreadContext?: (payload: {
    threadId: string
    runtimeId?: AgentRuntimeId
    workspaceRoot?: string
  } | null) => void
  getScheduleRuntime: () => ScheduleRuntime | null
  startFeishuInstallQrcode: (isLark: boolean) => Promise<ConnectPhoneInstallQrResult>
  pollFeishuInstall: (deviceCode: string) => Promise<ConnectPhoneInstallPollResult>
  startWeixinInstallQrcode: (weixinBridgeUrl?: string) => Promise<ConnectPhoneInstallQrResult>
  pollWeixinInstall: (deviceCode: string, weixinBridgeUrl?: string) => Promise<ConnectPhoneInstallPollResult>
  researchCards?: ResearchCardService
  showTurnCompleteNotification: (
    payload: TurnCompleteNotificationPayload
  ) => Promise<SystemNotificationResult>
  getAppVersion: () => string
  readGuiUpdateState: () => Promise<GuiUpdateState>
  loadGuiUpdaterModule: () => Promise<GuiUpdaterModule>
  resolveLogDirectory: () => string
  getMainPerformanceSnapshot?: () => unknown
  getScientificSkillsMcpLaunchConfig?: () => ScientificSkillsMcpLaunchConfig
  getScientificPlottingMcpLaunchConfig?: () => ScientificPlottingMcpLaunchConfig
  getBgcDiscoveryMcpLaunchConfig?: () => BgcDiscoveryMcpLaunchConfig
  getImageGenerationMcpLaunchConfig?: () => ImageGenerationMcpLaunchConfig
  getPptMasterMcpLaunchConfig?: () => PptMasterMcpLaunchConfig
  installScientificSkills?: (request: ScientificSkillsInstallRequest) => Promise<ScientificSkillsInstallResult>
  getScientificPlottingStatus?: () => Promise<ScientificPlottingStatusResult>
  prepareScientificPlottingReference?: (
    request: ScientificPlottingPrepareReferenceRequest
  ) => Promise<ScientificPlottingPrepareReferenceResult>
  extractVisualStyleProfile?: (request: VisualStyleExtractRequest) => Promise<VisualStyleExtractResult>
  saveVisualStyleProfile?: (request: VisualStyleSaveProfileRequest) => Promise<VisualStyleSaveProfileResult>
  logError: (category: string, message: string, detail?: unknown) => void
  transcribeSpeech?: (
    settings: AppSettingsV1,
    request: SpeechTranscriptionRequest
  ) => Promise<SpeechTranscriptionResult>
}

function parseIpcPayload<T>(channel: string, schema: z.ZodType<T>, payload: unknown): T {
  const parsed = schema.safeParse(payload)
  if (parsed.success) return parsed.data
  const issue = parsed.error.issues[0]
  throw new Error(`Invalid payload for ${channel}: ${issue?.message ?? 'Bad request.'}`)
}

type WriteExportIpcPayload = z.infer<typeof writeExportPayloadSchema>

function writeExportServicePayload(input: WriteExportIpcPayload) {
  return {
    path: input.path,
    workspaceRoot: input.workspaceRoot,
    format: input.format,
    content: input.content
  }
}

function runDesktopCommand(
  command: DesktopCommand,
  sender: AppBridgeSender,
  getMainWindow: () => BrowserWindow | null
): void {
  const mainWindow = getMainWindow()
  const contents = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : sender as WebContents

  switch (command) {
    case 'undo':
      contents.undo()
      return
    case 'redo':
      contents.redo()
      return
    case 'cut':
      contents.cut()
      return
    case 'copy':
      contents.copy()
      return
    case 'paste':
      contents.paste()
      return
    case 'selectAll':
      contents.selectAll()
      return
    case 'reload':
      contents.reload()
      return
    case 'zoomIn':
      contents.setZoomLevel(contents.getZoomLevel() + 1)
      return
    case 'zoomOut':
      contents.setZoomLevel(contents.getZoomLevel() - 1)
      return
    case 'resetZoom':
      contents.setZoomLevel(0)
      return
    case 'toggleDevTools':
      contents.toggleDevTools()
      return
    case 'minimize':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.minimize()
      return
    case 'toggleMaximize':
      if (!mainWindow || mainWindow.isDestroyed()) return
      if (mainWindow.isMaximized()) {
        mainWindow.unmaximize()
      } else {
        mainWindow.maximize()
      }
      return
    case 'close':
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.close()
      return
    case 'quit':
      app.quit()
      return
  }
}

export function registerAppIpcHandlers(options: RegisterAppIpcHandlersOptions): AppBridgeDispatcher {
  const {
    store,
    actionGuardEvaluator,
    getMainWindow,
    applySettingsPatch,
    getModelAccessStatus,
    getComputerUseRuntimeStatus,
    traces,
    extensions,
    agentRuntime,
    remoteWorkspace,
    workspacePlacement,
    fetchUpstreamModels,
    getRemoteChannelRuntime,
    getDiscordBotRuntime,
    getZulipBotRuntime,
    visibleContext,
    getScheduleRuntime,
    startFeishuInstallQrcode,
    pollFeishuInstall,
    startWeixinInstallQrcode,
    pollWeixinInstall,
    showTurnCompleteNotification,
    getAppVersion,
    readGuiUpdateState,
    loadGuiUpdaterModule,
    resolveLogDirectory,
    getMainPerformanceSnapshot,
    getScientificSkillsMcpLaunchConfig,
    getScientificPlottingMcpLaunchConfig,
    getBgcDiscoveryMcpLaunchConfig,
    getImageGenerationMcpLaunchConfig,
    getPptMasterMcpLaunchConfig,
    installScientificSkills: installScientificSkillsHandler = installScientificSkills,
    getScientificPlottingStatus: getScientificPlottingStatusHandler = getScientificPlottingStatus,
    prepareScientificPlottingReference: prepareScientificPlottingReferenceHandler = prepareScientificPlottingReference,
    extractVisualStyleProfile: extractVisualStyleProfileHandler = extractVisualStyleProfile,
    saveVisualStyleProfile: saveVisualStyleProfileOverride,
    logError,
    transcribeSpeech = requestSpeechTranscription
  } = options
  const workspaceFileWatchers = new Map<string, WorkspaceFileWatchRecord>()
  const agentRuntimeEventStreams = new Map<string, AgentRuntimeEventStreamRecord>()
  const invokeHandlers = new Map<string, AppBridgeInvokeHandler>()
  const requireTraceStore = (): NonNullable<RegisterAppIpcHandlersOptions['traces']> => {
    if (!traces) throw new Error('Full trace storage is not initialized.')
    return traces
  }
  const requireExtensionManager = (): DomainExtensionsApi => {
    if (!extensions) throw new Error('Extension management is not initialized.')
    return extensions
  }
  const requireWorkspacePlacement = (): WorkspacePlacementRouter => {
    if (!workspacePlacement) throw new Error('Workspace placement router is not initialized.')
    return workspacePlacement
  }
  const runExtensionOperation = async <T>(
    operation: string,
    action: () => Promise<T>
  ): Promise<T> => {
    try {
      return await action()
    } catch (error) {
      const rawMessage = error instanceof Error ? error.message : ''
      const printableMessage = Array.from(rawMessage, (character) => {
        const codePoint = character.codePointAt(0) ?? 0
        return codePoint <= 31 || codePoint === 127 ? ' ' : character
      }).join('')
      const message = printableMessage
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 500)
      throw new Error(message || `Extension ${operation} failed.`)
    }
  }

  const handleInvoke = (channel: string, handler: AppBridgeInvokeHandler): void => {
    invokeHandlers.set(channel, handler)
    ipcMain.handle(channel, async (event, payload: unknown) => {
      if (!options.isTrustedIpcSender(event)) {
        throw new Error('Rejected IPC invocation from an untrusted renderer frame.')
      }
      const startedAt = mainPerformanceMonitor.now()
      mainPerformanceMonitor.count('main.ipc.invoke')
      mainPerformanceMonitor.count(`main.ipc.invoke.${channel}`)
      try {
        return await handler({ sender: event.sender }, payload)
      } finally {
        mainPerformanceMonitor.sample('main.ipc.invoke.duration', mainPerformanceMonitor.now() - startedAt, {
          channel
        })
      }
    })
  }

  remoteWorkspace?.subscribe((snapshot) => {
    const window = getMainWindow()
    if (!window || window.isDestroyed()) return
    window.webContents.send('remoteWorkspace:snapshot-changed', snapshot)
  })

  const invoke = async (channel: string, payload: unknown, sender: AppBridgeSender): Promise<unknown> => {
    const startedAt = mainPerformanceMonitor.now()
    mainPerformanceMonitor.count('main.devBridge.invoke')
    mainPerformanceMonitor.count(`main.devBridge.invoke.${channel}`)
    const handler = invokeHandlers.get(channel)
    try {
      if (!handler) throw new Error(`Unknown app bridge channel: ${channel}`)
      return await handler({ sender }, payload)
    } finally {
      mainPerformanceMonitor.sample('main.devBridge.invoke.duration', mainPerformanceMonitor.now() - startedAt, {
        channel
      })
    }
  }

  handleInvoke('traces:read', async (_, payload: unknown) =>
    requireTraceStore().read(parseIpcPayload('traces:read', traceReadPayloadSchema, payload ?? {}))
  )
  handleInvoke('traces:summaries', async (_, payload: unknown) =>
    requireTraceStore().summaries(parseIpcPayload('traces:summaries', traceSummariesPayloadSchema, payload ?? {}))
  )
  handleInvoke('traces:export', async (_, payload: unknown) => {
    const request = parseIpcPayload('traces:export', traceExportPayloadSchema, payload ?? {})
    const date = new Date().toISOString().slice(0, 10)
    const saveOptions = {
      title: 'Export SciForge full traces',
      defaultPath: `sciforge-trace-${date}.jsonl`,
      filters: [{ name: 'SciForge Full Trace', extensions: ['jsonl'] }]
    }
    const mainWindow = getMainWindow()
    const selection = mainWindow
      ? await dialog.showSaveDialog(mainWindow, saveOptions)
      : await dialog.showSaveDialog(saveOptions)
    if (selection.canceled || !selection.filePath) return { canceled: true as const }
    const result = await requireTraceStore().export({
      destination: selection.filePath,
      ...(request.traceIds?.length ? { traceIds: request.traceIds } : {})
    })
    return { canceled: false as const, ...result }
  })
  handleInvoke('traces:clear', async () => requireTraceStore().clear())

  handleInvoke('extensions:list', async (_, payload: unknown) => {
    parseIpcPayload('extensions:list', domainExtensionListPayloadSchema, payload ?? {})
    return runExtensionOperation('listing', async () =>
      parseIpcPayload(
        'extensions:list result',
        domainExtensionListResultSchema,
        await requireExtensionManager().list()
      )
    )
  })

  handleInvoke('extensions:install', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'extensions:install',
      domainExtensionInstallPayloadSchema,
      payload
    )
    return runExtensionOperation('installation', async () =>
      parseIpcPayload(
        'extensions:install result',
        domainExtensionSummarySchema,
        await requireExtensionManager().install(request)
      )
    )
  })

  handleInvoke('extensions:uninstall', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'extensions:uninstall',
      domainExtensionPackagePayloadSchema,
      payload
    )
    await runExtensionOperation('uninstallation', () =>
      requireExtensionManager().uninstall(request)
    )
  })

  handleInvoke('extensions:rollback', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'extensions:rollback',
      domainExtensionPackagePayloadSchema,
      payload
    )
    return runExtensionOperation('rollback', async () =>
      parseIpcPayload(
        'extensions:rollback result',
        domainExtensionSummarySchema,
        await requireExtensionManager().rollback(request)
      )
    )
  })

  handleInvoke('extensions:set-enabled', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'extensions:set-enabled',
      domainExtensionSetEnabledPayloadSchema,
      payload
    )
    return runExtensionOperation('state update', async () =>
      parseIpcPayload(
        'extensions:set-enabled result',
        domainExtensionSummarySchema,
        await requireExtensionManager().setEnabled(request)
      )
    )
  })

  const saveVisualStyleProfileHandler = saveVisualStyleProfileOverride ?? (async (
    request: VisualStyleSaveProfileRequest
  ): Promise<VisualStyleSaveProfileResult> => {
    const path = request.path?.trim() || `.sciforge/visual-styles/${request.profile.id}.json`
    return writeWorkspaceFile({
      workspaceRoot: request.workspaceRoot,
      path,
      content: `${JSON.stringify({
        profile: request.profile,
        diagnostics: request.diagnostics
      }, null, 2)}\n`
    })
  })

  const disposeWorkspaceFileWatch = async (watchId: string): Promise<boolean> => {
    const record = workspaceFileWatchers.get(watchId)
    if (!record) return false
    try {
      await requireWorkspacePlacement().unwatchFile(watchId)
    } catch (error) {
      logError('workspace-watch', 'Failed to close workspace file watcher', {
        watchId,
        message: error instanceof Error ? error.message : String(error)
      })
    }
    workspaceFileWatchers.delete(watchId)
    return true
  }

  const cleanupAgentRuntimeEventStreamRecord = (streamId: string, record: AgentRuntimeEventStreamRecord): void => {
    if (agentRuntimeEventStreams.get(streamId) !== record) return
    record.sender.removeListener('destroyed', record.onSenderDestroyed)
    agentRuntimeEventStreams.delete(streamId)
  }

  const disposeAgentRuntimeEventStream = (streamId: string, sender?: AppBridgeSender): boolean => {
    const record = agentRuntimeEventStreams.get(streamId)
    if (!record) return false
    if (sender && record.sender.id !== sender.id) return false
    record.controller.abort()
    cleanupAgentRuntimeEventStreamRecord(streamId, record)
    return true
  }

  const disposeAgentRuntimeEventStreamsForSender = (sender: AppBridgeSender): void => {
    for (const [streamId, record] of agentRuntimeEventStreams) {
      if (record.sender.id === sender.id) {
        disposeAgentRuntimeEventStream(streamId, sender)
      }
    }
  }

  const disposeWorkspaceFileWatchesForSender = (sender: AppBridgeSender): void => {
    for (const [watchId, record] of workspaceFileWatchers) {
      if (record.sender.id === sender.id) {
        void disposeWorkspaceFileWatch(watchId)
      }
    }
  }

  handleInvoke('settings:get', async () => store.load())
  handleInvoke('modelAccess:status', async () => getModelAccessStatus(await store.load()))
  handleInvoke('settings:set', async (_, partial: unknown) =>
    applySettingsPatch(
      parseIpcPayload('settings:set', settingsPatchSchema, partial) as AppSettingsPatch
    )
  )
  handleInvoke('computer-use:permissions', async () => getComputerUsePermissions())
  handleInvoke('computer-use:request-permission', async (_, kind: unknown) =>
    requestComputerUsePermission(
      parseIpcPayload(
        'computer-use:request-permission',
        computerUsePermissionKindSchema,
        kind
      )
    )
  )
  handleInvoke('computer-use:status', async () => {
    const settings = await store.load()
    const runtime = getComputerUseRuntimeStatus
      ? await getComputerUseRuntimeStatus()
      : await readComputerUseRuntimeStatus(
        join(app.getPath('userData'), 'computer-use', 'status.json')
      )
    return {
      settings: settings.computerUse,
      permissions: await getComputerUsePermissions(),
      runtime
    }
  })
  handleInvoke('performance:snapshot', async () => {
    const mainSnapshot = getMainPerformanceSnapshot?.() ?? null
    const win = getMainWindow()
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) {
      return { ok: false, message: 'Main window is not available.', mainSnapshot }
    }
    const snapshot = await win.webContents.executeJavaScript(
      'window.__SCIFORGE_PERF__?.snapshot?.() ?? null',
      true
    ) as unknown
    return snapshot
      ? { ok: true, snapshot, mainSnapshot }
      : { ok: false, message: 'Renderer performance monitor is not available.', mainSnapshot }
  })

  const requireResearchCardService = (): ResearchCardService => {
    if (!options.researchCards) {
      throw new Error('Research card service is not initialized.')
    }
    return options.researchCards
  }

  handleInvoke('researchCards:list', async (_, payload: unknown) =>
    requireResearchCardService().list(
      parseIpcPayload('researchCards:list', researchCardListPayloadSchema, payload ?? {})
    )
  )
  handleInvoke('researchCards:create', async (_, payload: unknown) =>
    requireResearchCardService().create(
      parseIpcPayload('researchCards:create', researchCardCreatePayloadSchema, payload)
    )
  )
  handleInvoke('researchCards:update', async (_, payload: unknown) =>
    requireResearchCardService().update(
      parseIpcPayload('researchCards:update', researchCardUpdatePayloadSchema, payload)
    )
  )
  handleInvoke('researchCards:archive', async (_, payload: unknown) =>
    requireResearchCardService().archive(
      parseIpcPayload('researchCards:archive', researchCardArchivePayloadSchema, payload)
    )
  )

  handleInvoke('visibleContext:publish', async (event, payload: unknown) => {
    const snapshot = parseIpcPayload('visibleContext:publish', visibleContextPublishPayloadSchema, payload)
    const boundSnapshot = { ...snapshot, windowId: visibleContextWindowId(event.sender) }
    if (!visibleContext) return boundSnapshot
    return visibleContext.publish(boundSnapshot)
  })
  handleInvoke('visibleContext:get', async () => {
    if (!visibleContext) return emptyVisibleContextSnapshot()
    return visibleContext.get()
  })
  handleInvoke('visibleContext:target-ref', async (event, payload: unknown) => {
    const request = parseIpcPayload(
      'visibleContext:target-ref',
      visibleContextTargetRefPayloadSchema,
      payload
    )
    if (!visibleContext) return { ok: false as const }
    const targetRef = await visibleContext.registeredTargetRef(
      visibleContextWindowId(event.sender),
      request
    )
    return targetRef
      ? { ok: true as const, targetRef }
      : { ok: false as const }
  })
  handleInvoke('visibleContext:capture:preview', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'visibleContext:capture:preview',
      visibleContextCapturePreviewPayloadSchema,
      payload
    )
    if (!visibleContext) return { ok: false, message: 'Visible capture previews are unavailable.' }
    return visibleContext.readCapturePreview(request.path)
  })

  const requireAgentRuntime = (): NonNullable<RegisterAppIpcHandlersOptions['agentRuntime']> => {
    if (!agentRuntime) {
      throw new Error('AgentRuntimeHost is not initialized.')
    }
    return agentRuntime
  }

  const requireRemoteWorkspace =
    (): NonNullable<RegisterAppIpcHandlersOptions['remoteWorkspace']> => {
      if (!remoteWorkspace) throw new Error('Remote Workspace is not initialized.')
      return remoteWorkspace
    }

  handleInvoke('remoteWorkspace:list', async () => requireRemoteWorkspace().list())
  handleInvoke('remoteWorkspace:get', async () => requireRemoteWorkspace().get())
  handleInvoke('remoteWorkspace:attach', async (_, payload: unknown) =>
    requireRemoteWorkspace().attach(parseIpcPayload(
      'remoteWorkspace:attach',
      remoteWorkspaceAttachPayloadSchema,
      payload
    ))
  )
  handleInvoke('remoteWorkspace:select', async (_, payload: unknown) =>
    requireRemoteWorkspace().select(parseIpcPayload(
      'remoteWorkspace:select',
      remoteWorkspaceSelectPayloadSchema,
      payload
    ))
  )
  handleInvoke('remoteWorkspace:reconnect', async (_, payload: unknown) =>
    requireRemoteWorkspace().reconnect(parseIpcPayload(
      'remoteWorkspace:reconnect',
      remoteWorkspaceSessionPayloadSchema,
      payload
    ))
  )
  handleInvoke('remoteWorkspace:close', async (_, payload: unknown) =>
    requireRemoteWorkspace().close(parseIpcPayload(
      'remoteWorkspace:close',
      remoteWorkspaceSessionPayloadSchema,
      payload
    ))
  )

  const requireDiscordBotRuntime = (): DiscordBotRuntime => {
    const runtime = getDiscordBotRuntime?.()
    if (!runtime) {
      throw new Error('Discord bot runtime is not initialized.')
    }
    return runtime
  }

  const requireZulipBotRuntime = (): ZulipBotRuntime => {
    const runtime = getZulipBotRuntime?.()
    if (!runtime) {
      throw new Error('Zulip bot runtime is not initialized.')
    }
    return runtime
  }

  handleInvoke('agentRuntime:connect', async (_, payload: unknown) => {
    const request = parseIpcPayload('agentRuntime:connect', agentRuntimeConnectPayloadSchema, payload ?? {})
    return requireAgentRuntime().connect(request.runtimeId)
  })
  handleInvoke('agentRuntime:capabilities', async (_, payload: unknown) => {
    const request = parseIpcPayload('agentRuntime:capabilities', agentRuntimeConnectPayloadSchema, payload ?? {})
    return requireAgentRuntime().capabilities(request.runtimeId)
  })
  handleInvoke('agentRuntime:listThreads', async (_, payload: unknown) =>
    requireAgentRuntime().listThreads(
      parseIpcPayload('agentRuntime:listThreads', agentRuntimeListThreadsPayloadSchema, payload ?? {})
    )
  )
  handleInvoke('agentRuntime:startThread', async (_, payload: unknown) =>
    requireAgentRuntime().startThread(
      parseIpcPayload('agentRuntime:startThread', agentRuntimeStartThreadPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:readThread', async (_, payload: unknown) =>
    requireAgentRuntime().readThread(
      parseIpcPayload('agentRuntime:readThread', agentRuntimeReadThreadPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:readThreadSidebarProbe', async (_, payload: unknown) =>
    requireAgentRuntime().readThreadSidebarProbe(
      parseIpcPayload(
        'agentRuntime:readThreadSidebarProbe',
        agentRuntimeReadThreadSidebarProbePayloadSchema,
        payload
      )
    )
  )
  handleInvoke('agentRuntime:startTurn', async (event, payload: unknown) => {
    const runtime = requireAgentRuntime()
    const request = parseIpcPayload(
      'agentRuntime:startTurn',
      agentRuntimeStartTurnPayloadSchema,
      payload
    )
    const visibleContextSurfaceId = visibleContextWindowId(event.sender)
    const callerId = capabilityAgentCallerId({
      runtimeId: request.runtimeId,
      threadId: request.threadId,
      requestId: request.threadId
    })
    const prepared = await visibleContext?.prepareSurfaceBinding?.(
      callerId,
      request.visibleContextOwnerThreadId ?? request.threadId,
      visibleContextSurfaceId
    ).catch(() => null)
    try {
      return await runtime.startTurn({
        ...request,
        visibleContextSurfaceId,
        visibleContextBindingAttempted: true,
        ...(prepared ? { visibleContextBindingId: prepared.bindingId } : {})
      })
    } catch (error) {
      if (prepared) {
        await Promise.resolve(
          visibleContext?.discardSurfaceBinding?.(callerId, prepared.bindingId)
        ).catch(() => undefined)
      }
      throw error
    }
  })
  handleInvoke('agentRuntime:interruptTurn', async (_, payload: unknown) =>
    requireAgentRuntime().interruptTurn(
      parseIpcPayload('agentRuntime:interruptTurn', agentRuntimeTurnTargetPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:steerTurn', async (event, payload: unknown) => {
    const request = parseIpcPayload(
      'agentRuntime:steerTurn',
      agentRuntimeTurnSteerPayloadSchema,
      payload
    )
    return requireAgentRuntime().steerTurn({
      ...request,
      visibleContextSurfaceId: visibleContextWindowId(event.sender)
    })
  })
  handleInvoke('agentRuntime:renameThread', async (_, payload: unknown) =>
    requireAgentRuntime().renameThread(
      parseIpcPayload('agentRuntime:renameThread', agentRuntimeThreadRenamePayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:deleteThread', async (_, payload: unknown) =>
    requireAgentRuntime().deleteThread(
      parseIpcPayload('agentRuntime:deleteThread', agentRuntimeThreadDeletePayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:compactThread', async (_, payload: unknown) =>
    requireAgentRuntime().compactThread(
      parseIpcPayload('agentRuntime:compactThread', agentRuntimeThreadCompactPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:forkThread', async (_, payload: unknown) =>
    requireAgentRuntime().forkThread(
      parseIpcPayload('agentRuntime:forkThread', agentRuntimeThreadForkPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:resumeSession', async (_, payload: unknown) =>
    requireAgentRuntime().resumeSession(
      parseIpcPayload('agentRuntime:resumeSession', agentRuntimeSessionResumePayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:updateThreadRelation', async (_, payload: unknown) =>
    requireAgentRuntime().updateThreadRelation(
      parseIpcPayload('agentRuntime:updateThreadRelation', agentRuntimeThreadRelationPayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:usage', async (_, payload: unknown) =>
    requireAgentRuntime().usage(
      parseIpcPayload('agentRuntime:usage', agentRuntimeUsagePayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:auxiliary', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'agentRuntime:auxiliary',
      agentRuntimeAuxiliaryPayloadSchema,
      payload
    )
    mainPerformanceMonitor.count(`main.agentRuntime.auxiliary.${request.operation}`)
    return requireAgentRuntime().auxiliary(request)
  })
  handleInvoke('agentRuntime:stopEvents', async (event, payload: unknown) =>
    disposeAgentRuntimeEventStream(streamIdSchema.parse(payload), event.sender)
  )
  handleInvoke('agentRuntime:subscribeEvents', async (event, payload: unknown) => {
    const request = parseIpcPayload('agentRuntime:subscribeEvents', agentRuntimeEventSubscribePayloadSchema, payload)
    const requestedId = request.streamId?.trim() ?? ''
    const streamId = requestedId || randomUUID()
    const sender = event.sender
    const active = agentRuntimeEventStreams.get(streamId)
    if (active && active.sender.id !== sender.id) {
      throw new Error(`Agent runtime event stream "${streamId}" is already active for another sender.`)
    }
    disposeAgentRuntimeEventStream(streamId, sender)

    const controller = new AbortController()
    const onSenderDestroyed = () => disposeAgentRuntimeEventStreamsForSender(sender)
    const record = { controller, sender, onSenderDestroyed }
    agentRuntimeEventStreams.set(streamId, record)
    sender.once('destroyed', onSenderDestroyed)

    void (async () => {
      try {
        for await (const runtimeEvent of requireAgentRuntime().subscribeEvents({
          ...request,
          streamId,
          signal: controller.signal
        })) {
          if (controller.signal.aborted || sender.isDestroyed()) return
          sender.send('agentRuntime:event', { streamId, event: runtimeEvent })
        }
        if (!controller.signal.aborted && !sender.isDestroyed()) {
          sender.send('agentRuntime:end', { streamId })
        }
      } catch (error) {
        if (!controller.signal.aborted && !sender.isDestroyed()) {
          sender.send('agentRuntime:error', {
            streamId,
            message: error instanceof Error ? error.message : String(error)
          })
        }
      } finally {
        cleanupAgentRuntimeEventStreamRecord(streamId, record)
      }
    })()

    await Promise.resolve()
    return { streamId }
  })
  handleInvoke('agentRuntime:resolveApproval', async (_, payload: unknown) =>
    requireAgentRuntime().resolveApproval(
      parseIpcPayload('agentRuntime:resolveApproval', agentRuntimeApprovalResolvePayloadSchema, payload)
    )
  )
  handleInvoke('agentRuntime:resolveUserInput', async (_, payload: unknown) =>
    requireAgentRuntime().resolveUserInput(
      parseIpcPayload('agentRuntime:resolveUserInput', agentRuntimeUserInputResolvePayloadSchema, payload)
    )
  )

  handleInvoke('upstream:models', async () => fetchUpstreamModels())

  handleInvoke('connectPhone:status', async (): Promise<ConnectPhoneRuntimeStatus> =>
    getRemoteChannelRuntime()?.status() ?? {
      imServerRunning: false,
      imUrl: '',
      runningTaskIds: []
    }
  )

  handleInvoke('schedule:status', async (): Promise<ScheduleRuntimeStatus> =>
    getScheduleRuntime()?.status() ?? {
      internalServerRunning: false,
      internalUrl: '',
      runningTaskIds: [],
      powerSaveBlockerActive: false
    }
  )

  handleInvoke('schedule:task:run', async (_, taskId: unknown): Promise<ScheduleRunResult> => {
    const normalizedTaskId = parseIpcPayload('schedule:task:run', streamIdSchema, taskId)
    const scheduleRuntime = getScheduleRuntime()
    if (!scheduleRuntime) return { ok: false, message: 'Schedule runtime is not initialized.' }
    return scheduleRuntime.runTask(normalizedTaskId)
  })

  handleInvoke(
    'remoteChannel:active-thread-context',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'remoteChannel:active-thread-context',
        remoteChannelActiveThreadContextPayloadSchema,
        payload
      )
      options.setRemoteChannelActiveThreadContext?.(request)
    }
  )

  handleInvoke(
    'remoteChannel:message:mirror',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('remoteChannel:message:mirror', remoteChannelMirrorPayloadSchema, payload)
      const remoteChannelRuntime = getRemoteChannelRuntime()
      if (!remoteChannelRuntime) return { ok: false as const, message: 'Remote channel runtime is not initialized.' }
      return remoteChannelRuntime.mirrorThreadMessageToIm(
        request.threadId,
        request.text,
        request.direction
      )
    }
  )

  handleInvoke(
    'remoteChannel:task:create-from-text',
    async (_, payload: unknown): Promise<ScheduleTaskFromTextResult> => {
      const request = parseIpcPayload(
        'remoteChannel:task:create-from-text',
        remoteChannelTaskFromTextPayloadSchema,
        payload
      )
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { kind: 'error', message: 'Schedule runtime is not initialized.' }
      const settings = await store.load()
      const channel = request.channelId
        ? settings.remoteChannel.channels.find((item) => item.id === request.channelId)
        : undefined
      return scheduleRuntime.createScheduledTaskFromText(request.text, {
        workspaceRoot: channel?.workspaceRoot || settings.schedule.defaultWorkspaceRoot || settings.workspaceRoot,
        modelHint: request.modelHint,
        mode: request.mode
      })
    }
  )

  handleInvoke(
    'schedule:task:create-from-text',
    async (_, payload: unknown): Promise<ScheduleTaskFromTextResult> => {
      const request = parseIpcPayload(
        'schedule:task:create-from-text',
        scheduleTaskFromTextPayloadSchema,
        payload
      )
      const scheduleRuntime = getScheduleRuntime()
      if (!scheduleRuntime) return { kind: 'error', message: 'Schedule runtime is not initialized.' }
      return scheduleRuntime.createScheduledTaskFromText(request.text, {
        workspaceRoot: request.workspaceRoot,
        modelHint: request.modelHint,
        mode: request.mode
      })
    }
  )

  handleInvoke(
    'connectPhone:install:qrcode',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'connectPhone:install:qrcode',
        connectPhoneInstallQrPayloadSchema,
        payload
      )
      if (request.provider === 'weixin') {
        const settings = await store.load()
        return startWeixinInstallQrcode(settings.connectPhone.weixinBridgeUrl)
      }
      return startFeishuInstallQrcode(request.isLark === true)
    }
  )

  handleInvoke(
    'connectPhone:install:poll',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'connectPhone:install:poll',
        connectPhoneInstallPollPayloadSchema,
        payload
      )
      if (request.provider === 'weixin') {
        const settings = await store.load()
        return pollWeixinInstall(request.deviceCode, settings.connectPhone.weixinBridgeUrl)
      }
      return pollFeishuInstall(request.deviceCode)
    }
  )

  handleInvoke('discord:status', async () =>
    requireDiscordBotRuntime().status()
  )

  handleInvoke('discord:configure-client', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:configure-client',
      discordConfigureClientPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().configureClientId(request.clientId)
  })

  handleInvoke('discord:configure-token', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:configure-token',
      discordConfigureTokenPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().configureToken(request.token, request.clientId)
  })

  handleInvoke('discord:configure-proxy', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:configure-proxy',
      discordConfigureProxyPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().configureProxy(request.proxyUrl)
  })

  handleInvoke('discord:guilds', async () =>
    requireDiscordBotRuntime().listGuilds()
  )

  handleInvoke('discord:channels', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:channels',
      discordGuildChannelsPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().listChannels(request.guildId)
  })

  handleInvoke('discord:bind-channel', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:bind-channel',
      discordBindChannelPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().bindChannel(request)
  })

  handleInvoke('discord:test-send', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:test-send',
      discordTestSendPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().testSend(request.channelId, request.text, request.channelConfigId)
  })

  handleInvoke('discord:set-guard', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'discord:set-guard',
      discordSetGuardPayloadSchema,
      payload
    )
    return requireDiscordBotRuntime().setGuard(request.enabled, {
      channelConfigId: request.channelConfigId,
      forceTakeover: request.forceTakeover
    })
  })

  handleInvoke('zulip:status', async () =>
    requireZulipBotRuntime().status()
  )

  handleInvoke('zulip:configure', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'zulip:configure',
      zulipConfigurePayloadSchema,
      payload
    )
    return requireZulipBotRuntime().configure(request)
  })

  handleInvoke('zulip:streams', async () =>
    requireZulipBotRuntime().listStreams()
  )

  handleInvoke('zulip:topics', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'zulip:topics',
      zulipStreamTopicsPayloadSchema,
      payload
    )
    return requireZulipBotRuntime().listTopics(request.streamId)
  })

  handleInvoke('zulip:bind-channel', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'zulip:bind-channel',
      zulipBindChannelPayloadSchema,
      payload
    )
    return requireZulipBotRuntime().bindChannel(request)
  })

  handleInvoke('zulip:test-send', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'zulip:test-send',
      zulipTestSendPayloadSchema,
      payload
    )
    return requireZulipBotRuntime().testSend(request.channelId, request.text, {
      channelConfigId: request.channelConfigId,
      topicName: request.topicName
    })
  })

  handleInvoke('zulip:set-guard', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'zulip:set-guard',
      zulipSetGuardPayloadSchema,
      payload
    )
    return requireZulipBotRuntime().setGuard(request.enabled, {
      channelConfigId: request.channelConfigId,
      forceTakeover: request.forceTakeover
    })
  })

  handleInvoke('workspace:pick-directory', async (_, defaultPath: unknown): Promise<WorkspacePickResult> => {
    const normalizedDefaultPath = parseIpcPayload(
      'workspace:pick-directory',
      z.object({ defaultPath: defaultPathSchema }).strict(),
      { defaultPath }
    ).defaultPath
    const options: Electron.OpenDialogOptions = {
      title: 'Select working directory',
      defaultPath: normalizedDefaultPath,
      properties: ['openDirectory', 'createDirectory', 'dontAddToRecent']
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return {
      canceled: result.canceled,
      path: result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })

  handleInvoke('workspace:pick-file', async (_, payload: unknown): Promise<WorkspacePickResult> => {
    const request = parseIpcPayload(
      'workspace:pick-file',
      z.object({
        title: z.string().trim().min(1).max(160),
        defaultPath: defaultPathSchema,
        filters: z.array(z.object({
          name: z.string().trim().min(1).max(80),
          extensions: z.array(
            z.string().trim().regex(/^(?:\*|[a-z0-9][a-z0-9.+_-]{0,31})$/i)
          ).min(1).max(64)
        }).strict()).min(1).max(16)
      }).strict(),
      payload
    )
    const options: Electron.OpenDialogOptions = {
      title: request.title,
      defaultPath: request.defaultPath,
      properties: ['openFile', 'dontAddToRecent'],
      filters: request.filters
    }
    const mainWindow = getMainWindow()
    const result = mainWindow
      ? await dialog.showOpenDialog(mainWindow, options)
      : await dialog.showOpenDialog(options)
    return {
      canceled: result.canceled,
      path: result.canceled ? null : (result.filePaths[0] ?? null)
    }
  })
  handleInvoke(
    'skill:save-file',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('skill:save-file', skillSaveFilePayloadSchema, payload)
      try {
        const rootPath = expandHomePath(request.rootPath)
        if (!rootPath) {
          return { ok: false as const, message: 'Skill directory is required.' }
        }
        const skillName = normalizeSkillFolderName(request.skillName)
        const skillDir = join(rootPath, skillName)
        const filePath = join(skillDir, 'SKILL.md')
        await mkdir(skillDir, { recursive: true })
        await writeFile(filePath, request.content, 'utf8')
        return { ok: true as const, path: filePath }
      } catch (error) {
        return {
          ok: false as const,
          message: error instanceof Error ? error.message : String(error)
        }
      }
    }
  )

  handleInvoke('skill:list', async (_, payload: unknown) => {
    const request = parseIpcPayload('skill:list', skillListPayloadSchema, payload)
    const settings = await store.load()
    return listGuiSkills(settings, request.workspaceRoot)
  })

  handleInvoke('mcp:scientific-skills-config', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'mcp:scientific-skills-config',
      scientificSkillsMcpConfigPayloadSchema,
      payload
    )
    try {
      const launch = getScientificSkillsMcpLaunchConfig?.() ?? {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
      return {
        ok: true as const,
        config: buildScientificSkillsMcpConfigFragment(launch, request.workspaceRoot)
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('mcp:scientific-skills-status', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'mcp:scientific-skills-status',
      scientificSkillsMcpConfigPayloadSchema,
      payload
    )
    try {
      const summary = buildScientificSkillsStatusSummary(
        await buildScientificSkillsIndex({ workspaceRoot: request.workspaceRoot })
      )
      return {
        ok: true as const,
        ...summary
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('mcp:scientific-plotting-config', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'mcp:scientific-plotting-config',
      scientificPlottingMcpConfigPayloadSchema,
      payload
    )
    try {
      const launch = getScientificPlottingMcpLaunchConfig?.() ?? {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
      return {
        ok: true as const,
        config: buildScientificPlottingMcpConfigFragment(launch, request.workspaceRoot)
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('mcp:bgc-discovery-config', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'mcp:bgc-discovery-config',
      scientificPlottingMcpConfigPayloadSchema,
      payload
    )
    try {
      const launch = getBgcDiscoveryMcpLaunchConfig?.() ?? {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
      return {
        ok: true as const,
        config: buildBgcDiscoveryMcpConfigFragment(launch, request.workspaceRoot)
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('mcp:image-generation-config', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'mcp:image-generation-config',
      scientificPlottingMcpConfigPayloadSchema,
      payload
    )
    try {
      const launch = getImageGenerationMcpLaunchConfig?.() ?? {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
      const settings = await store.load()
      return {
        ok: true as const,
        config: buildImageGenerationMcpConfigFragment(
          launch,
          request.workspaceRoot,
          settings
        )
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('scientific-plotting:status', async (_, payload: unknown) => {
    parseIpcPayload(
      'scientific-plotting:status',
      scientificPlottingStatusPayloadSchema,
      payload
    )
    try {
      return getScientificPlottingStatusHandler()
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('scientific-plotting:prepare-reference', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'scientific-plotting:prepare-reference',
      scientificPlottingPrepareReferencePayloadSchema,
      payload
    )
    try {
      return prepareScientificPlottingReferenceHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        status: 'invalid_request' as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('scientific-skills:install', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'scientific-skills:install',
      scientificSkillsInstallPayloadSchema,
      payload
    )
    try {
      return installScientificSkillsHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        status: 'unexpected_error' as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('visual-style:extract-profile', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'visual-style:extract-profile',
      visualStyleExtractPayloadSchema,
      payload
    )
    try {
      return extractVisualStyleProfileHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('visual-style:save-profile', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'visual-style:save-profile',
      visualStyleSaveProfilePayloadSchema,
      payload
    )
    try {
      return saveVisualStyleProfileHandler(request)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('mcp:ppt-master-config', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'mcp:ppt-master-config',
      pptMasterMcpConfigPayloadSchema,
      payload
    )
    try {
      const launch = getPptMasterMcpLaunchConfig?.() ?? {
        appPath: app.getAppPath(),
        execPath: process.execPath,
        isPackaged: app.isPackaged
      }
      return {
        ok: true as const,
        config: buildPptMasterMcpConfigFragment(launch, request.workspaceRoot)
      }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('skill:open-root', async (_, rootPath: unknown) => {
    const normalizedRootPath = parseIpcPayload('skill:open-root', rootPathSchema, rootPath)
    try {
      const target = expandHomePath(normalizedRootPath)
      if (!target) {
        return { ok: false as const, message: 'Skill directory is required.' }
      }
      await mkdir(target, { recursive: true })
      return openPathWithShell(target)
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })

  handleInvoke('git:branches', async (_, payload: unknown) => {
    const request = parseIpcPayload(
      'git:branches',
      gitWorkspacePayloadSchema,
      typeof payload === 'string' ? { workspaceRoot: payload } : payload
    )
    return requireWorkspacePlacement().getGitBranches(
      request.workspaceRoot,
      request.workspaceLocator
    )
  })
  handleInvoke(
    'git:switch-branch',
    async (_, payload: unknown) => {
      const request = parseIpcPayload('git:switch-branch', gitBranchPayloadSchema, payload)
      return requireWorkspacePlacement().switchGitBranch(
        request.workspaceRoot,
        request.branch,
        request.workspaceLocator
      )
    }
  )
  handleInvoke(
    'git:create-and-switch-branch',
    async (_, payload: unknown) => {
      const request = parseIpcPayload(
        'git:create-and-switch-branch',
        gitBranchPayloadSchema,
        payload
      )
      return requireWorkspacePlacement().createAndSwitchGitBranch(
        request.workspaceRoot,
        request.branch,
        request.workspaceLocator
      )
    }
  )

  handleInvoke('editor:list', async () => listEditorsResult())
  handleInvoke('editor:open-path', async (_, payload: unknown) =>
    openEditorPath(parseIpcPayload('editor:open-path', openEditorPathPayloadSchema, payload))
  )

  handleInvoke('file:resolve-workspace', async (_, payload: unknown) =>
    requireWorkspacePlacement().resolveFile(
      parseIpcPayload('file:resolve-workspace', workspaceFileTargetPayloadSchema, payload)
    )
  )
  handleInvoke('file:list-workspace-directory', async (_, payload: unknown) =>
    requireWorkspacePlacement().listDirectory(
      parseIpcPayload('file:list-workspace-directory', workspaceDirectoryTargetPayloadSchema, payload)
    )
  )
  handleInvoke('file:read-workspace', async (_, payload: unknown) =>
    requireWorkspacePlacement().readFile(
      parseIpcPayload('file:read-workspace', workspaceFileTargetPayloadSchema, payload)
    )
  )
  handleInvoke('file:read-workspace-image', async (_, payload: unknown) =>
    requireWorkspacePlacement().readImage(
      parseIpcPayload('file:read-workspace-image', workspaceFileTargetPayloadSchema, payload)
    )
  )
  handleInvoke('file:write-workspace', async (_, payload: unknown) =>
    requireWorkspacePlacement().writeFile(
      parseIpcPayload('file:write-workspace', workspaceFileWritePayloadSchema, payload)
    )
  )
  handleInvoke('file:read-workspace-range', async (_, payload: unknown) =>
    requireWorkspacePlacement().readRange(
      parseIpcPayload('file:read-workspace-range', workspaceFileRangeReadPayloadSchema, payload)
    )
  )
  handleInvoke('file:search-workspace-text', async (_, payload: unknown) =>
    requireWorkspacePlacement().searchText(
      parseIpcPayload('file:search-workspace-text', workspaceTextSearchPayloadSchema, payload)
    )
  )
  handleInvoke('file:create-workspace', async (_, payload: unknown) =>
    requireWorkspacePlacement().createFile(
      parseIpcPayload('file:create-workspace', workspaceFileCreatePayloadSchema, payload)
    )
  )
  handleInvoke('file:create-workspace-directory', async (_, payload: unknown) =>
    requireWorkspacePlacement().createDirectory(
      parseIpcPayload('file:create-workspace-directory', workspaceDirectoryCreatePayloadSchema, payload)
    )
  )
  handleInvoke('file:save-workspace-clipboard-image', async (_, payload: unknown) =>
    requireWorkspacePlacement().saveClipboardImage(
      parseIpcPayload(
        'file:save-workspace-clipboard-image',
        workspaceClipboardImageSavePayloadSchema,
        payload
      )
    )
  )
  handleInvoke('clipboard:read-image', async () => readClipboardImage())
  handleInvoke('clipboard:paste-workspace', async (_, payload: unknown) =>
    requireWorkspacePlacement().pasteClipboard(
      parseIpcPayload('clipboard:paste-workspace', workspaceClipboardPastePayloadSchema, payload)
    )
  )
  handleInvoke('file:rename-workspace-entry', async (_, payload: unknown) =>
    requireWorkspacePlacement().renameEntry(
      parseIpcPayload('file:rename-workspace-entry', workspaceEntryRenamePayloadSchema, payload)
    )
  )
  handleInvoke('file:suggest-workspace-pdf-name', async (_, payload: unknown) =>
    requireWorkspacePlacement().suggestPdfName(
      parseIpcPayload(
        'file:suggest-workspace-pdf-name',
        workspacePdfRenameSuggestionPayloadSchema,
        payload
      )
    )
  )
  handleInvoke('file:copy-workspace-entry', async (_, payload: unknown) =>
    requireWorkspacePlacement().copyEntry(
      parseIpcPayload('file:copy-workspace-entry', workspaceEntryCopyPayloadSchema, payload)
    )
  )
  handleInvoke('file:import-workspace-entries', async (_, payload: unknown) =>
    requireWorkspacePlacement().importEntries(
      parseIpcPayload('file:import-workspace-entries', workspaceEntryImportPayloadSchema, payload)
    )
  )
  handleInvoke('file:move-workspace-entry', async (_, payload: unknown) =>
    requireWorkspacePlacement().moveEntry(
      parseIpcPayload('file:move-workspace-entry', workspaceEntryMovePayloadSchema, payload)
    )
  )
  handleInvoke('file:delete-workspace-entry', async (_, payload: unknown) =>
    requireWorkspacePlacement().deleteEntry(
      parseIpcPayload('file:delete-workspace-entry', workspaceEntryDeletePayloadSchema, payload)
    )
  )
  const startWorkspaceFileWatch = async (
    event: AppBridgeInvokeEvent,
    payload: unknown
  ): Promise<WorkspaceFileWatchResult> => {
    const request = parseIpcPayload('file:watch-workspace', workspaceFileWatchPayloadSchema, payload)
    const result = await requireWorkspacePlacement().watchFile(request, (change) => {
      if (!event.sender.isDestroyed()) event.sender.send('file:workspace-changed', change)
    })
    if (!result.ok) return result
    workspaceFileWatchers.set(result.watchId, { sender: event.sender })
    event.sender.once('destroyed', () => disposeWorkspaceFileWatchesForSender(event.sender))
    return result
  }
  handleInvoke('file:watch-workspace', async (event, payload: unknown) =>
    startWorkspaceFileWatch(event, payload)
  )
  handleInvoke('file:unwatch-workspace', async (_, watchId: unknown) =>
    await disposeWorkspaceFileWatch(
      parseIpcPayload('file:unwatch-workspace', streamIdSchema, watchId)
    )
  )
  handleInvoke('write:export', async (_, payload: unknown) => {
    const input = parseIpcPayload('write:export', writeExportPayloadSchema, payload)
    const guard = await actionGuardEvaluator.evaluate({
      actionId: 'write.export',
      payload: input
    })
    if (!guard.allowed) {
      throw new Error(
        guard.message ?? 'Action write.export was rejected by an installed domain guard.'
      )
    }
    return exportWriteDocument(writeExportServicePayload(input), { parentWindow: getMainWindow() })
  })
  handleInvoke('write:inline-completion', async (_, payload: unknown) =>
    requestWriteInlineCompletion(
      await store.load(),
      parseIpcPayload('write:inline-completion', writeInlineCompletionPayloadSchema, payload)
    )
  )
  handleInvoke('write:retrieve-context', async (_, payload: unknown) => {
    try {
      const context = await retrieveWriteContext(
        parseIpcPayload('write:retrieve-context', writeRetrievalPayloadSchema, payload)
      )
      return { ok: true as const, context }
    } catch (error) {
      return {
        ok: false as const,
        message: error instanceof Error ? error.message : String(error)
      }
    }
  })
  handleInvoke('speech:transcribe', async (_, payload: unknown) =>
    transcribeSpeech(
      await store.load(),
      parseIpcPayload('speech:transcribe', speechTranscriptionPayloadSchema, payload)
    )
  )
  handleInvoke('write:inline-completion-debug:list', async () => listWriteInlineCompletionDebugEntries())
  handleInvoke('write:inline-completion-debug:clear', async () => {
    clearWriteInlineCompletionDebugEntries()
    return true
  })
  handleInvoke('desktop:command', async (event, command: unknown) => {
    runDesktopCommand(
      parseIpcPayload('desktop:command', desktopCommandSchema, command),
      event.sender,
      getMainWindow
    )
  })
  handleInvoke('shell:open-external', async (_, url: unknown) => {
    const validatedUrl = parseIpcPayload('shell:open-external', shellOpenExternalUrlSchema, url)
    await shell.openExternal(validatedUrl)
  })
  handleInvoke('notification:turn-complete', async (_, payload: unknown) =>
    showTurnCompleteNotification(
      parseIpcPayload('notification:turn-complete', notificationPayloadSchema, payload)
    )
  )
  handleInvoke('app:version', async () => getAppVersion())
  handleInvoke('gui:update-state', async () => readGuiUpdateState())
  handleInvoke('gui:update-check', async (_, channel: unknown): Promise<GuiUpdateInfo> => {
    const module = await loadGuiUpdaterModule()
    return module.checkGuiUpdate(
      parseIpcPayload(
        'gui:update-check',
        z.object({ channel: guiUpdateChannelSchema }).strict(),
        { channel }
      ).channel
    )
  })
  handleInvoke('gui:update-download', async (_, channel: unknown): Promise<GuiUpdateDownloadResult> => {
    const module = await loadGuiUpdaterModule()
    return module.downloadGuiUpdate(
      parseIpcPayload(
        'gui:update-download',
        z.object({ channel: guiUpdateChannelSchema }).strict(),
        { channel }
      ).channel
    )
  })
  handleInvoke('gui:update-install', async (): Promise<GuiUpdateInstallResult> => {
    const module = await loadGuiUpdaterModule()
    return module.installGuiUpdate()
  })

  handleInvoke('log:error', async (_, payload: unknown) => {
    const request = parseIpcPayload('log:error', logErrorPayloadSchema, payload)
    logError(request.category, request.message, request.detail)
  })
  handleInvoke('log:get-path', async () => resolveLogDirectory())
  handleInvoke('log:open-dir', async () => {
    const dir = resolveLogDirectory()
    try {
      await mkdir(dir, { recursive: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, message }
    }
    const error = await shell.openPath(dir)
    if (error) return { ok: false, message: error }
    return { ok: true }
  })

  return { invoke }
}
