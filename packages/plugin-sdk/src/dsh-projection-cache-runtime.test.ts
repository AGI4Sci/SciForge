import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ProcessExtensionRuntime } from './process-extension-host.js'

async function filesUnder(root: string): Promise<string[]> {
  const result: string[] = []
  for (const name of await readdir(root, { withFileTypes: true })) {
    const path = join(root, name.name)
    if (name.isDirectory()) result.push(...await filesUnder(path))
    else result.push(path)
  }
  return result
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-projection-cache-'))
  const entryPath = join(root, 'projection-cache.mjs')
  await writeFile(entryPath, "export { default } from '@deepseek-ai/dsh-session-projection-cache'\n")
  return { root, entryPath }
}

async function observedFixture() {
  const f = await fixture()
  await writeFile(f.entryPath, `
import Cache from '@deepseek-ai/dsh-session-projection-cache'
import { writeFile } from 'node:fs/promises'
let sessions
const disposed = []
export default class extends Cache {
  constructor(ctx, config) {
    super(ctx, config)
    sessions = ctx.sessions
    ctx.on('session/disposed', (session) => disposed.push(session.id))
  }
}
export function discover() {
  return { live: ['failed-write', 'live-one', 'live-two'].filter((id) => sessions.get(id)), disposed }
}
export async function deactivate() {
  await writeFile(${JSON.stringify(join(f.root, 'teardown.json'))}, JSON.stringify(discover()))
}
`)
  return f
}

test('failed projection checkpoint detaches the real session and permits same-id retry', async () => {
  const f = await observedFixture()
  const runtime = new ProcessExtensionRuntime({ pluginId: 'projection-cache', packageName: 'projection-cache', version: '0.2.0-rc.2', generation: 1, entryPath: f.entryPath, dshStorage: { profileRoot: f.root, packageName: 'projection-cache' }, dshConfig: { writeEveryEvents: 100, writeIntervalMs: 60000 } })
  const tableRoot = join(f.root, 'extensions', 'dsh-storage', 'projection-cache', 'session_projcache', 'sessions')
  try {
    await runtime.activate()
    // A real backend I/O failure, not a replacement Session or cache service.
    await mkdir(join(tableRoot, 'failed-write.json'), { recursive: true })
    const input = { id: 'failed-write', createdAt: 1700000000010, events: 1, dispose: true }
    await assert.rejects(runtime.syntheticSession(input), /EISDIR|directory|rename/i)
    const afterFailure = await runtime.managedDiscover()
    await rm(join(tableRoot, 'failed-write.json'), { recursive: true, force: true })
    const retry = await runtime.syntheticSession(input).catch((error: Error) => ({ error: error.message }))
    assert.deepEqual({ afterFailure, retry }, {
      afterFailure: { live: [], disposed: ['failed-write'] },
      retry: { id: 'failed-write', eventCount: 1, persisted: true, disposed: true }
    })
  } finally {
    await runtime.dispose()
    await rm(f.root, { recursive: true, force: true })
  }
})

test('runner teardown detaches every retained synthetic session before the cache consumer closes', async () => {
  const f = await observedFixture()
  const runtime = new ProcessExtensionRuntime({ pluginId: 'projection-cache', packageName: 'projection-cache', version: '0.2.0-rc.2', generation: 1, entryPath: f.entryPath, dshStorage: { profileRoot: f.root, packageName: 'projection-cache' }, dshConfig: { writeEveryEvents: 100, writeIntervalMs: 60000 } })
  try {
    await runtime.activate()
    await runtime.syntheticSession({ id: 'live-one', createdAt: 1700000000020, events: 1 })
    await runtime.syntheticSession({ id: 'live-two', createdAt: 1700000000021, events: 1 })
    assert.deepEqual(await runtime.managedDiscover(), { live: ['live-one', 'live-two'], disposed: [] })
    await runtime.deactivate()
    assert.deepEqual(JSON.parse(await readFile(join(f.root, 'teardown.json'), 'utf8')), {
      live: [], disposed: ['live-one', 'live-two']
    })
  } finally {
    await runtime.dispose()
    await rm(f.root, { recursive: true, force: true })
  }
})

test('projection cache rejects missing and non-positive required configuration', async () => {
  const f = await fixture()
  try {
    for (const dshConfig of [{}, { writeEveryEvents: 0, writeIntervalMs: 1 }, { writeEveryEvents: 1, writeIntervalMs: 0 }]) {
      const runtime = new ProcessExtensionRuntime({ pluginId: 'projection-cache', packageName: 'projection-cache', version: '0.2.0-rc.2', generation: 1, entryPath: f.entryPath, dshStorage: { profileRoot: f.root, packageName: 'projection-cache' }, dshConfig })
      try { await assert.rejects(runtime.activate(), /writeEveryEvents|writeIntervalMs|required|positive/i) } finally { await runtime.dispose() }
    }
  } finally { await rm(f.root, { recursive: true, force: true }) }
})

test('projection cache persists across restart, isolates roots, and drains a disposed synthetic session', async () => {
  const f = await fixture()
  const options = { pluginId: 'projection-cache', packageName: 'projection-cache', version: '0.2.0-rc.2', entryPath: f.entryPath, dshStorage: { profileRoot: f.root, packageName: 'projection-cache' }, dshConfig: { writeEveryEvents: 100, writeIntervalMs: 1000 } }
  try {
    const first = new ProcessExtensionRuntime({ ...options, generation: 1 })
    await first.activate()
    const created = await first.syntheticSession({ id: 'restartable', createdAt: 1700000000001, events: 1, dispose: true }) as { disposed: boolean }
    assert.equal(created.disposed, true)
    await first.dispose()
    assert.ok((await filesUnder(join(f.root, 'extensions'))).some((path) => path.endsWith('.json')))

    const second = new ProcessExtensionRuntime({ ...options, generation: 2 })
    await second.activate()
    const restored = await second.syntheticSession({ id: 'restartable-2', createdAt: 1700000000002, events: 1, dispose: true }) as { persisted: boolean }
    assert.equal(restored.persisted, true)
    await second.dispose()

    const other = await fixture()
    try {
      const isolated = new ProcessExtensionRuntime({ ...options, generation: 3, entryPath: other.entryPath, dshStorage: { profileRoot: other.root, packageName: 'projection-cache' } })
      await isolated.activate()
      await isolated.syntheticSession({ id: 'other-root', createdAt: 1700000000003, events: 1, dispose: true })
      await isolated.dispose()
      const firstFiles = await filesUnder(join(f.root, 'extensions'))
      const otherFiles = await filesUnder(join(other.root, 'extensions'))
      assert.notDeepEqual(firstFiles.map((path) => path.replace(f.root, '')), otherFiles.map((path) => path.replace(other.root, '')))
    } finally { await rm(other.root, { recursive: true, force: true }) }
  } finally { await rm(f.root, { recursive: true, force: true }) }
})
