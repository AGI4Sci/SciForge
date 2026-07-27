import type {
  AppSettingsPatch,
  AppSettingsV1,
  AgentRuntimeId,
  RemoteChannelAgentProfileV1,
  ComputerUseSettingsV1,
  ScheduleRunResult,
  ScheduleRuntimeStatus,
  ScheduleTaskFromTextResult,
  WorkflowApprovalDecision,
  WorkflowCodeCheckResult,
  WorkflowCodeLanguage,
  WorkflowNodeTestResult,
  WorkflowRunResult,
  WorkflowRuntimeStatus
} from './app-settings'
import type {
  TraceClearResult,
  TraceExportResult,
  TraceReadQuery,
  TraceReadResult,
  TraceSummary,
  TraceSummaryQuery
} from '@sciforge/full-trace'
import type {
  AnchoredCommentCaptureRequest,
  AnchoredCommentCaptureResult,
  AnchoredCommentThread,
  CommentScreenshotAssetRef,
  FeedbackSubmissionRequest,
  FeedbackSubmissionResult,
  FeedbackSubmissionStatusRequest,
  FeedbackSubmissionStatusResult
} from './anchored-comments'
import type { EditorListResult, EditorOpenResult, OpenEditorPathOptions } from './editor'
import type { GitBranchesResult } from './git-branches'
import type {
  GuiUpdateChannel,
  GuiUpdateDownloadResult,
  GuiUpdateInfo,
  GuiUpdateInstallResult,
  GuiUpdateState
} from './gui-update'
import type {
  ClipboardImageReadResult,
  WorkspaceClipboardImageSavePayload,
  WorkspaceClipboardImageSaveResult,
  WorkspaceClipboardPastePayload,
  WorkspaceClipboardPasteResult,
  WorkspaceFileReadResult,
  WorkspaceImageReadResult,
  WorkspaceDirectoryCreatePayload,
  WorkspaceDirectoryCreateResult,
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceEntryRenamePayload,
  WorkspaceEntryRenameResult,
  WorkspacePdfRenameSuggestionPayload,
  WorkspacePdfRenameSuggestionResult,
  WorkspaceEntryCopyPayload,
  WorkspaceEntryCopyResult,
  WorkspaceEntryImportPayload,
  WorkspaceEntryImportResult,
  WorkspaceEntryMovePayload,
  WorkspaceEntryMoveResult,
  WorkspaceEntryDeletePayload,
  WorkspaceEntryDeleteResult,
  WorkspaceFileChangePayload,
  WorkspaceFileCreatePayload,
  WorkspaceFileCreateResult,
  WorkspaceFileResolveResult,
  WorkspaceFileTarget,
  WorkspaceFileWatchPayload,
  WorkspaceFileWatchResult,
  WorkspaceFileWritePayload,
  WorkspaceFileWriteResult
} from './workspace-file'
import type {
  WorkspaceObservation,
  WorkspacePreviewArtifactDescriptor,
  WorkspacePreviewAnchor,
  WorkspacePreviewAssetTransportDescriptor,
  WorkspacePreviewEditDiffSummary,
  WorkspacePreviewEditOperation,
  WorkspacePreviewExportTarget,
  WorkspacePreviewFileState,
  WorkspacePreviewIntegrityExpectation,
  WorkspacePreviewIntegrityVerification,
  WorkspacePreviewPluginActionResult,
  WorkspacePreviewPluginManifest,
  WorkspacePreviewSession,
  WorkspaceStructuredSelection
} from './workspace-preview'
import type { PdfAnnotationSidecar } from './pdf-annotations'
import type {
  CapabilityReadiness,
  CapabilityReadinessRequest,
  CapabilityDescriptor,
  CapabilityDiscoveryQuery,
  CapabilityEventQuery,
  CapabilityInvocationRequest,
  CapabilityInvocationResult,
  CapabilityObservation,
  CapabilityObserveRequest,
  CapabilityResourceBindRequest,
  CapabilityResourceContentAccess,
  CapabilityResourceHandle,
  CapabilityResourceBinding as BrokerCapabilityResourceBinding,
  CapabilityResourceChangeEvent
} from './capability-broker'
import type { BioGymDoctorResult, BioGymRunEvent } from './biogym'
import type {
  WriteInlineCompletionDebugEntry,
  WriteInlineCompletionRequest,
  WriteInlineCompletionResult
} from './write-inline-completion'
import type {
  WriteRetrievalRequest,
  WriteRetrievalResult
} from './write-retrieval'
import type {
  WriteExportPayload,
  WriteExportResult,
  WriteRichClipboardPayload,
  WriteRichClipboardResult
} from './write-export'
import type {
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeThreadRelation,
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
} from './agent-runtime-contract'
import type {
  SpeechTranscriptionRequest,
  SpeechTranscriptionResult
} from './speech-to-text'
import type {
  TerminalCreatePayload,
  TerminalCreateResult,
  TerminalDataPayload,
  TerminalExitPayload,
  TerminalResizePayload,
  TerminalWritePayload
} from './terminal'
import type {
  VisibleContextCapturePreviewRequest,
  VisibleContextCapturePreviewResult,
  VisibleContextPublishInput,
  VisibleContextSnapshot
} from './visible-context'
import type {
  VisualStyleExtractRequest,
  VisualStyleExtractResult,
  VisualStyleSaveProfileRequest,
  VisualStyleSaveProfileResult
} from './visual-style'
import type {
  ScientificPlottingPrepareReferenceRequest,
  ScientificPlottingPrepareReferenceResult,
  ScientificPlottingStatusResult
} from './scientific-plotting'
import type {
  VisualDocument,
  VisualDocumentCreateCandidateRequest,
  VisualDocumentCreateCandidateResult,
  VisualDocumentExportReviewPacketRequest,
  VisualDocumentExportReviewPacketResult,
  VisualDocumentInsertArtifactRequest,
  VisualDocumentInsertArtifactResult,
  VisualDocumentOpenRequest,
  VisualDocumentOpenResult,
  VisualDocumentRevisionDecisionRequest,
  VisualDocumentRevisionDecisionResult,
  VisualDocumentSaveAnnotationsRequest,
  VisualDocumentSaveAnnotationsResult,
  VisualDocumentStatusResult,
  VisualDocumentUpdateContextRequest,
  VisualDocumentUpdateContextResult,
  VisualReviewAnnotation,
  VisualReviewPacket
} from '../../packages/workers/visual-document/src/types'
export type {
  VisualDocument,
  VisualDocumentCreateCandidateRequest,
  VisualDocumentCreateCandidateResult,
  VisualDocumentExportReviewPacketRequest,
  VisualDocumentExportReviewPacketResult,
  VisualDocumentInsertArtifactRequest,
  VisualDocumentInsertArtifactResult,
  VisualDocumentOpenRequest,
  VisualDocumentOpenResult,
  VisualDocumentRevisionDecisionRequest,
  VisualDocumentRevisionDecisionResult,
  VisualDocumentSaveAnnotationsRequest,
  VisualDocumentSaveAnnotationsResult,
  VisualDocumentStatusResult,
  VisualDocumentUpdateContextRequest,
  VisualDocumentUpdateContextResult,
  VisualReviewAnnotation,
  VisualReviewPacket
}
import type {
  ResearchCard,
  ResearchCardArchiveInput,
  ResearchCardCreateInput,
  ResearchCardListInput,
  ResearchCardUpdateInput
} from './research-cards'

