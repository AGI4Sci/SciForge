import { createHash, randomUUID } from 'node:crypto'
import { loadImage } from '@napi-rs/canvas'
import { constants } from 'node:fs'
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, join, resolve } from 'node:path'
import {
  artifactVersionRefV1Schema,
  type ArtifactVersionRefV1
} from '@sciforge/domain-artifact-versions/contract'
import {
  VISUAL_ARTIFACT_KINDS,
  VISUAL_DOCUMENT_SCHEMA_VERSION,
  type NormalizedBounds,
  type NormalizedPoint,
  type VisualAnnotationGeometry,
  type VisualArtifact,
  type VisualDocument,
  type VisualDocumentCreateCandidateRequest,
  type VisualDocumentCreateCandidateResult,
  type VisualDocumentExportReviewPacketRequest,
  type VisualDocumentExportReviewPacketResult,
  type VisualDocumentInsertArtifactRequest,
  type VisualDocumentInsertArtifactResult,
  type VisualDocumentOpenRequest,
  type VisualDocumentOpenResult,
  type VisualDocumentPaths,
  type VisualDocumentRevisionDecisionRequest,
  type VisualDocumentRevisionDecisionResult,
  type VisualDocumentSaveAnnotationsRequest,
  type VisualDocumentSaveAnnotationsResult,
  type VisualDocumentUpdateContextRequest,
  type VisualDocumentUpdateContextResult,
  type VisualNode,
  type VisualReviewAnnotation,
  type VisualRevision,
  type VisualTruthLock
} from '../types.js'
import { canonicalPath, resolveOpenTargetPath } from './workspace-paths.js'

const DEFAULT_DOCUMENT_ID = 'default'
const DEFAULT_CANVAS = { width: 1200, height: 800, background: '#ffffff' }
const DEFAULT_MANUSCRIPT_STYLE_REF = '.sciforge/visual-styles/manuscript-default.json'
const DECODABLE_RASTER_EXTENSIONS = new Set([
  '.avif',
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.webp'
])
const REVIEW_IMAGE_MIME_TYPES = new Map([
  ['.avif', 'image/avif'],
  ['.bmp', 'image/bmp'],
  ['.gif', 'image/gif'],
  ['.jpeg', 'image/jpeg'],
  ['.jpg', 'image/jpeg'],
  ['.png', 'image/png'],
  ['.webp', 'image/webp']
])
const MAX_REVIEW_IMAGE_BYTES = 47 * 1024 * 1024
const ACCEPTANCE_RECEIPT_SCHEMA_VERSION = 1 as const

type VisualAcceptanceReceipt = {
  schemaVersion: typeof ACCEPTANCE_RECEIPT_SCHEMA_VERSION
  documentId: string
  revisionId: string
  state: 'prepared' | 'version-committed' | 'completed'
  candidateHash: string
  sourceHash: string
  workingCopyHash: string
  backupPath: string
  preparedAt: string
  artifactVersionRef?: ArtifactVersionRefV1
  completedAt?: string
}

function safeId(raw: string | undefined, fallback = DEFAULT_DOCUMENT_ID): string {
  const id = (raw?.trim() || fallback).replace(/[^a-zA-Z0-9._-]+/g, '-')
  if (!id || id === '.' || id === '..') throw new Error('A valid documentId is required.')
  return id.slice(0, 120)
}

async function ensureWorkspace(workspaceRoot: string): Promise<string> {
  if (!workspaceRoot.trim()) throw new Error('workspaceRoot is required.')
  const root = await canonicalPath(resolve(workspaceRoot))
  const info = await stat(root)
  if (!info.isDirectory()) throw new Error('workspaceRoot must be a directory.')
  return root
}

function documentPaths(workspaceRoot: string, documentId: string): VisualDocumentPaths {
  const documentDir = join(workspaceRoot, '.sciforge', 'visual-documents', documentId)
  return {
    documentDir,
    documentPath: join(documentDir, 'document.json'),
    assetsDir: join(documentDir, 'assets'),
    revisionsDir: join(documentDir, 'revisions'),
    backupsDir: join(documentDir, 'backups'),
    reviewPacketsDir: join(documentDir, 'review-packets')
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK)
    return true
  } catch {
    return false
  }
}

async function ensureDirectories(paths: VisualDocumentPaths): Promise<void> {
  await Promise.all([
    mkdir(paths.assetsDir, { recursive: true }),
    mkdir(paths.revisionsDir, { recursive: true }),
    mkdir(paths.backupsDir, { recursive: true }),
    mkdir(paths.reviewPacketsDir, { recursive: true })
  ])
}

