import { describe, expect, it } from 'vitest'

import type { DomainPackageJsonValue } from '@sciforge/domain-sdk/contract'
import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContribution,
  type DomainMainContributionHost
} from '@sciforge/domain-sdk/host'

import {
  CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
  MAIN_CONTENT_SPACE_VERIFICATION_PROFILE_LOCATION,
  defineContentSpaceVerificationProfileContribution
} from '../verification-policy.js'
import { composeContentSpaceVerificationPolicy } from './verification-policy-catalog.js'

const PROVIDER_INSTANCE_REF = 'provider-instance-alpha'
const principal = Object.freeze({
  authority: 'sciforge.identity-access',
  subject: 'verification-user',
  assurance: 'local-selection' as const,
  deviceId: 'verification-device',
  identityVersion: 1
})

describe('Content Space verification profile composition', () => {
  it('keeps empty composition disabled and aggregates an exact static profile', () => {
    expect(composeContentSpaceVerificationPolicy(host([]))).toBeUndefined()
    const declared = profileContribution('profile-alpha')

    expect(composeContentSpaceVerificationPolicy(host([
      contribution('fixture.profile-alpha', declared, declared, undefined, 'forbidden')
    ]))).toEqual({
      contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
      profiles: [declared.profile]
    })
  })

  it('rejects a profile contribution that does not forbid public release', () => {
    const declared = profileContribution('profile-alpha')

    expect(() => composeContentSpaceVerificationPolicy(host([
      contribution('fixture.public-release-allowed', declared, declared)
    ]))).toThrow(/forbid public release/u)
  })

  it('fails composition for manifest/runtime drift or invalid metadata', () => {
    const declared = profileContribution('profile-alpha')
    const drifted = profileContribution('profile-beta')

    expect(() => composeContentSpaceVerificationPolicy(host([
      contribution('fixture.drifted', declared, drifted, undefined, 'forbidden')
    ]))).toThrow(/drifted/u)
    expect(() => composeContentSpaceVerificationPolicy(host([
      contribution('fixture.version', declared, declared, '1.0.0', 'forbidden')
    ]))).toThrow(/metadata/u)
    expect(() => composeContentSpaceVerificationPolicy(host([
      contribution('fixture.invalid', {
        ...declared,
        unexpected: true
      }, declared, undefined, 'forbidden')
    ]))).toThrow(/drifted/u)
  })

  it('fails the whole composition for duplicate profile identities', () => {
    const declared = profileContribution('profile-alpha')

    expect(() => composeContentSpaceVerificationPolicy(host([
      contribution('fixture.profile-one', declared, declared, undefined, 'forbidden'),
      contribution('fixture.profile-two', declared, declared, undefined, 'forbidden')
    ]))).toThrow(/duplicated/u)
  })
})

function profileContribution(profileId: string) {
  return defineContentSpaceVerificationProfileContribution({
    location: MAIN_CONTENT_SPACE_VERIFICATION_PROFILE_LOCATION,
    contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
    profile: {
      profileId,
      providerInstanceRef: PROVIDER_INSTANCE_REF,
      principal,
      audience: 'agent',
      authority: {
        kind: 'provider-instance',
        providerInstanceRef: PROVIDER_INSTANCE_REF
      },
      operation: { family: 'ordinary', operation: 'list-containers' },
      transferLimits: { maxUploadBytes: 0, maxDownloadBytes: 0 },
      validFrom: '2026-08-21T00:00:00.000Z',
      expiresAt: '2026-08-21T01:00:00.000Z'
    }
  })
}

function contribution(
  id: string,
  contract: DomainPackageJsonValue,
  value: unknown,
  version: string = CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
  publicRelease?: 'allowed' | 'forbidden'
): DomainMainContribution {
  return Object.freeze({
    id,
    kind: MAIN_EXTENSION_CONTRIBUTION_KIND,
    packageName: '@fixture/content-space-verification',
    owner: Object.freeze({ moduleId: 'fixture.content-space-verification', moduleVersion: '1.0.0' }),
    version,
    ...(publicRelease === undefined ? {} : { publicRelease }),
    contract,
    value
  })
}

function host(contributions: readonly DomainMainContribution[]): DomainMainContributionHost {
  return Object.freeze({ list: () => contributions })
}
