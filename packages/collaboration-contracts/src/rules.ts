import { z } from 'zod'
import {
  idempotencyKeySchema,
  receiptIdSchema,
  revisionSchema,
  sha256Schema
} from './core.js'
import type { ProviderIdentity } from './provider.js'

export const PROJECT_TRANSITIONS = {
  draft: ['paused', 'active', 'cancelled'],
  active: ['paused', 'completed', 'cancelled'],
  paused: ['active', 'cancelled'],
  completed: [],
  cancelled: []
} as const

export const TASK_TRANSITIONS = {
  planned: ['offered', 'cancelled'],
  offered: ['in_progress', 'failed', 'cancelled'],
  in_progress: ['needs_human', 'awaiting_review', 'manual_recovery_required', 'failed', 'cancelled'],
  needs_human: ['in_progress', 'failed', 'cancelled'],
  awaiting_review: ['completed', 'revision_requested', 'manual_recovery_required', 'cancelled'],
  revision_requested: ['offered', 'cancelled'],
  manual_recovery_required: ['awaiting_review', 'revision_requested', 'cancelled'],
  completed: [],
  failed: [],
  cancelled: []
} as const

export const TASK_EXECUTION_TRANSITIONS = {
  offered: ['accepted', 'rejected', 'cancelled', 'timed_out', 'revoked', 'superseded'],
  accepted: ['running', 'failed', 'cancelled', 'revoked', 'superseded'],
  rejected: [],
  running: ['needs_human', 'result_submitted', 'manual_recovery_required', 'failed', 'cancelled', 'revoked', 'superseded'],
  needs_human: ['running', 'failed', 'cancelled', 'revoked', 'superseded'],
  result_submitted: ['completed', 'superseded'],
  manual_recovery_required: ['result_submitted', 'cancelled', 'superseded'],
  completed: [],
  failed: [],
  cancelled: [],
  timed_out: [],
  revoked: [],
  superseded: []
} as const

export const TASK_OFFER_TRANSITIONS = {
  pending: ['accepted', 'rejected', 'withdrawn', 'timed_out'],
  accepted: [],
  rejected: [],
  withdrawn: [],
  timed_out: []
} as const

export const PROJECT_PLAN_TRANSITIONS = {
  draft: ['awaiting_confirmation', 'superseded'],
  awaiting_confirmation: ['confirmed', 'superseded'],
  confirmed: ['superseded'],
  superseded: []
} as const

export const PROJECT_MEMBERSHIP_TRANSITIONS = {
  pending_membership: ['active'],
  active: ['membership_removal_pending'],
  membership_removal_pending: ['removed'],
  removed: []
} as const

export const PROJECT_CONTENT_BINDING_TRANSITIONS = {
  provisioning: ['active', 'closed'],
  active: ['degraded', 'closed'],
  degraded: ['active', 'closed'],
  closed: []
} as const

export const PROJECT_CONTENT_READINESS_TRANSITIONS = {
  missing_identity: ['pending'],
  pending: ['missing_identity', 'ready', 'degraded'],
  ready: ['pending', 'degraded'],
  degraded: ['missing_identity', 'pending', 'ready']
} as const

export const PROVIDER_PRINCIPAL_FACT_READINESS_TRANSITIONS = {
  ready: ['degraded'],
  degraded: ['ready']
} as const

export const TASK_AUTHORITY_TRANSITIONS = {
  eligible: ['suspended', 'fenced'],
  suspended: ['eligible', 'fenced'],
  fenced: []
} as const

export const PROJECT_CONTENT_PROVISIONING_INTENT_TRANSITIONS = {
  pending: ['in_progress', 'cancelled', 'superseded'],
  in_progress: ['awaiting_attestation', 'manual_recovery_required', 'cancelled', 'superseded'],
  awaiting_attestation: ['completed', 'manual_recovery_required', 'superseded'],
  manual_recovery_required: ['in_progress', 'awaiting_attestation', 'cancelled', 'superseded'],
  completed: [],
  superseded: [],
  cancelled: []
} as const

export const EXTERNAL_OPERATION_RECOVERY_TRANSITIONS = {
  prepared: ['dispatched'],
  dispatched: ['observed_success', 'observed_failure', 'outcome_unknown'],
  observed_success: [],
  observed_failure: [],
  outcome_unknown: ['observed_success', 'observed_failure', 'abandoned'],
  abandoned: []
} as const

