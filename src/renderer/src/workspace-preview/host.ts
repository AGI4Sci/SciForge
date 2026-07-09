import type {
  SciForgeApi,
  WorkspacePreviewApplyEditResult,
  WorkspacePreviewDescribeAssetResult,
  WorkspacePreviewExportResult,
  WorkspacePreviewInvokeActionResult,
  WorkspacePreviewObserveResult,
  WorkspacePreviewOpenInput,
  WorkspacePreviewOpenResult,
  WorkspacePreviewPrepareArtifactResult,
  WorkspacePreviewReadArtifactRangeResult,
  WorkspacePreviewReadRangeResult
} from '@shared/sciforge-api'
import type {
  WorkspaceFileChangePayload,
  WorkspaceFileWatchPayload,
  WorkspaceFileWatchResult
} from '@shared/workspace-file'
import type {
  WorkspacePreviewArtifactDescriptor,
  WorkspacePreviewAssetTransportDescriptor,
  WorkspacePreviewAssetTransportKind,
  WorkspaceObservation,
  WorkspacePreviewByteRange,
  WorkspacePreviewEditDiffSummary,
  WorkspacePreviewEditOperation,
  WorkspacePreviewExportTarget,
  WorkspacePreviewFileState,
  WorkspacePreviewPluginActionInput,
  WorkspacePreviewPluginManifest,
  WorkspacePreviewPrepareArtifactRequest,
  WorkspacePreviewReadArtifactRangeRequest,
  WorkspacePreviewSession,
  WorkspaceStructuredSelection
} from '@shared/workspace-preview'
import {
  rendererWorkspacePreviewRegistry,
  type RendererWorkspacePreviewPluginDescriptor,
  type RendererWorkspacePreviewRegistry,
  type RendererWorkspacePreviewResolveInput
} from './registry'

export type WorkspacePreviewBridgeAdapter = SciForgeApi['workspacePreview']

type WorkspacePreviewApplyEditSuccess = Extract<WorkspacePreviewApplyEditResult, { ok: true }>

export type WorkspacePreviewLastEditSummary = WorkspacePreviewEditDiffSummary

export type WorkspacePreviewAssetTransportClient = {
  descriptor: WorkspacePreviewAssetTransportDescriptor | null
  strategyStatus: (kind: WorkspacePreviewAssetTransportKind) =>
    WorkspacePreviewAssetTransportDescriptor['strategies'][number] | null
  readRange: (range: WorkspacePreviewByteRange) => Promise<WorkspacePreviewReadRangeResult>
  prepareArtifact: (request: WorkspacePreviewPrepareArtifactRequest) => Promise<WorkspacePreviewPrepareArtifactResult>
  readArtifactRange: (request: WorkspacePreviewReadArtifactRangeRequest) => Promise<WorkspacePreviewReadArtifactRangeResult>
  artifact: (artifactId: string) => WorkspacePreviewArtifactDescriptor | null
  readBytesIfWithin: (maxBytes: number) => Promise<
    | { ok: true; bytes: Uint8Array; bytesRead: number; truncated: false }
    | { ok: false; message: string }
  >
  readTextIfWithin: (maxBytes: number) => Promise<
    | { ok: true; text: string; bytesRead: number; truncated: false }
    | { ok: false; message: string }
  >
}

export type WorkspacePreviewHostState = {
  session: WorkspacePreviewSession | null
  descriptor: RendererWorkspacePreviewPluginDescriptor | null
  asset: WorkspacePreviewAssetTransportDescriptor | null
  observation: WorkspaceObservation | null
  file: WorkspacePreviewFileState | null
  lastEditSummary: WorkspacePreviewLastEditSummary | null
  error: string | null
}

export type WorkspacePreviewHostListener = (state: Readonly<WorkspacePreviewHostState>) => void

export type WorkspacePreviewHostOptions = {
  registry?: RendererWorkspacePreviewRegistry
  bridge?: WorkspacePreviewBridgeAdapter | null
  getBridge?: () => WorkspacePreviewBridgeAdapter | null | undefined
}

export type WorkspacePreviewSetSelectionOptions = {
  path?: string
  sessionId?: string
}

export function createWorkspacePreviewHostState(
  overrides: Partial<WorkspacePreviewHostState> = {}
): WorkspacePreviewHostState {
  return {
    session: null,
    descriptor: null,
    asset: null,
    observation: null,
    file: null,
    lastEditSummary: null,
    error: null,
    ...overrides
  }
}

function getWindowWorkspacePreviewBridge(): WorkspacePreviewBridgeAdapter | null {
  if (typeof window === 'undefined') return null
  return window.sciforge?.workspacePreview ?? null
}

