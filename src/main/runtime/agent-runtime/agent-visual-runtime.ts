import { createHash, createHmac, randomBytes } from 'node:crypto'
import { constants } from 'node:fs'
import {
  copyFile,
  lstat,
  mkdir,
  open,
  realpath,
  stat,
  unlink,
  writeFile
} from 'node:fs/promises'
import { dirname, join, relative, resolve } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import {
  VISUAL_SOURCE_MAX_FRAME_BYTES,
  type VisualFrame
} from '@sciforge/domain-sdk/visual-source'
import {
  agentVisualCaptureInputSchema,
  agentVisualCaptureOutputSchema,
  agentVisualLookInputSchema,
  agentVisualLookOutputSchema,
  type AgentVisualCaptureInput,
  type AgentVisualCaptureOutput,
  type AgentVisualLookInput,
  type AgentVisualLookOutput
} from '../../../shared/agent-visual'
import type { CapabilityCallerContext } from '../../../shared/capability-broker'
import type {
  NormalizedVisualRegion,
  VisualInspectionRequest,
  VisualInspector
} from '../../../../packages/workers/workspace-intel/src/visual-inspection'
import type {
  VisibleContextCapturedFrame,
  VisibleContextService
} from '../../services/visible-context-service'

const VISUAL_ASSET_DIRECTORY_SEGMENTS = ['.sciforge', 'visual-assets'] as const
const MAX_TRACKED_SNAPSHOTS = 512
const MAX_TRACKED_REGIONS = 4_096
const MAX_TRACKED_ARTIFACTS = 512
const MAX_TRACKED_PROOFS = 1_024
const MAX_CAPTURE_BYTES = VISUAL_SOURCE_MAX_FRAME_BYTES

export type AgentVisualRuntimeRequestContext = Readonly<{
  runtimeId: string
  threadId?: string
  turnId?: string
  workspaceId?: string
}>

export type AgentVisualRuntimeCallContext = Readonly<{
  caller: CapabilityCallerContext
  request: AgentVisualRuntimeRequestContext
  signal: AbortSignal
}>

export type AgentVisualManagedFrame = Readonly<{
  path: string
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp'
  width: number
  height: number
  capturedAt?: string
  sourceRevision?: string
}>

export type AgentVisualBytesFrame = VisualFrame

export type AgentVisualResolvedFrame = AgentVisualManagedFrame | AgentVisualBytesFrame

export type AgentVisualResourceResolver = (
  input: Readonly<{
    sourceRef: string
    targetRef?: string
    frame?: number
    caller: CapabilityCallerContext
    signal: AbortSignal
  }>
) => Promise<AgentVisualResolvedFrame>

export type AgentVisualRuntimeOptions = Readonly<{
  visibleContext: Pick<VisibleContextService, 'currentSurface' | 'captureFrame'>
  visualInspector: () => VisualInspector | undefined | Promise<VisualInspector | undefined>
  resolveResourceFrame?: AgentVisualResourceResolver
  frameDirectory?: string
  now?: () => Date
  secret?: Uint8Array
}>

type VisualScope = Readonly<{
  callerId: string
  workspaceRoot: string
  turnKey: string
}>

type SnapshotRecord = {
  ref: string
  scope: VisualScope
  path: string
  mimeType: AgentVisualResolvedFrame['mimeType']
  width: number
  height: number
  sourceSha256: string
  sourceRevision?: string
  latestProofRef?: string
}

type RegionRecord = {
  ref: string
  scope: VisualScope
  snapshotRef: string
  proofRef: string
  region: NormalizedVisualRegion
}

type ArtifactRecord = {
  ref: string
  scope: VisualScope
  path: string
  relativePath: string
  mimeType: 'image/png'
  width: number
  height: number
  sha256: string
  captureProofRef: string
}

type LookProofRecord = {
  ref: string
  scope: VisualScope
  snapshotRef: string
}

export class AgentVisualRuntime {
  private readonly now: () => Date
  private readonly secret: Uint8Array
  private readonly snapshots = new Map<string, SnapshotRecord>()
  private readonly regions = new Map<string, RegionRecord>()
  private readonly artifacts = new Map<string, ArtifactRecord>()
  private readonly lookProofs = new Map<string, LookProofRecord>()

