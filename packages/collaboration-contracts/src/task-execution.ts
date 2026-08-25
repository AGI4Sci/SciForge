import { z } from 'zod'

import {
  agentIdSchema,
  deviceIdSchema,
  entityMetadataShape,
  executionIdSchema,
  projectIdSchema,
  resultSubmissionIdSchema,
  revisionSchema,
  taskIdSchema,
  taskOfferIdSchema,
  timestampSchema,
  userIdSchema
} from './core.js'
import { taskExecutionFileIntentSchema } from './content-space-task-io.js'

export const taskExecutionStateSchema = z.enum([
  'offered',
  'accepted',
  'rejected',
  'running',
  'needs_human',
  'result_submitted',
  'manual_recovery_required',
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'revoked',
  'superseded'
])
export type TaskExecutionState = z.infer<typeof taskExecutionStateSchema>

export const taskExecutionFenceStatusSchema = z.enum(['open', 'fenced'])
export const taskExecutionFenceReasonSchema = z.enum([
  'offer_rejected',
  'offer_withdrawn',
  'offer_timed_out',
  'result_submitted',
  'reassigned',
  'device_revoked',
  'agent_revoked',
  'membership_removal_pending',
  'membership_removed',
  'project_paused',
  'project_terminal',
  'execution_failed',
  'execution_cancelled',
  'manual_recovery_required',
  'manual_recovery_abandoned',
  'completed'
])
export type TaskExecutionFenceReason = z.infer<typeof taskExecutionFenceReasonSchema>

export const taskExecutionFenceSchema = z.object({
  schemaVersion: z.literal(1),
  executionId: executionIdSchema,
  assigneeUserId: userIdSchema,
  assigneeAgentId: agentIdSchema,
  assigneeDeviceId: deviceIdSchema,
  assignmentTaskRevision: revisionSchema,
  projectExecutionAuthorityEpoch: revisionSchema,
  userTaskAuthorityEpoch: revisionSchema,
  bindingRevision: revisionSchema.nullable(),
  status: taskExecutionFenceStatusSchema,
  reason: taskExecutionFenceReasonSchema.nullable(),
  fencedAt: timestampSchema.nullable()
}).strict().superRefine((fence, context) => {
  const fenced = fence.status === 'fenced'
  if (fenced !== (fence.reason !== null && fence.fencedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'A fenced execution requires its bounded reason and fence time; an open fence has neither.'
    })
  }
})
export type TaskExecutionFence = z.infer<typeof taskExecutionFenceSchema>

