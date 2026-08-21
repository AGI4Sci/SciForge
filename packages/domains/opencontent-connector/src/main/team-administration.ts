import { z } from 'zod'

import {
  OpenContentConnectorError
} from '../contract.js'
import { assertOpenContentPrincipalCurrent } from './connection-service.js'
import {
  OPENCONTENT_INTERNAL_TEAM_USER_TYPE,
  OPENCONTENT_TEAM_MUTATION_SIZE_MAX,
  OPENCONTENT_TEAM_PAGE_SIZE_MAX,
  openContentFolderIdSchema,
  openContentIdentityIdSchema,
  openContentTeamIdSchema,
  openContentTeamPageSchema,
  openContentTeamRootSchema,
  openContentTeamSchema,
  openContentTeamUserPageSchema,
  openContentTeamUserSchema,
  openContentTeamUserTypeSchema,
  type OpenContentBoundTeamAdministration
} from '../team-administration-contract.js'

type OpenContentRequest = Readonly<{
  token: string
}>

type AddOpenContentCredential<Operation> = Operation extends (
  input: infer Input
) => infer Result
  ? (input: Input & OpenContentRequest) => Result
  : never

export type OpenContentTeamAdministration = Readonly<{
  [Operation in keyof OpenContentBoundTeamAdministration]: AddOpenContentCredential<
    OpenContentBoundTeamAdministration[Operation]
  >
}>

const MAX_RESPONSE_BYTES = 1_000_000
const REQUEST_TIMEOUT_MS = 15_000

const requestTokenSchema = z.string().trim().min(16).max(4096)
const teamNameSchema = z.string().trim().min(1).max(256)

const listTeamsInputSchema = z.object({
  token: requestTokenSchema,
  pageNumber: z.number().int().min(1).max(100_000),
  pageSize: z.number().int().min(1).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX),
  teamType: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  keyword: z.string().trim().min(1).max(256).optional(),
  signal: z.instanceof(AbortSignal).optional()
}).strict()

const createTeamInputSchema = z.object({
  token: requestTokenSchema,
  name: teamNameSchema,
  icon: z.string().max(512_000).optional(),
  remark: z.string().max(2048).optional(),
  signal: z.instanceof(AbortSignal).optional()
}).strict()

const observeTeamInputSchema = z.object({
  token: requestTokenSchema,
  teamId: openContentTeamIdSchema,
  signal: z.instanceof(AbortSignal).optional()
}).strict()

const editTeamInputSchema = z.object({
  token: requestTokenSchema,
  teamId: openContentTeamIdSchema,
  folderId: openContentFolderIdSchema,
  name: teamNameSchema,
  icon: z.string().max(512_000).optional(),
  remark: z.string().max(2048).optional(),
  signal: z.instanceof(AbortSignal).optional()
}).strict()

const listTeamUsersInputSchema = z.object({
  token: requestTokenSchema,
  teamId: openContentTeamIdSchema,
  pageNumber: z.number().int().min(1).max(100_000),
  pageSize: z.number().int().min(1).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX),
  signal: z.instanceof(AbortSignal).optional()
}).strict()

const teamUserMutationInputSchema = z.object({
  token: requestTokenSchema,
  teamId: openContentTeamIdSchema,
  identityIds: z.array(openContentIdentityIdSchema).min(1)
    .max(OPENCONTENT_TEAM_MUTATION_SIZE_MAX)
    .refine((ids) => new Set(ids).size === ids.length),
  signal: z.instanceof(AbortSignal).optional()
}).strict()

const resolveTeamRootInputSchema = z.object({
  token: requestTokenSchema,
  teamId: openContentTeamIdSchema,
  folderId: openContentFolderIdSchema,
  signal: z.instanceof(AbortSignal).optional()
}).strict()