  constructor(private readonly options: AgentVisualRuntimeOptions) {
    this.now = options.now ?? (() => new Date())
    this.secret = options.secret ?? randomBytes(32)
  }

  async look(
    rawInput: AgentVisualLookInput,
    context: AgentVisualRuntimeCallContext
  ): Promise<AgentVisualLookOutput> {
    const input = agentVisualLookInputSchema.parse(rawInput)
    const scope = visualScope(context)
    throwIfAborted(context.signal)

    const resolved = await this.resolveLookFrame(input, scope, context)
    throwIfAborted(context.signal)
    const frame = await this.materializeFrame(resolved.frame)
    const sourceBytes = await readBoundedImage(frame.path)
    const actualMimeType = detectSupportedImageMimeType(sourceBytes)
    if (actualMimeType !== frame.mimeType) {
      throw new Error('The visual source MIME type does not match its trusted frame metadata.')
    }
    const sourceSha256 = sha256(sourceBytes)
    const sourceImage = await loadImage(sourceBytes)
    if (sourceImage.width !== frame.width || sourceImage.height !== frame.height) {
      throw new Error('The visual source dimensions do not match its trusted frame metadata.')
    }
    if (resolved.snapshot && resolved.snapshot.sourceSha256 !== sourceSha256) {
      throw new Error('The visual snapshot changed after it was observed; call look again on the current source.')
    }

    const inspector = await this.options.visualInspector()
    if (!inspector) throw new Error('Visual understanding is unavailable.')
    const inspection = await inspector(visualInspectionRequest(input, frame.path, frame.mimeType))
    throwIfAborted(context.signal)
    if (inspection.status !== 'inspected') throw new Error(inspection.message)
    const inspectedArtifact = inspection.artifacts.find((artifact) => artifact.id === 'source')
    if (!inspectedArtifact || inspectedArtifact.sha256 !== sourceSha256) {
      throw new Error('The visual inspector did not attest the immutable source snapshot.')
    }
    if (!inspection.claims.some((claim) => claim.artifactId === 'source')) {
      throw new Error('The visual inspector returned no grounded evidence for the immutable source snapshot.')
    }
    const snapshot = resolved.snapshot ?? this.createSnapshot(
      scope,
      frame,
      sourceSha256,
      input.sourceRef
    )

    const proofRef = this.opaqueRef('visual_proof', [
      scopeKey(scope),
      snapshot.ref,
      inspection.attestation,
      randomBytes(16).toString('base64url')
    ])
    this.lookProofs.set(proofRef, {
      ref: proofRef,
      scope,
      snapshotRef: snapshot.ref
    })
    snapshot.latestProofRef = proofRef

    const regions: AgentVisualLookOutput['regions'] = []
    const claims: AgentVisualLookOutput['evidence']['claims'] = inspection.claims.map((claim, index) => {
      const region = normalizeClaimRegion(claim.region)
      if (!region) {
        return {
          kind: claim.kind,
          text: claim.text,
          confidence: claim.confidence
        }
      }
      const regionRef = this.opaqueRef('region', [
        scopeKey(scope),
        snapshot.ref,
        proofRef,
        String(index),
        stableRegion(region)
      ])
      this.regions.set(regionRef, {
        ref: regionRef,
        scope,
        snapshotRef: snapshot.ref,
        proofRef,
        region
      })
      regions.push({
        regionRef,
        label: claim.text.slice(0, 512),
        confidence: claim.confidence
      })
      return {
        kind: claim.kind,
        text: claim.text,
        regionRef,
        confidence: claim.confidence
      }
    })

    this.pruneTrackedRecords()
    return agentVisualLookOutputSchema.parse({
      snapshotRef: snapshot.ref,
      regions,
      evidence: {
        summary: inspection.summary,
        claims,
        uncertainties: inspection.uncertainties,
        ...(inspection.structuredResult !== undefined
          ? { structuredResult: inspection.structuredResult }
          : {})
      },
      proof: {
        schema: 'sciforge.visual-proof.v1',
        kind: 'look',
        status: 'verified',
        proofRef,
        ...(input.sourceRef ? { sourceRef: input.sourceRef } : {}),
        ...(resolved.parentProofRef ? { parentProofRef: resolved.parentProofRef } : {}),
        snapshotRef: snapshot.ref,
        provider: 'model-router',
        attestation: inspection.attestation,
        createdAt: this.now().toISOString()
      }
    })
  }

