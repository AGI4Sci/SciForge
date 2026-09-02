import { createHash } from 'node:crypto'
import { isDeepStrictEqual } from 'node:util'
import { join, resolve } from 'node:path'
import type {
  ArtifactVersionCommitPortV1,
  ArtifactVersionEventListPortV1,
  ArtifactVersionRefV1,
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
import {
  artifactVersionCommitPort,
  artifactVersionEventListPort,
  artifactVersionReadPort,
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
  ScientificPlottingProvenanceConsumer,
  scientificPlottingEvidenceTraceItem,
  scientificPlottingReceiptArtifactRefs,
  type ScientificPlottingProvenancePreparation,
  type ScientificPlottingProvenanceReceiptV1
} from './scientific-plotting-provenance-consumer.js'

export type EvidenceDagRuntimePort = Readonly<{
  activate(context: DomainMainRuntimeLifecycleContext): Promise<DomainMainRuntimeDisposer>
  consume(event: DomainArtifactEvent): Promise<void>
  view(input: EvidenceDagViewInput): Promise<EvidenceDagViewOutput>
  snapshotStatus(input: EvidenceDagSnapshotStatusInput): Promise<EvidenceDagCanonicalStatus>
  sealClosure(input: EvidenceDagSealClosureInput): Promise<EvidenceDagSealClosureOutput>
  appendSidechain(input: EvidenceDagSidechainAppendInput): Promise<EvidenceDagSidechainAppendOutput>
  update(input: EvidenceDagUpdateInput): Promise<EvidenceDagUpdateOutput>
  priority(input: EvidenceDagPriorityInput): Promise<EvidenceDagCanonicalStatus>
  preview(input: EvidenceDagPreviewInput): Promise<EvidenceDagPreviewOutput>
  exportSnapshotProducts(
    input: EvidenceDagExportSnapshotProductsInput
  ): Promise<EvidenceDagExportSnapshotProductsOutput>
  guardWriteExport(payload: unknown): Promise<DomainMainActionGuardResult>
  close(): Promise<void>
}>

export class EvidenceDagRuntime implements EvidenceDagRuntimePort {
  private context: DomainMainRuntimeLifecycleContext | undefined
  private enabled = false
  private closed = false
  private closePromise: Promise<void> | undefined
  private enablementDisposer: DomainMainRuntimeDisposer | undefined
  private readonly sidecar: EvidenceDagSidecarPort
  private readonly client: EvidenceDagServiceClient
  private readonly artifactVersions: EvidenceArtifactVersionClient
  private readonly artifactVersionLifecycle: EvidenceArtifactVersionLifecycleConsumer
  private readonly scientificPlottingProvenance: ScientificPlottingProvenanceConsumer
  private readonly deltaStore: EvidenceDagDeltaStore
  private readonly now: () => Date
  private readonly artifactVersionCommit: (workspaceRoot: string) => ArtifactVersionCommitPortV1
  private readonly artifactVersionRead: (workspaceRoot: string) => ArtifactVersionReadPortV1
  private readonly visibleSurfacesByThread = new Map<string, Set<string>>()

  constructor(options: Readonly<{
    userDataDir: string
    sidecar?: EvidenceDagSidecarPort
    client?: EvidenceDagServiceClient
    fetchImpl?: typeof fetch
    now?: () => Date
    artifactVersionCommitPort?: ArtifactVersionCommitPortV1
    artifactVersionReadPort?: ArtifactVersionReadPortV1
    artifactVersionEventListPort?: ArtifactVersionEventListPortV1
    artifactVersionLifecyclePollIntervalMs?: number
    artifactVersionLifecyclePageSize?: number
    scientificPlottingProvenancePollIntervalMs?: number
    deltaStore?: EvidenceDagDeltaStore
  }>) {
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
    this.scientificPlottingProvenance = new ScientificPlottingProvenanceConsumer({
      discoverWorkspaces: () => this.discoverProvenanceWorkspaces(),
      prepare: (workspaceRoot, receipt) =>
        this.prepareScientificPlottingProvenance(workspaceRoot, receipt),
      append: (input) => this.appendTrace(input),
      afterAppend: (prepared) => this.artifactVersionLifecycle.rememberThread({
        runtimeId: prepared.runtimeId,
        threadId: prepared.threadId,
        workspaceRoot: prepared.workspaceRoot,
        targetWatermark: prepared.targetWatermark,
        trace: prepared.trace
      }),
      now: options.now,
      ...(options.scientificPlottingProvenancePollIntervalMs !== undefined
        ? { pollIntervalMs: options.scientificPlottingProvenancePollIntervalMs }
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
    await this.deltaStore.load()
    await this.deltaStore.importLegacySnapshots(join(context.userDataDir, 'evidence-dag', 'threads'))
    await this.deltaStore.reconcileProvisional({
      compilerVersion: 'evidence-provisional.v1',
      policyVersion: 'evidence-provisional-policy.v1',
      now: this.now().toISOString()
    })
    this.enabled = await context.enablement.isEnabled()
    await this.artifactVersionLifecycle.start(this.enabled)
    await this.scientificPlottingProvenance.start(this.enabled)
    if (this.enabled) this.ensureSidecarInBackground()
    this.enablementDisposer = context.enablement.subscribe((enabled) => {
      this.enabled = enabled
      void this.artifactVersionLifecycle.setEnabled(enabled)
      void this.scientificPlottingProvenance.setEnabled(enabled)
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

  async consume(event: DomainArtifactEvent): Promise<void> {
    if (!this.context || !this.enabled) return
    const scope = domainArtifactEventScope(event)
    if (!scope.workspaceRoot) return
    const trace = await this.artifactVersions.pinTrace(
      evidenceTraceFromArtifactEvent(event),
      {
        runtimeId: scope.runtimeId,
        threadId: scope.threadId,
        operationId: event.kind === 'turn-completed' ? event.turnId : event.runId,
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
      operationId: event.kind === 'turn-completed' ? event.turnId : event.runId,
      kind: event.kind === 'turn-completed' ? 'turn' : 'execution',
      requestedWatermark: event.targetWatermark,
      idempotencyKey: `artifact-event:${event.kind}:${evidenceDagThreadId(runtimeId, threadId)}:${event.kind === 'turn-completed' ? event.turnId : event.runId}`,
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
    evidenceDagWorkspaceRoot(input.workspaceRoot, thread.workspaceRoot)
    await this.sidecar.ensureReady()
    const status = await this.status(input.runtimeId, input.threadId)
    return evidenceDagViewOutputSchema.parse({
      url: this.client.uiUrl(input.runtimeId, input.threadId),
      threadId: evidenceDagThreadId(input.runtimeId, input.threadId),
      status
    })
  }

  async snapshotStatus(
    raw: EvidenceDagSnapshotStatusInput
  ): Promise<EvidenceDagCanonicalStatus> {
    const input = evidenceDagSnapshotStatusInputSchema.parse(raw)
    const context = await this.requireEnabled()
    let authoritativeWorkspaceRoot: string | undefined
    try {
      authoritativeWorkspaceRoot = (await context.agentThreads.read({
        runtimeId: input.runtimeId,
        threadId: input.threadId
      })).workspaceRoot
    } catch {
      authoritativeWorkspaceRoot = undefined
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
    const input = evidenceDagSidechainAppendInputSchema.parse(raw)
    const context = await this.requireEnabled()
    const thread = await context.agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.threadId
    })
    evidenceDagWorkspaceRoot(input.workspaceRoot, thread.workspaceRoot)
    const result = await this.deltaStore.appendSidechain({
      threadId: evidenceDagThreadId(input.runtimeId, input.threadId),
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

  async update(raw: EvidenceDagUpdateInput): Promise<EvidenceDagUpdateOutput> {
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
    const status = await this.status(input.runtimeId, input.threadId)
    return evidenceDagUpdateOutputSchema.parse({
      url: this.client.uiUrl(input.runtimeId, input.threadId),
      threadId: evidenceDagThreadId(input.runtimeId, input.threadId),
      itemCount: trace.length,
      deltaDigest: appended.delta.deltaDigest,
      idempotent: appended.idempotent,
      status
    })
  }

  async sealClosure(
    raw: EvidenceDagSealClosureInput
  ): Promise<EvidenceDagSealClosureOutput> {
    const input = evidenceDagSealClosureInputSchema.parse(raw)
    const context = await this.requireEnabled()
    const thread = await context.agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.threadId
    })
    evidenceDagWorkspaceRoot(input.workspaceRoot, thread.workspaceRoot)
    const closure = await this.deltaStore.seal(
      evidenceDagThreadId(input.runtimeId, input.threadId),
      input.policy
    )
    return evidenceDagSealClosureOutputSchema.parse(closure)
  }

  async priority(raw: EvidenceDagPriorityInput): Promise<EvidenceDagCanonicalStatus> {
    const input = evidenceDagPriorityInputSchema.parse(raw)
    const context = await this.requireEnabled()
    const thread = await context.agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.threadId
    })
    evidenceDagWorkspaceRoot(input.workspaceRoot, thread.workspaceRoot)
    const visible = updateEvidenceDagVisibleSurfaces(
      this.visibleSurfacesByThread,
      input.runtimeId,
      input.threadId,
      input.surfaceId,
      input.visible
    )
    return evidenceDagPriorityOutputSchema.parse(
      await this.status(input.runtimeId, input.threadId)
    )
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
    const snapshotEvidence = await this.client.evidencePreview(input)
    return evidenceDagPreviewOutputSchema.parse(await resolveEvidenceDagPreview({
      request: input,
      engineThreadId: evidenceDagThreadId(input.runtimeId, input.threadId),
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
    const engineThreadId = evidenceDagThreadId(input.runtimeId, input.threadId)
    const projection = await this.client.snapshotProducts(
      engineThreadId,
      input.snapshotDigest,
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
      const targetDigest = status.authoritativeHead?.headDigest ?? status.committed?.digest
      if (!targetDigest) {
        throw new Error('Evidence export requires an existing sealed or legacy snapshot audit target.')
      }
      await this.sidecar.ensureReady()
      audit = evidenceDagAuditForGate(await this.client.audit(
        evidenceDagThreadId(input.runtimeId, input.threadId),
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
    await this.enablementDisposer?.()
    this.enablementDisposer = undefined
    await this.scientificPlottingProvenance.close()
    await this.artifactVersionLifecycle.close()
    this.context = undefined
    this.visibleSurfacesByThread.clear()
    await this.sidecar.stop()
  }

  private async status(runtimeId: string, threadId: string): Promise<EvidenceDagCanonicalStatus> {
    return this.localStatus(runtimeId, threadId)
  }

  private async appendTrace(input: EvidenceDagTraceAppendInput): Promise<EvidenceDagAppendResult> {
    const result = await this.deltaStore.append(evidenceDagDeltaInputFromTrace({
      ...input,
      threadId: evidenceDagThreadId(input.runtimeId, input.threadId)
    }))
    const authoritativeHead = await this.deltaStore.head(
      evidenceDagThreadId(input.runtimeId, input.threadId)
    )
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
        evidenceDagThreadId(input.runtimeId, input.threadId),
        compileInput
      )
    } catch (error) {
      await this.deltaStore.compileProvisional(
        evidenceDagThreadId(input.runtimeId, input.threadId),
        {
          ...compileInput,
          failure: {
            code: 'internal_error',
            message: error instanceof Error ? error.message : String(error),
            retryable: true,
            occurredAt: this.now().toISOString()
          }
        }
      )
    }
    return result
  }

  private async localStatus(
    runtimeId: string,
    threadId: string,
    workspaceRoot?: string
  ): Promise<EvidenceDagCanonicalStatus> {
    const engineThreadId = evidenceDagThreadId(runtimeId, threadId)
    const chain = await this.deltaStore.chain(engineThreadId)
    const records = chain.list()
    const first = records[0]
    if (first && (
      first.scope.runtimeId !== runtimeId ||
      (workspaceRoot && resolve(first.scope.workspaceRoot) !== resolve(workspaceRoot))
    )) return this.emptyStatus()
    const head = chain.head
    const provisional = chain.provisionalView
    const committed = chain.legacyCheckpointRoot?.snapshot ?? null
    const summary = provisional?.summary
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
      freshness: summary?.freshness ?? (head.headDigest ? 'pending' : 'unknown'),
      coverage: summary?.coverage ?? { complete: false, gapCount: 0 },
      materialRiskCount: summary?.materialRiskCount ?? 0,
      lastSuccessAt: summary?.lastSuccessAt ?? null,
      failure: summary?.failure ?? null
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
    const trace = await this.artifactVersions.pinTrace(evidenceTraceFromThread(detail), {
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

  private async prepareScientificPlottingProvenance(
    workspaceRoot: string,
    receipt: ScientificPlottingProvenanceReceiptV1
  ): Promise<ScientificPlottingProvenancePreparation> {
    const context = this.context
    if (!context || !this.enabled || !receipt.runtimeId || !receipt.threadId) {
      throw new Error('Evidence DAG runtime or Scientific Plotting target is unavailable.')
    }
    const detail = await context.agentThreads.read({
      runtimeId: receipt.runtimeId,
      threadId: receipt.threadId
    })
    if (detail.runtimeId !== receipt.runtimeId || detail.id !== receipt.threadId) {
      throw new Error('Scientific Plotting provenance resolved to a different Evidence thread.')
    }
    const capturedWorkspace = evidenceDagWorkspaceRoot(workspaceRoot, detail.workspaceRoot)
    await verifyScientificPlottingArtifactRefs(
      scientificPlottingReceiptArtifactRefs(receipt),
      this.artifactVersionRead(capturedWorkspace)
    )
    const trace = await this.artifactVersions.pinTrace([
      ...evidenceTraceFromThread(detail),
      scientificPlottingEvidenceTraceItem(receipt)
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

function genericGuardDecision(decision: ReturnType<typeof evaluateEvidenceDagHighImpactGate>) {
  return {
    allowed: decision.allowed,
    ...(!decision.allowed || decision.metadata.advisory ? { message: decision.message } : {}),
    metadata: domainPackageJsonValueSchema.parse(decision.metadata)
  }
}

async function verifyScientificPlottingArtifactRefs(
  refs: readonly ArtifactVersionRefV1[],
  readPort: ArtifactVersionReadPortV1
): Promise<void> {
  if (refs.length > 1_024) {
    throw new Error('Scientific Plotting provenance exceeds the exact version-ref limit.')
  }
  const declaredBytes = refs.reduce((total, ref) => total + ref.byteLength, 0)
  if (declaredBytes > 256 * 1024 * 1024) {
    throw new Error('Scientific Plotting provenance exceeds the exact byte-validation budget.')
  }
  for (const expected of refs) {
    const result = await readPort.read({ versionId: expected.versionId })
    if (!result.ok) {
      throw new Error(
        `Scientific Plotting ArtifactVersion ${expected.versionId} is unavailable: ${result.issue.message}`
      )
    }
    if (!isDeepStrictEqual(result.value.ref, expected)) {
      throw new Error(
        `Scientific Plotting ArtifactVersion ${expected.versionId} does not match its exact ref.`
      )
    }
    const bytes = Buffer.from(result.value.dataBase64, 'base64')
    const digest = createHash('sha256').update(bytes).digest('hex')
    if (bytes.byteLength !== expected.byteLength || digest !== expected.contentDigest) {
      throw new Error(
        `Scientific Plotting ArtifactVersion ${expected.versionId} failed byte integrity validation.`
      )
    }
  }
}
