import {
  MAIN_EXTENSION_CONTRIBUTION_KIND,
  type DomainMainContributionHost
} from '@sciforge/domain-sdk/host'

import {
  CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
  MAIN_CONTENT_SPACE_VERIFICATION_PROFILE_LOCATION,
  contentSpaceVerificationProfileContributionSchema,
  defineContentSpaceVerificationPolicy,
  type ContentSpaceVerificationPolicy
} from '../verification-policy.js'

/**
 * Composes only trusted, manifest-declared static profiles. Invalid or drifting
 * contributions fail the owning domain's activation instead of being skipped.
 */
export function composeContentSpaceVerificationPolicy(
  host: DomainMainContributionHost
): ContentSpaceVerificationPolicy | undefined {
  const contributions = host.list(MAIN_EXTENSION_CONTRIBUTION_KIND)
  if (!Array.isArray(contributions)) {
    throw new TypeError('Content Space verification profile composition is unavailable.')
  }

  const profiles = contributions.flatMap((contribution) => {
    if (!hasLocation(contribution.contract, MAIN_CONTENT_SPACE_VERIFICATION_PROFILE_LOCATION)) {
      return []
    }
    if (contribution.kind !== MAIN_EXTENSION_CONTRIBUTION_KIND ||
      contribution.version !== CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION) {
      throw new TypeError('Content Space verification profile metadata is invalid.')
    }
    const contract = contentSpaceVerificationProfileContributionSchema.safeParse(
      contribution.contract
    )
    const value = contentSpaceVerificationProfileContributionSchema.safeParse(
      contribution.value
    )
    if (!contract.success || !value.success ||
      JSON.stringify(contract.data) !== JSON.stringify(value.data)) {
      throw new TypeError('Content Space verification profile contract and value drifted.')
    }
    return [contract.data.profile]
  })

  if (profiles.length === 0) return undefined
  return defineContentSpaceVerificationPolicy({
    contractVersion: CONTENT_SPACE_VERIFICATION_POLICY_CONTRACT_VERSION,
    profiles: [...profiles].sort((left, right) => left.profileId.localeCompare(right.profileId))
  })
}

function hasLocation(value: unknown, location: string): boolean {
  return typeof value === 'object' && value !== null && !Array.isArray(value) &&
    'location' in value && value.location === location
}
