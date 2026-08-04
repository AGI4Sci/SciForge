import { createHash, randomUUID } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, open, realpath, stat } from 'node:fs/promises'
import { basename, isAbsolute, relative, resolve, sep } from 'node:path'

import {
  WORKSPACE_HOST_OPERATIONS,
  workspaceHostPayloadSchema,
  type WorkspaceHostPayload,
  type WorkspaceHostPreviewInvokeInput
} from '@sciforge/domain-sdk/workspace-host'
import {
  WORKSPACE_SERVER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
} from '@sciforge/domain-sdk/workspace-server'
import {
  WORKSPACE_PREVIEW_CONTRACT_VERSION,
  WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
  WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
  workspacePreviewArtifactDescriptorSchema,
  workspacePreviewAssetTransportDescriptorSchema,
  workspacePreviewByteRangeSchema,
  workspacePreviewEditOperationSchema,
  workspacePreviewExportTargetSchema,
  workspacePreviewFileStateSchema,
  workspacePreviewIntegrityExpectationSchema,
  workspacePreviewPluginActionInputSchema,
  workspacePreviewPrepareArtifactRequestSchema,
  workspacePreviewReadArtifactRangeRequestSchema,
  workspacePreviewSessionSchema,
  type WorkspacePreviewArtifactDescriptor,
  type WorkspacePreviewFileState,
  type WorkspacePreviewPluginManifest,
  type WorkspacePreviewProvider,
  type WorkspacePreviewSession
} from '@sciforge/domain-sdk/workspace-preview'

import {
  WorkspaceHostServiceError,
  type WorkspaceHostOperationRegistration
} from './service.js'

export type WorkspaceHostPreviewContribution = Readonly<{
  kind: string
  value: unknown
}>

type InstalledPreview = {
  manifest: WorkspacePreviewPluginManifest
  provider: WorkspacePreviewProvider
}

type PreviewArtifactRecord = {
  descriptor: WorkspacePreviewArtifactDescriptor
  bytes: Buffer
  sourceSize: number
  sourceMtimeMs: number
}

type PreviewSessionRecord = {
  installed: InstalledPreview
  session: WorkspacePreviewSession
  file: WorkspacePreviewFileState
  sourceRevision: string
  artifacts: Map<string, PreviewArtifactRecord>
}

const EXTERNAL_PREVIEW_METHODS = new Set([
  'open',
  'observe',
  'describeAsset',
  'readRange',
  'prepareArtifact',
  'readArtifactRange',
  'applyEdit',
  'exportPreview',
  'invokeAction',
  'release'
])

export function createWorkspaceHostPreviewOperation(
  contributions: readonly WorkspaceHostPreviewContribution[]
): WorkspaceHostOperationRegistration | undefined {
  const providers = installedPreviewProviders(contributions)
  if (providers.size === 0) return undefined
  const sessions = new Map<string, PreviewSessionRecord>()
  return {
    operation: WORKSPACE_HOST_OPERATIONS.previewInvoke,
    handler: async (payload, context) => {
      const request = payload as WorkspaceHostPreviewInvokeInput
      if (!EXTERNAL_PREVIEW_METHODS.has(request.method)) {
        throw previewError(
          'unsupported_operation',
          `Workspace Preview method ${request.method} is not allowed.`
        )
      }
      const installed = providers.get(request.pluginId)
      if (!installed) {
        throw previewError(
          'unsupported_operation',
          `Workspace Preview provider ${request.pluginId} is unavailable.`
        )
      }
      const input = requireRecord(request.input)
      switch (request.method) {
        case 'open':
          return openPreview(context.workspaceRoot, installed, input, sessions)
        case 'observe':
          return observePreview(installed, input, sessions)
        case 'describeAsset':
          return describePreviewAsset(installed, input, sessions)
        case 'readRange':
          return readPreviewRange(installed, input, sessions)
        case 'prepareArtifact':
          return preparePreviewArtifact(installed, input, sessions)
        case 'readArtifactRange':
          return readPreviewArtifactRange(installed, input, sessions)
        case 'applyEdit':
          return applyPreviewEdit(installed, input, sessions)
        case 'exportPreview':
          return exportPreview(installed, input, sessions)
        case 'invokeAction':
          return invokePreviewAction(installed, input, sessions)
        case 'release':
          return releasePreview(installed, input, sessions)
        default:
          throw previewError(
            'unsupported_operation',
            `Workspace Preview method ${request.method} is unsupported.`
          )
      }
    }
  }
}

