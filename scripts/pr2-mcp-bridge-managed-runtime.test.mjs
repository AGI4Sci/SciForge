import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { test } from 'node:test'
import { PluginHost } from '../packages/plugin-sdk/src/index.ts'

const root = resolve('test-fixtures/migration-plugins')
const packageName = '@sciforge/migration-p3-mcp-bridge'
const packageDirectory = resolve('test-fixtures/migration-plugins/p3-mcp-bridge')

async function makeHost(loaded) {
  return new PluginHost({
    root,
    hostApiVersion: '1.1.0',
    dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map([['@sciforge/migration-p3-mcp-bridge', { hostApiRange: '^1.0.0', permissions: [], approved: true }]]),
    allowedPermissionIds: new Set(),
    createLifecycleHooks: (plugin) => ({
      activate: async () => {
        const entry = plugin.layout.mainEntry
        assert.ok(entry)
        const module = await import(pathToFileURL(resolve(plugin.directory, entry)).href)
        loaded.set(plugin.manifest.name, module)
        await module.activate?.()
      },
      deactivate: async () => { await loaded.get(plugin.manifest.name)?.deactivate?.() },
      dispose: async () => { await loaded.get(plugin.manifest.name)?.dispose?.() }
    })
  })
}

test('P3 managed runtime fixture discovers, invokes, bounds, cancels, times out, and disposes', async () => {
  const loaded = new Map()
  const host = await makeHost(loaded)
  const discovered = await host.discover()
  const plugin = discovered.find(({ manifest }) => manifest.name === packageName)
  assert.ok(plugin?.compatibility.compatible)
  assert.ok(plugin?.permissions.allowed)

  await host.registry.activate(packageName)
  const runtime = loaded.get(packageName)
  assert.deepEqual(runtime.discover(), ['fixture_echo', 'fixture_delayed_echo', 'fixture_bounded_output'])
  assert.deepEqual(await runtime.invoke('fixture_echo', { message: 'managed-ok' }), { text: 'managed-ok' })

  const bounded = await runtime.invoke('fixture_bounded_output', { requestedLength: 100_000 })
  assert.equal(bounded.returnedLength, 4_096)
  assert.equal(bounded.truncated, true)

  const timeout = runtime.invoke('fixture_delayed_echo', { message: 'late', delayMs: 1_000 }, { timeoutMs: 5 })
  await assert.rejects(timeout, /timeout/)

  const controller = new AbortController()
  const cancelled = runtime.invoke('fixture_delayed_echo', { message: 'cancel', delayMs: 1_000 }, { signal: controller.signal, timeoutMs: 2_000 })
  controller.abort()
  await assert.rejects(cancelled, /aborted/)

  await host.registry.dispose(packageName)
  await assert.rejects(runtime.invoke('fixture_echo', { message: 'after-dispose' }), /not active/)
})

test('P3 fixture is network-free and does not expose arbitrary process inputs', async () => {
  const source = await readFile(resolve(packageDirectory, '../../../scripts/build-migration-fixtures.mjs'), 'utf8')
  const p3Block = source.slice(source.indexOf("directory: 'p3-mcp-bridge'"), source.indexOf("directory: 'p4-agent-teams'"))
  assert.doesNotMatch(p3Block, /\b(?:fetch|https?:|node:net|child_process|spawn|exec|npx|mcp-remote)\b/u)
  assert.match(p3Block, /cancellableFixtureDelay/)
  assert.match(p3Block, /boundedFixtureText/)
  assert.doesNotMatch(p3Block, /process\.env|process\.cwd|cwd|command|url|env/u)
})
