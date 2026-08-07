import { describe, expect, it, vi } from 'vitest'
import {
  VISUAL_REVIEW_CAPABILITY_IDS
} from './contract.js'
import {
  createVisualReviewCapabilityFactory,
  type VisualReviewCapabilityOptions,
  type VisualReviewServicePort
} from './main.js'

function service(): VisualReviewServicePort {
  return {
    open: vi.fn(async ({ workspaceRoot, documentId }) => ({
      ok: true,
      status: 'opened',
      workspaceRoot,
      document: { documentId },
      paths: {},
      changed: false
    })) as unknown as VisualReviewServicePort['open'],
    readImage: vi.fn(),
    updateContext: vi.fn(),
    applyStyleReference: vi.fn(),
    saveAnnotations: vi.fn(),
    exportReviewPacket: vi.fn(),
    createCandidate: vi.fn(),
    acceptCandidate: vi.fn(),
    rejectCandidate: vi.fn()
  }
}

describe('Visual Review capabilities', () => {
  it('publishes one governed definition per canonical operation', () => {
    const definitions = createVisualReviewCapabilityFactory<VisualReviewCapabilityOptions>({
      defineCapability: (definition) => definition,
      getService: service
    }).createDefinitions()
    const byId = new Map(definitions.map((definition) => [definition.id, definition]))

    expect([...byId.keys()]).toEqual(Object.values(VISUAL_REVIEW_CAPABILITY_IDS))
    for (const id of [
      VISUAL_REVIEW_CAPABILITY_IDS.readDocument,
      VISUAL_REVIEW_CAPABILITY_IDS.readImage
    ]) {
      expect(byId.get(id)?.effect, id).toBe('read')
      expect(byId.get(id)?.concurrency, id).toEqual({
        revision: 'none',
        idempotency: 'none'
      })
    }
    for (const id of [
      VISUAL_REVIEW_CAPABILITY_IDS.open,
      VISUAL_REVIEW_CAPABILITY_IDS.updateContext,
      VISUAL_REVIEW_CAPABILITY_IDS.applyStyleReference,
      VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations,
      VISUAL_REVIEW_CAPABILITY_IDS.exportReviewPacket,
      VISUAL_REVIEW_CAPABILITY_IDS.createCandidate,
      VISUAL_REVIEW_CAPABILITY_IDS.rejectCandidate
    ]) {
      expect(byId.get(id)?.concurrency.idempotency, id).toBe('required')
    }
    expect(byId.get(VISUAL_REVIEW_CAPABILITY_IDS.acceptCandidate)).toMatchObject({
      effect: 'destructive',
      audiences: ['ui'],
      approval: 'confirmation',
      concurrency: { revision: 'none', idempotency: 'required' }
    })
    expect(byId.get(VISUAL_REVIEW_CAPABILITY_IDS.saveAnnotations)?.audiences).toEqual(['ui'])
    expect(byId.get(VISUAL_REVIEW_CAPABILITY_IDS.createCandidate)?.audiences).toEqual([
      'agent',
      'system'
    ])
  })

  it('derives workspace ownership from the caller and calls one open operation', async () => {
    const fake = service()
    const definition = createVisualReviewCapabilityFactory<VisualReviewCapabilityOptions>({
      defineCapability: (value) => value,
      getService: () => fake
    }).createDefinitions().find(({ id }) => id === VISUAL_REVIEW_CAPABILITY_IDS.open)
    expect(definition).toBeDefined()

    const result = await definition!.handler({
      documentId: 'figure-1',
      artifact: {
        kind: 'generated_image',
        sourcePath: 'outputs/figure.png'
      }
    }, {
      caller: { workspaceId: '/workspace' }
    })

    expect(fake.open).toHaveBeenCalledOnce()
    expect(fake.open).toHaveBeenCalledWith({
      workspaceRoot: '/workspace',
      documentId: 'figure-1',
      artifact: {
        kind: 'generated_image',
        sourcePath: 'outputs/figure.png'
      }
    })
    expect(result).not.toHaveProperty('changed')
  })

  it('fails closed without a workspace-scoped caller', async () => {
    const definition = createVisualReviewCapabilityFactory<VisualReviewCapabilityOptions>({
      defineCapability: (value) => value,
      getService: service
    }).createDefinitions()[0]!

    await expect(definition.handler(
      { documentId: 'figure-1' },
      { caller: {} }
    )).rejects.toThrow('workspace-scoped caller')
  })
})
