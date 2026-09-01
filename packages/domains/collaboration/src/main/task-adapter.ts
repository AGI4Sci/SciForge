import { createHash } from 'node:crypto'
import {
  cloudResourceRefSchema,
  externalOperationRecoveryJournalEntrySchema,
  restRequestSchema,
  restResponseSchema,
  type AgentInboxMessage,
  type CloudResourceRef,
  type CloudStateEvent,
  type ExternalOperationRecoveryJournalEntry,
  type HumanAnswer,
  type RestEntity,
  type RestResponse,
  type Task,
  type TaskExecution,
  type TaskExecutionPreflight,
  type TaskOffer,
  type TaskOfferClosedPayload,
  type TaskOfferedPayload,
  type TaskRecoveryAbandonedPayload,
  type TaskRecoveryOutputLinkedPayload,
  type TaskResultOutput
} from '@sciforge/collaboration-contracts'
import {
  CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT,
  CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT,
  CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT,
  contentSpacePortableContainerReferenceEnvelopeSchema,
  contentSpacePortableFileReferenceEnvelopeSchema,
  type ContentSpaceSystemDownloadReceipt,
  type ContentSpaceSystemUploadNewReceipt
} from '@sciforge/domain-content-space/contract'
import type {
  DomainMainAgentExecutionHost,
  DomainMainSystemCapabilityInvoker
} from '@sciforge/domain-sdk/host'
import { truncateWellFormedUnicode } from '@sciforge/domain-sdk/unicode'
import { collaborationRequestId } from './request-id.js'
import type { CollaborationConnection } from './connection.js'
import { DurableCloudOutbox } from './outbox.js'
import { ensurePrivateWorkspaceRoot } from './private-workspace-root.js'
import {
  CollaborationLocalStore,
  type CollaborationExternalOperationJournal,
  type CollaborationPendingTaskOffer,
  type CollaborationProjectUnavailableFence,
  type CollaborationTaskRun
} from './store.js'
import { WorkerAcceptancePolicyService } from './worker-acceptance-policy.js'
import {
  parseWorkerRuntimeResult,
  workerHumanAnswerPrompt,
  workerTaskPrompt
} from './worker-runtime-result.js'

type CollaborationWorkerPreflight = NonNullable<CollaborationTaskRun['latestPreflight']>
type ContentTransferPreflightObservation = CollaborationWorkerPreflight[
  'contentTransferReadiness'
][number]

