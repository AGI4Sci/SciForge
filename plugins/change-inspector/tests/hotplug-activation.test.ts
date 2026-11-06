/**
 * E2 — activation is idempotent under concurrency, and a failed activation
 * rolls back without leaving a registration behind.
 *
 * The host projects each DSH tool by its own grant (GAPS.md G7 is fixed), so
 * `open_session` is registered exactly once using the injected generic agentThreads
 * Host service client. Registration, lifecycle state and generation are all
 * asserted.
 */
import assert from 'node:assert/strict'
import { cp } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  activationStateOf,
  changeInspectorIds,
  createHarness,
  DECLARED_IDS,
  EXPECTED_IDS,
  generationOf,
  PACKAGE_NAME,
  PLUGIN_SOURCE
} from './harness.js'

test('concurrent activation is accepted once: one generation, one active lifecycle', { timeout: 120_000 }, async () => {
  const harness = await createHarness()
  try {
    const before = await generationOf(harness)
    assert.equal(typeof before, 'number', 'discovered lifecycle must expose a numeric generation')
    assert.ok(before !== undefined)
    const outcomes = await Promise.allSettled([
      harness.service.setEnabled(PACKAGE_NAME, true),
      harness.service.setEnabled(PACKAGE_NAME, true)
    ])
    assert.deepEqual(
      outcomes.map((outcome) => outcome.status),
      ['fulfilled', 'fulfilled']
    )
    assert.equal(await activationStateOf(harness), 'active')
    assert.equal(await generationOf(harness), before + 1)
    assert.equal((await harness.service.list()).filter((entry) => entry.packageName === PACKAGE_NAME).length, 1)
    // G7 fixed: the granted read tool is projected.
    assert.deepEqual(changeInspectorIds(harness.registry), EXPECTED_IDS)
    assert.deepEqual(DECLARED_IDS, ['change-inspector.list-changes', 'change-inspector.open-session'])
  } finally {
    await harness.dispose()
  }
})

test('a second enable while active does not restart or re-register', { timeout: 120_000 }, async () => {
  const harness = await createHarness()
  try {
    await harness.service.setEnabled(PACKAGE_NAME, true)
    const generation = await generationOf(harness)
    await harness.service.setEnabled(PACKAGE_NAME, true)
    assert.equal(await generationOf(harness), generation)
    assert.equal(await activationStateOf(harness), 'active')
    assert.deepEqual(changeInspectorIds(harness.registry), EXPECTED_IDS)
  } finally {
    await harness.dispose()
  }
})

test('a failed activation rolls back: no active state, no residue, retry works', { timeout: 120_000 }, async () => {
  const harness = await createHarness({ brokenEntry: true })
  try {
    await assert.rejects(
      harness.service.setEnabled(PACKAGE_NAME, true),
      /activation failed/i
    )
    assert.notEqual(await activationStateOf(harness), 'active')
    assert.deepEqual(changeInspectorIds(harness.registry), [])

    // The failed generation is still unloadable without throwing.
    await harness.service.setEnabled(PACKAGE_NAME, false)
    assert.deepEqual(changeInspectorIds(harness.registry), [])

    // Repair the artifact in place: the failed lifecycle must be retired and a
    // fresh activation must succeed without a duplicate registration.
    await cp(join(PLUGIN_SOURCE, 'dist', 'main.js'), join(harness.pluginsRoot, 'change-inspector', 'dist', 'main.js'))
    await harness.service.setEnabled(PACKAGE_NAME, true)
    assert.equal(await activationStateOf(harness), 'active')
    assert.deepEqual(changeInspectorIds(harness.registry), EXPECTED_IDS)
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
    assert.deepEqual(changeInspectorIds(harness.registry), [])
    assert.notEqual(await activationStateOf(harness), 'active')

    await harness.service.setEnabled(PACKAGE_NAME, true)
    assert.equal(await activationStateOf(harness), 'active')
  } finally {
    await harness.dispose()
  }
})