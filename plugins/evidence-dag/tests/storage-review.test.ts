import { it, expect } from 'vitest'
import { mkdir, symlink, readdir, link, readFile, stat, rename, rm, chmod } from 'node:fs/promises'
import { join } from 'node:path'
import { PythonEvidenceWorker } from '@sciforge/domain-evidence-dag/host/python-worker'
import { EvidenceRuntime } from '../src/runtime.js'
import { workerOptions } from './worker-fixture.js'
import { artifactFixture } from './artifact-fixture.js'
it('real wheel rejects a snapshots symlink introduced during reasoning, not only before startup', async () => {
  const opts = await workerOptions(), outside = join(opts.root, 'outside')
  await mkdir(outside)
  let injected = false
  const worker = new PythonEvidenceWorker({ ...opts, reasoner: async input => {
    if (!injected) { injected = true; await symlink(outside, join(opts.storageRoot, 'snapshots')) }
    return opts.reasoner(input)
  } })
  try {
    await expect(worker.request('commitSnapshot', { threadId: 'research:dynamic', targetWatermark: '1', trace: [{ id: 't1', content: 'Synthetic' }], workspaceRoot: join(opts.root, 'workspace'), idempotencyKey: 'storage-dynamic-one' })).rejects.toThrow(/symlink|link|storage|directory/i)
    expect(await readdir(outside)).toEqual([])
  } finally { const pid = worker.pid; await worker.close(); expect(() => process.kill(pid!, 0)).toThrow() }
})

it.each(['events', 'staging', 'snapshot-blobs'])('wheel rejects dynamic %s directory links before any outside file write', async directory => {
  const opts = await workerOptions(), outside = join(opts.root, 'outside')
  await mkdir(outside)
  let injected = false
  const worker = new PythonEvidenceWorker({ ...opts, reasoner: async input => {
    if (!injected) {
      injected = true
      const target = join(opts.storageRoot, directory)
      await rm(target, { recursive: true, force: true }); await symlink(outside, target)
    }
    return opts.reasoner(input)
  } })
  try {
    await expect(worker.request('commitSnapshot', { threadId: 'dynamic:' + directory, targetWatermark: '1', trace: [{ id: 't1', content: 'Synthetic' }], workspaceRoot: join(opts.root, 'workspace'), idempotencyKey: 'dynamic-link-' + directory })).rejects.toThrow()
    expect(await readdir(outside)).toEqual([])
  } finally { await worker.close() }
})

it.each(['root', 'ancestor'])('real wheel rejects a %s storage link without chmod or writes outside', async position => {
  const opts = await workerOptions(), outside = join(opts.root, 'outside')
  await mkdir(outside)
  const beforeMode = (await stat(outside)).mode
  const root = position === 'root' ? opts.storageRoot : join(opts.root, 'parent', 'threads')
  await symlink(outside, position === 'root' ? root : join(opts.root, 'parent'))
  const worker = new PythonEvidenceWorker({ ...opts, storageRoot: root })
  try {
    await expect(worker.request('commitSnapshot', { threadId: 'links:' + position, targetWatermark: '1', trace: [], workspaceRoot: join(opts.root, 'workspace'), idempotencyKey: 'links-' + position })).rejects.toThrow()
    expect(await readdir(outside)).toEqual([]); expect((await stat(outside)).mode).toBe(beforeMode)
  } finally { const pid = worker.pid; await worker.close(); expect(() => process.kill(pid!, 0)).toThrow() }
})

it('real wheel rejects a hardlinked event outbox before appending or chmod', async () => {
  const opts = await workerOptions(), worker = new PythonEvidenceWorker(opts)
  const input = { threadId: 'research:hardlink', targetWatermark: '1', trace: [{ id: 't1', content: 'Synthetic' }], workspaceRoot: join(opts.root, 'workspace'), idempotencyKey: 'hardlink-one' }
  try {
    await worker.request('commitSnapshot', input)
    const outbox = join(opts.storageRoot, 'events/evidence-domain-events.json'), outside = join(opts.root, 'outside.json')
    await link(outbox, outside)
    const before = await readFile(outside, 'utf8'), mode = (await stat(outside)).mode
    await expect(worker.request('commitSnapshot', { ...input, targetWatermark: '2', idempotencyKey: 'hardlink-two' })).rejects.toThrow(/link|storage/i)
    expect(await readFile(outside, 'utf8')).toBe(before); expect((await stat(outside)).mode).toBe(mode)
  } finally { await worker.close() }
})
it('JS storage rejects a root symlink and later file links without touching their targets', async () => {
  const f = await artifactFixture(), outside = join(f.root, 'outside')
  await mkdir(outside); const outsideMode = (await stat(outside)).mode
  await symlink(outside, f.ports.storageRoot)
  let runtime = new EvidenceRuntime(f.ports)
  await expect(runtime.start()).rejects.toThrow(/symlink|link|storage/i)
  expect(await readdir(outside)).toEqual([])
  expect((await stat(outside)).mode).toBe(outsideMode)
  await rm(f.ports.storageRoot); runtime = new EvidenceRuntime(f.ports)
  try {
    await runtime.start(); await runtime.update(f.scope)
    const file = join(f.ports.storageRoot, 'artifact-version-lifecycle.json'), target = join(outside, 'state.json')
    await rename(file, target); await symlink(target, file)
    const before = await readFile(target, 'utf8')
    await expect(runtime.update(f.scope)).rejects.toThrow(/symlink|link|storage/i)
    expect(await readFile(target, 'utf8')).toBe(before)
    await rm(file); await rename(target, file)
    await runtime.update(f.scope)
  } finally { await runtime.close() }
})

