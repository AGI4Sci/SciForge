import { z } from 'zod'

export const OPENCONTENT_TEAM_PAGE_SIZE_MAX = 100 as const
export const OPENCONTENT_TEAM_MUTATION_SIZE_MAX = 100 as const
export const OPENCONTENT_INTERNAL_TEAM_USER_TYPE = 3 as const

export const openContentTeamIdSchema = z.number().int().positive().safe()
  .brand<'OpenContentTeamId'>()
export const openContentFolderIdSchema = z.number().int().positive().safe()
  .brand<'OpenContentFolderId'>()
export const openContentIdentityIdSchema = z.number().int().positive().safe()
  .brand<'OpenContentIdentityId'>()

export type OpenContentTeamId = z.infer<typeof openContentTeamIdSchema>
export type OpenContentFolderId = z.infer<typeof openContentFolderIdSchema>
export type OpenContentIdentityId = z.infer<typeof openContentIdentityIdSchema>

export const openContentTeamPageRequestSchema = z.object({
  pageNumber: z.number().int().min(1).max(100_000),
  pageSize: z.number().int().min(1).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX)
}).strict().readonly()

export const openContentTeamSchema = z.object({
  teamId: openContentTeamIdSchema,
  folderId: openContentFolderIdSchema,
  name: z.string().trim().min(1).max(256),
  ownerIdentityId: openContentIdentityIdSchema,
  status: z.number().int(),
  permission: z.number().int(),
  teamType: z.number().int(),
  isStuck: z.boolean()
}).strict().readonly()

export type OpenContentTeam = z.infer<typeof openContentTeamSchema>

export const openContentTeamPageSchema = z.object({
  pageNumber: z.number().int().min(1).max(100_000),
  pageSize: z.number().int().min(1).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX),
  totalCount: z.number().int().nonnegative().safe(),
  teams: z.array(openContentTeamSchema).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX).readonly(),
  nextPage: z.number().int().min(2).max(100_000).optional()
}).strict().readonly()

export type OpenContentTeamPage = z.infer<typeof openContentTeamPageSchema>

export const openContentTeamUserTypeSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4)
])

export type OpenContentTeamUserType = z.infer<typeof openContentTeamUserTypeSchema>

export const openContentTeamUserSchema = z.object({
  identityId: openContentIdentityIdSchema,
  userType: openContentTeamUserTypeSchema,
  displayName: z.string().trim().min(1).max(256).optional(),
  account: z.string().trim().min(1).max(256).optional()
}).strict().readonly()

export type OpenContentTeamUser = z.infer<typeof openContentTeamUserSchema>

export const openContentTeamUserPageSchema = z.object({
  pageNumber: z.number().int().min(1).max(100_000),
  pageSize: z.number().int().min(1).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX),
  totalCount: z.number().int().nonnegative().safe(),
  users: z.array(openContentTeamUserSchema).max(OPENCONTENT_TEAM_PAGE_SIZE_MAX).readonly(),
  nextPage: z.number().int().min(2).max(100_000).optional()
}).strict().readonly()

export type OpenContentTeamUserPage = z.infer<typeof openContentTeamUserPageSchema>

export const openContentTeamUserMutationSchema = z.object({
  teamId: openContentTeamIdSchema,
  identityIds: z.array(openContentIdentityIdSchema)
    .min(1)
    .max(OPENCONTENT_TEAM_MUTATION_SIZE_MAX)
    .refine((identityIds) => new Set(identityIds).size === identityIds.length)
    .readonly()
}).strict().readonly()

export const openContentTeamRootSchema = z.object({
  teamId: openContentTeamIdSchema,
  folderId: openContentFolderIdSchema,
  folderGuid: z.string().trim().min(1).max(256)
}).strict().readonly()

export type OpenContentTeamRoot = z.infer<typeof openContentTeamRootSchema>

type OpenContentRequest = Readonly<{
  token: string
  signal?: AbortSignal
}>

export type OpenContentTeamAdministration = Readonly<{
  listTeams(input: OpenContentRequest & Readonly<{
    pageNumber: number
    pageSize: number
    teamType?: 0 | 1 | 2 | 3
    keyword?: string
  }>): Promise<OpenContentTeamPage>
  createTeam(input: OpenContentRequest & Readonly<{
    name: string
    icon?: string
    remark?: string
  }>): Promise<void>
  observeTeam(input: OpenContentRequest & Readonly<{
    teamId: OpenContentTeamId
  }>): Promise<OpenContentTeam>
  editTeam(input: OpenContentRequest & Readonly<{
    teamId: OpenContentTeamId
    folderId: OpenContentFolderId
    name: string
    icon?: string
    remark?: string
  }>): Promise<void>
  stickTeam(input: OpenContentRequest & Readonly<{
    teamId: OpenContentTeamId
  }>): Promise<void>
  unstickTeam(input: OpenContentRequest & Readonly<{
    teamId: OpenContentTeamId
  }>): Promise<void>
  listTeamUsers(input: OpenContentRequest & Readonly<{
    teamId: OpenContentTeamId
    pageNumber: number
    pageSize: number
  }>): Promise<OpenContentTeamUserPage>
  addTeamUsers(input: OpenContentRequest & z.output<typeof openContentTeamUserMutationSchema>): Promise<void>
  removeTeamUsers(input: OpenContentRequest & z.output<typeof openContentTeamUserMutationSchema>): Promise<void>
  resolveTeamRoot(input: OpenContentRequest & Readonly<{
    teamId: OpenContentTeamId
    folderId: OpenContentFolderId
  }>): Promise<OpenContentTeamRoot>
  setTeamUserRole(input: OpenContentRequest & Readonly<{
    teamId: OpenContentTeamId
    identityIds: readonly OpenContentIdentityId[]
    userType: 2 | 3 | 4
  }>): Promise<void>
  transferTeamOwner(input: OpenContentRequest & Readonly<{
    teamId: OpenContentTeamId
    ownerIdentityId: OpenContentIdentityId
  }>): Promise<void>
}>

type BindOpenContentTeamOperation<Operation> = Operation extends (
  input: infer Input
) => infer Result
  ? (input: Omit<Input, 'token'>) => Result
  : never

export type OpenContentBoundTeamAdministration = Readonly<{
  [Operation in keyof OpenContentTeamAdministration]: BindOpenContentTeamOperation<
  OpenContentTeamAdministration[Operation]
  >
}>