async function atomicWrite(path: string, contents: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`
  try {
    await writeFile(temporaryPath, contents)
    await rename(temporaryPath, path)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

async function atomicCopy(sourcePath: string, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  const temporaryPath = `${targetPath}.${process.pid}.${randomUUID()}.tmp`
  try {
    await copyFile(sourcePath, temporaryPath)
    await rename(temporaryPath, targetPath)
  } catch (error) {
    await unlink(temporaryPath).catch(() => undefined)
    throw error
  }
}

async function hashFile(path: string): Promise<string> {
  const bytes = await readFile(path)
  return createHash('sha256').update(bytes).digest('hex')
}

function acceptanceReceiptPath(paths: VisualDocumentPaths, revisionId: string): string {
  return join(paths.documentDir, 'acceptance-outbox', `${safeId(revisionId)}.json`)
}

function acceptanceBackupPath(
  paths: VisualDocumentPaths,
  revisionId: string,
  sourcePath: string
): string {
  return join(paths.backupsDir, `accept-${safeId(revisionId)}-${basename(sourcePath)}`)
}

function sameArtifactVersionRef(left: ArtifactVersionRefV1, right: ArtifactVersionRefV1): boolean {
  return left.artifactId === right.artifactId
    && left.versionId === right.versionId
    && left.contentDigest === right.contentDigest
    && left.byteLength === right.byteLength
    && left.mediaType === right.mediaType
    && left.availability === right.availability
    && left.retention === right.retention
    && left.accessPolicy.visibility === right.accessPolicy.visibility
    && left.accessPolicy.allowExport === right.accessPolicy.allowExport
    && left.accessPolicy.principals.length === right.accessPolicy.principals.length
    && left.accessPolicy.principals.every(
      (principal, index) => principal === right.accessPolicy.principals[index]
    )
}

function parseAcceptanceReceipt(value: unknown): VisualAcceptanceReceipt {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Visual Review acceptance receipt.')
  }
  const receipt = value as Record<string, unknown>
  const state = receipt.state
  if (receipt.schemaVersion !== ACCEPTANCE_RECEIPT_SCHEMA_VERSION
    || typeof receipt.documentId !== 'string'
    || typeof receipt.revisionId !== 'string'
    || (state !== 'prepared' && state !== 'version-committed' && state !== 'completed')
    || typeof receipt.candidateHash !== 'string'
    || typeof receipt.sourceHash !== 'string'
    || typeof receipt.workingCopyHash !== 'string'
    || typeof receipt.backupPath !== 'string'
    || typeof receipt.preparedAt !== 'string') {
    throw new Error('Invalid Visual Review acceptance receipt.')
  }
  for (const [name, digest] of [
    ['candidateHash', receipt.candidateHash],
    ['sourceHash', receipt.sourceHash],
    ['workingCopyHash', receipt.workingCopyHash]
  ] as const) {
    if (!/^[a-f0-9]{64}$/u.test(digest)) {
      throw new Error(`Invalid ${name} in Visual Review acceptance receipt.`)
    }
  }
  const versionRef = receipt.artifactVersionRef === undefined
    ? undefined
    : artifactVersionRefV1Schema.parse(receipt.artifactVersionRef)
  if (state === 'version-committed' && !versionRef) {
    throw new Error('A version-committed acceptance receipt requires an ArtifactVersionRef.')
  }
  if (receipt.completedAt !== undefined && typeof receipt.completedAt !== 'string') {
    throw new Error('Invalid completedAt in Visual Review acceptance receipt.')
  }
  return {
    schemaVersion: ACCEPTANCE_RECEIPT_SCHEMA_VERSION,
    documentId: receipt.documentId,
    revisionId: receipt.revisionId,
    state,
    candidateHash: receipt.candidateHash,
    sourceHash: receipt.sourceHash,
    workingCopyHash: receipt.workingCopyHash,
    backupPath: receipt.backupPath,
    preparedAt: receipt.preparedAt,
    ...(versionRef ? { artifactVersionRef: versionRef } : {}),
    ...(typeof receipt.completedAt === 'string' ? { completedAt: receipt.completedAt } : {})
  }
}

async function readAcceptanceReceipt(
  paths: VisualDocumentPaths,
  revisionId: string
): Promise<VisualAcceptanceReceipt | null> {
  const path = acceptanceReceiptPath(paths, revisionId)
  if (!(await exists(path))) return null
  try {
    return parseAcceptanceReceipt(JSON.parse(await readFile(path, 'utf8')))
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : ''
    throw new Error(`Could not read Visual Review acceptance receipt.${detail}`)
  }
}

async function writeAcceptanceReceipt(
  paths: VisualDocumentPaths,
  receipt: VisualAcceptanceReceipt
): Promise<void> {
  await atomicWrite(
    acceptanceReceiptPath(paths, receipt.revisionId),
    `${JSON.stringify(receipt, null, 2)}\n`
  )
}

function now(): string {
  return new Date().toISOString()
}

function assertFinitePositive(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${name} must be a positive finite number.`)
}

function assertNormalizedPoint(point: NormalizedPoint, name: string): void {
  for (const [key, value] of Object.entries(point)) {
    if (!Number.isFinite(value) || value < 0 || value > 1) {
      throw new Error(`${name}.${key} must be normalized to [0, 1].`)
    }
  }
}

function assertNormalizedBounds(bounds: NormalizedBounds, name: string): void {
  assertNormalizedPoint({ x: bounds.x, y: bounds.y }, name)
  if (!Number.isFinite(bounds.width) || bounds.width <= 0 || bounds.width > 1) {
    throw new Error(`${name}.width must be in (0, 1].`)
  }
  if (!Number.isFinite(bounds.height) || bounds.height <= 0 || bounds.height > 1) {
    throw new Error(`${name}.height must be in (0, 1].`)
  }
  if (bounds.x + bounds.width > 1 || bounds.y + bounds.height > 1) {
    throw new Error(`${name} must stay inside the artifact.`)
  }
}

function assertGeometry(geometry: VisualAnnotationGeometry): void {
  if (geometry.kind === 'box') return assertNormalizedBounds(geometry.bounds, 'geometry.bounds')
  if (geometry.kind === 'pin') return assertNormalizedPoint(geometry.point, 'geometry.point')
  if (geometry.kind === 'arrow') {
    assertNormalizedPoint(geometry.from, 'geometry.from')
    return assertNormalizedPoint(geometry.to, 'geometry.to')
  }
  if (geometry.points.length < 2) throw new Error('A freehand annotation requires at least two points.')
  geometry.points.forEach((point, index) => assertNormalizedPoint(point, `geometry.points[${index}]`))
}

