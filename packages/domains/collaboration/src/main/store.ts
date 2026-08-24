import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  agentNodeSchema,
  cloudResourceRefSchema,
  externalOperationRecoveryJournalEntrySchema,
  humanAnswerSchema,
  humanEndpointBindingSchema,
  managedProviderContainerSchema,
  participantProfileSchema,
  projectSchema,
  providerLocatorSchema,
  remoteSessionProjectionSchema,
  taskExecutionPreflightSchema,
  taskExecutionSchema,
  taskOfferRejectionReasonSchema,
  taskResultOutputSchema,
  taskSchema,
  userPrincipalSchema
} from '@sciforge/collaboration-contracts'

const timestampSchema = z.iso.datetime({ offset: true })
const opaqueLocalIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,31}_[A-Za-z0-9]{12,64}$/)
const projectionIdSchema = remoteSessionProjectionSchema.shape.projectionId
const userIdSchema = userPrincipalSchema.shape.userId
const endpointIdSchema = humanEndpointBindingSchema.shape.humanEndpointId
const providerMessageIdSchema = z.string().min(1).max(512)

export const collaborationWorkerAcceptanceModeSchema = z.enum(['manual', 'automatic'])
export const collaborationWorkerAcceptancePolicySchema = z.object({
  agentId: agentNodeSchema.shape.agentId,
  mode: collaborationWorkerAcceptanceModeSchema,
  updatedAt: timestampSchema
}).strict()

export const collaborationLocalProjectionSchema = z.object({
  projection: remoteSessionProjectionSchema,
  runtimeId: z.string().trim().min(1).max(128),
  threadId: z.string().trim().min(1).max(512).optional(),
  workspaceRoot: z.string().trim().min(1).max(4_096).optional(),
  bindingMode: z.enum(['existing', 'new']),
  nextSequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  lastSynchronizedAt: timestampSchema.optional(),
  lastError: z.string().trim().min(1).max(4_000).optional()
}).strict().superRefine((record, context) => {
  if (record.bindingMode === 'existing' && !record.threadId) {
    context.addIssue({
      code: 'custom',
      path: ['threadId'],
      message: 'Existing Session projection requires its exact local thread.'
    })
  }
})

export const collaborationQueueItemSchema = z.object({
  queueItemId: opaqueLocalIdSchema,
  projectionId: projectionIdSchema,
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  direction: z.enum(['inbound', 'outbound']),
  origin: z.enum(['desktop', 'human-endpoint', 'agent', 'system']),
  kind: z.enum(['user-message', 'assistant-progress', 'assistant-reply', 'system-status']),
  senderUserId: userIdSchema.optional(),
  senderHumanEndpointId: endpointIdSchema.optional(),
  providerMessageId: providerMessageIdSchema.optional(),
  localItemId: z.string().trim().min(1).max(512).optional(),
  clientDirectiveId: z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/).optional(),
  remoteMessageId: providerMessageIdSchema.optional(),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  text: z.string().min(1).max(32_000),
  state: z.enum([
    'queued',
    'executing',
    'reconciling',
    'awaiting-approval',
    'delivering',
    'completed',
    'failed',
    'ignored'
  ]),
  attempts: z.number().int().nonnegative().max(1_000),
  turnId: z.string().trim().min(1).max(512).optional(),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  completedAt: timestampSchema.optional(),
  error: z.string().trim().min(1).max(4_000).optional()
}).strict().superRefine((item, context) => {
  const remoteInbound = item.direction === 'inbound' && item.origin === 'human-endpoint'
  if (remoteInbound !== Boolean(item.senderHumanEndpointId && item.providerMessageId)) {
    context.addIssue({
      code: 'custom',
      message: 'Human endpoint inbound messages require exact endpoint and provider message identity.'
    })
  }
  if ((item.kind === 'assistant-progress' || item.kind === 'assistant-reply') && item.direction !== 'outbound') {
    context.addIssue({ code: 'custom', path: ['direction'], message: 'Assistant messages are outbound.' })
  }
  const terminal = ['completed', 'failed', 'ignored'].includes(item.state)
  if (terminal !== (item.completedAt !== undefined)) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Terminal queue state requires completedAt.' })
  }
})

