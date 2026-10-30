import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ProcessExtensionHost } from './process-extension-host.js'

const alive = (pid: number) => {
  assert.ok(Number.isSafeInteger(pid) && pid > 0, 'liveness checks require an exact positive child PID')
  try { process.kill(pid, 0); return true } catch { return false }
}
async function exited(pid: number) {
  for (let i = 0; i < 100 && alive(pid); i++) await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(alive(pid), false, `child ${pid} must exit`)
}

const storageSource = `
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import { z } from 'zod'
export const inject = ['storage', 'storageDomain']
export async function apply(ctx) {
  const domain = await ctx.storage.domain.open(defineDomain({name:'same_medium',version:1,global:{schema:z.number(),initial:0},tables:{}}))
  const value = domain.global.get()
  await new Promise(resolve => setTimeout(resolve, 100))
  await domain.global.set(value + 1)
  ctx.effect(() => () => domain.close())
}
`

test('same-host concurrent prepare owns only one private-storage candidate', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-concurrent-prepare-'))
  const entryPath = join(root, 'main.mjs')
  await writeFile(entryPath, storageSource)
  const host = new ProcessExtensionHost({resolveDshStorage: () => ({profileRoot:root,packageName:'storage-test'})})
  const options = {pluginId:'storage-test',packageName:'storage-test',version:'1.0.0',entryPath}
  const pids: number[] = []
  try {
    const results = await Promise.allSettled([host.prepare(options), host.prepare(options)])
    for (const result of results) if (result.status === 'fulfilled') pids.push(result.value.pid!)
    assert.equal(results.filter(result => result.status === 'fulfilled').length, 1)
    assert.equal(results.filter(result => result.status === 'rejected').length, 1)
    assert.equal(host.pending('storage-test')?.snapshot.pid, pids[0])
    const medium = JSON.parse(await readFile(join(root,'extensions','dsh-storage','storage-test','same_medium.json'),'utf8'))
    assert.equal(medium.global, 1)
    await host.disposeAll()
    for (const pid of pids) await exited(pid)
    assert.equal(host.pending('storage-test'), undefined)
  } finally {
    await host.disposeAll().catch(() => undefined)
    for (const pid of pids) { if (alive(pid)) process.kill(pid, 'SIGTERM'); await exited(pid) }
    await rm(root, {recursive:true,force:true})
  }
})

async function waitForFile(path: string) {
  for (let i = 0; i < 200; i++) {
    const value = await readFile(path, 'utf8').catch(() => undefined)
    // writeFile publishes an empty file before its contents: never interpret
    // that transient state as PID 0 (which addresses the entire process group).
    if (value !== undefined && value.length > 0) return value
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  throw new Error(`Timed out waiting for ${path}`)
}

for (const packageName of ['-ordinary-plugin', '@-scope/-plugin']) {
  test(`private storage persists and restarts for legal npm identity ${packageName}`, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-legal-identity-'))
    const entryPath = join(root, 'main.mjs')
    await writeFile(entryPath, storageSource)
    const host = new ProcessExtensionHost({resolveDshStorage: name => ({profileRoot:root,packageName:name})})
    const options = {pluginId:packageName,packageName,version:'1.0.0',entryPath}
    const pids: number[] = []
    try {
      for (const expected of [1, 2]) {
        pids.push((await host.replace(options)).pid!)
        await host.disposeAll()
        await exited(pids.at(-1)!)
        const medium = JSON.parse(await readFile(join(root,'extensions','dsh-storage',encodeURIComponent(packageName),'same_medium.json'),'utf8'))
        assert.equal(medium.global, expected)
      }
    } finally {
      await host.disposeAll().catch(() => undefined)
      for (const pid of pids) { if (alive(pid)) process.kill(pid, 'SIGTERM'); await exited(pid) }
      await rm(root, {recursive:true,force:true})
    }
  })
}

