import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
import { join } from 'node:path'
import {
  ANCHORED_COMMENT_SCHEMA_VERSION,
  anchoredCommentStoreSchema,
  commentScreenshotAssetRefSchema,
  migrateAnchoredCommentStore,
  parseAnchoredCommentThread,
  type AnchoredCommentStore,
  type AnchoredCommentThread,
  type CommentScreenshotAssetRef
} from '../../shared/anchored-comments'
import {
  appDataStorePath,
  atomicWriteAppDataJson,
  atomicWriteAppDataText,
  readAppDataStoreText
} from './app-data-store'

export const ANCHORED_COMMENT_STORE_SEGMENTS = ['anchored-comments', 'comments.json'] as const
export const ANCHORED_COMMENT_ASSET_SEGMENTS = ['anchored-comments', 'assets'] as const

const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10])
const MAX_SCREENSHOT_BYTES = 25 * 1024 * 1024

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

export class AnchoredCommentService {
  private loaded: Promise<AnchoredCommentStore> | null = null
  private mutationQueue: Promise<void> = Promise.resolve()

  constructor(private readonly userDataDir: string) {}

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

  async upsertThread(value: AnchoredCommentThread): Promise<AnchoredCommentThread> {
    return this.enqueue(async () => {
      const thread = parseAnchoredCommentThread(value)
      await this.assertCaptureAssetsExist(thread)
      const store = await this.load()
      const index = store.threads.findIndex((item) => item.id === thread.id)
      if (index >= 0) {
        assertImmutableCapture(store.threads[index]!, thread)
        store.threads[index] = thread
      } else {
        store.threads.push(thread)
      }
      store.updatedAt = new Date().toISOString()
      await this.save(store)
      return cloneThread(thread)
    })
  }

  async deleteThread(threadId: string): Promise<boolean> {
    return this.enqueue(async () => {
      const id = requiredId(threadId, 'Comment thread id is required.')
      const store = await this.load()
      const index = store.threads.findIndex((item) => item.id === id)
      if (index < 0) return false
      const [removed] = store.threads.splice(index, 1)
      store.updatedAt = new Date().toISOString()
      await this.save(store)
      await this.garbageCollectAssets(assetDigests(removed!), store)
      return true
    })
  }

  async putScreenshotAsset(
    bytes: Uint8Array,
    options: PutCommentScreenshotOptions
  ): Promise<CommentScreenshotAssetRef> {
    assertPng(bytes)
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
    await atomicWriteAppDataText(this.userDataDir, segments, bytes)
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

  private async load(): Promise<AnchoredCommentStore> {
    if (!this.loaded) this.loaded = this.readStore()
    return this.loaded
  }

  private async readStore(): Promise<AnchoredCommentStore> {
    try {
      const rawText = await readAppDataStoreText(this.userDataDir, ANCHORED_COMMENT_STORE_SEGMENTS)
      const raw = JSON.parse(rawText) as unknown
      const migrated = migrateAnchoredCommentStore(raw)
      const rawVersion = raw && typeof raw === 'object' && !Array.isArray(raw)
        ? (raw as { schemaVersion?: unknown }).schemaVersion
        : undefined
      if (rawVersion !== ANCHORED_COMMENT_SCHEMA_VERSION) await this.save(migrated)
      return migrated
    } catch (error) {
      if (isMissingFile(error)) return emptyStore()
      throw withStoreError(error)
    }
  }

  private async save(store: AnchoredCommentStore): Promise<void> {
    const parsed = anchoredCommentStoreSchema.parse(store)
    await atomicWriteAppDataJson(
      this.userDataDir,
      ANCHORED_COMMENT_STORE_SEGMENTS,
      parsed,
      { trailingNewline: true }
    )
  }

  private async assertCaptureAssetsExist(thread: AnchoredCommentThread): Promise<void> {
    const refs = [thread.capture.fullWindowScreenshot, thread.capture.focusedScreenshot]
      .filter((asset): asset is CommentScreenshotAssetRef => Boolean(asset))
    for (const asset of refs) await this.readScreenshotAsset(asset)
  }

  private async readAssetBytes(segments: readonly string[]): Promise<Uint8Array> {
    const target = await appDataStorePath(this.userDataDir, segments, { createParentDirectories: false })
    return Uint8Array.from(await readFile(target.path))
  }

  private async garbageCollectAssets(digests: Set<string>, store: AnchoredCommentStore): Promise<void> {
    const retained = new Set(store.threads.flatMap((thread) => [...assetDigests(thread)]))
    for (const digest of digests) {
      if (retained.has(digest)) continue
      const target = await appDataStorePath(
        this.userDataDir,
        assetSegments(digest),
        { createParentDirectories: false }
      )
      await rm(target.path, { force: true })
    }
  }

  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.mutationQueue.then(operation, operation)
    this.mutationQueue = result.then(() => undefined, () => undefined)
    return result
  }
}

function emptyStore(): AnchoredCommentStore {
  return {
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
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

function assertPng(bytes: Uint8Array): void {
  if (bytes.byteLength < PNG_SIGNATURE.byteLength) throw new Error('Comment screenshot must be a PNG image.')
  for (let index = 0; index < PNG_SIGNATURE.byteLength; index += 1) {
    if (bytes[index] !== PNG_SIGNATURE[index]) throw new Error('Comment screenshot must be a PNG image.')
  }
}

function assertAssetBytes(asset: CommentScreenshotAssetRef, bytes: Uint8Array): void {
  if (bytes.byteLength !== asset.byteLength || sha256(bytes) !== asset.digest) {
    throw new Error(`Comment screenshot asset failed integrity validation: ${asset.digest}`)
  }
  assertPng(bytes)
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
