import { z } from 'zod'

import {
  principalSnapshotSchema,
  samePrincipalSnapshot,
  type PrincipalSnapshot
} from '@sciforge/domain-sdk/principal'
import { providerInstanceRefSchema } from '@sciforge/domain-sdk/provider-composition'

import {
  CONTENT_SPACE_LIMITS,
  contentContainerReferenceSchema,
  contentFileReferenceSchema,
  contentSpaceOperationSchema,
  opaqueExternalBindingValueSchema,
  type ContentSpaceExternalBindingAttestation,
  type ContentContainerReference,
  type ContentFileReference,
  type ContentSpaceReadinessReason
} from './contract.js'
import {
  contentSpaceAdministrationOperationSchema
} from './administration-contract.js'
import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS,
  type ContentSpaceExtendedOperationKey
} from './extended-operations-contract.js'
import {
  nativeDocumentOperationSchema
} from './native-document-contract.js'
import {
  extendedOperationEffect,
  nativeDocumentOperationEffect
} from './provider-features.js'

export const CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION = '2.0.0' as const
export const CONTENT_SPACE_VERIFICATION_PROFILE_MAX_VALIDITY_MS = 24 * 60 * 60 * 1_000
export const MAIN_CONTENT_SPACE_VERIFICATION_PROFILE_LOCATION =
  'main.content-space-verification-profile' as const

const verificationProfileIdSchema = z.string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[a-z0-9][a-z0-9._:-]*$/u)

const verificationAudienceSchema = z.enum(['ui', 'agent', 'system'])

const verificationOperationSchema = z.discriminatedUnion('family', [
  z.object({
    family: z.literal('ordinary'),
    operation: contentSpaceOperationSchema
  }).strict().readonly(),
  z.object({
    family: z.literal('native-document'),
    operation: nativeDocumentOperationSchema
  }).strict().readonly(),
  z.object({
    family: z.literal('extended'),
    operation: z.enum(
      Object.keys(CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS) as [
        ContentSpaceExtendedOperationKey,
        ...ContentSpaceExtendedOperationKey[]
      ]
    )
  }).strict().readonly(),
  z.object({
    family: z.literal('administration'),
    operation: contentSpaceAdministrationOperationSchema
  }).strict().readonly()
])

export const contentSpaceVerificationAuthoritySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('provider-instance'),
    providerInstanceRef: providerInstanceRefSchema
  }).strict().readonly(),
  z.object({
    kind: z.literal('content-root'),
    root: z.union([contentContainerReferenceSchema, contentFileReferenceSchema])
  }).strict().readonly()
])

export const contentSpaceVerificationTransferLimitsSchema = z.object({
  maxUploadBytes: z.number().int().min(0).max(CONTENT_SPACE_LIMITS.maxUploadBytes),
  maxDownloadBytes: z.number().int().min(0).max(CONTENT_SPACE_LIMITS.maxFileBytes)
}).strict().readonly()

const verificationExternalBindingSchema = z.object({
  externalSubject: opaqueExternalBindingValueSchema,
  bindingRevision: opaqueExternalBindingValueSchema
}).strict().readonly()

export const contentSpaceVerificationProfileSchema = z.object({
  profileId: verificationProfileIdSchema,
  providerInstanceRef: providerInstanceRefSchema,
  principal: principalSnapshotSchema,
  audience: verificationAudienceSchema,
  authority: contentSpaceVerificationAuthoritySchema,
  operation: verificationOperationSchema,
  transferLimits: contentSpaceVerificationTransferLimitsSchema,
  externalBinding: verificationExternalBindingSchema.optional(),
  validFrom: z.string().datetime({ offset: true }),
  expiresAt: z.string().datetime({ offset: true })
}).strict().superRefine((profile, context) => {
  const authorityProviderInstanceRef = profile.authority.kind === 'provider-instance'
    ? profile.authority.providerInstanceRef
    : profile.authority.root.providerInstanceRef
  if (authorityProviderInstanceRef !== profile.providerInstanceRef) {
    context.addIssue({
      code: 'custom',
      path: ['authority'],
      message: 'Verification authority must belong to the exact Provider Instance.'
    })
  }
  const validFrom = Date.parse(profile.validFrom)
  const expiresAt = Date.parse(profile.expiresAt)
  if (expiresAt <= validFrom ||
    expiresAt - validFrom > CONTENT_SPACE_VERIFICATION_PROFILE_MAX_VALIDITY_MS) {
    context.addIssue({
      code: 'custom',
      path: ['expiresAt'],
      message: 'Verification profile validity must be positive and no longer than 24 hours.'
    })
  }
  if (!profile.externalBinding && !profileSafeWithoutProviderBindingAttestation(profile)) {
    context.addIssue({
      code: 'custom',
      path: ['operation'],
      message: 'This verification profile requires a trusted Provider binding attestation.'
    })
  }
}).readonly()

/**
 * One trusted compile-time profile contribution. Both the package manifest
 * contract and its main-process runtime value use this exact static shape.
 */
