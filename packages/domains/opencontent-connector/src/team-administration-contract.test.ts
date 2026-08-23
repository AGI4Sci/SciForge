import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  openContentFolderIdSchema,
  openContentIdentityIdSchema,
  openContentTeamIdSchema,
  openContentTeamUserSchema,
  openContentTeamUserMutationSchema,
  type OpenContentBoundTeamAdministration,
  type OpenContentFolderId,
  // @ts-expect-error token-bearing Team administration stays package-private.
  type OpenContentTeamAdministration,
  type OpenContentTeamId
} from './team-administration-contract.js'

// @ts-expect-error Raw token-bearing administration is not part of the public main namespace.
import type { OpenContentTeamAdministration as PublicMainTeamAdministration } from './main/index.js'
// @ts-expect-error Credential-bearing connection sessions are package-private.
import type { OpenContentConnectionService as PublicMainConnectionService } from './main/index.js'

describe('OpenContent Team administration contract', () => {
  it('keeps Team ids and root-folder ids as distinct public types', () => {
    expectTypeOf<OpenContentTeamId>().not.toEqualTypeOf<OpenContentFolderId>()
    expect(openContentTeamIdSchema.parse(9000019)).toBe(9000019)
    expect(openContentFolderIdSchema.parse(9002213)).toBe(9002213)
    expect(openContentIdentityIdSchema.parse(9000041)).toBe(9000041)
    expect(() => openContentTeamIdSchema.parse(0)).toThrow()
  })

  it('bounds every provider page and membership mutation to 100 records', () => {
    expect(() => openContentTeamUserMutationSchema.parse({
      teamId: 9000019,
      identityIds: Array.from({ length: 101 }, (_, index) => index + 1)
    })).toThrow()
    expect(() => openContentTeamUserMutationSchema.parse({
      teamId: 9000019,
      identityIds: [9000041, 9000041]
    })).toThrow()
  })

  it('publishes only the Team-member fields proven by the supplier contract', () => {
    expect(openContentTeamUserSchema.parse({
      identityId: 9000041,
      userType: 3,
      displayName: 'Fixture User'
    })).toEqual({
      identityId: 9000041,
      userType: 3,
      displayName: 'Fixture User'
    })
    expect(() => openContentTeamUserSchema.parse({
      identityId: 9000041,
      userType: 3,
      account: 'unproven-alias'
    })).toThrow()
  })

  it('does not publish dormant or destructive Team mutations', () => {
    expectTypeOf<OpenContentBoundTeamAdministration>()
      .not.toHaveProperty('deleteTeam')
    expectTypeOf<OpenContentBoundTeamAdministration>()
      .not.toHaveProperty('setTeamUserRole')
    expectTypeOf<OpenContentBoundTeamAdministration>()
      .not.toHaveProperty('transferTeamOwner')
    expectTypeOf<Parameters<OpenContentBoundTeamAdministration['listTeams']>[0]>()
      .not.toHaveProperty('token')
  })
})