function assertNode(node: VisualNode): void {
  if (!node.id.trim()) throw new Error('Visual node id is required.')
  assertNormalizedBounds(node.bounds, `node ${node.id} bounds`)
}

function assertTruthLock(lock: VisualTruthLock): void {
  if (!lock.id.trim() || !lock.description.trim()) throw new Error('Truth locks require id and description.')
}

function assertDocument(document: unknown): asserts document is VisualDocument {
  if (!document || typeof document !== 'object') throw new Error('Invalid VisualDocument JSON.')
  const value = document as Partial<VisualDocument>
  if (value.schemaVersion !== VISUAL_DOCUMENT_SCHEMA_VERSION) {
    throw new Error(`Unsupported VisualDocument schemaVersion: ${String(value.schemaVersion)}.`)
  }
  if (!value.documentId || !value.canvas || !Array.isArray(value.nodes) || !Array.isArray(value.annotations)
    || !Array.isArray(value.truthLocks) || !Array.isArray(value.revisions)) {
    throw new Error('VisualDocument is missing required fields.')
  }
  assertFinitePositive(value.canvas.width, 'canvas.width')
  assertFinitePositive(value.canvas.height, 'canvas.height')
  value.nodes.forEach(assertNode)
  value.annotations.forEach((annotation) => assertGeometry(annotation.geometry))
  value.truthLocks.forEach(assertTruthLock)
}

async function readDocument(path: string): Promise<VisualDocument> {
  const parsed: unknown = JSON.parse(await readFile(path, 'utf8'))
  assertDocument(parsed)
  return parsed
}

async function writeDocument(path: string, document: VisualDocument): Promise<void> {
  assertDocument(document)
  await atomicWrite(path, `${JSON.stringify(document, null, 2)}\n`)
}

async function loadRequiredDocument(workspaceRoot: string, documentId?: string) {
  const root = await ensureWorkspace(workspaceRoot)
  const id = safeId(documentId)
  const paths = documentPaths(root, id)
  if (!(await exists(paths.documentPath))) throw new Error(`VisualDocument not found: ${id}`)
  return { root, paths, document: await readDocument(paths.documentPath) }
}

function extensionFor(path: string): string {
  const extension = extname(path).toLowerCase()
  return /^\.[a-z0-9]{1,12}$/.test(extension) ? extension : '.bin'
}

async function dimensionsFromRasterArtifact(path: string): Promise<{ width: number; height: number } | null> {
  const extension = extname(path).toLowerCase()
  if (!DECODABLE_RASTER_EXTENSIONS.has(extension)) return null
  try {
    const image = await loadImage(path)
    const dimensions = { width: image.width, height: image.height }
    assertFinitePositive(dimensions.width, 'candidate raster width')
    assertFinitePositive(dimensions.height, 'candidate raster height')
    return dimensions
  } catch (error) {
    const detail = error instanceof Error ? ` ${error.message}` : ''
    throw new Error(`Could not decode candidate raster image dimensions.${detail}`)
  }
}

function rootArtifactNode(artifact: VisualArtifact): VisualNode {
  return {
    id: `artifact-${artifact.id}`,
    kind: artifact.kind === 'scientific_plot' ? 'scientific_plot' : 'generated_asset',
    bounds: { x: 0, y: 0, width: 1, height: 1 },
    semanticRef: 'visual-document.root-artifact',
    assetPath: artifact.workingCopyPath,
    editable: false,
    truthLocked: false
  }
}

export async function readVisualReviewImage(input: {
  workspaceRoot: string
  path: string
}): Promise<{ ok: true; dataUrl: string }> {
  const workspaceRoot = await ensureWorkspace(input.workspaceRoot)
  const path = await resolveOpenTargetPath(input.path, workspaceRoot, {
    allowBasenameFallback: false
  })
  const extension = extname(path).toLowerCase()
  const mimeType = REVIEW_IMAGE_MIME_TYPES.get(extension)
  if (!mimeType) throw new Error(`Unsupported Visual Review image type: ${extension || 'unknown'}.`)
  const info = await stat(path)
  if (!info.isFile()) throw new Error('Visual Review image path must point to a file.')
  if (info.size > MAX_REVIEW_IMAGE_BYTES) {
    throw new Error(`Visual Review images must be at most ${MAX_REVIEW_IMAGE_BYTES} bytes.`)
  }
  const bytes = await readFile(path)
  return { ok: true, dataUrl: `data:${mimeType};base64,${bytes.toString('base64')}` }
}