for (const cleanup of ['disposeAll', 'rollbackPrepared'] as const) {
test(`same-package prepare stays excluded while a prepared storage runtime drains via ${cleanup}`, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-draining-prepare-'))
  const entryPath = join(root, 'main.mjs')
  const marker = join(root, 'draining')
  const release = join(root, 'release')
  await writeFile(entryPath, `import { writeFile, access } from 'node:fs/promises'\n` + storageSource.replace(
    'ctx.effect(() => () => domain.close())',
    `ctx.effect(() => async () => {
      await writeFile(${JSON.stringify(marker)}, String(process.pid))
      while (!await access(${JSON.stringify(release)}).then(() => true, () => false)) await new Promise(r => setTimeout(r, 10))
      await domain.close()
    })`))
  const host = new ProcessExtensionHost({resolveDshStorage: () => ({profileRoot:root,packageName:'storage-test'})})
  const options = {pluginId:'storage-test',packageName:'storage-test',version:'1.0.0',entryPath}
  const pids: number[] = []
  let disposing: Promise<unknown> | undefined
  try {
    pids.push((await host.prepare(options)).pid!)
    disposing = cleanup === 'disposeAll' ? host.disposeAll() : host.rollbackPrepared('storage-test')
    await waitForFile(marker)
    const outcome = await host.prepare(options).then(value => ({value,error:undefined}), error => ({value:undefined,error}))
    if (outcome.value) pids.push(outcome.value.pid!)
    assert.ok(outcome.error, 'drain must retain package ownership until cleanup completes')
    await writeFile(release, '')
    await disposing
    for (const pid of pids) await exited(pid)
    pids.push((await host.prepare(options)).pid!)
    await host.disposeAll()
    await exited(pids.at(-1)!)
  } finally {
    await writeFile(release, '')
    await disposing?.catch(() => undefined)
    await host.disposeAll().catch(() => undefined)
    for (const pid of pids) { if (alive(pid)) process.kill(pid, 'SIGTERM'); await exited(pid) }
    await rm(root, {recursive:true,force:true})
  }
})

}

test('activation failure releases package ownership and permits storage retry', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-prepare-retry-'))
  const entryPath = join(root, 'main.mjs')
  const marker = join(root, 'failed-pid')
  await writeFile(entryPath, `import { writeFile } from 'node:fs/promises'\n` + storageSource.replace(
    'const value = domain.global.get()',
    `await writeFile(${JSON.stringify(marker)}, String(process.pid)); throw new Error('activation failed')`))
  const host = new ProcessExtensionHost({resolveDshStorage: name => ({profileRoot:root,packageName:name})})
  const options = {pluginId:'storage-test',packageName:'storage-test',version:'1.0.0',entryPath}
  const pids: number[] = []
  try {
    await assert.rejects(host.prepare(options), /activation failed/)
    pids.push(Number(await waitForFile(marker)))
    await exited(pids[0])
    assert.equal(host.pending('storage-test'), undefined)
    await writeFile(entryPath, storageSource)
    const retry = await host.prepare(options)
    pids.push(retry.pid!)
    assert.equal(retry.generation, 2)
    assert.equal(retry.state, 'active')
    await host.disposeAll()
    await exited(retry.pid!)
  } finally {
    await host.disposeAll().catch(() => undefined)
    for (const pid of pids) { if (alive(pid)) process.kill(pid, 'SIGTERM'); await exited(pid) }
    await rm(root, {recursive:true,force:true})
  }
})

test('different packages can activate concurrently without a global prepare lock', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-prepare-parallel-'))
  const release = join(root, 'release')
  const host = new ProcessExtensionHost({resolveDshStorage: name => ({profileRoot:root,packageName:name})})
  const starts: Promise<unknown>[] = []
  const pids: number[] = []
  try {
    for (const packageName of ['first-plugin', 'second-plugin']) {
      const entryPath = join(root, `${packageName}.mjs`)
      const marker = join(root, packageName)
      await writeFile(entryPath, `
import { writeFile, access } from 'node:fs/promises'
export async function apply() {
  await writeFile(${JSON.stringify(marker)}, String(process.pid))
  while (!await access(${JSON.stringify(release)}).then(() => true, () => false)) await new Promise(r => setTimeout(r, 10))
}
`)
      starts.push(host.prepare({pluginId:packageName,packageName,version:'1.0.0',entryPath}))
    }
    // Both children must enter apply before either is allowed to complete.
    for (const name of ['first-plugin', 'second-plugin']) pids.push(Number(await waitForFile(join(root,name))))
    assert.notEqual(pids[0], pids[1])
    await writeFile(release, '')
    await Promise.all(starts)
    assert.equal(host.pending('first-plugin')?.snapshot.state, 'active')
    assert.equal(host.pending('second-plugin')?.snapshot.state, 'active')
    await host.disposeAll()
    for (const pid of pids) await exited(pid)
  } finally {
    await writeFile(release, '')
    await Promise.allSettled(starts)
    await host.disposeAll().catch(() => undefined)
    for (const pid of pids) { if (alive(pid)) process.kill(pid, 'SIGTERM'); await exited(pid) }
    await rm(root, {recursive:true,force:true})
  }
})