export type WorkspacePickResult = { canceled: boolean; path: string | null }
export type WorkspaceFilePickerFilter = {
  name: string
  extensions: string[]
}
export type WorkspaceFilePickerRequest = {
  title: string
  defaultPath?: string
  filters: WorkspaceFilePickerFilter[]
}
export type PathOpenResult = { ok: boolean; message?: string }
export type AgentRuntimeEventSubscribeInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  sinceSeq?: number
  streamId?: string
}
export type AgentRuntimeThreadRenameInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  title: string
}
export type AgentRuntimeThreadDeleteInput = {
  runtimeId: AgentRuntimeId
  threadId: string
}
export type AgentRuntimeThreadCompactInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  reason?: string
}
export type AgentRuntimeThreadForkInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  relation?: AgentRuntimeThreadRelation
  title?: string
}
export type AgentRuntimeSessionResumeInput = {
  runtimeId: AgentRuntimeId
  sessionId: string
  model?: string
  mode?: string
  maxResumeCount?: number
}
export type AgentRuntimeSessionResumeHandle = {
  threadId: string
  sessionId: string
}
export type AgentRuntimeThreadRelationInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  relation: AgentRuntimeThreadRelation
}
export type AgentRuntimeApprovalResolveInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  approvalId: string
  decision: 'allowed' | 'denied'
  message?: string
}
export type AgentRuntimeUserInputResolveInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  requestId: string
  answers: Array<{ id: string; label?: string; value: string }>
}
export type AgentRuntimeEventPayload = {
  streamId: string
  event: AgentRuntimeEvent
}
export type AgentRuntimeEventEndPayload = {
  streamId: string
}
export type AgentRuntimeEventErrorPayload = {
  streamId: string
  message?: string
}
export const DESKTOP_COMMANDS = [
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'selectAll',
  'reload',
  'zoomIn',
  'zoomOut',
  'resetZoom',
  'toggleDevTools',
  'minimize',
  'toggleMaximize',
  'close',
  'quit'
] as const
export type DesktopCommand = typeof DESKTOP_COMMANDS[number]
export type SkillSaveResult = { ok: true; path: string } | { ok: false; message: string }
export type SkillListItem = {
  id: string
  name: string
  description?: string
  root: string
  entryPath: string
  scope: 'project' | 'global'
  legacy: boolean
}
export type SkillListResult =
  | { ok: true; skills: SkillListItem[]; validationErrors: Array<{ root: string; message: string }> }
  | { ok: false; message: string }
export type ScientificSkillsMcpConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; message: string }
export type ScientificPlottingMcpConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; message: string }
export type BgcDiscoveryMcpConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; message: string }
export type DatasetApiMcpConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; message: string }
export type ImageGenerationMcpConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; message: string }
export type PptMasterMcpConfigResult =
  | { ok: true; config: Record<string, unknown> }
  | { ok: false; message: string }
export type ScientificSkillsInstallRequest = {
  workspaceRoot: string
  backend?: 'git' | 'npx'
  ref?: string
}
export type ScientificSkillsInstallResult =
  | {
      ok: true
      status: 'installed' | 'already_installed'
      backend: 'git' | 'npx'
      targetPath: string
      commit?: string
      provenancePath?: string
      stdoutTail?: string
      stderrTail?: string
    }
  | {
      ok: false
      status:
        | 'invalid_workspace'
        | 'invalid_existing_target'
        | 'clone_failed'
        | 'verification_failed'
        | 'npx_failed'
        | 'not_discovered_after_npx'
        | 'unexpected_error'
      backend?: 'git' | 'npx'
      targetPath?: string
      message: string
      stdoutTail?: string
      stderrTail?: string
    }