export const STATE_TRANSITIONS = {
  user: {
    active: ['suspended', 'revoked'],
    suspended: ['active', 'revoked'],
    revoked: []
  },
  endpoint: {
    active: ['suspended', 'revoked'],
    suspended: ['active', 'revoked'],
    revoked: []
  },
  ['agent']: {
    active: ['revoked'],
    revoked: []
  },
  participant: {
    incomplete: ['active', 'suspended', 'revoked'],
    active: ['incomplete', 'suspended', 'revoked'],
    suspended: ['incomplete', 'active', 'revoked'],
    revoked: []
  },
  projection: {
    active: ['paused', 'error', 'closed'],
    paused: ['active', 'error', 'closed'],
    error: ['active', 'paused', 'closed'],
    closed: []
  },
  project_input: {
    queued: ['processed', 'rejected', 'expired'],
    processed: [],
    rejected: [],
    expired: []
  },
  project: PROJECT_TRANSITIONS,
  project_endpoint_binding: {
    active: ['error', 'closed'],
    error: ['active', 'closed'],
    closed: []
  },
  task: TASK_TRANSITIONS,
  task_execution: TASK_EXECUTION_TRANSITIONS,
  task_offer: TASK_OFFER_TRANSITIONS,
  project_plan: PROJECT_PLAN_TRANSITIONS,
  project_membership: PROJECT_MEMBERSHIP_TRANSITIONS,
  project_content_binding: PROJECT_CONTENT_BINDING_TRANSITIONS,
  project_content_readiness: PROJECT_CONTENT_READINESS_TRANSITIONS,
  provider_directory_principal_fact: PROVIDER_PRINCIPAL_FACT_READINESS_TRANSITIONS,
  task_authority: TASK_AUTHORITY_TRANSITIONS,
  project_content_provisioning_intent: PROJECT_CONTENT_PROVISIONING_INTENT_TRANSITIONS,
  external_operation_recovery: EXTERNAL_OPERATION_RECOVERY_TRANSITIONS,
  project_record: {
    proposed: ['accepted', 'rejected'],
    accepted: [],
    rejected: []
  },
  human_needed: {
    pending: ['answered', 'expired', 'cancelled'],
    answered: [],
    expired: [],
    cancelled: []
  },
  inbox: {
    pending: ['delivered', 'acknowledged', 'expired', 'dead_letter'],
    delivered: ['acknowledged', 'expired', 'dead_letter'],
    acknowledged: [],
    expired: [],
    dead_letter: []
  }
} as const

export type StateMachineName = keyof typeof STATE_TRANSITIONS

export function canTransition(
  machine: StateMachineName,
  from: string,
  to: string
): boolean {
  const transitions = STATE_TRANSITIONS[machine] as Readonly<Record<string, readonly string[]>>
  return transitions[from]?.includes(to) ?? false
}

export const canTransitionProject = (from: string, to: string): boolean => canTransition('project', from, to)
export const canTransitionTask = (from: string, to: string): boolean => canTransition('task', from, to)
export const canTransitionTaskExecution = (from: string, to: string): boolean => canTransition('task_execution', from, to)
export const canTransitionTaskOffer = (from: string, to: string): boolean => canTransition('task_offer', from, to)
export const canTransitionProjectPlan = (from: string, to: string): boolean => canTransition('project_plan', from, to)
export const canTransitionProjectMembership = (from: string, to: string): boolean => canTransition('project_membership', from, to)
export const canTransitionProjectContentBinding = (from: string, to: string): boolean => canTransition('project_content_binding', from, to)
export const canTransitionProjectContentReadiness = (from: string, to: string): boolean => canTransition('project_content_readiness', from, to)
export const canTransitionProviderDirectoryPrincipalFact = (from: string, to: string): boolean => canTransition('provider_directory_principal_fact', from, to)
export const canTransitionTaskAuthority = (from: string, to: string): boolean => canTransition('task_authority', from, to)
export const canTransitionProjectContentProvisioningIntent = (from: string, to: string): boolean => canTransition('project_content_provisioning_intent', from, to)
export const canTransitionExternalOperationRecovery = (from: string, to: string): boolean => canTransition('external_operation_recovery', from, to)

export const stateTransitionSchema = z.object({
  machine: z.enum(Object.keys(STATE_TRANSITIONS) as [StateMachineName, ...StateMachineName[]]),
  from: z.string().min(1).max(64),
  to: z.string().min(1).max(64)
}).strict().superRefine((transition, context) => {
  if (!canTransition(transition.machine, transition.from, transition.to)) {
    context.addIssue({
      code: 'custom',
      message: `Invalid ${transition.machine} transition: ${transition.from} -> ${transition.to}`
    })
  }
})
export type StateTransition = z.infer<typeof stateTransitionSchema>

export const revisionCheckSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('match'),
    currentRevision: revisionSchema,
    nextRevision: revisionSchema
  }).strict(),
  z.object({
    outcome: z.literal('conflict'),
    expectedRevision: revisionSchema,
    currentRevision: revisionSchema
  }).strict()
])
export type RevisionCheck = z.infer<typeof revisionCheckSchema>

