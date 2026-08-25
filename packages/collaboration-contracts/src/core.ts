import { z } from 'zod'

export const CURRENT_PROTOCOL_VERSION = '1.0' as const
export const CURRENT_SCHEMA_VERSION = 1 as const

export const protocolVersionSchema = z.literal(CURRENT_PROTOCOL_VERSION)
export const schemaVersionSchema = z.literal(CURRENT_SCHEMA_VERSION)
export const versionStringSchema = z.string().regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)$/u)

export type ProtocolVersion = z.infer<typeof protocolVersionSchema>

export function isProtocolVersionCompatible(candidate: string): boolean {
  const parsed = versionStringSchema.safeParse(candidate)
  if (!parsed.success) return false
  const [candidateMajor, candidateMinor] = parsed.data.split('.').map(Number)
  const [currentMajor, currentMinor] = CURRENT_PROTOCOL_VERSION.split('.').map(Number)
  return candidateMajor === currentMajor && candidateMinor! <= currentMinor!
}

export const compatibleProtocolVersionSchema = versionStringSchema.refine(
  isProtocolVersionCompatible,
  { message: `Protocol version must be compatible with ${CURRENT_PROTOCOL_VERSION}` }
)

const opaqueSuffix = '[A-Za-z0-9](?:[A-Za-z0-9_]{10,62}[A-Za-z0-9])'

function opaqueId(prefix: string): z.ZodString {
  return z.string().regex(new RegExp(`^${prefix}_${opaqueSuffix}$`, 'u'))
}

export const userIdSchema = opaqueId('usr')
export const humanEndpointIdSchema = opaqueId('hep')
export const deviceIdSchema = opaqueId('dev')
export const agentIdSchema = opaqueId('agt')
export const participantIdSchema = opaqueId('par')
export const projectionIdSchema = opaqueId('rsp')
export const projectInputIdSchema = opaqueId('pin')
export const projectIdSchema = opaqueId('prj')
export const projectMembershipIdSchema = opaqueId('pmb')
export const taskAuthorityIdSchema = opaqueId('tau')
export const providerPrincipalFactIdSchema = opaqueId('ppf')
export const providerObservationIdSchema = opaqueId('pob')
export const provisioningIntentIdSchema = opaqueId('pci')
export const provisioningAttestationIdSchema = opaqueId('pca')
export const projectContentBindingIdSchema = opaqueId('pcb')
export const contentRecoveryJournalEntryIdSchema = opaqueId('crj')
export const recoveryActionIdSchema = opaqueId('rca')
export const projectEndpointBindingIdSchema = opaqueId('peb')
export const taskIdSchema = opaqueId('tsk')
export const executionIdSchema = opaqueId('exe')
export const taskOfferIdSchema = opaqueId('ofr')
export const projectPlanIdSchema = opaqueId('pln')
export const resultSubmissionIdSchema = opaqueId('rsu')
export const reviewDecisionIdSchema = opaqueId('rvw')
export const collaborationEventIdSchema = opaqueId('evt')
export const resourceRefIdSchema = opaqueId('rrf')
export const projectRecordIdSchema = opaqueId('rec')
export const inboxMessageIdSchema = opaqueId('ibx')
export const receiptIdSchema = opaqueId('rcp')
export const humanRequestIdSchema = opaqueId('hrq')
export const humanAnswerIdSchema = opaqueId('han')
export const confirmationIdSchema = opaqueId('cfm')
export const oidcIdentityIdSchema = opaqueId('oid')
export const challengeIdSchema = opaqueId('chl')
export const requestIdSchema = opaqueId('req')
export const localItemIdSchema = opaqueId('lit')
export const turnIdSchema = opaqueId('trn')
export const installationIdSchema = opaqueId('ins')
export const managedContainerIdSchema = opaqueId('mco')
export const remoteApprovalIdSchema = opaqueId('rap')

export type UserId = z.infer<typeof userIdSchema>
export type HumanEndpointId = z.infer<typeof humanEndpointIdSchema>
export type DeviceId = z.infer<typeof deviceIdSchema>
export type AgentId = z.infer<typeof agentIdSchema>
export type ParticipantId = z.infer<typeof participantIdSchema>
export type ProjectionId = z.infer<typeof projectionIdSchema>
export type ProjectInputId = z.infer<typeof projectInputIdSchema>
export type ProjectId = z.infer<typeof projectIdSchema>
export type ProjectMembershipId = z.infer<typeof projectMembershipIdSchema>
export type TaskAuthorityId = z.infer<typeof taskAuthorityIdSchema>
export type ProviderPrincipalFactId = z.infer<typeof providerPrincipalFactIdSchema>
export type ProviderObservationId = z.infer<typeof providerObservationIdSchema>
export type ProvisioningIntentId = z.infer<typeof provisioningIntentIdSchema>
export type ProvisioningAttestationId = z.infer<typeof provisioningAttestationIdSchema>
export type ProjectContentBindingId = z.infer<typeof projectContentBindingIdSchema>
export type ContentRecoveryJournalEntryId = z.infer<typeof contentRecoveryJournalEntryIdSchema>
export type RecoveryActionId = z.infer<typeof recoveryActionIdSchema>
export type ProjectEndpointBindingId = z.infer<typeof projectEndpointBindingIdSchema>
export type TaskId = z.infer<typeof taskIdSchema>
export type ExecutionId = z.infer<typeof executionIdSchema>
export type TaskOfferId = z.infer<typeof taskOfferIdSchema>
export type ProjectPlanId = z.infer<typeof projectPlanIdSchema>
export type ResultSubmissionId = z.infer<typeof resultSubmissionIdSchema>
export type ReviewDecisionId = z.infer<typeof reviewDecisionIdSchema>
export type CollaborationEventId = z.infer<typeof collaborationEventIdSchema>
export type ResourceRefId = z.infer<typeof resourceRefIdSchema>
export type ProjectRecordId = z.infer<typeof projectRecordIdSchema>
export type InboxMessageId = z.infer<typeof inboxMessageIdSchema>
export type ReceiptId = z.infer<typeof receiptIdSchema>
export type HumanRequestId = z.infer<typeof humanRequestIdSchema>
export type HumanAnswerId = z.infer<typeof humanAnswerIdSchema>
export type ConfirmationId = z.infer<typeof confirmationIdSchema>
export type ChallengeId = z.infer<typeof challengeIdSchema>
export type RequestId = z.infer<typeof requestIdSchema>
export type InstallationId = z.infer<typeof installationIdSchema>
export type RemoteApprovalId = z.infer<typeof remoteApprovalIdSchema>

