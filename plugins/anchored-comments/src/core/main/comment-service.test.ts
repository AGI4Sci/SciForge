import { mkdir, mkdtemp, readFile, readdir, realpath, rm, truncate, writeFile } from 'node:fs/promises'
import { deflateSync } from 'node:zlib'
import { createCanvas } from '@napi-rs/canvas'
import { createNodeFilePort } from '../../ports/files'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  ANCHORED_COMMENT_SCHEMA_VERSION,
  type AnchoredCommentThread,
  type CommentScreenshotAssetRef
} from '../contract'
import {
  AnchoredCommentService,
  anchoredCommentAssetPath,
  anchoredCommentStorePath
} from './comment-service'

const tempDirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(await realpath(tmpdir()), 'sciforge-anchored-comments-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function png(marker = 1): Uint8Array {
  const canvas = createCanvas(2, 2)
  const context = canvas.getContext('2d')
  context.fillStyle = marker === 1 ? '#ff0000' : '#0000ff'
  context.fillRect(0, 0, 2, 2)
  return Uint8Array.from(canvas.encodeSync('png'))
}

// Construct adversarial but checksum-correct chunks without decoding large images.
function pngChunk(type: string | Uint8Array, payload = Buffer.alloc(0)): Buffer {
  const chunk = Buffer.alloc(12 + payload.length)
  chunk.writeUInt32BE(payload.length, 0)
  Buffer.from(typeof type === 'string' ? Buffer.from(type, 'latin1') : type).copy(chunk, 4, 0, 4)
  payload.copy(chunk, 8)
  let crc = 0xffffffff
  for (const byte of chunk.subarray(4, chunk.length - 4)) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0)
  }
  chunk.writeUInt32BE((crc ^ 0xffffffff) >>> 0, chunk.length - 4)
  return chunk
}

function thread(
  id: string,
  assets?: { full: CommentScreenshotAssetRef; focused: CommentScreenshotAssetRef }
): AnchoredCommentThread {
  return {
    schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
    id,
    workspaceKey: '/workspace/example',
    purpose: 'research',
    anchor: {
      targetKey: 'figure:2',
      targetLabel: 'Figure 2',
      canonical: { kind: 'research', resourceKind: 'figure', resourceId: 'figure-2' },
      bounds: { x: 20, y: 30, width: 200, height: 120 }
    },
    capture: {
      capturedAt: '2026-07-11T00:00:00.000Z',
      appVersion: '0.1.0',
      platform: 'darwin',
      viewport: { width: 1200, height: 800, scaleFactor: 2 },
      targetLabel: 'Figure 2',
      targetBounds: { x: 20, y: 30, width: 200, height: 120 },
      ...(assets
        ? { fullWindowScreenshot: assets.full, focusedScreenshot: assets.focused }
        : { unavailableReason: 'No window was available.' })
    },
    messages: [{
      id: `${id}-message`,
      authorKind: 'user',
      body: 'Please check this plot.',
      createdAt: '2026-07-11T00:00:01.000Z',
      updatedAt: '2026-07-11T00:00:01.000Z'
    }],
    status: 'open',
    anchorResolution: 'resolved',
    feedback: { state: 'local' },
    createdAt: '2026-07-11T00:00:00.000Z',
    updatedAt: '2026-07-11T00:00:01.000Z'
  }
}

