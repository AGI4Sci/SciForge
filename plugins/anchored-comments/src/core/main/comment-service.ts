import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { inflateSync } from 'node:zlib'
import { join } from 'node:path'
import {
  ANCHORED_COMMENT_SCHEMA_VERSION,
  anchoredCommentStoreSchema,
  commentScreenshotAssetRefSchema,
  migrateAnchoredCommentStore,
  parseAnchoredCommentThread,
  type AnchoredCommentCaptureBundle,
  type AnchoredCommentDeleteResult,
  type AnchoredCommentThread,
  type CommentScreenshotAssetRef
} from '../contract'
import { createNodeFilePort, type AnchoredCommentFilePort } from '../../ports/files'

export const ANCHORED_COMMENT_STORE_SEGMENTS = ['anchored-comments', 'comments.json'] as const
export const ANCHORED_COMMENT_ASSET_SEGMENTS = ['anchored-comments', 'assets'] as const

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024
const MAX_COMMENT_STORE_BYTES = 32 * 1024 * 1024
const MAX_PNG_CHUNKS = 4_096
const MAX_PNG_DECODED_BYTES = 128 * 1024 * 1024

export type AnchoredCommentListFilter = {
  workspaceKey?: string
  targetKey?: string
  purpose?: AnchoredCommentThread['purpose']
  status?: AnchoredCommentThread['status']
  includeResolved?: boolean
}

export type PutCommentScreenshotOptions = {
  width: number
  height: number
}

export function anchoredCommentStorePath(userDataDir: string): string {
  return join(userDataDir, ...ANCHORED_COMMENT_STORE_SEGMENTS)
}

export function anchoredCommentAssetPath(
  userDataDir: string,
  asset: Pick<CommentScreenshotAssetRef, 'digest'>
): string {
  const digest = validateDigest(asset.digest)
  return join(userDataDir, ...ANCHORED_COMMENT_ASSET_SEGMENTS, `${digest}.png`)
}

// Internal persistence metadata never appears in caller-controlled public threads.
const serviceStoreSchema = anchoredCommentStoreSchema.extend({
  threadInstances: z.record(z.string(), z.string().uuid())
})
type ServiceStore = z.infer<typeof serviceStoreSchema>
export type CommentThreadSnapshot = Readonly<{
  thread: AnchoredCommentThread
  instanceId: string
  canonicalIdentity: string
}>

export class AnchoredCommentService {
  private loaded: Promise<ServiceStore> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()
  private readonly files: AnchoredCommentFilePort

  constructor(private readonly userDataDir: string, files?: AnchoredCommentFilePort) {
    this.files = files ?? createNodeFilePort(userDataDir)
  }

  storePath(): string {
    return anchoredCommentStorePath(this.userDataDir)
  }

  assetPath(asset: Pick<CommentScreenshotAssetRef, 'digest'>): string {
    return anchoredCommentAssetPath(this.userDataDir, asset)
  }

  async listThreads(filter: AnchoredCommentListFilter = {}): Promise<AnchoredCommentThread[]> {
    const store = await this.load()
    return store.threads
      .filter((thread) => !filter.workspaceKey || thread.workspaceKey === filter.workspaceKey)
      .filter((thread) => !filter.targetKey || thread.anchor.targetKey === filter.targetKey)
      .filter((thread) => !filter.purpose || thread.purpose === filter.purpose)
      .filter((thread) => !filter.status || thread.status === filter.status)
      .filter((thread) => filter.includeResolved !== false || thread.status !== 'resolved')
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
      .map(cloneThread)
  }

  async getThread(threadId: string): Promise<AnchoredCommentThread | null> {
    const id = requiredId(threadId, 'Comment thread id is required.')
    const store = await this.load()
    const thread = store.threads.find((item) => item.id === id)
    return thread ? cloneThread(thread) : null
  }

  /** Lease acquired before external awaits, serialized with create/delete. */
  async snapshotThread(threadId: string): Promise<CommentThreadSnapshot | null> {
    return this.enqueue(async () => {
      const store = await this.load()
      const thread = store.threads.find(item => item.id === requiredId(threadId, 'Comment thread id is required.'))
      return thread ? Object.freeze({ thread: cloneThread(thread), instanceId: store.threadInstances[thread.id]!, canonicalIdentity: canonicalIdentity(thread) }) : null
    })
  }

