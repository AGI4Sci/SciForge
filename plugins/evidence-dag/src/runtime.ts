import { createEvidenceArtifactVersionClient, evidenceArtifactVersionIdentities, mergeLifecycleProjection } from '../../../packages/domains/evidence-dag/src/main/artifact-version-client.js'
import { EvidenceArtifactVersionLifecycleConsumer } from '../../../packages/domains/evidence-dag/src/main/artifact-version-lifecycle-consumer.js'
import { artifactVersionCommitResultV1Schema, artifactVersionReadResultV1Schema, artifactVersionEventListResultV1Schema } from '@sciforge/domain-artifact-versions/contract'
import { commitEvidenceSnapshotProducts } from '../../../packages/domains/evidence-dag/src/main/snapshot-products.js'
import type { EvidenceDagSnapshotProductsProjection } from '../../../packages/domains/evidence-dag/src/main/client.js'
import { randomUUID } from 'node:crypto'
import { projectEvidenceTrace } from './trace-projection.js'
import { awaitQuiescence } from '@sciforge/domain-evidence-dag/host/quiescence'
import { AsyncLocalStorage } from 'node:async_hooks'
import { join } from 'node:path'
import { EvidenceDagDeltaStore, evidenceDagDeltaInputFromTrace, evidenceDagCanonicalStatusSchema, evidenceDagUpdateInputSchema, evidenceDagSealClosureInputSchema, evidenceDagCommittedSnapshotSchema, type EvidenceDagSealClosureInput, evidenceDagSidechainAppendInputSchema, evidenceDagSidechainAppendOutputSchema, type EvidenceDagSidechainAppendInput, evidenceDagExportSnapshotProductsInputSchema, type EvidenceDagExportSnapshotProductsInput } from './core.js'
import { PORTS_VERSION, type EvidencePorts, type Scope, type ThreadProjection, type PortRequest, type Json, type Caller } from '@sciforge/domain-evidence-dag/host/ports'

