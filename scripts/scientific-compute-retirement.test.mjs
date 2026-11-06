import assert from 'node:assert/strict'
import { access, readFile, readdir } from 'node:fs/promises'
import { test } from 'node:test'
import { installedDomainPackages } from '../src/shared/installed-domain-packages.ts'
import * as fullTrace from '@sciforge/full-trace'

const root = new URL('../', import.meta.url)
const retired = /scientific-compute|compute_run_baseline|compute_status/u

test('Scientific Compute has no static or installable workspace package', async () => {
  for (const path of ['packages/domains/scientific-compute', 'plugins/scientific-compute']) {
    await assert.rejects(access(new URL(path, root)), { code: 'ENOENT' })
  }
  assert.ok(!installedDomainPackages.definitions.some((entry) => retired.test(entry.packageName)))
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'))
  assert.ok(!retired.test(JSON.stringify(lock.packages)))
})

test('the active capability reference and evaluation sources contain no retired actions', async () => {
  const reference = await readFile(new URL('docs/generated/capabilities.md', root), 'utf8')
  assert.ok(!retired.test(reference))
  const directory = new URL('eval-cases/capability/', root)
  for (const name of await readdir(directory)) {
    if (!/\.jsonl?$/u.test(name)) continue
    const content = await readFile(new URL(name, directory), 'utf8')
    assert.ok(!retired.test(content), `Retired executable reference in ${name}`)
  }
})

test('generic Full Trace remains available without the scientific-only API', async () => {
  assert.equal(typeof fullTrace.LocalTraceStore, 'function')
  assert.equal(typeof fullTrace.deriveTraceId, 'function')
  assert.ok(!Object.keys(fullTrace).some((name) => /scientific/iu.test(name)))
  await assert.rejects(access(new URL('packages/full-trace/src/scientific.ts', root)), { code: 'ENOENT' })
})

test('independent plotting and scientific benchmark infrastructure remain', async () => {
  for (const path of ['plugins/scientific-plotting/package.json', 'scripts/scientific-benchmark.test.mjs']) {
    await access(new URL(path, root))
  }
})
