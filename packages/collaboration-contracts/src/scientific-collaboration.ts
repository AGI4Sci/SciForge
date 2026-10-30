import { exactContractInputReferenceHistorySchema, exactContractInputReferenceSchema } from './object-reference.js'
import { hash as sha256 } from 'fast-sha256'
import { canonicalizeJson } from '@sciforge/domain-sdk/canonical-json'
import { z } from 'zod'

import {
  claimIdSchema,
  deviceIdSchema,
  entityMetadataShape,
  evidenceRefIdSchema,
  executionIdSchema,
  interventionIdSchema,
  nonEmptyTextSchema,
  projectIdSchema,
  providerOpaqueIdSchema,
  resultSubmissionIdSchema,
  reviewDecisionIdSchema,
  revisionSchema,
  schemaVersionSchema,
  sha256Schema,
  taskIdSchema,
  timestampSchema,
  userIdSchema,
  workerAttestationIdSchema
} from './core.js'
import { deviceFactSignatureMetadataSchema } from './identity.js'
import { providerInstanceRefSchema } from './project-content.js'
import type { TaskFileIntent } from './task-object-io.js'

const boundedScientificTextSchema = z.string().trim().min(1).max(8_000)
const boundedDescriptionSchema = z.string().trim().min(1).max(4_000)

function uniqueStrings(values: readonly string[]): boolean {
  return new Set(values).size === values.length
}

/** Stable JSON used by all scientific collaboration digests. Array order is significant. */
export function canonicalScientificJson(value: unknown): string {
  return canonicalizeJson(value)
}

export function scientificDigest(value: unknown): string {
  return [...sha256(new TextEncoder().encode(canonicalScientificJson(value)))]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

export const requiredOutputKindSchema = z.enum(['file', 'table', 'figure', 'text', 'other'])
export type RequiredOutputKind = z.infer<typeof requiredOutputKindSchema>

/** Provider-neutral mapping of the existing Task file intent into the scientific Contract. */
export const requiredOutputSchema = z.object({
  outputKey: z.string().trim().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u),
  kind: requiredOutputKindSchema,
  description: boundedDescriptionSchema,
  fileName: z.string().trim().min(1).max(128).optional(),
  mediaType: z.string().trim().min(1).max(256).optional(),
  /** File-size constraint copied from the canonical Task file intent. */
  maxBytes: z.number().int().min(1).max(1_073_741_824).optional()
}).strict()
export type RequiredOutput = z.infer<typeof requiredOutputSchema>

/**
 * The material Plan fields that become a TaskContract. They are optional on a
 * draft for recovery of plans created before PR2; Cloud fills and validates
 * them before creating a Task/Offer.
 */
export const taskContractMaterialFieldsSchema = z.object({
  scientificScope: boundedScientificTextSchema.optional(),
  scientificInputVersions: z.array(exactContractInputReferenceSchema).max(1_000).optional(),
  constraints: z.array(boundedDescriptionSchema).max(100).refine(uniqueStrings, 'Contract constraints must be unique.').optional(),
  acceptanceCriteria: z.array(boundedDescriptionSchema).min(1).max(100).optional(),
  requiredOutputs: z.array(requiredOutputSchema).max(100).optional()
}).strict()
export type TaskContractMaterialFields = z.infer<typeof taskContractMaterialFieldsSchema>

/** Map the one canonical file output constraint into Contract requiredOutputs. */
type TaskFileOutputIntentSource = Pick<TaskFileIntent, 'inputs' | 'output'>

export function requiredOutputsFromTaskFileIntent(intent: TaskFileOutputIntentSource | null): RequiredOutput[] {
  if (intent === null) return []
  return [{
    outputKey: 'primary-file',
    kind: 'file',
    description: 'Primary Task file output.',
    fileName: intent.output.fileName,
    mediaType: intent.output.mediaType,
    maxBytes: intent.output.maxBytes
  }]
}

/**
 * Ensure the Contract and file intent cannot describe two different output
 * files. This is deliberately provider-neutral: it compares only the
 * portable file constraints owned by the collaboration contract.
 */
