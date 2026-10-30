import { z } from 'zod'
import {
  RESEARCH_AUDIT_SESSION_CHANGE_MAX_LIST_CHANGES as CHANGE_INSPECTOR_MAX_LIST_CHANGES,
  RESEARCH_AUDIT_SESSION_CHANGE_MAX_SUMMARY_PATCH_BYTES as CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES,
  researchAuditSessionChangeStatusSchema as changeInspectorStatusSchema,
  researchAuditSessionChangeSummarySchema as changeInspectorChangeSummarySchema,
  researchAuditSessionChangeListChangesOutputSchema as changeInspectorListChangesOutputSchema,
  type ResearchAuditSessionChangeSummary as ChangeInspectorChangeSummary,
  type ResearchAuditSessionChangeListChangesOutput as ChangeInspectorListChangesOutput
} from '@sciforge/domain-sdk/research-audit'

export const CHANGE_INSPECTOR_RESOURCE_KIND = 'agent-session-changes'

export const CHANGE_INSPECTOR_CAPABILITY_IDS = Object.freeze({
  openSession: 'change-inspector.open-session',
  listChanges: 'change-inspector.list-changes'
} as const)

export const CHANGE_INSPECTOR_DEFAULT_LIST_CHANGES = 100

// Summary and list-output contracts are canonical in
// `@sciforge/domain-sdk/research-audit` (the cross-domain audit projection
// reads them through SDK contracts only).
export {
  CHANGE_INSPECTOR_MAX_LIST_CHANGES,
  CHANGE_INSPECTOR_MAX_SUMMARY_PATCH_BYTES,
  changeInspectorStatusSchema,
  changeInspectorChangeSummarySchema,
  changeInspectorListChangesOutputSchema
}

export type {
  ChangeInspectorChangeSummary,
  ChangeInspectorListChangesOutput
}

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

export const changeInspectorListChangesInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(256),
  limit: z
    .number()
    .int()
    .positive()
    .max(CHANGE_INSPECTOR_MAX_LIST_CHANGES)
    .optional(),
  cursor: z.string().trim().min(1).max(512).optional()
}).strict()

export type ChangeInspectorListChangesInput = z.infer<
  typeof changeInspectorListChangesInputSchema
>

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
