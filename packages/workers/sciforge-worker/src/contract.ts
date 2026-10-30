import { z } from 'zod'
import {
  workspaceHostOperationSchema,
  workspaceHostPayloadSchema,
  workspaceHostEventKindSchema,
  WORKSPACE_HOST_PROTOCOL_VERSION,
  type WorkspaceHostPayload
} from '@sciforge/domain-sdk/workspace-host'

export const SCIFORGE_WORKER_PROTOCOL_VERSION = 1 as const
export const SCIFORGE_WORKER_PACKAGE = '@sciforge/sciforge-worker' as const

export const sciforgeWorkerHelloSchema = z.object({
  type: z.literal('sciforge-worker/hello'),
  protocolVersion: z.literal(SCIFORGE_WORKER_PROTOCOL_VERSION),
  workspaceHostProtocolVersion: z.literal(WORKSPACE_HOST_PROTOCOL_VERSION),
  workerVersion: z.string().trim().min(1).max(128),
  workspaceRoot: z.string().min(1).max(4096),
  capabilities: z.array(workspaceHostOperationSchema).max(256)
}).strict()
export type SciforgeWorkerHello = z.infer<typeof sciforgeWorkerHelloSchema>

export const sciforgeWorkerRequestSchema = z.object({
  type: z.literal('request'), id: z.string().trim().min(1).max(128),
  method: workspaceHostOperationSchema, params: workspaceHostPayloadSchema.optional()
}).strict()
export type SciforgeWorkerRequest = z.infer<typeof sciforgeWorkerRequestSchema>

export const sciforgeWorkerResponseSchema = z.object({
  type: z.literal('response'), id: z.string().trim().min(1).max(128),
  ok: z.boolean(), result: workspaceHostPayloadSchema.optional(),
  error: z.object({code:z.string().trim().min(1).max(128), message:z.string().trim().min(1).max(2000)}).strict().optional()
}).strict().superRefine((v, c) => {
  if (v.ok && v.error) c.addIssue({code:'custom', message:'Successful response cannot include error.'})
  if (!v.ok && !v.error) c.addIssue({code:'custom', message:'Failed response must include error.'})
})
export type SciforgeWorkerResponse = z.infer<typeof sciforgeWorkerResponseSchema>

export const sciforgeWorkerEventSchema = z.object({
  type: z.literal('event'), event: workspaceHostEventKindSchema,
  sequence: z.number().int().min(0), payload: workspaceHostPayloadSchema.optional()
}).strict()
export type SciforgeWorkerEvent = z.infer<typeof sciforgeWorkerEventSchema>

export type SciforgeWorkerFrame = SciforgeWorkerHello | SciforgeWorkerRequest | SciforgeWorkerResponse | SciforgeWorkerEvent
export type SciforgeWorkerValue = WorkspaceHostPayload

export function parseSciforgeWorkerFrame(value: unknown): SciforgeWorkerFrame {
  if (typeof value !== 'object' || value === null || !('type' in value)) throw new Error('Worker frame must be an object with a type.')
  const type = (value as {type?: unknown}).type
  if (type === 'sciforge-worker/hello') return sciforgeWorkerHelloSchema.parse(value)
  if (type === 'request') return sciforgeWorkerRequestSchema.parse(value)
  if (type === 'response') return sciforgeWorkerResponseSchema.parse(value)
  if (type === 'event') return sciforgeWorkerEventSchema.parse(value)
  throw new Error(`Unknown SciForge worker frame type: ${String(type)}`)
}
