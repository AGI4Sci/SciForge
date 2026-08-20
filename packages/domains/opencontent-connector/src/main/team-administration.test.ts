import { describe, expect, it, vi } from 'vitest'

import {
  openContentFolderIdSchema,
  openContentIdentityIdSchema,
  openContentTeamIdSchema
} from '../team-administration-contract.js'
import {
  bindOpenContentTeamAdministration,
  createOpenContentTeamAdministration
} from './team-administration.js'

const token = 'opaque-token-value-0001'

describe('OpenContent Team administration transport', () => {
  it('lists one strictly bounded Team page and keeps Team and folder ids separate', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        token,
        pageNum: 1,
        pageSize: 2,
        sortName: 'team_name',
        teamType: 0,
        desc: false,
        keyWord: 'SciForge-MVP'
      })
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          pageNum: 1,
          pageSize: 2,
          totalCount: 3,
          teamList: [{
            teamId: 19,
            folderId: 2213,
            teamName: 'SciForge-MVP-alpha',
            teamStatus: 1,
            teamOwner: 42,
            permission: 15,
            teamType: 2,
            isStick: true
          }, {
            teamId: 20,
            folderId: 2214,
            teamName: 'SciForge-MVP-beta',
            teamStatus: 1,
            teamOwner: 42,
            permission: 15,
            teamType: 2,
            isStick: false
          }],
          sortName: 'team_name',
          sortDesc: 'false'
        }
      })
    })
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.listTeams({
      token,
      pageNumber: 1,
      pageSize: 2,
      teamType: 0,
      keyword: 'SciForge-MVP'
    })).resolves.toEqual({
      pageNumber: 1,
      pageSize: 2,
      totalCount: 3,
      teams: [{
        teamId: 19,
        folderId: 2213,
        name: 'SciForge-MVP-alpha',
        ownerIdentityId: 42,
        status: 1,
        permission: 15,
        teamType: 2,
        isStuck: true
      }, {
        teamId: 20,
        folderId: 2214,
        name: 'SciForge-MVP-beta',
        ownerIdentityId: 42,
        status: 1,
        permission: 15,
        teamType: 2,
        isStuck: false
      }],
      nextPage: 2
    })
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://opencontent.invalid/flatsdk/api/services/Team/GetMyTeamList'
    )
  })

  it('binds the Token inside a main-only Team administration session', async () => {
    const fetch = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ token })
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          pageNum: 1,
          pageSize: 100,
          totalCount: 0,
          teamList: []
        }
      })
    })
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    const bound = bindOpenContentTeamAdministration(administration, token, () => undefined)
    await expect(bound.listTeams({
      pageNumber: 1,
      pageSize: 100
    })).resolves.toMatchObject({ teams: [] })
    expect(Object.isFrozen(bound)).toBe(true)
    expect(bound).not.toHaveProperty('token')
  })

  it('revalidates the Host Principal before every bound Team request', async () => {
    const fetch = vi.fn(async () => jsonResponse({ result: 0, msg: '', data: 1 }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })
    let principalIsCurrent = true
    const assertPrincipalCurrent = vi.fn(async () => {
      if (!principalIsCurrent) throw new Error('private Host Principal diagnostic')
    })
    const bound = bindOpenContentTeamAdministration(
      administration,
      token,
      assertPrincipalCurrent
    )
    const teamId = openContentTeamIdSchema.parse(19)

    await bound.stickTeam({ teamId })
    principalIsCurrent = false
    const error = await bound.unstickTeam({ teamId }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'unauthorized' })
    expect(JSON.stringify(error)).not.toContain('private Host Principal diagnostic')
    expect(fetch).toHaveBeenCalledOnce()
    expect(assertPrincipalCurrent).toHaveBeenCalledTimes(2)
  })

  it('never retries CreateTeam and classifies an uncertain transport as outcome_unknown', async () => {
    const fetch = vi.fn(async () => {
      throw new DOMException('request timed out', 'TimeoutError')
    })
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.createTeam({
      token,
      name: 'SciForge-MVP-timeout'
    })).rejects.toMatchObject({ code: 'outcome_unknown' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('maps the provider duplicate-name result to a conflict without retrying', async () => {
    const fetch = vi.fn(async () => jsonResponse({ result: 806, msg: 'duplicate', data: null }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.createTeam({
      token,
      name: 'SciForge-MVP-existing'
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('preserves a definite HTTP conflict from CreateTeam', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 409 }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.createTeam({
      token,
      name: 'SciForge-MVP-existing'
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('observes, edits, sticks, and unsticks a Team through the documented endpoints', async () => {
    const requests: Array<Readonly<{ path: string; body: unknown }>> = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body)) as unknown
      requests.push({ path, body })
      if (path.endsWith('/GetTeamById')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            teamId: 19,
            folderId: 2213,
            teamName: 'SciForge-MVP-alpha',
            teamStatus: 1,
            teamOwner: 42,
            permission: 15,
            teamType: 2,
            isStick: false
          }
        })
      }
      return jsonResponse({ result: 0, msg: '', data: 1 })
    })
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })
    const teamId = openContentTeamIdSchema.parse(19)
    const folderId = openContentFolderIdSchema.parse(2213)

    await expect(administration.observeTeam({ token, teamId })).resolves.toMatchObject({
      teamId: 19,
      folderId: 2213,
      ownerIdentityId: 42
    })
    await administration.editTeam({
      token,
      teamId,
      folderId,
      name: 'SciForge-MVP-renamed',
      remark: 'Project team'
    })
    await administration.stickTeam({ token, teamId })
    await administration.unstickTeam({ token, teamId })

    expect(requests).toEqual([{
      path: '/flatsdk/api/services/Team/GetTeamById',
      body: { token, teamId: 19 }
    }, {
      path: '/flatsdk/api/services/Team/EditTeamInfo',
      body: {
        token,
        teamId: 19,
        folderId: 2213,
        teamName: 'SciForge-MVP-renamed',
        teamRemark: 'Project team'
      }
    }, {
      path: '/flatsdk/api/services/Team/StickTeam',
      body: { token, teamId: 19 }
    }, {
      path: '/flatsdk/api/services/Team/UnStickTeam',
      body: { token, teamId: 19 }
    }])
  })

  it('pages Team users and uses the verified identity DTO for add and remove', async () => {
    const requests: Array<Readonly<{ path: string; body: unknown }>> = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const path = new URL(String(input)).pathname
      const body = JSON.parse(String(init?.body)) as unknown
      requests.push({ path, body })
      if (path.endsWith('/GetTeamUserByTeamIdPaging')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            pageNum: 1,
            pageSize: 2,
            totalCount: 3,
            list: [{
              identityId: 42,
              userType: 1,
              name: 'Creator'
            }, {
              identityId: 41,
              userType: 3,
              name: 'Member A',
              account: 'member-a'
            }]
          }
        })
      }
      return jsonResponse({ result: 0, msg: '', data: {} })
    })
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })
    const teamId = openContentTeamIdSchema.parse(19)
    const memberA = openContentIdentityIdSchema.parse(41)
    const memberB = openContentIdentityIdSchema.parse(43)

    await expect(administration.listTeamUsers({
      token,
      teamId,
      pageNumber: 1,
      pageSize: 2
    })).resolves.toEqual({
      pageNumber: 1,
      pageSize: 2,
      totalCount: 3,
      users: [{ identityId: 42, userType: 1, displayName: 'Creator' }, {
        identityId: 41,
        userType: 3,
        displayName: 'Member A',
        account: 'member-a'
      }],
      nextPage: 2
    })
    await administration.addTeamUsers({
      token,
      teamId,
      identityIds: [memberA, memberB]
    })
    await administration.removeTeamUsers({
      token,
      teamId,
      identityIds: [memberB]
    })

    expect(requests.slice(1)).toEqual([{
      path: '/flatsdk/api/services/Team/SaveTeamUserList',
      body: {
        token,
        teamId: 19,
        addUserInfo: [{ userId: 41, userType: 3 }, { userId: 43, userType: 3 }],
        updateUserInfo: [],
        deleteUserInfo: []
      }
    }, {
      path: '/flatsdk/api/services/Team/SaveTeamUserList',
      body: {
        token,
        teamId: 19,
        addUserInfo: [],
        updateUserInfo: [],
        deleteUserInfo: [43]
      }
    }])
  })

  it('resolves a Team root only when the folder readback belongs to that Team', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        result: 0,
        msg: '',
        data: {
          id: 2213,
          folderGuid: '7031fd44-2a4a-4c3c-9c74-121104b4324a',
          parentFolderId: 0,
          folderType: 1,
          teamId: 19,
          permission: 15,
          childFolderCount: 0,
          childFileCount: 0
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        result: 0,
        msg: '',
        data: {
          id: 2213,
          folderGuid: '7031fd44-2a4a-4c3c-9c74-121104b4324a',
          parentFolderId: 0,
          folderType: 1,
          teamId: 99,
          permission: 15,
          childFolderCount: 0,
          childFileCount: 0
        }
      }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })
    const teamId = openContentTeamIdSchema.parse(19)
    const folderId = openContentFolderIdSchema.parse(2213)

    await expect(administration.resolveTeamRoot({ token, teamId, folderId }))
      .resolves.toEqual({
        teamId: 19,
        folderId: 2213,
        folderGuid: '7031fd44-2a4a-4c3c-9c74-121104b4324a'
      })
    await expect(administration.resolveTeamRoot({ token, teamId, folderId }))
      .rejects.toMatchObject({ code: 'provider_contract_violation' })
  })

  it('keeps Stage 3 role and owner writes explicit and separate', async () => {
    const requests: Array<Readonly<{ path: string; body: unknown }>> = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      requests.push({
        path: new URL(String(input)).pathname,
        body: JSON.parse(String(init?.body)) as unknown
      })
      return jsonResponse({ result: 0, msg: '', data: 1 })
    })
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })
    const teamId = openContentTeamIdSchema.parse(19)
    const identityId = openContentIdentityIdSchema.parse(41)

    await administration.setTeamUserRole({
      token,
      teamId,
      identityIds: [identityId],
      userType: 2
    })
    await administration.transferTeamOwner({
      token,
      teamId,
      ownerIdentityId: identityId
    })

    expect(requests).toEqual([{
      path: '/flatsdk/api/services/Team/SetTeamUserRole',
      body: { token, teamId: 19, userIds: [41], userType: 2 }
    }, {
      path: '/flatsdk/api/services/Team/EditTeamOwner',
      body: { token, teamId: 19, userId: 41 }
    }])
  })
})

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}
