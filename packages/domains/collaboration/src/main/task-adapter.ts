import { createHash, randomUUID } from 'node:crypto'
import type { DomainMainWakeupsHost } from '@sciforge/domain-sdk/host'
import { validateWorkerFollowupTime, workerFollowupView, type WorkerFollowup } from '../task-followup.js'
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {
  cloudResourceRefSchema,
  deliveryCandidateSchema,
  deliveryManifestSchema,
  exactContractReferenceHistorySchema,
  frozenDeliveryBundleSchema,
  canonicalFrozenDeliveryBundleBytes,
  frozenDeliveryBundleDigest,
  taskDeliveryFactsSchema,
  workerDeliveryConfirmationDigest,
  workerDeliveryHumanActionFactDigest,
  workerDeliveryHumanActionProofSchema,
  restRequestSchema,
  restResponseSchema,
  taskSchema,
  taskExecutionSchema,
  type AgentInboxMessage,
  type CloudResourceRef,
  type CloudStateEvent,
  type ExactContractReferenceHistory,
  type FrozenDeliveryBundle,
  type FrozenDeliveryBundleHistory,
  type HumanAnswer,
  type RestEntity,
  type RestResponse,
  type ProjectCoordinationFactPage,
  type Task,
  type TaskDeliveryFacts,
  type TaskExecution,
  type TaskOffer,
  type TaskOfferClosedPayload,
  type TaskOfferedPayload,
  type WorkerDeliveryConfirmationTarget
} from '@sciforge/collaboration-contracts'
import {
  parseWorkerRuntimeResult,
  workerRuntimeResultOutputSchema,
  type WorkerRuntimeResult
} from '../worker-runtime-result.js'
import type {
  DomainMainAgentThreadsHost,
  DomainMainAgentExecutionHost,
  DomainMainHumanActionsHost,
  DomainMainTurnLifecycleEventsHost
} from '@sciforge/domain-sdk/host'
import type { AuthenticatedCloudTransport } from '@sciforge/domain-identity-access/authenticated-cloud-transport'
import type { AgentCloudRuntimeError } from '@sciforge/domain-identity-access/agent-cloud-runtime'
import type { DeviceFactAttestationSigningService } from '@sciforge/domain-identity-access/device-fact-attestation-signing'
import { resolveSafeWorkspaceWriteTarget, writeSafeWorkspaceFile } from '@sciforge/domain-sdk/node/workspace-paths'
import { truncateWellFormedUnicode } from '@sciforge/domain-sdk/unicode'
import { validateDeliveryMaterialBytes, deliveryMaterialKind, deliveryMaterialMaxBytes, deliveryMaterialMediaType } from '../delivery-material-policy.js'
import { capabilityRequirementsSatisfied } from '../capability-requirements.js'
import {
  collaborationTaskReturnInputSchema,
  type CollaborationTaskReturnInput,
  collaborationTaskSessionContinueInputSchema,
  type CollaborationTaskSessionContinueInput,
  type CollaborationTaskSessionContinueResult,
  type CollaborationOfferAvailability
} from '../contract.js'
import { collaborationRequestId } from './request-id.js'
import type { CollaborationConnection } from './connection.js'
import { DurableCloudOutbox } from './outbox.js'
import { ensurePrivateWorkspaceRoot } from './private-workspace-root.js'
import { restoreWorkerDeliveryCheckpoint } from './worker-delivery-checkpoint.js'
import { workerSessionContinuationContext } from './worker-session-continuation-context.js'
import {
  CollaborationLocalStore,
  isObjectUploadLimit,
  isDeliveryCandidateValidationFailure,
  type CollaborationOutboxEntry,
  enforceWorkerOutboxAuthorityFence,
  type CollaborationPendingTaskOffer,
  type CollaborationProjectUnavailableFence,
  type CollaborationTaskCheckpoint,
  type CollaborationTaskInteraction,
  type CollaborationTaskRun,
  type FrozenWorkerCandidate,
  workerDeliverySagaSchema,
  type WorkerDeliverySaga
} from './store.js'
import {
  workerResultRepairPrompt,
  workerHumanAnswerPrompt,
  workerTaskPrompt
} from './worker-runtime-result.js'
import {
  TaskInteractionController,
  type LocalTaskInteractionView,
  type TaskInteractionSubmit,
  type TaskInteractionDispatchRequest,
  type TaskInteractionDispatchResult
} from './task-interaction-controller.js'
import type { TaskCheckpointCreate } from './task-interaction-journal.js'
import {
  workerDeliveryCancelInputSchema, type WorkerDeliveryCancelInput,
  workerDeliverySubmitInputSchema,
  workerDeliveryDraftSaveInputSchema,
  workerDeliveryMaterialImportInputSchema,
  type WorkerDeliveryMaterialImportInput,
  workerResidualDisposeInputSchema,
  type WorkerDeliveryView,
  type WorkerDeliveryDraft,
  type WorkerDeliveryDraftSaveInput,
  type WorkerDeliveryReadInput,
  type WorkerDeliverySubmitInput,
  type WorkerDeliveryMaterialsInput,
  type WorkerDeliveryMaterialsResult
} from '../worker-delivery.js'

import { listDeliveryMaterials, readDeliveryMaterials, readDeliveryWorkspaceIdentity } from './worker-delivery-materials.js'

type CollaborationWorkerPreflight = NonNullable<CollaborationTaskRun['latestPreflight']>
type SessionAdmissionEvent = Parameters<Parameters<NonNullable<DomainMainTurnLifecycleEventsHost['subscribeRequiredAdmission']>>[0]>[0]
type SessionOutputEvent = Parameters<Parameters<NonNullable<DomainMainTurnLifecycleEventsHost['subscribeRequiredOutput']>>[0]>[0]

export type CollaborationTaskAdapterOptions = Readonly<{
  wakeups?: DomainMainWakeupsHost
  store: CollaborationLocalStore
  connection: CollaborationConnection
  outbox: DurableCloudOutbox
  agentExecution: DomainMainAgentExecutionHost & Readonly<{
    prepareSession: NonNullable<DomainMainAgentExecutionHost['prepareSession']>
  }>
  humanActions: DomainMainHumanActionsHost
  signing: DeviceFactAttestationSigningService
  authenticatedCloudTransport?: AuthenticatedCloudTransport
  localAgentId: () => string | undefined
  workspaceRootForExecution: (executionId: string) => string
  workspaceDisplayNameForProject?: (projectId: string) => string | undefined
  sanitizeText?: (value: string) => string
  now?: () => Date
}>

export type WorkerOfferDecision = Readonly<{
  decision: 'accept' | 'dismiss' | 'reject'
}>

const TERMINAL_RUN_STATES = new Set<CollaborationTaskRun['state']>([
  'completed',
  'failed',
  'fenced',
  'manual-recovery'
])

const TERMINAL_PENDING_OFFER_STATES = new Set<CollaborationPendingTaskOffer['state']>([
  'dismissed',
  'claimed_elsewhere',
  'closed',
  'failed'
])

const PROJECT_UNAVAILABLE_PRESERVED_RUN_STATES = new Set<CollaborationTaskRun['state']>([
  'completed',
  'failed',
  'fenced'
])

const TERMINAL_EXECUTION_EVENT_STATES = new Set<TaskExecution['state']>([
  'manual_recovery_required',
  'completed',
  'failed',
  'cancelled',
  'revoked',
  'superseded'
])

export function collaborationWorkerSessionTitle(title: string): string {
  return truncateWellFormedUnicode(title.replace(/[\r\n\u0085\u2028\u2029]+/gu, ' ').trim(), 200)
}

/** Canonical durable Worker runner for inbox, HCI, Runtime, transfer, and Cloud state. */
export class CollaborationTaskAdapter {
  private readonly followupWakeups = new Map<string, () => void>()
  private readonly now: () => Date
  private readonly running = new Map<string, Promise<void>>()
  private readonly delivering = new Map<string, 'preparing' | 'signing'>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly activeAgentTurns = new Set<string>()
  private readonly interactionDispatchWindows = new Set<string>()
  private readonly retryDispatchGates = new Map<string, { key: string; owners: number }>()
  private readonly continuingExecutions = new Map<string, Promise<CollaborationTaskSessionContinueResult>>()
  private readonly finalizingExecutions = new Set<string>()
  private readonly returningExecutions = new Map<string, Promise<void>>()
  private readonly interactions: TaskInteractionController
  private stopped = false

  constructor(private readonly options: CollaborationTaskAdapterOptions) {
    this.now = options.now ?? (() => new Date())
    this.interactions = new TaskInteractionController({
      store: options.store,
      now: this.now,
      sanitizeText: options.sanitizeText,
      canDispatch: (executionId) => (
        (this.interactionDispatchWindows.has(executionId) || this.retryDispatchGates.has(executionId)) &&
        !this.activeAgentTurns.has(executionId)
      ),
      canDispatchInteraction: (interaction) => {
        if (!interaction.executionId) return true
        const retryGate = this.retryDispatchGates.get(interaction.executionId)
        return retryGate ? interaction.idempotencyKey === retryGate.key : true
      },
      canSubmit: (executionId) => !this.finalizingExecutions.has(executionId),
      dispatch: (request) => this.dispatchTaskInteraction(request)
    })
  }

  async recover(): Promise<void> {
    this.stopped = false
    const retryDispatchKeys = new Map(this.options.store.snapshot().taskInteractions
      .filter((interaction) => (
        interaction.kind === 'retry' && interaction.executionId &&
        interaction.state === 'queued'
      ))
      .map((interaction) => [interaction.executionId!, interaction.idempotencyKey]))
    for (const [executionId, key] of retryDispatchKeys) this.acquireRetryDispatch(executionId, key)
    this.wake()
    try {
      await this.interactions.recover()
    } finally {
      for (const [executionId, key] of retryDispatchKeys) this.releaseRetryDispatch(executionId, key)
    }
  }

  /** Resume durable intents and bound executions on the existing heartbeat. */
  wake(): void {
    if (this.stopped) return
    for (const offer of this.options.store.snapshot().pendingTaskOffers) {
      if (!['dismissed', 'closed', 'claimed_elsewhere'].includes(offer.state) && !offer.authorityFencedAt) {
        this.schedule(offer.taskOfferId)
      }
    }
    for (const run of this.options.store.snapshot().taskRuns) {
      this.armFollowup(run)
      if (run.authorityFencedAt) continue
      const continuation = this.pendingContinuation(run)
      if (continuation) {
        this.scheduleContinuation(run.offer.executionId, continuation.operationId)
        continue
      }
      if (run.externalJournal.some((entry) => entry.state === 'effect_dispatched')) {
        this.schedule(run.offer.executionId)
      } else if (!TERMINAL_RUN_STATES.has(run.state) || this.hasDeliveryRecovery(run)) {
        this.schedule(run.offer.executionId)
      }
    }
  }

  stop(): void {
    for (const cancel of this.followupWakeups.values()) cancel()
    this.followupWakeups.clear()
    this.stopped = true
    for (const controller of this.controllers.values()) controller.abort()
    this.interactions.stop()
  }

  async waitForIdle(executionId?: string): Promise<void> {
    if (executionId) await this.running.get(executionId)
    else {
      while (this.running.size > 0) await Promise.all([...this.running.values()])
    }
  }

  private armFollowup(run: CollaborationTaskRun): void {
    const active = run.followups?.find((item) => item.state === 'waiting' || item.state === 'dispatching')
    const key = run.offer.executionId
    if (this.followupWakeups.has(key) || !active || this.stopped || !this.options.wakeups ||
        TERMINAL_RUN_STATES.has(run.state) || run.authorityFencedAt) return
    if (Date.parse(active.at) <= this.now().getTime()) return
    this.followupWakeups.set(key, this.options.wakeups.schedule(active.at, () => {
      this.followupWakeups.delete(key)
      if (!this.stopped) this.scheduleAfterCurrent(key)
    }))
  }

  private async settleFollowup(executionId: string, id: string, state: WorkerFollowup['state'], reason: string | null = null): Promise<void> {
    await this.options.store.transact((draft) => {
      const run = requireDraftRun(draft.taskRuns, executionId)
      const followup = run.followups.find((item) => item.id === id)
      if (followup && ['waiting', 'dispatching'].includes(followup.state)) {
        followup.state = state
        followup.reason = reason
      }
    })
    if (state !== 'dispatching') {
      this.followupWakeups.get(executionId)?.()
      this.followupWakeups.delete(executionId)
    }
  }

  /** Persist the intent from the exact observed turn before releasing its model slot. */
  private async deferWorkerResult(run: CollaborationTaskRun, result: Extract<WorkerRuntimeResult, { outcome: 'deferred' }>): Promise<void> {
    run = this.requireRun(run.offer.executionId)
    const source = run.agentJournal.at(-1)
    if (!source || source.state !== 'observed_success' || !source.turnId || !source.observedAt ||
        !run.runtimeId || !run.threadId || !source.safeResultText ||
        JSON.stringify(parseWorkerRuntimeResult(source.safeResultText)) !== JSON.stringify(result)) {
      throw new Error('复查缺少当前执行轮次的完整回执，未安排自动续办。')
    }
    if (run.followups.some((item) => item.sourceInvocationId === source.logicalInvocationId)) return
    validateWorkerFollowupTime(result.followup.at, new Date(source.observedAt))
    if (run.followups.length >= 8) throw new Error('本任务已达到八次复查上限，请由成员查看后继续。')
    if (!this.options.wakeups) throw new Error('当前宿主不支持任务复查，未安排自动续办。')
    const contractDigest = requireTask(run).contractDigest ?? requireExecution(run).contractDigest
    if (!contractDigest) throw new Error('任务缺少精确要求版本，未安排自动续办。')
    const followup: WorkerFollowup = {
      ...result.followup, id: `followup-${digest(source.logicalInvocationId).slice(0, 48)}`,
      sourceInvocationId: source.logicalInvocationId, sourceTurnId: source.turnId,
      runtimeId: run.runtimeId, threadId: run.threadId, contractDigest,
      inputResources: run.resources,
      createdAt: source.observedAt, state: 'waiting', reason: null
    }
    await this.options.store.transact((draft) => {
      const current = requireDraftRun(draft.taskRuns, run.offer.executionId)
      if (!['running', 'waiting-result-confirm'].includes(current.state) || current.executionMode !== 'ai' || current.authorityFencedAt || current.agentJournal.at(-1)?.logicalInvocationId !== source.logicalInvocationId) return
      for (const previous of current.followups) {
        if (['waiting', 'dispatching'].includes(previous.state)) previous.state = 'completed'
      }
      current.followups.push(followup)
      current.state = 'running'
      current.resultSummary = null
      current.error = null
    })
    this.followupWakeups.get(run.offer.executionId)?.()
    this.followupWakeups.delete(run.offer.executionId)
    this.armFollowup(this.requireRun(run.offer.executionId))
  }

  private acquireRetryDispatch(executionId: string, key: string): void {
    const gate = this.retryDispatchGates.get(executionId)
    if (gate) {
      if (gate.key !== key) throw new Error('A different Task retry is already in progress.')
      gate.owners += 1
      return
    }
    this.retryDispatchGates.set(executionId, { key, owners: 1 })
  }

  private releaseRetryDispatch(executionId: string, key: string): void {
    const gate = this.retryDispatchGates.get(executionId)
    if (!gate || gate.key !== key) return
    gate.owners -= 1
    if (gate.owners === 0) this.retryDispatchGates.delete(executionId)
  }

  private readonly openingTaskSessions = new Map<string, Promise<Readonly<{ runtimeId: string; threadId: string }>>>()

  async ensureTaskSession(input: Readonly<{ projectId: string; taskId: string; executionId: string }>, userId: string): Promise<Readonly<{ runtimeId: string; threadId: string }>> {
    const run = this.requireRun(input.executionId)
    if (run.offer.projectId !== input.projectId || run.offer.taskId !== input.taskId ||
        run.execution?.assigneeUserId !== userId || run.execution.assigneeAgentId !== this.options.localAgentId()) {
      throw new Error('只有当前电脑上的任务执行人可以打开任务会话。')
    }
    if (run.runtimeId || run.threadId) return requireRunSession(run)
    this.assertDraftEditable(run, input)
    const pending = this.openingTaskSessions.get(input.executionId)
    if (pending) return pending
    const operation = (async () => {
      const session = await this.options.agentExecution.prepareSession({ workspaceRoot: run.workspaceRoot,
        title: collaborationWorkerSessionTitle(requireTask(run).title), interaction: 'reviewable', mode: 'agent' })
      return this.options.store.transact((state) => {
        const current = requireDraftRun(state.taskRuns, input.executionId)
        this.assertDraftEditable(current, input)
        if (state.user?.userId !== userId || current.execution?.assigneeAgentId !== this.options.localAgentId()) {
          throw new Error('会话准备期间协作身份已变化，请重新打开任务。')
        }
        if (current.runtimeId || current.threadId) return requireRunSession(current)
        current.runtimeId = session.runtimeId
        current.threadId = session.threadId
        current.updatedAt = this.now().toISOString()
        return session
      })
    })().finally(() => this.openingTaskSessions.delete(input.executionId))
    this.openingTaskSessions.set(input.executionId, operation)
    return operation
  }

  /** Acceptance records responsibility; only a subsequent human choice starts work. */
  async startTask(input: Readonly<{ projectId: string; taskId: string; executionId: string; mode: 'manual' | 'ai' }>, userId: string): Promise<void> {
    const run = this.requireRun(input.executionId)
    if (run.offer.projectId !== input.projectId || run.offer.taskId !== input.taskId ||
        run.execution?.assigneeUserId !== userId || run.execution.assigneeAgentId !== this.options.localAgentId()) {
      throw new Error('只有这台电脑上的任务执行人可以选择执行方式。')
    }
    this.assertDraftEditable(run, input)
    if (this.delivering.has(input.executionId) || this.activeAgentTurns.has(input.executionId)) throw new Error('请等待当前操作完成。')
    if (run.executionMode === input.mode) return
    if (this.running.has(input.executionId) || this.openingTaskSessions.has(input.executionId)) throw new Error('请等待当前操作完成。')
    await this.options.store.transact((state) => {
      const current = requireDraftRun(state.taskRuns, input.executionId)
      this.assertDraftEditable(current, input)
      if (current.executionMode !== run.executionMode) throw new Error('执行方式已有更新，请刷新后重试。')
      current.executionMode = input.mode
      if (current.execution?.state === 'running') current.state = input.mode === 'ai' ? 'running' : 'waiting-result-confirm'
    })
    this.schedule(input.executionId)
  }

  /** Local control-plane APIs consumed by the Collaboration Runtime. */
  async returnTask(raw: CollaborationTaskReturnInput, userId: string): Promise<void> {
    const input = collaborationTaskReturnInputSchema.parse(raw)
    const run = this.requireRun(input.executionId)
    if (run.offer.projectId !== input.projectId || run.offer.taskId !== input.taskId ||
        run.execution?.assigneeUserId !== userId ||
        run.execution.assigneeAgentId !== this.options.localAgentId()) {
      throw new Error('只有这台电脑上的被派成员可以退回当前任务。')
    }
    const current = this.returningExecutions.get(input.executionId)
    if (current) return current
    const operation = this.returnExecution(input).finally(() => {
      this.returningExecutions.delete(input.executionId)
    })
    this.returningExecutions.set(input.executionId, operation)
    return operation
  }

  private async returnExecution(input: CollaborationTaskReturnInput): Promise<void> {
    let run = this.requireRun(input.executionId)
    if (run.execution?.state === 'failed' && run.execution.fence.status === 'fenced') return
    if (this.delivering.has(input.executionId) || this.hasDeliveryRecovery(run)) {
      throw new Error('交付正在提交，请等待提交结果后再处理任务。')
    }
    const preflight = await this.refreshPreflight(run, true, new AbortController().signal)
    run = this.requireRun(input.executionId)
    if (this.delivering.has(input.executionId) || this.hasDeliveryRecovery(run)) {
      throw new Error('交付正在提交，请等待提交结果后再处理任务。')
    }
    if (preflight.reasons.some((reason) => reason === 'execution_mismatch' || reason === 'agent_inactive') ||
        !['accepted', 'running', 'needs_human'].includes(requireExecution(run).state) ||
        run.task?.currentExecutionId !== input.executionId || run.state === 'completed') {
      throw new Error('任务已结束或执行归属已变化，请刷新后查看。')
    }
    const reason = (this.options.sanitizeText?.(input.reason) ?? input.reason).trim().slice(0, 500)
    if (!reason) throw new Error('请填写退回原因。')
    // Persist the local stop before aborting: late Runtime outcomes and restart
    // recovery must never regain write authority, even if the Cloud is offline.
    if (!TERMINAL_RUN_STATES.has(run.state)) await this.markFenced(run, reason)
    this.controllers.get(input.executionId)?.abort(reason)
    await this.failExecution(this.requireRun(input.executionId), 'worker_returned', reason, true)
  }

  async submitTaskInteraction(input: TaskInteractionSubmit): Promise<CollaborationTaskInteraction> {
    const retryRun = input.kind === 'retry'
      ? this.findRun(input.executionId, input.taskId)
      : undefined
    const retryFailure = retryRun ? latestAgentFailure(retryRun) : undefined
    const retryKeyBase = retryRun && retryFailure
      ? `idem_task-retry_${digest(`${retryRun.offer.executionId}\u0000${retryFailure.logicalInvocationId}`).slice(0, 48)}`
      : undefined
    const retryInteractions = retryKeyBase
      ? this.options.store.snapshot().taskInteractions.filter((interaction) => (
          interaction.executionId === retryRun!.offer.executionId &&
          interaction.kind === 'retry' &&
          interaction.idempotencyKey.startsWith(retryKeyBase)
        ))
      : []
    const pendingRetry = [...retryInteractions].reverse().find((interaction) => (
      interaction.state === 'queued' || interaction.state === 'dispatching' ||
      interaction.state === 'awaiting_cloud'
    ))
    const submittedInput = input.kind === 'retry' && retryFailure
      ? {
          ...input,
          idempotencyKey: input.idempotencyKey ?? pendingRetry?.idempotencyKey ??
            `${retryKeyBase}_${retryInteractions.length + 1}`
        }
      : input
    const retryDispatchKey = input.kind === 'retry' ? submittedInput.idempotencyKey : undefined
    const retryExecutionId = input.kind === 'retry' ? retryRun?.offer.executionId : undefined
    if (retryExecutionId && retryDispatchKey) {
      this.acquireRetryDispatch(retryExecutionId, retryDispatchKey)
    }
    let interaction: CollaborationTaskInteraction
    try {
      interaction = await this.interactions.submit(submittedInput)
    } finally {
      if (
        retryExecutionId && retryDispatchKey
      ) {
        this.releaseRetryDispatch(retryExecutionId, retryDispatchKey)
      }
    }
    // A local resume is the explicit human signal that a paused run may be
    // scheduled again.  The Cloud execution remains the same and will still
    // pass the normal preflight before the next Worker turn.
    if (input.kind === 'resume' && interaction.state === 'applied') {
      const run = this.findRun(input.executionId, input.taskId)
      if (run) this.schedule(run.offer.executionId)
    }
    // Explicit human confirmation releases a result that is parked in the
    // local "waiting-result-confirm" gate; the same run then submits.
    if (input.kind === 'confirm-result' && interaction.state === 'queued') {
      const run = this.findRun(input.executionId, input.taskId)
      if (run && run.state === 'waiting-result-confirm') {
        this.schedule(run.offer.executionId)
      }
    }
    if (input.kind === 'retry' && interaction.state === 'applied') {
      const run = this.findRun(input.executionId, input.taskId)
      if (run) this.schedule(run.offer.executionId)
    }
    return interaction
  }

  /** Explicit human handoff, never an automatic retry of the predecessor's work. */
  async continueTaskSession(raw: CollaborationTaskSessionContinueInput, userId: string): Promise<CollaborationTaskSessionContinueResult> {
    const parsed = collaborationTaskSessionContinueInputSchema.parse(raw)
    const input = { ...parsed, reason: truncateWellFormedUnicode(this.options.sanitizeText?.(parsed.reason) ?? parsed.reason, 1_000).trim() || '接续原因已脱敏' }
    const run = this.requireRun(input.executionId)
    if (run.offer.projectId !== input.projectId || run.offer.taskId !== input.taskId ||
        run.execution?.assigneeUserId !== userId || run.execution.assigneeAgentId !== this.options.localAgentId()) {
      throw new Error('Only this Device assigned Worker may continue its exact Task Session.')
    }
    const alreadyContinued = run.sessionContinuations?.some((item) => item.predecessorRuntimeId === input.predecessorRuntimeId && item.predecessorThreadId === input.predecessorThreadId)
    if (!alreadyContinued && (this.activeAgentTurns.has(input.executionId) ||
        this.returningExecutions.has(input.executionId) || this.finalizingExecutions.has(input.executionId))) {
      throw new Error('Wait for the current execution activity to settle before continuing the Session.')
    }
    const active = this.continuingExecutions.get(input.executionId)
    if (active) return active.then(() => this.continueTaskSession(input, userId))
    // Reserve continuation before joining a heartbeat/preflight job so another
    // wake cannot reclaim the execution between settlement and verification.
    const scheduled = this.running.get(input.executionId)
    const operation = Promise.resolve().then(async () => {
      await scheduled
      const current = this.requireRun(input.executionId)
      if (current.offer.projectId !== input.projectId || current.offer.taskId !== input.taskId ||
          current.execution?.assigneeUserId !== userId || current.execution.assigneeAgentId !== this.options.localAgentId()) {
        throw new Error('Only this Device assigned Worker may continue its exact Task Session.')
      }
      return this.prepareTaskContinuation(input)
    }).finally(() => this.continuingExecutions.delete(input.executionId))
    this.continuingExecutions.set(input.executionId, operation)
    const result = await operation
    this.scheduleContinuation(input.executionId, result.clientDirectiveId)
    return result
  }