export const contentSpaceVerificationProfileContributionSchema = z.object({
  location: z.literal(MAIN_CONTENT_SPACE_VERIFICATION_PROFILE_LOCATION),
  contractVersion: z.literal(CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION),
  profile: contentSpaceVerificationProfileSchema
}).strict().readonly()

export const contentSpaceVerificationPolicySchema = z.object({
  contractVersion: z.literal(CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION),
  profiles: z.array(contentSpaceVerificationProfileSchema).max(256).superRefine(
    (profiles, context) => {
      const seen = new Set<string>()
      for (const [index, profile] of profiles.entries()) {
        if (seen.has(profile.profileId)) {
          context.addIssue({
            code: 'custom',
            path: [index, 'profileId'],
            message: `Verification profile ${profile.profileId} is duplicated.`
          })
        }
        seen.add(profile.profileId)
      }
    }
  ).readonly()
}).strict().readonly()

export type ContentSpaceVerificationOperation = z.infer<typeof verificationOperationSchema>
export type ContentSpaceVerificationAuthority = z.infer<
  typeof contentSpaceVerificationAuthoritySchema
>
export type ContentSpaceVerificationTransferLimits = z.infer<
  typeof contentSpaceVerificationTransferLimitsSchema
>
export type ContentSpaceVerificationProfile = z.infer<
  typeof contentSpaceVerificationProfileSchema
>
export type ContentSpaceVerificationProfileContribution = z.infer<
  typeof contentSpaceVerificationProfileContributionSchema
>
export type ContentSpaceVerificationPolicy = z.infer<
  typeof contentSpaceVerificationPolicySchema
>

export type ContentSpaceVerificationAdmission = Readonly<{
  state: Readonly<{
    readiness: 'poc_only' | 'blocked_by_contract' | 'production_ready'
    reasonCode: ContentSpaceReadinessReason
  }>
  providerInstanceRef: string
  principal: PrincipalSnapshot
  audience?: 'ui' | 'agent' | 'system'
  authority: ContentSpaceVerificationAuthority
  operation: ContentSpaceVerificationOperation
  transferLimits: ContentSpaceVerificationTransferLimits
  externalBinding?: ContentSpaceExternalBindingAttestation
  now: Date
}>

export type ContentSpaceVerificationProfileMatchAdmission = Readonly<
  Omit<ContentSpaceVerificationAdmission, 'transferLimits'>
>

export type ContentSpaceVerificationProfileMatch = Readonly<{
  profileId: string
  transferLimits: ContentSpaceVerificationTransferLimits
}>

export function defineContentSpaceVerificationPolicy(
  input: ContentSpaceVerificationPolicy
): ContentSpaceVerificationPolicy {
  return contentSpaceVerificationPolicySchema.parse(input)
}

export function defineContentSpaceVerificationProfileContribution(
  input: ContentSpaceVerificationProfileContribution
): ContentSpaceVerificationProfileContribution {
  return contentSpaceVerificationProfileContributionSchema.parse(input)
}

/**
 * Matches only trusted invocation facts against constructor-installed profiles.
 * It never promotes readiness and is deliberately unable to admit contract-blocked states.
 */
export function contentSpaceVerificationPolicyAdmits(
  policy: ContentSpaceVerificationPolicy | undefined,
  admission: ContentSpaceVerificationAdmission
): boolean {
  const { transferLimits: requestedTransferLimits, ...facts } = admission
  const match = contentSpaceVerificationPolicyMatch(policy, facts)
  return match !== undefined && sameTransferLimits(
    match.transferLimits,
    requestedTransferLimits
  )
}

/**
 * Selects one exact trusted profile after every invocation fact, including the
 * live external binding, has matched. Ambiguous overlapping profiles fail
 * closed instead of choosing the widest byte limit.
 */
export function contentSpaceVerificationPolicyMatch(
  policy: ContentSpaceVerificationPolicy | undefined,
  admission: ContentSpaceVerificationProfileMatchAdmission
): ContentSpaceVerificationProfileMatch | undefined {
  const matches = matchingVerificationProfiles(policy, admission, true)
  if (matches.length !== 1) return undefined
  const [profile] = matches
  return Object.freeze({
    profileId: profile!.profileId,
    transferLimits: profile!.transferLimits
  })
}

/**
 * A preflight only: reports whether an otherwise exact profile could match
 * after obtaining a Provider-owned binding attestation. It does not admit the
 * invocation or reveal the profile's byte limit.
 */
export function contentSpaceVerificationPolicyHasExternalBindingCandidate(
  policy: ContentSpaceVerificationPolicy | undefined,
  admission: ContentSpaceVerificationProfileMatchAdmission
): boolean {
  return matchingVerificationProfiles(policy, admission, false)
    .some((profile) => profile.externalBinding !== undefined)
}

/**
 * Reports whether a matching static profile requires live Provider binding evidence.
 * This is only a preflight hint; it never admits an invocation.
 */
