import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
  const dir = await mkdtemp(join(tmpdir(), 'sciforge-anchored-comments-'))
  tempDirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

function png(marker = 1): Uint8Array {
  return Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, marker, 0, 0, 0])
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
    const full = await service.putScreenshotAsset(png(1), { width: 1200, height: 800 })
    const focused = await service.putScreenshotAsset(png(2), { width: 240, height: 180 })
    const duplicate = await service.putScreenshotAsset(png(1), { width: 1200, height: 800 })
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

  it('rejects malformed stores instead of silently discarding comment data', async () => {
    const root = await tempDir()
    await mkdir(join(root, 'anchored-comments'))
    await writeFile(anchoredCommentStorePath(root), '{"schemaVersion":1,"threads":"bad"}', 'utf8')

    await expect(new AnchoredCommentService(root).listThreads())
      .rejects.toThrow(/Invalid anchored comment store/)
  })
})
