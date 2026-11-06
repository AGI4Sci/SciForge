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

/* Public tool ids are owned and declared by this independent plugin. */
export const CHANGE_INSPECTOR_CAPABILITY_IDS = Object.freeze({
  openSession: 'change-inspector.open-session',
  listChanges: 'change-inspector.list-changes'
} as const)

export const CHANGE_INSPECTOR_DEFAULT_LIST_CHANGES = 100
export const CHANGE_INSPECTOR_MAX_PATCH_BYTES = 65_536
export const CHANGE_INSPECTOR_MAX_SNAPSHOT_BYTES = 262_144

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
  patch: z.string().min(1).refine(value => Buffer.byteLength(value, 'utf8') <= CHANGE_INSPECTOR_MAX_PATCH_BYTES, 'Patch exceeds UTF-8 byte budget'),
  patchBytes: z.number().int().nonnegative(),
  patchTruncated: z.boolean(),
  occurredAt: z.string().datetime({ offset: true }).optional()
}).strict()

export type ChangeInspectorChange = z.infer<typeof changeInspectorChangeSchema>

export const changeInspectorSnapshotSchema = z.object({
  sessionId: z.string().trim().min(1).max(256),
  revision: z.string().trim().min(1).max(256),
  changes: z.array(changeInspectorChangeSchema).max(5_000),
  truncated: z.boolean(),
  truncationReasons: z.array(z.enum(['patch-byte-limit', 'snapshot-byte-limit', 'change-count-limit']))
}).strict()

export type ChangeInspectorSnapshot = z.infer<typeof changeInspectorSnapshotSchema>

export const changeInspectorListChangesInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(256).optional(),
  limit: z.number().int().positive().max(CHANGE_INSPECTOR_MAX_LIST_CHANGES).optional(),
  cursor: z.string().trim().min(1).max(512).optional()
}).strict()

export type ChangeInspectorListChangesInput = z.infer<typeof changeInspectorListChangesInputSchema>

export const changeInspectorOpenInputSchema = z.object({
  sessionId: z.string().trim().min(1).max(256).optional(),
  runtimeId: z.string().trim().min(1).max(256).optional()
}).strict()

export type ChangeInspectorOpenInput = z.infer<typeof changeInspectorOpenInputSchema>

/* The tool returns bounded data directly to the invoking Agent conversation. */
export const changeInspectorOpenSessionResultSchema = z.object({
  sessionId: z.string().trim().min(1).max(256).optional(),
  resourceId: z.string().trim().min(1).max(256),
  snapshot: changeInspectorSnapshotSchema
}).strict()

export type ChangeInspectorOpenSessionResult = z.infer<typeof changeInspectorOpenSessionResultSchema>