function messageFromError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message
  if (typeof error === 'string' && error.trim()) return error
  return 'Workspace preview bridge request failed.'
}

function missingBridgeMessage(): string {
  return 'Workspace preview bridge is unavailable.'
}

function missingSessionMessage(): string {
  return 'No workspace preview session is active.'
}

export class WorkspacePreviewHost {
  private readonly registry: RendererWorkspacePreviewRegistry
  private readonly getBridge: () => WorkspacePreviewBridgeAdapter | null | undefined
  private readonly listeners = new Set<WorkspacePreviewHostListener>()
  private state: WorkspacePreviewHostState = createWorkspacePreviewHostState()

  constructor(options: WorkspacePreviewHostOptions = {}) {
    this.registry = options.registry ?? rendererWorkspacePreviewRegistry
    this.getBridge = Object.prototype.hasOwnProperty.call(options, 'bridge')
      ? () => options.bridge ?? null
      : options.getBridge ?? getWindowWorkspacePreviewBridge
  }

  getState(): Readonly<WorkspacePreviewHostState> {
    return this.state
  }

  subscribe(listener: WorkspacePreviewHostListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  listDescriptors(): readonly RendererWorkspacePreviewPluginDescriptor[] {
    return this.registry.list()
  }

  resolvePath(input: RendererWorkspacePreviewResolveInput): RendererWorkspacePreviewPluginDescriptor | null {
    return this.registry.resolve(input)
  }

  async listPlugins(): Promise<WorkspacePreviewPluginManifest[]> {
    const bridge = this.bridgeOrError()
    if (!bridge) return []

    try {
      const plugins = await bridge.listPlugins()
      this.patchState({ error: null })
      return plugins
    } catch (error) {
      this.patchState({ error: messageFromError(error) })
      return []
    }
  }

  async open(input: WorkspacePreviewOpenInput): Promise<WorkspacePreviewOpenResult> {
    const descriptor = this.resolvePath({
      path: input.path,
      mimeType: input.mimeType,
      includeFallback: true
    })
    if (!descriptor) {
      return this.failOpen(`No workspace preview plugin resolved for ${input.path}.`)
    }

    const bridge = this.bridgeOrError()
    if (!bridge) return this.failOpen(missingBridgeMessage())

    try {
      const result = await bridge.open(input)
      if (!result.ok) {
        this.patchState({ error: result.message })
        return result
      }

      this.patchState({
        session: result.session,
        descriptor: this.registry.get(result.manifest.id) ?? this.registry.get(result.session.pluginId) ?? descriptor,
        asset: null,
        observation: null,
        file: result.file,
        lastEditSummary: null,
        error: null
      })
      return result
    } catch (error) {
      return this.failOpen(messageFromError(error))
    }
  }

  async observe(sessionId?: string): Promise<WorkspacePreviewObserveResult> {
    const resolvedSessionId = this.resolveSessionId(sessionId)
    if (!resolvedSessionId) return this.failObserve(missingSessionMessage())

    const bridge = this.bridgeOrError()
    if (!bridge) return this.failObserve(missingBridgeMessage())

    try {
      const result = await bridge.observe(resolvedSessionId)
      if (!result.ok) {
        this.patchState({ error: result.message })
        return result
      }

      this.patchState({
        observation: result.observation,
        error: null
      })
      return result
    } catch (error) {
      return this.failObserve(messageFromError(error))
    }
  }

  async releaseSession(sessionId?: string): Promise<boolean> {
    const resolvedSessionId = this.resolveSessionId(sessionId)
    if (!resolvedSessionId) return false

    const bridge = this.bridgeOrError()
    if (!bridge) return false

    try {
      const released = await bridge.releaseSession(resolvedSessionId)
      if (released && this.state.session?.id === resolvedSessionId) {
        this.patchState(createWorkspacePreviewHostState())
      } else if (released) {
        this.patchState({ error: null })
      }
      return released
    } catch (error) {
      this.patchState({ error: messageFromError(error) })
      return false
    }
  }

  async describeAsset(sessionId?: string): Promise<WorkspacePreviewDescribeAssetResult> {
    const resolvedSessionId = this.resolveSessionId(sessionId)
    if (!resolvedSessionId) return this.failDescribeAsset(missingSessionMessage())

    const bridge = this.bridgeOrError()
    if (!bridge) return this.failDescribeAsset(missingBridgeMessage())

    try {
      const result = await bridge.describeAsset(resolvedSessionId)
      this.patchState({
        asset: result.ok ? result.descriptor : null,
        error: result.ok ? null : result.message
      })
      return result
    } catch (error) {
      return this.failDescribeAsset(messageFromError(error))
    }
  }

  async readRange(range: WorkspacePreviewByteRange): Promise<WorkspacePreviewReadRangeResult>
  async readRange(sessionId: string, range: WorkspacePreviewByteRange): Promise<WorkspacePreviewReadRangeResult>
  async readRange(
    sessionIdOrRange: string | WorkspacePreviewByteRange,
    range?: WorkspacePreviewByteRange
  ): Promise<WorkspacePreviewReadRangeResult> {
    const sessionId = typeof sessionIdOrRange === 'string' ? sessionIdOrRange : this.state.session?.id
    const resolvedRange = typeof sessionIdOrRange === 'string' ? range : sessionIdOrRange
    if (!sessionId || !resolvedRange) return this.failReadRange(missingSessionMessage())

    const bridge = this.bridgeOrError()
    if (!bridge) return this.failReadRange(missingBridgeMessage())

    try {
      const result = await bridge.readRange(sessionId, resolvedRange)
      this.patchState({ error: result.ok ? null : result.message })
      return result
    } catch (error) {
      return this.failReadRange(messageFromError(error))
    }
  }

  async prepareArtifact(
    request: WorkspacePreviewPrepareArtifactRequest,
    sessionId = this.state.session?.id
  ): Promise<WorkspacePreviewPrepareArtifactResult> {
    if (!sessionId) return this.failPrepareArtifact(missingSessionMessage())

    const bridge = this.bridgeOrError()
    if (!bridge) return this.failPrepareArtifact(missingBridgeMessage())

    try {
      const result = await bridge.prepareArtifact(sessionId, request)
      if (result.ok) {
        await this.describeAsset(sessionId)
      } else {
        this.patchState({ error: result.message })
      }
      return result
    } catch (error) {
      return this.failPrepareArtifact(messageFromError(error))
    }
  }

  async readArtifactRange(
    request: WorkspacePreviewReadArtifactRangeRequest,
    sessionId = this.state.session?.id
  ): Promise<WorkspacePreviewReadArtifactRangeResult> {
    if (!sessionId) return this.failReadArtifactRange(missingSessionMessage())

    const bridge = this.bridgeOrError()
    if (!bridge) return this.failReadArtifactRange(missingBridgeMessage())

    try {
      const result = await bridge.readArtifactRange(sessionId, request)
      this.patchState({ error: result.ok ? null : result.message })
      return result
    } catch (error) {
      return this.failReadArtifactRange(messageFromError(error))
    }
  }

  async setSelection(
    selection: WorkspaceStructuredSelection,
    options: WorkspacePreviewSetSelectionOptions = {}
  ): Promise<WorkspacePreviewApplyEditResult> {
    const path = options.path ?? this.state.session?.path
    const sessionId = options.sessionId ?? this.state.session?.id
    if (!path || !sessionId) return this.failApplyEdit(missingSessionMessage())

    return this.applyEdit(sessionId, {
      kind: 'workspace.setSelection',
      path,
      selection
    })
  }

  async applyEdit(operation: WorkspacePreviewEditOperation): Promise<WorkspacePreviewApplyEditResult>
  async applyEdit(
    sessionId: string,
    operation: WorkspacePreviewEditOperation
  ): Promise<WorkspacePreviewApplyEditResult>
  async applyEdit(
    sessionIdOrOperation: string | WorkspacePreviewEditOperation,
    operation?: WorkspacePreviewEditOperation
  ): Promise<WorkspacePreviewApplyEditResult> {
    const sessionId = typeof sessionIdOrOperation === 'string' ? sessionIdOrOperation : this.state.session?.id
    const resolvedOperation = typeof sessionIdOrOperation === 'string' ? operation : sessionIdOrOperation
    if (!sessionId || !resolvedOperation) return this.failApplyEdit(missingSessionMessage())

    const bridge = this.bridgeOrError()
    if (!bridge) return this.failApplyEdit(missingBridgeMessage())

    try {
      const result = await bridge.applyEdit(sessionId, resolvedOperation)
      if (!result.ok) {
        this.patchState({ error: result.message })
        return result
      }

      this.patchState({
        session: result.session,
        descriptor: this.registry.get(result.session.pluginId) ?? this.state.descriptor,
        asset: this.state.asset?.sessionId === result.session.id ? this.state.asset : null,
        observation: observationWithSessionSelection(this.state.observation, result.session),
        lastEditSummary: diffSummaryFromApplyEditResult(result),
        error: null
      })
      return result
    } catch (error) {
      return this.failApplyEdit(messageFromError(error))
    }
  }

  async export(target: WorkspacePreviewExportTarget): Promise<WorkspacePreviewExportResult>
  async export(sessionId: string, target: WorkspacePreviewExportTarget): Promise<WorkspacePreviewExportResult>
  async export(
    sessionIdOrTarget: string | WorkspacePreviewExportTarget,
    target?: WorkspacePreviewExportTarget
  ): Promise<WorkspacePreviewExportResult> {
    const sessionId = typeof sessionIdOrTarget === 'string' ? sessionIdOrTarget : this.state.session?.id
    const resolvedTarget = typeof sessionIdOrTarget === 'string' ? target : sessionIdOrTarget
    if (!sessionId || !resolvedTarget) return this.failExport(missingSessionMessage())

    const bridge = this.bridgeOrError()
    if (!bridge) return this.failExport(missingBridgeMessage())

    try {
      const result = await bridge.export(sessionId, resolvedTarget)
      this.patchState({ error: result.ok ? null : result.message })
      return result
    } catch (error) {
      return this.failExport(messageFromError(error))
    }
  }

  async invokeAction(action: WorkspacePreviewPluginActionInput): Promise<WorkspacePreviewInvokeActionResult>
  async invokeAction(
    sessionId: string,
    action: WorkspacePreviewPluginActionInput
  ): Promise<WorkspacePreviewInvokeActionResult>
  async invokeAction(
    sessionIdOrAction: string | WorkspacePreviewPluginActionInput,
    action?: WorkspacePreviewPluginActionInput
  ): Promise<WorkspacePreviewInvokeActionResult> {
    const sessionId = typeof sessionIdOrAction === 'string' ? sessionIdOrAction : this.state.session?.id
    const resolvedAction = typeof sessionIdOrAction === 'string' ? action : sessionIdOrAction
    if (!sessionId || !resolvedAction) return this.failInvokeAction(missingSessionMessage())

    const bridge = this.bridgeOrError()
    if (!bridge) return this.failInvokeAction(missingBridgeMessage())

    try {
      const result = await bridge.invokeAction(sessionId, resolvedAction)
      this.patchState({ error: result.ok ? null : result.message })
      return result
    } catch (error) {
      return this.failInvokeAction(messageFromError(error))
    }
  }

  async watch(payload: WorkspaceFileWatchPayload): Promise<WorkspaceFileWatchResult> {
    const bridge = this.bridgeOrError()
    if (!bridge) return this.failWatch(missingBridgeMessage())

    try {
      const result = await bridge.watch(payload)
      this.patchState({ error: result.ok ? null : result.message })
      return result
    } catch (error) {
      return this.failWatch(messageFromError(error))
    }
  }

  async unwatch(watchId: string): Promise<boolean> {
    const bridge = this.bridgeOrError()
    if (!bridge) return false

    try {
      const result = await bridge.unwatch(watchId)
      this.patchState({ error: result ? null : `Workspace preview watch ${watchId} was not active.` })
      return result
    } catch (error) {
      this.patchState({ error: messageFromError(error) })
      return false
    }
  }

  onChanged(handler: (payload: WorkspaceFileChangePayload) => void): () => void {
    const bridge = this.bridgeOrError()
    if (!bridge) return () => undefined
    return bridge.onChanged(handler)
  }

  private bridgeOrError(): WorkspacePreviewBridgeAdapter | null {
    const bridge = this.getBridge()
    if (!bridge) this.patchState({ error: missingBridgeMessage() })
    return bridge ?? null
  }

  private resolveSessionId(sessionId?: string): string | null {
    return sessionId ?? this.state.session?.id ?? null
  }

  private patchState(patch: Partial<WorkspacePreviewHostState>): void {
    this.state = {
      ...this.state,
      ...patch
    }
    for (const listener of this.listeners) listener(this.state)
  }

  private failOpen(message: string): WorkspacePreviewOpenResult {
    this.patchState({ error: message })
    return { ok: false, message }
  }

  private failObserve(message: string): WorkspacePreviewObserveResult {
    this.patchState({ error: message })
    return { ok: false, message }
  }

  private failDescribeAsset(message: string): WorkspacePreviewDescribeAssetResult {
    this.patchState({ error: message })
    return { ok: false, message }
  }

  private failReadRange(message: string): WorkspacePreviewReadRangeResult {
    this.patchState({ error: message })
    return { ok: false, message }
  }

  private failPrepareArtifact(message: string): WorkspacePreviewPrepareArtifactResult {
    this.patchState({ error: message })
    return { ok: false, message }
  }

  private failReadArtifactRange(message: string): WorkspacePreviewReadArtifactRangeResult {
    this.patchState({ error: message })
    return { ok: false, message }
  }

  private failApplyEdit(message: string): WorkspacePreviewApplyEditResult {
    this.patchState({ error: message })
    return { ok: false, message }
  }

  private failExport(message: string): WorkspacePreviewExportResult {
    this.patchState({ error: message })
    return { ok: false, message }
  }

  private failInvokeAction(message: string): WorkspacePreviewInvokeActionResult {
    this.patchState({ error: message })
    return { ok: false, message }
  }

  private failWatch(message: string): WorkspaceFileWatchResult {
    this.patchState({ error: message })
    return { ok: false, message }
  }
}

export function createWorkspacePreviewHost(options: WorkspacePreviewHostOptions = {}): WorkspacePreviewHost {
  return new WorkspacePreviewHost(options)
}

export function createWorkspacePreviewAssetTransportClient(input: {
  descriptor: WorkspacePreviewAssetTransportDescriptor | null
  readRange: (range: WorkspacePreviewByteRange) => Promise<WorkspacePreviewReadRangeResult>
  prepareArtifact?: (request: WorkspacePreviewPrepareArtifactRequest) => Promise<WorkspacePreviewPrepareArtifactResult>
  readArtifactRange?: (request: WorkspacePreviewReadArtifactRangeRequest) => Promise<WorkspacePreviewReadArtifactRangeResult>
}): WorkspacePreviewAssetTransportClient {
  const readBytesIfWithin: WorkspacePreviewAssetTransportClient['readBytesIfWithin'] = async (maxBytes) => {
    const descriptor = input.descriptor
    if (!descriptor) return { ok: false, message: 'No workspace preview asset descriptor is available.' }
    if (!descriptor.range.available) return { ok: false, message: 'Byte-range transport is not available for this asset.' }
    if (descriptor.range.size > maxBytes) {
      return {
        ok: false,
        message: `Asset is ${descriptor.range.size} bytes, which exceeds the ${maxBytes} byte text read limit.`
      }
    }
    if (descriptor.range.size > descriptor.range.maxChunkBytes) {
      return {
        ok: false,
        message: `Asset is ${descriptor.range.size} bytes, which exceeds the ${descriptor.range.maxChunkBytes} byte range chunk limit.`
      }
    }
    if (descriptor.range.size === 0) {
      return {
        ok: true,
        bytes: new Uint8Array(),
        bytesRead: 0,
        truncated: false
      }
    }

    const result = await input.readRange({
      offset: 0,
      length: descriptor.range.size
    })
    if (!result.ok) return result

    return {
      ok: true,
      bytes: decodeBase64Bytes(result.dataBase64),
      bytesRead: result.length,
      truncated: false
    }
  }

  return {
    descriptor: input.descriptor,
    strategyStatus(kind) {
      return input.descriptor?.strategies.find((strategy) => strategy.kind === kind) ?? null
    },
    readRange(range) {
      return input.readRange(range)
    },
    async prepareArtifact(request) {
      if (!input.prepareArtifact) return { ok: false, message: 'Workspace preview artifact preparation is unavailable.' }
      return input.prepareArtifact(request)
    },
    async readArtifactRange(request) {
      if (!input.readArtifactRange) return { ok: false, message: 'Workspace preview artifact range transport is unavailable.' }
      return input.readArtifactRange(request)
    },
    artifact(artifactId) {
      return input.descriptor?.artifacts?.find((artifact) => artifact.artifactId === artifactId) ?? null
    },
    readBytesIfWithin,
    async readTextIfWithin(maxBytes) {
      const result = await readBytesIfWithin(maxBytes)
      if (!result.ok) return result
      return {
        ok: true,
        text: new TextDecoder().decode(result.bytes),
        bytesRead: result.bytesRead,
        truncated: false
      }
    }
  }
}

function diffSummaryFromApplyEditResult(
  result: WorkspacePreviewApplyEditSuccess
): WorkspacePreviewLastEditSummary | null {
  return (
    result as WorkspacePreviewApplyEditSuccess & {
      diffSummary?: WorkspacePreviewLastEditSummary
    }
  ).diffSummary ?? null
}

function observationWithSessionSelection(
  observation: WorkspaceObservation | null,
  session: WorkspacePreviewSession
): WorkspaceObservation | null {
  if (!observation || !session.selection) return observation
  return {
    ...observation,
    selection: session.selection
  }
}

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