const setTeamUserRoleInputSchema = z.object({
  token: requestTokenSchema,
  teamId: openContentTeamIdSchema,
  identityIds: z.array(openContentIdentityIdSchema).min(1)
    .max(OPENCONTENT_TEAM_MUTATION_SIZE_MAX)
    .refine((ids) => new Set(ids).size === ids.length),
  userType: z.union([z.literal(2), z.literal(3), z.literal(4)]),
  signal: z.instanceof(AbortSignal).optional()
}).strict()

const transferTeamOwnerInputSchema = z.object({
  token: requestTokenSchema,
  teamId: openContentTeamIdSchema,
  ownerIdentityId: openContentIdentityIdSchema,
  signal: z.instanceof(AbortSignal).optional()
}).strict()

const providerEnvelopeSchema = z.object({
  result: z.number().int(),
  msg: z.string().max(2048).nullable().optional(),
  data: z.unknown().optional()
}).passthrough()

const providerTeamSchema = z.object({
  teamId: openContentTeamIdSchema,
  folderId: openContentFolderIdSchema,
  teamName: z.string().trim().min(1).max(256),
  teamStatus: z.number().int(),
  teamOwner: openContentIdentityIdSchema,
  permission: z.number().int(),
  teamType: z.number().int(),
  isStick: z.boolean()
}).passthrough()

const providerTeamPageSchema = z.object({
  pageNum: z.number().int().min(1).max(100_000),
  pageSize: z.number().int().min(1).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX),
  totalCount: z.number().int().nonnegative().safe(),
  teamList: z.array(providerTeamSchema).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX),
  sortName: z.string().max(64).optional(),
  sortDesc: z.union([z.string().max(16), z.boolean()]).optional()
}).passthrough()

const providerTeamUserSchema = z.object({
  identityId: openContentIdentityIdSchema.optional(),
  userIdentityId: openContentIdentityIdSchema.optional(),
  userId: openContentIdentityIdSchema.optional(),
  userType: openContentTeamUserTypeSchema,
  displayName: z.string().trim().min(1).max(256).optional(),
  name: z.string().trim().min(1).max(256).optional(),
  userName: z.string().trim().min(1).max(256).optional(),
  account: z.string().trim().min(1).max(256).optional()
}).passthrough().refine((user) => (
  user.identityId !== undefined ||
  user.userIdentityId !== undefined ||
  user.userId !== undefined
))

const providerTeamUserPageSchema = z.object({
  pageNum: z.number().int().min(1).max(100_000).optional(),
  pageSize: z.number().int().min(1).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX).optional(),
  totalCount: z.number().int().nonnegative().safe().optional(),
  total: z.number().int().nonnegative().safe().optional(),
  list: z.array(providerTeamUserSchema).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX).optional(),
  datas: z.array(providerTeamUserSchema).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX).optional(),
  items: z.array(providerTeamUserSchema).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX).optional(),
  teamUserList: z.array(providerTeamUserSchema).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX).optional()
}).passthrough().refine((page) => (
  page.list !== undefined ||
  page.datas !== undefined ||
  page.items !== undefined ||
  page.teamUserList !== undefined
))

const providerFolderInfoSchema = z.object({
  id: openContentFolderIdSchema,
  folderGuid: z.string().trim().min(1).max(256),
  teamId: openContentTeamIdSchema
}).passthrough()