  async capture(
    rawInput: AgentVisualCaptureInput,
    context: AgentVisualRuntimeCallContext
  ): Promise<AgentVisualCaptureOutput> {
    const input = agentVisualCaptureInputSchema.parse(rawInput)
    const scope = visualScope(context)
    throwIfAborted(context.signal)

    const snapshot = this.requireSnapshot(input.snapshotRef, scope)
    const region = input.regionRef
      ? this.requireRegion(input.regionRef, snapshot.ref, scope)
      : undefined
    const inspectionProofRef = region?.proofRef ?? snapshot.latestProofRef
    if (!inspectionProofRef) {
      throw new Error('The visual snapshot has no verified look proof in this turn.')
    }
    const lookProof = this.lookProofs.get(inspectionProofRef)
    if (!lookProof || !sameScope(lookProof.scope, scope) || lookProof.snapshotRef !== snapshot.ref) {
      throw new Error('The visual inspection proof is unavailable for this caller, workspace, or turn.')
    }

    const currentBytes = await readBoundedImage(snapshot.path)
    if (sha256(currentBytes) !== snapshot.sourceSha256) {
      throw new Error('The visual snapshot changed after inspection; call look again before capture.')
    }
    const rendered = await renderCapturePng(snapshot, currentBytes, region?.region)
    throwIfAborted(context.signal)
    const digest = sha256(rendered.bytes)
    const persisted = await persistVisualAsset(scope.workspaceRoot, digest, rendered.bytes)
    const artifactRef = this.opaqueRef('artifact', [
      scopeKey(scope),
      persisted.relativePath,
      digest
    ])
    const proofRef = this.opaqueRef('visual_proof', [
      scopeKey(scope),
      inspectionProofRef,
      artifactRef,
      randomBytes(16).toString('base64url')
    ])
    this.artifacts.set(artifactRef, {
      ref: artifactRef,
      scope,
      path: persisted.path,
      relativePath: persisted.relativePath,
      mimeType: 'image/png',
      width: rendered.width,
      height: rendered.height,
      sha256: digest,
      captureProofRef: proofRef
    })
    this.pruneTrackedRecords()
    return agentVisualCaptureOutputSchema.parse({
      artifactRef,
      relativePath: persisted.relativePath,
      mimeType: 'image/png',
      width: rendered.width,
      height: rendered.height,
      size: rendered.bytes.byteLength,
      sha256: digest,
      changed: persisted.changed,
      proof: {
        schema: 'sciforge.visual-proof.v1',
        kind: 'capture',
        status: 'persisted',
        proofRef,
        inspectionProofRef,
        snapshotRef: snapshot.ref,
        ...(region ? { regionRef: region.ref } : {}),
        artifactRef,
        sha256: digest,
        cropped: Boolean(region),
        createdAt: this.now().toISOString()
      }
    })
  }

  private async resolveLookFrame(
    input: AgentVisualLookInput,
    scope: VisualScope,
    context: AgentVisualRuntimeCallContext
  ): Promise<{ frame: AgentVisualResolvedFrame; snapshot?: SnapshotRecord; parentProofRef?: string }> {
    const sourceRef = input.sourceRef
    if (!sourceRef) {
      const current = await this.options.visibleContext.currentSurface(scope.callerId)
      if (current.workspaceId && resolve(current.workspaceId) !== scope.workspaceRoot) {
        throw new Error('The current visual surface belongs to a different workspace.')
      }
      const frame = await this.options.visibleContext.captureFrame(current.resourceId, {
        ...(input.targetRef ? { targetRef: input.targetRef } : {})
      })
      return { frame }
    }
    if (sourceRef.startsWith('snapshot_')) {
      if (input.frame) throw new Error('A stored snapshot cannot select another visual frame.')
      if (input.targetRef) throw new Error('A stored snapshot cannot be combined with a live surface target.')
      const snapshot = this.requireSnapshot(sourceRef, scope)
      return { frame: frameFromSnapshot(snapshot), snapshot }
    }
    if (sourceRef.startsWith('artifact_')) {
      if (input.frame) throw new Error('A persisted visual artifact cannot select another visual frame.')
      if (input.targetRef) throw new Error('A persisted visual artifact cannot be combined with a live surface target.')
      const artifact = this.requireArtifact(sourceRef, scope)
      return {
        frame: {
          path: artifact.path,
          mimeType: artifact.mimeType,
          width: artifact.width,
          height: artifact.height
        },
        parentProofRef: artifact.captureProofRef
      }
    }
    const resolveResourceFrame = this.options.resolveResourceFrame
    if (!resolveResourceFrame) {
      throw new Error('No visual source provider is available for this resource reference.')
    }
    return {
      frame: await resolveResourceFrame({
        sourceRef,
        ...(input.targetRef ? { targetRef: input.targetRef } : {}),
        ...(input.frame ? { frame: input.frame } : {}),
        caller: context.caller,
        signal: context.signal
      })
    }
  }

