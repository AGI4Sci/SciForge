/**
 * Capability parity: the canonical plugin factory and its workspace operations
 * must agree field by field for valid input and reject the same invalid input.
 *
 * The factory is evaluated through its input schema, handler and output schema.
 * Both calls use the same plugin-owned backend implementation with independent
 * temporary stores, so this checks workspace and port wiring, not a legacy domain.
 */
import assert from 'node:assert/strict'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'
import type { z } from 'zod'
import { ANCHORED_COMMENT_CAPABILITY_IDS, anchoredCommentDeleteResultSchema, anchoredCommentReadAssetResultSchema } from '../src/core/contract.js'
import { createAnchoredCommentsCapabilityFactory } from '../src/core/main/index.js'
import { AnchoredCommentService } from '../src/core/main/comment-service.js'
import { AnchoredCommentFeedbackService } from '../src/core/main/feedback-service.js'
import { createAnchoredCommentsOperations } from '../src/core/operations.js'
import { EXPECTED_HOST_GRANTS } from '../src/dsh-adapter/tools.js'
import { createFixtureNetworkPort } from '../src/ports/network.js'
import manifest from '../sciforge.dsh.json' with { type: 'json' }
import {
  captureRequest,
  feedbackPacket,
  gatewayResult,
  NOW,
  PNG_BYTES,
  productFeedbackThread,
  researchThread
} from './fixtures.js'

type CapabilityDefinition = Readonly<{
  id: string
  effect: string
  approval: string
  inputSchema: z.ZodType
  outputSchema: z.ZodType
  handler: (input: unknown) => Promise<Readonly<{ output: unknown }>>
}>

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(await realpath(tmpdir()), prefix))
  roots.push(root)
  return root
}

type FactorySurface = Readonly<{
  definitions: readonly CapabilityDefinition[]
  comments: AnchoredCommentService
}>

function factorySurface(root: string, gateway?: { submit: (packet: unknown) => Promise<unknown> }): FactorySurface {
  const comments = new AnchoredCommentService(root)
  const feedback = new AnchoredCommentFeedbackService({
    comments,
    gateway: (gateway ?? null) as never,
    now: () => new Date(NOW)
  })
  const factory = createAnchoredCommentsCapabilityFactory<CapabilityDefinition>({
    defineCapability: (definition) => definition as unknown as CapabilityDefinition,
    getComments: () => comments,
    getFeedback: () => feedback
  })
  return { definitions: factory.createDefinitions(), comments }
}

async function callFactory(
  surface: FactorySurface,
  capabilityId: string,
  input: unknown
): Promise<unknown> {
  const definition = surface.definitions.find((candidate) => candidate.id === capabilityId)
  assert.ok(definition, `factory capability ${capabilityId} is missing`)
  const parsed = definition.inputSchema.parse(input)
  const result = await definition.handler(parsed)
  return definition.outputSchema.parse(result.output)
}

