import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginHost } from '../packages/plugin-sdk/src/index.ts'

const root = resolve('test-fixtures/migration-plugins')

test('PR-1 discovers and runs four independent DSH migration adapters', async () => {
  const loaded = new Map()
  const host = new PluginHost({
    root,
    hostApiVersion: '1.1.0',
    dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map([
      ['@sciforge/migration-p1-unitverse', { hostApiRange: '^1.0.0', permissions: [], approved: true }],
      ['@sciforge/migration-p2-better-sidebar', { hostApiRange: '^1.0.0', permissions: [], approved: true }],
      ['@sciforge/migration-p3-mcp-bridge', { hostApiRange: '^1.0.0', permissions: [], approved: true }],
      ['@sciforge/migration-p4-agent-teams', { hostApiRange: '^1.0.0', permissions: [], approved: true }]
    ]),
    allowedPermissionIds: new Set(),
    createLifecycleHooks: (plugin) => ({
      activate: async () => {
        const entry = plugin.layout.mainEntry
        assert.ok(entry)
        const module = await import(pathToFileURL(resolve(plugin.directory, entry)).href)
        loaded.set(plugin.manifest.name, module)
        await module.activate?.()
      },
      deactivate: async () => {
        await loaded.get(plugin.manifest.name)?.deactivate?.()
      },
      dispose: async () => {
        await loaded.get(plugin.manifest.name)?.dispose?.()
      }
    })
  })

  const discovered = await host.discover()
  const migrationPlugins = discovered.filter(({ manifest }) => [
    '@sciforge/migration-p1-unitverse', '@sciforge/migration-p2-better-sidebar', '@sciforge/migration-p3-mcp-bridge', '@sciforge/migration-p4-agent-teams'
  ].includes(manifest.name))
  assert.deepEqual(migrationPlugins.map(({ manifest }) => manifest.name), [
    '@sciforge/migration-p1-unitverse', '@sciforge/migration-p2-better-sidebar', '@sciforge/migration-p3-mcp-bridge', '@sciforge/migration-p4-agent-teams'
  ])
  for (const plugin of migrationPlugins) {
    assert.equal(plugin.compatibility.compatible, true)
    assert.equal(plugin.permissions.allowed, true)
    const activated = await host.registry.activate(plugin.manifest.name)
    assert.equal(activated?.state, 'active')
    const result = await loaded.get(plugin.manifest.name).smoke()
    if (plugin.manifest.name.endsWith('unitverse')) assert.equal(result.result, 152.4)
    if (plugin.manifest.name.endsWith('better-sidebar')) assert.deepEqual(result.tabIds.slice(0, 4), ['explorer', 'changes', 'tasks', 'sidechat'])
    if (plugin.manifest.name.endsWith('mcp-bridge')) assert.deepEqual(result.discovered, ['fixture_echo', 'fixture_delayed_echo', 'fixture_bounded_output'])
    if (plugin.manifest.name.endsWith('agent-teams')) assert.deepEqual(result.tasks, ['completed', 'completed'])
    assert.equal((await host.registry.deactivate(plugin.manifest.name))?.state, 'enabled')
    assert.equal((await host.registry.dispose(plugin.manifest.name))?.state, 'disposed')
  }
})
