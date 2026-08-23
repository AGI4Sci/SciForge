import { z } from 'zod'

import {
  OpenContentConnectorError
} from '../contract.js'
import { assertOpenContentPrincipalCurrent } from './connection-service.js'
import { readOpenContentFolderInfo } from './folder-info-reader.js'
import {
  OPENCONTENT_PROVIDER_REQUEST_TIMEOUT_MS,
  requestOpenContentProviderJson
} from './provider-json-transport.js'
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
  identityId: openContentIdentityIdSchema,
  userType: openContentTeamUserTypeSchema,
  displayName: z.string().trim().min(1).max(256).optional()
}).strict()

const providerTeamUserPageSchema = z.object({
  pageNum: z.number().int().min(1).max(100_000).optional(),
  pageSize: z.number().int().min(1).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX).optional(),
  totalCount: z.number().int().nonnegative().safe().optional(),
  teamUser: z.array(providerTeamUserSchema).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX)
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
    resolveTeamRoot: (input) => invoke(() => administration.resolveTeamRoot({ ...input, token }))
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
    options.requestTimeoutMs ?? OPENCONTENT_PROVIDER_REQUEST_TIMEOUT_MS
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
      const filterMismatch = (
        input.teamType === 1 && teams.some((team) => !team.isStuck)
      ) || (
        (input.teamType === 2 || input.teamType === 3) &&
        teams.some((team) => team.teamType !== input.teamType)
      )
      if (filterMismatch) {
        throw connectorError('provider_contract_violation')
      }
      assertExactPageCount(page.pageNum, page.pageSize, page.totalCount, teams.length)
      const consumed = (page.pageNum - 1) * page.pageSize + teams.length
      return openContentTeamPageSchema.parse({
        pageNumber: page.pageNum,
        pageSize: page.pageSize,
        totalCount: page.totalCount,
        teams,
        ...(consumed < page.totalCount
          ? { nextPage: page.pageNum + 1 }
          : {})
      })
    },
    createTeam: async (rawInput: z.input<typeof createTeamInputSchema>): Promise<void> => {
      const input = parseInput(createTeamInputSchema, rawInput)
      await executeMutation({
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
      const users = page.teamUser.map(normalizeTeamUser)
      const suppliedTotalCount = page.totalCount
      if (suppliedTotalCount === undefined && (
        pageNumber !== 1 || users.length >= pageSize
      )) {
        throw connectorError('provider_contract_violation')
      }
      const totalCount = suppliedTotalCount ?? users.length
      if (suppliedTotalCount !== undefined) {
        assertExactPageCount(pageNumber, pageSize, totalCount, users.length)
      }
      const consumed = (pageNumber - 1) * pageSize + users.length
      return openContentTeamUserPageSchema.parse({
        pageNumber,
        pageSize,
        totalCount,
        users,
        ...(consumed < totalCount ? { nextPage: pageNumber + 1 } : {})
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
      const receipt = await readOpenContentFolderInfo({
        token: input.token,
        folderId: input.folderId,
        signal: input.signal,
        request: ({ path, body, signal }) => requestOpenContentProviderJson({
          baseUrl,
          fetchImplementation,
          path,
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
          signal,
          timeoutMs: requestTimeoutMs,
          errorFactory: connectorError
        })
      })
      requireBusinessSuccess(receipt.result)
      const folder = receipt.folder
      if (!folder) throw connectorError('provider_contract_violation')
      if (folder.id !== input.folderId || folder.teamId !== input.teamId) {
        throw connectorError('provider_contract_violation')
      }
      return openContentTeamRootSchema.parse({
        teamId: input.teamId,
        folderId: folder.id,
        folderGuid: folder.folderGuid
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
  return openContentTeamUserSchema.parse({
    identityId: user.identityId,
    userType: user.userType,
    ...(user.displayName === undefined ? {} : { displayName: user.displayName })
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
    envelope = await readEnvelope({ ...input, http409IsConflict: true })
  } catch (error) {
    if (error instanceof OpenContentConnectorError && (
      error.code === 'unauthorized' ||
      error.code === 'rate_limited' ||
      error.code === 'conflict'
    )) throw error
    throw connectorError('outcome_unknown')
  }
  if (envelope.result !== 0) throw connectorError('outcome_unknown')
}

async function readEnvelope(input: Readonly<{
  baseUrl: URL
  fetchImplementation: typeof fetch
  requestTimeoutMs: number
  path: string
  body: unknown
  signal?: AbortSignal
  http409IsConflict?: boolean
}>): Promise<z.infer<typeof providerEnvelopeSchema>> {
  const response = await requestOpenContentProviderJson({
    baseUrl: input.baseUrl,
    fetchImplementation: input.fetchImplementation,
    path: input.path,
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(input.body),
    signal: input.signal,
    timeoutMs: input.requestTimeoutMs,
    http409IsConflict: input.http409IsConflict,
    errorFactory: connectorError
  })
  return parseProvider(providerEnvelopeSchema, response)
}

function requireBusinessSuccess(result: number): void {
  if (result !== 0) throw connectorError('unauthorized')
}

function assertExactPageCount(
  pageNumber: number,
  pageSize: number,
  totalCount: number,
  returnedCount: number
): void {
  const offset = (pageNumber - 1) * pageSize
  const expectedCount = Math.min(pageSize, Math.max(totalCount - offset, 0))
  if (returnedCount !== expectedCount) throw connectorError('provider_contract_violation')
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
