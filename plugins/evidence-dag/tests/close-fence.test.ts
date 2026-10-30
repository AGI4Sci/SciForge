import { it, expect } from 'vitest'
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { join } from 'node:path'
import { EvidenceRuntime } from '../src/runtime.js'
import { artifactFixture } from './artifact-fixture.js'
import type { Json, PortRequest } from '@sciforge/domain-evidence-dag/host/ports'
import { PythonEvidenceWorker } from '@sciforge/domain-evidence-dag/host/python-worker'
import { workerOptions } from './worker-fixture.js'

const barrier = () => {
  let release!: () => void
  const promise = new Promise<void>(resolve => { release = resolve })
  return { promise, release }
}
async function diskHashes(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {}
  async function visit(path: string, prefix: string) {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = `${prefix}${entry.name}`
      if (entry.isDirectory()) await visit(join(path, entry.name), `${name}/`)
      else files[name] = createHash('sha256').update(await readFile(join(path, entry.name))).digest('hex')
    }
  }
  await visit(root, '')
  return files
}

it.each(['read', 'commit', 'abort'] as const)('ED-R4-01 fences late %s delivery without revoking already durable effects', async stage => {
  const f = await artifactFixture()
  await writeFile(join(f.scope.workspaceRoot, 'result-2.txt'), 'synthetic evidence artifact')
  const seeded = await f.service.commit(f.scope.workspaceRoot, { idempotencyKey: 'close-fence-seed', candidates: [{ candidateId: 'seed', expectedCurrentVersionId: null, kind: 'text', intent: 'observe', content: { mode: 'snapshot', dataBase64: Buffer.from('synthetic evidence artifact').toString('base64') } }] }, f.access)
  if (!seeded.ok) throw new Error('seed failed')
  let armed = false, closing = false, trace = f.trace
  const entered = barrier(), held = barrier(), cancelEntered = barrier()
  const completed = new Set<string>(), postClose: PortRequest['operation'][] = []
  const controller = new AbortController()
  const runtime = new EvidenceRuntime({ ...f.ports, request: async r => {
    if (closing && r.operation !== 'sidecar.close') postClose.push(r.operation)
    if (r.operation === 'threads.read') return { ...f.scope, watermark: armed ? '8' : '7', trace } as unknown as Json
    const receipt = await f.ports.request(r)
    // Only response delivery is held: the real read/commit is finished.
    completed.add(r.requestId)
    if (armed && r.operation === (stage === 'commit' ? 'artifacts.commit' : 'artifacts.read')) {
      entered.release(); await held.promise
    }
    return receipt
  }, cancel: async requestId => {
    // No fabricated cancellation: exact true describes completed I/O only.
    expect(completed.has(requestId)).toBe(true)
    cancelEntered.release()
    return { cancelled: true, quiescent: true }
  } }, { closeTimeoutMs: 300 })
  await runtime.start()
  // Positive control: normal pre-close pin persists a new artifact.
  await runtime.update(f.scope)
  trace = [{ ...structuredClone(f.trace[0]), artifact: { ...f.trace[0].artifact, locator: 'result-2.txt' }, artifactVersionRef: seeded.value.versions[0].ref } as typeof f.trace[number]]
  armed = true
  const work = runtime.withInvocation({ callId: 'synthetic-close-fence' }, controller.signal, () => runtime.update(f.scope)).then(() => ({ rejected: false }), error => ({ rejected: true, error }))
  await entered.promise
  const before = await f.service.listEvents(f.scope.workspaceRoot, { afterSequence: 0, limit: 100 }, f.access)
  const hashes = await diskHashes(join(f.root, 'host-artifacts'))
  expect(before.ok).toBe(true)
  if (before.ok) expect(before.value.lastSequence).toBe(stage === 'commit' ? 6 : 4)
  let stop: Promise<void> | undefined
  try {
    if (stage === 'abort') { controller.abort(); await cancelEntered.promise }
    else { closing = true; stop = runtime.close(); expect(runtime.close()).toBe(stop) }
    held.release()
    expect(await work).toMatchObject({ rejected: true })
    if (stop) await stop
    else { closing = true; await runtime.close() }
    const after = await f.service.listEvents(f.scope.workspaceRoot, { afterSequence: 0, limit: 100 }, f.access)
    const afterHashes = await diskHashes(join(f.root, 'host-artifacts'))
    console.log('ED_R4_DURABLE_FENCE', JSON.stringify({ stage, before, after, hashes, afterHashes, postClose, cancelReceipt: { quiescent: true } }))
    expect(after).toEqual(before)
    expect(afterHashes).toEqual(hashes)
    expect(postClose).toEqual([])
    expect(f.calls.filter(r => r.operation === 'sidecar.close')).toHaveLength(1)

  } finally { held.release(); await work; await stop?.catch(() => undefined); await runtime.close().catch(() => undefined) }
})

