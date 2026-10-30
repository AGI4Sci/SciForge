import { test, expect } from 'vitest'
import { mkdtemp, lstat, readdir, rm, symlink, mkdir, writeFile, readFile, chmod, rename } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { readCommittedChain, committedStatus } from '@sciforge/domain-evidence-dag/host/committed-reader'
import { Context } from '@deepseek-ai/cordis'
import Tools from '@deepseek-ai/dsh-tools'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { ToolCallId } from '@deepseek-ai/dsh-llm'
import * as entry from '../src/dsh-adapter.js'

const interpreter = process.env.EVIDENCE_BUILD_PYTHON!
const scope = { runtimeId: 'codex', threadId: 'fresh-status', workspaceRoot: '/controlled-workspace' }
async function fixture(action: (base: string) => Promise<void>) {
  const base = await mkdtemp(join(tmpdir(), 'status-readonly-'))
  try { await action(base) } finally { await rm(base, { recursive: true, force: true }) }
}
async function publicStatus(root: string, update = false) {
  const ctx = new Context()
  try {
    await ctx.plugin(SystemPrompt); await ctx.plugin(Tools)
    ctx.provide('evidenceDagPorts', {
      storageRoot: root, identity: { pluginId: 'sciforge-evidence-dag', version: '1.0.0', profileId: 'isolated-status' },
      async request(r: any) {
        if (r.operation === 'committed.status') {
          expect(r.scope).toEqual(scope)
          return committedStatus(await readCommittedChain(root, interpreter, scope, undefined, process.env.EVIDENCE_TEST_WHEEL), scope, async () => { throw Error('unexpected snapshot read') })
        }
        if (r.operation === 'threads.read' && update) return { ...scope, watermark: '1', trace: [{ id: 'receipt', text: 'A deterministic component claim.' }] }
        // Deterministic extraction DTO only; all DSH/update/store/read code is real.
        if (r.operation === 'sidecar.extract' && update) return { snapshot: {}, graph: { thread_id: `${scope.runtimeId}:${scope.threadId}`, nodes: [{ id: 'claim:component', type: 'claim', content: 'A deterministic component claim.' }], edges: [], meta: { scope: { workspaceRoot: scope.workspaceRoot } } } }
        if (r.operation === 'sidecar.close') return { exited: true }
        throw Error(`Unexpected writable operation: ${r.operation}`)
      }, cancel: async () => ({ cancelled: true, quiescent: true }),
    })
    await ctx.plugin(entry)
    if (update) {
      const produced = await ctx.tools.execute({ name: 'evidence_dag_update', arguments: scope, callId: brandString<ToolCallId>('producer-update'), signal: new AbortController().signal })
      expect(produced.isError, JSON.stringify(produced)).toBe(false)
      const status = await ctx.tools.execute({ name: 'evidence_dag_snapshot_status', arguments: scope, callId: brandString<ToolCallId>('warm-status'), signal: new AbortController().signal })
      return { produced: produced.value, status } as any
    }
    return await ctx.tools.execute({ name: 'evidence_dag_snapshot_status', arguments: scope, callId: brandString<ToolCallId>('cold-status'), signal: new AbortController().signal })
  } finally { await ctx.fiber.dispose() }
}

test('official snapshot-status returns explicit empty status on a fresh nested storage root without creating it', () => fixture(async base => {
  const root = join(base, 'evidence-dag', 'python')
  const before = await lstat(base)
  const result = await publicStatus(root)
  expect(result.isError, JSON.stringify(result)).toBe(false)
  expect(result.value).toMatchObject({ committed: null, provisional: null, authoritativeHead: { rootKind: 'empty', sequence: 0, headDigest: null } })
  const after = await lstat(base)
  expect({ mode: after.mode, ino: after.ino, mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs }).toEqual({ mode: before.mode, ino: before.ino, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs })
  expect(await readdir(base)).toEqual([])
}))

test.each(['live', 'dangling'])('missing storage below a %s ancestor symlink is rejected rather than treated as empty', kind => fixture(async base => {
  const target = join(base, 'target')
  if (kind === 'live') await mkdir(target)
  await symlink(target, join(base, 'alias'))
  await expect(readCommittedChain(join(base, 'alias', 'missing', 'python'), interpreter, scope)).rejects.toThrow()
  expect(await readdir(base)).toEqual(kind === 'live' ? ['alias', 'target'] : ['alias'])
}))

