import { describe, expect, it } from 'vitest'

import {
  CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
  contentSpaceVerificationPolicyAdmits,
  contentSpaceVerificationPolicyHasExternalBindingCandidate,
  contentSpaceVerificationPolicyMatch,
  contentSpaceVerificationProfileSchema,
  defineContentSpaceVerificationPolicy,
  type ContentSpaceVerificationAdmission,
  type ContentSpaceVerificationProfile
} from './verification-policy.js'

const PROVIDER_INSTANCE_REF = 'provider-instance-alpha'
const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'verification-user',
  assurance: 'local-selection' as const,
  deviceId: 'verification-device',
  identityVersion: 7
})
const root = Object.freeze({
  providerInstanceRef: PROVIDER_INSTANCE_REF,
  containerId: 'verified-root'
})
const externalBinding = Object.freeze({
  externalSubject: 'a'.repeat(64),
  bindingRevision: 'b'.repeat(64)
})

describe('Content Space verification policy', () => {
  it('permits only list-containers bootstrap or exact root-scoped reads without Provider binding attestation', () => {
    const bootstrap = profile({
      authority: { kind: 'provider-instance', providerInstanceRef: PROVIDER_INSTANCE_REF },
      operation: { family: 'ordinary', operation: 'list-containers' }
    })
    const ordinaryRead = profile({
      authority: { kind: 'content-root', root },
      operation: { family: 'ordinary', operation: 'list-entries' }
    })
    const nativeRead = profile({
      authority: { kind: 'content-root', root },
      operation: { family: 'native-document', operation: 'read' }
    })
    const extendedRead = profile({
      authority: { kind: 'content-root', root },
      operation: { family: 'extended', operation: 'getEntryInfo' }
    })

    for (const allowed of [bootstrap, ordinaryRead, nativeRead, extendedRead]) {
      expect(contentSpaceVerificationProfileSchema.safeParse(allowed).success).toBe(true)
    }

    const rejected = [
      profile({
        authority: { kind: 'provider-instance', providerInstanceRef: PROVIDER_INSTANCE_REF },
        operation: { family: 'ordinary', operation: 'list-entries' }
      }),
      profile({
        authority: { kind: 'provider-instance', providerInstanceRef: PROVIDER_INSTANCE_REF },
        operation: { family: 'native-document', operation: 'read' }
      }),
      profile({
        authority: { kind: 'provider-instance', providerInstanceRef: PROVIDER_INSTANCE_REF },
        operation: { family: 'extended', operation: 'getCurrentPrincipal' }
      }),
      profile({
        authority: { kind: 'provider-instance', providerInstanceRef: PROVIDER_INSTANCE_REF },
        operation: { family: 'administration', operation: 'list-spaces' }
      }),
      profile({
        authority: { kind: 'content-root', root },
        operation: { family: 'ordinary', operation: 'create-folder' }
      }),
      profile({
        authority: { kind: 'content-root', root },
        operation: { family: 'native-document', operation: 'create' }
      }),
      profile({
        authority: { kind: 'content-root', root },
        operation: { family: 'extended', operation: 'renameEntry' }
      }),
      profile({
        authority: { kind: 'content-root', root },
        operation: { family: 'administration', operation: 'observe-space' }
      }),
      profile({
        authority: { kind: 'content-root', root },
        operation: { family: 'ordinary', operation: 'list-entries' },
        transferLimits: { maxUploadBytes: 1, maxDownloadBytes: 0 }
      })
    ]
    for (const denied of rejected) {
      expect(contentSpaceVerificationProfileSchema.safeParse(denied).success).toBe(false)
    }
  })

  it('matches every trusted fact exactly and never admits blocked or expired readiness', () => {
    const exactProfile = profile({
      authority: { kind: 'provider-instance', providerInstanceRef: PROVIDER_INSTANCE_REF },
      operation: { family: 'ordinary', operation: 'list-containers' }
    })
    const policy = defineContentSpaceVerificationPolicy({
      contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
      profiles: [exactProfile]
    })
    const exact: ContentSpaceVerificationAdmission = {
      state: { readiness: 'poc_only', reasonCode: 'verification_profile_required' },
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      principal,
      audience: 'agent',
      authority: exactProfile.authority,
      operation: exactProfile.operation,
      transferLimits: exactProfile.transferLimits,
      now: new Date('2026-08-21T00:30:00.000Z')
    }

    expect(contentSpaceVerificationPolicyAdmits(policy, exact)).toBe(true)
    const mismatches: ContentSpaceVerificationAdmission[] = [
      { ...exact, providerInstanceRef: 'provider-instance-beta' },
      { ...exact, principal: { ...principal, assurance: 'cloud-authenticated' } },
      { ...exact, audience: 'ui' },
      {
        ...exact,
        authority: { kind: 'provider-instance', providerInstanceRef: 'provider-instance-beta' }
      },
      { ...exact, operation: { family: 'ordinary', operation: 'list-entries' } },
      { ...exact, transferLimits: { maxUploadBytes: 1, maxDownloadBytes: 0 } },
      { ...exact, now: new Date('2026-08-20T23:59:59.999Z') },
      { ...exact, now: new Date('2026-08-21T01:00:00.000Z') },
      {
        ...exact,
        state: { readiness: 'blocked_by_contract', reasonCode: 'provider_contract_missing' }
      },
      {
        ...exact,
        state: { readiness: 'poc_only', reasonCode: 'provider_contract_missing' }
      }
    ]
    for (const mismatch of mismatches) {
      expect(contentSpaceVerificationPolicyAdmits(policy, mismatch)).toBe(false)
    }
  })

  it('admits unsafe PoC operations only with the exact Provider binding attestation', () => {
    const uploadProfile = profile({
      authority: { kind: 'content-root', root },
      operation: { family: 'ordinary', operation: 'upload-new' },
      transferLimits: { maxUploadBytes: 16 * 1024 * 1024, maxDownloadBytes: 0 },
      externalBinding
    })
    expect(contentSpaceVerificationProfileSchema.parse(uploadProfile)).toEqual(uploadProfile)
    const policy = defineContentSpaceVerificationPolicy({
      contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
      profiles: [uploadProfile]
    })
    const exact: ContentSpaceVerificationAdmission = {
      state: { readiness: 'poc_only', reasonCode: 'verification_profile_required' },
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      principal,
      audience: 'agent',
      authority: uploadProfile.authority,
      operation: uploadProfile.operation,
      transferLimits: uploadProfile.transferLimits,
      externalBinding: {
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        principal,
        ...externalBinding
      },
      now: new Date('2026-08-21T00:30:00.000Z')
    }

    expect(contentSpaceVerificationPolicyAdmits(policy, exact)).toBe(true)
    expect(contentSpaceVerificationPolicyAdmits(policy, {
      ...exact,
      externalBinding: undefined
    })).toBe(false)
    expect(contentSpaceVerificationPolicyAdmits(policy, {
      ...exact,
      externalBinding: { ...exact.externalBinding!, externalSubject: 'c'.repeat(64) }
    })).toBe(false)
    expect(contentSpaceVerificationPolicyAdmits(policy, {
      ...exact,
      externalBinding: { ...exact.externalBinding!, bindingRevision: 'd'.repeat(64) }
    })).toBe(false)
    expect(contentSpaceVerificationPolicyAdmits(policy, {
      ...exact,
      externalBinding: {
        ...exact.externalBinding!,
        principal: { ...principal, identityVersion: principal.identityVersion + 1 }
      }
    })).toBe(false)
  })

  it('returns one exact system profile byte limit only after binding and fails ambiguous matches closed', () => {
    const systemProfile = profile({
      profileId: 'system-download-small',
      audience: 'system',
      authority: { kind: 'content-root', root },
      operation: { family: 'ordinary', operation: 'download' },
      transferLimits: { maxUploadBytes: 0, maxDownloadBytes: 1_024 },
      externalBinding
    })
    const policy = defineContentSpaceVerificationPolicy({
      contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
      profiles: [systemProfile]
    })
    const facts = {
      state: { readiness: 'poc_only' as const, reasonCode: 'verification_profile_required' as const },
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      principal,
      audience: 'system' as const,
      authority: systemProfile.authority,
      operation: systemProfile.operation,
      now: new Date('2026-08-21T00:30:00.000Z')
    }

    expect(contentSpaceVerificationPolicyMatch(policy, facts)).toBeUndefined()
    expect(contentSpaceVerificationPolicyHasExternalBindingCandidate(policy, facts)).toBe(true)
    expect(contentSpaceVerificationPolicyMatch(policy, {
      ...facts,
      externalBinding: {
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        principal,
        ...externalBinding
      }
    })).toEqual({
      profileId: 'system-download-small',
      transferLimits: { maxUploadBytes: 0, maxDownloadBytes: 1_024 }
    })
    expect(contentSpaceVerificationPolicyAdmits(policy, {
      ...facts,
      transferLimits: { maxUploadBytes: 0, maxDownloadBytes: 1_024 },
      externalBinding: {
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        principal,
        ...externalBinding
      }
    })).toBe(true)
    expect(contentSpaceVerificationPolicyAdmits(policy, {
      ...facts,
      transferLimits: { maxUploadBytes: 0, maxDownloadBytes: 2_048 },
      externalBinding: {
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        principal,
        ...externalBinding
      }
    })).toBe(false)

    const ambiguous = defineContentSpaceVerificationPolicy({
      contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
      profiles: [
        systemProfile,
        { ...systemProfile, profileId: 'system-download-overlap' }
      ]
    })
    expect(contentSpaceVerificationPolicyMatch(ambiguous, {
      ...facts,
      externalBinding: {
        providerInstanceRef: PROVIDER_INSTANCE_REF,
        principal,
        ...externalBinding
      }
    })).toBeUndefined()
  })
})

function profile(input: Readonly<{
  profileId?: string
  audience?: ContentSpaceVerificationProfile['audience']
  authority: ContentSpaceVerificationProfile['authority']
  operation: ContentSpaceVerificationProfile['operation']
  transferLimits?: ContentSpaceVerificationProfile['transferLimits']
  externalBinding?: ContentSpaceVerificationProfile['externalBinding']
}>): ContentSpaceVerificationProfile {
  return {
    profileId: input.profileId ??
      `profile-${input.operation.family}-${input.operation.operation}`.toLowerCase(),
    providerInstanceRef: PROVIDER_INSTANCE_REF,
    principal,
    audience: input.audience ?? 'agent',
    authority: input.authority,
    operation: input.operation,
    transferLimits: input.transferLimits ?? { maxUploadBytes: 0, maxDownloadBytes: 0 },
    ...(input.externalBinding ? { externalBinding: input.externalBinding } : {}),
    validFrom: '2026-08-21T00:00:00.000Z',
    expiresAt: '2026-08-21T01:00:00.000Z'
  }
}
