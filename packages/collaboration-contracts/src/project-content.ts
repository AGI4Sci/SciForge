import { z } from 'zod'

import { providerInstanceRefSchema } from '@sciforge/domain-sdk/provider-composition'

import {
  agentIdSchema,
  contentRecoveryJournalEntryIdSchema,
  deviceIdSchema,
  entityMetadataShape,
  executionIdSchema,
  projectContentBindingIdSchema,
  projectIdSchema,
  providerPrincipalFactIdSchema,
  providerObservationIdSchema,
  providerOpaqueIdSchema,
  provisioningAttestationIdSchema,
  provisioningIntentIdSchema,
  recoveryActionIdSchema,
  revisionSchema,
  safeCodeSchema,
  sha256Schema,
  taskIdSchema,
  timestampSchema,
  userIdSchema
} from './core.js'
import { portableContentSpaceLocatorSchema } from './content-space-task-io.js'
import {
  canonicalDeviceFactAttestationBytes,
  deviceFactSignatureMetadataSchema
} from './identity.js'

const canonicalOpaqueSchema = (maximum: number) => z.string()
  .min(1)
  .max(maximum)
  .refine((value) => value === value.trim(), 'Opaque values must be canonical.')
  .refine(
    (value) => [...value].every((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint !== undefined && codePoint >= 32 && codePoint !== 127
    }),
    'Opaque values cannot contain control characters.'
  )

export { providerInstanceRefSchema }
export type { ProviderInstanceRef } from '@sciforge/domain-sdk/provider-composition'

const sameProviderInstance = (
  left: z.infer<typeof providerInstanceReferenceSchema>,
  right: z.infer<typeof providerInstanceReferenceSchema>
): boolean => left.providerInstanceRef === right.providerInstanceRef

export const providerInstanceReferenceSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('provider_instance_reference'),
  providerInstanceRef: providerInstanceRefSchema
}).strict()
export type ProviderInstanceReference = z.infer<typeof providerInstanceReferenceSchema>

/** Non-secret directory identity. It is descriptive and never carries Provider authority. */
export const providerDirectoryPrincipalReferenceSchema = z.object({
  schemaVersion: z.literal(1),
  type: z.literal('provider_directory_principal_reference'),
  providerInstance: providerInstanceReferenceSchema,
  principalKind: z.literal('user'),
  principalId: providerOpaqueIdSchema
}).strict()
export type ProviderDirectoryPrincipalReference = z.infer<typeof providerDirectoryPrincipalReferenceSchema>

export const providerDirectoryPrincipalFactReadinessSchema = z.enum(['ready', 'degraded'])
export const providerDirectoryPrincipalFactReadinessReasonSchema = z.enum([
  'provider_binding_changed',
  'provider_unavailable',
  'provider_unauthorized'
])

/**
 * Global non-secret identity fact for one exact User + Provider Instance slot.
 * It is factual provenance only and never represents Provider ACL or Task authority.
 */
export const providerDirectoryPrincipalFactSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('provider_directory_principal_fact'),
  providerPrincipalFactId: providerPrincipalFactIdSchema,
  userId: userIdSchema,
  providerPrincipal: providerDirectoryPrincipalReferenceSchema,
  principalIdentityRevision: revisionSchema,
  providerBindingAttestationDigest: sha256Schema,
  publishedByDeviceId: deviceIdSchema,
  readiness: providerDirectoryPrincipalFactReadinessSchema,
  readinessReason: providerDirectoryPrincipalFactReadinessReasonSchema.nullable(),
  observedAt: timestampSchema
}).strict().superRefine((fact, context) => {
  if ((fact.readiness === 'ready') !== (fact.readinessReason === null)) {
    context.addIssue({
      code: 'custom',
      path: ['readinessReason'],
      message: 'A ready Provider principal fact has no degradation reason; a degraded fact requires one.'
    })
  }
})
export type ProviderDirectoryPrincipalFact = z.infer<typeof providerDirectoryPrincipalFactSchema>

