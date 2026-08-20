import { z } from 'zod'

import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS,
  contentSpaceExtendedErrorCodeSchema,
  type ContentSpaceExtendedErrorCode,
  type ContentSpaceExtendedOperationKey
} from '@sciforge/domain-content-space/extended-operations-contract'

import {
  admitOpenContentSkillRuntimeOwner,
  type OpenContentSkillRuntimeOwner
} from './contract.js'

/**
 * Attachment-owned commands which this adapter may ask the private runner to
 * execute.  Raw methods, URLs, argv, environment variables, and paths are not
 * part of this contract.
 */
export const OPENCONTENT_EXTENDED_OPERATION_COMMANDS = Object.freeze([
  'file-search',
  'file-rag-scope',
  'file-info',
  'file-internal-link',
  'folder-info',
  'recent-files',
  'meta-types',
  'meta-attrs',
  'meta-modeldata',
  'meta-info',
  'meta-edit',
  'rename',
  'copy',
  'move',
  'delete',
  'create-shortcut',
  'file-edit',
  'folder-edit',
  'sec-level-list',
  'upload',
  'download',
  'attach-list',
  'attach-remove',
  'relation-list',
  'relation-create',
  'relation-remove',
  'file-tag-list',
  'file-tag-set',
  'file-tag-delete',
  'publish',
  'my-publish-list',
  'cancel-publish',
  'create-share',
  'my-share-list',
  'cancel-share',
  'albums',
  'album-files',
  'favorite-add',
  'favorite-remove',
  'user-info',
  'search-user',
  'search-department',
  'search-position',
  'search-user-group',
  'perm-cates',
  'perm-list',
  'perm-set',
  'collab-list',
  'collab-search',
  'collab-link',
  'kbox-list',
  'file-list'
] as const)

export const openContentExtendedOperationCommandSchema = z.enum(
  OPENCONTENT_EXTENDED_OPERATION_COMMANDS
)
export type OpenContentExtendedOperationCommand = z.infer<
  typeof openContentExtendedOperationCommandSchema
>

const invocationIdSchema = z.string()
  .trim()
  .min(16)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]+$/u)

const commandArgsSchema = z.record(z.string(), z.json())
const safeTransferNameSchema = z.string().trim().min(1).max(256)
  .refine((value) => value !== '.' && value !== '..' && !/[\\/]/u.test(value) &&
    [...value].every((character) => {
      const code = character.codePointAt(0) ?? 0
      return code > 31 && code !== 127
    }))
const transferReadSchema = z.custom<OpenContentExtendedUploadSource['read']>(
  (value) => typeof value === 'function',
  'A managed upload source requires a read function.'
)
const transferWriteSchema = z.custom<OpenContentExtendedDownloadDestination['write']>(
  (value) => typeof value === 'function',
  'A managed download destination requires a write function.'
)

export const openContentExtendedDataFileSchema = z.discriminatedUnion('role', [
  z.object({
    role: z.literal('source'),
    encoding: z.literal('managed-stream'),
    name: safeTransferNameSchema,
    size: z.number().int().nonnegative().max(1_073_741_824),
    read: transferReadSchema
  }).strict().readonly(),
  z.object({
    role: z.literal('destination'),
    encoding: z.literal('managed-stream'),
    name: safeTransferNameSchema,
    write: transferWriteSchema
  }).strict().readonly()
])
export type OpenContentExtendedDataFile = z.infer<typeof openContentExtendedDataFileSchema>

/** Ordinary attachment commands currently accept no caller supplied files. */
export const openContentExtendedCommandInvocationSchema = z.object({
  invocationId: invocationIdSchema,
  command: openContentExtendedOperationCommandSchema,
  args: commandArgsSchema,
  dataFiles: z.array(openContentExtendedDataFileSchema).max(1).readonly()
}).strict().superRefine((invocation, issue) => {
  const roles = invocation.dataFiles.map((file) => file.role)
  const needsSource = invocation.command === 'upload'
  const needsDestination = invocation.command === 'download'
  const expected = needsSource ? ['source'] : needsDestination ? ['destination'] : []
  if (roles.length !== expected.length || roles.some((role, index) => role !== expected[index])) {
    issue.addIssue({
      code: 'custom',
      path: ['dataFiles'],
      message: `${invocation.command} requires data-file roles: ${expected.join(', ') || '(none)'}.`
    })
  }
}).readonly()

export type OpenContentExtendedCommandInvocation = z.infer<
  typeof openContentExtendedCommandInvocationSchema
>

export const OPENCONTENT_CLI_RESULT_PROTOCOL = 'opencontent-cli-result:v1' as const

/** The success receipt shared with the private CLI runner. */
export const openContentExtendedCommandSuccessSchema = z.object({
  protocol: z.literal(OPENCONTENT_CLI_RESULT_PROTOCOL),
  invocationId: invocationIdSchema,
  command: openContentExtendedOperationCommandSchema,
  attemptCount: z.literal(1),
  outcome: z.literal('succeeded'),
  json: z.json(),
  structuredDeliveryItems: z.array(z.json()).max(8).readonly(),
  managedDataFiles: z.array(z.json()).max(8).readonly()
}).strict().readonly()

export type OpenContentExtendedCommandSuccess = z.infer<
  typeof openContentExtendedCommandSuccessSchema
>

export interface OpenContentExtendedCommandTransport {
  invoke(invocation: OpenContentExtendedCommandInvocation): Promise<unknown>
}

export interface OpenContentTeamGovernancePort {
  updateMemberRole(input: Readonly<{
    invocationId: string
    teamRootId: string
    memberPrincipalId: string
    userType: 2 | 3 | 4
  }>): Promise<Readonly<{ applied: true }>>
  transferOwnership(input: Readonly<{
    invocationId: string
    teamRootId: string
    newOwnerPrincipalId: string
  }>): Promise<Readonly<{ applied: true }>>
}

type MappingRoute = 'cli' | 'team-administration'

export type OpenContentExtendedOperationMapping = Readonly<{
  operation: ContentSpaceExtendedOperationKey
  route: MappingRoute
  commands: readonly OpenContentExtendedOperationCommand[]
  mutationCommands: readonly OpenContentExtendedOperationCommand[]
}>

function cliMapping(
  operation: ContentSpaceExtendedOperationKey,
  commands: readonly OpenContentExtendedOperationCommand[],
  mutationCommands: OpenContentExtendedOperationCommand | readonly OpenContentExtendedOperationCommand[] = []
): OpenContentExtendedOperationMapping {
  return Object.freeze({
    operation,
    route: 'cli',
    commands,
    mutationCommands: Object.freeze(Array.isArray(mutationCommands)
      ? [...mutationCommands]
      : [mutationCommands])
  })
}

function teamMapping(
  operation: ContentSpaceExtendedOperationKey
): OpenContentExtendedOperationMapping {
  return Object.freeze({
    operation,
    route: 'team-administration',
    commands: [],
    mutationCommands: []
  })
}

/**
 * Exhaustive public-operation to private-command map. Some mappings are
 * bounded compositions; at most one of the enumerated mutation alternatives
 * may execute in a composition.
 */
export const OPENCONTENT_EXTENDED_OPERATION_MAPPINGS = Object.freeze({
  searchEntries: cliMapping('searchEntries', ['file-search', 'file-info', 'folder-info']),
  listRecentEntries: cliMapping('listRecentEntries', ['recent-files', 'file-info']),
  getEntryInfo: cliMapping('getEntryInfo', ['file-info', 'folder-info']),
  resolveInternalLink: cliMapping('resolveInternalLink', ['file-internal-link']),
  buildFileScope: cliMapping('buildFileScope', ['file-rag-scope']),
  listMetadataTypes: cliMapping('listMetadataTypes', ['meta-types']),
  listMetadataFields: cliMapping('listMetadataFields', ['meta-attrs']),
  listMetadataChoices: cliMapping('listMetadataChoices', ['meta-attrs', 'meta-modeldata']),
  readEntryMetadata: cliMapping('readEntryMetadata', ['meta-info']),
  editEntryMetadata: cliMapping('editEntryMetadata', ['meta-attrs', 'meta-edit'], 'meta-edit'),
  renameEntry: cliMapping('renameEntry', ['rename'], 'rename'),
  copyEntries: cliMapping('copyEntries', ['copy'], 'copy'),
  moveEntries: cliMapping('moveEntries', ['move'], 'move'),
  deleteEntries: cliMapping('deleteEntries', ['delete'], 'delete'),
  createShortcut: cliMapping('createShortcut', ['create-shortcut'], 'create-shortcut'),
  updateEntryProperties: cliMapping(
    'updateEntryProperties',
    ['file-edit', 'folder-edit'],
    ['file-edit', 'folder-edit']
  ),
  listSecurityLevels: cliMapping('listSecurityLevels', ['sec-level-list']),
  updateFileVersion: cliMapping('updateFileVersion', []),
  exportFileAsPdf: cliMapping('exportFileAsPdf', ['download'], 'download'),
  listAttachments: cliMapping('listAttachments', ['attach-list']),
  addAttachment: cliMapping('addAttachment', ['upload'], 'upload'),
  removeAttachment: cliMapping('removeAttachment', ['attach-remove'], 'attach-remove'),
  listRelations: cliMapping('listRelations', ['relation-list']),
  createRelation: cliMapping('createRelation', ['relation-create'], 'relation-create'),
  removeRelation: cliMapping('removeRelation', ['relation-remove'], 'relation-remove'),
  listTags: cliMapping('listTags', ['file-tag-list']),
  setTags: cliMapping('setTags', ['file-tag-set'], 'file-tag-set'),
  removeTags: cliMapping('removeTags', ['file-tag-delete'], 'file-tag-delete'),
  createPublication: cliMapping('createPublication', ['publish'], 'publish'),
  listPublications: cliMapping('listPublications', ['my-publish-list']),
  cancelPublication: cliMapping('cancelPublication', ['cancel-publish'], 'cancel-publish'),
  createShare: cliMapping('createShare', ['create-share'], 'create-share'),
  listShares: cliMapping('listShares', ['my-share-list']),
  cancelShare: cliMapping('cancelShare', ['cancel-share'], 'cancel-share'),
  listAlbums: cliMapping('listAlbums', ['albums']),
  listAlbumEntries: cliMapping('listAlbumEntries', ['album-files', 'file-info', 'folder-info']),
  addFavorite: cliMapping('addFavorite', ['favorite-add'], 'favorite-add'),
  removeFavorite: cliMapping('removeFavorite', ['album-files', 'favorite-remove'], 'favorite-remove'),
  getCurrentPrincipal: cliMapping('getCurrentPrincipal', ['user-info']),
  searchUsers: cliMapping('searchUsers', ['search-user']),
  searchDepartments: cliMapping('searchDepartments', ['search-department']),
  searchPositions: cliMapping('searchPositions', ['search-position']),
  searchGroups: cliMapping('searchGroups', ['search-user-group']),
  listPermissionCategories: cliMapping('listPermissionCategories', ['perm-cates']),
  listPermissions: cliMapping('listPermissions', ['perm-list']),
  changePermissions: cliMapping('changePermissions', ['perm-set'], 'perm-set'),
  listCollaborationEntries: cliMapping('listCollaborationEntries', ['collab-list']),
  searchCollaborationEntries: cliMapping('searchCollaborationEntries', ['collab-search']),
  resolveCollaborationInvitation: cliMapping('resolveCollaborationInvitation', ['collab-link']),
  listKnowledgeCollections: cliMapping('listKnowledgeCollections', ['kbox-list']),
  searchKnowledgeCollections: cliMapping('searchKnowledgeCollections', ['kbox-list']),
  browseKnowledgeCollection: cliMapping(
    'browseKnowledgeCollection',
    ['kbox-list', 'file-list', 'file-info', 'folder-info']
  ),
  updateTeamMemberRole: teamMapping('updateTeamMemberRole'),
  transferTeamOwnership: teamMapping('transferTeamOwnership')
} satisfies Readonly<Record<ContentSpaceExtendedOperationKey, OpenContentExtendedOperationMapping>>)

const ERROR_RETRY = Object.freeze({
  never: 'never',
  human: 'after-human-action',
  same: 'safe-with-same-invocation'
} as const)

type ExtendedFailure = Readonly<{
  ok: false
  error: Readonly<{
    code: string
    message: string
    retry: 'never' | 'after-human-action' | 'safe-with-same-invocation'
  }>
}>

class ProviderPayloadError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'ProviderPayloadError'
    this.code = code
  }
}

function failure(
  code: string,
  message: string,
  retry: ExtendedFailure['error']['retry'] = ERROR_RETRY.never
): ExtendedFailure {
  return Object.freeze({
    ok: false,
    error: Object.freeze({ code, message: message.slice(0, 256), retry })
  })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function record(value: unknown, label = 'Provider payload'): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new ProviderPayloadError('provider_contract_violation', `${label} must be an object.`)
  }
  return value
}

function first(recordValue: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = recordValue[key]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

function requiredString(
  recordValue: Record<string, unknown>,
  keys: readonly string[],
  label: string
): string {
  const value = first(recordValue, keys)
  if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') {
    throw new ProviderPayloadError('provider_contract_violation', `${label} is missing.`)
  }
  return String(value).trim()
}

