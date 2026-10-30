import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  OwnedRegistry,
  RendererContributionRegistry,
  ManagedRuntimeRegistry,
  WorkflowLifecycleRegistry,
} from './contribution-registries.js'
import { ContributionHost } from './contribution-host.js'

test('stale disposer cannot remove a replacement after plugin unregister', () => {
  const registry = new OwnedRegistry<{ pluginId: string; id: string; generation: number }>()
  const disposeOld = registry.register({ pluginId: 'p', id: 'same', generation: 1 })
  registry.unregisterPlugin('p')
  const replacement = { pluginId: 'p', id: 'same', generation: 2 }
  const disposeNew = registry.register(replacement)

  disposeOld()
  assert.deepEqual(registry.list('p'), [replacement])
  disposeNew()
  assert.deepEqual(registry.list(), [])
})

test('duplicate registration is rejected without changing the current owner', () => {
  const registry = new OwnedRegistry<{ pluginId: string; id: string; generation: number }>()
  const original = { pluginId: 'p', id: 'same', generation: 1 }
  const dispose = registry.register(original)
  assert.throws(() => registry.register(original), /already registered/)
  assert.throws(() => registry.register({ ...original, generation: 2 }), /already registered/)
  assert.deepEqual(registry.list(), [original])
  dispose()
  const replacement = { ...original, generation: 2 }
  registry.register(replacement)
  dispose()
  assert.deepEqual(registry.list(), [replacement])
})

test('same contribution id remains isolated between plugin owners', () => {
  const registry = new OwnedRegistry<{ pluginId: string; id: string; generation: number }>()
  const first = { pluginId: 'p', id: 'same', generation: 1 }
  const peer = { pluginId: 'q', id: 'same', generation: 1 }
  const disposeOld = registry.register(first)
  const disposePeer = registry.register(peer)
  registry.unregisterPlugin('p')
  const replacement = { ...first, generation: 2 }
  const disposeNew = registry.register(replacement)
  disposeOld()
  assert.deepEqual(registry.list('p'), [replacement])
  assert.deepEqual(registry.list('q'), [peer])
  assert.equal(Object.isFrozen(registry.list()), true)
  disposeNew()
  assert.deepEqual(registry.list(), [peer])
  disposePeer()
  assert.deepEqual(registry.list(), [])
})

for (const [kind, registry] of [
  ['renderer', new RendererContributionRegistry()],
  ['managed-runtime', new ManagedRuntimeRegistry()],
  ['workflow', new WorkflowLifecycleRegistry()],
] as const) {
  test(`${kind} cleanup through ContributionHost cannot remove a replacement registration`, async () => {
    const host = new ContributionHost()
    let entered!: () => void
    let release!: () => void
    const started = new Promise<void>((resolve) => { entered = resolve })
    const barrier = new Promise<void>((resolve) => { release = resolve })
    const old = {
      pluginId: 'p', id: 'same', generation: 1,
      kind: 'panel' as const, title: 'panel', open: () => undefined,
      discover: () => undefined, invoke: async () => undefined,
      start: async () => undefined, status: async () => undefined,
      advance: async () => undefined, cancel: async () => undefined,
      dispose: async () => undefined,
    }
    const disposeOld = registry.register(old)
    host.register({
      pluginId: old.pluginId, id: old.id, generation: old.generation, kind, value: old,
      unregister: async () => { entered(); await barrier; disposeOld() },
    })
    const cleaning = host.unregisterPlugin('p', 1)
    await started
    try {
      registry.unregisterPlugin('p')
      const replacement = { ...old, generation: 2 }
      const disposeNew = registry.register(replacement)
      host.register({
        pluginId: 'p', id: 'same', generation: 2, kind, value: replacement,
        unregister: disposeNew,
      })
      release()
      await cleaning
      assert.deepEqual(registry.list('p'), [replacement])
      assert.equal(host.has('p', kind, 'same', 2), true)
      await host.unregisterPlugin('p', 1)
      assert.deepEqual(registry.list('p'), [replacement])
      await host.unregisterPlugin('p', 2)
      await host.unregisterPlugin('p', 2)
      disposeOld()
      assert.deepEqual(registry.list(), [])
      assert.deepEqual(host.list(), [])
    } finally {
      release()
      await cleaning
    }
  })
}

test('each registration owns its disposer even when the same item is registered again', () => {
  const registry = new OwnedRegistry<{ pluginId: string; id: string; generation: number }>()
  const item = { pluginId: 'p', id: 'same', generation: 1 }
  const disposeOld = registry.register(item)
  registry.unregisterPlugin('p')
  registry.unregisterPlugin('p')
  const disposeNew = registry.register(item)
  disposeOld()
  disposeOld()
  assert.deepEqual(registry.list(), [item])
  disposeNew()
  disposeNew()
  assert.deepEqual(registry.list(), [])
})
