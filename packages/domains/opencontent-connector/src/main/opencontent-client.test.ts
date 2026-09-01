import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'

import { describe, expect, it, vi } from 'vitest'

import {
  createOpenContentClient
} from './opencontent-client.js'
import * as openContentClientModule from './opencontent-client.js'

const principalIsCurrent = () => undefined

describe('OpenContent client enrollment', () => {
  it('keeps the raw client package-private behind the standard main entrypoint', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../../package.json', import.meta.url), 'utf8')
    ) as Readonly<{ exports?: Readonly<Record<string, unknown>> }>

    expect(manifest.exports?.['./main']).toBe('./src/main/index.ts')
    expect(manifest.exports).not.toHaveProperty('./main/client')
  })

  it('does not expose an unavailable fallback client beside the pinned profile client', () => {
    expect(openContentClientModule).not.toHaveProperty('createUnavailableOpenContentClient')
  })

  it('maps HTTP throttling to a bounded rate-limited error', async () => {
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch: vi.fn(async () => new Response('', { status: 429 }))
    })

    await expect(client.isTokenValid({
      token: 'fixture-token-value',
      assertPrincipalCurrent: principalIsCurrent
    }))
      .rejects.toMatchObject({ code: 'rate_limited' })
  })

  it('rejects an oversized declared JSON body before reading it', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      cancel: () => { cancelled = true }
    })
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch: vi.fn(async () => new Response(body, {
        status: 200,
        headers: { 'content-length': '1000001' }
      }))
    })

    await expect(client.isTokenValid({
      token: 'fixture-token-value',
      assertPrincipalCurrent: principalIsCurrent
    }))
      .rejects.toMatchObject({ code: 'provider_contract_violation' })
    expect(cancelled).toBe(true)
  })

  it('cancels a streamed JSON body as soon as the cumulative limit is exceeded', async () => {
    let cancelled = false
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(600_000))
        controller.enqueue(new Uint8Array(600_000))
      },
      cancel: () => { cancelled = true }
    })
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch: vi.fn(async () => new Response(body, { status: 200 }))
    })

    await expect(client.isTokenValid({
      token: 'fixture-token-value',
      assertPrincipalCurrent: principalIsCurrent
    }))
      .rejects.toMatchObject({ code: 'provider_contract_violation' })
    expect(cancelled).toBe(true)
  })

  it('checks a stored Token without attempting a background login', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      expect(String(input)).toContain('/flatsdk/api/services/Auth/CheckUserTokenValidity')
      return jsonResponse({ result: 0, msg: '', data: false })
    })
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(client.isTokenValid({
      token: 'fixture-token-value',
      assertPrincipalCurrent: principalIsCurrent
    })).resolves.toBe(false)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('keeps a provider-mandated query Token inside one pinned ephemeral HTTPS request', async () => {
    const canary = 'opaque-provider-query-canary-7f91'
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      expect(url.origin).toBe('https://opencontent.invalid')
      expect(url.pathname).toBe('/flatsdk/api/services/Auth/CheckUserTokenValidity')
      expect(Object.fromEntries(url.searchParams)).toEqual({ token: canary })
      expect(init).toMatchObject({
        method: 'POST',
        redirect: 'error',
        credentials: 'omit',
        referrerPolicy: 'no-referrer'
      })
      throw new Error(`provider transport echoed ${url}`)
    })
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    const error = await client.isTokenValid({
      token: canary,
      assertPrincipalCurrent: principalIsCurrent
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'provider_unavailable' })
    expect(JSON.stringify({
      name: error instanceof Error ? error.name : '',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : ''
    })).not.toContain(canary)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('authenticates through RSA login and returns only the validated Token', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const requests: Array<Readonly<{ url: string; init?: RequestInit }>> = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      requests.push({ url, init })
      if (url.endsWith('/inbiz/org/api/auth/GetLoginRsaPublicKey')) {
        return jsonResponse({
          result: 0,
          message: null,
          data: { PublicKey: publicKeyPem, Algorithm: 'RSA', Padding: 'OAEP-SHA256' },
          totalCount: 0
        })
      }
      if (url.endsWith('/flatsdk/api/services/Auth/UserLogin')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(body).toMatchObject({ secure: false, rsaSecure: true, clientType: 4 })
        expect(body.userName).not.toBe('fixture-user')
        expect(body.password).not.toBe('fixture-password')
        return jsonResponse({ result: 0, msg: '', data: 'opaque-token-value-0001', clientId: null })
      }
      if (url.includes('/flatsdk/api/services/Auth/CheckUserTokenValidity')) {
        expect(url).toContain('token=opaque-token-value-0001')
        return jsonResponse({ result: 0, msg: '', data: true })
      }
      throw new Error(`Unexpected request ${url}`)
    })
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })
    const assertPrincipalCurrent = vi.fn(async () => { await Promise.resolve() })
    const fill = vi.spyOn(Buffer.prototype, 'fill')

    try {
      await expect(client.authenticateExistingAccount({
        username: 'fixture-user',
        password: 'fixture-password',
        assertPrincipalCurrent
      })).resolves.toEqual({
        token: 'opaque-token-value-0001'
      })
      expect(fill.mock.calls.filter(([value]) => value === 0)).toHaveLength(2)
      expect(requests).toHaveLength(3)
      expect(assertPrincipalCurrent).toHaveBeenCalledTimes(3)
    } finally {
      fill.mockRestore()
    }
  })

  it('classifies an invalid post-login Token as reauthentication required', async () => {
    const fetch = postLoginValidationTransport({ tokenValid: false })
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(client.authenticateExistingAccount({
      username: 'fixture-user',
      password: 'fixture-password',
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'reauthentication_required' })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('does not fetch account metadata in the credential-bearing authentication stage', async () => {
    const fetch = postLoginValidationTransport({ tokenValid: true, accountResult: 1 })
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(client.authenticateExistingAccount({
      username: 'fixture-user',
      password: 'fixture-password',
      assertPrincipalCurrent: principalIsCurrent
    })).resolves.toEqual({ token: 'opaque-token-value-0001' })
    expect(fetch).toHaveBeenCalledTimes(3)
  })

  it('projects current account observation to binding identity and display name only', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: {
        id: 'external-user-a',
        identityId: 9000041,
        account: 'scientist@example.org',
        name: 'Research Library',
        topPersonalFolderId: 2213
      }
    }))
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(client.observeCurrentExternalAccount({
      token: 'fixture-token-value',
      assertPrincipalCurrent: principalIsCurrent
    })).resolves.toEqual({
      id: 'external-user-a',
      identityId: 9000041,
      name: 'Research Library'
    })
  })

  it('clears the parsed credential fields before dispatching the login request', () => {
    const source = readFileSync(
      new URL('./opencontent-client.ts', import.meta.url),
      'utf8'
    )
    const enrollmentStart = source.indexOf('authenticateExistingAccount: async')
    const enrollmentEnd = source.indexOf('listPersonalRootFolder:', enrollmentStart)
    const enrollmentSource = source.slice(enrollmentStart, enrollmentEnd)
    const offsets = [
      'userNameCiphertext = rsaOaepSha256',
      'passwordCiphertext = rsaOaepSha256',
      "input.username = ''",
      "input.password = ''",
      "path: '/flatsdk/api/services/Auth/UserLogin'"
    ].map((marker) => enrollmentSource.indexOf(marker))

    expect(offsets.every((offset) => offset >= 0)).toBe(true)
    expect(offsets).toEqual([...offsets].sort((left, right) => left - right))
  })

  it('fails before credential submission when the RSA-key envelope drifts from the verified contract', async () => {
    const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
    const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: { PublicKey: publicKeyPem, Algorithm: 'RSA', Padding: 'OAEP-SHA256' }
    }))
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(client.authenticateExistingAccount({
      username: 'fixture-user',
      password: 'fixture-password',
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('resolves the personal root to one stable folder GUID fact', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/flatsdk/api/services/User/GetTopPersonalFolderId')) {
        expect(JSON.parse(String(init?.body))).toEqual({ token: 'fixture-token-value' })
        return jsonResponse({ result: 0, msg: '', data: '1001' })
      }
      if (url.endsWith('/flatsdk/api/services/DocList/GetFolderInfoById')) {
        const { folderId } = JSON.parse(String(init?.body)) as { folderId: number }
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            id: folderId,
            folderGuid: 'personal-folder-guid',
            parentFolderId: 0,
            folderType: 1,
            teamId: 0,
            permission: 7,
            childFolderCount: 0,
            childFileCount: 0
          }
        })
      }
      throw new Error(`Unexpected request ${url}`)
    })
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(client.listPersonalRootFolder({
      token: 'fixture-token-value',
      assertPrincipalCurrent: principalIsCurrent
    })).resolves.toEqual({
      source: 'personal-root',
      folderGuid: 'personal-folder-guid',
      label: 'Personal library'
    })
  })

  it('lists mixed folder children through the encoded bounded paging contract', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      expect(url).toMatch(/\/flatsdk\/api\/services\/DocList\/GetFolderChildren$/u)
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>
      expect(body).toMatchObject({
        token: 'fixture-token-value',
        fid: 'team-folder-guid',
        noCalcPerm: false
      })
      expect(decodeURIComponent(String(body.argsXml))).toContain('<PageNum>2</PageNum>')
      return jsonResponse({
        result: 0,
        msg: '',
        data: {
          folderId: 2213,
          thisFolder: { id: 2213, folderGuid: 'team-folder-guid', permission: -1 },
          docListInfo: {
            foldersInfo: [{
              id: 2214,
              folderGuid: 'child-folder-guid',
              name: 'Experiment A',
              parentFolderId: 2213,
              childFolderCount: 0,
              childFileCount: 1,
              permission: 7
            }],
            filesInfo: [{
              id: 10522,
              fileGuid: 'child-file-guid',
              name: 'result.txt',
              parentFolderId: 2213,
              size: 98,
              permission: 7
            }],
            settings: {
              pageNum: 2,
              pageSize: 20,
              totalCount: 42,
              fileCount: 21,
              folderCount: 21
            }
          }
        }
      })
    })
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(client.listFolderEntries({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      page: 2,
      pageSize: 20,
      assertPrincipalCurrent: principalIsCurrent
    })).resolves.toEqual({
      parentFolderGuid: 'team-folder-guid',
      entries: [{
        kind: 'container',
        folderGuid: 'child-folder-guid',
        label: 'Experiment A'
      }, {
        kind: 'file',
        fileGuid: 'child-file-guid',
        label: 'result.txt',
        size: 98
      }],
      nextPage: 3
    })
  })

  it('awaits an asynchronous Principal guard immediately before a folder-list dispatch', async () => {
    let releaseGuard!: () => void
    const guardPending = new Promise<void>((resolve) => { releaseGuard = resolve })
    const fetch = vi.fn(async () => jsonResponse(
      emptyFolderChildren('team-folder-guid', 9002213, 1, 20)
    ))
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    const result = client.listFolderEntries({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      page: 1,
      pageSize: 20,
      assertPrincipalCurrent: () => guardPending
    })
    await Promise.resolve()
    expect(fetch).not.toHaveBeenCalled()

    releaseGuard()
    await expect(result).resolves.toEqual({
      parentFolderGuid: 'team-folder-guid',
      entries: [],
      nextPage: undefined
    })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('does not dispatch a later root-list request after the Principal changes', async () => {
    let principalCurrent = true
    const requestedPaths: string[] = []
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/User/GetTopPersonalFolderId')) {
        principalCurrent = false
        return jsonResponse({ result: 0, msg: '', data: '1001' })
      }
      throw new Error(`A Principal change must stop request ${url.pathname}`)
    })
    const assertPrincipalCurrent = vi.fn(async () => {
      await Promise.resolve()
      if (!principalCurrent) throw new Error('stale principal')
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.listPersonalRootFolder({
      token: 'fixture-token-value',
      assertPrincipalCurrent
    })).rejects.toMatchObject({ code: 'unauthorized' })

    expect(requestedPaths).toEqual([
      '/flatsdk/api/services/User/GetTopPersonalFolderId'
    ])
    expect(assertPrincipalCurrent).toHaveBeenCalledTimes(2)
  })

  it('does not misclassify a non-authenticated business rejection as an authorization failure', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 37,
      msg: 'provider business rejection',
      data: null
    }))
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.listFolderEntries({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      page: 1,
      pageSize: 20,
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'provider_unavailable' })
  })

  it('rejects folder listings whose children belong to another numeric parent', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: {
        folderId: 9002213,
        thisFolder: { id: 9002213, folderGuid: 'team-folder-guid', permission: 7 },
        docListInfo: {
          foldersInfo: [{
            id: 9002214,
            folderGuid: 'foreign-folder-guid',
            name: 'Foreign folder',
            parentFolderId: 9999,
            childFolderCount: 0,
            childFileCount: 0,
            permission: 7
          }],
          filesInfo: [],
          settings: {
            pageNum: 1,
            pageSize: 20,
            totalCount: 1,
            fileCount: 0,
            folderCount: 1
          }
        }
      }
    }))
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.listFolderEntries({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      page: 1,
      pageSize: 20,
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })
  })

  it('observes the exact file-detail response without reusing listing field names', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: {
        fileId: 10802,
        fileGuid: 'child-file-guid',
        fileName: 'result.txt',
        fileSize: 98,
        parentFolderId: 2213,
        permission: 7
      }
    }))
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(client.observeEntry({
      token: 'fixture-token-value',
      kind: 'file',
      resourceGuid: 'child-file-guid',
      assertPrincipalCurrent: principalIsCurrent
    })).resolves.toEqual({
      kind: 'file',
      fileGuid: 'child-file-guid',
      label: 'result.txt',
      size: 98
    })
  })

  it('creates a folder from a public parent GUID while keeping numeric Provider identities internal', async () => {
    const publicInput = Object.freeze({
      parentFolderGuid: 'team-folder-guid',
      name: 'self-evolve'
    })
    const requestedPaths: string[] = []
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: 'fixture-token-value',
          folderId: publicInput.parentFolderGuid
        })
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            id: 2213,
            folderGuid: publicInput.parentFolderGuid,
            name: 'SciForge Research',
            permission: 7
          }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(body).toMatchObject({
          token: 'fixture-token-value',
          fid: publicInput.parentFolderGuid,
          noCalcPerm: false
        })
        expect(decodeURIComponent(String(body.argsXml))).toContain('<PageNum>1</PageNum>')
        expect(decodeURIComponent(String(body.argsXml))).toContain('<PageSize>100</PageSize>')
        return jsonResponse(emptyFolderChildren(publicInput.parentFolderGuid, 2213, 1, 100))
      }
      if (url.pathname.endsWith('/flatsdk/api/services/TemplateCreate/CreateFolder')) {
        const body = JSON.parse(String(init?.body)) as Record<string, unknown>
        expect(body).toEqual({
          token: 'fixture-token-value',
          name: publicInput.name,
          remark: '',
          code: '',
          parentFolderId: '2213'
        })
        expect(JSON.stringify(body)).not.toContain(publicInput.parentFolderGuid)
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 3317, name: publicInput.name }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderInfoById')) {
        expect(JSON.parse(String(init?.body))).toEqual({
          token: 'fixture-token-value',
          folderId: 3317
        })
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            id: 3317,
            folderGuid: 'created-folder-guid',
            parentFolderId: 2213,
            folderType: 2,
            teamId: 19,
            permission: 7,
            childFolderCount: 0,
            childFileCount: 0
          }
        })
      }
      throw new Error(`Unexpected request ${url}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    expect(Object.keys(publicInput).sort()).toEqual(['name', 'parentFolderGuid'])
    const result = await client.createFolder({
      token: 'fixture-token-value',
      ...publicInput,
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })

    expect(result).toEqual({ folderGuid: 'created-folder-guid' })
    expect(result).not.toHaveProperty('id')
    expect(result).not.toHaveProperty('parentFolderId')
    expect(JSON.stringify(result)).not.toContain('2213')
    expect(JSON.stringify(result)).not.toContain('3317')
    expect(requestedPaths).toEqual([
      '/flatsdk/api/services/DocList/GetFolderByGuidOrId',
      '/flatsdk/api/services/DocList/GetFolderChildren',
      '/flatsdk/api/services/TemplateCreate/CreateFolder',
      '/flatsdk/api/services/DocList/GetFolderInfoById'
    ])
  })

  it.each(['2', '7', '19'])(
    'rejects numeric OpenContent namespace or Team identity %s as a folder parent',
    async (parentFolderGuid) => {
      const fetch = vi.fn(async () => {
        throw new Error('A numeric parent must not reach OpenContent.')
      })
      const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

      await expect(client.createFolder({
        token: 'fixture-token-value',
        parentFolderGuid,
        name: 'Experiment',
        signal: new AbortController().signal,
        assertPrincipalCurrent: principalIsCurrent
      })).rejects.toMatchObject({ code: 'invalid_input' })
      expect(fetch).not.toHaveBeenCalled()
    }
  )

  it('does not dispatch a folder mutation when the Principal changes after preflight', async () => {
    const requestedPaths: string[] = []
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 9002213, folderGuid: 'team-folder-guid', name: 'Team', permission: 7 }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        return jsonResponse(emptyFolderChildren('team-folder-guid', 9002213, 1, 100))
      }
      throw new Error(`A Principal change must stop request ${url.pathname}`)
    })
    let assertionCount = 0
    const assertPrincipalCurrent = vi.fn(async () => {
      assertionCount += 1
      await Promise.resolve()
      if (assertionCount === 3) throw new Error('sensitive-host-principal-diagnostic')
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    const error = await client.createFolder({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      name: 'Experiment',
      signal: new AbortController().signal,
      assertPrincipalCurrent
    }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'unauthorized' })
    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).not.toContain('sensitive-host-principal-diagnostic')
    expect(requestedPaths).toEqual([
      '/flatsdk/api/services/DocList/GetFolderByGuidOrId',
      '/flatsdk/api/services/DocList/GetFolderChildren'
    ])
    expect(assertPrincipalCurrent).toHaveBeenCalledTimes(3)
  })

  it('guards every paginated name-availability request before folder creation', async () => {
    let principalCurrent = true
    const requestedPaths: string[] = []
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 9002213, folderGuid: 'team-folder-guid', name: 'Team', permission: 7 }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        const response = emptyFolderChildren('team-folder-guid', 9002213, 1, 100)
        response.data.docListInfo.settings.totalCount = 101
        principalCurrent = false
        return jsonResponse(response)
      }
      throw new Error(`A Principal change must stop request ${url.pathname}`)
    })
    const assertPrincipalCurrent = vi.fn(async () => {
      await Promise.resolve()
      if (!principalCurrent) throw new Error('stale principal')
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.createFolder({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      name: 'Experiment',
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })).rejects.toMatchObject({ code: 'unauthorized' })

    expect(requestedPaths).toEqual([
      '/flatsdk/api/services/DocList/GetFolderByGuidOrId',
      '/flatsdk/api/services/DocList/GetFolderChildren'
    ])
    expect(assertPrincipalCurrent).toHaveBeenCalledTimes(3)
  })

  it('refuses to claim a created folder when OpenContent observes it under another parent', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 9002213, folderGuid: 'team-folder-guid', name: 'Team', permission: 7 }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        return jsonResponse(emptyFolderChildren('team-folder-guid', 9002213, 1, 100))
      }
      if (url.pathname.endsWith('/flatsdk/api/services/TemplateCreate/CreateFolder')) {
        return jsonResponse({ result: 0, data: { id: 3317, name: 'Experiment' } })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderInfoById')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            id: 3317,
            folderGuid: 'wrong-parent-folder-guid',
            parentFolderId: 9999,
            folderType: 2,
            teamId: 9000019,
            permission: 7,
            childFolderCount: 0,
            childFileCount: 0
          }
        })
      }
      throw new Error(`Unexpected request ${url.pathname}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.createFolder({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      name: 'Experiment',
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'outcome_unknown' })
  })

  it('reports an indeterminate folder write once without retrying the mutation', async () => {
    const requestedPaths: string[] = []
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 9002213, folderGuid: 'team-folder-guid', name: 'Team', permission: 7 }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        return jsonResponse(emptyFolderChildren('team-folder-guid', 9002213, 1, 100))
      }
      if (url.pathname.endsWith('/flatsdk/api/services/TemplateCreate/CreateFolder')) {
        throw new Error('connection closed after request dispatch')
      }
      throw new Error(`Unexpected request ${url.pathname}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.createFolder({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      name: 'Experiment',
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'outcome_unknown' })
    expect(requestedPaths.filter((path) => path.endsWith('/TemplateCreate/CreateFolder')))
      .toHaveLength(1)
  })

  it('reports outcome unknown without retry when the Principal changes after mutation dispatch', async () => {
    let principalCurrent = true
    const requestedPaths: string[] = []
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 9002213, folderGuid: 'team-folder-guid', name: 'Team', permission: 7 }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        return jsonResponse(emptyFolderChildren('team-folder-guid', 9002213, 1, 100))
      }
      if (url.pathname.endsWith('/flatsdk/api/services/TemplateCreate/CreateFolder')) {
        principalCurrent = false
        return jsonResponse({ result: 0, data: { id: 3317, name: 'Experiment' } })
      }
      throw new Error(`A Principal change must stop request ${url.pathname}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.createFolder({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      name: 'Experiment',
      signal: new AbortController().signal,
      assertPrincipalCurrent: async () => {
        await Promise.resolve()
        if (!principalCurrent) throw new Error('stale principal')
      }
    })).rejects.toMatchObject({ code: 'outcome_unknown' })

    expect(requestedPaths).toEqual([
      '/flatsdk/api/services/DocList/GetFolderByGuidOrId',
      '/flatsdk/api/services/DocList/GetFolderChildren',
      '/flatsdk/api/services/TemplateCreate/CreateFolder'
    ])
  })

  it('maps OpenContent folder-name business result 7 to bounded invalid input', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 9002213, folderGuid: 'team-folder-guid', name: 'Team', permission: 7 }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        return jsonResponse(emptyFolderChildren('team-folder-guid', 9002213, 1, 100))
      }
      if (url.pathname.endsWith('/flatsdk/api/services/TemplateCreate/CreateFolder')) {
        return jsonResponse({ result: 7, data: null })
      }
      throw new Error(`Unexpected request ${url.pathname}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.createFolder({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      name: 'Experiment',
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'invalid_input' })
  })

  it('reports a malformed successful folder mutation response as outcome unknown', async () => {
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 9002213, folderGuid: 'team-folder-guid', name: 'Team', permission: 7 }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        return jsonResponse(emptyFolderChildren('team-folder-guid', 9002213, 1, 100))
      }
      if (url.pathname.endsWith('/flatsdk/api/services/TemplateCreate/CreateFolder')) {
        return jsonResponse({ result: 0, data: null })
      }
      throw new Error(`Unexpected request ${url.pathname}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.createFolder({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      name: 'Experiment',
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'outcome_unknown' })
  })

  it('uploads new bytes through main-site creation and bounded region transfer', async () => {
    const bytes = new TextEncoder().encode('fixture upload bytes')
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 2213, folderGuid: 'team-folder-guid', name: 'Team', permission: 7 }
        })
      }
      if (url.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        return jsonResponse(emptyFolderChildren('team-folder-guid', 2213, 1, 100))
      }
      if (url.endsWith('/flatsdk/api/services/Transport/Upload/CheckAndCreateDocInfo')) {
        const form = init?.body as FormData
        expect(form).toBeInstanceOf(FormData)
        expect(form.get('fileName')).toBe('result.txt')
        expect(form.get('fileModel')).toBe('UPLOAD')
        return jsonResponse({
          result: 0,
          reason: '',
          data: {
            FileId: 10802,
            FileVerId: 11670,
            ParentFolderId: 2213,
            RegionHash: 'fixture-region-hash',
            RegionId: 1,
            RegionType: 1,
            RegionUrl: ''
          }
        })
      }
      if (url.includes('/document/upload?')) {
        const form = init?.body as FormData
        expect((form.get('file') as Blob).size).toBe(bytes.byteLength)
        return jsonResponse({
          uploadId: form.get('uploadId'),
          filename: 'result.txt',
          status: 'End',
          message: null,
          percent: 100,
          tag: 'false'
        })
      }
      if (url.includes('/flatsdk/api/services/DocList/GetFileByIdOrGuid?')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            fileId: 10802,
            fileGuid: 'uploaded-file-guid',
            fileName: 'result.txt',
            parentFolderId: 2213,
            fileSize: bytes.byteLength,
            permission: 7
          }
        })
      }
      throw new Error(`Unexpected request ${url}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.uploadNewFile({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      name: 'result.txt',
      size: bytes.byteLength,
      read: async ({ offset, length }) => bytes.slice(offset, offset + length),
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })).resolves.toEqual({
      fileGuid: 'uploaded-file-guid',
      writeAfterObservation: {
        parentFolderGuid: 'team-folder-guid',
        fileGuid: 'uploaded-file-guid',
        name: 'result.txt',
        size: bytes.byteLength
      }
    })
  })

  it('does not dispatch another upload chunk after the Principal changes', async () => {
    const size = (5 * 1024 * 1024) + 1
    const uploadChunks: number[] = []
    let principalCurrent = true
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 9002213, folderGuid: 'team-folder-guid', name: 'Team', permission: 7 }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        return jsonResponse(emptyFolderChildren('team-folder-guid', 9002213, 1, 100))
      }
      if (url.pathname.endsWith('/flatsdk/api/services/Transport/Upload/CheckAndCreateDocInfo')) {
        return jsonResponse({
          result: 0,
          data: {
            FileId: 9010802,
            FileVerId: 11670,
            ParentFolderId: 9002213,
            RegionHash: 'fixture-region-hash',
            RegionId: 1,
            RegionType: 1,
            RegionUrl: ''
          }
        })
      }
      if (url.pathname === '/document/upload') {
        const form = init?.body as FormData
        uploadChunks.push(Number(form.get('chunk')))
        principalCurrent = false
        return jsonResponse({
          uploadId: form.get('uploadId'),
          filename: 'result.bin',
          status: 'Uploading',
          message: null,
          percent: 50,
          tag: 'false'
        })
      }
      throw new Error(`A Principal change must stop request ${url.pathname}`)
    })
    const assertPrincipalCurrent = vi.fn(async () => {
      await Promise.resolve()
      if (!principalCurrent) throw new Error('stale principal')
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.uploadNewFile({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      name: 'result.bin',
      size,
      read: async ({ length }) => new Uint8Array(length),
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })).rejects.toMatchObject({ code: 'outcome_unknown' })

    expect(uploadChunks).toEqual([0])
  })

  it('returns conflict without uploading when the target name already exists', async () => {
    const requestedPaths: string[] = []
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 9002213, folderGuid: 'team-folder-guid', name: 'Team', permission: 7 }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        const response = emptyFolderChildren('team-folder-guid', 9002213, 1, 100, [{
          id: 9010802,
          fileGuid: 'existing-file-guid',
          name: 'result.txt',
          parentFolderId: 9002213,
          size: 7,
          permission: 7
        }])
        response.data.docListInfo.settings.totalCount = 1
        response.data.docListInfo.settings.fileCount = 1
        return jsonResponse(response)
      }
      throw new Error(`Upload mutation unexpectedly reached ${url.pathname}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.uploadNewFile({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      name: 'result.txt',
      size: 0,
      read: async () => new Uint8Array(),
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'conflict' })
    expect(requestedPaths).toEqual([
      '/flatsdk/api/services/DocList/GetFolderByGuidOrId',
      '/flatsdk/api/services/DocList/GetFolderChildren'
    ])
  })

  it('returns unauthorized when the real upload write gate rejects the current member', async () => {
    const requestedPaths: string[] = []
    const read = vi.fn(async () => new Uint8Array())
    const fetch = vi.fn(async (rawInput: string | URL | Request) => {
      const url = new URL(String(rawInput))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 9002213, folderGuid: 'team-folder-guid', name: 'Team', permission: 1 }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        return jsonResponse(emptyFolderChildren('team-folder-guid', 9002213, 1, 100))
      }
      if (url.pathname.endsWith('/flatsdk/api/services/Transport/Upload/CheckAndCreateDocInfo')) {
        return new Response(JSON.stringify({ result: 403 }), {
          status: 403,
          headers: { 'content-type': 'application/json' }
        })
      }
      throw new Error(`A rejected upload gate must stop request ${url.pathname}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.uploadNewFile({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      name: 'result.txt',
      size: 0,
      read,
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'unauthorized' })

    expect(requestedPaths).toEqual([
      '/flatsdk/api/services/DocList/GetFolderByGuidOrId',
      '/flatsdk/api/services/DocList/GetFolderChildren',
      '/flatsdk/api/services/Transport/Upload/CheckAndCreateDocInfo'
    ])
    expect(read).not.toHaveBeenCalled()
  })

  it('refuses to claim an upload whose final file fact is outside the requested parent', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: { id: 9002213, folderGuid: 'team-folder-guid', name: 'Team', permission: 7 }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderChildren')) {
        return jsonResponse(emptyFolderChildren('team-folder-guid', 9002213, 1, 100))
      }
      if (url.pathname.endsWith('/flatsdk/api/services/Transport/Upload/CheckAndCreateDocInfo')) {
        return jsonResponse({
          result: 0,
          data: {
            FileId: 9010802,
            FileVerId: 11670,
            ParentFolderId: 9002213,
            RegionHash: 'fixture-region-hash',
            RegionId: 1,
            RegionType: 1,
            RegionUrl: ''
          }
        })
      }
      if (url.pathname === '/document/upload') {
        const form = init?.body as FormData
        return jsonResponse({
          uploadId: form.get('uploadId'),
          filename: 'result.txt',
          status: 'End',
          message: null,
          percent: 100,
          tag: 'false'
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFileByIdOrGuid')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            fileId: 9010802,
            fileGuid: 'wrong-parent-file-guid',
            fileName: 'result.txt',
            parentFolderId: 9999,
            fileSize: 0,
            permission: 7
          }
        })
      }
      throw new Error(`Unexpected request ${url.pathname}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.uploadNewFile({
      token: 'fixture-token-value',
      parentFolderGuid: 'team-folder-guid',
      name: 'result.txt',
      size: 0,
      read: async () => new Uint8Array(),
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'outcome_unknown' })
  })

  it('observes one token-free file parent fact while retaining numeric IDs internally', async () => {
    const requestedPaths: string[] = []
    const fetch = vi.fn(async (rawUrl: string | URL | Request) => {
      const url = new URL(String(rawUrl))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFileByIdOrGuid')) {
        expect(url.searchParams.get('fileIdOrGuid')).toBe('candidate-file-guid')
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            fileId: 7001,
            fileGuid: 'candidate-file-guid',
            fileName: 'candidate.txt',
            fileSize: 19,
            parentFolderId: 6001,
            permission: 7
          }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderInfoById')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            id: 6001,
            folderGuid: 'parent-folder-guid',
            parentFolderId: 5001,
            folderType: 2,
            teamId: 41,
            permission: 7,
            childFolderCount: 0,
            childFileCount: 1
          }
        })
      }
      throw new Error(`Unexpected request ${url.pathname}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.observeEntryParent({
      token: 'fixture-token-value',
      kind: 'file',
      resourceGuid: 'candidate-file-guid',
      assertPrincipalCurrent: principalIsCurrent
    })).resolves.toEqual({
      child: { kind: 'file', resourceGuid: 'candidate-file-guid' },
      parent: { kind: 'container', resourceGuid: 'parent-folder-guid' }
    })
    expect(requestedPaths).toEqual([
      '/flatsdk/api/services/DocList/GetFileByIdOrGuid',
      '/flatsdk/api/services/DocList/GetFolderInfoById'
    ])
  })

  it('distinguishes an observable Provider root without exposing its numeric parent sentinel', async () => {
    const requestedPaths: string[] = []
    const fetch = vi.fn(async (rawUrl: string | URL | Request) => {
      const url = new URL(String(rawUrl))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderByGuidOrId')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            id: 6001,
            folderGuid: 'provider-root-guid',
            name: 'Root',
            permission: 7
          }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFolderInfoById')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            id: 6001,
            folderGuid: 'provider-root-guid',
            parentFolderId: 0,
            folderType: 2,
            teamId: 41,
            permission: 7,
            childFolderCount: 1,
            childFileCount: 0
          }
        })
      }
      throw new Error(`Unexpected request ${url.pathname}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.observeEntryParent({
      token: 'fixture-token-value',
      kind: 'container',
      resourceGuid: 'provider-root-guid',
      assertPrincipalCurrent: principalIsCurrent
    })).resolves.toEqual({
      child: { kind: 'container', resourceGuid: 'provider-root-guid' }
    })
    expect(requestedPaths).toEqual([
      '/flatsdk/api/services/DocList/GetFolderByGuidOrId',
      '/flatsdk/api/services/DocList/GetFolderInfoById'
    ])
  })

  it('fails closed when a file fact has no observable parent or uses a numeric public identity', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      msg: '',
      data: {
        fileId: 7001,
        fileGuid: 'orphan-file-guid',
        fileName: 'orphan.txt',
        fileSize: 19,
        parentFolderId: 0,
        permission: 7
      }
    }))
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.observeEntryParent({
      token: 'fixture-token-value',
      kind: 'file',
      resourceGuid: 'orphan-file-guid',
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })
    await expect(client.observeEntryParent({
      token: 'fixture-token-value',
      kind: 'file',
      resourceGuid: '7001',
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'invalid_input' })
    expect(fetch).toHaveBeenCalledOnce()
  })

  it('rejects metadata-visible content when the real DownloadCheck denies permission', async () => {
    const requestedPaths: string[] = []
    const fetch = vi.fn(async (rawInput: string | URL | Request) => {
      const url = new URL(String(rawInput))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/DocList/GetFileByIdOrGuid')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            fileId: 7001,
            fileGuid: 'metadata-visible-file-guid',
            fileName: 'visible-but-denied.txt',
            fileSize: 19,
            parentFolderId: 6001,
            permission: 1
          }
        })
      }
      if (url.pathname.endsWith('/flatsdk/api/services/Transport/Download/DownloadCheck')) {
        return jsonResponse({ result: 403 })
      }
      throw new Error(`A denied DownloadCheck must stop request ${url.pathname}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.observeEntry({
      token: 'fixture-token-value',
      kind: 'file',
      resourceGuid: 'metadata-visible-file-guid',
      assertPrincipalCurrent: principalIsCurrent
    })).resolves.toMatchObject({
      kind: 'file',
      fileGuid: 'metadata-visible-file-guid'
    })
    await expect(client.authorizeDownload({
      token: 'fixture-token-value',
      fileGuid: 'metadata-visible-file-guid',
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'unauthorized' })

    expect(requestedPaths).toEqual([
      '/flatsdk/api/services/DocList/GetFileByIdOrGuid',
      '/flatsdk/api/services/Transport/Download/DownloadCheck'
    ])
  })

  it('rejects a malformed DownloadCheck transfer origin as a Provider contract violation', async () => {
    const fetch = vi.fn(async () => jsonResponse({
      result: 0,
      data: {
        regionId: 17,
        regionType: 2,
        regionHash: 'fixture-download-hash',
        regionUrl: 'not-an-absolute-url'
      }
    }))
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.authorizeDownload({
      token: 'fixture-token-value',
      fileGuid: 'download-file-guid',
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })

    expect(fetch).toHaveBeenCalledOnce()
  })

  it('downloads one GUID through check then streams only response bytes', async () => {
    const bytes = new TextEncoder().encode('fixture download bytes')
    const writes: Uint8Array[] = []
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/flatsdk/api/services/Transport/Download/DownloadCheck')) {
        return jsonResponse({
          result: 0,
          data: {
            regionId: 1,
            regionType: 1,
            regionHash: 'fixture-download-hash',
            regionUrl: ''
          }
        })
      }
      if (url.includes('/downLoad/index?')) {
        expect(url).toContain('fileGuid=download-file-guid')
        return new Response(bytes, {
          status: 200,
          headers: { 'content-length': String(bytes.byteLength) }
        })
      }
      throw new Error(`Unexpected request ${url}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    const authorization = await client.authorizeDownload({
      token: 'fixture-token-value',
      fileGuid: 'download-file-guid',
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })
    await expect(client.downloadAuthorizedFile({
      token: 'fixture-token-value',
      authorization,
      write: async (chunk: Uint8Array) => { writes.push(Uint8Array.from(chunk)) },
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })).resolves.toEqual({ bytesWritten: bytes.byteLength })
    expect(Buffer.concat(writes)).toEqual(Buffer.from(bytes))
  })

  it('cancels and unlocks the download reader with the primary destination error', async () => {
    const primaryError = new Error('The Workspace destination rejected the chunk.')
    const cancel = vi.fn<(reason?: unknown) => void>(() => {
      throw new Error('The response cancellation cleanup also failed.')
    })
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
      },
      cancel
    })
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = String(input)
      if (url.endsWith('/flatsdk/api/services/Transport/Download/DownloadCheck')) {
        return jsonResponse({
          result: 0,
          data: {
            regionId: 1,
            regionType: 1,
            regionHash: 'fixture-download-hash',
            regionUrl: ''
          }
        })
      }
      if (url.includes('/downLoad/index?')) return new Response(body, { status: 200 })
      throw new Error(`Unexpected request ${url}`)
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    const authorization = await client.authorizeDownload({
      token: 'fixture-token-value',
      fileGuid: 'download-file-guid',
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })
    await expect(client.downloadAuthorizedFile({
      token: 'fixture-token-value',
      authorization,
      write: async () => { throw primaryError },
      signal: new AbortController().signal,
      assertPrincipalCurrent: principalIsCurrent
    })).rejects.toBe(primaryError)

    expect(cancel).toHaveBeenCalledOnce()
    expect(cancel).toHaveBeenCalledWith(primaryError)
    expect(body.locked).toBe(false)
  })

  it.each([
    ['malformed', 'not-a-decimal-length', 'provider_contract_violation'],
    ['oversized', String(1024 * 1024 * 1024 + 1), 'bounds_exceeded']
  ] as const)(
    'cancels and unlocks the download reader for a %s declared body',
    async (_label, contentLength, expectedCode) => {
      const cancel = vi.fn<(reason?: unknown) => void>()
      const body = new ReadableStream<Uint8Array>({ cancel })
      const fetch = vi.fn(async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith('/flatsdk/api/services/Transport/Download/DownloadCheck')) {
          return jsonResponse({
            result: 0,
            data: {
              regionId: 1,
              regionType: 1,
              regionHash: 'fixture-download-hash',
              regionUrl: ''
            }
          })
        }
        if (url.includes('/downLoad/index?')) {
          return new Response(body, {
            status: 200,
            headers: { 'content-length': contentLength }
          })
        }
        throw new Error(`Unexpected request ${url}`)
      })
      const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })
      const write = vi.fn(async () => undefined)

      const authorization = await client.authorizeDownload({
        token: 'fixture-token-value',
        fileGuid: 'download-file-guid',
        signal: new AbortController().signal,
        assertPrincipalCurrent: principalIsCurrent
      })
      const primaryError = await client.downloadAuthorizedFile({
        token: 'fixture-token-value',
        authorization,
        write,
        signal: new AbortController().signal,
        assertPrincipalCurrent: principalIsCurrent
      }).catch((error: unknown) => error)

      expect(primaryError).toMatchObject({ code: expectedCode })
      expect(cancel).toHaveBeenCalledOnce()
      expect(cancel).toHaveBeenCalledWith(primaryError)
      expect(body.locked).toBe(false)
      expect(write).not.toHaveBeenCalled()
    }
  )

  it('does not dispatch the download transfer after the Principal changes during its check', async () => {
    let principalCurrent = true
    const requestedPaths: string[] = []
    const fetch = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      requestedPaths.push(url.pathname)
      if (url.pathname.endsWith('/flatsdk/api/services/Transport/Download/DownloadCheck')) {
        principalCurrent = false
        return jsonResponse({
          result: 0,
          data: {
            regionId: 1,
            regionType: 1,
            regionHash: 'fixture-download-hash',
            regionUrl: ''
          }
        })
      }
      throw new Error(`A Principal change must stop request ${url.pathname}`)
    })
    const assertPrincipalCurrent = vi.fn(async () => {
      await Promise.resolve()
      if (!principalCurrent) throw new Error('stale principal')
    })
    const client = createOpenContentClient({ baseUrl: 'https://opencontent.invalid', fetch })

    await expect(client.authorizeDownload({
      token: 'fixture-token-value',
      fileGuid: 'download-file-guid',
      signal: new AbortController().signal,
      assertPrincipalCurrent
    })).rejects.toMatchObject({ code: 'unauthorized' })

    expect(requestedPaths).toEqual([
      '/flatsdk/api/services/Transport/Download/DownloadCheck'
    ])
    expect(assertPrincipalCurrent).toHaveBeenCalledTimes(2)
  })
})

