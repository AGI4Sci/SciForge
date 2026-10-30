import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { DevelopmentExternalPluginService } from './development-external-plugins'

const io = vi.hoisted(() => ({ beforeWrite: undefined as undefined | (() => Promise<void>) }))
vi.mock('node:fs/promises', async (importOriginal) => {
  const real = await importOriginal<typeof import('node:fs/promises')>()
  return { ...real, writeFile: async (...args: Parameters<typeof real.writeFile>) => {
    if (String(args[0]).endsWith('development-external-state.json.tmp')) await io.beforeWrite?.()
    return real.writeFile(...args)
  } }
})

function deferred() {
  let resolve!: () => void
  const promise = new Promise<void>((done) => { resolve = done })
  return { promise, resolve }
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'dsh-state-'))
  for (const name of ['one', 'two']) {
    const directory = join(root, 'plugins', name)
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), JSON.stringify({ name, version: '1.0.0', type: 'module', exports: { '.': './main.js' }, dsh: { bundle: { patch: './patch.yml' } } }))
    await writeFile(join(directory, 'patch.yml'), '[]')
    await writeFile(join(directory, 'main.js'), 'export async function activate() {}')
  }
  const service = new DevelopmentExternalPluginService({ root: join(root, 'plugins'), userDataPath: join(root, 'data'), hostApiVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2',
    adapterContracts: new Map(['one', 'two'].map((packageName) => [packageName, { approved: true, permissions: [], hostApiRange: '^1.0.0',
      dshAuthorization: { packageName, packageVersion: '1.0.0', dshRuntimeVersion: '0.2.0-rc.2' } }])) })
  await service.initialize()
  const state = async () => JSON.parse(await readFile(join(root, 'data/extensions/development-external-state.json'), 'utf8'))
  const cleanup = async () => { io.beforeWrite = undefined; await service.dispose(); await rm(root, { recursive: true, force: true }) }
  return { service, state, cleanup }
}

it('serializes different stopped-plugin saves so an older snapshot cannot overwrite newer state', async () => {
  const f = await fixture()
  const entered = deferred()
  const release = deferred()
  let calls = 0
  let secondEntered = false
  io.beforeWrite = async () => {
    calls += 1
    if (calls === 1) { entered.resolve(); await release.promise } else secondEntered = true
  }
  try {
    const first = f.service.setDshConfig('one', { label: 'first' })
    await entered.promise
    const second = f.service.setDshConfig('two', { label: 'second' })
    const outcomes = Promise.allSettled([first, second])
    // Give an unqueued second write time to enter while the first is blocked.
    await new Promise((done) => setTimeout(done, 50))
    const concurrentWriteEntered = secondEntered
    release.resolve()
    expect((await outcomes).map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(concurrentWriteEntered).toBe(false)
    expect(calls).toBe(2)
    expect(await f.state()).toMatchObject({ dshConfigs: { one: { label: 'first' }, two: { label: 'second' } } })
  } finally { release.resolve(); await f.cleanup() }
})

it('retains desired configuration after a failed save and lets the next save retry current state', async () => {
  const f = await fixture()
  try {
    await f.service.setDshConfig('one', { label: 'durable' })
    io.beforeWrite = async () => { throw new Error('injected disk failure') }
    await expect(f.service.setDshConfig('one', { label: 'desired' })).rejects.toThrow('injected disk failure')
    expect(await f.state()).toMatchObject({ dshConfigs: { one: { label: 'durable' } } })
    io.beforeWrite = undefined
    await f.service.setDshConfig('two', { label: 'retry' })
    expect(await f.state()).toMatchObject({ dshConfigs: { one: { label: 'desired' }, two: { label: 'retry' } } })
  } finally { await f.cleanup() }
})

// These are additional interleaving regressions for the shared-writer fix, not
// independent RED cycles: the minimal queue already supplies their behavior.
it('concurrent different-plugin saves both fulfill using the real shared temporary file', async () => {
  const f = await fixture()
  try {
    const outcomes = await Promise.allSettled([
      f.service.setDshConfig('one', { label: 'first' }),
      f.service.setDshConfig('two', { label: 'second' })
    ])
    expect(outcomes.map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await f.state()).toMatchObject({ dshConfigs: { one: { label: 'first' }, two: { label: 'second' } } })
  } finally { await f.cleanup() }
})
it.each([true, false])('preserves configuration when an enabled=%s write interleaves', async (enabled) => {
  const f = await fixture()
  const entered = deferred()
  const release = deferred()
  try {
    if (!enabled) await f.service.setEnabled('two', true)
    let calls = 0
    io.beforeWrite = async () => {
      if (++calls === 1) { entered.resolve(); await release.promise }
    }
    const configuration = f.service.setDshConfig('one', { label: 'interleaved' })
    await entered.promise
    const lifecycle = f.service.setEnabled('two', enabled)
    const outcomes = Promise.allSettled([configuration, lifecycle])
    await new Promise((done) => setTimeout(done, 50))
    release.resolve()
    expect((await outcomes).map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await f.state()).toMatchObject({ enabled: enabled ? ['two'] : [], dshConfigs: { one: { label: 'interleaved' } } })
  } finally { release.resolve(); await f.cleanup() }
})

it('a queued save recovers from a preceding failed write without losing newer configuration', async () => {
  const f = await fixture()
  const entered = deferred()
  const release = deferred()
  try {
    let calls = 0
    io.beforeWrite = async () => {
      if (++calls === 1) { entered.resolve(); await release.promise; throw new Error('first write failed') }
    }
    const first = f.service.setDshConfig('one', { label: 'older' })
    const firstOutcome = first.catch((error: unknown) => error)
    await entered.promise
    const newer = f.service.setDshConfig('one', { label: 'newer' })
    const other = f.service.setDshConfig('two', { label: 'other' })
    const outcomes = Promise.allSettled([newer, other])
    release.resolve()
    expect(await firstOutcome).toMatchObject({ message: 'first write failed' })
    expect((await outcomes).map((result) => result.status)).toEqual(['fulfilled', 'fulfilled'])
    expect(await f.state()).toMatchObject({ dshConfigs: { one: { label: 'newer' }, two: { label: 'other' } } })
  } finally { release.resolve(); await f.cleanup() }
})
