import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { indexFromBatchReport } from './dsh-plugin-market-index.mjs'

test('market catalog retains the actual package source instead of assuming a plugins directory', async () => {
  const source = 'packages/domains/example-domain'
  const report = {
    dshRuntimeVersion: '0.2.0-rc.2', catalogEntries: [{ name: '@example/domain', source }],
    plugins: [{ plugin: 'example-domain', packageName: '@example/domain', version: '1.0.0', source, activated: true,
      artifact: { path: 'example.sciforge-dsh-plugin', tools: ['read'], hostDependencies: [], publisherId: 'example', sizeBytes: 1, sha256: 'a'.repeat(64) } }]
  }
  const index = await indexFromBatchReport(report, async () => ({ manifest: { entry: 'dist/main.js', tools: { read: { id: 'example.read', effect: 'read' } }, hostDependencies: [] } }))
  assert.equal(index.plugins[0].source, source)
})

test('discovery includes DSH domain packages without installing plain domains or escaping fixture scope', async () => {
  const { listDshPluginDirectories } = await import('./dsh-plugin-sources.mjs')
  const root = await mkdtemp(join(tmpdir(), 'dsh-sources-'))
  try {
    for (const [dir, manifest] of [
      ['plugins/legacy', { name: '@example/legacy' }],
      ['plugins/templates', { name: '@example/template', dsh: { bundle: {} } }],
      ['packages/domains/dual', { name: '@example/dual', dsh: { bundle: { patch: './plugin/cordis.patch.yml' } } }],
      ['packages/domains/plain', { name: '@example/plain' }],
      ['fixtures/demo', { name: '@example/demo', dsh: { bundle: {} } }]
    ]) {
      await mkdir(join(root, dir), { recursive: true })
      await writeFile(join(root, dir, 'package.json'), JSON.stringify(manifest))
    }
    assert.deepEqual(await listDshPluginDirectories({ root }), [join(root, 'packages/domains/dual'), join(root, 'plugins/legacy')].sort())
    assert.deepEqual(await listDshPluginDirectories({ root, pluginsDirectory: 'fixtures' }), [join(root, 'fixtures/demo')])
  } finally { await rm(root, { recursive: true, force: true }) }
})
