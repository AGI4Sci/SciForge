import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { discoverPlugins } from './discovery.js'
import { ProcessExtensionHost } from './process-extension-host.js'

// Opt-in provenance/fail-closed grant smoke. Positive Broker evidence is separate.
// Copies only audited package files, never dependencies or profile data.
const source = process.env.DSH_REAL_PLUGIN_DIR

test('real unitverse: unmodified discovery, isolated core and explicit missing host tool grant', { skip: !source }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-real-audit-'))
  const directory = join(root, 'sample')
  const host = new ProcessExtensionHost()
  try {
    const files = ['package.json', 'LICENSE', 'cordis.patch.yml', 'lib/index.js', 'lib/convert.js', 'lib/chunk-TYC2FTN7.js', 'lib/client.js']
    const hashes: Record<string, string> = {}
    for (const file of files) {
      const bytes = await readFile(join(source!, file))
      await mkdir(dirname(join(directory, file)), { recursive: true })
      await writeFile(join(directory, file), bytes)
      hashes[file] = createHash('sha256').update(bytes).digest('hex')
    }
    const manifest = JSON.parse(await readFile(join(directory, 'package.json'), 'utf8'))
    assert.equal(manifest.name, 'dsh-unitverse')
    assert.equal(manifest.version, '1.1.1')
    assert.equal(manifest.license, 'MIT')
    const plugins = await discoverPlugins(root, { root, hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2' })
    assert.equal(plugins.length, 1)
    assert.equal(plugins[0]?.permissions.allowed, false)
    assert.equal(plugins[0]?.compatibility.compatible, false)
    const core = await import(pathToFileURL(join(directory, 'lib/convert.js')).href)
    const length = core.convertDetailed(5, 'ft', 'cm')
    const pressure = core.convertDetailed(1, 'atm', 'kPa')
    assert.equal(length.result, 152.4)
    assert.equal(pressure.result, 101.325)
    assert.throws(() => core.convertDetailed(1, 'ft', 'kg'))
    let blocker = ''
    await assert.rejects(host.prepare({ pluginId: manifest.name, packageName: manifest.name, version: manifest.version, entryPath: join(directory, 'lib/index.js') }), (error: unknown) => {
      blocker = error instanceof Error ? error.message : String(error)
      return /requires an explicit host compute grant/.test(blocker)
    })
    assert.equal(host.pending(manifest.name), undefined)
    assert.equal(host.runtime(manifest.name), undefined)
    console.log(JSON.stringify({ sample: `${manifest.name}@${manifest.version}`, repository: manifest.repository, license: manifest.license, hashes, discovery: 'parsed; activation not approved', core: { length: length.result, pressure: pressure.result }, startup: 'blocked', blocker, broker: 'NOT EXECUTED', hotReplacement: 'NOT VERIFIED' }, null, 2))
  } finally {
    await host.rollbackPrepared('dsh-unitverse')
    await rm(root, { recursive: true, force: true })
  }
})
