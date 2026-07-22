import type {
  SciForgeApi,
  CapabilityResourceBinding,
  WorkspacePreviewAnnotationImportResult,
  WorkspacePreviewAnnotationListResult,
  WorkspacePreviewAnnotationReviewGenerateResult,
  WorkspacePreviewAnnotationReviewImproveResult,
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
  WorkspacePreviewArtifactDescriptor,
  WorkspacePreviewAnnotationDeleteInput,
  WorkspacePreviewAnnotationResolveInput,
  WorkspacePreviewAnnotationSidecarImportActionInput,
  WorkspacePreviewAnnotationUpdateInput,
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
import type {
  PdfReviewGenerateActionInput,
  PdfReviewImproveAnnotationActionInput
} from '@shared/pdf-review'
import {
  type RendererWorkspacePreviewPluginDescriptor,
  type RendererWorkspacePreviewRegistry,
  type RendererWorkspacePreviewResolveInput
} from './registry'
import {
  createWorkspacePreviewCapabilityAdapter,
  type WorkspacePreviewCapabilityAdapter
} from './capability-adapter'

export type WorkspacePreviewBridgeAdapter = WorkspacePreviewCapabilityAdapter

type WorkspacePreviewApplyEditSuccess = Extract<WorkspacePreviewApplyEditResult, { ok: true }>

export type WorkspacePreviewLastEditSummary = WorkspacePreviewEditDiffSummary

export type WorkspacePreviewAssetTransportClient = {
  descriptor: WorkspacePreviewAssetTransportDescriptor | null
  sourceUrl?: string | null
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
  capability: CapabilityResourceBinding | null
  descriptor: RendererWorkspacePreviewPluginDescriptor | null
  asset: WorkspacePreviewAssetTransportDescriptor | null
  observation: WorkspaceObservation | null
  file: WorkspacePreviewFileState | null
  lastEditSummary: WorkspacePreviewLastEditSummary | null
  error: string | null
}

export type WorkspacePreviewHostListener = (state: Readonly<WorkspacePreviewHostState>) => void

export type WorkspacePreviewHostOptions = {
  registry: RendererWorkspacePreviewRegistry
  bridge?: WorkspacePreviewBridgeAdapter | null
  getBridge?: () => WorkspacePreviewBridgeAdapter | null | undefined
  resourceContentUrl?: SciForgeApi['capabilities']['resourceContentUrl']
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
    capability: null,
    descriptor: null,
    asset: null,
    observation: null,
    file: null,
    lastEditSummary: null,
    error: null,
    ...overrides
  }
}