export type CollaborationTaskAdapterOptions = Readonly<{
  store: CollaborationLocalStore
  connection: CollaborationConnection
  outbox: DurableCloudOutbox
  agentExecution: DomainMainAgentExecutionHost & Readonly<{
    prepareSession: NonNullable<DomainMainAgentExecutionHost['prepareSession']>
  }>
  capabilities: DomainMainSystemCapabilityInvoker
  localAgentId: () => string | undefined
  workspaceRootForExecution: (executionId: string) => string
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
  'result_submitted',
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
  private readonly now: () => Date
  private readonly policies: WorkerAcceptancePolicyService
  private readonly running = new Map<string, Promise<void>>()
  private readonly controllers = new Map<string, AbortController>()
  private stopped = false

  constructor(private readonly options: CollaborationTaskAdapterOptions) {
    this.now = options.now ?? (() => new Date())
    this.policies = new WorkerAcceptancePolicyService(options.store, this.now)
  }

  async recover(): Promise<void> {
    this.stopped = false
    for (const offer of this.options.store.snapshot().pendingTaskOffers) {
      if (offer.state === 'pending' || offer.state === 'claiming' || offer.state === 'rejecting') {
        this.schedule(offer.taskOfferId)
      }
    }
    for (const run of this.options.store.snapshot().taskRuns) {
      if (run.externalJournal.some((entry) => entry.state === 'effect_dispatched')) {
        this.schedule(run.offer.executionId)
      } else if (!TERMINAL_RUN_STATES.has(run.state)) {
        this.schedule(run.offer.executionId)
      }
    }
  }

  stop(): void {
    this.stopped = true
    for (const controller of this.controllers.values()) controller.abort()
  }

  async waitForIdle(executionId?: string): Promise<void> {
    if (executionId) await this.running.get(executionId)
    else {
      while (this.running.size > 0) await Promise.all([...this.running.values()])
    }
  }

  acceptanceMode(agentId: string): 'manual' | 'automatic' {
    return this.policies.read(agentId)
  }

  async updateAcceptanceMode(
    agentId: string,
    mode: 'manual' | 'automatic'
  ): Promise<'manual' | 'automatic'> {
    const updated = await this.policies.update(agentId, mode)
    await this.publishAvailability('online')
    return updated
  }

  async decideOffer(taskOfferId: string, input: WorkerOfferDecision): Promise<void> {
    const offer = this.requirePendingOffer(taskOfferId)
    if (offer.state !== 'awaiting-manual') {
      throw new Error('Only an offer awaiting a manual decision can be accepted, rejected, or dismissed on this Device.')
    }
    const decidedAt = this.now().toISOString()
    await this.options.store.transact((draft) => {
      const current = draft.pendingTaskOffers.find((candidate) => candidate.taskOfferId === taskOfferId)
      if (!current) throw new Error('Local pending Task offer was not found.')
      if (current.state !== 'awaiting-manual') {
        throw new Error('Only an offer awaiting a manual decision can be accepted, rejected, or dismissed on this Device.')
      }
      if (input.decision !== 'dismiss') {
        current.state = input.decision === 'accept' ? 'claiming' : 'rejecting'
        current.completedAt = null
        current.error = null
      } else {
        current.state = 'dismissed'
        current.completedAt = decidedAt
        current.error = 'Dismissed on this Device; another Device may still claim this User offer.'
      }
      current.updatedAt = decidedAt
    })
    if (input.decision !== 'dismiss') this.schedule(taskOfferId)
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
    if (payload.type === 'task.recovery.output_linked') {
      await this.acceptRecoveryOutputLinked(payload, message.recipientAgentId, message.createdAt)
      return
    }
    if (payload.type === 'task.recovery.abandoned') {
      await this.acceptRecoveryAbandoned(payload, message.recipientAgentId)
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
    const existing = this.findPendingOffer(payload.taskOfferId)
    if (existing) {
      if (
        existing.taskId !== payload.taskId ||
        existing.projectId !== payload.projectId ||
        existing.workerUserId !== payload.workerUserId
      ) throw new Error('Task offer identity was reused for another Worker User or Task.')
      if (existing.state === 'pending' || existing.state === 'claiming' || existing.state === 'rejecting') {
        this.schedule(payload.taskOfferId)
      }
      return
    }

    const receivedAt = this.now().toISOString()
    await this.options.store.transact((draft) => {
      draft.pendingTaskOffers.push({
        projectId: payload.projectId,
        taskId: payload.taskId,
        taskOfferId: payload.taskOfferId,
        workerUserId: payload.workerUserId,
        currentTaskRevision: payload.currentTaskRevision,
        offerRevision: payload.offerRevision,
        recipientAgentId,
        receivedAt,
        preflightReasons: [],
        state: 'pending',
        updatedAt: receivedAt,
        completedAt: null,
        error: null
      })
    })
    this.schedule(payload.taskOfferId)
  }

  private async acceptOfferClaimed(taskOfferId: string, claimedByAgentId: string): Promise<void> {
    const pending = this.findPendingOffer(taskOfferId)
    if (!pending || pending.state === 'dismissed') return
    if (claimedByAgentId === this.options.localAgentId() && pending.state === 'claiming') return
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
      throw new Error('Task-offer closure revisions conflict with the local terminal journal.')
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
      currentTaskRevision: payload.taskRevision,
      offerRevision: payload.offerRevision,
      completedAt,
      error
    })
  }

  private async acceptRecoveryOutputLinked(
    payload: TaskRecoveryOutputLinkedPayload,
    recipientAgentId: string,
    linkedAt: string
  ): Promise<void> {
    this.requireLocalInboxRecipient(recipientAgentId)
    let run = this.findRun(payload.executionId)
    if (!run) throw new Error('Local Worker recovery journal was not found.')
    requireRecoveryMessageTuple(run, payload)

    if (hasExactAppliedRecoveryLink(run, payload)) {
      if (run.state === 'completed') return
      if (run.state !== 'manual-recovery') {
        throw new Error('Recovery output was already linked outside the exact manual-recovery state.')
      }
      const delivered = this.deliveredResultSubmission(run)
      if (delivered) {
        await this.completeRecoveredRun(
          run.offer.executionId,
          delivered.task,
          delivered.execution
        )
        return
      }
      await this.submitRecoveredResult(run)
      return
    }
    if (run.state !== 'manual-recovery') {
      throw new Error('Only the exact local manual-recovery execution may link an observed output.')
    }

    const journal = requireUnknownRecoveryJournal(run, payload)
    const { task, preflight } = await this.readExactRecoveryCloudState(
      payload.taskId,
      payload.executionId,
      payload.taskRevision,
      payload.executionRevision,
      'manual_recovery_required'
    )
    const resource = await this.readCloudResource(payload.resourceRefId)
    validateRecoveryOutput(run, task, preflight, journal, payload, resource)
    const observedCloudJournal = externalOperationRecoveryJournalEntrySchema.parse({
      ...requireCloudJournal(journal),
      state: 'observed_success',
      receiptDigest: payload.output.transferReceiptDigest,
      observationDigest: payload.output.observationDigest,
      safeFailureCode: null,
      resolvedAt: linkedAt,
      revision: payload.journalRevision,
      updatedAt: linkedAt
    })

    await this.options.store.transact((draft) => {
      const current = requireDraftRun(draft.taskRuns, payload.executionId)
      if (current.state !== 'manual-recovery') {
        throw new Error('Worker recovery state changed before the observed output was persisted.')
      }
      const currentJournal = requireUnknownRecoveryJournal(current, payload)
      if (current.resources.some((candidate) => (
        candidate.role === 'output-file' && candidate.resourceRefId !== resource.resourceRefId
      ))) {
        throw new Error('A different output ResourceRef is already bound to this execution.')
      }
      Object.assign(currentJournal, {
        state: 'observed_success',
        cloudJournal: observedCloudJournal,
        receiptDigest: payload.output.transferReceiptDigest,
        observationDigest: payload.output.observationDigest,
        observedAt: linkedAt,
        safeFailureCode: null,
        safeError: null
      })
      current.task = task
      current.execution = preflight.execution
      current.latestPreflight = {
        cloud: preflight,
        outcome: 'denied',
        reasons: ['cloud_denied', 'execution_mismatch'],
        contentTransferReadiness: [],
        evaluatedAt: preflight.evaluatedAt
      }
      current.expectedTaskRevision = payload.taskRevision
      current.expectedExecutionRevision = payload.executionRevision
      current.resources = [
        ...current.resources.filter(({ resourceRefId }) => resourceRefId !== resource.resourceRefId),
        resource
      ]
      current.outputs = [payload.output]
      if (!current.recoveryJournalEntryIds.includes(payload.journalEntryId)) {
        current.recoveryJournalEntryIds.push(payload.journalEntryId)
      }
      current.updatedAt = linkedAt
      draft.tasks = [...draft.tasks.filter(({ taskId }) => taskId !== task.taskId), task]
    })
    run = this.requireRun(payload.executionId)
    await this.submitRecoveredResult(run)
  }

  private async acceptRecoveryAbandoned(
    payload: TaskRecoveryAbandonedPayload,
    recipientAgentId: string
  ): Promise<void> {
    this.requireLocalInboxRecipient(recipientAgentId)
    const run = this.findRun(payload.executionId)
    // Cloud also notifies a distinct Coordinator Agent. That Agent has no
    // Worker journal for this execution and only needs the generic Project refresh.
    if (!run) return
    requireRecoveryMessageTuple(run, payload)
    if (
      run.state === 'fenced' &&
      run.task?.revision === payload.taskRevision &&
      run.task.status === 'revision_requested' &&
      run.execution?.revision === payload.executionRevision &&
      run.execution.state === 'cancelled' &&
      run.execution.fence.reason === 'manual_recovery_abandoned'
    ) return
    if (run.state !== 'manual-recovery') {
      throw new Error('Only the exact local manual-recovery execution may be abandoned.')
    }
    if (!run.externalJournal.some((entry) => (
      entry.cloudJournal?.projectId === payload.projectId &&
      entry.cloudJournal.taskId === payload.taskId &&
      entry.cloudJournal.executionId === payload.executionId &&
      (entry.state === 'outcome_unknown' || entry.state === 'observed_failure')
    ))) {
      throw new Error('The exact unresolved local recovery journal was not found.')
    }
    const { task, preflight } = await this.readExactRecoveryCloudState(
      payload.taskId,
      payload.executionId,
      payload.taskRevision,
      payload.executionRevision,
      'cancelled'
    )
    const completedAt = preflight.execution.terminalAt ?? this.now().toISOString()
    await this.updateRun(payload.executionId, {
      task,
      execution: preflight.execution,
      expectedTaskRevision: payload.taskRevision,
      expectedExecutionRevision: payload.executionRevision,
      state: 'fenced',
      completedAt,
      error: payload.reason
    })
    this.controllers.get(payload.executionId)?.abort(payload.reason)
    await this.publishAvailability('online')
  }

  private requireLocalInboxRecipient(recipientAgentId: string): void {
    const localAgentId = this.options.localAgentId()
    if (!localAgentId || recipientAgentId !== localAgentId) {
      throw new Error('Recovery Inbox recipient does not match this Agent Device.')
    }
  }

  private async readExactRecoveryCloudState(
    taskId: string,
    executionId: string,
    taskRevision: number,
    executionRevision: number,
    expectedExecutionState: 'manual_recovery_required' | 'cancelled'
  ): Promise<Readonly<{ task: Task; preflight: TaskExecutionPreflight }>> {
    const response = await this.options.connection.executeAsAgent(restRequestSchema.parse({
      protocolVersion: '1.0',
      requestId: collaborationRequestId(),
      type: 'task.execution.preflight.get',
      taskId,
      executionId,
      expectedTaskRevision: taskRevision,
      expectedExecutionRevision: executionRevision
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.task_execution_preflight') {
      throw new Error(`Task recovery preflight returned unexpected ${response.type}.`)
    }
    const preflight = response.preflight
    const task = await this.readTask(taskId)
    const revisionOrIdentityDrift = preflight.currentTaskRevision !== taskRevision ||
      preflight.requestedTaskRevision !== taskRevision ||
      preflight.requestedExecutionRevision !== executionRevision ||
      preflight.execution.revision !== executionRevision ||
      preflight.projectId !== task.projectId ||
      preflight.taskId !== task.taskId ||
      preflight.executionId !== executionId ||
      preflight.currentExecutionId !== executionId ||
      task.revision !== taskRevision ||
      task.currentExecutionId !== executionId ||
      preflight.execution.taskId !== taskId
    const denialReasons = new Set(preflight.decision.reasons)
    if (
      revisionOrIdentityDrift ||
      preflight.decision.outcome !== 'denied' ||
      !denialReasons.has('execution_fenced') ||
      denialReasons.has('execution_not_current') ||
      denialReasons.has('task_revision_mismatch') ||
      denialReasons.has('execution_revision_mismatch')
    ) {
      throw new Error('Recovery does not target the exact current manual-recovery execution.')
    }
    if (expectedExecutionState === 'manual_recovery_required') {
      if (
        denialReasons.size !== 1 ||
        task.status !== 'manual_recovery_required' ||
        task.currentExecutionState !== 'manual_recovery_required' ||
        preflight.execution.state !== 'manual_recovery_required' ||
        preflight.execution.fence.status !== 'fenced' ||
        preflight.execution.fence.reason !== 'manual_recovery_required'
      ) {
        throw new Error('Recovery does not target the exact current manual-recovery execution.')
      }
    } else if (
      task.status !== 'revision_requested' ||
      task.currentExecutionState !== 'cancelled' ||
      preflight.execution.state !== 'cancelled' ||
      preflight.execution.fence.status !== 'fenced' ||
      preflight.execution.fence.reason !== 'manual_recovery_abandoned'
    ) {
      throw new Error('Cloud abandonment does not match the exact fenced execution.')
    }
    return { task, preflight }
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

  async fenceLocalAgent(agentId: string, reason: string): Promise<void> {
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
            TERMINAL_PENDING_OFFER_STATES.has(offer.state)) continue
        offer.state = 'failed'
        offer.completedAt = now
        offer.updatedAt = now
        offer.error = reason.slice(0, 4_000)
      }
      for (const run of draft.taskRuns) {
        if (run.offer.recipientAgentId !== agentId || TERMINAL_RUN_STATES.has(run.state)) continue
        run.state = 'fenced'
        run.completedAt = now
        run.updatedAt = now
        run.error = reason.slice(0, 4_000)
      }
    })
    for (const [identifier, controller] of this.controllers) {
      const offer = this.findPendingOffer(identifier)
      const run = this.findRun(identifier)
      if (offer?.recipientAgentId === agentId || run?.offer.recipientAgentId === agentId) {
        controller.abort(reason)
      }
    }
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
    if (this.stopped || this.running.has(identifier)) return
    const promise = this.process(identifier).catch(async (error) => {
      if (this.stopped) return
      const pending = this.findPendingOffer(identifier)
      if (pending && !TERMINAL_PENDING_OFFER_STATES.has(pending.state)) {
        const recoverableClaimFailure = pending.state === 'claiming' && (
          error instanceof OfferClaimCheckpointError ||
          this.hasUncertainDurableClaim(pending)
        )
        await this.updatePendingOffer(identifier, {
          state: recoverableClaimFailure ? 'claiming' : 'failed',
          completedAt: recoverableClaimFailure ? null : this.now().toISOString(),
          error: safeError(error, this.options.sanitizeText)
        })
        return
      }
      const current = this.findRun(identifier)
      if (!current || TERMINAL_RUN_STATES.has(current.state)) return
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
    if (TERMINAL_RUN_STATES.has(run.state)) return
    const controller = this.controllers.get(executionId) ?? new AbortController()
    this.controllers.set(executionId, controller)
    try {
      const uncertain = run.externalJournal.find((entry) => entry.state === 'effect_dispatched')
      if (uncertain) {
        await this.observeUnknownOutcome(run, uncertain, 'desktop_restarted_after_provider_dispatch')
        return
      }
      if (run.state === 'needs-human') {
        await this.refreshPreflight(run, true, controller.signal)
        throwIfSignalAborted(controller.signal)
        return
      }
      const preflight = await this.refreshPreflight(run, true, controller.signal)
      throwIfSignalAborted(controller.signal)
      run = this.requireRun(executionId)
      if (TERMINAL_RUN_STATES.has(run.state)) return
      if (preflight.outcome === 'denied') {
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

  private async processPendingOffer(initial: CollaborationPendingTaskOffer): Promise<void> {
    let offer = initial
    if (TERMINAL_PENDING_OFFER_STATES.has(offer.state) ||
        offer.state === 'awaiting-manual') return
    if (offer.state === 'rejecting') {
      await this.rejectPendingOffer(offer)
      return
    }
    if (offer.state === 'claiming' && await this.resumePendingOfferClaim(offer)) return
    const controller = new AbortController()
    this.controllers.set(offer.taskOfferId, controller)
    try {
      const acceptanceMode = this.policies.read(offer.recipientAgentId)
      const preflight = await this.preflightPendingOffer(offer, controller.signal)
      throwIfSignalAborted(controller.signal)
      offer = this.requirePendingOffer(offer.taskOfferId)
      if (TERMINAL_PENDING_OFFER_STATES.has(offer.state)) return
      const preflightReasons = preflight.reason ? [preflight.reason] : []
      if (offer.state === 'pending' && acceptanceMode === 'manual') {
        await this.updatePendingOffer(offer.taskOfferId, {
          state: 'awaiting-manual',
          preflightReasons,
          error: null
        }, preflight.task, offer.state)
        return
      }
      if (preflight.reason) {
        const manual = acceptanceMode === 'manual'
        await this.updatePendingOffer(offer.taskOfferId, {
          state: manual ? 'awaiting-manual' : 'failed',
          preflightReasons,
          completedAt: manual ? null : this.now().toISOString(),
          error: `${preflight.message} Another Device may still claim the User-level offer.`
        }, preflight.task, offer.state)
        return
      }
      offer = await this.updatePendingOffer(offer.taskOfferId, {
        state: 'claiming',
        preflightReasons: [],
        error: null
      }, preflight.task, offer.state)
      throwIfSignalAborted(controller.signal)
      if (offer.state !== 'claiming') return
      await this.claimPendingOffer(offer)
    } finally {
      if (this.controllers.get(offer.taskOfferId) === controller) {
        this.controllers.delete(offer.taskOfferId)
      }
    }
  }

  /** Advisory Device-local checks shared by manual and automatic acceptance before the Cloud claim. */
  private async preflightPendingOffer(
    offer: CollaborationPendingTaskOffer,
    signal: AbortSignal
  ): Promise<Readonly<{
    task?: Task
    reason: CollaborationPendingTaskOffer['preflightReasons'][number] | null
    message: string
  }>> {
    let task: Task
    try {
      task = await this.readTask(offer.taskId)
    } catch {
      return { reason: 'task_unavailable', message: 'The current Task facts are unavailable.' }
    }
    if (
      task.projectId !== offer.projectId ||
      task.revision !== offer.currentTaskRevision ||
      task.status !== 'offered' ||
      task.currentExecutionId !== null
    ) {
      return {
        task,
        reason: 'offer_not_current',
        message: 'The User-level offer is no longer current on this Device.'
      }
    }
    if (!await this.runtimeReady()) {
      return { task, reason: 'runtime_not_ready', message: 'This Device Runtime is not ready.' }
    }
    if (!task.fileIntent) return { task, reason: null, message: '' }

    try {
      const response = await this.options.connection.executeAsAgent(restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: collaborationRequestId(),
        type: 'project.content.binding.get',
        projectId: offer.projectId
      }))
      if (
        response.type !== 'rest.entity' ||
        response.entity.type !== 'project_content_space_binding'
      ) {
        return {
          task,
          reason: 'content_not_ready',
          message: 'The current Project Content binding is unavailable.'
        }
      }
      const binding = response.entity
      if (
        binding.projectId !== offer.projectId ||
        binding.status !== 'active' ||
        binding.revision !== task.fileIntent.bindingRevision ||
        !binding.rootLocator ||
        !binding.rootLocatorDigest
      ) {
        return {
          task,
          reason: 'content_not_ready',
          message: 'The current Project Content binding is not ready.'
        }
      }

      const root = contentSpacePortableContainerReferenceEnvelopeSchema.parse(binding.rootLocator)
      const workspaceRoot = this.options.workspaceRootForExecution(offer.taskOfferId)
      await ensurePrivateWorkspaceRoot(workspaceRoot)
      const intents = [
        ...task.fileIntent.inputs.map((input) => ({
          operation: 'download' as const,
          input: {
            root,
            candidate: contentSpacePortableFileReferenceEnvelopeSchema.parse(input.locator),
            workspaceRelativePath: input.destinationName
          }
        })),
        {
          operation: 'upload-new' as const,
          input: {
            root,
            name: task.fileIntent.output.fileName,
            workspaceRelativePath: task.fileIntent.output.fileName
          }
        }
      ]
      for (const intent of intents) {
        const result = await this.options.capabilities.invoke(
          CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT,
          CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT.inputSchema.parse(intent),
          {
            workspaceId: workspaceRoot,
            signal,
            systemExecutionContext: {
              contractVersion: 1,
              phase: 'task-offer-preflight',
              projectId: offer.projectId,
              taskId: offer.taskId,
              taskOfferId: offer.taskOfferId,
              taskRevision: offer.currentTaskRevision,
              offerRevision: offer.offerRevision
            }
          }
        )
        throwIfSignalAborted(signal)
        if (!result.ok || result.value.status !== 'ready') {
          return {
            task,
            reason: 'provider_not_ready',
            message: 'This Device Provider session is not ready for the exact file Task.'
          }
        }
      }
      return { task, reason: null, message: '' }
    } catch {
      throwIfSignalAborted(signal)
      return {
        task,
        reason: 'provider_not_ready',
        message: 'This Device Provider session is not ready for the exact file Task.'
      }
    }
  }

  private async claimPendingOffer(pending: CollaborationPendingTaskOffer): Promise<void> {
    const requestFacts = pendingOfferClaimRequestFacts(pending)
    const response = await this.options.outbox.enqueueAndWait('task.offer-decision',
      restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: collaborationRequestId(),
        type: 'task.offer.accept',
        idempotencyKey: idempotencyKey('task.offer.accept', requestFacts),
        ...requestFacts
      }))
    await this.persistClaimedOffer(pending, response)
  }

  private async resumePendingOfferClaim(pending: CollaborationPendingTaskOffer): Promise<boolean> {
    const requestFacts = pendingOfferClaimRequestFacts(pending)
    const claimIdempotencyKey = idempotencyKey('task.offer.accept', requestFacts)
    const replay = await this.options.outbox.resumeAndWait(
      'task.offer-decision',
      claimIdempotencyKey,
      (request) => {
        if (
          request.type !== 'task.offer.accept' ||
          request.idempotencyKey !== claimIdempotencyKey ||
          request.taskOfferId !== requestFacts.taskOfferId ||
          request.taskId !== requestFacts.taskId ||
          request.expectedTaskRevision !== requestFacts.expectedTaskRevision ||
          request.expectedOfferRevision !== requestFacts.expectedOfferRevision
        ) {
          throw new Error('Durable Task offer claim does not match the pending User offer.')
        }
      }
    )
    if (!replay) return false
    await this.persistClaimedOffer(pending, replay.response)
    return true
  }

  private hasUncertainDurableClaim(pending: CollaborationPendingTaskOffer): boolean {
    const requestFacts = pendingOfferClaimRequestFacts(pending)
    const claimIdempotencyKey = idempotencyKey('task.offer.accept', requestFacts)
    const entry = this.options.store.snapshot().outbox.find((candidate) => (
      candidate.idempotencyKey === claimIdempotencyKey
    ))
    if (
      !entry ||
      entry.kind !== 'task.offer-decision' ||
      entry.state === 'delivered'
    ) return false
    const request = restRequestSchema.safeParse(entry.body)
    return request.success &&
      request.data.type === 'task.offer.accept' &&
      request.data.idempotencyKey === claimIdempotencyKey &&
      request.data.taskOfferId === requestFacts.taskOfferId &&
      request.data.taskId === requestFacts.taskId &&
      request.data.expectedTaskRevision === requestFacts.expectedTaskRevision &&
      request.data.expectedOfferRevision === requestFacts.expectedOfferRevision
  }

  private async persistClaimedOffer(
    pending: CollaborationPendingTaskOffer,
    response: RestResponse
  ): Promise<void> {
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.collection') {
      throw new Error(`Task offer claim returned unexpected ${response.type}.`)
    }
    const task = response.items.find((item): item is Task => item.type === 'task')
    const execution = response.items.find((item): item is TaskExecution => item.type === 'task_execution')
    const offer = response.items.find((item): item is TaskOffer => item.type === 'task_offer')
    const localAgentId = this.options.localAgentId()
    if (
      response.items.length !== 3 ||
      !task || !execution || !offer || !localAgentId ||
      task.taskId !== pending.taskId || task.projectId !== pending.projectId ||
      task.currentExecutionId !== execution.executionId ||
      execution.taskId !== pending.taskId || execution.projectId !== pending.projectId ||
      execution.assigneeAgentId !== localAgentId || execution.assigneeUserId !== pending.workerUserId ||
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
            recipientAgentId: localAgentId,
            receivedAt: pending.receivedAt
          },
          task,
          execution,
          latestPreflight: null,
          decision: { decision: 'accept', decidedAt: acceptedAt },
          expectedTaskRevision: task.revision,
          expectedExecutionRevision: execution.revision,
          state: 'accepting',
          workspaceRoot,
          runtimeId: null,
          threadId: null,
          humanRequestId: null,
          humanAnswer: null,
          resources: [],
          agentJournal: [],
          externalJournal: [],
          outputs: [],
          recoveryJournalEntryIds: [],
          resultSummary: null,
          lateOutcomes: [],
          startedAt: null,
          updatedAt: acceptedAt,
          completedAt: null,
          error: null
        })
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
      if (run.state === 'accepting' || !run.startedAt) {
        run = await this.updateRun(run.offer.executionId, {
          ...(run.state === 'accepting' ? { state: 'running' as const } : {}),
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
    await this.executeRunning(run)
  }

  private async executeRunning(initial: CollaborationTaskRun): Promise<void> {
    let run = initial
    const controller = this.controllers.get(run.offer.executionId) ?? new AbortController()
    this.controllers.set(run.offer.executionId, controller)
    try {
      const preflight = await this.refreshPreflight(run, true, controller.signal)
      throwIfSignalAborted(controller.signal)
      if (preflight.outcome === 'denied') {
        await this.markFenced(run, `Execution lost authority: ${preflight.reasons.join(', ')}`)
        return
      }
      run = this.requireRun(run.offer.executionId)
      if (TERMINAL_RUN_STATES.has(run.state)) return
      if (requireExecution(run).fileIntent) {
        await this.downloadInputs(run, controller.signal)
        run = this.requireRun(run.offer.executionId)
        if (TERMINAL_RUN_STATES.has(run.state)) return
      }
      const runtimeResult = await this.runAgent(run, controller.signal)
      if (!runtimeResult) return
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
      if (requireExecution(run).fileIntent) {
        await this.uploadOutput(run, controller.signal)
        run = this.requireRun(run.offer.executionId)
        if (TERMINAL_RUN_STATES.has(run.state)) return
      }
      await this.submitResult(run, controller.signal)
    } finally {
      if (this.controllers.get(run.offer.executionId) === controller) {
        this.controllers.delete(run.offer.executionId)
      }
    }
  }

  private async runAgent(run: CollaborationTaskRun, signal: AbortSignal) {
    const existing = [...run.agentJournal].reverse().find((entry) => (
      entry.state === 'prepared' || entry.state === 'dispatched'
    ))
    const ordinal = run.agentJournal.length + (existing ? 0 : 1)
    const logicalInvocationId = existing?.logicalInvocationId ?? `agent.${run.offer.executionId}.${ordinal}`
    const clientDirectiveId = existing?.clientDirectiveId ??
      `collab-worker-${digest(`${run.offer.executionId}\u0000${ordinal}`).slice(0, 48)}`
    if (!existing) {
      const preparedAt = this.now().toISOString()
      await this.options.store.transact((draft) => {
        const current = requireDraftRun(draft.taskRuns, run.offer.executionId)
        current.agentJournal.push({
          logicalInvocationId, clientDirectiveId, state: 'prepared', preparedAt,
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
      session = await this.options.agentExecution.prepareSession({
        workspaceRoot: run.workspaceRoot,
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
    const prompt = run.humanAnswer
      ? workerHumanAnswerPrompt(run.humanAnswer.answer)
      : workerTaskPrompt({
          title: task.title,
          objective: task.objective,
          completionCriteria: task.completionCriteria,
          fileIntent: execution.fileIntent
            ? { inputs: execution.fileIntent.inputs, output: execution.fileIntent.output }
            : null
        })
    let result
    try {
      result = await this.options.agentExecution.run({
        runtimeId: run.runtimeId!,
        threadId: run.threadId!,
        workspaceRoot: run.workspaceRoot,
        clientDirectiveId,
        prompt,
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
      await this.updateAgentJournal(run.offer.executionId, logicalInvocationId, {
        state: 'observed_failure', observedAt: this.now().toISOString(),
        runtimeState: 'failed', safeError: safeError(error, this.options.sanitizeText)
      })
      await this.failExecution(this.requireRun(run.offer.executionId), 'runtime_failed', 'Agent Runtime invocation failed.')
      return null
    }
    const safeText = result.text.slice(0, 32_000)
    const observedAt = this.now().toISOString()
    const postflight = await this.refreshPreflight(
      this.requireRun(run.offer.executionId),
      true,
      signal
    ).catch(() => null)
    if (signal.aborted && this.stopped) return null
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
    await this.updateAgentJournal(run.offer.executionId, logicalInvocationId, {
      state: result.state === 'completed' ? 'observed_success' : 'observed_failure',
      observedAt,
      runtimeId: result.runtimeId, threadId: result.threadId, turnId: result.turnId,
      runtimeState: result.state, safeResultText: safeText,
      ...(result.state === 'completed' ? {} : { safeError: `Agent turn ended in ${result.state}.` })
    })
    await this.updateRun(run.offer.executionId, {
      runtimeId: result.runtimeId, threadId: result.threadId, humanAnswer: null
    })
    if (result.state !== 'completed') {
      await this.failExecution(this.requireRun(run.offer.executionId),
        `runtime_${result.state}`, `Agent turn ended in ${result.state}.`)
      return null
    }
    try {
      return parseWorkerRuntimeResult(result.text)
    } catch {
      await this.failExecution(this.requireRun(run.offer.executionId),
        'invalid_runtime_result', 'Agent Runtime returned an invalid Worker result.')
      return null
    }
  }

  private async downloadInputs(run: CollaborationTaskRun, signal: AbortSignal): Promise<void> {
    await this.ensureResources(run)
    run = this.requireRun(run.offer.executionId)
    const fileIntent = requireExecution(run).fileIntent!
    const root = requireContentRoot(run)
    for (const input of fileIntent.inputs) {
      const logicalInvocationId = `download.${run.offer.executionId}.${digest(input.resourceRefId).slice(0, 24)}`
      const existing = run.externalJournal.find((entry) => entry.logicalInvocationId === logicalInvocationId)
      if (existing?.state === 'observed_success') continue
      const resource = requireResource(run, input.resourceRefId, 'input-file')
      await this.executeTransfer(run, {
        logicalInvocationId,
        operation: 'download',
        workspaceRelativePath: input.destinationName,
        input: {
          root,
          candidate: contentSpacePortableFileReferenceEnvelopeSchema.parse(resource.locator),
          workspaceRelativePath: input.destinationName
        },
        signal
      })
      run = this.requireRun(run.offer.executionId)
      if (TERMINAL_RUN_STATES.has(run.state)) return
    }
  }

  private async uploadOutput(run: CollaborationTaskRun, signal: AbortSignal): Promise<void> {
    await this.ensureResources(run)
    run = this.requireRun(run.offer.executionId)
    const execution = requireExecution(run)
    const output = execution.fileIntent!.output
    const root = requireContentRoot(run)
    const logicalInvocationId = `upload.${run.offer.executionId}.output`
    const existing = run.externalJournal.find((entry) => entry.logicalInvocationId === logicalInvocationId)
    if (existing?.state === 'observed_success' && run.outputs.length === 1) return
    const receipt = await this.executeTransfer(run, {
      logicalInvocationId,
      operation: 'upload_new',
      workspaceRelativePath: output.fileName,
      input: { root, name: output.fileName, workspaceRelativePath: output.fileName },
      signal
    })
    if (!receipt || !('portableReference' in receipt)) return
    const latest = this.requireRun(run.offer.executionId)
    if (TERMINAL_RUN_STATES.has(latest.state)) return
    const binding = latest.latestPreflight?.cloud.contentBinding
    const uploadPreflight = latest.latestPreflight?.contentTransferReadiness.find((observation) => (
      observation.operation === 'upload-new' && observation.status === 'ready'
    ))
    if (!binding?.rootLocatorDigest || execution.fence.bindingRevision === null || !uploadPreflight) {
      await this.failExecution(latest, 'content_not_ready', 'Project content binding is incomplete.')
      return
    }
    const resultOutput: TaskResultOutput = {
      executionId: execution.executionId,
      assignmentTaskRevision: execution.fileIntent!.assignmentTaskRevision,
      locator: receipt.portableReference,
      locatorDigest: digest(canonicalJson(receipt.portableReference)),
      rootLocatorDigest: binding.rootLocatorDigest,
      bindingRevision: execution.fence.bindingRevision,
      transferReceiptDigest: receipt.transferReceiptDigest,
      observationDigest: receipt.observationDigest,
      preflightObservationDigest: uploadPreflight.observationRevision
    }
    await this.updateRun(run.offer.executionId, { outputs: [resultOutput] })
  }

  private async executeTransfer(
    initial: CollaborationTaskRun,
    operation: Readonly<{
      logicalInvocationId: string
      operation: 'download' | 'upload_new'
      workspaceRelativePath: string
      input: Record<string, unknown>
      signal: AbortSignal
    }>
  ): Promise<ContentSpaceSystemDownloadReceipt | ContentSpaceSystemUploadNewReceipt | null> {
    let run = initial
    let journal = run.externalJournal.find((entry) => entry.logicalInvocationId === operation.logicalInvocationId)
    const requestDigest = digest(canonicalJson({
      operation: operation.operation,
      input: operation.input,
      context: systemExecutionContext(run)
    }))
    if (!journal) {
      const preparedAt = this.now().toISOString()
      const prepared: CollaborationExternalOperationJournal = {
        logicalInvocationId: operation.logicalInvocationId,
        operation: operation.operation,
        workspaceRelativePath: operation.workspaceRelativePath,
        requestDigest,
        state: 'prepared',
        cloudJournal: null,
        receiptDigest: null,
        observationDigest: null,
        preparedAt,
        effectDispatchedAt: null,
        observedAt: null,
        safeFailureCode: null,
        safeError: null
      }
      await this.options.store.transact((draft) => {
        const current = requireDraftRun(draft.taskRuns, run.offer.executionId)
        current.externalJournal.push(prepared)
        current.updatedAt = preparedAt
      })
    }
    run = this.requireRun(run.offer.executionId)
    journal = requireTransferJournal(run, operation.logicalInvocationId)
    if (journal.requestDigest !== requestDigest) {
      throw new Error('Transfer logical invocation was reused for different content facts.')
    }
    if (journal.state === 'observed_success') return null
    if (journal.state === 'effect_dispatched') {
      await this.observeUnknownOutcome(run, journal, 'desktop_restarted_after_provider_dispatch')
      return null
    }
    if (journal.state === 'prepared') {
      const requestFacts = {
        scope: 'task_content_transfer' as const,
        projectId: run.offer.projectId,
        taskId: run.offer.taskId,
        executionId: run.offer.executionId,
        preparedTaskRevision: run.expectedTaskRevision,
        preparedExecutionRevision: run.expectedExecutionRevision,
        provisioningIntentId: null,
        provisioningRevision: null,
        logicalInvocationId: operation.logicalInvocationId,
        operation: operation.operation,
        requestDigest
      }
      const response = await this.options.outbox.enqueueAndWait('task.external-operation',
        restRequestSchema.parse({
          protocolVersion: '1.0', requestId: collaborationRequestId(),
          type: 'external_operation.prepare',
          idempotencyKey: idempotencyKey('external_operation.prepare', requestFacts),
          ...requestFacts
        }))
      await this.updateTransferJournal(run.offer.executionId, operation.logicalInvocationId, {
        state: 'cloud_prepared',
        cloudJournal: requireResponseEntity(response, 'external_operation_recovery_journal_entry')
      })
      journal = requireTransferJournal(this.requireRun(run.offer.executionId), operation.logicalInvocationId)
    }
    if (journal.state === 'cloud_prepared') {
      const cloudJournal = requireCloudJournal(journal)
      const requestFacts = {
        journalEntryId: cloudJournal.contentRecoveryJournalEntryId,
        expectedJournalRevision: cloudJournal.revision
      }
      const response = await this.options.outbox.enqueueAndWait('task.external-operation',
        restRequestSchema.parse({
          protocolVersion: '1.0', requestId: collaborationRequestId(),
          type: 'external_operation.dispatch',
          idempotencyKey: idempotencyKey('external_operation.dispatch', requestFacts),
          ...requestFacts
        }))
      await this.updateTransferJournal(run.offer.executionId, operation.logicalInvocationId, {
        state: 'cloud_dispatched',
        cloudJournal: requireResponseEntity(response, 'external_operation_recovery_journal_entry')
      })
      journal = requireTransferJournal(this.requireRun(run.offer.executionId), operation.logicalInvocationId)
    }
    const preflight = await this.refreshPreflight(
      this.requireRun(run.offer.executionId),
      true,
      operation.signal
    )
    throwIfSignalAborted(operation.signal)
    if (preflight.outcome === 'denied') {
      await this.markFenced(this.requireRun(run.offer.executionId),
        `Transfer preflight denied: ${preflight.reasons.join(', ')}`)
      return null
    }
    const effectDispatchedAt = this.now().toISOString()
    await this.updateTransferJournal(run.offer.executionId, operation.logicalInvocationId, {
      state: 'effect_dispatched', effectDispatchedAt
    })
    run = this.requireRun(run.offer.executionId)
    journal = requireTransferJournal(run, operation.logicalInvocationId)
    try {
      const invocationOptions = {
        workspaceId: run.workspaceRoot,
        idempotencyKey: `content_${digest(operation.logicalInvocationId).slice(0, 48)}`,
        systemExecutionContext: systemExecutionContext(run),
        signal: operation.signal
      }
      const result = operation.operation === 'download'
        ? await this.options.capabilities.invoke(
            CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT,
            CONTENT_SPACE_SYSTEM_DOWNLOAD_CONTRACT.inputSchema.parse(operation.input),
            invocationOptions)
        : await this.options.capabilities.invoke(
            CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT,
            CONTENT_SPACE_SYSTEM_UPLOAD_NEW_CONTRACT.inputSchema.parse(operation.input),
            invocationOptions)
      if (this.requireRun(run.offer.executionId).state === 'fenced') {
        if (!result.ok) {
          await this.observeLateTransferOutcome(
            run,
            journal,
            result.error.code === 'outcome_unknown' ? 'outcome_unknown' : 'failed_after_fence',
            result.error.message
          )
          return null
        }
        await this.observeLateTransferOutcome(
          run,
          journal,
          'completed_after_fence',
          'Provider success was observed after the local execution was fenced.',
          result.value.transferReceiptDigest,
          result.value.observationDigest
        )
        return result.value
      }
      if (!result.ok) {
        await this.observeTransferFailure(run, journal, result.error.code, result.error.message,
          result.error.code === 'outcome_unknown')
        return null
      }
      await this.observeTransferSuccess(
        run,
        journal,
        result.value.transferReceiptDigest,
        result.value.observationDigest
      )
      return result.value
    } catch (error) {
      if (this.requireRun(run.offer.executionId).state === 'fenced') {
        await this.observeLateTransferOutcome(
          run,
          journal,
          'outcome_unknown',
          safeError(error, this.options.sanitizeText)
        )
        return null
      }
      await this.observeUnknownOutcome(run, journal, safeError(error, this.options.sanitizeText))
      return null
    }
  }

  private async observeTransferSuccess(
    run: CollaborationTaskRun,
    journal: CollaborationExternalOperationJournal,
    receiptDigest: string,
    observationDigest: string
  ): Promise<void> {
    let response: ExternalOperationRecoveryJournalEntry
    try {
      response = await this.observeExternalOperation(requireCloudJournal(journal), {
        outcome: 'observed_success', receiptDigest, observationDigest, safeFailureCode: null
      })
    } catch (error) {
      if (this.requireRun(run.offer.executionId).state !== 'fenced') throw error
      await this.observeLateTransferOutcome(
        run,
        journal,
        'completed_after_fence',
        'Cloud rejected the observation after local execution authority was fenced.',
        receiptDigest,
        observationDigest
      )
      return
    }
    if (this.requireRun(run.offer.executionId).state === 'fenced') {
      await this.observeLateTransferOutcome(
        run,
        journal,
        'completed_after_fence',
        'Provider success completed concurrently with the local execution fence.',
        receiptDigest,
        observationDigest,
        response
      )
      return
    }
    await this.updateTransferJournal(run.offer.executionId, journal.logicalInvocationId, {
      state: 'observed_success', cloudJournal: response,
      receiptDigest, observationDigest, observedAt: this.now().toISOString()
    })
    await this.options.store.transact((draft) => {
      const current = requireDraftRun(draft.taskRuns, run.offer.executionId)
      if (!current.recoveryJournalEntryIds.includes(response.contentRecoveryJournalEntryId)) {
        current.recoveryJournalEntryIds.push(response.contentRecoveryJournalEntryId)
      }
    })
  }

  private async observeTransferFailure(
    run: CollaborationTaskRun,
    journal: CollaborationExternalOperationJournal,
    safeFailureCode: string,
    message: string,
    unknown: boolean
  ): Promise<void> {
    if (unknown) {
      await this.observeUnknownOutcome(run, journal, safeFailureCode)
      return
    }
    const normalized = normalizeSafeCode(safeFailureCode)
    let response: ExternalOperationRecoveryJournalEntry
    try {
      response = await this.observeExternalOperation(requireCloudJournal(journal), {
        outcome: 'observed_failure', receiptDigest: null, observationDigest: null,
        safeFailureCode: normalized
      })
    } catch (error) {
      if (this.requireRun(run.offer.executionId).state !== 'fenced') throw error
      await this.observeLateTransferOutcome(run, journal, 'failed_after_fence', message)
      return
    }
    if (this.requireRun(run.offer.executionId).state === 'fenced') {
      await this.observeLateTransferOutcome(
        run,
        journal,
        'failed_after_fence',
        message,
        null,
        null,
        response
      )
      return
    }
    await this.updateTransferJournal(run.offer.executionId, journal.logicalInvocationId, {
      state: 'observed_failure', cloudJournal: response,
      observedAt: this.now().toISOString(), safeFailureCode: normalized,
      safeError: message.slice(0, 4_000)
    })
    await this.failExecution(this.requireRun(run.offer.executionId),
      'provider_not_ready', 'Content Provider transfer failed closed.')
  }

  private async observeUnknownOutcome(
    run: CollaborationTaskRun,
    journal: CollaborationExternalOperationJournal,
    detail: string
  ): Promise<void> {
    let response: ExternalOperationRecoveryJournalEntry
    try {
      response = await this.observeExternalOperation(requireCloudJournal(journal), {
        outcome: 'outcome_unknown', receiptDigest: null, observationDigest: null,
        safeFailureCode: 'provider_outcome_unknown'
      })
    } catch (error) {
      if (this.requireRun(run.offer.executionId).state !== 'fenced') throw error
      await this.observeLateTransferOutcome(run, journal, 'outcome_unknown', detail)
      return
    }
    if (this.requireRun(run.offer.executionId).state === 'fenced') {
      await this.observeLateTransferOutcome(
        run,
        journal,
        'outcome_unknown',
        detail,
        null,
        null,
        response
      )
      return
    }
    const observedAt = this.now().toISOString()
    await this.updateTransferJournal(run.offer.executionId, journal.logicalInvocationId, {
      state: 'outcome_unknown', cloudJournal: response, observedAt,
      safeFailureCode: 'provider_outcome_unknown', safeError: detail.slice(0, 4_000)
    })
    const enteredManualRecovery = await this.options.store.transact((draft) => {
      const current = requireDraftRun(draft.taskRuns, run.offer.executionId)
      if (TERMINAL_RUN_STATES.has(current.state)) return false
      current.state = 'manual-recovery'
      current.completedAt = observedAt
      current.updatedAt = observedAt
      current.error = 'Provider outcome is unknown; manual recovery is required.'
      current.lateOutcomes.push({
        source: 'content_space',
        logicalInvocationId: journal.logicalInvocationId,
        outcome: 'outcome_unknown', observedAt,
        safeDetail: detail.slice(0, 4_000)
      })
      return true
    })
    if (!enteredManualRecovery) return
    await this.publishAvailability('online')
  }

  private async rejectPendingOffer(pending: CollaborationPendingTaskOffer): Promise<void> {
    const requestFacts = {
      taskOfferId: pending.taskOfferId,
      taskId: pending.taskId,
      expectedTaskRevision: pending.currentTaskRevision,
      expectedOfferRevision: pending.offerRevision
    }
    const response = await this.options.outbox.enqueueAndWait('task.offer-decision',
      restRequestSchema.parse({
        protocolVersion: '1.0',
        requestId: collaborationRequestId(),
        type: 'task.offer.reject',
        idempotencyKey: idempotencyKey('task.offer.reject', requestFacts),
        ...requestFacts
      }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
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
      currentTaskRevision: task.revision,
      offerRevision: offer.revision,
      completedAt,
      error: 'The Worker User rejected the Task offer.'
    }, task)
  }

  private async observeLateTransferOutcome(
    run: CollaborationTaskRun,
    journal: CollaborationExternalOperationJournal,
    outcome: 'completed_after_fence' | 'failed_after_fence' | 'outcome_unknown',
    detail: string,
    receiptDigest: string | null = null,
    observationDigest: string | null = null,
    cloudJournal?: ExternalOperationRecoveryJournalEntry
  ): Promise<void> {
    const safeDetail = safeError(detail, this.options.sanitizeText)
    const observedAt = this.now().toISOString()
    await this.options.store.transact((draft) => {
      const current = requireDraftRun(draft.taskRuns, run.offer.executionId)
      const entry = current.externalJournal.find((candidate) => (
        candidate.logicalInvocationId === journal.logicalInvocationId
      ))
      if (!entry) throw new Error('External operation journal entry was not found.')
      Object.assign(entry, {
        state: 'late_outcome',
        ...(cloudJournal ? { cloudJournal } : {}),
        receiptDigest,
        observationDigest,
        observedAt,
        safeFailureCode: outcome,
        safeError: safeDetail
      })
      if (!current.lateOutcomes.some((candidate) => (
        candidate.source === 'content_space' &&
        candidate.logicalInvocationId === journal.logicalInvocationId &&
        candidate.outcome === outcome
      ))) {
        current.lateOutcomes.push({
          source: 'content_space',
          logicalInvocationId: journal.logicalInvocationId,
          outcome,
          observedAt,
          safeDetail
        })
      }
      current.updatedAt = observedAt
    })
  }

  private async observeExternalOperation(
    journal: ExternalOperationRecoveryJournalEntry,
    observation: Readonly<{
      outcome: 'observed_success' | 'observed_failure' | 'outcome_unknown'
      receiptDigest: string | null
      observationDigest: string | null
      safeFailureCode: string | null
    }>
  ): Promise<ExternalOperationRecoveryJournalEntry> {
    const requestFacts = {
      journalEntryId: journal.contentRecoveryJournalEntryId,
      expectedJournalRevision: journal.revision,
      ...observation
    }
    const response = await this.options.outbox.enqueueAndWait('task.external-operation',
      restRequestSchema.parse({
        protocolVersion: '1.0', requestId: collaborationRequestId(),
        type: 'external_operation.observe',
        idempotencyKey: idempotencyKey('external_operation.observe', requestFacts),
        ...requestFacts
      }))
    return requireResponseCollectionEntity(response, 'external_operation_recovery_journal_entry')
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

  private async submitResult(run: CollaborationTaskRun, signal: AbortSignal): Promise<void> {
    const preflight = await this.refreshPreflight(run, true, signal)
    throwIfSignalAborted(signal)
    run = this.requireRun(run.offer.executionId)
    if (preflight.outcome === 'denied') {
      await this.markFenced(run, `Result preflight denied: ${preflight.reasons.join(', ')}`)
      return
    }
    await this.sendResultSubmission(run, true)
  }

  private async submitRecoveredResult(run: CollaborationTaskRun): Promise<void> {
    const execution = requireExecution(run)
    const task = requireTask(run)
    if (
      run.state !== 'manual-recovery' ||
      task.status !== 'manual_recovery_required' ||
      execution.state !== 'manual_recovery_required' ||
      execution.fence.status !== 'fenced' ||
      execution.fence.reason !== 'manual_recovery_required' ||
      run.outputs.length !== 1 ||
      run.recoveryJournalEntryIds.length === 0
    ) {
      throw new Error('Recovered result submission requires the exact persisted manual-recovery facts.')
    }
    await this.sendResultSubmission(run, false)
  }

  private resultSubmissionFacts(run: CollaborationTaskRun) {
    const latestAgent = [...run.agentJournal].reverse().find((entry) => entry.state === 'observed_success')
    if (!latestAgent?.runtimeId || !run.startedAt || !run.resultSummary) {
      throw new Error('Runtime provenance is incomplete.')
    }
    return {
      taskId: run.offer.taskId,
      executionId: run.offer.executionId,
      expectedTaskRevision: run.expectedTaskRevision,
      expectedExecutionRevision: run.expectedExecutionRevision,
      summary: run.resultSummary,
      runtimeProvenance: {
        runtimeId: latestAgent.runtimeId,
        modelId: null,
        startedAt: run.startedAt,
        completedAt: timestampNotBefore(
          latestAgent.observedAt ?? this.now().toISOString(),
          run.startedAt
        )
      },
      outputs: run.outputs,
      recoveryJournalEntryIds: run.recoveryJournalEntryIds
    }
  }

  private deliveredResultSubmission(run: CollaborationTaskRun): Readonly<{
    task: Task
    execution: TaskExecution
  }> | null {
    const expectedFacts = this.resultSubmissionFacts(run)
    const expectedKey = idempotencyKey('task.result.submit', expectedFacts)
    return this.options.store.snapshot().outbox.map((entry) => {
      if (entry.kind !== 'task.result' || entry.state !== 'delivered' || !entry.response) return null
      const request = restRequestSchema.safeParse(entry.body)
      const response = restResponseSchema.safeParse(entry.response)
      if (
        !request.success ||
        request.data.type !== 'task.result.submit' ||
        request.data.idempotencyKey !== expectedKey ||
        !response.success ||
        response.data.type !== 'rest.collection' ||
        response.data.requestId !== request.data.requestId ||
        response.data.nextCursor !== undefined ||
        response.data.items.length !== 3 ||
        response.data.items[0]?.type !== 'task' ||
        response.data.items[1]?.type !== 'task_execution' ||
        response.data.items[2]?.type !== 'task_result_submission'
      ) return null
      if (canonicalJson(taskResultRequestFacts(request.data)) !== canonicalJson(expectedFacts)) {
        return null
      }
      return requireTaskResultBundle(response.data)
    }).find((result): result is Readonly<{ task: Task; execution: TaskExecution }> => (
      result !== null
    )) ?? null
  }

  private async sendResultSubmission(
    run: CollaborationTaskRun,
    markSubmitting: boolean
  ): Promise<void> {
    let submissionFacts
    try {
      submissionFacts = this.resultSubmissionFacts(run)
    } catch (error) {
      if (!markSubmitting) throw error
      await this.failExecution(run, 'runtime_provenance_missing', 'Runtime provenance is incomplete.')
      return
    }
    const request = restRequestSchema.parse({
      protocolVersion: '1.0', requestId: collaborationRequestId(),
      type: 'task.result.submit',
      idempotencyKey: idempotencyKey('task.result.submit', submissionFacts),
      ...submissionFacts,
      submissionDigest: digest(canonicalJson(submissionFacts))
    })
    if (markSubmitting) {
      const submitting = await this.updateRun(run.offer.executionId, { state: 'submitting' })
      if (submitting.state !== 'submitting') return
    }
    const response = await this.options.outbox.enqueueAndWait('task.result', request)
    const submitted = requireTaskResultBundle(response)
    await this.completeRecoveredRun(run.offer.executionId, submitted.task, submitted.execution)
  }

  private async completeRecoveredRun(
    executionId: string,
    task: Task,
    execution: TaskExecution
  ): Promise<void> {
    await this.updateRun(executionId, {
      task,
      execution,
      expectedTaskRevision: task.revision,
      expectedExecutionRevision: execution.revision,
      state: 'completed', completedAt: this.now().toISOString(), error: null
    })
    await this.publishAvailability('online')
  }

  private async failExecution(
    run: CollaborationTaskRun,
    safeFailureCode: string,
    safeMessage: string
  ): Promise<void> {
    if (TERMINAL_RUN_STATES.has(run.state)) return
    if (requireExecution(run).fence.status === 'fenced') {
      await this.markFenced(run, safeMessage)
      return
    }
    const failedAt = this.now().toISOString()
    const failing = await this.updateRun(run.offer.executionId, {
      error: safeMessage.slice(0, 4_000)
    })
    if (TERMINAL_RUN_STATES.has(failing.state)) return
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
      state: 'failed', completedAt: failedAt,
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
      'provider_not_ready' |
      'content_not_ready' |
      'agent_inactive' |
      'execution_mismatch'
    > = []
    if (cloud.decision.outcome === 'denied') reasons.push('cloud_denied')
    const localAgent = this.options.store.snapshot().agents.find((agent) => (
      agent.agentId === run.offer.recipientAgentId
    ))
    if (!localAgent || localAgent.lifecycleStatus !== 'active') reasons.push('agent_inactive')
    if (!(await this.runtimeReady())) reasons.push('runtime_not_ready')
    throwIfSignalAborted(signal)
    if (
      cloud.execution.executionId !== run.offer.executionId ||
      cloud.execution.assigneeAgentId !== run.offer.recipientAgentId ||
      task.currentExecutionId !== run.offer.executionId ||
      cloud.execution.fence.status !== 'open'
    ) reasons.push('execution_mismatch')
    if (cloud.execution.fileIntent && (
      cloud.taskKind !== 'file' ||
      cloud.contentReadiness?.state !== 'ready' ||
      cloud.contentBinding?.status !== 'active' ||
      !cloud.contentBinding.rootLocator ||
      !cloud.contentBinding.rootLocatorDigest
    )) {
      reasons.push('content_not_ready')
    }
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
    if (cloud.execution.fileIntent && uniqueReasons.length === 0) {
      const content = await this.preflightContentTransfers(
        this.requireRun(run.offer.executionId),
        signal
      )
      throwIfSignalAborted(signal)
      if (!content.ready) reasons.push('provider_not_ready')
      uniqueReasons = [...new Set(reasons)]
      local = {
        cloud,
        outcome: uniqueReasons.length === 0 ? 'allowed' as const : 'denied' as const,
        reasons: uniqueReasons,
        contentTransferReadiness: content.observations,
        evaluatedAt: this.now().toISOString()
      }
      await this.updateRun(run.offer.executionId, {
        latestPreflight: local,
        error: uniqueReasons.length ? `Preflight denied: ${uniqueReasons.join(', ')}` : null
      })
      throwIfSignalAborted(signal)
    }
    return local
  }

  private async preflightContentTransfers(
    run: CollaborationTaskRun,
    signal: AbortSignal
  ): Promise<Readonly<{
    ready: boolean
    observations: Array<Readonly<{
      operation: 'download' | 'upload-new'
      status: 'ready' | 'provider_not_ready' | 'principal_stale' | 'binding_stale'
      intentDigest: string
      observationRevision: string
    }>>
  }>> {
    try {
      await this.ensureResources(run)
      run = this.requireRun(run.offer.executionId)
      const fileIntent = requireExecution(run).fileIntent
      if (!fileIntent) return { ready: true, observations: [] }
      const root = requireContentRoot(run)
      const intents = [
        ...fileIntent.inputs.map((input) => ({
          operation: 'download' as const,
          input: {
            root,
            candidate: contentSpacePortableFileReferenceEnvelopeSchema.parse(
              requireResource(run, input.resourceRefId, 'input-file').locator
            ),
            workspaceRelativePath: input.destinationName
          }
        })),
        {
          operation: 'upload-new' as const,
          input: {
            root,
            name: fileIntent.output.fileName,
            workspaceRelativePath: fileIntent.output.fileName
          }
        }
      ]
      const observations: ContentTransferPreflightObservation[] = []
      for (const intent of intents) {
        const result = await this.options.capabilities.invoke(
          CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT,
          CONTENT_SPACE_SYSTEM_TRANSFER_PREFLIGHT_CONTRACT.inputSchema.parse(intent),
          {
            workspaceId: run.workspaceRoot,
            signal,
            systemExecutionContext: systemExecutionContext(run)
          }
        )
        throwIfSignalAborted(signal)
        if (!result.ok) return { ready: false, observations }
        observations.push({
          operation: intent.operation,
          status: result.value.status,
          intentDigest: result.value.intentDigest,
          observationRevision: result.value.observationRevision
        })
      }
      return {
        ready: observations.every(({ status }) => status === 'ready'),
        observations
      }
    } catch {
      throwIfSignalAborted(signal)
      return { ready: false, observations: [] }
    }
  }

  private async ensureResources(run: CollaborationTaskRun): Promise<void> {
    const fileIntent = requireExecution(run).fileIntent
    if (!fileIntent) return
    const expected = [
      ...fileIntent.inputs.map(({ resourceRefId }, ordinal) => ({
        resourceRefId,
        role: 'input-file' as const,
        ordinal
      })),
      {
        resourceRefId: fileIntent.output.rootResourceRefId,
        role: 'output-container' as const,
        ordinal: fileIntent.inputs.length
      }
    ]
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
        resource.bindingRevision !== fileIntent.bindingRevision ||
        resource.intentDigest !== fileIntent.declarationDigest ||
        resource.role !== expectation.role ||
        resource.ordinal !== expectation.ordinal ||
        resource.locatorDigest !== digest(canonicalJson(resource.locator)) ||
        resource.status !== 'available'
      ) throw new Error('ResourceRef does not match the exact current execution fence.')
      if (
        expectation.role === 'output-container' && (
          resource.locatorDigest !== run.latestPreflight?.cloud.contentBinding?.rootLocatorDigest ||
          canonicalJson(resource.locator) !== canonicalJson(requireContentRoot(run))
        )
      ) throw new Error('Output root ResourceRef does not match the current Project content binding.')
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
    if (execution.state === 'manual_recovery_required') {
      await this.updateRun(run.offer.executionId, {
        execution, state: 'manual-recovery', completedAt: now,
        error: 'Cloud requires manual execution recovery.'
      })
    } else if (['failed', 'cancelled', 'revoked', 'superseded'].includes(execution.state)) {
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
    return response.entity
  }

  private findRun(executionId: string): CollaborationTaskRun | undefined {
    return this.options.store.snapshot().taskRuns.find((run) => run.offer.executionId === executionId)
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
        update.state !== offer.state
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
      if (
        TERMINAL_RUN_STATES.has(run.state) &&
        update.state !== undefined &&
        update.state !== run.state &&
        !(run.state === 'manual-recovery' && (
          update.state === 'completed' || update.state === 'fenced'
        ))
      ) return structuredClone(run)
      Object.assign(run, update, { updatedAt: this.now().toISOString() })
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

  private async updateTransferJournal(
    executionId: string,
    logicalInvocationId: string,
    update: Partial<CollaborationExternalOperationJournal>
  ): Promise<void> {
    await this.options.store.transact((draft) => {
      const run = requireDraftRun(draft.taskRuns, executionId)
      const entry = run.externalJournal.find((item) => item.logicalInvocationId === logicalInvocationId)
      if (!entry) throw new Error('External operation journal entry was not found.')
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

function requireTransferJournal(
  run: CollaborationTaskRun,
  logicalInvocationId: string
): CollaborationExternalOperationJournal {
  const journal = run.externalJournal.find((item) => item.logicalInvocationId === logicalInvocationId)
  if (!journal) throw new Error('External operation journal entry was not found.')
  return journal
}

function requireCloudJournal(
  journal: CollaborationExternalOperationJournal
): ExternalOperationRecoveryJournalEntry {
  if (!journal.cloudJournal) throw new Error('Cloud recovery journal identity is missing.')
  return journal.cloudJournal
}

function requireRecoveryMessageTuple(
  run: CollaborationTaskRun,
  payload: TaskRecoveryOutputLinkedPayload | TaskRecoveryAbandonedPayload
): void {
  if (
    run.offer.projectId !== payload.projectId ||
    run.offer.taskId !== payload.taskId ||
    run.offer.executionId !== payload.executionId ||
    run.offer.recipientAgentId !== run.execution?.assigneeAgentId
  ) {
    throw new Error('Recovery Inbox message does not match the immutable local execution tuple.')
  }
}

function requireUnknownRecoveryJournal(
  run: CollaborationTaskRun,
  payload: TaskRecoveryOutputLinkedPayload
): CollaborationExternalOperationJournal {
  const journal = run.externalJournal.find((candidate) => (
    candidate.logicalInvocationId === payload.logicalInvocationId &&
    candidate.cloudJournal?.contentRecoveryJournalEntryId === payload.journalEntryId
  ))
  if (!journal) throw new Error('The exact local Provider recovery journal was not found.')
  const cloudJournal = requireCloudJournal(journal)
  if (
    journal.operation !== 'upload_new' ||
    journal.state !== 'outcome_unknown' ||
    cloudJournal.scope !== 'task_content_transfer' ||
    cloudJournal.projectId !== payload.projectId ||
    cloudJournal.taskId !== payload.taskId ||
    cloudJournal.executionId !== payload.executionId ||
    cloudJournal.logicalInvocationId !== payload.logicalInvocationId ||
    cloudJournal.operation !== 'upload_new' ||
    cloudJournal.state !== 'outcome_unknown' ||
    cloudJournal.revision + 1 !== payload.journalRevision ||
    cloudJournal.requestDigest !== journal.requestDigest
  ) {
    throw new Error('The recovery link does not match the exact unresolved Provider invocation.')
  }
  return journal
}

function hasExactAppliedRecoveryLink(
  run: CollaborationTaskRun,
  payload: TaskRecoveryOutputLinkedPayload
): boolean {
  const journal = run.externalJournal.find((candidate) => (
    candidate.logicalInvocationId === payload.logicalInvocationId &&
    candidate.cloudJournal?.contentRecoveryJournalEntryId === payload.journalEntryId
  ))
  const cloudJournal = journal?.cloudJournal
  const resource = run.resources.find(({ resourceRefId }) => resourceRefId === payload.resourceRefId)
  return Boolean(
    journal?.state === 'observed_success' &&
    journal.receiptDigest === payload.output.transferReceiptDigest &&
    journal.observationDigest === payload.output.observationDigest &&
    cloudJournal?.state === 'observed_success' &&
    cloudJournal.revision === payload.journalRevision &&
    cloudJournal.receiptDigest === payload.output.transferReceiptDigest &&
    cloudJournal.observationDigest === payload.output.observationDigest &&
    run.outputs.length === 1 &&
    canonicalJson(run.outputs[0]) === canonicalJson(payload.output) &&
    run.recoveryJournalEntryIds.includes(payload.journalEntryId) &&
    resource?.role === 'output-file' &&
    resource.status === 'available' &&
    resource.locatorDigest === payload.output.locatorDigest &&
    canonicalJson(resource.locator) === canonicalJson(payload.output.locator)
  )
}

function validateRecoveryOutput(
  run: CollaborationTaskRun,
  task: Task,
  preflight: TaskExecutionPreflight,
  journal: CollaborationExternalOperationJournal,
  payload: TaskRecoveryOutputLinkedPayload,
  resource: CloudResourceRef
): void {
  const execution = preflight.execution
  const fileIntent = execution.fileIntent
  const binding = preflight.contentBinding
  const cloudJournal = requireCloudJournal(journal)
  if (
    preflight.taskKind !== 'file' ||
    task.fileIntent === null ||
    !fileIntent ||
    !binding ||
    binding.status !== 'active' ||
    binding.rootLocator === null ||
    binding.rootLocatorDigest === null ||
    binding.revision !== fileIntent.bindingRevision ||
    task.fileIntent.bindingRevision !== fileIntent.bindingRevision ||
    payload.output.executionId !== execution.executionId ||
    payload.output.assignmentTaskRevision !== fileIntent.assignmentTaskRevision ||
    payload.output.bindingRevision !== fileIntent.bindingRevision ||
    payload.output.rootLocatorDigest !== binding.rootLocatorDigest ||
    digest(canonicalJson(binding.rootLocator)) !== binding.rootLocatorDigest ||
    journal.workspaceRelativePath !== fileIntent.output.fileName ||
    cloudJournal.requestDigest !== journal.requestDigest ||
    resource.resourceRefId !== payload.resourceRefId ||
    resource.projectId !== payload.projectId ||
    resource.taskId !== payload.taskId ||
    resource.executionId !== payload.executionId ||
    resource.assignmentTaskRevision !== fileIntent.assignmentTaskRevision ||
    resource.bindingRevision !== fileIntent.bindingRevision ||
    resource.intentDigest !== fileIntent.declarationDigest ||
    resource.role !== 'output-file' ||
    resource.ordinal !== fileIntent.inputs.length + 1 ||
    resource.status !== 'available' ||
    resource.locatorDigest !== payload.output.locatorDigest ||
    resource.locatorDigest !== digest(canonicalJson(resource.locator)) ||
    canonicalJson(resource.locator) !== canonicalJson(payload.output.locator) ||
    resource.locator.authority !== binding.rootLocator.authority ||
    run.offer.recipientAgentId !== execution.assigneeAgentId
  ) {
    throw new Error('Observed output does not match the exact current execution, root, journal and ResourceRef.')
  }
}

function requireContentRoot(run: CollaborationTaskRun) {
  const root = run.latestPreflight?.cloud.contentBinding?.rootLocator
  if (!root) throw new Error('Project content root is not ready.')
  return contentSpacePortableContainerReferenceEnvelopeSchema.parse(root)
}

function requireResource(
  run: CollaborationTaskRun,
  resourceRefId: string,
  role: CloudResourceRef['role']
): CloudResourceRef {
  const resource = run.resources.find((item) => item.resourceRefId === resourceRefId)
  if (!resource || resource.role !== role) throw new Error(`Required ${role} ResourceRef is unavailable.`)
  return resource
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

function requireResponseCollectionEntity<Type extends RestEntity['type']>(
  response: RestResponse,
  type: Type
): Extract<RestEntity, { type: Type }> {
  if (response.type !== 'rest.collection' || response.nextCursor !== undefined) {
    throw new Error(`Cloud command returned unexpected ${response.type}; expected ${type} collection.`)
  }
  const matches = response.items.filter((entity) => entity.type === type)
  if (matches.length !== 1) {
    throw new Error(`Cloud command returned ${matches.length} ${type} entities; expected exactly one.`)
  }
  return matches[0] as Extract<RestEntity, { type: Type }>
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
  return { task, execution }
}

function requireTaskResultBundle(response: RestResponse): Readonly<{
  task: Task
  execution: TaskExecution
}> {
  if (
    response.type !== 'rest.collection' ||
    response.nextCursor !== undefined ||
    response.items.length !== 3
  ) {
    throw new Error(`Cloud command returned unexpected ${response.type}; expected Task result bundle.`)
  }
  const [task, execution, submission] = response.items
  if (
    task?.type !== 'task' ||
    execution?.type !== 'task_execution' ||
    submission?.type !== 'task_result_submission'
  ) {
    throw new Error('Cloud command returned a malformed Task result bundle.')
  }
  return { task, execution }
}

function taskResultRequestFacts(request: Extract<
  ReturnType<typeof restRequestSchema.parse>,
  { type: 'task.result.submit' }
>) {
  return {
    taskId: request.taskId,
    executionId: request.executionId,
    expectedTaskRevision: request.expectedTaskRevision,
    expectedExecutionRevision: request.expectedExecutionRevision,
    summary: request.summary,
    runtimeProvenance: request.runtimeProvenance,
    outputs: request.outputs,
    recoveryJournalEntryIds: request.recoveryJournalEntryIds
  }
}

function pendingOfferClaimRequestFacts(pending: CollaborationPendingTaskOffer) {
  return {
    taskOfferId: pending.taskOfferId,
    taskId: pending.taskId,
    expectedTaskRevision: pending.currentTaskRevision,
    expectedOfferRevision: pending.offerRevision
  }
}

class OfferClaimCheckpointError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'The accepted TaskRun checkpoint failed.', { cause })
    this.name = 'OfferClaimCheckpointError'
  }
}

function systemExecutionContext(run: CollaborationTaskRun) {
  return {
    contractVersion: 1,
    projectId: run.offer.projectId,
    taskId: run.offer.taskId,
    executionId: run.offer.executionId,
    executionRevision: run.expectedExecutionRevision
  } as const
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