  private pendingContinuation(run: CollaborationTaskRun) {
    const continuation = run.sessionContinuations?.at(-1)
    if (!continuation || continuation.runtimeId !== run.runtimeId || continuation.threadId !== run.threadId ||
        TERMINAL_RUN_STATES.has(run.state) || run.state === 'needs-human') return undefined
    const index = run.agentJournal.findIndex((entry) => entry.continuationOperationId === continuation.operationId)
    if (index < 0) return continuation
    // A later ordinary input supersedes this turn's local draft application;
    // never replay an older handoff over a newer human or Agent result.
    if (index !== run.agentJournal.length - 1) return undefined
    const invocation = run.agentJournal[index]!
    if (['observed_failure', 'late_outcome'].includes(invocation.state) ||
        run.followups.some((item) => item.sourceInvocationId === invocation.logicalInvocationId) ||
        invocation.state === 'observed_success' && run.deliveryDraft?.sourceTurnId === invocation.turnId) return undefined
    return continuation
  }

  private scheduleContinuation(executionId: string, operationId: string): void {
    if (this.stopped || this.running.has(executionId) || this.pendingContinuation(this.requireRun(executionId))?.operationId !== operationId) return
    const work = this.executeContinuation(executionId, operationId).catch(async (error) => {
      if (!this.stopped) await this.updateRun(executionId, { error: safeError(error, this.options.sanitizeText) })
    }).finally(() => { if (this.running.get(executionId) === work) this.running.delete(executionId) })
    this.running.set(executionId, work)
  }

  private async executeContinuation(executionId: string, operationId: string): Promise<void> {
    const controller = new AbortController()
    this.controllers.set(executionId, controller)
    try {
      const run = this.requireRun(executionId)
      if (this.pendingContinuation(run)?.operationId !== operationId) return
      const control = this.interactions.view(run.offer.projectId, run.offer.taskId, executionId)
      if (control.pending.length > 0 || control.state === 'paused_local' || control.latestInteraction?.kind === 'cancel') throw new Error('The execution is paused or cancelled locally; resolve that control before continuing.')
      const previous = run.agentJournal.find((entry) => entry.continuationOperationId === operationId)
      if (previous && ['observed_failure', 'late_outcome'].includes(previous.state)) return
      const authorized = await this.authorizeExecution(run, controller.signal)
      if (!authorized || this.pendingContinuation(this.requireRun(executionId))?.operationId !== operationId) return
      if (previous?.state !== 'observed_success') await this.updateRun(executionId, { state: 'running', error: null })
      const result = previous?.state === 'observed_success'
        ? parseWorkerRuntimeResult(previous.safeResultText ?? '')
        : await this.runAgent(authorized, controller.signal, false, undefined, operationId)
      if (!result || this.pendingContinuation(this.requireRun(executionId))?.operationId !== operationId) return
      const latest = this.requireRun(executionId)
      const invocation = latest.agentJournal.at(-1)!
      if (invocation.continuationOperationId !== operationId) return
      if (result.outcome === 'deferred') await this.deferWorkerResult(latest, result)
      else if (result.outcome === 'needs_human') await this.createHumanNeeded(latest, result.question, result.requiredAssurance, controller.signal)
      else await this.updateDeliveryDraft(latest, result.summary, invocation.turnId, false, invocation.logicalInvocationId)
    } finally {
      if (this.controllers.get(executionId) === controller) this.controllers.delete(executionId)
    }
  }

  private assertContinuationSettled(run: CollaborationTaskRun): void {
    if (this.stopped || run.authorityFencedAt || TERMINAL_RUN_STATES.has(run.state) ||
        ['needs-human', 'submitting', 'accepting'].includes(run.state) || run.deliverySaga || run.frozenCandidate ||
        this.activeAgentTurns.has(run.offer.executionId)) throw new Error('Execution cannot accept a Session continuation.')
    if (run.agentJournal.some((entry) => ['prepared', 'dispatched'].includes(entry.state)) ||
        run.externalJournal.some((entry) => !['observed_success', 'observed_failure'].includes(entry.state))) {
      throw new Error('Reconcile pending directives and external outcomes before continuing; blind replay is forbidden.')
    }
    const snapshot = this.options.store.snapshot()
    if (this.interactions.view(run.offer.projectId, run.offer.taskId, run.offer.executionId).state === 'paused_local') throw new Error('Resume the local execution before requesting continuation.')
    if (snapshot.taskInteractions.some((entry) => entry.executionId === run.offer.executionId &&
        ['queued', 'dispatching', 'awaiting_cloud'].includes(entry.state)) ||
        snapshot.outbox.some((entry) => (entry.body.executionId === run.offer.executionId || entry.body.taskId === run.offer.taskId ||
          entry.body.context && typeof entry.body.context === 'object' && !Array.isArray(entry.body.context) &&
          entry.body.context.executionId === run.offer.executionId) && entry.state !== 'delivered' &&
          !this.isSettledCancelledDeliveryRow(run, entry))) {
      throw new Error('Reconcile pending Task interactions and Cloud receipts before continuing.')
    }
  }

  private async prepareTaskContinuation(input: CollaborationTaskSessionContinueInput): Promise<CollaborationTaskSessionContinueResult> {
    let run = this.requireRun(input.executionId)
    const authorized = await this.authorizeExecution(run, new AbortController().signal)
    if (!authorized) throw new Error('Current Cloud authority does not allow Session continuation.')
    run = authorized
    const prior = run.sessionContinuations?.find((item) => item.predecessorRuntimeId === input.predecessorRuntimeId &&
      item.predecessorThreadId === input.predecessorThreadId)
    if (prior) {
      if (run.runtimeId !== prior.runtimeId || run.threadId !== prior.threadId) throw new Error('This continuation has already been superseded.')
      return { opened: true, sessionId: prior.threadId, runtimeId: prior.runtimeId, threadId: prior.threadId,
        context: prior.context, clientDirectiveId: prior.operationId }
    }
    this.assertContinuationSettled(run)
    if (run.runtimeId !== input.predecessorRuntimeId || run.threadId !== input.predecessorThreadId) {
      throw new Error('Continuation predecessor does not match the current exact Session binding.')
    }
    const host = this.options.agentExecution
    if (!host.inspectSession || !host.readAdmission || !host.acquireSubmission || !host.releaseSubmission) throw new Error('Runtime cannot safely inspect and fence a Session continuation.')
    const predecessor = { runtimeId: run.runtimeId, threadId: run.threadId }
    const admission = await host.readAdmission(predecessor)
    if (admission.recovery !== 'ready' || admission.receipts.some((receipt) =>
      !(['rejected', 'abandoned'].includes(receipt.delivery) || receipt.delivery === 'delivered' &&
        ['completed', 'failed', 'cancelled'].includes(receipt.execution)))) {
      throw new Error('Resolve the predecessor Session input and output receipts before continuing.')
    }
    const operationId = `continuation-${digest(`${input.executionId}\0${predecessor.runtimeId}\0${predecessor.threadId}`).slice(0, 48)}`
    const targetDigest = digest(JSON.stringify({ executionId: input.executionId, predecessor }))
    // Fence the canonical input ledger across native inspection and binding.
    // Failed/unknown preparation releases only this operation's exact fence;
    // a committed successor keeps the predecessor fenced permanently.
    await host.acquireSubmission({ ...predecessor, operationId, targetDigest, expectedRevision: admission.revision })
    let committed = false
    try {
      const inspection = await host.inspectSession(predecessor)
      if (inspection.state !== 'missing' && inspection.state !== 'quiescent') {
        throw new Error('The predecessor Runtime is active or unknown; investigate before continuing.')
      }
      const before = this.requireRun(input.executionId)
      this.assertContinuationSettled(before)
      const context = workerSessionContinuationContext({ run: before,
        checkpoints: this.options.store.snapshot().taskCheckpoints,
        predecessor, reason: input.reason, sanitizeText: this.options.sanitizeText })
      const session = await host.prepareSession({ runtimeId: predecessor.runtimeId, workspaceRoot: before.workspaceRoot,
        title: collaborationWorkerSessionTitle(`${before.task?.title ?? 'Task'} · 接续`), interaction: 'reviewable', mode: 'agent' })
      if (session.runtimeId !== predecessor.runtimeId || session.threadId === predecessor.threadId) throw new Error('Runtime did not create a distinct successor on the same Runtime.')
      const current = await this.authorizeExecution(this.requireRun(input.executionId), new AbortController().signal)
      if (!current || current.expectedTaskRevision !== before.expectedTaskRevision ||
          current.expectedExecutionRevision !== before.expectedExecutionRevision ||
          current.task?.contractDigest !== before.task?.contractDigest ||
          JSON.stringify(current.resources) !== JSON.stringify(before.resources)) throw new Error('Cloud facts changed while preparing continuation; refresh and retry.')
      this.assertContinuationSettled(current)
      await this.options.store.transact((draft) => {
        const latest = requireDraftRun(draft.taskRuns, input.executionId)
        if (latest.authorityFencedAt || latest.runtimeId !== predecessor.runtimeId || latest.threadId !== predecessor.threadId ||
            latest.expectedTaskRevision !== current.expectedTaskRevision || latest.expectedExecutionRevision !== current.expectedExecutionRevision ||
            latest.task?.contractDigest !== current.task?.contractDigest || JSON.stringify(latest.resources) !== JSON.stringify(current.resources) ||
            latest.execution?.fence.status !== 'open') throw new Error('Session binding or authority changed during continuation.')
        latest.sessionContinuations ??= []
        latest.sessionContinuations.push({ predecessorRuntimeId: predecessor.runtimeId, predecessorThreadId: predecessor.threadId,
          ...session, operationId, targetDigest, reason: input.reason, context, admissionRevision: admission.revision,
          taskRevision: current.expectedTaskRevision, executionRevision: current.expectedExecutionRevision,
          contractDigest: requireTask(current).contractDigest, inputResources: current.resources, createdAt: this.now().toISOString() })
        latest.runtimeId = session.runtimeId; latest.threadId = session.threadId
        latest.updatedAt = this.now().toISOString()
      })
      committed = true
      return { opened: true, sessionId: session.threadId, ...session, context, clientDirectiveId: operationId }
    } finally {
      if (!committed && host.releaseSubmission) await host.releaseSubmission({ ...predecessor, operationId, targetDigest })
    }
  }

  appendTaskCheckpoint(input: TaskCheckpointCreate): Promise<CollaborationTaskCheckpoint> {
    return this.interactions.appendCheckpoint(input)
  }

  taskInteractionView(projectId: string, taskId: string, executionId?: string): LocalTaskInteractionView {
    return this.interactions.view(projectId, taskId, executionId)
  }

  listTaskInteractions(projectId: string, taskId?: string): readonly CollaborationTaskInteraction[] {
    return this.interactions.listInteractions(projectId, taskId)
  }

  listTaskCheckpoints(projectId: string, taskId?: string): readonly CollaborationTaskCheckpoint[] {
    return this.interactions.listCheckpoints(projectId, taskId)
  }

  async decideOffer(taskOfferId: string, input: WorkerOfferDecision): Promise<void> {
    const offer = this.requirePendingOffer(taskOfferId)
    // Repeated clicks preserve the one durable Human decision and original Outbox.
    if ((input.decision === 'accept' && offer.state === 'claiming') ||
        (input.decision === 'reject' && offer.state === 'rejecting')) return
    if (offer.state !== 'awaiting-manual') {
      throw new Error('Only an offer awaiting a manual decision can be accepted, rejected, or dismissed on this Device.')
    }
    const availability = this.offerAvailability(taskOfferId)
    const allowed = input.decision === 'accept' ? availability.canAccept
      : input.decision === 'reject' ? availability.canReject : availability.canDismiss
    if (!allowed || !this.offerActorCurrent(offer)) {
      throw new Error('The Task offer requires current identity and Cloud reconciliation before a decision.')
    }
    const decidedAt = this.now().toISOString()
    await this.options.store.transact((draft) => {
      const current = draft.pendingTaskOffers.find((candidate) => candidate.taskOfferId === taskOfferId)
      if (!current) throw new Error('Local pending Task offer was not found.')
      if ((input.decision === 'accept' && current.state === 'claiming') ||
          (input.decision === 'reject' && current.state === 'rejecting')) return
      if (current.state !== 'awaiting-manual') {
        throw new Error('Only an offer awaiting a manual decision can be accepted, rejected, or dismissed on this Device.')
      }
      if (input.decision !== 'dismiss') {
        current.state = input.decision === 'accept' ? 'claiming' : 'rejecting'
        current.completedAt = null
        current.error = null
        current.decision = { decision: input.decision, decidedAt }
        current.recoveryReason = 'synchronization_pending'
      } else {
        current.state = 'dismissed'
        current.completedAt = decidedAt
        current.error = 'Dismissed on this Device; another Device may still claim this User offer.'
      }
      current.updatedAt = decidedAt
    })
    if (input.decision !== 'dismiss') this.scheduleAfterCurrent(taskOfferId)
  }

  offerAvailability(taskOfferId: string): CollaborationOfferAvailability {
    const offer = this.requirePendingOffer(taskOfferId)
    const unavailable = (state: CollaborationOfferAvailability['state'],
      reason: CollaborationOfferAvailability['reason']): CollaborationOfferAvailability => ({
      state, reason, canAccept: false, canReject: false, canDismiss: false
    })
    if (offer.state === 'claimed_elsewhere') return unavailable('claimed_elsewhere', 'claimed_by_other_device')
    if (offer.authorityFencedAt) return unavailable('invalid', 'authority_changed')
    if (offer.state === 'closed' || offer.state === 'dismissed') {
      return unavailable('invalid', offer.recoveryReason === 'authority_changed' || offer.recoveryReason === 'contract_changed'
        ? offer.recoveryReason : offer.closedOutcome === 'timed_out' ? 'offer_expired' : 'offer_closed')
    }
    if (offer.expiresAt && Date.parse(offer.expiresAt) <= this.now().getTime() &&
        offer.state !== 'claiming') return unavailable('invalid', 'offer_expired')
    const identity = this.options.authenticatedCloudTransport?.status()
    if (identity && identity.state !== 'ready') return unavailable('recovering', 'authority_unverified')
    if (!this.offerActorCurrent(offer)) return unavailable('invalid', 'authority_changed')
    if (offer.state === 'claiming' || offer.state === 'rejecting') {
      return unavailable('sync_pending', 'synchronization_pending')
    }
    if (offer.recoveryReason === 'authority_unverified') return unavailable('recovering', 'authority_unverified')
    if (offer.recoveryReason === 'contract_changed' || offer.recoveryReason === 'authority_changed') {
      return unavailable('invalid', offer.recoveryReason)
    }
    if (offer.state === 'failed' || offer.recoveryReason === 'recovery_evidence_missing') {
      return unavailable('unverified', 'recovery_evidence_missing')
    }
    if (offer.state === 'pending' || offer.recoveryReason === 'reconciliation_required') {
      return unavailable('recovering', 'reconciliation_required')
    }
    return { state: 'available', reason: offer.recoveryReason === 'synchronization_pending' ||
      (this.options.connection.state?.().state !== undefined && this.options.connection.state().state !== 'connected')
      ? 'offline_queue_available' : 'manual_decision_required', canAccept: true, canReject: true, canDismiss: true }
  }

  async handleInbox(message: AgentInboxMessage): Promise<void> {
    const payload = message.payload
    if (payload.type === 'task.offered') {
      await this.acceptOffer(payload, message.recipientAgentId)
      return
    }
    if (payload.type === 'task.offer.claimed') {
      await this.acceptOfferClaimed(payload.taskOfferId, payload.claimedByAgentId)
      return
    }
    if (payload.type === 'task.offer.closed') {
      await this.acceptOfferClosed(payload)
      return
    }
    if (payload.type === 'task.delivery.revision_requested') {
      await this.acceptDeliveryRevisionRequested(payload)
      return
    }
    if (payload.type === 'task.execution.fenced') {
      const run = this.findRun(payload.executionId)
      if (!run) return
      if (run.offer.projectId !== payload.projectId || run.offer.taskId !== payload.taskId) {
        throw new Error('Execution-fenced Inbox identity does not match the local Worker journal.')
      }
      await this.markFenced(run, payload.reason)
      return
    }
    if (payload.type === 'human.answer.received') {
      await this.acceptHumanAnswer(payload.answer, message.recipientAgentId)
      return
    }
    if (payload.type === 'collaboration.state.changed') {
      await this.acceptCloudStateEvent(payload.event)
      return
    }
    if (payload.type === 'task.cancelled' || payload.type === 'task.updated') {
      const run = this.findRun(payload.executionId)
      if (!run) return
      await this.updateRun(payload.executionId, {
        expectedTaskRevision: Math.max(run.expectedTaskRevision, payload.revision)
      })
      this.schedule(payload.executionId)
    }
  }

  /** Persists an immutable offer before any decision or Cloud acknowledgement. */
  async acceptOffer(payload: TaskOfferedPayload, recipientAgentId: string): Promise<void> {
    const localAgentId = this.options.localAgentId()
    if (!localAgentId || recipientAgentId !== localAgentId) {
      throw new Error('Task offer recipient does not match this Agent Device.')
    }
    const boundRun = this.options.store.snapshot().taskRuns.find(({ offer }) => offer.taskOfferId === payload.taskOfferId)
    if (boundRun) {
      if (boundRun.offer.projectId !== payload.projectId || boundRun.offer.taskId !== payload.taskId ||
          boundRun.execution?.assigneeUserId !== payload.workerUserId ||
          boundRun.offer.recipientAgentId !== recipientAgentId) {
        throw new Error('Task offer identity was reused after binding an immutable local Execution.')
      }
      return
    }
    const existing = this.findPendingOffer(payload.taskOfferId)
    if (existing) {
      if (
        existing.taskId !== payload.taskId ||
        existing.projectId !== payload.projectId ||
        existing.workerUserId !== payload.workerUserId
      ) throw new Error('Task offer identity was reused for another Worker User or Task.')
      if (existing.contractRevision !== payload.contractRevision ||
          existing.contractDigest !== payload.contractDigest) {
        throw new Error('Task offer Contract changed; a new Offer and manual acceptance are required.')
      }
      if (existing.state === 'failed') {
        if (!existing.authorityFencedAt) this.schedule(payload.taskOfferId)
        return
      }
      if (existing.state === 'pending' || existing.state === 'claiming' ||
          existing.state === 'rejecting' || existing.state === 'awaiting-manual') {
        await this.options.store.transact((draft) => {
          const current = draft.pendingTaskOffers.find((candidate) => (
            candidate.taskOfferId === payload.taskOfferId
          ))
          if (!current) return
          if (payload.currentTaskRevision < current.currentTaskRevision ||
              payload.offerRevision < current.offerRevision) return
          current.currentTaskRevision = payload.currentTaskRevision
          current.offerRevision = payload.offerRevision
          if (payload.contractRevision !== undefined) current.contractRevision = payload.contractRevision
          if (payload.contractDigest !== undefined) current.contractDigest = payload.contractDigest
          if (payload.revisionInstruction) {
            current.revisionInstruction = payload.revisionInstruction
          }
          current.updatedAt = this.now().toISOString()
        })
        this.schedule(payload.taskOfferId)
      }
      return
    }

    const receivedAt = this.now().toISOString()
    await this.options.store.transact((draft) => {
      if (draft.pendingTaskOffers.some(({ taskOfferId }) => taskOfferId === payload.taskOfferId) ||
          draft.taskRuns.some(({ offer }) => offer.taskOfferId === payload.taskOfferId)) return
      draft.pendingTaskOffers.push({
        projectId: payload.projectId,
        taskId: payload.taskId,
        taskOfferId: payload.taskOfferId,
        workerUserId: payload.workerUserId,
        currentTaskRevision: payload.currentTaskRevision,
        offerRevision: payload.offerRevision,
        ...(payload.contractRevision !== undefined ? { contractRevision: payload.contractRevision } : {}),
        ...(payload.contractDigest !== undefined ? { contractDigest: payload.contractDigest } : {}),
        recipientAgentId,
        receivedAt,
        ...(payload.revisionInstruction ? { revisionInstruction: payload.revisionInstruction } : {}),
        preflightReasons: [],
        state: 'pending',
        updatedAt: receivedAt,
        completedAt: null,
        error: null
      })
    })
    this.schedule(payload.taskOfferId)
    void this.readTask(payload.taskId).then((task) => this.options.store.transact((draft) => {
      if (draft.projectUnavailableFences.some(({ projectId }) => projectId === task.projectId)) return
      if (draft.tasks.some((current) => current.taskId === task.taskId && current.revision >= task.revision)) return
      draft.tasks = [...draft.tasks.filter(({ taskId }) => taskId !== task.taskId), task]
    })).catch(() => undefined)
  }

  private async acceptOfferClaimed(taskOfferId: string, claimedByAgentId: string): Promise<void> {
    const pending = this.findPendingOffer(taskOfferId)
    if (!pending || pending.state === 'dismissed') return
    if (claimedByAgentId === this.options.localAgentId()) {
      // Winner notifications can precede recovery of a pre-fix failed journal.
      // Only the original durable Human request can restore that Execution.
      if (pending.state !== 'claiming' && !pending.authorityFencedAt) this.schedule(taskOfferId)
      return
    }
    this.controllers.get(taskOfferId)?.abort('Task offer claimed on another Device.')
    const completedAt = this.now().toISOString()
    await this.updatePendingOffer(taskOfferId, {
      state: 'claimed_elsewhere',
      completedAt,
      error: 'Another Device of this Worker User claimed the Task.'
    })
  }

  private async acceptOfferClosed(payload: TaskOfferClosedPayload): Promise<void> {
    if (payload.audience !== 'worker') {
      throw new Error('A Coordinator Task-offer closure cannot enter the Worker handler.')
    }
    const pending = this.findPendingOffer(payload.taskOfferId)
    if (!pending || ['dismissed', 'claimed_elsewhere'].includes(pending.state)) return
    if (
      pending.projectId !== payload.projectId ||
      pending.taskId !== payload.taskId
    ) {
      throw new Error('Task-offer closure identity does not match the local User offer.')
    }
    if (pending.state === 'closed') {
      if (
        pending.currentTaskRevision === payload.taskRevision &&
        pending.offerRevision === payload.offerRevision
      ) return
      // An expired accept response closes the local card before the timeout
      // transaction has advanced Cloud revisions. Adopt its later Inbox fact.
      if (pending.closedOutcome !== 'timed_out' || payload.outcome !== 'timed_out') {
        throw new Error('Task-offer closure revisions conflict with the local terminal journal.')
      }
    }
    if (
      payload.taskRevision !== pending.currentTaskRevision + 1 ||
      payload.offerRevision !== pending.offerRevision + 1
    ) {
      throw new Error('Task-offer closure did not advance the exact Task and Offer revisions.')
    }
    const completedAt = this.now().toISOString()
    const error = payload.outcome === 'rejected'
      ? 'The Worker User rejected the Task offer.'
      : payload.outcome === 'timed_out'
        ? 'The Task offer timed out.'
        : 'The Coordinator withdrew the Task offer.'
    this.controllers.get(payload.taskOfferId)?.abort(error)
    await this.updatePendingOffer(payload.taskOfferId, {
      state: 'closed',
      closedOutcome: payload.outcome,
      currentTaskRevision: payload.taskRevision,
      offerRevision: payload.offerRevision,
      completedAt,
      error
    })
  }

  private async readCloudResource(resourceRefId: string): Promise<CloudResourceRef> {
    const response = await this.options.connection.executeAsAgent(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'resource.get',
      resourceRefId
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.entity' || response.entity.type !== 'resource_ref') {
      throw new Error(`Recovery ResourceRef query returned unexpected ${response.type}.`)
    }
    return cloudResourceRefSchema.parse(response.entity)
  }

  private async readTaskDeliveryFacts(taskId: string): Promise<TaskDeliveryFacts> {
    const response = await this.options.connection.executeAsAgent(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'delivery.task.get',
      taskId
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.task.delivery' || response.facts.taskId !== taskId) {
      throw new Error(`Task Delivery facts query returned unexpected ${response.type}.`)
    }
    return taskDeliveryFactsSchema.parse(response.facts)
  }

  /** Owner-requested rework reopens the same Execution and private Session; the Worker produces r(N+1). */
  private async acceptDeliveryRevisionRequested(
    payload: Extract<AgentInboxMessage['payload'], { type: 'task.delivery.revision_requested' }>
  ): Promise<void> {
    const run = this.findRun(payload.executionId)
    if (!run || run.authorityFencedAt) return
    if (run.offer.projectId !== payload.projectId || run.offer.taskId !== payload.taskId) {
      throw new Error('Delivery revision request does not match the local Worker journal.')
    }
    if (TERMINAL_RUN_STATES.has(run.state) && run.state !== 'completed') {
      throw new Error('A failed or fenced Worker execution cannot accept a Delivery revision request.')
    }
    const facts = await this.readTaskDeliveryFacts(payload.taskId)
    if (!facts.revisionRequest ||
        facts.revisionRequest.revisionRequestId !== payload.revisionRequestId ||
        facts.revisionRequest.executionId !== payload.executionId ||
        facts.revisionRequest.executionRevision !== payload.executionRevision) {
      throw new Error('Cloud did not return the exact Delivery revision request.')
    }
    // Only the sealed version named by this request can be reopened. Replayed
    // Inbox messages must not discard an in-flight revision or a newer result.
    if (!run.frozenCandidate || run.frozenCandidate.dirty ||
        facts.manifest?.deliveryManifestId !== facts.revisionRequest.deliveryManifestId ||
        facts.manifest.bundleDigest !== run.frozenCandidate.bundleDigest) return
    await this.updateRun(payload.executionId, {
      offer: { ...run.offer, revisionInstruction: facts.revisionRequest.instruction },
      executionMode: 'unselected',
      state: 'waiting-result-confirm',
      resultSummary: null,
      deliveryDraft: { ...newDeliveryDraft(run, this.now().toISOString()), summary: run.frozenCandidate.bundle.summary,
        selectedMaterials: run.deliveryDraft?.selectedMaterials ?? [], ...(run.deliveryDraft?.declaredMaterial !== undefined ? { declaredMaterial: run.deliveryDraft.declaredMaterial } : {}), outputs: run.frozenCandidate.bundle.schemaVersion === 2 ? run.frozenCandidate.bundle.outputs : [] },
      frozenCandidate: { ...run.frozenCandidate, dirty: true },
      deliverySaga: null,
      completedAt: null,
      expectedExecutionRevision: Math.max(run.expectedExecutionRevision, payload.executionRevision),
      error: null
    })
    this.scheduleAfterCurrent(payload.executionId)
  }

