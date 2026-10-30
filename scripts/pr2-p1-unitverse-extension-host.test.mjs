import assert from 'node:assert/strict'
import { test } from 'node:test'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { PluginHost } from '../packages/plugin-sdk/src/index.ts'

const root = resolve('test-fixtures/migration-plugins')

test('PR-2 P1 unitverse is discovered and can be disabled/re-enabled without composition changes', async () => {
  const loaded = new Map()
  const host = new PluginHost({
    root,
    hostApiVersion: '1.1.0',
    dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map([['@sciforge/migration-p1-unitverse', { hostApiRange: '^1.0.0', permissions: [], approved: true }]]),
    allowedPermissionIds: new Set(),
    createLifecycleHooks: (plugin) => ({
      activate: async () => {
        const entry = plugin.layout.mainEntry
        assert.ok(entry)
        const module = await import(pathToFileURL(resolve(plugin.directory, entry)).href)
        loaded.set(plugin.manifest.name, module)
        await module.activate?.()
      },
      deactivate: async () => loaded.get(plugin.manifest.name)?.deactivate?.(),
      dispose: async () => loaded.get(plugin.manifest.name)?.dispose?.()
    })
  })

  const discovered = await host.discover()
  const plugin = discovered.find(({ manifest }) => manifest.name.endsWith('unitverse'))
  assert.ok(plugin, 'unitverse manifest must be discovered from the independent directory')
  assert.equal(plugin.compatibility.compatible, true)
  assert.equal(plugin.permissions.allowed, true)

  const packageName = plugin.manifest.name
  const lifecycle = host.registry.get(packageName)
  assert.ok(lifecycle)
  assert.equal((await lifecycle.activate()).state, 'active')
  assert.equal(lifecycle.snapshot.generation, 1)
  assert.equal(loaded.get(packageName).smoke().result, 152.4)

  assert.equal((await lifecycle.disable()).state, 'disabled')
  assert.throws(() => loaded.get(packageName).smoke(), /not active/)

  assert.equal((await lifecycle.activate()).state, 'active')
  assert.equal(lifecycle.snapshot.generation, 2)
  assert.equal(loaded.get(packageName).smoke().result, 152.4)
  assert.equal((await lifecycle.dispose()).state, 'disposed')
})