export function bindOpenContentTeamAdministration(
  administration: OpenContentTeamAdministration,
  rawToken: string,
  assertPrincipalCurrent: () => void | Promise<void>
): OpenContentBoundTeamAdministration {
  const token = parseInput(requestTokenSchema, rawToken)
  const invoke = async <Value>(operation: () => Value | Promise<Value>): Promise<Value> => {
    await assertOpenContentPrincipalCurrent(assertPrincipalCurrent)
    return operation()
  }
  return Object.freeze({
    listTeams: (input) => invoke(() => administration.listTeams({ ...input, token })),
    createTeam: (input) => invoke(() => administration.createTeam({ ...input, token })),
    observeTeam: (input) => invoke(() => administration.observeTeam({ ...input, token })),
    editTeam: (input) => invoke(() => administration.editTeam({ ...input, token })),
    stickTeam: (input) => invoke(() => administration.stickTeam({ ...input, token })),
    unstickTeam: (input) => invoke(() => administration.unstickTeam({ ...input, token })),
    listTeamUsers: (input) => invoke(() => administration.listTeamUsers({ ...input, token })),
    addTeamUsers: (input) => invoke(() => administration.addTeamUsers({ ...input, token })),
    removeTeamUsers: (input) => invoke(() => administration.removeTeamUsers({ ...input, token })),
    resolveTeamRoot: (input) => invoke(() => administration.resolveTeamRoot({ ...input, token })),
    setTeamUserRole: (input) => invoke(() => administration.setTeamUserRole({ ...input, token })),
    transferTeamOwner: (input) => invoke(() => administration.transferTeamOwner({ ...input, token }))
  })
}