async function openOrCreateVisualDocument(
  request: VisualDocumentOpenRequest
): Promise<VisualDocumentOpenResult> {
  const workspaceRoot = await ensureWorkspace(request.workspaceRoot)
  const documentId = safeId(request.documentId)
  const paths = documentPaths(workspaceRoot, documentId)
  if (await exists(paths.documentPath)) {
    return { ok: true, status: 'opened', workspaceRoot, document: await readDocument(paths.documentPath), paths }
  }
  if (request.createIfMissing === false) {
    throw new Error(`VisualDocument does not exist: ${documentId}.`)
  }
  await ensureDirectories(paths)

  const createdAt = now()
  const canvas = { ...DEFAULT_CANVAS, ...request.canvas }
  assertFinitePositive(canvas.width, 'canvas.width')
  assertFinitePositive(canvas.height, 'canvas.height')
  const inheritedStyleProfileRef = request.styleProfileRef === undefined
    && await exists(join(workspaceRoot, DEFAULT_MANUSCRIPT_STYLE_REF))
    ? DEFAULT_MANUSCRIPT_STYLE_REF
    : request.styleProfileRef ?? null
  const document: VisualDocument = {
    schemaVersion: VISUAL_DOCUMENT_SCHEMA_VERSION,
    documentId,
    canvas,
    artifact: null,
    nodes: [],
    annotations: [],
    truthLocks: [],
    styleProfileRef: inheritedStyleProfileRef,
    revisions: [],
    activeCandidateRevisionId: null,
    acceptedRevisionId: null,
    createdAt,
    updatedAt: createdAt
  }
  await writeDocument(paths.documentPath, document)
  return { ok: true, status: 'created', workspaceRoot, document, paths }
}

async function insertVisualDocumentArtifact(
  request: VisualDocumentInsertArtifactRequest
): Promise<VisualDocumentInsertArtifactResult> {
  if (!VISUAL_ARTIFACT_KINDS.includes(request.kind)) throw new Error(`Unsupported artifact kind: ${request.kind}`)
  const opened = await openOrCreateVisualDocument({
    workspaceRoot: request.workspaceRoot,
    ...(request.documentId ? { documentId: request.documentId } : {})
  })
  const { document, paths } = opened
  if (document.artifact) throw new Error('VisualDocument already has an artifact. Create a new document instead of replacing it.')
  const sourcePath = await resolveOpenTargetPath(request.sourcePath, opened.workspaceRoot, { allowBasenameFallback: false })
  const sourceInfo = await stat(sourcePath)
  if (!sourceInfo.isFile()) throw new Error('sourcePath must point to a file.')
  const artifactId = randomUUID()
  const workingCopyPath = join(paths.assetsDir, `current-${artifactId}${extensionFor(sourcePath)}`)
  try {
    await atomicCopy(sourcePath, workingCopyPath)
    const sourceHash = await hashFile(sourcePath)
    if (request.versionRef) {
      if (request.versionRef.availability !== 'available') {
        throw new Error('The bound ArtifactVersion is not available for review.')
      }
      if (sourceHash !== request.versionRef.contentDigest) {
        throw new Error('Source artifact bytes do not match the bound ArtifactVersion digest.')
      }
      if (sourceInfo.size !== request.versionRef.byteLength) {
        throw new Error('Source artifact byte length does not match the bound ArtifactVersion.')
      }
      if (request.mimeType && request.versionRef.mediaType && request.mimeType !== request.versionRef.mediaType) {
        throw new Error('Source artifact media type does not match the bound ArtifactVersion.')
      }
    }
    const artifact: VisualArtifact = {
      id: artifactId,
      kind: request.kind,
      sourcePath,
      sourceHash,
      workingCopyPath,
      workingCopyHash: sourceHash,
      ...((request.mimeType ?? request.versionRef?.mediaType)
        ? { mimeType: request.mimeType ?? request.versionRef!.mediaType }
        : {}),
      ...(request.width ? { width: request.width } : {}),
      ...(request.height ? { height: request.height } : {}),
      ...(request.manifestPath ? { manifestPath: await resolveOpenTargetPath(request.manifestPath, opened.workspaceRoot) } : {}),
      ...(request.title ? { title: request.title.trim() } : {}),
      ...(request.caption ? { caption: request.caption.trim() } : {}),
      ...(request.versionRef ? { versionRef: request.versionRef } : {})
    }
    const nodes = request.nodes?.length ? request.nodes : [rootArtifactNode(artifact)]
    nodes.forEach(assertNode)
    const nodeIds = new Set(nodes.map((node) => node.id))
    if (nodeIds.size !== nodes.length) throw new Error('Visual node ids must be unique.')
    const truthLocks = request.truthLocks ?? []
    truthLocks.forEach(assertTruthLock)

    const updated: VisualDocument = {
      ...document,
      artifact,
      nodes,
      truthLocks,
      styleProfileRef: request.styleProfileRef ?? document.styleProfileRef,
      canvas: {
        ...document.canvas,
        ...(request.width ? { width: request.width } : {}),
        ...(request.height ? { height: request.height } : {})
      },
      updatedAt: now()
    }
    await writeDocument(paths.documentPath, updated)
    return { ok: true, status: 'inserted', document: updated, paths }
  } catch (error) {
    await unlink(workingCopyPath).catch(() => undefined)
    throw error
  }
}

/**
 * Canonical activation operation used by every renderer and agent ingress.
 * Artifact staging is deliberately owned by the service so callers never
 * compose open + insert as separate business operations.
 */
export async function openVisualReviewDocument(
  request: VisualDocumentOpenRequest & Readonly<{
    artifact?: Omit<VisualDocumentInsertArtifactRequest, 'workspaceRoot' | 'documentId'>
  }>
): Promise<VisualDocumentOpenResult & Readonly<{ changed: boolean }>> {
  const opened = await openOrCreateVisualDocument(request)
  if (!request.artifact || opened.document.artifact) {
    return { ...opened, changed: opened.status === 'created' }
  }
  let inserted: VisualDocumentInsertArtifactResult
  try {
    inserted = await insertVisualDocumentArtifact({
      workspaceRoot: opened.workspaceRoot,
      documentId: opened.document.documentId,
      ...request.artifact
    })
  } catch (error) {
    if (opened.status === 'created') {
      await rm(opened.paths.documentDir, { recursive: true, force: true })
    }
    throw error
  }
  return {
    ...opened,
    document: inserted.document,
    paths: inserted.paths,
    changed: true
  }
}

