import assert from 'node:assert/strict'
import { test } from 'node:test'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PluginHost } from './discovery.js'
import { checkPluginCompatibility, hostApiRangeSchema, parsePluginManifest, pluginExactVersionSchema } from './manifest.js'

const raw = { name: 'semver-plugin', version: '1.0.0', dsh: { bundle: { patch: './patch.yml' } } }
const manifest = parsePluginManifest(raw)
const authorization = { packageName: raw.name, packageVersion: raw.version, dshRuntimeVersion: '0.2.0-rc.2' }
const adapter = { hostApiRange: '^1.0.0', permissions: [], approved: true, dshAuthorization: authorization }
const options = { hostApiVersion: '1.0.0', dshRuntimeVersion: authorization.dshRuntimeVersion, adapter }
const invalidRanges = ['', ' ', 'latest', '>=1.0.0 garbage', '^1.0.0 || garbage', '1.0.0-01', '^01.0.0']
const invalidVersions = ['1.0', '01.0.0', '1.0.0-01', '9007199254740992.0.0', '1.0.0junk', '*']

test('invalid npm ranges are rejected by both the schema and compatibility checker', () => {
  for (const hostApiRange of invalidRanges) {
    assert.equal(hostApiRangeSchema.safeParse(hostApiRange).success, false, hostApiRange)
    assert.equal(checkPluginCompatibility(manifest, { ...options, adapter: { ...adapter, hostApiRange } }).compatible, false, hostApiRange)
  }
})

test('DSH engines use standard ranges and default prerelease rules without broadening exact approval', () => {
  for (const [range, actual, expected] of [
    ['^0.2.0', '0.3.0', false], ['^0.0.3', '0.0.4', false],
    ['*', '0.2.0-rc.2', false], ['^0.2.0', '0.2.0-rc.2', false],
    ['>=0.2.0-rc.1 <0.3.0', '0.2.0-rc.2', true],
    ['>=0.2.0-rc.3 <0.3.0', '0.2.0-rc.2', false],
    ['>=0.2.0-rc.1 <0.3.0', '0.2.1-rc.2', false],
    ['0.2.x || 1.x', '0.2.9', true], ['0.2.0 - 0.2.9', '0.2.9', true]
  ] as const) {
    const declared = parsePluginManifest({ ...raw, engines: { dsh: range } })
    const result = checkPluginCompatibility(declared, { ...options, dshRuntimeVersion: actual,
      adapter: { ...adapter, dshAuthorization: { ...authorization, dshRuntimeVersion: actual } } })
    assert.equal(result.compatible, expected, `${range}: ${actual}`)
  }
  for (const dsh of invalidRanges.filter(Boolean)) {
    assert.equal(checkPluginCompatibility(parsePluginManifest({ ...raw, engines: { dsh } }), options).compatible, false, dsh)
  }
  for (const actual of invalidVersions) {
    const declared = parsePluginManifest({ ...raw, engines: { dsh: '*' } })
    assert.equal(checkPluginCompatibility(declared, { ...options, dshRuntimeVersion: actual,
      adapter: { hostApiRange: '^1.0.0', permissions: [], approved: true } }).compatible, false, actual)
  }
  for (const actual of ['^0.2.0', '*', 'v0.2.0', ' 0.2.0', '0.2.0 ', '0.2.0-01', '9007199254740992.0.0']) {
    assert.equal(checkPluginCompatibility(manifest, { ...options, dshRuntimeVersion: actual,
      adapter: { ...adapter, dshAuthorization: { ...authorization, dshRuntimeVersion: actual } } }).compatible, false, actual)
  }
  for (const version of [...invalidVersions, '^0.2.0', 'v0.2.0', ' 0.2.0', '0.2.0 ']) {
    assert.equal(pluginExactVersionSchema.safeParse(version).success, false, version)
  }
  assert.equal(pluginExactVersionSchema.parse('1.0.0+build.01'), '1.0.0+build.01')
  assert.equal(checkPluginCompatibility(manifest, { ...options, dshRuntimeVersion: '0.2.0-rc.2+build.2',
    adapter: { ...adapter, dshAuthorization: { ...authorization, dshRuntimeVersion: '0.2.0-rc.2+build.1' } } }).compatible, false)
  assert.equal(checkPluginCompatibility(manifest, { ...options, dshRuntimeVersion: '0.2.0-rc.3' }).compatible, false)
  assert.equal(checkPluginCompatibility(manifest, options).compatible, true)
})

