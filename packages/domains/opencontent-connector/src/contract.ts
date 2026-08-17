import { z } from 'zod'
import type { PrincipalSnapshot } from '@sciforge/domain-sdk/principal'

export const OPENCONTENT_PROVIDER_KIND = 'opencontent' as const
export const OPENCONTENT_DEMO_INSTANCE_REF = 'opencontent-edoc2-demo' as const
export const OPENCONTENT_CONTENT_SPACE_SERVICE_ID = 'opencontent.content-space' as const
export const OPENCONTENT_CONTENT_SPACE_SERVICE_VERSION = '1.0.0' as const

export const OPENCONTENT_CONNECTION_CAPABILITY_IDS = Object.freeze({
  status: 'opencontent.connection.status',
  bind: 'opencontent.connection.bind',
  unbind: 'opencontent.connection.unbind'
} as const)

export const openContentEmptyInputSchema = z.object({}).strict().readonly()

export const openContentBindInputSchema = z.object({
  username: z.string().trim().min(1).max(256),
  password: z.string().min(1).max(1024)
}).strict().readonly()

export const openContentUnbindOutputSchema = z.object({
  state: z.literal('disconnected'),
  remoteRevocation: z.literal('unsupported')
}).strict().readonly()

export const openContentExternalAccountSchema = z.object({
  id: z.string().trim().min(1).max(256),
  identityId: z.number().int().nonnegative().safe(),
  account: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(256),
  topPersonalFolderId: z.string().regex(/^\d+$/u)
}).strict().readonly()

export const openContentAuthenticatedSessionSchema = z.object({
  token: z.string().trim().min(16).max(4096),
  account: openContentExternalAccountSchema
}).strict().readonly()

export type OpenContentExternalAccount = z.infer<typeof openContentExternalAccountSchema>
export type OpenContentAuthenticatedSession = z.infer<
  typeof openContentAuthenticatedSessionSchema
>

const openContentExternalAccountSummarySchema = z.object({
  id: z.string().trim().min(1).max(256),
  identityId: z.number().int().nonnegative().safe(),
  account: z.string().trim().min(1).max(256),
  name: z.string().trim().min(1).max(256)
}).strict().readonly()

export const openContentConnectionStatusSchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('disconnected') }).strict().readonly(),
  z.object({
    state: z.enum(['connected', 'reauthentication_required']),
    providerInstanceRef: z.string().trim().min(3).max(256),
    externalAccount: openContentExternalAccountSummarySchema
  }).strict().readonly()
])

export type OpenContentConnectionStatus = z.infer<typeof openContentConnectionStatusSchema>

export type OpenContentContentSpaceFacade = Readonly<{
  listRootFolders(input: Readonly<{
    principal: PrincipalSnapshot
    teamPage: number
    teamPageSize: number
    includePersonal?: boolean
    includeTeams?: boolean
    signal?: AbortSignal
    assertPrincipalCurrent(): void
  }>): Promise<Readonly<{
    roots: readonly Readonly<{
      source: 'personal-root' | 'team-root'
      folderGuid: string
      label: string
    }>[]
    nextTeamPage?: number
  }>>
  listFolderEntries(input: Readonly<{
    principal: PrincipalSnapshot
    parentFolderGuid: string
    page: number
    pageSize: number
    signal?: AbortSignal
    assertPrincipalCurrent(): void
  }>): Promise<Readonly<{
    parentFolderGuid: string
    entries: readonly (
      | Readonly<{ kind: 'container'; folderGuid: string; label: string }>
      | Readonly<{ kind: 'file'; fileGuid: string; label: string; size: number }>
    )[]
    nextPage?: number
  }>>
  observeEntry(input: Readonly<{
    principal: PrincipalSnapshot
    kind: 'container' | 'file'
    resourceGuid: string
    signal?: AbortSignal
    assertPrincipalCurrent(): void
  }>): Promise<
    | Readonly<{ kind: 'container'; folderGuid: string; label: string }>
    | Readonly<{ kind: 'file'; fileGuid: string; label: string; size: number }>
  >
  createFolder(input: Readonly<{
    principal: PrincipalSnapshot
    parentFolderGuid: string
    name: string
    signal: AbortSignal
    assertPrincipalCurrent(): void
  }>): Promise<Readonly<{ folderGuid: string }>>
  uploadNewFile(input: Readonly<{
    principal: PrincipalSnapshot
    parentFolderGuid: string
    name: string
    size: number
    read(range: Readonly<{ offset: number; length: number }>): Promise<Uint8Array>
    signal: AbortSignal
    assertPrincipalCurrent(): void
  }>): Promise<Readonly<{ fileGuid: string }>>
  downloadFile(input: Readonly<{
    principal: PrincipalSnapshot
    fileGuid: string
    write(chunk: Uint8Array): Promise<void>
    signal: AbortSignal
    assertPrincipalCurrent(): void
  }>): Promise<Readonly<{ bytesWritten: number }>>
}>

export type OpenContentConnectorErrorCode =
  | 'invalid_input'
  | 'unauthorized'
  | 'reauthentication_required'
  | 'provider_unavailable'
  | 'rate_limited'
  | 'provider_contract_violation'
  | 'conflict'
  | 'outcome_unknown'
  | 'bounds_exceeded'
  | 'cancelled'

export class OpenContentConnectorError extends Error {
  readonly code: OpenContentConnectorErrorCode

  constructor(code: OpenContentConnectorErrorCode, message: string, options?: ErrorOptions) {
    super(message.slice(0, 256), options)
    this.name = 'OpenContentConnectorError'
    this.code = code
  }
}