export function requiredOutputsMatchTaskFileIntent(
  outputs: readonly RequiredOutput[],
  intent: TaskFileOutputIntentSource | null
): boolean {
  const expected = requiredOutputsFromTaskFileIntent(intent)
  const parsed = z.array(requiredOutputSchema).safeParse(outputs)
  if (!parsed.success) return false
  if (expected.length === 0) return outputs.every((output) => output.kind !== 'file')
  const fileOutputs = outputs.filter((output) => output.kind === 'file')
  if (fileOutputs.length !== 1 || outputs.length !== 1) return false
  const actual = fileOutputs[0]
  const canonical = expected[0]
  if (actual === undefined || canonical === undefined) return false
  return actual.fileName === canonical.fileName &&
    actual.mediaType === canonical.mediaType &&
    actual.maxBytes === canonical.maxBytes
}

const taskContractPayloadShape = {
  schemaVersion: schemaVersionSchema,
  type: z.literal('task_contract'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  contractRevision: revisionSchema,
  objective: nonEmptyTextSchema,
  scientificScope: boundedScientificTextSchema,
  scientificInputVersions: z.array(exactContractInputReferenceSchema).max(1_000),
  constraints: z.array(boundedDescriptionSchema).max(100).refine(uniqueStrings, 'Contract constraints must be unique.'),
  acceptanceCriteria: z.array(boundedDescriptionSchema).min(1).max(100),
  requiredOutputs: z.array(requiredOutputSchema).max(100),
} as const

function validateTaskContractDigest(contract: { contractDigest: string }, context: z.RefinementCtx): void {
  const { contractDigest, ...payload } = contract
  if (scientificDigest(payload) !== contractDigest) {
    context.addIssue({
      code: 'custom',
      path: ['contractDigest'],
      message: 'Task Contract digest must cover every immutable Contract field.'
    })
  }
}

/** Immutable material fields for a newly created Task Contract. */
export const taskContractSchema = z.object({
  ...taskContractPayloadShape,
  contractDigest: sha256Schema
}).strict().superRefine(validateTaskContractDigest)
export type TaskContract = z.infer<typeof taskContractSchema>

/** Persisted accepted Contracts retain their original exact references and digest across upgrades. */
export const taskContractHistorySchema = z.object({
  ...taskContractSchema.shape,
  scientificInputVersions: z.array(exactContractInputReferenceHistorySchema).max(1_000)
}).strict().superRefine(validateTaskContractDigest)
export type TaskContractHistory = z.infer<typeof taskContractHistorySchema>

function validateTaskContractRevision(
  revision: { projectId: string; taskId: string; contract: { projectId: string; taskId: string } },
  context: z.RefinementCtx
): void {
  if (revision.projectId !== revision.contract.projectId || revision.taskId !== revision.contract.taskId) {
    context.addIssue({
      code: 'custom',
      path: ['contract'],
      message: 'Contract revision identity must match its append-only row.'
    })
  }
}

/** Append-only Cloud row for one current or historical Contract revision. */
export const taskContractRevisionSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('task_contract_revision'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  contract: taskContractSchema
}).strict().superRefine(validateTaskContractRevision)
export type TaskContractRevision = z.infer<typeof taskContractRevisionSchema>

export const taskContractRevisionHistorySchema = z.object({
  ...taskContractRevisionSchema.shape,
  contract: taskContractHistorySchema
}).strict().superRefine(validateTaskContractRevision)
export type TaskContractRevisionHistory = z.infer<typeof taskContractRevisionHistorySchema>

export const frozenManifestEntrySchema = z.object({
  providerInstanceRef: providerInstanceRefSchema,
  immutableResourceReference: z.string().trim().min(1).max(2_048),
  immutableVersionId: providerOpaqueIdSchema,
  contentDigest: sha256Schema
}).strict()
export type FrozenManifestEntry = z.infer<typeof frozenManifestEntrySchema>

