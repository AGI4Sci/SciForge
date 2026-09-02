import type {
  AppSettingsPatch,
  AppSettingsV1,
  AgentRuntimeId,
  ComputerUseSettingsV1,
  ScheduleRunResult,
  ScheduleRuntimeStatus,
  ScheduleTaskFromTextResult
} from './app-settings'
import type {
  TraceClearResult,
  TraceExportResult,
  TraceReadQuery,
  TraceReadResult,
  TraceSummary,
  TraceSummaryQuery
} from '@sciforge/full-trace'
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
  WorkspaceFileRangeReadPayload,
  WorkspaceFileRangeReadResult,
  WorkspaceFileResolveResult,
  WorkspaceFileTarget,
  WorkspaceFileWatchPayload,
  WorkspaceFileWatchResult,
  WorkspaceFileWritePayload,
  WorkspaceFileWriteResult,
  WorkspaceTextSearchPayload,
  WorkspaceTextSearchResult
} from './workspace-file'
import type { WorkspaceLocator } from '@sciforge/domain-sdk/workspace-host'
import type {
  DomainRendererDownloadSelection,
  DomainRendererPickDownloadDestinationInput,
  DomainRendererPickUploadSourceInput,
  DomainRendererUploadSelection
} from '@sciforge/domain-sdk/file-transfer'
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
  CapabilityResourceChangeEvent,
  CapabilityTransportRequestId
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
  WriteExportResult
} from './write-export'
import type {
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeThreadPage,
  AgentRuntimeThreadPageInput,
  AgentRuntimeThreadRelation,
  AgentRuntimeThread,
  AgentRuntimeThreadListInput,
  AgentRuntimeThreadStatus,
  AgentRuntimeThreadStatusInput,
  AgentRuntimeThreadStartInput,
  AgentRuntimeToolArtifact,
  AgentRuntimeToolArtifactReadInput,
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
  VisibleContextCapturePreviewRequest,
  VisibleContextCapturePreviewResult,
  VisibleContextPublishInput,
  VisibleContextSnapshot,
  VisibleContextTargetRefRequest,
  VisibleContextTargetRefResult
} from './visible-context'
import type { RemoteWorkspaceApi } from './remote-workspace'
import type { DomainExtensionsApi } from './domain-extensions'

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
  workspaceLocator?: WorkspaceLocator
  sinceSeq?: number
  streamId?: string
}
export type AgentRuntimeThreadRenameInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  workspaceLocator?: WorkspaceLocator
  title: string
}
export type AgentRuntimeThreadDeleteInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  workspaceLocator?: WorkspaceLocator
}
export type AgentRuntimeThreadCompactInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  workspaceLocator?: WorkspaceLocator
  reason?: string
}
export type AgentRuntimeThreadForkInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  workspaceLocator?: WorkspaceLocator
  relation?: AgentRuntimeThreadRelation
  title?: string
}
export type AgentRuntimeSessionResumeInput = {
  runtimeId: AgentRuntimeId
  sessionId: string
  workspaceLocator?: WorkspaceLocator
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
  workspaceLocator?: WorkspaceLocator
  relation: AgentRuntimeThreadRelation
}
export type AgentRuntimeApprovalResolveInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  workspaceLocator?: WorkspaceLocator
  approvalId: string
  decision: 'allowed' | 'denied'
  message?: string
}
export type AgentRuntimeUserInputResolveInput = {
  runtimeId: AgentRuntimeId
  threadId: string
  workspaceLocator?: WorkspaceLocator
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
export type BgcDiscoveryMcpConfigResult =
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
export type PerformanceSnapshotResult =
  | { ok: true; snapshot: unknown }
  | { ok: false; message: string }
export type WorkspacePreviewOpenInput = {
  path: string
  workspaceRoot: string
  workspaceLocator?: WorkspaceLocator
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
  extensions: DomainExtensionsApi
  getScheduleStatus: () => Promise<ScheduleRuntimeStatus>
  runScheduleTask: (taskId: string) => Promise<ScheduleRunResult>
  pickWorkspaceDirectory: (defaultPath?: string) => Promise<WorkspacePickResult>
  pickFile: (request: WorkspaceFilePickerRequest) => Promise<WorkspacePickResult>
  buildScientificSkillsMcpConfig: (workspaceRoot?: string) => Promise<ScientificSkillsMcpConfigResult>
  buildBgcDiscoveryMcpConfig: (workspaceRoot?: string) => Promise<BgcDiscoveryMcpConfigResult>
  buildImageGenerationMcpConfig: (workspaceRoot?: string) => Promise<ImageGenerationMcpConfigResult>
  buildPptMasterMcpConfig: (workspaceRoot?: string) => Promise<PptMasterMcpConfigResult>
  getScientificSkillsStatus: (workspaceRoot?: string) => Promise<ScientificSkillsStatusResult>
  installScientificSkills: (request: ScientificSkillsInstallRequest) => Promise<ScientificSkillsInstallResult>
  listSkills: (workspaceRoot?: string) => Promise<SkillListResult>
  saveSkillFile: (rootPath: string, skillName: string, content: string) => Promise<SkillSaveResult>
  openSkillRoot: (rootPath: string) => Promise<PathOpenResult>
  getGitBranches: (
    workspaceRoot: string,
    workspaceLocator?: WorkspaceLocator
  ) => Promise<GitBranchesResult>
  switchGitBranch: (
    workspaceRoot: string,
    branch: string,
    workspaceLocator?: WorkspaceLocator
  ) => Promise<GitBranchesResult>
  createAndSwitchGitBranch: (
    workspaceRoot: string,
    branch: string,
    workspaceLocator?: WorkspaceLocator
  ) => Promise<GitBranchesResult>
  listEditors: () => Promise<EditorListResult>
  openEditorPath: (options: OpenEditorPathOptions) => Promise<EditorOpenResult>
  listWorkspaceDirectory: (options: WorkspaceDirectoryTarget) => Promise<WorkspaceDirectoryListResult>
  resolveWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileResolveResult>
  readWorkspaceFile: (options: WorkspaceFileTarget) => Promise<WorkspaceFileReadResult>
  readWorkspaceImage: (options: WorkspaceFileTarget) => Promise<WorkspaceImageReadResult>
  writeWorkspaceFile: (payload: WorkspaceFileWritePayload) => Promise<WorkspaceFileWriteResult>
  readWorkspaceFileRange: (
    payload: WorkspaceFileRangeReadPayload
  ) => Promise<WorkspaceFileRangeReadResult>
  searchWorkspaceText: (
    payload: WorkspaceTextSearchPayload
  ) => Promise<WorkspaceTextSearchResult>
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
      transportRequestId?: CapabilityTransportRequestId
      workspaceId?: string
      request: CapabilityObserveRequest
    }) => Promise<CapabilityObservation>
    bind: (input: {
      workspaceId?: string
      request: CapabilityResourceBindRequest
    }) => Promise<CapabilityResourceHandle>
    invoke: (input: {
      transportRequestId?: CapabilityTransportRequestId
      workspaceId?: string
      workspaceLocator?: WorkspaceLocator
      request: CapabilityInvocationRequest
      approval?: { mode: 'confirmation' }
    }) => Promise<CapabilityInvocationResult>
    cancel: (transportRequestId: CapabilityTransportRequestId) => Promise<boolean>
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
  fileTransfers: {
    pickUploadSource: (input: {
      ownerId: string
      request: DomainRendererPickUploadSourceInput
      transportRequestId?: CapabilityTransportRequestId
    }) => Promise<DomainRendererUploadSelection>
    pickDownloadDestination: (input: {
      ownerId: string
      request: DomainRendererPickDownloadDestinationInput
      transportRequestId?: CapabilityTransportRequestId
    }) => Promise<DomainRendererDownloadSelection>
    cancel: (transportRequestId: CapabilityTransportRequestId) => Promise<boolean>
    settle: (transportRequestId: CapabilityTransportRequestId) => Promise<boolean>
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
  speechToText: {
    transcribe: (payload: SpeechTranscriptionRequest) => Promise<SpeechTranscriptionResult>
  }
  visibleContext: {
    publish: (snapshot: VisibleContextPublishInput) => Promise<VisibleContextSnapshot>
    get: () => Promise<VisibleContextSnapshot>
    registeredTargetRef: (
      request: VisibleContextTargetRefRequest
    ) => Promise<VisibleContextTargetRefResult>
    readCapturePreview: (
      request: VisibleContextCapturePreviewRequest
    ) => Promise<VisibleContextCapturePreviewResult>
    onRefreshRequested: (handler: () => void) => () => void
    onCaptureStateChanged: (handler: (active: boolean) => void) => () => void
  }
  remoteWorkspace: RemoteWorkspaceApi
  agentRuntime: {
    connect: (runtimeId?: AgentRuntimeThreadListInput['runtimeId']) => Promise<void>
    capabilities: (runtimeId?: AgentRuntimeThreadListInput['runtimeId']) => Promise<AgentRuntimeCapabilities>
    listThreads: (input?: AgentRuntimeThreadListInput) => Promise<AgentRuntimeThread[]>
    startThread: (input: AgentRuntimeThreadStartInput) => Promise<AgentRuntimeThread>
    readThreadStatus: (input: AgentRuntimeThreadStatusInput) => Promise<AgentRuntimeThreadStatus>
    readThreadPage: (input: AgentRuntimeThreadPageInput) => Promise<AgentRuntimeThreadPage>
    readToolArtifact: (input: AgentRuntimeToolArtifactReadInput) => Promise<AgentRuntimeToolArtifact>
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
  getPathForFile: (file: File) => string
}
