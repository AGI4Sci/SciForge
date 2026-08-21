import {
  constants,
  publicEncrypt,
  randomUUID
} from 'node:crypto'

import { z } from 'zod'

import {
  OpenContentConnectorError
} from '../contract.js'

const MAX_RESPONSE_BYTES = 1_000_000
const REQUEST_TIMEOUT_MS = 15_000
const TRANSFER_TIMEOUT_MS = 60_000
const UPLOAD_CHUNK_BYTES = 5 * 1024 * 1024
const MAX_UPLOAD_BYTES = 16 * 1024 * 1024
const MAX_DOWNLOAD_BYTES = 1024 * 1024 * 1024

const openContentExternalAccountSchema = z.object({
  id: z.string().trim().min(1).max(256),
  identityId: z.number().int().nonnegative().safe(),
  account: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(256),
  topPersonalFolderId: z.string().regex(/^\d+$/u)
}).strict().readonly()

const openContentAuthenticatedSessionSchema = z.object({
  token: z.string().trim().min(16).max(4096),
  account: openContentExternalAccountSchema
}).strict().readonly()

type OpenContentExternalAccount = z.infer<typeof openContentExternalAccountSchema>
type OpenContentAuthenticatedSession = z.infer<typeof openContentAuthenticatedSessionSchema>

const publicKeyResponseSchema = z.object({
  result: z.number().int(),
  message: z.string().max(1024).nullable(),
  data: z.object({
    PublicKey: z.string().min(64).max(32_768),
    Algorithm: z.string().trim().min(1).max(64),
    Padding: z.string().trim().min(1).max(64)
  }).strict(),
  totalCount: z.number().int().nonnegative().safe()
}).strict()

const loginResponseSchema = z.object({
  result: z.number().int(),
  msg: z.string().max(1024),
  data: z.string().trim().min(16).max(4096),
  clientId: z.string().max(4096).nullable()
}).strict()

const tokenValidityResponseSchema = envelopeSchema(z.boolean())

const externalAccountResponseSchema = envelopeSchema(z.object({
  id: z.string().trim().min(1).max(256),
  identityId: z.number().int().nonnegative().safe(),
  account: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(256),
  topPersonalFolderId: z.union([
    z.number().int().nonnegative().safe(),
    z.string().regex(/^\d+$/u)
  ])
}))

const personalRootResponseSchema = envelopeSchema(z.string().regex(/^\d+$/u))

const teamPageResponseSchema = envelopeSchema(z.object({
  pageNum: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(100),
  totalCount: z.number().int().nonnegative().safe(),
  teamList: z.array(z.object({
    teamId: z.number().int().nonnegative().safe(),
    folderId: z.number().int().nonnegative().safe(),
    teamName: z.string().trim().min(1).max(256),
    teamStatus: z.number().int(),
    teamOwner: z.number().int().nonnegative().safe(),
    permission: z.number().int(),
    teamType: z.number().int(),
    isStick: z.boolean()
  })).max(100),
  sortName: z.string().max(64),
  sortDesc: z.string().max(16)
}))

const folderInfoResponseSchema = envelopeSchema(z.object({
  id: z.number().int().nonnegative().safe(),
  folderGuid: z.string().trim().min(1).max(256),
  parentFolderId: z.number().int().nonnegative().safe(),
  folderType: z.number().int(),
  teamId: z.number().int().nonnegative().safe(),
  permission: z.number().int(),
  childFolderCount: z.number().int().nonnegative().safe(),
  childFileCount: z.number().int().nonnegative().safe()
}))

const folderChildSchema = z.object({
  id: z.number().int().nonnegative().safe(),
  folderGuid: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(512),
  parentFolderId: z.number().int().nonnegative().safe(),
  childFolderCount: z.number().int().nonnegative().safe(),
  childFileCount: z.number().int().nonnegative().safe(),
  permission: z.number().int()
})

const fileChildSchema = z.object({
  id: z.number().int().nonnegative().safe(),
  fileGuid: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(512),
  parentFolderId: z.number().int().nonnegative().safe(),
  size: z.number().int().nonnegative().safe(),
  permission: z.number().int()
})

const folderByGuidResponseSchema = envelopeSchema(z.object({
  id: z.number().int().nonnegative().safe(),
  folderGuid: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(512),
  permission: z.number().int()
}))

const fileDetailResponseSchema = envelopeSchema(z.object({
  fileId: z.number().int().nonnegative().safe(),
  fileGuid: z.string().trim().min(1).max(256),
  fileName: z.string().trim().min(1).max(512),
  fileSize: z.number().int().nonnegative().safe(),
  parentFolderId: z.number().int().nonnegative().safe(),
  permission: z.number().int()
}))

const folderChildrenResponseSchema = envelopeSchema(z.object({
  folderId: z.number().int().nonnegative().safe(),
  thisFolder: z.object({
    id: z.number().int().nonnegative().safe(),
    folderGuid: z.string().trim().min(1).max(256),
    permission: z.number().int()
  }),
  docListInfo: z.object({
    foldersInfo: z.array(folderChildSchema).max(100),
    filesInfo: z.array(fileChildSchema).max(100),
    settings: z.object({
      pageNum: z.number().int().min(1).max(100_000),
      pageSize: z.number().int().min(1).max(100),
      totalCount: z.number().int().nonnegative().safe(),
      fileCount: z.number().int().nonnegative().safe(),
      folderCount: z.number().int().nonnegative().safe()
    })
  })
}))

const mutationEnvelopeSchema = z.object({
  result: z.number().int(),
  data: z.unknown().optional()
})

