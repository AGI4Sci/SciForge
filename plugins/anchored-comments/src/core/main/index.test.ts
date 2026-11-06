import { describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AnchoredCommentService as RealCommentService } from './comment-service'
import type { AnchoredCommentThread } from '../contract'
import type { AnchoredCommentService } from './comment-service'
import {
  ANCHORED_COMMENT_CAPABILITY_IDS,
  anchoredCommentCaptureResultSchema
} from '../contract'
import { createAnchoredCommentsCapabilityFactory } from './index'

// Valid PNG bytes for engineering tests only; never real screenshot acceptance evidence.
const PNG = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAC0lEQVR4nGNgQAcAABIAAXfx+gAAAAAASUVORK5CYII=', 'base64'
))
const DIGEST = createHash('sha256').update(PNG).digest('hex')
const SOURCE = {
  instanceId: 'instance-test', workspaceRoot: '/workspace', threadId: 'agent-thread',
  windowId: 'window-test', targetRef: 'view-document-a', resourcePath: '/workspace/docs/a.md',
  validatedRevision: 3, captureRevisionAtomic: false as const,
  capturedAt: '2026-11-03T05:00:00.000Z', redactionPolicy: 'registered-target-v1' as const
}
const REQUEST = {
  threadId: 'comment-a', targetRef: SOURCE.targetRef, targetLabel: 'Document A',
  targetBounds: { x: 10, y: 20, width: 120, height: 80 },
  viewport: { width: 1000, height: 800, scaleFactor: 2 }
}

function captureFixture() {
  const asset = { digest: DIGEST, mimeType: 'image/png' as const, byteLength: PNG.byteLength, width: 2, height: 2 }
  const getThread = vi.fn(async (_id: string): Promise<any> => ({
    capture: {}, anchor: { canonical: { kind: 'research', resourceId: 'docs/a.md' } }
  }))
  const putScreenshotAsset = vi.fn(async () => asset)
  const attachCapturedScreenshot = vi.fn(async (
    threadId: string,
    _bytes: Uint8Array,
    _dimensions: { width: number; height: number },
    makeCapture: Parameters<AnchoredCommentService['attachCapturedScreenshot']>[3]
  ) => ({ id: threadId, capture: makeCapture(asset) }))
  const captureRegisteredTarget = vi.fn(async (): Promise<any> => ({
    ok: true, png: PNG, width: 2, height: 2, sha256: DIGEST, redacted: true, source: { ...SOURCE }
  }))
  const factory = createAnchoredCommentsCapabilityFactory({
    defineCapability: (definition) => definition,
    getComments: () => ({ snapshotThread: async (id: string) => ({ thread: await getThread(id), instanceId: "service-test-instance", canonicalIdentity: "identity" }), getThread, putScreenshotAsset, attachCapturedScreenshot }) as unknown as AnchoredCommentService,
    getFeedback: vi.fn(), visualCapture: { captureRegisteredTarget }
  })
  const capture = factory.createDefinitions().find((definition) => definition.id === ANCHORED_COMMENT_CAPABILITY_IDS.capture)!
  return { capture, getThread, putScreenshotAsset, attachCapturedScreenshot, captureRegisteredTarget }
}

