import assert from 'node:assert/strict'
import { test } from 'node:test'
import { discoverPlugins } from './discovery.js'
import { parsePluginManifest } from './manifest.js'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

// Public fields observed in the unmodified installed dsh-unitverse@1.1.1.
// No plugin code, dependencies, profile or user data are embedded here.
const manifest = {
  name: 'dsh-unitverse', version: '1.1.1', type: 'module',
  exports: { '.': { import: './lib/index.js', require: './lib/index.cjs' }, './client': { default: './lib/client.js' } },
  engines: { node: '>=18' },
  dsh: {
    bundle: { patch: './cordis.patch.yml' },
    client: { platform: 'web', inject: ['@deepseek-ai/dsh-client-runtime'] },
    marketplace: { profiles: ['web'], requiresBuildApproval: false, requiresRestart: true, manualSteps: false }
  }
}

test('preserves third-party DSH metadata without treating it as host approval', () => {
  const parsed = parsePluginManifest(manifest)
  assert.deepEqual(parsed.dsh, manifest.dsh)
  assert.throws(() => parsePluginManifest({ ...manifest, dsh: { ...manifest.dsh, bundle: { patch: 42 } } }))
})

test('discovers a native manifest with supplemental metadata and no SciForge sidecar', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-manifest-contract-'))
  try {
    const directory = join(root, 'plugin')
    await mkdir(join(directory, 'lib'), { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify(manifest))
    await writeFile(join(directory, 'cordis.patch.yml'), '- insert:\n    - id: unitverse\n      name: dsh-unitverse\n')
    await writeFile(join(directory, 'lib/index.js'), 'export {}')
    await writeFile(join(directory, 'lib/client.js'), 'export {}')
    const plugins = await discoverPlugins(root, { root, hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0-rc.2' })
    assert.equal(plugins.length, 1)
    assert.equal(plugins[0]?.layout.mainEntry, './lib/index.js')
    assert.equal(plugins[0]?.layout.clientEntry, './lib/client.js')
    assert.equal(plugins[0]?.adapter, undefined)
    assert.equal(plugins[0]?.permissions.allowed, false)
    assert.equal(plugins[0]?.compatibility.compatible, false)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