function getWindowCapabilityResourceContentUrl(
  access: Parameters<SciForgeApi['capabilities']['resourceContentUrl']>[0]
): string | null {
  if (typeof window === 'undefined') return null
  return window.sciforge?.capabilities.resourceContentUrl(access) ?? null
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
  private readonly resourceContentUrl: SciForgeApi['capabilities']['resourceContentUrl']
  private readonly listeners = new Set<WorkspacePreviewHostListener>()
  private state: WorkspacePreviewHostState = createWorkspacePreviewHostState()
  private openRequestSequence = 0

  constructor(options: WorkspacePreviewHostOptions) {
    this.registry = options.registry
    if (Object.prototype.hasOwnProperty.call(options, 'bridge')) {
      this.getBridge = () => options.bridge ?? null
    } else if (options.getBridge) {
      this.getBridge = options.getBridge
    } else {
      const adapter = createWorkspacePreviewCapabilityAdapter()
      this.getBridge = () => adapter
    }
    this.resourceContentUrl = options.resourceContentUrl ?? getWindowCapabilityResourceContentUrl
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
      const message = messageFromError(error)
      this.patchState({ error: message })
      throw new Error(message)
    }
  }

  async open(input: WorkspacePreviewOpenInput): Promise<WorkspacePreviewOpenResult> {
    const requestSequence = ++this.openRequestSequence
    const bridge = this.bridgeOrError()
    if (!bridge) return this.failOpen(missingBridgeMessage())

    try {
      const result = await bridge.open(input)
      if (requestSequence !== this.openRequestSequence) {
        if (result.ok) {
          await bridge.releaseSession(result.session.id).catch(() => false)
        }
        return {
          ok: false,
          message: 'Workspace preview request was superseded.'
        }
      }
      if (!result.ok) {
        this.patchState({ error: result.message })
        return result
      }

      this.patchState({
        session: result.session,
        capability: result.capability ?? null,
        descriptor: this.registry.get(result.manifest.id) ?? this.registry.get(result.session.pluginId),
        asset: null,
        observation: null,
        file: result.file,
        lastEditSummary: null,
        error: null
      })
      return result
    } catch (error) {
      if (requestSequence !== this.openRequestSequence) {
        return {
          ok: false,
          message: 'Workspace preview request was superseded.'
        }
      }
      return this.failOpen(messageFromError(error))
    }
  }

  cancelPendingOpen(): void {
    this.openRequestSequence += 1
  }

  async observe(sessionId?: string): Promise<WorkspacePreviewObserveResult> {
    const resolvedSessionId = this.resolveSessionId(sessionId)
    if (!resolvedSessionId) return this.failObserve(missingSessionMessage())

    const bridge = this.bridgeOrError()
    if (!bridge) return this.failObserve(missingBridgeMessage())

    try {
      const result = await bridge.observe(resolvedSessionId)
      if (this.state.session?.id !== resolvedSessionId) return result
      if (!result.ok) {
        this.patchState({ error: result.message })
        return result
      }

      this.patchState({
        observation: result.observation,
        capability: result.capability ?? this.state.capability,
        error: null
      })
      return result
    } catch (error) {
      if (this.state.session?.id !== resolvedSessionId) {
        return { ok: false, message: 'Workspace preview session was superseded.' }
      }
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
      if (this.state.session?.id !== resolvedSessionId) return result
      this.patchState({
        asset: result.ok ? result.descriptor : null,
        error: result.ok ? null : result.message
      })
      return result
    } catch (error) {
      if (this.state.session?.id !== resolvedSessionId) {
        return { ok: false, message: 'Workspace preview session was superseded.' }
      }
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
      return this.acceptApplyEditResult(result)
    } catch (error) {
      return this.failApplyEdit(messageFromError(error))
    }
  }

  async listAnnotations(
    sessionId = this.state.session?.id
  ): Promise<WorkspacePreviewAnnotationListResult> {
    if (!sessionId) return { ok: false, message: missingSessionMessage() }
    const bridge = this.bridgeOrError()
    if (!bridge) return { ok: false, message: missingBridgeMessage() }
    try {
      const result = await bridge.listAnnotations(sessionId)
      this.patchState({ error: result.ok ? null : result.message })
      return result
    } catch (error) {
      const message = messageFromError(error)
      this.patchState({ error: message })
      return { ok: false, message }
    }
  }

  async updateAnnotation(input: WorkspacePreviewAnnotationUpdateInput): Promise<WorkspacePreviewApplyEditResult> {
    const sessionId = this.state.session?.id
    if (!sessionId) return this.failApplyEdit(missingSessionMessage())
    const bridge = this.bridgeOrError()
    if (!bridge) return this.failApplyEdit(missingBridgeMessage())
    try {
      return this.acceptApplyEditResult(await bridge.updateAnnotation(sessionId, input))
    } catch (error) {
      return this.failApplyEdit(messageFromError(error))
    }
  }

  async resolveAnnotation(input: WorkspacePreviewAnnotationResolveInput): Promise<WorkspacePreviewApplyEditResult> {
    const sessionId = this.state.session?.id
    if (!sessionId) return this.failApplyEdit(missingSessionMessage())
    const bridge = this.bridgeOrError()
    if (!bridge) return this.failApplyEdit(missingBridgeMessage())
    try {
      return this.acceptApplyEditResult(await bridge.resolveAnnotation(sessionId, input))
    } catch (error) {
      return this.failApplyEdit(messageFromError(error))
    }
  }

  async deleteAnnotation(input: WorkspacePreviewAnnotationDeleteInput): Promise<WorkspacePreviewApplyEditResult> {
    const sessionId = this.state.session?.id
    if (!sessionId) return this.failApplyEdit(missingSessionMessage())
    const bridge = this.bridgeOrError()
    if (!bridge) return this.failApplyEdit(missingBridgeMessage())
    try {
      return this.acceptApplyEditResult(await bridge.deleteAnnotation(sessionId, input))
    } catch (error) {
      return this.failApplyEdit(messageFromError(error))
    }
  }

  async importAnnotations(
    input: WorkspacePreviewAnnotationSidecarImportActionInput,
    sessionId = this.state.session?.id
  ): Promise<WorkspacePreviewAnnotationImportResult> {
    if (!sessionId) return { ok: false, message: missingSessionMessage() }
    const bridge = this.bridgeOrError()
    if (!bridge) return { ok: false, message: missingBridgeMessage() }
    try {
      const result = await bridge.importAnnotations(sessionId, input)
      this.patchState({ error: result.ok ? null : result.message })
      return result
    } catch (error) {
      const message = messageFromError(error)
      this.patchState({ error: message })
      return { ok: false, message }
    }
  }

  async generateAnnotationReview(
    input: PdfReviewGenerateActionInput,
    sessionId = this.state.session?.id
  ): Promise<WorkspacePreviewAnnotationReviewGenerateResult> {
    if (!sessionId) return { ok: false, message: missingSessionMessage() }
    const bridge = this.bridgeOrError()
    if (!bridge) return { ok: false, message: missingBridgeMessage() }
    try {
      const result = await bridge.generateAnnotationReview(sessionId, input)
      this.patchState({ error: result.ok ? null : result.message })
      return result
    } catch (error) {
      const message = messageFromError(error)
      this.patchState({ error: message })
      return { ok: false, message }
    }
  }

  async improveAnnotationReview(
    input: PdfReviewImproveAnnotationActionInput,
    sessionId = this.state.session?.id
  ): Promise<WorkspacePreviewAnnotationReviewImproveResult> {
    if (!sessionId) return { ok: false, message: missingSessionMessage() }
    const bridge = this.bridgeOrError()
    if (!bridge) return { ok: false, message: missingBridgeMessage() }
    try {
      const result = await bridge.improveAnnotationReview(sessionId, input)
      this.patchState({ error: result.ok ? null : result.message })
      return result
    } catch (error) {
      const message = messageFromError(error)
      this.patchState({ error: message })
      return { ok: false, message }
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
      this.patchState({
        capability: result.ok ? result.capability ?? this.state.capability : this.state.capability,
        error: result.ok ? null : result.message
      })
      return result
    } catch (error) {
      return this.failInvokeAction(messageFromError(error))
    }
  }

  assetSourceUrl(sessionId?: string): string | null {
    const resolvedSessionId = this.resolveSessionId(sessionId)
    const session = this.state.session
    const capability = this.state.capability
    if (!resolvedSessionId || resolvedSessionId !== session?.id || !capability) return null
    return this.resourceContentUrl({
      workspaceId: session.workspaceRoot,
      resource: capability.resource
    })
  }

  private acceptApplyEditResult(result: WorkspacePreviewApplyEditResult): WorkspacePreviewApplyEditResult {
    if (!result.ok) {
      this.patchState({ error: result.message })
      return result
    }
    this.patchState({
      session: result.session,
      capability: result.capability ?? this.state.capability,
      descriptor: this.registry.get(result.session.pluginId) ?? this.state.descriptor,
      asset: this.state.asset?.sessionId === result.session.id ? this.state.asset : null,
      observation: observationWithSessionSelection(this.state.observation, result.session),
      lastEditSummary: diffSummaryFromApplyEditResult(result),
      error: null
    })
    return result
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
    if (statePatchIsNoop(this.state, patch)) return
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

}

