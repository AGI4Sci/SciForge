import { it, expect } from 'vitest'
import { readFile, rm, symlink } from 'node:fs/promises'
import { artifactFixture } from './artifact-fixture.js'
import { join } from 'node:path'
import { EvidenceRuntime } from '../src/runtime.js'
import { PythonEvidenceWorker } from '@sciforge/domain-evidence-dag/host/python-worker'
import { workerOptions, syntheticReasoner } from './worker-fixture.js'
const posixTest = process.platform === 'win32' ? it.skip : it

const live = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const observe = <T>(work: Promise<T>, ms: number) => new Promise<{ value?: T; error?: unknown; timedOut?: true }>(resolve => {
  const timer = setTimeout(() => resolve({ timedOut: true }), ms)
  work.then(value => { clearTimeout(timer); resolve({ value }) }, error => { clearTimeout(timer); resolve({ error }) })
})

it.each([true, false])('runtime close cancels blocked extraction and stops real wheel; cooperative=%s', async cooperative => {
  const options = await workerOptions()
  let enter!: () => void, release!: () => void, first = true, aborted = false
  const entered = new Promise<void>(r => { enter = r }), held = new Promise<void>(r => { release = r })
  const worker = new PythonEvidenceWorker({ ...options, closeTimeoutMs: 200, reasoner: async (input, signal) => {
    if (first) {
      first = false; enter()
      signal.addEventListener('abort', () => { aborted = true; if (cooperative) release() }, { once: true })
      await held
    }
    return syntheticReasoner(input)
  } } as ConstructorParameters<typeof PythonEvidenceWorker>[0])
  const scope = { runtimeId: 'codex', threadId: 'blocked', workspaceRoot: join(options.root, 'workspace') }
  const operations: string[] = [], cancellations: string[] = []
  let extractionRequestId: string | undefined
  const runtime = new EvidenceRuntime({ identity: { pluginId: 'sciforge-evidence-dag', version: '1.0.0', profileId: 'synthetic' }, storageRoot: join(options.root, 'js'),
    request: async r => {
      operations.push(r.operation)
      if (r.operation === 'threads.read') return { ...scope, watermark: '1', trace: [{ id: 't1', claimId: 'claim:1', content: 'Synthetic' }] }
      if (r.operation === 'sidecar.extract') { extractionRequestId = r.requestId; return worker.request('extract', r.input) }
      if (r.operation === 'sidecar.commitSnapshot') return worker.request('commitSnapshot', r.input)
      if (r.operation === 'sidecar.readSnapshot') return worker.request('readSnapshot', r.input)
      if (r.operation === 'sidecar.close') { await worker.close(); return { exited: true } }
      throw Error('unsupported ' + r.operation)
    }, cancel: async id => { cancellations.push(id); await worker.close(); return { cancelled: true, quiescent: true } },
  }, { closeTimeoutMs: 400 } as ConstructorParameters<typeof EvidenceRuntime>[1])
  let updating: Promise<unknown> | undefined, closing: Promise<void> | undefined
  try {
    await runtime.start()
    const before = (await runtime.store.chain('codex:blocked')).list()
    updating = runtime.update(scope).catch(e => e)
    await entered
    expect(operations).toContain('sidecar.extract')
    expect(operations).not.toContain('sidecar.commitSnapshot')
    expect((await runtime.store.chain('codex:blocked')).list()).toEqual(before)
    const pid = worker.pid!
    closing = runtime.close()
    const result = await observe(closing, 1500)
    expect(result.timedOut).not.toBe(true)
    expect(aborted).toBe(true)
    expect(extractionRequestId).toBeDefined()
    expect(cancellations).toEqual([extractionRequestId])
    expect(operations).toContain('sidecar.close')
    expect(live(pid)).toBe(false)
    if (cooperative) expect(result.error).toBeUndefined()
    else {
      expect(result.error).toBeDefined()
      release(); await worker.close(); await runtime.close()
    }
    expect(await updating).toBeInstanceOf(Error)
    // A cancelled extraction must never append a delta or acknowledge a
    // committed Snapshot, including after noncooperative reasoning releases.
    const chain = await runtime.store.chain('codex:blocked')
    expect(chain.committedEvidenceSnapshot).toBeNull()
    expect(chain.list()).toEqual(before)
    expect(chain.list()).toHaveLength(0)
    await expect(readFile(join(options.root, 'js/deltas.json'), 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    const { EvidenceDagDeltaStore } = await import('../src/core.js')
    const cold = new EvidenceDagDeltaStore(join(options.root, 'js/deltas.json'))
    await cold.load()
    expect((await cold.chain('codex:blocked')).list()).toEqual([])
    expect((await cold.chain('codex:blocked')).committedEvidenceSnapshot).toBeNull()
    console.log('ED02_PID', JSON.stringify({ pid, exited: !live(pid), cooperative, aborted, failure: result.error instanceof Error ? result.error.message : result.error }))
  } finally {
    release(); await updating; await closing?.catch(() => undefined); await worker.close(); await runtime.close()
  }
}, 15000)

const messages = (error: unknown): string[] => error instanceof AggregateError
  ? [error.message, ...error.errors.flatMap(messages)] : [error instanceof Error ? error.message : String(error)]

it.each([false, true])('failed lifecycle close retains flush and still stops real PID; stopFailure=%s', async stopFailure => {
  const f = await artifactFixture(), options = await workerOptions(), worker = new PythonEvidenceWorker(options)
  let watermark = '7', failStop = stopFailure
  const runtime = new EvidenceRuntime({ ...f.ports, request: async r => {
    if (r.operation === 'threads.read') return { ...f.scope, watermark, trace: structuredClone(f.trace) } as any
    if (r.operation === 'sidecar.extract') return worker.request('extract', r.input)
    if (r.operation === 'sidecar.commitSnapshot') return worker.request('commitSnapshot', r.input)
    if (r.operation === 'sidecar.readSnapshot') return worker.request('readSnapshot', r.input)
    if (r.operation === 'sidecar.close') { await worker.close(); if (failStop) throw Error('STOP_RECEIPT_FAILURE'); return { exited: true } }
    return f.ports.request(r)
  } })
  const file = join(f.ports.storageRoot, 'artifact-version-lifecycle.json')
  try {
    await runtime.start(); const update = await runtime.update(f.scope)
    const claims = update.status.provisional?.lastGood?.claims as Array<{ id: string }>
    expect(claims).toHaveLength(1)
    const closure = await runtime.sealClosure({ ...f.scope, idempotencyKey: 'lifecycle-failure', policy: {
      version: 'EvidenceClosurePolicyV1', targetClaimIds: claims.map(claim => claim.id), expectedHeadDigest: update.status.authoritativeHead!.headDigest!, barrierWatermark: '7', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [],
    } })
    expect(closure.status).toBe('complete')
    const snapshot = (await runtime.snapshotStatus(f.scope)).committed!
    expect(snapshot).not.toBeNull()
    const pid = worker.pid!
    await rm(file); await symlink(join(f.root, 'outside-state.json'), file)
    watermark = '8'
    await expect(runtime.update(f.scope)).rejects.toThrow(/symlink/i)
    const result = await observe(runtime.close(), 2000)
    expect(result.error).toBeDefined(); expect(result.timedOut).not.toBe(true)
    expect(live(pid)).toBe(false)
    expect(messages(result.error).join(';')).toMatch(/symlink/i)
    if (stopFailure) expect(messages(result.error)).toContain('STOP_RECEIPT_FAILURE')
    failStop = false
    // A failed first drain must not mark the consumer closed: even a second
    // attempt against the same obstruction must still visibly reject.
    await expect(runtime.close()).rejects.toThrow()
    await rm(file)
    const retry = runtime.close(); expect(runtime.close()).toBe(retry); await retry
    const persisted = JSON.parse(await readFile(file, 'utf8'))
    expect(persisted.threads.find((t: any) => t.threadId === f.scope.threadId).targetWatermark).toBe('8')
    const cold = new EvidenceRuntime(f.ports)
    await cold.start()
    expect((await cold.snapshotStatus(f.scope)).committed).toEqual(snapshot)
    await cold.close()
    console.log('ED03_PID', JSON.stringify({ pid, exited: !live(pid), stopFailure, errors: messages(result.error), retainedWatermarkReadBack: '8', snapshotDigest: snapshot.digest }))
  } finally {
    failStop = false; await rm(file, { force: true }); await worker.close(); await runtime.close().catch(() => undefined)
  }
}, 15000)

it('retries a nonquiescent cancellation owner instead of caching its rejection forever', async () => {
  const f = await artifactFixture()
  let enter!: () => void, release!: () => void, cancelled = 0
  const entered = new Promise<void>(r => { enter = r }), held = new Promise<void>(r => { release = r })
  const runtime = new EvidenceRuntime({ ...f.ports, request: async r => {
    if (r.operation === 'threads.read') { enter(); await held }
    return f.ports.request(r)
  }, cancel: async () => { cancelled++; if (cancelled > 1) release(); return { cancelled: true, quiescent: cancelled > 1 } } }, { closeTimeoutMs: 30 })
  let work: Promise<unknown> | undefined
  try {
    await runtime.start(); work = runtime.update(f.scope).catch(e => e); await entered
    await expect(runtime.close()).rejects.toThrow()
    const retried = await observe(runtime.close(), 500)
    expect(retried.timedOut).not.toBe(true); expect(retried.error).toBeUndefined()
    expect(cancelled).toBe(2); expect(await work).toBeInstanceOf(Error)
  } finally { release(); await work; await runtime.close().catch(() => undefined) }
})

posixTest('real wheel SIGTERM refusal escalates to SIGKILL and confirms OS exit', async () => {
  const { writeFile, chmod } = await import('node:fs/promises')
  const options = await workerOptions(), executable = join(options.root, 'ignore-term.py')
  await writeFile(executable, `#!/opt/homebrew/bin/python3 -I
import os,sys
args=sys.argv[1:]
i=args.index('-c')+1
args[i]='import signal;signal.signal(signal.SIGTERM,signal.SIG_IGN);'+args[i]
os.execv('/opt/homebrew/bin/python3',['python3',*args])
`)
  await chmod(executable, 0o700)
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(r => { enter = r }), held = new Promise<void>(r => { release = r })
  const worker = new PythonEvidenceWorker({ ...options, executable, reasoner: async input => { enter(); await held; return syntheticReasoner(input) } })
  const request = worker.request('commitSnapshot', { threadId: 'codex:term', trace: [{ id: 't1', content: 'Synthetic' }], targetWatermark: '1', workspaceRoot: join(options.root, 'workspace'), idempotencyKey: 'ignore-term' }).catch(e => e)
  try {
    await entered
    const pid = worker.pid!, closing = worker.close()
    // Abort of the reasoner alone cannot establish OS exit. Keep this barrier
    // held long enough to observe the SIGTERM-resistant process still live.
    await new Promise(r => setTimeout(r, 50)); expect(live(pid)).toBe(true)
    release()
    const outcome = await observe(closing, 3000)
    expect(outcome.timedOut).not.toBe(true); expect(outcome.error).toBeUndefined()
    expect(live(pid)).toBe(false); await request
    console.log('ED02_SIGKILL_PID', JSON.stringify({ pid, exited: !live(pid) }))
  } finally { release(); await request; await worker.close() }
}, 15000)
