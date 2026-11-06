/** Canonical public tool invocations run through Broker, not the retired thin-layer invocation API. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHANGE_INSPECTOR_CAPABILITY_IDS } from '../src/contract.js'
import { createHarness, invokeHarness, PACKAGE_NAME, contractFor } from './harness.js'

for (const actionId of Object.values(CHANGE_INSPECTOR_CAPABILITY_IDS)) {
  test(`${actionId} fails closed without an authenticated ordinary Session`, { timeout: 120_000 }, async () => {
    const h = await createHarness()
    try {
      await h.service.setEnabled(PACKAGE_NAME, true)
      await assert.rejects(h.broker.invoke(h.caller, { actionId, input: {} }), /Resource|resource|Session|session|authority|envelope/)
      assert.equal(h.snapshotReads.length, 0)
    } finally { await h.dispose() }
  })
}

test('canonical tool invocation rejects missing, disabled and unknown capabilities', { timeout: 120_000 }, async () => {
  const h = await createHarness()
  try {
    const invoke = (actionId: string) => invokeHarness(h, actionId, {})
    await assert.rejects(invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.openSession))
    await h.service.setEnabled(PACKAGE_NAME, true)
    await assert.rejects(invoke('change-inspector.delete-everything'))
    await h.service.setEnabled(PACKAGE_NAME, false)
    await assert.rejects(invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.openSession))
    assert.equal(h.service.activePluginIdentity(PACKAGE_NAME), undefined)
    assert.equal(h.snapshotReads.length, 0)
  } finally { await h.dispose() }
})

test('live exact-version approval is rechecked before Host reads', { timeout: 120_000 }, async () => {
  const h = await createHarness()
  try {
    await h.service.setEnabled(PACKAGE_NAME, true)
    h.contracts.set(PACKAGE_NAME, contractFor(PACKAGE_NAME, '9.9.9'))
    await assert.rejects(invokeHarness(h, CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {}), /authoriz|approv|contract|grant/i)
    assert.equal(h.snapshotReads.length, 0)
  } finally { await h.dispose() }
})