export const projectContentDesiredMemberSchema = z.object({
  userId: userIdSchema,
  providerPrincipalFactId: providerPrincipalFactIdSchema,
  snapshottedFactRevision: revisionSchema,
  principal: providerDirectoryPrincipalReferenceSchema
}).strict()
export type ProjectContentDesiredMember = z.infer<typeof projectContentDesiredMemberSchema>

export const provisioningIntentKindSchema = z.enum([
  'initial_provisioning',
  'membership_change',
  'reconcile',
  'rebind',
  'content_owner_transfer'
])
export const provisioningIntentStateSchema = z.enum([
  'pending',
  'in_progress',
  'awaiting_attestation',
  'manual_recovery_required',
  'completed',
  'superseded',
  'cancelled'
])
export type ProvisioningIntentKind = z.infer<typeof provisioningIntentKindSchema>
export type ProvisioningIntentState = z.infer<typeof provisioningIntentStateSchema>

export const projectContentProvisioningIntentSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_content_provisioning_intent'),
  provisioningIntentId: provisioningIntentIdSchema,
  projectId: projectIdSchema,
  provisioningRevision: revisionSchema,
  kind: provisioningIntentKindSchema,
  state: provisioningIntentStateSchema,
  createdByOwnerUserId: userIdSchema,
  contentOwnerUserId: userIdSchema,
  providerInstance: providerInstanceReferenceSchema,
  desiredMembers: z.array(projectContentDesiredMemberSchema).min(1).max(1_000),
  containerDisplayName: z.string().trim().min(1).max(200),
  currentRootLocator: portableContentSpaceLocatorSchema.nullable(),
  currentBindingRevision: revisionSchema.nullable(),
  intentDigest: sha256Schema
}).strict().superRefine((intent, context) => {
  const users = intent.desiredMembers.map(({ userId }) => userId)
  if (new Set(users).size !== users.length) {
    context.addIssue({ code: 'custom', path: ['desiredMembers'], message: 'Desired member Users must be unique.' })
  }
  const principals = intent.desiredMembers.map(({ principal }) => (
    `${principal.providerInstance.providerInstanceRef}\u0000${principal.principalId}`
  ))
  if (new Set(principals).size !== principals.length) {
    context.addIssue({ code: 'custom', path: ['desiredMembers'], message: 'Desired Provider principals must be unique.' })
  }
  const factIds = intent.desiredMembers.map(({ providerPrincipalFactId }) => providerPrincipalFactId)
  if (new Set(factIds).size !== factIds.length) {
    context.addIssue({ code: 'custom', path: ['desiredMembers'], message: 'Desired Provider principal facts must be unique.' })
  }
  if (!intent.desiredMembers.some(({ userId }) => userId === intent.contentOwnerUserId)) {
    context.addIssue({
      code: 'custom',
      path: ['desiredMembers'],
      message: 'The exact content owner User must be in the one desired member fact set.'
    })
  }
  for (const [index, member] of intent.desiredMembers.entries()) {
    if (!sameProviderInstance(intent.providerInstance, member.principal.providerInstance)) {
      context.addIssue({
        code: 'custom',
        path: ['desiredMembers', index, 'principal', 'providerInstance'],
        message: 'Every desired principal must belong to the target Provider Instance.'
      })
    }
  }

  if ((intent.currentRootLocator === null) !== (intent.currentBindingRevision === null)) {
    context.addIssue({
      code: 'custom',
      path: ['currentBindingRevision'],
      message: 'A current binding revision and root locator must be supplied together.'
    })
  }
  if (intent.currentRootLocator !== null && intent.currentRootLocator.kind !== 'content-space.container-reference') {
    context.addIssue({
      code: 'custom',
      path: ['currentRootLocator', 'kind'],
      message: 'A Project content root must be a container reference.'
    })
  }
})
export type ProjectContentProvisioningIntent = z.infer<typeof projectContentProvisioningIntentSchema>