  private createSnapshot(
    scope: VisualScope,
    frame: AgentVisualManagedFrame,
    sourceSha256: string,
    sourceIdentity?: string
  ): SnapshotRecord {
    const ref = this.opaqueRef('snapshot', [
      scopeKey(scope),
      sourceIdentity ?? 'current-surface',
      frame.sourceRevision ?? '',
      sourceSha256,
      randomBytes(16).toString('base64url')
    ])
    const snapshot: SnapshotRecord = {
      ref,
      scope,
      path: frame.path,
      mimeType: frame.mimeType,
      width: frame.width,
      height: frame.height,
      sourceSha256,
      ...(frame.sourceRevision ? { sourceRevision: frame.sourceRevision } : {})
    }
    this.snapshots.set(ref, snapshot)
    return snapshot
  }

  private requireSnapshot(ref: string, scope: VisualScope): SnapshotRecord {
    const snapshot = this.snapshots.get(ref)
    if (!snapshot || !sameScope(snapshot.scope, scope)) {
      throw new Error('The visual snapshot is unavailable for this caller, workspace, or turn.')
    }
    return snapshot
  }

  private requireRegion(ref: string, snapshotRef: string, scope: VisualScope): RegionRecord {
    const region = this.regions.get(ref)
    if (!region || !sameScope(region.scope, scope) || region.snapshotRef !== snapshotRef) {
      throw new Error('The visual region is unavailable for this snapshot, caller, workspace, or turn.')
    }
    return region
  }

  private requireArtifact(ref: string, scope: VisualScope): ArtifactRecord {
    const artifact = this.artifacts.get(ref)
    if (!artifact || !sameScope(artifact.scope, scope)) {
      throw new Error('The visual artifact is unavailable for this caller, workspace, or turn.')
    }
    return artifact
  }

  private async materializeFrame(frame: AgentVisualResolvedFrame): Promise<AgentVisualManagedFrame> {
    if ('path' in frame) return frame
    const sourceRevision = frame.sourceRevision.trim()
    if (!sourceRevision) throw new Error('Visual source frames require a source revision.')
    if (!this.options.frameDirectory?.trim()) {
      throw new Error('Visual frame materialization is unavailable because no managed frame directory is configured.')
    }
    const prepared = await prepareProviderFrame(frame)
    const directory = await createManagedFrameDirectory(this.options.frameDirectory)
    const digest = sha256(prepared.bytes)
    const path = join(directory, `frame-${digest}.${imageExtension(prepared.mimeType)}`)
    await writeContentAddressedFile(path, digest, prepared.bytes)
    return {
      path,
      mimeType: prepared.mimeType,
      width: prepared.width,
      height: prepared.height,
      sourceRevision
    }
  }

  private opaqueRef(prefix: 'snapshot' | 'region' | 'artifact' | 'visual_proof', parts: readonly string[]): string {
    return `${prefix}_${createHmac('sha256', this.secret).update(parts.join('\u0000')).digest('base64url')}`
  }

  private pruneTrackedRecords(): void {
    pruneMap(this.snapshots, MAX_TRACKED_SNAPSHOTS)
    pruneMap(this.regions, MAX_TRACKED_REGIONS)
    pruneMap(this.artifacts, MAX_TRACKED_ARTIFACTS)
    pruneMap(this.lookProofs, MAX_TRACKED_PROOFS)
  }
}