export function createOpenContentTeamAdministration(options: Readonly<{
  baseUrl: string
  fetch?: typeof fetch
  requestTimeoutMs?: number
}>): OpenContentTeamAdministration {
  const baseUrl = trustedBaseUrl(options.baseUrl)
  const fetchImplementation = options.fetch ?? globalThis.fetch
  const requestTimeoutMs = parseInput(
    z.number().int().min(1).max(120_000),
    options.requestTimeoutMs ?? REQUEST_TIMEOUT_MS
  )

  const administration: OpenContentTeamAdministration = {
    listTeams: async (rawInput: z.input<typeof listTeamsInputSchema>) => {
      const input = parseInput(listTeamsInputSchema, rawInput)
      const envelope = await readEnvelope({
        baseUrl,
        fetchImplementation,
        requestTimeoutMs,
        path: '/flatsdk/api/services/Team/GetMyTeamList',
        body: {
          token: input.token,
          pageNum: input.pageNumber,
          pageSize: input.pageSize,
          sortName: 'team_name',
          teamType: input.teamType ?? 0,
          desc: false,
          ...(input.keyword === undefined ? {} : { keyWord: input.keyword })
        },
        signal: input.signal
      })
      requireBusinessSuccess(envelope.result)
      const page = parseProvider(providerTeamPageSchema, envelope.data)
      if (page.pageNum !== input.pageNumber || page.pageSize !== input.pageSize) {
        throw connectorError('provider_contract_violation')
      }
      const teams = page.teamList.map(normalizeTeam)
      return openContentTeamPageSchema.parse({
        pageNumber: page.pageNum,
        pageSize: page.pageSize,
        totalCount: page.totalCount,
        teams,
        ...(page.pageNum * page.pageSize < page.totalCount
          ? { nextPage: page.pageNum + 1 }
          : {})
      })
    },
    createTeam: async (rawInput: z.input<typeof createTeamInputSchema>): Promise<void> => {
      const input = parseInput(createTeamInputSchema, rawInput)
      if (input.signal?.aborted) throw connectorError('cancelled')
      let envelope: z.infer<typeof providerEnvelopeSchema>
      try {
        envelope = await readEnvelope({
          baseUrl,
          fetchImplementation,
          requestTimeoutMs,
          path: '/flatsdk/api/services/Team/CreateTeam',
          body: {
            token: input.token,
            teamName: input.name,
            ...(input.icon === undefined ? {} : { teamIcon: input.icon }),
            ...(input.remark === undefined ? {} : { teamRemark: input.remark })
          },
          signal: input.signal
        })
      } catch (error) {
        if (error instanceof OpenContentConnectorError && (
          error.code === 'unauthorized' ||
          error.code === 'rate_limited' ||
          error.code === 'conflict' ||
          error.code === 'cancelled'
        )) throw error
        throw connectorError('outcome_unknown')
      }
      if (envelope.result === 806) throw connectorError('conflict')
      requireBusinessSuccess(envelope.result)
    },
    observeTeam: async (rawInput) => {
      const input = parseInput(observeTeamInputSchema, rawInput)
      const envelope = await readEnvelope({
        baseUrl,
        fetchImplementation,
        requestTimeoutMs,
        path: '/flatsdk/api/services/Team/GetTeamById',
        body: { token: input.token, teamId: input.teamId },
        signal: input.signal
      })
      requireBusinessSuccess(envelope.result)
      const team = normalizeTeam(parseProvider(providerTeamSchema, envelope.data))
      if (team.teamId !== input.teamId) throw connectorError('provider_contract_violation')
      return team
    },
    editTeam: async (rawInput) => {
      const input = parseInput(editTeamInputSchema, rawInput)
      await executeMutation({
        baseUrl,
        fetchImplementation,
        requestTimeoutMs,
        path: '/flatsdk/api/services/Team/EditTeamInfo',
        body: {
          token: input.token,
          teamId: input.teamId,
          folderId: input.folderId,
          teamName: input.name,
          ...(input.icon === undefined ? {} : { teamIcon: input.icon }),
          ...(input.remark === undefined ? {} : { teamRemark: input.remark })
        },
        signal: input.signal
      })
    },
    stickTeam: async (rawInput) => {
      const input = parseInput(observeTeamInputSchema, rawInput)
      await executeMutation({
        baseUrl,
        fetchImplementation,
        requestTimeoutMs,
        path: '/flatsdk/api/services/Team/StickTeam',
        body: { token: input.token, teamId: input.teamId },
        signal: input.signal
      })
    },
    unstickTeam: async (rawInput) => {
      const input = parseInput(observeTeamInputSchema, rawInput)
      await executeMutation({
        baseUrl,
        fetchImplementation,
        requestTimeoutMs,
        path: '/flatsdk/api/services/Team/UnStickTeam',
        body: { token: input.token, teamId: input.teamId },
        signal: input.signal
      })
    },
    listTeamUsers: async (rawInput) => {
      const input = parseInput(listTeamUsersInputSchema, rawInput)
      const envelope = await readEnvelope({
        baseUrl,
        fetchImplementation,
        requestTimeoutMs,
        path: '/flatsdk/api/services/Team/GetTeamUserByTeamIdPaging',
        body: {
          token: input.token,
          pageNum: input.pageNumber,
          pageSize: input.pageSize,
          teamId: input.teamId
        },
        signal: input.signal
      })
      requireBusinessSuccess(envelope.result)
      const page = parseProvider(providerTeamUserPageSchema, envelope.data)
      const pageNumber = page.pageNum ?? input.pageNumber
      const pageSize = page.pageSize ?? input.pageSize
      if (pageNumber !== input.pageNumber || pageSize !== input.pageSize) {
        throw connectorError('provider_contract_violation')
      }
      const rawUsers = page.list ?? page.datas ?? page.items ?? page.teamUserList ?? []
      const users = rawUsers.map(normalizeTeamUser)
      const totalCount = page.totalCount ?? page.total ?? users.length
      return openContentTeamUserPageSchema.parse({
        pageNumber,
        pageSize,
        totalCount,
        users,
        ...(pageNumber * pageSize < totalCount ? { nextPage: pageNumber + 1 } : {})
      })
    },
    addTeamUsers: async (rawInput) => {
      const input = parseInput(teamUserMutationInputSchema, rawInput)
      await executeMutation({
        baseUrl,
        fetchImplementation,
        requestTimeoutMs,
        path: '/flatsdk/api/services/Team/SaveTeamUserList',
        body: {
          token: input.token,
          teamId: input.teamId,
          addUserInfo: input.identityIds.map((identityId) => ({
            userId: identityId,
            userType: OPENCONTENT_INTERNAL_TEAM_USER_TYPE
          })),
          updateUserInfo: [],
          deleteUserInfo: []
        },
        signal: input.signal
      })
    },
    removeTeamUsers: async (rawInput) => {
      const input = parseInput(teamUserMutationInputSchema, rawInput)
      await executeMutation({
        baseUrl,
        fetchImplementation,
        requestTimeoutMs,
        path: '/flatsdk/api/services/Team/SaveTeamUserList',
        body: {
          token: input.token,
          teamId: input.teamId,
          addUserInfo: [],
          updateUserInfo: [],
          deleteUserInfo: input.identityIds
        },
        signal: input.signal
      })
    },
    resolveTeamRoot: async (rawInput) => {
      const input = parseInput(resolveTeamRootInputSchema, rawInput)
      const envelope = await readEnvelope({
        baseUrl,
        fetchImplementation,
        requestTimeoutMs,
        path: '/flatsdk/api/services/DocList/GetFolderInfoById',
        body: { token: input.token, folderId: input.folderId },
        signal: input.signal
      })
      requireBusinessSuccess(envelope.result)
      const folder = parseProvider(providerFolderInfoSchema, envelope.data)
      if (folder.id !== input.folderId || folder.teamId !== input.teamId) {
        throw connectorError('provider_contract_violation')
      }
      return openContentTeamRootSchema.parse({
        teamId: input.teamId,
        folderId: folder.id,
        folderGuid: folder.folderGuid
      })
    },
    setTeamUserRole: async (rawInput) => {
      const input = parseInput(setTeamUserRoleInputSchema, rawInput)
      await executeMutation({
        baseUrl,
        fetchImplementation,
        requestTimeoutMs,
        path: '/flatsdk/api/services/Team/SetTeamUserRole',
        body: {
          token: input.token,
          teamId: input.teamId,
          userIds: input.identityIds,
          userType: input.userType
        },
        signal: input.signal
      })
    },
    transferTeamOwner: async (rawInput) => {
      const input = parseInput(transferTeamOwnerInputSchema, rawInput)
      await executeMutation({
        baseUrl,
        fetchImplementation,
        requestTimeoutMs,
        path: '/flatsdk/api/services/Team/EditTeamOwner',
        body: {
          token: input.token,
          teamId: input.teamId,
          userId: input.ownerIdentityId
        },
        signal: input.signal
      })
    }
  }
  return Object.freeze(administration)
}