test('rollbackPrepared cancels activating private storage and permits retry after child exit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-prepare-rollback-'))
  const entryPath = join(root, 'main.mjs')
  const marker = join(root, 'pid')
  const release = join(root, 'release')
  await writeFile(entryPath, `import { writeFile, access } from 'node:fs/promises'\n` + storageSource.replace(
    'const value = domain.global.get()',
    `await writeFile(${JSON.stringify(marker)}, String(process.pid))
  while (!await access(${JSON.stringify(release)}).then(() => true, () => false)) await new Promise(r => setTimeout(r, 10))
  const value = domain.global.get()`))
  const host = new ProcessExtensionHost({resolveDshStorage: name => ({profileRoot:root,packageName:name})})
  const options = {pluginId:'storage-test',packageName:'storage-test',version:'1.0.0',entryPath}
  const preparing = host.prepare(options).then(value => ({value,error:undefined}), error => ({value:undefined,error}))
  const pids: number[] = []
  let rollingBack: Promise<unknown> | undefined
  try {
    pids.push(Number(await waitForFile(marker)))
    assert.equal(alive(pids[0]), true)
    rollingBack = host.rollbackPrepared('storage-test')
    await assert.rejects(host.prepare(options), /preparing\/prepared replacement or disposal/)
    await writeFile(release, '')
    await rollingBack
    const outcome = await preparing
    assert.ok(outcome.error, 'rollback during activation must reject prepare, not publish a live storage candidate')
    assert.equal(outcome.error.code, 'request_cancelled')
    assert.equal(host.pending('storage-test'), undefined)
    assert.equal(host.runtime('storage-test'), undefined)
    await exited(pids[0])
    const retry = await host.prepare(options)
    pids.push(retry.pid!)
    assert.equal(retry.generation, 2)
    assert.equal(retry.state, 'active')
    assert.equal(host.pending('storage-test')?.snapshot.pid, retry.pid)
    const medium = JSON.parse(await readFile(join(root,'extensions','dsh-storage','storage-test','same_medium.json'),'utf8'))
    assert.equal(medium.global, 2)
    await host.disposeAll()
    await exited(retry.pid!)
  } finally {
    await writeFile(release, '')
    await preparing
    await rollingBack?.catch(() => undefined)
    await host.disposeAll().catch(() => undefined)
    for (const pid of pids) { if (alive(pid)) process.kill(pid, 'SIGTERM'); await exited(pid) }
    await rm(root, {recursive:true,force:true})
  }
})

// These native-hook cases exercise the same host ownership machinery without
// private Storage: an active Storage generation intentionally forbids prepare.
// Promoted from reviewed scratch probes; existing behavior, not a new TDD fix.
const lifecycleCases = [
  { mode: 'rollback-dispose', name: 'rollback followed by disposeAll drains an activating candidate' },
  { mode: 'dispose-rollback', name: 'dispose followed by rollback drains an activating candidate' },
  { mode: 'double-rollback', name: 'repeated rollback during activation is idempotent' },
  { mode: 'activation-failure', name: 'activation failure during rollback preserves the startup error and permits retry' },
  { mode: 'cleanup-failure', name: 'cleanup failure during cancelled activation cannot strand candidate ownership' },
  { mode: 'activation-timeout', name: 'activation timeout during rollback terminates the child and permits retry' },
  { mode: 'preserve-active', name: 'rollback of an activating candidate preserves the existing active generation' },
  { mode: 'queued-dispose-active', name: 'disposeAll queued behind rollback still owns the existing active generation' }
] as const
const nativeSource = `
export async function activate() {}
export async function deactivate() {}
export async function dispose() {}
export function getCapabilityDefinitions() { return [] }
`