export const provisioningObservedOperationKindSchema = z.enum([
  'create_shared_container',
  'observe_root',
  'list_members',
  'add_member',
  'remove_member',
  'download_check',
  'upload_new',
  'observe_output'
])
export const factualObservationOutcomeSchema = z.enum([
  'observed_success',
  'observed_absent',
  'observed_failure',
  'outcome_unknown',
  'unauthorized'
])

export const provisioningObservedOperationSchema = z.object({
  operationId: canonicalOpaqueSchema(128),
  operationRevision: revisionSchema,
  kind: provisioningObservedOperationKindSchema,
  subjectPrincipal: providerDirectoryPrincipalReferenceSchema.nullable(),
  requestDigest: sha256Schema,
  receiptDigest: sha256Schema.nullable(),
  outcome: factualObservationOutcomeSchema,
  safeFailureCode: safeCodeSchema.nullable(),
  observedAt: timestampSchema
}).strict().superRefine((operation, context) => {
  const failed = operation.outcome === 'observed_failure' ||
    operation.outcome === 'outcome_unknown' ||
    operation.outcome === 'unauthorized'
  if (failed !== (operation.safeFailureCode !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['safeFailureCode'],
      message: 'Failure, uncertainty and unauthorized observations require one bounded safe failure code.'
    })
  }
  if (operation.outcome === 'observed_success' && operation.receiptDigest === null) {
    context.addIssue({
      code: 'custom',
      path: ['receiptDigest'],
      message: 'An observed successful write or read must retain its exact receipt digest.'
    })
  }
})
export type ProvisioningObservedOperation = z.infer<typeof provisioningObservedOperationSchema>

export const providerMemberPresenceSchema = z.enum(['present', 'absent'])
export const provisionedMemberObservationSchema = z.object({
  userId: userIdSchema,
  providerPrincipalFactId: providerPrincipalFactIdSchema,
  snapshottedFactRevision: revisionSchema,
  principal: providerDirectoryPrincipalReferenceSchema,
  presence: providerMemberPresenceSchema,
  observationDigest: sha256Schema,
  observedAt: timestampSchema
}).strict()
export type ProvisionedMemberObservation = z.infer<typeof provisionedMemberObservationSchema>

export const provisionedMemberSetSchema = z.array(provisionedMemberObservationSchema).min(1).max(1_000)
  .superRefine((members, context) => {
    const users = members.map(({ userId }) => userId)
    if (new Set(users).size !== users.length) {
      context.addIssue({ code: 'custom', message: 'Provisioned member observations must be unique by User.' })
    }
    const factIds = members.map(({ providerPrincipalFactId }) => providerPrincipalFactId)
    if (new Set(factIds).size !== factIds.length) {
      context.addIssue({ code: 'custom', message: 'Provisioned member observations must use unique Provider principal facts.' })
    }
  })
export type ProvisionedMemberSet = z.infer<typeof provisionedMemberSetSchema>

export const projectContentProvisioningFactualPayloadSchema = z.object({
  format: z.literal('sciforge.project-content-provisioning-attestation.v1'),
  provisioningAttestationId: provisioningAttestationIdSchema,
  projectId: projectIdSchema,
  provisioningIntentId: provisioningIntentIdSchema,
  provisioningRevision: revisionSchema,
  ownerUserId: userIdSchema,
  principalIdentityRevision: revisionSchema,
  providerBindingAttestationDigest: sha256Schema,
  providerInstance: providerInstanceReferenceSchema,
  rootLocator: portableContentSpaceLocatorSchema,
  rootLocatorDigest: sha256Schema,
  observedOperations: z.array(provisioningObservedOperationSchema).min(1).max(2_000),
  memberObservations: provisionedMemberSetSchema,
  memberSetDigest: sha256Schema,
  observationStartedAt: timestampSchema,
  observationCompletedAt: timestampSchema
}).strict()
export type ProjectContentProvisioningFactualPayload = z.infer<
  typeof projectContentProvisioningFactualPayloadSchema
>

function stableJson(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'number' || typeof value === 'string') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (typeof value !== 'object') throw new TypeError('Canonical factual payload contains an unsupported value.')
  const fields = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
    .map(([key, child]) => `${JSON.stringify(key)}:${stableJson(child)}`)
  return `{${fields.join(',')}}`
}

