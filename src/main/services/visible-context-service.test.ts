import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION,
  VISIBLE_CONTEXT_SCHEMA_VERSION,
  type VisibleContextSnapshot
} from '../../shared/visible-context'
import {
  VisibleContextService,
  visibleContextCaptureRequestsPath,
  type CapturedVisualPage,
  type SurfaceCaptureProvider
} from './visible-context-service'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryUserData(): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), 'sciforge-visible-context-'))
  cleanup.push(path)
  return path
}

function whitePng(width = 100, height = 80): Buffer {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  return canvas.encodeSync('png')
}

async function pixel(path: string, x: number, y: number): Promise<number[]> {
  const image = await loadImage(path)
  const canvas = createCanvas(image.width, image.height)
  const context = canvas.getContext('2d')
  context.drawImage(image, 0, 0)
  return [...context.getImageData(x, y, 1, 1).data]
}

function snapshot(overrides: Partial<VisibleContextSnapshot> = {}): VisibleContextSnapshot {
  return {
    schemaVersion: VISIBLE_CONTEXT_SCHEMA_VERSION,
    windowId: 'window-1',
    revision: 1,
    publishedAt: '2026-07-11T03:00:00.000Z',
    freshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
    components: [{
      id: 'preview',
      region: 'workspace-preview',
      component: 'pdf',
      visible: true,
      updatedAt: '2026-07-11T03:00:00.000Z',
      summary: 'PDF page 10',
      visualTargets: [{
        id: 'page-10',
        kind: 'document-page',
        contentType: 'application/pdf',
        bounds: { x: -5, y: 20, width: 300, height: 400 },
        page: 10,
        active: true
      }]
    }],
    ...overrides
  }
}

function captureIdentity(value: VisibleContextSnapshot) {
  if (!value.snapshotToken) throw new Error('Expected a bound visible-context snapshot token.')
  return {
    snapshotToken: value.snapshotToken,
    windowId: value.windowId,
    revision: value.revision,
    activeThreadId: value.activeThreadId ?? null
  }
}

function successfulSurfaceCaptureProvider(
  capturePage: (windowId: string, bounds?: { x: number; y: number; width: number; height: number }) => Promise<CapturedVisualPage>
): SurfaceCaptureProvider {
  return {
    capture: async (request) => ({
      ok: true,
      page: await capturePage(request.windowId, request.bounds)
    })
  }
}