export const collaborationLocalReceiptSchema = z.object({
  receiptKey: z.string().trim().min(1).max(1_024),
  contentHash: z.string().regex(/^[a-f0-9]{64}$/),
  queueItemId: opaqueLocalIdSchema,
  projectionId: projectionIdSchema,
  status: z.enum(['accepted', 'processing', 'completed', 'delivered', 'failed', 'ignored']),
  providerMessageId: providerMessageIdSchema.optional(),
  localItemId: z.string().trim().min(1).max(512).optional(),
  remoteMessageId: providerMessageIdSchema.optional(),
  turnId: z.string().trim().min(1).max(512).optional(),
  attempts: z.number().int().nonnegative().max(1_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict()

export const collaborationOutboxEntrySchema = z.object({
  outboxId: opaqueLocalIdSchema,
  idempotencyKey: z.string().min(16).max(128).regex(/^idem_[A-Za-z0-9._:-]+$/),
  kind: z.enum([
    'projection.command',
    'projection.message',
    'projection.status',
    'task.accepted',
    'task.progress',
    'task.result',
    'task.failed',
    'task.offer-decision',
    'task.external-operation',
    'task.human-needed',
    'coordinator.command',
    'worker.availability',
    'agent.heartbeat',
    'inbox.ack',
    'capability.approval.create',
    'capability.approval.result',
    'capability.approval.withdraw'
  ]),
  body: z.record(z.string(), z.json()),
  state: z.enum(['pending', 'sending', 'reconciling', 'delivered', 'failed']),
  attempts: z.number().int().nonnegative().max(1_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deliveredAt: timestampSchema.optional(),
  response: z.record(z.string(), z.json()).optional(),
  error: z.string().trim().min(1).max(4_000).optional()
}).strict().superRefine((entry, context) => {
  if ((entry.state === 'delivered') !== (entry.deliveredAt !== undefined)) {
    context.addIssue({ code: 'custom', path: ['deliveredAt'], message: 'Delivered outbox entry requires deliveredAt.' })
  }
  if (entry.response !== undefined && entry.state !== 'delivered') {
    context.addIssue({
      code: 'custom',
      path: ['response'],
      message: 'Only a delivered outbox command may retain its strict Cloud response.'
    })
  }
})

const taskExecutionIdSchema = taskExecutionSchema.shape.executionId
const taskOfferIdSchema = z.string()
  .regex(/^ofr_[A-Za-z0-9](?:[A-Za-z0-9_]{10,62}[A-Za-z0-9])$/u)
const localInvocationIdSchema = z.string().trim().min(1).max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
const clientDirectiveIdSchema = z.string().trim().min(1).max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)

const collaborationContentTransferPreflightObservationSchema = z.object({
  operation: z.enum(['download', 'upload-new']),
  status: z.enum(['ready', 'provider_not_ready', 'principal_stale', 'binding_stale']),
  intentDigest: sha256Schema,
  observationRevision: sha256Schema
}).strict()

export const collaborationTaskOfferJournalSchema = z.object({
  projectId: projectSchema.shape.projectId,
  taskId: taskSchema.shape.taskId,
  executionId: taskExecutionIdSchema,
  taskOfferId: taskOfferIdSchema,
  currentTaskRevision: taskSchema.shape.revision,
  currentExecutionRevision: taskExecutionSchema.shape.revision,
  offerRevision: taskSchema.shape.revision,
  recipientAgentId: agentNodeSchema.shape.agentId,
  receivedAt: timestampSchema
}).strict()

export const collaborationWorkerPreflightSchema = z.object({
  cloud: taskExecutionPreflightSchema,
  outcome: z.enum(['allowed', 'denied']),
  reasons: z.array(z.enum([
    'cloud_denied',
    'runtime_not_ready',
    'provider_not_ready',
    'content_not_ready',
    'agent_inactive',
    'execution_mismatch'
  ])).max(16),
  contentTransferReadiness: z.array(
    collaborationContentTransferPreflightObservationSchema
  ).max(101),
  evaluatedAt: timestampSchema
}).strict().superRefine((preflight, context) => {
  if ((preflight.outcome === 'allowed') !== (preflight.reasons.length === 0)) {
    context.addIssue({
      code: 'custom',
      path: ['reasons'],
      message: 'An allowed local preflight has no denial reasons.'
    })
  }
})

export const collaborationTaskOfferDecisionSchema = z.discriminatedUnion('decision', [
  z.object({
    decision: z.literal('accept'),
    decidedAt: timestampSchema
  }).strict(),
  z.object({
    decision: z.literal('reject'),
    reason: taskOfferRejectionReasonSchema,
    safeReasonDetail: z.string().trim().min(1).max(500).nullable(),
    decidedAt: timestampSchema
  }).strict().superRefine((decision, context) => {
    if ((decision.reason === 'other') !== (decision.safeReasonDetail !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['safeReasonDetail'],
        message: 'Only other rejection requires a bounded safe detail.'
      })
    }
  })
])

export const collaborationAgentInvocationJournalSchema = z.object({
  logicalInvocationId: localInvocationIdSchema,
  clientDirectiveId: clientDirectiveIdSchema,
  state: z.enum([
    'prepared',
    'dispatched',
    'observed_success',
    'observed_failure',
    'late_outcome'
  ]),
  preparedAt: timestampSchema,
  dispatchedAt: timestampSchema.nullable(),
  observedAt: timestampSchema.nullable(),
  runtimeId: z.string().trim().min(1).max(128).nullable(),
  threadId: z.string().trim().min(1).max(512).nullable(),
  turnId: z.string().trim().min(1).max(512).nullable(),
  runtimeState: z.enum(['completed', 'failed', 'cancelled']).nullable(),
  safeResultText: z.string().max(32_000).nullable(),
  safeError: z.string().trim().min(1).max(4_000).nullable()
}).strict().superRefine((entry, context) => {
  const dispatched = entry.state !== 'prepared'
  if (dispatched !== (entry.dispatchedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['dispatchedAt'], message: 'Dispatched Agent work requires dispatch time.' })
  }
  const observed = entry.state === 'observed_success' ||
    entry.state === 'observed_failure' || entry.state === 'late_outcome'
  if (observed !== (entry.observedAt !== null && entry.runtimeState !== null)) {
    context.addIssue({ code: 'custom', path: ['observedAt'], message: 'Observed Agent work requires exact outcome facts.' })
  }
})

export const collaborationExternalOperationJournalSchema = z.object({
  logicalInvocationId: localInvocationIdSchema,
  operation: z.enum(['download', 'upload_new']),
  workspaceRelativePath: z.string().trim().min(1).max(4_096),
  requestDigest: sha256Schema,
  state: z.enum([
    'prepared',
    'cloud_prepared',
    'cloud_dispatched',
    'effect_dispatched',
    'observed_success',
    'observed_failure',
    'outcome_unknown',
    'late_outcome'
  ]),
  cloudJournal: externalOperationRecoveryJournalEntrySchema.nullable(),
  receiptDigest: sha256Schema.nullable(),
  observationDigest: sha256Schema.nullable(),
  preparedAt: timestampSchema,
  effectDispatchedAt: timestampSchema.nullable(),
  observedAt: timestampSchema.nullable(),
  safeFailureCode: z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u).nullable(),
  safeError: z.string().trim().min(1).max(4_000).nullable()
}).strict().superRefine((entry, context) => {
  if ((entry.state !== 'prepared') !== (entry.cloudJournal !== null)) {
    context.addIssue({ code: 'custom', path: ['cloudJournal'], message: 'Cloud-prepared work retains its canonical journal entry.' })
  }
  const effectDispatched = ['effect_dispatched', 'observed_success', 'observed_failure', 'outcome_unknown', 'late_outcome']
    .includes(entry.state)
  if (effectDispatched !== (entry.effectDispatchedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['effectDispatchedAt'], message: 'Provider dispatch requires its durable local time.' })
  }
  const observed = ['observed_success', 'observed_failure', 'outcome_unknown', 'late_outcome']
    .includes(entry.state)
  if (observed !== (entry.observedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['observedAt'], message: 'Observed transfer state requires observation time.' })
  }
  const success = entry.state === 'observed_success'
  if (success !== (entry.receiptDigest !== null && entry.observationDigest !== null)) {
    context.addIssue({ code: 'custom', path: ['observationDigest'], message: 'Successful transfer requires exact receipt and observation digests.' })
  }
})