export const frozenManifestSchema = z.object({
  entries: z.array(frozenManifestEntrySchema).min(1).max(10_000),
  manifestDigest: sha256Schema
}).strict().superRefine((manifest, context) => {
  const identities = manifest.entries.map((entry) => (
    `${entry.providerInstanceRef}\u0000${entry.immutableResourceReference}\u0000${entry.immutableVersionId}`
  ))
  if (!uniqueStrings(identities)) {
    context.addIssue({ code: 'custom', path: ['entries'], message: 'Frozen manifest entries must be unique.' })
  }
  if (scientificDigest(manifest.entries) !== manifest.manifestDigest) {
    context.addIssue({
      code: 'custom',
      path: ['manifestDigest'],
      message: 'Frozen manifest digest must cover the ordered immutable entries.'
    })
  }
})
export type FrozenManifest = z.infer<typeof frozenManifestSchema>

/** Provider proof required before a file version can become scientific evidence. */
export const immutableEvidenceProofSchema = z.object({
  immutableIdentity: z.literal(true),
  retentionGuaranteed: z.literal(true),
  versionSpecificRetrieval: z.literal(true),
  byteStable: z.literal(true),
  observedAt: timestampSchema
}).strict()
export type ImmutableEvidenceProof = z.infer<typeof immutableEvidenceProofSchema>

export const evidenceRefSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('immutable_version'),
    evidenceRefId: evidenceRefIdSchema,
    providerInstanceRef: providerInstanceRefSchema,
    immutableResourceReference: z.string().trim().min(1).max(2_048),
    immutableVersionId: providerOpaqueIdSchema,
    contentDigest: sha256Schema,
    proof: immutableEvidenceProofSchema
  }).strict(),
  z.object({
    kind: z.literal('whole_project'),
    evidenceRefId: evidenceRefIdSchema,
    manifest: frozenManifestSchema,
    proof: immutableEvidenceProofSchema
  }).strict()
])
export type EvidenceRef = z.infer<typeof evidenceRefSchema>

export const claimTypeSchema = z.enum(['quantitative', 'method', 'conclusion', 'other'])
export type ClaimType = z.infer<typeof claimTypeSchema>

/** A material scientific unit. Every Claim must cite at least one EvidenceRef. */
export const claimSchema = z.object({
  claimId: claimIdSchema,
  type: claimTypeSchema,
  statement: nonEmptyTextSchema,
  evidenceRefIds: z.array(evidenceRefIdSchema).min(1).max(100)
    .refine(uniqueStrings, 'Claim EvidenceRef IDs must be unique.')
}).strict()
export type Claim = z.infer<typeof claimSchema>

export const interventionKindSchema = z.enum([
  'scientific_correction',
  'interpretation_correction',
  'method_change',
  'data_correction',
  'other'
])
export type InterventionKind = z.infer<typeof interventionKindSchema>

export const interventionRecordSchema = z.object({
  interventionId: interventionIdSchema,
  kind: interventionKindSchema,
  description: boundedDescriptionSchema,
  affectedClaimIds: z.array(claimIdSchema).max(100).refine(uniqueStrings, 'Intervention Claim IDs must be unique.')
}).strict()
export type InterventionRecord = z.infer<typeof interventionRecordSchema>

