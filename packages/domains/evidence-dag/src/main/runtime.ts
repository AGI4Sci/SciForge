import { appendCheckpointArtifactTrace } from './checkpoint-artifact-trace.js'
import { readHumanReviews } from './human-review-read.js'
import { evidenceDagRerunSpecInputSchema, evidenceDagRerunCompareInputSchema, type EvidenceDagRerunSpecInput, type EvidenceDagRerunCompareInput } from '../contract.js'
import { verifyProducerArtifactRefs } from './producer-artifact-refs.js'
import { join, resolve } from 'node:path'
import { lstat, readdir } from 'node:fs/promises'
import { prepareEvidenceStorage } from './secure-storage.js'
import type {
  ArtifactVersionCommitPortV1,
  ArtifactVersionEventListPortV1,
  ArtifactVersionReadPortV1
} from '@sciforge/domain-artifact-versions/contract'
import { domainPackageJsonValueSchema } from '@sciforge/domain-sdk'
import type {
  DomainArtifactEvent,
  DomainMainActionGuardResult,
  DomainMainRuntimeLifecycleContext,
  DomainMainRuntimeDisposer
} from '@sciforge/domain-sdk/host'
import { domainArtifactEventScope } from '@sciforge/domain-sdk/host'
import {
  evidenceDagActivationPayloadSchema,
  evidenceDagAuditQueryInputSchema,
  evidenceDagAuditQueryOutputSchema,
  evidenceDagCanonicalStatusSchema,
  evidenceDagExportSnapshotProductsInputSchema,
  evidenceDagPreviewInputSchema,
  evidenceDagPreviewOutputSchema,
  evidenceDagPriorityInputSchema,
  evidenceDagPriorityOutputSchema,
  evidenceDagSealClosureInputSchema,
  evidenceDagSealClosureOutputSchema,
  evidenceDagSnapshotStatusInputSchema,
  evidenceDagSnapshotStatusOutputSchema,
  evidenceDagSidechainAppendInputSchema,
  evidenceDagSidechainAppendOutputSchema,
  evidenceDagUpdateInputSchema,
  evidenceDagUpdateOutputSchema,
  evidenceDagViewInputSchema,
  evidenceDagViewOutputSchema,
  type EvidenceDagCanonicalStatus,
  type EvidenceDagAuditQueryInput,
  type EvidenceDagAuditQueryOutput,
  type EvidenceDagDelta,
  type EvidenceDagExportSnapshotProductsInput,
  type EvidenceDagExportSnapshotProductsOutput,
  type EvidenceDagPreviewInput,
  type EvidenceDagPreviewOutput,
  type EvidenceDagPriorityInput,
  type EvidenceDagSealClosureInput,
  type EvidenceDagSealClosureOutput,
  type EvidenceDagSnapshotStatusInput,
  type EvidenceDagSidechainAppendInput,
  type EvidenceDagSidechainAppendOutput,
  type EvidenceDagUpdateInput,
  type EvidenceDagUpdateOutput,
  type EvidenceDagViewInput,
  type EvidenceDagViewOutput
} from '../contract.js'
import {
  evidenceTraceFromArtifactEvent,
  evidenceTraceFromThread
} from './artifacts.js'
import { artifactVersionCommitPort, artifactVersionEventListPort, artifactVersionReadPort } from './artifact-version-static-ports.js'
import {
  createEvidenceArtifactVersionClient,
  type EvidenceArtifactVersionClient
} from './artifact-version-client.js'
import {
  EvidenceArtifactVersionLifecycleConsumer,
  type EvidenceArtifactLifecycleThread,
  type EvidenceArtifactLifecycleThreadKey
} from './artifact-version-lifecycle-consumer.js'
import {
  EvidenceDagServiceClient,
  evidenceDagThreadId
} from './client.js'
import { resolveEvidenceDagPreview } from './preview.js'
import {
  EVIDENCE_DAG_WRITE_EXPORT_ACTION,
  evidenceDagAuditForGate,
  evidenceDagWriteExportGuardPayloadSchema,
  evaluateEvidenceDagHighImpactGate
} from './gate.js'
import {
  EvidenceDagSidecar,
  type EvidenceDagSidecarPort
} from './sidecar.js'
import {
  EvidenceDagDeltaStore,
  evidenceDagDeltaInputFromTrace,
  type EvidenceDagAppendResult,
  type EvidenceDagTraceAppendInput
} from './evidence-delta.js'
import { commitEvidenceSnapshotProducts } from './snapshot-products.js'
import {
  EvidenceProducerProvenanceConsumer,
  type EvidenceProducerPreparation,
  type EvidenceProducerReceipt
} from './producer-provenance-consumer.js'
import { scientificPlottingReceiptAdapter } from './scientific-plotting-receipt-adapter.js'
import { ResearchRecordRuntime } from './research-record.js'
import { prepareSubmittedClaims } from './claim-submission.js'
import { evidenceDagSubmitClaimsInputSchema, evidenceDagSubmitClaimsOutputSchema, type EvidenceDagSubmitClaimsInput, type EvidenceDagSubmitClaimsOutput } from '../contract.js'

export type EvidenceDagRuntimePort = Readonly<{
  records: Pick<ResearchRecordRuntime, 'view' | 'edit' | 'review' | 'audit' | 'submitHumanReview'>
  activate(context: DomainMainRuntimeLifecycleContext): Promise<DomainMainRuntimeDisposer>
  consume(event: DomainArtifactEvent): Promise<void>
  view(input: EvidenceDagViewInput): Promise<EvidenceDagViewOutput>
  snapshotStatus(input: EvidenceDagSnapshotStatusInput): Promise<EvidenceDagCanonicalStatus>
  sealClosure(input: EvidenceDagSealClosureInput): Promise<EvidenceDagSealClosureOutput>
  appendSidechain(input: EvidenceDagSidechainAppendInput): Promise<EvidenceDagSidechainAppendOutput>
  update(input: EvidenceDagUpdateInput): Promise<EvidenceDagUpdateOutput>
  submitClaims(input: EvidenceDagSubmitClaimsInput): Promise<EvidenceDagSubmitClaimsOutput>
  priority(input: EvidenceDagPriorityInput): Promise<EvidenceDagCanonicalStatus>
  preview(input: EvidenceDagPreviewInput): Promise<EvidenceDagPreviewOutput>
  exportSnapshotProducts(
    input: EvidenceDagExportSnapshotProductsInput
  ): Promise<EvidenceDagExportSnapshotProductsOutput>
  auditQuery(
    input: EvidenceDagAuditQueryInput & Readonly<{ workspaceRoot?: string }>
  ): Promise<EvidenceDagAuditQueryOutput>
  rerunSpec(input: EvidenceDagRerunSpecInput): ReturnType<EvidenceDagServiceClient['rerunSpec']>
  rerunCompare(input: EvidenceDagRerunCompareInput): ReturnType<EvidenceDagServiceClient['rerunCompare']>
  guardWriteExport(payload: unknown): Promise<DomainMainActionGuardResult>
  close(): Promise<void>
}>