export function createWorkspacePreviewHost(options: WorkspacePreviewHostOptions): WorkspacePreviewHost {
  return new WorkspacePreviewHost(options)
}

export function createWorkspacePreviewAssetTransportClient(input: {
  descriptor: WorkspacePreviewAssetTransportDescriptor | null
  sourceUrl?: string | null
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
        message: `Asset is ${descriptor.range.size} bytes, which exceeds the ${maxBytes} byte read limit.`
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

    const bytes = new Uint8Array(descriptor.range.size)
    const preferredChunkBytes = Math.min(
      descriptor.range.recommendedChunkBytes,
      descriptor.range.maxChunkBytes
    )
    const chunkLength = Math.max(1, Math.min(preferredChunkBytes, descriptor.range.size))
    let bytesRead = 0
    const ranges: WorkspacePreviewByteRange[] = []
    for (let offset = 0; offset < descriptor.range.size; offset += chunkLength) {
      const length = Math.min(chunkLength, descriptor.range.size - offset)
      ranges.push({ offset, length })
    }

    let nextRangeIndex = 0
    let readFailure: { ok: false; message: string } | null = null
    const parallelReads = Math.min(2, ranges.length)
    await Promise.all(Array.from({ length: parallelReads }, async () => {
      while (!readFailure) {
        const range = ranges[nextRangeIndex]
        nextRangeIndex += 1
        if (!range) return
        const result = await input.readRange(range)
        if (!result.ok) {
          readFailure = result
          return
        }
        const chunk = decodeBase64Bytes(result.dataBase64)
        bytes.set(chunk, range.offset)
        bytesRead += chunk.length
      }
    }))
    if (readFailure) return readFailure

    return {
      ok: true,
      bytes,
      bytesRead,
      truncated: false
    }
  }

  return {
    descriptor: input.descriptor,
    sourceUrl: input.sourceUrl ?? null,
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

function statePatchIsNoop(
  state: WorkspacePreviewHostState,
  patch: Partial<WorkspacePreviewHostState>
): boolean {
  const keys = Object.keys(patch) as Array<keyof WorkspacePreviewHostState>
  if (keys.length === 0) return true
  return keys.every((key) => state[key] === patch[key])
}

function decodeBase64Bytes(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}
