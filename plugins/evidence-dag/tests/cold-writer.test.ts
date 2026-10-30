import { it, expect, vi } from 'vitest'

const startupBarrier = vi.hoisted(() => ({ mkdirCalls: [] as string[], afterMkdir: undefined as undefined | ((path: string) => Promise<void>) }))
vi.mock('node:fs/promises', async importOriginal => {
  const fs = await importOriginal<typeof import('node:fs/promises')>()
  return { ...fs, mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
    startupBarrier.mkdirCalls.push(String(args[0]))
    const result = await fs.mkdir(...args)
    await startupBarrier.afterMkdir?.(String(args[0]))
    return result
  } }
})
import { mkdtemp, stat, rm, mkdir, writeFile, readFile, chmod, readdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createEvidenceProductionService } from '@sciforge/domain-evidence-dag/host/production-service'
import { syntheticReasoner } from './worker-fixture.js'
import { EvidenceDagDeltaStore, evidenceDagDeltaInputFromTrace, evidenceDagCommittedSnapshotSchema } from '../src/core.js'

// Reuse an already built formal wheel; never build/install dependencies in this gate.
async function fixture(wheelSha256Override?: string) {
  const root = await mkdtemp(join(tmpdir(), 'evidence-cold-writer-'))
  const executable = process.env.EVIDENCE_TEST_PYTHON!
  const wheelPath = process.env.EVIDENCE_TEST_WHEEL ?? fileURLToPath(new URL('../dist/sciforge_evidence_dag-1.0.0-py3-none-any.whl', import.meta.url))
  const wheelSha256 = wheelSha256Override ?? createHash('sha256').update(await readFile(wheelPath)).digest('hex')
  const scope = { runtimeId: 'r', threadId: 't', workspaceRoot: join(root, 'workspace') }
  const identity = { pluginId: 'p', version: '1', profileId: 'cold-profile' }
  const home = join(root, 'worker', 'home'), tmpDir = join(root, 'worker', 'tmp'), storageRoot = join(root, 'storage')
  let reasonerCalls = 0
  const options = { identity, storageRoot, storageInterpreter: executable, clientModule: 'unused',
    worker: { executable, wheelPath, wheelSha256, storageRoot, home, tmpDir, reasoner: async (input: any) => { reasonerCalls++; return syntheticReasoner(input) } },
    threads: { read: async () => ({ ...scope, watermark: '1', trace: [] }), list: async () => [scope] },
    artifacts: { invoke: async () => { throw new Error('Unexpected artifact effect') } } }
  const mkdirBaseline = startupBarrier.mkdirCalls.length
  const production = createEvidenceProductionService(options)
  const request = (operation: string, effect = 'workspace-write', assertCurrent = () => {}, signal = new AbortController().signal) => ({
    requestId: 'cold-request', serviceId: 'evidenceDagPorts', operation,
    input: { protocol: 'sciforge-evidence-ports.v1', identity, operation, scope,
      input: { threadId: 'r:t', workspaceRoot: scope.workspaceRoot, trace: [{ id: 't1', type: 'message', content: 'Synthetic source.' }], targetWatermark: '1', idempotencyKey: 'first-writer' } },
    owner: { connectionId: 'c', pluginId: 'p', packageName: 'p', version: '1', generation: 1, invocationId: 'cold', authority: { effect, caller: { workspaceId: scope.workspaceRoot }, ordinarySession: scope } },
    assertCurrent, signal })
  const invoke = (r: ReturnType<typeof request>) => production.providers.evidenceDagPorts.operations[r.operation](r as any)
  const absent = async () => { for (const path of [home, tmpDir, storageRoot]) await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' }) }
  const cleanup = async () => { await production.close(); const pid = production.worker.pid; if (pid) expect(() => process.kill(pid, 0)).toThrow(); await rm(root, { recursive: true, force: true }) }
  return { root, scope, options, home, tmpDir, storageRoot, production, request, invoke, absent, cleanup, mkdirBaseline, reasonerCalls: () => reasonerCalls }
}

it('production first authorized writer starts with missing home/tmp/storage using the formal wheel', async () => {
  const f = await fixture()
  try {
    await f.absent()
    const result = await f.invoke(f.request('sidecar.extract')) as any
    expect(result.snapshot.digest).toMatch(/^sha256:/)
    expect(result.graph.nodes.some((node: any) => node.type === 'claim')).toBe(true)
    for (const path of [f.home, f.tmpDir, f.storageRoot]) expect((await stat(path)).isDirectory()).toBe(true)
    expect(f.reasonerCalls()).toBeGreaterThan(0)
    expect(f.production.worker.pid).toBeGreaterThan(0)
  } finally { await f.cleanup() }
})

it('production activation and committed/read-only ports do not create cold writer directories', async () => {
  const f = await fixture()
  try {
    await f.absent()
    expect(f.production.worker.pid).toBeUndefined()
    await f.invoke(f.request('threads.read', 'read'))
    await f.invoke(f.request('threads.list', 'read'))
    const r = f.request('committed.status', 'read')
    delete (r.owner.authority as any).ordinarySession
    // A genuinely absent store returns empty status without bootstrapping a writer.
    await expect(f.invoke(r)).resolves.toMatchObject({
      committed: null, provisional: null,
      authoritativeHead: { rootKind: 'empty', sequence: 0, headDigest: null },
    })
    await f.absent()
    expect(startupBarrier.mkdirCalls.length).toBe(f.mkdirBaseline)
    expect(f.production.worker.pid).toBeUndefined()
    expect(f.reasonerCalls()).toBe(0)
  } finally { await f.cleanup() }
})

it('production committed activation/read preserves existing storage bytes and modes', async () => {
  const f = await fixture()
  try {
    await mkdir(f.storageRoot)
    const file = join(f.storageRoot, 'unrelated')
    await writeFile(file, 'unchanged')
    await chmod(f.storageRoot, 0o750); await chmod(file, 0o640)
    const bytes = await readFile(file)
    const fields = async (path: string) => { const s = await stat(path); return [s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs] }
    const before = [await fields(f.storageRoot), await fields(file)]
    await f.invoke(f.request('committed.status', 'read'))
    expect([await fields(f.storageRoot), await fields(file)]).toEqual(before)
    expect(await readFile(file)).toEqual(bytes)
    expect(await readdir(f.storageRoot)).toEqual(['unrelated'])
    await expect(stat(f.home)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(f.tmpDir)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(f.production.worker.pid).toBeUndefined()
  } finally { await f.cleanup() }
})

it('production denied effect/scope/lease and cancelled writers never create directories', async () => {
  const f = await fixture()
  try {
    await expect(f.invoke(f.request('sidecar.extract', 'read'))).rejects.toThrow(/authorized|effect/)
    const foreign = f.request('sidecar.extract'); foreign.input.scope = { ...foreign.input.scope, threadId: 'foreign' }
    await expect(f.invoke(foreign)).rejects.toThrow(/scope/)
    await expect(f.invoke(f.request('sidecar.extract', 'workspace-write', () => { throw new Error('revoked') }))).rejects.toThrow('revoked')
    const abort = new AbortController(); abort.abort(new Error('cancelled'))
    await expect(f.invoke(f.request('sidecar.extract', 'workspace-write', () => {}, abort.signal))).rejects.toThrow('cancelled')
    await f.absent()
    expect(startupBarrier.mkdirCalls.length).toBe(f.mkdirBaseline)
    expect(f.production.worker.pid).toBeUndefined()
    expect(f.reasonerCalls()).toBe(0)
  } finally { await f.cleanup() }
})

// Expanded post-implementation controls: real filesystem/child, synthetic reasoning.
it.each(['revoked', 'cancelled', 'closed'] as const)('writer rechecks %s after awaited home mkdir before tmp mkdir or spawn', async mode => {
  const f = await fixture()
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const released = new Promise<void>(resolve => { release = resolve })
  let revoked = false
  const abort = new AbortController()
  startupBarrier.afterMkdir = async path => { if (path === f.home) { enter(); await released } }
  const work = Promise.resolve(f.invoke(f.request('sidecar.extract', 'workspace-write', () => { if (revoked) throw new Error('revoked') }, abort.signal)))
  const rejected = expect(work).rejects.toThrow(/revoked|cancelled|closed/)
  try {
    await entered
    expect((await stat(f.home)).isDirectory()).toBe(true)
    await expect(stat(f.tmpDir)).rejects.toMatchObject({ code: 'ENOENT' })
    if (mode === 'revoked') revoked = true
    if (mode === 'cancelled') abort.abort(new Error('cancelled'))
    const closing = mode === 'closed' ? f.production.close() : undefined
    release()
    await rejected
    await closing
    await expect(stat(f.tmpDir)).rejects.toMatchObject({ code: 'ENOENT' })
    await expect(stat(f.storageRoot)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(f.production.worker.pid).toBeUndefined()
    expect(f.reasonerCalls()).toBe(0)
  } finally { release(); startupBarrier.afterMkdir = undefined; await work.catch(() => undefined); await f.cleanup() }
})

it('wheel integrity failure precedes every writer mkdir', async () => {
  const f = await fixture('0'.repeat(64))
  try {
    await expect(f.invoke(f.request('sidecar.extract'))).rejects.toThrow('integrity mismatch')
    await f.absent()
    expect(f.production.worker.pid).toBeUndefined()
  } finally { await f.cleanup() }
})

it('first legacy sidecar read does not initialize cold writer directories', async () => {
  const f = await fixture()
  try {
    await expect(f.invoke(f.request('sidecar.readSnapshot', 'read'))).rejects.toMatchObject({ code: 'ENOENT' })
    await f.absent()
    expect(startupBarrier.mkdirCalls.length).toBe(f.mkdirBaseline)
    expect(f.production.worker.pid).toBeUndefined()
    expect(f.reasonerCalls()).toBe(0)
  } finally { await f.cleanup() }
})

it('first writer leaves existing executor directory modes and unrelated bytes unchanged', async () => {
  const f = await fixture()
  try {
    for (const path of [f.home, f.tmpDir]) { await mkdir(path, { recursive: true }); await chmod(path, 0o750) }
    const file = join(f.home, 'keep')
    await writeFile(file, 'keep bytes'); await chmod(file, 0o640)
    const before = await stat(file), bytes = await readFile(file)
    await f.invoke(f.request('sidecar.extract'))
    for (const path of [f.home, f.tmpDir]) {
      const mode = (await stat(path)).mode & 0o777
      if (process.platform === 'win32') expect(mode).toBeGreaterThan(0)
      else expect(mode).toBe(0o750)
    }
    const after = await stat(file)
    expect([after.ino, after.mode, after.size, after.mtimeMs, after.ctimeMs]).toEqual([before.ino, before.mode, before.size, before.mtimeMs, before.ctimeMs])
    expect(await readFile(file)).toEqual(bytes)
  } finally { await f.cleanup() }
})

it('cold committed production activation/status preserves the real immutable store without recreating home/tmp', async () => {
  const f = await fixture()
  let cold: ReturnType<typeof createEvidenceProductionService> | undefined
  try {
    const result = await f.invoke(f.request('sidecar.extract')) as any
    const file = join(f.storageRoot, 'deltas.json')
    const store = new EvidenceDagDeltaStore(file)
    const delta = evidenceDagDeltaInputFromTrace({ ...f.scope, threadId: 'r:t', operationId: 'one', idempotencyKey: 'committed-one', kind: 'manual', requestedWatermark: '1', trace: [] })
    const appended = await store.append({ ...delta, payload: { ...delta.payload, claims: [{ id: 'claim-1', text: 'Synthetic.' }] } })
    const closure = await store.seal('r:t', { version: 'EvidenceClosurePolicyV1', targetClaimIds: ['claim-1'], expectedHeadDigest: appended.delta.deltaDigest, barrierWatermark: '1', edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false, cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [] })
    expect(closure.status).toBe('complete')
    const snapshot = evidenceDagCommittedSnapshotSchema.parse(Object.fromEntries(Object.keys(evidenceDagCommittedSnapshotSchema.shape).map(key => [key, result.snapshot[key]])))
    await store.recordCommittedSnapshot('r:t', snapshot, closure.closureDigest)
    await f.production.close()
    expect(() => process.kill(f.production.worker.pid!, 0)).toThrow()
    await rm(f.home, { recursive: true }); await rm(f.tmpDir, { recursive: true })
    await chmod(f.storageRoot, 0o750); await chmod(file, 0o640)
    const capture = async () => {
      const entries: Record<string, unknown> = {}
      const visit = async (path: string): Promise<void> => {
        const s = await stat(path)
        entries[path] = [s.ino, s.mode, s.size, s.mtimeMs, s.ctimeMs]
        if (s.isDirectory()) for (const entry of (await readdir(path)).sort()) await visit(join(path, entry))
        else entries[`${path}:bytes`] = (await readFile(path)).toString('base64')
      }
      await visit(f.storageRoot)
      return entries
    }
    const before = await capture(), calls = f.reasonerCalls(), mkdirCalls = startupBarrier.mkdirCalls.length
    cold = createEvidenceProductionService(f.options)
    expect(await capture()).toEqual(before)
    const request = f.request('committed.status', 'read')
    delete (request.owner.authority as any).ordinarySession
    const status = await cold.providers.evidenceDagPorts.operations['committed.status'](request as any) as any
    expect(status.committed).toEqual(snapshot)
    expect(await capture()).toEqual(before)
    for (const path of [f.home, f.tmpDir]) await expect(stat(path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(startupBarrier.mkdirCalls.length).toBe(mkdirCalls)
    expect(cold.worker.pid).toBeUndefined()
    expect(f.reasonerCalls()).toBe(calls)
  } finally { await cold?.close(); await f.cleanup() }
})
