import { artifactVersionRefV1Schema } from '@sciforge/domain-artifact-versions/contract'
import { z } from 'zod'

/**
 * Producer-neutral Evidence hand-off contract.
 *
 * A producer package commits its artifacts as immutable Artifact Versions and
 * then writes one immutable pending receipt into the Evidence inbox. These
 * schemas are the single definition of that receipt and of the delivery
 * receipt Evidence writes back. Producers import them from the public contract
 * entry instead of copying the shape.
 */

const identifierSchema = z.string().trim().min(1).max(256)
const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
const timestampSchema = z.iso.datetime({ offset: true })

export const evidenceOperationIdSchema = z.string()
  .trim()
  .min(16)
  .max(256)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/u)

export const evidenceProducerIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/u)

const evidenceArtifactSchema = z.object({
  kind: z.string().trim().min(1).max(256),
  locator: z.string().trim().min(1).max(8_192),
  contentDigest: sha256Schema,
  size: z.number().int().nonnegative(),
  mediaType: z.string().trim().min(1).max(256).optional(),
  retention: artifactVersionRefV1Schema.shape.retention,
  accessPolicy: artifactVersionRefV1Schema.shape.accessPolicy,
  artifactVersionRef: artifactVersionRefV1Schema
}).strict()

export const evidenceLineageV1Schema = z.object({
  activity: z.object({
    id: identifierSchema,
    type: z.literal('analysis_run'),
    name: z.string().trim().min(1).max(1_000),
    status: z.literal('completed'),
    parameters: z.record(z.string().trim().min(1).max(256), z.unknown()),
    stochastic: z.boolean().optional(),
    randomSeed: z.number().int().safe().optional()
  }).strict(),
  inputs: z.array(z.object({
    id: identifierSchema,
    type: z.literal('dataset_version'),
    name: z.string().trim().min(1).max(1_000),
    artifact: evidenceArtifactSchema.optional(),
    provenanceBreakpoint: z.string().trim().min(1).max(4_000).optional()
  }).strict()).max(1_024),
  software: z.array(z.object({
    id: identifierSchema,
    type: z.literal('software_version'),
    name: z.string().trim().min(1).max(1_000),
    version: z.string().trim().min(1).max(512).optional(),
    contentDigest: sha256Schema
  }).strict()).max(1_024),
  // Producers whose work has no pinned execution environment omit it; Evidence
  // then reports the reproducibility gap instead of inventing one.
  environment: z.object({
    id: identifierSchema,
    type: z.literal('environment'),
    name: z.string().trim().min(1).max(1_000),
    contentDigest: sha256Schema,
    pythonVersion: z.string().trim().min(1).max(512).optional(),
    packages: z.record(
      z.string().trim().min(1).max(256),
      z.string().trim().min(1).max(512)
    ).optional(),
    fontFingerprint: sha256Schema.optional()
  }).strict().optional(),
  logs: z.array(z.object({
    id: identifierSchema,
    type: z.literal('artifact'),
    name: z.string().trim().min(1).max(1_000),
    artifact: evidenceArtifactSchema
  }).strict()).max(1_024),
  outputs: z.array(z.object({
    id: identifierSchema,
    type: z.enum(['artifact', 'dataset_version']),
    name: z.string().trim().min(1).max(1_000),
    artifact: evidenceArtifactSchema
  }).strict()).max(1_024),
  relations: z.array(z.object({
    src: identifierSchema,
    dst: identifierSchema,
    rel: z.enum(['replicates', 'fails_to_replicate', 'derived_from'])
  }).strict()).max(4_096)
}).strict()

/** runtimeId and threadId name one Evidence thread, so they travel together. */
export function validateEvidenceRoutingPair(
  value: { runtimeId?: string | undefined; threadId?: string | undefined },
  context: z.RefinementCtx
): void {
  if (Boolean(value.runtimeId) !== Boolean(value.threadId)) {
    context.addIssue({
      code: 'custom',
      path: value.runtimeId ? ['threadId'] : ['runtimeId'],
      message: 'runtimeId and threadId must be provided together.'
    })
  }
}

/** Immutable pending receipt a producer writes into `inbox/<producer>/`. */
export const evidenceProducerReceiptV1Schema = z.object({
  schemaVersion: z.literal(1),
  producer: evidenceProducerIdSchema,
  operationId: evidenceOperationIdSchema,
  state: z.literal('pending'),
  createdAt: timestampSchema,
  runtimeId: identifierSchema.optional(),
  threadId: identifierSchema.optional(),
  toolName: z.string().trim().min(1).max(256),
  commitRefs: z.record(z.string().trim().min(1).max(64), artifactVersionRefV1Schema)
    .refine((refs) => Object.keys(refs).length >= 1 && Object.keys(refs).length <= 64, {
      message: 'commitRefs must name between 1 and 64 committed versions.'
    }),
  evidenceLineage: evidenceLineageV1Schema
}).strict().superRefine(validateEvidenceRoutingPair)

const deliveryBase = {
  schemaVersion: z.literal(1),
  consumer: z.literal('evidence-dag'),
  producer: evidenceProducerIdSchema,
  operationId: evidenceOperationIdSchema,
  createdAt: timestampSchema,
  runtimeId: identifierSchema,
  threadId: identifierSchema,
  sourceDigest: sha256Schema
} as const

/**
 * Delivery receipt Evidence writes after the producer receipt was handled.
 *
 * Two persisted generations share schemaVersion 1 and are told apart by
 * `state`, so both stay readable after an upgrade:
 * - `committed`: the delta append is durable; carries the delta identity.
 * - `enqueued`: written by consumers before 2026-09-02, when delivery went
 *   through a job queue. Read-only; new receipts are always `committed`.
 */
export const evidenceProducerDeliveryReceiptV1Schema = z.discriminatedUnion('state', [
  z.object({
    ...deliveryBase,
    state: z.literal('committed'),
    // Evidence delta identities use the public prefixed digest form while
    // embedded Artifact content digests remain bare SHA-256 hex strings.
    deltaDigest: z.string().regex(/^sha256:[a-f0-9]{64}$/u)
  }).strict(),
  z.object({
    ...deliveryBase,
    state: z.literal('enqueued'),
    jobId: identifierSchema
  }).strict()
])

export type EvidenceLineageV1 = z.infer<typeof evidenceLineageV1Schema>
export type EvidenceProducerReceiptV1 = z.infer<typeof evidenceProducerReceiptV1Schema>
export type EvidenceProducerDeliveryReceiptV1 = z.infer<
  typeof evidenceProducerDeliveryReceiptV1Schema
>
