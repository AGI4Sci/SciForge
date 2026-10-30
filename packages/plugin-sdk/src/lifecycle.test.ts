import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePluginManifest } from './manifest.js'
import { PluginLifecycle, PluginLifecycleRegistry } from './lifecycle.js'

const manifest = parsePluginManifest({ name: '@example/dummy-plugin', version: '0.1.0', engines: { dsh: '^1.0.0' }, dsh: { bundle: { patch: './cordis.patch.yml' } } })

test('dummy plugin follows enable, activate, deactivate, dispose lifecycle', async () => {
  const events: string[] = []
  const lifecycle = new PluginLifecycle(manifest, {
    activate: () => { events.push('activate') },
    deactivate: () => { events.push('deactivate') },
    dispose: () => { events.push('dispose') }
  })
  assert.equal(lifecycle.snapshot.state, 'discovered')
  lifecycle.markVerified()
  await lifecycle.enable()
  await lifecycle.activate()
  assert.equal(lifecycle.snapshot.state, 'active')
  await lifecycle.deactivate()
  await lifecycle.dispose()
  await lifecycle.dispose()
  assert.deepEqual(events, ['activate', 'deactivate', 'dispose'])
  assert.equal(lifecycle.snapshot.state, 'disposed')
})

test('lifecycle exposes generation and idempotent unregister boundary', async () => {
  const events: string[] = []
  const lifecycle = new PluginLifecycle(manifest, {
    unregister: () => { events.push('unregister') },
    dispose: () => { events.push('dispose') }
  })
  lifecycle.markVerified()
  await lifecycle.activate()
  const generation = lifecycle.snapshot.generation
  assert.equal(generation, 1)
  assert.equal(lifecycle.isCurrentGeneration(generation), true)
  await lifecycle.unregister()
  await lifecycle.unregister()
  await lifecycle.dispose()
  assert.deepEqual(events, ['unregister', 'dispose'])
  assert.equal(lifecycle.isCurrentGeneration(generation), false)
})

test('host registry drives the same lifecycle used by extension management', async () => {
  const events: string[] = []
  const registry = new PluginLifecycleRegistry()
  const lifecycle = new PluginLifecycle(manifest, {
    activate: () => { events.push('activate') },
    deactivate: () => { events.push('deactivate') },
    dispose: () => { events.push('dispose') }
  })
  lifecycle.markVerified()
  registry.register(lifecycle)
  await registry.activate('@example/dummy-plugin')
  await registry.deactivate('@example/dummy-plugin')
  await registry.dispose('@example/dummy-plugin')
  assert.deepEqual(events, ['activate', 'deactivate', 'dispose'])
  assert.equal(registry.snapshots()[0]?.state, 'disposed')
})