  async updateThreadFeedback(snapshot: CommentThreadSnapshot, feedback: AnchoredCommentThread['feedback'], updatedAt: string): Promise<void> {
    return this.enqueue(async () => {
      const store = structuredClone(await this.load())
      const thread = this.assertSnapshot(store, snapshot)
      thread.feedback = feedback
      thread.updatedAt = updatedAt
      const next = parseAnchoredCommentThread(thread)
      store.threads[store.threads.findIndex(item => item.id === next.id)] = next
      store.updatedAt = updatedAt
      await this.save(store)
      this.loaded = Promise.resolve(store)
    })
  }

  private assertSnapshot(store: ServiceStore, snapshot: CommentThreadSnapshot): AnchoredCommentThread {
    const thread = store.threads.find(item => item.id === snapshot.thread.id)
    if (!thread || store.threadInstances[thread.id] !== snapshot.instanceId || canonicalIdentity(thread) !== snapshot.canonicalIdentity) {
      throw new Error('Comment thread instance or canonical identity changed during asynchronous operation.')
    }
    return thread
  }

  async upsertThread(value: AnchoredCommentThread): Promise<AnchoredCommentThread> {
    return this.enqueue(async () => {
      const thread = parseAnchoredCommentThread(value)
      await this.assertCaptureAssetsExist(thread)
      const store = structuredClone(await this.load())
      const index = store.threads.findIndex((item) => item.id === thread.id)
      if (index >= 0) {
        assertImmutableCapture(store.threads[index]!, thread)
        store.threads[index] = thread
      } else {
        store.threads.push(thread)
        store.threadInstances[thread.id] = randomUUID()
      }
      store.updatedAt = new Date().toISOString()
      await this.save(store)
      this.loaded = Promise.resolve(store)
      return cloneThread(thread)
    })
  }

  /** The trusted capture operation commits its asset and attachment in one queue. */
  async attachCapturedScreenshot(
    threadId: string,
    bytes: Uint8Array,
    dimensions: PutCommentScreenshotOptions,
    makeCapture: (asset: CommentScreenshotAssetRef) => AnchoredCommentCaptureBundle,
    expected: CommentThreadSnapshot
  ): Promise<AnchoredCommentThread> {
    return this.enqueue(async () => {
      const id = requiredId(threadId, 'Comment thread id is required.')
      const current = await this.load()
      const index = current.threads.findIndex((thread) => thread.id === id)
      if (index < 0) throw new Error('Comment thread was not found.')
      const previous = this.assertSnapshot(current, expected)
      if (previous.id !== id) throw new Error('Comment snapshot belongs to another thread.')
      if (previous.capture.fullWindowScreenshot || previous.capture.focusedScreenshot) {
        throw new Error('Comment visual evidence is already established.')
      }
      let createdAsset: CommentScreenshotAssetRef | undefined
      try {
        const asset = await this.putScreenshotAssetInternal(bytes, dimensions, (created) => { createdAsset = created })
        const next = parseAnchoredCommentThread({ ...previous, capture: makeCapture(asset) })
        if (!assetDigests(next).has(asset.digest)) throw new Error('Capture attachment must reference its captured screenshot asset.')
        await this.assertCaptureAssetsExist(next)
        next.updatedAt = new Date().toISOString()
        const candidate = structuredClone(current)
        candidate.threads[index] = next
        candidate.updatedAt = next.updatedAt
        await this.save(candidate)
        this.loaded = Promise.resolve(candidate)
        return cloneThread(next)
      } catch (error) {
        if (createdAsset && !current.threads.some((thread) => assetDigests(thread).has(createdAsset!.digest))) {
          try {
            await this.files.remove(assetSegments(createdAsset.digest))
          } catch (cleanupError) {
            throw new AggregateError([error, cleanupError], 'Comment capture was not committed; new screenshot cleanup failed and is pending.', { cause: error })
          }
        }
        throw error
      }
    })
  }