  /** New ordinary Session input invalidates the displayed snapshot before dispatch. */
  async acceptSessionAdmission(event: SessionAdmissionEvent): Promise<void> {
    if (!['queue', 'direct', 'steer'].includes(event.kind)) return
    let run = this.runForSession(event)
    if (!run || TERMINAL_RUN_STATES.has(run.state)) return
    if (this.delivering.has(run.offer.executionId) || run.state === 'submitting') {
      throw new Error('Worker Delivery submission is in progress; the Session cannot accept new input.')
    }
    const clientDirectiveId = event.clientDirectiveId
    if (!clientDirectiveId || run.agentJournal.some((entry) =>
        entry.clientDirectiveId === clientDirectiveId && entry.origin !== 'session')) return
    const admission = await this.readSessionAdmission(requireRunSession(run))
    const receipt = admission?.receipts.find((entry) => entry.clientDirectiveId === clientDirectiveId)
    if (receipt?.delivery === 'abandoned' || receipt?.delivery === 'delivered' &&
        ['completed', 'failed', 'cancelled'].includes(receipt.execution)) return
    // The first ordinary user input authorizes this conversational work only.
    // Starting Cloud execution must never schedule the autonomous whole-task turn.
    if (run.execution?.state === 'accepted') {
      run = await this.updateRun(run.offer.executionId, { executionMode: 'manual' })
      const preflight = await this.refreshPreflight(run, true, new AbortController().signal)
      if (preflight.outcome !== 'allowed') throw new Error('当前任务执行权限不可用，请处理任务变更或刷新后再发送。')
      await this.acceptAndStart(this.requireRun(run.offer.executionId))
      run = this.requireRun(run.offer.executionId)
    }
    // Host admission can arrive before the new queue receipt is written, or
    // again while it is delivering/started/output_pending. Persist Session
    // ownership and the dirty draft in ONE transaction before any wake can see
    // running + no result but only the old Adapter success journal.
    await this.recordSessionInvocation(run, clientDirectiveId, event.revision, {
      state: 'dispatched', turnId: receipt?.turnId ?? null, runtimeState: null, failure: null
    }, true)
  }

  /** Observe ordinary Session turns through the Host's required output boundary. */
  async acceptSessionOutput(
    event: SessionOutputEvent,
    readThread: DomainMainAgentThreadsHost['read']
  ): Promise<void> {
    let run = this.runForSession(event)
    // Adapter-owned turns already persist and validate their result in runAgent.
    if (!run || this.activeAgentTurns.has(run.offer.executionId) || TERMINAL_RUN_STATES.has(run.state)) return
    if (run.agentJournal.some((entry) => entry.origin === 'session' &&
        (entry.admissionRevision ?? 0) > event.revision)) return
    if (run.deliveryDraft?.sourceTurnId === event.turnId && run.agentJournal.some((entry) =>
        entry.origin === 'session' && entry.turnId === event.turnId && entry.admissionRevision === event.revision && entry.state === 'observed_success')) return
    const candidate = run.frozenCandidate
    if (candidate && candidate.sourceTurnId === event.turnId &&
        candidate.admissionRevision === event.revision && !candidate.dirty) return
    // Unsuccessful or unreadable output cannot leave the previous snapshot
    // confirmable, even if its admission notification was not observed here.
    run = await this.updateRun(run.offer.executionId, {
      ...(candidate ? { frozenCandidate: { ...candidate, dirty: true } } : {}),
      resultSummary: null
    })
    try {
      const controller = new AbortController()
      const authorized = await this.authorizeExecution(run, controller.signal)
      if (!authorized) throw new Error('Worker Session output no longer has execution authority.')
      run = authorized
      const admission = await this.readSessionAdmission(requireRunSession(run))
      const receipt = admission?.receipts.find((entry) => entry.turnId === event.turnId)
      // An old output cannot overwrite a newer Session input/outcome.
      if (run.agentJournal.some((entry) => entry.origin === 'session' &&
          (entry.admissionRevision ?? 0) > event.revision)) return
      const thread = await readThread(requireRunSession(run)).catch((error) => {
        if (event.state === 'completed') throw error
        return undefined
      })
      if (this.requireRun(run.offer.executionId).agentJournal.some((entry) =>
          entry.origin === 'session' && (entry.admissionRevision ?? 0) > event.revision)) return
      if (thread && (thread.id !== event.threadId || thread.runtimeId !== event.runtimeId)) {
        throw new Error('The Worker output does not match its bound Runtime Session.')
      }
      const turn = thread?.turns.find(({ id }) => id === event.turnId)
      if (event.state !== 'completed') {
        const failure = turn?.failure ?? { code: `runtime_${event.state}`,
          message: event.state === 'failed' ? '本轮执行失败，可将原文作为新输入重新执行。' : '本轮执行已取消。', retryable: false }
        const message = safeError(failure.message, this.options.sanitizeText).slice(0, 1_000)
        if (receipt?.delivery === 'delivered') {
          await this.recordSessionInvocation(run, receipt.clientDirectiveId, event.revision, {
            state: 'observed_failure', turnId: event.turnId, runtimeState: event.state,
            failure: { ...failure, message }, safeError: message
          })
        }
        await this.updateRun(run.offer.executionId, { error: message })
        return
      }
      if (!turn) throw new Error('The completed Worker Session turn was not found.')
      const finalText = turn.messages.filter(({ kind }) => kind === 'assistant-final').map(({ text }) => text).join('\n')
      let result: WorkerRuntimeResult | null = null
      try { result = parseWorkerRuntimeResult(finalText) } catch { /* Ordinary Session replies may be plain text. */ }
      if (receipt?.delivery === 'delivered') {
        await this.recordSessionInvocation(run, receipt.clientDirectiveId, event.revision, {
          state: 'observed_success', turnId: event.turnId, runtimeState: 'completed', failure: null,
          safeResultText: finalText.slice(0, 32_000), safeError: null
        })
      }
      // Only Adapter-owned structured turns may create HumanNeeded. Ordinary
      // replies contribute a draft suggestion without changing Cloud authority.
      await this.updateDeliveryDraft(this.requireRun(run.offer.executionId),
        result?.outcome === 'completed' ? result.summary : null, event.turnId, true)
    } catch (error) {
      await this.updateRun(run.offer.executionId, { error: safeError(error, this.options.sanitizeText) })
      // A rejected Worker result is local error state, not a Host settlement
      // failure: returning lets the Host retire the output_pending receipt.
    }
  }

  /** A steer is another input to the owned turn, never another Runtime call. */
  private async settleSteeredSessionInputs(
    executionId: string,
    result: Awaited<ReturnType<DomainMainAgentExecutionHost['run']>>
  ): Promise<boolean> {
    const run = this.requireRun(executionId)
    const admission = await this.readSessionAdmission(requireRunSession(run))
    const steeredInputs = new Set(admission?.receipts.filter((receipt) =>
      receipt.mode === 'steer' && receipt.delivery === 'delivered' && receipt.turnId === result.turnId
    ).map((receipt) => receipt.clientDirectiveId))
    if (steeredInputs.size === 0) return false
    await this.options.store.transact((draft) => {
      const current = requireDraftRun(draft.taskRuns, executionId)
      // A later queued input does not prevent the earlier same-turn receipt
      // from settling, but it retains ownership of the next result/draft.
      for (const entry of current.agentJournal) {
        if (entry.origin !== 'session' || !steeredInputs.has(entry.clientDirectiveId) ||
            entry.state !== 'dispatched') continue
        Object.assign(entry, {
          state: result.state === 'completed' ? 'observed_success' : 'observed_failure',
          turnId: result.turnId,
          runtimeState: result.state,
          observedAt: this.now().toISOString(),
          ...(result.state === 'completed' ? { failure: null, safeError: null, safeResultText: result.text.slice(0, 32_000) }
            : { failure: result.failure ? { ...result.failure, message: safeError(result.failure.message, this.options.sanitizeText).slice(0, 1_000) } : null,
                safeError: safeError(result.failure?.message ?? `Agent turn ended in ${result.state}.`, this.options.sanitizeText) })
        })
      }
    })
    return true
  }

  private async recordSessionInvocation(
    run: CollaborationTaskRun,
    clientDirectiveId: string,
    admissionRevision: number,
    outcome: Pick<CollaborationTaskRun['agentJournal'][number], 'state' | 'turnId' | 'runtimeState'> &
      Partial<Pick<CollaborationTaskRun['agentJournal'][number], 'failure' | 'safeResultText' | 'safeError'>>,
    admittedInput = false
  ): Promise<void> {
    const now = this.now().toISOString()
    await this.options.store.transact((draft) => {
      const current = requireDraftRun(draft.taskRuns, run.offer.executionId)
      if (current.authorityFencedAt || TERMINAL_RUN_STATES.has(current.state)) return
      let entry = current.agentJournal.find((item) => item.clientDirectiveId === clientDirectiveId)
      if (current.agentJournal.some((item) => item.origin === 'session' &&
          (item.admissionRevision ?? 0) > admissionRevision)) return
      if (entry && entry.origin !== 'session') return
      if (entry && (entry.admissionRevision ?? 0) > admissionRevision) return
      if (outcome.state === 'dispatched' && entry && ['observed_success', 'observed_failure', 'late_outcome'].includes(entry.state)) return
      if (admittedInput && (this.delivering.has(current.offer.executionId) || current.state === 'submitting')) {
        throw new Error('Worker Delivery submission is in progress; the Session cannot accept new input.')
      }
      if (!entry) {
        entry = { logicalInvocationId: `session.${digest(clientDirectiveId).slice(0, 48)}`, clientDirectiveId,
          origin: 'session', state: 'dispatched', preparedAt: now, dispatchedAt: now, observedAt: null,
          runtimeId: run.runtimeId, threadId: run.threadId, turnId: null, runtimeState: null,
          safeResultText: null, safeError: null }
        current.agentJournal.push(entry)
      }
      Object.assign(entry, outcome, { admissionRevision,
        observedAt: outcome.state === 'dispatched' ? null : now })
      if (admittedInput) {
        for (const followup of current.followups) {
          if (['waiting', 'dispatching'].includes(followup.state)) {
            followup.state = 'cancelled'
            followup.reason = '成员已在原会话输入新指令，旧复查已取消。'
          }
        }
        this.followupWakeups.get(run.offer.executionId)?.()
        this.followupWakeups.delete(run.offer.executionId)
        current.state = 'running'
        current.resultSummary = null
        current.error = null
        if (current.frozenCandidate) current.frozenCandidate = { ...current.frozenCandidate, dirty: true }
      }
      current.updatedAt = now
    })
  }

  private runForSession(ref: Readonly<{ runtimeId: string; threadId: string }>): CollaborationTaskRun | undefined {
    const runs = this.options.store.snapshot().taskRuns.filter((run) => (
      run.runtimeId === ref.runtimeId && run.threadId === ref.threadId
    ))
    if (runs.length > 1) throw new Error('The Worker Session is bound to more than one execution.')
    return runs[0]
  }

  async fenceLocalAgent(agentId: string, reason: string, cause?: AgentCloudRuntimeError): Promise<void> {
    const now = this.now().toISOString()
    const pendingControllers = new Set<AbortController>()
    for (const [identifier, controller] of this.controllers) {
      const offer = this.findPendingOffer(identifier)
      if (offer?.recipientAgentId === agentId) pendingControllers.add(controller)
    }
    for (const controller of pendingControllers) controller.abort(reason)
    await this.options.store.transact((draft) => {
      for (const offer of draft.pendingTaskOffers) {
        if (offer.recipientAgentId !== agentId ||
            ['dismissed', 'closed', 'claimed_elsewhere'].includes(offer.state)) continue
        const unclickedIdentityChange = (cause?.cloudCode === 'identity_changed' || cause?.code === 'identity_required') &&
          (offer.state === 'pending' || offer.state === 'awaiting-manual') && !offer.decision &&
          !draft.taskRuns.some(({ offer: runOffer }) => runOffer.taskOfferId === offer.taskOfferId) &&
          !draft.outbox.some(({ kind, body }) => kind === 'task.offer-decision' &&
            body.taskOfferId === offer.taskOfferId && (body.type === 'task.offer.accept' || body.type === 'task.offer.reject'))
        if (unclickedIdentityChange) {
          offer.recoveryReason = 'authority_unverified'
          offer.updatedAt = now
          offer.error = reason.slice(0, 4_000)
          continue
        }
        offer.state = 'failed'
        offer.completedAt = now
        offer.updatedAt = now
        offer.error = reason.slice(0, 4_000)
        offer.authorityFencedAt = now
        offer.recoveryReason = 'authority_changed'
      }
      for (const run of draft.taskRuns) {
        if (run.offer.recipientAgentId !== agentId) continue
        run.authorityFencedAt ??= now
        for (const followup of run.followups) {
          if (['waiting', 'dispatching'].includes(followup.state)) {
            followup.state = 'cancelled'
            followup.reason = '执行权限已撤销，旧复查已取消。'
          }
        }
        this.followupWakeups.get(run.offer.executionId)?.()
        this.followupWakeups.delete(run.offer.executionId)
        if (TERMINAL_RUN_STATES.has(run.state)) continue
        run.state = 'fenced'
        run.completedAt = now
        run.updatedAt = now
        run.error = reason.slice(0, 4_000)
      }
      for (const entry of draft.outbox) enforceWorkerOutboxAuthorityFence(draft, entry)
    })
    this.options.outbox.wake?.()
    for (const [identifier, controller] of this.controllers) {
      const offer = this.findPendingOffer(identifier)
      const run = this.findRun(identifier)
      if (offer?.recipientAgentId === agentId || run?.offer.recipientAgentId === agentId) {
        controller.abort(reason)
      }
    }
  }

  /** Pause I/O and Runtime turns without inventing an Offer or Execution terminal. */
  async suspendLocalAgent(agentId: string, reason: string): Promise<void> {
    for (const [identifier, controller] of this.controllers) {
      const offer = this.findPendingOffer(identifier)
      const run = this.findRun(identifier)
      if (offer?.recipientAgentId === agentId || run?.offer.recipientAgentId === agentId) {
        controller.abort(new AuthorityUnverifiedError(reason))
      }
    }
    await this.options.store.transact((draft) => {
      for (const offer of draft.pendingTaskOffers) {
        if (offer.recipientAgentId !== agentId || ['dismissed', 'closed', 'claimed_elsewhere'].includes(offer.state) ||
            offer.authorityFencedAt) continue
        offer.recoveryReason = 'authority_unverified'
        offer.error = reason.slice(0, 4_000)
        offer.updatedAt = this.now().toISOString()
      }
    })
  }

  async handleProjectUnavailable(
    projectId: string,
    input: Readonly<Pick<CollaborationProjectUnavailableFence, 'kind' | 'reason'>>
  ): Promise<void> {
    const snapshot = this.options.store.snapshot()
    const existingFence = snapshot.projectUnavailableFences.find((fence) => (
      fence.projectId === projectId
    ))
    const effectiveFence = existingFence?.kind === 'permanent'
      ? existingFence
      : input
    const needsStateCleanup = snapshot.pendingTaskOffers.some((offer) => (
      offer.projectId === projectId &&
      !TERMINAL_PENDING_OFFER_STATES.has(offer.state)
    )) || snapshot.taskRuns.some((run) => (
      run.offer.projectId === projectId && !PROJECT_UNAVAILABLE_PRESERVED_RUN_STATES.has(run.state)
    )) || snapshot.projects.some((project) => project.projectId === projectId) ||
      !existingFence || existingFence.kind !== effectiveFence.kind ||
      existingFence.reason !== effectiveFence.reason
    if (needsStateCleanup) {
      const now = this.now().toISOString()
      await this.options.store.transact((draft) => {
        const currentFence = draft.projectUnavailableFences.find((fence) => (
          fence.projectId === projectId
        ))
        const nextFence = currentFence?.kind === 'permanent'
          ? currentFence
          : { projectId, ...input, observedAt: now }
        for (const offer of draft.pendingTaskOffers) {
          if (
            offer.projectId !== projectId ||
            TERMINAL_PENDING_OFFER_STATES.has(offer.state)
          ) continue
          offer.state = 'closed'
          offer.completedAt = now
          offer.updatedAt = now
          offer.error = nextFence.reason
        }
        for (const run of draft.taskRuns) {
          if (
            run.offer.projectId !== projectId ||
            PROJECT_UNAVAILABLE_PRESERVED_RUN_STATES.has(run.state)
          ) continue
          run.state = 'fenced'
          run.completedAt = now
          run.updatedAt = now
          run.error = nextFence.reason
        }
        draft.projects = draft.projects.filter((project) => project.projectId !== projectId)
        draft.projectUnavailableFences = [
          ...draft.projectUnavailableFences.filter((fence) => fence.projectId !== projectId),
          nextFence
        ]
      })
    }
    const reason = this.options.store.snapshot().projectUnavailableFences.find((fence) => (
      fence.projectId === projectId
    ))?.reason ?? effectiveFence.reason
    for (const [identifier, controller] of this.controllers) {
      const offer = this.findPendingOffer(identifier)
      const run = this.findRun(identifier)
      if (offer?.projectId === projectId || run?.offer.projectId === projectId) {
        controller.abort(reason)
      }
    }
  }

