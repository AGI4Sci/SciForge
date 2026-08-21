import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  openContentFolderIdSchema,
  openContentIdentityIdSchema,
  openContentTeamIdSchema,
  openContentTeamPageRequestSchema,
  openContentTeamUserMutationSchema,
  type OpenContentBoundTeamAdministration,
  type OpenContentFolderId,
  // @ts-expect-error token-bearing Team administration stays package-private.
  type OpenContentTeamAdministration,
  type OpenContentTeamId
} from './team-administration-contract.js'

describe('OpenContent Team administration contract', () => {
  it('keeps Team ids and root-folder ids as distinct public types', () => {
    expectTypeOf<OpenContentTeamId>().not.toEqualTypeOf<OpenContentFolderId>()
    expect(openContentTeamIdSchema.parse(9000019)).toBe(9000019)
    expect(openContentFolderIdSchema.parse(9002213)).toBe(9002213)
    expect(openContentIdentityIdSchema.parse(9000041)).toBe(9000041)
    expect(() => openContentTeamIdSchema.parse(0)).toThrow()
  })

  it('bounds every provider page and membership mutation to 100 records', () => {
    expect(openContentTeamPageRequestSchema.parse({ pageNumber: 1, pageSize: 100 }))
      .toEqual({ pageNumber: 1, pageSize: 100 })
    expect(() => openContentTeamPageRequestSchema.parse({ pageNumber: 1, pageSize: 101 }))
      .toThrow()
    expect(() => openContentTeamUserMutationSchema.parse({
      teamId: 9000019,
      identityIds: Array.from({ length: 101 }, (_, index) => index + 1)
    })).toThrow()
    expect(() => openContentTeamUserMutationSchema.parse({
      teamId: 9000019,
      identityIds: [9000041, 9000041]
    })).toThrow()
  })

  it('does not publish destructive Team deletion', () => {
    expectTypeOf<OpenContentBoundTeamAdministration>()
      .not.toHaveProperty('deleteTeam')
    expectTypeOf<Parameters<OpenContentBoundTeamAdministration['listTeams']>[0]>()
      .not.toHaveProperty('token')
  })
})
