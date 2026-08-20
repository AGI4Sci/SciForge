import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  openContentFolderIdSchema,
  openContentIdentityIdSchema,
  openContentTeamIdSchema,
  openContentTeamPageRequestSchema,
  openContentTeamUserMutationSchema,
  type OpenContentFolderId,
  type OpenContentTeamAdministration,
  type OpenContentTeamId
} from './team-administration-contract.js'

describe('OpenContent Team administration contract', () => {
  it('keeps Team ids and root-folder ids as distinct public types', () => {
    expectTypeOf<OpenContentTeamId>().not.toEqualTypeOf<OpenContentFolderId>()
    expect(openContentTeamIdSchema.parse(19)).toBe(19)
    expect(openContentFolderIdSchema.parse(2213)).toBe(2213)
    expect(openContentIdentityIdSchema.parse(41)).toBe(41)
    expect(() => openContentTeamIdSchema.parse(0)).toThrow()
  })

  it('bounds every provider page and membership mutation to 100 records', () => {
    expect(openContentTeamPageRequestSchema.parse({ pageNumber: 1, pageSize: 100 }))
      .toEqual({ pageNumber: 1, pageSize: 100 })
    expect(() => openContentTeamPageRequestSchema.parse({ pageNumber: 1, pageSize: 101 }))
      .toThrow()
    expect(() => openContentTeamUserMutationSchema.parse({
      teamId: 19,
      identityIds: Array.from({ length: 101 }, (_, index) => index + 1)
    })).toThrow()
    expect(() => openContentTeamUserMutationSchema.parse({
      teamId: 19,
      identityIds: [41, 41]
    })).toThrow()
  })

  it('does not publish destructive Team deletion', () => {
    expectTypeOf<OpenContentTeamAdministration>()
      .not.toHaveProperty('deleteTeam')
  })
})
