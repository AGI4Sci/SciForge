import { z } from 'zod'
import { deliveryManifestIdSchema, materialRevisionIdSchema, objectIdSchema, projectIdSchema, projectResultIdSchema, revisionSchema, sha256Schema, timestampSchema, userIdSchema } from './core.js'

const opaqueReferenceSchema = z.string().trim().min(1).max(2_048)

export const objectReferenceSchema = z.object({
  objectId: objectIdSchema,
  objectKey: opaqueReferenceSchema,
  revision: revisionSchema,
  sha256: sha256Schema,
  byteCount: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  mediaType: z.string().trim().min(1).max(255),
  projectId: projectIdSchema,
  visibility: z.enum(['project_public', 'private_session', 'staged']),
  ownerUserId: userIdSchema,
  retentionUntil: timestampSchema.nullable()
}).strict()
export type ObjectReference = z.infer<typeof objectReferenceSchema>


const unique = <T>(values: readonly T[]): boolean => new Set(values).size === values.length

const exactInputVersionShape = {
  revision: revisionSchema,
  digest: sha256Schema
}
export const exactContractInputReferenceSchema = z.discriminatedUnion('kind', [
  z.object({ ...exactInputVersionShape, kind: z.literal('material_revision'), referenceId: materialRevisionIdSchema }).strict(),
  z.object({ ...exactInputVersionShape, kind: z.literal('project_result'), referenceId: projectResultIdSchema, objectId: objectIdSchema }).strict(),
  z.object({ ...exactInputVersionShape, kind: z.literal('adopted_delivery'), referenceId: deliveryManifestIdSchema, objectId: objectIdSchema }).strict()
])
/** Original persisted references are read-only; these kinds do not authorize new Task inputs. */
export const exactContractInputReferenceHistorySchema = z.union([
  exactContractInputReferenceSchema,
  z.object({
    ...exactInputVersionShape,
    kind: z.enum(['material_revision', 'delivery_manifest', 'project_result', 'external_scientific_input']),
    referenceId: opaqueReferenceSchema
  }).strict()
])
export type ExactContractInputReferenceHistory = z.infer<typeof exactContractInputReferenceHistorySchema>
export type ExactContractInputReference = z.infer<typeof exactContractInputReferenceSchema>

export const uniqueInputReferences = (values: readonly ExactContractInputReferenceHistory[]): boolean => {
  const keys = values.map((value) => `${value.kind}\u0000${value.referenceId}\u0000${'objectId' in value ? value.objectId : ''}\u0000${value.revision}\u0000${value.digest}`)
  return unique(keys)
}