for (const { mode, name } of lifecycleCases) {
  test(name, { timeout: 15000 }, async () => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-lifecycle-interleaving-'))
    const host = new ProcessExtensionHost()
    const entryPath = join(root, 'candidate.mjs')
    const oldPath = join(root, 'active.mjs')
    const marker = join(root, 'pid')
    const release = join(root, 'release')
    const cleanupMarker = join(root, 'cleanup')
    const options = { pluginId: 'fixture', packageName: 'fixture', version: '2.0.0', entryPath,
      timeoutMs: mode === 'activation-timeout' ? 1000 : 3000 }
    const hasActive = mode === 'preserve-active' || mode === 'queued-dispose-active'
    const pids: number[] = []
    let preparing: Promise<{ value?: unknown; error?: unknown }> | undefined
    let cleanups: Promise<unknown>[] = []
    try {
      if (hasActive) {
        await writeFile(oldPath, nativeSource)
        pids.push((await host.replace({ ...options, version: '1.0.0', entryPath: oldPath })).pid!)
      }
      await writeFile(entryPath, `
import { writeFile, access } from 'node:fs/promises'
export async function activate() {
  await writeFile(${JSON.stringify(marker)}, String(process.pid))
  while (!await access(${JSON.stringify(release)}).then(() => true, () => false)) await new Promise(r => setTimeout(r, 10))
  ${mode === 'activation-failure' ? "throw new Error('activation failed')" : ''}
}
export async function deactivate() {
  ${mode === 'cleanup-failure' ? `await writeFile(${JSON.stringify(cleanupMarker)}, 'cleanup failed'); throw new Error('cleanup failed')` : ''}
}
export async function dispose() {}
export function getCapabilityDefinitions() { return [] }
`)
      preparing = host.prepare(options).then(value => ({ value }), error => ({ error }))
      const candidatePid = Number(await waitForFile(marker))
      pids.push(candidatePid)
      assert.equal(alive(candidatePid), true)
      if (mode === 'dispose-rollback') cleanups = [host.dispose('fixture'), host.rollbackPrepared('fixture')]
      else if (mode === 'rollback-dispose' || mode === 'queued-dispose-active') cleanups = [host.rollbackPrepared('fixture'), host.disposeAll()]
      else if (mode === 'double-rollback') cleanups = [host.rollbackPrepared('fixture'), host.rollbackPrepared('fixture')]
      else cleanups = [host.rollbackPrepared('fixture')]
      await assert.rejects(host.prepare(options), /preparing\/prepared replacement or disposal/)
      if (mode !== 'activation-timeout') await writeFile(release, '')
      await Promise.all(cleanups)
      const outcome = await preparing
      assert.ok(outcome.error, 'cancelled or failed activation must never publish a candidate')
      const startupFailure = mode === 'activation-failure' || mode === 'activation-timeout'
      assert.ok(outcome.error instanceof Error && 'code' in outcome.error)
      assert.equal(outcome.error.code, startupFailure ? 'startup_failed' : 'request_cancelled')
      if (mode === 'activation-failure') assert.match(outcome.error.message, /activation failed/)
      if (mode === 'activation-timeout') assert.match(outcome.error.message, /timed out/i)
      if (mode === 'cleanup-failure') assert.equal(await waitForFile(cleanupMarker), 'cleanup failed')
      assert.equal(host.pending('fixture'), undefined)
      await exited(candidatePid)
      if (mode === 'preserve-active') {
        assert.equal(host.snapshot('fixture')?.version, '1.0.0')
        assert.equal(host.snapshot('fixture')?.pid, pids[0])
        assert.equal(alive(pids[0]), true)
        await host.disposeAll()
      }
      assert.equal(host.runtime('fixture'), undefined)
      for (const pid of pids) await exited(pid)
      await writeFile(release, '')
      await writeFile(entryPath, nativeSource)
      if (mode === 'cleanup-failure') {
        // The failed cleanup intentionally retains ownership for the documented retry.
        await assert.rejects(host.prepare(options), /preparing\/prepared replacement or disposal/)
        await host.dispose('fixture')
      }
      const retry = await host.prepare(options)
      pids.push(retry.pid!)
      assert.equal(retry.generation, hasActive ? 3 : 2)
      assert.equal(retry.state, 'active')
      assert.equal(host.pending('fixture')?.snapshot.pid, retry.pid)
      await host.disposeAll()
      await exited(retry.pid!)
    } finally {
      await writeFile(release, '')
      await preparing
      await Promise.allSettled(cleanups)
      await host.disposeAll().catch(() => undefined)
      for (const pid of pids) { if (alive(pid)) process.kill(pid, 'SIGTERM'); await exited(pid) }
      await rm(root, { recursive: true, force: true })
    }
  })
}