function emptyFolderChildren(
  folderGuid: string,
  folderId: number,
  pageNum: number,
  pageSize: number,
  filesInfo: Array<Readonly<{
    id: number
    fileGuid: string
    name: string
    parentFolderId: number
    size: number
    permission: number
  }>> = []
) {
  return {
    result: 0,
    msg: '',
    data: {
      folderId,
      thisFolder: { id: folderId, folderGuid, permission: 7 },
      docListInfo: {
        foldersInfo: [],
        filesInfo,
        settings: { pageNum, pageSize, totalCount: 0, fileCount: 0, folderCount: 0 }
      }
    }
  }
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' }
  })
}

function postLoginValidationTransport(options: Readonly<{
  tokenValid: boolean
  accountResult?: number
}>) {
  const { publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  const publicKeyPem = publicKey.export({ type: 'spki', format: 'pem' }).toString()
  return vi.fn(async (input: string | URL | Request) => {
    const url = new URL(String(input))
    if (url.pathname === '/inbiz/org/api/auth/GetLoginRsaPublicKey') {
      return jsonResponse({
        result: 0,
        message: null,
        data: { PublicKey: publicKeyPem, Algorithm: 'RSA', Padding: 'OAEP-SHA256' },
        totalCount: 0
      })
    }
    if (url.pathname === '/flatsdk/api/services/Auth/UserLogin') {
      return jsonResponse({
        result: 0,
        msg: '',
        data: 'opaque-token-value-0001',
        clientId: null
      })
    }
    if (url.pathname === '/flatsdk/api/services/Auth/CheckUserTokenValidity') {
      return jsonResponse({ result: 0, msg: '', data: options.tokenValid })
    }
    if (url.pathname === '/flatsdk/api/services/User/GetUserInfoByToken') {
      return jsonResponse({
        result: options.accountResult ?? 0,
        msg: options.accountResult ? 'account lookup rejected' : '',
        data: {
          id: 'external-user-guid',
          identityId: 42,
          account: 'fixture-user',
          name: 'Fixture User',
          topPersonalFolderId: 2213
        }
      })
    }
    throw new Error(`Unexpected request ${url.pathname}`)
  }) as typeof fetch
}