/** One immutable assignment attempt. Reassignment always creates another executionId. */
export const taskExecutionSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('task_execution'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  attempt: z.number().int().min(1).max(101),
  offeredByCoordinatorAgentId: agentIdSchema,
  assigneeUserId: userIdSchema,
  assigneeAgentId: agentIdSchema,
  assigneeDeviceId: deviceIdSchema,
  state: taskExecutionStateSchema,
  stateRevision: revisionSchema,
  fence: taskExecutionFenceSchema,
  fileIntent: taskExecutionFileIntentSchema.nullable(),
  currentResultSubmissionId: resultSubmissionIdSchema.nullable(),
  offeredAt: timestampSchema,
  acceptedAt: timestampSchema.nullable(),
  startedAt: timestampSchema.nullable(),
  terminalAt: timestampSchema.nullable()
}).strict().superRefine((execution, context) => {
  if (
    execution.fence.executionId !== execution.executionId ||
    execution.fence.assigneeUserId !== execution.assigneeUserId ||
    execution.fence.assigneeAgentId !== execution.assigneeAgentId ||
    execution.fence.assigneeDeviceId !== execution.assigneeDeviceId
  ) {
    context.addIssue({
      code: 'custom',
      path: ['fence'],
      message: 'Execution fence identity must match the immutable assignment attempt.'
    })
  }
  if ((execution.fileIntent === null) !== (execution.fence.bindingRevision === null)) {
    context.addIssue({
      code: 'custom',
      path: ['fence', 'bindingRevision'],
      message: 'Only a file execution carries a Project content binding revision.'
    })
  }
  if (execution.fileIntent !== null) {
    if (
      execution.fileIntent.projectId !== execution.projectId ||
      execution.fileIntent.taskId !== execution.taskId ||
      execution.fileIntent.executionId !== execution.executionId ||
      execution.fileIntent.bindingRevision !== execution.fence.bindingRevision ||
      execution.fileIntent.assignmentTaskRevision !== execution.fence.assignmentTaskRevision
    ) {
      context.addIssue({
        code: 'custom',
        path: ['fileIntent'],
        message: 'Execution file intent must match the exact execution fence and revisions.'
      })
    }
  }

  const acceptanceRequired = execution.state === 'accepted' ||
    execution.state === 'running' ||
    execution.state === 'needs_human' ||
    execution.state === 'result_submitted' ||
    execution.state === 'manual_recovery_required' ||
    execution.state === 'completed' ||
    execution.state === 'failed'
  const acceptanceForbidden = execution.state === 'offered' ||
    execution.state === 'rejected' ||
    execution.state === 'timed_out'
  if (acceptanceRequired && execution.acceptedAt === null) {
    context.addIssue({
      code: 'custom',
      path: ['acceptedAt'],
      message: 'This execution state requires its preserved acceptance time.'
    })
  }
  if (acceptanceForbidden && execution.acceptedAt !== null) {
    context.addIssue({
      code: 'custom',
      path: ['acceptedAt'],
      message: 'An unaccepted offer cannot have an acceptance time.'
    })
  }
  const startRequired = execution.state === 'running' ||
    execution.state === 'needs_human' ||
    execution.state === 'result_submitted' ||
    execution.state === 'manual_recovery_required' ||
    execution.state === 'completed'
  const startForbidden = execution.state === 'offered' ||
    execution.state === 'accepted' ||
    execution.state === 'rejected' ||
    execution.state === 'timed_out'
  if (startRequired && execution.startedAt === null) {
    context.addIssue({
      code: 'custom',
      path: ['startedAt'],
      message: 'This execution state requires its preserved start time.'
    })
  }
  if (startForbidden && execution.startedAt !== null) {
    context.addIssue({
      code: 'custom',
      path: ['startedAt'],
      message: 'An execution that never started cannot have a start time.'
    })
  }
  const terminal = execution.state === 'rejected' ||
    execution.state === 'result_submitted' ||
    execution.state === 'manual_recovery_required' ||
    execution.state === 'completed' ||
    execution.state === 'failed' ||
    execution.state === 'cancelled' ||
    execution.state === 'timed_out' ||
    execution.state === 'revoked' ||
    execution.state === 'superseded'
  if (terminal && (execution.terminalAt === null || execution.fence.status !== 'fenced')) {
    context.addIssue({
      code: 'custom',
      path: ['terminalAt'],
      message: 'A write-terminal execution must be durably fenced with its terminal time.'
    })
  }
  if (!terminal && (execution.terminalAt !== null || execution.fence.status !== 'open')) {
    context.addIssue({
      code: 'custom',
      path: ['fence'],
      message: 'A live execution must keep an open fence and no terminal time.'
    })
  }
  const resultRequired = execution.state === 'result_submitted' || execution.state === 'completed'
  const resultAllowed = resultRequired || execution.state === 'superseded'
  if (resultRequired && execution.currentResultSubmissionId === null) {
    context.addIssue({
      code: 'custom',
      path: ['currentResultSubmissionId'],
      message: 'Submitted and completed execution states retain the immutable result submission.'
    })
  }
  if (!resultAllowed && execution.currentResultSubmissionId !== null) {
    context.addIssue({
      code: 'custom',
      path: ['currentResultSubmissionId'],
      message: 'Only a submitted, completed or superseded result path may identify a result submission.'
    })
  }
})
export type TaskExecution = z.infer<typeof taskExecutionSchema>

export const taskOfferStateSchema = z.enum([
  'pending',
  'accepted',
  'rejected',
  'withdrawn',
  'timed_out'
])
export const taskOfferRejectionReasonSchema = z.enum([
  'runtime_not_ready',
  'provider_not_ready',
  'device_inactive',
  'membership_not_active',
  'content_not_ready',
  'capacity_reached',
  'unsupported_capability',
  'human_rejected',
  'other'
])

export const taskOfferSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('task_offer'),
  taskOfferId: taskOfferIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  assigneeUserId: userIdSchema,
  assigneeAgentId: agentIdSchema,
  assigneeDeviceId: deviceIdSchema,
  state: taskOfferStateSchema,
  offeredAt: timestampSchema,
  expiresAt: timestampSchema,
  respondedAt: timestampSchema.nullable(),
  rejectionReason: taskOfferRejectionReasonSchema.nullable(),
  safeReasonDetail: z.string().trim().min(1).max(500).nullable()
}).strict().superRefine((offer, context) => {
  if (Date.parse(offer.expiresAt) <= Date.parse(offer.offeredAt)) {
    context.addIssue({ code: 'custom', path: ['expiresAt'], message: 'Task offer expiry must follow its creation.' })
  }
  const responded = offer.state !== 'pending'
  if (responded !== (offer.respondedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['respondedAt'], message: 'Only a terminal offer has a response time.' })
  }
  if ((offer.state === 'rejected') !== (offer.rejectionReason !== null)) {
    context.addIssue({ code: 'custom', path: ['rejectionReason'], message: 'Only a rejected offer has a bounded rejection reason.' })
  }
  if (offer.rejectionReason === 'other' && offer.safeReasonDetail === null) {
    context.addIssue({ code: 'custom', path: ['safeReasonDetail'], message: 'Other rejection requires a bounded safe detail.' })
  }
  if (offer.state !== 'rejected' && offer.safeReasonDetail !== null) {
    context.addIssue({ code: 'custom', path: ['safeReasonDetail'], message: 'Only a rejected offer may carry safe detail.' })
  }
})
export type TaskOffer = z.infer<typeof taskOfferSchema>
