/**
 * E2 — activation is idempotent under concurrency, and a failed activation
 * leaves no capability residue behind.
 *
 * The host projects every declared tool (G7 fixed), so a healthy activation
 * registers all eight ids while a failed one registers none.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { ANCHORED_COMMENT_CAPABILITY_IDS } from '../src/core/contract.js'
import {
  activationStateOf,
  anchoredCommentIds,
  anchoredCommentOpeners,
  createHarness,
  EXPECTED_IDS,
  PACKAGE_NAME
} from './harness.js'

test('concurrent activation is accepted once and leaves the plugin active', { timeout: 120_000 }, async () => {
  const harness = await createHarness()
  try {
    const outcomes = await Promise.allSettled([
      harness.service.setEnabled(PACKAGE_NAME, true),
      harness.service.setEnabled(PACKAGE_NAME, true)
    ])
    assert.deepEqual(
      outcomes.map((outcome) => outcome.status),
      ['fulfilled', 'fulfilled']
    )
    assert.equal(await activationStateOf(harness), 'active')
    assert.deepEqual(anchoredCommentIds(harness.registry), EXPECTED_IDS)
    assert.deepEqual(anchoredCommentOpeners(harness.registry), [])
  } finally {
    await harness.dispose()
  }
})

test('a failed activation rolls back: no active state, no registry residue', { timeout: 120_000 }, async () => {
  const harness = await createHarness({ brokenEntry: true })
  try {
    await assert.rejects(harness.service.setEnabled(PACKAGE_NAME, true))
    assert.notEqual(await activationStateOf(harness), 'active')
    assert.deepEqual(anchoredCommentIds(harness.registry), [])
    // The failed generation is still unloadable without throwing.
    await harness.service.setEnabled(PACKAGE_NAME, false)
    assert.deepEqual(anchoredCommentIds(harness.registry), [])
  } finally {
    await harness.dispose()
  }
})

test('disabling an active plugin removes every contribution and keeps it loadable', { timeout: 120_000 }, async () => {
  const harness = await createHarness()
  try {
    await harness.service.setEnabled(PACKAGE_NAME, true)
    assert.equal(await activationStateOf(harness), 'active')
    await harness.service.setEnabled(PACKAGE_NAME, false)
    assert.deepEqual(anchoredCommentIds(harness.registry), [])
    assert.notEqual(await activationStateOf(harness), 'active')

    await harness.service.setEnabled(PACKAGE_NAME, true)
    assert.equal(await activationStateOf(harness), 'active')
  } finally {
    await harness.dispose()
  }
})

test('G8: the delete tool keeps its confirmation gate after projection', { timeout: 120_000 }, async () => {
  const harness = await createHarness()
  try {
    await harness.service.setEnabled(PACKAGE_NAME, true)
    const approval = (id: string) => harness.registry.get(id)?.descriptor.approval
    assert.equal(approval(ANCHORED_COMMENT_CAPABILITY_IDS.delete), 'confirmation')
    assert.equal(approval(ANCHORED_COMMENT_CAPABILITY_IDS.submitFeedback), 'confirmation')
    for (const id of [
      ANCHORED_COMMENT_CAPABILITY_IDS.list,
      ANCHORED_COMMENT_CAPABILITY_IDS.get,
      ANCHORED_COMMENT_CAPABILITY_IDS.upsert,
      ANCHORED_COMMENT_CAPABILITY_IDS.readAsset,
      ANCHORED_COMMENT_CAPABILITY_IDS.capture,
      ANCHORED_COMMENT_CAPABILITY_IDS.feedbackStatus
    ]) {
      assert.equal(approval(id), 'none', `unexpected approval for ${id}`)
    }
  } finally {
    await harness.dispose()
  }
})
