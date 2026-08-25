import { createHash } from 'node:crypto'

import {
  CONTENT_SPACE_LIMITS,
  CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,
  ContentSpaceOperationError,
  artifactReferenceSchema,
  contentContainerReferenceSchema,
  contentSpaceExternalBindingAttestationSchema,
  contentSpaceFileDescendantProofEvidenceSchema,
  contentSpaceFileDescendantProofLimitsSchema,
  contentFileReferenceSchema,
  contentSpaceEntryNameSchema,
  contentSpacePageRequestSchema,
  defineContentSpaceProvider,
  type ArtifactReference,
  type ContentContainerReference,
  type ContentEntryReference,
  type ContentFileReference,
  type ContentSpaceCapabilityState,
  type ContentSpaceEntrySummary,
  type ContentSpaceProvider,
  type ContentSpaceProviderFileDescendantProofInput,
  type ContentSpaceProviderOperationContext,
  type ContentSpaceProviderUploadNewReceipt,
  type ContentSpaceProviderWriteContext,
  type ContentSpaceUploadSource,
  type CreateFolderReceipt,
} from '@sciforge/domain-content-space/contract'
import { principalSnapshotSchema } from '@sciforge/domain-sdk/principal'
import { providerInstanceRefSchema } from '@sciforge/domain-sdk/provider-composition'

const CHUNK_BYTES = 64 * 1024
const ROOT_CONTAINER_ID = 'mock_root'

export const LOCAL_MOCK_CONTENT_SPACE_LIMITS = Object.freeze({
  maxNodes: 256,
  maxStoredBytes: 1 * 1024 * 1024,
  maxWriteRecords: 512
})

type FolderNode = Readonly<{
  kind: 'container'
  id: string
  parentId?: string
  name: string
}>
type FileVersion = Readonly<{
  id: string
  bytes: Uint8Array
  digest: string
  modifiedAt: string
}>
type FileNode = Readonly<{
  kind: 'file'
  id: string
  parentId: string
  name: string
  currentVersionId: string
  versions: ReadonlyMap<string, FileVersion>
}>
type StoredNode = FolderNode | FileNode
type WriteReceipt = CreateFolderReceipt | ContentSpaceProviderUploadNewReceipt
type WriteRecord =
  | Readonly<{ status: 'pending' | 'unknown'; fingerprint: string }>
  | Readonly<{ status: 'committed'; fingerprint: string; receipt: WriteReceipt }>

export type LocalMockContentSpaceProviderOptions = Readonly<{
  providerInstanceRef: string
  now?: () => Date
}>