/**
 * Enforces the protected Windows DACL for every evidence file that startup
 * opens, in one asynchronous batch. The synchronous storage primitive spawns
 * PowerShell and compiles its C# bridge per file identity (~3s each), so
 * pre-authorizing this known set removes that from the synchronous read path.
 */
async function preauthorizeEvidenceStorage(root: string): Promise<void> {
  if (process.platform !== 'win32') return
  const rootInfo = await lstat(root, { bigint: true }).catch(() => undefined)
  if (!rootInfo?.isDirectory()) return
  const entries: { path: string; dev: bigint; ino: bigint; directory: boolean }[] = [
    { path: root, dev: rootInfo.dev, ino: rootInfo.ino, directory: true }
  ]
  const names = await readdir(root).catch(() => [] as string[])
  for (const name of names) {
    if (!name.endsWith('.json')) continue
    const filePath = join(root, name)
    const info = await lstat(filePath, { bigint: true }).catch(() => undefined)
    if (info?.isFile() && info.nlink === 1n) {
      entries.push({ path: filePath, dev: info.dev, ino: info.ino, directory: false })
    }
  }
  await prepareEvidenceStorage(entries)
}

export class EvidenceDagRuntime implements EvidenceDagRuntimePort {
  readonly records: ResearchRecordRuntime
  private context: DomainMainRuntimeLifecycleContext | undefined
  private enabled = false
  private closed = false
  private derivationEpoch = 0
  private closePromise: Promise<void> | undefined
  private enablementDisposer: DomainMainRuntimeDisposer | undefined
  private readonly sidecar: EvidenceDagSidecarPort
  private readonly client: EvidenceDagServiceClient
  private readonly artifactVersions: EvidenceArtifactVersionClient
  private readonly artifactVersionLifecycle: EvidenceArtifactVersionLifecycleConsumer
  private readonly producerProvenance: EvidenceProducerProvenanceConsumer
  private readonly deltaStore: EvidenceDagDeltaStore
  private readonly now: () => Date
  private readonly artifactVersionCommit: (workspaceRoot: string) => ArtifactVersionCommitPortV1
  private readonly artifactVersionRead: (workspaceRoot: string) => ArtifactVersionReadPortV1
  private readonly visibleSurfacesByThread = new Map<string, Set<string>>()
  private readonly sealQueues = new Map<string, Promise<unknown>>()
  private captureQueue: Promise<unknown> = Promise.resolve()
  /**
   * Legacy snapshot import, provisional reconciliation and the evidence ACL
   * warm-up are idempotent housekeeping. Awaiting them during lifecycle
   * activation delayed the first window by seconds, so they run after
   * activation; every read/write path awaits this promise first.
   */
  private startupMaintenance: Promise<void> = Promise.resolve()

  constructor(options: Readonly<{
    userDataDir: string
    sanitizeText?: (text: string) => string
    sidecar?: EvidenceDagSidecarPort
    client?: EvidenceDagServiceClient
    fetchImpl?: typeof fetch
    now?: () => Date
    artifactVersionCommitPort?: ArtifactVersionCommitPortV1
    artifactVersionReadPort?: ArtifactVersionReadPortV1
    artifactVersionEventListPort?: ArtifactVersionEventListPortV1
    artifactVersionLifecyclePollIntervalMs?: number
    artifactVersionLifecyclePageSize?: number
    producerProvenancePollIntervalMs?: number
    deltaStore?: EvidenceDagDeltaStore
  }>) {
    this.records = new ResearchRecordRuntime(options)
    this.now = options.now ?? (() => new Date())
    this.sidecar = options.sidecar ?? new EvidenceDagSidecar({ fetchImpl: options.fetchImpl })
    this.client = options.client ?? new EvidenceDagServiceClient({
      endpoint: () => this.sidecar.endpoint(),
      fetchImpl: options.fetchImpl,
      now: options.now
    })
    const commitPort = (workspaceRoot: string) => {
      if (options.artifactVersionCommitPort) return options.artifactVersionCommitPort
      if (!this.context) {
        throw new Error('Evidence DAG runtime lifecycle is not active.')
      }
      return artifactVersionCommitPort(this.context, workspaceRoot)
    }
    const readPort = (workspaceRoot: string) => {
      if (options.artifactVersionReadPort) return options.artifactVersionReadPort
      if (!this.context) {
        throw new Error('Evidence DAG runtime lifecycle is not active.')
      }
      return artifactVersionReadPort(this.context, workspaceRoot)
    }
    const eventListPort = (workspaceRoot: string) => {
      if (options.artifactVersionEventListPort) return options.artifactVersionEventListPort
      if (!this.context) {
        throw new Error('Evidence DAG runtime lifecycle is not active.')
      }
      return artifactVersionEventListPort(this.context, workspaceRoot)
    }
    this.artifactVersions = createEvidenceArtifactVersionClient(commitPort, readPort)
    this.artifactVersionCommit = commitPort
    this.artifactVersionRead = readPort
    this.deltaStore = options.deltaStore ?? new EvidenceDagDeltaStore(
      join(options.userDataDir, 'evidence-dag', 'deltas.json')
    )
    this.artifactVersionLifecycle = new EvidenceArtifactVersionLifecycleConsumer({
      storagePath: join(
        options.userDataDir,
        'evidence-dag',
        'artifact-version-lifecycle.json'
      ),
      eventListPort,
      discoverThreads: () => this.discoverLifecycleThreads(),
      prepareThread: (thread) => this.prepareLifecycleThread(thread),
      identities: (trace) => this.artifactVersions.identities(trace),
      withLifecycle: (trace, lifecycle) =>
        this.artifactVersions.withLifecycle(trace, lifecycle),
      append: (input) => this.appendTrace(input),
      now: options.now,
      ...(options.artifactVersionLifecyclePollIntervalMs !== undefined
        ? { pollIntervalMs: options.artifactVersionLifecyclePollIntervalMs }
        : {}),
      ...(options.artifactVersionLifecyclePageSize !== undefined
        ? { pageSize: options.artifactVersionLifecyclePageSize }
        : {}),
      log: (entry) => this.context?.log(entry)
    })
    this.producerProvenance = new EvidenceProducerProvenanceConsumer({
      discoverWorkspaces: () => this.discoverProvenanceWorkspaces(),
      adapters: new Map([['scientific-plotting', scientificPlottingReceiptAdapter]]),
      prepare: (workspaceRoot, receipt) =>
        this.prepareProducerProvenance(workspaceRoot, receipt),
      append: (input) => this.appendTrace(input),
      afterAppend: (prepared) => this.artifactVersionLifecycle.rememberThread({
        runtimeId: prepared.runtimeId,
        threadId: prepared.threadId,
        workspaceRoot: prepared.workspaceRoot,
        targetWatermark: prepared.targetWatermark,
        trace: prepared.trace
      }),
      now: options.now,
      ...(options.producerProvenancePollIntervalMs !== undefined
        ? { pollIntervalMs: options.producerProvenancePollIntervalMs }
        : {}),
      log: (entry) => this.context?.log(entry)
    })
  }

