import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'
import { discoverPlugins, PluginHost } from './discovery.js'
import { checkPluginCompatibility, checkPluginPermissions, parsePluginManifest } from './manifest.js'

const native = (extra: Record<string, unknown> = {}) => parsePluginManifest({ name: '@example/contract-fixture', version: '0.1.0', dsh: { bundle: { patch: './cordis.patch.yml' } }, ...extra })

test('native DSH packages without an adapter remain unknown and need approval', () => {
  const manifest = native()
  const compatibility = checkPluginCompatibility(manifest, { dshRuntimeVersion: '0.2.0', hostApiVersion: '1.0.0' })
  const permissions = checkPluginPermissions(manifest, undefined)
  assert.equal(compatibility.compatible, false)
  assert.equal(compatibility.hostApi.status, 'adapter-required')
  assert.equal(permissions.status, 'needs-approval')
  assert.equal(permissions.allowed, false)
})

test('zero-permission adapters and approved privileged adapters are explicit', () => {
  const manifest = native()
  const zero = checkPluginPermissions(manifest, { hostApiRange: '^1.0.0', permissions: [], approved: true })
  assert.deepEqual(zero, { status: 'approved', allowed: true, requested: [], approved: [], denied: [] })
  const network = checkPluginPermissions(manifest, { hostApiRange: '^1.0.0', permissions: ['network.http'], approved: false }, new Set())
  assert.equal(network.status, 'needs-approval')
  assert.equal(network.allowed, false)
  const approved = checkPluginPermissions(manifest, { hostApiRange: '^1.0.0', permissions: ['network.http'], approved: true }, new Set(['network.http']))
  assert.equal(approved.status, 'approved')
  assert.deepEqual(approved.approved, ['network.http'])
})

test('DSH runtime and SciForge host API checks are independent', () => {
  const manifest = native({ engines: { dsh: '^0.2.0' } })
  const runtimeMismatch = checkPluginCompatibility(manifest, { dshRuntimeVersion: '0.1.0', hostApiVersion: '1.0.0', adapter: { hostApiRange: '^1.0.0', permissions: [], approved: true } })
  assert.equal(runtimeMismatch.dshRuntime.status, 'incompatible')
  assert.equal(runtimeMismatch.hostApi.status, 'compatible')
  const hostMismatch = checkPluginCompatibility(manifest, { dshRuntimeVersion: '0.2.1', hostApiVersion: '2.0.0', adapter: { hostApiRange: '^1.0.0', permissions: [], approved: true } })
  assert.equal(hostMismatch.dshRuntime.status, 'compatible')
  assert.equal(hostMismatch.hostApi.status, 'incompatible')
})

test('dummy plugin can be discovered from an independent directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'sciforge-plugin-discovery-'))
  try {
    const plugin = join(root, 'dummy')
    await mkdir(plugin)
    await writeFile(join(plugin, 'package.json'), JSON.stringify({ name: '@example/dummy-plugin', version: '0.1.0', engines: { dsh: '^1.0.0' }, exports: { '.': './dist/main.js' }, dsh: { bundle: { patch: './cordis.patch.yml' } } }))
    await writeFile(join(plugin, 'cordis.patch.yml'), '[{"insert":[{"id":"example.dummy","name":"./dist/main.js"}]}]')
    await mkdir(join(plugin, 'dist'))
    await writeFile(join(plugin, 'dist', 'main.js'), 'export {}')
    const discovered = await discoverPlugins(root, { root, hostApiVersion: '1.11.0', dshRuntimeVersion: '1.0.0', adapterContracts: new Map([['@example/dummy-plugin', { hostApiRange: '^1.0.0', permissions: [], approved: true }]]) })
    assert.equal(discovered.length, 1)
    assert.equal(discovered[0]?.manifest.name, '@example/dummy-plugin')
    assert.equal(discovered[0]?.compatibility.compatible, true)
    assert.equal(discovered[0]?.permissions.allowed, true)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('PR-1 fixture is outside static domain composition', async () => {
  const fixtureRoot = join(fileURLToPath(new URL('../../../test-fixtures/', import.meta.url)), 'pr1-dummy-plugin')
  const discoveryRoot = join(fixtureRoot, '..')
  const discovered = await discoverPlugins(discoveryRoot, { root: discoveryRoot, hostApiVersion: '1.11.0', dshRuntimeVersion: '0.2.0', adapterContracts: new Map([['@example/dummy-plugin', { hostApiRange: '^1.0.0', permissions: [], approved: true }]]) })
  assert.equal(discovered[0]?.manifest.name, '@example/dummy-plugin')
  assert.equal(discovered[0]?.compatibility.compatible, true)
})

test('dummy host discovers and drives a plugin without static composition', async () => {
  const fixtureRoot = join(fileURLToPath(new URL('../../../test-fixtures/', import.meta.url)), 'pr1-dummy-plugin')
  const events: string[] = []
  const host = new PluginHost({
    root: join(fixtureRoot, '..'),
    hostApiVersion: '1.11.0',
    dshRuntimeVersion: '0.2.0',
    adapterContracts: new Map([['@example/dummy-plugin', { hostApiRange: '^1.0.0', permissions: [], approved: true }]]),
    createLifecycleHooks: () => ({
      activate: () => { events.push('activate') },
      deactivate: () => { events.push('deactivate') },
      dispose: () => { events.push('dispose') }
    })
  })
  await host.discover()
  await host.registry.activate('@example/dummy-plugin')
  await host.registry.deactivate('@example/dummy-plugin')
  await host.registry.dispose('@example/dummy-plugin')
  assert.deepEqual(events, ['activate', 'deactivate', 'dispose'])
})