const createdFolderDataSchema = z.object({
  id: z.number().int().nonnegative().safe(),
  name: z.string().trim().min(1).max(512)
})

const uploadCheckDataSchema = z.object({
  FileId: z.number().int().nonnegative().safe(),
  FileVerId: z.number().int().nonnegative().safe(),
  ParentFolderId: z.number().int().nonnegative().safe(),
  RegionHash: z.string().trim().min(1).max(16_384),
  RegionId: z.number().int().nonnegative().safe(),
  RegionType: z.number().int(),
  RegionUrl: z.string().max(2048)
})

const uploadChunkResponseSchema = z.object({
  uploadId: z.string().trim().min(1).max(256),
  filename: z.string().trim().min(1).max(512),
  status: z.enum(['Begin', 'Uploading', 'Error', 'End', 'Cancel']),
  message: z.string().max(2048).nullable(),
  percent: z.number().min(0).max(100),
  tag: z.union([z.boolean(), z.enum(['true', 'false'])])
})

const downloadCheckDataSchema = z.object({
  regionId: z.number().int().nonnegative().safe(),
  regionType: z.number().int(),
  regionHash: z.string().trim().min(1).max(16_384),
  regionUrl: z.string().max(2048)
})

export type OpenContentRootFolder = Readonly<{
  source: 'personal-root' | 'team-root'
  folderGuid: string
  label: string
}>

