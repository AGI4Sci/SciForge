import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import { PluginHost } from './discovery.js'
import { checkPluginCompatibility, checkPluginPermissions, parsePluginManifest, type PluginAdapterContract } from './manifest.js'

const raw = { name: 'ordinary-dsh-plugin', version: '1.1.1', dsh: { bundle: { patch: './patch.yml' } } }
const manifest = parsePluginManifest(raw)
const authorization = { packageName: raw.name, packageVersion: raw.version, dshRuntimeVersion: '0.2.0-rc.2' }
const contract = { hostApiRange: '^1.0.0', permissions: ['tools.compute'], approved: true, dshAuthorization: authorization }
const options = { dshRuntimeVersion: '0.2.0-rc.2', hostApiVersion: '1.0.0', adapter: contract }

test('host can authorize one exact native package/runtime version without fabricating engines', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-host-authorization-'))
  const directory = join(root, 'plugin')
  const events: string[] = []
  try {
    await mkdir(directory)
    await writeFile(join(directory, 'package.json'), JSON.stringify(raw))
    await writeFile(join(directory, 'patch.yml'), '[]')
    const host = new PluginHost({ root, hostApiVersion: options.hostApiVersion, dshRuntimeVersion: options.dshRuntimeVersion,
      adapterContracts: new Map([[raw.name, contract]]), allowedPermissionIds: new Set(['tools.compute']),
      createLifecycleHooks: () => ({ activate: () => { events.push('activate') }, dispose: () => { events.push('dispose') } }) })
    const [plugin] = await host.discover()
    assert.equal(plugin?.compatibility.compatible, true)
    assert.equal(plugin?.permissions.allowed, true)
    assert.equal(plugin?.manifest.engines, undefined)
    await host.registry.activate(raw.name)
    await host.registry.dispose(raw.name)
    assert.deepEqual(events, ['activate', 'dispose'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('a version-bound host authorization cannot approve another package, version, or runtime', () => {
  for (const changed of [
    { packageName: 'another-plugin' }, { packageVersion: '1.1.2' }, { dshRuntimeVersion: '0.2.0-rc.1' },
    { dshRuntimeVersion: '*' }, { dshRuntimeVersion: '^0.2.0' }
  ]) {
    assert.equal(checkPluginCompatibility(manifest, { ...options, adapter: { ...contract, dshAuthorization: { ...authorization, ...changed } } }).compatible, false)
  }
  assert.equal(checkPluginCompatibility(manifest, { ...options, dshRuntimeVersion: undefined }).compatible, false)
  assert.equal(checkPluginCompatibility(manifest, { ...options, adapter: { ...contract, approved: false } }).compatible, false)
  assert.equal(checkPluginCompatibility(manifest, { ...options, adapter: { ...contract, approved: undefined } }).compatible, false)
  assert.equal(checkPluginCompatibility(manifest, { ...options, adapter: { hostApiRange: contract.hostApiRange, permissions: [], approved: true } }).compatible, false)
})

test('explicit runtime authorization still requires compatible Host API and approved permissions', () => {
  assert.equal(checkPluginCompatibility(manifest, { ...options, hostApiVersion: '2.0.0' }).compatible, false)
  assert.equal(checkPluginPermissions(manifest, contract, new Set()).allowed, false)
  assert.equal(checkPluginPermissions(manifest, { ...contract, approved: false }, new Set(['tools.compute'])).allowed, false)
  assert.equal(checkPluginPermissions(manifest, contract, new Set(['tools.compute'])).allowed, true)
  const declaredIncompatible = parsePluginManifest({ ...raw, engines: { dsh: '^1.0.0' } })
  assert.equal(checkPluginCompatibility(declaredIncompatible, options).compatible, false)
})

test('host authorization rejects matching range tokens and remains version-bound when engines exist', () => {
  for (const runtime of ['*', '^0.2.0', 'latest', '0.2', '01.2.0', '0.2.0-01']) {
    assert.equal(checkPluginCompatibility(manifest, { ...options, dshRuntimeVersion: runtime,
      adapter: { ...contract, dshAuthorization: { ...authorization, dshRuntimeVersion: runtime } } }).compatible, false)
  }
  const declared = parsePluginManifest({ ...raw, engines: { dsh: '^0.2.0' } })
  assert.equal(checkPluginCompatibility(declared, { ...options,
    adapter: { ...contract, dshAuthorization: { ...authorization, packageVersion: '1.1.2' } } }).compatible, false)
  assert.equal(checkPluginCompatibility(declared, { ...options, adapter: { ...contract, approved: false } }).compatible, false)
  const invalidVersion = parsePluginManifest({ ...raw, version: '*' })
  assert.equal(checkPluginCompatibility(invalidVersion, { ...options,
    adapter: { ...contract, dshAuthorization: { ...authorization, packageVersion: '*' } } }).compatible, false)
})

test('unknown Host API range syntax is incompatible rather than silently compatible', () => {
  const invalid = { ...contract, hostApiRange: 'not-a-semver-range' }
  const result = checkPluginCompatibility(manifest, { ...options, adapter: invalid })
  assert.equal(result.compatible, false)
  assert.equal(result.hostApi.status, 'incompatible')
})

test('supported Host API range forms retain their existing semantics', () => {
  for (const hostApiRange of ['^1.0.0', '~1.0.0', '*', '>=1.0.0', '<=1.11.0', '>=1.0.0 <2.0.0', ' >0.9.0 <=1.11.0', ' =1.0.0']) {
    const result = checkPluginCompatibility(manifest, { ...options, adapter: { ...contract, hostApiRange } })
    assert.equal(result.compatible, true, hostApiRange)
  }
})

test('empty ranges and unknown mixed tokens cannot authorize a runtime', () => {
  for (const hostApiRange of ['', ' ', 'latest', '>=1.0.0 garbage', '^1.0.0 || garbage']) {
    assert.equal(checkPluginCompatibility(manifest, { ...options, adapter: { ...contract, hostApiRange } }).compatible, false, hostApiRange)
  }
})

test('invalid Host API ranges never register lifecycle activation hooks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-invalid-range-'))
  let activations = 0
  try {
    await mkdir(join(root, 'plugin'))
    await writeFile(join(root, 'plugin', 'package.json'), JSON.stringify(raw))
    await writeFile(join(root, 'plugin', 'patch.yml'), '[]')
    const host = new PluginHost({ root, hostApiVersion: options.hostApiVersion, dshRuntimeVersion: options.dshRuntimeVersion,
      adapterContracts: new Map([[raw.name, { ...contract, hostApiRange: 'not-a-semver-range' }]]),
      allowedPermissionIds: new Set(['tools.compute']), createLifecycleHooks: () => ({ activate: () => { activations++ } }) })
    const [plugin] = await host.discover()
    assert.equal(plugin?.compatibility.compatible, false)
    assert.equal(host.registry.get(raw.name), undefined)
    assert.equal(await host.registry.activate(raw.name), undefined)
    assert.equal(activations, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('wildcard and comparator ranges do not accept malformed actual versions', () => {
  for (const hostApiRange of ['*', '>=1.0.0']) {
    for (const hostApiVersion of ['not-a-version', '1.0.0junk']) {
      assert.equal(checkPluginCompatibility(manifest, { ...options, hostApiVersion, adapter: { ...contract, hostApiRange } }).compatible, false)
    }
  }
})

// Keep this assignability checked once the public SDK adds the host-owned field.
const publicContract: PluginAdapterContract = contract
void publicContract