export function contentSpaceVerificationPolicyRequiresExternalBinding(
  policy: ContentSpaceVerificationPolicy | undefined,
  admission: ContentSpaceVerificationAdmission
): boolean {
  if (!policy || admission.state.readiness !== 'poc_only' ||
    admission.state.reasonCode !== 'verification_profile_required' ||
    !admission.audience || !Number.isFinite(admission.now.getTime())) return false
  return policy.profiles.some((profile) =>
    profile.externalBinding !== undefined && sameVerificationProfileFacts(profile, admission)
  )
}

function sameVerificationProfileFacts(
  profile: ContentSpaceVerificationProfile,
  admission: ContentSpaceVerificationAdmission
): boolean {
  return sameVerificationProfileCoreFacts(profile, admission) &&
    sameTransferLimits(profile.transferLimits, admission.transferLimits)
}

function sameVerificationProfileCoreFacts(
  profile: ContentSpaceVerificationProfile,
  admission: ContentSpaceVerificationProfileMatchAdmission
): boolean {
  return profile.providerInstanceRef === admission.providerInstanceRef &&
    profile.audience === admission.audience &&
    samePrincipalSnapshot(profile.principal, admission.principal) &&
    sameVerificationAuthority(profile.authority, admission.authority) &&
    profile.operation.family === admission.operation.family &&
    profile.operation.operation === admission.operation.operation &&
    admission.now.getTime() >= Date.parse(profile.validFrom) &&
    admission.now.getTime() < Date.parse(profile.expiresAt)
}

function sameTransferLimits(
  left: ContentSpaceVerificationTransferLimits,
  right: ContentSpaceVerificationTransferLimits
): boolean {
  return left.maxUploadBytes === right.maxUploadBytes &&
    left.maxDownloadBytes === right.maxDownloadBytes
}

function matchingVerificationProfiles(
  policy: ContentSpaceVerificationPolicy | undefined,
  admission: ContentSpaceVerificationProfileMatchAdmission,
  requireExactExternalBinding: boolean
): readonly ContentSpaceVerificationProfile[] {
  if (!policy || admission.state.readiness !== 'poc_only' ||
    admission.state.reasonCode !== 'verification_profile_required' ||
    !admission.audience || !Number.isFinite(admission.now.getTime())) return []
  return policy.profiles.filter((profile) =>
    sameVerificationProfileCoreFacts(profile, admission) &&
    (!requireExactExternalBinding ||
      sameExternalBinding(profile.externalBinding, admission.externalBinding, admission))
  )
}

function sameExternalBinding(
  expected: ContentSpaceVerificationProfile['externalBinding'],
  actual: ContentSpaceExternalBindingAttestation | undefined,
  admission: Pick<ContentSpaceVerificationAdmission, 'providerInstanceRef' | 'principal'>
): boolean {
  if (!expected) return true
  if (!actual) return false
  return actual.providerInstanceRef === admission.providerInstanceRef &&
    samePrincipalSnapshot(actual.principal, admission.principal) &&
    actual.externalSubject === expected.externalSubject &&
    actual.bindingRevision === expected.bindingRevision
}

function sameVerificationAuthority(
  left: ContentSpaceVerificationAuthority,
  right: ContentSpaceVerificationAuthority
): boolean {
  if (left.kind !== right.kind) return false
  if (left.kind === 'provider-instance' && right.kind === 'provider-instance') {
    return left.providerInstanceRef === right.providerInstanceRef
  }
  if (left.kind !== 'content-root' || right.kind !== 'content-root') return false
  return sameContentReference(left.root, right.root)
}

function sameContentReference(
  left: ContentContainerReference | ContentFileReference,
  right: ContentContainerReference | ContentFileReference
): boolean {
  if (left.providerInstanceRef !== right.providerInstanceRef) return false
  if ('containerId' in left && 'containerId' in right) {
    return left.containerId === right.containerId
  }
  return 'fileId' in left && 'fileId' in right && left.fileId === right.fileId
}

const ROOT_SCOPED_ORDINARY_READS = new Set([
  'list-entries',
  'observe-entry',
  'portal-target'
])

function profileSafeWithoutProviderBindingAttestation(
  profile: Pick<
    ContentSpaceVerificationProfile,
    'authority' | 'operation' | 'transferLimits'
  >
): boolean {
  if (profile.transferLimits.maxUploadBytes !== 0 ||
    profile.transferLimits.maxDownloadBytes !== 0) return false

  if (profile.authority.kind === 'provider-instance') {
    return profile.operation.family === 'ordinary' &&
      profile.operation.operation === 'list-containers'
  }
  if (profile.operation.family === 'ordinary') {
    return ROOT_SCOPED_ORDINARY_READS.has(profile.operation.operation)
  }
  if (profile.operation.family === 'native-document') {
    return nativeDocumentOperationEffect(profile.operation.operation) === 'read'
  }
  if (profile.operation.family === 'extended') {
    return extendedOperationEffect(profile.operation.operation) === 'read'
  }
  return false
}
