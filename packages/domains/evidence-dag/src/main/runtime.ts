import { join, resolve } from 'node:path'
import { domainPackageJsonValueSchema } from '@sciforge/domain-sdk'
import type {
  DomainAgentArtifactEvent,
  DomainMainActionGuardResult,
  DomainMainRuntimeLifecycleContext,
  DomainMainRuntimeDisposer
} from '@sciforge/domain-sdk/host'
import {
  evidenceDagActivationPayloadSchema,
  evidenceDagCanonicalStatusSchema,
  evidenceDagPreviewInputSchema,
  evidenceDagPreviewOutputSchema,
  evidenceDagPriorityInputSchema,
  evidenceDagPriorityOutputSchema,
  evidenceDagUpdateInputSchema,
  evidenceDagUpdateOutputSchema,
  evidenceDagViewInputSchema,
  evidenceDagViewOutputSchema,
  type EvidenceDagCanonicalStatus,
  type EvidenceDagPreviewInput,
  type EvidenceDagPreviewOutput,
  type EvidenceDagPriorityInput,
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
  EvidenceDagServiceError,
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
import { EvidenceDagQueue } from './queue.js'
import {
  EvidenceDagSidecar,
  type EvidenceDagSidecarPort
} from './sidecar.js'

export type EvidenceDagRuntimePort = Readonly<{
  activate(context: DomainMainRuntimeLifecycleContext): Promise<DomainMainRuntimeDisposer>
  consume(event: DomainAgentArtifactEvent): Promise<void>
  view(input: EvidenceDagViewInput): Promise<EvidenceDagViewOutput>
  update(input: EvidenceDagUpdateInput): Promise<EvidenceDagUpdateOutput>
  priority(input: EvidenceDagPriorityInput): Promise<EvidenceDagCanonicalStatus>
  preview(input: EvidenceDagPreviewInput): Promise<EvidenceDagPreviewOutput>
  guardWriteExport(payload: unknown): Promise<DomainMainActionGuardResult>
  close(): Promise<void>
}>

export class EvidenceDagRuntime implements EvidenceDagRuntimePort {
  private context: DomainMainRuntimeLifecycleContext | undefined
  private enabled = false
  private closed = false
  private enablementDisposer: DomainMainRuntimeDisposer | undefined
  private readonly sidecar: EvidenceDagSidecarPort
  private readonly client: EvidenceDagServiceClient
  private readonly queue: EvidenceDagQueue

  constructor(options: Readonly<{
    userDataDir: string
    sidecar?: EvidenceDagSidecarPort
    client?: EvidenceDagServiceClient
    queue?: EvidenceDagQueue
    fetchImpl?: typeof fetch
    now?: () => Date
  }>) {
    this.sidecar = options.sidecar ?? new EvidenceDagSidecar({ fetchImpl: options.fetchImpl })
    this.client = options.client ?? new EvidenceDagServiceClient({
      endpoint: () => this.sidecar.endpoint(),
      fetchImpl: options.fetchImpl,
      now: options.now
    })
    this.queue = options.queue ?? new EvidenceDagQueue({
      storagePath: join(options.userDataDir, 'evidence-dag', 'desktop-update-queue.json'),
      submit: async (input, reportActivity) => {
        await this.sidecar.ensureReady()
        try {
          return await this.client.update(input, reportActivity)
        } catch (error) {
          if (
            error instanceof EvidenceDagServiceError &&
            error.diagnostic.code === 'upstream_timeout'
          ) {
            // Closing the package-owned process also closes any HTTP handler
            // that outlived the desktop observation deadline. The durable
            // queue can then retry without overlapping an abandoned POST.
            await this.sidecar.stop()
          }
          throw error
        }
      },
      now: options.now,
      canRunBackground: () => !this.context?.agentThreads.hasActiveTurns()
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
    await this.queue.start(this.enabled)
    if (this.enabled) this.ensureSidecarInBackground()
    this.enablementDisposer = context.enablement.subscribe((enabled) => {
      this.enabled = enabled
      void this.queue.setEnabled(enabled)
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

  async consume(event: DomainAgentArtifactEvent): Promise<void> {
    if (!this.context || !this.enabled || !event.artifacts.length || !event.workspaceRoot) return
    const trace = evidenceTraceFromArtifactEvent(event)
    if (!trace.length) return
    await this.queue.enqueue({
      runtimeId: event.runtimeId,
      threadId: event.threadId,
      engineThreadId: evidenceDagThreadId(event.runtimeId, event.threadId),
      targetWatermark: event.targetWatermark,
      reason: 'turn_committed',
      priority: 'background',
      trace,
      workspaceRoot: event.workspaceRoot
    })
  }

  async view(raw: EvidenceDagViewInput): Promise<EvidenceDagViewOutput> {
    const input = evidenceDagViewInputSchema.parse(raw)
    await this.requireEnabled()
    if (!input.runtimeId || !input.threadId) {
      return evidenceDagViewOutputSchema.parse({
        url: this.client.uiUrl(),
        status: this.emptyStatus()
      })
    }
    await this.sidecar.ensureReady()
    const status = await this.status(input.runtimeId, input.threadId)
    return evidenceDagViewOutputSchema.parse({
      url: this.client.uiUrl(input.runtimeId, input.threadId),
      threadId: evidenceDagThreadId(input.runtimeId, input.threadId),
      status
    })
  }

  async update(raw: EvidenceDagUpdateInput): Promise<EvidenceDagUpdateOutput> {
    const input = evidenceDagUpdateInputSchema.parse(raw)
    const context = await this.requireEnabled()
    await this.sidecar.ensureReady()
    const detail = await context.agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.threadId
    })
    const workspaceRoot = evidenceDagWorkspaceRoot(input.workspaceRoot, detail.workspaceRoot)
    const trace = evidenceTraceFromThread(detail)
    const queued = await this.queue.enqueue({
      runtimeId: input.runtimeId,
      threadId: input.threadId,
      engineThreadId: evidenceDagThreadId(input.runtimeId, input.threadId),
      targetWatermark: detail.watermark,
      reason: input.operation === 'rebuild'
        ? input.rebuildKind ?? 'reinterpretation'
        : 'manual_immediate',
      priority: 'immediate',
      trace,
      workspaceRoot,
      ...(input.operation === 'rebuild' ? { rebuild: true } : {}),
      ...(input.rebuildRationale ? { rebuildRationale: input.rebuildRationale } : {})
    })
    const status = await this.status(input.runtimeId, input.threadId)
    return evidenceDagUpdateOutputSchema.parse({
      url: this.client.uiUrl(input.runtimeId, input.threadId),
      threadId: evidenceDagThreadId(input.runtimeId, input.threadId),
      itemCount: queued.itemCount,
      jobId: queued.jobId,
      coalesced: queued.coalesced,
      status
    })
  }

  async priority(raw: EvidenceDagPriorityInput): Promise<EvidenceDagCanonicalStatus> {
    const input = evidenceDagPriorityInputSchema.parse(raw)
    await this.requireEnabled()
    await this.queue.prioritize(input.runtimeId, input.threadId, input.visible)
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
    if (!thread.workspaceRoot) {
      return {
        ok: false,
        code: 'file_unavailable',
        message: 'The Evidence thread has no workspace root.'
      }
    }
    const snapshotEvidence = await this.client.evidencePreview(input)
    return evidenceDagPreviewOutputSchema.parse(await resolveEvidenceDagPreview({
      request: input,
      engineThreadId: evidenceDagThreadId(input.runtimeId, input.threadId),
      workspaceRoot: thread.workspaceRoot,
      snapshotEvidence
    }))
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
      const update = await this.update({
        runtimeId: input.runtimeId,
        threadId: input.threadId,
        ...(input.workspaceRoot ? { workspaceRoot: input.workspaceRoot } : {})
      })
      const snapshot = await this.queue.waitForCommitted(update.jobId)
      audit = evidenceDagAuditForGate(await this.client.audit(
        snapshot.threadId,
        snapshot.digest
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
    if (this.closed) return
    this.closed = true
    await this.enablementDisposer?.()
    this.enablementDisposer = undefined
    this.context = undefined
    await Promise.all([this.queue.close(), this.sidecar.stop()])
  }

  private async status(runtimeId: string, threadId: string): Promise<EvidenceDagCanonicalStatus> {
    const [serviceCommitted, localCommitted, queuedPending] = await Promise.all([
      this.client.committedSnapshot(evidenceDagThreadId(runtimeId, threadId)).catch(() => null),
      this.queue.committed(runtimeId, threadId),
      this.queue.pending(runtimeId, threadId)
    ])
    const committed = serviceCommitted ?? localCommitted
    const pending = committed && queuedPending &&
      evidenceDagWatermarkCovers(committed.inputWatermark, queuedPending.targetWatermark)
      ? null
      : queuedPending
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
}

export function parseEvidenceDagActivation(value: unknown) {
  return evidenceDagActivationPayloadSchema.parse(value)
}

export function evidenceDagWatermarkCovers(committed: string, target: string): boolean {
  if (committed === target) return true
  if (committed.startsWith(`${target}:batch:`)) {
    const match = /:batch:(\d+)\/(\d+)$/u.exec(committed)
    return Boolean(match && match[1] === match[2])
  }
  const committedSequence = leadingSequence(committed)
  const targetSequence = leadingSequence(target)
  if (committedSequence !== null && targetSequence !== null) {
    return committedSequence > targetSequence
  }
  const committedTime = Date.parse(committed)
  const targetTime = Date.parse(target)
  return Number.isFinite(committedTime) && Number.isFinite(targetTime) &&
    committedTime > targetTime
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

function leadingSequence(value: string): number | null {
  const match = /^(\d+)(?::|$)/u.exec(value)
  if (!match) return null
  const sequence = Number(match[1])
  return Number.isSafeInteger(sequence) ? sequence : null
}

function genericGuardDecision(decision: ReturnType<typeof evaluateEvidenceDagHighImpactGate>) {
  return {
    allowed: decision.allowed,
    ...(!decision.allowed || decision.metadata.advisory ? { message: decision.message } : {}),
    metadata: domainPackageJsonValueSchema.parse(decision.metadata)
  }
}