/** Adapter orchestration, not a Host Context or a second evidence database. */
export class EvidenceRuntime {
  private readonly invocation = new AsyncLocalStorage<{ caller: Caller; signal: AbortSignal }>()
  withInvocation<T>(caller: Caller, signal: AbortSignal, action: () => Promise<T>): Promise<T> {
    return this.invocation.run({ caller, signal }, action)
  }
  readonly store: EvidenceDagDeltaStore
  private readonly lifecycle: EvidenceArtifactVersionLifecycleConsumer
  private closing = false
  private closeAttempt: Promise<void> | undefined
  private tail: Promise<unknown> = Promise.resolve()
  private readonly admitted = new Set<Promise<unknown>>()
  private readonly activeRequests = new Map<string, () => Promise<void>>()
  private closed = false
  private started = false
  constructor(private readonly ports: EvidencePorts, private readonly options: { now?: () => Date; closeTimeoutMs?: number } = {}) {
    this.store = new EvidenceDagDeltaStore(join(ports.storageRoot, 'deltas.json'))
    this.lifecycle = new EvidenceArtifactVersionLifecycleConsumer({
      storagePath: join(ports.storageRoot, 'artifact-version-lifecycle.json'),
      eventListPort: (workspaceRoot, scope) => ({ listEvents: async (input) => {
        if (!scope || scope.workspaceRoot !== workspaceRoot) throw new Error('Evidence artifact request has no authorized workspace scope.')
        return artifactVersionEventListResultV1Schema.parse(await this.request('artifacts.listEvents', input, scope))
      } }),
      discoverThreads: async (scope) => await this.request('threads.list', {}, scope) as unknown as Scope[],
      prepareThread: async (scope) => { const detail = await this.thread(scope); return { ...scope, targetWatermark: detail.watermark, trace: await this.pin(scope, detail) } },
      identities: evidenceArtifactVersionIdentities, withLifecycle: mergeLifecycleProjection,
      append: (input) => this.store.append(evidenceDagDeltaInputFromTrace({ ...input, threadId: `${input.runtimeId}:${input.threadId}` })),
      now: options.now,
    })
  }
  private now() { return (this.options.now?.() ?? new Date()).toISOString() }
  async start() {
    await this.store.load()
    await this.store.reconcileProvisional({ compilerVersion: 'evidence-provisional.v1', policyVersion: 'evidence-provisional-policy.v1', now: this.now() })
    await this.lifecycle.start(false)
    this.started = true
  }
  private async pin(scope: Scope, detail: ThreadProjection) {
    // Bind ports to this operation's authorized identity, never workspace cache
    // or ambient poll identity (one workspace can contain many threads).
    const client = createEvidenceArtifactVersionClient(
      () => ({ commit: async input => artifactVersionCommitResultV1Schema.parse(await this.request('artifacts.commit', input as unknown as Json, scope)) }),
      () => ({ read: async input => artifactVersionReadResultV1Schema.parse(await this.request('artifacts.read', input as unknown as Json, scope)) }),
    )
    return client.pinTrace(detail.trace, { ...scope, operationId: `manual:${detail.watermark}`, occurredAt: this.now() })
  }
  private async pollLocked(scope: Scope) {
    this.assertLive()
    await this.thread(scope)
    await this.lifecycle.pollNow(true, scope)
  }
  private admit<T>(operation: () => Promise<T>, serial = true): Promise<T> {
    try { this.assertLive() } catch (error) { return Promise.reject(error) }
    const work = serial ? this.tail.then(() => { this.assertLive(); return operation() }) : operation()
    if (serial) this.tail = work.then(() => undefined, () => undefined)
    this.admitted.add(work)
    work.then(() => this.admitted.delete(work), () => this.admitted.delete(work))
    return work
  }
  update(scope: Scope) { return this.admit(() => this.updateLocked(scope)) }
  snapshotStatus(scope: Scope) { return this.admit(() => this.status(scope), false) }
  sealClosure(input: EvidenceDagSealClosureInput) { return this.admit(() => this.sealLocked(input)) }
  exportSnapshotProducts(raw: EvidenceDagExportSnapshotProductsInput) {
    return this.admit(async () => {
      const input = evidenceDagExportSnapshotProductsInputSchema.parse(raw)
      const scope = { runtimeId: input.runtimeId, threadId: input.threadId, workspaceRoot: input.workspaceRoot! }
      await this.thread(scope)
      const threadId = `${scope.runtimeId}:${scope.threadId}`
      const chain = await this.store.chain(threadId)
      const bound = chain.committedSnapshotClosureEntries().some(([, digest]) => digest === input.snapshotDigest)
      const legacy = chain.legacyCheckpointRoot?.status === 'legacy/complete' && chain.legacyCheckpointRoot.snapshot.digest === input.snapshotDigest
      if (!bound && !legacy) throw new Error('Evidence products require a Snapshot bound to a complete closure.')
      const projection = await this.request('sidecar.snapshotProducts', { threadId, snapshotDigest: input.snapshotDigest, workspaceRoot: scope.workspaceRoot, datacite: input.datacite } as unknown as Json, scope) as unknown as EvidenceDagSnapshotProductsProjection
      this.assertLive()
      return commitEvidenceSnapshotProducts({ request: input, engineThreadId: threadId, projection,
        readPort: { read: async request => artifactVersionReadResultV1Schema.parse(await this.request('artifacts.read', request as unknown as Json, scope)) },
        commitPort: { commit: async request => artifactVersionCommitResultV1Schema.parse(await this.request('artifacts.commit', request as unknown as Json, scope)) },
      })
    })
  }
  appendSidechain(raw: EvidenceDagSidechainAppendInput) {
    return this.admit(async () => {
      const input = evidenceDagSidechainAppendInputSchema.parse(raw)
      const scope = { runtimeId: input.runtimeId, threadId: input.threadId, workspaceRoot: input.workspaceRoot! }
      await this.thread(scope)
      this.assertLive()
      return evidenceDagSidechainAppendOutputSchema.parse(await this.store.appendSidechain({ ...input, threadId: `${scope.runtimeId}:${scope.threadId}` }))
    })
  }
  pollArtifactEvents(scope: Scope) { return this.admit(() => this.pollLocked(scope)) }
  private assertLive() {
    this.invocation.getStore()?.signal.throwIfAborted()
    if (this.closed || this.closing || !this.started) throw new Error('Evidence runtime is closing, closed or not live.')
  }
  private async request(operation: PortRequest['operation'], input: Json, scope?: Scope) {
    // Cleanup must remain callable after the shutdown fence (including from
    // an aborted invocation); every ordinary port shares the same live gate.
    const cleanup = operation === 'sidecar.close'
    const context = cleanup ? undefined : this.invocation.getStore()
    if (!cleanup) this.assertLive()
    const requestId = randomUUID()
    let cancellation: Promise<void> | undefined, cancellationFailed = false, confirmed = false
    const releaseOwner = () => {
      if (this.activeRequests.get(requestId) === cancelOwner) this.activeRequests.delete(requestId)
    }
    const cancelOwner = () => {
      if (confirmed) return Promise.resolve()
      if (cancellation && !cancellationFailed) return cancellation
      cancellationFailed = false
      const attempt = awaitQuiescence(Promise.resolve().then(() => this.ports.cancel(requestId)),
        this.options.closeTimeoutMs ?? 5_000, 'request cancellation').then(result => {
        if (result?.quiescent !== true) throw Object.assign(new Error('Evidence cancellation is not quiescent.'), { code: 'CANCEL_NOT_QUIESCENT' })
        if (cancellation === attempt) { confirmed = true; releaseOwner() }
      })
      cancellation = attempt
      // Keep the rejected attempt observable by the original request. Only
      // the next cancellation attempt replaces it, never its rejection value.
      attempt.catch(() => { if (cancellation === attempt) cancellationFailed = true })
      return attempt
    }
    const abort = () => { void cancelOwner().catch(() => undefined) }
    if (operation !== 'sidecar.close') this.activeRequests.set(requestId, cancelOwner)
    context?.signal.addEventListener('abort', abort, { once: true })
    try {
      const value = await this.ports.request({ protocol: PORTS_VERSION, requestId, identity: this.ports.identity, operation, input, ...(scope ? { scope } : {}), ...(context ? { caller: context.caller } : {}) })
      if (cancellation) await cancellation
      // Exact quiescence confirms effect-stop, not permission to resume a
      // closed call chain and dispatch its next irreversible effect.
      if (!cleanup) this.assertLive()
      return value
    } finally {
      // Settlement is not effect-stop confirmation. Only ordinary requests
      // or an explicitly quiescent cancellation can release this owner.
      if (!cancellation || confirmed) releaseOwner()
      context?.signal.removeEventListener('abort', abort)
      if (cancellation) await cancellation
    }
  }
  private async thread(scope: Scope) {
    const result = await this.request('threads.read', {}, scope) as unknown as ThreadProjection
    this.assertLive()
    if (result.runtimeId !== scope.runtimeId || result.threadId !== scope.threadId || result.workspaceRoot !== scope.workspaceRoot || !Array.isArray(result.trace)) {
      throw new Error('Evidence thread projection does not match the requested scope.')
    }
    return result
  }
  private async updateLocked(raw: Scope) {
    this.assertLive()
    const scope = evidenceDagUpdateInputSchema.parse(raw) as Scope
    const detail = await this.thread(scope)
    this.assertLive()
    const trace = await this.pin(scope, detail)
    await this.lifecycle.rememberThread({ ...scope, targetWatermark: detail.watermark, trace })
    this.assertLive()
    const id = `${scope.runtimeId}:${scope.threadId}`
    const projected = projectEvidenceTrace(trace)
    const extracted = await this.request('sidecar.extract', {
      threadId: id, targetWatermark: detail.watermark, trace: projected,
      workspaceRoot: scope.workspaceRoot, reason: 'manual',
      idempotencyKey: `extract:${id}:${detail.watermark}`,
    } as unknown as Json, scope) as unknown as { snapshot?: Record<string, unknown>; graph?: { thread_id: string; nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> } }
    if (!extracted.snapshot || !extracted.graph || extracted.graph.thread_id !== id || !Array.isArray(extracted.graph.nodes) || !Array.isArray(extracted.graph.edges)) throw new Error('Evidence canonical extractor returned no scoped graph.')
    const append = evidenceDagDeltaInputFromTrace({ ...scope, threadId: id, trace: projected, operationId: `manual:${detail.watermark}`, kind: 'manual', requestedWatermark: detail.watermark, idempotencyKey: `manual:${id}:${detail.watermark}` })
    // Persist the canonical objects, not the model's temporary IDs or an
    // in-memory Snapshot shortcut. Closure and cold replay use this same graph.
    const result = await this.store.append({ ...append, payload: { ...append.payload, graph: extracted.graph, claims: extracted.graph.nodes.filter(node => node.type === 'claim' || node.type === 'conclusion') } })
    const head = await this.store.head(id)
    await this.store.compileProvisional(id, { compilerVersion: 'evidence-provisional.v1', policyVersion: 'evidence-provisional-policy.v1', desiredHeadDigest: head.headDigest, now: this.now() })
    return { threadId: id, itemCount: detail.trace.length, deltaDigest: result.delta.deltaDigest, idempotent: result.idempotent, status: await this.status(scope) }
  }
  private async sealLocked(raw: EvidenceDagSealClosureInput) {
    this.assertLive()
    const input = evidenceDagSealClosureInputSchema.parse(raw)
    const scope = { runtimeId: input.runtimeId, threadId: input.threadId, workspaceRoot: input.workspaceRoot! }
    await this.thread(scope)
    const threadId = `${scope.runtimeId}:${scope.threadId}`
    // Canonical seal validates idempotent replay policy; never bypass it by
    // looking up the receipt first (changed-policy replay must fail closed).
    const closure = await this.store.seal(threadId, input.policy, input.idempotencyKey)
    const bound = await this.store.chain(threadId)
    if (closure.status !== 'complete' || bound.committedSnapshotClosureEntries().some(([digest]) => digest === closure.closureDigest)) return closure
    const included = new Set(closure.includedDeltaDigests)
    const trace = bound.list().filter(record => included.has(record.deltaDigest)).map(delta => ({ kind: 'sciforge.evidence-delta-envelope.v1', schemaVersion: 'sciforge.evidence-delta-envelope.v1', delta }))
    this.assertLive()
    const result = await this.request('sidecar.commitSnapshot', { threadId, trace, targetWatermark: input.policy.barrierWatermark, workspaceRoot: scope.workspaceRoot, idempotencyKey: input.idempotencyKey } as unknown as Json, scope) as unknown as { snapshot: Record<string, unknown> }
    const snapshot = evidenceDagCommittedSnapshotSchema.parse(Object.fromEntries(Object.keys(evidenceDagCommittedSnapshotSchema.shape).filter(key => key in result.snapshot).map(key => [key, result.snapshot[key]])))
    if (snapshot.threadId !== threadId || snapshot.inputWatermark !== input.policy.barrierWatermark) throw new Error('Evidence Snapshot thread/barrier mismatch.')
    const verified = await this.request('sidecar.readSnapshot', { threadId, snapshotDigest: snapshot.digest, workspaceRoot: scope.workspaceRoot }, scope) as unknown as { snapshot: { digest: string } }
    if (verified.snapshot?.digest !== snapshot.digest) throw new Error('Evidence persisted Snapshot integrity mismatch.')
    await this.store.recordCommittedSnapshot(threadId, snapshot, closure.closureDigest)
    return closure
  }
  private async status(scope: Scope) {
    this.assertLive()
    await this.thread(scope)
    const chain = await this.store.chain(`${scope.runtimeId}:${scope.threadId}`)
    const first = chain.list()[0]
    if (first && (first.scope.workspaceRoot !== scope.workspaceRoot || first.scope.runtimeId !== scope.runtimeId)) throw new Error('Evidence persisted scope mismatch.')
    const head = chain.head
    const provisional = chain.provisionalView
    const summary = provisional?.summary
    const committed = chain.committedEvidenceSnapshot ?? null
    return evidenceDagCanonicalStatusSchema.parse({ committed, pending: null, updatedAt: [head.updatedAt, provisional?.updatedAt, committed?.createdAt].filter(Boolean).sort().at(-1) ?? this.now(), authoritativeHead: head, provisional,
      desiredHeadDigest: summary?.desiredHeadDigest ?? head.headDigest, appliedHeadDigest: summary?.appliedHeadDigest ?? null, freshness: summary?.freshness ?? 'unknown', coverage: summary?.coverage ?? { complete: false, gapCount: 0 }, materialRiskCount: summary?.materialRiskCount ?? 0, lastSuccessAt: summary?.lastSuccessAt ?? null, failure: summary?.failure ?? null })
  }
  close(): Promise<void> {
    if (this.closed) return Promise.resolve()
    this.closing = true
    if (this.closeAttempt) return this.closeAttempt
    const attempt = this.closeOnce()
    this.closeAttempt = attempt
    attempt.catch(() => { if (this.closeAttempt === attempt) this.closeAttempt = undefined })
    return attempt
  }
  private async closeOnce() {
    const timeout = this.options.closeTimeoutMs ?? 5_000
    // Stop the producer before waiting for work that only that producer can
    // settle. Both cancellation and stop are driven even if either fails.
    const cancelling = [...this.activeRequests.values()].map(cancel => cancel())
    const stopped = this.request('sidecar.close', {}).then(value => {
      if ((value as { exited?: boolean }).exited !== true) throw new Error('Evidence sidecar exit is unconfirmed.')
    })
    const failures: unknown[] = []
    try {
      const outcomes = await awaitQuiescence(Promise.allSettled([...cancelling, stopped]), timeout, 'producer stop')
      for (const outcome of outcomes) if (outcome.status === 'rejected') failures.push(outcome.reason)
    } catch (error) { failures.push(error) }
    try { await awaitQuiescence(Promise.allSettled([...this.admitted]), timeout, 'admitted operations') } catch (error) { failures.push(error) }
    try { await awaitQuiescence(this.lifecycle.close(), timeout, 'lifecycle drain') } catch (error) { failures.push(error) }
    if (failures.length) throw new AggregateError(failures, 'Evidence runtime close failed.')
    this.closed = true
  }
}