  async deleteThread(threadId: string): Promise<AnchoredCommentDeleteResult> {
    return this.enqueue(async () => {
      const id = requiredId(threadId, 'Comment thread id is required.')
      const store = structuredClone(await this.load())
      const index = store.threads.findIndex((item) => item.id === id)
      if (index < 0) return { deleted: false }
      const [removed] = store.threads.splice(index, 1)
      delete store.threadInstances[id]
      store.updatedAt = new Date().toISOString()
      await this.save(store)
      this.loaded = Promise.resolve(store)
      try {
        await this.garbageCollectAssets(assetDigests(removed!), store)
      } catch (error) {
        const reason = Array.from(error instanceof Error ? error.message : String(error),
          character => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127 ? ' ' : character
        ).join('').trim().slice(0, 800) || 'Unknown cleanup error.'
        return {
          deleted: true,
          cleanupPending: true,
          warnings: [`Comment deletion was committed, but unreferenced screenshot cleanup is pending: ${reason}`]
        }
      }
      return { deleted: true }
    })
  }

  async putScreenshotAsset(
    bytes: Uint8Array,
    options: PutCommentScreenshotOptions
  ): Promise<CommentScreenshotAssetRef> {
    return this.enqueue(() => this.putScreenshotAssetInternal(bytes, options))
  }

  private async putScreenshotAssetInternal(
    bytes: Uint8Array,
    options: PutCommentScreenshotOptions,
    onCreated?: (asset: CommentScreenshotAssetRef) => void
  ): Promise<CommentScreenshotAssetRef> {
    assertPng(bytes, options)
    if (bytes.byteLength > MAX_SCREENSHOT_BYTES) {
      throw new Error(`Comment screenshot exceeds ${MAX_SCREENSHOT_BYTES} bytes.`)
    }
    const digest = sha256(bytes)
    const asset = commentScreenshotAssetRefSchema.parse({
      digest,
      mimeType: 'image/png',
      byteLength: bytes.byteLength,
      width: options.width,
      height: options.height
    })
    const segments = assetSegments(digest)
    try {
      const existing = await this.readAssetBytes(segments)
      assertAssetBytes(asset, existing)
      return asset
    } catch (error) {
      if (!isMissingFile(error)) throw error
    }
    await this.files.writeAtomic(segments, bytes)
    onCreated?.(asset)
    const persisted = await this.readAssetBytes(segments)
    assertAssetBytes(asset, persisted)
    return asset
  }

  async readScreenshotAsset(value: CommentScreenshotAssetRef): Promise<Uint8Array> {
    const asset = commentScreenshotAssetRefSchema.parse(value)
    const bytes = await this.readAssetBytes(assetSegments(asset.digest))
    assertAssetBytes(asset, bytes)
    return bytes
  }

  private async load(): Promise<ServiceStore> {
    if (!this.loaded) {
      const pending = this.readStore()
      this.loaded = pending
      void pending.catch(() => {
        if (this.loaded === pending) this.loaded = null
      })
    }
    return this.loaded
  }

  private async readStore(): Promise<ServiceStore> {
    try {
      const rawText = await this.files.readText(ANCHORED_COMMENT_STORE_SEGMENTS, MAX_COMMENT_STORE_BYTES)
      if (Buffer.byteLength(rawText, 'utf8') > MAX_COMMENT_STORE_BYTES) {
        throw new Error(`Comment store exceeds ${MAX_COMMENT_STORE_BYTES} bytes.`)
      }
      const raw = JSON.parse(rawText) as Record<string, unknown>
      const { threadInstances, ...publicStore } = raw
      const migrated = migrateAnchoredCommentStore(publicStore)
      const instances = threadInstances === undefined
        ? Object.fromEntries(migrated.threads.map(thread => [thread.id, randomUUID()]))
        : z.record(z.string(), z.string().uuid()).parse(threadInstances)
      if (migrated.threads.some(thread => !Object.hasOwn(instances, thread.id)) || Object.keys(instances).length !== migrated.threads.length || new Set(Object.values(instances)).size !== migrated.threads.length) {
        throw new Error('Comment store instance identities are incomplete or duplicated.')
      }
      const internal = serviceStoreSchema.parse({ ...migrated, threadInstances: instances })
      const rawVersion = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as { schemaVersion?: unknown }).schemaVersion
        : undefined
      if (rawVersion !== ANCHORED_COMMENT_SCHEMA_VERSION || threadInstances === undefined) await this.save(internal)
      return internal
    } catch (error) {
      if (isMissingFile(error)) return emptyStore()
      throw withStoreError(error)
    }
  }

  private async save(store: ServiceStore): Promise<void> {
    const parsed = serviceStoreSchema.parse(store)
    const serialized = `${JSON.stringify(parsed, null, 2)}\n`
    if (Buffer.byteLength(serialized, 'utf8') > MAX_COMMENT_STORE_BYTES) {
      throw new Error(`Comment store exceeds ${MAX_COMMENT_STORE_BYTES} bytes.`)
    }
    await this.files.writeAtomic(ANCHORED_COMMENT_STORE_SEGMENTS, serialized)
  }

  private async assertCaptureAssetsExist(thread: AnchoredCommentThread): Promise<void> {
    const refs = [thread.capture.fullWindowScreenshot, thread.capture.focusedScreenshot]
      .filter((asset): asset is CommentScreenshotAssetRef => Boolean(asset))
    for (const asset of refs) await this.readScreenshotAsset(asset)
  }

  private async readAssetBytes(segments: readonly string[]): Promise<Uint8Array> {
    return this.files.readBytes(segments, MAX_SCREENSHOT_BYTES)
  }

  private async garbageCollectAssets(digests: Set<string>, store: ServiceStore): Promise<void> {
    const retained = new Set(store.threads.flatMap((thread) => [...assetDigests(thread)]))
    for (const digest of digests) {
      if (retained.has(digest)) continue
      await this.files.remove(assetSegments(digest))
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }
}