it('JS rejects hardlinked delta files and replacement storage roots without chmodding outside', async () => {
  const f = await artifactFixture(), runtime = new EvidenceRuntime(f.ports)
  await runtime.start(); await runtime.update(f.scope)
  const ancestorMode = (await stat(f.root)).mode
  const outside = join(f.root, 'outside-delta.json'), delta = join(f.ports.storageRoot, 'deltas.json')
  await link(delta, outside)
  const before = await readFile(outside, 'utf8'), mode = (await stat(outside)).mode
  const changed = { ...f.ports, request: async (r: any) => r.operation === 'threads.read'
    ? { ...f.scope, watermark: '8', trace: f.trace } : f.ports.request(r) }
  const fresh = new EvidenceRuntime(changed)
  await expect(fresh.start()).rejects.toThrow(/link|storage/i)
  expect(await readFile(outside, 'utf8')).toBe(before); expect((await stat(outside)).mode).toBe(mode)
  await rm(outside)
  const original = f.ports.storageRoot + '-original'
  await rename(f.ports.storageRoot, original); await mkdir(f.ports.storageRoot)
  await expect(runtime.update(f.scope)).rejects.toThrow(/identity|storage/i)
  expect(await readdir(f.ports.storageRoot)).toEqual([])
  expect((await stat(f.root)).mode).toBe(ancestorMode)
  await rm(f.ports.storageRoot, { recursive: true }); await rename(original, f.ports.storageRoot)
  await runtime.update(f.scope); await runtime.close()
})

it('normal JS and wheel files retain 0600 and directories 0700 through restart', async () => {
  const opts = await workerOptions()
  let worker = new PythonEvidenceWorker(opts)
  const input = { threadId: 'research:modes', targetWatermark: '1', trace: [{ id: 't1', content: 'Synthetic' }], workspaceRoot: join(opts.root, 'workspace'), idempotencyKey: 'modes-one' }
  let digest: string
  try { digest = (await worker.request('commitSnapshot', input)).snapshot.digest } finally { await worker.close() }
  await chmod(opts.storageRoot, 0o755)
  await chmod(join(opts.storageRoot, 'events/evidence-domain-events.json'), 0o644)
  worker = new PythonEvidenceWorker({ ...opts, reasoner: async () => { throw Error('must read old Snapshot') } })
  try { expect((await worker.request('readSnapshot', { threadId: input.threadId, snapshotDigest: digest!, workspaceRoot: input.workspaceRoot })).snapshot.digest).toBe(digest!) } finally { await worker.close() }
  const f = await artifactFixture(); let runtime = new EvidenceRuntime(f.ports)
  await runtime.start(); await runtime.update(f.scope); await runtime.close()
  await chmod(f.ports.storageRoot, 0o755)
  await chmod(join(f.ports.storageRoot, 'deltas.json'), 0o644)
  await chmod(join(f.ports.storageRoot, 'artifact-version-lifecycle.json'), 0o644)
  runtime = new EvidenceRuntime(f.ports); await runtime.start(); await runtime.update(f.scope); await runtime.close()
  for (const root of [opts.storageRoot, f.ports.storageRoot]) {
    for (const path of [root, ...(await readdir(root, { recursive: true })).map(p => join(root, p))]) {
      const s = await stat(path)
      if (process.platform === 'win32') expect(s.mode & 0o777, path).toBeGreaterThan(0)
      else expect(s.mode & 0o777, path).toBe(s.isDirectory() ? 0o700 : 0o600)
      if (s.isFile()) expect(s.nlink, path).toBe(1)
    }
  }
})
