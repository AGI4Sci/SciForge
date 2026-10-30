import { it, expect } from 'vitest'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { EvidenceRuntime } from '../src/runtime.js'
import { EvidenceDagDeltaStore } from '../src/core.js'
import { PythonEvidenceWorker } from '@sciforge/domain-evidence-dag/host/python-worker'
import { workerOptions, syntheticReasoner } from './worker-fixture.js'

const live = (pid: number) => { try { process.kill(pid, 0); return true } catch { return false } }
const observe = <T>(work: Promise<T>, ms: number) => new Promise<{ value?: T; error?: unknown; timedOut?: true }>(resolve => {
  const timer = setTimeout(() => resolve({ timedOut: true }), ms)
  work.then(value => { clearTimeout(timer); resolve({ value }) }, error => { clearTimeout(timer); resolve({ error }) })
})

// Real formally built wheel + controlled reasoning: component acceptance only,
// not a real Agent/model/application acceptance test.
it.each([true, false])('close cancels admitted real-wheel seal review without committing; cooperative=%s', async cooperative => {
  const options = await workerOptions()
  let enter!: () => void, release!: () => void
  const entered = new Promise<void>(resolve => { enter = resolve })
  const held = new Promise<void>(resolve => { release = resolve })
  let reviewing = false, aborted = false, reasonerSettled = false, reviewTask = ''
  const worker = new PythonEvidenceWorker({ ...options, closeTimeoutMs: 200, reasoner: async (input, signal) => {
    if (reviewing) {
      const system = (input as any).messages.find((message: any) => message.role === 'system')?.content ?? ''
      // Only independent seal verification may satisfy the barrier. A second
      // extraction is a regression, not an acceptable substitute for review.
      expect(system).toMatch(/EDAG-TASK: (nli|adversarial)/)
      reviewTask = system.split('\n')[0]
      signal.addEventListener('abort', () => { aborted = true; if (cooperative) release() }, { once: true })
      enter()
      try { await held; return await syntheticReasoner(input) } finally { reasonerSettled = true }
    }
    return syntheticReasoner(input)
  } })
  const scope = { runtimeId: 'codex', threadId: 'seal-review', workspaceRoot: join(options.root, 'workspace') }
  const operations: string[] = [], cancellations: string[] = [], cancellationAcks: string[] = []
  let commitRequestId: string | undefined, commitReturned = false
  const runtime = new EvidenceRuntime({
    identity: { pluginId: 'sciforge-evidence-dag', version: '1.0.0', profileId: 'synthetic' }, storageRoot: join(options.root, 'js'),
    request: async request => {
      operations.push(request.operation)
      if (request.operation === 'threads.read') return { ...scope, watermark: '1', trace: [{ id: 't1', content: 'Synthetic' }] }
      if (request.operation === 'sidecar.extract') return worker.request('extract', request.input)
      if (request.operation === 'sidecar.commitSnapshot') {
        commitRequestId = request.requestId
        const result = await worker.request('commitSnapshot', request.input)
        commitReturned = true
        return result
      }
      if (request.operation === 'sidecar.readSnapshot') return worker.request('readSnapshot', request.input)
      if (request.operation === 'sidecar.close') { await worker.close(); return { exited: true } }
      throw Error('unsupported ' + request.operation)
    },
    cancel: async id => {
      cancellations.push(id)
      await worker.close()
      await worker.waitForQuiescence()
      cancellationAcks.push(id)
      return { cancelled: true, quiescent: true }
    },
  }, { closeTimeoutMs: 400 })
  let sealing: Promise<unknown> | undefined, closing: Promise<void> | undefined
  try {
    await runtime.start()
    const update = await runtime.update(scope)
    const claims = update.status.provisional?.lastGood?.claims as Array<{ id: string }>
    expect(claims).toHaveLength(1)
    const targetClaimIds = claims.map(claim => claim.id)
    const chain = await runtime.store.chain('codex:seal-review')
    const before = structuredClone(chain.list())
    expect(before).toHaveLength(1)
    expect(chain.committedEvidenceSnapshot).toBeNull()
    const pid = worker.pid!
    expect(live(pid)).toBe(true)
    reviewing = true
    sealing = runtime.sealClosure({ ...scope, idempotencyKey: 'blocked-independent-review', policy: {
      version: 'EvidenceClosurePolicyV1', targetClaimIds, expectedHeadDigest: update.status.authoritativeHead!.headDigest!, barrierWatermark: '1',
      edgeFamilies: [], directions: ['inbound'], maxDepth: 0, termination: 'depth', expandEquivalent: false, expandRefinement: false,
      cycleHandling: 'allow', unknownEdgeHandling: 'ignore', requiredRecords: [], requiredExternalRefs: [],
    } }).then(value => ({ receipt: value }), error => error)
    expect((await observe(entered, 3000)).timedOut).not.toBe(true)
    expect(reviewTask).toMatch(/EDAG-TASK: (nli|adversarial)/)
    expect(commitRequestId).toBeDefined()
    expect(operations.filter(operation => operation === 'sidecar.extract')).toHaveLength(1)
    expect(operations.filter(operation => operation === 'sidecar.commitSnapshot')).toHaveLength(1)
    expect(chain.list()).toEqual(before)
    expect(chain.committedSnapshotClosureEntries()).toEqual([])
    expect(reasonerSettled).toBe(false)
    closing = runtime.close()
    const result = await observe(closing, 1500)
    expect(result.timedOut).not.toBe(true)
    expect(aborted).toBe(true)
    expect(cancellations).toEqual([commitRequestId])
    expect(operations).toContain('sidecar.close')
    expect(live(pid)).toBe(false)
    if (cooperative) {
      expect(result.error).toBeUndefined()
      expect(reasonerSettled).toBe(true)
      expect(cancellationAcks).toEqual([commitRequestId])
    } else {
      expect(result.error).toBeInstanceOf(AggregateError)
      expect(reasonerSettled).toBe(false)
      expect(cancellationAcks).toEqual([])
      // OS exit/request rejection cannot stand in for real producer settlement.
      const quiescence = worker.waitForQuiescence()
      expect(await observe(quiescence, 50)).toEqual({ timedOut: true })
      expect(chain.committedEvidenceSnapshot).toBeNull()
      expect(chain.list()).toEqual(before)
      release()
      await quiescence
      expect(reasonerSettled).toBe(true)
      const retry = runtime.close()
      expect(runtime.close()).toBe(retry)
      await retry
      expect(cancellations).toEqual([commitRequestId, commitRequestId])
      expect(cancellationAcks).toEqual([commitRequestId])
    }
    await worker.waitForQuiescence()
    expect(await sealing).toBeInstanceOf(Error)
    expect(commitReturned).toBe(false)
    expect(operations).not.toContain('sidecar.readSnapshot')
    expect(chain.list()).toEqual(before)
    expect(chain.committedEvidenceSnapshot).toBeNull()
    expect(chain.committedSnapshotClosureEntries()).toEqual([])
    // Seal may persist a complete closure intent; it must not persist a false
    // committed Snapshot binding or mutate any immutable update record.
    const durable = await readFile(join(options.root, 'js/deltas.json'), 'utf8')
    expect(durable.length).toBeGreaterThan(0)
    const cold = new EvidenceDagDeltaStore(join(options.root, 'js/deltas.json'))
    await cold.load()
    const restored = await cold.chain('codex:seal-review')
    expect(restored.list()).toEqual(before)
    expect(restored.committedEvidenceSnapshot).toBeNull()
    expect(restored.committedSnapshotClosureEntries()).toEqual([])
    console.log('R4_SEAL_REVIEW', JSON.stringify({ cooperative, pid, exited: !live(pid), reviewTask, commitRequestId, cancellations, cancellationAcks, reasonerSettled, commitReturned, immutableRecords: before.length, coldCommitted: restored.committedEvidenceSnapshot }))
  } finally {
    release()
    await sealing
    await closing?.catch(() => undefined)
    await worker.close()
    await runtime.close()
  }
}, 15000)
