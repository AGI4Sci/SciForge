import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parsePluginManifest } from './manifest.js'
import {
  ExtensionHost,
  ExtensionHostError,
  type ExtensionModule
} from './extension-host.js'

function moduleOf(version: string, events: string[], fail = false): ExtensionModule {
  const manifest = parsePluginManifest({ name: '@example/extension-fixture', version, engines: { dsh: '^1.0.0' }, dsh: { bundle: { patch: './cordis.patch.yml' } } })
  return {
    manifest,
    activate: async (context) => {
      events.push(`activate:${version}`)
      context.register('fixture.value', version)
      if (fail) throw new Error('fixture activation failed')
    },
    deactivate: () => { events.push(`deactivate:${version}`) },
    unregister: () => { events.push(`unregister:${version}`) },
    dispose: () => { events.push(`dispose:${version}`) }
  }
}

test('extension host activates, replaces, and rejects stale contributions', async () => {
  const events: string[] = []
  const host = new ExtensionHost({ hostApiVersion: '1.3.0', dshRuntimeVersion: '1.0.0', adapterContract: { hostApiRange: '^1.0.0', permissions: [], approved: true } })
  const first = moduleOf('1.0.0', events)
  const firstSnapshot = await host.activate(first)
  assert.equal(firstSnapshot.generation, 1)
  const oldContribution = host.contribution<string>('@example/extension-fixture', 'fixture.value')!
  assert.equal(oldContribution.invoke(), '1.0.0')

  const secondSnapshot = await host.activate(moduleOf('2.0.0', events))
  assert.equal(secondSnapshot.generation, 2)
  assert.equal(secondSnapshot.state, 'active')
  assert.deepEqual(events, [
    'activate:1.0.0',
    'activate:2.0.0',
    'deactivate:1.0.0',
    'unregister:1.0.0',
    'dispose:1.0.0'
  ])
  assert.throws(() => oldContribution.invoke(), (error: unknown) =>
    error instanceof ExtensionHostError && error.code === 'stale_generation')
  assert.equal(host.contribution<string>('@example/extension-fixture', 'fixture.value')!.invoke(), '2.0.0')
})

test('failed replacement rolls back to the previous active instance', async () => {
  const events: string[] = []
  const host = new ExtensionHost({ hostApiVersion: '1.3.0', dshRuntimeVersion: '1.0.0', adapterContract: { hostApiRange: '^1.0.0', permissions: [], approved: true } })
  await host.activate(moduleOf('1.0.0', events))
  await assert.rejects(
    host.activate(moduleOf('3.0.0', events, true)),
    (error: unknown) => error instanceof ExtensionHostError && error.code === 'activation_failed'
  )
  assert.equal(host.snapshot('@example/extension-fixture')?.version, '1.0.0')
  assert.equal(host.snapshot('@example/extension-fixture')?.state, 'active')
  assert.equal(host.contribution<string>('@example/extension-fixture', 'fixture.value')!.invoke(), '1.0.0')
  assert.deepEqual(events, [
    'activate:1.0.0',
    'activate:3.0.0',
    'unregister:3.0.0',
    'dispose:3.0.0'
  ])
})

test('dispose unregisters contributions and rejects calls after deactivation', async () => {
  const events: string[] = []
  const host = new ExtensionHost({ hostApiVersion: '1.3.0', dshRuntimeVersion: '1.0.0', adapterContract: { hostApiRange: '^1.0.0', permissions: [], approved: true } })
  await host.activate(moduleOf('1.0.0', events))
  await host.deactivate('@example/extension-fixture')
  assert.throws(
    () => host.contribution<string>('@example/extension-fixture', 'fixture.value')!.invoke(),
    (error: unknown) => error instanceof ExtensionHostError && error.code === 'stale_generation'
  )
  await host.dispose('@example/extension-fixture')
  assert.equal(host.snapshot('@example/extension-fixture'), undefined)
  assert.deepEqual(events, [
    'activate:1.0.0',
    'deactivate:1.0.0',
    'unregister:1.0.0',
    'dispose:1.0.0'
  ])
})
