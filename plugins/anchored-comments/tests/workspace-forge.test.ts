/**
 * B3: explicit workspace argument.
 *
 * - the adapter strips `workspaceRoot` from the tool arguments;
 * - missing / empty / oversized / relative values are rejected;
 * - a forged `workspaceRoot` inside the capability payload cannot replace the
 *   caller's value: the strict contract rejects the whole input;
 * - the store really lands under `<workspaceRoot>/.sciforge/anchored-comments/`.
 */
import assert from 'node:assert/strict'
import { existsSync } from 'node:fs'
import { mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, test } from 'node:test'
import { ANCHORED_COMMENT_CAPABILITY_IDS } from '../src/core/contract.js'
import { anchoredCommentsDataRoot, createAnchoredCommentsOperations } from '../src/core/operations.js'
import { CAPABILITY_INPUT_SCHEMAS, splitWorkspaceArgument } from '../src/dsh-adapter/tools.js'
import { captureRequest, feedbackPacket, PNG_BYTES, researchThread } from './fixtures.js'
import { createHash } from 'node:crypto'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function tempRoot(prefix: string): Promise<string> {
  const root = await mkdtemp(join(await realpath(tmpdir()), prefix))
  roots.push(root)
  return root
}

describe('anchored-comments workspace argument', () => {
  test('strips workspaceRoot and leaves the capability input untouched', () => {
    const { input, workspaceRoot } = splitWorkspaceArgument({
      workspaceRoot: '/tmp/anchored-workspace',
      threadId: 'thread-1'
    })
    assert.equal(workspaceRoot, '/tmp/anchored-workspace')
    assert.deepEqual(input, { threadId: 'thread-1' })
  })

  test('rejects a missing, empty or oversized workspaceRoot', () => {
    assert.throws(() => splitWorkspaceArgument({ threadId: 'thread-1' }))
    assert.throws(() => splitWorkspaceArgument({ workspaceRoot: '', threadId: 'thread-1' }))
    assert.throws(() => splitWorkspaceArgument({ workspaceRoot: '   ' }))
    assert.throws(() => splitWorkspaceArgument({ workspaceRoot: 'x'.repeat(4_097) }))
    assert.throws(() => splitWorkspaceArgument({ workspaceRoot: 42 }))
  })

  test('a forged workspaceRoot inside the payload is rejected, never forwarded', async () => {
    const workspaceRoot = await tempRoot('anchored-forge-workspace-')
    const forgedRoot = await tempRoot('anchored-forged-target-')
    const forged = join(forgedRoot, 'workspace')
    const operations = createAnchoredCommentsOperations({ env: {} })
    await assert.rejects(
      operations.invoke(
        ANCHORED_COMMENT_CAPABILITY_IDS.list,
        { workspaceRoot: forged },
        workspaceRoot
      )
    )
    await assert.rejects(
      operations.invoke(
        ANCHORED_COMMENT_CAPABILITY_IDS.upsert,
        { thread: researchThread('thread-forged'), workspaceRoot: forged },
        workspaceRoot
      )
    )
    await assert.rejects(
      operations.invoke(
        ANCHORED_COMMENT_CAPABILITY_IDS.delete,
        { threadId: 'thread-1', workspaceRoot: forged },
        workspaceRoot
      )
    )
    assert.equal(existsSync(forged), false)
  })

  test('the operation rejects a relative or NUL-bearing caller workspace', () => {
    assert.throws(() => anchoredCommentsDataRoot(''))
    assert.throws(() => anchoredCommentsDataRoot('   '))
    assert.throws(() => anchoredCommentsDataRoot('relative/workspace'))
    assert.throws(() => anchoredCommentsDataRoot('/tmp/anchored\0workspace'))
    assert.throws(() => anchoredCommentsDataRoot(`/${'x'.repeat(4_096)}`))
  })

  test('every capability input schema is strict and rejects a forged workspaceRoot', () => {
    const asset = {
      digest: createHash('sha256').update(PNG_BYTES).digest('hex'),
      mimeType: 'image/png' as const,
      byteLength: PNG_BYTES.byteLength,
      width: 2,
      height: 2
    }
    const samples: Record<string, unknown> = {
      [ANCHORED_COMMENT_CAPABILITY_IDS.list]: {},
      [ANCHORED_COMMENT_CAPABILITY_IDS.get]: { threadId: 'thread-1' },
      [ANCHORED_COMMENT_CAPABILITY_IDS.upsert]: { thread: researchThread('thread-1') },
      [ANCHORED_COMMENT_CAPABILITY_IDS.delete]: { threadId: 'thread-1' },
      [ANCHORED_COMMENT_CAPABILITY_IDS.readAsset]: { asset },
      [ANCHORED_COMMENT_CAPABILITY_IDS.capture]: captureRequest(),
      [ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback]: { packet: feedbackPacket() },
      [ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus]: { threadId: 'thread-1' }
    }
    for (const [capabilityId, schema] of Object.entries(CAPABILITY_INPUT_SCHEMAS)) {
      const sample = samples[capabilityId]
      assert.ok(sample !== undefined, `missing strictness sample for ${capabilityId}`)
      assert.equal(schema.safeParse(sample).success, true, `${capabilityId} rejected its valid sample`)
      const forged = schema.safeParse({ ...(sample as object), workspaceRoot: '/forged/workspace' })
      assert.equal(forged.success, false, `${capabilityId} accepted a forged workspaceRoot`)
    }
  })

  test('the caller workspace is the only place the store is written', async () => {
    const workspaceRoot = await tempRoot('anchored-store-workspace-')
    const operations = createAnchoredCommentsOperations({ env: {} })
    await operations.invoke(
      ANCHORED_COMMENT_CAPABILITY_IDS.upsert,
      { thread: researchThread('thread-store-1') },
      workspaceRoot
    )
    assert.equal(
      existsSync(join(workspaceRoot, '.sciforge', 'anchored-comments', 'comments.json')),
      true
    )
    assert.equal(anchoredCommentsDataRoot(workspaceRoot), join(workspaceRoot, '.sciforge'))
  })
})