export function createLocalMockContentSpaceProvider(
  options: LocalMockContentSpaceProviderOptions
): ContentSpaceProvider {
  const providerInstanceRef = providerInstanceRefSchema.parse(options.providerInstanceRef)
  const now = options.now ?? (() => new Date())
  const nodes = new Map<string, StoredNode>()
  const writes = new Map<string, WriteRecord>()
  let nextFolderId = 1
  let nextFileId = 1
  let nextVersionId = 1
  let totalFileBytes = 0

  nodes.set(ROOT_CONTAINER_ID, Object.freeze({
    kind: 'container',
    id: ROOT_CONTAINER_ID,
    name: 'Local Content Space'
  }))

  return defineContentSpaceProvider({
    contractVersion: CONTENT_SPACE_PROVIDER_CONTRACT_VERSION,

    async attestExternalBinding(context) {
      assertContext(context, providerInstanceRef, now)
      await assertPrincipalCurrent(context)
      return mockExternalBinding(context, providerInstanceRef)
    },

    async describeCapabilities(context) {
      assertContext(context, providerInstanceRef, now)
      return ALL_CAPABILITIES
    },

    async listContainers({ context, page }) {
      assertContext(context, providerInstanceRef, now)
      const request = contentSpacePageRequestSchema.parse(page)
      return Object.freeze({
        providerInstanceRef,
        ...pageItems([{
          reference: containerReference(providerInstanceRef, ROOT_CONTAINER_ID),
          scope: 'personal' as const,
          label: 'Local Content Space'
        }], request)
      })
    },

    async listEntries({ context, parent, page }) {
      assertContext(context, providerInstanceRef, now)
      const parentReference = assertContainerReference(parent, providerInstanceRef)
      assertFolder(nodes, parentReference.containerId)
      const request = contentSpacePageRequestSchema.parse(page)
      const items = [...nodes.values()]
        .filter((node) => node.parentId === parentReference.containerId)
        .sort((left, right) => compareCanonicalText(left.name, right.name) ||
          compareCanonicalText(left.id, right.id))
        .map((node) => entrySummary(providerInstanceRef, node))
      return Object.freeze({
        parent: parentReference,
        ...pageItems(items, request)
      })
    },

    async observeEntry({ context, reference }) {
      assertContext(context, providerInstanceRef, now)
      const node = resolveNode(nodes, reference, providerInstanceRef)
      if ('immutableVersionId' in reference) {
        const file = assertFile(nodes, reference.fileId)
        const version = file.versions.get(reference.immutableVersionId)
        if (!version || (reference.digest && reference.digest.value !== version.digest)) {
          fail('invalid_reference', 'The immutable file version is unknown or mismatched.')
        }
      }
      return Object.freeze({
        entry: entrySummary(providerInstanceRef, node),
        capabilities: node.kind === 'container'
          ? CONTAINER_CAPABILITIES
          : FILE_CAPABILITIES
      })
    },

    async proveFileDescendant(input) {
      return proveFileDescendant(nodes, input, providerInstanceRef, now)
    },

    async createFolder({ context, parent, name }) {
      assertWriteContext(context, providerInstanceRef, now)
      const parentReference = assertContainerReference(parent, providerInstanceRef)
      assertFolder(nodes, parentReference.containerId)
      const safeName = contentSpaceEntryNameSchema.parse(name)
      const key = writeKey(context)
      const fingerprint = `create-folder:${parentReference.containerId}:${safeName}`
      const prior = priorReceipt(writes, key, fingerprint)
      if (prior) return prior as CreateFolderReceipt
      assertNoCollision(nodes, parentReference.containerId, safeName)
      assertNewWriteCapacity(writes, key)
      if (nodes.size >= LOCAL_MOCK_CONTENT_SPACE_LIMITS.maxNodes) {
        fail('bounds_exceeded', 'The local mock Provider entry capacity is exhausted.')
      }
      writes.set(key, Object.freeze({ status: 'pending', fingerprint }))
      try {
        const id = `mock_folder_${nextFolderId++}`
        nodes.set(id, Object.freeze({
          kind: 'container',
          id,
          parentId: parentReference.containerId,
          name: safeName
        }))
        const receipt = Object.freeze({
          invocationId: context.invocationId,
          parent: parentReference,
          name: safeName,
          reference: containerReference(providerInstanceRef, id)
        })
        writes.set(key, Object.freeze({ status: 'committed', fingerprint, receipt }))
        return receipt
      } catch (error) {
        writes.set(key, Object.freeze({ status: 'unknown', fingerprint }))
        if (error instanceof ContentSpaceOperationError && error.detail.code === 'outcome_unknown') {
          throw error
        }
        fail('outcome_unknown', 'The create-folder outcome cannot be proven.')
      }
    },

    async uploadNewFile({ context, parent, name, source }) {
      assertWriteContext(context, providerInstanceRef, now)
      const parentReference = assertContainerReference(parent, providerInstanceRef)
      assertFolder(nodes, parentReference.containerId)
      const safeName = contentSpaceEntryNameSchema.parse(name)
      const sourceSize = parseSourceSize(source)
      const key = writeKey(context)
      if (!writes.has(key) &&
        totalFileBytes + sourceSize > LOCAL_MOCK_CONTENT_SPACE_LIMITS.maxStoredBytes) {
        fail('bounds_exceeded', 'The local mock Provider byte capacity is exhausted.')
      }
      const bytes = await readUploadSource(source, sourceSize, context.signal)
      assertNotCancelled(context.signal)
      const contentDigest = sha256(bytes)
      const fingerprint = [
        'upload-new',
        parentReference.containerId,
        safeName,
        String(sourceSize),
        contentDigest
      ].join(':')
      const prior = priorReceipt(writes, key, fingerprint)
      if (prior) return prior as ContentSpaceProviderUploadNewReceipt
      assertNoCollision(nodes, parentReference.containerId, safeName)
      assertNewWriteCapacity(writes, key)
      if (nodes.size >= LOCAL_MOCK_CONTENT_SPACE_LIMITS.maxNodes ||
        totalFileBytes + sourceSize > LOCAL_MOCK_CONTENT_SPACE_LIMITS.maxStoredBytes) {
        fail('bounds_exceeded', 'The local mock Provider storage capacity is exhausted.')
      }
      writes.set(key, Object.freeze({ status: 'pending', fingerprint }))
      try {
        const fileId = `mock_file_${nextFileId++}`
        const versionId = `mock_version_${nextVersionId++}`
        const version = Object.freeze({
          id: versionId,
          bytes,
          digest: contentDigest,
          modifiedAt: now().toISOString()
        })
        nodes.set(fileId, Object.freeze({
          kind: 'file',
          id: fileId,
          parentId: parentReference.containerId,
          name: safeName,
          currentVersionId: versionId,
          versions: new Map([[versionId, version]])
        }))
        totalFileBytes += sourceSize
        const reference = fileReference(providerInstanceRef, fileId)
        const observed = entrySummary(providerInstanceRef, assertFile(nodes, fileId))
        if (observed.kind !== 'file' ||
          observed.reference.fileId !== reference.fileId ||
          observed.label !== safeName ||
          observed.size !== sourceSize) {
          fail('outcome_unknown', 'The upload write-after observation does not match the write.')
        }
        const receipt = Object.freeze({
          invocationId: context.invocationId,
          parent: parentReference,
          name: safeName,
          sourceSize,
          reference,
          writeAfterObservation: Object.freeze({
            parent: parentReference,
            reference,
            name: observed.label,
            size: observed.size
          })
        })
        writes.set(key, Object.freeze({ status: 'committed', fingerprint, receipt }))
        return receipt
      } catch (error) {
        writes.set(key, Object.freeze({ status: 'unknown', fingerprint }))
        if (error instanceof ContentSpaceOperationError && error.detail.code === 'outcome_unknown') {
          throw error
        }
        fail('outcome_unknown', 'The upload outcome cannot be proven.')
      }
    },

    async authorizeDownload({ context, reference }) {
      assertWriteContext(context, providerInstanceRef, now)
      await assertPrincipalCurrent(context)
      const parsedReference = assertFileProvider(reference, providerInstanceRef)
      const file = assertFile(nodes, parsedReference.fileId)
      const versionId = 'immutableVersionId' in parsedReference
        ? parsedReference.immutableVersionId
        : file.currentVersionId
      const version = file.versions.get(versionId)
      if (!version || ('digest' in parsedReference && parsedReference.digest &&
        parsedReference.digest.value !== version.digest)) {
        fail('invalid_reference', 'The requested immutable version is unknown or mismatched.')
      }
      let state: 'active' | 'consumed' | 'retired' = 'active'
      return Object.freeze({
        consume: async ({ destination }) => {
          if (state !== 'active') {
            fail('unauthorized', 'The local download authorization is no longer active.')
          }
          state = 'consumed'
          await assertPrincipalCurrent(context)
          assertNotCancelled(context.signal)
          if (!destination || typeof destination.write !== 'function') {
            fail('invalid_input', 'A managed download destination is required.')
          }
          try {
            for (let offset = 0; offset < version.bytes.byteLength; offset += CHUNK_BYTES) {
              assertNotCancelled(context.signal)
              await destination.write(version.bytes.slice(offset, offset + CHUNK_BYTES))
            }
            assertNotCancelled(context.signal)
            await assertPrincipalCurrent(context)
            return Object.freeze({
              invocationId: context.invocationId,
              reference: parsedReference,
              bytesWritten: version.bytes.byteLength,
              digest: Object.freeze({ algorithm: 'sha256' as const, value: version.digest })
            })
          } catch (error) {
            if (error instanceof ContentSpaceOperationError) throw error
            fail('outcome_unknown', 'The local download outcome cannot be proven.')
          }
        },
        retire: async () => {
          if (state === 'active') state = 'retired'
        }
      })
    },

    async resolvePortalTarget({ context, reference }) {
      assertContext(context, providerInstanceRef, now)
      const node = resolveNode(nodes, reference, providerInstanceRef)
      return Object.freeze({
        url: `https://content-space.invalid/portal/${encodeURIComponent(node.id)}`,
        expiresAt: new Date(now().getTime() + 60_000).toISOString()
      })
    },

    async observeImmutableVersion({ context, reference }) {
      assertContext(context, providerInstanceRef, now)
      const parsed = assertFileProvider(reference, providerInstanceRef)
      const file = assertFile(nodes, parsed.fileId)
      const version = file.versions.get(file.currentVersionId)
      if (!version) {
        return Object.freeze({
          proven: false as const,
          reasonCode: 'resource_capability_missing' as const
        })
      }
      // This Provider is intentionally process-local. It can expose a stable
      // version identity while the process is alive, but it cannot promise
      // retention or version-specific retrieval across a restart. Therefore it
      // must never produce the proof required for an ArtifactReference.
      return Object.freeze({
        proven: false as const,
        reasonCode: 'verification_profile_required' as const
      })
    }
  })
}