async function openPreview(
  workspaceRoot: string,
  installed: InstalledPreview,
  input: Record<string, WorkspaceHostPayload>,
  sessions: Map<string, PreviewSessionRecord>
): Promise<WorkspaceHostPayload> {
  const canonicalRoot = await realpath(workspaceRoot)
  const relativePath = normalizeRelativePath(input.relativePath)
  const sourcePath = await realpath(resolve(canonicalRoot, relativePath))
  assertContained(canonicalRoot, sourcePath)
  const sourceStat = await stat(sourcePath)
  if (!sourceStat.isFile()) return { ok: false, message: 'Cannot preview a directory.' }
  const file = workspacePreviewFileStateSchema.parse({
    workspaceRoot: canonicalRoot,
    path: sourcePath,
    relativePath,
    ...(typeof input.mimeType === 'string' ? { mimeType: input.mimeType } : {}),
    size: sourceStat.size,
    mtimeMs: sourceStat.mtimeMs
  })
  const validation = installed.provider.validateFile
    ? await installed.provider.validateFile({ manifest: installed.manifest, file })
    : { ok: true as const }
  if (!validation.ok) return toWirePayload(validation)
  let integrity: WorkspaceHostPayload | undefined
  if (input.integrity !== undefined) {
    const expectation = workspacePreviewIntegrityExpectationSchema.parse(input.integrity)
    const hash = createHash('sha256')
    for await (const chunk of createReadStream(sourcePath)) hash.update(chunk)
    const actualDigest = `sha256:${hash.digest('hex')}`
    const verification = {
      ...expectation,
      actualDigest,
      verified: actualDigest === expectation.expectedDigest
    }
    integrity = verification
    if (!verification.verified) {
      return {
        ok: false,
        message: `Workspace Preview integrity mismatch: expected ${expectation.expectedDigest}, got ${actualDigest}.`
      }
    }
  }
  const now = new Date().toISOString()
  const session = workspacePreviewSessionSchema.parse({
    id: randomUUID(),
    pluginId: installed.manifest.id,
    workspaceRoot: canonicalRoot,
    path: sourcePath,
    modality: installed.manifest.modality,
    mode: input.mode ?? 'preview',
    openedAt: now,
    updatedAt: now,
    mtimeMs: sourceStat.mtimeMs,
    file,
    ...(input.selection !== undefined ? { selection: input.selection } : {})
  })
  const sourceRevision = previewSourceRevision(sourceStat)
  sessions.set(session.id, {
    installed,
    session,
    file,
    sourceRevision,
    artifacts: new Map()
  })
  return toWirePayload({
    ok: true,
    session,
    manifest: installed.manifest,
    route: 'matched',
    file,
    sourceRevision,
    ...(integrity ? { integrity } : {})
  })
}

async function observePreview(
  installed: InstalledPreview,
  input: Record<string, WorkspaceHostPayload>,
  sessions: Map<string, PreviewSessionRecord>
): Promise<WorkspaceHostPayload> {
  const record = requireSession(installed, input, sessions)
  if (!installed.provider.observe) {
    return { ok: false, message: 'Workspace Preview provider cannot observe this source.' }
  }
  await refreshSource(record)
  const result = await installed.provider.observe(providerBaseInput(record))
  return result.ok
    ? toWirePayload({ ok: true, observation: result.observation })
    : { ok: false, message: result.message }
}