export const revisionSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
export const expectedRevisionSchema = revisionSchema
export const sequenceSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER)
export const credentialVersionSchema = z.number().int().min(1).max(1_000_000)
export const idempotencyKeySchema = z.string()
  .min(16)
  .max(128)
  .regex(/^idem_[A-Za-z0-9._:-]+$/u)
export const sha256Schema = z.string().regex(/^[a-f0-9]{64}$/u)
export const timestampSchema = z.string().datetime({ offset: true })
export const nonEmptyTextSchema = z.string().trim().min(1).max(32_000)
export const displayNameSchema = z.string().trim().min(1).max(200)
export const providerIdSchema = z.string().regex(/^[a-z][a-z0-9.-]{0,63}$/u)
export const providerOpaqueIdSchema = z.string().min(1).max(512)
export const providerCursorSchema = z.string().min(1).max(2_048)
export const providerMessageIdSchema = z.string().min(1).max(512)
export const runtimeIdSchema = z.string().min(1).max(128)
export const threadIdSchema = z.string().min(1).max(512)
export const runtimeTurnIdSchema = z.string().min(1).max(512)
export const safeCodeSchema = z.string().regex(/^[a-z][a-z0-9_.-]{0,63}$/u)

export type Revision = z.infer<typeof revisionSchema>
export type Sequence = z.infer<typeof sequenceSchema>
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>

export const assuranceLevelSchema = z.enum(['basic', 'verified', 'strong'])
export type AssuranceLevel = z.infer<typeof assuranceLevelSchema>

export const jsonObjectSchema = z.record(z.string(), z.json())
export type JsonObject = z.infer<typeof jsonObjectSchema>

const credentialKeyPattern = /(?:^|[_-])(?:authorization|credential|device[_-]?token|access[_-]?token|refresh[_-]?token|password|passphrase|secret|api[_-]?key|private[_-]?key|challenge)(?:$|[_-])/iu
const embeddedCredentialPatterns = [
  /\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/giu,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/gu,
  /([a-z][a-z0-9+.-]*:\/\/[^\s:/]+:)[^\s@]+@/giu
] as const

export const REDACTED_VALUE = '[REDACTED]' as const

function redactString(value: string): string {
  return value
    .replace(embeddedCredentialPatterns[0], REDACTED_VALUE)
    .replace(embeddedCredentialPatterns[1], REDACTED_VALUE)
    .replace(embeddedCredentialPatterns[2], `$1${REDACTED_VALUE}@`)
}

export function isCredentialFieldName(key: string): boolean {
  if (credentialKeyPattern.test(key)) return true
  const normalized = key.replace(/[_-]/gu, '').toLocaleLowerCase('en-US')
  return normalized.startsWith('challenge') || [
    'credential',
    'token',
    'password',
    'passphrase',
    'secret',
    'apikey',
    'privatekey'
  ].some((suffix) => normalized.endsWith(suffix))
}

export function redactCredentials(value: unknown): unknown {
  if (typeof value === 'string') return redactString(value)
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value
  if (Array.isArray(value)) return value.map(redactCredentials)
  if (typeof value !== 'object') return '[UNSERIALIZABLE]'
  return Object.fromEntries(Object.entries(value).map(([key, child]) => [
    key,
    isCredentialFieldName(key) ? REDACTED_VALUE : redactCredentials(child)
  ]))
}

function findCredentialLeak(value: unknown, path = '$'): string | undefined {
  if (typeof value === 'string') {
    if (value === REDACTED_VALUE) return undefined
    for (const pattern of embeddedCredentialPatterns) {
      pattern.lastIndex = 0
      if (pattern.test(value)) return path
    }
    return undefined
  }
  if (Array.isArray(value)) {
    for (let index = 0; index < value.length; index += 1) {
      const leak = findCredentialLeak(value[index], `${path}[${index}]`)
      if (leak !== undefined) return leak
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  for (const [key, child] of Object.entries(value)) {
    if (isCredentialFieldName(key) && child !== REDACTED_VALUE) return `${path}.${key}`
    const leak = findCredentialLeak(child, `${path}.${key}`)
    if (leak !== undefined) return leak
  }
  return undefined
}

export const redactedJsonSchema = z.json().superRefine((value, context) => {
  const leakedAt = findCredentialLeak(value)
  if (leakedAt !== undefined) {
    context.addIssue({
      code: 'custom',
      message: `Credential material must be redacted at ${leakedAt}`
    })
  }
})

export const entityMetadataShape = {
  schemaVersion: schemaVersionSchema,
  revision: revisionSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema
} as const

export const protocolEnvelopeShape = {
  protocolVersion: protocolVersionSchema,
  requestId: requestIdSchema
} as const

export const idempotentCommandShape = {
  idempotencyKey: idempotencyKeySchema,
  expectedRevision: expectedRevisionSchema
} as const