/**
 * The sole runtime-neutral member-set serialization. Callers hash these bytes
 * only inside their private cryptographic boundary; this package does not
 * select or implement a digest algorithm.
 */
export function canonicalProvisionedMemberSetBytes(
  input: readonly ProvisionedMemberObservation[]
): Uint8Array {
  const members = provisionedMemberSetSchema.parse(input)
  const ordered = [...members].sort((left, right) => left.userId < right.userId ? -1 : left.userId > right.userId ? 1 : 0)
  return new TextEncoder().encode(stableJson(ordered))
}

export function canonicalProjectContentProvisioningFactualPayloadBytes(
  input: ProjectContentProvisioningFactualPayload
): Uint8Array {
  const payload = projectContentProvisioningFactualPayloadSchema.parse(input)
  return new TextEncoder().encode(stableJson(payload))
}

/**
 * A Device-signed statement of Provider observations. The signature proves the
 * observer and payload integrity; it is not a Provider permission or reusable grant.
 */
export const projectContentProvisioningAttestationSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_content_provisioning_attestation'),
  ...projectContentProvisioningFactualPayloadSchema.shape,
  deviceSignature: deviceFactSignatureMetadataSchema
}).strict().superRefine((attestation, context) => {
  if (attestation.rootLocator.kind !== 'content-space.container-reference') {
    context.addIssue({
      code: 'custom',
      path: ['rootLocator', 'kind'],
      message: 'Provisioning must observe one exact shared container root.'
    })
  }
  if (Date.parse(attestation.observationCompletedAt) < Date.parse(attestation.observationStartedAt)) {
    context.addIssue({
      code: 'custom',
      path: ['observationCompletedAt'],
      message: 'Observation completion cannot precede its start.'
    })
  }
  if (attestation.deviceSignature.userId !== attestation.ownerUserId) {
    context.addIssue({
      code: 'custom',
      path: ['deviceSignature', 'userId'],
      message: 'The Device signature must belong to the exact Project content owner.'
    })
  }
  if (attestation.deviceSignature.factRevision !== attestation.provisioningRevision) {
    context.addIssue({
      code: 'custom',
      path: ['deviceSignature', 'factRevision'],
      message: 'The Device signature must bind the exact provisioning revision.'
    })
  }
  if (attestation.deviceSignature.observedAt !== attestation.observationCompletedAt) {
    context.addIssue({
      code: 'custom',
      path: ['deviceSignature', 'observedAt'],
      message: 'The Device signature observation time must match the factual payload completion.'
    })
  }
  if (Date.parse(attestation.deviceSignature.issuedAt) < Date.parse(attestation.observationCompletedAt)) {
    context.addIssue({
      code: 'custom',
      path: ['deviceSignature', 'issuedAt'],
      message: 'Attestation issuance cannot precede its observations.'
    })
  }
  const operationIds = attestation.observedOperations.map(({ operationId }) => operationId)
  if (new Set(operationIds).size !== operationIds.length) {
    context.addIssue({ code: 'custom', path: ['observedOperations'], message: 'Observed operation IDs must be unique.' })
  }
  for (const [index, member] of attestation.memberObservations.entries()) {
    if (!sameProviderInstance(attestation.providerInstance, member.principal.providerInstance)) {
      context.addIssue({
        code: 'custom',
        path: ['memberObservations', index, 'principal', 'providerInstance'],
        message: 'Every member observation must belong to the attested Provider Instance.'
      })
    }
  }
})
export type ProjectContentProvisioningAttestation = z.infer<typeof projectContentProvisioningAttestationSchema>