export function checkExpectedRevision(expectedRevision: number, currentRevision: number): RevisionCheck {
  if (expectedRevision === currentRevision) {
    return revisionCheckSchema.parse({
      outcome: 'match',
      currentRevision,
      nextRevision: currentRevision + 1
    })
  }
  return revisionCheckSchema.parse({ outcome: 'conflict', expectedRevision, currentRevision })
}

export const coordinatorAuthorityEpochCheckSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('match'),
    currentCoordinatorAuthorityEpoch: revisionSchema
  }).strict(),
  z.object({
    outcome: z.literal('fenced'),
    expectedCoordinatorAuthorityEpoch: revisionSchema,
    currentCoordinatorAuthorityEpoch: revisionSchema
  }).strict()
])
export type CoordinatorAuthorityEpochCheck = z.infer<typeof coordinatorAuthorityEpochCheckSchema>

/** Coordinator transfer increments the epoch; every old-epoch write is fenced. */
export function checkCoordinatorAuthorityEpoch(
  expectedCoordinatorAuthorityEpoch: number,
  currentCoordinatorAuthorityEpoch: number
): CoordinatorAuthorityEpochCheck {
  if (expectedCoordinatorAuthorityEpoch === currentCoordinatorAuthorityEpoch) {
    return coordinatorAuthorityEpochCheckSchema.parse({
      outcome: 'match',
      currentCoordinatorAuthorityEpoch
    })
  }
  return coordinatorAuthorityEpochCheckSchema.parse({
    outcome: 'fenced',
    expectedCoordinatorAuthorityEpoch,
    currentCoordinatorAuthorityEpoch
  })
}

export const idempotencyRecordSchema = z.object({
  actorKey: z.string().min(1).max(256),
  idempotencyKey: idempotencyKeySchema,
  requestHash: sha256Schema,
  receiptId: receiptIdSchema
}).strict()
export type IdempotencyRecord = z.infer<typeof idempotencyRecordSchema>

export const idempotencyReconciliationSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('new') }).strict(),
  z.object({ outcome: z.literal('duplicate'), receiptId: receiptIdSchema }).strict(),
  z.object({ outcome: z.literal('conflict'), receiptId: receiptIdSchema }).strict()
])
export type IdempotencyReconciliation = z.infer<typeof idempotencyReconciliationSchema>

export function reconcileIdempotency(
  existing: IdempotencyRecord | undefined,
  candidate: Omit<IdempotencyRecord, 'receiptId'>
): IdempotencyReconciliation {
  if (existing === undefined) return { outcome: 'new' }
  if (existing.actorKey !== candidate.actorKey || existing.idempotencyKey !== candidate.idempotencyKey) {
    return { outcome: 'new' }
  }
  return existing.requestHash === candidate.requestHash
    ? { outcome: 'duplicate', receiptId: existing.receiptId }
    : { outcome: 'conflict', receiptId: existing.receiptId }
}

export function providerIdentityKey(identity: ProviderIdentity): string {
  return [identity.provider, identity.realmId, identity.providerUserId]
    .map((part) => `${part.length}:${part}`)
    .join('|')
}

export const STABLE_ENTITY_ID_FIELDS = {
  user_principal: 'userId',
  human_endpoint_binding: 'humanEndpointId',
  agent_node: 'agentId',
  participant_profile: 'participantId',
  remote_session_projection: 'projectionId',
  project_input: 'projectInputId',
  project: 'projectId',
  project_endpoint_binding: 'projectEndpointBindingId',
  project_membership: 'projectMembershipId',
  task_authority: 'taskAuthorityId',
  provider_directory_principal_fact: 'providerPrincipalFactId',
  project_provider_membership_observation: 'providerObservationId',
  project_content_provisioning_intent: 'provisioningIntentId',
  project_content_provisioning_attestation: 'provisioningAttestationId',
  project_content_readiness: 'userId',
  project_content_space_binding: 'projectContentBindingId',
  external_operation_recovery_journal_entry: 'contentRecoveryJournalEntryId',
  visible_recovery_action: 'recoveryActionId',
  resource_ref: 'resourceRefId',
  task: 'taskId',
  task_execution: 'executionId',
  task_offer: 'taskOfferId',
  project_plan: 'projectPlanId',
  task_result_submission: 'resultSubmissionId',
  task_review_decision: 'reviewDecisionId',
  project_final_summary: 'projectRecordId',
  project_record: 'projectRecordId',
  human_needed: 'humanRequestId',
  human_answer: 'humanAnswerId'
} as const

export function hasStableEntityIdentity(
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>
): boolean {
  if (before.type !== after.type || typeof before.type !== 'string') return false
  const field = STABLE_ENTITY_ID_FIELDS[before.type as keyof typeof STABLE_ENTITY_ID_FIELDS]
  return field !== undefined && before[field] === after[field]
}