function visualScope(context: AgentVisualRuntimeCallContext): VisualScope {
  const callerId = context.caller.callerId.trim()
  const workspaceId = (context.caller.workspaceId ?? context.request.workspaceId)?.trim()
  const runtimeId = context.request.runtimeId.trim()
  const threadId = context.request.threadId?.trim() ?? ''
  const turnId = context.request.turnId?.trim()
  if (!callerId) throw new Error('Visual operations require a caller identity.')
  if (!workspaceId) throw new Error('Visual operations require a workspace.')
  if (!runtimeId || !turnId) throw new Error('Visual operations require a runtime and turn identity.')
  return {
    callerId,
    workspaceRoot: resolve(workspaceId),
    turnKey: `${runtimeId}\u0000${threadId}\u0000${turnId}`
  }
}

function visualInspectionRequest(
  input: AgentVisualLookInput,
  imagePath: string,
  mimeType: AgentVisualResolvedFrame['mimeType']
): VisualInspectionRequest {
  return {
    task: input.task,
    artifacts: [{ id: 'source', imagePath, mimeType }],
    ...(input.intent
      ? {
          outputIntent: {
            kind: inspectionIntent(input.intent)
          }
        }
      : {})
  }
}

function inspectionIntent(
  intent: NonNullable<AgentVisualLookInput['intent']>
): NonNullable<VisualInspectionRequest['outputIntent']>['kind'] {
  switch (intent) {
    case 'describe': return 'description'
    case 'ocr': return 'ocr'
    case 'locate': return 'structured-extraction'
    case 'quality-review': return 'quality-review'
  }
}

function normalizeClaimRegion(region: NormalizedVisualRegion | undefined): NormalizedVisualRegion | undefined {
  if (!region) return undefined
  if (![region.x, region.y, region.width, region.height].every(Number.isFinite)) return undefined
  if (
    region.x < 0 ||
    region.y < 0 ||
    region.width <= 0 ||
    region.height <= 0 ||
    region.x + region.width > 1 ||
    region.y + region.height > 1
  ) {
    return undefined
  }
  return { ...region }
}

function frameFromSnapshot(snapshot: SnapshotRecord): AgentVisualResolvedFrame {
  return {
    path: snapshot.path,
    mimeType: snapshot.mimeType,
    width: snapshot.width,
    height: snapshot.height,
    ...(snapshot.sourceRevision ? { sourceRevision: snapshot.sourceRevision } : {})
  }
}

async function renderCapturePng(
  snapshot: SnapshotRecord,
  sourceBytes: Buffer,
  region?: NormalizedVisualRegion
): Promise<{ bytes: Buffer; width: number; height: number }> {
  const image = await loadImage(sourceBytes)
  if (image.width !== snapshot.width || image.height !== snapshot.height) {
    throw new Error('The visual snapshot dimensions changed after inspection.')
  }
  if (!region && snapshot.mimeType === 'image/png') {
    return { bytes: sourceBytes, width: image.width, height: image.height }
  }
  const crop = region
    ? pixelRegion(region, image.width, image.height)
    : { x: 0, y: 0, width: image.width, height: image.height }
  const canvas = createCanvas(crop.width, crop.height)
  canvas.getContext('2d').drawImage(
    image,
    crop.x,
    crop.y,
    crop.width,
    crop.height,
    0,
    0,
    crop.width,
    crop.height
  )
  return {
    bytes: canvas.encodeSync('png'),
    width: crop.width,
    height: crop.height
  }
}

async function prepareProviderFrame(
  frame: AgentVisualBytesFrame
): Promise<{ bytes: Buffer; mimeType: AgentVisualManagedFrame['mimeType']; width: number; height: number }> {
  const bytes = boundedFrameBytes(frame.bytes)
  const actualMimeType = detectSupportedImageMimeType(bytes)
  if (actualMimeType !== frame.mimeType) {
    throw new Error('The visual source MIME type does not match the supplied frame bytes.')
  }
  const image = await loadImage(bytes)
  if (image.width !== frame.width || image.height !== frame.height) {
    throw new Error('The visual source dimensions do not match the supplied frame bytes.')
  }
  const redactions = (frame.redactions ?? []).map((region) => {
    const normalized = normalizeClaimRegion(region)
    if (!normalized) throw new Error('Visual source redactions must use normalized in-bounds regions.')
    return normalized
  })
  if (redactions.length === 0) {
    return {
      bytes,
      mimeType: frame.mimeType,
      width: image.width,
      height: image.height
    }
  }
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  context.fillStyle = '#000000'
  for (const region of redactions) {
    const crop = pixelRegion(region, image.width, image.height)
    context.fillRect(crop.x, crop.y, crop.width, crop.height)
  }
  return {
    bytes: canvas.encodeSync('png'),
    mimeType: 'image/png',
    width: image.width,
    height: image.height
  }
}

