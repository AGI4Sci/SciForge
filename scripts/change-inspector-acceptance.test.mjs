import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { runAcceptance } from './change-inspector-acceptance-core.ts'

const repository = fileURLToPath(new URL('..', import.meta.url))

test('acceptance verifies canonical plugin lifecycle and labels fixture evidence honestly', { timeout: 120_000 }, async () => {
  const steps = []
  const report = await runAcceptance({ repository, onStep: step => steps.push(step) })
  assert.equal(report.evidence, 'host-lifecycle-fixture')
  assert.equal(report.liveModel, false)
  assert.equal(report.uiVerified, false)
  assert.equal(report.electron, null)
  assert.equal(report.declared, 2)
  assert.deepEqual(report.steps, steps)
  const registration = steps.find(step => step.step === 'registered-two-tools-and-generic-opener')
  assert.equal(registration.detail.ids.length, 3)
  const disabled = steps.find(step => step.step === 'disable-unregisters-all-contributions')
  assert.deepEqual(disabled.detail.ids, registration.detail.ids)
  assert.equal(disabled.detail.registered, 0)
  assert.equal(disabled.detail.staleResourceRejected, true)
  assert.equal(steps.at(-1).step, 'dispose-unregisters-all-contributions')
})

for (const args of [['--json'], ['--unknown'], ['--json', '--startup-tests']]) {
  test(`CLI rejects malformed arguments: ${args.join(' ')}`, () => {
    const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/change-inspector-plugin-acceptance.mjs', ...args], {
      cwd: repository, encoding: 'utf8'
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /requires an output path|Unknown argument/)
    assert.doesNotMatch(result.stdout, /ACCEPT plugin-owned/)
  })
}

test('acceptance entrypoints have no retired aliases, thin layer, or synthetic UI evidence', async () => {
  for (const path of ['scripts/change-inspector-acceptance-core.ts', 'scripts/change-inspector-plugin-acceptance.mjs']) {
    const source = await readFile(new URL(`../${path}`, import.meta.url), 'utf8')
    assert.doesNotMatch(source, /change-inspector\.plugin-|change-inspector-thin-layer|createChangeInspectorThinLayer|BrowserWindow|rendererTitle|\bA4\b/)
  }
})