function normalizeTeam(team: z.infer<typeof providerTeamSchema>) {
  return openContentTeamSchema.parse({
    teamId: team.teamId,
    folderId: team.folderId,
    name: team.teamName,
    ownerIdentityId: team.teamOwner,
    status: team.teamStatus,
    permission: team.permission,
    teamType: team.teamType,
    isStuck: team.isStick
  })
}

function normalizeTeamUser(user: z.infer<typeof providerTeamUserSchema>) {
  const identityId = user.identityId ?? user.userIdentityId ?? user.userId
  if (identityId === undefined) throw connectorError('provider_contract_violation')
  return openContentTeamUserSchema.parse({
    identityId,
    userType: user.userType,
    ...(user.displayName ?? user.name ?? user.userName
      ? { displayName: user.displayName ?? user.name ?? user.userName }
      : {}),
    ...(user.account === undefined ? {} : { account: user.account })
  })
}

async function executeMutation(input: Readonly<{
  baseUrl: URL
  fetchImplementation: typeof fetch
  requestTimeoutMs: number
  path: string
  body: unknown
  signal?: AbortSignal
}>): Promise<void> {
  if (input.signal?.aborted) throw connectorError('cancelled')
  let envelope: z.infer<typeof providerEnvelopeSchema>
  try {
    envelope = await readEnvelope(input)
  } catch (error) {
    if (error instanceof OpenContentConnectorError && (
      error.code === 'unauthorized' ||
      error.code === 'rate_limited' ||
      error.code === 'conflict' ||
      error.code === 'cancelled'
    )) throw error
    throw connectorError('outcome_unknown')
  }
  if (envelope.result === 806) throw connectorError('conflict')
  requireBusinessSuccess(envelope.result)
}