function pixelRegion(
  region: NormalizedVisualRegion,
  width: number,
  height: number
): { x: number; y: number; width: number; height: number } {
  const x = Math.max(0, Math.min(width - 1, Math.floor(region.x * width)))
  const y = Math.max(0, Math.min(height - 1, Math.floor(region.y * height)))
  const right = Math.max(x + 1, Math.min(width, Math.ceil((region.x + region.width) * width)))
  const bottom = Math.max(y + 1, Math.min(height, Math.ceil((region.y + region.height) * height)))
  return { x, y, width: right - x, height: bottom - y }
}

async function persistVisualAsset(
  workspaceRoot: string,
  digest: string,
  bytes: Buffer
): Promise<{ path: string; relativePath: string; changed: boolean }> {
  const canonicalWorkspace = await canonicalWorkspaceRoot(workspaceRoot)
  const directory = await createManagedAssetDirectory(canonicalWorkspace)
  const path = join(directory, `${digest}.png`)
  const relativePath = relative(canonicalWorkspace, path).replaceAll('\\', '/')
  const changed = await writeContentAddressedFile(path, digest, bytes)
  return { path, relativePath, changed }
}

async function canonicalWorkspaceRoot(workspaceRoot: string): Promise<string> {
  const canonical = await realpath(workspaceRoot)
  const info = await stat(canonical)
  if (!info.isDirectory()) throw new Error('The visual workspace root is not a directory.')
  return canonical
}

async function createManagedAssetDirectory(workspaceRoot: string): Promise<string> {
  const requested = join(workspaceRoot, ...VISUAL_ASSET_DIRECTORY_SEGMENTS)
  await assertNoSymlinkPath(workspaceRoot, VISUAL_ASSET_DIRECTORY_SEGMENTS)
  const existingAncestor = await nearestExistingAncestor(requested, workspaceRoot)
  const existingInfo = await lstat(existingAncestor)
  if (existingInfo.isSymbolicLink()) {
    throw new Error('The visual asset directory cannot traverse a symbolic link.')
  }
  const canonicalAncestor = await realpath(existingAncestor)
  if (!isWithinRoot(workspaceRoot, canonicalAncestor)) {
    throw new Error('The visual asset directory resolves outside the workspace.')
  }
  await mkdir(requested, { recursive: true })
  await assertNoSymlinkPath(workspaceRoot, VISUAL_ASSET_DIRECTORY_SEGMENTS)
  const canonical = await realpath(requested)
  if (!isWithinRoot(workspaceRoot, canonical)) {
    throw new Error('The visual asset directory resolves outside the workspace.')
  }
  return canonical
}

async function createManagedFrameDirectory(input: string): Promise<string> {
  const requested = resolve(input)
  await mkdir(requested, { recursive: true })
  const info = await lstat(requested)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error('The managed visual frame path is not a regular directory.')
  }
  return realpath(requested)
}

async function assertNoSymlinkPath(
  workspaceRoot: string,
  segments: readonly string[]
): Promise<void> {
  let current = workspaceRoot
  for (const segment of segments) {
    current = join(current, segment)
    try {
      const info = await lstat(current)
      if (info.isSymbolicLink()) {
        throw new Error('The visual asset directory cannot traverse a symbolic link.')
      }
      if (!info.isDirectory()) {
        throw new Error('The visual asset directory path contains a non-directory entry.')
      }
    } catch (error) {
      if (isNodeErrorCode(error, 'ENOENT')) return
      throw error
    }
  }
}