test('an existing nondirectory storage ancestor is not treated as empty', () => fixture(async base => {
  await writeFile(join(base, 'file'), 'not a directory')
  await expect(readCommittedChain(join(base, 'file', 'python'), interpreter, scope)).rejects.toThrow()
  expect(await readFile(join(base, 'file'), 'utf8')).toBe('not a directory')
}))

// Public DSH component regression, not real-model/application acceptance.
test('official update claims remain readable through warm and cold snapshot-status without writer activation', () => fixture(async base => {
  const root = join(base, 'storage')
  const { produced, status } = await publicStatus(root, true)
  expect(produced.status.provisional.lastGood.claims).toHaveLength(1)
  expect(status.isError, JSON.stringify(status)).toBe(false)
  expect(status.value.provisional).toEqual(produced.status.provisional)
  const bytes = await readFile(join(root, 'deltas.json'))
  const before = await lstat(join(root, 'deltas.json'))
  const cold = await publicStatus(root)
  const after = await lstat(join(root, 'deltas.json'))
  expect(cold.isError, JSON.stringify(cold)).toBe(false)
  expect(cold.value.provisional).toEqual(produced.status.provisional)
  expect({ mode: after.mode, ino: after.ino, mtimeMs: after.mtimeMs, ctimeMs: after.ctimeMs }).toEqual({ mode: before.mode, ino: before.ino, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs })
  if (process.platform !== 'win32') expect(after.atimeMs).toBe(before.atimeMs)
  expect(await readFile(join(root, 'deltas.json'))).toEqual(bytes)
}))

test('snapshot-status rejects private canonical claim data hidden below inputShape', () => fixture(async base => {
  const { EvidenceDeltaChain, evidenceDagDeltaInputFromTrace } = await import('../src/core.js')
  const chain = new EvidenceDeltaChain('codex:fresh-status')
  const input = evidenceDagDeltaInputFromTrace({ ...scope, threadId: 'codex:fresh-status', operationId: 'canonical-input-shape', idempotencyKey: 'canonical-input-shape', kind: 'manual', requestedWatermark: '1', trace: [] })
  chain.append({ ...input, payload: {
    ...input.payload,
    claims: [{ id: 'canonical-private', type: 'claim', content: 'must not disclose', inputShape: { accessPolicy: { visibility: 'private' } } }]
  } })
  chain.provisional({ compilerVersion: 'evidence-provisional.v1', policyVersion: 'evidence-provisional-policy.v1' })
  await expect(committedStatus(chain, scope, async () => { throw Error('unexpected snapshot read') })).rejects.toThrow('restricted evidence')
}))

test('snapshot-status preserves DTO inputShape exemption inside persisted trace', async () => {
  const { EvidenceDeltaChain, evidenceDagDeltaInputFromTrace } = await import('../src/core.js')
  const chain = new EvidenceDeltaChain('codex:fresh-status')
  const input = evidenceDagDeltaInputFromTrace({ ...scope, threadId: 'codex:fresh-status', operationId: 'dto-input-shape', idempotencyKey: 'dto-input-shape', kind: 'manual', requestedWatermark: '1', trace: [] })
  chain.append({ ...input, payload: {
    ...input.payload,
    trace: [{ inputShape: { accessPolicy: { visibility: 'private' } } }]
  } })
  chain.provisional({ compilerVersion: 'evidence-provisional.v1', policyVersion: 'evidence-provisional-policy.v1' })
  await expect(committedStatus(chain, scope, async () => { throw Error('unexpected snapshot read') })).resolves.toMatchObject({ provisional: { lastGood: expect.any(Object) } })
})

test('snapshot-status ignores scope and availability words in tool DTO/schema projections', () => fixture(async base => {
  const { EvidenceDeltaChain, evidenceDagDeltaInputFromTrace } = await import('../src/core.js')
  const chain = new EvidenceDeltaChain('codex:fresh-status')
  const graph: any = {
    thread_id: 'codex:fresh-status', nodes: [{ id: 'public:claim', type: 'claim', content: 'public component' }],
    edges: [], meta: { scope: { workspaceRoot: scope.workspaceRoot } }, artifact_registry: { artifacts: [], sourceAnchors: [], artifactVersions: [] }
  }
  const input = evidenceDagDeltaInputFromTrace({ ...scope, threadId: 'codex:fresh-status', operationId: 'dto', idempotencyKey: 'dto-regression', kind: 'manual', requestedWatermark: '1', trace: [] })
  chain.append({ ...input, payload: {
    ...input.payload, graph, claims: graph.nodes,
    trace: [{ detail: [{ text: [{ scope: 'workspace', inputShape: { properties: { availability: { type: 'string' }, accessPolicy: { type: 'object' } } } }] }], output: [] }]
  } })
  const provisional = chain.provisional({ compilerVersion: 'evidence-provisional.v1', policyVersion: 'evidence-provisional-policy.v1' })
  const root = join(base, 'storage')
  await mkdir(root)
  await writeFile(join(root, 'deltas.json'), JSON.stringify({ version: 1, chains: [{ threadId: 'codex:fresh-status', records: chain.list(), provisional }] }))
  const result = await publicStatus(root)
  expect(result.isError, JSON.stringify(result)).toBe(false)
}))

