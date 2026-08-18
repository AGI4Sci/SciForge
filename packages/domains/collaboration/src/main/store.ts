import { chmod, mkdir, open, readFile, rename, rm } from 'node:fs/promises'
import { dirname } from 'node:path'
import { z } from 'zod'
import {
  agentNodeSchema,
  humanEndpointBindingSchema,
  participantProfileSchema,
  projectSchema,
  providerLocatorSchema,
  remoteSessionProjectionSchema,
  taskSchema,
  userPrincipalSchema
} from '@sciforge/collaboration-contracts'

const timestampSchema = z.iso.datetime({ offset: true })
const opaqueLocalIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,31}_[A-Za-z0-9]{12,64}$/)
const projectionIdSchema = remoteSessionProjectionSchema.shape.projectionId
const userIdSchema = userPrincipalSchema.shape.userId
const endpointIdSchema = humanEndpointBindingSchema.shape.humanEndpointId
const providerMessageIdSchema = z.string().min(1).max(512)

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
  kind: z.enum(['user-message', 'assistant-reply', 'system-status']),
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
  if (item.kind === 'assistant-reply' && item.direction !== 'outbound') {
    context.addIssue({ code: 'custom', path: ['direction'], message: 'Assistant replies are outbound.' })
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
    'agent.heartbeat',
    'inbox.ack'
  ]),
  body: z.record(z.string(), z.json()),
  state: z.enum(['pending', 'sending', 'reconciling', 'delivered', 'failed']),
  attempts: z.number().int().nonnegative().max(1_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  deliveredAt: timestampSchema.optional(),
  error: z.string().trim().min(1).max(4_000).optional()
}).strict().superRefine((entry, context) => {
  if ((entry.state === 'delivered') !== (entry.deliveredAt !== undefined)) {
    context.addIssue({ code: 'custom', path: ['deliveredAt'], message: 'Delivered outbox entry requires deliveredAt.' })
  }
})

export const collaborationTaskRunSchema = z.object({
  task: taskSchema,
  state: z.enum(['offered', 'accepting', 'running', 'reconciling', 'needs-human', 'completed', 'failed', 'stale']),
  runtimeId: z.string().trim().min(1).max(128).optional(),
  threadId: z.string().trim().min(1).max(512).optional(),
  workspaceRoot: z.string().trim().min(1).max(4_096).optional(),
  clientDirectiveId: z.string().trim().min(1).max(256).regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/),
  localTurnId: z.string().trim().min(1).max(512).optional(),
  resultText: z.string().max(32_000).optional(),
  startedAt: timestampSchema.optional(),
  updatedAt: timestampSchema,
  completedAt: timestampSchema.optional(),
  error: z.string().trim().min(1).max(4_000).optional()
}).strict()

export const collaborationDiagnosticRecordSchema = z.object({
  code: z.string().trim().min(1).max(128),
  severity: z.enum(['info', 'warning', 'error']),
  message: z.string().trim().min(1).max(4_000),
  occurredAt: timestampSchema,
  recoverable: z.boolean()
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
  agents: z.array(agentNodeSchema).max(64),
  participant: participantProfileSchema.optional(),
  projections: z.array(collaborationLocalProjectionSchema).max(10_000),
  projects: z.array(projectSchema).max(10_000),
  tasks: z.array(taskSchema).max(100_000),
  taskRuns: z.array(collaborationTaskRunSchema).max(100_000),
  queue: z.array(collaborationQueueItemSchema).max(100_000),
  receipts: z.array(collaborationLocalReceiptSchema).max(200_000),
  outbox: z.array(collaborationOutboxEntrySchema).max(100_000),
  diagnostics: z.array(collaborationDiagnosticRecordSchema).max(256)
}).strict()

export type CollaborationLocalState = z.infer<typeof collaborationLocalStateSchema>
export type CollaborationLocalProjection = z.infer<typeof collaborationLocalProjectionSchema>
export type CollaborationQueueItem = z.infer<typeof collaborationQueueItemSchema>
export type CollaborationLocalReceipt = z.infer<typeof collaborationLocalReceiptSchema>
export type CollaborationOutboxEntry = z.infer<typeof collaborationOutboxEntrySchema>
export type CollaborationTaskRun = z.infer<typeof collaborationTaskRunSchema>

export const EMPTY_COLLABORATION_LOCAL_STATE: CollaborationLocalState = Object.freeze({
  schemaVersion: 1,
  revision: 0,
  lastInboxSequence: 0,
  endpoints: [],
  endpointLocators: [],
  agents: [],
  projections: [],
  projects: [],
  tasks: [],
  taskRuns: [],
  queue: [],
  receipts: [],
  outbox: [],
  diagnostics: []
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
    for (const run of draft.taskRuns) {
      if (run.state !== 'accepting' && run.state !== 'running') continue
      run.state = 'reconciling'
      run.updatedAt = recoveredAt
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