function canonicalIdentity(thread: AnchoredCommentThread): string {
  return JSON.stringify([thread.workspaceKey, thread.anchor.targetKey, thread.anchor.canonical])
}

function emptyStore(): ServiceStore {
  return {
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
    threadInstances: {},
    threads: [],
    updatedAt: new Date(0).toISOString()
  }
}

function cloneThread(thread: AnchoredCommentThread): AnchoredCommentThread {
  return structuredClone(thread)
}

function assetSegments(digest: string): readonly string[] {
  return [...ANCHORED_COMMENT_ASSET_SEGMENTS, `${validateDigest(digest)}.png`]
}

function validateDigest(digest: string): string {
  if (!/^[a-f0-9]{64}$/.test(digest)) throw new Error('Invalid comment screenshot digest.')
  return digest
}

function assetDigests(thread: AnchoredCommentThread): Set<string> {
  return new Set([
    thread.capture.fullWindowScreenshot?.digest,
    thread.capture.focusedScreenshot?.digest
  ].filter((digest): digest is string => Boolean(digest)))
}

function assertImmutableCapture(previous: AnchoredCommentThread, next: AnchoredCommentThread): void {
  if (previous.workspaceKey !== next.workspaceKey) {
    throw new Error('A comment thread cannot move between workspaces.')
  }
  if (previous.createdAt !== next.createdAt) {
    throw new Error('A comment thread creation timestamp is immutable.')
  }
  if (
    previous.anchor.targetKey !== next.anchor.targetKey
    || JSON.stringify(previous.anchor.canonical) !== JSON.stringify(next.anchor.canonical)
  ) {
    throw new Error('A comment canonical target identity is immutable.')
  }
  if (JSON.stringify(previous.capture) !== JSON.stringify(next.capture)) {
    throw new Error('Comment visual evidence is immutable after thread creation.')
  }
}

