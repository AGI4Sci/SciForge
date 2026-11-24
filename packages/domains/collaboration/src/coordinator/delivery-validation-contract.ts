import { z } from 'zod'
import { deliveryManifestSchema, objectReferenceSchema, userIdSchema, sha256Schema } from '@sciforge/collaboration-contracts'

export const DELIVERY_VALIDATION_ACTION = 'collaboration.delivery.validate'
export const deliveryValidationReferenceSchema = z.object({ specDigest: sha256Schema, targetDigest: sha256Schema }).strict()
const scalar = z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()])
export const deliveryValidationSpecSchema = z.object({
  version: z.literal(1),
  target: z.object({
    projectId: deliveryManifestSchema.shape.projectId,
    taskId: deliveryManifestSchema.shape.taskId,
    deliveryManifestId: deliveryManifestSchema.shape.deliveryManifestId,
    manifestDigest: sha256Schema,
    object: objectReferenceSchema
  }).strict(),
  assertions: z.array(z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('equals'), path: z.array(z.string().max(256)).max(32), expected: scalar }).strict(),
    z.object({ kind: z.literal('range'), path: z.array(z.string().max(256)).max(32),
      min: z.number().finite(), max: z.number().finite() }).strict().refine(a => a.min <= a.max, 'Invalid range')
  ])).min(1).max(128)
}).strict()
export const deliveryValidationRecordSchema = z.object({
  ...deliveryValidationReferenceSchema.shape,
  checkId: z.uuid(),
  principalUserId: userIdSchema,
  spec: deliveryValidationSpecSchema,
  status: z.enum(['passed', 'failed', 'unknown']),
  checkedAt: z.iso.datetime(),
  detail: z.string().max(1000)
}).strict()
export type DeliveryValidationSpec = z.infer<typeof deliveryValidationSpecSchema>
export type DeliveryValidationRecord = z.infer<typeof deliveryValidationRecordSchema>
export type DeliveryValidationReference = z.infer<typeof deliveryValidationReferenceSchema>
