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

function inspectedEvidence(task: string) {
  return {
    status: 'inspected' as const,
    provider: 'model-router' as const,
    model: 'vision-model',
    inspectedAt: '2026-07-11T03:00:02.000Z',
    task,
    artifacts: [{ id: 'surface', mimeType: 'image/png' as const, sha256: 'a'.repeat(64) }],
    requestSha256: 'b'.repeat(64),
    evidenceSha256: 'c'.repeat(64),
    attestation: `sha256:${'d'.repeat(64)}`,
    summary: 'Five PDF annotations are visible.',
    claims: [],
    uncertainties: []
  }
}

describe('VisibleContextService surface inspection v2', () => {
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
    const inspector = vi.fn(async (request: { task: string }) => inspectedEvidence(request.task))
    const service = new VisibleContextService(await temporaryUserData(), {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(capture),
      visualInspector: () => inspector,
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

    const result = await service.inspectSurface(observed.resourceId, {
      targetRef,
      task: 'Count the visible PDF annotations.'
    })
    expect(capture).toHaveBeenCalledWith({ x: 30, y: 40, width: 310, height: 410 })
    expect(result).toMatchObject({
      artifact: { artifactRef: expect.stringMatching(/^artifact_/u), targetRef },
      evidence: { provider: 'model-router', summary: 'Five PDF annotations are visible.' }
    })
    expect(JSON.stringify(result)).not.toMatch(/path|snapshotToken|componentId|targetId|bounds|revision/iu)
  })

  it('fails closed when the requested opaque target is no longer visible', async () => {
    const capture = vi.fn()
    const service = new VisibleContextService(await temporaryUserData(), {
      surfaceCaptureProvider: successfulSurfaceCaptureProvider(capture),
      now: () => new Date('2026-07-11T03:00:03.000Z')
    })
    await service.publish(snapshot())
    await expect(service.inspectSurface('electron:1', {
      targetRef: `target_${'x'.repeat(26)}`,
      task: 'Inspect the target.'
    })).rejects.toThrow('no longer visible')
    expect(capture).not.toHaveBeenCalled()
  })
})