async function nearestExistingAncestor(path: string, workspaceRoot: string): Promise<string> {
  let current = path
  while (isWithinRoot(workspaceRoot, current)) {
    try {
      await lstat(current)
      return current
    } catch (error) {
      if (!isNodeErrorCode(error, 'ENOENT')) throw error
    }
    const parent = dirname(current)
    if (parent === current) break
    current = parent
  }
  throw new Error('The visual asset directory has no existing workspace ancestor.')
}

async function readExistingContentAddressedFile(path: string, digest: string): Promise<boolean> {
  try {
    await requireContentAddressedFile(path, digest)
    return true
  } catch (error) {
    if (isNodeErrorCode(error, 'ENOENT')) return false
    throw error
  }
}

async function writeContentAddressedFile(path: string, digest: string, bytes: Buffer): Promise<boolean> {
  const existing = await readExistingContentAddressedFile(path, digest)
  if (existing) return false

  const temporaryPath = join(dirname(path), `.${digest}.${randomBytes(12).toString('hex')}.tmp`)
  await writeFile(temporaryPath, bytes, { flag: 'wx' })
  try {
    try {
      await copyFile(temporaryPath, path, constants.COPYFILE_EXCL)
      return true
    } catch (error) {
      if (!isNodeErrorCode(error, 'EEXIST')) throw error
      await requireContentAddressedFile(path, digest)
      return false
    }
  } finally {
    await unlink(temporaryPath).catch(() => undefined)
  }
}

async function requireContentAddressedFile(path: string, digest: string): Promise<void> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) {
    throw new Error('The content-addressed visual asset path is not a regular managed file.')
  }
  const bytes = await readBoundedImage(path)
  if (sha256(bytes) !== digest) {
    throw new Error('The content-addressed visual asset does not match its digest.')
  }
}

async function readBoundedImage(path: string): Promise<Buffer> {
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0))
  try {
    const info = await handle.stat()
    if (!info.isFile()) {
      throw new Error('The visual source is not a regular file.')
    }
    if (info.size < 1 || info.size > MAX_CAPTURE_BYTES) {
      throw new Error(`The visual source must be between 1 and ${MAX_CAPTURE_BYTES} bytes.`)
    }
    return await handle.readFile()
  } finally {
    await handle.close()
  }
}

function boundedFrameBytes(bytes: Uint8Array): Buffer {
  if (bytes.byteLength < 1 || bytes.byteLength > MAX_CAPTURE_BYTES) {
    throw new Error(`The visual source must be between 1 and ${MAX_CAPTURE_BYTES} bytes.`)
  }
  return Buffer.from(bytes)
}

function detectSupportedImageMimeType(bytes: Uint8Array): AgentVisualManagedFrame['mimeType'] {
  if (
    bytes.byteLength >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a
  ) {
    return 'image/png'
  }
  if (
    bytes.byteLength >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return 'image/jpeg'
  }
  if (
    bytes.byteLength >= 12 &&
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50
  ) {
    return 'image/webp'
  }
  throw new Error('The visual source is not a supported PNG, JPEG, or WebP image.')
}

function imageExtension(mimeType: AgentVisualManagedFrame['mimeType']): 'png' | 'jpg' | 'webp' {
  switch (mimeType) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
  }
}

function scopeKey(scope: VisualScope): string {
  return `${scope.callerId}\u0000${scope.workspaceRoot}\u0000${scope.turnKey}`
}

function sameScope(left: VisualScope, right: VisualScope): boolean {
  return scopeKey(left) === scopeKey(right)
}

function stableRegion(region: NormalizedVisualRegion): string {
  return [region.x, region.y, region.width, region.height].join(',')
}

function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function isWithinRoot(root: string, candidate: string): boolean {
  const path = relative(root, candidate)
  return path === '' || (!path.startsWith('..') && !path.startsWith('/'))
}

function throwIfAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  throw signal.reason instanceof Error ? signal.reason : new Error('The visual operation was aborted.')
}

function isNodeErrorCode(error: unknown, code: string): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && String(error.code) === code)
}

function pruneMap<Key, Value>(map: Map<Key, Value>, limit: number): void {
  while (map.size > limit) {
    const oldest = map.keys().next().value as Key | undefined
    if (oldest === undefined) return
    map.delete(oldest)
  }
}
