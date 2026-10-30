import { z } from 'zod'
import { deliveryManifestSchema, frozenDeliveryBundleHistorySchema, frozenDeliveryBundleSchema, deliveryRelativePathSchema, DELIVERY_MAX_FILE_COUNT, workerDeliveryConfirmationTargetSchema } from '@sciforge/collaboration-contracts'

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
export const workerDeliveryDraftSchema = z.object({
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
  summary: z.string().max(32_000), expectedDraftRevision: z.number().int().positive(),
  aiSummaryDecision: z.enum(['replace', 'keep']).optional(),
  selectedMaterials: z.array(workerDeliverySelectedMaterialSchema).max(DELIVERY_MAX_FILE_COUNT).optional()
}).strict()
export const workerDeliverySubmitInputSchema = z.object({ target: workerDeliveryConfirmationTargetSchema }).strict()
export const workerDeliveryViewSchema = z.object({
  projectId: z.string(), taskId: z.string(), executionId: z.string(),
  state: z.enum(['executing', 'waiting_confirmation', 'submitting', 'sealed', 'returned', 'blocked']),
  submissionProgress: z.enum(['preparing', 'signing', 'staging', 'candidate', 'review', 'seal']).optional(),
  draft: workerDeliveryDraftSchema.nullable(),
  confirmationTarget: workerDeliveryConfirmationTargetSchema.nullable(),
  history: z.array(z.object({
    bundle: frozenDeliveryBundleHistorySchema, sourceTurnId: z.string(), frozenAt: z.string(),
    manifest: deliveryManifestSchema, deliveryManifestId: z.string(), submittedByUserId: z.string(), submittedAt: z.string()
  }).strict()),
  candidate: z.object({
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