function optionalString(
  recordValue: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  const value = first(recordValue, keys)
  if (value === undefined || value === '') return undefined
  return typeof value === 'string' || typeof value === 'number'
    ? String(value).trim() || undefined
    : undefined
}

function requiredNumber(
  recordValue: Record<string, unknown>,
  keys: readonly string[],
  label: string
): number {
  const value = first(recordValue, keys)
  const parsed = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(parsed) || parsed < 0) {
    throw new ProviderPayloadError('provider_contract_violation', `${label} is missing or invalid.`)
  }
  return parsed
}

function optionalNumber(
  recordValue: Record<string, unknown>,
  keys: readonly string[]
): number | undefined {
  const value = first(recordValue, keys)
  if (value === undefined || value === null || value === '') return undefined
  const parsed = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined
}

function booleanValue(value: unknown, fallback = false): boolean {
  if (typeof value === 'boolean') return value
  if (value === 1 || value === '1' || value === 'true') return true
  if (value === 0 || value === '0' || value === 'false') return false
  return fallback
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function providerArray(value: unknown, keys: readonly string[]): readonly unknown[] {
  if (Array.isArray(value)) return value
  const object = record(value)
  for (const key of keys) {
    if (Array.isArray(object[key])) return object[key]
  }
  return []
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const trimmed = value.trim()
  const withZone = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/u.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}+08:00`
    : trimmed
  const epoch = Date.parse(withZone)
  return Number.isFinite(epoch) ? new Date(epoch).toISOString() : undefined
}

function parseByteSize(value: unknown): number {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return Math.trunc(value)
  if (typeof value !== 'string') return 0
  const match = value.trim().match(/^(\d+(?:\.\d+)?)\s*(B|KB|MB|GB|TB)?$/iu)
  if (!match) return 0
  const magnitude = Number(match[1])
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const power = units.indexOf((match[2] ?? 'B').toUpperCase())
  return Math.round(magnitude * (1024 ** Math.max(power, 0)))
}

function unwrapCliJson(value: unknown): unknown {
  if (!isRecord(value)) return value
  if (value.success === false) {
    const message = optionalString(value, ['error', 'message', 'msg']) ?? 'OpenContent rejected the operation.'
    throw new ProviderPayloadError(mapProviderBusinessCode(first(value, ['code', 'result'])), message)
  }
  const numericResult = optionalNumber(value, ['result'])
  if (numericResult !== undefined && numericResult !== 0) {
    throw new ProviderPayloadError(
      mapProviderBusinessCode(numericResult),
      optionalString(value, ['msg', 'message', 'error']) ?? `OpenContent result ${numericResult}.`
    )
  }
  return value.success === true && value.data !== undefined ? value.data : value
}

function mapProviderBusinessCode(value: unknown): string {
  const code = String(value ?? '').toUpperCase()
  if (['401', '403', '2400', 'AUTH_FAILED', 'UNAUTHORIZED'].includes(code)) return 'unauthorized'
  if (['404', '601', 'NOT_FOUND'].includes(code)) return 'not_found'
  if (['409', '806', 'ALREADY_EXISTS', 'CONFLICT'].includes(code)) return 'conflict'
  if (['429', 'RATE_LIMITED'].includes(code)) return 'rate_limited'
  if (['INVALID_PARAMS', '400'].includes(code)) return 'invalid_input'
  return 'provider_unavailable'
}

function mapThrownError(error: unknown, effect: string): ExtendedFailure {
  if (error instanceof ProviderPayloadError) return failure(error.code, error.message)
  if (error instanceof z.ZodError) {
    return failure(
      'provider_contract_violation',
      'OpenContent returned data outside the declared Provider contract.'
    )
  }
  const item = isRecord(error) ? error : undefined
  const rawCode = String(item?.code ?? '').replaceAll('-', '_').toLowerCase()
  const message = error instanceof Error
    ? error.message
    : optionalString(item ?? {}, ['message']) ?? 'OpenContent operation failed.'
  const publicCode = contentSpaceExtendedErrorCodeSchema.safeParse(rawCode)
  if (publicCode.success) {
    return failure(publicCode.data, message, retryForPublicError(publicCode.data, effect))
  }
  if (rawCode.includes('outcome_unknown') || rawCode.includes('timed_out_after_start')) {
    return failure('outcome_unknown', message)
  }
  if (rawCode.includes('cancel')) return failure('cancelled', message)
  if (rawCode.includes('unauthor') || rawCode.includes('auth_failed')) {
    return failure('unauthorized', message, ERROR_RETRY.human)
  }
  if (rawCode.includes('invalid_input') || rawCode.includes('invalid_params')) {
    return failure('invalid_input', message)
  }
  if (rawCode.includes('contract') || rawCode.includes('invalid_json') || rawCode.includes('truncat')) {
    return failure('provider_contract_violation', message)
  }
  return failure(
    effect === 'read' ? 'provider_unavailable' : 'outcome_unknown',
    message,
    ERROR_RETRY.never
  )
}

function retryForPublicError(
  code: ContentSpaceExtendedErrorCode,
  effect: string
): ExtendedFailure['error']['retry'] {
  if (code === 'outcome_unknown') return ERROR_RETRY.never
  if (['unauthorized', 'blocked_by_contract', 'source_unavailable', 'destination_unavailable']
    .includes(code)) {
    return ERROR_RETRY.human
  }
  if (effect === 'read' && ['provider_unavailable', 'rate_limited'].includes(code)) {
    return ERROR_RETRY.same
  }
  return ERROR_RETRY.never
}

function fileReference(providerInstanceRef: string, fileId: string) {
  return Object.freeze({ providerInstanceRef, fileId })
}

function containerReference(providerInstanceRef: string, containerId: string) {
  return Object.freeze({ providerInstanceRef, containerId })
}

function directoryPrincipal(
  providerInstanceRef: string,
  kind: 'user' | 'department' | 'position' | 'group',
  item: Record<string, unknown>
) {
  const principalId = requiredString(item, ['identityId', 'IdentityId', 'id', 'Id', 'guid', 'Guid'], 'Principal identity')
  const displayName = requiredString(item, ['displayName', 'name', 'Name', 'userName', 'UserName'], 'Principal name')
  return Object.freeze({
    reference: Object.freeze({ providerInstanceRef, kind, principalId }),
    displayName,
    ...(optionalString(item, ['loginName', 'account', 'Account'])
      ? { accountName: optionalString(item, ['loginName', 'account', 'Account']) }
      : {}),
    ...(optionalString(item, ['departmentName', 'DepartmentName'])
      ? { departmentName: optionalString(item, ['departmentName', 'DepartmentName']) }
      : {}),
    ...(optionalString(item, ['positionName', 'PositionName'])
      ? { positionName: optionalString(item, ['positionName', 'PositionName']) }
      : {})
  })
}

function assertProviderAuthority(value: unknown, providerInstanceRef: string): void {
  const visit = (candidate: unknown): void => {
    if (Array.isArray(candidate)) {
      for (const item of candidate) visit(item)
      return
    }
    if (!isRecord(candidate)) return
    if ('providerInstanceRef' in candidate && candidate.providerInstanceRef !== providerInstanceRef) {
      throw new ProviderPayloadError(
        'invalid_reference',
        'Every extended-operation reference must belong to the selected Provider instance.'
      )
    }
    for (const child of Object.values(candidate)) visit(child)
  }
  visit(value)
}

function pageNumber(page: Record<string, unknown>): number {
  const cursor = page.cursor
  if (cursor === undefined) return 1
  if (typeof cursor !== 'string' || !/^ocpage_[1-9]\d*$/u.test(cursor)) {
    throw new ProviderPayloadError('invalid_input', 'The page cursor was not issued by this adapter.')
  }
  return Number(cursor.slice('ocpage_'.length))
}

function nextCursor(total: number | undefined, page: number, limit: number): string | undefined {
  return total !== undefined && total > page * limit ? `ocpage_${page + 1}` : undefined
}

function providerKindForEntry(reference: Record<string, unknown>): 'file' | 'folder' {
  return 'fileId' in reference ? 'file' : 'folder'
}

function entryId(reference: Record<string, unknown>): string {
  return providerKindForEntry(reference) === 'file'
    ? requiredString(reference, ['fileId'], 'File identity')
    : requiredString(reference, ['containerId'], 'Container identity')
}

function targetKind(kind: unknown): 'file' | 'folder' | 'teamfolder' {
  if (kind === 'file') return 'file'
  if (kind === 'container') return 'folder'
  if (kind === 'shared-container') return 'teamfolder'
  throw new ProviderPayloadError('invalid_input', 'Unknown permission target kind.')
}

function mutationIds(entries: readonly unknown[]) {
  const fileIds: string[] = []
  const folderIds: string[] = []
  for (const value of entries) {
    const reference = record(value, 'Entry reference')
    if ('fileId' in reference) fileIds.push(requiredString(reference, ['fileId'], 'File identity'))
    else folderIds.push(requiredString(reference, ['containerId'], 'Container identity'))
  }
  return Object.freeze({ fileIds, folderIds })
}

function asDateOnly(value: string): string {
  return value.slice(0, 10)
}

const metadataControlKinds = Object.freeze({
  edoc2Textbox: 'text',
  edoc2TextArea: 'text',
  edoc2Number: 'number',
  edoc2Date: 'date',
  edoc2Switch: 'boolean',
  edoc2Selectbox: 'single-choice',
  edoc2DynamicList: 'multiple-choice',
  edoc2SelectMember: 'directory-principals',
  edoc2SelectFile: 'files',
  edoc2SelectFolder: 'containers'
} as const)

function metadataField(
  providerInstanceRef: string,
  typeId: string,
  item: Record<string, unknown>
) {
  const fieldId = requiredString(item, ['attrId', 'AttrId', 'fieldId'], 'Metadata field identity')
  const control = requiredString(item, ['controlType', 'ControlType'], 'Metadata control type')
  const kind = metadataControlKinds[control as keyof typeof metadataControlKinds]
  if (!kind) throw new ProviderPayloadError('unsupported', `Unsupported OpenContent metadata control ${control}.`)
  return Object.freeze({
    reference: Object.freeze({
      type: Object.freeze({ providerInstanceRef, metadataTypeId: typeId }),
      fieldId
    }),
    name: requiredString(item, ['attrName', 'AttrName', 'name', 'Name'], 'Metadata field name'),
    kind,
    required: booleanValue(first(item, ['required', 'isRequired', 'IsRequired'])),
    multiple: booleanValue(first(item, ['multiple', 'isMultiple', 'IsMultiple'])) || kind === 'multiple-choice',
    readOnly: booleanValue(first(item, ['readOnly', 'isReadOnly', 'IsReadOnly']))
  })
}

function metadataFilterValue(predicate: Record<string, unknown>): unknown {
  switch (predicate.kind) {
    case 'text':
    case 'boolean':
      return predicate.value
    case 'number':
    case 'date':
      return predicate.operator === 'range'
        ? Object.fromEntries([
          ...(predicate.from === undefined ? [] : [['from', typeof predicate.from === 'string' ? asDateOnly(predicate.from) : predicate.from]]),
          ...(predicate.to === undefined ? [] : [['to', typeof predicate.to === 'string' ? asDateOnly(predicate.to) : predicate.to]])
        ])
        : typeof predicate.value === 'string' ? asDateOnly(predicate.value) : predicate.value
    case 'choices':
      return arrayValue(predicate.choiceIds).map((value) => String(value))
    case 'directory-principals':
      return arrayValue(predicate.principals).map((value) => requiredString(record(value), ['principalId'], 'Principal identity'))
    case 'files':
      return arrayValue(predicate.files).map((value) => requiredString(record(value), ['fileId'], 'File identity'))
    case 'containers':
      return arrayValue(predicate.containers).map((value) => requiredString(record(value), ['containerId'], 'Container identity'))
    default:
      throw new ProviderPayloadError('unsupported', 'Unsupported metadata search predicate.')
  }
}

function searchArgs(request: Record<string, unknown>, scopeKey = 'scope'): Record<string, unknown> {
  const scope = record(request[scopeKey], 'Search scope')
  const args: Record<string, unknown> = {
    keyword: request.query,
    type: Array.isArray(request.entryKinds) && request.entryKinds.length === 1
      ? request.entryKinds[0] === 'container' ? 'folder' : 'file'
      : 'file',
    isPreciseSearch: request.matching !== 'contains'
  }
  if (scope.kind === 'container') {
    args.folderId = requiredString(record(scope.container), ['containerId'], 'Search container')
  } else if (scope.kind === 'provider-scope') {
    args.fileSearchType = scope.scope === 'personal' ? 'person' : 'team'
  }
  if (Array.isArray(request.extensions)) args.fileExtName = request.extensions.join(',')
  if (Array.isArray(request.fields)) {
    args.searchFields = request.fields.map((field) => field === 'name'
      ? 'filename'
      : field === 'tags' ? 'filetag' : 'filecontent').join(',')
  }
  if (Array.isArray(request.createdBy) && request.createdBy.length === 1) {
    args.creatorId = requiredString(record(request.createdBy[0]), ['principalId'], 'Creator identity')
  }
  if (Array.isArray(request.modifiedBy) && request.modifiedBy.length === 1) {
    args.modifierId = requiredString(record(request.modifiedBy[0]), ['principalId'], 'Modifier identity')
  }
  if (isRecord(request.created)) {
    if (typeof request.created.from === 'string') args.createTimeStart = asDateOnly(request.created.from)
    if (typeof request.created.to === 'string') args.createTimeEnd = asDateOnly(request.created.to)
  }
  if (isRecord(request.modified)) {
    if (typeof request.modified.from === 'string') args.modifyTimeStart = asDateOnly(request.modified.from)
    if (typeof request.modified.to === 'string') args.modifyTimeEnd = asDateOnly(request.modified.to)
  }
  if (isRecord(request.tags)) {
    args.tags = arrayValue(request.tags.names)
    args.tagOperator = request.tags.match === 'any' ? 'or' : 'and'
  }
  if (Array.isArray(request.metadata)) {
    args.metaFilters = request.metadata.map((candidate) => {
      const predicate = record(candidate, 'Metadata predicate')
      const field = record(predicate.field, 'Metadata field')
      return {
        typeId: requiredString(field, ['metadataTypeId'], 'Metadata type identity'),
        attrId: requiredString(field, ['fieldId'], 'Metadata field identity'),
        controlType: metadataControlType(predicate.kind),
        value: metadataFilterValue(predicate),
        operator: 'eq'
      }
    })
  }
  return args
}

function metadataControlType(kind: unknown): string {
  switch (kind) {
    case 'text': return 'edoc2Textbox'
    case 'number': return 'edoc2Number'
    case 'date': return 'edoc2Date'
    case 'boolean': return 'edoc2Switch'
    case 'choices': return 'edoc2Selectbox'
    case 'directory-principals': return 'edoc2SelectMember'
    case 'files': return 'edoc2SelectFile'
    case 'containers': return 'edoc2SelectFolder'
    default: throw new ProviderPayloadError('unsupported', 'Unsupported metadata search control.')
  }
}

export type OpenContentExtendedOperationAdapter = Readonly<{
  execute(input: Readonly<{
    invocationId: string
    operation: ContentSpaceExtendedOperationKey
    request: unknown
    source?: OpenContentExtendedUploadSource
    destination?: OpenContentExtendedDownloadDestination
  }>): Promise<unknown>
}>

export type OpenContentExtendedUploadSource = Readonly<{
  name: string
  size: number
  sha256?: string
  read(input: Readonly<{ offset: number; length: number }>): Promise<Uint8Array>
}>

export type OpenContentExtendedDownloadDestination = Readonly<{
  write(chunk: Uint8Array): Promise<void>
}>

export function createOpenContentExtendedOperationAdapter(input: Readonly<{
  owner: OpenContentSkillRuntimeOwner
  providerInstanceRef: string
  transport?: OpenContentExtendedCommandTransport
  teamGovernance?: OpenContentTeamGovernancePort
  now?: () => Date
}>): OpenContentExtendedOperationAdapter {
  const { providerInstanceRef, transport, teamGovernance } = input
  const owner = admitOpenContentSkillRuntimeOwner(input.owner)
  if (owner.role !== 'adapter-owner') {
    throw new TypeError('Only the OpenContent Content Space provider may own the extended adapter.')
  }
  const now = input.now ?? (() => new Date())

  async function invoke(
    invocationId: string,
    command: OpenContentExtendedOperationCommand,
    args: Record<string, unknown>,
    dataFiles: readonly OpenContentExtendedDataFile[] = [],
    onTransportReturned?: () => void
  ): Promise<unknown> {
    if (!transport) {
      throw new ProviderPayloadError('blocked_by_contract', 'The OpenContent CLI transport is unavailable.')
    }
    const invocation = openContentExtendedCommandInvocationSchema.parse({
      invocationId,
      command,
      args,
      dataFiles
    })
    const rawResult = await transport.invoke(invocation)
    onTransportReturned?.()
    const result = openContentExtendedCommandSuccessSchema.parse(rawResult)
    if (result.invocationId !== invocationId || result.command !== command) {
      throw new ProviderPayloadError(
        'provider_contract_violation',
        'The CLI runner returned a receipt for another invocation or command.'
      )
    }
    return unwrapCliJson(result.json)
  }

  return Object.freeze({
    async execute(execution): Promise<unknown> {
      const contract = CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS[execution.operation]
      if (!contract) return failure('unsupported', 'Unknown Content Space extended operation.')
      const mapping = OPENCONTENT_EXTENDED_OPERATION_MAPPINGS[execution.operation]
      let mutationTransportReturned = false
      const parsedRequest = contract.requestSchema.safeParse(rehydrateTransferHandle(
        execution.operation,
        execution.request,
        execution.source,
        execution.destination
      ))
      if (!parsedRequest.success) {
        return contract.resultSchema.parse(failure('invalid_input', 'The extended-operation request is invalid.'))
      }
      try {
        invocationIdSchema.parse(execution.invocationId)
        assertProviderAuthority(parsedRequest.data, providerInstanceRef)
        const value = await executeOperation({
          providerInstanceRef,
          invocationId: execution.invocationId,
          operation: execution.operation,
          request: record(parsedRequest.data, 'Extended-operation request'),
          invoke: async (invocationId, command, args, dataFiles) => {
            return invoke(invocationId, command, args, dataFiles, () => {
              if (mapping.mutationCommands.includes(command)) mutationTransportReturned = true
            })
          },
          teamGovernance,
          now,
          source: execution.source,
          destination: execution.destination
        })
        return contract.resultSchema.parse(Object.freeze({ ok: true, value }))
      } catch (error) {
        if (
          mutationTransportReturned &&
          (contract.effect === 'external-write' || contract.effect === 'destructive') &&
          (
            (error instanceof ProviderPayloadError && error.code === 'provider_contract_violation') ||
            error instanceof z.ZodError
          )
        ) {
          const message = error instanceof ProviderPayloadError
            ? error.message
            : 'OpenContent returned data outside the declared Provider contract.'
          return contract.resultSchema.parse(failure('outcome_unknown', message))
        }
        const mapped = mapThrownError(error, contract.effect)
        return contract.resultSchema.parse(mapped)
      }
    }
  })
}

function rehydrateTransferHandle(
  operation: ContentSpaceExtendedOperationKey,
  request: unknown,
  source: OpenContentExtendedUploadSource | undefined,
  destination: OpenContentExtendedDownloadDestination | undefined
): unknown {
  if (!isRecord(request)) return request
  const internalHandle = `xfer_${'i'.repeat(32)}`
  if (operation === 'updateFileVersion' || operation === 'addAttachment') {
    return source ? Object.freeze({ ...request, sourceHandle: internalHandle }) : request
  }
  if (operation === 'exportFileAsPdf') {
    return destination ? Object.freeze({ ...request, destinationHandle: internalHandle }) : request
  }
  return request
}

type ExecuteContext = Readonly<{
  providerInstanceRef: string
  invocationId: string
  operation: ContentSpaceExtendedOperationKey
  request: Record<string, unknown>
  invoke(
    commandInvocationId: string,
    command: OpenContentExtendedOperationCommand,
    args: Record<string, unknown>,
    dataFiles?: readonly OpenContentExtendedDataFile[]
  ): Promise<unknown>
  teamGovernance?: OpenContentTeamGovernancePort
  now(): Date
  source?: OpenContentExtendedUploadSource
  destination?: OpenContentExtendedDownloadDestination
}>

function compositionInvocationId(invocationId: string, index: number): string {
  const suffix = `_read_${index}`
  return `${invocationId.slice(0, Math.max(16, 128 - suffix.length))}${suffix}`
}

async function executeOperation(context: ExecuteContext): Promise<unknown> {
  const { operation } = context
  switch (operation) {
    case 'searchEntries': return executeSearchEntries(context)
    case 'listRecentEntries': return executeRecentEntries(context)
    case 'getEntryInfo': return executeGetEntryInfo(context)
    case 'resolveInternalLink': return executeInternalLink(context)
    case 'buildFileScope': return executeBuildScope(context)
    case 'listMetadataTypes': return executeListMetadataTypes(context)
    case 'listMetadataFields': return executeListMetadataFields(context)
    case 'listMetadataChoices': return executeListMetadataChoices(context)
    case 'readEntryMetadata': return executeReadMetadata(context)
    case 'editEntryMetadata': return executeEditMetadata(context)
    case 'renameEntry': return executeRename(context)
    case 'copyEntries': return executeCopyOrMove(context, 'copy')
    case 'moveEntries': return executeCopyOrMove(context, 'move')
    case 'deleteEntries': return executeDelete(context)
    case 'createShortcut': return executeCreateShortcut(context)
    case 'updateEntryProperties': return executeUpdateProperties(context)
    case 'listSecurityLevels': return executeSecurityLevels(context)
    case 'updateFileVersion': return executeUpdateVersion(context)
    case 'exportFileAsPdf': return executeExportPdf(context)
    case 'listAttachments': return executeListAttachments(context)
    case 'addAttachment': return executeAddAttachment(context)
    case 'removeAttachment': return executeRemoveAttachment(context)
    case 'listRelations': return executeListRelations(context)
    case 'createRelation': return executeCreateRelation(context)
    case 'removeRelation': return executeRemoveRelation(context)
    case 'listTags': return executeListTags(context)
    case 'setTags': return executeSetTags(context)
    case 'removeTags': return executeRemoveTags(context)
    case 'createPublication': return executeCreatePublication(context)
    case 'listPublications': return executeListPublications(context)
    case 'cancelPublication': return executeCancelPublications(context)
    case 'createShare': return executeCreateShare(context)
    case 'listShares': return executeListShares(context)
    case 'cancelShare': return executeCancelShares(context)
    case 'listAlbums': return executeListAlbums(context)
    case 'listAlbumEntries': return executeListAlbumEntries(context)
    case 'addFavorite': return executeAddFavorite(context)
    case 'removeFavorite': return executeRemoveFavorite(context)
    case 'getCurrentPrincipal': return executeCurrentPrincipal(context)
    case 'searchUsers': return executePrincipalSearch(context, 'user')
    case 'searchDepartments': return executePrincipalSearch(context, 'department')
    case 'searchPositions': return executePrincipalSearch(context, 'position')
    case 'searchGroups': return executePrincipalSearch(context, 'group')
    case 'listPermissionCategories': return executePermissionCategories(context)
    case 'listPermissions': return executeListPermissions(context)
    case 'changePermissions': return executeChangePermissions(context)
    case 'listCollaborationEntries': return executeCollaborationList(context, false)
    case 'searchCollaborationEntries': return executeCollaborationList(context, true)
    case 'resolveCollaborationInvitation': return executeCollaborationLink(context)
    case 'listKnowledgeCollections': return executeKnowledgeCollections(context, false)
    case 'searchKnowledgeCollections': return executeKnowledgeCollections(context, true)
    case 'browseKnowledgeCollection': return executeBrowseKnowledge(context)
    case 'updateTeamMemberRole': return executeTeamMemberRole(context)
    case 'transferTeamOwnership': return executeTeamOwnership(context)
  }
  return unreachableOperation(operation)
}

function unreachableOperation(operation: never): never {
  throw new ProviderPayloadError(
    'provider_contract_violation',
    `The extended-operation dispatcher is incomplete: ${String(operation)}.`
  )
}

async function executeSearchEntries(context: ExecuteContext): Promise<unknown> {
  const page = record(context.request.page, 'Search page')
  const pageIndex = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Search page limit')
  if (limit > 100) {
    throw new ProviderPayloadError('bounds_exceeded', 'OpenContent search pages are limited to 100 entries.')
  }
  const entryKinds = arrayValue(context.request.entryKinds)
  if (entryKinds.length > 1) {
    throw new ProviderPayloadError(
      'unsupported',
      'OpenContent cannot preserve one ordered cursor across mixed file and folder search results.'
    )
  }
  const args = {
    ...searchArgs(context.request),
    pageIndex,
    pageSize: limit,
    ...(isRecord(context.request.sort)
      ? {
        sort: context.request.sort.field === 'created-at'
          ? 'filecreatetime'
          : context.request.sort.field === 'size' ? 'filesize' : 'filemodifytime',
        order: context.request.sort.direction === 'ascending' ? 'asc' : 'desc'
      }
      : {})
  }
  const raw = await context.invoke(context.invocationId, 'file-search', args)
  const payload = record(raw)
  const items = providerArray(first(payload, ['items', 'data']), ['items'])
  const total = optionalNumber(payload, ['total', 'totalCount', 'matchedCount'])
  const normalized: unknown[] = []
  for (const [index, item] of items.entries()) {
    const summary = record(item, 'Search item')
    const kind = optionalString(summary, ['type', 'kind']) === 'folder' ? 'container' : 'file'
    const id = requiredString(summary, ['id', 'fileId', 'folderId'], 'Search result identity')
    normalized.push(await observeEntryInfo(
      context,
      kind === 'file'
        ? fileReference(context.providerInstanceRef, id)
        : containerReference(context.providerInstanceRef, id),
      index + 1
    ))
  }
  return Object.freeze({
    items: Object.freeze(normalized),
    ...(nextCursor(total, pageIndex, limit) ? { nextCursor: nextCursor(total, pageIndex, limit) } : {}),
    ...(total === undefined ? {} : { matchedCount: total })
  })
}

async function executeRecentEntries(context: ExecuteContext): Promise<unknown> {
  const page = record(context.request.page, 'Recent page')
  const pageIndex = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Recent page limit')
  if (limit > 100) throw new ProviderPayloadError('bounds_exceeded', 'OpenContent recent pages are limited to 100 entries.')
  if (arrayValue(context.request.entryKinds).includes('container')) {
    throw new ProviderPayloadError('unsupported', 'OpenContent recent history exposes files only.')
  }
  const raw = await context.invoke(context.invocationId, 'recent-files', {
    pageNum: pageIndex,
    pageSize: limit
  })
  const payload = record(raw)
  const items = providerArray(first(payload, ['items', 'data', 'files']), ['items', 'files'])
  const total = optionalNumber(payload, ['total', 'totalCount', 'allCount'])
  const normalized: unknown[] = []
  for (const [index, item] of items.entries()) {
    const summary = record(item, 'Recent file')
    const id = requiredString(summary, ['id', 'fileId', 'FileId'], 'Recent file identity')
    normalized.push(await observeEntryInfo(
      context,
      fileReference(context.providerInstanceRef, id),
      index + 1
    ))
  }
  return Object.freeze({
    items: Object.freeze(normalized),
    ...(nextCursor(total, pageIndex, limit) ? { nextCursor: nextCursor(total, pageIndex, limit) } : {}),
    ...(total === undefined ? {} : { matchedCount: total })
  })
}

async function executeGetEntryInfo(context: ExecuteContext): Promise<unknown> {
  return observeEntryInfo(context, record(context.request.reference, 'Entry reference'), 0)
}

async function observeEntryInfo(
  context: ExecuteContext,
  reference: Record<string, unknown>,
  compositionIndex: number
): Promise<unknown> {
  if ('fileId' in reference) {
    const raw = await context.invoke(
      compositionIndex === 0 ? context.invocationId : compositionInvocationId(context.invocationId, compositionIndex),
      'file-info',
      { fileId: requiredString(reference, ['fileId'], 'File identity') }
    )
    const payload = record(raw, 'File information')
    const fileId = requiredString(payload, ['fileGuid', 'fileId', 'id'], 'File identity')
    const parentId = requiredString(payload, ['folderGuid', 'folderId', 'parentFolderId'], 'Parent folder identity')
    const modifiedById = optionalString(payload, ['editorId', 'modifierId'])
    const modifiedByName = optionalString(payload, ['editorName', 'modifierName'])
    return Object.freeze({
      kind: 'file',
      reference: fileReference(context.providerInstanceRef, fileId),
      name: requiredString(payload, ['fileName', 'name'], 'File name'),
      parent: containerReference(context.providerInstanceRef, parentId),
      size: requiredNumber(payload, ['fileSize', 'size'], 'File size'),
      ...(normalizeTimestamp(first(payload, ['fileCreateTime', 'createTime']))
        ? { createdAt: normalizeTimestamp(first(payload, ['fileCreateTime', 'createTime'])) }
        : {}),
      ...(normalizeTimestamp(first(payload, ['fileModifyTime', 'modifyTime']))
        ? { modifiedAt: normalizeTimestamp(first(payload, ['fileModifyTime', 'modifyTime'])) }
        : {}),
      ...(modifiedById && modifiedByName
        ? { modifiedBy: directoryPrincipal(context.providerInstanceRef, 'user', { identityId: modifiedById, name: modifiedByName }) }
        : {}),
      ...(optionalString(payload, ['fileLastVerId', 'fileVerId', 'currentVersionId'])
        ? { currentVersionId: optionalString(payload, ['fileLastVerId', 'fileVerId', 'currentVersionId']) }
        : {}),
      ...(optionalString(payload, ['code']) ? { code: optionalString(payload, ['code']) } : {}),
      ...(optionalString(payload, ['fileRemark', 'remark']) ? { remark: optionalString(payload, ['fileRemark', 'remark']) } : {})
    })
  }
  const raw = await context.invoke(
    compositionIndex === 0 ? context.invocationId : compositionInvocationId(context.invocationId, compositionIndex),
    'folder-info',
    { folderId: requiredString(reference, ['containerId'], 'Folder identity') }
  )
  const payload = record(raw, 'Folder information')
  const folderId = requiredString(payload, ['folderGuid', 'folderId', 'id'], 'Folder identity')
  const parentId = optionalString(payload, ['parentFolderGuid', 'parentFolderId'])
  return Object.freeze({
    kind: 'container',
    reference: containerReference(context.providerInstanceRef, folderId),
    name: requiredString(payload, ['folderName', 'name'], 'Folder name'),
    ...(parentId ? { parent: containerReference(context.providerInstanceRef, parentId) } : {}),
    ...(normalizeTimestamp(first(payload, ['createTime', 'folderCreateTime']))
      ? { createdAt: normalizeTimestamp(first(payload, ['createTime', 'folderCreateTime'])) }
      : {}),
    ...(normalizeTimestamp(first(payload, ['modifyTime', 'folderModifyTime']))
      ? { modifiedAt: normalizeTimestamp(first(payload, ['modifyTime', 'folderModifyTime'])) }
      : {}),
    ...(optionalString(payload, ['code']) ? { code: optionalString(payload, ['code']) } : {}),
    ...(optionalString(payload, ['remark']) ? { remark: optionalString(payload, ['remark']) } : {})
  })
}

async function executeInternalLink(context: ExecuteContext): Promise<unknown> {
  const reference = record(context.request.reference, 'Entry reference')
  if (!('fileId' in reference)) {
    throw new ProviderPayloadError('unsupported', 'The attachment CLI exposes internal links for files only.')
  }
  const raw = record(await context.invoke(context.invocationId, 'file-internal-link', {
    fileId: requiredString(reference, ['fileId'], 'File identity')
  }))
  const url = requiredString(raw, ['url', 'link'], 'Internal link')
  const expiresAt = new Date(context.now().getTime() + 5 * 60_000).toISOString()
  return Object.freeze({ reference, target: Object.freeze({ url, expiresAt }) })
}

async function executeBuildScope(context: ExecuteContext): Promise<unknown> {
  const raw = record(await context.invoke(context.invocationId, 'file-rag-scope', {
    ...searchArgs(context.request)
  }))
  if (raw.executable === false && raw.code === 'FILE_SCOPE_EMPTY') {
    return Object.freeze({
      files: Object.freeze([]),
      matchedCount: 0,
      truncated: false,
      selection: Object.freeze({ limit: 100, sort: 'modified-at', direction: 'descending' })
    })
  }
  if (raw.executable !== true || !isRecord(raw.fileScope)) {
    throw new ProviderPayloadError('provider_contract_violation', 'OpenContent did not produce an executable file scope.')
  }
  const scope = raw.fileScope
  const files = arrayValue(scope.fileGuids).map((value) => {
    if (typeof value !== 'string' || value.trim() === '') {
      throw new ProviderPayloadError('provider_contract_violation', 'The file scope contains an invalid identity.')
    }
    return fileReference(context.providerInstanceRef, value)
  })
  return Object.freeze({
    files: Object.freeze(files),
    matchedCount: requiredNumber(scope, ['total'], 'File-scope match count'),
    truncated: booleanValue(scope.truncated),
    selection: Object.freeze({ limit: 100, sort: 'modified-at', direction: 'descending' })
  })
}

async function executeListMetadataTypes(context: ExecuteContext): Promise<unknown> {
  const page = record(context.request.page, 'Metadata page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Metadata page limit')
  const raw = await context.invoke(context.invocationId, 'meta-types', {})
  const all = providerArray(raw, ['items', 'types', 'data'])
  const start = (index - 1) * limit
  const items = all.slice(start, start + limit).map((value) => {
    const item = record(value, 'Metadata type')
    return Object.freeze({
      reference: Object.freeze({
        providerInstanceRef: context.providerInstanceRef,
        metadataTypeId: requiredString(item, ['TypeId', 'typeId', 'id'], 'Metadata type identity')
      }),
      name: requiredString(item, ['TypeName', 'typeName', 'name'], 'Metadata type name'),
      ...(optionalString(item, ['description', 'Description']) ? { description: optionalString(item, ['description', 'Description']) } : {})
    })
  })
  return Object.freeze({
    items: Object.freeze(items),
    ...(start + items.length < all.length ? { nextCursor: `ocpage_${index + 1}` } : {})
  })
}

async function metadataAttributes(context: ExecuteContext, typeId: string): Promise<Readonly<{
  name: string
  items: readonly Record<string, unknown>[]
}>> {
  const raw = await context.invoke(compositionInvocationId(context.invocationId, 1), 'meta-attrs', { typeId })
  const payload = record(raw, 'Metadata attributes')
  return Object.freeze({
    name: optionalString(payload, ['typeName', 'TypeName', 'name']) ?? typeId,
    items: providerArray(first(payload, ['attrs', 'attributes', 'items', 'data']), ['attrs', 'attributes', 'items'])
      .map((value) => record(value, 'Metadata attribute'))
  })
}

async function executeListMetadataFields(context: ExecuteContext): Promise<unknown> {
  const type = record(context.request.type, 'Metadata type reference')
  const typeId = requiredString(type, ['metadataTypeId'], 'Metadata type identity')
  const attrs = await metadataAttributes(context, typeId)
  return Object.freeze({
    type: Object.freeze({ reference: type, name: attrs.name }),
    items: Object.freeze(attrs.items.map((item) => metadataField(context.providerInstanceRef, typeId, item)))
  })
}

async function executeListMetadataChoices(context: ExecuteContext): Promise<unknown> {
  const field = record(context.request.field, 'Metadata field reference')
  const type = record(field.type, 'Metadata type reference')
  const typeId = requiredString(type, ['metadataTypeId'], 'Metadata type identity')
  const fieldId = requiredString(field, ['fieldId'], 'Metadata field identity')
  const attrs = await metadataAttributes(context, typeId)
  const attribute = attrs.items.find((item) => optionalString(item, ['attrId', 'AttrId']) === fieldId)
  if (!attribute) throw new ProviderPayloadError('invalid_reference', 'The metadata field is unavailable.')
  const control = requiredString(attribute, ['controlType', 'ControlType'], 'Metadata control type')
  const page = record(context.request.page, 'Choice page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Choice page limit')
  let choices: readonly unknown[]
  if (control === 'edoc2DynamicList') {
    const raw = await context.invoke(compositionInvocationId(context.invocationId, 2), 'meta-modeldata', {
      typeId,
      attrId: fieldId,
      ...(context.request.query ? { keyword: context.request.query } : {}),
      pageIndex: index,
      pageSize: Math.min(limit, 100)
    })
    choices = providerArray(raw, ['items', 'data'])
  } else {
    const setting = isRecord(attribute.setting) ? attribute.setting : {}
    choices = providerArray(first(setting, ['datasource', 'dataSource', 'items']), ['items'])
      .filter((value) => {
        const query = context.request.query
        if (typeof query !== 'string') return true
        const item = record(value, 'Metadata choice')
        return (optionalString(item, ['text', 'label', 'name']) ?? '').toLowerCase().includes(query.toLowerCase())
      })
      .slice((index - 1) * limit, index * limit)
  }
  const items = choices.map((value) => {
    const item = record(value, 'Metadata choice')
    const choiceId = requiredString(item, ['value', 'id', 'Id'], 'Metadata choice identity')
    return Object.freeze({
      reference: Object.freeze({ field, choiceId }),
      label: requiredString(item, ['text', 'label', 'name', 'Name'], 'Metadata choice label')
    })
  })
  return Object.freeze({ field, items: Object.freeze(items) })
}

function metadataValue(
  providerInstanceRef: string,
  control: string,
  value: unknown,
  fieldReference: Record<string, unknown>
): unknown {
  if (value === undefined || value === null || value === '') return undefined
  switch (control) {
    case 'edoc2Textbox':
    case 'edoc2TextArea':
      return Object.freeze({ kind: 'text', value: String(value) })
    case 'edoc2Number': {
      const parsed = Number(value)
      if (!Number.isFinite(parsed)) throw new ProviderPayloadError('provider_contract_violation', 'Metadata number is invalid.')
      return Object.freeze({ kind: 'number', value: parsed })
    }
    case 'edoc2Date': {
      const timestamp = normalizeTimestamp(value)
      if (!timestamp) throw new ProviderPayloadError('provider_contract_violation', 'Metadata date is invalid.')
      return Object.freeze({ kind: 'date', value: timestamp })
    }
    case 'edoc2Switch':
      return Object.freeze({ kind: 'boolean', value: booleanValue(value) })
    case 'edoc2Selectbox':
    case 'edoc2DynamicList':
      return Object.freeze({
        kind: 'choices',
        values: Object.freeze(arrayValue(Array.isArray(value) ? value : [value]).map((candidate) => Object.freeze({
          field: fieldReference,
          choiceId: typeof candidate === 'object' && candidate !== null
            ? requiredString(record(candidate), ['value', 'id'], 'Metadata choice identity')
            : String(candidate)
        })))
      })
    case 'edoc2SelectMember':
      return Object.freeze({
        kind: 'directory-principals',
        values: Object.freeze(arrayValue(Array.isArray(value) ? value : [value]).map((candidate) => {
          const item = record(candidate, 'Metadata member')
          return Object.freeze({
            providerInstanceRef,
            kind: memberKind(first(item, ['memberType', 'type'])),
            principalId: requiredString(item, ['identityId', 'id'], 'Metadata member identity')
          })
        }))
      })
    case 'edoc2SelectFile':
      return Object.freeze({
        kind: 'files',
        values: Object.freeze(arrayValue(Array.isArray(value) ? value : [value]).map((candidate) =>
          fileReference(providerInstanceRef, typeof candidate === 'object' && candidate !== null
            ? requiredString(record(candidate), ['fileId', 'id', 'value'], 'Metadata file identity')
            : String(candidate))))
      })
    case 'edoc2SelectFolder':
      return Object.freeze({
        kind: 'containers',
        values: Object.freeze(arrayValue(Array.isArray(value) ? value : [value]).map((candidate) =>
          containerReference(providerInstanceRef, typeof candidate === 'object' && candidate !== null
            ? requiredString(record(candidate), ['folderId', 'id', 'value'], 'Metadata folder identity')
            : String(candidate))))
      })
    default:
      throw new ProviderPayloadError('unsupported', `Unsupported OpenContent metadata control ${control}.`)
  }
}

function memberKind(value: unknown): 'user' | 'department' | 'position' | 'group' {
  const normalized = String(value ?? '').toLowerCase()
  if (normalized === '2' || normalized === 'department') return 'department'
  if (normalized === '4' || normalized === 'position') return 'position'
  if (normalized === '8' || normalized === 'group') return 'group'
  return 'user'
}

async function executeReadMetadata(context: ExecuteContext): Promise<unknown> {
  const target = record(context.request.target, 'Metadata target')
  const requestedType = isRecord(context.request.type) ? context.request.type : undefined
  const raw = await context.invoke(context.invocationId, 'meta-info', {
    fileId: entryId(target),
    fileType: providerKindForEntry(target)
  })
  const payload = record(raw, 'Metadata information')
  const candidates = providerArray(first(payload, ['records', 'metaRecords', 'items']), ['records', 'items'])
  const records = candidates.length > 0 ? candidates : [payload]
  const normalized = records.map((candidate) => {
    const item = record(candidate, 'Metadata record')
    const typeId = requiredString(item, ['metaTypeId', 'typeId', 'TypeId'], 'Metadata type identity')
    if (requestedType && requestedType.metadataTypeId !== typeId) return undefined
    const typeReference = Object.freeze({ providerInstanceRef: context.providerInstanceRef, metadataTypeId: typeId })
    const attributes = providerArray(first(item, ['attrs', 'attributes', 'values']), ['attrs', 'attributes', 'values'])
    return Object.freeze({
      target,
      type: Object.freeze({
        reference: typeReference,
        name: requiredString(item, ['metaTypeName', 'typeName', 'TypeName'], 'Metadata type name')
      }),
      values: Object.freeze(attributes.map((candidateAttribute) => {
        const attribute = record(candidateAttribute, 'Metadata attribute')
        const definition = metadataField(context.providerInstanceRef, typeId, attribute)
        const value = metadataValue(
          context.providerInstanceRef,
          requiredString(attribute, ['controlType', 'ControlType'], 'Metadata control type'),
          first(attribute, ['attrValue', 'columnValue', 'value', 'Value']),
          definition.reference
        )
        return Object.freeze({ field: definition, ...(value === undefined ? {} : { value }) })
      }))
    })
  }).filter((value) => value !== undefined)
  return Object.freeze({ target, items: Object.freeze(normalized) })
}

function metadataEditValue(value: unknown): unknown {
  if (value === null) return ''
  const typed = record(value, 'Metadata value')
  switch (typed.kind) {
    case 'text':
    case 'number':
    case 'boolean': return typed.value
    case 'date': return typeof typed.value === 'string' ? asDateOnly(typed.value) : typed.value
    case 'choices': return arrayValue(typed.values).map((candidate) => requiredString(record(candidate), ['choiceId'], 'Metadata choice identity'))
    case 'directory-principals': return arrayValue(typed.values).map((candidate) => {
      const principal = record(candidate, 'Directory principal')
      const id = requiredString(principal, ['principalId'], 'Directory principal identity')
      return { id, identityId: id, guid: id, text: id, memberType: principalMemberType(principal.kind) }
    })
    case 'files': return arrayValue(typed.values).map((candidate) => requiredString(record(candidate), ['fileId'], 'Metadata file identity'))
    case 'containers': return arrayValue(typed.values).map((candidate) => requiredString(record(candidate), ['containerId'], 'Metadata folder identity'))
    default: throw new ProviderPayloadError('unsupported', 'Unsupported metadata edit value.')
  }
}

function principalMemberType(kind: unknown): number {
  if (kind === 'department') return 2
  if (kind === 'position') return 4
  if (kind === 'group') return 8
  return 1
}

async function executeEditMetadata(context: ExecuteContext): Promise<unknown> {
  const target = record(context.request.target, 'Metadata target')
  const type = record(context.request.type, 'Metadata type reference')
  const typeId = requiredString(type, ['metadataTypeId'], 'Metadata type identity')
  const attrs = await metadataAttributes(context, typeId)
  const changes = arrayValue(context.request.changes)
  const changeColumns = changes.map((candidate) => {
    const change = record(candidate, 'Metadata change')
    const field = record(change.field, 'Metadata field reference')
    const fieldType = record(field.type, 'Metadata field type')
    if (fieldType.metadataTypeId !== typeId) {
      throw new ProviderPayloadError('invalid_reference', 'Every changed field must belong to the selected metadata type.')
    }
    const fieldId = requiredString(field, ['fieldId'], 'Metadata field identity')
    const attribute = attrs.items.find((item) => optionalString(item, ['attrId', 'AttrId']) === fieldId)
    if (!attribute) throw new ProviderPayloadError('invalid_reference', `Metadata field ${fieldId} is unavailable.`)
    const columnName = requiredString(attribute, ['columnName', 'ColumnName'], 'Metadata edit column')
    return Object.freeze({ columnName, attrValue: metadataEditValue(change.value) })
  })
  await context.invoke(context.invocationId, 'meta-edit', {
    docId: entryId(target),
    docType: providerKindForEntry(target),
    changeColumns
  })
  return Object.freeze({
    target,
    type,
    changedFields: Object.freeze(changes.map((candidate) => record(candidate).field))
  })
}

async function executeRename(context: ExecuteContext): Promise<unknown> {
  const target = record(context.request.target, 'Rename target')
  const raw = assertMutationSettled(await context.invoke(context.invocationId, 'rename', {
    id: entryId(target),
    type: providerKindForEntry(target),
    newName: context.request.name
  }))
  const provedTargetId = optionalString(raw, ['id'])
  const provedTargetType = optionalString(raw, ['type'])
  const provedName = optionalString(raw, ['newName'])
  if (
    provedTargetId === undefined ||
    provedTargetType !== providerKindForEntry(target) ||
    provedName !== context.request.name
  ) {
    throw new ProviderPayloadError(
      'provider_contract_violation',
      'OpenContent rename receipt does not prove the requested target and name.'
    )
  }
  return Object.freeze({ target, name: context.request.name })
}

function assertMutationSettled(raw: unknown): Record<string, unknown> {
  const payload = record(raw, 'Mutation receipt')
  if (payload.pending === true || payload.completed === false) {
    throw new ProviderPayloadError('outcome_unknown', 'OpenContent accepted the mutation but did not prove completion.')
  }
  return payload
}

async function executeCopyOrMove(
  context: ExecuteContext,
  command: 'copy' | 'move'
): Promise<unknown> {
  const entries = arrayValue(context.request.entries)
  const destination = record(context.request.destination, 'Destination folder')
  const ids = mutationIds(entries)
  const raw = assertMutationSettled(await context.invoke(context.invocationId, command, {
    ...(ids.fileIds.length ? { fileIds: ids.fileIds.join(',') } : {}),
    ...(ids.folderIds.length ? { folderIds: ids.folderIds.join(',') } : {}),
    targetFolderId: requiredString(destination, ['containerId'], 'Destination folder identity')
  }))
  const returnedItemPayload = first(raw, ['items', 'results'])
  const returnedItems = returnedItemPayload === undefined
    ? []
    : providerArray(returnedItemPayload, ['items', 'results'])
  if (
    command === 'move' &&
    (
      optionalNumber(raw, ['operationCount']) !== entries.length ||
      optionalNumber(raw, ['successCount']) !== entries.length
    )
  ) {
    throw new ProviderPayloadError(
      'provider_contract_violation',
      'OpenContent move receipt did not prove completion for every requested entry.'
    )
  }
  if (command === 'copy' && returnedItems.length !== entries.length) {
    throw new ProviderPayloadError(
      'provider_contract_violation',
      'OpenContent copy did not return every created entry identity.'
    )
  }
  const items = entries.map((sourceValue, index) => {
    const source = record(sourceValue, 'Source entry')
    if (command === 'move') return Object.freeze({ ok: true, source, result: source })
    const resultItem = record(returnedItems[index], 'Copied entry')
    const resultId = requiredString(resultItem, ['resultId', 'newId', 'fileId', 'folderId', 'id'], 'Copied entry identity')
    const result = providerKindForEntry(source) === 'file'
      ? fileReference(context.providerInstanceRef, resultId)
      : containerReference(context.providerInstanceRef, resultId)
    return Object.freeze({ ok: true, source, result })
  })
  return Object.freeze({ items: Object.freeze(items) })
}

async function executeDelete(context: ExecuteContext): Promise<unknown> {
  const entries = arrayValue(context.request.entries)
  const ids = mutationIds(entries)
  const raw = assertMutationSettled(await context.invoke(context.invocationId, 'delete', {
    ...(ids.fileIds.length ? { fileIds: ids.fileIds.join(',') } : {}),
    ...(ids.folderIds.length ? { folderIds: ids.folderIds.join(',') } : {})
  }))
  const operationCount = optionalNumber(raw, ['operationCount'])
  const successCount = optionalNumber(raw, ['successCount'])
  if (operationCount !== entries.length) {
    throw new ProviderPayloadError('provider_contract_violation', 'OpenContent deletion count does not match the request.')
  }
  if (successCount !== entries.length) {
    throw new ProviderPayloadError('outcome_unknown', 'OpenContent did not prove deletion of every requested entry.')
  }
  return Object.freeze({ deleted: Object.freeze([...entries]), failed: Object.freeze([]) })
}

async function executeCreateShortcut(context: ExecuteContext): Promise<unknown> {
  const target = record(context.request.target, 'Shortcut target')
  const destination = record(context.request.destination, 'Shortcut destination')
  if (typeof context.request.name !== 'string') {
    throw new ProviderPayloadError('invalid_input', 'A shortcut name is required; the adapter never guesses one.')
  }
  const raw = record(await context.invoke(context.invocationId, 'create-shortcut', {
    entryId: entryId(target),
    type: providerKindForEntry(target),
    parentId: requiredString(destination, ['containerId'], 'Shortcut destination identity'),
    name: context.request.name
  }), 'Shortcut receipt')
  const shortcutId = requiredString(raw, ['shortcutId', 'fileId', 'folderId', 'id'], 'Shortcut identity')
  return Object.freeze({
    target,
    destination,
    shortcut: providerKindForEntry(target) === 'file'
      ? fileReference(context.providerInstanceRef, shortcutId)
      : containerReference(context.providerInstanceRef, shortcutId)
  })
}

async function executeUpdateProperties(context: ExecuteContext): Promise<unknown> {
  const target = record(context.request.target, 'Property target')
  const changes = record(context.request.changes, 'Property changes')
  if (providerKindForEntry(target) === 'folder' && changes.securityLevel !== undefined) {
    throw new ProviderPayloadError('unsupported', 'OpenContent folders do not support security levels.')
  }
  const command = providerKindForEntry(target) === 'file' ? 'file-edit' : 'folder-edit'
  const args: Record<string, unknown> = {
    [command === 'file-edit' ? 'fileId' : 'folderId']: entryId(target)
  }
  if (changes.code !== undefined) args.code = changes.code ?? ''
  if (changes.remark !== undefined) args.remark = changes.remark ?? ''
  if (isRecord(changes.securityLevel)) args.levelId = changes.securityLevel.securityLevelId
  if (changes.securityLevel === null) args.levelId = 0
  await context.invoke(context.invocationId, command, args)
  return Object.freeze({
    target,
    changed: Object.freeze([
      ...(changes.code === undefined ? [] : ['code']),
      ...(changes.remark === undefined ? [] : ['remark']),
      ...(changes.securityLevel === undefined ? [] : ['security-level'])
    ])
  })
}

async function executeSecurityLevels(context: ExecuteContext): Promise<unknown> {
  const page = record(context.request.page, 'Security-level page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Security-level page limit')
  const raw = await context.invoke(context.invocationId, 'sec-level-list', {})
  const all = providerArray(raw, ['items', 'levels', 'data'])
  const start = (index - 1) * limit
  const items = all.slice(start, start + limit).map((candidate) => {
    const item = record(candidate, 'Security level')
    return Object.freeze({
      reference: Object.freeze({
        providerInstanceRef: context.providerInstanceRef,
        securityLevelId: requiredString(item, ['levelId', 'id'], 'Security-level identity')
      }),
      name: requiredString(item, ['levelName', 'name'], 'Security-level name'),
      ...(optionalNumber(item, ['rank', 'level']) === undefined ? {} : { rank: optionalNumber(item, ['rank', 'level']) })
    })
  })
  return Object.freeze({
    items: Object.freeze(items),
    ...(start + items.length < all.length ? { nextCursor: `ocpage_${index + 1}` } : {})
  })
}

function executeUpdateVersion(_context: ExecuteContext): never {
  throw new ProviderPayloadError(
    'blocked_by_contract',
    'OpenContent does not expose an atomic expected-version update contract.'
  )
}

async function executeExportPdf(context: ExecuteContext): Promise<unknown> {
  if (!context.destination) throw new ProviderPayloadError('destination_unavailable', 'The managed PDF destination is unavailable.')
  const reference = record(context.request.reference, 'PDF source')
  const fileId = requiredString(reference, ['fileId'], 'PDF source identity')
  const raw = record(await context.invoke(context.invocationId, 'download', {
    ...(context.request.versionId ? { ver_id: context.request.versionId } : { fileIds: fileId }),
    ispdfdownload: true
  }, [Object.freeze({
    role: 'destination',
    encoding: 'managed-stream',
    name: `${fileId}.pdf`,
    write: context.destination.write
  })]), 'PDF export receipt')
  const bytesWritten = requiredNumber(raw, ['bytesWritten', 'size'], 'Exported byte count')
  const digest = optionalString(raw, ['sha256', 'digest'])
  return Object.freeze({
    reference,
    format: 'pdf',
    bytesWritten,
    ...(digest && /^[a-f0-9]{64}$/u.test(digest)
      ? { digest: Object.freeze({ algorithm: 'sha256', value: digest }) }
      : {})
  })
}

async function executeListAttachments(context: ExecuteContext): Promise<unknown> {
  const master = record(context.request.master, 'Master file')
  const page = record(context.request.page, 'Attachment page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Attachment page limit')
  if (limit > 100) throw new ProviderPayloadError('bounds_exceeded', 'OpenContent attachment pages are limited to 100 items.')
  const raw = record(await context.invoke(context.invocationId, 'attach-list', {
    fileId: requiredString(master, ['fileId'], 'Master file identity'),
    pageNum: index,
    pageSize: limit
  }))
  const items = providerArray(first(raw, ['items', 'attachments', 'data']), ['items', 'attachments']).map((candidate) => {
    const item = record(candidate, 'Attachment')
    return Object.freeze({
      master,
      attachment: fileReference(
        context.providerInstanceRef,
        requiredString(item, ['fileId', 'id'], 'Attachment identity')
      ),
      name: requiredString(item, ['fileName', 'name'], 'Attachment name'),
      size: parseByteSize(first(item, ['size', 'fileSize'])),
      ...(normalizeTimestamp(first(item, ['createTime', 'addedAt']))
        ? { addedAt: normalizeTimestamp(first(item, ['createTime', 'addedAt'])) }
        : {})
    })
  })
  const total = optionalNumber(raw, ['total', 'totalCount'])
  return Object.freeze({
    master,
    items: Object.freeze(items),
    ...(nextCursor(total, index, limit) ? { nextCursor: nextCursor(total, index, limit) } : {})
  })
}

async function executeAddAttachment(context: ExecuteContext): Promise<unknown> {
  if (!context.source) throw new ProviderPayloadError('source_unavailable', 'The managed attachment source is unavailable.')
  const master = record(context.request.master, 'Master file')
  const name = requiredString(context.request, ['name'], 'Attachment name')
  const raw = record(await context.invoke(context.invocationId, 'upload', {
    masterFileId: requiredString(master, ['fileId'], 'Master file identity')
  }, [Object.freeze({
    role: 'source',
    encoding: 'managed-stream',
    name,
    size: context.source.size,
    read: context.source.read
  })]), 'Attachment upload receipt')
  const attachmentId = requiredString(raw, ['fileId', 'id'], 'Attachment identity')
  return Object.freeze({
    master,
    attachment: fileReference(context.providerInstanceRef, attachmentId),
    name,
    size: context.source.size,
    ...(normalizeTimestamp(first(raw, ['createTime', 'addedAt']))
      ? { addedAt: normalizeTimestamp(first(raw, ['createTime', 'addedAt'])) }
      : {})
  })
}

async function executeRemoveAttachment(context: ExecuteContext): Promise<unknown> {
  const master = record(context.request.master, 'Master file')
  const attachment = record(context.request.attachment, 'Attachment file')
  await context.invoke(context.invocationId, 'attach-remove', {
    attachFileIds: requiredString(attachment, ['fileId'], 'Attachment identity')
  })
  return Object.freeze({ master, attachment, removed: true })
}

function relationIdentity(sourceId: string, targetId: string): string {
  const identity = `${sourceId}:${targetId}`
  if (identity.length > 256) {
    throw new ProviderPayloadError('provider_contract_violation', 'The OpenContent relation identity exceeds the portable bound.')
  }
  return identity
}

async function executeListRelations(context: ExecuteContext): Promise<unknown> {
  const target = record(context.request.target, 'Relation target')
  const targetId = requiredString(target, ['fileId'], 'Relation target identity')
  const page = record(context.request.page, 'Relation page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Relation page limit')
  if (limit > 100) throw new ProviderPayloadError('bounds_exceeded', 'OpenContent relation pages are limited to 100 items.')
  const raw = record(await context.invoke(context.invocationId, 'relation-list', {
    fileId: targetId,
    pageNum: index,
    pageSize: limit
  }))
  const items = providerArray(first(raw, ['items', 'relations', 'data']), ['items', 'relations']).map((candidate) => {
    const item = record(candidate, 'Relation')
    const relatedId = requiredString(item, ['fileId', 'relatedFileId', 'id'], 'Related file identity')
    const main = booleanValue(first(item, ['mainRelate', 'isMain']), true)
    const source = main ? target : fileReference(context.providerInstanceRef, relatedId)
    const related = main ? fileReference(context.providerInstanceRef, relatedId) : target
    return Object.freeze({
      reference: Object.freeze({
        providerInstanceRef: context.providerInstanceRef,
        relationId: relationIdentity(
          requiredString(record(source), ['fileId'], 'Relation source identity'),
          requiredString(record(related), ['fileId'], 'Relation target identity')
        )
      }),
      source,
      target: related,
      kind: 'related'
    })
  })
  const total = optionalNumber(raw, ['total', 'totalCount'])
  return Object.freeze({
    target,
    items: Object.freeze(items),
    ...(nextCursor(total, index, limit) ? { nextCursor: nextCursor(total, index, limit) } : {})
  })
}

async function executeCreateRelation(context: ExecuteContext): Promise<unknown> {
  if (context.request.kind !== 'related' || context.request.label !== undefined) {
    throw new ProviderPayloadError(
      'unsupported',
      'The attachment CLI supports only unlabeled related-file relations.'
    )
  }
  const source = record(context.request.source, 'Relation source')
  const target = record(context.request.target, 'Relation target')
  const sourceId = requiredString(source, ['fileId'], 'Relation source identity')
  const targetId = requiredString(target, ['fileId'], 'Relation target identity')
  await context.invoke(context.invocationId, 'relation-create', {
    fileIds: sourceId,
    relatedFileIds: targetId
  })
  return Object.freeze({
    reference: Object.freeze({
      providerInstanceRef: context.providerInstanceRef,
      relationId: relationIdentity(sourceId, targetId)
    }),
    source,
    target,
    kind: 'related'
  })
}

async function executeRemoveRelation(context: ExecuteContext): Promise<unknown> {
  const relation = record(context.request.relation, 'Relation')
  const source = record(relation.source, 'Relation source')
  const target = record(relation.target, 'Relation target')
  await context.invoke(context.invocationId, 'relation-remove', {
    fileId: requiredString(source, ['fileId'], 'Relation source identity'),
    relatedFileId: requiredString(target, ['fileId'], 'Relation target identity')
  })
  return Object.freeze({ relation: record(relation.reference, 'Relation reference'), removed: true })
}

async function executeListTags(context: ExecuteContext): Promise<unknown> {
  const target = record(context.request.target, 'Tag target')
  const page = record(context.request.page, 'Tag page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Tag page limit')
  const raw = record(await context.invoke(context.invocationId, 'file-tag-list', {
    fileId: requiredString(target, ['fileId'], 'Tag target identity')
  }))
  const all = providerArray(first(raw, ['items', 'tags', 'data']), ['items', 'tags'])
  const start = (index - 1) * limit
  const items = all.slice(start, start + limit).map((candidate) => {
    const item = record(candidate, 'File tag')
    return Object.freeze({
      reference: Object.freeze({
        providerInstanceRef: context.providerInstanceRef,
        tagId: requiredString(item, ['tagId', 'id'], 'Tag identity')
      }),
      name: requiredString(item, ['tagName', 'name'], 'Tag name')
    })
  })
  return Object.freeze({
    target,
    items: Object.freeze(items),
    ...(start + items.length < all.length ? { nextCursor: `ocpage_${index + 1}` } : {})
  })
}

async function executeSetTags(context: ExecuteContext): Promise<unknown> {
  const targets = arrayValue(context.request.targets).map((candidate) => record(candidate, 'Tag target'))
  const names = arrayValue(context.request.names).map((candidate) => String(candidate))
  await context.invoke(context.invocationId, 'file-tag-set', {
    fileIds: targets.map((target) => requiredString(target, ['fileId'], 'Tag target identity')).join(','),
    tags: names.join(',')
  })
  return Object.freeze({ targets: Object.freeze(targets), names: Object.freeze(names) })
}

async function executeRemoveTags(context: ExecuteContext): Promise<unknown> {
  const targets = arrayValue(context.request.targets).map((candidate) => record(candidate, 'Tag target'))
  if (targets.length !== 1) {
    throw new ProviderPayloadError(
      'bounds_exceeded',
      'OpenContent removes tag identities from exactly one file per atomic write.'
    )
  }
  const tags = arrayValue(context.request.tags).map((candidate) => record(candidate, 'Tag reference'))
  await context.invoke(context.invocationId, 'file-tag-delete', {
    fileId: requiredString(targets[0] ?? {}, ['fileId'], 'Tag target identity'),
    tagIds: tags.map((tag) => requiredString(tag, ['tagId'], 'Tag identity')).join(',')
  })
  return Object.freeze({ targets: Object.freeze(targets), tags: Object.freeze(tags) })
}

function publicationDays(expiry: Record<string, unknown>, now: Date): number {
  if (expiry.kind !== 'expires-at' || typeof expiry.expiresAt !== 'string') {
    throw new ProviderPayloadError('unsupported', 'OpenContent publication links require a finite expiry.')
  }
  const remaining = Date.parse(expiry.expiresAt) - now.getTime()
  if (!Number.isFinite(remaining) || remaining <= 0) {
    throw new ProviderPayloadError('invalid_input', 'Publication expiry must be in the future.')
  }
  return Math.max(1, Math.ceil(remaining / 86_400_000))
}

async function executeCreatePublication(context: ExecuteContext): Promise<unknown> {
  const permissions = arrayValue(context.request.permissions)
  if (!permissions.includes('preview') || permissions.includes('print')) {
    throw new ProviderPayloadError(
      'unsupported',
      'OpenContent publication exposes preview and optional download; print cannot be controlled independently.'
    )
  }
  const targets = arrayValue(context.request.targets).map((candidate) => record(candidate, 'Publication target'))
  const ids = mutationIds(targets)
  if (ids.fileIds.length > 0 && ids.folderIds.length > 0) {
    throw new ProviderPayloadError('unsupported', 'OpenContent cannot publish mixed file and folder targets atomically.')
  }
  const expiry = record(context.request.expiry, 'Publication expiry')
  const raw = record(await context.invoke(context.invocationId, 'publish', {
    ...(ids.fileIds.length ? { fileId: ids.fileIds.join(',') } : { folderId: ids.folderIds.join(',') }),
    days: publicationDays(expiry, context.now()),
    name: context.request.name,
    canDownload: permissions.includes('download')
  }), 'Publication receipt')
  const publicationId = requiredString(raw, ['code', 'Publish_Code', 'publicationId'], 'Publication identity')
  const link = optionalString(raw, ['link', 'url'])
  const observedExpiry = normalizeTimestamp(first(raw, ['endDate', 'Publish_EndTime']))
  if (!observedExpiry) {
    throw new ProviderPayloadError(
      'provider_contract_violation',
      'OpenContent did not prove the publication expiry after converting it to Provider days.'
    )
  }
  return Object.freeze({
    observation: 'complete',
    reference: Object.freeze({ providerInstanceRef: context.providerInstanceRef, publicationId }),
    name: context.request.name,
    targets: Object.freeze(targets),
    permissions: Object.freeze([...permissions]),
    expiry: Object.freeze({ kind: 'expires-at', expiresAt: observedExpiry }),
    ...(link
      ? { accessTarget: Object.freeze({ url: link, expiresAt: new Date(context.now().getTime() + 5 * 60_000).toISOString() }) }
      : {})
  })
}

async function executeListPublications(context: ExecuteContext): Promise<unknown> {
  const page = record(context.request.page, 'Publication page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Publication page limit')
  if (limit > 100) throw new ProviderPayloadError('bounds_exceeded', 'OpenContent publication pages are limited to 100 items.')
  const raw = record(await context.invoke(context.invocationId, 'my-publish-list', {
    pageNum: index,
    pageSize: limit,
    ...(context.request.query ? { keyWord: context.request.query } : {})
  }))
  const items = providerArray(first(raw, ['items', 'publishList', 'data']), ['items', 'publishList']).map((candidate) => {
    const item = record(candidate, 'Publication')
    const end = normalizeTimestamp(first(item, ['Publish_EndTime', 'endDate']))
    return Object.freeze({
      observation: 'partial',
      reference: Object.freeze({
        providerInstanceRef: context.providerInstanceRef,
        publicationId: requiredString(item, ['Publish_Code', 'code', 'publicationId'], 'Publication identity')
      }),
      ...(optionalString(item, ['Publish_Name', 'name']) ? { name: optionalString(item, ['Publish_Name', 'name']) } : {}),
      ...(end ? { expiry: Object.freeze({ kind: 'expires-at', expiresAt: end }) } : {})
    })
  })
  const total = optionalNumber(raw, ['totalCount', 'total'])
  return Object.freeze({
    items: Object.freeze(items),
    ...(nextCursor(total, index, limit) ? { nextCursor: nextCursor(total, index, limit) } : {})
  })
}

async function executeCancelPublications(context: ExecuteContext): Promise<unknown> {
  const publications = arrayValue(context.request.publications).map((candidate) => record(candidate, 'Publication reference'))
  await context.invoke(context.invocationId, 'cancel-publish', {
    codes: publications.map((item) => requiredString(item, ['publicationId'], 'Publication identity')).join('|')
  })
  return Object.freeze({ cancelled: Object.freeze(publications) })
}

function sharePower(permissions: readonly unknown[]): number {
  const set = new Set(permissions)
  const exactly = (...values: string[]) => set.size === values.length && values.every((value) => set.has(value))
  if (exactly('preview')) return 0
  if (exactly('preview', 'print')) return 4
  if (exactly('preview', 'print', 'download')) return 7
  if (exactly('preview', 'print', 'download', 'edit')) return 15
  throw new ProviderPayloadError('unsupported', 'OpenContent supports only its four cumulative share permission profiles.')
}

function shareMemberType(kind: unknown): number {
  if (kind === 'group') return 3
  if (kind === 'position') return 4
  if (kind === 'department') return 5
  return 0
}

async function executeCreateShare(context: ExecuteContext): Promise<unknown> {
  const targets = arrayValue(context.request.targets).map((candidate) => record(candidate, 'Share target'))
  const recipients = arrayValue(context.request.recipients).map((candidate) => record(candidate, 'Share recipient'))
  const kinds = new Set(targets.map(providerKindForEntry))
  if (kinds.size !== 1) throw new ProviderPayloadError('unsupported', 'OpenContent cannot share mixed files and folders atomically.')
  const permissions = arrayValue(context.request.permissions)
  const expiry = record(context.request.expiry, 'Share expiry')
  const args: Record<string, unknown> = {
    entrys: targets.map((target) => `${entryId(target)},${providerKindForEntry(target) === 'file' ? 2 : 1}`).join(';'),
    member: recipients.map((principal) => `${requiredString(principal, ['principalId'], 'Share recipient identity')},${shareMemberType(principal.kind)}`).join(';'),
    shareName: context.request.name,
    power: sharePower(permissions),
    sendMail: context.request.notifyRecipients,
    dateType: expiry.kind === 'permanent' ? 'Permanent' : 'SpecifyTime'
  }
  if (expiry.kind === 'expires-at' && typeof expiry.expiresAt === 'string') {
    args.end = expiry.expiresAt.replace('T', ' ').replace(/\.\d{3}Z$/u, '')
  }
  const raw = record(await context.invoke(context.invocationId, 'create-share', args), 'Share receipt')
  const shareId = requiredString(raw, ['shareId', 'id'], 'Share identity')
  return Object.freeze({
    observation: 'complete',
    reference: Object.freeze({ providerInstanceRef: context.providerInstanceRef, shareId }),
    name: context.request.name,
    targets: Object.freeze(targets),
    recipients: Object.freeze(recipients),
    permissions: Object.freeze([...permissions]),
    expiry
  })
}

async function executeListShares(context: ExecuteContext): Promise<unknown> {
  const page = record(context.request.page, 'Share page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Share page limit')
  if (limit > 100) throw new ProviderPayloadError('bounds_exceeded', 'OpenContent share pages are limited to 100 items.')
  const raw = record(await context.invoke(context.invocationId, 'my-share-list', {
    pageNum: index,
    pageSize: limit,
    ...(context.request.query ? { keyWord: context.request.query } : {})
  }))
  const items = providerArray(first(raw, ['items', 'shareList', 'data']), ['items', 'shareList']).map((candidate) => {
    const item = record(candidate, 'Share')
    return Object.freeze({
      observation: 'partial',
      reference: Object.freeze({
        providerInstanceRef: context.providerInstanceRef,
        shareId: requiredString(item, ['shareId', 'id'], 'Share identity')
      }),
      ...(optionalString(item, ['shareName', 'name']) ? { name: optionalString(item, ['shareName', 'name']) } : {})
    })
  })
  const total = optionalNumber(raw, ['totalCount', 'total'])
  return Object.freeze({
    items: Object.freeze(items),
    ...(nextCursor(total, index, limit) ? { nextCursor: nextCursor(total, index, limit) } : {})
  })
}

async function executeCancelShares(context: ExecuteContext): Promise<unknown> {
  const shares = arrayValue(context.request.shares).map((candidate) => record(candidate, 'Share reference'))
  await context.invoke(context.invocationId, 'cancel-share', {
    shareIds: shares.map((item) => requiredString(item, ['shareId'], 'Share identity')).join(',')
  })
  return Object.freeze({ cancelled: Object.freeze(shares) })
}

async function executeListAlbums(context: ExecuteContext): Promise<unknown> {
  const page = record(context.request.page, 'Album page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Album page limit')
  if (limit > 100) throw new ProviderPayloadError('bounds_exceeded', 'OpenContent album pages are limited to 100 items.')
  const raw = record(await context.invoke(context.invocationId, 'albums', {
    pageNumber: index,
    pageSize: limit,
    ...(context.request.query ? { keyword: context.request.query } : {})
  }))
  const items = providerArray(first(raw, ['albums', 'items', 'data']), ['albums', 'items']).map((candidate) => {
    const item = record(candidate, 'Album')
    return Object.freeze({
      reference: Object.freeze({
        providerInstanceRef: context.providerInstanceRef,
        albumId: requiredString(item, ['fsId', 'albumId', 'id'], 'Album identity')
      }),
      name: requiredString(item, ['name', 'albumName'], 'Album name'),
      entryCount: (optionalNumber(item, ['fileCount']) ?? 0) + (optionalNumber(item, ['folderCount']) ?? 0),
      isDefault: booleanValue(first(item, ['isDefault', 'default']))
    })
  })
  const total = optionalNumber(raw, ['totalCount', 'total'])
  return Object.freeze({
    items: Object.freeze(items),
    ...(nextCursor(total, index, limit) ? { nextCursor: nextCursor(total, index, limit) } : {})
  })
}

async function albumFiles(
  context: ExecuteContext,
  albumId: string,
  pageIndex: number,
  pageSize: number,
  invocationIndex: number
): Promise<Readonly<{ raw: Record<string, unknown>; items: readonly unknown[] }>> {
  const raw = record(await context.invoke(
    invocationIndex === 0 ? context.invocationId : compositionInvocationId(context.invocationId, invocationIndex),
    'album-files',
    { fsId: albumId, pageNumber: pageIndex, pageSize }
  ))
  return Object.freeze({
    raw,
    items: providerArray(first(raw, ['files', 'items', 'data']), ['files', 'items'])
  })
}

async function executeListAlbumEntries(context: ExecuteContext): Promise<unknown> {
  const album = record(context.request.album, 'Album reference')
  const albumId = requiredString(album, ['albumId'], 'Album identity')
  const page = record(context.request.page, 'Album-entry page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Album-entry page limit')
  if (limit > 100) throw new ProviderPayloadError('bounds_exceeded', 'OpenContent album-entry pages are limited to 100 items.')
  const response = await albumFiles(context, albumId, index, limit, 0)
  const items: unknown[] = []
  for (const [itemIndex, candidate] of response.items.entries()) {
    const item = record(candidate, 'Favorite entry')
    const id = requiredString(item, ['fileId', 'id'], 'Favorite entry identity')
    const kind = String(first(item, ['type', 'entryType']) ?? '2') === '1' ? 'container' : 'file'
    const info = await observeEntryInfo(
      context,
      kind === 'file'
        ? fileReference(context.providerInstanceRef, id)
        : containerReference(context.providerInstanceRef, id),
      itemIndex + 1
    )
    items.push(Object.freeze({
      favoriteId: requiredString(item, ['fvId', 'favoriteId'], 'Favorite identity'),
      entry: info
    }))
  }
  const total = optionalNumber(response.raw, ['totalCount', 'total'])
  return Object.freeze({
    album,
    items: Object.freeze(items),
    ...(nextCursor(total, index, limit) ? { nextCursor: nextCursor(total, index, limit) } : {})
  })
}

async function executeAddFavorite(context: ExecuteContext): Promise<unknown> {
  const album = record(context.request.album, 'Album reference')
  const entries = arrayValue(context.request.entries).map((candidate) => record(candidate, 'Favorite entry'))
  const kinds = new Set(entries.map(providerKindForEntry))
  if (kinds.size !== 1) throw new ProviderPayloadError('unsupported', 'OpenContent favorites must contain one entry kind per write.')
  await context.invoke(context.invocationId, 'favorite-add', {
    fsId: requiredString(album, ['albumId'], 'Album identity'),
    ids: entries.map(entryId).join(','),
    types: providerKindForEntry(entries[0] ?? {}) === 'file' ? '2' : '1'
  })
  return Object.freeze({ album, entries: Object.freeze(entries) })
}

async function executeRemoveFavorite(context: ExecuteContext): Promise<unknown> {
  const album = record(context.request.album, 'Album reference')
  const albumId = requiredString(album, ['albumId'], 'Album identity')
  const response = await albumFiles(context, albumId, 1, 100, 1)
  let favoriteId: string
  let entry: Record<string, unknown>
  if (context.request.by === 'favorite') {
    const ids = arrayValue(context.request.favoriteIds)
    if (ids.length !== 1) {
      throw new ProviderPayloadError('bounds_exceeded', 'OpenContent removes exactly one favorite per atomic write.')
    }
    favoriteId = String(ids[0])
    const found = response.items.map((candidate) => record(candidate)).find((item) =>
      optionalString(item, ['fvId', 'favoriteId']) === favoriteId
    )
    if (!found) throw new ProviderPayloadError('invalid_reference', 'The favorite is not present in the selected album page.')
    const fileId = requiredString(found, ['fileId', 'id'], 'Favorite entry identity')
    entry = String(first(found, ['type', 'entryType']) ?? '2') === '1'
      ? containerReference(context.providerInstanceRef, fileId)
      : fileReference(context.providerInstanceRef, fileId)
  } else {
    const entries = arrayValue(context.request.entries).map((candidate) => record(candidate, 'Favorite entry'))
    if (entries.length !== 1) {
      throw new ProviderPayloadError('bounds_exceeded', 'OpenContent removes exactly one favorite per atomic write.')
    }
    entry = entries[0] ?? {}
    const found = response.items.map((candidate) => record(candidate)).find((item) =>
      optionalString(item, ['fileId', 'id']) === entryId(entry)
    )
    if (!found) throw new ProviderPayloadError('invalid_reference', 'The entry is not a favorite in the selected album page.')
    favoriteId = requiredString(found, ['fvId', 'favoriteId'], 'Favorite identity')
  }
  await context.invoke(context.invocationId, 'favorite-remove', { fvId: favoriteId })
  return Object.freeze({ album, entries: Object.freeze([entry]) })
}

async function executeCurrentPrincipal(context: ExecuteContext): Promise<unknown> {
  const raw = record(await context.invoke(context.invocationId, 'user-info', {}), 'Current user')
  return directoryPrincipal(context.providerInstanceRef, 'user', raw)
}

async function executePrincipalSearch(
  context: ExecuteContext,
  kind: 'user' | 'department' | 'position' | 'group'
): Promise<unknown> {
  const page = record(context.request.page, 'Directory page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Directory page limit')
  if (limit > 100) throw new ProviderPayloadError('bounds_exceeded', 'OpenContent directory pages are limited to 100 items.')
  const command = kind === 'user'
    ? 'search-user'
    : kind === 'department' ? 'search-department' : kind === 'position' ? 'search-position' : 'search-user-group'
  const args: Record<string, unknown> = kind === 'group'
    ? { groupName: context.request.query }
    : { keyword: context.request.query }
  if (kind === 'user') {
    args.pageIndex = index
    args.pageSize = limit
    if (isRecord(context.request.within)) {
      const principal = record(context.request.within.principal, 'Directory scope')
      args.orgType = context.request.within.kind === 'department' ? 2 : 4
      args.orgId = requiredString(principal, ['principalId'], 'Directory scope identity')
      args.recursive = context.request.within.recursive
    }
  } else if (index !== 1) {
    throw new ProviderPayloadError('bounds_exceeded', 'This OpenContent directory search has no stable continuation cursor.')
  }
  const raw = await context.invoke(context.invocationId, command, args)
  const payload = isRecord(raw) ? raw : {}
  const candidates = providerArray(raw, ['items', 'users', 'departments', 'positions', 'groups', 'data'])
  const sliced = kind === 'user' ? candidates : candidates.slice(0, limit)
  const items = sliced.map((candidate) => directoryPrincipal(context.providerInstanceRef, kind, record(candidate)))
  const total = optionalNumber(payload, ['totalCount', 'total'])
  return Object.freeze({
    items: Object.freeze(items),
    ...(nextCursor(total, index, limit) ? { nextCursor: nextCursor(total, index, limit) } : {})
  })
}

async function executePermissionCategories(context: ExecuteContext): Promise<unknown> {
  const targetKindValue = context.request.targetKind
  const raw = await context.invoke(context.invocationId, 'perm-cates', {
    type: targetKind(targetKindValue)
  })
  const items = providerArray(raw, ['items', 'categories', 'data']).map((candidate) => {
    const item = record(candidate, 'Permission category')
    return Object.freeze({
      reference: Object.freeze({
        providerInstanceRef: context.providerInstanceRef,
        targetKind: targetKindValue,
        categoryId: requiredString(item, ['cateId', 'categoryId', 'id'], 'Permission category identity')
      }),
      name: requiredString(item, ['name', 'cateName'], 'Permission category name'),
      ...(optionalString(item, ['summary', 'description']) ? { summary: optionalString(item, ['summary', 'description']) } : {})
    })
  })
  return Object.freeze({ items: Object.freeze(items) })
}

function permissionSource(value: unknown): 'direct' | 'inherited' | 'self' | 'administrator' {
  const state = Number(value)
  if (state === 1) return 'inherited'
  if (state === 3) return 'self'
  if (state === 4) return 'administrator'
  return 'direct'
}

async function executeListPermissions(context: ExecuteContext): Promise<unknown> {
  const target = record(context.request.target, 'Permission target')
  const kind = context.request.targetKind
  const raw = await context.invoke(context.invocationId, 'perm-list', {
    id: entryId(target),
    type: targetKind(kind)
  })
  const items = providerArray(raw, ['items', 'permissions', 'data']).map((candidate) => {
    const item = record(candidate, 'Permission assignment')
    const principalKind = memberKind(first(item, ['memberType']))
    return Object.freeze({
      target,
      principal: Object.freeze({
        providerInstanceRef: context.providerInstanceRef,
        kind: principalKind,
        principalId: requiredString(item, ['memberId'], 'Permission principal identity')
      }),
      category: Object.freeze({
        providerInstanceRef: context.providerInstanceRef,
        targetKind: kind,
        categoryId: requiredString(item, ['permCateId'], 'Permission category identity')
      }),
      source: permissionSource(first(item, ['state'])),
      ...(normalizeTimestamp(first(item, ['startTime'])) ? { startsAt: normalizeTimestamp(first(item, ['startTime'])) } : {}),
      ...(normalizeTimestamp(first(item, ['expiredTime'])) ? { expiresAt: normalizeTimestamp(first(item, ['expiredTime'])) } : {})
    })
  })
  return Object.freeze({ target, items: Object.freeze(items) })
}

async function executeChangePermissions(context: ExecuteContext): Promise<unknown> {
  const target = record(context.request.target, 'Permission target')
  const kind = context.request.targetKind
  const changes = arrayValue(context.request.changes).map((candidate) => record(candidate, 'Permission change'))
  const args: Record<string, unknown> = { id: entryId(target), type: targetKind(kind) }
  const buckets: Record<string, unknown[]> = {
    newPermissions: [],
    changePermissions: [],
    deletePermissions: []
  }
  for (const change of changes) {
    const principal = record(change.principal, 'Permission principal')
    const common = {
      memberId: requiredString(principal, ['principalId'], 'Permission principal identity'),
      memberType: principalMemberType(principal.kind)
    }
    if (change.action === 'remove') {
      buckets.deletePermissions?.push(common)
      continue
    }
    const category = record(change.category, 'Permission category')
    const item = {
      ...common,
      permCateId: requiredString(category, ['categoryId'], 'Permission category identity'),
      ...(change.startsAt ? { startTime: change.startsAt } : {}),
      ...(change.expiresAt ? { expiredTime: change.expiresAt } : {})
    }
    buckets[change.action === 'add' ? 'newPermissions' : 'changePermissions']?.push(item)
  }
  for (const [key, values] of Object.entries(buckets)) if (values.length > 0) args[key] = values
  await context.invoke(context.invocationId, 'perm-set', args)
  return Object.freeze({ target, applied: changes.length })
}

function collaborationFilter(value: unknown): number {
  if (value === 'owned') return 1
  if (value === 'assisting') return 2
  if (value === 'unread') return 3
  if (value === 'commented') return 4
  return -1
}

async function executeCollaborationList(context: ExecuteContext, search: boolean): Promise<unknown> {
  const page = record(context.request.page, 'Collaboration page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Collaboration page limit')
  if (limit > 100) throw new ProviderPayloadError('bounds_exceeded', 'OpenContent collaboration pages are limited to 100 items.')
  const raw = record(await context.invoke(context.invocationId, search ? 'collab-search' : 'collab-list', {
    ...(search ? { keyword: context.request.query } : { docType: collaborationFilter(context.request.filter) }),
    pageNum: index,
    pageSize: limit
  }))
  const items = providerArray(first(raw, ['data', 'items']), ['items']).map((candidate) => {
    const item = record(candidate, 'Collaboration entry')
    const ownerId = requiredString(item, ['DocflowFileCreateUserId', 'creatorId', 'ownerId'], 'Collaboration owner identity')
    const ownerName = requiredString(item, ['DocflowFileCreateUserName', 'creatorName', 'ownerName'], 'Collaboration owner name')
    const createdAt = normalizeTimestamp(first(item, ['DocflowCreateTime', 'createTime']))
    if (!createdAt) throw new ProviderPayloadError('provider_contract_violation', 'Collaboration creation time is invalid.')
    return Object.freeze({
      file: fileReference(context.providerInstanceRef, requiredString(item, ['FileId', 'fileId'], 'Collaboration file identity')),
      name: requiredString(item, ['DocflowFileName', 'fileName'], 'Collaboration file name'),
      createdAt,
      owner: directoryPrincipal(context.providerInstanceRef, 'user', { identityId: ownerId, name: ownerName }),
      read: booleanValue(first(item, ['DocflowRead', 'read'])),
      deleted: booleanValue(first(item, ['isDeleted', 'deleted']))
    })
  })
  const total = optionalNumber(raw, ['allCount', 'totalCount', 'total'])
  return Object.freeze({
    items: Object.freeze(items),
    ...(nextCursor(total, index, limit) ? { nextCursor: nextCursor(total, index, limit) } : {})
  })
}

async function executeCollaborationLink(context: ExecuteContext): Promise<unknown> {
  const file = record(context.request.file, 'Collaboration file')
  const raw = await context.invoke(context.invocationId, 'collab-link', {
    fileId: requiredString(file, ['fileId'], 'Collaboration file identity')
  })
  const text = typeof raw === 'string'
    ? raw
    : requiredString(record(raw), ['url', 'link', 'invitation'], 'Collaboration link')
  const url = text.match(/https:\/\/[^\s]+/u)?.[0]
  if (!url) throw new ProviderPayloadError('provider_contract_violation', 'OpenContent did not return an HTTPS collaboration link.')
  return Object.freeze({
    file,
    target: Object.freeze({
      url,
      expiresAt: new Date(context.now().getTime() + 5 * 60_000).toISOString()
    })
  })
}

async function executeKnowledgeCollections(context: ExecuteContext, search: boolean): Promise<unknown> {
  const page = record(context.request.page, 'Knowledge page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Knowledge page limit')
  if (limit > 100) throw new ProviderPayloadError('bounds_exceeded', 'OpenContent knowledge pages are limited to 100 items.')
  const raw = record(await context.invoke(context.invocationId, 'kbox-list', {
    ...(search ? { keyword: context.request.query } : {}),
    pageNumber: index,
    pageSize: limit
  }))
  const items = providerArray(first(raw, ['items', 'boxes', 'data']), ['items', 'boxes']).map((candidate) => {
    const item = record(candidate, 'Knowledge collection')
    return Object.freeze({
      reference: Object.freeze({
        providerInstanceRef: context.providerInstanceRef,
        collectionId: requiredString(item, ['boxId', 'id'], 'Knowledge collection identity')
      }),
      name: requiredString(item, ['boxName', 'name'], 'Knowledge collection name'),
      ...(optionalString(item, ['boxDescription', 'description']) ? { description: optionalString(item, ['boxDescription', 'description']) } : {}),
      root: containerReference(context.providerInstanceRef, requiredString(item, ['folderId'], 'Knowledge root identity')),
      status: String(first(item, ['boxStatus', 'status']) ?? '').toLowerCase() === 'online' ? 'active' : 'inactive'
    })
  })
  const total = optionalNumber(raw, ['totalCount', 'total'])
  return Object.freeze({
    items: Object.freeze(items),
    ...(nextCursor(total, index, limit) ? { nextCursor: nextCursor(total, index, limit) } : {})
  })
}

async function executeBrowseKnowledge(context: ExecuteContext): Promise<unknown> {
  const collection = record(context.request.collection, 'Knowledge collection')
  let parent: Record<string, unknown>
  if (isRecord(context.request.parent)) {
    parent = context.request.parent
  } else {
    const collectionId = requiredString(collection, ['collectionId'], 'Knowledge collection identity')
    const observed = record(await context.invoke(
      compositionInvocationId(context.invocationId, 1),
      'kbox-list',
      { pageNumber: 1, pageSize: 100 }
    ), 'Knowledge collections')
    const match = providerArray(first(observed, ['items', 'boxes', 'data']), ['items', 'boxes'])
      .map((candidate) => record(candidate, 'Knowledge collection'))
      .find((candidate) => optionalString(candidate, ['boxId', 'id']) === collectionId)
    if (!match) throw new ProviderPayloadError('invalid_reference', 'The knowledge collection root is unavailable.')
    parent = containerReference(
      context.providerInstanceRef,
      requiredString(match, ['folderId'], 'Knowledge root identity')
    )
  }
  const page = record(context.request.page, 'Knowledge browse page')
  const index = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Knowledge browse page limit')
  if (limit > 100) throw new ProviderPayloadError('bounds_exceeded', 'OpenContent folder pages are limited to 100 items.')
  const raw = record(await context.invoke(context.invocationId, 'file-list', {
    folderId: requiredString(parent, ['containerId'], 'Knowledge folder identity'),
    pageNum: index,
    pageSize: limit
  }))
  const candidates = providerArray(first(raw, ['items', 'data']), ['items'])
  const items: unknown[] = []
  for (const [itemIndex, candidate] of candidates.entries()) {
    const item = record(candidate, 'Knowledge entry')
    const id = requiredString(item, ['id', 'fileId', 'folderId'], 'Knowledge entry identity')
    items.push(await observeEntryInfo(
      context,
      optionalString(item, ['type', 'kind']) === 'folder'
        ? containerReference(context.providerInstanceRef, id)
        : fileReference(context.providerInstanceRef, id),
      itemIndex + 1
    ))
  }
  const total = optionalNumber(raw, ['totalCount', 'total'])
  return Object.freeze({
    items: Object.freeze(items),
    ...(nextCursor(total, index, limit) ? { nextCursor: nextCursor(total, index, limit) } : {})
  })
}

async function executeTeamMemberRole(context: ExecuteContext): Promise<unknown> {
  if (!context.teamGovernance) throw new ProviderPayloadError('blocked_by_contract', 'Team governance is unavailable.')
  const teamRoot = record(context.request.teamRoot, 'Team root')
  const member = record(context.request.member, 'Team member')
  await context.teamGovernance.updateMemberRole({
    invocationId: context.invocationId,
    teamRootId: requiredString(teamRoot, ['containerId'], 'Team root identity'),
    memberPrincipalId: requiredString(member, ['principalId'], 'Team member identity'),
    userType: teamUserType(context.request.role)
  })
  return Object.freeze({ teamRoot, member, role: context.request.role })
}

function teamUserType(role: unknown): 2 | 3 | 4 {
  switch (role) {
    case 'manager': return 2
    case 'internal': return 3
    case 'external': return 4
    default: throw new ProviderPayloadError('invalid_input', 'Unknown Team member role.')
  }
}

async function executeTeamOwnership(context: ExecuteContext): Promise<unknown> {
  if (!context.teamGovernance) throw new ProviderPayloadError('blocked_by_contract', 'Team governance is unavailable.')
  const teamRoot = record(context.request.teamRoot, 'Team root')
  const owner = record(context.request.newOwner, 'New team owner')
  await context.teamGovernance.transferOwnership({
    invocationId: context.invocationId,
    teamRootId: requiredString(teamRoot, ['containerId'], 'Team root identity'),
    newOwnerPrincipalId: requiredString(owner, ['principalId'], 'Team owner identity')
  })
  return Object.freeze({ teamRoot, owner })
}