export async function saveVisualDocumentAnnotations(
  request: VisualDocumentSaveAnnotationsRequest
): Promise<VisualDocumentSaveAnnotationsResult> {
  const { paths, document } = await loadRequiredDocument(request.workspaceRoot, request.documentId)
  if (!document.artifact) throw new Error('Insert an artifact before saving review annotations.')
  const nodeIds = new Set(document.nodes.map((node) => node.id))
  const previous = new Map(document.annotations.map((annotation) => [annotation.id, annotation]))
  const timestamp = now()
  const annotations: VisualReviewAnnotation[] = request.annotations.map((input) => {
    assertGeometry(input.geometry)
    const instruction = input.instruction.trim()
    if (!instruction) throw new Error('Every annotation requires a modification instruction.')
    const id = safeId(input.id, randomUUID())
    const targetNodeIds = [...new Set(input.targetNodeIds ?? [])]
    for (const targetId of targetNodeIds) {
      if (!nodeIds.has(targetId)) throw new Error(`Annotation targets unknown visual node: ${targetId}`)
    }
    return {
      id,
      kind: input.geometry.kind,
      geometry: input.geometry,
      instruction,
      targetNodeIds,
      status: input.status ?? previous.get(id)?.status ?? 'open',
      createdAt: previous.get(id)?.createdAt ?? timestamp,
      updatedAt: timestamp
    }
  })
  if (new Set(annotations.map((annotation) => annotation.id)).size !== annotations.length) {
    throw new Error('Annotation ids must be unique.')
  }
  const updated = { ...document, annotations, updatedAt: timestamp }
  await writeDocument(paths.documentPath, updated)
  return { ok: true, status: 'saved', annotations, document: updated }
}

export async function updateVisualDocumentContext(
  request: VisualDocumentUpdateContextRequest
): Promise<VisualDocumentUpdateContextResult> {
  const { paths, document } = await loadRequiredDocument(request.workspaceRoot, request.documentId)
  const nodes = request.nodes ?? document.nodes
  nodes.forEach(assertNode)
  if (new Set(nodes.map((node) => node.id)).size !== nodes.length) throw new Error('Visual node ids must be unique.')
  const truthLocks = request.truthLocks ?? document.truthLocks
  truthLocks.forEach(assertTruthLock)
  const nodeIds = new Set(nodes.map((node) => node.id))
  for (const lock of truthLocks) {
    for (const nodeId of lock.nodeIds) {
      if (!nodeIds.has(nodeId)) throw new Error(`Truth lock targets unknown visual node: ${nodeId}`)
    }
  }
  const updated: VisualDocument = {
    ...document,
    nodes,
    truthLocks,
    ...(request.styleProfileRef !== undefined ? { styleProfileRef: request.styleProfileRef } : {}),
    updatedAt: now()
  }
  await writeDocument(paths.documentPath, updated)
  return { ok: true, status: 'updated', document: updated }
}

export async function exportVisualReviewPacket(
  request: VisualDocumentExportReviewPacketRequest
): Promise<VisualDocumentExportReviewPacketResult> {
  const { paths, document } = await loadRequiredDocument(request.workspaceRoot, request.documentId)
  if (!document.artifact) throw new Error('A review packet requires an artifact.')
  const packetId = safeId(request.packetId, `review-${Date.now()}-${randomUUID().slice(0, 8)}`)
  const annotations = document.annotations.filter((annotation) => annotation.status === 'open')
  const packet = {
    schemaVersion: 1 as const,
    packetId,
    documentId: document.documentId,
    createdAt: now(),
    sourceArtifact: document.artifact,
    annotations,
    truthLocks: document.truthLocks,
    styleProfileRef: document.styleProfileRef,
    revisionContext: {
      acceptedRevisionId: document.acceptedRevisionId,
      activeCandidateRevisionId: document.activeCandidateRevisionId,
      selectedRegions: annotations.map((annotation) => annotation.geometry),
      selectedNodeIds: [...new Set(annotations.flatMap((annotation) => annotation.targetNodeIds))],
      preserve: document.truthLocks.map((lock) => lock.description)
    }
  }
  const packetPath = join(paths.reviewPacketsDir, `${packetId}.json`)
  await atomicWrite(packetPath, `${JSON.stringify(packet, null, 2)}\n`)
  return { ok: true, status: 'exported', packet, packetPath }
}