  async activate(context: DomainMainRuntimeLifecycleContext): Promise<DomainMainRuntimeDisposer> {
    if (this.closed) throw new Error('Evidence DAG runtime is closed.')
    if (this.context && this.context !== context) {
      throw new Error('Evidence DAG runtime lifecycle is already active.')
    }
    this.context = context
    this.sidecar.configure(context)
    this.enabled = await context.enablement.isEnabled()
    this.records.start(context, this.enabled)
    if (this.enabled) this.ensureSidecarInBackground()
    this.startupMaintenance = this.runStartupMaintenance(context)
    this.enablementDisposer = context.enablement.subscribe((enabled) => {
      if (this.closed) return
      this.derivationEpoch++
      this.enabled = enabled
      this.records.setEnabled(enabled)
      void this.artifactVersionLifecycle.setEnabled(enabled)
      void this.producerProvenance.setEnabled(enabled)
      if (enabled) this.ensureSidecarInBackground()
      else void this.sidecar.stop()
    })
    const abort = () => void this.close()
    context.signal.addEventListener('abort', abort, { once: true })
    return async () => {
      context.signal.removeEventListener('abort', abort)
      await this.close()
    }
  }

  /**
   * Runs the startup housekeeping that must never block lifecycle activation.
   * Read/write paths await this promise, so callers still observe a fully
   * migrated store; only activation itself returns early.
   */
  private runStartupMaintenance(context: DomainMainRuntimeLifecycleContext): Promise<void> {
    const task = (async (): Promise<void> => {
      const startedAt = Date.now()
      const traced = process.env.SCIFORGE_STARTUP_TRACE === '1'
      const step = async <T>(name: string, run: () => Promise<T>): Promise<T> => {
        const at = Date.now()
        try {
          return await run()
        } finally {
          if (traced) {
            context.log({
              level: 'info',
              message: 'Evidence DAG startup step.',
              detail: { step: name, elapsedMs: Date.now() - at }
            })
          }
        }
      }
      const evidenceRoot = join(context.userDataDir, 'evidence-dag')
      await step('storage-acl', () => preauthorizeEvidenceStorage(evidenceRoot))
      await step('delta-store-load', () => this.deltaStore.load())
      for (const recovery of this.deltaStore.recoveryStatus()) context.log({
        level: 'warn',
        message: 'Evidence 历史完整性校验失败；损坏原件已隔离保留，有效前缀及其他会话历史已保留。新输入可继续，历史证据仍不完整。',
        detail: recovery
      })
      await step('legacy-import', () => this.deltaStore.importLegacySnapshots(join(evidenceRoot, 'threads')))
      const epoch = this.derivationEpoch
      if (!this.closed && this.enabled) await step('provisional-reconcile', () => this.deltaStore.reconcileProvisional({
        compilerVersion: 'evidence-provisional.v1',
        policyVersion: 'evidence-provisional-policy.v1',
        now: this.now().toISOString()
      }, () => !this.closed && this.enabled && epoch === this.derivationEpoch))
      if (this.closed) return
      await step('artifact-version-lifecycle-start', () => this.artifactVersionLifecycle.start(this.enabled))
      if (this.closed) return
      // start only schedules the canonical consumer; draining must not be
      // awaited here because appendTrace waits for startupMaintenance.
      await step('producer-provenance-start', () => this.producerProvenance.start(this.enabled))
      if (traced) {
        context.log({
          level: 'info',
          message: 'Evidence DAG startup maintenance finished.',
          detail: { elapsedMs: Date.now() - startedAt }
        })
      }
    })()
    task.catch((error) => {
      context.log({
        level: 'warn',
        message: 'Evidence DAG startup maintenance failed.',
        detail: error instanceof Error ? error.message : String(error)
      })
    })
    return task.catch(() => undefined)
  }

  async consume(event: DomainArtifactEvent): Promise<void> {
    if (!this.context || !this.enabled) return
    await this.startupMaintenance
    const scope = domainArtifactEventScope(event)
    if (!scope.workspaceRoot) return
    const trace = await this.artifactVersions.pinTrace(
      evidenceTraceFromArtifactEvent(event),
      {
        runtimeId: scope.runtimeId,
        threadId: scope.threadId,
        operationId: event.kind !== 'execution-completed' ? event.turnId : event.runId,
        workspaceRoot: scope.workspaceRoot,
        occurredAt: event.occurredAt
      }
    )
    const { runtimeId, threadId, workspaceRoot } = scope
    if (trace.length) {
      await this.artifactVersionLifecycle.rememberThread({
        runtimeId,
        threadId,
        workspaceRoot,
        targetWatermark: event.targetWatermark,
        trace
      })
    }
    await this.appendTrace({
      runtimeId,
      threadId,
      workspaceRoot,
      operationId: event.kind !== 'execution-completed' ? event.turnId : event.runId,
      kind: event.kind !== 'execution-completed' ? 'turn' : 'execution',
      requestedWatermark: event.targetWatermark,
      idempotencyKey: `artifact-event:${event.kind}:${evidenceDagThreadId(runtimeId, threadId)}:${event.kind !== 'execution-completed' ? event.turnId : event.runId}`,
      eventKind: event.kind,
      trace,
      createdAt: event.occurredAt
    })
    this.artifactVersionLifecycle.requestPoll()
  }

