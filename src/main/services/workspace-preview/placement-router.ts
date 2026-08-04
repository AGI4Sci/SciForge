import { isAbsolute, normalize, relative } from 'node:path/posix'
import { z } from 'zod'

import {
  WORKSPACE_HOST_OPERATIONS,
  workspaceHostPayloadSchema,
  workspaceHostPreviewInvokeInputSchema,
  workspaceLocatorSchema,
  type WorkspaceHostPayload,
  type WorkspaceLocator
} from '@sciforge/domain-sdk/workspace-host'
import {
  TEXT_WORKSPACE_PREVIEW_PLUGIN_ID,
  resolveWorkspacePreviewInitialSelection,
  resolveWorkspacePreviewPlugin,
  workspaceObservationSchema,
  workspacePreviewArtifactDescriptorSchema,
  workspacePreviewAssetTransportDescriptorSchema,
  workspacePreviewByteRangeSchema,
  workspacePreviewEditDiffSummarySchema,
  workspacePreviewEditOperationSchema,
  workspacePreviewExportTargetSchema,
  workspacePreviewFileStateSchema,
  workspacePreviewIntegrityVerificationSchema,
  workspacePreviewPluginActionInputSchema,
  workspacePreviewPluginActionResultSchema,
  workspacePreviewPluginManifestSchema,
  workspacePreviewPrepareArtifactRequestSchema,
  workspacePreviewReadArtifactRangeRequestSchema,
  workspacePreviewSessionSchema,
  type WorkspacePreviewByteRange,
  type WorkspacePreviewEditOperation,
  type WorkspacePreviewExportTarget,
  type WorkspacePreviewPluginActionInput,
  type WorkspacePreviewPrepareArtifactRequest,
  type WorkspacePreviewReadArtifactRangeRequest,
  type WorkspacePreviewSession
} from '../../../shared/workspace-preview'
import type {
  WorkspacePreviewAnnotationDeleteInput,
  WorkspacePreviewAnnotationResolveInput,
  WorkspacePreviewAnnotationSidecarImportActionInput,
  WorkspacePreviewAnnotationUpdateInput
} from '@sciforge/domain-sdk/workspace-preview'
import type {
  WorkspacePreviewAnnotationImportResult,
  WorkspacePreviewAnnotationListResult,
  WorkspacePreviewAnnotationReviewGenerateResult,
  WorkspacePreviewAnnotationReviewImproveResult
} from '../../../shared/sciforge-api'
import type {
  PdfReviewGenerateActionInput,
  PdfReviewImproveAnnotationActionInput
} from '../../../shared/pdf-review'
import type { WorkspaceFileWatchPayload } from '../../../shared/workspace-file'
import type { WorkspaceHostSessionPort } from '../../workspace-host/session-manager'
import {
  WorkspacePreviewHost,
  type WorkspacePreviewApplyEditResult,
  type WorkspacePreviewDescribeAssetResult,
  type WorkspacePreviewExportResult,
  type WorkspacePreviewHostOptions,
  type WorkspacePreviewInvokeActionResult,
  type WorkspacePreviewOpenInput,
  type WorkspacePreviewOpenResult,
  type WorkspacePreviewObserveResult,
  type WorkspacePreviewPrepareArtifactResult,
  type WorkspacePreviewReadArtifactRangeResult,
  type WorkspacePreviewReadRangeResult,
  type WorkspacePreviewWatchSnapshotResult,
  type WorkspacePreviewWatchStartResult
} from './host'
import type { WorkspacePreviewRenderVisualInput } from './provider-registry'
import type { VisualFrame } from '@sciforge/domain-sdk/visual-source'

const failureSchema = z.object({
  ok: z.literal(false),
  message: z.string().trim().min(1).max(2_000)
}).strict()

const openFailureSchema = z.object({
  ok: z.literal(false),
  message: z.string().trim().min(1).max(2_000),
  integrity: z.object({
    algorithm: z.literal('sha256'),
    expectedDigest: z.string().trim().min(1).max(128),
    actualDigest: z.string().trim().min(1).max(128),
    verified: z.literal(false)
  }).strict().optional()
}).strict()

const openResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    session: workspacePreviewSessionSchema,
    manifest: workspacePreviewPluginManifestSchema,
    route: z.enum(['matched', 'fallback']),
    file: workspacePreviewFileStateSchema,
    integrity: workspacePreviewIntegrityVerificationSchema.optional(),
    sourceRevision: z.string().trim().min(1).max(512)
  }).strict(),
  openFailureSchema
])

const observeResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    observation: workspaceObservationSchema
  }).strict(),
  failureSchema
])

const describeAssetResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    descriptor: workspacePreviewAssetTransportDescriptorSchema,
    sourceRevision: z.string().trim().min(1).max(512)
  }).strict(),
  failureSchema
])

const readRangeResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    sessionId: z.string().trim().min(1).max(256),
    assetId: z.string().trim().min(1).max(256),
    offset: z.number().int().nonnegative(),
    length: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    dataBase64: z.string(),
    mimeType: z.string().trim().min(1).max(128).optional()
  }).strict(),
  failureSchema
])

const prepareArtifactResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    sessionId: z.string().trim().min(1).max(256),
    artifact: workspacePreviewArtifactDescriptorSchema
  }).strict(),
  failureSchema
])

const readArtifactRangeResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    sessionId: z.string().trim().min(1).max(256),
    assetId: z.string().trim().min(1).max(256),
    artifactId: z.string().trim().min(1).max(256),
    offset: z.number().int().nonnegative(),
    length: z.number().int().nonnegative(),
    size: z.number().int().nonnegative(),
    mimeType: z.string().trim().min(1).max(128),
    dataBase64: z.string()
  }).strict(),
  failureSchema
])

const applyEditResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    session: workspacePreviewSessionSchema,
    operationKind: z.string().trim().min(1).max(128),
    appliedAt: z.string().trim().min(1).max(128),
    audit: z.object({
      pluginId: z.string().trim().min(1).max(128),
      path: z.string().trim().min(1).max(4_096),
      operationKind: z.string().trim().min(1).max(128),
      effect: z.enum(['file-write', 'session-update', 'sidecar-write'])
    }).strict(),
    diffSummary: workspacePreviewEditDiffSummarySchema.optional()
  }).strict(),
  failureSchema
])

const applyEditInvocationResultSchema = z.object({
  result: applyEditResultSchema.nullable(),
  sourceRevision: z.string().trim().min(1).max(512)
}).strict()

const exportResultSchema = z.union([
  z.object({
    ok: z.literal(true),
    sessionId: z.string().trim().min(1).max(256),
    path: z.string().trim().min(1).max(4_096),
    target: workspacePreviewExportTargetSchema,
    exportedAt: z.string().trim().min(1).max(128),
    audit: z.object({
      pluginId: z.string().trim().min(1).max(128),
      sourcePath: z.string().trim().min(1).max(4_096),
      targetKind: z.enum(['download', 'workspace-file', 'clipboard', 'attachment']),
      format: z.string().trim().min(1).max(64),
      effect: z.enum(['source-copy', 'sidecar-package', 'annotated-pdf'])
    }).strict()
  }).strict(),
  failureSchema
])

const invokeActionResultSchema = z.union([
  workspacePreviewPluginActionResultSchema,
  failureSchema
])

const releaseResultSchema = z.object({
  released: z.boolean()
}).strict()

export type PlacedWorkspacePreviewOpenInput = WorkspacePreviewOpenInput & Readonly<{
  workspaceLocator?: WorkspaceLocator
}>

export type WorkspacePreviewPlacementRouterOptions = Readonly<{
  local?: WorkspacePreviewHost
  localOptions?: WorkspacePreviewHostOptions
  resolveWorkspaceHostSessionPort(
    locator: WorkspaceLocator
  ): WorkspaceHostSessionPort | Promise<WorkspaceHostSessionPort>
}>

type RemotePreviewSession = Readonly<{
  locator: WorkspaceLocator
  port: WorkspaceHostSessionPort
  session: WorkspacePreviewSession
  pluginId: string
  sourceRevision: string
}>

/**
 * The only placement boundary for Workspace Preview.
 *
 * Session placement is fixed at open time. Once a session is remote, every
 * supported asset/provider operation is sent to the same Workspace Host port;
 * errors never fall back to the desktop provider registry.
 */
export class WorkspacePreviewPlacementRouter {
  readonly #local: WorkspacePreviewHost
  readonly #resolveWorkspaceHostSessionPort:
    WorkspacePreviewPlacementRouterOptions['resolveWorkspaceHostSessionPort']
  readonly #remoteSessions = new Map<string, RemotePreviewSession>()

  constructor(options: WorkspacePreviewPlacementRouterOptions) {
    if (options.local && options.localOptions) {
      throw new Error('Provide either a local Workspace Preview host or local host options, not both.')
    }
    this.#local = options.local ?? new WorkspacePreviewHost(options.localOptions)
    this.#resolveWorkspaceHostSessionPort = options.resolveWorkspaceHostSessionPort
  }