export type ScientificSkillsStatusResult =
  | {
      ok: true
      installed: boolean
      skillCount: number
      fingerprint: string
      indexedAt: string
      roots: Array<{
        path: string
        source: string
        exists: boolean
        skillCount: number
        error?: string
      }>
      validationErrors: Array<{ path: string; message: string }>
      plottingPack: {
        total: number
        installed: number
        missing: number
        items: Array<{
          skillId: string
          label: string
          installed: boolean
          name?: string
          description?: string
          entryPath?: string
          dependencyRisk?: string
          validationErrors: string[]
        }>
      }
      installHint?: string
      onDemandPolicy: {
        mode: 'manual-approval'
        summary: string
      }
    }
  | { ok: false; message: string }
export type TurnCompleteNotificationPayload = {
  threadId?: string
  title: string
  body: string
}
export type SystemNotificationResult =
  | { ok: true; shown: boolean; reason?: string }
  | { ok: false; message: string }
export type RemoteChannelActivityPayload = {
  channelId: string
  threadId: string
  runtimeId?: AgentRuntimeId
  previousThreadId?: string
}
export type RemoteChannelActiveThreadContextPayload = {
  threadId: string
  runtimeId?: AgentRuntimeId
  workspaceRoot?: string
}
export type RemoteChannelMirrorResult =
  | { ok: true }
  | { ok: false; message: string }
export type UpstreamModelsResult =
  | { ok: true; modelIds: string[]; modelGroups?: ModelProviderModelGroup[] }
  | { ok: false; message: string }
export type ModelProviderModelGroup = {
  providerId: string
  label: string
  modelIds: string[]
}
export type ModelAccessCredentialState =
  | 'missing'
  | 'configured'
  | 'authenticated'
  | 'unauthenticated'
  | 'rejected'
  | 'unknown'
export type ModelAccessWireProtocol = 'responses' | 'chat-completions' | 'anthropic-messages'
export type ModelAccessProtocolState =
  | 'cached'
  | 'selected'
  | 'pending-first-request'
  | 'unknown'
  | 'not-applicable'
export type ModelAccessStatus = {
  setupRequired: boolean
  mode: 'api' | 'coding-plan' | null
  service: 'model-router' | 'plan-gateway' | null
  health: 'healthy' | 'not_configured' | 'unavailable' | 'error'
  adapterId: string | null
  credentialState: ModelAccessCredentialState
  protocol: ModelAccessWireProtocol | null
  protocolState: ModelAccessProtocolState
  traceCaptureReady: boolean
  action: string
}
export type ComputerUsePermissionKind = 'accessibility' | 'screenRecording'
export type ComputerUsePermissionState = 'granted' | 'denied' | 'unknown'
export type ComputerUsePermissions = {
  platform: string
  supported: boolean
  needsPermission: boolean
  accessibility: ComputerUsePermissionState
  screenRecording: ComputerUsePermissionState
  accessibilityNeedsRestart: boolean
}
export type ComputerUseLeaseView = {
  leaseId: string
  computerUseSessionId: string
  agentId: string
  threadId: string
  turnId?: string
  targetId: string
  backend: string
  acquiredAt: string
  updatedAt: string
}
export type ComputerUseRejectionView = {
  code: string
  message: string
  targetId?: string
  activeLease?: ComputerUseLeaseView
}
export type ComputerUseBackendStatusView = {
  backend: string
  available: boolean
  platform: string
  reason?: string
  activeLeases: ComputerUseLeaseView[]
  recentRejections: ComputerUseRejectionView[]
  recentError?: string
}
export type ComputerUseRuntimeStatusView = {
  updatedAt: string
  servers: Array<ComputerUseBackendStatusView & { serverId: string; pid: number; updatedAt: string }>
  activeLeases: ComputerUseLeaseView[]
  recentRejections: ComputerUseRejectionView[]
  backend: ComputerUseBackendStatusView | null
}
export type ComputerUseStatusView = {
  settings?: ComputerUseSettingsV1
  permissions: ComputerUsePermissions
  runtime: ComputerUseRuntimeStatusView
}
export type ConnectPhoneInstallQrResult =
  | { ok: true; url: string; deviceCode: string; userCode: string; interval: number; expireIn: number }
  | { ok: false; message: string }
export type ConnectPhoneInstallPollResult =
  | { done: true; kind: 'feishu'; appId: string; appSecret: string; domain: string }
  | { done: true; kind: 'weixin'; accountId: string; sessionKey: string }
  | { done: false; error?: string }
export type ConnectPhoneRuntimeStatus = {
  imServerRunning: boolean
  imUrl: string
  runningTaskIds: string[]
}
export type RemoteChannelTaskFromTextResult = ScheduleTaskFromTextResult
export type DiscordBotInfo = {
  applicationId: string
  botId: string
  botUsername: string
  inviteUrl: string
}
export type DiscordGuild = {
  id: string
  name: string
}
export type DiscordChannel = {
  id: string
  name: string
  type: number
}
export type DiscordGuardConflictStatus = {
  channelConfigId: string
  guildId: string
  guildName: string
  channelId: string
  channelName: string
  ownerInstallationId: string
  currentInstallationId: string
  takeoverAvailable: boolean
  message: string
}
export type DiscordBotChannelStatus = {
  channelConfigId: string
  guildId: string
  guildName: string
  channelId: string
  channelName: string
  label: string
  enabled: boolean
  connected: boolean
  conflict?: DiscordGuardConflictStatus
  guardOwnerInstallationId?: string
  guardOwnerUpdatedAt?: string
  workspaceRoot: string
  model: string
  runtimeId?: AgentRuntimeId
  agentName: string
  accessError?: string
}
export type DiscordBotStatus = {
  installationId?: string
  clientId?: string
  inviteUrl?: string
  tokenConfigured?: boolean
  proxyUrl?: string
  configured: boolean
  connected: boolean
  enabled: boolean
  bot?: DiscordBotInfo
  channels?: DiscordBotChannelStatus[]
  conflict?: DiscordGuardConflictStatus
  guildId?: string
  guildName?: string
  channelId?: string
  channelName?: string
  message?: string
}
export type DiscordConfigureClientResult =
  | { ok: true; status: DiscordBotStatus }
  | { ok: false; message: string }
