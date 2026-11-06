import assert from 'node:assert/strict'
import { access, readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { installedDomainPackages } from '../src/shared/installed-domain-packages.ts'

const root = new URL('../', import.meta.url)
const pluginName = '@sciforge/plugin-biology-workbench'
const domainName = '@sciforge/domain-biology-workbench'

test('Biology Room and Life Science Preview have one built-in package and no installable plugin', async () => {
  for (const path of [
    'plugins/biology-workbench', 'plugins/biology-room', 'plugins/life-science-preview',
    'src/main/extensions/biology-workbench-takeover.ts', 'scripts/biology-workbench'
  ]) await assert.rejects(access(new URL(path, root)), { code: 'ENOENT' })
  const definitions = installedDomainPackages.definitions.filter((entry) => entry.packageName === domainName)
  assert.equal(definitions.length, 1)
  const declaration = JSON.parse(await readFile(new URL('packages/domains/biology-workbench/sciforge.domain.json', root), 'utf8'))
  const slots = Object.values(declaration.contributionContracts).filter((entry) => typeof entry.modality === 'string')
  assert.deepEqual(slots.map((entry) => entry.id).sort(), [
    'bioimaging', 'biology-index-transport', 'molecular', 'omics-matrix', 'proteomics-spectra', 'sequence-genomics'
  ])
  assert.ok(declaration.entrypoints.some((entry) => entry.process === 'main'))
  assert.ok(declaration.entrypoints.some((entry) => entry.process === 'renderer'))
  assert.ok(declaration.entrypoints.some((entry) => entry.process === 'workspace-server'))
})

test('installed plugin state cannot exclude the built-in biology provider at startup', async () => {
  const startup = await readFile(new URL('src/main/index.ts', root), 'utf8')
  assert.ok(!/biologyTakeover|resolveBiologyWorkbenchTakeover|BIOLOGY_WORKBENCH_STATIC_PACKAGE/.test(startup))
  const generated = await readFile(new URL('src/main/modules/installed-domain-main.ts', root), 'utf8')
  assert.ok(generated.includes(domainName))
})

test('dependency and market metadata contain no biological runtime plugin', async () => {
  const lock = JSON.parse(await readFile(new URL('package-lock.json', root), 'utf8'))
  assert.ok(!JSON.stringify(lock.packages).includes(pluginName))
  assert.ok(!Object.keys(lock.packages).some((key) => key === 'plugins/biology-workbench'))
  const market = JSON.parse(await readFile(new URL('market/index.json', root), 'utf8'))
  for (const record of [...market.plugins, ...market.blocked]) {
    assert.notEqual(record.name, pluginName)
    assert.notEqual(record.plugin, 'biology-workbench')
  }
  const batch = await readFile(new URL('scripts/dsh-plugin-market-batch.mjs', root), 'utf8')
  assert.doesNotMatch(batch, /'biology-workbench'\s*:/)
})
