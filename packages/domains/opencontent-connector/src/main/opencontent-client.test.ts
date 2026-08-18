import { generateKeyPairSync } from 'node:crypto'

import { describe, expect, it, vi } from 'vitest'

import {
  createOpenContentClient,
  createUnavailableOpenContentClient
} from './opencontent-client.js'

describe('OpenContent client enrollment', () => {
  it('fails closed without a configured Provider endpoint', async () => {
    const client = createUnavailableOpenContentClient()

    await expect(client.isTokenValid({ token: 'fixture-token-value' }))
      .rejects.toMatchObject({ code: 'provider_unavailable' })
    await expect(client.authenticateExistingAccount({
      username: 'fixture-user',
      password: 'fixture-password'
    })).rejects.toMatchObject({ code: 'provider_unavailable' })
  })

  it('maps HTTP throttling to a bounded rate-limited error', async () => {
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch: vi.fn(async () => new Response('', { status: 429 }))
    })

    await expect(client.isTokenValid({ token: 'fixture-token-value' }))
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

    await expect(client.isTokenValid({ token: 'fixture-token-value' }))
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

    await expect(client.isTokenValid({ token: 'fixture-token-value' }))
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

    await expect(client.isTokenValid({ token: 'fixture-token-value' })).resolves.toBe(false)
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

    const error = await client.isTokenValid({ token: canary }).catch((caught: unknown) => caught)

    expect(error).toMatchObject({ code: 'provider_unavailable' })
    expect(JSON.stringify({
      name: error instanceof Error ? error.name : '',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : ''
    })).not.toContain(canary)
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('authenticates through RSA login then validates the Token and stable account identity', async () => {
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
      if (url.endsWith('/flatsdk/api/services/User/GetUserInfoByToken')) {
        expect(JSON.parse(String(init?.body))).toEqual({ token: 'opaque-token-value-0001' })
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            id: 'external-user-guid',
            identityId: 42,
            account: 'fixture-user',
            name: 'Fixture User',
            topPersonalFolderId: 2213
          }
        })
      }
      throw new Error(`Unexpected request ${url}`)
    })
    const client = createOpenContentClient({
      baseUrl: 'https://opencontent.invalid',
      fetch
    })

    await expect(client.authenticateExistingAccount({
      username: 'fixture-user',
      password: 'fixture-password'
    })).resolves.toEqual({
      token: 'opaque-token-value-0001',
      account: {
        id: 'external-user-guid',
        identityId: 42,
        account: 'fixture-user',
        name: 'Fixture User',
        topPersonalFolderId: '2213'
      }
    })
    expect(requests).toHaveLength(4)
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
      password: 'fixture-password'
    })).rejects.toMatchObject({ code: 'provider_contract_violation' })
    expect(fetch).toHaveBeenCalledTimes(1)
  })

  it('resolves personal and Team roots to stable folder GUID facts', async () => {
    const fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith('/flatsdk/api/services/User/GetTopPersonalFolderId')) {
        expect(JSON.parse(String(init?.body))).toEqual({ token: 'fixture-token-value' })
        return jsonResponse({ result: 0, msg: '', data: '1001' })
      }
      if (url.endsWith('/flatsdk/api/services/Team/GetMyTeamList')) {
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            pageNum: 1,
            pageSize: 20,
            totalCount: 1,
            teamList: [{
              teamId: 19,
              folderId: 2213,
              teamName: 'sciforge test',
              teamStatus: 1,
              teamOwner: 41,
              permission: 7,
              teamType: 0,
              isStick: false
            }],
            sortName: 'team_name',
            sortDesc: 'false'
          }
        })
      }
      if (url.endsWith('/flatsdk/api/services/DocList/GetFolderInfoById')) {
        const { folderId } = JSON.parse(String(init?.body)) as { folderId: number }
        return jsonResponse({
          result: 0,
          msg: '',
          data: {
            id: folderId,
            folderGuid: folderId === 1001 ? 'personal-folder-guid' : 'team-folder-guid',
            parentFolderId: 0,
            folderType: folderId === 1001 ? 1 : 2,
            teamId: folderId === 1001 ? 0 : 19,
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

    await expect(client.listRootFolders({
      token: 'fixture-token-value',
      teamPage: 1,
      teamPageSize: 20
    })).resolves.toEqual({
      roots: [{
        source: 'personal-root',
        folderGuid: 'personal-folder-guid',
        label: 'Personal library'
      }, {
        source: 'team-root',
        folderGuid: 'team-folder-guid',
        label: 'sciforge test'
      }],
      nextTeamPage: undefined
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
      pageSize: 20
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
      resourceGuid: 'child-file-guid'
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
      signal: new AbortController().signal
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
      signal: new AbortController().signal
    })).resolves.toEqual({ fileGuid: 'uploaded-file-guid' })
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

    await expect(client.downloadFile({
      token: 'fixture-token-value',
      fileGuid: 'download-file-guid',
      write: async (chunk) => { writes.push(Uint8Array.from(chunk)) },
      signal: new AbortController().signal
    })).resolves.toEqual({ bytesWritten: bytes.byteLength })
    expect(Buffer.concat(writes)).toEqual(Buffer.from(bytes))
  })
})

function emptyFolderChildren(
  folderGuid: string,
  folderId: number,
  pageNum: number,
  pageSize: number
) {
  return {
    result: 0,
    msg: '',
    data: {
      folderId,
      thisFolder: { id: folderId, folderGuid, permission: 7 },
      docListInfo: {
        foldersInfo: [],
        filesInfo: [],
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
