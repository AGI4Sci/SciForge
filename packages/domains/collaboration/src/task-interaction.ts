import { z } from 'zod'
import {
  projectSchema,
  taskExecutionSchema,
  taskSchema
} from '@sciforge/collaboration-contracts'

const timestampSchema = z.iso.datetime({ offset: true })
const opaqueLocalIdSchema = z.string().regex(/^[a-z][a-z0-9-]{2,31}_[A-Za-z0-9]{12,64}$/u)
const localIdempotencyKeySchema = z.string().min(16).max(128)
  .regex(/^idem_[A-Za-z0-9._:-]+$/u)
const clientDirectiveIdSchema = z.string().trim().min(1).max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)
const taskExecutionIdSchema = taskExecutionSchema.shape.executionId

/** Local-only human/agent intent journal. Cloud task state is never replaced by this. */
export const collaborationTaskInteractionSchema = z.object({
  interactionId: opaqueLocalIdSchema,
  idempotencyKey: localIdempotencyKeySchema,
  projectId: projectSchema.shape.projectId,
  taskId: taskSchema.shape.taskId,
  executionId: taskExecutionIdSchema.nullable(),
  kind: z.enum(['guidance', 'pause', 'resume', 'cancel', 'retry']),
  origin: z.enum(['human', 'agent', 'system']),
  text: z.string().trim().min(1).max(32_000).nullable(),
  clientDirectiveId: clientDirectiveIdSchema.nullable(),
  state: z.enum([
    'queued',
    'dispatching',
    'awaiting_cloud',
    'applied',
    'rejected',
    'failed',
    'superseded'
  ]),
  attempts: z.number().int().nonnegative().max(1_000),
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
  dispatchedAt: timestampSchema.nullable(),
  completedAt: timestampSchema.nullable(),
  error: z.string().trim().min(1).max(4_000).nullable()
}).strict().superRefine((interaction, context) => {
  if (interaction.kind === 'guidance' && interaction.text === null) {
    context.addIssue({ code: 'custom', path: ['text'], message: 'Guidance interactions require human-readable text.' })
  }
  if (interaction.state === 'queued' && interaction.dispatchedAt !== null) {
    context.addIssue({ code: 'custom', path: ['dispatchedAt'], message: 'A queued interaction cannot have a local dispatch time.' })
  }
  if (['dispatching', 'awaiting_cloud', 'applied'].includes(interaction.state) && interaction.dispatchedAt === null) {
    context.addIssue({ code: 'custom', path: ['dispatchedAt'], message: 'An active or applied interaction requires its local dispatch time.' })
  }
  const terminal = ['applied', 'rejected', 'failed', 'superseded'].includes(interaction.state)
  if (terminal !== (interaction.completedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'A terminal interaction requires its local completion time.' })
  }
  if (['rejected', 'failed'].includes(interaction.state) !== (interaction.error !== null)) {
    context.addIssue({ code: 'custom', path: ['error'], message: 'Rejected or failed interactions require a bounded error.' })
  }
})

/** Append-only local checkpoint for human-readable progress and restart recovery. */
export const collaborationTaskCheckpointSchema = z.object({
  checkpointId: opaqueLocalIdSchema,
  idempotencyKey: localIdempotencyKeySchema,
  projectId: projectSchema.shape.projectId,
  taskId: taskSchema.shape.taskId,
  executionId: taskExecutionIdSchema.nullable(),
  sequence: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  kind: z.enum(['progress', 'partial-result', 'human-note', 'status']),
  source: z.enum(['human', 'agent', 'system']),
  summary: z.string().trim().min(1).max(4_000),
  detail: z.string().trim().min(1).max(32_000).nullable(),
  createdAt: timestampSchema
}).strict()

export type CollaborationTaskInteraction = z.infer<typeof collaborationTaskInteractionSchema>
export type CollaborationTaskCheckpoint = z.infer<typeof collaborationTaskCheckpointSchema>
