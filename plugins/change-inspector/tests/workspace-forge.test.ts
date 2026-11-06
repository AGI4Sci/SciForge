/** Authority is owned by the real generic Host service, never tool payloads. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHANGE_INSPECTOR_CAPABILITY_IDS } from '../src/contract.js'
import { createHarness, invokeHarness, PACKAGE_NAME } from './harness.js'

for (const actionId of Object.values(CHANGE_INSPECTOR_CAPABILITY_IDS)) {
  test(`${actionId} refuses workspaceRoot/sessionDetail injection before aggregate reads`, { timeout: 120_000 }, async () => {
    const h = await createHarness()
    try {
      await h.service.setEnabled(PACKAGE_NAME, true)
      for (const input of [{ workspaceRoot: h.workspaceRoot }, { workspaceRoot: '/forged' }, { sessionDetail: { artifacts: [] } }]) {
        await assert.rejects(invokeHarness(h, actionId, input), /unrecognized|invalid/i)
      }
      assert.equal(h.snapshotReads.length, 0)
    } finally { await h.dispose() }
  })
}

test('same-workspace other Session and other runtime are refused without lookup', { timeout: 120_000 }, async () => {
  const h = await createHarness()
  try {
    await h.service.setEnabled(PACKAGE_NAME, true)
    for (const input of [{ sessionId: 'other-session-same-workspace' }, { runtimeId: 'other-runtime' }, { sessionId: 'synthetic-dsh-session' }]) {
      await assert.rejects(invokeHarness(h, CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, input), /another session or runtime/)
    }
    assert.equal(h.snapshotReads.length, 0)
  } finally { await h.dispose() }
})

test('untrusted caller root and UI audience cannot gain aggregate read authority', { timeout: 120_000 }, async () => {
  const h = await createHarness()
  try {
    await h.service.setEnabled(PACKAGE_NAME, true)
    for (const caller of [{ ...h.caller, workspaceId: '/forged' }, { ...h.caller, audience: 'ui' as const }]) {
      await assert.rejects(invokeHarness(h, CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {}, caller as typeof h.caller), /authoriz|authenticated|audience|unavailable|Only an Agent/i)
    }
    assert.equal(h.snapshotReads.length, 0)
  } finally { await h.dispose() }
})

test('revoking agent-threads.read prevents aggregate reads on the running generation', { timeout: 120_000 }, async () => {
  const h = await createHarness()
  try {
    await h.service.setEnabled(PACKAGE_NAME, true)
    const contract = h.contracts.get(PACKAGE_NAME)!
    h.contracts.set(PACKAGE_NAME, { ...contract, dshAuthorization: { ...contract.dshAuthorization!, ports: [] } })
    await assert.rejects(invokeHarness(h, CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {}), /authoriz|grant|port/i)
    assert.equal(h.snapshotReads.length, 0)
  } finally { await h.dispose() }
})