  /** Publishes local facts only; Cloud joins Device, Agent, membership, and Project readiness. */
  async publishAvailability(connectionStatus: 'online' | 'offline'): Promise<void> {
    const agentId = this.options.localAgentId()
    if (!agentId) return
    const state = this.options.store.snapshot()
    const agent = state.agents.find((candidate) => candidate.agentId === agentId)
    if (!agent) return
    const runtimeReady = await this.runtimeReady()
    const observedAt = this.now().toISOString()
    const activeTaskCount = state.taskRuns.filter((run) => (
      run.offer.recipientAgentId === agentId && !TERMINAL_RUN_STATES.has(run.state)
    )).length
    const requestFacts = {
      agentId,
      expectedAgentRevision: agent.revision,
      connectionStatus,
      lastHeartbeatAt: connectionStatus === 'online' ? agent.lastSeenAt ?? observedAt : null,
      runtimeReadiness: runtimeReady ? 'ready' as const : 'unavailable' as const,
      runtimeCapabilityTags: [...agent.capabilities].sort(),
      acceptsNewOffers: connectionStatus === 'online' &&
        agent.lifecycleStatus === 'active' && runtimeReady && activeTaskCount < 10,
      activeTaskCount,
      observedAt
    }
    await this.options.outbox.enqueue('worker.availability', restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'worker.availability.publish',
      idempotencyKey: idempotencyKey('worker.availability', requestFacts),
      ...requestFacts
    }))
  }

  private async runtimeReady(): Promise<boolean> {
    const observe = this.options.agentExecution.runtimeReadiness
    if (!observe) return false
    try {
      return (await observe()).state === 'ready'
    } catch {
      return false
    }
  }

  private schedule(identifier: string): void {
    if (this.stopped || this.running.has(identifier) || this.continuingExecutions.has(identifier)) return
    const promise = this.process(identifier).catch(async (error) => {
      if (this.stopped) return
      const pending = this.findPendingOffer(identifier)
      if (pending && !['dismissed', 'closed', 'claimed_elsewhere'].includes(pending.state) && !pending.authorityFencedAt) {
        const recoverableClaimFailure = pending.state === 'claiming' && (
          error instanceof OfferClaimCheckpointError ||
          this.hasUncertainDurableClaim(pending)
        )
        await this.updatePendingOffer(identifier, {
          state: error instanceof OfferDecisionRejectedError ? 'failed'
            : recoverableClaimFailure ? 'claiming' : pending.state,
          completedAt: error instanceof OfferDecisionRejectedError ? this.now().toISOString()
            : recoverableClaimFailure ? null : pending.completedAt,
          recoveryReason: error instanceof OfferDecisionRejectedError ? 'recovery_evidence_missing'
            : isAuthorityUnverified(error) ? 'authority_unverified'
            : pending.state === 'awaiting-manual' && pending.verifiedAt && isCloudTemporarilyUnavailable(error)
              ? 'synchronization_pending' : 'reconciliation_required',
          error: safeError(error, this.options.sanitizeText)
        })
        return
      }
      const current = this.findRun(identifier)
      if (!current || (TERMINAL_RUN_STATES.has(current.state) && !this.hasDeliveryRecovery(current))) return
      await this.updateRun(identifier, { error: safeError(error, this.options.sanitizeText) })
    }).finally(() => {
      if (this.running.get(identifier) === promise) this.running.delete(identifier)
    })
    this.running.set(identifier, promise)
  }

  private scheduleAfterCurrent(identifier: string): void {
    const current = this.running.get(identifier)
    if (!current) {
      this.schedule(identifier)
      return
    }
    void current.then(
      () => this.schedule(identifier),
      () => this.schedule(identifier)
    )
  }

  private async process(identifier: string): Promise<void> {
    if (this.stopped) return
    const pending = this.findPendingOffer(identifier)
    if (pending) {
      await this.processPendingOffer(pending)
      return
    }
    const executionId = identifier
    let run = this.requireRun(executionId)
    if (this.hasParkedDeliveryValidationFailure(run)) return
    if (run.authorityFencedAt || run.executionMode === 'unselected' || !run.executionMode && run.agentJournal.length === 0) return
    if (this.delivering.has(executionId)) return
    if (run.deliverySaga && this.options.store.snapshot().outbox.some((entry) =>
      entry.body.executionId === executionId &&
      entry.idempotencyKey.startsWith(`idem_object.stage.${run.deliverySaga!.operationId}.`) &&
      isObjectUploadLimit(entry))) return
    if (this.hasDeliveryRecovery(run)) {
      const controller = new AbortController()
      this.controllers.set(executionId, controller)
      this.delivering.set(executionId, 'preparing')
      try {
        run = await this.restoreDeliverySaga(run, controller.signal)
        await this.continueDeliverySaga(run, this.deliveryDecision(run))
      } finally {
        this.delivering.delete(executionId)
        if (this.controllers.get(executionId) === controller) this.controllers.delete(executionId)
      }
      return
    }
    if (TERMINAL_RUN_STATES.has(run.state)) return
    const controller = this.controllers.get(executionId) ?? new AbortController()
    this.controllers.set(executionId, controller)
    try {
      if (run.state === 'needs-human') {
        await this.refreshPreflight(run, true, controller.signal)
        throwIfSignalAborted(controller.signal)
        return
      }
      const preflight = await this.refreshPreflight(run, true, controller.signal)
      throwIfSignalAborted(controller.signal)
      run = this.requireRun(executionId)
      if (this.delivering.has(executionId)) return
      if (this.hasDeliveryRecovery(run)) {
        this.scheduleAfterCurrent(executionId)
        return
      }
      if (run.state === 'submitting') throw new Error('The pending Delivery has no recoverable confirmation checkpoint.')
      if (TERMINAL_RUN_STATES.has(run.state)) return
      if (preflight.outcome === 'denied') {
        if (await this.waitForExecutionReadiness(run, preflight)) return
        const message = `Worker preflight denied: ${preflight.reasons.join(', ')}`
        if (requireExecution(run).fence.status === 'open') {
          await this.failExecution(run, 'worker_preflight_denied', message)
        } else {
          await this.markFenced(run, message)
        }
        return
      }
      await this.acceptAndStart(run)
    } finally {
      if (this.controllers.get(executionId) === controller) {
        this.controllers.delete(executionId)
      }
    }
  }

  private async processPendingOffer(offer: CollaborationPendingTaskOffer): Promise<void> {
    if (['dismissed', 'closed', 'claimed_elsewhere'].includes(offer.state) || offer.authorityFencedAt) return
    if (offer.state === 'pending') {
      await this.updatePendingOffer(offer.taskOfferId, {
        state: 'awaiting-manual', preflightReasons: [], error: null,
        verifiedAt: this.now().toISOString()
      }, undefined, 'pending')
      return
    }
    if (offer.state === 'awaiting-manual' || offer.state === 'failed' || this.durableClaim(offer)) {
      if (!await this.reconcilePendingOffer(offer)) return
      offer = this.requirePendingOffer(offer.taskOfferId)
      if (offer.state === 'awaiting-manual') return
    }
    if (offer.state === 'rejecting') {
      await this.rejectPendingOffer(offer)
      return
    }
    try {
      if (await this.resumePendingOfferClaim(offer)) return
      await this.claimPendingOffer(this.requirePendingOffer(offer.taskOfferId))
    } catch (error) {
      if (!(error instanceof OfferClaimRevisionRaceError)) throw error
      // Only an explicit extension of this same Contract can refresh the CAS.
      this.scheduleAfterCurrent(offer.taskOfferId)
    }
  }

  private offerActorCurrent(offer: CollaborationPendingTaskOffer): boolean {
    const localAgentId = this.options.localAgentId()
    const agent = this.options.store.snapshot().agents.find(({ agentId }) => agentId === localAgentId)
    if (!agent || agent.lifecycleStatus !== 'active' || localAgentId !== offer.recipientAgentId ||
        agent.ownerUserId !== offer.workerUserId || !agent.deviceId) return false
    const identity = this.options.authenticatedCloudTransport?.status()
    return !identity || (identity.state === 'ready' && identity.userId === offer.workerUserId &&
      identity.deviceId === agent.deviceId)
  }

  /** The sole recovery read: Cloud facts qualify a local journal; transport never closes an Offer. */
  private async reconcilePendingOffer(original: CollaborationPendingTaskOffer): Promise<boolean> {
    if (!this.offerActorCurrent(original)) {
      const identity = this.options.authenticatedCloudTransport?.status()
      await this.updatePendingOffer(original.taskOfferId, {
        recoveryReason: identity && identity.state !== 'ready' ? 'authority_unverified' : 'authority_changed',
        error: 'Current User, Device and Agent must be revalidated before this Offer can recover.'
      })
      return false
    }
    const identityBefore = this.options.authenticatedCloudTransport?.status()
    const collections = ['memberships', 'task_authorities', 'tasks', 'offers', 'executions'] as const
    let requests: Array<{ collection: typeof collections[number]; limit: number; cursor?: string }> =
      collections.map((collection) => ({ collection, limit: 250 }))
    const pages: ProjectCoordinationFactPage[] = []
    let project: Extract<RestResponse, { type: 'rest.project_coordination' }>['project'] | undefined
    let observedAt: string | undefined
    for (let pageNumber = 0; requests.length > 0 && pageNumber < 100; pageNumber += 1) {
      const request = restRequestSchema.parse({
        protocolVersion: '1.0', requestId: collaborationRequestId(),
        type: 'project.coordination.read', projectId: original.projectId, collections: requests
      })
      const response = restResponseSchema.parse(await this.options.connection.executeAsUser(request))
      if (this.stopped) return false
      if (!this.offerActorCurrent(original) || JSON.stringify(identityBefore) !==
          JSON.stringify(this.options.authenticatedCloudTransport?.status())) {
        throw new AuthorityUnverifiedError('Identity changed during Offer reconciliation.')
      }
      if (response.requestId !== request.requestId) throw new Error('Offer reconciliation received another request receipt.')
      if (response.type === 'rest.error') {
        if (response.error.code === 'permission_denied' || response.error.code === 'not_found') {
          await this.closeReconciledOffer(original, 'authority_changed')
          return false
        }
        throw new Error(response.error.message)
      }
      if (response.type !== 'rest.project_coordination' || response.project.projectId !== original.projectId ||
          (observedAt !== undefined && response.observedAt !== observedAt)) {
        throw new Error('Offer reconciliation did not return the exact Cloud Project observation.')
      }
      project = response.project
      observedAt = response.observedAt
      const next: typeof requests = []
      for (const requested of requests) {
        const page = response.pages.find(({ collection }) => collection === requested.collection)
        if (!page || page.cursor !== requested.cursor) throw new Error('Offer reconciliation page is incomplete.')
        pages.push(page)
        if (page.nextCursor) next.push({ ...requested, cursor: page.nextCursor })
      }
      requests = next
    }
    if (requests.length > 0 || !project) throw new Error('Offer reconciliation pagination did not finish.')
    if (this.stopped) return false
    if (!this.offerActorCurrent(original) || JSON.stringify(identityBefore) !==
        JSON.stringify(this.options.authenticatedCloudTransport?.status())) {
      throw new AuthorityUnverifiedError('Identity changed during Offer reconciliation.')
    }
    const current = this.requirePendingOffer(original.taskOfferId)
    if (current.authorityFencedAt || ['dismissed', 'closed', 'claimed_elsewhere'].includes(current.state)) return false
    const membership = pages.flatMap((page) => page.collection === 'memberships' ? page.items : [])
      .find(({ userId }) => userId === original.workerUserId)
    const task = pages.flatMap((page) => page.collection === 'tasks' ? page.items : [])
      .find(({ taskId }) => taskId === original.taskId)
    const offer = pages.flatMap((page) => page.collection === 'offers' ? page.items : [])
      .find(({ taskOfferId }) => taskOfferId === original.taskOfferId)
    const authorities = pages.flatMap((page) => page.collection === 'task_authorities' ? page.items : [])
      .filter(({ userId }) => userId === original.workerUserId)
    if (project.status === 'paused') {
      await this.updatePendingOffer(current.taskOfferId, { recoveryReason: 'authority_changed',
        error: 'The Cloud Project is paused; acceptance waits for current Project authority.' })
      return false
    }
    if (project.status !== 'active' || membership?.state !== 'active' || !task || !authorities.some((authority) =>
      authority.state === 'eligible' && authority.scope === (task.fileIntent ? 'file_tasks' : 'text_tasks'))) {
      await this.closeReconciledOffer(current, 'authority_changed')
      return false
    }
    if (!task || !offer || offer.workerUserId !== current.workerUserId || offer.taskId !== current.taskId ||
        typeof current.contractRevision !== 'number' || typeof current.contractDigest !== 'string') {
      await this.updatePendingOffer(current.taskOfferId, { recoveryReason: 'recovery_evidence_missing',
        error: 'Cloud facts cannot prove this exact saved Offer and Contract; a new human decision is required.' })
      return false
    }
    if (task.contractRevision !== current.contractRevision || task.contractDigest !== current.contractDigest ||
        offer.contractRevision !== current.contractRevision || offer.contractDigest !== current.contractDigest) {
      await this.closeReconciledOffer(current, 'contract_changed')
      return false
    }
    if (offer.state !== 'pending' && offer.state !== 'accepted') {
      await this.closeReconciledOffer(current, offer.state === 'timed_out' ? 'offer_expired' : 'offer_closed',
        offer.state === 'rejected' ? 'rejected' : offer.state === 'timed_out' ? 'timed_out' : 'withdrawn')
      return false
    }
    const claim = this.durableClaim(current)
    if (offer.state === 'accepted') {
      const execution = pages.flatMap((page) => page.collection === 'executions' ? page.items : [])
        .find(({ executionId }) => executionId === offer.executionId)
      if (execution && (execution.assigneeAgentId !== current.recipientAgentId ||
          execution.assigneeDeviceId !== this.options.store.snapshot().agents.find(
            ({ agentId }) => agentId === current.recipientAgentId)?.deviceId)) {
        await this.updatePendingOffer(current.taskOfferId, { state: 'claimed_elsewhere',
          completedAt: this.now().toISOString(), error: 'Another Device claimed this Offer.' })
        return false
      }
      if (!execution || execution.assigneeUserId !== current.workerUserId ||
          execution.contractRevision !== current.contractRevision || execution.contractDigest !== current.contractDigest ||
          task.currentExecutionId !== execution.executionId || execution.fence.status !== 'open' ||
          !['accepted', 'running', 'needs_human'].includes(execution.state) ||
          this.options.store.snapshot().taskRuns.some(({ offer: saved }) => saved.taskOfferId === current.taskOfferId)) {
        await this.closeReconciledOffer(current, 'offer_closed')
        return false
      }
      if (!claim || claim.body.expectedContractRevision !== current.contractRevision ||
          claim.body.expectedContractDigest !== current.contractDigest) {
        await this.updatePendingOffer(current.taskOfferId, { recoveryReason: 'recovery_evidence_missing',
          error: 'Accepted Execution has no matching durable human acceptance request on this Device.' })
        return false
      }
    } else {
      if (Date.parse(offer.expiresAt) <= Date.parse(observedAt!)) {
        await this.closeReconciledOffer(current, 'offer_expired', 'timed_out')
        return false
      }
      if (task.status !== 'offered' || task.currentExecutionId !== null ||
          task.revision !== current.currentTaskRevision || offer.revision < current.offerRevision) {
        await this.closeReconciledOffer(current, 'offer_closed')
        return false
      }
    }
    const decisions = this.options.store.snapshot().outbox.filter(({ kind, body }) =>
      kind === 'task.offer-decision' && body.taskOfferId === current.taskOfferId)
    const rejection = decisions.find(({ body }) => body.type === 'task.offer.reject')
    if ((claim && rejection) ||
        decisions.some(({ state, response }) => state === 'delivered' && response?.type === 'rest.error')) {
      await this.updatePendingOffer(current.taskOfferId, { recoveryReason: 'recovery_evidence_missing',
        error: 'A durable rejected decision cannot be replaced by a new acceptance during recovery.' })
      return false
    }
    const nextState = claim || current.decision?.decision === 'accept' ? 'claiming'
      : rejection || current.decision?.decision === 'reject' ? 'rejecting' : 'awaiting-manual'
    // A checked Cloud observation is the only transition allowed out of historical failed.
    return this.options.store.transact((draft) => {
      const pending = draft.pendingTaskOffers.find(({ taskOfferId }) => taskOfferId === current.taskOfferId)
      if (!pending || pending.authorityFencedAt || pending.state !== current.state ||
          pending.updatedAt !== current.updatedAt || pending.decision?.decision !== current.decision?.decision) return false
      Object.assign(pending, { state: nextState, completedAt: null, error: null,
        verifiedAt: this.now().toISOString(), expiresAt: offer.expiresAt,
        recoveryReason: nextState === 'awaiting-manual' ? undefined : 'synchronization_pending',
        // Preserve the exact body of an uncertain acceptance, including its original CAS.
        ...(!claim && !rejection ? { offerRevision: offer.revision } : {}), updatedAt: this.now().toISOString() })
      draft.tasks = [...draft.tasks.filter(({ taskId }) => taskId !== task.taskId), taskSchema.parse(task)]
      return true
    })
  }

  private async closeReconciledOffer(offer: CollaborationPendingTaskOffer,
    recoveryReason: 'authority_changed' | 'contract_changed' | 'offer_expired' | 'offer_closed',
    closedOutcome?: CollaborationPendingTaskOffer['closedOutcome']): Promise<void> {
    await this.updatePendingOffer(offer.taskOfferId, { state: 'closed', recoveryReason,
      ...(closedOutcome ? { closedOutcome } : {}), completedAt: this.now().toISOString(),
      error: `Cloud Offer reconciliation: ${recoveryReason}.` })
  }

  private async claimPendingOffer(pending: CollaborationPendingTaskOffer): Promise<void> {
    const requestFacts = pendingOfferClaimRequestFacts(pending)
    let response: RestResponse
    try {
      response = await this.options.outbox.enqueueAndWait('task.offer-decision', pendingOfferClaimRequest(pending))
      await this.persistClaimedOffer(pending, response)
      return
    } catch (error) {
      const current = this.findPendingOffer(pending.taskOfferId)
      if (!(error instanceof OfferClaimCheckpointError) && current && current.state === 'claiming' &&
          (current.currentTaskRevision !== requestFacts.expectedTaskRevision ||
           current.offerRevision !== requestFacts.expectedOfferRevision) &&
          !this.hasUncertainDurableClaim(current)) {
        throw new OfferClaimRevisionRaceError(error)
      }
      throw error
    }
  }

  private async resumePendingOfferClaim(pending: CollaborationPendingTaskOffer): Promise<boolean> {
    const entry = this.durableClaim(pending)
    if (!entry) return false
    const replay = await this.options.outbox.resumeAndWait('task.offer-decision', entry.idempotencyKey,
      (request) => {
        if (request.type !== 'task.offer.accept' || request.taskOfferId !== pending.taskOfferId ||
            request.taskId !== pending.taskId ||
            request.expectedContractRevision !== pending.contractRevision ||
            request.expectedContractDigest !== pending.contractDigest ||
            request.agentId !== pending.recipientAgentId ||
            request.interaction !== 'explicit_click') {
          throw new Error('Durable Task offer claim does not match the manually accepted Contract.')
        }
      })
    if (!replay) return false
    if (replay.response.type === 'rest.error' && replay.response.error.code === 'revision_conflict' &&
        this.requirePendingOffer(pending.taskOfferId).offerRevision !== pending.offerRevision &&
        !this.hasUncertainDurableClaim(this.requirePendingOffer(pending.taskOfferId))) {
      throw new OfferClaimRevisionRaceError(new Error(replay.response.error.message))
    }
    await this.persistClaimedOffer(pending, replay.response)
    return true
  }

  private durableClaim(pending: CollaborationPendingTaskOffer) {
    return this.options.store.snapshot().outbox.find((entry) => {
      const request = entry.body
      if (entry.kind !== 'task.offer-decision' || request.type !== 'task.offer.accept' ||
          request.taskOfferId !== pending.taskOfferId) return false
      // A definitive extension CAS loss can use the refreshed Offer revision;
      // transport failures and successful receipts always replay the original body.
      const response = entry.response ? restResponseSchema.parse(entry.response) : null
      return !(entry.state === 'delivered' && response?.type === 'rest.error' &&
        response.error.code === 'revision_conflict' &&
        request.expectedTaskRevision === pending.currentTaskRevision &&
        request.expectedOfferRevision !== pending.offerRevision &&
        request.expectedContractRevision === pending.contractRevision &&
        request.expectedContractDigest === pending.contractDigest)
    })
  }

  private hasUncertainDurableClaim(pending: CollaborationPendingTaskOffer): boolean {
    const entry = this.durableClaim(pending)
    return entry !== undefined && entry.state !== 'delivered'
  }

  private async persistClaimedOffer(
    pending: CollaborationPendingTaskOffer,
    response: RestResponse
  ): Promise<void> {
    if (response.type === 'rest.error') {
      if (response.error.code === 'expired') {
        await this.updatePendingOffer(pending.taskOfferId, {
          state: 'closed', closedOutcome: 'timed_out', completedAt: this.now().toISOString(),
          error: response.error.message
        })
        return
      }
      throw new OfferDecisionRejectedError(response.error.message)
    }
    if (response.type !== 'rest.collection') {
      throw new Error(`Task offer claim returned unexpected ${response.type}.`)
    }
    const task = response.items.find((item): item is Task => item.type === 'task')
    const execution = response.items.find((item): item is TaskExecution => item.type === 'task_execution')
    const offer = response.items.find((item): item is TaskOffer => item.type === 'task_offer')
    const localAgentId = this.options.localAgentId()
    const agent = this.options.store.snapshot().agents.find((candidate) => candidate.agentId === localAgentId)
    if (
      response.items.length !== 3 ||
      !task || !execution || !offer || !localAgentId ||
      task.taskId !== pending.taskId || task.projectId !== pending.projectId ||
      task.currentExecutionId !== execution.executionId ||
      execution.taskId !== pending.taskId || execution.projectId !== pending.projectId ||
      execution.assigneeAgentId !== localAgentId || execution.assigneeUserId !== pending.workerUserId ||
      execution.assigneeDeviceId !== agent?.deviceId ||
      (execution.contractRevision ?? null) !== (pending.contractRevision ?? null) ||
      (execution.contractDigest ?? null) !== (pending.contractDigest ?? null) ||
      (offer.contractRevision ?? null) !== (pending.contractRevision ?? null) ||
      (offer.contractDigest ?? null) !== (pending.contractDigest ?? null) ||
      execution.state !== 'accepted' ||
      offer.taskOfferId !== pending.taskOfferId || offer.workerUserId !== pending.workerUserId ||
      offer.executionId !== execution.executionId || offer.state !== 'accepted'
    ) {
      throw new Error('Task offer claim did not return this Device\'s exact immutable execution.')
    }
    const workspaceRoot = this.options.workspaceRootForExecution(execution.executionId)
    const acceptedAt = this.now().toISOString()
    try {
      await ensurePrivateWorkspaceRoot(workspaceRoot)
      await this.options.store.transact((draft) => {
        const current = draft.pendingTaskOffers.find((candidate) => candidate.taskOfferId === pending.taskOfferId)
        if (!current || current.state !== 'claiming') {
          throw new Error('The local offer claim journal is no longer current.')
        }
        draft.pendingTaskOffers = draft.pendingTaskOffers.filter((candidate) => (
          candidate.taskOfferId !== pending.taskOfferId
        ))
        draft.taskRuns.push({
          offer: {
            projectId: pending.projectId,
            taskId: pending.taskId,
            executionId: execution.executionId,
            taskOfferId: pending.taskOfferId,
            currentTaskRevision: task.revision,
            currentExecutionRevision: execution.revision,
            offerRevision: offer.revision,
            ...(task.contractRevision !== null && task.contractRevision !== undefined
              ? { contractRevision: task.contractRevision }
              : {}),
            ...(task.contractDigest !== null && task.contractDigest !== undefined
              ? { contractDigest: task.contractDigest }
              : {}),
            recipientAgentId: localAgentId,
            receivedAt: pending.receivedAt,
            revisionInstruction: pending.revisionInstruction
          },
          task,
          execution,
          latestPreflight: null,
          decision: { decision: 'accept', decidedAt: acceptedAt },
          expectedTaskRevision: task.revision,
          expectedExecutionRevision: execution.revision,
          state: 'accepting',
          executionMode: 'unselected',
          workspaceRoot,
          runtimeId: null,
          threadId: null,
          humanRequestId: null,
          humanAnswer: null,
          resources: [],
          agentJournal: [],
          followups: [],
          externalJournal: [],
          outputs: [],
          recoveryJournalEntryIds: [],
          resultSummary: null,
          frozenCandidate: null,
          deliveryDraft: null,
          deliveryHistory: [],
      cancelledDeliveryAttempts: [],
          deliverySaga: null,
          lateOutcomes: [],
          startedAt: null,
          updatedAt: acceptedAt,
          completedAt: null,
          error: null
        })
        const acceptedRun = requireDraftRun(draft.taskRuns, execution.executionId)
        acceptedRun.deliveryDraft = newDeliveryDraft(acceptedRun, acceptedAt)
        draft.tasks = [...draft.tasks.filter(({ taskId }) => taskId !== task.taskId), task]
      })
    } catch (error) {
      throw new OfferClaimCheckpointError(error)
    }
    await this.publishAvailability('online')
    this.schedule(execution.executionId)
  }

  private async acceptAndStart(initial: CollaborationTaskRun): Promise<void> {
    let run = initial
    let execution = requireExecution(run)
    if (execution.state === 'accepted') {
      const observedAt = this.now().toISOString()
      const startedAt = run.startedAt ?? timestampNotBefore(observedAt, execution.acceptedAt)
      if (!run.startedAt) {
        run = await this.updateRun(run.offer.executionId, { startedAt })
        execution = requireExecution(run)
      }
      const requestFacts = {
        taskId: run.offer.taskId,
        executionId: run.offer.executionId,
        expectedTaskRevision: run.expectedTaskRevision,
        expectedExecutionRevision: run.expectedExecutionRevision,
        startedAt
      }
      const response = await this.options.outbox.enqueueAndWait('task.progress',
        restRequestSchema.parse({
          protocolVersion: '1.0', requestId: collaborationRequestId(),
          type: 'task.execution.start',
          idempotencyKey: idempotencyKey('task.execution.start', requestFacts),
          ...requestFacts
        }))
      const started = requireTaskExecutionBundle(response)
      execution = started.execution
      const task = started.task
      run = await this.updateRun(run.offer.executionId, {
        task, execution,
        expectedTaskRevision: task.revision,
        expectedExecutionRevision: execution.revision,
        state: 'running', startedAt: execution.startedAt ?? startedAt, error: null
      })
      if (TERMINAL_RUN_STATES.has(run.state)) return
    }
    if (execution.state === 'running') {
      if (!execution.startedAt) {
        throw new Error('Running Cloud execution is missing its canonical start timestamp.')
      }
      if (run.startedAt && run.startedAt !== execution.startedAt) {
        throw new Error('Local execution start provenance conflicts with the canonical Cloud execution.')
      }
      if ((run.state === 'accepting' || run.state === 'waiting-runtime') || !run.startedAt) {
        run = await this.updateRun(run.offer.executionId, {
          ...((run.state === 'accepting' || run.state === 'waiting-runtime') ? { state: 'running' as const } : {}),
          startedAt: execution.startedAt,
          error: null
        })
        if (TERMINAL_RUN_STATES.has(run.state)) return
      }
    }
    if (execution.state === 'needs_human') {
      await this.updateRun(run.offer.executionId, { state: 'needs-human' })
      return
    }
    if (execution.state !== 'running') {
      await this.applyTerminalExecution(run, execution)
      return
    }
    if (run.executionMode === 'manual') {
      await this.updateRun(run.offer.executionId, { state: 'waiting-result-confirm' })
      return
    }
    await this.executeRunning(run)
  }

  private async executeRunning(initial: CollaborationTaskRun): Promise<void> {
    let run = initial
    const controller = this.controllers.get(run.offer.executionId) ?? new AbortController()
    this.controllers.set(run.offer.executionId, controller)
    try {
      const authorized = await this.authorizeExecution(run, controller.signal)
      if (!authorized) return
      run = authorized
      const controlView = this.interactions.view(
        run.offer.projectId,
        run.offer.taskId,
        run.offer.executionId
      )
      if (
        controlView.state === 'paused_local' ||
        (controlView.latestInteraction?.kind === 'cancel' &&
          controlView.latestInteraction.state === 'applied')
      ) return
      // The owner restores the timer from its durable intent. Heartbeats do not
      // start another model turn before the due time or after an unknown outcome.
      const followup = run.followups.find((item) => ['waiting', 'dispatching'].includes(item.state))
      if (followup) {
        if (followup.runtimeId !== run.runtimeId || followup.threadId !== run.threadId ||
            followup.contractDigest !== (requireTask(run).contractDigest ?? requireExecution(run).contractDigest) || digest(JSON.stringify(followup.inputResources)) !== digest(JSON.stringify(run.resources)) || run.state === 'needs-human') {
          await this.settleFollowup(run.offer.executionId, followup.id, 'cancelled', '任务、会话或等待状态已改变；旧复查不再续办。')
          return
        }
        if (Date.parse(followup.at) > this.now().getTime()) { this.armFollowup(run); return }
        if (this.now().getTime() - Date.parse(followup.at) > 24 * 60 * 60_000) {
          await this.settleFollowup(run.offer.executionId, followup.id, 'unknown', '复查已错过超过一天，请核实当前情况后手动继续。')
          return
        }
        await this.settleFollowup(run.offer.executionId, followup.id, 'dispatching')
      } else {
        // Recover a successful deferral whose turn was saved before its intent.
        const last = run.agentJournal.at(-1)
        if (last?.origin !== 'session' && last?.state === 'observed_success' && last.safeResultText) {
          let recovered: WorkerRuntimeResult | undefined
          try { recovered = parseWorkerRuntimeResult(last.safeResultText) } catch { /* Ordinary member output. */ }
          if (recovered?.outcome === 'deferred') {
            await this.deferWorkerResult(run, recovered)
            return
          }
        }
      }
      if (await this.recoverInterruptedRetryOutcome(run, controller.signal) === 'parked') return
      run = this.requireRun(run.offer.executionId)
      if (TERMINAL_RUN_STATES.has(run.state)) return
      const latestInvocation = run.agentJournal.at(-1)
      if (!run.resultSummary && (latestAgentFailure(run) ||
          (latestInvocation?.origin === 'session' && latestInvocation.state !== 'observed_success'))) return
      if (requireExecution(run).fileIntent) {
        await this.downloadInputs(run, controller.signal)
        run = this.requireRun(run.offer.executionId)
        if (TERMINAL_RUN_STATES.has(run.state)) return
      }
      run = this.requireRun(run.offer.executionId)
      if (run.state === 'waiting-result-confirm' || run.state === 'submitting' || (run.deliverySaga && !['sealed', 'returned'].includes(run.deliverySaga.state))) {
        // A prepared draft waits for explicit human submission; rescheduling
        // never freezes or publishes the member's current content.
        return
      }
      const initialRuntimeResult: WorkerRuntimeResult | null = run.resultSummary
        ? { schemaVersion: 1, outcome: 'completed', summary: run.resultSummary }
        : await this.runAgent(run, controller.signal, false, undefined, undefined, followup?.id)
      if (!initialRuntimeResult) {
        if (followup && latestAgentFailure(this.requireRun(run.offer.executionId))) {
          await this.settleFollowup(run.offer.executionId, followup.id, 'unknown', '复查轮次未完成；保留原回执，等待成员核实，不自动重做。')
        }
        return
      }
      if (initialRuntimeResult.outcome === 'deferred') {
        try {
          await this.deferWorkerResult(this.requireRun(run.offer.executionId), initialRuntimeResult)
        } catch (error) {
          if (followup) await this.settleFollowup(run.offer.executionId, followup.id, 'unknown', safeError(error, this.options.sanitizeText).slice(0, 2_000))
          throw error
        }
        return
      }
      if (followup) await this.settleFollowup(run.offer.executionId, followup.id, 'completed')
      if (initialRuntimeResult.outcome === 'completed' && !run.resultSummary) {
        await this.updateRun(run.offer.executionId, {
          resultSummary: initialRuntimeResult.summary,
          humanAnswer: null,
          humanRequestId: null
        })
        run = this.requireRun(run.offer.executionId)
      }
      // Flush independent local controls. Member text only enters through the
      // standard Session composer and its durable Host queue/steer receipts.
      this.interactionDispatchWindows.add(run.offer.executionId)
      try {
        await this.interactions.flush(run.offer.executionId)
      } finally {
        this.interactionDispatchWindows.delete(run.offer.executionId)
      }
      this.finalizingExecutions.add(run.offer.executionId)
      run = this.requireRun(run.offer.executionId)
      if (run.state === 'needs-human') return
      const interactionView = this.interactions.view(
        run.offer.projectId,
        run.offer.taskId,
        run.offer.executionId
      )
      if (
        interactionView.state === 'paused_local' ||
        (interactionView.latestInteraction?.kind === 'cancel' &&
          interactionView.latestInteraction.state === 'applied')
      ) return
      const runtimeResult: WorkerRuntimeResult = run.resultSummary
        ? { schemaVersion: 1, outcome: 'completed', summary: run.resultSummary }
        : initialRuntimeResult
      run = this.requireRun(run.offer.executionId)
      if (runtimeResult.outcome === 'needs_human') {
        await this.createHumanNeeded(
          run,
          runtimeResult.question,
          runtimeResult.requiredAssurance,
          controller.signal
        )
        return
      }
      await this.updateRun(run.offer.executionId, {
        resultSummary: runtimeResult.summary,
        humanAnswer: null,
        humanRequestId: null
      })
      run = this.requireRun(run.offer.executionId)
      const resultTurnId = latestObservedTurnId(run)
      const memberSteered = run.agentJournal.some((entry) => entry.origin === 'session' &&
        entry.state === 'observed_success' && entry.turnId === resultTurnId)
      await this.updateDeliveryDraft(run, runtimeResult.summary, resultTurnId, memberSteered)
    } finally {
      this.finalizingExecutions.delete(run.offer.executionId)
      if (this.controllers.get(run.offer.executionId) === controller) {
        this.controllers.delete(run.offer.executionId)
      }
    }
  }

  /** Dispatch durable retry/control intents without introducing Session input. */
  private async dispatchTaskInteraction(
    request: TaskInteractionDispatchRequest
  ): Promise<TaskInteractionDispatchResult> {
    const run = this.requireRun(request.run.offer.executionId)
    if (
      run.offer.projectId !== request.interaction.projectId ||
      run.offer.taskId !== request.interaction.taskId ||
      request.interaction.executionId !== run.offer.executionId ||
      run.runtimeId !== request.session.runtimeId ||
      run.threadId !== request.session.threadId
    ) {
      return { outcome: 'rejected', error: 'Task interaction does not match the exact Worker Session binding.' }
    }
    if (TERMINAL_RUN_STATES.has(run.state) || requireExecution(run).fence.status !== 'open') {
      return {
        outcome: 'rejected',
        error: 'Cloud execution is terminal or fenced; use the existing Task reassign/retry operation.'
      }
    }
    if (run.state === 'needs-human') {
      return {
        outcome: 'rejected',
        error: 'This execution is waiting for its canonical HumanNeeded answer; answer that request instead.'
      }
    }
    if (run.state === 'submitting') {
      return {
        outcome: 'rejected',
        error: 'Cloud result submission is already in progress; this execution cannot accept another intervention.'
      }
    }
    if (request.interaction.kind === 'retry') {
      const failure = latestAgentFailure(run)
      if (!failure) {
        return {
          outcome: 'rejected',
          error: 'There is no failed Worker Runtime turn to execute again.'
        }
      }
      const result = await this.runAgent(
        run,
        request.signal,
        false,
        request.interaction.interactionId
      )
      if (!result) {
        const latest = this.requireRun(run.offer.executionId)
        throw new Error(
          latestAgentFailure(latest)?.failure?.message ??
          'Worker Runtime retry failed.'
        )
      }
      if (result.outcome === 'deferred') {
        await this.deferWorkerResult(this.requireRun(run.offer.executionId), result)
      } else if (result.outcome === 'needs_human') {
        await this.createHumanNeeded(
          this.requireRun(run.offer.executionId),
          result.question,
          result.requiredAssurance,
          request.signal
        )
      } else {
        await this.updateRun(run.offer.executionId, {
          resultSummary: result.summary,
          humanAnswer: null,
          humanRequestId: null
        })
      }
      const completedAttempt = [...this.requireRun(run.offer.executionId).agentJournal]
        .reverse()
        .find((entry) => entry.state === 'observed_success')
      return {
        outcome: 'applied',
        ...(completedAttempt?.clientDirectiveId
          ? { clientDirectiveId: completedAttempt.clientDirectiveId }
          : {})
      }
    }
    // Local controls are applied by the controller, without another Agent call.
    return { outcome: 'applied' }
  }

  private async recoverInterruptedRetryOutcome(
    run: CollaborationTaskRun,
    signal: AbortSignal
  ): Promise<'continue' | 'parked'> {
    const interaction = [...this.options.store.snapshot().taskInteractions].reverse().find((candidate) => (
      candidate.executionId === run.offer.executionId && candidate.kind === 'retry'
    ))
    if (!interaction || interaction.state !== 'failed') return 'continue'
    const invocation = [...run.agentJournal].reverse().find((entry) => (
      entry.retryInteractionId === interaction.interactionId
    ))
    if (!invocation) return 'continue'
    if (invocation.state === 'prepared' || invocation.state === 'dispatched') return 'parked'
    if (invocation.state === 'observed_failure') return 'parked'
    if (invocation.state !== 'observed_success' || run.resultSummary) return 'continue'
    let result: WorkerRuntimeResult
    try {
      result = parseWorkerRuntimeResult(invocation.safeResultText ?? '')
    } catch {
      await this.failExecution(
        this.requireRun(run.offer.executionId),
        'invalid_runtime_result',
        'Agent Runtime returned an invalid Worker result.'
      )
      return 'parked'
    }
    if (result.outcome === 'deferred') {
      await this.deferWorkerResult(this.requireRun(run.offer.executionId), result)
      return 'parked'
    }
    if (result.outcome === 'needs_human') {
      await this.createHumanNeeded(
        this.requireRun(run.offer.executionId),
        result.question,
        result.requiredAssurance,
        signal
      )
    } else {
      await this.updateRun(run.offer.executionId, {
        resultSummary: result.summary,
        humanAnswer: null,
        humanRequestId: null
      })
    }
    return 'continue'
  }

  private async waitForExecutionReadiness(
    run: CollaborationTaskRun,
    preflight: CollaborationWorkerPreflight
  ): Promise<boolean> {
    const pendingChange = preflight.cloud.decision.reasons.length > 0 &&
      preflight.cloud.decision.reasons.every((reason) => reason === 'task_change_pending')
    if (!preflight.reasons.length || !preflight.reasons.every((reason) =>
      ['runtime_not_ready', 'capability_unavailable', 'provider_not_ready'].includes(reason) ||
      reason === 'cloud_denied' && pendingChange)) return false
    await this.updateRun(run.offer.executionId, {
      ...(requireExecution(run).state === 'accepted' ? { state: 'waiting-runtime' as const } : {}),
      error: `Waiting for execution readiness: ${preflight.reasons.join(', ')}`
    })
    return true
  }

  private async authorizeExecution(
    run: CollaborationTaskRun,
    signal: AbortSignal
  ): Promise<CollaborationTaskRun | null> {
    if (this.requireRun(run.offer.executionId).authorityFencedAt) return null
    const preflight = await this.refreshPreflight(run, true, signal)
    throwIfSignalAborted(signal)
    const current = this.requireRun(run.offer.executionId)
    if (current.authorityFencedAt) return null
    if (this.delivering.has(run.offer.executionId) || current.state === 'submitting') return null
    if (preflight.outcome === 'denied') {
      if (await this.waitForExecutionReadiness(current, preflight)) return null
      await this.markFenced(current, `Execution lost authority: ${preflight.reasons.join(', ')}`)
      return null
    }
    return TERMINAL_RUN_STATES.has(current.state) ? null : current
  }

  private async runAgent(
    run: CollaborationTaskRun,
    signal: AbortSignal,
    repairAttempt = false,
    retryInteractionId?: string,
    continuationOperationId?: string,
    followupId?: string
  ): Promise<WorkerRuntimeResult | null> {
    // Every owned Runtime turn, including retries and repair, uses current Cloud authority.
    const authorized = await this.authorizeExecution(run, signal)
    if (!authorized) return null
    run = authorized
    if (followupId) {
      const observed = [...run.agentJournal].reverse().find((entry) => entry.followupId === followupId && entry.state === 'observed_success')
      if (observed?.safeResultText) return parseWorkerRuntimeResult(observed.safeResultText)
    }
    const latestInvocation = run.agentJournal.at(-1)
    if (!continuationOperationId && latestInvocation?.origin === 'session' && latestInvocation.state !== 'observed_success') return null
    const existing = [...run.agentJournal].reverse().find((entry) => (
      entry.origin !== 'session' && (entry.state === 'prepared' || entry.state === 'dispatched') &&
      (followupId ? entry.followupId === followupId : continuationOperationId ? entry.continuationOperationId === continuationOperationId : retryInteractionId
        ? entry.retryInteractionId === retryInteractionId
        : !entry.retryInteractionId && !entry.continuationOperationId && !entry.followupId)
    ))
    const ordinal = run.agentJournal.length + (existing ? 0 : 1)
    const logicalInvocationId = existing?.logicalInvocationId ?? `agent.${run.offer.executionId}.${ordinal}`
    const clientDirectiveId = existing?.clientDirectiveId ?? continuationOperationId ??
      `collab-worker-${digest(`${run.offer.executionId}\u0000${ordinal}`).slice(0, 48)}`
    if (!existing) {
      const preparedAt = this.now().toISOString()
      await this.options.store.transact((draft) => {
        const current = requireDraftRun(draft.taskRuns, run.offer.executionId)
        current.agentJournal.push({
          logicalInvocationId, clientDirectiveId, state: 'prepared', preparedAt,
          ...(retryInteractionId ? { retryInteractionId } : {}),
          ...(followupId ? { followupId } : {}),
          ...(continuationOperationId ? { continuationOperationId } : {}),
          dispatchedAt: null, observedAt: null,
          runtimeId: null, threadId: null, turnId: null, runtimeState: null,
          safeResultText: null, safeError: null
        })
        current.updatedAt = preparedAt
      })
    }
    run = this.requireRun(run.offer.executionId)
    let journal = requireAgentJournal(run, logicalInvocationId)
    const partialRunSession = Boolean(run.runtimeId) !== Boolean(run.threadId)
    const partialJournalSession = Boolean(journal.runtimeId) !== Boolean(journal.threadId)
    if (partialRunSession || partialJournalSession) {
      throw new Error('The durable Runtime Session binding is incomplete; refusing turn dispatch.')
    }
    const runSession = run.runtimeId && run.threadId
      ? { runtimeId: run.runtimeId, threadId: run.threadId }
      : null
    const journalSession = journal.runtimeId && journal.threadId
      ? { runtimeId: journal.runtimeId, threadId: journal.threadId }
      : null
    if (runSession && journalSession && (
      runSession.runtimeId !== journalSession.runtimeId ||
      runSession.threadId !== journalSession.threadId
    )) {
      throw new Error('The Worker Runtime Session binding changed within one execution.')
    }
    let session = runSession ?? journalSession
    if (!session) {
      if (journal.state === 'dispatched') {
        throw new Error('A dispatched Runtime turn has no durable Session binding; blind redispatch is forbidden.')
      }
      const workspaceDisplayName = this.options.workspaceDisplayNameForProject?.(run.offer.projectId)
      session = await this.options.agentExecution.prepareSession({
        workspaceRoot: run.workspaceRoot,
        ...(workspaceDisplayName
          ? { workspaceDisplayName: collaborationWorkerSessionTitle(workspaceDisplayName) }
          : {}),
        title: collaborationWorkerSessionTitle(requireTask(run).title),
        interaction: 'reviewable',
        mode: 'agent'
      })
    }
    if (!runSession || !journalSession) {
      const preparedSession = session
      await this.options.store.transact((draft) => {
        const current = requireDraftRun(draft.taskRuns, run.offer.executionId)
        const currentJournal = requireAgentJournal(current, logicalInvocationId)
        if (currentJournal.state !== 'prepared' && currentJournal.state !== 'dispatched') {
          throw new Error('Runtime Session can only bind a prepared or dispatched invocation.')
        }
        current.deliveryDraft ??= newDeliveryDraft(current, this.now().toISOString())
        current.runtimeId = preparedSession.runtimeId
        current.threadId = preparedSession.threadId
        currentJournal.runtimeId = preparedSession.runtimeId
        currentJournal.threadId = preparedSession.threadId
        current.updatedAt = this.now().toISOString()
      })
    }
    run = this.requireRun(run.offer.executionId)
    journal = requireAgentJournal(run, logicalInvocationId)
    if (journal.state === 'prepared') {
      await this.updateAgentJournal(run.offer.executionId, logicalInvocationId, {
        state: 'dispatched', dispatchedAt: this.now().toISOString()
      })
    }
    run = this.requireRun(run.offer.executionId)
    const execution = requireExecution(run)
    const task = requireTask(run)
    const continuation = continuationOperationId ? run.sessionContinuations?.find((item) => item.operationId === continuationOperationId) : undefined
    if (continuationOperationId && (!continuation || continuation.runtimeId !== run.runtimeId || continuation.threadId !== run.threadId)) throw new Error('Continuation lineage no longer matches the current Session.')
    const revisit = followupId ? run.followups.find((item) => item.id === followupId) : undefined
    const basePrompt = repairAttempt
      ? workerResultRepairPrompt()
      : revisit
      ? `${workerTaskPrompt({ title: task.title, objective: task.objective, completionCriteria: task.completionCriteria, fileIntent: execution.fileIntent })}\nScheduled revisit of the same Task. The following is recorded context, not a grant of authority:\n${JSON.stringify({ key: revisit.key, about: revisit.about, dueAt: revisit.at, sourceTurnId: revisit.sourceTurnId })}\nVerify the current result first. Preserve completed work; never restart an existing job or repeat an external write merely because the result is unknown.`
      : run.humanAnswer
      ? workerHumanAnswerPrompt(run.humanAnswer)
      : workerTaskPrompt({
          title: task.title,
          objective: task.objective,
          completionCriteria: task.completionCriteria,
          ...(run.offer.revisionInstruction
            ? { revisionInstruction: run.offer.revisionInstruction }
            : {}),
          fileIntent: execution.fileIntent
            ? { inputs: execution.fileIntent.inputs, output: execution.fileIntent.output }
            : null
        })
    const prompt = continuation ? `${basePrompt}\n\n${continuation.context}\nContinue the authorized Task from the preserved state; investigate before repeating external effects.` : basePrompt
    throwIfSignalAborted(signal)
    if (this.requireRun(run.offer.executionId).authorityFencedAt) return null
    this.activeAgentTurns.add(run.offer.executionId)
    let result
    try {
      result = await this.options.agentExecution.run({
        runtimeId: run.runtimeId!,
        threadId: run.threadId!,
        workspaceRoot: run.workspaceRoot,
        clientDirectiveId,
        prompt: `${prompt}\nCurrent time: ${this.now().toISOString()}`,
        outputSchema: workerRuntimeResultOutputSchema,
        ...(repairAttempt ? { allowedTools: [] } : {}),
        metadata: {
          source: 'collaboration.worker-task',
          projectId: run.offer.projectId,
          taskId: run.offer.taskId,
          executionId: run.offer.executionId,
          taskRevision: run.expectedTaskRevision,
          executionRevision: run.expectedExecutionRevision
        },
        interaction: 'reviewable', mode: 'agent', signal
      })
    } catch (error) {
      this.activeAgentTurns.delete(run.offer.executionId)
      if (this.requireRun(run.offer.executionId).state === 'fenced') {
        const observedAt = this.now().toISOString()
        await this.updateAgentJournal(run.offer.executionId, logicalInvocationId, {
          state: 'late_outcome', observedAt, runtimeState: 'failed',
          safeError: safeError(error, this.options.sanitizeText)
        })
        await this.recordLateOutcome(
          'agent_runtime',
          run.offer.executionId,
          logicalInvocationId,
          'failed_after_fence',
          error
        )
        return null
      }
      if (signal.aborted && this.stopped) return null
      if (signal.aborted && isAuthorityUnverified(signal.reason)) return null
      await this.updateAgentJournal(run.offer.executionId, logicalInvocationId, {
        state: 'observed_failure', observedAt: this.now().toISOString(),
        runtimeState: 'failed', safeError: safeError(error, this.options.sanitizeText)
      })
      await this.failExecution(this.requireRun(run.offer.executionId), 'runtime_failed', 'Agent Runtime invocation failed.')
      return null
    }
    this.activeAgentTurns.delete(run.offer.executionId)
    const safeText = result.text.slice(0, 32_000)
    const observedAt = this.now().toISOString()
    const postflight = await this.refreshPreflight(
      this.requireRun(run.offer.executionId),
      true,
      signal
    ).catch(() => null)
    if (signal.aborted && this.stopped) return null
    if (signal.aborted && isAuthorityUnverified(signal.reason)) return null
    if (!postflight || postflight.outcome === 'denied') {
      await this.updateAgentJournal(run.offer.executionId, logicalInvocationId, {
        state: 'late_outcome', observedAt,
        runtimeId: result.runtimeId, threadId: result.threadId, turnId: result.turnId,
        runtimeState: result.state, safeResultText: safeText
      })
      await this.recordLateOutcome('agent_runtime', run.offer.executionId, logicalInvocationId,
        result.state === 'completed' ? 'completed_after_fence' : 'failed_after_fence', result.text)
      await this.markFenced(this.requireRun(run.offer.executionId), 'Execution was fenced while Agent Runtime was active.')
      return null
    }
    const runtimeFailureMessage = result.failure?.message
      ? safeError(result.failure.message, this.options.sanitizeText)
      : `Agent turn ended in ${result.state}.`
    await this.updateAgentJournal(run.offer.executionId, logicalInvocationId, {
      state: result.state === 'completed' ? 'observed_success' : 'observed_failure',
      observedAt,
      runtimeId: result.runtimeId, threadId: result.threadId, turnId: result.turnId,
      runtimeState: result.state, safeResultText: safeText,
      ...(result.state === 'completed'
        ? { failure: null }
        : {
            safeError: runtimeFailureMessage,
            failure: result.failure
              ? { ...result.failure, message: runtimeFailureMessage.slice(0, 1_000) }
              : {
                  code: result.state === 'cancelled' ? 'runtime_cancelled' : 'runtime_failed',
                  message: runtimeFailureMessage.slice(0, 1_000),
                  retryable: false
                }
          })
    })
    await this.updateRun(run.offer.executionId, {
      runtimeId: result.runtimeId, threadId: result.threadId, humanAnswer: null
    })
    const memberSteered = await this.settleSteeredSessionInputs(run.offer.executionId, result)
    if (continuationOperationId && this.requireRun(run.offer.executionId).agentJournal.at(-1)?.logicalInvocationId !== logicalInvocationId) return null
    // A failed/cancelled turn ends this invocation, not the member's Task.
    // Keep the draft and Cloud execution open for a new input or human submission.
    if (result.state !== 'completed') return null
    try {
      return parseWorkerRuntimeResult(result.text)
    } catch (error) {
      if (memberSteered) {
        // The request/schema remain unchanged. A confirmed human steer may
        // produce an ordinary reply, just like another Member Session input.
        // Preserve the explanation rather than starting an automatic repair.
        await this.updateDeliveryDraft(this.requireRun(run.offer.executionId), null, result.turnId, true)
        return null
      }
      await this.updateAgentJournal(run.offer.executionId, logicalInvocationId, {
        state: 'observed_failure',
        safeError: safeError(error, this.options.sanitizeText)
      })
      if (!repairAttempt && !retryInteractionId && !continuationOperationId && !followupId) {
        return this.runAgent(
          this.requireRun(run.offer.executionId),
          signal,
          true
        )
      }
      await this.failExecution(this.requireRun(run.offer.executionId),
        'invalid_runtime_result', 'Agent Runtime returned an invalid Worker result.')
      return null
    }
  }

  /** Downloads exact Cloud object inputs into the private execution workspace. */
  private async downloadInputs(run: CollaborationTaskRun, signal: AbortSignal): Promise<void> {
    await this.ensureResources(run)
    run = this.requireRun(run.offer.executionId)
    const fileIntent = requireExecution(run).fileIntent
    if (!fileIntent) return
    const transport = this.options.authenticatedCloudTransport
    if (!transport) throw new Error('Cloud object inputs require an authenticated User transport.')
    await ensurePrivateWorkspaceRoot(run.workspaceRoot)
    for (const input of fileIntent.inputs) {
      throwIfSignalAborted(signal)
      const resource = run.resources.find((candidate) => (
        candidate.resourceRefId === input.resourceRefId && candidate.role === 'input-file'
      ))
      if (!resource || resource.status !== 'available') {
        throw new Error('A Cloud input ResourceRef is unavailable for this execution.')
      }
      const locator = resource.locator
      const request = locator.source.kind === 'shared_material'
        ? {
            projectId: locator.object.projectId,
            materialRevisionId: locator.source.materialRevisionId,
            objectId: locator.object.objectId
          }
        : {
            projectId: locator.object.projectId,
            deliveryManifestId: locator.source.deliveryManifestId,
            objectId: locator.object.objectId
          }
      const read = await transport.readObject({ request, expected: locator.object }, { signal })
      throwIfSignalAborted(signal)
      if (read.object.sha256 !== locator.object.sha256 ||
          read.object.revision !== locator.object.revision ||
          read.body.byteLength !== locator.object.byteCount ||
          createHash('sha256').update(read.body).digest('hex') !== locator.object.sha256) {
        throw new Error('Cloud input bytes do not match the exact Contract object.')
      }
      const destination = join(run.workspaceRoot, input.destinationName)
      await mkdir(dirname(destination), { recursive: true })
      await writeFile(destination, read.body)
    }
  }

  /** Freeze current member-approved content once, inside the canonical submit operation. */
  private async freezeCandidate(run: CollaborationTaskRun, summary: string, admissionRevision: number,
    expectedTarget: WorkerDeliveryConfirmationTarget): Promise<FrozenWorkerCandidate> {
    const workspace = await readDeliveryWorkspaceIdentity(run.workspaceRoot)
    const contract = await this.readAcceptedContract(run)
    const outputs = await readDeliveryMaterials(deliveryMaterialContext(run), workspace)
    const bundle = deliveryBundleForDraft(run, summary, outputs.map(({ metadata }) => metadata))
    const target = confirmationTargetForBundle(bundle)
    if (workerDeliveryConfirmationDigest(target) !== workerDeliveryConfirmationDigest(expectedTarget)) {
      throw new Error('草稿或文件有新改动，请预览后再次提交。')
    }
    const candidateId = `cnd_${randomUUID().replaceAll('-', '')}`
    const snapshotRoot = `.sciforge/delivery/${candidateId}`
    const outputFiles: FrozenWorkerCandidate['outputFiles'] = []
    for (const [index, output] of outputs.entries()) {
      await readDeliveryWorkspaceIdentity(run.workspaceRoot, workspace)
      const target = await resolveSafeWorkspaceWriteTarget(`${snapshotRoot}/outputs/${index}/${output.metadata.fileName}`, run.workspaceRoot)
      await readDeliveryWorkspaceIdentity(run.workspaceRoot, workspace)
      await writeSafeWorkspaceFile(target, output.bytes, { exclusive: true })
      await readDeliveryWorkspaceIdentity(run.workspaceRoot, workspace)
      await chmod(target.path, 0o400)
      outputFiles.push({ path: target.path, sha256: output.metadata.sha256,
        byteCount: output.metadata.byteCount, mediaType: output.metadata.mediaType })
    }
    const bundleBytes = canonicalFrozenDeliveryBundleBytes(bundle)
    await readDeliveryWorkspaceIdentity(run.workspaceRoot, workspace)
    const bundleTarget = await resolveSafeWorkspaceWriteTarget(`${snapshotRoot}/bundle.json`, run.workspaceRoot)
    await readDeliveryWorkspaceIdentity(run.workspaceRoot, workspace)
    await writeSafeWorkspaceFile(bundleTarget, bundleBytes, { exclusive: true })
    await readDeliveryWorkspaceIdentity(run.workspaceRoot, workspace)
    await chmod(bundleTarget.path, 0o400)
    const candidate: FrozenWorkerCandidate = {
      ...(run.deliveryDraft?.sourceChat ? { sourceChat: run.deliveryDraft.sourceChat } : {}),
      candidateId, sourceTurnId: run.deliveryDraft?.sourceTurnId ?? latestObservedTurnId(run) ?? `member-r${bundle.resultRevision}`,
      admissionRevision, frozenAt: this.now().toISOString(), bundle, bundleDigest: frozenDeliveryBundleDigest(bundle),
      contract,
      bundleFile: { path: bundleTarget.path, sha256: createHash('sha256').update(bundleBytes).digest('hex'),
        byteCount: bundleBytes.byteLength, mediaType: 'application/json' }, outputFiles, dirty: false
    }
    const currentAdmission = await this.deliveryAdmission(run)
    await readDeliveryWorkspaceIdentity(run.workspaceRoot, workspace)
    if (currentAdmission?.revision !== admissionRevision) throw new Error('会话有新输入，请等待本轮完成后再提交。')
    await this.options.store.transact((state) => {
      const current = requireDraftRun(state.taskRuns, run.offer.executionId)
      this.assertDraftEditable(current, run.offer)
      if (current.deliveryDraft?.revision !== run.deliveryDraft?.revision) throw new Error('草稿已有更新，请预览后再次提交。')
      current.frozenCandidate = candidate
      if (current.deliveryDraft) current.deliveryDraft = { ...current.deliveryDraft, summary, outputs: bundle.outputs }
    })
    return candidate
  }

  private async readAcceptedContract(run: CollaborationTaskRun): Promise<ExactContractReferenceHistory> {
    try { await this.options.connection.refreshDashboards() }
    catch (cause) { throw new Error('无法核验已接受的任务要求，请刷新任务后再次提交。', { cause }) }
    const execution = requireExecution(run)
    const dashboard = this.options.connection.cloudDashboards().find((candidate) => (
      candidate.projectId === run.offer.projectId && !candidate.stale && !candidate.offline && !candidate.revoked
    ))
    const card = dashboard?.tasks.find((task) => task.taskId === run.offer.taskId && task.executionId === run.offer.executionId)
    const accepted = card && exactContractReferenceHistorySchema.safeParse(card.contract)
    if (!accepted || !accepted.success || accepted.data.projectId !== run.offer.projectId ||
        accepted.data.taskId !== run.offer.taskId || accepted.data.contractRevision !== execution.contractRevision ||
        accepted.data.contractDigest !== execution.contractDigest) {
      throw new Error('已接受的任务要求尚未同步，请刷新任务后再次提交。')
    }
    const previous = run.frozenCandidate
    if (previous && previous.bundle.executionId === run.offer.executionId &&
        previous.contract.contractRevision === accepted.data.contractRevision &&
        previous.contract.contractDigest === accepted.data.contractDigest &&
        JSON.stringify(previous.contract) !== JSON.stringify(accepted.data)) {
      throw new Error('任务要求的原始记录不一致，请刷新任务后核验。')
    }
    return accepted.data
  }

  private async deliveryAdmission(run: CollaborationTaskRun) {
    if (run.executionMode === 'manual' && !run.runtimeId && !run.threadId) {
      return { revision: 0, recovery: 'ready' as const, receipts: [] }
    }
    return this.readSessionAdmission(requireRunSession(run))
  }

  private async readSessionAdmission(
    ref: Readonly<{ runtimeId: string; threadId: string }>
  ) {
    if (!this.options.agentExecution.readAdmission) return null
    return this.options.agentExecution.readAdmission(ref)
  }

  private async updateDeliveryDraft(run: CollaborationTaskRun, summary: string | null,
    turnId = latestObservedTurnId(run), ordinaryTurn = false, expectedInvocationId?: string): Promise<void> {
    await this.options.store.transact((state) => {
      const current = requireDraftRun(state.taskRuns, run.offer.executionId)
      if (TERMINAL_RUN_STATES.has(current.state) || current.state === 'submitting') return
      if (expectedInvocationId && current.agentJournal.at(-1)?.logicalInvocationId !== expectedInvocationId) return
      const previous = current.deliveryDraft ?? newDeliveryDraft(current, this.now().toISOString())
      if (turnId && previous.sourceTurnId === turnId) return
      const aiSummary = summary === null ? null : truncateDeliveryBundleSummary(summary)
      const sourceRound = current.agentJournal.findIndex((entry) => entry.turnId === turnId) + 1
      current.deliveryDraft = {
        ...previous, revision: previous.revision + 1,
        ...(aiSummary !== null ? previous.summaryEdited
          ? { aiSummary: aiSummary === previous.summary ? null : aiSummary }
          : { summary: aiSummary, aiSummary: null } : {}),
        sourceTurnId: turnId, sourceRound: sourceRound || previous.sourceRound + 1,
        sourceUpdatedAt: this.now().toISOString(), updatedAt: this.now().toISOString(),
        changed: ordinaryTurn || previous.changed || previous.sourceTurnId !== null ||
          previous.basedOnResultRevision !== null || previous.summaryEdited
      }
      Object.assign(current, { state: 'waiting-result-confirm', error: null,
        resultSummary: summary, humanAnswer: null, humanRequestId: null, updatedAt: this.now().toISOString() })
    })
  }

  async saveWorkerDeliveryDraft(raw: WorkerDeliveryDraftSaveInput, sourceChat?: Readonly<{ runtimeId: string; threadId: string; turnId: string }>): Promise<WorkerDeliveryView> {
    const input = workerDeliveryDraftSaveInputSchema.parse(raw)
    if (this.delivering.has(input.executionId)) throw new Error('交付正在封存，草稿只读。')
    const observed = this.requireRun(input.executionId)
    this.assertDraftEditable(observed, input)
    if (input.declaredMaterial) {
      await readDeliveryMaterials({ ...deliveryMaterialContext(observed), declaredMaterial: input.declaredMaterial,
        selectedMaterials: input.selectedMaterials ?? observed.deliveryDraft?.selectedMaterials ?? [] })
    } else if (input.selectedMaterials) {
      // Missing mandatory output must not prevent saving additional materials or a summary.
      await readDeliveryMaterials({ ...deliveryMaterialContext(observed), declared: null, declaredMaterial: null,
        selectedMaterials: input.selectedMaterials })
    }
    await this.options.store.transact((state) => {
      if (this.delivering.has(input.executionId)) throw new Error('交付正在封存，草稿只读。')
      const run = requireDraftRun(state.taskRuns, input.executionId)
      this.assertDraftEditable(run, input)
      const previous = run.deliveryDraft ?? newDeliveryDraft(run, this.now().toISOString())
      if (previous.revision !== input.expectedDraftRevision) throw new Error('草稿已有更新，请刷新后保留你的修改。')
      const summary = input.aiSummaryDecision === 'replace' ? previous.aiSummary ?? input.summary : input.summary
      const { sourceChat: previousSourceChat, declaredMaterial: previousDeclaredMaterial, ...previousDraft } = previous
      const draftSourceChat = sourceChat ?? (summary === previous.summary ? previousSourceChat : undefined)
      const declaredMaterial = input.declaredMaterial === undefined ? previousDeclaredMaterial
        : input.declaredMaterial && sourceChat && !input.declaredMaterial.relativePath.startsWith('.sciforge/uploads/')
          ? { ...input.declaredMaterial, source: 'ai' as const } : input.declaredMaterial
      run.deliveryDraft = { ...previousDraft, revision: previous.revision + 1, summary,
        ...(draftSourceChat ? { sourceChat: draftSourceChat } : {}),
        ...(declaredMaterial !== undefined ? { declaredMaterial } : {}),
        summaryEdited: input.aiSummaryDecision !== 'replace',
        aiSummary: input.aiSummaryDecision ? null : previous.aiSummary,
        selectedMaterials: input.selectedMaterials ?? previous.selectedMaterials,
        changed: previous.changed ||
          input.declaredMaterial !== undefined && JSON.stringify(input.declaredMaterial) !== JSON.stringify(previous.declaredMaterial) ||
          input.selectedMaterials !== undefined && JSON.stringify(input.selectedMaterials) !== JSON.stringify(previous.selectedMaterials),
        materialError: null,
        updatedAt: this.now().toISOString() }
      run.updatedAt = this.now().toISOString()
    })
    return this.refreshWorkerDelivery(input)
  }

  private assertDraftEditable(run: CollaborationTaskRun, input: WorkerDeliveryReadInput): void {
    if (run.offer.projectId !== input.projectId || run.offer.taskId !== input.taskId) {
      throw new Error('草稿与当前任务执行不匹配。')
    }
    if (TERMINAL_RUN_STATES.has(run.state) || run.authorityFencedAt || run.deliverySaga && run.deliverySaga.state !== 'returned') {
      throw new Error('交付已提交或正在封存，草稿只读。')
    }
  }

  async listWorkerDeliveryMaterials(input: WorkerDeliveryMaterialsInput): Promise<WorkerDeliveryMaterialsResult> {
    const run = this.requireRun(input.executionId)
    this.assertDraftEditable(run, input)
    return listDeliveryMaterials(deliveryMaterialContext(run), input)
  }

  async importWorkerDeliveryMaterial(raw: WorkerDeliveryMaterialImportInput) {
    const input = workerDeliveryMaterialImportInputSchema.parse(raw)
    const run = this.requireRun(input.executionId)
    const assertCurrent = () => {
      const current = this.requireRun(input.executionId)
      this.assertDraftEditable(current, input)
      if (this.delivering.has(input.executionId) || current.workspaceRoot !== run.workspaceRoot ||
          this.options.store.snapshot().user?.userId !== current.execution?.assigneeUserId ||
          current.execution?.assigneeAgentId !== this.options.localAgentId()) {
        throw new Error('只有当前电脑上的任务执行人可以导入交付文件。')
      }
    }
    assertCurrent()
    const kind = deliveryMaterialKind({ name: input.fileName })
    if (kind === 'unsupported') throw new Error('文件类型暂不支持，请选择支持的资料格式。')
    const limit = deliveryMaterialMaxBytes(kind)
    if (input.contentBase64.length > Math.ceil(limit / 3) * 4) throw new Error('文件超过资料大小限制。')
    const bytes = Buffer.from(input.contentBase64, 'base64')
    if (bytes.length > limit || bytes.toString('base64') !== input.contentBase64) throw new Error('文件内容或大小不符合要求。')
    validateDeliveryMaterialBytes({ name: input.fileName }, bytes)
    const identity = await readDeliveryWorkspaceIdentity(run.workspaceRoot)
    // A unique directory preserves the original name without overwriting a
    // previous upload. Human materials belong to the execution, not an AI chat.
    const relativePath = `materials/${randomUUID()}/${input.fileName}`
    const target = await resolveSafeWorkspaceWriteTarget(relativePath, run.workspaceRoot, { createParentDirectories: true })
    await readDeliveryWorkspaceIdentity(run.workspaceRoot, identity)
    assertCurrent()
    await writeSafeWorkspaceFile(target, bytes, { exclusive: true })
    await readDeliveryWorkspaceIdentity(run.workspaceRoot, identity)
    assertCurrent()
    return { file: { relativePath, fileName: input.fileName, byteCount: bytes.length,
      mediaType: deliveryMaterialMediaType({ name: input.fileName }), source: 'member' as const } }
  }

  async refreshWorkerDelivery(input: WorkerDeliveryReadInput): Promise<WorkerDeliveryView> {
    const run = this.findRun(input.executionId, input.taskId)
    if (!run || run.offer.projectId !== input.projectId) throw new Error('当前成员没有这个任务执行的交付草稿。')
    if (!this.delivering.has(run.offer.executionId) && !TERMINAL_RUN_STATES.has(run.state) && !run.deliverySaga && run.deliveryDraft) {
      let outputs = run.deliveryDraft.outputs
      let materialError: string | null = null
      try { outputs = (await readDeliveryMaterials(deliveryMaterialContext(run))).map(({ metadata }) => metadata) }
      catch (error) { materialError = error instanceof Error ? error.message : '提交文件不可用，请重新选择。' }
      await this.options.store.transact((state) => {
        const current = requireDraftRun(state.taskRuns, run.offer.executionId)
        if (this.delivering.has(current.offer.executionId) || !current.deliveryDraft || current.deliverySaga || TERMINAL_RUN_STATES.has(current.state) ||
            current.deliveryDraft.revision !== run.deliveryDraft?.revision) return
        if (JSON.stringify(current.deliveryDraft.outputs) === JSON.stringify(outputs) && current.deliveryDraft.materialError === materialError) return
        current.deliveryDraft.changed ||= current.deliveryDraft.outputs.length > 0
        current.deliveryDraft.outputs = outputs
        current.deliveryDraft.materialError = materialError
      })
    }
    return this.workerDeliveryView(input)
  }

  workerDeliveryView(input: WorkerDeliveryReadInput): WorkerDeliveryView {
    const run = this.findRun(input.executionId, input.taskId)
    if (!run || run.offer.projectId !== input.projectId) {
      throw new Error('The current user has no Worker delivery for this Task execution.')
    }
    const view = workerDeliveryViewForRun(run, this.interactions.listInteractions(input.projectId, input.taskId))
    const preparing = this.delivering.get(input.executionId)
    const followup = workerFollowupView(run.followups.at(-1), run.agentJournal.at(-1))
    const phase = run.deliverySaga?.state
    const submissionProgress = phase === 'staging' || phase === 'candidate' || phase === 'review' || phase === 'seal'
      ? phase : preparing
    return { ...view, ...(followup ? { followup } : {}), canCancelFailedSubmission: this.canCancelFailedSubmission(run), ...(submissionProgress && view.state !== 'sealed'
      ? { state: view.state === 'blocked' ? 'blocked' : 'submitting', submissionProgress } : {}),
      ...(this.hasParkedDeliveryValidationFailure(run) ? { error: '云端已拒绝这份交付的内容要求，重复重试不会解决。请撤回失败提交并继续编辑，修正文件类型或大小后重新确认提交。' } : {}) }
  }

  /** Disposes one preserved residual instruction; content is never auto-replayed. */
  async disposeWorkerResidual(input: WorkerDeliveryReadInput & Readonly<{
    interactionId: string
    disposition: 'copied_to_composer' | 'discarded'
  }>): Promise<WorkerDeliveryView> {
    const parsed = workerResidualDisposeInputSchema.parse(input)
    const run = this.requireRun(parsed.executionId)
    if (run.offer.projectId !== parsed.projectId || run.offer.taskId !== parsed.taskId) {
      throw new Error('Residual instruction does not belong to this Task execution.')
    }
    await this.options.store.transact((draft) => {
      const interaction = draft.taskInteractions.find((candidate) => (
        candidate.interactionId === parsed.interactionId
      ))
      if (!interaction || interaction.projectId !== parsed.projectId ||
          interaction.taskId !== parsed.taskId || interaction.executionId !== parsed.executionId) {
        throw new Error('The exact residual instruction was not found.')
      }
      if (interaction.disposition) return
      interaction.disposition = parsed.disposition
      interaction.updatedAt = this.now().toISOString()
    })
    return this.workerDeliveryView(parsed)
  }

  private hasParkedDeliveryValidationFailure(run: CollaborationTaskRun): boolean {
    return this.options.store.snapshot().outbox.some(entry =>
      entry.idempotencyKey === `idem_delivery.candidate.create.${run.deliverySaga?.operationId}` &&
      entry.body.candidateId === run.deliverySaga?.candidateId && isDeliveryCandidateValidationFailure(entry))
  }

  private cancellableDeliveryRows(run: CollaborationTaskRun, outbox: readonly CollaborationOutboxEntry[]): boolean {
    const saga = run.deliverySaga
    if (!saga || saga.manifest) return false
    const stages = outbox.filter(entry => entry.idempotencyKey.startsWith(`idem_object.stage.${saga.operationId}.`))
    const commands = outbox.filter(entry => entry.kind === 'delivery.command' &&
      (entry.body.candidateId === saga.candidateId || entry.body.operationId === saga.operationId))
    if (saga.state === 'staging') return stages.some(entry => entry.state === 'failed' && isObjectUploadLimit(entry)) &&
      stages.every(entry => entry.state === 'delivered' || entry.state === 'failed' && isObjectUploadLimit(entry)) && commands.length === 0
    return saga.state === 'candidate' && stages.length > 0 && stages.every(entry => entry.state === 'delivered') &&
      commands.length === 1 && commands.every(entry => entry.body.candidateId === saga.candidateId &&
        entry.idempotencyKey === `idem_delivery.candidate.create.${saga.operationId}` && isDeliveryCandidateValidationFailure(entry))
  }

  /** A cancellation settles only the exact definitive failure retained with its signed snapshot. */
  private isSettledCancelledDeliveryRow(run: CollaborationTaskRun, entry: CollaborationOutboxEntry): boolean {
    if (entry.state !== 'failed') return false
    return run.cancelledDeliveryAttempts.some(({ candidate, saga }) => {
      if (!this.matchesDeliveryAttempt(run, candidate, saga) || saga.manifest) return false
      if (entry.body.projectId !== run.offer.projectId || entry.body.taskId !== run.offer.taskId ||
          entry.body.executionId !== run.offer.executionId) return false
      if (entry.kind === 'delivery.stage' && entry.body.type === 'object.stage' &&
          saga.state === 'staging' && isObjectUploadLimit(entry)) {
        const files = [candidate.bundleFile, ...candidate.outputFiles]
        return files.some((file, index) => entry.idempotencyKey ===
          `idem_object.stage.${saga.operationId}.${index === 0 ? 'bundle' : `output.${index - 1}`}` &&
          entry.body.sha256 === file.sha256 && entry.body.byteCount === file.byteCount &&
          entry.body.mediaType === file.mediaType && entry.stageFile?.path === file.path &&
          entry.stageFile.sha256 === file.sha256 && entry.stageFile.byteCount === file.byteCount)
      }
      return saga.state === 'candidate' && isDeliveryCandidateValidationFailure(entry) &&
        entry.idempotencyKey === `idem_delivery.candidate.create.${saga.operationId}` &&
        entry.body.candidateId === candidate.candidateId && entry.body.bundleDigest === candidate.bundleDigest &&
        entry.body.contractRevision === candidate.bundle.contractRevision &&
        entry.body.resultRevision === candidate.bundle.resultRevision && entry.body.workerUserId === run.execution?.assigneeUserId
    })
  }

  private matchesDeliveryAttempt(run: CollaborationTaskRun, candidate: FrozenWorkerCandidate, saga: WorkerDeliverySaga): boolean {
    const bundle = candidate.bundle
    const target = { projectId: bundle.projectId, taskId: bundle.taskId, executionId: bundle.executionId,
      contractRevision: bundle.contractRevision, resultRevision: bundle.resultRevision,
      bundleDigest: candidate.bundleDigest, decision: 'approved' as const }
    const { deviceSignature, ...action } = saga.proof
    return bundle.schemaVersion === 2 && bundle.projectId === run.offer.projectId && bundle.taskId === run.offer.taskId &&
      bundle.executionId === run.offer.executionId && saga.candidateId === candidate.candidateId &&
      candidate.bundleDigest === frozenDeliveryBundleDigest(bundle) &&
      saga.operationId === `dop_${createHash('sha256').update(saga.proof.actionId).digest('hex').slice(0, 32)}` &&
      saga.proof.deviceSignature.userId === run.execution?.assigneeUserId &&
      saga.proof.deviceSignature.deviceId === run.execution?.assigneeDeviceId &&
      deviceSignature.purpose === 'worker-delivery-review' && deviceSignature.factRevision === bundle.resultRevision &&
      saga.proof.confirmedInputDigest === workerDeliveryConfirmationDigest(target) &&
      deviceSignature.canonicalPayloadDigest === workerDeliveryHumanActionFactDigest(target, action)
  }

  private assertUnregisteredDeliveryAttempt(run: CollaborationTaskRun, facts: TaskDeliveryFacts): void {
    const candidate = run.frozenCandidate
    const saga = run.deliverySaga
    const fail = () => { throw new Error('云端已登记交付或执行阶段已改变，不能撤回。') }
    if (!candidate || !saga || !this.matchesDeliveryAttempt(run, candidate, saga) ||
        requireExecution(run).state !== 'running' || facts.taskId !== run.offer.taskId) return fail()
    if (!facts.candidate && !facts.manifest) return
    // The latest Task facts retain r1 while a revision attempt r2 is still unregistered.
    // Accept only the exact locally sealed history targeted by the Cloud revision request.
    const history = run.deliveryHistory.find(({ manifest }) => manifest.deliveryManifestId === facts.manifest?.deliveryManifestId)
    const previous = facts.candidate
    const manifest = facts.manifest
    const revision = facts.revisionRequest
    if (!history || !previous || !manifest || !revision || previous.status !== 'sealed' ||
        previous.projectId !== run.offer.projectId || previous.taskId !== run.offer.taskId ||
        previous.executionId !== run.offer.executionId || manifest.projectId !== run.offer.projectId ||
        manifest.taskId !== run.offer.taskId || manifest.executionId !== run.offer.executionId ||
        previous.resultRevision >= candidate.bundle.resultRevision || manifest.resultRevision !== previous.resultRevision ||
        previous.candidateId !== history.candidate.candidateId || previous.candidateId === candidate.candidateId ||
        previous.resultRevision !== history.candidate.bundle.resultRevision ||
        previous.contractRevision !== history.candidate.bundle.contractRevision ||
        previous.workerUserId !== requireExecution(run).assigneeUserId ||
        previous.bundleDigest !== history.candidate.bundleDigest || manifest.bundleDigest !== previous.bundleDigest ||
        previous.bundleObjectId !== manifest.bundleObjectId ||
        JSON.stringify(previous.outputObjectIds) !== JSON.stringify(manifest.outputObjectIds) ||
        manifest.operationId === saga.operationId || JSON.stringify(manifest) !== JSON.stringify(history.manifest) ||
        revision.projectId !== run.offer.projectId || revision.taskId !== run.offer.taskId ||
        revision.executionId !== run.offer.executionId || revision.deliveryManifestId !== manifest.deliveryManifestId ||
        revision.executionRevision > requireExecution(run).revision) fail()
  }

  private canCancelFailedSubmission(run: CollaborationTaskRun): boolean {
    const saga = run.deliverySaga
    if (this.delivering.has(run.offer.executionId) || this.returningExecutions.has(run.offer.executionId) ||
        run.authorityFencedAt || run.state !== 'submitting' || !run.deliveryDraft || !run.frozenCandidate ||
        !saga || saga.manifest) return false
    return this.cancellableDeliveryRows(run, this.options.store.snapshot().outbox)
  }

  /** Cancels only an unregistered, parked upload; original bytes, proof and outbox remain evidence. */
  async cancelFailedWorkerDelivery(raw: WorkerDeliveryCancelInput): Promise<WorkerDeliveryView> {
    const input = workerDeliveryCancelInputSchema.parse(raw)
    let run = this.requireRun(input.executionId)
    if (run.offer.projectId !== input.projectId || run.offer.taskId !== input.taskId) throw new Error('交付与当前任务执行不匹配。')
    if (run.cancelledDeliveryAttempts.some(entry => entry.saga.operationId === input.operationId)) return this.workerDeliveryView(input)
    if (!this.canCancelFailedSubmission(run) || run.deliverySaga?.operationId !== input.operationId) throw new Error('仅可撤回已确定失败且云端尚未登记的上传限制或内容校验失败提交。')
    this.delivering.set(input.executionId, 'preparing')
    try {
      run = await this.restoreDeliverySaga(run, new AbortController().signal)
      const facts = await this.readTaskDeliveryFacts(input.taskId)
      this.assertUnregisteredDeliveryAttempt(run, facts)
      if (run.runtimeId && run.threadId) await this.options.agentExecution.releaseSubmission?.({
        runtimeId: run.runtimeId, threadId: run.threadId, operationId: input.operationId,
        targetDigest: run.frozenCandidate!.bundleDigest
      })
      await this.options.store.transact(state => {
        const current = requireDraftRun(state.taskRuns, input.executionId)
        const saga = current.deliverySaga
        const candidate = current.frozenCandidate
        if (current.state !== 'submitting' || current.authorityFencedAt || !saga || saga.operationId !== input.operationId ||
            saga.manifest || !candidate || !current.deliveryDraft ||
            requireExecution(current).state !== 'running' || state.projectUnavailableFences.some(f => f.projectId === input.projectId) ||
            !this.cancellableDeliveryRows(current, state.outbox)) {
          throw new Error('提交状态已变化，请刷新后重试。')
        }
        const now = this.now().toISOString()
        current.cancelledDeliveryAttempts.push({ candidate: structuredClone(candidate), saga: structuredClone(saga), cancelledAt: now })
        current.deliveryDraft = { ...current.deliveryDraft, revision: current.deliveryDraft.revision + 1,
          resultRevision: Math.max(current.deliveryDraft.resultRevision, candidate.bundle.resultRevision) + 1,
          basedOnResultRevision: candidate.bundle.resultRevision, changed: true, updatedAt: now }
        current.frozenCandidate = null
        current.deliverySaga = null
        current.state = 'waiting-result-confirm'
        current.error = null
        current.completedAt = null
        current.updatedAt = now
      })
      return this.workerDeliveryView(input)
    } finally { this.delivering.delete(input.executionId) }
  }

  /**
   * The one canonical Worker result path: barrier, exact human proof, then the
   * durable stage -> candidate -> review -> seal saga keyed by the human action.
   */
  async submitWorkerDelivery(raw: WorkerDeliverySubmitInput): Promise<WorkerDeliveryView> {
    const input = workerDeliverySubmitInputSchema.parse(raw)
    const executionId = input.target.executionId
    if (this.returningExecutions.has(executionId)) throw new Error('任务正在退回，不能提交交付。')
    if (this.delivering.has(executionId)) throw new Error('This Delivery operation is already in progress.')
    this.delivering.set(executionId, 'preparing')
    try { return await this.prepareWorkerDelivery(input) }
    finally { this.delivering.delete(executionId) }
  }

  private async prepareWorkerDelivery({ target }: WorkerDeliverySubmitInput): Promise<WorkerDeliveryView> {
    let run = this.requireRun(target.executionId)
    if (run.offer.projectId !== target.projectId || run.offer.taskId !== target.taskId) {
      throw new Error('Delivery confirmation does not match the local Worker execution.')
    }
    if (run.deliverySaga) {
      if (!run.frozenCandidate || workerDeliveryConfirmationDigest(target) !== workerDeliveryConfirmationDigest(
        confirmationTargetForBundle(run.frozenCandidate.bundle, run.frozenCandidate.bundleDigest))) throw new Error('交付已经封存为快照，不能更改本次提交内容。')
      if (run.deliverySaga.state === 'sealed') return this.workerDeliveryView(target)
      await this.continueDeliverySaga(run, this.deliveryDecision(run), true)
      return this.workerDeliveryView(target)
    }
    this.assertDraftEditable(run, target)
    const summary = run.deliveryDraft?.summary.trim()
    if (!summary) throw new Error('请填写结果说明。')
    if (!frozenDeliveryBundleSchema.shape.summary.safeParse(summary).success) throw new Error('结果说明不符合交付要求，请控制在 8000 字以内并移除私有会话信息。')
    if (target.decision !== 'approved') throw new Error('提交后内容不能更改，请使用任务的返修流程。')
    if (run.state === 'needs-human') throw new Error('请先回答任务需要补充的问题，再提交交付。')
    if (run.executionMode === 'unselected' || run.executionMode === 'manual' && requireExecution(run).state === 'accepted') {
      run = await this.updateRun(run.offer.executionId, { executionMode: 'manual' })
      const preflight = await this.refreshPreflight(run, true, new AbortController().signal)
      if (preflight.outcome !== 'allowed') throw new Error('当前任务执行权限不可用，请刷新后重试。')
      run = this.requireRun(run.offer.executionId)
      await this.acceptAndStart(run)
      run = this.requireRun(run.offer.executionId)
    }
    if (requireExecution(run).state !== 'running') throw new Error('任务尚未开始执行，暂时不能提交。')
    if (this.activeAgentTurns.has(target.executionId)) throw new Error('AI 正在修改，请等待完成后再提交。')
    const admission = await this.deliveryAdmission(run)
    if (!admission || admission.recovery !== 'ready') throw new Error('会话状态尚未恢复，暂时不能提交。')
    if (admission.receipts.some((receipt) => !(receipt.delivery === 'abandoned' ||
        receipt.delivery === 'delivered' && ['completed', 'failed', 'cancelled'].includes(receipt.execution)))) {
      throw new Error('会话仍有未完成或待核验的输入，请处理后再提交。')
    }
    const candidate = await this.freezeCandidate(run, summary, admission.revision, target)
    run = this.requireRun(target.executionId)
    // The Host receives the exact wrapped target shown by the confirmation UI.
    const action = this.options.humanActions.capture({ target })
    const lease = this.options.humanActions.validate({ target, action })
    this.delivering.set(target.executionId, 'signing')
    const deviceSignature = await this.options.signing.signDeviceFact({
      purpose: 'worker-delivery-review', factDigest: workerDeliveryHumanActionFactDigest(target, action),
      factRevision: target.resultRevision, observedAt: action.occurredAt
    }, { purpose: 'worker-delivery-review', target, action })
    lease.assertCurrent()
    const proof = workerDeliveryHumanActionProofSchema.parse({ ...action, deviceSignature })
    const operationId = `dop_${createHash('sha256').update(proof.actionId).digest('hex').slice(0, 32)}`
    await this.updateRun(target.executionId, { deliverySaga: { operationId, candidateId: candidate.candidateId,
      proof, state: 'prepared', manifest: null, error: null }, state: 'submitting' })
    await this.continueDeliverySaga(this.requireRun(target.executionId), target.decision)
    return this.workerDeliveryView(target)
  }

  private async continueDeliverySaga(
    run: CollaborationTaskRun,
    decision: WorkerDeliveryConfirmationTarget['decision'],
    explicitRetry = false
  ): Promise<void> {
    try {
      await this.runDeliverySaga(run, decision, explicitRetry)
    } catch (error) {
      const safe = safeError(error, this.options.sanitizeText)
      try {
        await this.updateRun(run.offer.executionId, {
          deliverySaga: this.requireDeliverySaga(run.offer.executionId, { error: safe })
        })
      } catch (checkpointError) {
        throw new AggregateError([error, checkpointError],
          `${safe}; Delivery checkpoint failed: ${safeError(checkpointError, this.options.sanitizeText)}`)
      }
      throw error
    }
  }

  private deliveryDecision(run: CollaborationTaskRun): WorkerDeliveryConfirmationTarget['decision'] {
    const saga = run.deliverySaga
    const candidate = run.frozenCandidate
    if (!saga || !candidate) throw new Error('The Delivery confirmation checkpoint is incomplete.')
    for (const decision of ['approved', 'returned'] as const) {
      if (saga.proof.confirmedInputDigest === workerDeliveryConfirmationDigest({
        projectId: run.offer.projectId, taskId: run.offer.taskId, executionId: run.offer.executionId,
        contractRevision: candidate.bundle.contractRevision, resultRevision: candidate.bundle.resultRevision,
        bundleDigest: candidate.bundleDigest, decision
      })) return decision
    }
    throw new Error('The saved human action does not confirm this exact Delivery candidate.')
  }

  private hasDeliveryRecovery(run: CollaborationTaskRun): boolean {
    const snapshot = this.options.store.snapshot()
    if (snapshot.projectUnavailableFences.some(({ projectId }) => projectId === run.offer.projectId)) return false
    if (TERMINAL_RUN_STATES.has(run.state) && !(run.state === 'fenced' &&
        run.execution?.state === 'result_submitted' && run.execution.fence.reason === 'result_submitted')) return false
    if (run.deliverySaga) return !['sealed', 'returned'].includes(run.deliverySaga.state)
    if (run.execution?.state !== 'result_submitted') return false
    return snapshot.outbox.some(({ body }) => body.type === 'delivery.candidate.create' &&
      body.executionId === run.offer.executionId && snapshot.outbox.some(({ body: review }) => (
        review.type === 'delivery.candidate.review' && review.candidateId === body.candidateId &&
        review.decision === 'approved'
      )))
  }

  private async restoreDeliverySaga(initial: CollaborationTaskRun, signal: AbortSignal): Promise<CollaborationTaskRun> {
    const preflight = await this.refreshPreflight(initial, true, signal)
    const run = this.requireRun(initial.offer.executionId)
    const { cloud } = preflight
    const execution = cloud.execution
    const authority = cloud.taskAuthorities.find(({ scope }) => (
      scope === (execution.fileIntent ? 'file_tasks' : 'text_tasks')
    ))
    if (preflight.reasons.includes('agent_inactive') || cloud.projectStatus !== 'active' || cloud.membership.state !== 'active' ||
        authority?.state !== 'eligible' || authority.authorityEpoch !== execution.fence.userTaskAuthorityEpoch ||
        cloud.projectExecutionAuthorityEpoch !== execution.fence.projectExecutionAuthorityEpoch ||
        cloud.currentExecutionId !== run.offer.executionId ||
        cloud.device.status !== 'active' || cloud.agent.lifecycleStatus !== 'active' ||
        execution.assigneeAgentId !== run.offer.recipientAgentId ||
        execution.assigneeAgentId !== this.options.localAgentId() ||
        execution.assigneeUserId !== cloud.agent.ownerUserId || execution.assigneeDeviceId !== cloud.device.deviceId ||
        run.task?.currentExecutionId !== run.offer.executionId ||
        !['running', 'result_submitted', 'completed'].includes(execution.state) ||
        (execution.state === 'running' ? execution.fence.status !== 'open' : execution.fence.reason !== execution.state)) {
      throw new Error('Delivery recovery is blocked by the current Cloud execution authority.')
    }
    let checkpoint = run.deliverySaga ? { frozenCandidate: run.frozenCandidate, deliverySaga: run.deliverySaga } : null
    if (!checkpoint) {
      const facts = await this.readTaskDeliveryFacts(run.offer.taskId)
      const candidate = deliveryCandidateSchema.parse(facts.candidate)
      checkpoint = await restoreWorkerDeliveryCheckpoint(run, candidate, this.options.store.snapshot().outbox)
    }
    return this.options.store.transact((draft) => {
      const current = requireDraftRun(draft.taskRuns, run.offer.executionId)
      if (draft.projectUnavailableFences.some(({ projectId }) => projectId === run.offer.projectId) ||
          (TERMINAL_RUN_STATES.has(current.state) && !(current.state === 'fenced' &&
            execution.state === 'result_submitted' && execution.fence.reason === 'result_submitted'))) {
        throw new Error('The Worker execution was fenced during Delivery recovery.')
      }
      Object.assign(current, checkpoint, { state: 'submitting', completedAt: null, error: null,
        updatedAt: this.now().toISOString() })
      return structuredClone(current)
    })
  }

  /** Drives the durable saga; every step is idempotent under the human-action operation. */
  private async runDeliverySaga(
    initial: CollaborationTaskRun,
    decision: WorkerDeliveryConfirmationTarget['decision'],
    explicitRetry: boolean
  ): Promise<void> {
    let run = initial
    const saga = run.deliverySaga
    const candidate = run.frozenCandidate
    if (!saga || !candidate) throw new Error('The Delivery saga lost its frozen candidate.')
    if (candidate.bundle.schemaVersion !== 2) throw new Error('旧版交付快照仅供查看，请使用返修流程准备新的交付。')
    const execution = requireExecution(run)
    const operationId = saga.operationId
    const facts = await this.readTaskDeliveryFacts(run.offer.taskId)
    this.assertDeliveryActive(run.offer.executionId, operationId)
    let cloudCandidate = facts.candidate && facts.candidate.executionId === run.offer.executionId &&
      facts.candidate.resultRevision === candidate.bundle.resultRevision
      ? deliveryCandidateSchema.parse(facts.candidate) : null
    const assertCandidate = () => {
      if (!cloudCandidate || cloudCandidate.candidateId !== candidate.candidateId ||
          cloudCandidate.projectId !== run.offer.projectId || cloudCandidate.taskId !== run.offer.taskId ||
          cloudCandidate.executionId !== run.offer.executionId || cloudCandidate.workerUserId !== execution.assigneeUserId ||
          cloudCandidate.contractRevision !== candidate.bundle.contractRevision ||
          cloudCandidate.resultRevision !== candidate.bundle.resultRevision || cloudCandidate.bundleDigest !== candidate.bundleDigest ||
          JSON.stringify(cloudCandidate.outputs.map(({ objectId: _objectId, ...descriptor }) => descriptor)) !== JSON.stringify(candidate.bundle.outputs)) {
        throw new Error('Cloud Delivery facts conflict with the exact frozen candidate.')
      }
    }
    if ((!cloudCandidate || cloudCandidate.status === 'private') && (run.runtimeId || run.threadId)) {
      await this.options.agentExecution.acquireSubmission?.({
        ...requireRunSession(run), operationId,
        expectedRevision: candidate.admissionRevision, targetDigest: candidate.bundleDigest
      })
    }
    if (!cloudCandidate) {
      run = await this.updateSagaState(run.offer.executionId, 'staging')
      const files = [candidate.bundleFile, ...candidate.outputFiles]
      const objectIds: string[] = []
      for (const [index, file] of files.entries()) {
        this.assertDeliveryActive(run.offer.executionId, operationId)
        const staged = await this.options.outbox.stageAndWait({
          protocolVersion: '1.0', requestId: collaborationRequestId(), type: 'object.stage',
          projectId: run.offer.projectId, taskId: run.offer.taskId, executionId: run.offer.executionId,
          mediaType: file.mediaType, sha256: file.sha256, byteCount: file.byteCount,
          idempotencyKey: `idem_object.stage.${operationId}.${index === 0 ? 'bundle' : `output.${index - 1}`}`
        }, file.path, { explicitRetry })
        objectIds.push(staged.object.objectId)
      }
      run = await this.updateSagaState(run.offer.executionId, 'candidate')
      const created = await this.options.outbox.enqueueAndWait('delivery.command', restRequestSchema.parse({
        protocolVersion: '1.0', requestId: collaborationRequestId(), type: 'delivery.candidate.create',
        idempotencyKey: `idem_delivery.candidate.create.${operationId}`,
        candidateId: candidate.candidateId, projectId: run.offer.projectId, taskId: run.offer.taskId,
        executionId: run.offer.executionId, workerUserId: execution.assigneeUserId,
        contractRevision: candidate.bundle.contractRevision, resultRevision: candidate.bundle.resultRevision,
        bundleDigest: candidate.bundleDigest, bundleObjectId: objectIds[0], outputObjectIds: objectIds.slice(1)
      }))
      const { type: _type, ...createdFacts } = requireResponseEntity(created, 'delivery_candidate')
      cloudCandidate = deliveryCandidateSchema.parse(createdFacts)
    }
    assertCandidate()
    const reviewedStatus = decision === 'approved' ? 'submitted' : 'returned'
    if (cloudCandidate!.status !== reviewedStatus && !(decision === 'approved' && cloudCandidate!.status === 'sealed')) {
      if (cloudCandidate!.status !== 'private' && !(decision === 'returned' && cloudCandidate!.status === 'submitted')) {
        throw new Error('The Cloud Delivery candidate can no longer accept this Worker decision.')
      }
      run = await this.updateSagaState(run.offer.executionId, decision === 'returned' ? 'returning' : 'review')
      const reviewed = await this.options.outbox.enqueueAndWait('delivery.command', restRequestSchema.parse({
        protocolVersion: '1.0', requestId: collaborationRequestId(), type: 'delivery.candidate.review',
        idempotencyKey: `idem_delivery.candidate.review.${operationId}${decision === 'returned' ? '.returned' : ''}`,
        candidateId: candidate.candidateId, resultRevision: candidate.bundle.resultRevision,
        bundleDigest: candidate.bundleDigest, humanAction: saga.proof, decision, reason: null
      }))
      const { type: _type, ...reviewedFacts } = requireResponseEntity(reviewed, 'delivery_candidate')
      cloudCandidate = deliveryCandidateSchema.parse(reviewedFacts)
      assertCandidate()
      if (cloudCandidate.status !== reviewedStatus) throw new Error('Cloud did not record the exact Worker Delivery review.')
    }
    this.assertDeliveryActive(run.offer.executionId, operationId)
    if (decision === 'returned') {
      if (run.runtimeId && run.threadId) await this.options.agentExecution.releaseSubmission?.({
        runtimeId: run.runtimeId,
        threadId: run.threadId!,
        operationId,
        targetDigest: candidate.bundleDigest
      })
      await this.updateRun(run.offer.executionId, {
        state: 'running',
        frozenCandidate: { ...candidate, dirty: true },
        deliverySaga: this.requireDeliverySaga(run.offer.executionId, { state: 'returned' }),
        error: null
      })
      return
    }
    run = await this.updateSagaState(run.offer.executionId, 'seal')
    const manifest = facts.manifest && cloudCandidate!.status === 'sealed'
      ? deliveryManifestSchema.parse(facts.manifest)
      : deliveryManifestSchema.parse(requireResponseEntity(
        await this.options.outbox.enqueueAndWait('delivery.command', restRequestSchema.parse({
          protocolVersion: '1.0', requestId: collaborationRequestId(), type: 'delivery.manifest.seal',
          idempotencyKey: `idem_delivery.manifest.seal.${operationId}`,
          candidateId: candidate.candidateId, operationId, contract: candidate.contract,
          verificationEvidence: ['Worker User confirmed the current explanation and selected files as an immutable snapshot.']
        })), 'delivery_manifest'))
    this.assertDeliveryActive(run.offer.executionId, operationId)
    if (manifest.operationId !== operationId || manifest.projectId !== run.offer.projectId ||
        manifest.taskId !== run.offer.taskId || manifest.executionId !== run.offer.executionId ||
        manifest.resultRevision !== candidate.bundle.resultRevision ||
        manifest.bundleDigest !== candidate.bundleDigest ||
        manifest.workerDecision !== 'approved' ||
        JSON.stringify(manifest.outputs?.map(({ objectId: _objectId, ...descriptor }) => descriptor)) !== JSON.stringify(candidate.bundle.outputs)) {
      throw new Error('Cloud did not seal the exact reviewed Delivery candidate.')
    }
    if (run.runtimeId && run.threadId) await this.options.agentExecution.releaseSubmission?.({
      runtimeId: run.runtimeId,
      threadId: run.threadId!,
      operationId,
      targetDigest: candidate.bundleDigest
    })
    const completedAt = manifest.sealedAt
    await this.updateRun(run.offer.executionId, {
      state: 'completed',
      completedAt,
      deliverySaga: this.requireDeliverySaga(run.offer.executionId, { state: 'sealed', manifest }),
      deliveryHistory: [...run.deliveryHistory.filter((entry) => entry.candidate.candidateId !== candidate.candidateId), { candidate, manifest }],
      error: null
    })
    await this.publishAvailability('online')
  }

  private async updateSagaState(
    executionId: string,
    state: WorkerDeliverySaga['state']
  ): Promise<CollaborationTaskRun> {
    this.assertDeliveryActive(executionId, this.requireDeliverySaga(executionId, {}).operationId)
    return this.updateRun(executionId, {
      deliverySaga: this.requireDeliverySaga(executionId, { state, error: null })
    })
  }

  private assertDeliveryActive(executionId: string, operationId: string): void {
    const current = this.requireRun(executionId)
    if (current.state !== 'submitting' || current.deliverySaga?.operationId !== operationId ||
        this.options.store.snapshot().projectUnavailableFences.some(({ projectId }) => projectId === current.offer.projectId)) {
      throw new Error('The Worker Delivery operation is fenced or no longer current.')
    }
  }

  private requireDeliverySaga(
    executionId: string,
    update: Partial<WorkerDeliverySaga>
  ): WorkerDeliverySaga {
    const current = this.requireRun(executionId).deliverySaga
    if (!current) throw new Error('The Delivery saga checkpoint is missing before its next step.')
    return workerDeliverySagaSchema.parse({ ...current, ...update })
  }

  private async rejectPendingOffer(pending: CollaborationPendingTaskOffer): Promise<void> {
    const requestFacts = {
      taskOfferId: pending.taskOfferId,
      taskId: pending.taskId,
      expectedTaskRevision: pending.currentTaskRevision,
      expectedOfferRevision: pending.offerRevision
    }
    const original = this.options.store.snapshot().outbox.find(({ kind, body }) =>
      kind === 'task.offer-decision' && body.type === 'task.offer.reject' && body.taskOfferId === pending.taskOfferId)
    const replay = original ? await this.options.outbox.resumeAndWait('task.offer-decision', original.idempotencyKey,
      (request) => {
        if (request.type !== 'task.offer.reject' || request.taskOfferId !== pending.taskOfferId ||
            request.taskId !== pending.taskId || request.expectedTaskRevision !== pending.currentTaskRevision ||
            request.expectedOfferRevision !== pending.offerRevision) {
          throw new Error('Durable rejection does not match this exact Human decision.')
        }
      }) : null
    const response = replay?.response ?? await this.options.outbox.enqueueAndWait('task.offer-decision',
      restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: collaborationRequestId(),
        type: 'task.offer.reject',
        idempotencyKey: idempotencyKey('task.offer.reject', requestFacts),
        ...requestFacts
      }))
    if (response.type === 'rest.error') throw new OfferDecisionRejectedError(response.error.message)
    if (response.type !== 'rest.collection') {
      throw new Error(`Task offer rejection returned unexpected ${response.type}.`)
    }
    const task = response.items.find((item): item is Task => item.type === 'task')
    const offer = response.items.find((item): item is TaskOffer => item.type === 'task_offer')
    if (
      response.items.length !== 2 || !task || !offer ||
      task.taskId !== pending.taskId || task.projectId !== pending.projectId ||
      task.revision !== pending.currentTaskRevision + 1 ||
      task.status !== 'revision_requested' || task.currentExecutionId !== null ||
      offer.taskOfferId !== pending.taskOfferId || offer.projectId !== pending.projectId ||
      offer.taskId !== pending.taskId || offer.workerUserId !== pending.workerUserId ||
      offer.revision !== pending.offerRevision + 1 || offer.executionId !== null ||
      offer.state !== 'rejected'
    ) {
      throw new Error('Task offer rejection did not return the exact User-level closure.')
    }
    const completedAt = this.now().toISOString()
    await this.updatePendingOffer(pending.taskOfferId, {
      state: 'closed',
      closedOutcome: 'rejected',
      currentTaskRevision: task.revision,
      offerRevision: offer.revision,
      completedAt,
      error: 'The Worker User rejected the Task offer.'
    }, task)
  }

  private async createHumanNeeded(
    run: CollaborationTaskRun,
    question: string,
    requiredAssurance: 'verified' | 'strong',
    signal: AbortSignal
  ): Promise<void> {
    const expiresAt = new Date(this.now().getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString()
    const requestFacts = {
      projectId: run.offer.projectId,
      targetUserId: requireExecution(run).assigneeUserId,
      context: {
        scope: 'worker_execution' as const,
        taskId: run.offer.taskId,
        executionId: run.offer.executionId,
        expectedTaskRevision: run.expectedTaskRevision,
        expectedExecutionRevision: run.expectedExecutionRevision
      },
      requiredAssurance,
      prompt: question,
      interaction: { kind: 'clarification' as const },
      confirmableAction: null,
      expiresAt
    }
    const pending = await this.updateRun(run.offer.executionId, { state: 'needs-human' })
    if (pending.state !== 'needs-human') return
    const response = await this.options.outbox.enqueueAndWait('task.human-needed',
      restRequestSchema.parse({
        protocolVersion: '1.0', requestId: collaborationRequestId(),
        type: 'human.needed.create',
        idempotencyKey: idempotencyKey('human.needed.create', requestFacts),
        ...requestFacts
      }))
    await this.updateRun(run.offer.executionId, {
      humanRequestId: requireResponseEntity(response, 'human_needed').humanRequestId,
      humanAnswer: null,
      state: 'needs-human'
    })
    await this.refreshPreflight(this.requireRun(run.offer.executionId), true, signal)
  }

  private async acceptHumanAnswer(answer: HumanAnswer, recipientAgentId: string): Promise<void> {
    if (answer.context.scope !== 'worker_execution') return
    const executionId = answer.context.executionId
    let run = this.findRun(executionId)
    if (!run) return
    if (TERMINAL_RUN_STATES.has(run.state)) return
    // The needs-human exchange already concluded; a duplicate or late answer
    // for the completed result is idempotent, never a state error.
    if (run.state === 'waiting-result-confirm' || run.state === 'submitting' || run.deliverySaga) return
    if (run.humanRequestId === null) {
      await this.recoverHumanRequestId(run, answer)
      run = this.requireRun(executionId)
    }
    if (
      run.offer.projectId !== answer.projectId ||
      run.offer.taskId !== answer.context.taskId ||
      run.offer.recipientAgentId !== recipientAgentId ||
      run.humanRequestId !== answer.humanRequestId
    ) {
      throw new Error('Human answer does not match the pending Worker execution.')
    }
    if (run.humanAnswer?.humanAnswerId === answer.humanAnswerId) return
    if (run.state !== 'needs-human') {
      throw new Error('Human answer arrived outside the pending Worker HumanNeeded state.')
    }
    await this.updateRun(executionId, { humanAnswer: answer, state: 'running', error: null })
    this.scheduleAfterCurrent(executionId)
  }

  private async recoverHumanRequestId(
    run: CollaborationTaskRun,
    answer: HumanAnswer
  ): Promise<void> {
    let recoveredHumanRequestId: string | null = null
    for (const entry of this.options.store.snapshot().outbox) {
      if (entry.kind !== 'task.human-needed' || entry.state !== 'delivered' || !entry.response) continue
      const request = restRequestSchema.safeParse(entry.body)
      const response = restResponseSchema.safeParse(entry.response)
      if (
        !request.success || request.data.type !== 'human.needed.create' ||
        request.data.projectId !== run.offer.projectId ||
        request.data.context.scope !== 'worker_execution' ||
        request.data.context.taskId !== run.offer.taskId ||
        request.data.context.executionId !== run.offer.executionId ||
        !response.success || response.data.type !== 'rest.entity' ||
        response.data.requestId !== request.data.requestId ||
        response.data.entity.type !== 'human_needed' ||
        response.data.entity.humanRequestId !== answer.humanRequestId ||
        response.data.entity.projectId !== run.offer.projectId ||
        response.data.entity.context.scope !== 'worker_execution' ||
        response.data.entity.context.taskId !== run.offer.taskId ||
        response.data.entity.context.executionId !== run.offer.executionId ||
        response.data.entity.requestedByAgentId !== run.offer.recipientAgentId ||
        response.data.entity.targetUserId !== answer.answeredByUserId
      ) continue
      recoveredHumanRequestId = response.data.entity.humanRequestId
      break
    }
    if (recoveredHumanRequestId) {
      await this.updateRun(run.offer.executionId, { humanRequestId: recoveredHumanRequestId })
    }
  }

  /**
   * Whether a completed Worker result must wait for explicit human
   * confirmation before it is submitted to the Cloud Coordinator. Defaults
   * off to preserve current behaviour; teams enabling the confirmation gate
   * flip this constant (or wire it to a setting) and Worker UI surfaces a
   * "confirm and submit" action. See COLLAB-007.
   */
  private async failExecution(
    run: CollaborationTaskRun,
    safeFailureCode: string,
    safeMessage: string,
    returnedByWorker = false
  ): Promise<void> {
    if (TERMINAL_RUN_STATES.has(run.state) && !returnedByWorker) return
    if (requireExecution(run).fence.status === 'fenced') {
      await this.markFenced(run, safeMessage)
      return
    }
    const failedAt = returnedByWorker && run.completedAt ? run.completedAt : this.now().toISOString()
    const failing = await this.updateRun(run.offer.executionId, {
      error: safeMessage.slice(0, 4_000)
    })
    if (TERMINAL_RUN_STATES.has(failing.state) && !returnedByWorker) return
    const requestFacts = {
      taskId: run.offer.taskId,
      executionId: run.offer.executionId,
      expectedTaskRevision: run.expectedTaskRevision,
      expectedExecutionRevision: run.expectedExecutionRevision,
      safeFailureCode: normalizeSafeCode(safeFailureCode),
      safeMessage: safeMessage.slice(0, 500),
      failedAt
    }
    const response = await this.options.outbox.enqueueAndWait('task.failed',
      restRequestSchema.parse({
        protocolVersion: '1.0', requestId: collaborationRequestId(),
        type: 'task.execution.fail',
        idempotencyKey: idempotencyKey('task.execution.fail', requestFacts),
        ...requestFacts
      }))
    const failed = requireTaskExecutionBundle(response)
    await this.updateRun(run.offer.executionId, {
      task: failed.task,
      execution: failed.execution,
      expectedTaskRevision: failed.task.revision,
      expectedExecutionRevision: failed.execution.revision,
      ...(returnedByWorker ? {} : { state: 'failed' as const }), completedAt: failedAt,
      error: safeMessage.slice(0, 4_000)
    })
    await this.publishAvailability('online')
  }

  private async refreshPreflight(
    run: CollaborationTaskRun,
    allowRevisionReconcile: boolean,
    signal: AbortSignal
  ): Promise<CollaborationWorkerPreflight> {
    throwIfSignalAborted(signal)
    const response = await this.options.connection.executeAsAgent(restRequestSchema.parse({
      protocolVersion: '1.0', requestId: collaborationRequestId(),
      type: 'task.execution.preflight.get',
      taskId: run.offer.taskId,
      executionId: run.offer.executionId,
      expectedTaskRevision: run.expectedTaskRevision,
      expectedExecutionRevision: run.expectedExecutionRevision
    }))
    throwIfSignalAborted(signal)
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.task_execution_preflight') {
      throw new Error(`Task preflight returned unexpected ${response.type}.`)
    }
    const cloud = response.preflight
    const task = await this.readTask(run.offer.taskId)
    throwIfSignalAborted(signal)
    const reasons: Array<
      'cloud_denied' |
      'runtime_not_ready' |
      'capability_unavailable' |
      'agent_inactive' |
      'execution_mismatch'
    > = []
    if (cloud.decision.outcome === 'denied') reasons.push('cloud_denied')
    const localAgent = this.options.store.snapshot().agents.find((agent) => (
      agent.agentId === run.offer.recipientAgentId
    ))
    if (!localAgent || localAgent.lifecycleStatus !== 'active') reasons.push('agent_inactive')
    const runtime = run.executionMode === 'manual' ? null : await this.options.agentExecution.runtimeReadiness?.().catch(() => null)
    if (run.executionMode !== 'manual' && runtime?.state !== 'ready') reasons.push('runtime_not_ready')
    else if (runtime?.state === 'ready' && !capabilityRequirementsSatisfied(
      task.requiredCapabilityTags,
      runtime.capabilityTags
    )) {
      reasons.push('capability_unavailable')
    }
    throwIfSignalAborted(signal)
    if (
      cloud.execution.executionId !== run.offer.executionId ||
      cloud.execution.assigneeAgentId !== run.offer.recipientAgentId ||
      cloud.execution.assigneeAgentId !== this.options.localAgentId() ||
      cloud.execution.assigneeUserId !== localAgent?.ownerUserId ||
      cloud.execution.assigneeDeviceId !== localAgent?.deviceId ||
      task.currentExecutionId !== run.offer.executionId ||
      cloud.execution.fence.status !== 'open'
    ) reasons.push('execution_mismatch')
    let uniqueReasons = [...new Set(reasons)]
    let local: CollaborationWorkerPreflight = {
      cloud,
      outcome: uniqueReasons.length === 0 ? 'allowed' as const : 'denied' as const,
      reasons: uniqueReasons,
      contentTransferReadiness: [],
      evaluatedAt: this.now().toISOString()
    }
    await this.updateRun(run.offer.executionId, {
      task,
      execution: cloud.execution,
      latestPreflight: local,
      expectedTaskRevision: cloud.currentTaskRevision,
      expectedExecutionRevision: cloud.execution.revision,
      error: uniqueReasons.length ? `Preflight denied: ${uniqueReasons.join(', ')}` : null
    })
    throwIfSignalAborted(signal)
    const revisionOnlyDenial = cloud.decision.outcome === 'denied' &&
      cloud.decision.reasons.length > 0 &&
      cloud.decision.reasons.every((reason) => (
        reason === 'task_revision_mismatch' || reason === 'execution_revision_mismatch'
      ))
    if (allowRevisionReconcile && revisionOnlyDenial) {
      return this.refreshPreflight(this.requireRun(run.offer.executionId), false, signal)
    }
    return local
  }

  private async ensureResources(run: CollaborationTaskRun): Promise<void> {
    const fileIntent = requireExecution(run).fileIntent
    if (!fileIntent) return
    const expected = fileIntent.inputs.map(({ resourceRefId }, ordinal) => ({
      resourceRefId,
      ordinal
    }))
    const current = new Map(run.resources.map((resource) => [resource.resourceRefId, resource]))
    for (const expectation of expected) {
      const { resourceRefId } = expectation
      const response = await this.options.connection.executeAsAgent(restRequestSchema.parse({
        protocolVersion: '1.0', requestId: collaborationRequestId(),
        type: 'resource.get', resourceRefId
      }))
      if (response.type === 'rest.error') throw new Error(response.error.message)
      if (response.type !== 'rest.entity' || response.entity.type !== 'resource_ref') {
        throw new Error(`ResourceRef query returned unexpected ${response.type}.`)
      }
      const resource = cloudResourceRefSchema.parse(response.entity)
      if (
        resource.projectId !== run.offer.projectId ||
        resource.taskId !== run.offer.taskId ||
        resource.executionId !== run.offer.executionId ||
        resource.assignmentTaskRevision !== fileIntent.assignmentTaskRevision ||
        resource.intentDigest !== fileIntent.declarationDigest ||
        resource.role !== 'input-file' ||
        resource.ordinal !== expectation.ordinal ||
        resource.locatorDigest !== digest(canonicalJson(resource.locator)) ||
        resource.status !== 'available'
      ) throw new Error('ResourceRef does not match the exact current execution fence.')
      current.set(resourceRefId, resource)
    }
    await this.updateRun(run.offer.executionId, {
      resources: expected.map(({ resourceRefId }) => current.get(resourceRefId)!)
    })
  }

  private async acceptCloudStateEvent(event: CloudStateEvent): Promise<void> {
    if (event.type === 'task.execution.changed') {
      const run = this.findRun(event.executionId)
      if (!run || TERMINAL_RUN_STATES.has(run.state)) return
      await this.updateRun(event.executionId, {
        expectedExecutionRevision: Math.max(run.expectedExecutionRevision, event.revision)
      })
      if (event.state === 'result_submitted' ||
          (event.state === 'completed' && this.hasDeliveryRecovery(run))) {
        this.schedule(event.executionId)
        return
      }
      if (TERMINAL_EXECUTION_EVENT_STATES.has(event.state)) {
        await this.markFenced(
          this.requireRun(event.executionId),
          `Cloud execution entered terminal state ${event.state}.`
        )
        return
      }
      this.schedule(event.executionId)
      return
    }
    if (!('projectId' in event)) return
    for (const run of this.options.store.snapshot().taskRuns) {
      if (run.offer.projectId === event.projectId && !TERMINAL_RUN_STATES.has(run.state)) {
        if (
          event.type === 'project.membership.changed' &&
          event.userId === run.execution?.assigneeUserId &&
          event.state !== 'active'
        ) {
          await this.markFenced(run, `Project membership entered state ${event.state}.`)
          continue
        }
        this.schedule(run.offer.executionId)
      }
    }
  }

  private async applyTerminalExecution(run: CollaborationTaskRun, execution: TaskExecution): Promise<void> {
    const now = this.now().toISOString()
    if (['failed', 'cancelled', 'revoked', 'superseded', 'manual_recovery_required'].includes(execution.state)) {
      await this.updateRun(run.offer.executionId, {
        execution,
        state: execution.state === 'failed' ? 'failed' : 'fenced',
        completedAt: now,
        error: `Cloud execution is ${execution.state}.`
      })
    }
    await this.publishAvailability('online')
  }

  private async markFenced(run: CollaborationTaskRun, error: string): Promise<void> {
    if (TERMINAL_RUN_STATES.has(this.requireRun(run.offer.executionId).state)) return
    await this.updateRun(run.offer.executionId, {
      state: 'fenced', completedAt: this.now().toISOString(), error: error.slice(0, 4_000)
    })
    this.controllers.get(run.offer.executionId)?.abort(error)
    await this.publishAvailability('online')
  }

  private async recordLateOutcome(
    source: 'agent_runtime' | 'content_space' | 'cloud',
    executionId: string,
    logicalInvocationId: string,
    outcome: 'completed_after_fence' | 'failed_after_fence' | 'outcome_unknown',
    detail: unknown
  ): Promise<void> {
    const observedAt = this.now().toISOString()
    await this.options.store.transact((draft) => {
      const run = requireDraftRun(draft.taskRuns, executionId)
      if (run.lateOutcomes.some((candidate) => (
        candidate.source === source &&
        candidate.logicalInvocationId === logicalInvocationId &&
        candidate.outcome === outcome
      ))) return
      run.lateOutcomes.push({
        source, logicalInvocationId, outcome, observedAt,
        safeDetail: safeError(detail, this.options.sanitizeText)
      })
      run.updatedAt = observedAt
    })
  }

  private async readTask(taskId: string): Promise<Task> {
    const response = await this.options.connection.executeAsAgent(restRequestSchema.parse({
      protocolVersion: '1.0', requestId: collaborationRequestId(), type: 'task.get', taskId
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.entity' || response.entity.type !== 'task') {
      throw new Error(`Task query returned unexpected ${response.type}.`)
    }
    // Strict new-write decode: a legacy-only Task cannot drive new execution work.
    return taskSchema.parse(response.entity)
  }

  private findRun(executionId: string | undefined, taskId?: string): CollaborationTaskRun | undefined {
    const candidates = this.options.store.snapshot().taskRuns.filter((run) => (
      (!executionId || run.offer.executionId === executionId) &&
      (!taskId || run.offer.taskId === taskId)
    ))
    if (executionId) return candidates.find((run) => run.offer.executionId === executionId)
    return candidates.find((run) => run.task?.currentExecutionId === run.offer.executionId) ??
      [...candidates].sort((left, right) => left.updatedAt.localeCompare(right.updatedAt)).at(-1)
  }

  private findPendingOffer(taskOfferId: string): CollaborationPendingTaskOffer | undefined {
    return this.options.store.snapshot().pendingTaskOffers.find((offer) => offer.taskOfferId === taskOfferId)
  }

  private requirePendingOffer(taskOfferId: string): CollaborationPendingTaskOffer {
    const offer = this.findPendingOffer(taskOfferId)
    if (!offer) throw new Error('Local pending Task offer was not found.')
    return offer
  }

  private async updatePendingOffer(
    taskOfferId: string,
    update: Partial<CollaborationPendingTaskOffer>,
    task?: Task,
    expectedState?: CollaborationPendingTaskOffer['state']
  ): Promise<CollaborationPendingTaskOffer> {
    return this.options.store.transact((draft) => {
      const offer = draft.pendingTaskOffers.find((candidate) => candidate.taskOfferId === taskOfferId)
      if (!offer) throw new Error('Local pending Task offer was not found.')
      if (expectedState !== undefined && offer.state !== expectedState) {
        return structuredClone(offer)
      }
      if (
        TERMINAL_PENDING_OFFER_STATES.has(offer.state) &&
        update.state !== undefined &&
        update.state !== offer.state &&
        // A definitive Inbox closure can resolve a local failed claim. It may
        // never revive a closed offer or authorize another acceptance.
        !(offer.state === 'failed' && (update.state === 'closed' || update.state === 'claimed_elsewhere'))
      ) return structuredClone(offer)
      Object.assign(offer, update, { updatedAt: this.now().toISOString() })
      if (task) {
        draft.tasks = [...draft.tasks.filter((candidate) => candidate.taskId !== task.taskId), task]
      }
      return structuredClone(offer)
    })
  }

  private requireRun(executionId: string): CollaborationTaskRun {
    const run = this.findRun(executionId)
    if (!run) throw new Error('Local Worker execution journal was not found.')
    return run
  }

  private async updateRun(
    executionId: string,
    update: Partial<CollaborationTaskRun>
  ): Promise<CollaborationTaskRun> {
    return this.options.store.transact((draft) => {
      const run = requireDraftRun(draft.taskRuns, executionId)
      if (run.authorityFencedAt && update.state !== undefined && !TERMINAL_RUN_STATES.has(update.state)) {
        return structuredClone(run)
      }
      if (
        TERMINAL_RUN_STATES.has(run.state) &&
        update.state !== undefined &&
        update.state !== run.state &&
        !(run.state === 'manual-recovery' && (
          update.state === 'completed' || update.state === 'fenced'
        )) &&
        // An Owner Delivery revision request reopens the same sealed Execution.
        !(run.state === 'completed' && update.state === 'waiting-result-confirm' && update.executionMode === 'unselected')
      ) return structuredClone(run)
      Object.assign(run, update, { updatedAt: this.now().toISOString() })
      if (TERMINAL_RUN_STATES.has(run.state) || run.state === 'needs-human' || run.executionMode === 'manual') {
        for (const followup of run.followups) {
          if (['waiting', 'dispatching'].includes(followup.state)) {
            followup.state = 'cancelled'
            followup.reason = '任务已停止、转为人工处理或等待本人回答；旧复查不再执行。'
          }
        }
        this.followupWakeups.get(executionId)?.()
        this.followupWakeups.delete(executionId)
      }
      if (run.task) {
        draft.tasks = [...draft.tasks.filter((task) => task.taskId !== run.task!.taskId), run.task]
      }
      return structuredClone(run)
    })
  }

  private async updateAgentJournal(
    executionId: string,
    logicalInvocationId: string,
    update: Record<string, unknown>
  ): Promise<void> {
    await this.options.store.transact((draft) => {
      const run = requireDraftRun(draft.taskRuns, executionId)
      const entry = run.agentJournal.find((item) => item.logicalInvocationId === logicalInvocationId)
      if (!entry) throw new Error('Agent invocation journal entry was not found.')
      Object.assign(entry, update)
      run.updatedAt = this.now().toISOString()
    })
  }
}

function requireDraftRun(runs: CollaborationTaskRun[], executionId: string): CollaborationTaskRun {
  const run = runs.find((item) => item.offer.executionId === executionId)
  if (!run) throw new Error('Local Worker execution journal was not found.')
  return run
}

function requireTask(run: CollaborationTaskRun): Task {
  if (!run.task) throw new Error('Worker run is missing its canonical Task snapshot.')
  return run.task
}

function requireExecution(run: CollaborationTaskRun): TaskExecution {
  if (!run.execution) throw new Error('Worker run is missing its canonical execution snapshot.')
  return run.execution
}

function requireAgentJournal(
  run: CollaborationTaskRun,
  logicalInvocationId: string
): CollaborationTaskRun['agentJournal'][number] {
  const journal = run.agentJournal.find((item) => item.logicalInvocationId === logicalInvocationId)
  if (!journal) throw new Error('Agent invocation journal entry was not found.')
  return journal
}

function requireResponseEntity<Type extends RestEntity['type']>(
  response: RestResponse,
  type: Type
): Extract<RestEntity, { type: Type }> {
  if (response.type !== 'rest.entity' || response.entity.type !== type) {
    throw new Error(`Cloud command returned unexpected ${response.type}; expected ${type}.`)
  }
  return response.entity as Extract<RestEntity, { type: Type }>
}

function requireTaskExecutionBundle(response: RestResponse): Readonly<{
  task: Task
  execution: TaskExecution
}> {
  if (
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== 2
  ) {
    throw new Error(`Cloud command returned unexpected ${response.type}; expected Task/Execution bundle.`)
  }
  const [task, execution] = response.items
  if (task?.type !== 'task' || execution?.type !== 'task_execution') {
    throw new Error('Cloud command returned a malformed Task/Execution bundle.')
  }
  return { task: taskSchema.parse(task), execution: taskExecutionSchema.parse(execution) }
}

/**
 * The Delivery report budget is 8000 Unicode code points; surrogate pairs are
 * never split, so an astral-heavy summary still fits the 16000-unit schema cap.
 */
function truncateDeliveryBundleSummary(value: string): string {
  return [...value].slice(0, 8_000).join('')
}

function requireRunSession(run: CollaborationTaskRun): Readonly<{ runtimeId: string; threadId: string }> {
  if (!run.runtimeId || !run.threadId) {
    throw new Error('The Worker execution has no durable Runtime Session binding.')
  }
  return { runtimeId: run.runtimeId, threadId: run.threadId }
}

function latestObservedTurnId(run: CollaborationTaskRun): string | null {
  const latest = [...run.agentJournal].reverse().find((entry) => (
    entry.state === 'observed_success' && entry.turnId
  ))
  return latest?.turnId ?? null
}

function deliveryBundleForDraft(run: CollaborationTaskRun, summary: string, outputs: FrozenDeliveryBundle['outputs']): FrozenDeliveryBundle {
  const execution = requireExecution(run)
  return frozenDeliveryBundleSchema.parse({ schemaVersion: 2, projectId: run.offer.projectId,
    taskId: run.offer.taskId, executionId: run.offer.executionId,
    contractRevision: run.offer.contractRevision ?? execution.contractRevision,
    resultRevision: run.deliveryDraft?.resultRevision ?? nextDeliveryRevision(run), summary, outputs })
}

function confirmationTargetForBundle(bundle: FrozenDeliveryBundleHistory, knownDigest?: string): WorkerDeliveryConfirmationTarget {
  return { projectId: bundle.projectId, taskId: bundle.taskId, executionId: bundle.executionId,
    contractRevision: bundle.contractRevision, resultRevision: bundle.resultRevision,
    bundleDigest: knownDigest ?? frozenDeliveryBundleDigest(frozenDeliveryBundleSchema.parse(bundle)), decision: 'approved' }
}

function computedDraftTarget(run: CollaborationTaskRun): WorkerDeliveryConfirmationTarget | null {
  const draft = run.deliveryDraft
  if (!draft?.summary.trim() || draft.materialError || requireExecution(run).fileIntent && !draft.outputs.some(({ role }) => role === 'declared')) return null
  try { return confirmationTargetForBundle(deliveryBundleForDraft(run, draft.summary.trim(), draft.outputs)) }
  catch { return null }
}

function nextDeliveryRevision(run: CollaborationTaskRun): number {
  return Math.max(0, ...run.cancelledDeliveryAttempts.map(({ candidate }) => candidate.bundle.resultRevision), ...run.deliveryHistory.map(({ candidate }) => candidate.bundle.resultRevision),
    run.deliverySaga?.manifest?.resultRevision ?? 0) + 1
}

function newDeliveryDraft(run: CollaborationTaskRun, now: string): WorkerDeliveryDraft {
  const resultRevision = nextDeliveryRevision(run)
  return { revision: (run.deliveryDraft?.revision ?? 0) + 1, resultRevision,
    basedOnResultRevision: resultRevision > 1 ? resultRevision - 1 : null,
    summary: '', aiSummary: null, summaryEdited: false, sourceTurnId: null,
    sourceRound: 0, sourceUpdatedAt: null, updatedAt: now, changed: false, outputs: [], selectedMaterials: [], materialError: null }
}

function deliveryMaterialContext(run: CollaborationTaskRun) {
  return { workspaceRoot: run.workspaceRoot, threadId: run.threadId,
    selectedMaterials: run.deliveryDraft?.selectedMaterials ?? [],
    declaredMaterial: run.deliveryDraft?.declaredMaterial,
    declared: requireExecution(run).fileIntent?.output ?? null }
}

function workerDeliveryViewForRun(
  run: CollaborationTaskRun,
  interactions: readonly CollaborationTaskInteraction[]
): WorkerDeliveryView {
  const saga = run.deliverySaga
  let state: WorkerDeliveryView['state']
  if (saga) {
    if (saga.state === 'sealed') state = 'sealed'
    else if (saga.state === 'returned') state = 'returned'
    else if (saga.error || saga.state === 'blocked' || saga.state === 'unknown') state = 'blocked'
    else state = 'submitting'
  } else if ((run.state === 'waiting-result-confirm' || run.executionMode === 'unselected' || run.executionMode === 'manual') && run.deliveryDraft) state = 'waiting_confirmation'
  else if (TERMINAL_RUN_STATES.has(run.state)) state = 'blocked'
  else if (workerFollowupView(run.followups.at(-1), run.agentJournal.at(-1))?.state === 'cancelled' && run.deliveryDraft) state = 'waiting_confirmation'
  else state = 'executing'
  const candidate = run.frozenCandidate
  return {
    declaredOutput: requireExecution(run).fileIntent?.output ?? null,
    projectId: run.offer.projectId,
    taskId: run.offer.taskId,
    executionId: run.offer.executionId,
    state,
    draft: run.deliveryDraft,
    confirmationTarget: run.deliverySaga && candidate ? confirmationTargetForBundle(candidate.bundle, candidate.bundleDigest) : computedDraftTarget(run),
    history: run.deliveryHistory.map(({ candidate: snapshot, manifest }) => ({
      ...(snapshot.sourceChat ? { sourceChat: snapshot.sourceChat } : {}),
      bundle: snapshot.bundle, sourceTurnId: snapshot.sourceTurnId, frozenAt: snapshot.frozenAt, manifest,
      deliveryManifestId: manifest.deliveryManifestId, submittedByUserId: requireExecution(run).assigneeUserId,
      submittedAt: manifest.sealedAt
    })),
    candidate: candidate
      ? {
          target: {
            projectId: candidate.bundle.projectId,
            taskId: candidate.bundle.taskId,
            executionId: candidate.bundle.executionId,
            contractRevision: candidate.bundle.contractRevision,
            resultRevision: candidate.bundle.resultRevision,
            bundleDigest: candidate.bundleDigest,
            decision: 'approved'
          },
          ...(candidate.sourceChat ? { sourceChat: candidate.sourceChat } : {}),
          bundle: candidate.bundle,
          sourceTurnId: candidate.sourceTurnId,
          frozenAt: candidate.frozenAt,
          dirty: candidate.dirty
        }
      : null,
    operationId: saga?.operationId ?? null,
    deliveryManifestId: saga?.manifest?.deliveryManifestId ?? null,
    error: saga?.error ?? run.error,
    residuals: interactions
      .filter((interaction) => (
        interaction.executionId === run.offer.executionId &&
        !['applied', 'superseded'].includes(interaction.state)
      ))
      .map((interaction) => ({
        interactionId: interaction.interactionId,
        text: interaction.text,
        uncertain: interaction.state === 'dispatching' || interaction.state === 'awaiting_cloud',
        disposition: interaction.disposition ?? null
      }))
  }
}

function pendingOfferClaimRequest(pending: CollaborationPendingTaskOffer) {
  const requestFacts = pendingOfferClaimRequestFacts(pending)
  return restRequestSchema.parse({
    protocolVersion: '1.0', requestId: collaborationRequestId(), type: 'task.offer.accept',
    idempotencyKey: idempotencyKey('task.offer.accept', requestFacts), ...requestFacts
  })
}

function pendingOfferClaimRequestFacts(pending: CollaborationPendingTaskOffer) {
  return {
    taskOfferId: pending.taskOfferId,
    taskId: pending.taskId,
    agentId: pending.recipientAgentId,
    interaction: 'explicit_click',
    expectedTaskRevision: pending.currentTaskRevision,
    expectedOfferRevision: pending.offerRevision,
    ...(pending.contractRevision !== undefined && pending.contractRevision !== null
      ? { expectedContractRevision: pending.contractRevision }
      : {}),
    ...(pending.contractDigest !== undefined && pending.contractDigest !== null
      ? { expectedContractDigest: pending.contractDigest }
      : {})
  }
}

class OfferClaimCheckpointError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'The accepted TaskRun checkpoint failed.', { cause })
    this.name = 'OfferClaimCheckpointError'
  }
}