export type DiscordConfigureTokenResult =
  | { ok: true; status: DiscordBotStatus }
  | { ok: false; message: string }
export type DiscordConfigureProxyResult =
  | { ok: true; status: DiscordBotStatus }
  | { ok: false; message: string }
export type DiscordGuildListResult =
  | { ok: true; guilds: DiscordGuild[] }
  | { ok: false; message: string }
export type DiscordChannelListResult =
  | { ok: true; channels: DiscordChannel[] }
  | { ok: false; message: string }
export type DiscordBindChannelResult =
  | { ok: true; status: DiscordBotStatus; channelConfigId: string }
  | { ok: false; message: string }
export type DiscordTestSendResult =
  | { ok: true; messageId: string }
  | { ok: false; message: string }
export type DiscordGuardResult =
  | { ok: true; status: DiscordBotStatus }
  | { ok: false; message: string; status?: DiscordBotStatus; conflict?: DiscordGuardConflictStatus }
export type ZulipBotInfo = {
  realmUrl: string
  botEmail: string
  botUserId: string
  botFullName: string
}
export type ZulipStream = {
  id: string
  name: string
}
export type ZulipTopic = {
  name: string
  maxId?: number
}
export type ZulipGuardConflictStatus = {
  channelConfigId: string
  streamId: string
  streamName: string
  topicName: string
  ownerInstallationId: string
  currentInstallationId: string
  takeoverAvailable: boolean
  message: string
}
export type ZulipBotChannelStatus = {
  channelConfigId: string
  streamId: string
  streamName: string
  topicName: string
  label: string
  enabled: boolean
  connected: boolean
  conflict?: ZulipGuardConflictStatus
  guardOwnerInstallationId?: string
  guardOwnerUpdatedAt?: string
  workspaceRoot: string
  model: string
  runtimeId?: AgentRuntimeId
  agentName: string
  accessError?: string
}
export type ZulipBotStatus = {
  installationId?: string
  realmUrl?: string
  botEmail?: string
  tokenConfigured?: boolean
  configured: boolean
  connected: boolean
  enabled: boolean
  bot?: ZulipBotInfo
  channels?: ZulipBotChannelStatus[]
  conflict?: ZulipGuardConflictStatus
  streamId?: string
  streamName?: string
  topicName?: string
  message?: string
}
export type ZulipConfigureResult =
  | { ok: true; status: ZulipBotStatus }
  | { ok: false; message: string }
export type ZulipStreamListResult =
  | { ok: true; streams: ZulipStream[] }
  | { ok: false; message: string }
export type ZulipTopicListResult =
  | { ok: true; topics: ZulipTopic[] }
  | { ok: false; message: string }
export type ZulipBindChannelResult =
  | { ok: true; status: ZulipBotStatus; channelConfigId: string }
  | { ok: false; message: string }
export type ZulipTestSendResult =
  | { ok: true; messageId: string }
  | { ok: false; message: string }
export type ZulipGuardResult =
  | { ok: true; status: ZulipBotStatus }
  | { ok: false; message: string; status?: ZulipBotStatus; conflict?: ZulipGuardConflictStatus }
export type PerformanceSnapshotResult =
  | { ok: true; snapshot: unknown }
  | { ok: false; message: string }
export type WorkspacePreviewOpenInput = {
  path: string
  workspaceRoot: string
  mimeType?: string
  mode?: WorkspacePreviewSession['mode']
  line?: number
  column?: number
  selection?: WorkspaceStructuredSelection
  anchor?: WorkspacePreviewAnchor
  integrity?: WorkspacePreviewIntegrityExpectation
}
export type CapabilityResourceBinding = BrokerCapabilityResourceBinding
export type WorkspacePreviewOpenResult =
  | {
      ok: true
      session: WorkspacePreviewSession
      manifest: WorkspacePreviewPluginManifest
      route: 'matched' | 'fallback'
      file: WorkspacePreviewFileState
      integrity?: WorkspacePreviewIntegrityVerification
      capability?: CapabilityResourceBinding
    }
  | { ok: false; message: string }
export type WorkspacePreviewObserveResult =
  | { ok: true; observation: WorkspaceObservation; capability?: CapabilityResourceBinding }
  | { ok: false; message: string }
export type WorkspacePreviewReadRangeResult =
  | {
      ok: true
      sessionId: string
      assetId: string
      offset: number
      length: number
      size: number
      dataBase64: string
      mimeType?: string
    }
  | { ok: false; message: string }
export type WorkspacePreviewPrepareArtifactResult =
  | {
      ok: true
      sessionId: string
      artifact: WorkspacePreviewArtifactDescriptor
    }
  | { ok: false; message: string }
export type WorkspacePreviewReadArtifactRangeResult =
  | {
      ok: true
      sessionId: string
      assetId: string
      artifactId: string
      offset: number
      length: number
      size: number
      mimeType: string
      dataBase64: string
    }
  | { ok: false; message: string }