async function readEnvelope(input: Readonly<{
  baseUrl: URL
  fetchImplementation: typeof fetch
  requestTimeoutMs: number
  path: string
  body: unknown
  signal?: AbortSignal
}>): Promise<z.infer<typeof providerEnvelopeSchema>> {
  const response = await requestJson(input)
  return parseProvider(providerEnvelopeSchema, response)
}

async function requestJson(input: Readonly<{
  baseUrl: URL
  fetchImplementation: typeof fetch
  requestTimeoutMs: number
  path: string
  body: unknown
  signal?: AbortSignal
}>): Promise<unknown> {
  const timeout = AbortSignal.timeout(input.requestTimeoutMs)
  const signal = input.signal ? AbortSignal.any([input.signal, timeout]) : timeout
  let response: Response
  try {
    response = await input.fetchImplementation(new URL(input.path, input.baseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(input.body),
      redirect: 'error',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
      signal
    })
  } catch {
    if (input.signal?.aborted) throw connectorError('cancelled')
    throw connectorError('provider_unavailable')
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw connectorError('unauthorized')
    }
    if (response.status === 429) throw connectorError('rate_limited')
    if (response.status === 409) throw connectorError('conflict')
    throw connectorError('provider_unavailable')
  }
  const declaredLength = response.headers.get('content-length')
  if (declaredLength !== null && (
    !/^\d+$/u.test(declaredLength) || Number(declaredLength) > MAX_RESPONSE_BYTES
  )) {
    await response.body?.cancel().catch(() => undefined)
    throw connectorError('provider_contract_violation')
  }
  let text: string
  try {
    text = await response.text()
  } catch {
    if (input.signal?.aborted) throw connectorError('cancelled')
    throw connectorError('provider_unavailable')
  }
  if (new TextEncoder().encode(text).byteLength > MAX_RESPONSE_BYTES) {
    throw connectorError('provider_contract_violation')
  }
  try {
    return JSON.parse(text)
  } catch {
    throw connectorError('provider_contract_violation')
  }
}

function requireBusinessSuccess(result: number): void {
  if (result !== 0) throw connectorError('unauthorized')
}

function parseProvider<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown
): z.output<Schema> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw connectorError('provider_contract_violation')
  return parsed.data
}

function parseInput<Schema extends z.ZodType>(
  schema: Schema,
  value: unknown
): z.output<Schema> {
  const parsed = schema.safeParse(value)
  if (!parsed.success) throw connectorError('invalid_input')
  return parsed.data
}

function trustedBaseUrl(value: string): URL {
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw connectorError('invalid_input')
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== '/' ||
    parsed.search ||
    parsed.hash
  ) throw connectorError('invalid_input')
  return parsed
}

function connectorError(
  code: ConstructorParameters<typeof OpenContentConnectorError>[0]
): OpenContentConnectorError {
  const messages = {
    invalid_input: 'OpenContent Team administration input is invalid.',
    unauthorized: 'OpenContent rejected the Team administration permission.',
    reauthentication_required: 'The OpenContent connection must be authenticated again.',
    provider_unavailable: 'OpenContent Team administration is unavailable.',
    rate_limited: 'OpenContent rate-limited Team administration.',
    provider_contract_violation: 'OpenContent returned an unsupported Team response.',
    conflict: 'An OpenContent Team with this name already exists.',
    outcome_unknown: 'The OpenContent Team write outcome cannot be proven.',
    bounds_exceeded: 'The OpenContent Team operation exceeded a configured bound.',
    cancelled: 'The OpenContent Team operation was cancelled.'
  } as const
  return new OpenContentConnectorError(code, messages[code])
}
