import { z } from 'zod'
import {
  domainPackageJsonValueSchema,
  type DomainPackageJsonValue
} from '@sciforge/domain-sdk/contract'

export const GIT_CHECKPOINTS_CAPABILITY_IDS = Object.freeze({
  list: 'git-checkpoints.list',
  create: 'git-checkpoints.create',
  preview: 'git-checkpoints.preview',
  restore: 'git-checkpoints.restore'
} as const)

export const gitCheckpointStatusSchema = z.enum([
  'available',
  'restored',
  'blocked',
  'failed'
])
export const gitCheckpointPhaseSchema = z.enum([
  'before-turn',
  'after-turn',
  'manual',
  'rescue'
])

export const gitCheckpointSchema = z.object({
  checkpointId: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/),
  runtimeId: z.string().trim().min(1).max(128),
  threadId: z.string().trim().min(1).max(512),
  turnId: z.string().trim().min(1).max(512).optional(),
  phase: gitCheckpointPhaseSchema,
  workspaceRoot: z.string().trim().min(1).max(4_096),
  provider: z.string().trim().min(1).max(128),
  revision: z.string().trim().min(1).max(512),
  createdAt: z.iso.datetime({ offset: true }),
  changeSummary: z.string().max(100_000),
  status: gitCheckpointStatusSchema,
  restoreStatus: z.iso.datetime({ offset: true }).optional(),
  rescueCheckpointId: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/).optional()
}).strict()

export const gitCheckpointListInputSchema = z.object({
  runtimeId: z.string().trim().min(1).max(128).optional(),
  threadId: z.string().trim().min(1).max(512).optional(),
  workspaceRoot: z.string().trim().min(1).max(4_096).optional()
}).strict()

export const gitCheckpointCreateInputSchema = z.object({
  runtimeId: z.string().trim().min(1).max(128),
  threadId: z.string().trim().min(1).max(512),
  turnId: z.string().trim().min(1).max(512).optional(),
  workspaceRoot: z.string().trim().min(1).max(4_096),
  phase: gitCheckpointPhaseSchema.default('manual')
}).strict()

export const gitCheckpointPreviewInputSchema = z.object({
  checkpointId: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/)
}).strict()

export const gitCheckpointPreviewSchema = z.object({
  checkpoint: gitCheckpointSchema,
  patch: z.string().max(1_000_000),
  truncated: z.boolean()
}).strict()

export const gitCheckpointRestoreInputSchema = z.object({
  checkpointId: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/)
}).strict()

export const gitCheckpointRestoreSchema = gitCheckpointSchema.extend({
  rescueCheckpointId: z.string().regex(/^[A-Za-z0-9._-]{1,200}$/)
}).strict()

export const gitCheckpointFailureSchema = z.object({
  ok: z.literal(false),
  reason: z.string().trim().min(1).max(128),
  message: z.string().trim().min(1).max(4_000),
  details: domainPackageJsonValueSchema.optional()
}).strict()

export function gitCheckpointResultSchema<T extends z.ZodType>(valueSchema: T) {
  return z.discriminatedUnion('ok', [
    z.object({ ok: z.literal(true), value: valueSchema }).strict(),
    gitCheckpointFailureSchema
  ])
}

export const gitCheckpointListResultSchema = gitCheckpointResultSchema(
  z.array(gitCheckpointSchema).max(20_000)
)
export const gitCheckpointCreateResultSchema = gitCheckpointResultSchema(gitCheckpointSchema)
export const gitCheckpointPreviewResultSchema = gitCheckpointResultSchema(gitCheckpointPreviewSchema)
export const gitCheckpointRestoreResultSchema = gitCheckpointResultSchema(gitCheckpointRestoreSchema)

export type GitCheckpoint = z.infer<typeof gitCheckpointSchema>
export type GitCheckpointPhase = z.infer<typeof gitCheckpointPhaseSchema>
export type GitCheckpointListInput = z.infer<typeof gitCheckpointListInputSchema>
export type GitCheckpointCreateInput = z.input<typeof gitCheckpointCreateInputSchema>
export type GitCheckpointPreview = z.infer<typeof gitCheckpointPreviewSchema>
export type GitCheckpointRestoreInput = z.input<typeof gitCheckpointRestoreInputSchema>
export type GitCheckpointRestore = z.infer<typeof gitCheckpointRestoreSchema>
export type GitCheckpointResult<T> =
  | Readonly<{ ok: true; value: T }>
  | Readonly<{
      ok: false
      reason: string
      message: string
      details?: DomainPackageJsonValue
    }>