describe('Anchored Comments capability factory', () => {
  it('publishes one broker path for every package operation', () => {
    const factory = createAnchoredCommentsCapabilityFactory({
      defineCapability: (definition) => definition, getComments: vi.fn(), getFeedback: vi.fn()
    })
    expect(factory.createDefinitions().map((definition) => definition.id)).toEqual(Object.values(ANCHORED_COMMENT_CAPABILITY_IDS))
    expect(Object.keys(factory)).toEqual(['createDefinitions'])
  })

  it('binds package operations to the caller workspace without preview resources', () => {
    const factory = createAnchoredCommentsCapabilityFactory({
      defineCapability: (definition) => definition, getComments: vi.fn(), getFeedback: vi.fn()
    })
    for (const definition of factory.createDefinitions()) {
      expect(definition.scope).toBe('workspace')
      expect(definition.description).toMatch(/workspace scope.*bound separately/iu)
    }
  })

  it('fails closed when the Host safe-capture contract is unavailable', async () => {
    const factory = createAnchoredCommentsCapabilityFactory({
      defineCapability: (definition) => definition, getComments: vi.fn(), getFeedback: vi.fn()
    })
    const capture = factory.createDefinitions().find((definition) => definition.id === ANCHORED_COMMENT_CAPABILITY_IDS.capture)!
    const result = await capture.handler(REQUEST)
    expect(anchoredCommentCaptureResultSchema.parse(result.output)).toMatchObject({
      ok: false, message: expect.stringContaining('unavailable')
    })
  })

  it('persists Host source and timestamp and passes the canonical document path to Host', async () => {
    const fixture = captureFixture()
    const result = await fixture.capture.handler(REQUEST)
    expect(fixture.getThread).toHaveBeenCalledWith(REQUEST.threadId)
    expect(fixture.captureRegisteredTarget).toHaveBeenCalledWith({
      targetRef: SOURCE.targetRef, expectedResourcePath: 'docs/a.md', annotation: 'callout', label: 'Document A'
    })
    expect(fixture.putScreenshotAsset).not.toHaveBeenCalled()
    expect(fixture.attachCapturedScreenshot).toHaveBeenCalledWith(
      REQUEST.threadId, PNG, { width: 2, height: 2 }, expect.any(Function), expect.objectContaining({ instanceId: 'service-test-instance' })
    )
    const parsed = anchoredCommentCaptureResultSchema.parse(result.output)
    expect(parsed).toMatchObject({ ok: true, capture: {
      capturedAt: SOURCE.capturedAt, source: SOURCE, contentDigest: DIGEST,
      redacted: true, focusedScreenshot: { digest: DIGEST, byteLength: PNG.byteLength }
    } })
    if (!parsed.ok) throw new Error('Expected successful capture')
    expect(fixture.attachCapturedScreenshot).toHaveBeenCalledTimes(1)
    const committedThread = await fixture.attachCapturedScreenshot.mock.results[0]!.value
    expect(parsed.capture).toEqual(committedThread.capture)
    expect(fixture.getThread.mock.invocationCallOrder[0]).toBeLessThan(fixture.captureRegisteredTarget.mock.invocationCallOrder[0]!)
  })

  it.each([
    ['different document', { ...SOURCE, resourcePath: '/workspace/docs/b.md' }],
    ['different registered target', { ...SOURCE, targetRef: 'view-document-b' }]
  ])('rejects %s before writing an asset', async (_label, source) => {
    const fixture = captureFixture()
    fixture.captureRegisteredTarget.mockResolvedValue({
      ok: true, png: PNG, width: 2, height: 2, sha256: DIGEST, redacted: true, source
    })
    await expect(fixture.capture.handler(REQUEST)).rejects.toThrow(/source does not match/)
    expect(fixture.putScreenshotAsset).not.toHaveBeenCalled()
    expect(fixture.attachCapturedScreenshot).not.toHaveBeenCalled()
  })

  it('rejects missing Host provenance before writing an asset', async () => {
    const fixture = captureFixture()
    fixture.captureRegisteredTarget.mockResolvedValue({
      ok: true, png: PNG, width: 2, height: 2, sha256: DIGEST, redacted: true
    })
    await expect(fixture.capture.handler(REQUEST)).rejects.toThrow(/source|provenance/i)
    expect(fixture.putScreenshotAsset).not.toHaveBeenCalled()
    expect(fixture.attachCapturedScreenshot).not.toHaveBeenCalled()
  })

  it('rejects a false Host SHA-256 before writing an asset', async () => {
    const fixture = captureFixture()
    fixture.captureRegisteredTarget.mockResolvedValue({
      ok: true, png: PNG, width: 2, height: 2, sha256: 'a'.repeat(64), redacted: true, source: SOURCE
    })
    await expect(fixture.capture.handler(REQUEST)).rejects.toThrow(/content digest check/)
    expect(fixture.putScreenshotAsset).not.toHaveBeenCalled()
    expect(fixture.attachCapturedScreenshot).not.toHaveBeenCalled()
  })

  it.each(['missing', 'existing-evidence'] as const)('rejects %s before capturing or writing an asset', async (state) => {
    const fixture = captureFixture()
    fixture.getThread.mockResolvedValue(state === 'missing' ? null : {
      capture: { focusedScreenshot: { digest: DIGEST } },
      anchor: { canonical: { kind: 'research', resourceId: 'docs/a.md' } }
    })
    await expect(fixture.capture.handler(REQUEST)).rejects.toThrow(state === 'missing' ? /not found/ : /already established/)
    expect(fixture.captureRegisteredTarget).not.toHaveBeenCalled()
    expect(fixture.putScreenshotAsset).not.toHaveBeenCalled()
    expect(fixture.attachCapturedScreenshot).not.toHaveBeenCalled()
  })

  it('does not write an asset when Host rejects a sensitive target', async () => {
    const fixture = captureFixture()
    fixture.captureRegisteredTarget.mockResolvedValue({ ok: false, error: { code: 'target-redacted', message: 'Sensitive target' } })
    expect(await fixture.capture.handler(REQUEST)).toEqual({ output: { ok: false, message: 'Sensitive target' } })
    expect(fixture.putScreenshotAsset).not.toHaveBeenCalled()
    expect(fixture.attachCapturedScreenshot).not.toHaveBeenCalled()
  })
})