export const collaborationTaskLateOutcomeSchema = z.object({
  source: z.enum(['agent_runtime', 'content_space', 'cloud']),
  logicalInvocationId: localInvocationIdSchema,
  outcome: z.enum(['completed_after_fence', 'failed_after_fence', 'outcome_unknown']),
  observedAt: timestampSchema,
  safeDetail: z.string().trim().min(1).max(4_000)
}).strict()

export const collaborationTaskRunSchema = z.object({
  offer: collaborationTaskOfferJournalSchema,
  task: taskSchema.nullable(),
  execution: taskExecutionSchema.nullable(),
  latestPreflight: collaborationWorkerPreflightSchema.nullable(),
  decision: collaborationTaskOfferDecisionSchema.nullable(),
  expectedTaskRevision: taskSchema.shape.revision,
  expectedExecutionRevision: taskExecutionSchema.shape.revision,
  state: z.enum([
    'offered',
    'awaiting-manual',
    'accepting',
    'running',
    'needs-human',
    'submitting',
    'completed',
    'rejected',
    'failed',
    'fenced',
    'manual-recovery'
  ]),
  workspaceRoot: z.string().trim().min(1).max(4_096),
  runtimeId: z.string().trim().min(1).max(128).nullable(),
  threadId: z.string().trim().min(1).max(512).nullable(),
  humanRequestId: z.string().regex(/^hrq_[A-Za-z0-9]{12,64}$/u).nullable(),
  humanAnswer: humanAnswerSchema.nullable(),
  resources: z.array(cloudResourceRefSchema).max(101),
  agentJournal: z.array(collaborationAgentInvocationJournalSchema).max(1_000),
  externalJournal: z.array(collaborationExternalOperationJournalSchema).max(1_000),
  outputs: z.array(taskResultOutputSchema).max(100),
  recoveryJournalEntryIds: z.array(
    externalOperationRecoveryJournalEntrySchema.shape.contentRecoveryJournalEntryId
  ).max(100),
  resultSummary: z.string().trim().min(1).max(32_000).nullable(),
  lateOutcomes: z.array(collaborationTaskLateOutcomeSchema).max(1_000),
  startedAt: timestampSchema.nullable(),
  updatedAt: timestampSchema,
  completedAt: timestampSchema.nullable(),
  error: z.string().trim().min(1).max(4_000).nullable()
}).strict().superRefine((run, context) => {
  if (run.task && (
    run.task.taskId !== run.offer.taskId || run.task.projectId !== run.offer.projectId
  )) {
    context.addIssue({ code: 'custom', path: ['task'], message: 'Task snapshot must match the immutable offer.' })
  }
  if (run.execution && (
    run.execution.taskId !== run.offer.taskId ||
    run.execution.executionId !== run.offer.executionId ||
    run.execution.assigneeAgentId !== run.offer.recipientAgentId
  )) {
    context.addIssue({ code: 'custom', path: ['execution'], message: 'Execution snapshot must match the immutable offer.' })
  }
  const terminal = ['completed', 'rejected', 'failed', 'fenced', 'manual-recovery'].includes(run.state)
  if (terminal !== (run.completedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Terminal Worker run requires completion time.' })
  }
})

export const collaborationDiagnosticRecordSchema = z.object({
  code: z.string().trim().min(1).max(128),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().trim().min(1).max(4_000),
  occurredAt: timestampSchema,
  recoverable: z.boolean()
}).strict()

export const collaborationLocalRemoteApprovalSchema = z.object({
  desktopApprovalId: z.string().trim().min(1).max(512),
  remoteApprovalId: z.string().regex(/^rap_[A-Za-z0-9]{12,64}$/).optional(),
  projectionId: projectionIdSchema,
  runtimeId: z.string().trim().min(1).max(128),
  threadId: z.string().trim().min(1).max(512),
  turnId: z.string().trim().min(1).max(512),
  capabilityRequestId: z.string().trim().min(1).max(512),
  safeSummary: z.string().trim().min(1).max(500),
  effect: z.enum(['workspace-write', 'external-write', 'destructive']),
  remoteEligible: z.boolean(),
  expiresAt: timestampSchema,
  decisionId: z.string().trim().min(1).max(512).optional(),
  decision: z.enum(['allow_once', 'deny_once']).optional(),
  outcome: z.enum(['applied', 'already_terminal', 'not_pending', 'not_eligible']).optional(),
  state: z.enum(['creating', 'pending', 'deciding', 'reporting', 'completed', 'failed']),
  createdAt: timestampSchema,
  updatedAt: timestampSchema
}).strict()

export const collaborationLocalStateSchema = z.object({
  schemaVersion: z.literal(1),
  revision: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  lastInboxSequence: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  user: userPrincipalSchema.optional(),
  endpoints: z.array(humanEndpointBindingSchema).max(64),
  endpointLocators: z.array(z.object({
    humanEndpointId: humanEndpointBindingSchema.shape.humanEndpointId,
    locator: providerLocatorSchema
  }).strict()).max(10_000),
  managedContainers: z.array(managedProviderContainerSchema).max(64).default([]),
  agents: z.array(agentNodeSchema).max(64),
  participant: participantProfileSchema.optional(),
  projections: z.array(collaborationLocalProjectionSchema).max(10_000),
  projects: z.array(projectSchema).max(10_000),
  tasks: z.array(taskSchema).max(100_000),
  taskRuns: z.array(collaborationTaskRunSchema).max(100_000),
  workerAcceptancePolicies: z.array(collaborationWorkerAcceptancePolicySchema)
    .max(64)
    .default([])
    .superRefine((policies, context) => {
      const seen = new Set<string>()
      for (const [index, policy] of policies.entries()) {
        if (seen.has(policy.agentId)) {
          context.addIssue({
            code: 'custom',
            path: [index, 'agentId'],
            message: 'Each local Agent Device has exactly one acceptance policy.'
          })
        }
        seen.add(policy.agentId)
      }
    }),
  queue: z.array(collaborationQueueItemSchema).max(100_000),
  receipts: z.array(collaborationLocalReceiptSchema).max(200_000),
  outbox: z.array(collaborationOutboxEntrySchema).max(100_000),
  diagnostics: z.array(collaborationDiagnosticRecordSchema).max(256),
  remoteApprovals: z.array(collaborationLocalRemoteApprovalSchema).max(10_000).default([])
}).strict()

export type CollaborationLocalState = z.infer<typeof collaborationLocalStateSchema>
export type CollaborationLocalProjection = z.infer<typeof collaborationLocalProjectionSchema>
export type CollaborationQueueItem = z.infer<typeof collaborationQueueItemSchema>
export type CollaborationLocalReceipt = z.infer<typeof collaborationLocalReceiptSchema>
export type CollaborationOutboxEntry = z.infer<typeof collaborationOutboxEntrySchema>
export type CollaborationTaskRun = z.infer<typeof collaborationTaskRunSchema>
export type CollaborationExternalOperationJournal = z.infer<
  typeof collaborationExternalOperationJournalSchema
>
export type CollaborationWorkerAcceptanceMode = z.infer<
  typeof collaborationWorkerAcceptanceModeSchema
>
export type CollaborationWorkerAcceptancePolicy = z.infer<
  typeof collaborationWorkerAcceptancePolicySchema
>
export type CollaborationLocalRemoteApproval = z.infer<typeof collaborationLocalRemoteApprovalSchema>

export const EMPTY_COLLABORATION_LOCAL_STATE: CollaborationLocalState = Object.freeze({
  schemaVersion: 1,
  revision: 0,
  lastInboxSequence: 0,
  endpoints: [],
  endpointLocators: [],
  managedContainers: [],
  agents: [],
  projections: [],
  projects: [],
  tasks: [],
  taskRuns: [],
  workerAcceptancePolicies: [],
  queue: [],
  receipts: [],
  outbox: [],
  diagnostics: [],
  remoteApprovals: []
})

export interface CollaborationStateBackend {
  read(): Promise<unknown | undefined>
  write(value: CollaborationLocalState): Promise<void>
}

export class FileCollaborationStateBackend implements CollaborationStateBackend {
  constructor(private readonly path: string) {}

  async read(): Promise<unknown | undefined> {
    try {
      return JSON.parse(await readFile(this.path, 'utf8')) as unknown
    } catch (error) {
      if (isNodeError(error) && error.code === 'ENOENT') return undefined
      throw error
    }
  }

  async write(value: CollaborationLocalState): Promise<void> {
    const directoryPath = dirname(this.path)
    await mkdir(directoryPath, { recursive: true, mode: 0o700 })
    await chmod(directoryPath, 0o700)
    const temporaryPath = `${this.path}.tmp-${process.pid}-${Date.now()}`
    try {
      const handle = await open(temporaryPath, 'wx', 0o600)
      try {
        await handle.writeFile(`${JSON.stringify(value)}\n`, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
      await rename(temporaryPath, this.path)
      await chmod(this.path, 0o600)
      const directory = await open(directoryPath, 'r')
      try {
        await directory.sync().catch((error: unknown) => {
          if (!isUnsupportedDirectorySync(error)) throw error
        })
      } finally {
        await directory.close()
      }
    } finally {
      await rm(temporaryPath, { force: true }).catch(() => undefined)
    }
  }
}

export class CollaborationLocalStore {
  private state: CollaborationLocalState | null = null
  private transactionTail: Promise<void> = Promise.resolve()

  constructor(private readonly backend: CollaborationStateBackend) {}

  async open(): Promise<CollaborationLocalState> {
    if (this.state) return structuredClone(this.state)
    const stored = await this.backend.read()
    this.state = stored === undefined
      ? structuredClone(EMPTY_COLLABORATION_LOCAL_STATE)
      : collaborationLocalStateSchema.parse(stored)
    await this.recoverInterruptedWork()
    return this.snapshot()
  }

  snapshot(): CollaborationLocalState {
    if (!this.state) throw new Error('Collaboration store is not open.')
    return structuredClone(this.state)
  }

  async transact<Result>(
    update: (draft: CollaborationLocalState) => Result | Promise<Result>
  ): Promise<Result> {
    let resolveResult!: (value: Result | PromiseLike<Result>) => void
    let rejectResult!: (reason?: unknown) => void
    const result = new Promise<Result>((resolve, reject) => {
      resolveResult = resolve
      rejectResult = reject
    })
    this.transactionTail = this.transactionTail.then(async () => {
      try {
        if (!this.state) await this.open()
        const draft = structuredClone(this.state!)
        const value = await update(draft)
        draft.revision += 1
        const parsed = collaborationLocalStateSchema.parse(draft)
        await this.backend.write(parsed)
        this.state = parsed
        resolveResult(value)
      } catch (error) {
        rejectResult(error)
      }
    })
    return result
  }

  private async recoverInterruptedWork(): Promise<void> {
    if (!this.state) return
    let changed = false
    const recoveredAt = new Date().toISOString()
    const draft = structuredClone(this.state)
    for (const item of draft.queue) {
      if (item.state === 'executing') {
        item.state = 'reconciling'
        item.updatedAt = recoveredAt
        changed = true
      } else if (item.state === 'delivering') {
        item.state = 'queued'
        item.updatedAt = recoveredAt
        changed = true
      }
    }
    for (const entry of draft.outbox) {
      if (entry.state !== 'sending') continue
      entry.state = 'reconciling'
      entry.updatedAt = recoveredAt
      changed = true
    }
    if (!changed) return
    draft.revision += 1
    const parsed = collaborationLocalStateSchema.parse(draft)
    await this.backend.write(parsed)
    this.state = parsed
  }
}

function isUnsupportedDirectorySync(error: unknown): boolean {
  if (!isNodeError(error)) return false
  if (['EINVAL', 'ENOTSUP', 'EISDIR'].includes(error.code ?? '')) return true
  return process.platform === 'win32' && error.code === 'EPERM'
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error
}