  async view(raw: EvidenceDagViewInput): Promise<EvidenceDagViewOutput> {
    const input = evidenceDagViewInputSchema.parse(raw)
    const context = await this.requireEnabled()
    if (!input.runtimeId || !input.threadId) {
      return evidenceDagViewOutputSchema.parse({
        url: this.client.uiUrl(),
        status: this.emptyStatus()
      })
    }
    const thread = await context.agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.threadId
    })
    const workspaceRoot = evidenceDagWorkspaceRoot(input.workspaceRoot, thread.workspaceRoot)
    if (thread.id !== input.threadId || thread.runtimeId !== input.runtimeId) throw new Error('Graph thread identity mismatch.')
    const engineThreadId = await this.engineThreadId(input.runtimeId, input.threadId, workspaceRoot)
    if (input.snapshotDigest || input.artifactVersionRef) {
      try {
        if (input.artifactVersionRef) await verifyProducerArtifactRefs([input.artifactVersionRef], this.artifactVersionRead(workspaceRoot))
        // Starting the read service loads stored facts; no update or model execution is requested.
        await this.sidecar.ensureReady()
        const result = await this.client.graphBinding(engineThreadId, input)
        return evidenceDagViewOutputSchema.parse({
          url: result.binding.status === 'resolved' ? this.client.uiUrl(undefined, engineThreadId, result.binding.snapshotDigest, input.artifactVersionRef) : null,
          threadId: engineThreadId, binding: result.binding,
          status: { ...this.emptyStatus(), committed: result.snapshot }
        })
      } catch {
        return evidenceDagViewOutputSchema.parse({ url: null, binding: { status: 'missing', reason: 'snapshot_unavailable_or_restricted' }, status: this.emptyStatus() })
      }
    }
    await this.sidecar.ensureReady()
    const status = await this.localStatus(input.runtimeId, input.threadId, workspaceRoot)
    return evidenceDagViewOutputSchema.parse({
      url: this.client.uiUrl(undefined, engineThreadId),
      threadId: engineThreadId,
      status
    })
  }

  async snapshotStatus(
    raw: EvidenceDagSnapshotStatusInput
  ): Promise<EvidenceDagCanonicalStatus> {
    const input = evidenceDagSnapshotStatusInputSchema.parse(raw)
    const context = await this.requireEnabled()
    let authoritativeWorkspaceRoot: string | undefined
    const syntheticExecution = isSyntheticExecutionScope(input.runtimeId, input.threadId)
    try {
      authoritativeWorkspaceRoot = (await context.agentThreads.read({
        runtimeId: input.runtimeId,
        threadId: input.threadId
      })).workspaceRoot
    } catch {
      // Synthetic package executions have no Agent Thread by design. Their
      // scope is still bound by the Host-produced domain:/execution: identity;
      // ordinary Sessions must never fall back to a caller-supplied workspace
      // when Host authority is unavailable.
      if (!syntheticExecution) return this.emptyStatus()
    }
    if (!syntheticExecution && !authoritativeWorkspaceRoot?.trim()) {
      return this.emptyStatus()
    }
    const workspaceRoot = evidenceDagWorkspaceRoot(
      input.workspaceRoot,
      authoritativeWorkspaceRoot
    )
    return evidenceDagSnapshotStatusOutputSchema.parse(
      await this.localStatus(
        input.runtimeId,
        input.threadId,
        workspaceRoot
      )
    )
  }

  async appendSidechain(raw: EvidenceDagSidechainAppendInput): Promise<EvidenceDagSidechainAppendOutput> {
    await this.startupMaintenance
    const input = evidenceDagSidechainAppendInputSchema.parse(raw)
    const context = await this.requireEnabled()
    const thread = await context.agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.threadId
    })
    const workspaceRoot = evidenceDagWorkspaceRoot(input.workspaceRoot, thread.workspaceRoot)
    const result = await this.deltaStore.appendSidechain({
      threadId: await this.engineThreadId(input.runtimeId, input.threadId, workspaceRoot),
      recordId: input.recordId,
      recordType: input.recordType,
      closureDigest: input.closureDigest,
      idempotencyKey: input.idempotencyKey,
      payload: input.payload,
      producerIdentity: input.producerIdentity,
      reviewerIdentity: input.reviewerIdentity,
      createdAt: input.createdAt
    })
    return evidenceDagSidechainAppendOutputSchema.parse(result)
  }

  async submitClaims(raw: EvidenceDagSubmitClaimsInput): Promise<EvidenceDagSubmitClaimsOutput> {
    await this.startupMaintenance
    const input = evidenceDagSubmitClaimsInputSchema.parse(raw)
    const context = await this.requireEnabled()
    const epoch = this.derivationEpoch
    const detail = await context.agentThreads.read({ runtimeId: input.runtimeId, threadId: input.threadId })
    if (detail.id !== input.threadId || detail.runtimeId !== input.runtimeId) throw new Error('Claim thread identity mismatch.')
    const workspaceRoot = evidenceDagWorkspaceRoot(input.workspaceRoot, detail.workspaceRoot)
    const prepared = await prepareSubmittedClaims({ ...input, workspaceRoot }, this.artifactVersionRead(workspaceRoot))
    const { claims } = prepared
    const append = this.captureQueue.then(async () => {
      if (this.closed || !this.enabled || epoch !== this.derivationEpoch || context.signal.aborted) {
        throw new Error('Claim submission superseded before append.')
      }
      const chain = await this.deltaStore.chain(await this.engineThreadId(input.runtimeId, input.threadId, workspaceRoot))
      const existing = chain.list().find(record => record.idempotencyKey === `claims:${input.idempotencyKey}`)
      if (this.closed || !this.enabled || epoch !== this.derivationEpoch || context.signal.aborted) {
        throw new Error('Claim submission superseded before append.')
      }
      const priorTrace = existing?.payload.trace
      const priorSubmission = Array.isArray(priorTrace) ? priorTrace.find((item): item is Record<string, unknown> =>
        item !== null && typeof item === 'object' && item.kind === 'sciforge.claim-submission.v1') : undefined
      // Revalidation above checks current access and bytes; immutable retries keep
      // the first captured metadata, which may have changed on the live Artifact.
      const submission = priorSubmission ? { ...priorSubmission, claims } : { kind: 'sciforge.claim-submission.v1', ...prepared }
      return this.appendTraceLocked({
        runtimeId: input.runtimeId, threadId: input.threadId, workspaceRoot,
        operationId: `claims:${input.idempotencyKey}`, kind: 'manual', requestedWatermark: existing?.requestedWatermark ?? detail.watermark,
        idempotencyKey: `claims:${input.idempotencyKey}`,
        eventKind: 'claim-submission', trace: [submission]
      })
    })
    this.captureQueue = append.catch(() => undefined)
    const appended = await append
    return evidenceDagSubmitClaimsOutputSchema.parse({ threadId: appended.delta.scope.threadId,
      deltaDigest: appended.delta.deltaDigest, idempotent: appended.idempotent, claims })
  }

  async update(raw: EvidenceDagUpdateInput): Promise<EvidenceDagUpdateOutput> {
    await this.startupMaintenance
    const input = evidenceDagUpdateInputSchema.parse(raw)
    const context = await this.requireEnabled()
    const detail = await context.agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.threadId
    })
    const workspaceRoot = evidenceDagWorkspaceRoot(input.workspaceRoot, detail.workspaceRoot)
    const trace = await this.artifactVersions.pinTrace(
      evidenceTraceFromThread(detail),
      {
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        operationId: `manual:${detail.watermark}`,
        workspaceRoot,
        occurredAt: new Date().toISOString()
      }
    )
    await this.artifactVersionLifecycle.rememberThread({
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      workspaceRoot,
      targetWatermark: detail.watermark,
      trace
    })
    const appended = await this.appendTrace({
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      operationId: `manual:${detail.watermark}`,
      kind: 'manual',
      requestedWatermark: detail.watermark,
      idempotencyKey: `manual:${evidenceDagThreadId(input.runtimeId, input.threadId)}:${detail.watermark}`,
      trace,
      workspaceRoot,
    })
    this.artifactVersionLifecycle.requestPoll()
    const engineThreadId = await this.engineThreadId(input.runtimeId, input.threadId, workspaceRoot)
    const status = await this.localStatus(input.runtimeId, input.threadId, workspaceRoot)
    return evidenceDagUpdateOutputSchema.parse({
      url: this.client.uiUrl(undefined, engineThreadId),
      threadId: engineThreadId,
      itemCount: trace.length,
      deltaDigest: appended.delta.deltaDigest,
      idempotent: appended.idempotent,
      status
    })
  }

  async sealClosure(
    raw: EvidenceDagSealClosureInput
  ): Promise<EvidenceDagSealClosureOutput> {
    await this.startupMaintenance
    const input = evidenceDagSealClosureInputSchema.parse(raw)
    const engineThreadId = evidenceDagThreadId(input.runtimeId, input.threadId)
    const previous = this.sealQueues.get(engineThreadId) ?? Promise.resolve()
    const current = previous.then(() => this.sealClosureLocked(input))
    this.sealQueues.set(engineThreadId, current)
    try {
      return await current
    } finally {
      if (this.sealQueues.get(engineThreadId) === current) this.sealQueues.delete(engineThreadId)
    }
  }

  private async sealClosureLocked(
    input: EvidenceDagSealClosureInput
  ): Promise<EvidenceDagSealClosureOutput> {
    const context = await this.requireEnabled()
    const thread = await context.agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.threadId
    })
    const workspaceRoot = evidenceDagWorkspaceRoot(input.workspaceRoot, thread.workspaceRoot)
    const engineThreadId = await this.engineThreadId(input.runtimeId, input.threadId, workspaceRoot)
    const closure = await this.deltaStore.seal(engineThreadId, input.policy, input.idempotencyKey)
    // A closure is the formal Evidence boundary. The delta chain remains the
    // desktop capture authority, while the package-owned sidecar remains the
    // canonical writer of the committed Snapshot consumed by Project/export.
    const chain = await this.deltaStore.chain(engineThreadId)
    // A pure legacy root already points at an immutable historical Snapshot.
    // Once deltas are appended, a successor closure must materialize a new one.
    const sealingLegacyRoot = Boolean(
      chain.legacyCheckpointRoot &&
      chain.list().length === 0 &&
      closure.headDigest === chain.legacyCheckpointRoot.snapshot.digest
    )
    if (closure.status === 'complete' && !sealingLegacyRoot) {
      // `seal()` is durable before the sidecar call. A retry after a sidecar
      // failure therefore sees the same closure and can safely materialize it.
      // Once the exact closure/Snapshot binding is durable, replay is a pure
      // read and must not fan out another `/updates` request.
      if (
        chain.committedSnapshotClosureEntries().some(([digest]) => digest === closure.closureDigest)
      ) {
        return evidenceDagSealClosureOutputSchema.parse(closure)
      }
      await this.sidecar.ensureReady()
      const includedDeltaDigests = new Set(closure.includedDeltaDigests)
      const trace = chain.list().flatMap((record) => {
        if (!includedDeltaDigests.has(record.deltaDigest)) return []
        return evidenceDeltaTrace(record)
      })
      const targetWatermark = input.policy.barrierWatermark
      const committed = await this.client.commitSnapshot({
        threadId: engineThreadId,
        targetWatermark,
        trace,
        workspaceRoot,
        idempotencyKey: input.idempotencyKey
      })
      if (committed.inputWatermark !== targetWatermark) {
        throw new Error('Evidence closure seal returned a Snapshot whose input watermark does not exactly match its barrier.')
      }
      await this.deltaStore.recordCommittedSnapshot(engineThreadId, committed, closure.closureDigest)
    }
    return evidenceDagSealClosureOutputSchema.parse(closure)
  }

  async priority(raw: EvidenceDagPriorityInput): Promise<EvidenceDagCanonicalStatus> {
    const input = evidenceDagPriorityInputSchema.parse(raw)
    const context = await this.requireEnabled()
    const thread = await context.agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.threadId
    })
    const workspaceRoot = evidenceDagWorkspaceRoot(input.workspaceRoot, thread.workspaceRoot)
    const visible = updateEvidenceDagVisibleSurfaces(
      this.visibleSurfacesByThread,
      input.runtimeId,
      input.threadId,
      input.surfaceId,
      input.visible
    )
    return evidenceDagPriorityOutputSchema.parse(
      await this.localStatus(input.runtimeId, input.threadId, workspaceRoot)
    )
  }

  async rerunSpec(raw: EvidenceDagRerunSpecInput) {
    const input = evidenceDagRerunSpecInputSchema.parse(raw)
    const workspaceRoot = await this.authorizeRerunRead(input)
    const engineThreadId = await this.engineThreadId(input.runtimeId, input.threadId, workspaceRoot)
    if ('snapshotDigest' in input) return this.client.rerunSpec({ ...input, threadId: engineThreadId })
    const chain = await this.deltaStore.chain(engineThreadId)
    const first = chain.list()[0]
    if (first) {
      if (first.scope.runtimeId !== input.runtimeId) throw new Error('Rerun closure runtime mismatch.')
      evidenceDagWorkspaceRoot(workspaceRoot, first.scope.workspaceRoot)
    }
    const snapshotDigest = chain.committedSnapshotClosureEntries().find(([closure]) => closure === input.closureDigest)?.[1]
    if (!snapshotDigest) throw new Error('Exact closure has no retained committed Snapshot binding; rerun unavailable.')
    return this.client.rerunSpec({ runtimeId: input.runtimeId, threadId: engineThreadId, workspaceRoot,
      snapshotDigest, conclusionId: input.conclusionId })
  }

  async rerunCompare(raw: EvidenceDagRerunCompareInput) {
    const input = evidenceDagRerunCompareInputSchema.parse(raw)
    const workspaceRoot = await this.authorizeRerunRead(input)
    return this.client.rerunCompare({ ...input, threadId: await this.engineThreadId(input.runtimeId, input.threadId, workspaceRoot) })
  }

  private async authorizeRerunRead(input: { runtimeId: string; threadId: string; workspaceRoot?: string }) {
    const context = await this.requireEnabled()
    const thread = await context.agentThreads.read({ runtimeId: input.runtimeId, threadId: input.threadId })
    if (thread.id !== input.threadId || thread.runtimeId !== input.runtimeId) throw new Error('Rerun thread identity mismatch.')
    if (!thread.workspaceRoot) throw new Error('Rerun read requires a captured thread workspace.')
    const workspaceRoot = evidenceDagWorkspaceRoot(input.workspaceRoot, thread.workspaceRoot)
    await this.sidecar.ensureReady()
    await this.requireEnabled()
    return workspaceRoot
  }

  async preview(raw: EvidenceDagPreviewInput): Promise<EvidenceDagPreviewOutput> {
    const input = evidenceDagPreviewInputSchema.parse(raw)
    const context = await this.requireEnabled()
    await this.sidecar.ensureReady()
    const thread = await context.agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.threadId
    })
    let workspaceRoot: string
    try {
      workspaceRoot = evidenceDagWorkspaceRoot(input.workspaceRoot, thread.workspaceRoot)
    } catch (error) {
      return {
        ok: false,
        code: 'file_unavailable',
        message: error instanceof Error ? error.message : String(error)
      }
    }
    const engineThreadId = await this.engineThreadId(input.runtimeId, input.threadId, workspaceRoot)
    const snapshotEvidence = await this.client.evidencePreview({ ...input, threadId: engineThreadId })
    return evidenceDagPreviewOutputSchema.parse(await resolveEvidenceDagPreview({
      request: input,
      engineThreadId,
      workspaceRoot,
      snapshotEvidence
    }))
  }

  async exportSnapshotProducts(
    raw: EvidenceDagExportSnapshotProductsInput
  ): Promise<EvidenceDagExportSnapshotProductsOutput> {
    const input = evidenceDagExportSnapshotProductsInputSchema.parse(raw)
    const context = await this.requireEnabled()
    const thread = await context.agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.threadId
    })
    const workspaceRoot = evidenceDagWorkspaceRoot(input.workspaceRoot, thread.workspaceRoot)
    await this.sidecar.ensureReady()
    const engineThreadId = await this.engineThreadId(input.runtimeId, input.threadId, workspaceRoot)
    const chain = await this.deltaStore.chain(engineThreadId)
    const requestedDigest = input.snapshotDigest
    const boundToClosure = chain.committedSnapshotClosureEntries().some(([, digest]) => digest === requestedDigest)
    const legacyComplete = chain.legacyCheckpointRoot?.status === 'legacy/complete' &&
      chain.legacyCheckpointRoot.snapshot.digest === requestedDigest
    if (!boundToClosure && !legacyComplete) {
      throw new Error('Evidence snapshot products require a Snapshot bound to a complete closure.')
    }
    const projection = await this.client.snapshotProducts(
      engineThreadId,
      requestedDigest,
      input.datacite
    )
    return commitEvidenceSnapshotProducts({
      request: input,
      engineThreadId,
      projection,
      readPort: this.artifactVersionRead(workspaceRoot),
      commitPort: this.artifactVersionCommit(workspaceRoot)
    })
  }

  async auditQuery(
    raw: EvidenceDagAuditQueryInput & Readonly<{ workspaceRoot?: string }>
  ): Promise<EvidenceDagAuditQueryOutput> {
    // `workspaceRoot` is host caller scope injected by the capability handler,
    // not part of the public query contract, so it stays out of the strict
    // subject-only input schema.
    const input = evidenceDagAuditQueryInputSchema.parse({ subject: raw.subject, asOf: raw.asOf })
    await this.requireEnabled()
    // The Evidence-side read port of `research-audit.query`: sidechain records
    // come only from this domain's own store and revision-bound exact index.
    // Cross-domain facets stay reported as gap codes; no aggregate is built
    // here and no write path is reachable.
    const { evaluation, review, bindings } = await this.deltaStore.queryAudit(input.subject, raw.workspaceRoot)
    let readServiceReady: Promise<void> | undefined
    const reviewDecisions = await readHumanReviews({ bindings, subject: input.subject, asOf: input.asOf, client: this.client,
      authorize: async scope => {
        const context = await this.requireEnabled()
        // The canonical engine encoder is idempotent: both a native ID and an
        // already-prefixed native ID can encode to the same engine key. Ask
        // the authority for those two exact preimages; ambiguity is unavailable.
        const prefix = `${scope.runtimeId}:`
        const baseId = scope.threadId.replace(/:workspace:[0-9a-f]{64}$/u, '')
        const candidates = [...new Set([scope.threadId, baseId, ...(baseId.startsWith(prefix) ? [baseId.slice(prefix.length)] : [])])]
        const threads = []
        for (const threadId of candidates) {
          try {
            const thread = await (context.agentThreads.readMetadata ?? context.agentThreads.read)({ runtimeId: scope.runtimeId, threadId })
            if (thread.id === threadId && thread.runtimeId === scope.runtimeId && thread.workspaceRoot &&
              await this.engineThreadId(thread.runtimeId, thread.id, thread.workspaceRoot) === scope.engineThreadId) threads.push(thread)
          } catch { /* Not an authorized preimage; never discover other threads. */ }
        }
        if (threads.length !== 1) throw new Error('Review thread identity is missing or ambiguous.')
        const workspaceRoot = evidenceDagWorkspaceRoot(raw.workspaceRoot, threads[0].workspaceRoot)
        if ('artifactVersionRef' in input.subject) await verifyProducerArtifactRefs([input.subject.artifactVersionRef], this.artifactVersionRead(workspaceRoot))
        readServiceReady ??= this.sidecar.ensureReady()
        await readServiceReady
      }
    })
    return evidenceDagAuditQueryOutputSchema.parse({
      subject: input.subject,
      records: evaluation.records,
      scientificReview: review,
      reviewDecisions,
      completeness: { complete: evaluation.complete, gapCodes: [...evaluation.gapCodes] },
      freshness: evaluation.freshness,
      source: 'evidence-dag'
    })
  }

  async guardWriteExport(payload: unknown): Promise<DomainMainActionGuardResult> {
    const parsed = evidenceDagWriteExportGuardPayloadSchema.safeParse(payload)
    if (!parsed.success) {
      return genericGuardDecision(evaluateEvidenceDagHighImpactGate({
        action: EVIDENCE_DAG_WRITE_EXPORT_ACTION,
        auditUnavailableReason: 'write.export Evidence guard payload is invalid.',
        requireFreshAudit: true
      }))
    }
    const input = parsed.data
    if (!input.runtimeId || !input.threadId) {
      return genericGuardDecision(evaluateEvidenceDagHighImpactGate({
        action: EVIDENCE_DAG_WRITE_EXPORT_ACTION,
        auditUnavailableReason: 'write.export did not include runtimeId and threadId.',
        overrideConfirmed: input.overrideConfirmed,
        requireFreshAudit: true,
        ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
        ...(input.threadId ? { threadId: input.threadId } : {}),
        ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {})
      }))
    }
    let audit: ReturnType<typeof evidenceDagAuditForGate>
    try {
      const status = await this.snapshotStatus({
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {})
      })
      // Audit/export operate on the Evidence owner's immutable Snapshot. The
      // delta head is only a local capture identity and cannot be resolved by
      // the sidecar snapshot reader.
      const targetDigest = status.committed?.digest
      if (!targetDigest) {
        throw new Error('Evidence export requires an existing sealed or legacy snapshot audit target.')
      }
      await this.sidecar.ensureReady()
      audit = evidenceDagAuditForGate(await this.client.audit(
        status.committed!.threadId,
        targetDigest
      ))
    } catch (error) {
      audit = {
        auditUnavailableReason: error instanceof Error ? error.message : String(error)
      }
    }
    return genericGuardDecision(evaluateEvidenceDagHighImpactGate({
      action: EVIDENCE_DAG_WRITE_EXPORT_ACTION,
      riskDigest: audit.riskDigest,
      auditCompletedAt: audit.auditCompletedAt,
      auditUnavailableReason: audit.auditUnavailableReason,
      overrideConfirmed: input.overrideConfirmed,
      requireFreshAudit: true,
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {})
    }))
  }

  async close(): Promise<void> {
    this.closePromise ??= this.closeOnce()
    await this.closePromise
  }

  private async closeOnce(): Promise<void> {
    this.closed = true
    this.derivationEpoch++
    await this.records.close()
    await this.enablementDisposer?.()
    this.enablementDisposer = undefined
    await this.producerProvenance.close()
    await this.artifactVersionLifecycle.close()
    this.context = undefined
    this.visibleSurfacesByThread.clear()
    await this.sidecar.stop()
  }

  private async engineThreadId(runtimeId: string, threadId: string, workspaceRoot: string): Promise<string> {
    return this.deltaStore.threadIdForWorkspace(evidenceDagThreadId(runtimeId, threadId), workspaceRoot)
  }

  private async appendTrace(input: EvidenceDagTraceAppendInput): Promise<EvidenceDagAppendResult> {
    const next = this.captureQueue.then(() => this.appendTraceLocked(input))
    this.captureQueue = next.catch(() => undefined)
    return next
  }

  private async appendTraceLocked(input: EvidenceDagTraceAppendInput): Promise<EvidenceDagAppendResult> {
    const epoch = this.derivationEpoch
    const stillCurrent = () => !this.closed && this.enabled && epoch === this.derivationEpoch
    await this.startupMaintenance
    const engineThreadId = await this.engineThreadId(input.runtimeId, input.threadId, input.workspaceRoot)
    const result = await this.deltaStore.append(evidenceDagDeltaInputFromTrace({
      ...input,
      threadId: engineThreadId
    }))
    if (!stillCurrent()) return result
    const authoritativeHead = await this.deltaStore.head(
      engineThreadId
    )
    if (!stillCurrent()) return result
    const compileInput = {
      compilerVersion: 'evidence-provisional.v1',
      policyVersion: 'evidence-provisional-policy.v1',
      // An idempotent replay may refer to an older delta after a newer head
      // has committed. Provisional compilation always follows that authority.
      desiredHeadDigest: authoritativeHead.headDigest,
      now: this.now().toISOString()
    }
    try {
      await this.deltaStore.compileProvisional(
        engineThreadId,
        compileInput, stillCurrent
      )
    } catch (error) {
      if (!stillCurrent()) return result
      await this.deltaStore.compileProvisional(
        engineThreadId,
        {
          ...compileInput,
          failure: {
            code: 'internal_error',
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
            occurredAt: this.now().toISOString()
          }
        }, stillCurrent
      )
    }
    return result
  }

  private async localStatus(
    runtimeId: string,
    threadId: string,
    workspaceRoot?: string
  ): Promise<EvidenceDagCanonicalStatus> {
    const engineThreadId = workspaceRoot
      ? await this.engineThreadId(runtimeId, threadId, workspaceRoot)
      : evidenceDagThreadId(runtimeId, threadId)
    const chain = await this.deltaStore.chain(engineThreadId)
    const records = chain.list()
    if (engineThreadId !== evidenceDagThreadId(runtimeId, threadId) && !records.length && !chain.legacyCheckpointRoot) return this.emptyStatus()
    const first = records[0]
    if (first && (
      first.scope.runtimeId !== runtimeId ||
      (workspaceRoot && resolve(first.scope.workspaceRoot) !== resolve(workspaceRoot))
    )) return this.emptyStatus()
    const head = chain.head
    const provisional = chain.provisionalView
    const committed = chain.committedEvidenceSnapshot ?? (
      chain.legacyCheckpointRoot?.status === 'legacy/complete'
        ? chain.legacyCheckpointRoot.snapshot
        : null
    )
    const summary = provisional?.summary
    const recovery = this.deltaStore.recoveryStatus().find(item => item.threadId === engineThreadId)
    const updatedAt = [head.updatedAt, provisional?.updatedAt, committed?.createdAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? new Date().toISOString()
    return evidenceDagCanonicalStatusSchema.parse({
      committed,
      pending: null,
      updatedAt,
      authoritativeHead: head,
      provisional,
      desiredHeadDigest: summary?.desiredHeadDigest ?? head.headDigest,
      appliedHeadDigest: summary?.appliedHeadDigest ?? provisional?.appliedHeadDigest ?? null,
      freshness: recovery ? 'failed' : summary?.freshness ?? (head.headDigest ? 'pending' : 'unknown'),
      coverage: summary?.coverage ?? { complete: false, gapCount: 0 },
      materialRiskCount: summary?.materialRiskCount ?? 0,
      lastSuccessAt: summary?.lastSuccessAt ?? null,
      failure: recovery ? {
        code: 'internal_error',
        message: `历史证据完整性校验失败，已保留原件并隔离 ${recovery.quarantinedRecordCount} 条记录。新输入可继续；历史证据不完整，不能作为完整可信证据使用。`,
        retryable: false,
        occurredAt: recovery.detectedAt
      } : summary?.failure ?? null
    })
  }

  private canonicalStatus(
    committed: EvidenceDagCanonicalStatus['committed'],
    pending: EvidenceDagCanonicalStatus['pending']
  ): EvidenceDagCanonicalStatus {
    const updatedAt = [committed?.createdAt, pending?.updatedAt]
      .filter((value): value is string => Boolean(value))
      .sort()
      .at(-1) ?? new Date().toISOString()
    return evidenceDagCanonicalStatusSchema.parse({ committed, pending, updatedAt })
  }

  private emptyStatus(): EvidenceDagCanonicalStatus {
    return evidenceDagCanonicalStatusSchema.parse({
      committed: null,
      pending: null,
      updatedAt: new Date().toISOString()
    })
  }

  private async requireEnabled(): Promise<DomainMainRuntimeLifecycleContext> {
    if (this.closed) throw new Error('Evidence DAG runtime is closed.')
    if (!this.context) throw new Error('Evidence DAG runtime lifecycle is not active.')
    // Reads and writes must observe the migrated store even though the
    // housekeeping above now finishes in the background after activation.
    await this.startupMaintenance
    if (!this.enabled || !await this.context.enablement.isEnabled()) {
      throw new Error('Evidence DAG is disabled.')
    }
    return this.context
  }

  private ensureSidecarInBackground(): void {
    void this.sidecar.ensureReady().catch((error) => {
      this.context?.log({
        level: 'warn',
        message: 'Evidence DAG sidecar is not ready.',
        detail: error instanceof Error ? error.message : String(error)
      })
    })
  }

  private async discoverLifecycleThreads(): Promise<readonly EvidenceArtifactLifecycleThreadKey[]> {
    const context = this.context
    if (!context || !this.enabled) return []
    const threads = await context.agentThreads.list({
      limit: 500,
      includeArchived: true,
      includeSide: false
    })
    return threads.flatMap((thread) => thread.workspaceRoot
      ? [{
          runtimeId: thread.runtimeId,
          threadId: thread.id,
          workspaceRoot: thread.workspaceRoot
        }]
      : [])
  }

  private async prepareLifecycleThread(
    thread: EvidenceArtifactLifecycleThreadKey
  ): Promise<EvidenceArtifactLifecycleThread> {
    const context = this.context
    if (!context || !this.enabled) {
      throw new Error('Evidence DAG runtime lifecycle is not active.')
    }
    const detail = await context.agentThreads.read({
      runtimeId: thread.runtimeId,
      threadId: thread.threadId
    })
    const workspaceRoot = evidenceDagWorkspaceRoot(thread.workspaceRoot, detail.workspaceRoot)
    const sourceTrace = await appendCheckpointArtifactTrace(context, {
      runtimeId: thread.runtimeId, threadId: thread.threadId, workspaceRoot,
      knownTurnIds: detail.turns.map(turn => turn.id)
    }, evidenceTraceFromThread(detail))
    const trace = await this.artifactVersions.pinTrace(sourceTrace, {
      runtimeId: thread.runtimeId,
      threadId: thread.threadId,
      operationId: `artifact-lifecycle:${detail.watermark}`,
      workspaceRoot,
      occurredAt: new Date().toISOString()
    })
    return {
      ...thread,
      workspaceRoot,
      targetWatermark: detail.watermark,
      trace
    }
  }

  private async discoverProvenanceWorkspaces(): Promise<readonly string[]> {
    const context = this.context
    if (!context || !this.enabled) return []
    const threads = await context.agentThreads.list({
      limit: 500,
      includeArchived: true,
      includeSide: false
    })
    return [...new Set(threads.flatMap((thread) => thread.workspaceRoot
      ? [resolve(thread.workspaceRoot)]
      : []))].sort()
  }

  private async prepareProducerProvenance(
    workspaceRoot: string,
    receipt: EvidenceProducerReceipt
  ): Promise<EvidenceProducerPreparation> {
    const context = this.context
    if (!context || !this.enabled || !receipt.runtimeId || !receipt.threadId) {
      throw new Error('Evidence DAG runtime or producer target is unavailable.')
    }
    const detail = await context.agentThreads.read({
      runtimeId: receipt.runtimeId,
      threadId: receipt.threadId
    })
    if (detail.runtimeId !== receipt.runtimeId || detail.id !== receipt.threadId) {
      throw new Error('Producer provenance resolved to a different Evidence thread.')
    }
    const capturedWorkspace = evidenceDagWorkspaceRoot(workspaceRoot, detail.workspaceRoot)
    await verifyProducerArtifactRefs(
      receipt.artifactRefs,
      this.artifactVersionRead(capturedWorkspace)
    )
    const trace = await this.artifactVersions.pinTrace([
      ...evidenceTraceFromThread(detail),
      receipt.traceItem
    ], {
      runtimeId: receipt.runtimeId,
      threadId: receipt.threadId,
      operationId: receipt.operationId,
      workspaceRoot: capturedWorkspace,
      occurredAt: receipt.createdAt
    })
    return {
      runtimeId: receipt.runtimeId,
      threadId: receipt.threadId,
      workspaceRoot: capturedWorkspace,
      targetWatermark: detail.watermark,
      trace
    }
  }
}