export async function createVisualCandidateRevision(
  request: VisualDocumentCreateCandidateRequest
): Promise<VisualDocumentCreateCandidateResult> {
  const { root, paths, document } = await loadRequiredDocument(request.workspaceRoot, request.documentId)
  if (!document.artifact) throw new Error('A candidate revision requires an artifact.')
  if (document.activeCandidateRevisionId) {
    throw new Error('Resolve the active candidate before creating another candidate.')
  }
  if (request.expectedBaseHash && request.expectedBaseHash !== document.artifact.workingCopyHash) {
    throw new Error('Candidate base hash does not match the current accepted artifact.')
  }
  const candidateSourcePath = await resolveOpenTargetPath(request.candidatePath, root, { allowBasenameFallback: false })
  if (!(await stat(candidateSourcePath)).isFile()) throw new Error('candidatePath must point to a file.')
  const summary = request.summary.trim()
  if (!summary) throw new Error('A candidate summary is required.')
  const candidateHash = await hashFile(candidateSourcePath)
  if (request.reviewEvidence.tool !== 'image_generation_review_candidate') {
    throw new Error('Candidate QA evidence must come from image_generation_review_candidate.')
  }
  const reviewedArtifactPath = await resolveOpenTargetPath(
    request.reviewEvidence.reviewedArtifactPath,
    root,
    { allowBasenameFallback: false }
  )
  if (await canonicalPath(reviewedArtifactPath) !== await canonicalPath(candidateSourcePath)) {
    throw new Error('Candidate path does not match the reviewed artifact path.')
  }
  if (request.reviewEvidence.reviewedArtifactHash !== candidateHash) {
    throw new Error('Candidate hash does not match the reviewed artifact hash.')
  }
  if (!request.reviewEvidence.semantic.pass || request.reviewEvidence.repairable
    || request.reviewEvidence.semantic.violations.length > 0
    || request.reviewEvidence.semantic.repairInstructions.length > 0) {
    throw new Error('Candidate must pass semantic visual review without pending repairs.')
  }
  const revisionId = randomUUID()
  const artifactPath = join(paths.revisionsDir, revisionId, `candidate${extensionFor(candidateSourcePath)}`)
  await atomicCopy(candidateSourcePath, artifactPath)
  const rasterDimensions = await dimensionsFromRasterArtifact(artifactPath)
  const width = rasterDimensions?.width ?? request.width ?? document.artifact.width
  const height = rasterDimensions?.height ?? request.height ?? document.artifact.height
  const createdAt = now()
  const revision: VisualRevision = {
    id: revisionId,
    status: 'candidate',
    basedOnHash: document.artifact.workingCopyHash,
    artifactPath,
    artifactHash: candidateHash,
    ...(width ? { width } : {}),
    ...(height ? { height } : {}),
    summary,
    reviewEvidence: request.reviewEvidence,
    createdAt
  }
  const updated: VisualDocument = {
    ...document,
    revisions: [...document.revisions, revision],
    activeCandidateRevisionId: revisionId,
    updatedAt: createdAt
  }
  await writeDocument(paths.documentPath, updated)
  return { ok: true, status: 'candidate_created', revision, document: updated }
}

export async function acceptVisualCandidateRevision(
  request: VisualDocumentRevisionDecisionRequest
): Promise<VisualDocumentRevisionDecisionResult> {
  const preflight = await preflightVisualCandidateAcceptance(request)
  if (preflight.alreadyAccepted) return preflight.alreadyAccepted
  const { paths, document, artifact, candidate, index } = preflight
  let receipt = await readAcceptanceReceipt(paths, candidate.id)
  if (!receipt) throw new Error('Visual Review acceptance receipt disappeared after preflight.')

  if (request.artifactVersionRef) {
    const candidateInfo = await stat(candidate.artifactPath)
    if (request.artifactVersionRef.availability !== 'available'
      || request.artifactVersionRef.contentDigest !== candidate.artifactHash
      || request.artifactVersionRef.byteLength !== candidateInfo.size
      || (artifact.mimeType && request.artifactVersionRef.mediaType !== artifact.mimeType)
      || (artifact.versionRef
        && request.artifactVersionRef.artifactId !== artifact.versionRef.artifactId)) {
      throw new Error('Committed ArtifactVersionRef does not match the reviewed candidate bytes.')
    }
    if (receipt.artifactVersionRef
      && !sameArtifactVersionRef(receipt.artifactVersionRef, request.artifactVersionRef)) {
      throw new Error('Acceptance receipt is already bound to a different ArtifactVersionRef.')
    }
    receipt = {
      ...receipt,
      state: 'version-committed',
      artifactVersionRef: request.artifactVersionRef
    }
    // This write is the durable cross-service receipt. It happens before any
    // source or working-copy replacement so retries can finish local acceptance
    // after the shared version service has already advanced its current pointer.
    await writeAcceptanceReceipt(paths, receipt)
  }

  const boundVersionRef = request.artifactVersionRef ?? receipt.artifactVersionRef
  const sourceHash = await hashFile(artifact.sourcePath)
  const workingCopyHash = await hashFile(artifact.workingCopyPath)
  if (sourceHash !== receipt.candidateHash) {
    if (sourceHash !== receipt.sourceHash) {
      throw new Error('Source artifact has an unexpected hash during acceptance recovery.')
    }
    await atomicCopy(candidate.artifactPath, artifact.sourcePath)
  }
  if (workingCopyHash !== receipt.candidateHash) {
    if (workingCopyHash !== receipt.workingCopyHash) {
      throw new Error('Working copy has an unexpected hash during acceptance recovery.')
    }
    await atomicCopy(candidate.artifactPath, artifact.workingCopyPath)
  }

  const decidedAt = now()
  const acceptedHash = candidate.artifactHash
  const accepted: VisualRevision = {
    ...candidate,
    status: 'accepted',
    decidedAt,
    backupPath: receipt.backupPath,
    ...(boundVersionRef ? { versionRef: boundVersionRef } : {})
  }
  const updated: VisualDocument = {
    ...document,
    artifact: {
      ...artifact,
      sourceHash: acceptedHash,
      workingCopyHash: acceptedHash,
      ...(boundVersionRef ? { versionRef: boundVersionRef } : {}),
      ...(accepted.width ? { width: accepted.width } : {}),
      ...(accepted.height ? { height: accepted.height } : {})
    },
    revisions: document.revisions.map((revision, revisionIndex) => revisionIndex === index ? accepted : revision),
    activeCandidateRevisionId: null,
    acceptedRevisionId: accepted.id,
    updatedAt: decidedAt
  }
  await writeDocument(paths.documentPath, updated)
  await writeAcceptanceReceipt(paths, {
    ...receipt,
    state: 'completed',
    ...(boundVersionRef ? { artifactVersionRef: boundVersionRef } : {}),
    completedAt: decidedAt
  })
  return { ok: true, status: 'accepted', revision: accepted, document: updated }
}