export function projectContentProvisioningFactualPayloadFromAttestation(
  input: ProjectContentProvisioningAttestation
): ProjectContentProvisioningFactualPayload {
  const attestation = projectContentProvisioningAttestationSchema.parse(input)
  return projectContentProvisioningFactualPayloadSchema.parse({
    format: attestation.format,
    provisioningAttestationId: attestation.provisioningAttestationId,
    projectId: attestation.projectId,
    provisioningIntentId: attestation.provisioningIntentId,
    provisioningRevision: attestation.provisioningRevision,
    ownerUserId: attestation.ownerUserId,
    principalIdentityRevision: attestation.principalIdentityRevision,
    providerBindingAttestationDigest: attestation.providerBindingAttestationDigest,
    providerInstance: attestation.providerInstance,
    rootLocator: attestation.rootLocator,
    rootLocatorDigest: attestation.rootLocatorDigest,
    observedOperations: attestation.observedOperations,
    memberObservations: attestation.memberObservations,
    memberSetDigest: attestation.memberSetDigest,
    observationStartedAt: attestation.observationStartedAt,
    observationCompletedAt: attestation.observationCompletedAt
  })
}

export function canonicalProjectContentProvisioningAttestationFactualPayloadBytes(
  input: ProjectContentProvisioningAttestation
): Uint8Array {
  return canonicalProjectContentProvisioningFactualPayloadBytes(
    projectContentProvisioningFactualPayloadFromAttestation(input)
  )
}

export function canonicalProjectContentProvisioningAttestationSignatureBytes(
  input: ProjectContentProvisioningAttestation
): Uint8Array {
  const attestation = projectContentProvisioningAttestationSchema.parse(input)
  return canonicalDeviceFactAttestationBytes(attestation.deviceSignature)
}

export const providerMembershipObservationOutcomeSchema = z.enum([
  'present',
  'absent',
  'unavailable',
  'unauthorized'
])
export const providerMembershipObservationSourceSchema = z.enum([
  'provisioning_attestation',
  'explicit_reconcile',
  'download_check',
  'upload_new'
])

export const projectProviderMembershipObservationSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_provider_membership_observation'),
  providerObservationId: providerObservationIdSchema,
  projectId: projectIdSchema,
  userId: userIdSchema,
  providerPrincipalFactId: providerPrincipalFactIdSchema,
  snapshottedFactRevision: revisionSchema,
  providerPrincipal: providerDirectoryPrincipalReferenceSchema,
  bindingRevision: revisionSchema,
  provisioningRevision: revisionSchema,
  source: providerMembershipObservationSourceSchema,
  outcome: providerMembershipObservationOutcomeSchema,
  observerUserId: userIdSchema,
  observerDeviceId: deviceIdSchema,
  observerAgentId: agentIdSchema.nullable(),
  provisioningAttestationId: provisioningAttestationIdSchema.nullable(),
  evidenceDigest: sha256Schema,
  observedAt: timestampSchema
}).strict().superRefine((observation, context) => {
  if ((observation.source === 'provisioning_attestation') !== (
    observation.provisioningAttestationId !== null
  )) {
    context.addIssue({
      code: 'custom',
      path: ['provisioningAttestationId'],
      message: 'Only a provisioning-attestation observation names its attestation.'
    })
  }
})
export type ProjectProviderMembershipObservation = z.infer<
  typeof projectProviderMembershipObservationSchema
>

export const projectContentReadinessStateSchema = z.enum([
  'missing_identity',
  'pending',
  'ready',
  'degraded'
])
export const projectContentReadinessReasonSchema = z.enum([
  'identity_missing',
  'provisioning_pending',
  'provider_member_absent',
  'provider_unavailable',
  'provider_unauthorized',
  'binding_degraded',
  'content_owner_lost_root'
])
export type ProjectContentReadinessState = z.infer<typeof projectContentReadinessStateSchema>

