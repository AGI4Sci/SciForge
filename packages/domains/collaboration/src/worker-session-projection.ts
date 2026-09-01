import { z } from 'zod'
import {
  agentIdSchema,
  deviceIdSchema,
  executionIdSchema,
  projectIdSchema,
  taskExecutionFenceStatusSchema,
  taskExecutionStateSchema,
  taskIdSchema,
  timestampSchema,
  userIdSchema
} from '@sciforge/collaboration-contracts'

export const WORKER_SESSION_PROJECTION_SERVICE_ID =
  'sciforge.collaboration.worker-session-projection' as const
export const WORKER_SESSION_PROJECTION_CONTRACT_VERSION = '1.0.0' as const

export const workerSessionExecutionBindingSchema = z.object({
  schemaVersion: z.literal(1),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  runtimeId: z.string().trim().min(1).max(256),
  threadId: z.string().trim().min(1).max(512),
  workerUserId: userIdSchema,
  assigneeAgentId: agentIdSchema,
  assigneeDeviceId: deviceIdSchema,
  taskRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  executionRevision: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  executionState: taskExecutionStateSchema,
  fenceStatus: taskExecutionFenceStatusSchema,
  projectExecutionAuthorityEpoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  userTaskAuthorityEpoch: z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  updatedAt: timestampSchema
}).strict().readonly()

export type WorkerSessionExecutionBinding = z.infer<
  typeof workerSessionExecutionBindingSchema
>

export type WorkerSessionProjectionService = Readonly<{
  listBindings(): readonly WorkerSessionExecutionBinding[]
}>

export function defineWorkerSessionProjectionService(
  service: WorkerSessionProjectionService
): WorkerSessionProjectionService {
  if (!service || typeof service.listBindings !== 'function') {
    throw new TypeError('Worker Session projection service is invalid.')
  }
  return Object.freeze({
    listBindings: () => Object.freeze(
      service.listBindings().map((binding) => (
        workerSessionExecutionBindingSchema.parse(binding)
      ))
    )
  })
}
