import { z } from 'zod'
import { workerFollowupViewSchema } from './task-followup.js'
import { taskFileOutputIntentSchema, deliveryManifestSchema, frozenDeliveryBundleHistorySchema, frozenDeliveryBundleSchema, deliveryRelativePathSchema, DELIVERY_MAX_FILE_COUNT, DELIVERY_MAX_FILE_BYTES, workerDeliveryConfirmationTargetSchema } from '@sciforge/collaboration-contracts'

export const workerDeliveryReadInputSchema = z.object({
  projectId: z.string().min(1), taskId: z.string().min(1), executionId: z.string().min(1)
}).strict()
export const workerDeliverySelectedMaterialSchema = z.object({
  relativePath: deliveryRelativePathSchema, source: z.enum(['member', 'attachment']).optional()
}).strict()
export const workerDeliveryMaterialsInputSchema = workerDeliveryReadInputSchema.extend({
  cursor: z.string().regex(/^\d+$/).optional(), query: z.string().max(256).optional()
}).strict()
export const workerDeliveryMaterialSchema = z.object({
  relativePath: deliveryRelativePathSchema, fileName: z.string().min(1),
  mediaType: z.string().min(1), byteCount: z.number().int().nonnegative(),
  source: z.enum(['ai', 'member', 'attachment'])
}).strict()
export const workerDeliveryMaterialsResultSchema = z.object({
  files: z.array(workerDeliveryMaterialSchema).max(100), nextCursor: z.string().nullable(), truncated: z.boolean()
}).strict()
export const workerDeliveryMaterialImportInputSchema = workerDeliveryReadInputSchema.extend({
  fileName: z.string().min(1).max(180).refine((name) => !name.includes('/') && deliveryRelativePathSchema.safeParse(name).success,
    'Choose one canonical portable filename without path or reserved characters.'),
  contentBase64: z.string().max(Math.ceil(DELIVERY_MAX_FILE_BYTES / 3) * 4).regex(/^[A-Za-z0-9+/]*={0,2}$/u)
}).strict()
export const workerDeliveryMaterialImportResultSchema = z.object({ file: workerDeliveryMaterialSchema }).strict()
export type WorkerDeliveryMaterialImportInput = z.infer<typeof workerDeliveryMaterialImportInputSchema>
export const workerDeliveryDraftSchema = z.object({
  declaredMaterial: workerDeliverySelectedMaterialSchema.extend({ source: z.enum(['ai', 'member', 'attachment']).optional() }).nullable().optional(),
  sourceChat: z.object({ runtimeId: z.string().min(1), threadId: z.string().min(1), turnId: z.string().min(1) }).strict().optional(),
  revision: z.number().int().positive(), resultRevision: z.number().int().positive(),
  basedOnResultRevision: z.number().int().positive().nullable(),
  summary: z.string().max(32_000), aiSummary: z.string().max(32_000).nullable(), summaryEdited: z.boolean(),
  sourceTurnId: z.string().nullable(), sourceRound: z.number().int().nonnegative(),
  sourceUpdatedAt: z.string().nullable(), updatedAt: z.string(), changed: z.boolean(),
  outputs: frozenDeliveryBundleSchema.shape.outputs,
  selectedMaterials: z.array(workerDeliverySelectedMaterialSchema).max(DELIVERY_MAX_FILE_COUNT).default([]),
  materialError: z.string().nullable().default(null)
}).strict()
export const workerDeliveryDraftSaveInputSchema = workerDeliveryReadInputSchema.extend({
  declaredMaterial: workerDeliverySelectedMaterialSchema.nullable().optional(),
  summary: z.string().max(32_000), expectedDraftRevision: z.number().int().positive(),
  aiSummaryDecision: z.enum(['replace', 'keep']).optional(),
  selectedMaterials: z.array(workerDeliverySelectedMaterialSchema).max(DELIVERY_MAX_FILE_COUNT).optional()
}).strict()
export const workerDeliveryCancelInputSchema = workerDeliveryReadInputSchema.extend({ operationId: z.string().min(1) }).strict()
export type WorkerDeliveryCancelInput = z.infer<typeof workerDeliveryCancelInputSchema>
export const workerDeliverySubmitInputSchema = z.object({ target: workerDeliveryConfirmationTargetSchema }).strict()
export const workerDeliveryViewSchema = z.object({
  followup: workerFollowupViewSchema.optional(),
  declaredOutput: taskFileOutputIntentSchema.nullable().optional(),
  projectId: z.string(), taskId: z.string(), executionId: z.string(),
  state: z.enum(['executing', 'waiting_confirmation', 'submitting', 'sealed', 'returned', 'blocked']),
  canCancelFailedSubmission: z.boolean().optional(),
  submissionProgress: z.enum(['preparing', 'signing', 'staging', 'candidate', 'review', 'seal']).optional(),
  draft: workerDeliveryDraftSchema.nullable(),
  confirmationTarget: workerDeliveryConfirmationTargetSchema.nullable(),
  history: z.array(z.object({
    sourceChat: workerDeliveryDraftSchema.shape.sourceChat,
    bundle: frozenDeliveryBundleHistorySchema, sourceTurnId: z.string(), frozenAt: z.string(),
    manifest: deliveryManifestSchema, deliveryManifestId: z.string(), submittedByUserId: z.string(), submittedAt: z.string()
  }).strict()),
  candidate: z.object({
    sourceChat: workerDeliveryDraftSchema.shape.sourceChat,
    target: workerDeliveryConfirmationTargetSchema,
    bundle: frozenDeliveryBundleHistorySchema,
    sourceTurnId: z.string(), frozenAt: z.string(), dirty: z.boolean()
  }).strict().nullable(),
  operationId: z.string().nullable(), deliveryManifestId: z.string().nullable(),
  error: z.string().nullable(),
  residuals: z.array(z.object({ interactionId: z.string(), text: z.string().nullable(),
    uncertain: z.boolean(), disposition: z.enum(['copied_to_composer', 'discarded']).nullable() }).strict())
}).strict()
export const workerDeliveryResultSchema = z.object({ delivery: workerDeliveryViewSchema }).strict()
export const workerResidualDisposeInputSchema = workerDeliveryReadInputSchema.extend({
  interactionId: z.string().min(1), disposition: z.enum(['copied_to_composer', 'discarded'])
}).strict()
export type WorkerDeliveryView = z.infer<typeof workerDeliveryViewSchema>
export type WorkerDeliveryDraft = z.infer<typeof workerDeliveryDraftSchema>
export type WorkerDeliveryDraftSaveInput = z.infer<typeof workerDeliveryDraftSaveInputSchema>
export type WorkerDeliveryReadInput = z.infer<typeof workerDeliveryReadInputSchema>
export type WorkerDeliverySubmitInput = z.infer<typeof workerDeliverySubmitInputSchema>

export type WorkerDeliverySelectedMaterial = z.infer<typeof workerDeliverySelectedMaterialSchema>
export type WorkerDeliveryMaterialsInput = z.infer<typeof workerDeliveryMaterialsInputSchema>
export type WorkerDeliveryMaterialsResult = z.infer<typeof workerDeliveryMaterialsResultSchema>
