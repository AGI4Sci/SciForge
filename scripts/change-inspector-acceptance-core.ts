/**
 * Architecture and Host lifecycle acceptance using the shared plugin test harness.
 * Real child process, generic agentThreads provider and CapabilityBroker;
 * recorded Host aggregate + fixture Agent resolver, never a live model or UI.
 */
import assert from 'node:assert/strict'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export type AcceptanceStep = Readonly<{ step: string; ok: true; detail: unknown }>
export type AcceptanceReport = Readonly<{
  ok: true
  evidence: 'host-lifecycle-fixture'
  liveModel: false
  uiVerified: false
  package: string
  version: string
  declared: number
  electron: string | null
  steps: readonly AcceptanceStep[]
}>

export type AcceptanceOptions = Readonly<{
  repository: string
  /** Execution runtime metadata only; this does not verify application startup. */
  electron?: string | null
  onStep?: (step: AcceptanceStep) => void
}>

export async function runAcceptance(options: AcceptanceOptions): Promise<AcceptanceReport> {
  const steps: AcceptanceStep[] = []
  const step = (name: string, detail: unknown): void => {
    const entry = { step: name, ok: true as const, detail }
    steps.push(entry)
    options.onStep?.(entry)
  }
  const load = (path: string) => import(pathToFileURL(join(options.repository, path)).href)
  const harnessModule = await load('plugins/change-inspector/tests/harness.ts') as typeof import('../plugins/change-inspector/tests/harness.js')
  const contract = await load('plugins/change-inspector/src/contract.ts') as typeof import('../plugins/change-inspector/src/contract.js')
  const { createHarness, invokeHarness, PACKAGE_NAME, PACKAGE_VERSION } = harnessModule
  const { CHANGE_INSPECTOR_CAPABILITY_IDS, changeInspectorOpenSessionResultSchema, changeInspectorListChangesOutputSchema } = contract
  const manifest = JSON.parse(await readFile(join(options.repository, 'plugins/change-inspector/sciforge.dsh.json'), 'utf8'))
  const declared = Object.values(manifest.tools ?? {}).map(tool => (tool as { id: string }).id).sort()
  assert.deepEqual(declared, Object.values(CHANGE_INSPECTOR_CAPABILITY_IDS).sort())
  assert.equal(declared.length, 2)
  step('plugin-owned-public-contract', { ids: declared, liveModel: false, source: 'recorded Host aggregate and fixture Agent resolver' })

  const h = await createHarness()
  // Confirm the exact cleanup target before invoking the shared harness disposer.
  // Never remove a repository path, a supplied path, or a symlink target.
  const cleanupRoot = await realpath(h.root)
  assert.equal((await lstat(h.root)).isSymbolicLink(), false)
  assert.equal(dirname(cleanupRoot), await realpath(tmpdir()))
  assert.match(basename(cleanupRoot), /^change-inspector-host-[^/]+$/u)
  try {
    const baseline = h.registry.list().map(item => item.id).sort()
    assert.ok(baseline.every(id => !id.startsWith('change-inspector.')))
    await h.service.setEnabled(PACKAGE_NAME, true)
    const descriptors = h.registry.list().filter(item => !baseline.includes(item.id))
    const openers = descriptors.filter(item => item.tags.includes('dsh-session-opener'))
    assert.equal(openers.length, 1)
    const ids = [...declared, openers[0]!.id].sort()
    assert.deepEqual(descriptors.map(item => item.id).sort(), ids)
    for (const descriptor of descriptors) assert.ok(descriptor.audiences.includes('agent'))
    const identity = h.service.activePluginIdentity(PACKAGE_NAME)
    assert.ok(identity)
    step('registered-two-tools-and-generic-opener', { package: PACKAGE_NAME, ids, identity })

    const resource = (await h.broker.invokeOrdinarySession(h.caller, {
      actionId: openers[0]!.id, input: {}
    }, h.ordinarySession)).output as { token: string; semanticRevision: string; expiresAt: string }
    assert.match(resource.token, /^cap_/u)
    const opened = changeInspectorOpenSessionResultSchema.parse((await invokeHarness(h, CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {})).output)
    assert.equal(opened.snapshot.sessionId, h.ordinarySession.threadId)
    assert.match(opened.snapshot.revision, /^changes-[a-f0-9]{64}$/u)
    assert.deepEqual(opened.snapshot.changes.map(change => change.id), ['invoke-artifact'])
    assert.deepEqual(h.snapshotReads, [h.ordinarySession])
    const page = changeInspectorListChangesOutputSchema.parse((await invokeHarness(h, CHANGE_INSPECTOR_CAPABILITY_IDS.listChanges, { limit: 1 })).output)
    assert.equal(page.revision, opened.snapshot.revision)
    assert.deepEqual(page.changes.map(change => change.id), ['invoke-artifact'])
    step('broker-reads-recorded-host-aggregate', { sessionId: opened.snapshot.sessionId, revision: page.revision, changes: page.changes.length })

    const reads = h.snapshotReads.length
    await assert.rejects(h.broker.invoke(h.caller, { actionId: CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, input: {} }))
    await assert.rejects(invokeHarness(h, CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, { workspaceRoot: h.workspaceRoot }))
    await assert.rejects(invokeHarness(h, CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, { sessionId: 'other-session' }))
    assert.equal(h.snapshotReads.length, reads)
    step('reject-unbound-and-forged-authority', { extraSnapshotReads: 0 })

    await h.service.setEnabled(PACKAGE_NAME, false)
    assert.deepEqual(h.registry.list().map(item => item.id).sort(), baseline)
    assert.equal(h.service.activePluginIdentity(PACKAGE_NAME), undefined)
    for (const actionId of ids) {
      await assert.rejects(h.broker.invokeOrdinarySession(h.caller, { actionId, input: {}, resource }, h.ordinarySession))
    }
    await assert.rejects(h.broker.observe(h.caller, { resource }))
    assert.equal(h.snapshotReads.length, reads)
    step('disable-unregisters-all-contributions', { ids, registered: 0, staleResourceRejected: true })

    await h.service.setEnabled(PACKAGE_NAME, true)
    assert.deepEqual(h.registry.list().map(item => item.id).sort(), [...baseline, ...ids].sort())
    const reopened = changeInspectorOpenSessionResultSchema.parse((await invokeHarness(h, CHANGE_INSPECTOR_CAPABILITY_IDS.openSession, {})).output)
    assert.equal(reopened.snapshot.revision, opened.snapshot.revision)
    step('reenable-restores-canonical-tools', { ids, revision: reopened.snapshot.revision })
    await h.service.dispose()
    assert.deepEqual(h.registry.list(), [])
    step('dispose-unregisters-all-contributions', { registered: 0 })
  } finally {
    // h.root has been resolved and checked above; shared harness owns this root.
    await h.dispose()
  }
  return Object.freeze({
    ok: true, evidence: 'host-lifecycle-fixture', liveModel: false, uiVerified: false,
    package: PACKAGE_NAME, version: PACKAGE_VERSION, declared: declared.length,
    electron: options.electron ?? null, steps: Object.freeze(steps)
  })
}
