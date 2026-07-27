import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  MAIN_VISUAL_SOURCE_CONTRIBUTION_KIND,
  VISUAL_SOURCE_CONTRACT_VERSION,
  defineVisualSourceContributionContract,
  defineVisualSourceProvider,
  normalizedVisualRegionSchema,
  renderVisualSource,
  visualFrameSchema,
  visualSourceContractsEqual,
  visualSourceRenderRequestSchema
} from './visual-source.js'

const contract = {
  contractVersion: VISUAL_SOURCE_CONTRACT_VERSION,
  id: 'fixture.paper-visual-source',
  resourceKinds: ['workspace-preview', 'browser-page']
} as const

function frame(sourceRevision = 'revision-1') {
  return {
    bytes: new Uint8Array([1, 2, 3]),
    mimeType: 'image/png' as const,
    width: 640,
    height: 480,
    sourceRevision,
    anchor: {
      kind: 'resource',
      metadata: { page: 3 }
    },
    redactions: [{ x: 0.1, y: 0.2, width: 0.3, height: 0.4 }]
  }
}

function request(resourceKind = 'workspace-preview') {
  return {
    resource: {
      resourceId: 'preview-session-1',
      resourceKind,
      workspaceId: '/workspace',
      semanticRevision: 'revision-1'
    },
    target: {
      kind: 'region' as const,
      region: { x: 0.1, y: 0.2, width: 0.3, height: 0.4 }
    },
    frameIndex: 3,
    pixelRatio: 2,
    maxDimension: 4096
  }
}

describe('visual source public domain contract', () => {
  it('defines an immutable canonical contribution contract', () => {
    const defined = defineVisualSourceContributionContract({
      ...contract,
      id: ' fixture.paper-visual-source ',
      resourceKinds: [' workspace-preview ', 'browser-page']
    })

    assert.equal(MAIN_VISUAL_SOURCE_CONTRIBUTION_KIND, 'main.visual-source')
    assert.deepEqual(defined, contract)
    assert.equal(Object.isFrozen(defined), true)
    assert.equal(Object.isFrozen(defined.resourceKinds), true)
    assert.equal(visualSourceContractsEqual(defined, { ...contract }), true)
    assert.equal(visualSourceContractsEqual(defined, {
      ...contract,
      resourceKinds: ['workspace-preview']
    }), false)
  })

  it('fails closed on duplicate resource kinds and unknown contract fields', () => {
    assert.throws(() => defineVisualSourceContributionContract({
      ...contract,
      resourceKinds: ['workspace-preview', 'workspace-preview']
    }), /resource kind workspace-preview is duplicated/)
    assert.throws(() => defineVisualSourceContributionContract({
      ...contract,
      priority: 10
    } as typeof contract), /Unrecognized key/)
  })

  it('accepts only normalized in-bounds regions', () => {
    assert.deepEqual(normalizedVisualRegionSchema.parse({
      x: 0.25,
      y: 0.1,
      width: 0.5,
      height: 0.9
    }), {
      x: 0.25,
      y: 0.1,
      width: 0.5,
      height: 0.9
    })
    assert.throws(() => normalizedVisualRegionSchema.parse({
      x: 0.75,
      y: 0,
      width: 0.5,
      height: 1
    }), /horizontal source bounds/)
    assert.throws(() => normalizedVisualRegionSchema.parse({
      x: 0,
      y: 0.9,
      width: 1,
      height: 0.2
    }), /vertical source bounds/)
  })

  it('strictly validates render requests and visual frames', () => {
    assert.deepEqual(visualSourceRenderRequestSchema.parse(request()), request())
    assert.deepEqual(visualFrameSchema.parse(frame()), frame())
    assert.throws(() => visualSourceRenderRequestSchema.parse({
      ...request(),
      path: '/workspace/paper.pdf'
    }), /Unrecognized key/)
    assert.throws(() => visualFrameSchema.parse({
      ...frame(),
      bytes: new Uint8Array()
    }), /must not be empty/)
    assert.throws(() => visualFrameSchema.parse({
      ...frame(),
      mimeType: 'image/svg+xml'
    }))
  })

  it('validates provider support and the rendered source revision', async () => {
    const calls: unknown[] = []
    const provider = defineVisualSourceProvider({
      contract,
      render: async (input, context) => {
        calls.push({ input, signal: context.signal })
        return frame()
      }
    })
    const controller = new AbortController()

    await assert.doesNotReject(async () => {
      assert.deepEqual(
        await renderVisualSource(provider, request(), { signal: controller.signal }),
        frame()
      )
    })
    assert.equal(calls.length, 1)
    assert.equal((calls[0] as { signal: AbortSignal }).signal, controller.signal)

    await assert.rejects(
      renderVisualSource(provider, request('unsupported-resource')),
      /does not support resource kind unsupported-resource/
    )
    await assert.rejects(
      renderVisualSource({
        contract,
        render: async () => frame('revision-2')
      }, request()),
      /rendered revision revision-2/
    )
    await assert.rejects(
      renderVisualSource({
        contract,
        render: async () => ({ ...frame(), unexpected: true })
      }, request()),
      /Unrecognized key/
    )
  })

  it('rejects providers without a callable render implementation', () => {
    assert.throws(() => defineVisualSourceProvider({
      contract,
      render: null
    } as never), /exactly one render function/)
  })
})