describe('AnchoredCommentService', () => {
  it('rejects checksum-correct high-bit chunk types before ASCII decoding, using only bytes', async () => {
    const service = new AnchoredCommentService(await tempDir())
    const header = Buffer.alloc(13)
    header.writeUInt32BE(2, 0); header.writeUInt32BE(2, 4); header[8] = 8; header[9] = 6
    const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
    const payload = deflateSync(Buffer.alloc(18))
    const image = (type: Uint8Array) => Buffer.concat([signature, pngChunk('IHDR', header), pngChunk(type, payload), pngChunk('IEND')])
    await expect(service.putScreenshotAsset(image(Uint8Array.from([73, 68, 65, 84])), { width: 2, height: 2 })).resolves.toMatchObject({ width: 2, height: 2 })
    // C9 44 41 54 folds to IDAT with Buffer's ascii decoder, but is illegal PNG.
    await expect(service.putScreenshotAsset(image(Uint8Array.from([0xc9, 68, 65, 84])), { width: 2, height: 2 })).rejects.toThrow(/valid PNG/)
  })

  it('persists service identities, upgrades old stores and never accepts caller instance metadata', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'anchored-comments'))
    await writeFile(anchoredCommentStorePath(root), JSON.stringify({ schemaVersion: 1, threads: [thread('old')], updatedAt: thread('old').updatedAt }))
    const service = new AnchoredCommentService(root)
    const before = (await service.snapshotThread('old'))!
    expect((await new AnchoredCommentService(root).snapshotThread('old'))!.instanceId).toBe(before.instanceId)
    await expect(service.upsertThread({ ...thread('old'), instanceId: before.instanceId } as AnchoredCommentThread)).rejects.toThrow()
    await service.deleteThread('old')
    await service.upsertThread(thread('old'))
    expect((await service.snapshotThread('old'))!.instanceId).not.toBe(before.instanceId)
    await expect(service.updateThreadFeedback(before, { state: 'local' }, thread('old').updatedAt)).rejects.toThrow(/instance/)
  })
  it('persists validated threads and filters by workspace and target identity', async () => {
    const root = await tempDir()
    const service = new AnchoredCommentService(root)
    await service.upsertThread(thread('thread-1'))
    await service.upsertThread({
      ...thread('thread-2'),
      workspaceKey: '/workspace/other',
      anchor: { ...thread('thread-2').anchor, targetKey: 'table:cells:A1:B3' }
    })

    const reloaded = new AnchoredCommentService(root)
    await expect(reloaded.listThreads({ workspaceKey: '/workspace/example' }))
      .resolves.toMatchObject([{ id: 'thread-1' }])
    await expect(reloaded.listThreads({ targetKey: 'table:cells:A1:B3' }))
      .resolves.toMatchObject([{ id: 'thread-2' }])
    expect(JSON.parse(await readFile(anchoredCommentStorePath(root), 'utf8'))).toMatchObject({
      schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION
    })
  })

  it('migrates a version-zero persisted store and writes the current version', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'anchored-comments'))
    const legacy: Record<string, unknown> = {
      ...thread('legacy-thread'),
      schemaVersion: 0
    }
    await writeFile(anchoredCommentStorePath(root), JSON.stringify({ comments: [legacy] }), 'utf8')

    const service = new AnchoredCommentService(root)
    await expect(service.getThread('legacy-thread')).resolves.toMatchObject({
      schemaVersion: ANCHORED_COMMENT_SCHEMA_VERSION,
      id: 'legacy-thread'
    })
    expect(JSON.parse(await readFile(anchoredCommentStorePath(root), 'utf8')).schemaVersion)
      .toBe(ANCHORED_COMMENT_SCHEMA_VERSION)
  })

  it('stores PNGs by content digest, validates reads, and garbage-collects unreferenced assets', async () => {
    const root = await tempDir()
    const service = new AnchoredCommentService(root)
    const full = await service.putScreenshotAsset(png(1), { width: 2, height: 2 })
    const focused = await service.putScreenshotAsset(png(2), { width: 2, height: 2 })
    const duplicate = await service.putScreenshotAsset(png(1), { width: 2, height: 2 })
    expect(duplicate.digest).toBe(full.digest)
    await expect(service.readScreenshotAsset(full)).resolves.toEqual(png(1))

    await service.upsertThread(thread('thread-1', { full, focused }))
    await service.upsertThread(thread('thread-2', { full, focused }))
    await service.deleteThread('thread-1')
    await expect(readFile(anchoredCommentAssetPath(root, full))).resolves.toBeDefined()
    await service.deleteThread('thread-2')
    await expect(readFile(anchoredCommentAssetPath(root, full))).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(readFile(anchoredCommentAssetPath(root, focused))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('reports committed deletion with bounded cleanup warnings when asset removal fails', async () => {
    const root = await tempDir()
    const files = createNodeFilePort(root)
    let removals = 0
    const service = new AnchoredCommentService(root, {
      ...files,
      async remove() {
        removals++
        throw new Error(`asset removal denied\n${'x'.repeat(2_000)}`)
      }
    })
    const asset = await service.putScreenshotAsset(png(), { width: 2, height: 2 })
    await service.upsertThread(thread('deleted', { full: asset, focused: asset }))
    await service.upsertThread(thread('retained'))

    const outcome = await service.deleteThread('deleted')
    expect(outcome).toMatchObject({ deleted: true, cleanupPending: true })
    expect(outcome.warnings).toHaveLength(1)
    expect(outcome.warnings![0]).toMatch(/deletion was committed.*asset removal denied/)
    expect(outcome.warnings![0].length).toBeLessThanOrEqual(1_000)
    expect(outcome.warnings![0]).not.toMatch(/[\r\n]/)
    expect(await service.getThread('deleted')).toBeNull()
    expect(await new AnchoredCommentService(root).getThread('deleted')).toBeNull()
    expect(await service.getThread('retained')).not.toBeNull()
    await expect(service.readScreenshotAsset(asset)).resolves.toEqual(png())
    expect(await service.deleteThread('deleted')).toEqual({ deleted: false })
    expect(removals).toBe(1)
  })

  it('does not allow a saved capture to be silently replaced', async () => {
    const root = await tempDir()
    const service = new AnchoredCommentService(root)
    const original = thread('thread-1')
    await service.upsertThread(original)

    await expect(service.upsertThread({
      ...original,
      capture: { ...original.capture, targetLabel: 'A different target' },
      updatedAt: '2026-07-11T00:00:02.000Z'
    })).rejects.toThrow(/visual evidence is immutable/)
  })

  it('commits mutation caches only after persistence succeeds', async () => {
    const root = await tempDir()
    const files = createNodeFilePort(root)
    let fail = false
    const service = new AnchoredCommentService(root, {
      ...files,
      async writeAtomic(segments, content) {
        if (fail) throw new Error('write failed')
        await files.writeAtomic(segments, content)
      }
    })
    await service.upsertThread(thread('original'))
    fail = true
    await expect(service.upsertThread({ ...thread('original'), status: 'resolved' })).rejects.toThrow('write failed')
    await expect(service.upsertThread(thread('new'))).rejects.toThrow('write failed')
    await expect(service.deleteThread('original')).rejects.toThrow('write failed')
    expect(await service.getThread('original')).toMatchObject({ status: 'open' })
    expect(await service.getThread('new')).toBeNull()
    expect(await new AnchoredCommentService(root).getThread('original')).toMatchObject({ status: 'open' })
    fail = false
    expect(await service.deleteThread('original')).toEqual({ deleted: true })
  })

  it('retries a failed store read without recreating or losing persisted data', async () => {
    const root = await tempDir()
    const files = createNodeFilePort(root)
    let reads = 0
    const service = new AnchoredCommentService(root, {
      ...files,
      async readText(segments) {
        if (reads++ === 0) throw new Error('transient read failure')
        return files.readText(segments)
      }
    })
    await expect(service.listThreads()).rejects.toThrow('transient read failure')
    await expect(service.listThreads()).resolves.toEqual([])
  })

  it('rejects signature-only, corrupt, truncated and dimension-mismatched PNG assets before writing', async () => {
    const root = await tempDir()
    const service = new AnchoredCommentService(root)
    const valid = png()
    const corrupt = Uint8Array.from(valid)
    corrupt[corrupt.length - 5] ^= 1
    for (const bytes of [valid.subarray(0, 12), valid.subarray(0, valid.length - 1), corrupt]) {
      await expect(service.putScreenshotAsset(bytes, { width: 2, height: 2 })).rejects.toThrow(/valid PNG/)
    }
    await expect(service.putScreenshotAsset(valid, { width: 3, height: 2 })).rejects.toThrow(/matching dimensions/)
    const asset = await service.putScreenshotAsset(valid, { width: 2, height: 2 })
    await expect(service.readScreenshotAsset({ ...asset, width: 3 })).rejects.toThrow(/matching dimensions/)
  })

  it('rejects PNG chunk floods, excessive decoded budgets and inflation beyond declared dimensions', async () => {
    const root = await tempDir()
    const service = new AnchoredCommentService(root)
    const valid = Buffer.from(png())
    const header = valid.subarray(8, 33)
    const flood = Buffer.concat([valid.subarray(0, 33), ...Array.from({ length: 4_096 }, () => pngChunk('IDAT')), valid.subarray(33)])
    await expect(service.putScreenshotAsset(flood, { width: 2, height: 2 })).rejects.toThrow(/valid PNG/)

    const largeHeader = Buffer.from(header.subarray(8, 21))
    largeHeader.writeUInt32BE(100_000, 0)
    largeHeader.writeUInt32BE(100_000, 4)
    const large = Buffer.concat([valid.subarray(0, 8), pngChunk('IHDR', largeHeader), valid.subarray(33)])
    await expect(service.putScreenshotAsset(large, { width: 100_000, height: 100_000 })).rejects.toThrow(/valid PNG/)

    const bomb = Buffer.concat([valid.subarray(0, 33), pngChunk('IDAT', deflateSync(Buffer.alloc(1024 * 1024))), pngChunk('IEND')])
    await expect(service.putScreenshotAsset(bomb, { width: 2, height: 2 })).rejects.toThrow(/valid PNG/)
  })

  it('bounds persisted image and store reads before parsing their contents', async () => {
    const root = await tempDir()
    const service = new AnchoredCommentService(root)
    const asset = await service.putScreenshotAsset(png(), { width: 2, height: 2 })
    await truncate(anchoredCommentAssetPath(root, asset), 25 * 1024 * 1024 + 1)
    await expect(service.readScreenshotAsset(asset)).rejects.toThrow(/exceeds/)
    await writeFile(anchoredCommentStorePath(root), '{}')
    await truncate(anchoredCommentStorePath(root), 32 * 1024 * 1024 + 1)
    await expect(new AnchoredCommentService(root).listThreads()).rejects.toThrow(/exceeds/)
  })

  it('atomically attaches trusted evidence once without weakening ordinary upsert', async () => {
    const root = await tempDir()
    const files = createNodeFilePort(root)
    let fail = false
    const service = new AnchoredCommentService(root, {
      ...files,
      async writeAtomic(segments, content) {
        if (fail) throw new Error('write failed')
        await files.writeAtomic(segments, content)
      }
    })
    const original = thread('capture-thread')
    await service.upsertThread(original)
    const asset = await service.putScreenshotAsset(png(), { width: 2, height: 2 })
    const { unavailableReason: _reason, ...metadata } = original.capture
    const capture = { ...metadata, fullWindowScreenshot: asset }
    await expect(service.upsertThread({ ...original, capture })).rejects.toThrow(/immutable/)
    const snapshot = (await service.snapshotThread(original.id))!
    const attach = (id = original.id) => service.attachCapturedScreenshot(id, png(), { width: 2, height: 2 }, () => capture, snapshot)
    await expect(attach('missing')).rejects.toThrow(/not found/)
    await expect(service.attachCapturedScreenshot(original.id, png(), { width: 2, height: 2 }, () => ({ ...capture, fullWindowScreenshot: { ...asset, digest: 'a'.repeat(64) } }), snapshot)).rejects.toThrow(/must reference/)
    fail = true
    await expect(attach()).rejects.toThrow('write failed')
    expect((await service.getThread(original.id))!.capture).toEqual(original.capture)
    fail = false
    const attached = await attach()
    expect(attached.anchor).toEqual(original.anchor)
    expect(attached.createdAt).toBe(original.createdAt)
    expect((await new AnchoredCommentService(root).getThread(original.id))!.capture).toEqual(capture)
    await expect(attach()).rejects.toThrow(/already established/)
    await expect(service.attachCapturedScreenshot(original.id, png(2), { width: 2, height: 2 }, (asset) => ({ ...capture, fullWindowScreenshot: asset }), snapshot)).rejects.toThrow(/already established/)
  })

  it('serializes competing attachments before creating the losing screenshot asset', async () => {
    const root = await tempDir()
    const service = new AnchoredCommentService(root)
    const original = thread('concurrent')
    await service.upsertThread(original)
    const { unavailableReason: _reason, ...metadata } = original.capture
    const snapshot = (await service.snapshotThread(original.id))!
    const results = await Promise.allSettled([1, 2].map((marker) => service.attachCapturedScreenshot(
      original.id, png(marker), { width: 2, height: 2 }, (asset) => ({ ...metadata, focusedScreenshot: asset }), snapshot
    )))
    expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
    expect(await readdir(join(root, 'anchored-comments', 'assets'))).toHaveLength(1)
    expect((await service.getThread(original.id))!.capture.focusedScreenshot).toBeDefined()
  })

  it('rolls back new capture assets on save failure without deleting a shared digest', async () => {
    const root = await tempDir()
    const files = createNodeFilePort(root)
    let failStore = false
    const service = new AnchoredCommentService(root, {
      ...files,
      async writeAtomic(segments, content) {
        if (failStore && segments.at(-1) === 'comments.json') throw new Error('store write failed')
        await files.writeAtomic(segments, content)
      }
    })
    const original = thread('rollback')
    await service.upsertThread(original)
    const { unavailableReason: _reason, ...metadata } = original.capture
    failStore = true
    await expect(service.attachCapturedScreenshot(original.id, png(), { width: 2, height: 2 }, (asset) => ({ ...metadata, focusedScreenshot: asset }), (await service.snapshotThread(original.id))!)).rejects.toThrow('store write failed')
    expect(await readdir(join(root, 'anchored-comments', 'assets'))).toEqual([])
    expect((await service.getThread(original.id))!.capture).toEqual(original.capture)
    expect((await new AnchoredCommentService(root).getThread(original.id))!.capture).toEqual(original.capture)
    failStore = false
    const shared = await service.putScreenshotAsset(png(), { width: 2, height: 2 })
    await service.upsertThread(thread('shared', { full: shared, focused: shared }))
    failStore = true
    await expect(service.attachCapturedScreenshot(original.id, png(), { width: 2, height: 2 }, (asset) => ({ ...metadata, focusedScreenshot: asset }), (await service.snapshotThread(original.id))!)).rejects.toThrow('store write failed')
    expect(await service.readScreenshotAsset(shared)).toEqual(png())
    expect(await readdir(join(root, 'anchored-comments', 'assets'))).toEqual([`${shared.digest}.png`])
  })

  it('retains the save failure cause when rollback asset cleanup also fails', async () => {
    const root = await tempDir()
    const files = createNodeFilePort(root)
    const storeError = new Error('store write failed')
    const cleanupError = new Error('remove failed')
    let failStore = false
    const service = new AnchoredCommentService(root, {
      ...files,
      async writeAtomic(segments, content) {
        if (failStore && segments.at(-1) === 'comments.json') throw storeError
        await files.writeAtomic(segments, content)
      },
      async remove() { throw cleanupError }
    })
    const original = thread('cleanup-failed')
    await service.upsertThread(original)
    failStore = true
    const { unavailableReason: _reason, ...metadata } = original.capture
    let outcome: unknown
    try {
      await service.attachCapturedScreenshot(original.id, png(), { width: 2, height: 2 }, (asset) => ({ ...metadata, focusedScreenshot: asset }), (await service.snapshotThread(original.id))!)
    } catch (error) { outcome = error }
    expect(outcome).toBeInstanceOf(AggregateError)
    expect((outcome as AggregateError).cause).toBe(storeError)
    expect((outcome as AggregateError).errors).toEqual([storeError, cleanupError])
    expect((outcome as Error).message).toMatch(/not committed.*cleanup failed/)
    expect((await service.getThread(original.id))!.capture).toEqual(original.capture)
  })

  it('rejects malformed stores instead of silently discarding comment data', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'anchored-comments'))
    await writeFile(anchoredCommentStorePath(root), '{"schemaVersion":1,"threads":"bad"}', 'utf8')

    await expect(new AnchoredCommentService(root).listThreads())
      .rejects.toThrow(/Invalid anchored comment store/)
  })
})