export type WorkspacePreviewDescribeAssetResult =
  | { ok: true; descriptor: WorkspacePreviewAssetTransportDescriptor }
  | { ok: false; message: string }
export type WorkspacePreviewApplyEditResult =
  | {
      ok: true
      session: WorkspacePreviewSession
      operationKind: WorkspacePreviewEditOperation['kind']
      appliedAt: string
      audit: {
        pluginId: string
        path: string
        operationKind: WorkspacePreviewEditOperation['kind']
        effect: 'file-write' | 'session-update' | 'sidecar-write'
      }
      diffSummary?: WorkspacePreviewEditDiffSummary
      capability?: CapabilityResourceBinding
    }
  | { ok: false; message: string }
export type WorkspacePreviewExportResult =
  | {
      ok: true
      sessionId: string
      path: string
      target: WorkspacePreviewExportTarget
      exportedAt: string
      audit: {
        pluginId: string
        sourcePath: string
        targetKind: WorkspacePreviewExportTarget['kind']
        format: string
        effect: 'source-copy' | 'sidecar-package' | 'annotated-pdf'
      }
    }
  | { ok: false; message: string }
export type WorkspacePreviewInvokeActionResult =
  | (WorkspacePreviewPluginActionResult & { capability?: CapabilityResourceBinding })
  | { ok: false; message: string }

export type WorkspacePreviewAnnotationListResult =
  | { ok: true; sidecar: PdfAnnotationSidecar }
  | { ok: false; message: string }
export type WorkspacePreviewAnnotationImportResult =
  | {
      ok: true
      sidecar: PdfAnnotationSidecar
      importedAt: string
      fingerprintMatched: boolean
      warnings: string[]
    }
  | { ok: false; message: string }
export type WorkspacePreviewAnnotationReviewGenerateResult =
  | {
      ok: true
      sidecar: PdfAnnotationSidecar
      mode: 'auto' | 'import'
      commentCount: number
      skippedCount: number
      generatedAt: string
    }
  | { ok: false; message: string }
export type WorkspacePreviewAnnotationReviewImproveResult =
  | {
      ok: true
      sidecar: PdfAnnotationSidecar
      threadId: string
      annotationId: string
      modificationAdvice: string
      revisedContent: string
      generatedAt: string
    }
  | { ok: false; message: string }

export type FullTraceExportDialogResult =
  | { canceled: true }
  | ({ canceled: false } & TraceExportResult)

