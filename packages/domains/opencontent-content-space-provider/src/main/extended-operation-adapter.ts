import { z } from 'zod'

import {
  CONTENT_SPACE_EXTENDED_OPERATION_CONTRACTS,
  contentSpaceExtendedErrorCodeSchema,
  type ContentSpaceExtendedErrorCode,
  type ContentSpaceExtendedOperationKey
} from '@sciforge/domain-content-space/extended-operations-contract'
import { contentSpaceInvocationIdSchema } from '@sciforge/domain-content-space/contract'

import {
  isOpenContentSupplierMutationCommand,
  openContentExtendedCommandInvocationSchema,
  openContentExtendedCommandSuccessSchema,
  type OpenContentExtendedCommandTransport,
  type OpenContentExtendedDataFile,
  type OpenContentExtendedOperationCommand,
  type OpenContentExtendedUploadSource
} from '@sciforge/domain-opencontent-connector/main-contract'
import {
  openContentIdentityIdSchema,
  type OpenContentIdentityId
} from '@sciforge/domain-opencontent-connector/team-administration-contract'

export interface OpenContentCurrentPrincipalPort {
  currentIdentityId(): Promise<OpenContentIdentityId>
}

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

function canonicalResponseField(
  recordValue: Record<string, unknown>,
  canonicalKey: string,
  rejectedKeys: readonly string[] = []
): unknown {
  for (const rejectedKey of rejectedKeys) {
    if (Object.hasOwn(recordValue, rejectedKey)) {
      throw new ProviderPayloadError(
        'provider_contract_violation',
        `OpenContent returned unsupported response field ${rejectedKey}.`
      )
    }
  }
  return recordValue[canonicalKey]
}

function requiredString(
  recordValue: Record<string, unknown>,
  keys: readonly string[],
  label: string
): string {
  const [canonicalKey, ...rejectedKeys] = keys
  const value = canonicalKey === undefined
    ? undefined
    : canonicalResponseField(recordValue, canonicalKey, rejectedKeys)
  if (typeof value !== 'string' || value === '' || value !== value.trim()) {
    throw new ProviderPayloadError('provider_contract_violation', `${label} is missing.`)
  }
  return value
}

function responseString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value === '' || value !== value.trim()) {
    throw new ProviderPayloadError('provider_contract_violation', `${label} is missing or invalid.`)
  }
  return value
}

function supplierNumericOrStringId(value: unknown, label: string): string {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return String(value)
  }
  return responseString(value, label)
}

function exactResponseResourceGuid(
  payload: Record<string, unknown>,
  requestedResourceGuid: string,
  canonicalKey: 'fileGuid' | 'folderGuid',
  rejectedKeys: readonly string[],
  label: string
): string {
  const canonicalResourceGuid = requiredString(payload, [canonicalKey, ...rejectedKeys], label)
  if (canonicalResourceGuid !== requestedResourceGuid) {
    throw new ProviderPayloadError(
      'provider_contract_violation',
      `${label} does not match the requested resource.`
    )
  }
  return requestedResourceGuid
}

function optionalString(
  recordValue: Record<string, unknown>,
  keys: readonly string[]
): string | undefined {
  const [canonicalKey, ...rejectedKeys] = keys
  const value = canonicalKey === undefined
    ? undefined
    : canonicalResponseField(recordValue, canonicalKey, rejectedKeys)
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value === '' || value !== value.trim()) {
    throw new ProviderPayloadError(
      'provider_contract_violation',
      `OpenContent response field ${canonicalKey ?? '(missing)'} must be a non-empty string.`
    )
  }
  return value
}

function requiredNumber(
  recordValue: Record<string, unknown>,
  keys: readonly string[],
  label: string
): number {
  const [canonicalKey, ...rejectedKeys] = keys
  const value = canonicalKey === undefined
    ? undefined
    : canonicalResponseField(recordValue, canonicalKey, rejectedKeys)
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderPayloadError('provider_contract_violation', `${label} is missing or invalid.`)
  }
  return value
}

function optionalNumber(
  recordValue: Record<string, unknown>,
  keys: readonly string[]
): number | undefined {
  const [canonicalKey, ...rejectedKeys] = keys
  const value = canonicalKey === undefined
    ? undefined
    : canonicalResponseField(recordValue, canonicalKey, rejectedKeys)
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) {
    throw new ProviderPayloadError(
      'provider_contract_violation',
      `OpenContent response field ${canonicalKey ?? '(missing)'} must be a non-negative integer.`
    )
  }
  return value
}

function booleanValue(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  throw new ProviderPayloadError(
    'provider_contract_violation',
    'OpenContent returned an invalid boolean value.'
  )
}