async function describePreviewAsset(
  installed: InstalledPreview,
  input: Record<string, WorkspaceHostPayload>,
  sessions: Map<string, PreviewSessionRecord>
): Promise<WorkspaceHostPayload> {
  const record = requireSession(installed, input, sessions)
  const sourceStat = await refreshSource(record)
  pruneStaleArtifacts(record, sourceStat)
  const descriptor = workspacePreviewAssetTransportDescriptorSchema.parse({
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    sessionId: record.session.id,
    assetId: assetId(record.session.id),
    pluginId: installed.manifest.id,
    modality: installed.manifest.modality,
    file: {
      name: basename(record.file.path),
      relativePath: record.file.relativePath,
      ...(record.file.mimeType ? { mimeType: record.file.mimeType } : {}),
      size: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs
    },
    primary: 'byte-range',
    eagerRead: {
      allowed: false,
      reason: 'Remote scientific assets use bounded ranges and server-side providers.'
    },
    range: {
      available: true,
      maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
      recommendedChunkBytes: WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES,
      size: sourceStat.size
    },
    strategies: [{
      kind: 'byte-range',
      status: 'available',
      reason: 'Source bytes are read from the owning Workspace Host.',
      maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES
    }],
    artifacts: [...record.artifacts.values()].map((artifact) => artifact.descriptor)
  })
  return toWirePayload({
    ok: true,
    descriptor,
    sourceRevision: record.sourceRevision
  })
}

async function readPreviewRange(
  installed: InstalledPreview,
  input: Record<string, WorkspaceHostPayload>,
  sessions: Map<string, PreviewSessionRecord>
): Promise<WorkspaceHostPayload> {
  const record = requireSession(installed, input, sessions)
  const range = workspacePreviewByteRangeSchema.parse(input.range)
  const sourceStat = await refreshSource(record)
  const handle = await open(record.file.path, 'r')
  try {
    const length = Math.min(range.length, Math.max(0, sourceStat.size - range.offset))
    const buffer = Buffer.alloc(length)
    const { bytesRead } = await handle.read(buffer, 0, length, range.offset)
    return {
      ok: true,
      sessionId: record.session.id,
      assetId: assetId(record.session.id),
      offset: range.offset,
      length: bytesRead,
      size: sourceStat.size,
      dataBase64: buffer.subarray(0, bytesRead).toString('base64'),
      ...(record.file.mimeType ? { mimeType: record.file.mimeType } : {})
    }
  } finally {
    await handle.close()
  }
}

async function preparePreviewArtifact(
  installed: InstalledPreview,
  input: Record<string, WorkspaceHostPayload>,
  sessions: Map<string, PreviewSessionRecord>
): Promise<WorkspaceHostPayload> {
  const record = requireSession(installed, input, sessions)
  if (!installed.provider.prepareArtifact) {
    return { ok: false, message: 'Workspace Preview provider does not prepare artifacts.' }
  }
  const request = workspacePreviewPrepareArtifactRequestSchema.parse(input.request)
  const sourceStat = await refreshSource(record)
  const result = await installed.provider.prepareArtifact({
    ...providerBaseInput(record),
    request
  })
  if (!result.ok) return toWirePayload(result)
  const bytes = Buffer.from(result.bytes)
  const artifactId = randomUUID()
  const descriptor = workspacePreviewArtifactDescriptorSchema.parse({
    schemaVersion: WORKSPACE_PREVIEW_CONTRACT_VERSION,
    sessionId: record.session.id,
    assetId: assetId(record.session.id),
    artifactId,
    kind: result.kind,
    pluginId: installed.manifest.id,
    mimeType: result.mimeType,
    byteLength: bytes.byteLength,
    range: {
      available: true,
      size: bytes.byteLength,
      maxChunkBytes: WORKSPACE_PREVIEW_MAX_RANGE_BYTES,
      recommendedChunkBytes: WORKSPACE_PREVIEW_RECOMMENDED_RANGE_BYTES
    },
    source: {
      assetId: assetId(record.session.id),
      size: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs
    },
    cache: {
      scope: 'session',
      source: 'worker-decoder',
      createdAt: new Date().toISOString(),
      invalidation: 'source-size-mtime'
    },
    ...(result.kind === 'thumbnail' ? { thumbnail: result.thumbnail } : {}),
    ...(result.kind === 'tile' ? { tile: result.tile } : {})
  })
  record.artifacts.set(artifactId, {
    descriptor,
    bytes,
    sourceSize: sourceStat.size,
    sourceMtimeMs: sourceStat.mtimeMs
  })
  return toWirePayload({
    ok: true,
    sessionId: record.session.id,
    artifact: descriptor
  })
}