describe('VisibleContextService', () => {
  it('derives freshness and rejects out-of-order publishes for the same window', async () => {
    const userDataDir = await temporaryUserData()
    let now = new Date('2026-07-11T03:00:01.000Z')
    const service = new VisibleContextService(userDataDir, {
      surfaceCaptureProvider: { capture: vi.fn() },
      now: () => now
    })

    const published = await service.publish(snapshot())
    expect(published.freshness).toEqual({ stale: false, ageMs: 1_000, staleAfterMs: 5_000 })

    now = new Date('2026-07-11T03:00:07.000Z')
    expect((await service.get()).freshness).toEqual({
      stale: true,
      ageMs: 7_000,
      staleAfterMs: 5_000
    })

    const stalePublish = snapshot({ revision: 0, route: '/out-of-order' })
    expect((await service.publish(stalePublish)).route).toBeUndefined()
  })

  it('resolves target bounds and preserves a stable capture asset for each request', async () => {
    const userDataDir = await temporaryUserData()
    const capturePage = vi.fn()
      .mockResolvedValueOnce({
        png: Uint8Array.from([1, 2, 3]),
        width: 600,
        height: 800,
        scaleFactor: 2,
        bounds: { x: 0, y: 20, width: 295, height: 400 }
      })
      .mockResolvedValueOnce({
        png: Uint8Array.from([4, 5]),
        width: 1200,
        height: 900,
        scaleFactor: 2
      })
    const captureStates: boolean[] = []
    const service = new VisibleContextService(userDataDir, {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(capturePage),
      onCaptureState: (_windowId, active) => captureStates.push(active),
      now: () => new Date('2026-07-11T03:00:01.000Z')
    })
    const published = await service.publish(snapshot())

    const target = await service.capture({
      requestId: 'capture-target',
      ...captureIdentity(published),
      scope: 'target',
      componentId: 'preview',
      targetId: 'page-10'
    })
    expect(capturePage).toHaveBeenNthCalledWith(1, 'window-1', { x: -5, y: 20, width: 300, height: 400 })
    expect(target).toMatchObject({
      ok: true,
      resource: {
        kind: 'visualSnapshot',
        role: 'target',
        mimeType: 'image/png',
        windowId: 'window-1',
        revision: 1,
        componentId: 'preview',
        targetId: 'page-10',
        target: { bounds: { x: 0, y: 20, width: 295, height: 400 }, page: 10 }
      }
    })
    if (!target.ok) throw new Error('Expected target capture to succeed.')
    expect(target.resource.path.startsWith(userDataDir)).toBe(true)
    expect([...await readFile(target.resource.path)]).toEqual([1, 2, 3])

    const fullWindow = await service.capture({ requestId: 'capture-window', ...captureIdentity(published), scope: 'window' })
    expect(capturePage).toHaveBeenNthCalledWith(2, 'window-1', undefined)
    expect(fullWindow).toMatchObject({ ok: true, resource: { role: 'window' } })
    if (!fullWindow.ok) throw new Error('Expected window capture to succeed.')
    expect(fullWindow.resource.path).not.toBe(target.resource.path)
    expect(fullWindow.resource.path).toBe(service.capturePath('capture-window'))
    expect([...await readFile(target.resource.path)]).toEqual([1, 2, 3])
    expect([...await readFile(fullWindow.resource.path)]).toEqual([4, 5])
    expect(captureStates).toEqual([true, false, true, false])
  })

  it('does not capture missing or stale targets', async () => {
    const userDataDir = await temporaryUserData()
    const capturePage = vi.fn()
    const service = new VisibleContextService(userDataDir, {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(capturePage),
      now: () => new Date('2026-07-11T03:00:10.000Z')
    })
    const published = await service.publish(snapshot())

    await expect(service.capture({
      requestId: 'capture-target',
      ...captureIdentity(published),
      scope: 'target',
      componentId: 'preview',
      targetId: 'page-10'
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'stale_visible_context', retryable: true }
    })
    expect(capturePage).not.toHaveBeenCalled()
  })

  it('captures the surface bound to the requested token even after another window publishes', async () => {
    const userDataDir = await temporaryUserData()
    const capture = vi.fn(async () => ({
      ok: true as const,
      page: {
        png: Uint8Array.from([7]),
        width: 100,
        height: 80,
        scaleFactor: 1
      }
    }))
    const service = new VisibleContextService(userDataDir, {
      surfaceCaptureProvider: { capture },
      now: () => new Date('2026-07-11T03:00:01.000Z')
    })
    const first = await service.publish(snapshot({ windowId: 'electron:11' }))
    await service.publish(snapshot({ windowId: 'electron:22' }))

    const result = await service.capture({
      requestId: 'capture-first-surface',
      ...captureIdentity(first),
      scope: 'window'
    })

    expect(result).toMatchObject({ ok: true, resource: { windowId: 'electron:11' } })
    expect(capture).toHaveBeenCalledWith({
      windowId: 'electron:11',
      revision: 1,
      snapshotToken: first.snapshotToken,
      activeThreadId: null
    })
  })

  it('returns typed provider capability failures without treating them as capture exceptions', async () => {
    const userDataDir = await temporaryUserData()
    const capture = vi.fn(async () => ({
      ok: false as const,
      reason: {
        code: 'surface_capture_unsupported' as const,
        message: 'This surface has no trusted pixel source.',
        retryable: false
      }
    }))
    const service = new VisibleContextService(userDataDir, {
      surfaceCaptureProvider: { capture },
      now: () => new Date('2026-07-11T03:00:01.000Z')
    })
    const published = await service.publish(snapshot({ windowId: 'browser:4' }))

    await expect(service.capture({
      requestId: 'capture-browser-surface',
      ...captureIdentity(published),
      scope: 'window'
    })).resolves.toEqual({
      ok: false,
      requestId: 'capture-browser-surface',
      error: {
        code: 'surface_capture_unsupported',
        message: 'This surface has no trusted pixel source.',
        retryable: false
      }
    })
    expect(capture).toHaveBeenCalledOnce()
  })

  it('rejects an old token after the same surface publishes a newer revision', async () => {
    const userDataDir = await temporaryUserData()
    const capturePage = vi.fn()
    const service = new VisibleContextService(userDataDir, {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(capturePage),
      now: () => new Date('2026-07-11T03:00:01.000Z')
    })
    const first = await service.publish(snapshot())
    await service.publish(snapshot({ revision: 2, publishedAt: '2026-07-11T03:00:01.000Z' }))

    await expect(service.capture({
      requestId: 'capture-old-token',
      ...captureIdentity(first),
      scope: 'window'
    })).resolves.toMatchObject({
      ok: false,
      error: { code: 'stale_snapshot_token', retryable: true }
    })
    expect(capturePage).not.toHaveBeenCalled()
  })

  it('requests a targeted refresh but refuses to capture a stale bound revision', async () => {
    const userDataDir = await temporaryUserData()
    const capturePage = vi.fn(async () => ({
      png: Uint8Array.from([1]),
      width: 300,
      height: 400,
      scaleFactor: 1,
      bounds: { x: 0, y: 20, width: 295, height: 400 }
    }))
    const requestContextRefresh = vi.fn()
    const service = new VisibleContextService(userDataDir, {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(capturePage),
      requestContextRefresh,
      now: () => new Date('2026-07-11T03:00:10.000Z')
    })
    const published = await service.publish(snapshot())

    const result = await service.capture({
      requestId: 'capture-refreshed-target',
      ...captureIdentity(published),
      scope: 'target',
      componentId: 'preview',
      targetId: 'page-10'
    })

    expect(requestContextRefresh).toHaveBeenCalledTimes(1)
    expect(requestContextRefresh).toHaveBeenCalledWith('window-1')
    expect(capturePage).not.toHaveBeenCalled()
    expect(result).toMatchObject({ ok: false, error: { code: 'stale_visible_context' } })
  })

  it('blackens every intersecting redaction target before writing the single capture asset', async () => {
    const userDataDir = await temporaryUserData()
    const service = new VisibleContextService(userDataDir, {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(
        async () => ({
          png: whitePng(),
          width: 100,
          height: 80,
          scaleFactor: 1
        })
      ),
      now: () => new Date('2026-07-11T03:00:01.000Z')
    })
    const published = await service.publish(snapshot({
      components: [{
        id: 'app.window',
        region: 'window',
        component: 'sciforge-window',
        visible: true,
        updatedAt: '2026-07-11T03:00:00.000Z',
        summary: 'SciForge window',
        visualTargets: [
          { id: 'password', kind: 'region', bounds: { x: 10, y: 10, width: 20, height: 15 }, redact: true },
          { id: 'outside', kind: 'region', bounds: { x: 200, y: 200, width: 10, height: 10 }, redact: true }
        ]
      }]
    }))

    const result = await service.capture({ requestId: 'capture-redacted', ...captureIdentity(published), scope: 'window' })
    if (!result.ok) throw new Error('Expected redacted capture to succeed.')
    expect(await pixel(result.resource.path, 15, 15)).toEqual([0, 0, 0, 255])
    expect(await pixel(result.resource.path, 5, 5)).toEqual([255, 255, 255, 255])
  })

  it('reads only PNG previews directly inside the managed capture directory', async () => {
    const userDataDir = await temporaryUserData()
    const service = new VisibleContextService(userDataDir, {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(
        async () => ({
          png: whitePng(),
          width: 100,
          height: 80,
          scaleFactor: 1
        })
      ),
      now: () => new Date('2026-07-11T03:00:01.000Z')
    })
    const published = await service.publish(snapshot())
    const capture = await service.capture({ requestId: 'capture-preview', ...captureIdentity(published), scope: 'window' })
    if (!capture.ok) throw new Error('Expected capture to succeed.')

    await expect(service.readCapturePreview(capture.resource.path)).resolves.toMatchObject({
      ok: true,
      path: capture.resource.path,
      mimeType: 'image/png',
      dataUrl: expect.stringMatching(/^data:image\/png;base64,/)
    })
    await expect(service.readCapturePreview(join(userDataDir, 'outside.png'))).resolves.toEqual({
      ok: false,
      message: 'Capture preview path is outside the managed capture directory.'
    })
  })

  it('retains only the bounded set of most recent stable capture assets', async () => {
    const userDataDir = await temporaryUserData()
    const service = new VisibleContextService(userDataDir, {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(
        async () => ({ png: whitePng(), width: 100, height: 80, scaleFactor: 1 })
      ),
      captureRetentionLimit: 2,
      now: () => new Date('2026-07-11T03:00:01.000Z')
    })
    const published = await service.publish(snapshot())
    for (const requestId of ['capture-1', 'capture-2', 'capture-3']) {
      const result = await service.capture({ requestId, ...captureIdentity(published), scope: 'window' })
      if (!result.ok) throw new Error('Expected capture to succeed.')
    }

    const names = await readdir(dirname(service.capturePath('capture-3')))
    const captures = names.filter((name) => name.endsWith('.png'))
    expect(captures).toHaveLength(2)
    expect(captures).toContain('capture-3.png')
  })

  it('handles pre-existing broker requests through the same capture path', async () => {
    const userDataDir = await temporaryUserData()
    const requestDirectory = visibleContextCaptureRequestsPath(userDataDir)
    const service = new VisibleContextService(userDataDir, {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(
        async () => ({
          png: Uint8Array.from([9, 8, 7]),
          width: 100,
          height: 80,
          scaleFactor: 1
        })
      ),
      now: () => new Date('2026-07-11T03:00:01.000Z')
    })
    const published = await service.publish(snapshot())
    await mkdir(requestDirectory, { recursive: true })
    await writeFile(join(requestDirectory, 'broker-1.request.json'), JSON.stringify({
      schemaVersion: VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION,
      requestId: 'broker-1',
      requestedAt: '2026-07-11T03:00:00.000Z',
      expiresAt: '2026-07-11T03:00:10.000Z',
      ...captureIdentity(published),
      scope: 'window'
    }))

    const stop = await service.startCaptureRequestBroker()
    const responsePath = join(requestDirectory, 'broker-1.response.json')
    await vi.waitFor(async () => {
      const response = JSON.parse(await readFile(responsePath, 'utf8')) as Record<string, unknown>
      expect(response).toMatchObject({
        schemaVersion: VISIBLE_CONTEXT_CAPTURE_BROKER_SCHEMA_VERSION,
        requestId: 'broker-1',
        ok: true,
        capture: { kind: 'visualSnapshot', path: service.capturePath('broker-1') }
      })
    })
    stop()
  })
})