function numericBooleanValue(value: unknown): boolean {
  if (value === 1) return true
  if (value === 0) return false
  throw new ProviderPayloadError(
    'provider_contract_violation',
    'OpenContent returned an invalid boolean value.'
  )
}

// Content Space validates these request collections before they reach this adapter.
function parsedRequestArray(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : []
}

function directResponseArray(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) {
    throw new ProviderPayloadError(
      'provider_contract_violation',
      `${label} must be an array.`
    )
  }
  return value
}

function canonicalObjectArray(
  value: unknown,
  canonicalKey: string,
  rejectedKeys: readonly string[],
  label: string
): readonly unknown[] {
  const object = record(value, label)
  return directResponseArray(
    canonicalResponseField(object, canonicalKey, rejectedKeys),
    `${label} field ${canonicalKey}`
  )
}

function normalizeTimestamp(value: unknown): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ProviderPayloadError(
      'provider_contract_violation',
      'OpenContent returned an invalid timestamp.'
    )
  }
  const trimmed = value.trim()
  const withZone = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(?::\d{2})?$/u.test(trimmed)
    ? `${trimmed.replace(' ', 'T')}+08:00`
    : trimmed
  const epoch = Date.parse(withZone)
  if (!Number.isFinite(epoch)) {
    throw new ProviderPayloadError(
      'provider_contract_violation',
      'OpenContent returned an invalid timestamp.'
    )
  }
  return new Date(epoch).toISOString()
}

function parseByteSize(value: unknown): number {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) return value
  throw new ProviderPayloadError(
    'provider_contract_violation',
    'OpenContent returned an invalid byte size.'
  )
}