async function readPreviewArtifactRange(
  installed: InstalledPreview,
  input: Record<string, WorkspaceHostPayload>,
  sessions: Map<string, PreviewSessionRecord>
): Promise<WorkspaceHostPayload> {
  const record = requireSession(installed, input, sessions)
  const request = workspacePreviewReadArtifactRangeRequestSchema.parse(input.request)
  const sourceStat = await refreshSource(record)
  const artifact = record.artifacts.get(request.artifactId)
  if (!artifact) return { ok: false, message: 'Workspace Preview artifact was not found.' }
  if (
    artifact.sourceSize !== sourceStat.size
    || artifact.sourceMtimeMs !== sourceStat.mtimeMs
  ) {
    record.artifacts.delete(request.artifactId)
    return { ok: false, message: 'Workspace Preview artifact is stale.' }
  }
  const offset = Math.min(request.range.offset, artifact.bytes.byteLength)
  const chunk = artifact.bytes.subarray(
    offset,
    Math.min(artifact.bytes.byteLength, offset + request.range.length)
  )
  return {
    ok: true,
    sessionId: record.session.id,
    assetId: artifact.descriptor.assetId,
    artifactId: artifact.descriptor.artifactId,
    offset: request.range.offset,
    length: chunk.byteLength,
    size: artifact.bytes.byteLength,
    mimeType: artifact.descriptor.mimeType,
    dataBase64: chunk.toString('base64')
  }
}

async function applyPreviewEdit(
  installed: InstalledPreview,
  input: Record<string, WorkspaceHostPayload>,
  sessions: Map<string, PreviewSessionRecord>
): Promise<WorkspaceHostPayload> {
  const record = requireSession(installed, input, sessions)
  if (!installed.provider.applyEdit) {
    return {
      result: null,
      sourceRevision: record.sourceRevision
    }
  }
  await requireExpectedRevision(record, input.expectedRevision)
  const operation = workspacePreviewEditOperationSchema.parse(input.operation)
  const result = await installed.provider.applyEdit({
    ...providerBaseInput(record),
    operation: { ...operation, path: record.file.path },
    now: new Date().toISOString()
  })
  const sourceStat = await refreshSource(record, true)
  let normalizedResult = result
  if (result?.ok) {
    const nextSession = workspacePreviewSessionSchema.parse({
      ...result.session,
      file: record.file,
      mtimeMs: sourceStat.mtimeMs
    })
    if (
      nextSession.id !== record.session.id
      || nextSession.pluginId !== record.session.pluginId
      || nextSession.workspaceRoot !== record.session.workspaceRoot
      || nextSession.path !== record.session.path
    ) {
      throw previewError(
        'invalid_request',
        'Workspace Preview provider returned a session outside its owned source.'
      )
    }
    record.session = nextSession
    normalizedResult = { ...result, session: nextSession }
  }
  return toWirePayload({
    result: normalizedResult,
    sourceRevision: previewSourceRevision(sourceStat)
  })
}

async function exportPreview(
  installed: InstalledPreview,
  input: Record<string, WorkspaceHostPayload>,
  sessions: Map<string, PreviewSessionRecord>
): Promise<WorkspaceHostPayload> {
  const record = requireSession(installed, input, sessions)
  if (!installed.provider.exportPreview) {
    return { ok: false, message: 'Workspace Preview provider cannot export this source.' }
  }
  await requireExpectedRevision(record, input.expectedRevision)
  const target = workspacePreviewExportTargetSchema.parse(input.target)
  const normalizedTarget = await normalizeExportTarget(record.file.workspaceRoot, target)
  return toWirePayload(await installed.provider.exportPreview({
    ...providerBaseInput(record),
    target: normalizedTarget,
    now: new Date().toISOString()
  }))
}