/**
 * Performs every deterministic acceptance check and durably writes a prepared
 * outbox receipt before the shared version service may advance current.
 */
export async function preflightVisualCandidateAcceptance(
  request: VisualDocumentRevisionDecisionRequest
): Promise<Readonly<{
  paths: VisualDocumentPaths
  document: VisualDocument
  artifact: VisualArtifact
  candidate: VisualRevision
  index: number
  acceptanceState: VisualAcceptanceReceipt['state']
  newlyPrepared: boolean
  committedVersionRef?: ArtifactVersionRefV1
  alreadyAccepted?: VisualDocumentRevisionDecisionResult
}>> {
  const { paths, document } = await loadRequiredDocument(request.workspaceRoot, request.documentId)
  if (!document.artifact) throw new Error('VisualDocument has no artifact.')
  const index = document.revisions.findIndex((revision) => revision.id === request.revisionId)
  const candidate = document.revisions[index]
  const receipt = await readAcceptanceReceipt(paths, request.revisionId)

  if (candidate?.status === 'accepted' && document.acceptedRevisionId === request.revisionId) {
    if (document.activeCandidateRevisionId !== null) {
      throw new Error('Accepted Visual Review document still has an active candidate.')
    }
    if (candidate.versionRef && document.artifact.versionRef
      && !sameArtifactVersionRef(candidate.versionRef, document.artifact.versionRef)) {
      throw new Error('Accepted revision and document artifact bind different ArtifactVersionRefs.')
    }
    if (receipt) {
      assertAcceptanceReceiptMatches(
        receipt,
        paths,
        document,
        candidate,
        document.artifact,
        true
      )
      if (receipt.artifactVersionRef && candidate.versionRef
        && !sameArtifactVersionRef(receipt.artifactVersionRef, candidate.versionRef)) {
        throw new Error('Completed acceptance receipt binds a different ArtifactVersionRef.')
      }
      if (!(await exists(receipt.backupPath))
        || await hashFile(receipt.backupPath) !== receipt.sourceHash
        || await hashFile(document.artifact.sourcePath) !== candidate.artifactHash
        || await hashFile(document.artifact.workingCopyPath) !== candidate.artifactHash) {
        throw new Error('Completed Visual Review acceptance files are missing or corrupt.')
      }
      if (receipt.state !== 'completed') {
        await writeAcceptanceReceipt(paths, {
          ...receipt,
          state: 'completed',
          ...(candidate.versionRef ? { artifactVersionRef: candidate.versionRef } : {}),
          completedAt: candidate.decidedAt ?? now()
        })
      }
    }
    const alreadyAccepted: VisualDocumentRevisionDecisionResult = {
      ok: true,
      status: 'accepted',
      revision: candidate,
      document
    }
    return {
      paths,
      document,
      artifact: document.artifact,
      candidate,
      index,
      acceptanceState: 'completed',
      newlyPrepared: false,
      ...(candidate.versionRef ? { committedVersionRef: candidate.versionRef } : {}),
      alreadyAccepted
    }
  }

  if (document.activeCandidateRevisionId !== request.revisionId) {
    throw new Error('Only the active candidate can be accepted.')
  }
  if (!candidate || candidate.status !== 'candidate') throw new Error('Candidate revision not found.')
  if (candidate.basedOnHash !== document.artifact.workingCopyHash) throw new Error('Candidate is stale.')
  if (await hashFile(candidate.artifactPath) !== candidate.artifactHash) {
    throw new Error('Candidate artifact changed after creation.')
  }
  if (candidate.artifactHash !== candidate.reviewEvidence.reviewedArtifactHash) {
    throw new Error('Candidate no longer matches the reviewed artifact hash.')
  }

  if (receipt) {
    if (receipt.state === 'completed') {
      throw new Error('Completed acceptance receipt cannot target an active candidate.')
    }
    assertAcceptanceReceiptMatches(receipt, paths, document, candidate, document.artifact)
    await assertRecoverableAcceptanceFiles(receipt, document.artifact)
    return {
      paths,
      document,
      artifact: document.artifact,
      candidate,
      index,
      acceptanceState: receipt.state,
      newlyPrepared: false,
      ...(receipt.artifactVersionRef
        ? { committedVersionRef: receipt.artifactVersionRef }
        : {})
    }
  }

  if (await hashFile(document.artifact.sourcePath) !== document.artifact.sourceHash) {
    throw new Error('Source artifact changed outside SciForge; refusing to overwrite it.')
  }
  if (await hashFile(document.artifact.workingCopyPath) !== document.artifact.workingCopyHash) {
    throw new Error('Working copy changed outside SciForge; refusing to accept the candidate.')
  }
  const backupPath = acceptanceBackupPath(
    paths,
    candidate.id,
    document.artifact.sourcePath
  )
  if (await exists(backupPath)) {
    if (await hashFile(backupPath) !== document.artifact.sourceHash) {
      throw new Error('Prepared acceptance backup does not match the source artifact.')
    }
  } else {
    await atomicCopy(document.artifact.sourcePath, backupPath)
  }
  const prepared: VisualAcceptanceReceipt = {
    schemaVersion: ACCEPTANCE_RECEIPT_SCHEMA_VERSION,
    documentId: document.documentId,
    revisionId: candidate.id,
    state: 'prepared',
    candidateHash: candidate.artifactHash,
    sourceHash: document.artifact.sourceHash,
    workingCopyHash: document.artifact.workingCopyHash,
    backupPath,
    preparedAt: now()
  }
  await writeAcceptanceReceipt(paths, prepared)
  return {
    paths,
    document,
    artifact: document.artifact,
    candidate,
    index,
    acceptanceState: 'prepared',
    newlyPrepared: true
  }
}