export const projectContentReadinessSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_content_readiness'),
  projectId: projectIdSchema,
  userId: userIdSchema,
  providerInstance: providerInstanceReferenceSchema,
  state: projectContentReadinessStateSchema,
  reason: projectContentReadinessReasonSchema.nullable(),
  providerPrincipalFactId: providerPrincipalFactIdSchema.nullable(),
  snapshottedFactRevision: revisionSchema.nullable(),
  providerPrincipal: providerDirectoryPrincipalReferenceSchema.nullable(),
  bindingRevision: revisionSchema.nullable(),
  lastObservationId: providerObservationIdSchema.nullable(),
  effectiveAt: timestampSchema
}).strict().superRefine((readiness, context) => {
  if ((readiness.state === 'ready') !== (readiness.reason === null)) {
    context.addIssue({
      code: 'custom',
      path: ['reason'],
      message: 'Ready content state has no reason; every non-ready state requires one.'
    })
  }
  if (readiness.providerPrincipal !== null &&
      !sameProviderInstance(readiness.providerInstance, readiness.providerPrincipal.providerInstance)) {
    context.addIssue({
      code: 'custom',
      path: ['providerPrincipal', 'providerInstance'],
      message: 'Project content readiness principal must belong to the exact Project Provider Instance.'
    })
  }
  const missingIdentity = readiness.state === 'missing_identity'
  const missingSnapshot = readiness.providerPrincipalFactId === null &&
    readiness.snapshottedFactRevision === null &&
    readiness.providerPrincipal === null
  const completeSnapshot = readiness.providerPrincipalFactId !== null &&
    readiness.snapshottedFactRevision !== null &&
    readiness.providerPrincipal !== null
  if ((missingIdentity && !missingSnapshot) || (!missingIdentity && !completeSnapshot)) {
    context.addIssue({
      code: 'custom',
      path: ['providerPrincipal'],
      message: 'Only missing-identity readiness omits the exact snapshotted Provider principal fact.'
    })
  }
  if (readiness.state === 'ready' && (
    readiness.bindingRevision === null || readiness.lastObservationId === null
  )) {
    context.addIssue({
      code: 'custom',
      path: ['lastObservationId'],
      message: 'Ready content state requires an exact binding revision and Provider observation.'
    })
  }
})
export type ProjectContentReadiness = z.infer<typeof projectContentReadinessSchema>

export const projectContentSpaceBindingStatusSchema = z.enum([
  'provisioning',
  'active',
  'degraded',
  'closed'
])
export const projectContentSpaceBindingReasonSchema = z.enum([
  'provisioning_incomplete',
  'provider_unavailable',
  'owner_access_lost',
  'rebind_required',
  'content_owner_transfer_pending',
  'project_archived',
  'project_deleted',
  'owner_requested'
])