describe('anchored-comments factory/plugin parity', () => {
  test('capability ids and effects match the factory surface, the grant table and the manifest', async () => {
    const surface = factorySurface(await tempRoot('anchored-parity-meta-'))
    const declared = surface.definitions
      .map((definition) => [definition.id, definition.effect] as const)
      .sort()
    assert.deepEqual(declared, [
      [ANCHORED_COMMENT_CAPABILITY_IDS.list, 'read'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.get, 'read'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.upsert, 'workspace-write'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.delete, 'workspace-write'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.readAsset, 'read'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.capture, 'workspace-write'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback, 'external-write'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus, 'read']
    ].sort())

    assert.deepEqual(
      Object.values(EXPECTED_HOST_GRANTS).map((grant) => [grant.id, grant.effect]).sort(),
      declared
    )
    assert.deepEqual(
      Object.values(manifest.tools).map((tool) => [tool.id, tool.effect]).sort(),
      declared
    )
    assert.deepEqual(
      Object.keys(manifest.tools).sort(),
      Object.keys(EXPECTED_HOST_GRANTS).sort()
    )
    for (const tool of Object.values(manifest.tools)) {
      assert.equal(tool.scope, 'workspace')
      assert.equal('readResource' in tool, false)
    }
    for (const grant of Object.values(EXPECTED_HOST_GRANTS)) {
      assert.equal(grant.scope, 'workspace')
      assert.equal('readResource' in grant, false)
    }
  })

  test('approval parity: factory, grant table and manifest agree field by field', async () => {
    const surface = factorySurface(await tempRoot('anchored-parity-approval-'))
    const factoryApproval = new Map(
      surface.definitions.map((definition) => [definition.id, definition.approval] as const)
    )
    assert.deepEqual([...factoryApproval.entries()].sort(), [
      [ANCHORED_COMMENT_CAPABILITY_IDS.list, 'none'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.get, 'none'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.upsert, 'none'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.delete, 'confirmation'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.readAsset, 'none'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.capture, 'none'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback, 'confirmation'],
      [ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus, 'none']
    ].sort())

    // G8: the projection is grant.approval raised over the effect-derived floor.
    const projected = (grant: { effect: string; approval?: string }): string =>
      grant.approval === 'confirmation' || grant.effect === 'external-write' || grant.effect === 'destructive'
        ? 'confirmation'
        : 'none'
    for (const grant of Object.values(EXPECTED_HOST_GRANTS)) {
      assert.equal(projected(grant), factoryApproval.get(grant.id), `grant approval drift for ${grant.id}`)
    }
    for (const tool of Object.values(manifest.tools)) {
      assert.equal(projected(tool), factoryApproval.get(tool.id), `manifest approval drift for ${tool.id}`)
    }
    assert.equal(
      manifest.tools.anchored_comments_delete.approval,
      'confirmation',
      'the manifest must declare the confirmation gate for delete'
    )
  })

  test('list parity on an empty store', async () => {
    const factoryRoot = await tempRoot('anchored-parity-list-factory-')
    const workspaceRoot = await tempRoot('anchored-parity-list-plugin-')
    const surface = factorySurface(factoryRoot)
    const operations = createAnchoredCommentsOperations({ env: {} })
    assert.deepEqual(
      await operations.invoke(ANCHORED_COMMENT_CAPABILITY_IDS.list, {}, workspaceRoot),
      await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.list, {})
    )
  })

  test('upsert, get and filtered list parity', async () => {
    const factoryRoot = await tempRoot('anchored-parity-crud-factory-')
    const workspaceRoot = await tempRoot('anchored-parity-crud-plugin-')
    const surface = factorySurface(factoryRoot)
    const operations = createAnchoredCommentsOperations({ env: {} })
    const thread = researchThread('thread-parity-1')

    const factoryUpsert = await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.upsert, { thread })
    const pluginUpsert = await operations.invoke(
      ANCHORED_COMMENT_CAPABILITY_IDS.upsert,
      { thread },
      workspaceRoot
    )
    assert.deepEqual(pluginUpsert, factoryUpsert)
    assert.deepEqual(pluginUpsert, thread)

    assert.deepEqual(
      await operations.invoke(ANCHORED_COMMENT_CAPABILITY_IDS.get, { threadId: thread.id }, workspaceRoot),
      await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.get, { threadId: thread.id })
    )
    for (const filter of [
      {},
      { workspaceKey: thread.workspaceKey },
      { targetKey: thread.anchor.targetKey },
      { status: 'open' as const },
      { includeResolved: false }
    ]) {
      assert.deepEqual(
        await operations.invoke(ANCHORED_COMMENT_CAPABILITY_IDS.list, filter, workspaceRoot),
        await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.list, filter)
      )
    }
  })

  test('screenshot asset read parity (content-addressed data URL)', async () => {
    const factoryRoot = await tempRoot('anchored-parity-asset-factory-')
    const workspaceRoot = await tempRoot('anchored-parity-asset-plugin-')
    const surface = factorySurface(factoryRoot)
    const operations = createAnchoredCommentsOperations({ env: {} })
    const factoryAsset = await surface.comments.putScreenshotAsset(PNG_BYTES, { width: 2, height: 2 })
    const pluginComments = new AnchoredCommentService(join(workspaceRoot, '.sciforge'))
    const pluginAsset = await pluginComments.putScreenshotAsset(PNG_BYTES, { width: 2, height: 2 })
    assert.deepEqual(pluginAsset, factoryAsset)

    const result = await operations.invoke(
      ANCHORED_COMMENT_CAPABILITY_IDS.readAsset, { asset: pluginAsset }, workspaceRoot
    )
    assert.deepEqual(result, {
      digest: pluginAsset.digest,
      mimeType: 'image/png',
      byteLength: PNG_BYTES.byteLength,
      width: 2,
      height: 2,
      integrityVerified: true,
      dataUrl: `data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`
    })
    assert.deepEqual(
      result,
      await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.readAsset, { asset: factoryAsset })
    )
    const validated = anchoredCommentReadAssetResultSchema.parse(result)
    assert.equal(anchoredCommentReadAssetResultSchema.safeParse({ ...validated, integrityVerified: false }).success, false)
    assert.equal(anchoredCommentReadAssetResultSchema.safeParse({ ...validated, byteLength: 0 }).success, false)
    assert.equal(anchoredCommentReadAssetResultSchema.safeParse({ ...validated, width: 0 }).success, false)
    assert.equal(anchoredCommentReadAssetResultSchema.safeParse({ ...validated, source: 'model-claimed' }).success, false)
  })

  test('delete handler preserves the service committed-cleanup outcome and strict result contract', async () => {
    const surface = factorySurface(await tempRoot('anchored-parity-cleanup-'))
    const outcome = {
      deleted: true,
      cleanupPending: true,
      warnings: ['Comment deletion was committed, but asset cleanup is pending.']
    }
    surface.comments.deleteThread = async () => outcome
    assert.deepEqual(await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.delete, { threadId: 'thread-1' }), outcome)
    assert.equal(anchoredCommentDeleteResultSchema.safeParse({ ...outcome, warnings: ['x'.repeat(1_001)] }).success, false)
    assert.equal(anchoredCommentDeleteResultSchema.safeParse({ ...outcome, warnings: ['a', 'b', 'c'] }).success, false)
    assert.equal(anchoredCommentDeleteResultSchema.safeParse({ ...outcome, silent: true }).success, false)
  })

  test('capture parity: both surfaces fail closed without a visual-capture host', async () => {
    const factoryRoot = await tempRoot('anchored-parity-capture-factory-')
    const workspaceRoot = await tempRoot('anchored-parity-capture-plugin-')
    const surface = factorySurface(factoryRoot)
    const operations = createAnchoredCommentsOperations({ env: {} })
    const expected = {
      ok: false,
      message: 'Safe registered-target capture is unavailable in this build.'
    }
    assert.deepEqual(
      await operations.invoke(ANCHORED_COMMENT_CAPABILITY_IDS.capture, captureRequest(), workspaceRoot),
      expected
    )
    assert.deepEqual(
      await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.capture, captureRequest()),
      expected
    )
  })

  test('feedback status parity for an unknown thread', async () => {
    const factoryRoot = await tempRoot('anchored-parity-status-factory-')
    const workspaceRoot = await tempRoot('anchored-parity-status-plugin-')
    const surface = factorySurface(factoryRoot)
    const operations = createAnchoredCommentsOperations({ env: {} })
    assert.deepEqual(
      await operations.invoke(
        ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus,
        { threadId: 'missing-thread' },
        workspaceRoot
      ),
      await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus, {
        threadId: 'missing-thread'
      })
    )
  })

  test('feedback submit without a configured gateway fails the same way and persists the failure', async () => {
    const factoryRoot = await tempRoot('anchored-parity-submit-factory-')
    const workspaceRoot = await tempRoot('anchored-parity-submit-plugin-')
    const surface = factorySurface(factoryRoot)
    const operations = createAnchoredCommentsOperations({
      env: {},
      now: () => new Date(NOW)
    })
    const thread = productFeedbackThread()

    await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.upsert, { thread })
    await operations.invoke(ANCHORED_COMMENT_CAPABILITY_IDS.upsert, { thread }, workspaceRoot)

    const factoryResult = await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback, {
      packet: feedbackPacket()
    })
    const pluginResult = await operations.invoke(
      ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback,
      { packet: feedbackPacket() },
      workspaceRoot
    )
    assert.deepEqual(pluginResult, factoryResult)
    assert.deepEqual(pluginResult, {
      ok: false,
      message: 'SciForge feedback gateway is not configured.',
      retryable: false
    })

    // The failure is persisted on both sides with the injected clock.
    assert.deepEqual(
      await operations.invoke(ANCHORED_COMMENT_CAPABILITY_IDS.get, { threadId: thread.id }, workspaceRoot),
      await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.get, { threadId: thread.id })
    )
  })

  test('feedback submit parity through the injected network port', async () => {
    const factoryRoot = await tempRoot('anchored-parity-network-factory-')
    const workspaceRoot = await tempRoot('anchored-parity-network-plugin-')
    const surface = factorySurface(factoryRoot, {
      submit: async () => ({ ok: true, result: gatewayResult() })
    })
    const port = createFixtureNetworkPort(() => Response.json(gatewayResult()))
    const operations = createAnchoredCommentsOperations({
      network: port,
      env: { SCIFORGE_FEEDBACK_GATEWAY_URL: 'https://feedback.sciforge.test' },
      now: () => new Date(NOW)
    })
    const thread = productFeedbackThread()

    await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.upsert, { thread })
    await operations.invoke(ANCHORED_COMMENT_CAPABILITY_IDS.upsert, { thread }, workspaceRoot)

    const factoryResult = await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback, {
      packet: feedbackPacket()
    })
    const pluginResult = await operations.invoke(
      ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback,
      { packet: feedbackPacket() },
      workspaceRoot
    )
    assert.deepEqual(pluginResult, factoryResult)
    assert.deepEqual(pluginResult, { ok: true, result: gatewayResult() })
    assert.equal(port.requests.length, 1)
    assert.equal(port.requests[0]?.url, 'https://feedback.sciforge.test/v1/feedback')

    assert.deepEqual(
      await operations.invoke(ANCHORED_COMMENT_CAPABILITY_IDS.get, { threadId: thread.id }, workspaceRoot),
      await callFactory(surface, ANCHORED_COMMENT_CAPABILITY_IDS.get, { threadId: thread.id })
    )
  })

  test('invalid input is rejected by both surfaces', async () => {
    const factoryRoot = await tempRoot('anchored-parity-invalid-factory-')
    const workspaceRoot = await tempRoot('anchored-parity-invalid-plugin-')
    const surface = factorySurface(factoryRoot)
    const operations = createAnchoredCommentsOperations({ env: {} })

    const invalid: ReadonlyArray<readonly [string, unknown]> = [
      [ANCHORED_COMMENT_CAPABILITY_IDS.list, { unknownField: true }],
      [ANCHORED_COMMENT_CAPABILITY_IDS.get, {}],
      [ANCHORED_COMMENT_CAPABILITY_IDS.get, { threadId: '' }],
      [ANCHORED_COMMENT_CAPABILITY_IDS.upsert, { thread: { id: 'incomplete' } }],
      [ANCHORED_COMMENT_CAPABILITY_IDS.delete, { threadId: 42 }],
      [ANCHORED_COMMENT_CAPABILITY_IDS.readAsset, { asset: { digest: 'not-a-digest' } }],
      [ANCHORED_COMMENT_CAPABILITY_IDS.capture, { targetRef: 'x' }],
      [ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback, {
        packet: { ...feedbackPacket(), idempotencyKey: 'short' }
      }],
      [ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus, { threadId: 'x'.repeat(257) }]
    ]

    for (const [capabilityId, input] of invalid) {
      await assert.rejects(
        async () => callFactory(surface, capabilityId, input),
        `factory surface accepted invalid input for ${capabilityId}`
      )
      await assert.rejects(
        async () => operations.invoke(capabilityId, input, workspaceRoot),
        `plugin accepted invalid input for ${capabilityId}`
      )
    }
  })
})