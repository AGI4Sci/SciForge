import { z } from 'zod'

export const CHANGE_INSPECTOR_RESOURCE_KIND = 'agent-session-changes'

export const CHANGE_INSPECTOR_CAPABILITY_IDS = Object.freeze({
  openSession: 'change-inspector.open-session'
} as const)

export const changeInspectorStatusSchema = z.enum(['running', 'success', 'error'])

export const changeInspectorChangeSchema = z.object({
  id: z.string().trim().min(1).max(512),
  status: changeInspectorStatusSchema,
  filePath: z.string().trim().min(1).max(4_096).optional(),
  patch: z.string().min(1).max(2_000_000),
  occurredAt: z.string().datetime({ offset: true }).optional()
}).strict()

export type ChangeInspectorChange = z.infer<typeof changeInspectorChangeSchema>

export const changeInspectorSnapshotSchema = z.object({
  sessionId: z.string().trim().min(1).max(256),
  revision: z.string().trim().min(1).max(256),
  changes: z.array(changeInspectorChangeSchema).max(5_000),
  truncated: z.boolean()
}).strict()

export type ChangeInspectorSnapshot = z.infer<typeof changeInspectorSnapshotSchema>

export const changeInspectorOpenInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(256),
  runtimeId: z.string().trim().min(1).max(256)
}).strict()

export type ChangeInspectorOpenInput = z.infer<typeof changeInspectorOpenInputSchema>

export const changeInspectorResourceHandleSchema = z.object({
  token: z.string().regex(/^cap_[A-Za-z0-9_-]{20,}$/u),
  semanticRevision: z.string().trim().min(1).max(256),
  expiresAt: z.string().datetime({ offset: true })
}).strict()

export const changeInspectorOpenOutputSchema = z.object({
  resource: changeInspectorResourceHandleSchema,
  sessionId: z.string().trim().min(1).max(256)
}).strict()

export type ChangeInspectorOpenOutput = z.infer<typeof changeInspectorOpenOutputSchema>

export const changeInspectorObservationContract = Object.freeze({
  resourceKind: CHANGE_INSPECTOR_RESOURCE_KIND,
  stateSchema: changeInspectorSnapshotSchema
})