/** Cloud association metadata only. It never stores or asserts Provider ACL. */
export const projectContentSpaceBindingSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('project_content_space_binding'),
  projectContentBindingId: projectContentBindingIdSchema,
  projectId: projectIdSchema,
  contentOwnerUserId: userIdSchema,
  providerInstance: providerInstanceReferenceSchema,
  rootLocator: portableContentSpaceLocatorSchema.nullable(),
  rootLocatorDigest: sha256Schema.nullable(),
  provisioningIntentId: provisioningIntentIdSchema,
  provisioningRevision: revisionSchema,
  attestationId: provisioningAttestationIdSchema.nullable(),
  attestationDigest: sha256Schema.nullable(),
  status: projectContentSpaceBindingStatusSchema,
  statusReason: projectContentSpaceBindingReasonSchema.nullable(),
  activatedAt: timestampSchema.nullable(),
  degradedAt: timestampSchema.nullable(),
  closedAt: timestampSchema.nullable()
}).strict().superRefine((binding, context) => {
  const hasRoot = binding.rootLocator !== null && binding.rootLocatorDigest !== null
  if ((binding.rootLocator === null) !== (binding.rootLocatorDigest === null)) {
    context.addIssue({ code: 'custom', path: ['rootLocatorDigest'], message: 'Root locator and digest must be stored together.' })
  }
  if (binding.rootLocator !== null && binding.rootLocator.kind !== 'content-space.container-reference') {
    context.addIssue({
      code: 'custom',
      path: ['rootLocator', 'kind'],
      message: 'A Project content binding root must be a container reference.'
    })
  }
  const attested = binding.attestationId !== null && binding.attestationDigest !== null
  if ((binding.attestationId === null) !== (binding.attestationDigest === null)) {
    context.addIssue({ code: 'custom', path: ['attestationDigest'], message: 'Attestation identity and digest must be stored together.' })
  }
  const degradationReasons = new Set([
    'provider_unavailable',
    'owner_access_lost',
    'rebind_required',
    'content_owner_transfer_pending'
  ])
  const closeReasons = new Set(['project_archived', 'project_deleted', 'owner_requested'])
  if (binding.status === 'provisioning') {
    if (
      !hasRoot ||
      binding.statusReason !== 'provisioning_incomplete' ||
      binding.activatedAt !== null ||
      binding.degradedAt !== null ||
      binding.closedAt !== null
    ) {
      context.addIssue({ code: 'custom', path: ['status'], message: 'Provisioning binding requires an exact candidate root but remains unattached and inactive.' })
    }
  } else if (binding.status === 'active') {
    if (!hasRoot || !attested || binding.activatedAt === null || binding.statusReason !== null || binding.degradedAt !== null || binding.closedAt !== null) {
      context.addIssue({ code: 'custom', path: ['status'], message: 'Active binding requires its attested root and activation facts only.' })
    }
  } else if (binding.status === 'degraded') {
    if (!hasRoot || !attested || binding.activatedAt === null || binding.statusReason === null || !degradationReasons.has(binding.statusReason) || binding.degradedAt === null || binding.closedAt !== null) {
      context.addIssue({ code: 'custom', path: ['status'], message: 'Degraded binding retains activation and one closed degradation reason.' })
    }
  } else {
    if (binding.statusReason === null || !closeReasons.has(binding.statusReason) || binding.closedAt === null) {
      context.addIssue({ code: 'custom', path: ['status'], message: 'Closed binding requires one explicit close reason and time.' })
    }
    if (binding.activatedAt !== null && (!hasRoot || !attested)) {
      context.addIssue({ code: 'custom', path: ['activatedAt'], message: 'A previously active closed binding retains its attested root.' })
    }
    if (binding.degradedAt !== null && binding.activatedAt === null) {
      context.addIssue({ code: 'custom', path: ['degradedAt'], message: 'Only a previously active binding can retain degradation history.' })
    }
  }
})
export type ProjectContentSpaceBinding = z.infer<typeof projectContentSpaceBindingSchema>

export const externalOperationRecoveryStateSchema = z.enum([
  'prepared',
  'dispatched',
  'observed_success',
  'observed_failure',
  'outcome_unknown',
  'abandoned'
])
export const externalOperationKindSchema = z.enum([
  'create_shared_container',
  'list_members',
  'add_member',
  'remove_member',
  'observe_root',
  'download',
  'upload_new',
  'observe_output'
])
export const externalOperationRecoveryScopeSchema = z.enum([
  'project_provisioning',
  'project_membership',
  'task_content_transfer'
])