// Uncommitted canonical claims are derived from a whole graph. A disconnected
// restricted Artifact/anchor must deny the entire response, not a partial view.
test.each(['artifact', 'anchor', 'availability', 'unknown-availability', 'malformed-availability', 'scope', 'malformed-scope', 'opaque-policy'])('snapshot-status rejects complete provisional disclosure for %s restrictions', kind => fixture(async base => {
  const { EvidenceDeltaChain, evidenceDagDeltaInputFromTrace } = await import('../src/core.js')
  const chain = new EvidenceDeltaChain('codex:fresh-status')
  const policy = { visibility: 'private' }
  const graph: any = { thread_id: 'codex:fresh-status', nodes: [{ id: 'public:claim', type: 'claim', content: 'public component' }], edges: [], meta: { scope: { workspaceRoot: scope.workspaceRoot } }, artifact_registry: { artifacts: [{ artifactId: 'secret:artifact', accessPolicy: kind === 'artifact' ? policy : {} }], sourceAnchors: [{ anchorId: 'secret:anchor', accessPolicy: kind === 'anchor' ? policy : {} }], artifactVersions: [{ availability: kind === 'availability' ? 'restricted' : kind === 'unknown-availability' ? 'future' : kind === 'malformed-availability' ? null : 'available' }] } }
  if (kind === 'scope') graph.meta.scope.accessPolicy = policy
  if (kind === 'malformed-scope') graph.meta.scope = 'invalid'
  if (kind === 'opaque-policy') graph.meta.scope.accessPolicy = { futurePolicy: 'allow' }
  const input = evidenceDagDeltaInputFromTrace({ ...scope, threadId: 'codex:fresh-status', operationId: 'one', idempotencyKey: 'safety-control-one', kind: 'manual', requestedWatermark: '1', trace: [] })
  chain.append({ ...input, payload: { ...input.payload, graph, claims: graph.nodes } })
  const provisional = chain.provisional({ compilerVersion: 'evidence-provisional.v1', policyVersion: 'evidence-provisional-policy.v1' })
  await mkdir(join(base, 'storage'))
  await writeFile(join(base, 'storage/deltas.json'), JSON.stringify({ version: 1, chains: [{ threadId: 'codex:fresh-status', records: chain.list(), provisional }] }))
  const result = await publicStatus(join(base, 'storage'))
  expect(result.isError, JSON.stringify(result)).toBe(true)
  expect(JSON.stringify(result)).not.toMatch(/secret:artifact|secret:anchor|public component/)
}))

