import { artifactVersionRefV1Schema } from '@sciforge/domain-artifact-versions/contract'
import { z } from 'zod'
import {
  assertLineageIntegrity,
  evidenceLineageV1Schema,
  lineageArtifactRefs,
  type EvidenceProducerReceiptAdapter
} from './producer-provenance-consumer.js'

const identifierSchema = z.string().trim().min(1).max(256)
const operationIdSchema = z.string()
  .trim()
  .min(16)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)

const commitRefsSchema = z.object({
  derivedData: artifactVersionRefV1Schema,
  recipe: artifactVersionRefV1Schema,
  // Receipts written before executable code artifacts existed have no code ref.
  code: artifactVersionRefV1Schema.optional(),
  figure: artifactVersionRefV1Schema,
  renderManifest: artifactVersionRefV1Schema,
  attemptLog: artifactVersionRefV1Schema
}).strict()

export const scientificPlottingProvenanceReceiptV1Schema = z.object({
  schemaVersion: z.literal(1),
  producer: z.literal('scientific-plotting'),
  operationId: operationIdSchema,
  state: z.literal('pending'),
  createdAt: z.iso.datetime({ offset: true }),
  runtimeId: identifierSchema.optional(),
  threadId: identifierSchema.optional(),
  commitRefs: commitRefsSchema,
  evidenceLineage: evidenceLineageV1Schema
}).strict().superRefine((value, context) => {
  if (Boolean(value.runtimeId) !== Boolean(value.threadId)) {
    context.addIssue({
      code: 'custom',
      path: value.runtimeId ? ['threadId'] : ['runtimeId'],
      message: 'runtimeId and threadId must be provided together.'
    })
  }
})

export type ScientificPlottingProvenanceReceiptV1 = z.infer<
  typeof scientificPlottingProvenanceReceiptV1Schema
>

/** Scientific Plotting keeps its role-named receipt; Evidence reads it through this adapter. */
export const scientificPlottingReceiptAdapter: EvidenceProducerReceiptAdapter = (value) => {
  const receipt = scientificPlottingProvenanceReceiptV1Schema.parse(value)
  const committed = Object.values(receipt.commitRefs)
  if (new Set(committed.map((ref) => ref.versionId)).size !== committed.length) {
    throw new Error('Scientific Plotting provenance must reference distinct committed versions.')
  }
  const lineage = receipt.evidenceLineage
  const logVersions = new Set(lineage.logs.map((item) => item.artifact.artifactVersionRef.versionId))
  const outputVersions = new Set(
    lineage.outputs.map((item) => item.artifact.artifactVersionRef.versionId)
  )
  if (!logVersions.has(receipt.commitRefs.attemptLog.versionId)) {
    throw new Error('Scientific Plotting attemptLog commit ref is absent from Evidence lineage logs.')
  }
  for (const [role, ref] of Object.entries(receipt.commitRefs)) {
    if (role !== 'attemptLog' && !outputVersions.has(ref.versionId)) {
      throw new Error(`Scientific Plotting ${role} commit ref is absent from Evidence lineage outputs.`)
    }
  }
  assertLineageIntegrity(lineage)
  const id = `scientific-plotting/provenance:${receipt.operationId}`
  return {
    producer: receipt.producer,
    operationId: receipt.operationId,
    createdAt: receipt.createdAt,
    ...(receipt.runtimeId && receipt.threadId
      ? { runtimeId: receipt.runtimeId, threadId: receipt.threadId }
      : {}),
    artifactRefs: lineageArtifactRefs(lineage, committed),
    traceItem: Object.freeze({
      id,
      source_item_id: id,
      type: 'tool_result',
      tool_name: 'scientific_plotting.render',
      evidenceLineage: structuredClone(lineage),
      scientificPlottingProvenance: {
        schemaVersion: receipt.schemaVersion,
        producer: receipt.producer,
        operationId: receipt.operationId,
        commitRefs: structuredClone(receipt.commitRefs),
        createdAt: receipt.createdAt
      }
    })
  }
}