const resultBundlePayloadShape = {
  schemaVersion: schemaVersionSchema,
  type: z.literal('result_bundle'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  resultSubmissionId: resultSubmissionIdSchema,
  contractRevision: revisionSchema,
  resultRevision: revisionSchema,
  summary: nonEmptyTextSchema,
  claims: z.array(claimSchema).min(1).max(1_000),
  evidenceRefs: z.array(evidenceRefSchema).min(1).max(1_000),
  interventions: z.array(interventionRecordSchema).max(100)
} as const

/** Immutable Worker-authored scientific submission. Review state is stored separately. */
export const resultBundleSchema = z.object({
  ...resultBundlePayloadShape,
  bundleDigest: sha256Schema
}).strict().superRefine((bundle, context) => {
  const { bundleDigest, ...payload } = bundle
  if (scientificDigest(payload) !== bundleDigest) {
    context.addIssue({
      code: 'custom',
      path: ['bundleDigest'],
      message: 'Result Bundle digest must cover the immutable Bundle payload.'
    })
  }

  const claimIds = bundle.claims.map(({ claimId }) => claimId)
  if (!uniqueStrings(claimIds)) {
    context.addIssue({ code: 'custom', path: ['claims'], message: 'Result Bundle Claim IDs must be unique.' })
  }
  const evidenceRefsById = new Set(bundle.evidenceRefs.map(({ evidenceRefId }) => evidenceRefId))
  if (evidenceRefsById.size !== bundle.evidenceRefs.length) {
    context.addIssue({
      code: 'custom',
      path: ['evidenceRefs'],
      message: 'Result Bundle EvidenceRef IDs must be unique.'
    })
  }
  for (const [index, claim] of bundle.claims.entries()) {
    for (const evidenceRefId of claim.evidenceRefIds) {
      if (!evidenceRefsById.has(evidenceRefId)) {
        context.addIssue({
          code: 'custom',
          path: ['claims', index, 'evidenceRefIds'],
          message: `Claim cites an EvidenceRef that is not present in the Bundle: ${evidenceRefId}`
        })
      }
    }
  }
  const claimIdSet = new Set(claimIds)
  for (const [index, intervention] of bundle.interventions.entries()) {
    for (const claimId of intervention.affectedClaimIds) {
      if (!claimIdSet.has(claimId)) {
        context.addIssue({
          code: 'custom',
          path: ['interventions', index, 'affectedClaimIds'],
          message: `Intervention cites a Claim that is not present in the Bundle: ${claimId}`
        })
      }
    }
  }
})
export type ResultBundle = z.infer<typeof resultBundleSchema>

export const scientificResultStateSchema = z.enum(['submitted', 'revision_requested', 'approved'])
export type ScientificResultState = z.infer<typeof scientificResultStateSchema>

/** Current result gate projection. The previous immutable submission remains addressable during revision. */
export const scientificResultStateSnapshotSchema = z.object({
  schemaVersion: schemaVersionSchema,
  type: z.literal('scientific_result_state'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  contractRevision: revisionSchema,
  resultRevision: revisionSchema,
  state: scientificResultStateSchema,
  currentResultSubmissionId: resultSubmissionIdSchema
}).strict()
export type ScientificResultStateSnapshot = z.infer<typeof scientificResultStateSnapshotSchema>

const opaqueReferenceSchema = z.string().trim().min(1).max(2_048)

/** How the Worker User expressed the review: an explicit control or a trusted Session message. */
export const workerReviewInteractionSchema = z.enum(['explicit_click', 'explicit_keyboard_action', 'session_message'])
export type WorkerReviewInteraction = z.infer<typeof workerReviewInteractionSchema>

/** The immutable local target displayed at confirmation, before any object is staged. */
export const workerDeliveryConfirmationTargetSchema = z.object({
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  contractRevision: revisionSchema,
  resultRevision: revisionSchema,
  bundleDigest: sha256Schema,
  decision: z.enum(['approved', 'returned'])
}).strict()
export type WorkerDeliveryConfirmationTarget = z.infer<typeof workerDeliveryConfirmationTargetSchema>

export const humanActionConfirmationSchema = z.object({
  actionId: opaqueReferenceSchema,
  interaction: workerReviewInteractionSchema,
  occurredAt: timestampSchema,
  confirmedInputDigest: sha256Schema,
  sourceMessageDigest: sha256Schema.nullable()
}).strict().superRefine((action, context) => {
  if ((action.interaction === 'session_message') !== (action.sourceMessageDigest !== null)) {
    context.addIssue({ code: 'custom', path: ['sourceMessageDigest'], message: 'Only a trusted Session message carries a source message digest.' })
  }
})
export type HumanActionConfirmation = z.infer<typeof humanActionConfirmationSchema>

/** Signed by the existing Device authority only for a Host-authored human action. */
export const workerDeliveryHumanActionProofSchema = humanActionConfirmationSchema.safeExtend({
  deviceSignature: deviceFactSignatureMetadataSchema.extend({ purpose: z.literal('worker-delivery-review') })
}).superRefine((proof, context) => {
  if (proof.deviceSignature.observedAt !== proof.occurredAt || Date.parse(proof.deviceSignature.issuedAt) < Date.parse(proof.occurredAt)) {
    context.addIssue({ code: 'custom', path: ['deviceSignature'], message: 'The Device signature must bind the exact human action time.' })
  }
})
export type WorkerDeliveryHumanActionProof = z.infer<typeof workerDeliveryHumanActionProofSchema>

export function workerDeliveryConfirmationDigest(target: WorkerDeliveryConfirmationTarget): string {
  return scientificDigest(workerDeliveryConfirmationTargetSchema.parse(target))
}

export function workerDeliveryHumanActionFactDigest(
  target: WorkerDeliveryConfirmationTarget,
  action: HumanActionConfirmation
): string {
  const canonicalTarget = workerDeliveryConfirmationTargetSchema.parse(target)
  const canonicalAction = humanActionConfirmationSchema.parse(action)
  if (canonicalAction.confirmedInputDigest !== workerDeliveryConfirmationDigest(canonicalTarget)) {
    throw new TypeError('Human confirmation must cover the exact Delivery target.')
  }
  return scientificDigest({ purpose: 'worker-delivery-review', target: canonicalTarget, humanAction: canonicalAction })
}

const workerAttestationPayloadShape = {
  schemaVersion: schemaVersionSchema,
  type: z.literal('worker_attestation'),
  attestationId: workerAttestationIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  candidateId: opaqueReferenceSchema,
  workerUserId: userIdSchema,
  attestedByUserId: userIdSchema,
  deviceId: deviceIdSchema,
  interaction: workerReviewInteractionSchema,
  sourceMessageDigest: sha256Schema.nullable(),
  contractRevision: revisionSchema,
  resultRevision: revisionSchema,
  bundleDigest: sha256Schema,
  proofDigest: sha256Schema,
  humanActionId: opaqueReferenceSchema,
  attestedAt: timestampSchema
} as const

/**
 * Worker User authority over one exact Delivery candidate. The Cloud mints it
 * from the authenticated Worker review with its own time; a client never
 * supplies it, and no Agent actor is accepted here.
 */
export const workerAttestationSchema = z.object({
  ...entityMetadataShape,
  ...workerAttestationPayloadShape,
  attestationDigest: sha256Schema
}).strict().superRefine((attestation, context) => {
  if (attestation.workerUserId !== attestation.attestedByUserId) {
    context.addIssue({
      code: 'custom',
      path: ['attestedByUserId'],
      message: 'Only the Worker User may create the Worker Attestation.'
    })
  }
  const { attestationDigest, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = attestation
  if (scientificDigest(payload) !== attestationDigest) {
    context.addIssue({
      code: 'custom',
      path: ['attestationDigest'],
      message: 'Worker Attestation digest must cover its immutable authority payload.'
    })
  }
})
export type WorkerAttestation = z.infer<typeof workerAttestationSchema>

/** Exact pre-Delivery payload, retained only for authenticated historical reads. */
export const legacyWorkerAttestationSchema = z.object({
  ...entityMetadataShape,
  schemaVersion: schemaVersionSchema,
  type: z.literal('worker_attestation'),
  attestationId: workerAttestationIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  resultSubmissionId: resultSubmissionIdSchema,
  workerUserId: userIdSchema,
  attestedByUserId: userIdSchema,
  contractRevision: revisionSchema,
  resultRevision: revisionSchema,
  bundleDigest: sha256Schema,
  attestedAt: timestampSchema,
  attestationDigest: sha256Schema
}).strict().superRefine((attestation, context) => {
  const { attestationDigest, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = attestation
  if (attestation.workerUserId !== attestation.attestedByUserId || scientificDigest(payload) !== attestationDigest) {
    context.addIssue({ code: 'custom', path: ['attestationDigest'], message: 'Historical attestation must preserve its original Worker and digest.' })
  }
})
export const workerAttestationHistorySchema = z.union([workerAttestationSchema, legacyWorkerAttestationSchema])
export type WorkerAttestationHistory = z.infer<typeof workerAttestationHistorySchema>

const coordinatorReviewPayloadShape = {
  schemaVersion: schemaVersionSchema,
  type: z.literal('coordinator_review'),
  reviewDecisionId: reviewDecisionIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  resultSubmissionId: resultSubmissionIdSchema,
  workerAttestationId: workerAttestationIdSchema,
  contractRevision: revisionSchema,
  resultRevision: revisionSchema,
  bundleDigest: sha256Schema,
  decision: z.enum(['approved', 'revision_requested']),
  reviewedByUserId: userIdSchema,
  instruction: nonEmptyTextSchema.nullable(),
  reviewedAt: timestampSchema
} as const

/** Coordinator User decision over an already attested Bundle. */
export const coordinatorReviewSchema = z.object({
  ...entityMetadataShape,
  ...coordinatorReviewPayloadShape,
  reviewDigest: sha256Schema
}).strict().superRefine((review, context) => {
  if (review.decision === 'approved' && review.instruction !== null) {
    context.addIssue({
      code: 'custom',
      path: ['instruction'],
      message: 'An approved Bundle cannot carry a revision instruction.'
    })
  }
  if (review.decision === 'revision_requested' && review.instruction === null) {
    context.addIssue({
      code: 'custom',
      path: ['instruction'],
      message: 'A revision request requires a Worker-facing instruction.'
    })
  }
  const { reviewDigest, revision: _revision, createdAt: _createdAt, updatedAt: _updatedAt, ...payload } = review
  if (scientificDigest(payload) !== reviewDigest) {
    context.addIssue({
      code: 'custom',
      path: ['reviewDigest'],
      message: 'Coordinator Review digest must cover its immutable decision payload.'
    })
  }
})
export type CoordinatorReview = z.infer<typeof coordinatorReviewSchema>

/**
 * Read projection consumed by Coordinator Agent synthesis. It is produced only
 * after both the matching Worker Attestation and an approving Coordinator Review.
 */
export const approvedClaimSchema = z.object({
  schemaVersion: schemaVersionSchema,
  type: z.literal('approved_claim'),
  projectId: projectIdSchema,
  taskId: taskIdSchema,
  executionId: executionIdSchema,
  resultSubmissionId: resultSubmissionIdSchema,
  workerUserId: userIdSchema,
  contractRevision: revisionSchema,
  resultRevision: revisionSchema,
  claim: claimSchema,
  evidenceRefs: z.array(evidenceRefSchema).min(1).max(1_000),
  workerAttestationId: workerAttestationIdSchema,
  attestationDigest: sha256Schema,
  coordinatorReviewId: reviewDecisionIdSchema,
  reviewDigest: sha256Schema,
  approvedByUserId: userIdSchema,
  approvedAt: timestampSchema,
  approvalDigest: sha256Schema
}).strict().superRefine((approved, context) => {
  const evidenceRefsById = new Set(approved.evidenceRefs.map(({ evidenceRefId }) => evidenceRefId))
  for (const evidenceRefId of approved.claim.evidenceRefIds) {
    if (!evidenceRefsById.has(evidenceRefId)) {
      context.addIssue({
        code: 'custom',
        path: ['evidenceRefs'],
        message: `Approved Claim is missing cited EvidenceRef: ${evidenceRefId}`
      })
    }
  }
  const { approvalDigest, ...payload } = approved
  if (scientificDigest(payload) !== approvalDigest) {
    context.addIssue({
      code: 'custom',
      path: ['approvalDigest'],
      message: 'Approved Claim digest must cover the approved projection.'
    })
  }
})
export type ApprovedClaim = z.infer<typeof approvedClaimSchema>