// Post-implementation descriptor race controls; wrapper instruments Python's
// real openat after descriptor acquisition, never substitutes returned bytes.
const posixTest = process.platform === 'win32' ? test.skip : test
posixTest.each(['storage', 'ancestor'])('descriptor traversal retains the captured %s across a rename and hostile symlink replacement', boundary => fixture(async base => {
  const root = join(base, 'ancestor', 'storage'), foreign = join(base, 'foreign')
  await mkdir(root, { recursive: true }); await mkdir(foreign)
  await writeFile(join(foreign, 'deltas.json'), 'foreign-invalid-data')
  const foreignBytes = await readFile(join(foreign, 'deltas.json'))
  const foreignBefore = await lstat(join(foreign, 'deltas.json'))
  const ready = join(base, 'ready'), release = join(base, 'release'), executable = join(base, 'held-interpreter')
  await writeFile(executable, `#!${interpreter}
import os,sys,time
real_open=os.open
def held_open(path,*args,**kwargs):
 fd=real_open(path,*args,**kwargs)
 if path==${JSON.stringify(boundary)}:
  with open(${JSON.stringify(ready)},'w') as stream: stream.write(str(os.getpid()))
  deadline=time.monotonic()+5
  while not os.path.exists(${JSON.stringify(release)}):
   if time.monotonic()>deadline: raise TimeoutError('barrier')
   time.sleep(.005)
 return fd
os.open=held_open
exec(sys.argv[4])
`)
  await chmod(executable, 0o700)
  const pending = readCommittedChain(root, executable, scope)
  // Attach the rejection observer before waiting for instrumentation readiness.
  const settled = pending.then(value => ({ value }), error => ({ error }))
  try {
    const deadline = Date.now() + 4000
    while (!(await lstat(ready).catch(() => null))) {
      if (Date.now() > deadline) throw Error('reader barrier not reached')
      await new Promise(resolve => setTimeout(resolve, 5))
    }
    const target = boundary === 'storage' ? root : join(base, 'ancestor')
    await rename(target, target + '-captured')
    await symlink(foreign, target)
    await writeFile(release, '')
    const result = await settled
    expect(result).not.toHaveProperty('error')
    if ('value' in result) expect(result.value.head.rootKind).toBe('empty')
    const foreignAfter = await lstat(join(foreign, 'deltas.json'))
    expect([foreignAfter.ino, foreignAfter.mode, foreignAfter.mtimeMs, foreignAfter.ctimeMs, foreignAfter.atimeMs]).toEqual([foreignBefore.ino, foreignBefore.mode, foreignBefore.mtimeMs, foreignBefore.ctimeMs, foreignBefore.atimeMs])
    expect(await readFile(join(foreign, 'deltas.json'))).toEqual(foreignBytes)
    const pid = Number(await readFile(ready, 'utf8'))
    expect(() => process.kill(pid, 0)).toThrow()
    await expect(readCommittedChain(root, interpreter, scope)).rejects.toThrow()
  } finally { await writeFile(release, ''); await settled }
}))

test('production committed.status preserves Host workspace/lease/effect binding on missing storage without admitting the worker', () => fixture(async base => {
  const { createEvidenceProductionService } = await import('@sciforge/domain-evidence-dag/host/production-service')
  const identity = { pluginId: 'status-test', version: '1', profileId: 'isolated' }
  let reads = 0
  const owner = createEvidenceProductionService({ identity, storageRoot: join(base, 'state'), storageInterpreter: interpreter, clientModule: 'unused',
    worker: { executable: interpreter, storageRoot: join(base, 'python'), home: join(base, 'home'), tmpDir: join(base, 'tmp'), wheelPath: process.env.EVIDENCE_TEST_WHEEL!, wheelSha256: '0'.repeat(64), reasoner: async () => { throw Error('no model admitted') } },
    threads: { read: async (requested, context) => { reads++; context.assertCurrent(); expect(requested).toEqual(scope); expect(context.ordinarySession).toBeUndefined(); return { ...scope, watermark: '0', trace: [] } }, list: async () => [] },
    artifacts: { invoke: async () => { throw Error('no artifact effect admitted') } },
  })
  const request: any = { requestId: 'status', serviceId: 'evidenceDagPorts', operation: 'committed.status', signal: new AbortController().signal, assertCurrent() {},
    input: { protocol: 'sciforge-evidence-ports.v1', operation: 'committed.status', identity, scope },
    owner: { connectionId: 'c', pluginId: identity.pluginId, packageName: identity.pluginId, version: '1', generation: 1, invocationId: 'status', authority: { effect: 'read', caller: { workspaceId: scope.workspaceRoot } } },
  }
  const status = owner.providers.evidenceDagPorts.operations['committed.status']
  try {
    expect(await status(request)).toMatchObject({ committed: null, provisional: null, authoritativeHead: { rootKind: 'empty' } })
    expect(reads).toBe(1)
    await expect(status({ ...request, assertCurrent() { throw Error('revoked') } })).rejects.toThrow('revoked')
    await expect(status({ ...request, input: { ...request.input, scope: { ...scope, workspaceRoot: '/foreign' } } })).rejects.toThrow('workspace authority')
    await expect(status({ ...request, owner: { ...request.owner, authority: { ...request.owner.authority, effect: 'compute' } } })).rejects.toThrow('not authorized')
    expect(reads).toBe(1)
    expect(owner.worker.pid).toBeUndefined()
    expect(await readdir(base)).toEqual([])
  } finally { await owner.close() }
}))