export function updateEvidenceDagVisibleSurfaces(
  visibleSurfacesByThread: Map<string, Set<string>>,
  runtimeId: string,
  threadId: string,
  surfaceId: string,
  visible: boolean
): boolean {
  const threadKey = JSON.stringify([runtimeId, threadId])
  const surfaceIds = visibleSurfacesByThread.get(threadKey) ?? new Set<string>()
  if (visible) {
    surfaceIds.add(surfaceId)
    visibleSurfacesByThread.set(threadKey, surfaceIds)
  } else {
    surfaceIds.delete(surfaceId)
    if (surfaceIds.size === 0) visibleSurfacesByThread.delete(threadKey)
  }
  return surfaceIds.size > 0
}

export function parseEvidenceDagActivation(value: unknown) {
  return evidenceDagActivationPayloadSchema.parse(value)
}

export function evidenceDagWorkspaceRoot(
  requested: string | undefined,
  captured: string | undefined
): string {
  if (requested && captured && resolve(requested) !== resolve(captured)) {
    throw new Error('Evidence DAG workspace does not match the captured thread workspace.')
  }
  const workspaceRoot = requested ?? captured
  if (!workspaceRoot) {
    throw new Error('Evidence DAG update requires a workspace root.')
  }
  return workspaceRoot
}