const ALL_CAPABILITIES: readonly ContentSpaceCapabilityState[] = Object.freeze([
  capability('list-containers'),
  capability('list-entries'),
  capability('observe-entry'),
  capability('create-folder'),
  capability('upload-new'),
  capability('download'),
  capability('portal-target'),
  capability('observe-immutable-version')
])
const CONTAINER_CAPABILITIES = Object.freeze(ALL_CAPABILITIES.filter(({ operation }) =>
  ['list-entries', 'observe-entry', 'create-folder', 'upload-new', 'portal-target']
    .includes(operation)
))
const FILE_CAPABILITIES = Object.freeze(ALL_CAPABILITIES.filter(({ operation }) =>
  ['observe-entry', 'download', 'portal-target', 'observe-immutable-version']
    .includes(operation)
))

function capability(operation: ContentSpaceCapabilityState['operation']): ContentSpaceCapabilityState {
  return Object.freeze({ operation, readiness: 'production_ready', reasonCode: 'available' })
}

function assertContext(
  context: ContentSpaceProviderOperationContext,
  providerInstanceRef: string,
  now: () => Date
): void {
  principalSnapshotSchema.parse(context.principal)
  if (context.providerInstanceRef !== providerInstanceRef) {
    fail('invalid_target', 'The operation target belongs to another Provider Instance.')
  }
  const deadline = Date.parse(context.deadlineAt)
  if (!Number.isFinite(deadline) || deadline <= now().getTime()) {
    fail('cancelled', 'The operation deadline elapsed.')
  }
  assertNotCancelled(context.signal)
}