  listPlugins() {
    return this.#local.listPlugins()
  }

  getSession(sessionId: string): WorkspacePreviewSession | null {
    return this.#remoteSessions.get(sessionId)?.session ?? this.#local.getSession(sessionId)
  }

  async open(input: PlacedWorkspacePreviewOpenInput): Promise<WorkspacePreviewOpenResult> {
    if (!input.workspaceLocator) return this.#local.open(input)

    try {
      const locator = workspaceLocatorSchema.parse(input.workspaceLocator)
      const port = await this.#resolveWorkspaceHostSessionPort(locator)
      requirePreviewCapability(port)
      const manifest = resolveRemoteManifest(this.#local, input.path, input.mimeType)
      if (!manifest) {
        return { ok: false, message: `No workspace preview plugin is available for ${input.path}.` }
      }
      const relativePath = remoteRelativePath(input.path, input.workspaceRoot, locator)
      const selection = resolveWorkspacePreviewInitialSelection(input)
      const result = openResultSchema.parse(await invokePreview(port, manifest.id, 'open', {
        relativePath,
        ...(input.mimeType ? { mimeType: input.mimeType } : {}),
        ...(input.mode ? { mode: input.mode } : {}),
        ...(selection ? { selection } : {}),
        ...(input.integrity ? { integrity: input.integrity } : {})
      }))
      if (!result.ok) return { ok: false, message: result.message }
      if (result.session.pluginId !== manifest.id || result.manifest.id !== manifest.id) {
        return {
          ok: false,
          message: 'Remote Workspace Preview opened with a different plugin than the selected package cohort.'
        }
      }
      if (this.#remoteSessions.has(result.session.id) || this.#local.getSession(result.session.id)) {
        return { ok: false, message: 'Remote Workspace Preview returned a duplicate session ID.' }
      }
      this.#remoteSessions.set(result.session.id, {
        locator,
        port,
        session: result.session,
        pluginId: manifest.id,
        sourceRevision: result.sourceRevision
      })
      const { sourceRevision: _sourceRevision, ...publicResult } = result
      return publicResult
    } catch (error) {
      return placementFailure(error)
    }
  }

  async observe(sessionId: string): Promise<WorkspacePreviewObserveResult> {
    const remote = this.#remoteSessions.get(sessionId)
    if (!remote) return this.#local.observe(sessionId)
    return this.#invoke(remote, 'observe', { sessionId }, observeResultSchema)
  }

  async describeAsset(sessionId: string): Promise<WorkspacePreviewDescribeAssetResult> {
    const remote = this.#remoteSessions.get(sessionId)
    if (!remote) return this.#local.describeAsset(sessionId)
    const result = await this.#invoke(
      remote,
      'describeAsset',
      { sessionId },
      describeAssetResultSchema
    )
    if (!result.ok) return result
    this.#remoteSessions.set(sessionId, {
      ...remote,
      sourceRevision: result.sourceRevision
    })
    return { ok: true, descriptor: result.descriptor }
  }

  async readRange(
    sessionId: string,
    range: WorkspacePreviewByteRange
  ): Promise<WorkspacePreviewReadRangeResult> {
    const remote = this.#remoteSessions.get(sessionId)
    if (!remote) return this.#local.readRange(sessionId, range)
    const parsed = workspacePreviewByteRangeSchema.parse(range)
    return this.#invoke(remote, 'readRange', { sessionId, range: parsed }, readRangeResultSchema)
  }

  async prepareArtifact(
    sessionId: string,
    request: WorkspacePreviewPrepareArtifactRequest,
    now?: string
  ): Promise<WorkspacePreviewPrepareArtifactResult> {
    const remote = this.#remoteSessions.get(sessionId)
    if (!remote) return this.#local.prepareArtifact(sessionId, request, now)
    const parsed = workspacePreviewPrepareArtifactRequestSchema.parse(request)
    return this.#invoke(
      remote,
      'prepareArtifact',
      { sessionId, request: parsed },
      prepareArtifactResultSchema
    )
  }

  async readArtifactRange(
    sessionId: string,
    request: WorkspacePreviewReadArtifactRangeRequest
  ): Promise<WorkspacePreviewReadArtifactRangeResult> {
    const remote = this.#remoteSessions.get(sessionId)
    if (!remote) return this.#local.readArtifactRange(sessionId, request)
    const parsed = workspacePreviewReadArtifactRangeRequestSchema.parse(request)
    return this.#invoke(
      remote,
      'readArtifactRange',
      { sessionId, request: parsed },
      readArtifactRangeResultSchema
    )
  }

  async applyEdit(
    sessionId: string,
    operation: WorkspacePreviewEditOperation,
    now?: string
  ): Promise<WorkspacePreviewApplyEditResult> {
    const remote = this.#remoteSessions.get(sessionId)
    if (!remote) return this.#local.applyEdit(sessionId, operation, now)
    const parsed = workspacePreviewEditOperationSchema.parse(operation)
    const invocation = await this.#invoke(
      remote,
      'applyEdit',
      {
        sessionId,
        expectedRevision: remote.sourceRevision,
        operation: parsed
      },
      applyEditInvocationResultSchema
    )
    const result = invocation.result ?? {
      ok: false as const,
      message: `Workspace preview edit operation ${parsed.kind} is not implemented for plugin ${remote.pluginId}.`
    }
    this.#replaceRemoteSession(
      remote,
      result.ok ? result.session : remote.session,
      invocation.sourceRevision
    )
    return result as WorkspacePreviewApplyEditResult
  }

  async exportPreview(
    sessionId: string,
    target: WorkspacePreviewExportTarget,
    now?: string
  ): Promise<WorkspacePreviewExportResult> {
    const remote = this.#remoteSessions.get(sessionId)
    if (!remote) return this.#local.exportPreview(sessionId, target, now)
    const parsed = workspacePreviewExportTargetSchema.parse(target)
    return this.#invoke(
      remote,
      'exportPreview',
      {
        sessionId,
        expectedRevision: remote.sourceRevision,
        target: parsed
      },
      exportResultSchema
    )
  }

  async invokeAction(
    sessionId: string,
    action: WorkspacePreviewPluginActionInput,
    now?: string
  ): Promise<WorkspacePreviewInvokeActionResult> {
    const remote = this.#remoteSessions.get(sessionId)
    if (!remote) return this.#local.invokeAction(sessionId, action, now)
    const parsed = workspacePreviewPluginActionInputSchema.parse(action)
    return this.#invoke(
      remote,
      'invokeAction',
      { sessionId, action: parsed, ...(now ? { now } : {}) },
      invokeActionResultSchema
    )
  }

  async releaseSession(sessionId: string): Promise<boolean> {
    const remote = this.#remoteSessions.get(sessionId)
    if (!remote) return this.#local.releaseSession(sessionId)
    try {
      const result = await this.#invoke(remote, 'release', { sessionId }, releaseResultSchema)
      if (result.released) this.#remoteSessions.delete(sessionId)
      return result.released
    } catch {
      return false
    }
  }

  async renderVisual(
    sessionId: string,
    input: WorkspacePreviewRenderVisualInput = {}
  ): Promise<VisualFrame> {
    if (this.#remoteSessions.has(sessionId)) {
      throw new Error(
        'Remote Workspace Preview visual frames are unavailable; use the local renderer with bounded observations and artifacts.'
      )
    }
    return this.#local.renderVisual(sessionId, input)
  }

  async prepareWatch(
    input: WorkspaceFileWatchPayload,
    now?: string
  ): Promise<WorkspacePreviewWatchStartResult> {
    return this.#local.prepareWatch(input, now)
  }

  async createWatchSnapshot(
    input: WorkspaceFileWatchPayload
  ): Promise<WorkspacePreviewWatchSnapshotResult> {
    return this.#local.createWatchSnapshot(input)
  }

  async listAnnotations(sessionId: string): Promise<WorkspacePreviewAnnotationListResult> {
    if (this.#remoteSessions.has(sessionId)) return unsupportedRemoteAnnotation()
    return this.#local.listAnnotations(sessionId)
  }

  async updateAnnotation(
    sessionId: string,
    input: WorkspacePreviewAnnotationUpdateInput,
    now?: string
  ): Promise<WorkspacePreviewApplyEditResult> {
    if (this.#remoteSessions.has(sessionId)) return unsupportedRemoteAnnotation()
    return this.#local.updateAnnotation(sessionId, input, now)
  }

  async resolveAnnotation(
    sessionId: string,
    input: WorkspacePreviewAnnotationResolveInput,
    now?: string
  ): Promise<WorkspacePreviewApplyEditResult> {
    if (this.#remoteSessions.has(sessionId)) return unsupportedRemoteAnnotation()
    return this.#local.resolveAnnotation(sessionId, input, now)
  }

  async deleteAnnotation(
    sessionId: string,
    input: WorkspacePreviewAnnotationDeleteInput,
    now?: string
  ): Promise<WorkspacePreviewApplyEditResult> {
    if (this.#remoteSessions.has(sessionId)) return unsupportedRemoteAnnotation()
    return this.#local.deleteAnnotation(sessionId, input, now)
  }

  async importAnnotations(
    sessionId: string,
    input: WorkspacePreviewAnnotationSidecarImportActionInput
  ): Promise<WorkspacePreviewAnnotationImportResult> {
    if (this.#remoteSessions.has(sessionId)) return unsupportedRemoteAnnotation()
    return this.#local.importAnnotations(sessionId, input)
  }

  async generateAnnotationReview(
    sessionId: string,
    input: PdfReviewGenerateActionInput
  ): Promise<WorkspacePreviewAnnotationReviewGenerateResult> {
    if (this.#remoteSessions.has(sessionId)) return unsupportedRemoteAnnotation()
    return this.#local.generateAnnotationReview(sessionId, input)
  }

  async improveAnnotationReview(
    sessionId: string,
    input: PdfReviewImproveAnnotationActionInput
  ): Promise<WorkspacePreviewAnnotationReviewImproveResult> {
    if (this.#remoteSessions.has(sessionId)) return unsupportedRemoteAnnotation()
    return this.#local.improveAnnotationReview(sessionId, input)
  }

  async #invoke<Output>(
    remote: RemotePreviewSession,
    method: string,
    input: unknown,
    schema: z.ZodType<Output>
  ): Promise<Output> {
    requirePreviewCapability(remote.port)
    return schema.parse(await invokePreview(remote.port, remote.pluginId, method, input))
  }

  #replaceRemoteSession(
    remote: RemotePreviewSession,
    session: WorkspacePreviewSession,
    sourceRevision: string
  ): void {
    if (session.id !== remote.session.id || session.pluginId !== remote.pluginId) {
      throw new Error('Remote Workspace Preview returned a session for a different preview.')
    }
    this.#remoteSessions.set(session.id, { ...remote, session, sourceRevision })
  }
}

async function invokePreview(
  port: WorkspaceHostSessionPort,
  pluginId: string,
  method: string,
  input: unknown
): Promise<WorkspaceHostPayload> {
  const payload = workspaceHostPreviewInvokeInputSchema.parse({
    pluginId,
    method,
    input: workspaceHostPayloadSchema.parse(input)
  })
  return port.request(WORKSPACE_HOST_OPERATIONS.previewInvoke, payload)
}

function requirePreviewCapability(port: WorkspaceHostSessionPort): void {
  const available = port.getSession().capabilities.some(
    (capability) => capability.operation === WORKSPACE_HOST_OPERATIONS.previewInvoke
  )
  if (!available) {
    throw new Error('The selected Workspace Host does not provide scientific preview operations.')
  }
}

function resolveRemoteManifest(
  local: WorkspacePreviewHost,
  path: string,
  mimeType?: string
) {
  const manifests = local.listPlugins()
  return resolveWorkspacePreviewPlugin({ path, mimeType, manifests })
    ?? manifests.find((manifest) => manifest.id === TEXT_WORKSPACE_PREVIEW_PLUGIN_ID)
}

function remoteRelativePath(
  path: string,
  workspaceRoot: string,
  locator: WorkspaceLocator
): string {
  if ([path, workspaceRoot, locator.path].some((value) =>
    value.includes('\\') || value.includes('\0')
  )) {
    throw new Error('Remote preview paths must use Linux path syntax.')
  }
  const selectedRoot = normalize(locator.path)
  const requestedRoot = normalize(workspaceRoot)
  if (selectedRoot !== requestedRoot) {
    throw new Error('Remote preview workspaceRoot must match the selected Workspace Host locator.')
  }
  const candidate = isAbsolute(path) ? relative(selectedRoot, normalize(path)) : normalize(path)
  if (
    !candidate ||
    candidate === '..' ||
    candidate.startsWith('../') ||
    isAbsolute(candidate)
  ) {
    throw new Error('Remote preview path must identify a file inside the selected workspace.')
  }
  return candidate
}

function placementFailure(error: unknown): { ok: false; message: string } {
  return {
    ok: false,
    message: error instanceof Error ? error.message : String(error)
  }
}

function unsupportedRemoteAnnotation(): { ok: false; message: string } {
  return {
    ok: false,
    message: 'The selected remote Workspace Preview provider does not expose document annotation operations.'
  }
}