test('public discovery never constructs or activates lifecycle hooks for invalid or incompatible versions', async () => {
  const root = await mkdtemp(join(tmpdir(), 'semver-discovery-'))
  let hookFactories = 0
  let activations = 0
  try {
    await mkdir(join(root, 'plugin'))
    await writeFile(join(root, 'plugin', 'patch.yml'), '[]')
    const cases = [
      ...invalidRanges.map((hostApiRange) => ({ raw, options: { ...options, adapter: { ...adapter, hostApiRange } } })),
      ...invalidVersions.map((hostApiVersion) => ({ raw, options: { ...options, hostApiVersion, adapter: { ...adapter, hostApiRange: '*' } } })),
      ...invalidVersions.map((dshRuntimeVersion) => ({ raw: { ...raw, engines: { dsh: '*' } }, options: { ...options, dshRuntimeVersion, adapter: { hostApiRange: '^1.0.0', permissions: [], approved: true } } })),
      { raw, options: { ...options, hostApiVersion: '0.3.0', adapter: { ...adapter, hostApiRange: '^0.2.0' } } },
      { raw, options: { ...options, hostApiVersion: '1.0.0-rc.2' } },
      { raw: { ...raw, engines: { dsh: '^0.2.0' } }, options },
      { raw: { ...raw, engines: { dsh: 'garbage' } }, options }
    ]
    for (const item of cases) {
      await writeFile(join(root, 'plugin', 'package.json'), JSON.stringify(item.raw))
      const host = new PluginHost({ root, hostApiVersion: item.options.hostApiVersion, dshRuntimeVersion: item.options.dshRuntimeVersion,
        adapterContracts: new Map([[raw.name, item.options.adapter]]),
        createLifecycleHooks: () => { hookFactories++; return { activate: () => { activations++ } } } })
      const [plugin] = await host.discover()
      assert.equal(plugin?.compatibility.compatible, false, JSON.stringify(item))
      assert.equal(host.registry.get(raw.name), undefined)
      assert.equal(await host.registry.activate(raw.name), undefined)
    }
    assert.equal(hookFactories, 0)
    assert.equal(activations, 0)
  } finally { await rm(root, { recursive: true, force: true }) }
})

test('actual versions must be valid complete semver, even with wildcard ranges', () => {
  for (const hostApiVersion of invalidVersions) {
    assert.equal(checkPluginCompatibility(manifest, { ...options, hostApiVersion, adapter: { ...adapter, hostApiRange: '*' } }).compatible, false, hostApiVersion)
  }
})

test('caret zero boundaries and npm default prerelease exclusion are respected', () => {
  for (const [hostApiRange, hostApiVersion, expected] of [
    ['^0.2.0', '0.3.0', false], ['^0.0.3', '0.0.4', false],
    ['^0.2.0', '0.2.9', true], ['^0.0.3', '0.0.3', true],
    ['*', '1.0.0-rc.2', false], ['^1.0.0', '1.0.0-rc.2', false],
    ['>=1.0.0-rc.1 <2.0.0', '1.0.0-rc.2', true],
    ['>=1.0.0-rc.1 <2.0.0', '1.1.0-rc.2', false],
    ['>=1.0.0-rc.3 <2.0.0', '1.0.0-rc.2', false],
    ['^1.0.0', '1.0.0+build.2', true]
  ] as const) {
    assert.equal(checkPluginCompatibility(manifest, { ...options, hostApiVersion, adapter: { ...adapter, hostApiRange } }).compatible, expected, `${hostApiRange}: ${hostApiVersion}`)
  }
})

test('schema and compatibility accept standard npm range syntax', () => {
  for (const hostApiRange of ['^1.0.0 || ^2.0.0', '1.0.0 - 1.9.9', '1.x', '1.0.*', '>= 1.0.0 < 2.0.0', '1', '1.0', '>=1.0.0-rc.1 <2.0.0']) {
    assert.equal(hostApiRangeSchema.safeParse(hostApiRange).success, true, hostApiRange)
    assert.equal(checkPluginCompatibility(manifest, { ...options, adapter: { ...adapter, hostApiRange } }).compatible, true, hostApiRange)
  }
})