async function invokePreviewAction(
  installed: InstalledPreview,
  input: Record<string, WorkspaceHostPayload>,
  sessions: Map<string, PreviewSessionRecord>
): Promise<WorkspaceHostPayload> {
  const record = requireSession(installed, input, sessions)
  if (!installed.provider.invokeAction) {
    return { ok: false, message: 'Workspace Preview provider does not expose actions.' }
  }
  const action = workspacePreviewPluginActionInputSchema.parse(input.action)
  return toWirePayload(await installed.provider.invokeAction({
    ...providerBaseInput(record),
    action
  }))
}

function releasePreview(
  installed: InstalledPreview,
  input: Record<string, WorkspaceHostPayload>,
  sessions: Map<string, PreviewSessionRecord>
): WorkspaceHostPayload {
  const record = requireSession(installed, input, sessions)
  sessions.delete(record.session.id)
  return { released: true }
}

function requireSession(
  installed: InstalledPreview,
  input: Record<string, WorkspaceHostPayload>,
  sessions: Map<string, PreviewSessionRecord>
): PreviewSessionRecord {
  if (typeof input.sessionId !== 'string') {
    throw previewError('invalid_request', 'Workspace Preview sessionId is required.')
  }
  const record = sessions.get(input.sessionId)
  if (!record || record.installed !== installed) {
    throw previewError('not_found', 'Workspace Preview session was not found for this provider.')
  }
  return record
}

function providerBaseInput(record: PreviewSessionRecord) {
  return {
    session: record.session,
    manifest: record.installed.manifest,
    file: record.file
  }
}

async function refreshSource(
  record: PreviewSessionRecord,
  acceptChange = false
) {
  const sourceStat = await stat(record.file.path)
  const revision = previewSourceRevision(sourceStat)
  if (!acceptChange && revision !== record.sourceRevision) {
    throw previewError(
      'revision_conflict',
      'Workspace Preview source changed; reopen or refresh the session.'
    )
  }
  if (acceptChange) {
    record.sourceRevision = revision
    record.file = workspacePreviewFileStateSchema.parse({
      ...record.file,
      size: sourceStat.size,
      mtimeMs: sourceStat.mtimeMs
    })
    record.session = workspacePreviewSessionSchema.parse({
      ...record.session,
      file: record.file,
      mtimeMs: sourceStat.mtimeMs,
      updatedAt: new Date().toISOString()
    })
  }
  return sourceStat
}

async function requireExpectedRevision(
  record: PreviewSessionRecord,
  expected: WorkspaceHostPayload | undefined
): Promise<void> {
  const sourceStat = await stat(record.file.path)
  const current = previewSourceRevision(sourceStat)
  if (typeof expected !== 'string' || expected !== current) {
    throw previewError('revision_conflict', 'Workspace Preview source revision is stale.')
  }
}

function installedPreviewProviders(
  contributions: readonly WorkspaceHostPreviewContribution[]
): Map<string, InstalledPreview> {
  const providers = new Map<string, InstalledPreview>()
  for (const contribution of contributions) {
    if (
      contribution.kind !== WORKSPACE_SERVER_WORKSPACE_PREVIEW_PLUGIN_CONTRIBUTION_KIND
      || !isPreviewContributionValue(contribution.value)
    ) continue
    const pluginId = contribution.value.provider.pluginId
    if (providers.has(pluginId)) {
      throw previewError(
        'invalid_request',
        `Workspace Preview provider ${pluginId} is duplicated.`
      )
    }
    providers.set(pluginId, contribution.value)
  }
  return providers
}