function assertPng(bytes: Uint8Array, dimensions: PutCommentScreenshotOptions): void {
  const fail = (): never => { throw new Error('Comment screenshot must be a valid PNG image with matching dimensions.') }
  if (bytes.byteLength > MAX_SCREENSHOT_BYTES || bytes.byteLength < 45) fail()
  const data = Buffer.from(bytes)
  if (!data.subarray(0, 8).equals(Buffer.from(PNG_SIGNATURE))) fail()
  let offset = 8
  let width = 0, height = 0, depth = 0, color = 0, interlace = 0
  let header = false, ended = false, palette = false, dataEnded = false, sawData = false
  const compressed: Buffer[] = []
  let chunkCount = 0, compressedBytes = 0
  while (offset < data.length) {
    // Cap metadata/object overhead before creating a view for the next chunk.
    if (++chunkCount > MAX_PNG_CHUNKS || offset + 12 > data.length) fail()
    const length = data.readUInt32BE(offset)
    const end = offset + 12 + length
    if (end > data.length) fail()
    const typeBytes = data.subarray(offset + 4, offset + 8)
    if (!typeBytes.every(byte => (byte >= 65 && byte <= 90) || (byte >= 97 && byte <= 122))) fail()
    const type = typeBytes.toString('latin1')
    if (typeBytes[2]! < 65 || typeBytes[2]! > 90) fail()
    if (pngCrc(data.subarray(offset + 4, end - 4)) !== data.readUInt32BE(end - 4)) fail()
    const chunk = data.subarray(offset + 8, end - 4)
    if (!header && type !== 'IHDR') fail()
    if (type === 'IHDR') {
      if (header || length !== 13) fail()
      header = true
      width = chunk.readUInt32BE(0); height = chunk.readUInt32BE(4)
      depth = chunk[8]!; color = chunk[9]!; interlace = chunk[12]!
      const depths: Record<number, number[]> = { 0: [1, 2, 4, 8, 16], 2: [8, 16], 3: [1, 2, 4, 8], 4: [8, 16], 6: [8, 16] }
      if (!width || !height || width !== dimensions.width || height !== dimensions.height ||
        width > 100_000 || height > 100_000 || !depths[color]?.includes(depth) ||
        chunk[10] !== 0 || chunk[11] !== 0 || interlace > 1) fail()
    } else if (type === 'PLTE') {
      if (palette || sawData || color === 0 || color === 4 || !length || length % 3 || length > 768 ||
        (color === 3 && length / 3 > 2 ** depth)) fail()
      palette = true
    } else if (type === 'IDAT') {
      if (dataEnded || (color === 3 && !palette)) fail()
      sawData = true
      compressedBytes += length
      if (compressedBytes > MAX_SCREENSHOT_BYTES) fail()
      // Zero-length IDAT is legal PNG data but must not create retained objects.
      if (length) compressed.push(chunk)
    } else if (type === 'IEND') {
      if (length || !compressed.length || end !== data.length) fail()
      ended = true
    } else {
      if (type[0] === type[0]!.toUpperCase()) fail()
      if (sawData) dataEnded = true
    }
    offset = end
  }
  if (!ended) fail()
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[color]!
  const passes = interlace ? [[0, 0, 8, 8], [4, 0, 8, 8], [0, 4, 4, 8], [2, 0, 4, 4], [0, 2, 2, 4], [1, 0, 2, 2], [0, 1, 1, 2]] : [[0, 0, 1, 1]]
  const rows = passes.map(([x, y, dx, dy]) => {
    const w = Math.max(0, Math.ceil((width - x!) / dx!))
    const h = Math.max(0, Math.ceil((height - y!) / dy!))
    return { count: w ? h : 0, size: Math.ceil(w * channels * depth / 8) + 1 }
  })
  const expected = rows.reduce((sum, row) => sum + row.count * row.size, 0)
  if (!Number.isSafeInteger(expected) || expected <= 0 || expected > MAX_PNG_DECODED_BYTES) fail()
  let pixels: Buffer
  try { pixels = inflateSync(Buffer.concat(compressed, compressedBytes), { maxOutputLength: expected }) } catch { return fail() }
  if (pixels.length !== expected) fail()
  let rowOffset = 0
  for (const row of rows) for (let index = 0; index < row.count; index++) {
    if (pixels[rowOffset]! > 4) fail()
    rowOffset += row.size
  }
}

const PNG_CRC_TABLE = Uint32Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++) value = (value >>> 1) ^ ((value & 1) ? 0xedb88320 : 0)
  return value >>> 0
})

function pngCrc(bytes: Uint8Array): number {
  let crc = 0xffffffff
  for (const byte of bytes) crc = (crc >>> 8) ^ PNG_CRC_TABLE[(crc ^ byte) & 0xff]!
  return (crc ^ 0xffffffff) >>> 0
}

function assertAssetBytes(asset: CommentScreenshotAssetRef, bytes: Uint8Array): void {
  if (bytes.byteLength !== asset.byteLength || sha256(bytes) !== asset.digest) {
    throw new Error(`Comment screenshot asset failed integrity validation: ${asset.digest}`)
  }
  assertPng(bytes, asset)
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function requiredId(value: string, message: string): string {
  const normalized = value.trim()
  if (!normalized || normalized.length > 256) throw new Error(message)
  return normalized
}

function isMissingFile(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

function withStoreError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  return new Error(`Invalid anchored comment store: ${message}`, { cause: error })
}