function unwrapCliJson(
  envelope: ReturnType<typeof openContentExtendedCommandSuccessSchema.parse>['json']
): unknown {
  if (!envelope.success) {
    throw new ProviderPayloadError(mapProviderBusinessCode(envelope.code), envelope.error)
  }
  return envelope.data
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
  principalId: string,
  displayName: string
) {
  return Object.freeze({
    reference: Object.freeze({ providerInstanceRef, kind, principalId }),
    displayName
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

function verifiedNextCursor(
  total: number,
  page: number,
  limit: number,
  itemCount: number,
  label: string
): string | undefined {
  const offset = (page - 1) * limit
  const observedEnd = offset + itemCount
  if (
    itemCount > limit ||
    total < observedEnd ||
    (itemCount < limit && total !== observedEnd)
  ) {
    throw new ProviderPayloadError(
      'provider_contract_violation',
      `${label} does not prove a complete ordered page.`
    )
  }
  return total > observedEnd ? `ocpage_${page + 1}` : undefined
}

function providerKindForEntry(reference: Record<string, unknown>): 'file' | 'folder' {
  return 'fileId' in reference ? 'file' : 'folder'
}

function providerEntryKind(value: unknown): 'container' | 'file' {
  if (value === 1) return 'container'
  if (value === 2) return 'file'
  throw new ProviderPayloadError(
    'provider_contract_violation',
    'OpenContent returned an invalid entry kind.'
  )
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
  const multiple = booleanValue(canonicalResponseField(item, 'multiple', ['isMultiple', 'IsMultiple']))
  if (multiple !== (kind === 'multiple-choice')) {
    throw new ProviderPayloadError(
      'provider_contract_violation',
      'OpenContent returned contradictory metadata multiplicity.'
    )
  }
  return Object.freeze({
    reference: Object.freeze({
      type: Object.freeze({ providerInstanceRef, metadataTypeId: typeId }),
      fieldId
    }),
    name: requiredString(item, ['attrName', 'AttrName', 'name', 'Name'], 'Metadata field name'),
    kind,
    required: booleanValue(canonicalResponseField(item, 'required', ['isRequired', 'IsRequired'])),
    multiple,
    readOnly: booleanValue(canonicalResponseField(item, 'readOnly', ['isReadOnly', 'IsReadOnly']))
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
      return parsedRequestArray(predicate.choiceIds).map((value) => String(value))
    case 'directory-principals':
      return parsedRequestArray(predicate.principals).map((value) => requiredString(record(value), ['principalId'], 'Principal identity'))
    case 'files':
      return parsedRequestArray(predicate.files).map((value) => requiredString(record(value), ['fileId'], 'File identity'))
    case 'containers':
      return parsedRequestArray(predicate.containers).map((value) => requiredString(record(value), ['containerId'], 'Container identity'))
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
    args.tags = parsedRequestArray(request.tags.names)
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

type OpenContentExtendedOperationAdapter = Readonly<{
  execute(input: Readonly<{
    invocationId: string
    operation: ContentSpaceExtendedOperationKey
    request: unknown
    source?: OpenContentExtendedUploadSource
  }>): Promise<unknown>
}>

export function createOpenContentExtendedOperationAdapter(input: Readonly<{
  providerInstanceRef: string
  transport?: OpenContentExtendedCommandTransport
  currentPrincipal?: OpenContentCurrentPrincipalPort
  now?: () => Date
}>): OpenContentExtendedOperationAdapter {
  const { providerInstanceRef, transport, currentPrincipal } = input
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
      let mutationTransportReturned = false
      const parsedRequest = contract.requestSchema.safeParse(rehydrateTransferHandle(
        execution.operation,
        execution.request,
        execution.source
      ))
      if (!parsedRequest.success) {
        return contract.resultSchema.parse(failure('invalid_input', 'The extended-operation request is invalid.'))
      }
      try {
        contentSpaceInvocationIdSchema.parse(execution.invocationId)
        assertProviderAuthority(parsedRequest.data, providerInstanceRef)
        const value = await executeOperation({
          providerInstanceRef,
          invocationId: execution.invocationId,
          operation: execution.operation,
          request: record(parsedRequest.data, 'Extended-operation request'),
          invoke: async (invocationId, command, args, dataFiles) => {
            return invoke(invocationId, command, args, dataFiles, () => {
              if (isOpenContentSupplierMutationCommand(command)) mutationTransportReturned = true
            })
          },
          currentPrincipal,
          now,
          source: execution.source
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
  source: OpenContentExtendedUploadSource | undefined
): unknown {
  if (!isRecord(request)) return request
  const internalHandle = `xfer_${'i'.repeat(32)}`
  if (operation === 'updateFileVersion' || operation === 'addAttachment') {
    return source ? Object.freeze({ ...request, sourceHandle: internalHandle }) : request
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
  currentPrincipal?: OpenContentCurrentPrincipalPort
  now(): Date
  source?: OpenContentExtendedUploadSource
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
    case 'resolveInternalLink':
      throw new ProviderPayloadError(
        'blocked_by_contract',
        'The pinned supplier contract does not define an exact internal-link receipt schema.'
      )
    case 'buildFileScope': return executeBuildScope(context)
    case 'listMetadataTypes': return executeListMetadataTypes(context)
    case 'listMetadataFields': return executeListMetadataFields(context)
    case 'listMetadataChoices':
      throw new ProviderPayloadError(
        'blocked_by_contract',
        'The pinned supplier contract does not prove metadata-choice pagination completeness.'
      )
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
    case 'searchUsers':
    case 'searchDepartments':
    case 'searchPositions':
    case 'searchGroups':
      throw new ProviderPayloadError(
        'blocked_by_contract',
        'The pinned supplier contract does not define an exact directory result schema.'
      )
    case 'listPermissionCategories': return executePermissionCategories(context)
    case 'listPermissions': return executeListPermissions(context)
    case 'changePermissions': return executeChangePermissions(context)
    case 'listCollaborationEntries': return executeCollaborationList(context, false)
    case 'searchCollaborationEntries': return executeCollaborationList(context, true)
    case 'resolveCollaborationInvitation':
      throw new ProviderPayloadError(
        'blocked_by_contract',
        'The pinned supplier contract does not define an exact collaboration-link receipt schema.'
      )
    case 'listKnowledgeCollections':
    case 'searchKnowledgeCollections':
      throw new ProviderPayloadError(
        'blocked_by_contract',
        'The pinned supplier contract does not define an exact knowledge-collection receipt schema.'
      )
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
  const entryKinds = parsedRequestArray(context.request.entryKinds)
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
  const items = canonicalObjectArray(payload, 'items', ['data'], 'Search result page')
  const total = requiredNumber(payload, ['total', 'totalCount', 'matchedCount'], 'Search result count')
  const normalized: unknown[] = []
  for (const [index, item] of items.entries()) {
    const summary = record(item, 'Search item')
    const providerKind = requiredString(summary, ['type', 'kind'], 'Search result kind')
    if (providerKind !== 'file' && providerKind !== 'folder') {
      throw new ProviderPayloadError(
        'provider_contract_violation',
        'OpenContent returned an invalid search result kind.'
      )
    }
    const kind = providerKind === 'folder' ? 'container' : 'file'
    const id = requiredString(summary, ['id', 'fileId', 'folderId'], 'Search result identity')
    normalized.push(await observeEntryInfo(
      context,
      kind === 'file'
        ? fileReference(context.providerInstanceRef, id)
        : containerReference(context.providerInstanceRef, id),
      index + 1
    ))
  }
  const cursor = verifiedNextCursor(total, pageIndex, limit, items.length, 'Search result page')
  return Object.freeze({
    items: Object.freeze(normalized),
    ...(cursor ? { nextCursor: cursor } : {}),
    matchedCount: total
  })
}

async function executeRecentEntries(context: ExecuteContext): Promise<unknown> {
  const page = record(context.request.page, 'Recent page')
  const pageIndex = pageNumber(page)
  const limit = requiredNumber(page, ['limit'], 'Recent page limit')
  if (limit > 100) throw new ProviderPayloadError('bounds_exceeded', 'OpenContent recent pages are limited to 100 entries.')
  if (parsedRequestArray(context.request.entryKinds).includes('container')) {
    throw new ProviderPayloadError('unsupported', 'OpenContent recent history exposes files only.')
  }
  const raw = await context.invoke(context.invocationId, 'recent-files', {
    pageNum: pageIndex,
    pageSize: limit
  })
  const payload = record(raw)
  const items = canonicalObjectArray(
    payload,
    'items',
    ['data', 'files'],
    'Recent-file page'
  )
  const total = requiredNumber(payload, ['total', 'totalCount', 'allCount'], 'Recent result count')
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
  const cursor = verifiedNextCursor(total, pageIndex, limit, items.length, 'Recent-file page')
  return Object.freeze({
    items: Object.freeze(normalized),
    ...(cursor ? { nextCursor: cursor } : {}),
    matchedCount: total
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
    const requestedFileId = requiredString(reference, ['fileId'], 'File identity')
    const raw = await context.invoke(
      compositionIndex === 0 ? context.invocationId : compositionInvocationId(context.invocationId, compositionIndex),
      'file-info',
      { fileId: requestedFileId }
    )
    const payload = record(raw, 'File information')
    const fileId = exactResponseResourceGuid(
      payload,
      requestedFileId,
      'fileGuid',
      ['fileId', 'id'],
      'File identity'
    )
    const parentId = requiredString(payload, ['folderGuid', 'folderId', 'parentFolderId'], 'Parent folder identity')
    const modifiedById = optionalString(payload, ['editorId', 'modifierId'])
    const modifiedByName = optionalString(payload, ['editorName', 'modifierName'])
    return Object.freeze({
      kind: 'file',
      reference: fileReference(context.providerInstanceRef, fileId),
      name: requiredString(payload, ['fileName', 'name'], 'File name'),
      parent: containerReference(context.providerInstanceRef, parentId),
      size: requiredNumber(payload, ['fileSize', 'size'], 'File size'),
      ...(normalizeTimestamp(canonicalResponseField(payload, 'fileCreateTime', ['createTime']))
        ? { createdAt: normalizeTimestamp(canonicalResponseField(payload, 'fileCreateTime', ['createTime'])) }
        : {}),
      ...(normalizeTimestamp(canonicalResponseField(payload, 'fileModifyTime', ['modifyTime']))
        ? { modifiedAt: normalizeTimestamp(canonicalResponseField(payload, 'fileModifyTime', ['modifyTime'])) }
        : {}),
      ...(modifiedById && modifiedByName
        ? { modifiedBy: directoryPrincipal(context.providerInstanceRef, 'user', modifiedById, modifiedByName) }
        : {}),
      ...(optionalString(payload, ['fileLastVerId', 'fileVerId', 'currentVersionId'])
        ? { currentVersionId: optionalString(payload, ['fileLastVerId', 'fileVerId', 'currentVersionId']) }
        : {}),
      ...(optionalString(payload, ['code']) ? { code: optionalString(payload, ['code']) } : {}),
      ...(optionalString(payload, ['fileRemark', 'remark']) ? { remark: optionalString(payload, ['fileRemark', 'remark']) } : {})
    })
  }
  const requestedFolderId = requiredString(reference, ['containerId'], 'Folder identity')
  const raw = await context.invoke(
    compositionIndex === 0 ? context.invocationId : compositionInvocationId(context.invocationId, compositionIndex),
    'folder-info',
    { folderId: requestedFolderId }
  )
  const payload = record(raw, 'Folder information')
  const folderId = exactResponseResourceGuid(
    payload,
    requestedFolderId,
    'folderGuid',
    ['folderId', 'id'],
    'Folder identity'
  )
  const parentId = optionalString(payload, ['parentFolderGuid', 'parentFolderId'])
  return Object.freeze({
    kind: 'container',
    reference: containerReference(context.providerInstanceRef, folderId),
    name: requiredString(payload, ['folderName', 'name'], 'Folder name'),
    ...(parentId ? { parent: containerReference(context.providerInstanceRef, parentId) } : {}),
    ...(normalizeTimestamp(canonicalResponseField(payload, 'createTime', ['folderCreateTime']))
      ? { createdAt: normalizeTimestamp(canonicalResponseField(payload, 'createTime', ['folderCreateTime'])) }
      : {}),
    ...(normalizeTimestamp(canonicalResponseField(payload, 'modifyTime', ['folderModifyTime']))
      ? { modifiedAt: normalizeTimestamp(canonicalResponseField(payload, 'modifyTime', ['folderModifyTime'])) }
      : {}),
    ...(optionalString(payload, ['code']) ? { code: optionalString(payload, ['code']) } : {}),
    ...(optionalString(payload, ['remark']) ? { remark: optionalString(payload, ['remark']) } : {})
  })
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
  const files = directResponseArray(
    canonicalResponseField(scope, 'fileGuids'),
    'File-scope identities'
  ).map((value) => {
    if (typeof value !== 'string' || value === '' || value !== value.trim()) {
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
  const all = directResponseArray(raw, 'Metadata-type result')
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
    name: requiredString(payload, ['typeName', 'TypeName', 'name'], 'Metadata type name'),
    items: canonicalObjectArray(
      payload,
      'attrs',
      ['attributes', 'items', 'data'],
      'Metadata attributes'
    )
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

function metadataValue(
  providerInstanceRef: string,
  control: string,
  value: unknown,
  fieldReference: Record<string, unknown>
): unknown {
  if (value === undefined) return undefined
  switch (control) {
    case 'edoc2Textbox':
    case 'edoc2TextArea': {
      if (typeof value !== 'string') {
        throw new ProviderPayloadError(
          'provider_contract_violation',
          'OpenContent returned an invalid metadata text value.'
        )
      }
      return Object.freeze({ kind: 'text', value })
    }
    case 'edoc2Number': {
      if (typeof value !== 'number' || !Number.isFinite(value)) {
        throw new ProviderPayloadError('provider_contract_violation', 'Metadata number is invalid.')
      }
      return Object.freeze({ kind: 'number', value })
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
        values: Object.freeze(directResponseArray(value, 'Metadata choice values').map((candidate) => Object.freeze({
          field: fieldReference,
          choiceId: requiredString(record(candidate), ['value', 'id'], 'Metadata choice identity')
        })))
      })
    case 'edoc2SelectMember':
      return Object.freeze({
        kind: 'directory-principals',
        values: Object.freeze(directResponseArray(value, 'Metadata member values').map((candidate) => {
          const item = record(candidate, 'Metadata member')
          return Object.freeze({
            providerInstanceRef,
            kind: memberKind(canonicalResponseField(item, 'memberType', ['type'])),
            principalId: supplierNumericOrStringId(
              canonicalResponseField(item, 'identityId', ['id']),
              'Metadata member identity'
            )
          })
        }))
      })
    case 'edoc2SelectFile':
      return Object.freeze({
        kind: 'files',
        values: Object.freeze(directResponseArray(value, 'Metadata file values').map((candidate) =>
          fileReference(providerInstanceRef, supplierNumericOrStringId(
            canonicalResponseField(record(candidate), 'fileId', ['id', 'value']),
            'Metadata file identity'
          ))))
      })
    case 'edoc2SelectFolder':
      return Object.freeze({
        kind: 'containers',
        values: Object.freeze(directResponseArray(value, 'Metadata folder values').map((candidate) =>
          containerReference(providerInstanceRef, supplierNumericOrStringId(
            canonicalResponseField(record(candidate), 'folderId', ['id', 'value']),
            'Metadata folder identity'
          ))))
      })
    default:
      throw new ProviderPayloadError('unsupported', `Unsupported OpenContent metadata control ${control}.`)
  }
}

function memberKind(value: unknown): 'user' | 'department' | 'position' | 'group' {
  if (value === 1) return 'user'
  if (value === 2) return 'department'
  if (value === 4) return 'position'
  if (value === 8) return 'group'
  throw new ProviderPayloadError(
    'provider_contract_violation',
    'OpenContent returned an invalid directory-principal kind.'
  )
}

async function executeReadMetadata(context: ExecuteContext): Promise<unknown> {
  const target = record(context.request.target, 'Metadata target')
  const requestedType = isRecord(context.request.type) ? context.request.type : undefined
  const raw = await context.invoke(context.invocationId, 'meta-info', {
    fileId: entryId(target),
    fileType: providerKindForEntry(target)
  })
  const payload = record(raw, 'Metadata information')
  const records = canonicalObjectArray(
    payload,
    'records',
    ['metaRecords', 'items'],
    'Metadata information'
  )
  const normalized = records.map((candidate) => {
    const item = record(candidate, 'Metadata record')
    const typeId = requiredString(item, ['metaTypeId', 'typeId', 'TypeId'], 'Metadata type identity')
    if (requestedType && requestedType.metadataTypeId !== typeId) return undefined
    const typeReference = Object.freeze({ providerInstanceRef: context.providerInstanceRef, metadataTypeId: typeId })
    const attributes = canonicalObjectArray(
      item,
      'attrs',
      ['attributes', 'values'],
      'Metadata record attributes'
    )
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
          canonicalResponseField(attribute, 'attrValue', ['columnValue', 'value', 'Value']),
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
    case 'choices': return parsedRequestArray(typed.values).map((candidate) => requiredString(record(candidate), ['choiceId'], 'Metadata choice identity'))
    case 'directory-principals': return parsedRequestArray(typed.values).map((candidate) => {
      const principal = record(candidate, 'Directory principal')
      const id = requiredString(principal, ['principalId'], 'Directory principal identity')
      return { id, identityId: id, guid: id, text: id, memberType: principalMemberType(principal.kind) }
    })
    case 'files': return parsedRequestArray(typed.values).map((candidate) => requiredString(record(candidate), ['fileId'], 'Metadata file identity'))
    case 'containers': return parsedRequestArray(typed.values).map((candidate) => requiredString(record(candidate), ['containerId'], 'Metadata folder identity'))
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
  const changes = parsedRequestArray(context.request.changes)
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
    provedTargetId !== entryId(target) ||
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
  const entries = parsedRequestArray(context.request.entries)
  const destination = record(context.request.destination, 'Destination folder')
  const ids = mutationIds(entries)
  const raw = assertMutationSettled(await context.invoke(context.invocationId, command, {
    ...(ids.fileIds.length ? { fileIds: ids.fileIds.join(',') } : {}),
    ...(ids.folderIds.length ? { folderIds: ids.folderIds.join(',') } : {}),
    targetFolderId: requiredString(destination, ['containerId'], 'Destination folder identity')
  }))
  const returnedItemPayload = canonicalResponseField(raw, 'items', ['results'])
  const returnedItems = returnedItemPayload === undefined
    ? []
    : directResponseArray(returnedItemPayload, 'Copied-entry results')
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
  const entries = parsedRequestArray(context.request.entries)
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
  const all = directResponseArray(raw, 'Security-level result')
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
  const items = canonicalObjectArray(
    raw,
    'items',
    ['attachments', 'data'],
    'Attachment page'
  ).map((candidate) => {
    const item = record(candidate, 'Attachment')
    return Object.freeze({
      master,
      attachment: fileReference(
        context.providerInstanceRef,
        requiredString(item, ['fileId', 'id'], 'Attachment identity')
      ),
      name: requiredString(item, ['fileName', 'name'], 'Attachment name'),
      size: parseByteSize(canonicalResponseField(item, 'size', ['fileSize'])),
      ...(normalizeTimestamp(canonicalResponseField(item, 'createTime', ['addedAt']))
        ? { addedAt: normalizeTimestamp(canonicalResponseField(item, 'createTime', ['addedAt'])) }
        : {})
    })
  })
  const total = requiredNumber(raw, ['total', 'totalCount'], 'Attachment result count')
  const cursor = verifiedNextCursor(total, index, limit, items.length, 'Attachment page')
  return Object.freeze({
    master,
    items: Object.freeze(items),
    ...(cursor ? { nextCursor: cursor } : {})
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
    ...(normalizeTimestamp(canonicalResponseField(raw, 'createTime', ['addedAt']))
      ? { addedAt: normalizeTimestamp(canonicalResponseField(raw, 'createTime', ['addedAt'])) }
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
  const items = canonicalObjectArray(
    raw,
    'items',
    ['relations', 'data'],
    'Relation page'
  ).map((candidate) => {
    const item = record(candidate, 'Relation')
    const relatedId = requiredString(item, ['fileId', 'relatedFileId', 'id'], 'Related file identity')
    const main = booleanValue(canonicalResponseField(item, 'mainRelate', ['isMain']))
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
  const total = requiredNumber(raw, ['total', 'totalCount'], 'Relation result count')
  const cursor = verifiedNextCursor(total, index, limit, items.length, 'Relation page')
  return Object.freeze({
    target,
    items: Object.freeze(items),
    ...(cursor ? { nextCursor: cursor } : {})
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
  const all = canonicalObjectArray(raw, 'items', ['tags', 'data'], 'Tag result')
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
  const targets = parsedRequestArray(context.request.targets).map((candidate) => record(candidate, 'Tag target'))
  const names = parsedRequestArray(context.request.names).map((candidate) => String(candidate))
  await context.invoke(context.invocationId, 'file-tag-set', {
    fileIds: targets.map((target) => requiredString(target, ['fileId'], 'Tag target identity')).join(','),
    tags: names.join(',')
  })
  return Object.freeze({ targets: Object.freeze(targets), names: Object.freeze(names) })
}

async function executeRemoveTags(context: ExecuteContext): Promise<unknown> {
  const targets = parsedRequestArray(context.request.targets).map((candidate) => record(candidate, 'Tag target'))
  if (targets.length !== 1) {
    throw new ProviderPayloadError(
      'bounds_exceeded',
      'OpenContent removes tag identities from exactly one file per atomic write.'
    )
  }
  const tags = parsedRequestArray(context.request.tags).map((candidate) => record(candidate, 'Tag reference'))
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
  const permissions = parsedRequestArray(context.request.permissions)
  if (!permissions.includes('preview') || permissions.includes('print')) {
    throw new ProviderPayloadError(
      'unsupported',
      'OpenContent publication exposes preview and optional download; print cannot be controlled independently.'
    )
  }
  const targets = parsedRequestArray(context.request.targets).map((candidate) => record(candidate, 'Publication target'))
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
  const observedExpiry = normalizeTimestamp(
    canonicalResponseField(raw, 'endDate', ['Publish_EndTime'])
  )
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
  const items = canonicalObjectArray(
    raw,
    'items',
    ['publishList', 'data'],
    'Publication page'
  ).map((candidate) => {
    const item = record(candidate, 'Publication')
    const end = normalizeTimestamp(
      canonicalResponseField(item, 'Publish_EndTime', ['endDate'])
    )
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
  const total = requiredNumber(raw, ['totalCount', 'total'], 'Publication result count')
  const cursor = verifiedNextCursor(total, index, limit, items.length, 'Publication page')
  return Object.freeze({
    items: Object.freeze(items),
    ...(cursor ? { nextCursor: cursor } : {})
  })
}

async function executeCancelPublications(context: ExecuteContext): Promise<unknown> {
  const publications = parsedRequestArray(context.request.publications).map((candidate) => record(candidate, 'Publication reference'))
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
  const targets = parsedRequestArray(context.request.targets).map((candidate) => record(candidate, 'Share target'))
  const recipients = parsedRequestArray(context.request.recipients).map((candidate) => record(candidate, 'Share recipient'))
  const kinds = new Set(targets.map(providerKindForEntry))
  if (kinds.size !== 1) throw new ProviderPayloadError('unsupported', 'OpenContent cannot share mixed files and folders atomically.')
  const permissions = parsedRequestArray(context.request.permissions)
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
  const items = canonicalObjectArray(
    raw,
    'items',
    ['shareList', 'data'],
    'Share page'
  ).map((candidate) => {
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
  const total = requiredNumber(raw, ['totalCount', 'total'], 'Share result count')
  const cursor = verifiedNextCursor(total, index, limit, items.length, 'Share page')
  return Object.freeze({
    items: Object.freeze(items),
    ...(cursor ? { nextCursor: cursor } : {})
  })
}

async function executeCancelShares(context: ExecuteContext): Promise<unknown> {
  const shares = parsedRequestArray(context.request.shares).map((candidate) => record(candidate, 'Share reference'))
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
  const items = canonicalObjectArray(
    raw,
    'albums',
    ['items', 'data'],
    'Album page'
  ).map((candidate) => {
    const item = record(candidate, 'Album')
    return Object.freeze({
      reference: Object.freeze({
        providerInstanceRef: context.providerInstanceRef,
        albumId: requiredString(item, ['fsId', 'albumId', 'id'], 'Album identity')
      }),
      name: requiredString(item, ['name', 'albumName'], 'Album name'),
      entryCount: requiredNumber(item, ['fileCount'], 'Album file count') +
        requiredNumber(item, ['folderCount'], 'Album folder count'),
      isDefault: booleanValue(canonicalResponseField(item, 'isDefault', ['default']))
    })
  })
  const total = requiredNumber(raw, ['totalCount', 'total'], 'Album result count')
  const cursor = verifiedNextCursor(total, index, limit, items.length, 'Album page')
  return Object.freeze({
    items: Object.freeze(items),
    ...(cursor ? { nextCursor: cursor } : {})
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
    items: canonicalObjectArray(raw, 'files', ['items', 'data'], 'Album-entry page')
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
    const kind = providerEntryKind(canonicalResponseField(item, 'type', ['entryType']))
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
  const total = requiredNumber(response.raw, ['totalCount', 'total'], 'Album-entry result count')
  const cursor = verifiedNextCursor(total, index, limit, response.items.length, 'Album-entry page')
  return Object.freeze({
    album,
    items: Object.freeze(items),
    ...(cursor ? { nextCursor: cursor } : {})
  })
}

async function executeAddFavorite(context: ExecuteContext): Promise<unknown> {
  const album = record(context.request.album, 'Album reference')
  const entries = parsedRequestArray(context.request.entries).map((candidate) => record(candidate, 'Favorite entry'))
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
    const ids = parsedRequestArray(context.request.favoriteIds)
    if (ids.length !== 1) {
      throw new ProviderPayloadError('bounds_exceeded', 'OpenContent removes exactly one favorite per atomic write.')
    }
    favoriteId = String(ids[0])
    const found = response.items.map((candidate) => record(candidate)).find((item) =>
      optionalString(item, ['fvId', 'favoriteId']) === favoriteId
    )
    if (!found) throw new ProviderPayloadError('invalid_reference', 'The favorite is not present in the selected album page.')
    const fileId = requiredString(found, ['fileId', 'id'], 'Favorite entry identity')
    entry = providerEntryKind(canonicalResponseField(found, 'type', ['entryType'])) === 'container'
      ? containerReference(context.providerInstanceRef, fileId)
      : fileReference(context.providerInstanceRef, fileId)
  } else {
    const entries = parsedRequestArray(context.request.entries).map((candidate) => record(candidate, 'Favorite entry'))
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
  if (!context.currentPrincipal) {
    throw new ProviderPayloadError(
      'blocked_by_contract',
      'The authenticated OpenContent current-principal session is unavailable.'
    )
  }
  const identityId = openContentIdentityIdSchema.parse(
    await context.currentPrincipal.currentIdentityId()
  )
  return Object.freeze({
    reference: Object.freeze({
      providerInstanceRef: context.providerInstanceRef,
      kind: 'user' as const,
      principalId: String(identityId)
    }),
    displayName: 'Current OpenContent user'
  })
}

async function executePermissionCategories(context: ExecuteContext): Promise<unknown> {
  const targetKindValue = context.request.targetKind
  const raw = await context.invoke(context.invocationId, 'perm-cates', {
    type: targetKind(targetKindValue)
  })
  const items = directResponseArray(raw, 'Permission-category result').map((candidate) => {
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
  if (value === 0) return 'direct'
  if (value === 1) return 'inherited'
  if (value === 3) return 'self'
  if (value === 4) return 'administrator'
  throw new ProviderPayloadError(
    'provider_contract_violation',
    'OpenContent returned an invalid permission source.'
  )
}

async function executeListPermissions(context: ExecuteContext): Promise<unknown> {
  const target = record(context.request.target, 'Permission target')
  const kind = context.request.targetKind
  const raw = await context.invoke(context.invocationId, 'perm-list', {
    id: entryId(target),
    type: targetKind(kind)
  })
  const items = directResponseArray(raw, 'Permission result').map((candidate) => {
    const item = record(candidate, 'Permission assignment')
    const principalKind = memberKind(canonicalResponseField(item, 'memberType'))
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
      source: permissionSource(canonicalResponseField(item, 'state')),
      ...(normalizeTimestamp(canonicalResponseField(item, 'startTime'))
        ? { startsAt: normalizeTimestamp(canonicalResponseField(item, 'startTime')) }
        : {}),
      ...(normalizeTimestamp(canonicalResponseField(item, 'expiredTime'))
        ? { expiresAt: normalizeTimestamp(canonicalResponseField(item, 'expiredTime')) }
        : {})
    })
  })
  return Object.freeze({ target, items: Object.freeze(items) })
}

async function executeChangePermissions(context: ExecuteContext): Promise<unknown> {
  const target = record(context.request.target, 'Permission target')
  const kind = context.request.targetKind
  const changes = parsedRequestArray(context.request.changes).map((candidate) => record(candidate, 'Permission change'))
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
  const items = canonicalObjectArray(raw, 'data', ['items'], 'Collaboration page')
    .map((candidate) => {
    const item = record(candidate, 'Collaboration entry')
    const ownerId = requiredString(item, ['DocflowFileCreateUserId', 'creatorId', 'ownerId'], 'Collaboration owner identity')
    const ownerName = requiredString(item, ['DocflowFileCreateUserName', 'creatorName', 'ownerName'], 'Collaboration owner name')
    const createdAt = normalizeTimestamp(
      canonicalResponseField(item, 'DocflowCreateTime', ['createTime'])
    )
    if (!createdAt) throw new ProviderPayloadError('provider_contract_violation', 'Collaboration creation time is invalid.')
    return Object.freeze({
      file: fileReference(context.providerInstanceRef, requiredString(item, ['FileId', 'fileId'], 'Collaboration file identity')),
      name: requiredString(item, ['DocflowFileName', 'fileName'], 'Collaboration file name'),
      createdAt,
      owner: directoryPrincipal(context.providerInstanceRef, 'user', ownerId, ownerName),
      read: numericBooleanValue(canonicalResponseField(item, 'DocflowRead', ['read'])),
      deleted: booleanValue(canonicalResponseField(item, 'isDeleted', ['deleted']))
    })
  })
  const total = requiredNumber(raw, ['allCount', 'totalCount', 'total'], 'Collaboration result count')
  const cursor = verifiedNextCursor(total, index, limit, items.length, 'Collaboration page')
  return Object.freeze({
    items: Object.freeze(items),
    ...(cursor ? { nextCursor: cursor } : {})
  })
}
