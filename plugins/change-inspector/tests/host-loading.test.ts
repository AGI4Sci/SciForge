/** Real built plugin + child process + generic Host provider; recorded aggregate, not live Agent acceptance. */
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CHANGE_INSPECTOR_CAPABILITY_IDS } from '../src/contract.js'
import { createHarness, invokeHarness, PACKAGE_NAME, EXPECTED_IDS, changeInspectorIds } from './harness.js'

test('real Host lifecycle: activate, authorized default read, disable, re-enable', { timeout: 120_000 }, async () => {
  const h = await createHarness()
  try {
    await h.service.setEnabled(PACKAGE_NAME, true)
    assert.deepEqual(changeInspectorIds(h.registry), EXPECTED_IDS)
    const invoke = (actionId: string, input: unknown) => invokeHarness(h, actionId, input)
    const opened = (await invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {})).output as { snapshot: { sessionId: string; revision: string; changes: { id: string; patchBytes: number; patchTruncated: boolean }[]; truncationReasons: string[] } }
    assert.equal(opened.snapshot.sessionId, h.ordinarySession.threadId)
    assert.match(opened.snapshot.revision, /^changes-[a-f0-9]{64}$/)
    assert.equal(opened.snapshot.changes[0]!.id, 'invoke-artifact')
    assert.equal(opened.snapshot.changes[0]!.patchBytes > 0, true)
    assert.equal(opened.snapshot.changes[0]!.patchTruncated, false)
    assert.deepEqual(opened.snapshot.truncationReasons, [])
    assert.deepEqual(h.snapshotReads, [h.ordinarySession])
    const page = (await invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges, { limit: 1 })).output as { revision: string; changes: unknown[] }
    assert.equal(page.revision, opened.snapshot.revision)
    assert.equal(page.changes.length, 1)
    await assert.rejects(invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, { sessionId: 1 }), /invalid|validation|expected|string/i)
    const opener = h.registry.list().find(item => item.tags.includes('dsh-session-opener'))!
    const staleResource = (await h.broker.invokeOrdinarySession(h.caller, { actionId: opener.id, input: {} }, h.ordinarySession)).output as { token: string; semanticRevision: string; expiresAt: string }
    await h.service.setEnabled(PACKAGE_NAME, false)
    assert.deepEqual(changeInspectorIds(h.registry), [])
    await assert.rejects(invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {}), /not found|unknown|unavailable|registered/i)
    await h.service.setEnabled(PACKAGE_NAME, true)
    assert.equal(((await invoke(CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {})).output as typeof opened).snapshot.revision, opened.snapshot.revision)
    await h.service.dispose()
    await h.service.dispose()
  } finally {
    await h.dispose()
  }
})