function uncapturedThread(): AnchoredCommentThread {
  return {
    schemaVersion: 1, id: REQUEST.threadId, workspaceKey: '/workspace', purpose: 'research',
    anchor: { targetKey: 'docs/a.md', targetLabel: 'Document A', canonical: { kind: 'research', resourceKind: 'document', resourceId: 'docs/a.md' }, bounds: REQUEST.targetBounds },
    capture: { capturedAt: SOURCE.capturedAt, appVersion: 'test', platform: 'test', viewport: REQUEST.viewport, targetLabel: 'Document A', targetBounds: REQUEST.targetBounds, unavailableReason: 'Not captured' },
    messages: [{ id: 'original-message', body: 'Original', authorKind: 'user', createdAt: SOURCE.capturedAt, updatedAt: SOURCE.capturedAt }], status: 'open', anchorResolution: 'resolved', feedback: { state: 'local' }, createdAt: SOURCE.capturedAt, updatedAt: SOURCE.capturedAt
  }
}

it.each(['same', 'different', 'message', 'parallel'] as const)('checks original instance after delayed Host capture: %s', async mode => {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'ac-capture-aba-'))
  try {
    const comments = new RealCommentService(root)
    const original = uncapturedThread()
    await comments.upsertThread(original)
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    let started!: () => void
    const entered = new Promise<void>(resolve => { started = resolve })
    const captureRegisteredTarget = vi.fn(async () => {
      started(); await gate
      return { ok: true as const, png: PNG, width: 2, height: 2, sha256: DIGEST, redacted: true, source: { ...SOURCE } }
    })
    const factory = createAnchoredCommentsCapabilityFactory({
      defineCapability: definition => definition, getComments: () => comments,
      getFeedback: vi.fn(), visualCapture: { captureRegisteredTarget }
    })
    const capture = factory.createDefinitions().find(definition => definition.id === ANCHORED_COMMENT_CAPABILITY_IDS.capture)!
    const pending = capture.handler(REQUEST)
    await entered
    let second: ReturnType<typeof capture.handler> | undefined
    if (mode === 'same' || mode === 'different') {
      await comments.deleteThread(original.id)
      const replacement = structuredClone(original) // identical caller createdAt must not reuse service identity
      if (mode === 'different') {
        replacement.anchor.targetKey = 'docs/b.md'
        replacement.anchor.canonical = { kind: 'research', resourceKind: 'document', resourceId: 'docs/b.md' }
      }
      await comments.upsertThread(replacement)
    } else if (mode === 'message') {
      await comments.upsertThread({ ...original, messages: [{ id: 'new-message', body: 'Keep this update', authorKind: 'user', createdAt: SOURCE.capturedAt, updatedAt: SOURCE.capturedAt }] })
    } else {
      second = capture.handler(REQUEST)
      // Wait until both Host awaits have been entered, without timers.
      while (captureRegisteredTarget.mock.calls.length < 2) await Promise.resolve()
    }
    const before = await readFile(comments.storePath())
    release()
    if (mode === 'same' || mode === 'different') {
      await expect(pending).rejects.toThrow(/instance or canonical identity changed/)
      expect(await readFile(comments.storePath())).toEqual(before)
      expect(await readdir(join(root, 'anchored-comments', 'assets')).catch((error: NodeJS.ErrnoException) => { if (error.code === 'ENOENT') return []; throw error })).toEqual([])
    } else if (mode === 'parallel') {
      const results = await Promise.allSettled([pending, second!])
      expect(results.map(result => result.status)).toEqual(['fulfilled', 'rejected'])
      expect(await readdir(join(root, 'anchored-comments', 'assets'))).toEqual([`${DIGEST}.png`])
    } else {
      await expect(pending).resolves.toMatchObject({ output: { ok: true } })
      expect((await comments.getThread(original.id))!.messages[0]!.body).toBe('Keep this update')
    }
  } finally { await rm(root, { recursive: true, force: true }) }
})