async function normalizeExportTarget(
  workspaceRoot: string,
  target: ReturnType<typeof workspacePreviewExportTargetSchema.parse>
) {
  if (target.kind !== 'workspace-file') return target
  if (!target.path) {
    throw previewError(
      'invalid_request',
      'Workspace Preview workspace-file export requires a path.'
    )
  }
  const relativePath = normalizeRelativePath(target.path)
  const exportPath = resolve(workspaceRoot, relativePath)
  assertContained(workspaceRoot, exportPath)
  const parent = await realpath(resolve(exportPath, '..'))
  assertContained(workspaceRoot, parent)
  const existing = await lstat(exportPath).catch((error: unknown) => {
    if (isNodeError(error) && error.code === 'ENOENT') return undefined
    throw error
  })
  if (existing?.isSymbolicLink()) {
    throw previewError(
      'path_outside_workspace',
      'Workspace Preview export cannot write through a symbolic link.'
    )
  }
  return { ...target, path: exportPath }
}

function pruneStaleArtifacts(
  record: PreviewSessionRecord,
  sourceStat: Awaited<ReturnType<typeof stat>>
): void {
  for (const [id, artifact] of record.artifacts) {
    if (
      artifact.sourceSize !== sourceStat.size
      || artifact.sourceMtimeMs !== sourceStat.mtimeMs
    ) record.artifacts.delete(id)
  }
}

function previewSourceRevision(sourceStat: Awaited<ReturnType<typeof stat>>): string {
  return createHash('sha256')
    .update([
      sourceStat.dev,
      sourceStat.ino,
      sourceStat.size,
      sourceStat.mtimeMs,
      sourceStat.ctimeMs
    ].join(':'))
    .digest('hex')
}

function assetId(sessionId: string): string {
  return `asset-${sessionId}`
}

function toWirePayload(value: unknown): WorkspaceHostPayload {
  if (value === undefined) return null
  if (
    value === null
    || typeof value === 'boolean'
    || typeof value === 'string'
    || (typeof value === 'number' && Number.isFinite(value))
  ) return value
  if (value instanceof Uint8Array) {
    return {
      encoding: 'base64',
      contentBase64: Buffer.from(value).toString('base64')
    }
  }
  if (Array.isArray(value)) return value.map(toWirePayload)
  if (isRecord(value)) {
    return workspaceHostPayloadSchema.parse(Object.fromEntries(
      Object.entries(value)
        .filter(([, item]) => item !== undefined)
        .map(([key, item]) => [key, toWirePayload(item)])
    ))
  }
  throw new Error('Workspace Preview provider returned a non-transportable value.')
}

function isPreviewContributionValue(value: unknown): value is InstalledPreview {
  return isRecord(value)
    && isRecord(value.manifest)
    && isRecord(value.provider)
    && typeof value.provider.pluginId === 'string'
}

function normalizeRelativePath(value: unknown): string {
  if (
    typeof value !== 'string'
    || !value
    || value.includes('\0')
    || value.includes('\\')
    || isAbsolute(value)
  ) {
    throw previewError(
      'path_outside_workspace',
      'Workspace Preview path must be workspace-relative.'
    )
  }
  const normalized = value.replace(/\/+/g, '/')
    .split('/')
    .filter((part) => part && part !== '.')
  if (normalized.length === 0 || normalized.some((part) => part === '..')) {
    throw previewError(
      'path_outside_workspace',
      'Workspace Preview path escapes its workspace.'
    )
  }
  return normalized.join('/')
}

function assertContained(root: string, candidate: string): void {
  const child = relative(root, candidate)
  if (child === '..' || child.startsWith(`..${sep}`) || isAbsolute(child)) {
    throw previewError(
      'path_outside_workspace',
      'Workspace Preview path escapes its workspace.'
    )
  }
}

function requireRecord(value: WorkspaceHostPayload): Record<string, WorkspaceHostPayload> {
  if (!isRecord(value)) {
    throw previewError('invalid_request', 'Workspace Preview input must be an object.')
  }
  return value as Record<string, WorkspaceHostPayload>
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isNodeError(value: unknown): value is NodeJS.ErrnoException {
  return value instanceof Error && 'code' in value
}

function previewError(code: string, message: string): WorkspaceHostServiceError {
  return new WorkspaceHostServiceError(code, message)
}
