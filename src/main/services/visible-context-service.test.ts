import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas } from '@napi-rs/canvas'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  VISIBLE_CONTEXT_SCHEMA_VERSION,
  type VisibleContextSnapshot
} from '../../shared/visible-context'
import {
  VisibleContextService,
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

function snapshot(overrides: Partial<VisibleContextSnapshot> = {}): VisibleContextSnapshot {
  return {
    schemaVersion: VISIBLE_CONTEXT_SCHEMA_VERSION,
    windowId: 'electron:1',
    revision: 1,
    publishedAt: '2026-07-11T03:00:00.000Z',
    freshness: { stale: false, ageMs: 0, staleAfterMs: 5_000 },
    workspaceRoot: '/workspace',
    route: '/chat',
    components: [{
      id: 'right-sidebar.file-preview',
      region: 'right-sidebar',
      component: 'pdf',
      title: 'Paper.pdf',
      visible: true,
      updatedAt: '2026-07-11T03:00:00.000Z',
      summary: 'PDF page 10',
      resources: [{
        kind: 'workspace-preview',
        role: 'preview-target',
        title: 'Paper.pdf',
        capability: {
          resource: {
            token: `cap_${'a'.repeat(26)}`,
            semanticRevision: 'paper-1',
            expiresAt: '2026-07-11T04:00:00.000Z'
          },
          resourceRef: `res_${'b'.repeat(26)}`,
          operations: []
        }
      }],
      visualTargets: [{
        id: 'current-page',
        kind: 'document-page',
        contentType: 'application/pdf',
        bounds: { x: 10, y: 20, width: 300, height: 400 },
        page: 10,
        active: true
      }]
    }],
    ...overrides
  }
}

function successfulSurfaceCaptureProvider(
  capturePage: (bounds?: { x: number; y: number; width: number; height: number }) => Promise<CapturedVisualPage>
): SurfaceCaptureProvider {
  return {
    capture: async (request) => ({ ok: true, page: await capturePage(request.bounds) })
  }
}

describe('VisibleContextService capture', () => {
  it('keeps semantic current resources available when only renderer layout is stale', async () => {
    const service = new VisibleContextService(await temporaryUserData(), {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(vi.fn()),
      now: () => new Date('2026-07-11T03:00:06.000Z')
    })
    await service.publish(snapshot())

    const current = await service.currentSurface()
    expect(current.resourceId).toBe('electron:1')
    expect(current.state).toMatchObject({
      layoutFreshness: { stale: true, ageMs: 6_000, staleAfterMs: 5_000 }
    })
  })

  it('derives freshness and rejects out-of-order publishes for the same window', async () => {
    const userDataDir = await temporaryUserData()
    let now = new Date('2026-07-11T03:00:01.000Z')
    const service = new VisibleContextService(userDataDir, {
      surfaceCaptureProvider: { capture: vi.fn() },
      now: () => now
    })

    const published = await service.publish(snapshot())
    expect(published).not.toHaveProperty('snapshotToken')
    expect(published.freshness).toEqual({ stale: false, ageMs: 1_000, staleAfterMs: 5_000 })
    now = new Date('2026-07-11T03:00:07.000Z')
    expect((await service.get()).freshness.stale).toBe(true)
    expect((await service.publish(snapshot({ revision: 0, route: '/out-of-order' }))).route).toBe('/chat')
  })

  it('separates semantic revision from layout revision and emits stable opaque target refs', async () => {
    const service = new VisibleContextService(await temporaryUserData(), {
      surfaceCaptureProvider: { capture: vi.fn() },
      now: () => new Date('2026-07-11T03:00:01.000Z')
    })
    await service.publish(snapshot())
    const first = await service.currentSurface()
    const firstState = first.state as { targets: Array<{ targetRef: string }> }

    await service.publish(snapshot({
      revision: 2,
      publishedAt: '2026-07-11T03:00:01.000Z',
      components: snapshot().components.map((component) => ({
        ...component,
        updatedAt: '2026-07-11T03:00:01.000Z',
        visualTargets: component.visualTargets?.map((target) => ({
          ...target,
          bounds: { x: 40, y: 60, width: 300, height: 400 }
        }))
      }))
    }))
    const moved = await service.currentSurface()
    const movedState = moved.state as { targets: Array<{ targetRef: string }> }
    expect(moved.semanticRevision).toBe(first.semanticRevision)
    expect(moved.layoutRevision).not.toBe(first.layoutRevision)
    expect(movedState.targets[0]?.targetRef).toBe(firstState.targets[0]?.targetRef)

    await service.publish(snapshot({
      revision: 3,
      publishedAt: '2026-07-11T03:00:02.000Z',
      components: snapshot().components.map((component) => ({ ...component, summary: 'PDF page 11' }))
    }))
    expect((await service.currentSurface()).semanticRevision).not.toBe(first.semanticRevision)
  })

  it('resolves an observed target against the latest surface atomically without a stale-read rejection', async () => {
    const capture = vi.fn(async () => ({
      png: whitePng(),
      width: 100,
      height: 80,
      scaleFactor: 1,
      bounds: { x: 30, y: 40, width: 310, height: 410 }
    }))
    const service = new VisibleContextService(await temporaryUserData(), {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(capture),
      now: () => new Date('2026-07-11T03:00:03.000Z')
    })
    await service.publish(snapshot())
    const observed = await service.currentSurface()
    const targetRef = (observed.state as { targets: Array<{ targetRef: string }> }).targets[0]?.targetRef

    await service.publish(snapshot({
      revision: 2,
      publishedAt: '2026-07-11T03:00:02.000Z',
      components: snapshot().components.map((component) => ({
        ...component,
        summary: 'Five annotations are now visible',
        visualTargets: component.visualTargets?.map((target) => ({
          ...target,
          bounds: { x: 30, y: 40, width: 310, height: 410 }
        }))
      }))
    }))

    const result = await service.captureFrame(observed.resourceId, { targetRef })
    expect(capture).toHaveBeenCalledWith({ x: 30, y: 40, width: 310, height: 410 })
    expect(result).toEqual({
      path: expect.stringMatching(/surface-[a-f0-9]{24}\.png$/u),
      mimeType: 'image/png',
      capturedAt: '2026-07-11T03:00:03.000Z',
      width: 100,
      height: 80,
      targetRef
    })
  })

  it('captures a trusted target frame without requiring visual interpretation', async () => {
    const capture = vi.fn(async () => ({
      png: whitePng(310, 410),
      width: 310,
      height: 410,
      scaleFactor: 1,
      bounds: { x: 30, y: 40, width: 310, height: 410 }
    }))
    const service = new VisibleContextService(await temporaryUserData(), {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(capture),
      now: () => new Date('2026-07-11T03:00:03.000Z')
    })
    await service.publish(snapshot())
    const observed = await service.currentSurface()
    const targetRef = (observed.state as { targets: Array<{ targetRef: string }> }).targets[0]?.targetRef

    const frame = await service.captureFrame(observed.resourceId, { targetRef })

    expect(capture).toHaveBeenCalledWith({ x: 10, y: 20, width: 300, height: 400 })
    expect(frame).toEqual({
      path: expect.stringMatching(/surface-[a-f0-9]{24}\.png$/u),
      mimeType: 'image/png',
      capturedAt: '2026-07-11T03:00:03.000Z',
      width: 310,
      height: 410,
      targetRef
    })
    expect(await service.readCapturePreview(frame.path)).toMatchObject({
      ok: true,
      mimeType: 'image/png'
    })
  })

  it('keeps a running caller bound to its starting semantic surface after the foreground thread changes', async () => {
    const capture = vi.fn()
    const service = new VisibleContextService(await temporaryUserData(), {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(capture),
      now: () => new Date('2026-07-11T03:00:02.000Z')
    })
    await service.publish(snapshot({ activeThreadId: 'thread-a' }))
    await service.bindCurrentSurface('codex:thread-a', 'thread-a')
    const bound = await service.currentSurface('codex:thread-a')

    await service.publish(snapshot({
      revision: 2,
      publishedAt: '2026-07-11T03:00:01.000Z',
      activeThreadId: 'thread-b',
      components: snapshot().components.map((component) => ({
        ...component,
        title: 'Other.pdf',
        resources: component.resources?.map((resource) => ({
          ...resource,
          title: 'Other.pdf',
          capability: {
            resourceRef: `res_${'c'.repeat(26)}`,
            operations: []
          }
        }))
      }))
    }))

    const stillBound = await service.currentSurface('codex:thread-a')
    const foreground = await service.currentSurface('codex:thread-b')
    expect(stillBound.resourceId).toBe(bound.resourceId)
    expect(stillBound.state).toMatchObject({
      resources: [expect.objectContaining({ title: 'Paper.pdf', resourceRef: `res_${'b'.repeat(26)}` })]
    })
    expect(foreground.state).toMatchObject({
      resources: [expect.objectContaining({ title: 'Other.pdf', resourceRef: `res_${'c'.repeat(26)}` })]
    })
    await expect(service.captureFrame(bound.resourceId))
      .rejects.toThrow(/another session or resource is visible/u)
    expect(capture).not.toHaveBeenCalled()
  })

  it('requests a renderer refresh only when capture needs stale layout', async () => {
    const capture = vi.fn(async () => ({
      png: whitePng(),
      width: 100,
      height: 80,
      scaleFactor: 1,
      bounds: { x: 50, y: 70, width: 300, height: 400 }
    }))
    let service: VisibleContextService
    const requestSurfaceRefresh = vi.fn(() => {
      void service.publish(snapshot({
        revision: 2,
        publishedAt: '2026-07-11T03:00:06.000Z',
        activeThreadId: 'thread-a',
        components: snapshot().components.map((component) => ({
          ...component,
          visualTargets: component.visualTargets?.map((target) => ({
            ...target,
            bounds: { x: 50, y: 70, width: 300, height: 400 }
          }))
        }))
      }))
    })
    service = new VisibleContextService(await temporaryUserData(), {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(capture),
      requestSurfaceRefresh,
      now: () => new Date('2026-07-11T03:00:06.000Z')
    })
    await service.publish(snapshot({ activeThreadId: 'thread-a' }))
    await service.bindCurrentSurface('codex:thread-a', 'thread-a')
    const bound = await service.currentSurface('codex:thread-a')
    const targetRef = (bound.state as { targets: Array<{ targetRef: string }> }).targets[0]?.targetRef

    await service.captureFrame(bound.resourceId, { targetRef })

    expect(requestSurfaceRefresh).toHaveBeenCalledWith('electron:1')
    expect(capture).toHaveBeenCalledWith({ x: 50, y: 70, width: 300, height: 400 })
  })

  it('fails closed when the requested opaque target is no longer visible', async () => {
    const capture = vi.fn()
    const service = new VisibleContextService(await temporaryUserData(), {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(capture),
      now: () => new Date('2026-07-11T03:00:03.000Z')
    })
    await service.publish(snapshot())
    await expect(service.captureFrame('electron:1', {
      targetRef: `target_${'x'.repeat(26)}`
    })).rejects.toThrow('no longer visible')
    expect(capture).not.toHaveBeenCalled()
  })
})
