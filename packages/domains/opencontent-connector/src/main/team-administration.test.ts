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
            teamId: 9000019,
            folderId: 9002213,
            teamName: 'SciForge-MVP-alpha',
            teamStatus: 1,
            teamOwner: 9000042,
            permission: 15,
            teamType: 2,
            isStick: true
          }, {
            teamId: 20,
            folderId: 9002214,
            teamName: 'SciForge-MVP-beta',
            teamStatus: 1,
            teamOwner: 9000042,
            permission: 15,
            teamType: 3,
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
        teamId: 9000019,
        folderId: 9002213,
        name: 'SciForge-MVP-alpha',
        ownerIdentityId: 9000042,
        status: 1,
        permission: 15,
        teamType: 2,
        isStuck: true
      }, {
        teamId: 20,
        folderId: 9002214,
        name: 'SciForge-MVP-beta',
        ownerIdentityId: 9000042,
        status: 1,
        permission: 15,
        teamType: 3,
        isStuck: false
      }],
      nextPage: 2
    })
    expect(String(fetch.mock.calls[0]?.[0])).toBe(
      'https://opencontent.invalid/flatsdk/api/services/Team/GetMyTeamList'
    )
  })

  it('rejects a Team page whose returned count cannot satisfy its declared total', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: {
        pageNum: 1,
        pageSize: 2,
        totalCount: 3,
        teamList: [{
          teamId: 9000019,
          folderId: 9002213,
          teamName: 'Incomplete Team page',
          teamStatus: 1,
          teamOwner: 9000042,
          permission: 15,
          teamType: 2,
          isStick: false
        }]
      }
    }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.listTeams({
      token,
      pageNumber: 1,
      pageSize: 2
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    [2, 3],
    [3, 2]
  ] as const)('rejects a requested relation-type-%i page containing relation type %i', async (
    requestedTeamType,
    returnedTeamType
  ) => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: {
        pageNum: 1,
        pageSize: 100,
        totalCount: 1,
        teamList: [{
          teamId: 9000019,
          folderId: 9002213,
          teamName: 'Foreign Team type',
          teamStatus: 1,
          teamOwner: 9000042,
          permission: 15,
          teamType: returnedTeamType,
          isStick: false
        }]
      }
    }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.listTeams({
      token,
      pageNumber: 1,
      pageSize: 100,
      teamType: requestedTeamType
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('proves the pinned-Team filter without conflating it with the owner relation type', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: {
        pageNum: 1,
        pageSize: 100,
        totalCount: 1,
        teamList: [{
          teamId: 9000019,
          folderId: 9002213,
          teamName: 'Pinned owned Team',
          teamStatus: 1,
          teamOwner: 9000042,
          permission: 15,
          teamType: 2,
          isStick: true
        }]
      }
    }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.listTeams({
      token,
      pageNumber: 1,
      pageSize: 100,
      teamType: 1
    })).resolves.toMatchObject({
      teams: [expect.objectContaining({ teamType: 2, isStuck: true })]
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects an unpinned row returned for the pinned-Team filter', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: {
        pageNum: 1,
        pageSize: 100,
        totalCount: 1,
        teamList: [{
          teamId: 9000019,
          folderId: 9002213,
          teamName: 'Unpinned owned Team',
          teamStatus: 1,
          teamOwner: 9000042,
          permission: 15,
          teamType: 2,
          isStick: false
        }]
      }
    }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.listTeams({
      token,
      pageNumber: 1,
      pageSize: 100,
      teamType: 1
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })
    expect(fetch).toHaveBeenCalledOnce()
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
    expect(bound).not.toHaveProperty('setTeamUserRole')
    expect(bound).not.toHaveProperty('transferTeamOwner')
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
    const teamId = openContentTeamIdSchema.parse(9000019)

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

  it('classifies CreateTeam cancellation after dispatch as outcome_unknown', async () => {
    const controller = new AbortController()
    const fetch = abortAfterDispatch(controller)
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.createTeam({
      token,
      name: 'SciForge-MVP-cancelled-after-dispatch',
      signal: controller.signal
    })).rejects.toMatchObject({ code: 'outcome_unknown' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('keeps a pre-dispatch CreateTeam cancellation definite', async () => {
    const controller = new AbortController()
    controller.abort()
    const fetch = vi.fn<typeof globalThis.fetch>()
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.createTeam({
      token,
      name: 'SciForge-MVP-cancelled-before-dispatch',
      signal: controller.signal
    })).rejects.toMatchObject({ code: 'cancelled' })
    expect(fetch).not.toHaveBeenCalled()
  })

  it('classifies an invalid CreateTeam response after dispatch as outcome_unknown', async () => {
    const fetch = vi.fn(async () => new Response('{not-json', { status: 200 }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.createTeam({
      token,
      name: 'SciForge-MVP-invalid-response'
    })).rejects.toMatchObject({ code: 'outcome_unknown' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [409, 'conflict'],
    [429, 'rate_limited']
  ] as const)('preserves definite HTTP %i mutation failure as %s', async (status, code) => {
    const fetch = vi.fn(async () => new Response('', { status }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.createTeam({
      token,
      name: `SciForge-MVP-http-${status}`
    })).rejects.toMatchObject({ code })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not classify an HTTP conflict response from a Team read as a write conflict', async () => {
    const fetch = vi.fn(async () => new Response('', { status: 409 }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.listTeams({
      token,
      pageNumber: 1,
      pageSize: 100
    })).rejects.toMatchObject({ code: 'provider_unavailable' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('treats every nonzero Team mutation result as uncertain without retrying', async () => {
    const teamId = openContentTeamIdSchema.parse(9000019)
    const folderId = openContentFolderIdSchema.parse(9002213)
    const identityId = openContentIdentityIdSchema.parse(9000041)
    const invocations: readonly ((administration: ReturnType<
      typeof createOpenContentTeamAdministration
    >) => Promise<void>)[] = [
      (administration) => administration.createTeam({ token, name: 'Uncertain create' }),
      (administration) => administration.editTeam({
        token,
        teamId,
        folderId,
        name: 'Uncertain edit'
      }),
      (administration) => administration.stickTeam({ token, teamId }),
      (administration) => administration.unstickTeam({ token, teamId }),
      (administration) => administration.addTeamUsers({
        token,
        teamId,
        identityIds: [identityId]
      }),
      (administration) => administration.removeTeamUsers({
        token,
        teamId,
        identityIds: [identityId]
      })
    ]

    for (const [index, invoke] of invocations.entries()) {
      const fetch = vi.fn(async () => jsonResponse({
        result: index === 0 ? 806 : index + 1,
        msg: 'No endpoint-specific no-commit proof.',
        data: null
      }))
      const administration = createOpenContentTeamAdministration({
        baseUrl: 'https://opencontent.invalid',
        fetch
      })

      await expect(invoke(administration)).rejects.toMatchObject({ code: 'outcome_unknown' })
      expect(fetch).toHaveBeenCalledOnce()
    }
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
            teamId: 9000019,
            folderId: 9002213,
            teamName: 'SciForge-MVP-alpha',
            teamStatus: 1,
            teamOwner: 9000042,
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
    const teamId = openContentTeamIdSchema.parse(9000019)
    const folderId = openContentFolderIdSchema.parse(9002213)

    await expect(administration.observeTeam({ token, teamId })).resolves.toMatchObject({
      teamId: 9000019,
      folderId: 9002213,
      ownerIdentityId: 9000042
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
      body: { token, teamId: 9000019 }
    }, {
      path: '/flatsdk/api/services/Team/EditTeamInfo',
      body: {
        token,
        teamId: 9000019,
        folderId: 9002213,
        teamName: 'SciForge-MVP-renamed',
        teamRemark: 'Project team'
      }
    }, {
      path: '/flatsdk/api/services/Team/StickTeam',
      body: { token, teamId: 9000019 }
    }, {
      path: '/flatsdk/api/services/Team/UnStickTeam',
      body: { token, teamId: 9000019 }
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
            teamUser: [{
              identityId: 9000042,
              userType: 1,
              displayName: 'Creator'
            }, {
              identityId: 9000041,
              userType: 3,
              displayName: 'Member A'
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
    const teamId = openContentTeamIdSchema.parse(9000019)
    const memberA = openContentIdentityIdSchema.parse(9000041)
    const memberB = openContentIdentityIdSchema.parse(9000043)

    await expect(administration.listTeamUsers({
      token,
      teamId,
      pageNumber: 1,
      pageSize: 2
    })).resolves.toEqual({
      pageNumber: 1,
      pageSize: 2,
      totalCount: 3,
      users: [{ identityId: 9000042, userType: 1, displayName: 'Creator' }, {
        identityId: 9000041,
        userType: 3,
        displayName: 'Member A'
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
        teamId: 9000019,
        addUserInfo: [{ userId: 9000041, userType: 3 }, { userId: 9000043, userType: 3 }],
        updateUserInfo: [],
        deleteUserInfo: []
      }
    }, {
      path: '/flatsdk/api/services/Team/SaveTeamUserList',
      body: {
        token,
        teamId: 9000019,
        addUserInfo: [],
        updateUserInfo: [],
        deleteUserInfo: [9000043]
      }
    }])
  })

  it('classifies SaveTeamUserList cancellation after dispatch as outcome_unknown', async () => {
    const controller = new AbortController()
    const fetch = abortAfterDispatch(controller)
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.addTeamUsers({
      token,
      teamId: openContentTeamIdSchema.parse(9000019),
      identityIds: [openContentIdentityIdSchema.parse(9000043)],
      signal: controller.signal
    })).rejects.toMatchObject({ code: 'outcome_unknown' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects a Team-user page whose returned count cannot satisfy its declared total', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: {
        pageNum: 1,
        pageSize: 2,
        totalCount: 3,
        teamUser: [{ identityId: 9000042, userType: 1 }]
      }
    }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.listTeamUsers({
      token,
      teamId: openContentTeamIdSchema.parse(9000019),
      pageNumber: 1,
      pageSize: 2
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('fails closed when a metadata-free teamUser collection fills the requested page', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: {
        creatorName: 'Synthetic Owner',
        perm: true,
        teamUser: [{ identityId: 9000042, userType: 1 }, {
          identityId: 9000041,
          userType: 3
        }]
      }
    }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.listTeamUsers({
      token,
      teamId: openContentTeamIdSchema.parse(9000019),
      pageNumber: 1,
      pageSize: 2
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects a metadata-free Team-user page after page one', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: {
        teamUser: [{ identityId: 9000041, userType: 3 }]
      }
    }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.listTeamUsers({
      token,
      teamId: openContentTeamIdSchema.parse(9000019),
      pageNumber: 2,
      pageSize: 2
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each(['list', 'datas', 'items', 'teamUserList'] as const)(
    'rejects the unverified %s Team-member collection alias',
    async (collectionKey) => {
      const fetch = vi.fn(async () => jsonResponse({
        result: 0,
        msg: '',
        data: {
          [collectionKey]: [{ identityId: 9000042, userType: 1 }]
        }
      }))
      const administration = createOpenContentTeamAdministration({
        baseUrl: 'https://opencontent.invalid',
        fetch
      })

      await expect(administration.listTeamUsers({
        token,
        teamId: openContentTeamIdSchema.parse(9000019),
        pageNumber: 1,
        pageSize: 2
      })).rejects.toMatchObject({ code: 'provider_contract_violation' })
      expect(fetch).toHaveBeenCalledOnce()
    }
  )

  it('does not treat an unverified total alias as pagination proof', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: {
        total: 2,
        teamUser: [{ identityId: 9000042, userType: 1 }, {
          identityId: 9000041,
          userType: 3
        }]
      }
    }))
    const administration = createOpenContentTeamAdministration({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(administration.listTeamUsers({
      token,
      teamId: openContentTeamIdSchema.parse(9000019),
      pageNumber: 1,
      pageSize: 2
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it.each([
    ['userIdentityId', { userIdentityId: 9000042, userType: 1 }],
    ['userId', { userId: 9000042, userType: 1 }],
    ['conflicting identity alias', {
      identityId: 9000042,
      userIdentityId: 9000041,
      userType: 1
    }],
    ['name', { identityId: 9000042, userType: 1, name: 'Alias' }],
    ['userName', { identityId: 9000042, userType: 1, userName: 'Alias' }],
    ['account', { identityId: 9000042, userType: 1, account: 'alias-account' }]
  ] as const)(
    'rejects the unverified %s Team-member row field',
    async (_field, row) => {
      const fetch = vi.fn(async () => jsonResponse({
        result: 0,
        msg: '',
        data: {
          pageNum: 1,
          pageSize: 2,
          totalCount: 1,
          teamUser: [row]
        }
      }))
      const administration = createOpenContentTeamAdministration({
        baseUrl: 'https://opencontent.invalid',
        fetch
      })

      await expect(administration.listTeamUsers({
        token,
        teamId: openContentTeamIdSchema.parse(9000019),
        pageNumber: 1,
        pageSize: 2
      })).rejects.toMatchObject({ code: 'provider_contract_violation' })
      expect(fetch).toHaveBeenCalledOnce()
    }
  )

  it('resolves a Team root only when the folder readback belongs to that Team', async () => {
    const fetch = vi.fn()
      .mockResolvedValueOnce(jsonResponse({
        result: 0,
        msg: '',
        data: {
          id: 9002213,
          folderGuid: '11111111-2222-4333-8444-555555555555',
          parentFolderId: 0,
          folderType: 1,
          teamId: 9000019,
          permission: 15,
          childFolderCount: 0,
          childFileCount: 0
        }
      }))
      .mockResolvedValueOnce(jsonResponse({
        result: 0,
        msg: '',
        data: {
          id: 9002213,
          folderGuid: '11111111-2222-4333-8444-555555555555',
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
    const teamId = openContentTeamIdSchema.parse(9000019)
    const folderId = openContentFolderIdSchema.parse(9002213)

    await expect(administration.resolveTeamRoot({ token, teamId, folderId }))
      .resolves.toEqual({
        teamId: 9000019,
        folderId: 9002213,
        folderGuid: '11111111-2222-4333-8444-555555555555'
      })
    await expect(administration.resolveTeamRoot({ token, teamId, folderId }))
      .rejects.toMatchObject({ code: 'provider_contract_violation' })
  })

})

function abortAfterDispatch(controller: AbortController) {
  return vi.fn((_input: string | URL | Request, init?: RequestInit) =>
    new Promise<Response>((_resolve, reject) => {
      const signal = init?.signal
      if (!signal) {
        reject(new Error('The mutation request must carry an AbortSignal.'))
        return
      }
      signal.addEventListener('abort', () => {
        reject(new DOMException('The dispatched mutation was cancelled.', 'AbortError'))
      }, { once: true })
      controller.abort()
    }))
}

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}
