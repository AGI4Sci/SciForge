import {
  openContentIdentityIdSchema,
  type OpenContentIdentityId
} from '@sciforge/domain-opencontent-connector/team-administration-contract'

export function parseOpenContentDirectoryIdentity(
  principalId: string
): OpenContentIdentityId | undefined {
  if (!/^[1-9]\d*$/u.test(principalId)) return undefined
  const identityId = openContentIdentityIdSchema.safeParse(Number(principalId))
  return identityId.success && String(identityId.data) === principalId
    ? identityId.data
    : undefined
}