export const externalOperationRecoveryJournalEntrySchema = z.object({
  ...entityMetadataShape,
  type: z.literal('external_operation_recovery_journal_entry'),
  contentRecoveryJournalEntryId: contentRecoveryJournalEntryIdSchema,
  scope: externalOperationRecoveryScopeSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema.nullable(),
  executionId: executionIdSchema.nullable(),
  preparedTaskRevision: revisionSchema.nullable(),
  preparedExecutionRevision: revisionSchema.nullable(),
  provisioningIntentId: provisioningIntentIdSchema.nullable(),
  provisioningRevision: revisionSchema.nullable(),
  logicalInvocationId: canonicalOpaqueSchema(128),
  operation: externalOperationKindSchema,
  state: externalOperationRecoveryStateSchema,
  requestDigest: sha256Schema,
  receiptDigest: sha256Schema.nullable(),
  observationDigest: sha256Schema.nullable(),
  safeFailureCode: safeCodeSchema.nullable(),
  preparedAt: timestampSchema,
  dispatchedAt: timestampSchema.nullable(),
  resolvedAt: timestampSchema.nullable()
}).strict().superRefine((entry, context) => {
  const taskScoped = entry.scope === 'task_content_transfer'
  if (taskScoped !== (
    entry.taskId !== null &&
    entry.executionId !== null &&
    entry.preparedTaskRevision !== null &&
    entry.preparedExecutionRevision !== null
  )) {
    context.addIssue({
      code: 'custom',
      path: ['taskId'],
      message: 'Only Task content transfer recovery is bound to a Task execution.'
    })
  }
  if (!taskScoped && (
    entry.taskId !== null ||
    entry.executionId !== null ||
    entry.preparedTaskRevision !== null ||
    entry.preparedExecutionRevision !== null
  )) {
    context.addIssue({
      code: 'custom',
      path: ['preparedTaskRevision'],
      message: 'Only Task content transfer recovery carries Task and execution revisions.'
    })
  }
  if (taskScoped && (entry.provisioningIntentId !== null || entry.provisioningRevision !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['provisioningIntentId'],
      message: 'Task content transfer recovery cannot claim a provisioning intent.'
    })
  }
  const provisioningScoped = entry.scope !== 'task_content_transfer'
  if (provisioningScoped !== (
    entry.provisioningIntentId !== null && entry.provisioningRevision !== null
  )) {
    context.addIssue({
      code: 'custom',
      path: ['provisioningIntentId'],
      message: 'Provisioning and membership recovery require the exact intent revision.'
    })
  }
  if ((entry.state !== 'prepared') !== (entry.dispatchedAt !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['dispatchedAt'],
      message: 'Every state after prepared requires dispatch time.'
    })
  }
  const terminal = entry.state === 'observed_success' || entry.state === 'observed_failure' || entry.state === 'abandoned'
  if (terminal !== (entry.resolvedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['resolvedAt'], message: 'Only resolved recovery entries have resolution time.' })
  }
  const failed = entry.state === 'observed_failure' || entry.state === 'outcome_unknown'
  if (failed !== (entry.safeFailureCode !== null)) {
    context.addIssue({
      code: 'custom',
      path: ['safeFailureCode'],
      message: 'Observed failure and unknown outcome require one safe failure code.'
    })
  }
  if (entry.state === 'observed_success' && (
    entry.receiptDigest === null || entry.observationDigest === null
  )) {
    context.addIssue({
      code: 'custom',
      path: ['observationDigest'],
      message: 'Observed success requires exact receipt and write-after-observation digests.'
    })
  }
})
export type ExternalOperationRecoveryJournalEntry = z.infer<
  typeof externalOperationRecoveryJournalEntrySchema
>

export const visibleRecoveryActionKindSchema = z.enum([
  'resume_provisioning',
  'reconcile_provider_membership',
  'reconcile_exact_output',
  'link_observed_output',
  'abandon_execution',
  'rebind_content_root',
  'reprovision_content_root',
  'change_content_owner'
])

export const visibleRecoveryActionSchema = z.object({
  ...entityMetadataShape,
  type: z.literal('visible_recovery_action'),
  recoveryActionId: recoveryActionIdSchema,
  projectId: projectIdSchema,
  taskId: taskIdSchema.nullable(),
  executionId: executionIdSchema.nullable(),
  journalEntryId: contentRecoveryJournalEntryIdSchema,
  audience: z.enum(['owner', 'coordinator']),
  action: visibleRecoveryActionKindSchema,
  status: z.enum(['available', 'completed', 'withdrawn']),
  requiresFreshObservation: z.boolean(),
  safeSummary: z.string().trim().min(1).max(500),
  availableAt: timestampSchema,
  completedAt: timestampSchema.nullable()
}).strict().superRefine((action, context) => {
  if ((action.status === 'completed') !== (action.completedAt !== null)) {
    context.addIssue({ code: 'custom', path: ['completedAt'], message: 'Only completed recovery action has a completion time.' })
  }
  if ((action.taskId === null) !== (action.executionId === null)) {
    context.addIssue({ code: 'custom', path: ['executionId'], message: 'Task and execution recovery scope must be supplied together.' })
  }
})
export type VisibleRecoveryAction = z.infer<typeof visibleRecoveryActionSchema>