class AuthorityUnverifiedError extends Error {
  readonly code = 'authority_unverified'
}

class OfferDecisionRejectedError extends Error {}

function isAuthorityUnverified(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'authority_unverified'
}

function isCloudTemporarilyUnavailable(error: unknown): boolean {
  return error instanceof Error && 'code' in error &&
    ['transport_unavailable', 'runtime_unavailable', 'cloud_unavailable', 'cloud_timeout'].includes(String(error.code))
}

class OfferClaimRevisionRaceError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'The Task offer revision changed while claiming.', { cause })
    this.name = 'OfferClaimRevisionRaceError'
  }
}

function timestampNotBefore(observedAt: string, minimumAt: string): string {
  return Date.parse(observedAt) < Date.parse(minimumAt) ? minimumAt : observedAt
}

function idempotencyKey(kind: string, facts: unknown): string {
  return `idem_${kind}.${digest(canonicalJson(facts)).slice(0, 48)}`
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (!value || typeof value !== 'object') throw new TypeError('Canonical JSON value is unsupported.')
  return `{${Object.entries(value as Record<string, unknown>)
    .filter(([, child]) => child !== undefined)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
    .join(',')}}`
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function latestAgentFailure(run: CollaborationTaskRun) {
  const current = run.agentJournal.at(-1)
  if (current?.origin === 'session' && current.state !== 'observed_failure') return undefined
  const latest = [...run.agentJournal].reverse().find((entry) => (
    entry.state === 'observed_success' || entry.state === 'observed_failure'
  ))
  return latest?.state === 'observed_failure' && latest.failure
    ? latest
    : undefined
}

function throwIfSignalAborted(signal: AbortSignal): void {
  if (!signal.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new Error(typeof signal.reason === 'string'
    ? signal.reason
    : 'Worker operation was cancelled.')
}

function normalizeSafeCode(value: string): string {
  const normalized = value.trim().toLowerCase().replace(/[^a-z0-9_.-]+/gu, '_').slice(0, 64)
  return /^[a-z]/u.test(normalized) ? normalized : `provider_${normalized || 'failure'}`.slice(0, 64)
}

function safeError(error: unknown, sanitizeText?: (value: string) => string): string {
  const value = error instanceof Error ? error.message : typeof error === 'string'
    ? error
    : 'Worker execution failed.'
  return (sanitizeText?.(value) ?? value)
    .replace(/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/giu, '[REDACTED]')
    .replace(/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu, '[REDACTED]')
    .slice(0, 4_000)
}