test('prepared cleanup failure is reported while queued disposal releases ownership for retry', { timeout: 15000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-cleanup-failure-'))
  const host = new ProcessExtensionHost()
  const entryPath = join(root, 'main.mjs')
  const marker = join(root, 'cleanup')
  const release = join(root, 'release')
  const options = { pluginId: 'fixture', packageName: 'fixture', version: '1.0.0', entryPath }
  const pids: number[] = []
  let cleanups: Promise<unknown>[] = []
  try {
    await writeFile(entryPath, `import { writeFile, access } from 'node:fs/promises'\n` + nativeSource.replace(
      'export async function deactivate() {}', `export async function deactivate() {
        await writeFile(${JSON.stringify(marker)}, 'cleanup failed')
        while (!await access(${JSON.stringify(release)}).then(() => true, () => false)) await new Promise(r => setTimeout(r, 10))
        throw new Error('cleanup failed')
      }`))
    pids.push((await host.prepare(options)).pid!)
    const rollback = host.rollbackPrepared('fixture').then(value => ({ value, error: undefined }), error => ({ value: undefined, error }))
    cleanups = [rollback]
    assert.equal(await waitForFile(marker), 'cleanup failed')
    cleanups.push(host.disposeAll())
    await assert.rejects(host.prepare(options), /preparing\/prepared replacement or disposal/)
    await writeFile(release, '')
    await Promise.all(cleanups)
    const outcome = await rollback
    assert.ok(outcome.error instanceof Error)
    assert.match(outcome.error.message, /cleanup failed/)
    await exited(pids[0])
    assert.equal(host.pending('fixture'), undefined)
    assert.equal(host.runtime('fixture'), undefined)
    await writeFile(entryPath, nativeSource)
    const retry = await host.prepare(options)
    pids.push(retry.pid!)
    assert.equal(retry.generation, 2)
    await host.disposeAll()
    await exited(retry.pid!)
  } finally {
    await writeFile(release, '')
    await Promise.allSettled(cleanups)
    await host.disposeAll().catch(() => undefined)
    for (const pid of pids) { if (alive(pid)) process.kill(pid, 'SIGTERM'); await exited(pid) }
    await rm(root, { recursive: true, force: true })
  }
})

test('disposeAll owns an activating child and prevents late prepared publication', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-prepare-dispose-'))
  const entryPath = join(root, 'main.mjs')
  const marker = join(root, 'pid')
  const release = join(root, 'release')
  await writeFile(entryPath, `
import { writeFile, access } from 'node:fs/promises'
export async function apply() {
  await writeFile(${JSON.stringify(marker)}, String(process.pid))
  while (!await access(${JSON.stringify(release)}).then(() => true, () => false)) await new Promise(r => setTimeout(r, 10))
}
`)
  const host = new ProcessExtensionHost({resolveDshStorage: () => ({profileRoot:root,packageName:'storage-test'})})
  const options = {pluginId:'storage-test',packageName:'storage-test',version:'1.0.0',entryPath}
  const preparing = host.prepare(options).then(value => ({value,error:undefined}), error => ({value:undefined,error}))
  let pid: number | undefined
  try {
    pid = Number(await waitForFile(marker))
    assert.equal(alive(pid), true)
    const disposing = host.disposeAll()
    await writeFile(release, '')
    await disposing
    const outcome = await preparing
    assert.ok(outcome.error, 'cancelled prepare must reject rather than publish a disposed candidate')
    assert.equal(host.pending('storage-test'), undefined)
    assert.equal(host.runtime('storage-test'), undefined)
    await exited(pid)
  } finally {
    await writeFile(release, '')
    await preparing
    await host.disposeAll().catch(() => undefined)
    if (pid) { if (alive(pid)) process.kill(pid, 'SIGTERM'); await exited(pid) }
    await rm(root, {recursive:true,force:true})
  }
})
