import { createHash } from 'node:crypto'
import { mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CapabilityCallerContext } from '../../../shared/capability-broker'
import type { VisualInspector } from '../../../../packages/workers/workspace-intel/src/visual-inspection'
import {
  AgentVisualRuntime,
  type AgentVisualRuntimeCallContext
} from './agent-visual-runtime'

const cleanup: string[] = []

afterEach(async () => {
  await Promise.all(cleanup.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function temporaryDirectory(prefix: string): Promise<string> {
  const path = await mkdtemp(join(tmpdir(), prefix))
  cleanup.push(path)
  return path
}

function testPng(width = 100, height = 80): Buffer {
  const canvas = createCanvas(width, height)
  const context = canvas.getContext('2d')
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, width, height)
  context.fillStyle = '#1769aa'
  context.fillRect(width * 0.2, height * 0.25, width * 0.5, height * 0.5)
  return canvas.encodeSync('png')
}

function caller(workspaceId: string, callerId = 'codex:thread-a'): CapabilityCallerContext {
  return {
    audience: 'agent',
    callerId,
    workspaceId,
    approvals: []
  }
}

function callContext(
  workspaceId: string,
  overrides: Partial<AgentVisualRuntimeCallContext['request']> = {},
  callerId = 'codex:thread-a'
): AgentVisualRuntimeCallContext {
  return {
    caller: caller(workspaceId, callerId),
    request: {
      runtimeId: 'codex',
      threadId: 'thread-a',
      turnId: 'turn-1',
      workspaceId,
      ...overrides
    },
    signal: new AbortController().signal
  }
}

function inspectorWithRegion(): VisualInspector {
  return vi.fn(async (request) => {
    const bytes = await readFile(request.artifacts[0]!.imagePath)
    return {
      status: 'inspected' as const,
      provider: 'model-router' as const,
      model: 'vision-model',
      inspectedAt: '2026-07-26T06:00:00.000Z',
      task: request.task,
      artifacts: [{
        id: 'source',
        mimeType: request.artifacts[0]!.mimeType,
        sha256: createHash('sha256').update(bytes).digest('hex')
      }],
      requestSha256: 'a'.repeat(64),
      evidenceSha256: 'b'.repeat(64),
      attestation: `sha256:${'c'.repeat(64)}`,
      summary: 'The requested visual region is visible.',
      claims: [{
        kind: 'observation' as const,
        text: 'Blue method overview region',
        artifactId: 'source',
        region: { x: 0.2, y: 0.25, width: 0.5, height: 0.5 },
        confidence: 0.98
      }],
      uncertainties: []
    }
  })
}

describe('AgentVisualRuntime', () => {
  it('looks at the current trusted surface and persists a verified region as a content-addressed PNG', async () => {
    const workspaceRoot = await temporaryDirectory('sciforge-agent-visual-workspace-')
    const captureRoot = await temporaryDirectory('sciforge-agent-visual-capture-')
    const sourcePath = join(captureRoot, 'surface.png')
    await writeFile(sourcePath, testPng())
    const captureFrame = vi.fn(async () => ({
      path: sourcePath,
      mimeType: 'image/png' as const,
      capturedAt: '2026-07-26T06:00:00.000Z',
      width: 100,
      height: 80
    }))
    const inspector = inspectorWithRegion()
    const runtime = new AgentVisualRuntime({
      visibleContext: {
        currentSurface: vi.fn(async () => ({
          resourceId: 'bound-surface',
          workspaceId: workspaceRoot,
          semanticRevision: 'surface-1',
          layoutRevision: '1',
          state: {}
        })),
        captureFrame
      },
      visualInspector: () => inspector,
      now: () => new Date('2026-07-26T06:00:01.000Z'),
      secret: Buffer.alloc(32, 7)
    })
    const context = callContext(workspaceRoot)

    const looked = await runtime.look({
      targetRef: `target_${'t'.repeat(24)}`,
      task: 'Locate the method overview.'
    }, context)
    expect(captureFrame).toHaveBeenCalledWith('bound-surface', {
      targetRef: `target_${'t'.repeat(24)}`
    })
    expect(looked).toMatchObject({
      snapshotRef: expect.stringMatching(/^snapshot_/u),
      regions: [{
        regionRef: expect.stringMatching(/^region_/u),
        label: 'Blue method overview region',
        confidence: 0.98
      }],
      evidence: {
        claims: [{
          text: 'Blue method overview region',
          regionRef: expect.stringMatching(/^region_/u)
        }]
      },
      proof: {
        kind: 'look',
        status: 'verified'
      }
    })
    expect(looked.proof).not.toHaveProperty('sourceRef')

    const captured = await runtime.capture({
      snapshotRef: looked.snapshotRef,
      regionRef: looked.regions[0]!.regionRef
    }, context)
    expect(captured.relativePath).toMatch(/^\.sciforge\/visual-assets\/[a-f0-9]{64}\.png$/u)
    expect(captured.changed).toBe(true)
    expect(captured.proof).toMatchObject({
      inspectionProofRef: looked.proof.proofRef,
      snapshotRef: looked.snapshotRef,
      regionRef: looked.regions[0]!.regionRef,
      cropped: true
    })
    const persisted = await readFile(join(workspaceRoot, captured.relativePath))
    expect(createHash('sha256').update(persisted).digest('hex')).toBe(captured.sha256)
    const image = await loadImage(persisted)
    expect({ width: image.width, height: image.height }).toEqual({ width: 50, height: 40 })

    const replay = await runtime.capture({
      snapshotRef: looked.snapshotRef,
      regionRef: looked.regions[0]!.regionRef
    }, context)
    expect(replay.artifactRef).toBe(captured.artifactRef)
    expect(replay.relativePath).toBe(captured.relativePath)
    expect(replay.changed).toBe(false)
  })

  it('looks again at a captured artifact and links the final inspection to its capture proof', async () => {
    const workspaceRoot = await temporaryDirectory('sciforge-agent-visual-final-')
    const captureRoot = await temporaryDirectory('sciforge-agent-visual-final-source-')
    const sourcePath = join(captureRoot, 'surface.png')
    await writeFile(sourcePath, testPng())
    const inspector = inspectorWithRegion()
    const runtime = new AgentVisualRuntime({
      visibleContext: {
        currentSurface: vi.fn(async () => ({
          resourceId: 'surface',
          workspaceId: workspaceRoot,
          semanticRevision: 'surface-1',
          layoutRevision: '1',
          state: {}
        })),
        captureFrame: vi.fn(async () => ({
          path: sourcePath,
          mimeType: 'image/png' as const,
          capturedAt: '2026-07-26T06:00:00.000Z',
          width: 100,
          height: 80
        }))
      },
      visualInspector: () => inspector,
      now: () => new Date('2026-07-26T06:00:01.000Z'),
      secret: Buffer.alloc(32, 8)
    })
    const context = callContext(workspaceRoot)
    const firstLook = await runtime.look({ task: 'Locate the method overview.' }, context)
    const capture = await runtime.capture({
      snapshotRef: firstLook.snapshotRef,
      regionRef: firstLook.regions[0]!.regionRef
    }, context)

    const finalLook = await runtime.look({
      sourceRef: capture.artifactRef,
      task: 'Verify the final persisted crop.',
      intent: 'quality-review'
    }, context)

    expect(finalLook.proof).toMatchObject({
      sourceRef: capture.artifactRef,
      parentProofRef: capture.proof.proofRef
    })
    expect(inspector).toHaveBeenCalledTimes(2)

    await expect(runtime.look({
      sourceRef: capture.artifactRef,
      frame: 2,
      task: 'Inspect another frame.'
    }, context)).rejects.toThrow(/artifact cannot select another visual frame/u)
  })

  it('rejects snapshot and region refs outside their caller, workspace, or turn', async () => {
    const workspaceRoot = await temporaryDirectory('sciforge-agent-visual-scope-')
    const captureRoot = await temporaryDirectory('sciforge-agent-visual-scope-source-')
    const sourcePath = join(captureRoot, 'surface.png')
    await writeFile(sourcePath, testPng())
    const runtime = new AgentVisualRuntime({
      visibleContext: {
        currentSurface: vi.fn(async () => ({
          resourceId: 'surface',
          workspaceId: workspaceRoot,
          semanticRevision: 'surface-1',
          layoutRevision: '1',
          state: {}
        })),
        captureFrame: vi.fn(async () => ({
          path: sourcePath,
          mimeType: 'image/png' as const,
          capturedAt: '2026-07-26T06:00:00.000Z',
          width: 100,
          height: 80
        }))
      },
      visualInspector: () => inspectorWithRegion(),
      secret: Buffer.alloc(32, 9)
    })
    const owner = callContext(workspaceRoot)
    const looked = await runtime.look({ task: 'Locate the method overview.' }, owner)
    const input = {
      snapshotRef: looked.snapshotRef,
      regionRef: looked.regions[0]!.regionRef
    }

    await expect(runtime.capture(input, callContext(workspaceRoot, {}, 'codex:thread-b')))
      .rejects.toThrow(/caller, workspace, or turn/u)
    await expect(runtime.capture(input, callContext(workspaceRoot, { turnId: 'turn-2' })))
      .rejects.toThrow(/caller, workspace, or turn/u)
  })

  it('refuses to persist visual assets through a workspace symlink', async () => {
    const workspaceRoot = await temporaryDirectory('sciforge-agent-visual-symlink-')
    const outsideRoot = await temporaryDirectory('sciforge-agent-visual-outside-')
    const captureRoot = await temporaryDirectory('sciforge-agent-visual-symlink-source-')
    const sourcePath = join(captureRoot, 'surface.png')
    await writeFile(sourcePath, testPng())
    await symlink(outsideRoot, join(workspaceRoot, '.sciforge'))
    const runtime = new AgentVisualRuntime({
      visibleContext: {
        currentSurface: vi.fn(async () => ({
          resourceId: 'surface',
          workspaceId: workspaceRoot,
          semanticRevision: 'surface-1',
          layoutRevision: '1',
          state: {}
        })),
        captureFrame: vi.fn(async () => ({
          path: sourcePath,
          mimeType: 'image/png' as const,
          capturedAt: '2026-07-26T06:00:00.000Z',
          width: 100,
          height: 80
        }))
      },
      visualInspector: () => inspectorWithRegion(),
      secret: Buffer.alloc(32, 11)
    })
    const context = callContext(workspaceRoot)
    const looked = await runtime.look({ task: 'Locate the method overview.' }, context)

    await expect(runtime.capture({
      snapshotRef: looked.snapshotRef,
      regionRef: looked.regions[0]!.regionRef
    }, context)).rejects.toThrow(/symbolic link/u)
  })

  it('reuses an immutable snapshot for another look without recapturing the surface', async () => {
    const workspaceRoot = await temporaryDirectory('sciforge-agent-visual-snapshot-')
    const captureRoot = await temporaryDirectory('sciforge-agent-visual-snapshot-source-')
    const sourcePath = join(captureRoot, 'surface.png')
    await writeFile(sourcePath, testPng())
    const captureFrame = vi.fn(async () => ({
      path: sourcePath,
      mimeType: 'image/png' as const,
      capturedAt: '2026-07-26T06:00:00.000Z',
      width: 100,
      height: 80
    }))
    const runtime = new AgentVisualRuntime({
      visibleContext: {
        currentSurface: vi.fn(async () => ({
          resourceId: 'surface',
          workspaceId: workspaceRoot,
          semanticRevision: 'surface-1',
          layoutRevision: '1',
          state: {}
        })),
        captureFrame
      },
      visualInspector: () => inspectorWithRegion(),
      secret: Buffer.alloc(32, 10)
    })
    const context = callContext(workspaceRoot)
    const first = await runtime.look({ task: 'Describe the surface.' }, context)
    const second = await runtime.look({
      sourceRef: first.snapshotRef,
      task: 'Locate the method diagram.'
    }, context)

    expect(second.snapshotRef).toBe(first.snapshotRef)
    expect(second.proof.sourceRef).toBe(first.snapshotRef)
    expect(captureFrame).toHaveBeenCalledTimes(1)

    await expect(runtime.look({
      sourceRef: first.snapshotRef,
      frame: 2,
      task: 'Inspect another frame.'
    }, context)).rejects.toThrow(/snapshot cannot select another visual frame/u)
  })

  it('inspects a decoded workspace image path without using a domain-specific source', async () => {
    const workspaceRoot = await temporaryDirectory('sciforge-agent-visual-workspace-image-')
    const sourcePath = join(workspaceRoot, 'method-overview.data')
    await writeFile(sourcePath, testPng())
    const canonicalSourcePath = await realpath(sourcePath)
    const inspector = inspectorWithRegion()
    const runtime = new AgentVisualRuntime({
      visibleContext: {
        currentSurface: vi.fn(async () => {
          throw new Error('A workspace image must not use the live surface.')
        }),
        captureFrame: vi.fn(async () => {
          throw new Error('A workspace image must not capture the live surface.')
        })
      },
      visualInspector: () => inspector,
      secret: Buffer.alloc(32, 13)
    })
    const context = callContext(workspaceRoot)

    const looked = await runtime.look({
      path: 'method-overview.data',
      task: 'Locate the method overview.'
    }, context)

    expect(inspector).toHaveBeenCalledWith({
      task: 'Locate the method overview.',
      artifacts: [{
        id: 'source',
        imagePath: canonicalSourcePath,
        mimeType: 'image/png'
      }]
    })
    expect(looked.proof).not.toHaveProperty('sourceRef')
    const captured = await runtime.capture({
      snapshotRef: looked.snapshotRef,
      regionRef: looked.regions[0]!.regionRef
    }, context)
    expect(captured).toMatchObject({ width: 50, height: 40 })

    await expect(runtime.look({
      path: 'method-overview.data',
      targetRef: `target_${'p'.repeat(24)}`,
      task: 'Inspect the target.'
    }, context)).rejects.toThrow(/cannot be combined/u)
    expect(inspector).toHaveBeenCalledTimes(1)
  })

  it('rejects image paths that directly address another workspace', async () => {
    const workspaceRoot = await temporaryDirectory('sciforge-agent-visual-workspace-a-')
    const outsideRoot = await temporaryDirectory('sciforge-agent-visual-workspace-b-')
    const outsidePath = join(outsideRoot, 'outside.png')
    await writeFile(outsidePath, testPng())
    const inspector = inspectorWithRegion()
    const runtime = new AgentVisualRuntime({
      visibleContext: {
        currentSurface: vi.fn(async () => {
          throw new Error('Unexpected live surface lookup.')
        }),
        captureFrame: vi.fn(async () => {
          throw new Error('Unexpected live surface capture.')
        })
      },
      visualInspector: () => inspector
    })

    await expect(runtime.look({
      path: outsidePath,
      task: 'Inspect an image outside the workspace.'
    }, callContext(workspaceRoot))).rejects.toThrow(/workspace-relative|relative path/u)
    expect(inspector).not.toHaveBeenCalled()
  })

  it('rejects workspace image paths that traverse a symbolic link', async () => {
    const workspaceRoot = await temporaryDirectory('sciforge-agent-visual-workspace-link-')
    const outsideRoot = await temporaryDirectory('sciforge-agent-visual-workspace-link-outside-')
    const outsidePath = join(outsideRoot, 'outside.png')
    await writeFile(outsidePath, testPng())
    await symlink(outsidePath, join(workspaceRoot, 'linked.png'))
    const inspector = inspectorWithRegion()
    const runtime = new AgentVisualRuntime({
      visibleContext: {
        currentSurface: vi.fn(async () => {
          throw new Error('Unexpected live surface lookup.')
        }),
        captureFrame: vi.fn(async () => {
          throw new Error('Unexpected live surface capture.')
        })
      },
      visualInspector: () => inspector
    })

    await expect(runtime.look({
      path: 'linked.png',
      task: 'Inspect a linked image.'
    }, callContext(workspaceRoot))).rejects.toThrow(/symbolic link/u)
    expect(inspector).not.toHaveBeenCalled()
  })

  it('materializes provider-owned frame bytes before inspection and preserves them for capture', async () => {
    const workspaceRoot = await temporaryDirectory('sciforge-agent-visual-provider-')
    const frameDirectory = await temporaryDirectory('sciforge-agent-visual-frames-')
    const canonicalFrameDirectory = await realpath(frameDirectory)
    const bytes = new Uint8Array(testPng())
    const digest = createHash('sha256').update(bytes).digest('hex')
    const resolveResourceFrame = vi.fn(async () => ({
      bytes,
      mimeType: 'image/png' as const,
      width: 100,
      height: 80,
      sourceRevision: 'resource-revision-7',
      anchor: { kind: 'resource' }
    }))
    const currentSurface = vi.fn(async () => {
      throw new Error('The live surface must not be used for a resource visual source.')
    })
    const captureFrame = vi.fn(async () => {
      throw new Error('The live surface must not be captured for a resource visual source.')
    })
    const inspector = inspectorWithRegion()
    const runtime = new AgentVisualRuntime({
      visibleContext: { currentSurface, captureFrame },
      visualInspector: () => inspector,
      resolveResourceFrame,
      frameDirectory,
      secret: Buffer.alloc(32, 12)
    })
    const context = callContext(workspaceRoot)
    const sourceRef = `res_${'r'.repeat(24)}`

    const looked = await runtime.look({
      sourceRef,
      frame: 7,
      task: 'Locate the method diagram.'
    }, context)

    expect(resolveResourceFrame).toHaveBeenCalledWith({
      sourceRef,
      frame: 7,
      caller: context.caller,
      signal: context.signal
    })
    expect(currentSurface).not.toHaveBeenCalled()
    expect(captureFrame).not.toHaveBeenCalled()
    expect(inspector).toHaveBeenCalledWith(expect.objectContaining({
      artifacts: [{
        id: 'source',
        imagePath: join(canonicalFrameDirectory, `frame-${digest}.png`),
        mimeType: 'image/png'
      }]
    }))
    expect(looked.proof.sourceRef).toBe(sourceRef)

    const captured = await runtime.capture({
      snapshotRef: looked.snapshotRef,
      regionRef: looked.regions[0]!.regionRef
    }, context)
    expect(captured).toMatchObject({
      width: 50,
      height: 40,
      changed: true,
      proof: {
        inspectionProofRef: looked.proof.proofRef,
        snapshotRef: looked.snapshotRef,
        cropped: true
      }
    })
  })

  it.each([
    {
      name: 'empty source revision',
      sourceRevision: '',
      width: 100,
      expected: /source revision/u
    },
    {
      name: 'incorrect trusted dimensions',
      sourceRevision: 'resource-revision-8',
      width: 99,
      expected: /dimensions/u
    }
  ])('rejects provider bytes with $name', async ({ sourceRevision, width, expected }) => {
    const workspaceRoot = await temporaryDirectory('sciforge-agent-visual-provider-invalid-')
    const frameDirectory = await temporaryDirectory('sciforge-agent-visual-provider-invalid-frames-')
    const inspector = inspectorWithRegion()
    const runtime = new AgentVisualRuntime({
      visibleContext: {
        currentSurface: vi.fn(async () => {
          throw new Error('Unexpected live surface lookup.')
        }),
        captureFrame: vi.fn(async () => {
          throw new Error('Unexpected live surface capture.')
        })
      },
      visualInspector: () => inspector,
      resolveResourceFrame: async () => ({
        bytes: new Uint8Array(testPng()),
        mimeType: 'image/png',
        width,
        height: 80,
        sourceRevision,
        anchor: { kind: 'resource' }
      }),
      frameDirectory
    })

    await expect(runtime.look({
      sourceRef: `res_${'v'.repeat(24)}`,
      task: 'Inspect the provider frame.'
    }, callContext(workspaceRoot))).rejects.toThrow(expected)
    expect(inspector).not.toHaveBeenCalled()
  })

  it('fails visibly when provider bytes cannot be materialized into a managed frame directory', async () => {
    const workspaceRoot = await temporaryDirectory('sciforge-agent-visual-no-frame-directory-')
    const inspector = inspectorWithRegion()
    const runtime = new AgentVisualRuntime({
      visibleContext: {
        currentSurface: vi.fn(async () => {
          throw new Error('Unexpected live surface lookup.')
        }),
        captureFrame: vi.fn(async () => {
          throw new Error('Unexpected live surface capture.')
        })
      },
      visualInspector: () => inspector,
      resolveResourceFrame: async () => ({
        bytes: new Uint8Array(testPng()),
        mimeType: 'image/png',
        width: 100,
        height: 80,
        sourceRevision: 'resource-revision-9',
        anchor: { kind: 'resource' }
      })
    })

    await expect(runtime.look({
      sourceRef: `res_${'d'.repeat(24)}`,
      task: 'Inspect the provider frame.'
    }, callContext(workspaceRoot))).rejects.toThrow(/managed frame directory/u)
    expect(inspector).not.toHaveBeenCalled()
  })
})
