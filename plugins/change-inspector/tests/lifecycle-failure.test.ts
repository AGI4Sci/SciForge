/** Source Host integration: real plugin children and Broker; no live Agent/model. */
import assert from 'node:assert/strict'
import { ChildProcess } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { test } from 'node:test'
import { CHANGE_INSPECTOR_CAPABILITY_IDS } from '../src/contract.js'
import {
  changeInspectorIds, contractFor, createHarness, EXPECTED_IDS, generationOf,
  installPlugin, invokeHarness, PACKAGE_NAME, PACKAGE_VERSION
} from './harness.js'

const openSession = CHANGE_INSPECTOR_CAPABILITY_IDS.openSession
function barrier() {
  let release!: () => void
  const promise = new Promise<void>((resolve) => { release = resolve })
  return { promise, release }
}
async function until(check: () => boolean, message: string) {
  for (let attempt = 0; attempt < 500; attempt++) {
    if (check()) return
    await delay(10)
  }
  assert.fail(message)
}

test('failed approved update candidate preserves the healthy plugin generation and Broker tools', { timeout: 120_000 }, async () => {
  const h = await createHarness()
  try {
    await h.service.setEnabled(PACKAGE_NAME, true)
    const identity = h.service.activePluginIdentity(PACKAGE_NAME)
    const before = (await invokeHarness(h, openSession, {})).output
    const candidate = join(h.pluginsRoot, '.candidates', 'broken-update')
    await installPlugin(candidate, { brokenEntry: true })
    const manifestPath = join(candidate, 'package.json')
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'))
    manifest.version = '0.99.0'
    await writeFile(manifestPath, JSON.stringify(manifest))
    // Keep both exact-version approvals so activation, not approval, fails.
    h.contracts.set(`${PACKAGE_NAME}@${PACKAGE_VERSION}`, contractFor(PACKAGE_NAME, PACKAGE_VERSION))
    h.contracts.set(`${PACKAGE_NAME}@0.99.0`, contractFor(PACKAGE_NAME, '0.99.0'))
    await h.service.checkCandidate(PACKAGE_NAME, candidate)
    await assert.rejects(h.service.applyCandidate(PACKAGE_NAME), /simulated activation failure|activation failed/i)
    assert.deepEqual(h.service.activePluginIdentity(PACKAGE_NAME), identity)
    assert.deepEqual(changeInspectorIds(h.registry), EXPECTED_IDS)
    const status = await h.service.updateStatus(PACKAGE_NAME)
    assert.equal(status.version, PACKAGE_VERSION)
    assert.equal(status.status, 'invalid')
    assert.ok(status.diagnostic)
    assert.deepEqual((await invokeHarness(h, openSession, {})).output, before)
  } finally { await h.dispose() }
})

test('a test-owned plugin child crash unregisters its tools while another service stays callable', { timeout: 120_000 }, async (t) => {
  const h = await createHarness()
  const other = await createHarness()
  try {
    await other.service.setEnabled(PACKAGE_NAME, true)
    const otherIdentity = other.service.activePluginIdentity(PACKAGE_NAME)
    const before = (await invokeHarness(other, openSession, {})).output
    // Observe only this activation's spawn; never discover or kill ambient PIDs.
    const spawn = t.mock.method(ChildProcess.prototype as ChildProcess & { spawn: (...args: unknown[]) => unknown }, 'spawn')
    await h.service.setEnabled(PACKAGE_NAME, true)
    const children = spawn.mock.calls.map(call => call.this as ChildProcess)
    t.mock.restoreAll()
    assert.equal(children.length, 1)
    const child = children[0]
    assert.ok(child.pid && child.pid !== process.pid)
    assert.deepEqual(changeInspectorIds(h.registry), EXPECTED_IDS)
    const exited = new Promise<void>(resolve => child.once('exit', () => resolve()))
    assert.equal(child.kill('SIGKILL'), true)
    await exited
    await until(() => changeInspectorIds(h.registry).length === 0, 'crashed plugin tools remained registered')
    assert.equal(h.service.activePluginIdentity(PACKAGE_NAME), undefined)
    assert.equal((await h.service.updateStatus(PACKAGE_NAME)).activationState, 'failed')
    await assert.rejects(invokeHarness(h, openSession, {}))
    assert.deepEqual(other.service.activePluginIdentity(PACKAGE_NAME), otherIdentity)
    assert.deepEqual(changeInspectorIds(other.registry), EXPECTED_IDS)
    assert.deepEqual((await invokeHarness(other, openSession, {})).output, before)
  } finally {
    t.mock.restoreAll()
    await Promise.all([h.dispose(), other.dispose()])
  }
})

for (const retire of ['cancel', 'disable'] as const) {
  test(`${retire} fences an in-flight canonical Host read and rejects its late completion`, { timeout: 120_000 }, async () => {
    const entered = barrier(), release = barrier(), aborted = barrier()
    let held = true
    let completed = false
    const h = await createHarness({ beforeSnapshotRead: async signal => {
      if (!held) return
      signal.addEventListener('abort', aborted.release, { once: true })
      if (signal.aborted) aborted.release()
      entered.release()
      await release.promise // Deliberately ignore abort until the producer settles.
      completed = true
    } })
    const controller = new AbortController()
    let call: ReturnType<typeof invokeHarness> | undefined
    let disable: Promise<unknown> | undefined
    try {
      await h.service.setEnabled(PACKAGE_NAME, true)
      const generation = await generationOf(h)
      call = invokeHarness(h, openSession, {}, h.caller, { signal: controller.signal })
      let settled = false
      void call.then(() => { settled = true }, () => { settled = true })
      await entered.promise
      if (retire === 'cancel') controller.abort()
      else disable = h.service.setEnabled(PACKAGE_NAME, false)
      await aborted.promise
      assert.equal(completed, false)
      assert.equal(settled, false, 'outer invocation must await held provider settlement')
      const rejection = assert.rejects(call, retire === 'cancel'
        ? { code: 'invocation_cancelled' }
        : /Host invocation authority closed/)
      held = false
      release.release()
      await rejection
      await disable
      assert.equal(completed, true)
      if (retire === 'disable') {
        assert.equal(h.service.activePluginIdentity(PACKAGE_NAME), undefined)
        assert.deepEqual(changeInspectorIds(h.registry), [])
        await assert.rejects(invokeHarness(h, openSession, {}))
        await h.service.setEnabled(PACKAGE_NAME, true)
        assert.ok((await generationOf(h))! > generation!)
      } else {
        assert.equal(await generationOf(h), generation)
      }
      assert.deepEqual(changeInspectorIds(h.registry), EXPECTED_IDS)
      assert.ok((await invokeHarness(h, openSession, {})).output)
    } finally {
      release.release()
      await Promise.allSettled([call, disable])
      await h.dispose()
    }
  })
}