export type SciForgeApi = {
  platform: string
  /**
   * Use Chromium page zoom for application-wide UI scaling. Unlike CSS `zoom`,
   * this keeps pointer coordinates aligned with WebGL canvas coordinates.
   */
  setUiZoomFactor?: (factor: number) => void
  getSettings: () => Promise<AppSettingsV1>
  setSettings: (partial: AppSettingsPatch) => Promise<AppSettingsV1>
  onSettingsChanged: (handler: (settings: AppSettingsV1) => void) => () => void
  getModelAccessStatus: () => Promise<ModelAccessStatus>
  fetchUpstreamModels: () => Promise<UpstreamModelsResult>
  traces: {
    read: (query?: TraceReadQuery) => Promise<TraceReadResult>
    summaries: (query?: TraceSummaryQuery) => Promise<TraceSummary[]>
    export: (traceIds?: readonly string[]) => Promise<FullTraceExportDialogResult>
    clear: () => Promise<TraceClearResult>
  }
  getConnectPhoneStatus: () => Promise<ConnectPhoneRuntimeStatus>
  getScheduleStatus: () => Promise<ScheduleRuntimeStatus>
  runScheduleTask: (taskId: string) => Promise<ScheduleRunResult>
  getWorkflowStatus: () => Promise<WorkflowRuntimeStatus>
  runWorkflow: (workflowId: string, input?: unknown) => Promise<WorkflowRunResult>
  stopWorkflow: (workflowId: string) => Promise<WorkflowRunResult>
  runWorkflowNode: (workflowId: string, nodeId: string) => Promise<WorkflowRunResult>
  testWorkflowNode: (workflowId: string, nodeId: string, mockJson: string) => Promise<WorkflowNodeTestResult>
  resolveWorkflowApproval: (token: string, decision: WorkflowApprovalDecision) => Promise<{ ok: boolean }>
  checkWorkflowCode: (language: WorkflowCodeLanguage, code: string) => Promise<WorkflowCodeCheckResult>
  startConnectPhoneInstallQr: (
    provider: 'feishu' | 'weixin',
    options?: { isLark?: boolean }
  ) => Promise<ConnectPhoneInstallQrResult>
  pollConnectPhoneInstall: (
    provider: 'feishu' | 'weixin',
    deviceCode: string
  ) => Promise<ConnectPhoneInstallPollResult>
  getDiscordBotStatus: () => Promise<DiscordBotStatus>
  configureDiscordClientId: (clientId: string) => Promise<DiscordConfigureClientResult>
  configureDiscordBotToken: (token: string, clientId?: string) => Promise<DiscordConfigureTokenResult>
  configureDiscordProxy: (proxyUrl: string) => Promise<DiscordConfigureProxyResult>
  listDiscordGuilds: () => Promise<DiscordGuildListResult>
  listDiscordChannels: (guildId: string) => Promise<DiscordChannelListResult>
  bindDiscordChannel: (payload: {
    channelConfigId?: string
    guildId: string
    guildName?: string
    channelId: string
    channelName?: string
    enabled?: boolean
    workspaceRoot?: string
    model?: string
    runtimeId?: AgentRuntimeId
    agentProfile?: Partial<RemoteChannelAgentProfileV1>
  }) => Promise<DiscordBindChannelResult>
  testDiscordChannel: (channelId: string, text?: string, channelConfigId?: string) => Promise<DiscordTestSendResult>
  setDiscordGuard: (
    enabled: boolean,
    channelConfigId?: string,
    forceTakeover?: boolean
  ) => Promise<DiscordGuardResult>
  getZulipBotStatus: () => Promise<ZulipBotStatus>
  configureZulipBot: (payload: {
    realmUrl: string
    botEmail: string
    apiKey: string
  }) => Promise<ZulipConfigureResult>
  listZulipStreams: () => Promise<ZulipStreamListResult>
  listZulipTopics: (streamId: string) => Promise<ZulipTopicListResult>
  bindZulipChannel: (payload: {
    channelConfigId?: string
    streamId: string
    streamName?: string
    topicName?: string
    enabled?: boolean
    workspaceRoot?: string
    model?: string
    runtimeId?: AgentRuntimeId
    agentProfile?: Partial<RemoteChannelAgentProfileV1>
  }) => Promise<ZulipBindChannelResult>
  testZulipChannel: (
    channelId: string,
    text?: string,
    channelConfigId?: string,
    topicName?: string
  ) => Promise<ZulipTestSendResult>
  setZulipGuard: (
    enabled: boolean,
    channelConfigId?: string,
    forceTakeover?: boolean
  ) => Promise<ZulipGuardResult>
  pickWorkspaceDirectory: (defaultPath?: string) => Promise<WorkspacePickResult>
  pickFile: (request: WorkspaceFilePickerRequest) => Promise<WorkspacePickResult>
  buildScientificSkillsMcpConfig: (workspaceRoot?: string) => Promise<ScientificSkillsMcpConfigResult>
  buildScientificPlottingMcpConfig: (workspaceRoot?: string) => Promise<ScientificPlottingMcpConfigResult>
  buildBgcDiscoveryMcpConfig: (workspaceRoot?: string) => Promise<BgcDiscoveryMcpConfigResult>
  buildDatasetApiMcpConfig: (workspaceRoot?: string) => Promise<DatasetApiMcpConfigResult>
  buildImageGenerationMcpConfig: (workspaceRoot?: string) => Promise<ImageGenerationMcpConfigResult>
  buildPptMasterMcpConfig: (workspaceRoot?: string) => Promise<PptMasterMcpConfigResult>
  getScientificSkillsStatus: (workspaceRoot?: string) => Promise<ScientificSkillsStatusResult>
  installScientificSkills: (request: ScientificSkillsInstallRequest) => Promise<ScientificSkillsInstallResult>
  getScientificPlottingStatus: (workspaceRoot?: string) => Promise<ScientificPlottingStatusResult>
  prepareScientificPlottingReference: (
    request: ScientificPlottingPrepareReferenceRequest
  ) => Promise<ScientificPlottingPrepareReferenceResult>
  getVisualDocumentStatus: (workspaceRoot?: string) => Promise<VisualDocumentStatusResult>
  openVisualDocument: (request: VisualDocumentOpenRequest) => Promise<VisualDocumentOpenResult>
  insertVisualDocumentArtifact: (
    request: VisualDocumentInsertArtifactRequest
  ) => Promise<VisualDocumentInsertArtifactResult>
  updateVisualDocumentContext: (
    request: VisualDocumentUpdateContextRequest
  ) => Promise<VisualDocumentUpdateContextResult>
  saveVisualDocumentAnnotations: (
    request: VisualDocumentSaveAnnotationsRequest
  ) => Promise<VisualDocumentSaveAnnotationsResult>
  exportVisualReviewPacket: (
    request: VisualDocumentExportReviewPacketRequest
  ) => Promise<VisualDocumentExportReviewPacketResult>
  createVisualCandidateRevision: (
    request: VisualDocumentCreateCandidateRequest
  ) => Promise<VisualDocumentCreateCandidateResult>
  acceptVisualCandidateRevision: (
    request: VisualDocumentRevisionDecisionRequest
  ) => Promise<VisualDocumentRevisionDecisionResult>
  rejectVisualCandidateRevision: (
    request: VisualDocumentRevisionDecisionRequest
  ) => Promise<VisualDocumentRevisionDecisionResult>
  extractVisualStyleProfile: (request: VisualStyleExtractRequest) => Promise<VisualStyleExtractResult>
  saveVisualStyleProfile: (request: VisualStyleSaveProfileRequest) => Promise<VisualStyleSaveProfileResult>
  listSkills: (workspaceRoot?: string) => Promise<SkillListResult>
  saveSkillFile: (rootPath: string, skillName: string, content: string) => Promise<SkillSaveResult>
  openSkillRoot: (rootPath: string) => Promise<PathOpenResult>
  getGitBranches: (workspaceRoot: string) => Promise<GitBranchesResult>
  switchGitBranch: (workspaceRoot: string, branch: string) => Promise<GitBranchesResult>
  createAndSwitchGitBranch: (workspaceRoot: string, branch: string) => Promise<GitBranchesResult>
  listEditors: () => Promise<EditorListResult>
  openEditorPath: (options: OpenEditorPathOptions) => Promise<EditorOpenResult>
  listWorkspaceDirectory: (options: WorkspaceDirectoryTarget) => Promise<WorkspaceDirectoryListResult>
  resolveWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileResolveResult>
  readWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileReadResult>
  readWorkspaceImage: (options: WorkspaceFileTarget) => Promise<WorkspaceImageReadResult>
  writeWorkspaceFile: (payload: WorkspaceFileWritePayload) => Promise<WorkspaceFileWriteResult>
  createWorkspaceFile: (payload: WorkspaceFileCreatePayload) => Promise<WorkspaceFileCreateResult>
  createWorkspaceDirectory: (
    payload: WorkspaceDirectoryCreatePayload
  ) => Promise<WorkspaceDirectoryCreateResult>
  saveWorkspaceClipboardImage: (
    payload: WorkspaceClipboardImageSavePayload
  ) => Promise<WorkspaceClipboardImageSaveResult>
  readClipboardImage: () => Promise<ClipboardImageReadResult>
  pasteWorkspaceClipboard: (
    payload: WorkspaceClipboardPastePayload
  ) => Promise<WorkspaceClipboardPasteResult>
  renameWorkspaceEntry: (
    payload: WorkspaceEntryRenamePayload
  ) => Promise<WorkspaceEntryRenameResult>
  suggestWorkspacePdfName: (
    payload: WorkspacePdfRenameSuggestionPayload
  ) => Promise<WorkspacePdfRenameSuggestionResult>
  copyWorkspaceEntry: (
    payload: WorkspaceEntryCopyPayload
  ) => Promise<WorkspaceEntryCopyResult>
  importWorkspaceEntries: (
    payload: WorkspaceEntryImportPayload
  ) => Promise<WorkspaceEntryImportResult>
  moveWorkspaceEntry: (
    payload: WorkspaceEntryMovePayload
  ) => Promise<WorkspaceEntryMoveResult>
  deleteWorkspaceEntry: (
    payload: WorkspaceEntryDeletePayload
  ) => Promise<WorkspaceEntryDeleteResult>
  watchWorkspaceFile: (payload: WorkspaceFileWatchPayload) => Promise<WorkspaceFileWatchResult>
  unwatchWorkspaceFile: (watchId: string) => Promise<boolean>
  onWorkspaceFileChanged: (handler: (payload: WorkspaceFileChangePayload) => void) => () => void
  capabilities: {
    readiness: (input: CapabilityReadinessRequest) => Promise<CapabilityReadiness>
    discover: (input?: {
      workspaceId?: string
      query?: CapabilityDiscoveryQuery
    }) => Promise<CapabilityDescriptor[]>
    observe: (input: {
      workspaceId?: string
      request: CapabilityObserveRequest
    }) => Promise<CapabilityObservation>
    bind: (input: {
      workspaceId?: string
      request: CapabilityResourceBindRequest
    }) => Promise<CapabilityResourceHandle>
    invoke: (input: {
      workspaceId?: string
      request: CapabilityInvocationRequest
      approval?: { mode: 'confirmation' }
    }) => Promise<CapabilityInvocationResult>
    events: (input?: {
      workspaceId?: string
      query?: CapabilityEventQuery
    }) => Promise<CapabilityResourceChangeEvent[]>
    subscribe: (workspaceId?: string) => Promise<{ subscriptionId: string }>
    unsubscribe: (subscriptionId: string) => Promise<boolean>
    resourceContentUrl: (access: CapabilityResourceContentAccess) => string | null
    onEvent: (handler: (payload: {
      subscriptionId: string
      event: CapabilityResourceChangeEvent
    }) => void) => () => void
  }
  /** Optional until the BioGym service PR is installed. */
  biogym?: {
    doctor: () => Promise<BioGymDoctorResult>
    replay?: () => Promise<void>
    onRunEvent: (handler: (event: BioGymRunEvent) => void) => () => void
  }
  requestWriteInlineCompletion: (
    payload: WriteInlineCompletionRequest
  ) => Promise<WriteInlineCompletionResult>
  retrieveWriteContext: (payload: WriteRetrievalRequest) => Promise<WriteRetrievalResult>
  listWriteInlineCompletionDebugEntries: () => Promise<WriteInlineCompletionDebugEntry[]>
  clearWriteInlineCompletionDebugEntries: () => Promise<boolean>
  exportWriteDocument: (payload: WriteExportPayload) => Promise<WriteExportResult>
  copyWriteDocumentAsRichText: (
    payload: WriteRichClipboardPayload
  ) => Promise<WriteRichClipboardResult>
  speechToText: {
    transcribe: (payload: SpeechTranscriptionRequest) => Promise<SpeechTranscriptionResult>
  }
  researchCards: {
    list: (input?: ResearchCardListInput) => Promise<ResearchCard[]>
    create: (input: ResearchCardCreateInput) => Promise<ResearchCard>
    update: (input: ResearchCardUpdateInput) => Promise<ResearchCard>
    archive: (input: ResearchCardArchiveInput) => Promise<ResearchCard>
  }
  visibleContext: {
    publish: (snapshot: VisibleContextPublishInput) => Promise<VisibleContextSnapshot>
    get: () => Promise<VisibleContextSnapshot>
    readCapturePreview: (
      request: VisibleContextCapturePreviewRequest
    ) => Promise<VisibleContextCapturePreviewResult>
    onRefreshRequested: (handler: () => void) => () => void
    onCaptureStateChanged: (handler: (active: boolean) => void) => () => void
  }
  anchoredComments: {
    list: (filter?: {
      workspaceKey?: string
      targetKey?: string
      purpose?: AnchoredCommentThread['purpose']
      status?: AnchoredCommentThread['status']
      includeResolved?: boolean
    }) => Promise<AnchoredCommentThread[]>
    get: (threadId: string) => Promise<AnchoredCommentThread | null>
    upsert: (thread: AnchoredCommentThread) => Promise<AnchoredCommentThread>
    delete: (threadId: string) => Promise<boolean>
    readAsset: (asset: CommentScreenshotAssetRef) => Promise<{
      digest: string
      mimeType: 'image/png'
      dataUrl: string
    }>
    capture: (request: AnchoredCommentCaptureRequest) => Promise<AnchoredCommentCaptureResult>
    submitFeedback: (request: FeedbackSubmissionRequest) => Promise<FeedbackSubmissionResult>
    feedbackStatus: (
      request: FeedbackSubmissionStatusRequest
    ) => Promise<FeedbackSubmissionStatusResult>
  }
  agentRuntime: {
    connect: (runtimeId?: AgentRuntimeThreadListInput['runtimeId']) => Promise<void>
    capabilities: (runtimeId?: AgentRuntimeThreadListInput['runtimeId']) => Promise<AgentRuntimeCapabilities>
    listThreads: (input?: AgentRuntimeThreadListInput) => Promise<AgentRuntimeThread[]>
    startThread: (input: AgentRuntimeThreadStartInput) => Promise<AgentRuntimeThread>
    readThread: (input: AgentRuntimeThreadReadInput) => Promise<AgentRuntimeThreadDetail>
    readThreadSidebarProbe: (input: AgentRuntimeThreadReadInput) => Promise<AgentRuntimeThreadSidebarProbe>
    startTurn: (input: AgentRuntimeTurnStartInput) => Promise<AgentRuntimeTurnHandle>
    interruptTurn: (input: AgentRuntimeTurnTargetInput) => Promise<void>
    steerTurn: (input: AgentRuntimeTurnSteerInput) => Promise<void>
    subscribeEvents: (input: AgentRuntimeEventSubscribeInput) => Promise<{ streamId: string }>
    stopEvents: (streamId: string) => Promise<boolean>
    renameThread: (input: AgentRuntimeThreadRenameInput) => Promise<void>
    deleteThread: (input: AgentRuntimeThreadDeleteInput) => Promise<void>
    compactThread: (input: AgentRuntimeThreadCompactInput) => Promise<void>
    forkThread: (input: AgentRuntimeThreadForkInput) => Promise<AgentRuntimeThread>
    resumeSession: (input: AgentRuntimeSessionResumeInput) => Promise<AgentRuntimeSessionResumeHandle>
    updateThreadRelation: (input: AgentRuntimeThreadRelationInput) => Promise<void>
    usage: (input: AgentRuntimeUsageQuery) => Promise<AgentRuntimeUsageResponse>
    auxiliary: (input: AgentRuntimeAuxiliaryInput) => Promise<unknown>
    resolveApproval: (input: AgentRuntimeApprovalResolveInput) => Promise<void>
    resolveUserInput: (input: AgentRuntimeUserInputResolveInput) => Promise<void>
    onEvent: (handler: (payload: AgentRuntimeEventPayload) => void) => () => void
    onEnd: (handler: (payload: AgentRuntimeEventEndPayload) => void) => () => void
    onError: (handler: (payload: AgentRuntimeEventErrorPayload) => void) => () => void
  }
  onRemoteChannelActivity: (handler: (payload: RemoteChannelActivityPayload) => void) => () => void
  updateRemoteChannelActiveThreadContext: (payload: RemoteChannelActiveThreadContextPayload | null) => Promise<void>
  mirrorRemoteChannelMessage: (
    threadId: string,
    text: string,
    direction: 'user' | 'assistant'
  ) => Promise<RemoteChannelMirrorResult>
  createRemoteChannelTaskFromText: (
    text: string,
    options?: { channelId?: string; modelHint?: string; mode?: 'agent' | 'plan' }
  ) => Promise<RemoteChannelTaskFromTextResult>
  createScheduleTaskFromText: (
    text: string,
    options?: { workspaceRoot?: string; modelHint?: string; mode?: 'agent' | 'plan' }
  ) => Promise<ScheduleTaskFromTextResult>
  runDesktopCommand: (command: DesktopCommand) => Promise<void>
  getPerformanceSnapshot: () => Promise<PerformanceSnapshotResult>
  openExternal: (url: string) => Promise<void>
  getComputerUsePermissions: () => Promise<ComputerUsePermissions>
  requestComputerUsePermission: (
    kind: ComputerUsePermissionKind
  ) => Promise<ComputerUsePermissions>
  getComputerUseStatus: () => Promise<ComputerUseStatusView>
  showTurnCompleteNotification: (
    payload: TurnCompleteNotificationPayload
  ) => Promise<SystemNotificationResult>
  getAppVersion: () => Promise<string>
  getGuiUpdateState: () => Promise<GuiUpdateState>
  checkGuiUpdate: (channel?: GuiUpdateChannel) => Promise<GuiUpdateInfo>
  downloadGuiUpdate: (channel?: GuiUpdateChannel) => Promise<GuiUpdateDownloadResult>
  installGuiUpdate: () => Promise<GuiUpdateInstallResult>
  onGuiUpdateState: (handler: (payload: GuiUpdateState) => void) => () => void
  logError: (category: string, message: string, detail?: unknown) => Promise<void>
  getLogPath: () => Promise<string>
  openLogDir: () => Promise<{ ok: boolean; message?: string }>
  createTerminal: (payload: TerminalCreatePayload) => Promise<TerminalCreateResult>
  writeToTerminal: (payload: TerminalWritePayload) => Promise<boolean>
  resizeTerminal: (payload: TerminalResizePayload) => Promise<boolean>
  disposeTerminal: (sessionId: string) => Promise<boolean>
  onTerminalData: (handler: (payload: TerminalDataPayload) => void) => () => void
  onTerminalExit: (handler: (payload: TerminalExitPayload) => void) => () => void
  getPathForFile: (file: File) => string
}