it('ED-R4-01 canonical request refuses all new ordinary dispatch after close but allows cleanup', async () => {
  const f = await artifactFixture()
  const runtime = new EvidenceRuntime(f.ports)
  await runtime.start(); await runtime.close()
  const before = f.calls.length
  const request = runtime as unknown as { request(operation: PortRequest['operation'], input: Json, scope: typeof f.scope): Promise<unknown> }
  for (const operation of ['threads.read', 'artifacts.read', 'artifacts.commit', 'sidecar.commitSnapshot'] as const) {
    await expect(request.request(operation, {}, f.scope)).rejects.toThrow('closing')
  }
  expect(f.calls).toHaveLength(before)
})

it('ED-R4-01 owned cleanup remains callable inside an already aborted invocation', async () => {
  const f = await artifactFixture(), controller = new AbortController()
  let cancels = 0
  const runtime = new EvidenceRuntime({ ...f.ports, cancel: async () => { cancels++; return { cancelled: true, quiescent: true } } })
  await runtime.start(); controller.abort()
  try {
    await runtime.withInvocation({ callId: 'synthetic-aborted-cleanup' }, controller.signal, () => runtime.close())
    expect(f.calls.map(r => r.operation)).toEqual(['sidecar.close'])
    expect(cancels).toBe(0)
  } finally { await runtime.close().catch(() => undefined) }
})

it('ED-R4-01 late real-wheel read cannot resume a new sidecar write after close', async () => {
  const options = await workerOptions(), worker = new PythonEvidenceWorker(options)
  const scope = { runtimeId: 'codex', threadId: 'wheel-fence', workspaceRoot: join(options.root, 'workspace') }
  const input = { threadId: 'codex:wheel-fence', trace: [{ id: 't1', content: 'Synthetic' }], targetWatermark: '1', workspaceRoot: scope.workspaceRoot, idempotencyKey: 'wheel-fence-seed' }
  const seed = await worker.request('commitSnapshot', input) as { snapshot: { digest: string } }
  const pid = worker.pid!
  const entered = barrier(), held = barrier(), completed = new Set<string>()
  let closing = false
  const postClose: string[] = []
  const runtime = new EvidenceRuntime({ identity: { pluginId: 'sciforge-evidence-dag', version: '1.0.0', profileId: 'synthetic' }, storageRoot: join(options.root, 'js'),
    request: async r => {
      if (closing && r.operation !== 'sidecar.close') postClose.push(r.operation)
      if (r.operation === 'sidecar.close') { await worker.close(); return { exited: true } }
      if (r.operation === 'sidecar.readSnapshot') {
        const receipt = await worker.request('readSnapshot', r.input)
        completed.add(r.requestId); entered.release(); await held.promise
        return receipt
      }
      if (r.operation === 'sidecar.commitSnapshot') return worker.request('commitSnapshot', r.input)
      throw new Error(`Unexpected ${r.operation}`)
    }, cancel: async requestId => {
      expect(completed.has(requestId)).toBe(true)
      return { cancelled: true, quiescent: true }
    },
  }, { closeTimeoutMs: 500 })
  await runtime.start()
  const request = runtime as unknown as { request(operation: PortRequest['operation'], input: Json, targetScope: typeof scope): Promise<unknown> }
  const work = request.request('sidecar.readSnapshot', { threadId: input.threadId, workspaceRoot: scope.workspaceRoot, snapshotDigest: seed.snapshot.digest }, scope)
    .then(() => request.request('sidecar.commitSnapshot', { ...input, targetWatermark: '2', idempotencyKey: 'wheel-fence-forbidden' }, scope))
    .then(() => ({ rejected: false }), error => ({ rejected: true, error }))
  await entered.promise
  const hashes = await diskHashes(options.storageRoot)
  closing = true
  const stop = runtime.close(); expect(runtime.close()).toBe(stop)
  try {
    held.release(); expect(await work).toMatchObject({ rejected: true }); await stop
    const afterHashes = await diskHashes(options.storageRoot)
    console.log('ED_R4_WHEEL_FENCE', JSON.stringify({ pid, snapshotDigest: seed.snapshot.digest, hashes, afterHashes, postClose }))
    expect(postClose).toEqual([])
    expect(afterHashes).toEqual(hashes)
    expect(() => process.kill(pid, 0)).toThrow()
    // Cold standard worker reads the admitted Snapshot; shutdown did not undo it.
    const cold = new PythonEvidenceWorker({ ...options, reasoner: async () => { throw new Error('readback must not reason') } })
    try {
      expect(await cold.request('readSnapshot', { threadId: input.threadId, workspaceRoot: scope.workspaceRoot, snapshotDigest: seed.snapshot.digest })).toMatchObject({ snapshot: { digest: seed.snapshot.digest } })
    } finally { await cold.close() }
    console.log('ED_R4_WHEEL_FENCE', JSON.stringify({ pid, exited: true, snapshotDigest: seed.snapshot.digest, hashes, postClose }))
  } finally { held.release(); await work; await stop.catch(() => undefined); await worker.close(); await runtime.close().catch(() => undefined) }
})