function assertWriteContext(
  context: ContentSpaceProviderWriteContext,
  providerInstanceRef: string,
  now: () => Date
): void {
  assertContext(context, providerInstanceRef, now)
  if (!(context.signal instanceof AbortSignal) ||
    !/^[A-Za-z0-9][A-Za-z0-9_-]{15,127}$/u.test(context.invocationId)) {
    fail('invalid_input', 'A bounded invocation identity and cancellation signal are required.')
  }
}

async function assertPrincipalCurrent(
  context: ContentSpaceProviderOperationContext
): Promise<void> {
  try {
    await context.assertPrincipalCurrent()
  } catch {
    fail('unauthorized', 'The Principal changed during the local Provider operation.')
  }
  assertNotCancelled(context.signal)
}

function mockExternalBinding(
  context: ContentSpaceProviderOperationContext,
  providerInstanceRef: string
) {
  const principal = principalSnapshotSchema.parse(context.principal)
  return contentSpaceExternalBindingAttestationSchema.parse({
    providerInstanceRef,
    principal,
    externalSubject: createHash('sha256')
      .update(`local-mock-subject\0${providerInstanceRef}\0${JSON.stringify(principal)}`)
      .digest('hex'),
    bindingRevision: createHash('sha256')
      .update(`local-mock-binding-v1\0${providerInstanceRef}`)
      .digest('hex')
  })
}