export type OpenContentClient = Readonly<{
  authenticateExistingAccount(input: Readonly<{
    username: string
    password: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<OpenContentAuthenticatedSession>
  isTokenValid(input: Readonly<{
    token: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<boolean>
  observeCurrentExternalAccount(input: Readonly<{
    token: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<OpenContentExternalAccount>
  listRootFolders(input: Readonly<{
    token: string
    teamPage: number
    teamPageSize: number
    includePersonal?: boolean
    includeTeams?: boolean
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<Readonly<{
    roots: readonly OpenContentRootFolder[]
    nextTeamPage?: number
  }>>
  listFolderEntries(input: Readonly<{
    token: string
    parentFolderGuid: string
    page: number
    pageSize: number
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<Readonly<{
    parentFolderGuid: string
    entries: readonly (
      | Readonly<{ kind: 'container'; folderGuid: string; label: string }>
      | Readonly<{ kind: 'file'; fileGuid: string; label: string; size: number }>
    )[]
    nextPage?: number
  }>>
  observeEntry(input: Readonly<{
    token: string
    kind: 'container' | 'file'
    resourceGuid: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<
    | Readonly<{ kind: 'container'; folderGuid: string; label: string }>
    | Readonly<{ kind: 'file'; fileGuid: string; label: string; size: number }>
  >
  createFolder(input: Readonly<{
    token: string
    parentFolderGuid: string
    name: string
    signal: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<Readonly<{ folderGuid: string }>>
  uploadNewFile(input: Readonly<{
    token: string
    parentFolderGuid: string
    name: string
    size: number
    read(range: Readonly<{ offset: number; length: number }>): Promise<Uint8Array>
    signal: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<Readonly<{ fileGuid: string }>>
  downloadFile(input: Readonly<{
    token: string
    fileGuid: string
    write(chunk: Uint8Array): Promise<void>
    signal: AbortSignal
    assertPrincipalCurrent(): void | Promise<void>
  }>): Promise<Readonly<{ bytesWritten: number }>>
}>

export function createOpenContentClient(options: Readonly<{
  baseUrl: string
  fetch?: typeof fetch
}>): OpenContentClient {
  const baseUrl = trustedBaseUrl(options.baseUrl)
  const fetchImplementation = options.fetch ?? globalThis.fetch

  const folderInfo = async (
    token: string,
    folderId: number,
    signal: AbortSignal | undefined,
    assertPrincipalCurrent: () => void | Promise<void>
  ) => {
    const response = await requestJson({
      baseUrl,
      fetchImplementation,
      path: '/flatsdk/api/services/DocList/GetFolderInfoById',
      method: 'POST',
      body: { token, folderId },
      signal,
      assertPrincipalCurrent
    })
    const envelope = parseProviderResponse(
      folderInfoResponseSchema,
      response,
      'provider_contract_violation'
    )
    requireBusinessSuccess(envelope.result, 'provider_unavailable')
    if (envelope.data.id !== folderId) throw connectorError('provider_contract_violation')
    return envelope.data
  }

  const folderByGuid = async (
    token: string,
    folderGuid: string,
    signal: AbortSignal | undefined,
    assertPrincipalCurrent: () => void | Promise<void>
  ) => {
    const response = await requestJson({
      baseUrl,
      fetchImplementation,
      path: '/flatsdk/api/services/DocList/GetFolderByGuidOrId',
      method: 'POST',
      body: { token, folderId: folderGuid },
      signal,
      assertPrincipalCurrent
    })
    const envelope = parseProviderResponse(
      folderByGuidResponseSchema,
      response,
      'provider_contract_violation'
    )
    requireBusinessSuccess(envelope.result, 'provider_unavailable')
    if (envelope.data.folderGuid !== folderGuid) {
      throw connectorError('provider_contract_violation')
    }
    return envelope.data
  }

  const fileByGuidOrId = async (
    token: string,
    fileGuidOrId: string,
    signal: AbortSignal | undefined,
    assertPrincipalCurrent: () => void | Promise<void>
  ) => {
    const response = await requestJson({
      baseUrl,
      fetchImplementation,
      path: '/flatsdk/api/services/DocList/GetFileByIdOrGuid',
      method: 'GET',
      query: { token, fileIdOrGuid: fileGuidOrId },
      signal,
      assertPrincipalCurrent
    })
    const envelope = parseProviderResponse(
      fileDetailResponseSchema,
      response,
      'provider_contract_violation'
    )
    requireBusinessSuccess(envelope.result, 'provider_unavailable')
    return Object.freeze({
      id: envelope.data.fileId,
      fileGuid: envelope.data.fileGuid,
      name: envelope.data.fileName,
      parentFolderId: envelope.data.parentFolderId,
      size: envelope.data.fileSize,
      permission: envelope.data.permission
    })
  }

  const observeCurrentExternalAccount: OpenContentClient['observeCurrentExternalAccount'] =
    async (rawInput) => {
      const input = parseClientInput(currentAccountRequestSchema, rawInput)
      const response = await requestJson({
        baseUrl,
        fetchImplementation,
        path: '/flatsdk/api/services/User/GetUserInfoByToken',
        method: 'POST',
        body: { token: input.token },
        signal: rawInput.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
      const envelope = parseProviderResponse(
        externalAccountResponseSchema,
        response,
        'provider_contract_violation'
      )
      requireBusinessSuccess(envelope.result, 'reauthentication_required')
      return Object.freeze({
        ...envelope.data,
        topPersonalFolderId: String(envelope.data.topPersonalFolderId)
      })
    }

  return Object.freeze({
    isTokenValid: async (input) => {
      const response = await requestJson({
        baseUrl,
        fetchImplementation,
        path: '/flatsdk/api/services/Auth/CheckUserTokenValidity',
        method: 'POST',
        query: { token: input.token },
        signal: input.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
      const envelope = parseProviderResponse(
        tokenValidityResponseSchema,
        response,
        'provider_contract_violation'
      )
      requireBusinessSuccess(envelope.result, 'reauthentication_required')
      return envelope.data
    },
    observeCurrentExternalAccount,
    authenticateExistingAccount: async (rawInput) => {
      const input = parseClientInput(enrollmentInputSchema, rawInput)
      const publicKeyResponse = await requestJson({
        baseUrl,
        fetchImplementation,
        path: '/inbiz/org/api/auth/GetLoginRsaPublicKey',
        method: 'GET',
        signal: rawInput.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
      const publicKeyEnvelope = parseProviderResponse(
        publicKeyResponseSchema,
        publicKeyResponse,
        'provider_contract_violation'
      )
      requireBusinessSuccess(publicKeyEnvelope.result, 'provider_unavailable')
      assertRsaOaepSha256(publicKeyEnvelope.data)

      const key = normalizePublicKey(publicKeyEnvelope.data.PublicKey)
      const loginResponse = await requestJson({
        baseUrl,
        fetchImplementation,
        path: '/flatsdk/api/services/Auth/UserLogin',
        method: 'POST',
        body: {
          userName: rsaOaepSha256(input.username, key),
          password: rsaOaepSha256(input.password, key),
          clientType: 4,
          secure: false,
          rsaSecure: true
        },
        signal: rawInput.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
      const loginEnvelope = parseProviderResponse(
        loginResponseSchema,
        loginResponse,
        'provider_contract_violation'
      )
      requireBusinessSuccess(loginEnvelope.result, 'unauthorized')
      const token = loginEnvelope.data

      const validityResponse = await requestJson({
        baseUrl,
        fetchImplementation,
        path: '/flatsdk/api/services/Auth/CheckUserTokenValidity',
        method: 'POST',
        query: { token },
        signal: rawInput.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
      const validityEnvelope = parseProviderResponse(
        tokenValidityResponseSchema,
        validityResponse,
        'provider_contract_violation'
      )
      requireBusinessSuccess(validityEnvelope.result, 'reauthentication_required')
      if (!validityEnvelope.data) throw connectorError('reauthentication_required')

      const account = await observeCurrentExternalAccount({
        token,
        signal: rawInput.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
      return Object.freeze(openContentAuthenticatedSessionSchema.parse({
        token,
        account
      }))
    },
    listRootFolders: async (rawInput) => {
      const input = parseClientInput(rootFolderRequestSchema, rawInput)
      const personalRootPromise = input.includePersonal
        ? requestJson({
            baseUrl,
            fetchImplementation,
            path: '/flatsdk/api/services/User/GetTopPersonalFolderId',
            method: 'POST',
            body: { token: input.token },
            signal: rawInput.signal,
            assertPrincipalCurrent: input.assertPrincipalCurrent
          }).then((response) => {
            const envelope = parseProviderResponse(
              personalRootResponseSchema,
              response,
              'provider_contract_violation'
            )
            requireBusinessSuccess(envelope.result, 'provider_unavailable')
            return Number(envelope.data)
          })
        : Promise.resolve<number | undefined>(undefined)
      const teamPagePromise = input.includeTeams ? requestJson({
        baseUrl,
        fetchImplementation,
        path: '/flatsdk/api/services/Team/GetMyTeamList',
        method: 'POST',
        body: {
          token: input.token,
          pageNum: input.teamPage,
          pageSize: input.teamPageSize,
          sortName: 'team_name',
          teamType: 0,
          desc: false,
          keyWord: ''
        },
        signal: rawInput.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      }).then((response) => {
        const envelope = parseProviderResponse(
          teamPageResponseSchema,
          response,
          'provider_contract_violation'
        )
        requireBusinessSuccess(envelope.result, 'provider_unavailable')
        if (
          envelope.data.pageNum !== input.teamPage ||
          envelope.data.pageSize !== input.teamPageSize
        ) {
          throw connectorError('provider_contract_violation')
        }
        return envelope.data
      }) : Promise.resolve(undefined)
      const [personalFolderId, teamPage] = await Promise.all([
        personalRootPromise,
        teamPagePromise
      ])
      const [personalFolder, teamFolders] = await Promise.all([
        personalFolderId === undefined
          ? Promise.resolve(undefined)
          : folderInfo(
              input.token,
              personalFolderId,
              rawInput.signal,
              input.assertPrincipalCurrent
            ),
        Promise.all((teamPage?.teamList ?? []).map(async (team) => ({
          team,
          folder: await folderInfo(
            input.token,
            team.folderId,
            rawInput.signal,
            input.assertPrincipalCurrent
          )
        })))
      ])
      const roots: OpenContentRootFolder[] = []
      if (personalFolder) {
        roots.push(Object.freeze({
          source: 'personal-root',
          folderGuid: personalFolder.folderGuid,
          label: 'Personal library'
        }))
      }
      for (const { team, folder } of teamFolders) {
        if (folder.teamId !== team.teamId) throw connectorError('provider_contract_violation')
        roots.push(Object.freeze({
          source: 'team-root',
          folderGuid: folder.folderGuid,
          label: team.teamName
        }))
      }
      const consumed = input.teamPage * input.teamPageSize
      return Object.freeze({
        roots: Object.freeze(roots),
        ...(teamPage && consumed < teamPage.totalCount
          ? { nextTeamPage: input.teamPage + 1 }
          : {})
      })
    },
    listFolderEntries: (rawInput) => listFolderEntriesRequest({
      baseUrl,
      fetchImplementation,
      rawInput
    }),
    observeEntry: async (rawInput) => {
      const input = parseClientInput(observeEntryRequestSchema, rawInput)
      const container = input.kind === 'container'
      const response = await requestJson({
        baseUrl,
        fetchImplementation,
        path: container
          ? '/flatsdk/api/services/DocList/GetFolderByGuidOrId'
          : '/flatsdk/api/services/DocList/GetFileByIdOrGuid',
        method: container ? 'POST' : 'GET',
        ...(container
          ? { body: { token: input.token, folderId: input.resourceGuid } }
          : { query: { token: input.token, fileIdOrGuid: input.resourceGuid } }),
        signal: rawInput.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
      if (container) {
        const envelope = parseProviderResponse(
          folderByGuidResponseSchema,
          response,
          'provider_contract_violation'
        )
        requireBusinessSuccess(envelope.result, 'provider_unavailable')
        if (envelope.data.folderGuid !== input.resourceGuid) {
          throw connectorError('provider_contract_violation')
        }
        return Object.freeze({
          kind: 'container' as const,
          folderGuid: envelope.data.folderGuid,
          label: envelope.data.name
        })
      }
      const envelope = parseProviderResponse(
        fileDetailResponseSchema,
        response,
        'provider_contract_violation'
      )
      requireBusinessSuccess(envelope.result, 'provider_unavailable')
      if (envelope.data.fileGuid !== input.resourceGuid) {
        throw connectorError('provider_contract_violation')
      }
      return Object.freeze({
        kind: 'file' as const,
        fileGuid: envelope.data.fileGuid,
        label: envelope.data.fileName,
        size: envelope.data.fileSize
      })
    },
    createFolder: async (rawInput) => {
      const input = parseClientInput(createFolderRequestSchema, rawInput)
      const parent = await folderByGuid(
        input.token,
        input.parentFolderGuid,
        input.signal,
        input.assertPrincipalCurrent
      )
      await assertNameAvailable({
        baseUrl,
        fetchImplementation,
        token: input.token,
        parentFolderGuid: input.parentFolderGuid,
        name: input.name,
        signal: input.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
      let rawResponse: unknown
      try {
        rawResponse = await requestJson({
          baseUrl,
          fetchImplementation,
          path: '/flatsdk/api/services/TemplateCreate/CreateFolder',
          method: 'POST',
          body: {
            token: input.token,
            name: input.name,
            remark: '',
            code: '',
            parentFolderId: String(parent.id)
          },
          signal: input.signal,
          assertPrincipalCurrent: input.assertPrincipalCurrent
        })
      } catch (error) {
        throw mutationTransportError(error)
      }
      let envelope: z.infer<typeof mutationEnvelopeSchema>
      try {
        envelope = parseProviderResponse(
          mutationEnvelopeSchema,
          rawResponse,
          'provider_contract_violation'
        )
      } catch {
        throw connectorError('outcome_unknown')
      }
      if (envelope.result === 7) throw connectorError('invalid_input')
      if (envelope.result === 806) throw connectorError('conflict')
      requireBusinessSuccess(envelope.result, 'provider_unavailable')
      let created: z.infer<typeof createdFolderDataSchema>
      try {
        created = parseProviderResponse(
          createdFolderDataSchema,
          envelope.data,
          'provider_contract_violation'
        )
      } catch {
        throw connectorError('outcome_unknown')
      }
      if (created.name !== input.name) throw connectorError('outcome_unknown')
      const observed = await folderInfo(
        input.token,
        created.id,
        input.signal,
        input.assertPrincipalCurrent
      )
        .catch(() => { throw connectorError('outcome_unknown') })
      if (observed.parentFolderId !== parent.id) throw connectorError('outcome_unknown')
      return Object.freeze({ folderGuid: observed.folderGuid })
    },
    uploadNewFile: async (rawInput) => {
      const input = parseClientInput(uploadFileRequestSchema, rawInput)
      const parent = await folderByGuid(
        input.token,
        input.parentFolderGuid,
        input.signal,
        input.assertPrincipalCurrent
      )
      await assertNameAvailable({
        baseUrl,
        fetchImplementation,
        token: input.token,
        parentFolderGuid: input.parentFolderGuid,
        name: input.name,
        signal: input.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
      let rawCheck: unknown
      try {
        rawCheck = await requestMultipartJson({
          baseUrl,
          fetchImplementation,
          path: '/flatsdk/api/services/Transport/Upload/CheckAndCreateDocInfo',
          fields: {
            token: input.token,
            folderId: String(parent.id),
            fileName: input.name,
            fileRemark: '',
            size: String(input.size),
            type: 'application/octet-stream',
            attachType: '0',
            code: '',
            masterFileId: '',
            strategy: 'majorUpgrade',
            lastModifiedDate: providerLocalTimestamp(new Date()),
            fileModel: 'UPLOAD'
          },
          signal: input.signal,
          assertPrincipalCurrent: input.assertPrincipalCurrent
        })
      } catch (error) {
        throw mutationTransportError(error)
      }
      let envelope: z.infer<typeof mutationEnvelopeSchema>
      try {
        envelope = parseProviderResponse(
          mutationEnvelopeSchema,
          rawCheck,
          'provider_contract_violation'
        )
      } catch {
        throw connectorError('outcome_unknown')
      }
      if (envelope.result === 806) throw connectorError('conflict')
      requireBusinessSuccess(envelope.result, 'provider_unavailable')
      let check: z.infer<typeof uploadCheckDataSchema>
      try {
        check = parseProviderResponse(
          uploadCheckDataSchema,
          envelope.data,
          'provider_contract_violation'
        )
      } catch {
        throw connectorError('outcome_unknown')
      }
      if (check.ParentFolderId !== parent.id) throw connectorError('outcome_unknown')
      let transferBaseUrl: URL
      try {
        transferBaseUrl = trustedTransferBase(baseUrl, check.RegionType, check.RegionUrl)
      } catch {
        throw connectorError('outcome_unknown')
      }
      const uploadId = randomUUID()
      const chunks = Math.max(1, Math.ceil(input.size / UPLOAD_CHUNK_BYTES))
      let offset = 0
      try {
        for (let chunk = 0; chunk < chunks; chunk += 1) {
          const length = Math.min(UPLOAD_CHUNK_BYTES, input.size - offset)
          const bytes = await input.read({ offset, length })
          if (!(bytes instanceof Uint8Array) || bytes.byteLength !== length) {
            throw connectorError('provider_contract_violation')
          }
          const response = await requestMultipartJson({
            baseUrl: transferBaseUrl,
            fetchImplementation,
            path: '/document/upload',
            query: { token: input.token, code: '' },
            fields: {
              uploadId,
              regionHash: check.RegionHash,
              regionId: String(check.RegionId),
              fileName: input.name,
              size: String(input.size),
              chunks: String(chunks),
              chunk: String(chunk),
              chunkSize: String(UPLOAD_CHUNK_BYTES),
              blockSize: String(bytes.byteLength)
            },
            file: { name: input.name, bytes },
            signal: input.signal,
            timeoutMs: TRANSFER_TIMEOUT_MS,
            assertPrincipalCurrent: input.assertPrincipalCurrent
          })
          const status = parseProviderResponse(
            uploadChunkResponseSchema,
            response,
            'provider_contract_violation'
          )
          const last = chunk === chunks - 1
          if (
            status.uploadId !== uploadId ||
            status.filename !== input.name ||
            status.status === 'Error' ||
            status.status === 'Cancel' ||
            (last && (status.status !== 'End' || status.percent !== 100))
          ) throw connectorError('outcome_unknown')
          offset += bytes.byteLength
        }
      } catch {
        throw connectorError('outcome_unknown')
      }
      if (offset !== input.size) throw connectorError('outcome_unknown')
      const file = await fileByGuidOrId(
        input.token,
        String(check.FileId),
        input.signal,
        input.assertPrincipalCurrent
      )
        .catch(() => { throw connectorError('outcome_unknown') })
      if (
        file.id !== check.FileId ||
        file.parentFolderId !== parent.id ||
        file.name !== input.name ||
        file.size !== input.size
      ) throw connectorError('outcome_unknown')
      return Object.freeze({ fileGuid: file.fileGuid })
    },
    downloadFile: async (rawInput) => {
      const input = parseClientInput(downloadFileRequestSchema, rawInput)
      const rawCheck = await requestJson({
        baseUrl,
        fetchImplementation,
        path: '/flatsdk/api/services/Transport/Download/DownloadCheck',
        method: 'POST',
        body: { token: input.token, fileGuid: input.fileGuid },
        signal: input.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
      const envelope = parseProviderResponse(
        mutationEnvelopeSchema,
        rawCheck,
        'provider_contract_violation'
      )
      requireBusinessSuccess(envelope.result, 'provider_unavailable')
      const check = parseProviderResponse(
        downloadCheckDataSchema,
        envelope.data,
        'provider_contract_violation'
      )
      const transferBaseUrl = trustedTransferBase(baseUrl, check.regionType, check.regionUrl)
      const response = await requestRaw({
        baseUrl: transferBaseUrl,
        fetchImplementation,
        path: '/downLoad/index',
        query: {
          token: input.token,
          fileGuid: input.fileGuid,
          regionHash: check.regionHash
        },
        signal: input.signal,
        timeoutMs: TRANSFER_TIMEOUT_MS,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      })
      const declaredLength = response.headers.get('content-length')
      if (declaredLength && Number(declaredLength) > MAX_DOWNLOAD_BYTES) {
        throw connectorError('bounds_exceeded')
      }
      if (!response.body) throw connectorError('provider_contract_violation')
      const reader = response.body.getReader()
      let bytesWritten = 0
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (!(value instanceof Uint8Array) || value.byteLength < 1) {
            throw connectorError('provider_contract_violation')
          }
          bytesWritten += value.byteLength
          if (bytesWritten > MAX_DOWNLOAD_BYTES) throw connectorError('bounds_exceeded')
          await input.write(value)
        }
      } finally {
        reader.releaseLock()
      }
      return Object.freeze({ bytesWritten })
    }
  })
}

const principalAssertionSchema = z.custom<() => void | Promise<void>>(
  (value) => typeof value === 'function'
)

const enrollmentInputSchema = z.object({
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(4096),
  signal: z.instanceof(AbortSignal).optional(),
  assertPrincipalCurrent: principalAssertionSchema
}).strict()

const currentAccountRequestSchema = z.object({
  token: z.string().trim().min(16).max(4096),
  signal: z.instanceof(AbortSignal).optional(),
  assertPrincipalCurrent: principalAssertionSchema
}).strict()

const rootFolderRequestSchema = z.object({
  token: z.string().trim().min(16).max(4096),
  teamPage: z.number().int().min(1).max(100_000),
  teamPageSize: z.number().int().min(1).max(100),
  includePersonal: z.boolean().optional().default(true),
  includeTeams: z.boolean().optional().default(true),
  signal: z.instanceof(AbortSignal).optional(),
  assertPrincipalCurrent: principalAssertionSchema
}).strict()

const folderGuidSchema = z.string().trim().min(1).max(256)
  .refine((value) => !/^\d+$/u.test(value), {
    message: 'A folder GUID cannot be a numeric namespace, folder ID, or Team ID.'
  })

const folderChildrenRequestSchema = z.object({
  token: z.string().trim().min(16).max(4096),
  parentFolderGuid: folderGuidSchema,
  page: z.number().int().min(1).max(100_000),
  pageSize: z.number().int().min(1).max(100),
  signal: z.instanceof(AbortSignal).optional(),
  assertPrincipalCurrent: principalAssertionSchema
}).strict()

const observeEntryRequestSchema = z.object({
  token: z.string().trim().min(16).max(4096),
  kind: z.enum(['container', 'file']),
  resourceGuid: z.string().trim().min(1).max(256),
  signal: z.instanceof(AbortSignal).optional(),
  assertPrincipalCurrent: principalAssertionSchema
}).strict()

const transferNameSchema = z.string().trim().min(1).max(240)
  .refine((name) => !/[\\/\0]/u.test(name) && name !== '.' && name !== '..')

const createFolderRequestSchema = z.object({
  token: z.string().trim().min(16).max(4096),
  parentFolderGuid: folderGuidSchema,
  name: transferNameSchema,
  signal: z.instanceof(AbortSignal),
  assertPrincipalCurrent: principalAssertionSchema
}).strict()

const uploadFileRequestSchema = z.object({
  token: z.string().trim().min(16).max(4096),
  parentFolderGuid: folderGuidSchema,
  name: transferNameSchema,
  size: z.number().int().nonnegative().max(MAX_UPLOAD_BYTES),
  read: z.custom<(range: Readonly<{ offset: number; length: number }>) => Promise<Uint8Array>>(
    (value) => typeof value === 'function'
  ),
  signal: z.instanceof(AbortSignal),
  assertPrincipalCurrent: principalAssertionSchema
}).strict()

const downloadFileRequestSchema = z.object({
  token: z.string().trim().min(16).max(4096),
  fileGuid: z.string().trim().min(1).max(256),
  write: z.custom<(chunk: Uint8Array) => Promise<void>>(
    (value) => typeof value === 'function'
  ),
  signal: z.instanceof(AbortSignal),
  assertPrincipalCurrent: principalAssertionSchema
}).strict()

function folderChildrenArgsXml(page: number, pageSize: number): string {
  return encodeURIComponent(
    `<GetListArgs><PageNum>${page}</PageNum><PageSize>${pageSize}</PageSize>` +
    '<SortInfoName>basic:name</SortInfoName><SortDesc>false</SortDesc></GetListArgs>'
  )
}

async function listFolderEntriesRequest(input: Readonly<{
  baseUrl: URL
  fetchImplementation: typeof fetch
  rawInput: Readonly<{
    token: string
    parentFolderGuid: string
    page: number
    pageSize: number
    signal?: AbortSignal
    assertPrincipalCurrent: () => void | Promise<void>
  }>
}>): Promise<Awaited<ReturnType<OpenContentClient['listFolderEntries']>>> {
  const parsed = parseClientInput(folderChildrenRequestSchema, input.rawInput)
  const response = await requestJson({
    baseUrl: input.baseUrl,
    fetchImplementation: input.fetchImplementation,
    path: '/flatsdk/api/services/DocList/GetFolderChildren',
    method: 'POST',
    body: {
      token: parsed.token,
      code: '',
      fid: parsed.parentFolderGuid,
      argsXml: folderChildrenArgsXml(parsed.page, parsed.pageSize),
      noCalcPerm: false,
      collectCode: ''
    },
    signal: input.rawInput.signal,
    assertPrincipalCurrent: input.rawInput.assertPrincipalCurrent
  })
  const envelope = parseProviderResponse(
    folderChildrenResponseSchema,
    response,
    'provider_contract_violation'
  )
  requireBusinessSuccess(envelope.result, 'provider_unavailable')
  if (
    envelope.data.thisFolder.folderGuid !== parsed.parentFolderGuid ||
    envelope.data.thisFolder.id !== envelope.data.folderId ||
    envelope.data.docListInfo.settings.pageNum !== parsed.page ||
    envelope.data.docListInfo.settings.pageSize !== parsed.pageSize ||
    envelope.data.docListInfo.foldersInfo.some(
      (folder) => folder.parentFolderId !== envelope.data.folderId
    ) ||
    envelope.data.docListInfo.filesInfo.some(
      (file) => file.parentFolderId !== envelope.data.folderId
    )
  ) throw connectorError('provider_contract_violation')
  const entries = [
    ...envelope.data.docListInfo.foldersInfo.map((folder) => Object.freeze({
      kind: 'container' as const,
      folderGuid: folder.folderGuid,
      label: folder.name
    })),
    ...envelope.data.docListInfo.filesInfo.map((file) => Object.freeze({
      kind: 'file' as const,
      fileGuid: file.fileGuid,
      label: file.name,
      size: file.size
    }))
  ]
  if (entries.length > parsed.pageSize) throw connectorError('provider_contract_violation')
  return Object.freeze({
    parentFolderGuid: parsed.parentFolderGuid,
    entries: Object.freeze(entries),
    ...(parsed.page * parsed.pageSize < envelope.data.docListInfo.settings.totalCount
      ? { nextPage: parsed.page + 1 }
      : {})
  })
}

async function assertNameAvailable(input: Readonly<{
  baseUrl: URL
  fetchImplementation: typeof fetch
  token: string
  parentFolderGuid: string
  name: string
  signal: AbortSignal
  assertPrincipalCurrent(): void | Promise<void>
}>): Promise<void> {
  let page = 1
  for (; page <= 100; page += 1) {
    const result = await listFolderEntriesRequest({
      baseUrl: input.baseUrl,
      fetchImplementation: input.fetchImplementation,
      rawInput: {
        token: input.token,
        parentFolderGuid: input.parentFolderGuid,
        page,
        pageSize: 100,
        signal: input.signal,
        assertPrincipalCurrent: input.assertPrincipalCurrent
      }
    })
    if (result.entries.some((entry) => entry.label === input.name)) {
      throw connectorError('conflict')
    }
    if (!result.nextPage) return
    if (result.nextPage !== page + 1) throw connectorError('provider_contract_violation')
  }
  throw connectorError('provider_unavailable')
}

function providerLocalTimestamp(date: Date): string {
  return new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date)
}

function trustedTransferBase(mainBaseUrl: URL, regionType: number, regionUrl: string): URL {
  if (regionType === 1 && regionUrl === '') return mainBaseUrl
  if (regionType !== 2) throw connectorError('provider_contract_violation')
  const candidate = new URL(regionUrl)
  if (
    candidate.protocol !== 'https:' ||
    candidate.origin !== mainBaseUrl.origin ||
    candidate.username ||
    candidate.password ||
    candidate.search ||
    candidate.hash
  ) throw connectorError('provider_contract_violation')
  return new URL('/', candidate)
}

function mutationTransportError(error: unknown): OpenContentConnectorError {
  if (error instanceof OpenContentConnectorError && error.code === 'unauthorized') return error
  return connectorError('outcome_unknown')
}

function envelopeSchema<Data extends z.ZodType>(data: Data) {
  return z.object({
    result: z.number().int(),
    msg: z.string().max(1024),
    data: z.unknown()
  }).strict().transform((envelope, context): Readonly<{
    result: number
    msg: string
    data: z.output<Data>
  }> => {
    if (envelope.result !== 0) {
      return { ...envelope, data: undefined as z.output<Data> }
    }
    const parsed = data.safeParse(envelope.data)
    if (!parsed.success) {
      context.addIssue({
        code: 'custom',
        path: ['data'],
        message: 'OpenContent success data does not match its verified contract.'
      })
      return z.NEVER
    }
    return { ...envelope, data: parsed.data }
  })
}

async function requestJson(input: Readonly<{
  baseUrl: URL
  fetchImplementation: typeof fetch
  path: string
  method: 'GET' | 'POST'
  query?: Readonly<Record<string, string>>
  body?: unknown
  signal?: AbortSignal
  assertPrincipalCurrent: () => void | Promise<void>
}>): Promise<unknown> {
  const response = await requestRaw({
    ...input,
    headers: input.body === undefined ? undefined : { 'content-type': 'application/json' },
    body: input.body === undefined ? undefined : JSON.stringify(input.body)
  })
  return parseJsonBody(response)
}

async function requestMultipartJson(input: Readonly<{
  baseUrl: URL
  fetchImplementation: typeof fetch
  path: string
  query?: Readonly<Record<string, string>>
  fields: Readonly<Record<string, string>>
  file?: Readonly<{ name: string; bytes: Uint8Array }>
  signal?: AbortSignal
  timeoutMs?: number
  assertPrincipalCurrent: () => void | Promise<void>
}>): Promise<unknown> {
  const form = new FormData()
  for (const [name, value] of Object.entries(input.fields)) form.append(name, value)
  if (input.file) {
    form.append(
      'file',
      new Blob([Uint8Array.from(input.file.bytes)], { type: 'application/octet-stream' }),
      input.file.name
    )
  }
  const response = await requestRaw({
    baseUrl: input.baseUrl,
    fetchImplementation: input.fetchImplementation,
    path: input.path,
    method: 'POST',
    query: input.query,
    body: form,
    signal: input.signal,
    timeoutMs: input.timeoutMs,
    assertPrincipalCurrent: input.assertPrincipalCurrent
  })
  return parseJsonBody(response)
}

async function requestRaw(input: Readonly<{
  baseUrl: URL
  fetchImplementation: typeof fetch
  path: string
  method?: 'GET' | 'POST'
  query?: Readonly<Record<string, string>>
  headers?: Readonly<Record<string, string>>
  body?: BodyInit
  signal?: AbortSignal
  timeoutMs?: number
  assertPrincipalCurrent: () => void | Promise<void>
}>): Promise<Response> {
  const url = new URL(input.path, input.baseUrl)
  for (const [name, value] of Object.entries(input.query ?? {})) url.searchParams.set(name, value)
  const timeout = AbortSignal.timeout(input.timeoutMs ?? REQUEST_TIMEOUT_MS)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  try {
    await input.assertPrincipalCurrent()
  } catch {
    throw connectorError('unauthorized')
  }
  let response: Response
  try {
    response = await input.fetchImplementation(url, {
      method: input.method ?? 'GET',
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal,
      ...(input.headers ? { headers: input.headers } : {}),
      ...(input.body === undefined ? {} : { body: input.body })
    })
  } catch {
    if (input.signal?.aborted) throw connectorError('cancelled')
    throw connectorError('provider_unavailable')
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw connectorError('unauthorized')
    if (response.status === 429) throw connectorError('rate_limited')
    throw connectorError('provider_unavailable')
  }
  return response
}

async function parseJsonBody(response: Response): Promise<unknown> {
  const text = await readBoundedResponseText(response)
  try {
    return JSON.parse(text)
  } catch {
    throw connectorError('provider_contract_violation')
  }
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null) {
    const validLength = /^\d+$/u.test(declaredLength)
      ? Number(declaredLength)
      : Number.NaN
    if (!Number.isSafeInteger(validLength) || validLength > MAX_RESPONSE_BYTES) {
      await response.body?.cancel().catch(() => undefined)
      throw connectorError('provider_contract_violation')
    }
  }
  if (!response.body) return ''

  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let totalBytes = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      totalBytes += value.byteLength
      if (totalBytes > MAX_RESPONSE_BYTES) {
        await reader.cancel().catch(() => undefined)
        throw connectorError('provider_contract_violation')
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof OpenContentConnectorError) throw error
    throw connectorError('provider_unavailable')
  } finally {
    reader.releaseLock()
  }

  const bytes = new Uint8Array(totalBytes)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw connectorError('provider_contract_violation')
  }
}

function parseProviderResponse<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown,
  errorCode: 'provider_contract_violation'
): z.output<Schema> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw connectorError(errorCode)
  return parsed.data
}

function parseClientInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown
): z.output<Schema> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw connectorError('invalid_input')
  return parsed.data
}

function trustedBaseUrl(value: string): URL {
  const parsed = new URL(value)
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash ||
    parsed.pathname !== '/'
  ) {
    throw connectorError('invalid_input')
  }
  return parsed
}

function assertRsaOaepSha256(input: Readonly<{
  Algorithm: string
  Padding: string
}>): void {
  if (
    input.Algorithm.toUpperCase() !== 'RSA' ||
    !/^OAEP(?:-|_)SHA(?:-|_)?256$/iu.test(input.Padding)
  ) {
    throw connectorError('provider_contract_violation')
  }
}

function normalizePublicKey(value: string): string {
  if (value.includes('-----BEGIN PUBLIC KEY-----')) return value
  const compact = value.replace(/\s+/gu, '')
  if (!/^[A-Za-z0-9+/]+={0,2}$/u.test(compact)) {
    throw connectorError('provider_contract_violation')
  }
  const lines = compact.match(/.{1,64}/gu) ?? []
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----`
}

function rsaOaepSha256(value: string, publicKey: string): string {
  try {
    return publicEncrypt({
      key: publicKey,
      padding: constants.RSA_PKCS1_OAEP_PADDING,
      oaepHash: 'sha256'
    }, Buffer.from(value, 'utf8')).toString('base64')
  } catch {
    throw connectorError('provider_contract_violation')
  }
}

function requireBusinessSuccess(
  result: number,
  failureCode: 'unauthorized' | 'reauthentication_required' | 'provider_unavailable'
): void {
  if (result !== 0) throw connectorError(failureCode)
}

function connectorError(
  code: ConstructorParameters<typeof OpenContentConnectorError>[0]
): OpenContentConnectorError {
  const messages = {
    invalid_input: 'OpenContent input or trusted endpoint policy is invalid.',
    unauthorized: 'OpenContent rejected the account or current permission.',
    reauthentication_required: 'The OpenContent connection must be authenticated again.',
    provider_unavailable: 'OpenContent is unavailable for this operation.',
    rate_limited: 'OpenContent rate-limited this operation.',
    provider_contract_violation: 'OpenContent returned an unsupported response contract.',
    conflict: 'An OpenContent entry with this name already exists.',
    outcome_unknown: 'The OpenContent write outcome cannot be proven.',
    bounds_exceeded: 'The OpenContent transfer exceeds the configured bounds.',
    cancelled: 'The OpenContent operation was cancelled.'
  } as const
  return new OpenContentConnectorError(code, messages[code])
}