function assertAcceptanceReceiptMatches(
  receipt: VisualAcceptanceReceipt,
  paths: VisualDocumentPaths,
  document: VisualDocument,
  candidate: VisualRevision,
  artifact: VisualArtifact,
  accepted = false
): void {
  const expectedBackupPath = acceptanceBackupPath(paths, candidate.id, artifact.sourcePath)
  if (receipt.documentId !== document.documentId
    || receipt.revisionId !== candidate.id
    || receipt.candidateHash !== candidate.artifactHash
    || (accepted
      ? artifact.sourceHash !== candidate.artifactHash
        || artifact.workingCopyHash !== candidate.artifactHash
      : receipt.sourceHash !== artifact.sourceHash
        || receipt.workingCopyHash !== artifact.workingCopyHash)
    || receipt.backupPath !== expectedBackupPath) {
    throw new Error('Visual Review acceptance receipt does not match the candidate state.')
  }
}

async function assertRecoverableAcceptanceFiles(
  receipt: VisualAcceptanceReceipt,
  artifact: VisualArtifact
): Promise<void> {
  if (!(await exists(receipt.backupPath)) || await hashFile(receipt.backupPath) !== receipt.sourceHash) {
    throw new Error('Visual Review acceptance backup is missing or corrupt.')
  }
  const sourceHash = await hashFile(artifact.sourcePath)
  if (sourceHash !== receipt.sourceHash && sourceHash !== receipt.candidateHash) {
    throw new Error('Source artifact has an unexpected hash during acceptance recovery.')
  }
  const workingCopyHash = await hashFile(artifact.workingCopyPath)
  if (workingCopyHash !== receipt.workingCopyHash && workingCopyHash !== receipt.candidateHash) {
    throw new Error('Working copy has an unexpected hash during acceptance recovery.')
  }
}

/**
 * Clears a prepared receipt only when the caller knows no external version was
 * committed. Receipts with uncertain or confirmed commit state are retained so
 * the accept operation must be replayed to completion.
 */
export async function abortPreparedVisualCandidateAcceptance(
  request: VisualDocumentRevisionDecisionRequest
): Promise<void> {
  const { paths, document } = await loadRequiredDocument(request.workspaceRoot, request.documentId)
  const receipt = await readAcceptanceReceipt(paths, request.revisionId)
  if (!receipt) return
  if (receipt.state !== 'prepared') {
    throw new Error('Cannot abort an acceptance receipt after its ArtifactVersion was recorded.')
  }
  if (!document.artifact || document.activeCandidateRevisionId !== request.revisionId) {
    throw new Error('Cannot abort an acceptance receipt outside its active candidate.')
  }
  const candidate = document.revisions.find(({ id }) => id === request.revisionId)
  if (!candidate || candidate.status !== 'candidate') {
    throw new Error('Cannot abort an acceptance receipt without its active candidate.')
  }
  assertAcceptanceReceiptMatches(receipt, paths, document, candidate, document.artifact)
  if (await hashFile(document.artifact.sourcePath) !== receipt.sourceHash
    || await hashFile(document.artifact.workingCopyPath) !== receipt.workingCopyHash) {
    throw new Error('Cannot abort after local acceptance replacement may have started.')
  }
  await unlink(acceptanceReceiptPath(paths, request.revisionId))
}

export async function rejectVisualCandidateRevision(
  request: VisualDocumentRevisionDecisionRequest
): Promise<VisualDocumentRevisionDecisionResult> {
  const { paths, document } = await loadRequiredDocument(request.workspaceRoot, request.documentId)
  if (await readAcceptanceReceipt(paths, request.revisionId)) {
    throw new Error('Candidate has a pending acceptance receipt; retry acceptance before rejecting it.')
  }
  if (document.activeCandidateRevisionId !== request.revisionId) throw new Error('Only the active candidate can be rejected.')
  const index = document.revisions.findIndex((revision) => revision.id === request.revisionId)
  const candidate = document.revisions[index]
  if (!candidate || candidate.status !== 'candidate') throw new Error('Candidate revision not found.')
  const rejected: VisualRevision = { ...candidate, status: 'rejected', decidedAt: now() }
  const updated: VisualDocument = {
    ...document,
    revisions: document.revisions.map((revision, revisionIndex) => revisionIndex === index ? rejected : revision),
    activeCandidateRevisionId: null,
    updatedAt: rejected.decidedAt!
  }
  await writeDocument(paths.documentPath, updated)
  return { ok: true, status: 'rejected', revision: rejected, document: updated }
}
