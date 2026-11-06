/**
 * G9: the actual Anchored Comments plugin through the real Broker.
 *
 * Composes the real `DevelopmentExternalPluginService`, real `CapabilityBroker`
 * and real `ProcessExtensionHost` child, then runs the full
 * upsert → list → get → delete chain with an ordinary Session identity. This is
 * the agent lane; the renderer IPC lane cannot carry a Session envelope.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { CapabilityBroker } from '../../../src/main/capabilities/broker.js'
import { ANCHORED_COMMENT_CAPABILITY_IDS } from '../src/core/contract.js'
import { researchThread } from './fixtures.js'
import {
  anchoredCommentIds,
  createHarness,
  EXPECTED_IDS,
  PACKAGE_NAME
} from './harness.js'

test('Broker regression runs upsert → list → get → delete with a workspace-bound caller', { timeout: 120_000 }, async () => {
  const harness = await createHarness()
  const WORKSPACE = harness.workspaceRoot
  const broker = new CapabilityBroker(harness.registry)
  const caller = Object.freeze({
    audience: 'agent' as const,
    callerId: 'ac-broker-caller',
    workspaceId: WORKSPACE
  })
  const session = Object.freeze({ runtimeId: 'ac-runtime', threadId: 'ac-thread' })
  try {
    await harness.service.setEnabled(PACKAGE_NAME, true)
    assert.deepEqual(anchoredCommentIds(harness.registry), EXPECTED_IDS)

    const thread = researchThread('thread-broker-1')
    const upserted = await broker.invokeOrdinarySession(caller, {
      actionId: ANCHORED_COMMENT_CAPABILITY_IDS.upsert,
      invocationId: 'ac-upsert',
      input: { workspaceRoot: WORKSPACE, thread }
    }, session)
    assert.deepEqual(upserted.output, thread)

    const listed = await broker.invokeOrdinarySession(caller, {
      actionId: ANCHORED_COMMENT_CAPABILITY_IDS.list,
      input: { workspaceRoot: WORKSPACE }
    }, session)
    const threads = (listed.output as unknown as { threads: Array<{ id: string }> }).threads
    assert.deepEqual(threads.map((item) => item.id), [thread.id])

    const got = await broker.invokeOrdinarySession(caller, {
      actionId: ANCHORED_COMMENT_CAPABILITY_IDS.get,
      input: { workspaceRoot: WORKSPACE, threadId: thread.id }
    }, session)
    assert.deepEqual(got.output, { thread })

    const stored = JSON.parse(await readFile(
      join(WORKSPACE, '.sciforge', 'anchored-comments', 'comments.json'),
      'utf8'
    )) as { threads: Array<{ id: string }> }
    assert.deepEqual(stored.threads.map((item) => item.id), [thread.id])

    // Explicit foreign arguments must be rejected rather than silently rebound.
    await assert.rejects(broker.invokeOrdinarySession(caller, {
      actionId: ANCHORED_COMMENT_CAPABILITY_IDS.list,
      input: { workspaceRoot: join(WORKSPACE, '..', 'foreign') }
    }, session), /authenticated caller workspace/)
    const enumerated = await broker.invokeOrdinarySession(caller, {
      actionId: ANCHORED_COMMENT_CAPABILITY_IDS.capture,
      invocationId: 'ac-enumerate',
      input: { action: 'enumerate', workspaceRoot: WORKSPACE }
    }, session)
    assert.deepEqual(enumerated.output, { targets: [] })

    // This synthetic approval fixture tests Broker policy, not real human acceptance.
    await assert.rejects(
      broker.invokeOrdinarySession(caller, {
        actionId: ANCHORED_COMMENT_CAPABILITY_IDS.delete,
        invocationId: 'ac-delete-denied',
        input: { workspaceRoot: WORKSPACE, threadId: thread.id }
      }, session),
      (error: unknown) => Boolean(error && typeof error === 'object' && 'code' in error &&
        (error as { code?: string }).code === 'approval_denied')
    )

    const afterDenial = JSON.parse(await readFile(join(WORKSPACE, '.sciforge', 'anchored-comments', 'comments.json'), 'utf8'))
    assert.deepEqual(afterDenial.threads, [thread])

    const confirmed = {
      audience: 'agent' as const,
      callerId: 'ac-broker-caller',
      workspaceId: WORKSPACE,
      approvals: [{
        actionId: ANCHORED_COMMENT_CAPABILITY_IDS.delete,
        invocationId: 'ac-delete-confirmed',
        mode: 'confirmation' as const
      }]
    }
    const deleted = await broker.invokeOrdinarySession(confirmed, {
      actionId: ANCHORED_COMMENT_CAPABILITY_IDS.delete,
      invocationId: 'ac-delete-confirmed',
      input: { workspaceRoot: WORKSPACE, threadId: thread.id }
    }, session)
    assert.deepEqual(deleted.output, { deleted: true })
  } finally {
    await harness.dispose()
  }
})