function isSyntheticExecutionScope(runtimeId: string, threadId: string): boolean {
  return runtimeId.startsWith('domain:') && threadId.startsWith('execution:')
}

/** Preserve the complete immutable delta at a formal Snapshot boundary. */
function evidenceDeltaTrace(record: EvidenceDagDelta): readonly Readonly<Record<string, unknown>>[] {
  return [{
    kind: 'sciforge.evidence-delta-envelope.v1',
    schemaVersion: 'sciforge.evidence-delta-envelope.v1',
    delta: {
      deltaDigest: record.deltaDigest,
      payloadDigest: record.payloadDigest,
      predecessorDigest: record.predecessorDigest,
      sequence: record.sequence,
      scope: structuredClone(record.scope),
      requestedWatermark: record.requestedWatermark,
      committedWatermark: record.committedWatermark,
      schemaVersion: record.schemaVersion,
      extractorVersion: record.extractorVersion,
      verifierVersion: record.verifierVersion,
      idempotencyKey: record.idempotencyKey,
      sourceRefs: [...record.sourceRefs],
      artifactRefs: [...record.artifactRefs],
      runRefs: [...record.runRefs],
      payload: structuredClone(record.payload),
      createdAt: record.createdAt
    }
  }]
}

function genericGuardDecision(decision: ReturnType<typeof evaluateEvidenceDagHighImpactGate>) {
  return {
    allowed: decision.allowed,
    ...(!decision.allowed || decision.metadata.advisory ? { message: decision.message } : {}),
    metadata: domainPackageJsonValueSchema.parse(decision.metadata)
  }
}