async function proveFileDescendant(
  nodes: ReadonlyMap<string, StoredNode>,
  input: ContentSpaceProviderFileDescendantProofInput,
  providerInstanceRef: string,
  now: () => Date
) {
  const { context } = input
  assertWriteContext(context, providerInstanceRef, now)
  const root = assertContainerReference(input.root, providerInstanceRef)
  const candidate = contentFileReferenceSchema.parse(input.candidate)
  if (candidate.providerInstanceRef !== providerInstanceRef) {
    fail('invalid_target', 'The candidate file belongs to another Provider Instance.')
  }
  const limits = contentSpaceFileDescendantProofLimitsSchema.parse(input.limits)
  const expectedBinding = contentSpaceExternalBindingAttestationSchema.safeParse(
    context.expectedExternalBinding
  )
  const currentBinding = mockExternalBinding(context, providerInstanceRef)
  if (!expectedBinding.success ||
    JSON.stringify(expectedBinding.data) !== JSON.stringify(currentBinding)) {
    fail('unauthorized', 'The current local Provider binding does not match the expected binding.')
  }

  await assertPrincipalCurrent(context)
  const visited = new Set<string>([candidate.fileId])
  let parentId = assertFile(nodes, candidate.fileId).parentId
  let depth = 1
  while (true) {
    if (visited.has(parentId)) {
      fail('invalid_reference', 'The local Provider hierarchy contains a cycle.')
    }
    visited.add(parentId)
    if (visited.size > limits.maxNodes || depth > limits.maxDepth) {
      fail('bounds_exceeded', 'The local Provider descendant proof exceeded its bounds.')
    }
    if (parentId === root.containerId) break
    const parent = assertFolder(nodes, parentId)
    if (!parent.parentId) {
      fail('invalid_reference', 'The candidate file is not under the authorized root.')
    }
    parentId = parent.parentId
    depth += 1
  }
  await assertPrincipalCurrent(context)
  return contentSpaceFileDescendantProofEvidenceSchema.parse({
    invocationId: context.invocationId,
    providerInstanceRef,
    authority: providerInstanceRef,
    root,
    candidate,
    binding: currentBinding,
    counts: {
      depth,
      pages: 0,
      nodes: visited.size,
      elapsedMs: 0
    },
    provedAt: now().toISOString(),
    cacheable: false,
    portable: false
  })
}

function writeKey(context: ContentSpaceProviderWriteContext): string {
  return `${JSON.stringify(principalSnapshotSchema.parse(context.principal))}\u0000${context.invocationId}`
}

function priorReceipt(
  writes: ReadonlyMap<string, WriteRecord>,
  key: string,
  fingerprint: string
): WriteReceipt | undefined {
  const prior = writes.get(key)
  if (!prior) return undefined
  if (prior.fingerprint !== fingerprint || prior.status !== 'committed') {
    fail('outcome_unknown', 'The invocation identity cannot be safely replayed.')
  }
  return prior.receipt
}

function assertNewWriteCapacity(
  writes: ReadonlyMap<string, WriteRecord>,
  key: string
): void {
  if (!writes.has(key) &&
    writes.size >= LOCAL_MOCK_CONTENT_SPACE_LIMITS.maxWriteRecords) {
    fail('bounds_exceeded', 'The local mock Provider invocation ledger is exhausted.')
  }
}

function parseSourceSize(source: ContentSpaceUploadSource): number {
  if (!Number.isSafeInteger(source.size) || source.size < 0 ||
    source.size > CONTENT_SPACE_LIMITS.maxUploadBytes ||
    typeof source.read !== 'function') {
    fail('bounds_exceeded', 'The upload source exceeds local Provider bounds.')
  }
  return source.size
}

async function readUploadSource(
  source: ContentSpaceUploadSource,
  size: number,
  signal: AbortSignal
): Promise<Uint8Array> {
  const result = new Uint8Array(size)
  for (let offset = 0; offset < size;) {
    assertNotCancelled(signal)
    const length = Math.min(CHUNK_BYTES, size - offset)
    const chunk = await source.read(Object.freeze({ offset, length }))
    if (!(chunk instanceof Uint8Array) || chunk.byteLength < 1 || chunk.byteLength > length) {
      fail('source_unavailable', 'The upload source returned an invalid chunk.')
    }
    result.set(chunk, offset)
    offset += chunk.byteLength
  }
  return result
}

function assertNotCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) fail('cancelled', 'The operation was cancelled.')
}

function assertNoCollision(
  nodes: ReadonlyMap<string, StoredNode>,
  parentId: string,
  name: string
): void {
  if ([...nodes.values()].some((node) => node.parentId === parentId && node.name === name)) {
    fail('conflict', 'An entry with this name already exists.', 'after-human-action')
  }
}

function assertContainerReference(
  reference: ContentContainerReference,
  providerInstanceRef: string
): ContentContainerReference {
  const parsed = contentContainerReferenceSchema.parse(reference)
  if (parsed.providerInstanceRef !== providerInstanceRef) {
    fail('invalid_target', 'The container belongs to another Provider Instance.')
  }
  return parsed
}

function assertFileProvider(
  reference: ContentFileReference | ArtifactReference,
  providerInstanceRef: string
): ContentFileReference | ArtifactReference {
  const parsed = 'immutableVersionId' in reference
    ? artifactReferenceSchema.parse(reference)
    : contentFileReferenceSchema.parse(reference)
  if (parsed.providerInstanceRef !== providerInstanceRef) {
    fail('invalid_target', 'The file belongs to another Provider Instance.')
  }
  return parsed
}

function resolveNode(
  nodes: ReadonlyMap<string, StoredNode>,
  reference: ContentEntryReference,
  providerInstanceRef: string
): StoredNode {
  const id = 'containerId' in reference
    ? assertContainerReference(reference, providerInstanceRef).containerId
    : assertFileProvider(reference, providerInstanceRef).fileId
  const node = nodes.get(id)
  if (!node) fail('invalid_reference', 'The referenced Content Space entry is unknown.')
  return node
}

function assertFolder(nodes: ReadonlyMap<string, StoredNode>, id: string): FolderNode {
  const node = nodes.get(id)
  if (!node || node.kind !== 'container') fail('invalid_reference', 'The container is unknown.')
  return node
}

function assertFile(nodes: ReadonlyMap<string, StoredNode>, id: string): FileNode {
  const node = nodes.get(id)
  if (!node || node.kind !== 'file') fail('invalid_reference', 'The file is unknown.')
  return node
}

function containerReference(providerInstanceRef: string, containerId: string) {
  return contentContainerReferenceSchema.parse({ providerInstanceRef, containerId })
}

function fileReference(providerInstanceRef: string, fileId: string) {
  return contentFileReferenceSchema.parse({ providerInstanceRef, fileId })
}

function entrySummary(
  providerInstanceRef: string,
  node: StoredNode
): ContentSpaceEntrySummary {
  if (node.kind === 'container') {
    return Object.freeze({
      kind: 'container',
      reference: containerReference(providerInstanceRef, node.id),
      label: node.name
    })
  }
  const version = node.versions.get(node.currentVersionId)
  if (!version) fail('provider_unavailable', 'The current file version is unavailable.')
  return Object.freeze({
    kind: 'file',
    reference: fileReference(providerInstanceRef, node.id),
    label: node.name,
    size: version.bytes.byteLength,
    modifiedAt: version.modifiedAt
  })
}

function pageItems<Item>(
  items: readonly Item[],
  request: Readonly<{ cursor?: string; limit: number }>
): Readonly<{ items: readonly Item[]; nextCursor?: string }> {
  const offset = request.cursor ? parseCursor(request.cursor) : 0
  if (offset > items.length) fail('invalid_input', 'The page cursor is invalid.')
  const page = items.slice(offset, offset + request.limit)
  const next = offset + page.length
  return Object.freeze({
    items: Object.freeze(page),
    ...(next < items.length ? { nextCursor: `offset_${next}` } : {})
  })
}

function parseCursor(cursor: string): number {
  const match = /^offset_(\d{1,10})$/u.exec(cursor)
  if (!match) fail('invalid_input', 'The page cursor is invalid.')
  return Number(match[1])
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function compareCanonicalText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function fail(
  code: ConstructorParameters<typeof ContentSpaceOperationError>[0]['code'],
  message: string,
  retry: ConstructorParameters<typeof ContentSpaceOperationError>[0]['retry'] = 'never'
): never {
  throw new ContentSpaceOperationError({ code, message, retry })
}
