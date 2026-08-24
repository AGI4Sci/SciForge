import { createHash } from 'node:crypto'
import { chmod, mkdir } from 'node:fs/promises'
import {
  cloudResourceRefSchema,
  restRequestSchema,
  taskOfferRejectionReasonSchema,
  type AgentInboxMessage,
  type CloudResourceRef,
  type CloudStateEvent,
  type ExternalOperationRecoveryJournalEntry,
  type HumanAnswer,
  type RestEntity,
  type RestResponse,
  type Task,
  type TaskExecution,
  type TaskOfferedPayload,
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
import { collaborationRequestId } from './request-id.js'
import type { CollaborationConnection } from './connection.js'
import { DurableCloudOutbox } from './outbox.js'
import {
  CollaborationLocalStore,
  type CollaborationExternalOperationJournal,
  type CollaborationTaskRun
} from './store.js'
import { WorkerAcceptancePolicyService } from './worker-acceptance-policy.js'
import {
  parseWorkerRuntimeResult,
  workerHumanAnswerPrompt,
  workerTaskPrompt
} from './worker-runtime-result.js'

type TaskOfferRejectionReason = ReturnType<typeof taskOfferRejectionReasonSchema.parse>
type CollaborationWorkerPreflight = NonNullable<CollaborationTaskRun['latestPreflight']>
type ContentTransferPreflightObservation = CollaborationWorkerPreflight[
  'contentTransferReadiness'
][number]

export type CollaborationTaskAdapterOptions = Readonly<{
  store: CollaborationLocalStore
  connection: CollaborationConnection
  outbox: DurableCloudOutbox
  agentExecution: DomainMainAgentExecutionHost
  capabilities: DomainMainSystemCapabilityInvoker
  localAgentId: () => string | undefined
  workspaceRootForExecution: (executionId: string) => string
  sanitizeText?: (value: string) => string
  now?: () => Date
}>

export type WorkerOfferDecision = Readonly<
  | { decision: 'accept' }
  | {
      decision: 'reject'
      reason: TaskOfferRejectionReason
      safeReasonDetail?: string
    }
>

const TERMINAL_RUN_STATES = new Set<CollaborationTaskRun['state']>([
  'completed',
  'rejected',
  'failed',
  'fenced',
  'manual-recovery'
])

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
    for (const run of this.options.store.snapshot().taskRuns) {
      if (run.externalJournal.some((entry) => entry.state === 'effect_dispatched')) {
        this.schedule(run.offer.executionId)
      } else if (!TERMINAL_RUN_STATES.has(run.state) &&
        run.state !== 'awaiting-manual' && run.state !== 'needs-human') {
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
    else await Promise.all([...this.running.values()])
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

  async decideOffer(executionId: string, input: WorkerOfferDecision): Promise<void> {
    const run = this.requireRun(executionId)
    if (TERMINAL_RUN_STATES.has(run.state)) return
    if (run.state !== 'awaiting-manual') {
      throw new Error('Only an offer awaiting a manual decision can be accepted or rejected.')
    }
    const decidedAt = this.now().toISOString()
    await this.options.store.transact((draft) => {
      const current = requireDraftRun(draft.taskRuns, executionId)
      if (input.decision === 'accept') {
        current.decision = { decision: 'accept', decidedAt }
      } else {
        const reason = taskOfferRejectionReasonSchema.parse(input.reason)
        const detail = input.safeReasonDetail?.trim() || null
        if (reason === 'other' && !detail) {
          throw new Error('Other rejection requires a bounded safe detail.')
        }
        current.decision = {
          decision: 'reject',
          reason,
          safeReasonDetail: reason === 'other' ? detail : null,
          decidedAt
        }
      }
      current.state = 'accepting'
      current.updatedAt = decidedAt
    })
    this.schedule(executionId)
  }

  async handleInbox(message: AgentInboxMessage): Promise<void> {
    const payload = message.payload
    if (payload.type === 'task.offered') {
      await this.acceptOffer(payload, message.recipientAgentId)
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
    const existing = this.findRun(payload.executionId)
    if (existing) {
      if (
        existing.offer.taskOfferId !== payload.taskOfferId ||
        existing.offer.taskId !== payload.taskId ||
        existing.offer.projectId !== payload.projectId
      ) throw new Error('Execution identity was reused for a different Task offer.')
      if (!TERMINAL_RUN_STATES.has(existing.state)) this.schedule(payload.executionId)
      return
    }

    const receivedAt = this.now().toISOString()
    const workspaceRoot = this.options.workspaceRootForExecution(payload.executionId)
    await this.options.store.transact((draft) => {
      for (const previous of draft.taskRuns) {
        if (
          previous.offer.taskId !== payload.taskId ||
          previous.offer.executionId === payload.executionId ||
          TERMINAL_RUN_STATES.has(previous.state)
        ) continue
        previous.state = 'fenced'
        previous.completedAt = receivedAt
        previous.updatedAt = receivedAt
        previous.error = 'A newer immutable execution superseded this local run.'
      }
      draft.taskRuns.push({
        offer: {
          projectId: payload.projectId,
          taskId: payload.taskId,
          executionId: payload.executionId,
          taskOfferId: payload.taskOfferId,
          currentTaskRevision: payload.currentTaskRevision,
          currentExecutionRevision: payload.currentExecutionRevision,
          offerRevision: payload.offerRevision,
          recipientAgentId,
          receivedAt
        },
        task: null,
        execution: null,
        latestPreflight: null,
        decision: null,
        expectedTaskRevision: payload.currentTaskRevision,
        expectedExecutionRevision: payload.currentExecutionRevision,
        state: 'offered',
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
        updatedAt: receivedAt,
        completedAt: null,
        error: null
      })
    })
    for (const [executionId, controller] of this.controllers) {
      const previous = this.findRun(executionId)
      if (previous?.offer.taskId === payload.taskId && executionId !== payload.executionId) {
        controller.abort('Execution was superseded.')
      }
    }
    await mkdir(workspaceRoot, { recursive: true, mode: 0o700 })
    await chmod(workspaceRoot, 0o700)
    this.schedule(payload.executionId)
  }

  async fenceLocalAgent(agentId: string, reason: string): Promise<void> {
    const now = this.now().toISOString()
    await this.options.store.transact((draft) => {
      for (const run of draft.taskRuns) {
        if (run.offer.recipientAgentId !== agentId || TERMINAL_RUN_STATES.has(run.state)) continue
        run.state = 'fenced'
        run.completedAt = now
        run.updatedAt = now
        run.error = reason.slice(0, 4_000)
      }
    })
    for (const [executionId, controller] of this.controllers) {
      if (this.findRun(executionId)?.offer.recipientAgentId === agentId) controller.abort(reason)
    }
  }

  /** Publishes local facts only; Cloud joins Device, Agent, membership, and Project readiness. */
  async publishAvailability(connectionStatus: 'online' | 'offline'): Promise<void> {
    const agentId = this.options.localAgentId()
    if (!agentId) return
    const state = this.options.store.snapshot()
    const agent = state.agents.find((candidate) => candidate.agentId === agentId)
    if (!agent) return
    const observedAt = this.now().toISOString()
    const activeTaskCount = state.taskRuns.filter((run) => (
      run.offer.recipientAgentId === agentId && !TERMINAL_RUN_STATES.has(run.state)
    )).length
    const requestFacts = {
      agentId,
      expectedAgentRevision: agent.revision,
      connectionStatus,
      lastHeartbeatAt: connectionStatus === 'online' ? agent.lastSeenAt ?? observedAt : null,
      runtimeReadiness: 'ready' as const,
      runtimeCapabilityTags: [...agent.capabilities].sort(),
      acceptsNewOffers: connectionStatus === 'online' &&
        agent.lifecycleStatus === 'active' && activeTaskCount < 10,
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

  private schedule(executionId: string): void {
    if (this.stopped || this.running.has(executionId)) return
    const promise = this.process(executionId).catch(async (error) => {
      const current = this.findRun(executionId)
      if (!current || TERMINAL_RUN_STATES.has(current.state)) return
      await this.updateRun(executionId, { error: safeError(error, this.options.sanitizeText) })
    }).finally(() => {
      if (this.running.get(executionId) === promise) this.running.delete(executionId)
    })
    this.running.set(executionId, promise)
  }

  private async process(executionId: string): Promise<void> {
    if (this.stopped) return
    let run = this.requireRun(executionId)
    if (TERMINAL_RUN_STATES.has(run.state)) return
    const uncertain = run.externalJournal.find((entry) => entry.state === 'effect_dispatched')
    if (uncertain) {
      await this.observeUnknownOutcome(run, uncertain, 'desktop_restarted_after_provider_dispatch')
      return
    }
    if (!run.decision) {
      const preflight = await this.refreshPreflight(run)
      run = this.requireRun(executionId)
      if (preflight.outcome === 'denied') {
        await this.prepareAutomaticRejection(run, rejectionForPreflight(preflight.reasons))
      } else if (this.policies.read(run.offer.recipientAgentId) === 'manual') {
        await this.updateRun(executionId, { state: 'awaiting-manual', error: null })
        return
      } else {
        await this.updateRun(executionId, {
          decision: { decision: 'accept', decidedAt: this.now().toISOString() },
          state: 'accepting',
          error: null
        })
      }
      run = this.requireRun(executionId)
    }
    if (run.decision?.decision === 'reject') {
      await this.rejectOffer(run)
      return
    }
    const preflight = await this.refreshPreflight(run)
    run = this.requireRun(executionId)
    if (preflight.outcome === 'denied') {
      await this.markFenced(run, `Worker preflight denied: ${preflight.reasons.join(', ')}`)
      return
    }
    await this.acceptAndStart(run)
  }

  private async acceptAndStart(initial: CollaborationTaskRun): Promise<void> {
    let run = initial
    let execution = requireExecution(run)
    if (execution.state === 'offered') {
      const requestFacts = offerCommandFacts(run)
      const response = await this.options.outbox.enqueueAndWait('task.offer-decision',
        restRequestSchema.parse({
          protocolVersion: '1.0', requestId: collaborationRequestId(),
          type: 'task.offer.accept',
          idempotencyKey: idempotencyKey('task.offer.accept', requestFacts),
          ...requestFacts
        }))
      execution = requireResponseEntity(response, 'task_execution')
      const task = await this.readTask(run.offer.taskId)
      run = await this.updateRun(run.offer.executionId, {
        task, execution,
        expectedTaskRevision: task.revision,
        expectedExecutionRevision: execution.revision,
        state: 'accepting', error: null
      })
    }
    if (execution.state === 'accepted') {
      const startedAt = run.startedAt ?? this.now().toISOString()
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
      execution = requireResponseEntity(response, 'task_execution')
      const task = await this.readTask(run.offer.taskId)
      run = await this.updateRun(run.offer.executionId, {
        task, execution,
        expectedTaskRevision: task.revision,
        expectedExecutionRevision: execution.revision,
        state: 'running', startedAt, error: null
      })
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
      const preflight = await this.refreshPreflight(run)
      if (preflight.outcome === 'denied') {
        await this.markFenced(run, `Execution lost authority: ${preflight.reasons.join(', ')}`)
        return
      }
      run = this.requireRun(run.offer.executionId)
      if (requireExecution(run).fileIntent) {
        await this.downloadInputs(run, controller.signal)
        run = this.requireRun(run.offer.executionId)
        if (TERMINAL_RUN_STATES.has(run.state)) return
      }
      const runtimeResult = await this.runAgent(run, controller.signal)
      if (!runtimeResult) return
      run = this.requireRun(run.offer.executionId)
      if (runtimeResult.outcome === 'needs_human') {
        await this.createHumanNeeded(run, runtimeResult.question, runtimeResult.requiredAssurance)
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
      await this.submitResult(run)
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
    const dispatchedAt = existing?.dispatchedAt ?? this.now().toISOString()
    await this.updateAgentJournal(run.offer.executionId, logicalInvocationId, {
      state: 'dispatched', dispatchedAt
    })
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
        ...(run.runtimeId ? { runtimeId: run.runtimeId } : {}),
        ...(run.threadId ? { threadId: run.threadId } : {}),
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
      if (signal.aborted || this.requireRun(run.offer.executionId).state === 'fenced') {
        await this.recordLateOutcome(run.offer.executionId, logicalInvocationId, 'failed_after_fence', error)
        return null
      }
      await this.updateAgentJournal(run.offer.executionId, logicalInvocationId, {
        state: 'observed_failure', observedAt: this.now().toISOString(),
        runtimeState: 'failed', safeError: safeError(error, this.options.sanitizeText)
      })
      await this.failExecution(this.requireRun(run.offer.executionId), 'runtime_failed', 'Agent Runtime invocation failed.')
      return null
    }
    const safeText = result.text.slice(0, 32_000)
    const observedAt = this.now().toISOString()
    const postflight = await this.refreshPreflight(this.requireRun(run.offer.executionId)).catch(() => null)
    if (!postflight || postflight.outcome === 'denied') {
      await this.updateAgentJournal(run.offer.executionId, logicalInvocationId, {
        state: 'late_outcome', observedAt,
        runtimeId: result.runtimeId, threadId: result.threadId, turnId: result.turnId,
        runtimeState: result.state, safeResultText: safeText
      })
      await this.recordLateOutcome(run.offer.executionId, logicalInvocationId,
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
    const preflight = await this.refreshPreflight(this.requireRun(run.offer.executionId))
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
    const response = await this.observeExternalOperation(requireCloudJournal(journal), {
      outcome: 'observed_success', receiptDigest, observationDigest, safeFailureCode: null
    })
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
    const response = await this.observeExternalOperation(requireCloudJournal(journal), {
      outcome: 'observed_failure', receiptDigest: null, observationDigest: null,
      safeFailureCode: normalized
    })
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
    const response = await this.observeExternalOperation(requireCloudJournal(journal), {
      outcome: 'outcome_unknown', receiptDigest: null, observationDigest: null,
      safeFailureCode: 'provider_outcome_unknown'
    })
    const observedAt = this.now().toISOString()
    await this.updateTransferJournal(run.offer.executionId, journal.logicalInvocationId, {
      state: 'outcome_unknown', cloudJournal: response, observedAt,
      safeFailureCode: 'provider_outcome_unknown', safeError: detail.slice(0, 4_000)
    })
    await this.options.store.transact((draft) => {
      const current = requireDraftRun(draft.taskRuns, run.offer.executionId)
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
    return requireResponseEntity(response, 'external_operation_recovery_journal_entry')
  }

  private async createHumanNeeded(
    run: CollaborationTaskRun,
    question: string,
    requiredAssurance: 'verified' | 'strong'
  ): Promise<void> {
    const expiresAt = new Date(this.now().getTime() + 7 * 24 * 60 * 60 * 1_000).toISOString()
    const requestFacts = {
      projectId: run.offer.projectId,
      taskId: run.offer.taskId,
      executionId: run.offer.executionId,
      expectedTaskRevision: run.expectedTaskRevision,
      expectedExecutionRevision: run.expectedExecutionRevision,
      requiredAssurance,
      prompt: question,
      confirmableAction: null,
      expiresAt
    }
    await this.updateRun(run.offer.executionId, { state: 'needs-human' })
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
  }

  private async acceptHumanAnswer(answer: HumanAnswer, recipientAgentId: string): Promise<void> {
    const run = this.findRun(answer.executionId)
    if (!run) return
    if (run.offer.recipientAgentId !== recipientAgentId || run.humanRequestId !== answer.humanRequestId) {
      throw new Error('Human answer does not match the pending Worker execution.')
    }
    if (run.humanAnswer?.humanAnswerId === answer.humanAnswerId) return
    await this.updateRun(answer.executionId, { humanAnswer: answer, state: 'running', error: null })
    this.schedule(answer.executionId)
  }

  private async submitResult(run: CollaborationTaskRun): Promise<void> {
    const preflight = await this.refreshPreflight(run)
    run = this.requireRun(run.offer.executionId)
    if (preflight.outcome === 'denied') {
      await this.markFenced(run, `Result preflight denied: ${preflight.reasons.join(', ')}`)
      return
    }
    const latestAgent = [...run.agentJournal].reverse().find((entry) => entry.state === 'observed_success')
    if (!latestAgent?.runtimeId || !run.startedAt || !run.resultSummary) {
      await this.failExecution(run, 'runtime_provenance_missing', 'Runtime provenance is incomplete.')
      return
    }
    const submissionFacts = {
      taskId: run.offer.taskId,
      executionId: run.offer.executionId,
      expectedTaskRevision: run.expectedTaskRevision,
      expectedExecutionRevision: run.expectedExecutionRevision,
      summary: run.resultSummary,
      runtimeProvenance: {
        runtimeId: latestAgent.runtimeId,
        modelId: null,
        startedAt: run.startedAt,
        completedAt: latestAgent.observedAt ?? this.now().toISOString()
      },
      outputs: run.outputs,
      recoveryJournalEntryIds: run.recoveryJournalEntryIds
    }
    const request = restRequestSchema.parse({
      protocolVersion: '1.0', requestId: collaborationRequestId(),
      type: 'task.result.submit',
      idempotencyKey: idempotencyKey('task.result.submit', submissionFacts),
      ...submissionFacts,
      submissionDigest: digest(canonicalJson(submissionFacts))
    })
    await this.updateRun(run.offer.executionId, { state: 'submitting' })
    const response = await this.options.outbox.enqueueAndWait('task.result', request)
    requireResponseEntity(response, 'task_result_submission')
    await this.updateRun(run.offer.executionId, {
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
    await this.updateRun(run.offer.executionId, { error: safeMessage.slice(0, 4_000) })
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
    const failed = requireResponseEntity(response, 'task_execution')
    await this.updateRun(run.offer.executionId, {
      execution: failed,
      expectedExecutionRevision: failed.revision,
      state: 'failed', completedAt: failedAt,
      error: safeMessage.slice(0, 4_000)
    })
    await this.publishAvailability('online')
  }

  private async rejectOffer(run: CollaborationTaskRun): Promise<void> {
    const decision = run.decision
    if (!decision || decision.decision !== 'reject') throw new Error('Offer rejection decision is missing.')
    const requestFacts = {
      ...offerCommandFacts(run),
      reason: decision.reason,
      safeReasonDetail: decision.safeReasonDetail
    }
    const response = await this.options.outbox.enqueueAndWait('task.offer-decision',
      restRequestSchema.parse({
        protocolVersion: '1.0', requestId: collaborationRequestId(),
        type: 'task.offer.reject',
        idempotencyKey: idempotencyKey('task.offer.reject', requestFacts),
        ...requestFacts
      }))
    const rejected = requireResponseEntity(response, 'task_execution')
    await this.updateRun(run.offer.executionId, {
      execution: rejected,
      expectedExecutionRevision: rejected.revision,
      state: 'rejected', completedAt: this.now().toISOString(),
      error: decision.safeReasonDetail ?? `Offer rejected: ${decision.reason}.`
    })
    await this.publishAvailability('online')
  }

  private async prepareAutomaticRejection(
    run: CollaborationTaskRun,
    rejection: Readonly<{ reason: TaskOfferRejectionReason; detail: string | null }>
  ): Promise<void> {
    await this.updateRun(run.offer.executionId, {
      decision: {
        decision: 'reject',
        reason: rejection.reason,
        safeReasonDetail: rejection.reason === 'other' ? rejection.detail : null,
        decidedAt: this.now().toISOString()
      },
      state: 'accepting',
      error: rejection.detail
    })
  }

  private async refreshPreflight(run: CollaborationTaskRun) {
    const response = await this.options.connection.executeAsAgent(restRequestSchema.parse({
      protocolVersion: '1.0', requestId: collaborationRequestId(),
      type: 'task.execution.preflight.get',
      taskId: run.offer.taskId,
      executionId: run.offer.executionId,
      expectedTaskRevision: run.expectedTaskRevision,
      expectedExecutionRevision: run.expectedExecutionRevision
    }))
    if (response.type === 'rest.error') throw new Error(response.error.message)
    if (response.type !== 'rest.task_execution_preflight') {
      throw new Error(`Task preflight returned unexpected ${response.type}.`)
    }
    const cloud = response.preflight
    const task = await this.readTask(run.offer.taskId)
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
    if (cloud.execution.fileIntent && uniqueReasons.length === 0) {
      const content = await this.preflightContentTransfers(this.requireRun(run.offer.executionId))
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
    }
    return local
  }

  private async preflightContentTransfers(run: CollaborationTaskRun): Promise<Readonly<{
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
            systemExecutionContext: systemExecutionContext(run)
          }
        )
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
      if (!run) return
      await this.updateRun(event.executionId, {
        expectedExecutionRevision: Math.max(run.expectedExecutionRevision, event.revision)
      })
      this.schedule(event.executionId)
      return
    }
    if (!('projectId' in event)) return
    for (const run of this.options.store.snapshot().taskRuns) {
      if (run.offer.projectId === event.projectId && !TERMINAL_RUN_STATES.has(run.state)) {
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
    } else if (execution.state === 'rejected') {
      await this.updateRun(run.offer.executionId, { execution, state: 'rejected', completedAt: now })
    } else if (['failed', 'cancelled', 'revoked', 'superseded', 'timed_out'].includes(execution.state)) {
      await this.updateRun(run.offer.executionId, {
        execution,
        state: execution.state === 'failed' ? 'failed' : 'fenced',
        completedAt: now,
        error: `Cloud execution is ${execution.state}.`
      })
    }
  }

  private async markFenced(run: CollaborationTaskRun, error: string): Promise<void> {
    this.controllers.get(run.offer.executionId)?.abort(error)
    await this.updateRun(run.offer.executionId, {
      state: 'fenced', completedAt: this.now().toISOString(), error: error.slice(0, 4_000)
    })
  }

  private async recordLateOutcome(
    executionId: string,
    logicalInvocationId: string,
    outcome: 'completed_after_fence' | 'failed_after_fence',
    detail: unknown
  ): Promise<void> {
    const observedAt = this.now().toISOString()
    await this.options.store.transact((draft) => {
      const run = requireDraftRun(draft.taskRuns, executionId)
      run.lateOutcomes.push({
        source: 'agent_runtime', logicalInvocationId, outcome, observedAt,
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

function offerCommandFacts(run: CollaborationTaskRun) {
  return {
    taskOfferId: run.offer.taskOfferId,
    taskId: run.offer.taskId,
    executionId: run.offer.executionId,
    expectedTaskRevision: run.expectedTaskRevision,
    expectedExecutionRevision: run.expectedExecutionRevision,
    expectedOfferRevision: run.offer.offerRevision
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

function rejectionForPreflight(reasons: readonly string[]): Readonly<{
  reason: TaskOfferRejectionReason
  detail: string | null
}> {
  if (reasons.includes('runtime_not_ready')) return { reason: 'runtime_not_ready', detail: null }
  if (reasons.includes('provider_not_ready')) return { reason: 'provider_not_ready', detail: null }
  if (reasons.includes('content_not_ready')) return { reason: 'content_not_ready', detail: null }
  if (reasons.includes('agent_inactive')) return { reason: 'device_inactive', detail: null }
  if (reasons.includes('cloud_denied') || reasons.includes('execution_mismatch')) {
    return { reason: 'membership_not_active', detail: null }
  }
  return { reason: 'other', detail: 'Worker preflight denied the current immutable execution.' }
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
