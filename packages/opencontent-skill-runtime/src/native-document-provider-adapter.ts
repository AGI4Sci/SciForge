import { createHash } from 'node:crypto'

import { z } from 'zod'

import {
  contentContainerReferenceSchema,
  contentSpaceInvocationIdSchema,
  type ContentSpaceUploadSource
} from '@sciforge/domain-content-space/contract'
import {
  NATIVE_DOCUMENT_CONTRACT_VERSION,
  NATIVE_DOCUMENT_RESOURCE_TYPE,
  nativeDocumentHashSchema,
  nativeDocumentOperationSchema,
  nativeDocumentReferenceSchema,
  nativeDocumentRequestSchema,
  nativeDocumentSelectorSchema,
  type NativeDocumentChange,
  type NativeDocumentOperation,
  type NativeDocumentRequest,
  type NativeDocumentSelector
} from '@sciforge/domain-content-space/native-document-contract'
import {
  contentSpaceProviderNativeDocumentReceiptSchema,
  nativeDocumentOperationEffect,
  sameContentEntryReference,
  type ContentSpaceNativeDocumentExecutor,
  type ContentSpaceProviderNativeDocumentReceipt
} from '@sciforge/domain-content-space/provider-features'

import {
  OPENCONTENT_SKILL_RUNTIME_ADAPTER_OWNER_MODULE_ID,
  admitOpenContentSkillRuntimeOwner,
  type OpenContentSkillRuntimeOwner
} from './contract.js'
import {
  docflowCommandInvocationSchema,
  docflowNativeDocumentReceiptSchema,
  type DocflowCommandInvocation,
  type DocflowNativeDocumentAdapter,
  type DocflowNativeDocumentReceipt
} from './docflow-native-document-adapter.js'

type FeatureInput = Parameters<ContentSpaceNativeDocumentExecutor['execute']>[0]
type JsonRecord = Record<string, unknown>

type HandlelessImageUploadRequest = Omit<
  Extract<NativeDocumentRequest, { operation: 'image-upload' }>,
  'sourceHandle'
>
type HandlelessImageDownloadRequest = Omit<
  Extract<NativeDocumentRequest, { operation: 'image-download' }>,
  'destinationHandle'
>
type HandlelessImportRequest = Omit<
  Extract<NativeDocumentRequest, { operation: 'import' }>,
  'sourceHandle'
>
type HandlelessExportRequest = Omit<
  Extract<NativeDocumentRequest, { operation: 'export' }>,
  'destinationHandle'
>

type SanitizedNativeDocumentRequest =
  | Exclude<NativeDocumentRequest, {
    operation: 'image-upload' | 'image-download' | 'import' | 'export'
  }>
  | HandlelessImageUploadRequest
  | HandlelessImageDownloadRequest
  | HandlelessImportRequest
  | HandlelessExportRequest

type ProbeState = Readonly<{
  providerInstanceRef: string
  fileId: string
  documentHash: string
  selector: NativeDocumentSelector
  requestedCapability: Extract<NativeDocumentRequest, { operation: 'probe' }>['requestedCapability']
  selection: unknown
  templateToken: string
}>

type PrincipalBoundState<Value> = Readonly<{
  value: Value
  principalBinding: string
  expiresAt: number
}>

type ManagedStateStore<Value> = Readonly<{
  entries: Map<string, PrincipalBoundState<Value>>
  reservations: Set<symbol>
}>

type ManagedStateReservation = Readonly<{ kind: 'probe'; token: symbol }>

export type NativeDocumentProviderAdapterBinding = Readonly<{
  owner: OpenContentSkillRuntimeOwner | unknown
  docflow: DocflowNativeDocumentAdapter
}>

export type NativeDocumentProviderAdapter = Pick<
  ContentSpaceNativeDocumentExecutor,
  'execute'
>

const imageMediaTypeSchema = z.enum([
  'image/avif',
  'image/gif',
  'image/jpeg',
  'image/png',
  'image/svg+xml',
  'image/webp'
])

const handlelessImageUploadRequestSchema = z.object({
  operation: z.literal('image-upload'),
  document: nativeDocumentReferenceSchema,
  mediaType: imageMediaTypeSchema
}).strict().readonly()

const handlelessImageDownloadRequestSchema = z.object({
  operation: z.literal('image-download'),
  document: nativeDocumentReferenceSchema,
  position: z.number().int().min(1).max(100_000)
}).strict().readonly()

const handlelessImportRequestSchema = z.object({
  operation: z.literal('import'),
  resourceType: z.literal(NATIVE_DOCUMENT_RESOURCE_TYPE),
  parent: contentContainerReferenceSchema
}).strict().readonly()

const handlelessExportRequestSchema = z.object({
  operation: z.literal('export'),
  document: nativeDocumentReferenceSchema,
  format: z.enum(['docx', 'pdf', 'markdown'])
}).strict().readonly()

const jsonObjectSchema = z.record(z.string(), z.unknown())
const revisionIdSchema = z.string().trim().min(1).max(256)
const resourceIdSchema = z.string().trim().min(1).max(256)
const commentSchema = z.object({
  commentId: z.string().trim().min(1).max(256),
  body: z.string().trim().min(1).max(16_384),
  status: z.enum(['open', 'solved']),
  createdAt: z.string().datetime({ offset: true })
}).strict().readonly()

const MAX_SOURCE_BYTES = 18 * 1024 * 1024
const SOURCE_CHUNK_BYTES = 1024 * 1024
const MANAGED_STATE_TTL_MS = 10 * 60 * 1_000
const MANAGED_STATE_CAPACITY = 2_048

const NON_ATOMIC_HASH_BOUND_OPERATIONS = Object.freeze([
  'update',
  'insert',
  'edit',
  'undo',
  'redo',
  'comment-create',
  'comment-reply',
  'comment-solve',
  'comment-reopen',
  'comment-delete'
] as const satisfies readonly NativeDocumentOperation[])
const NON_ATOMIC_HASH_BOUND_OPERATION_SET = new Set<NativeDocumentOperation>(
  NON_ATOMIC_HASH_BOUND_OPERATIONS
)

type HashBoundOperation = (typeof NON_ATOMIC_HASH_BOUND_OPERATIONS)[number]
type HashBoundRequest = Extract<
  SanitizedNativeDocumentRequest,
  { operation: HashBoundOperation }
>
type NonHashBoundRequest = Exclude<SanitizedNativeDocumentRequest, HashBoundRequest>

function isHashBoundRequest(
  request: SanitizedNativeDocumentRequest
): request is HashBoundRequest {
  return NON_ATOMIC_HASH_BOUND_OPERATION_SET.has(request.operation)
}

const WRITE_OPERATIONS = new Set<NativeDocumentOperation>([
  'create',
  'update',
  'insert',
  'edit',
  'undo',
  'redo',
  'image-upload',
  'image-download',
  'comment-create',
  'comment-reply',
  'comment-solve',
  'comment-reopen',
  'comment-delete',
  'import',
  'export'
])

function createManagedStateStore<Value>(): ManagedStateStore<Value> {
  return Object.freeze({
    entries: new Map<string, PrincipalBoundState<Value>>(),
    reservations: new Set<symbol>()
  })
}

function purgeManagedStates<Value>(
  store: ManagedStateStore<Value>,
  now: number
): void {
  for (const [id, state] of store.entries) {
    if (state.expiresAt <= now) store.entries.delete(id)
  }
}

function reserveManagedState<Value>(
  store: ManagedStateStore<Value>,
  now: number
): symbol | undefined {
  purgeManagedStates(store, now)
  if (store.entries.size + store.reservations.size >= MANAGED_STATE_CAPACITY) {
    return undefined
  }
  const token = Symbol('managed-native-document-state')
  store.reservations.add(token)
  return token
}

function commitManagedState<Value>(
  store: ManagedStateStore<Value>,
  reservation: symbol,
  id: string,
  value: Value,
  boundPrincipal: string,
  now: number
): boolean {
  purgeManagedStates(store, now)
  if (!store.reservations.delete(reservation) || store.entries.has(id)) return false
  store.entries.set(id, Object.freeze({
    value,
    principalBinding: boundPrincipal,
    expiresAt: now + MANAGED_STATE_TTL_MS
  }))
  return true
}

function readManagedState<Value>(
  store: ManagedStateStore<Value>,
  id: string,
  boundPrincipal: string,
  now: number
): Value | undefined {
  purgeManagedStates(store, now)
  const state = store.entries.get(id)
  return state?.principalBinding === boundPrincipal ? state.value : undefined
}

function consumeManagedState<Value>(
  store: ManagedStateStore<Value>,
  id: string,
  boundPrincipal: string,
  now: number
): Value | undefined {
  const value = readManagedState(store, id, boundPrincipal, now)
  if (value !== undefined) store.entries.delete(id)
  return value
}

function releaseManagedStateReservation(
  reservation: ManagedStateReservation | undefined,
  probeStates: ManagedStateStore<ProbeState>
): void {
  if (reservation?.kind === 'probe') {
    probeStates.reservations.delete(reservation.token)
  }
}

function principalBinding(input: FeatureInput): string {
  const principal = input.context.principal
  return JSON.stringify([
    principal.authority,
    principal.subject,
    principal.assurance,
    principal.deviceId,
    principal.identityVersion
  ])
}

/** The DocFlow CLI calls Markdown export `md`; the public contract spells it out. */
export function mapNativeDocumentExportFormat(
  format: HandlelessExportRequest['format']
): 'docx' | 'pdf' | 'md' {
  return format === 'markdown' ? 'md' : format
}

/**
 * Binds the provider-neutral Content Space feature port to the fixed DocFlow
 * adapter. Host file-transfer handles never enter this boundary.
 */
export function createNativeDocumentProviderAdapter(
  binding: NativeDocumentProviderAdapterBinding
): NativeDocumentProviderAdapter {
  const owner = admitOpenContentSkillRuntimeOwner(binding.owner)
  if (owner.role !== 'adapter-owner' ||
    owner.moduleId !== OPENCONTENT_SKILL_RUNTIME_ADAPTER_OWNER_MODULE_ID) {
    throw new TypeError('The native-document provider adapter requires the declared adapter owner.')
  }

  const probeStates = createManagedStateStore<ProbeState>()

  return Object.freeze({
    async execute(input: FeatureInput): Promise<ContentSpaceProviderNativeDocumentReceipt> {
      const operation = nativeDocumentOperationSchema.parse(input.operation)
      const invocationId = contentSpaceInvocationIdSchema.parse(input.context.invocationId)
      const base = receiptBase(operation, invocationId)
      const parsedRequest = parseSanitizedRequest(input.request, operation)
      if (!parsedRequest.success) {
        return failureReceipt(
          base,
          'invalid_input',
          `Invalid ${operation} request: ${firstIssue(parsedRequest.error)}`
        )
      }
      const request = parsedRequest.data
      const boundPrincipal = principalBinding(input)

      const authorityFailure = validateFeatureAuthority(input, request)
      if (authorityFailure) {
        return failureReceipt(base, authorityFailure.code, authorityFailure.message)
      }
      if (input.context.signal?.aborted) {
        return failureReceipt(base, 'cancelled', 'The native-document invocation was cancelled before dispatch.')
      }

      if (isHashBoundRequest(request)) {
        return failureReceipt(
          base,
          'unsupported',
          'OpenContent does not expose an atomic compare-and-mutate contract for hash-bound native-document mutations.'
        )
      }

      const prepared = await prepareInvocation(
        input,
        request,
        invocationId,
        probeStates,
        boundPrincipal,
        Date.now()
      )
      if (!prepared.success) {
        return prepared.receipt
      }

      try {
        let rawReceipt: unknown
        try {
          rawReceipt = await binding.docflow.execute(prepared.invocation)
        } catch (error) {
          const message = boundedMessage(error, 'The DocFlow adapter rejected the invocation.')
          return WRITE_OPERATIONS.has(operation)
            ? outcomeUnknownReceipt(base, 'write', message)
            : failureReceipt(base, 'provider_unavailable', message)
        }

        const parsedDocflowReceipt = docflowNativeDocumentReceiptSchema.safeParse(rawReceipt)
        if (!parsedDocflowReceipt.success) {
          const gap = `DocFlow receipt: ${firstIssue(parsedDocflowReceipt.error)}`
          return isJsonObject(rawReceipt) && rawReceipt.outcome === 'succeeded'
            ? postDispatchProofGap(base, gap)
            : contractViolation(base, gap)
        }
        const docflowReceipt = parsedDocflowReceipt.data
        if (docflowReceipt.invocationId !== invocationId ||
          docflowReceipt.command !== prepared.invocation.command) {
          const gap = 'DocFlow receipt invocationId/command does not match the dispatched invocation.'
          return docflowReceipt.outcome === 'succeeded'
            ? postDispatchProofGap(base, gap)
            : contractViolation(base, gap)
        }
        if (docflowReceipt.outcome !== 'succeeded') {
          return mapNonSuccessReceipt(base, request, docflowReceipt)
        }

        const enriched = await enrichDocumentWriteReceipt(
          binding.docflow,
          request,
          base,
          docflowReceipt
        )
        if (!enriched.success) return enriched.receipt

        return normalizeSuccessReceipt(
          base,
          input,
          request,
          enriched.receipt,
          probeStates,
          boundPrincipal,
          prepared.reservation,
          Date.now()
        )
      } finally {
        releaseManagedStateReservation(
          prepared.reservation,
          probeStates
        )
      }
    }
  })
}

async function enrichDocumentWriteReceipt(
  docflow: DocflowNativeDocumentAdapter,
  request: NonHashBoundRequest,
  base: ReceiptBase,
  receipt: Extract<DocflowNativeDocumentReceipt, { outcome: 'succeeded' }>
): Promise<
  | Readonly<{
    success: true
    receipt: Extract<DocflowNativeDocumentReceipt, { outcome: 'succeeded' }>
  }>
  | Readonly<{
    success: false
    receipt: ContentSpaceProviderNativeDocumentReceipt
  }>
> {
  if (!['create', 'import'].includes(request.operation)) {
    return { success: true, receipt }
  }
  const hasHash = nativeDocumentHashSchema.safeParse(receipt.json.documentHash).success
  const hasRevision = revisionIdSchema.safeParse(
    receipt.json.revisionId ?? receipt.json.versionId
  ).success
  if (hasHash && hasRevision) return { success: true, receipt }

  const fileId = receipt.json.fileId ?? receipt.structuredDeliveryItems[0]?.businessIdentity
  if (typeof fileId !== 'string' || fileId.length === 0) {
    return {
      success: false,
      receipt: outcomeUnknownReceipt(
        base,
        'verify',
        'The write succeeded but no fileId is available for read-after-write verification.'
      )
    }
  }
  const invocation = docflowCommandInvocationSchema.parse({
    invocationId: compositionInvocationId(base.invocationId, 'readback'),
    command: 'docflow-read',
    args: { fileId },
    dataFiles: []
  })
  let raw: unknown
  try {
    raw = await docflow.execute(invocation)
  } catch (error) {
    return {
      success: false,
      receipt: outcomeUnknownReceipt(
        base,
        'verify',
        boundedMessage(error, 'The write succeeded but read-after-write verification failed.')
      )
    }
  }
  const readback = docflowNativeDocumentReceiptSchema.safeParse(raw)
  if (!readback.success || readback.data.outcome !== 'succeeded' ||
    readback.data.invocationId !== invocation.invocationId ||
    readback.data.command !== 'docflow-read') {
    return {
      success: false,
      receipt: outcomeUnknownReceipt(
        base,
        'verify',
        'The write succeeded but docflow-read returned no bound verification receipt.'
      )
    }
  }
  const finalHash = nativeDocumentHashSchema.safeParse(
    receipt.json.documentHash ?? readback.data.json.documentHash
  )
  const finalRevision = revisionIdSchema.safeParse(
    receipt.json.revisionId ?? receipt.json.versionId ??
    readback.data.json.revisionId ?? readback.data.json.versionId
  )
  if (!finalHash.success || !finalRevision.success) {
    return {
      success: false,
      receipt: outcomeUnknownReceipt(
        base,
        'verify',
        'The write succeeded but readback lacks documentHash or revisionId/versionId.'
      )
    }
  }
  return {
    success: true,
    receipt: {
      ...receipt,
      json: {
        ...receipt.json,
        documentHash: finalHash.data,
        revisionId: finalRevision.data
      }
    }
  }
}

type ReceiptBase = Readonly<{
  contractVersion: typeof NATIVE_DOCUMENT_CONTRACT_VERSION
  resourceType: typeof NATIVE_DOCUMENT_RESOURCE_TYPE
  operation: NativeDocumentOperation
  invocationId: string
}>

function receiptBase(
  operation: NativeDocumentOperation,
  invocationId: string
): ReceiptBase {
  return Object.freeze({
    contractVersion: NATIVE_DOCUMENT_CONTRACT_VERSION,
    resourceType: NATIVE_DOCUMENT_RESOURCE_TYPE,
    operation,
    invocationId
  })
}

function parseSanitizedRequest(
  raw: unknown,
  operation: NativeDocumentOperation
): Readonly<{
  success: true
  data: SanitizedNativeDocumentRequest
}> | Readonly<{
  success: false
  error: z.ZodError
}> {
  let parsed: z.ZodSafeParseResult<unknown>
  switch (operation) {
    case 'image-upload':
      parsed = handlelessImageUploadRequestSchema.safeParse(raw)
      break
    case 'image-download':
      parsed = handlelessImageDownloadRequestSchema.safeParse(raw)
      break
    case 'import':
      parsed = handlelessImportRequestSchema.safeParse(raw)
      break
    case 'export':
      parsed = handlelessExportRequestSchema.safeParse(raw)
      break
    default:
      parsed = nativeDocumentRequestSchema.safeParse(raw)
      break
  }
  return parsed.success
    ? { success: true, data: parsed.data as SanitizedNativeDocumentRequest }
    : { success: false, error: parsed.error }
}

function validateFeatureAuthority(
  input: FeatureInput,
  request: SanitizedNativeDocumentRequest
): Readonly<{
  code: 'invalid_input' | 'invalid_reference'
  message: string
}> | undefined {
  if (request.operation !== input.operation) {
    return {
      code: 'invalid_input',
      message: 'The parsed request operation does not match the feature operation.'
    }
  }
  const expectedEffect = nativeDocumentOperationEffect(request.operation)
  if (input.effect !== expectedEffect) {
    return {
      code: 'invalid_input',
      message: `Operation ${request.operation} requires effect ${expectedEffect}.`
    }
  }
  const expectedTarget = request.operation === 'create' || request.operation === 'import'
    ? request.parent
    : request.document.reference
  if (!sameContentEntryReference(input.target.primary, expectedTarget) ||
    !input.target.authorized.some((reference) =>
      sameContentEntryReference(reference, input.target.primary))) {
    return {
      code: 'invalid_reference',
      message: 'The request target is not the exact authorized Content Space primary target.'
    }
  }
  if (input.context.providerInstanceRef !== expectedTarget.providerInstanceRef ||
    input.target.root.providerInstanceRef !== expectedTarget.providerInstanceRef) {
    return {
      code: 'invalid_reference',
      message: 'The request, target, and execution context name different Provider instances.'
    }
  }
  return undefined
}

type PreparedInvocation =
  | Readonly<{
    success: true
    invocation: DocflowCommandInvocation
    reservation?: ManagedStateReservation
  }>
  | Readonly<{ success: false; receipt: ContentSpaceProviderNativeDocumentReceipt }>

async function prepareInvocation(
  input: FeatureInput,
  request: NonHashBoundRequest,
  invocationId: string,
  probeStates: ManagedStateStore<ProbeState>,
  boundPrincipal: string,
  now: number
): Promise<PreparedInvocation> {
  const base = receiptBase(request.operation, invocationId)
  let rawInvocation: unknown
  let reservation: ManagedStateReservation | undefined

  switch (request.operation) {
    case 'create':
      rawInvocation = {
        invocationId,
        command: 'docflow-create',
        args: {
          title: request.title,
          folderId: request.parent.containerId,
          references: []
        },
        dataFiles: [contentDataFile(request.content.value)]
      }
      break
    case 'read':
      rawInvocation = simpleFileInvocation(invocationId, 'docflow-read', request.document.reference.fileId)
      break
    case 'probe': {
      const token = reserveManagedState(probeStates, now)
      if (!token) {
        return {
          success: false,
          receipt: managedStateCapacityReceipt(base)
        }
      }
      reservation = Object.freeze({ kind: 'probe' as const, token })
      const probeOperation = mapProbeCapability(request.requestedCapability)
      rawInvocation = {
        invocationId,
        command: 'docflow-probe',
        args: {
          fileId: request.document.reference.fileId,
          target: mapSelector(request.selector),
          view: 'target',
          operation: probeOperation,
          include: probeIncludes(request.requestedCapability)
        },
        dataFiles: []
      }
      break
    }
    case 'plan': {
      const state = readManagedState(
        probeStates,
        request.probeReceiptId,
        boundPrincipal,
        now
      )
      if (!state) {
        return {
          success: false,
          receipt: stalePlanReceipt(base, request.baseHash)
        }
      }
      if (state.providerInstanceRef !== request.document.reference.providerInstanceRef ||
        state.fileId !== request.document.reference.fileId ||
        state.documentHash !== request.baseHash) {
        return {
          success: false,
          receipt: conflictReceipt(
            base,
            'stale_plan',
            'The probe receipt is bound to another document or document hash.',
            state.documentHash,
            request.baseHash
          )
        }
      }
      const operations = mapChanges(request.changes, state)
      if (!operations.success) {
        return {
          success: false,
          receipt: contractViolation(base, operations.message)
        }
      }
      consumeManagedState(
        probeStates,
        request.probeReceiptId,
        boundPrincipal,
        now
      )
      rawInvocation = {
        invocationId,
        command: 'docflow-plan',
        args: {
          fileId: request.document.reference.fileId,
          baseHash: request.baseHash
        },
        dataFiles: [
          {
            role: 'probe-template',
            encoding: 'managed',
            token: state.templateToken
          },
          {
            role: 'operations',
            encoding: 'json',
            name: 'operations.json',
            mediaType: 'application/json',
            content: {
              operations: operations.value,
              reason: 'SciForge provider-neutral native-document plan.'
            }
          }
        ]
      }
      break
    }
    case 'image-upload': {
      if (!input.source) {
        return {
          success: false,
          receipt: contractViolation(base, 'feature source is required for docflow-image-upload.')
        }
      }
      const bytes = await readSource(input.source)
      if (!bytes.success) {
        return {
          success: false,
          receipt: contractViolation(base, bytes.message)
        }
      }
      rawInvocation = {
        invocationId,
        command: 'docflow-image-upload',
        args: { source: 'data-file' },
        dataFiles: [{
          role: 'image',
          encoding: 'base64',
          name: input.source.name,
          mediaType: request.mediaType,
          content: Buffer.from(bytes.value).toString('base64')
        }]
      }
      break
    }
    case 'image-download': {
      if (!input.destination) {
        return {
          success: false,
          receipt: contractViolation(base, 'feature destination is required for docflow-image-download.')
        }
      }
      rawInvocation = {
        invocationId,
        command: 'docflow-image-download',
        args: {
          fileId: request.document.reference.fileId,
          position: request.position
        },
        dataFiles: [{
          role: 'destination',
          encoding: 'managed-stream',
          name: `${request.document.reference.fileId}-image-${request.position}.bin`,
          write: input.destination.write
        }]
      }
      break
    }
    case 'comment-list':
      rawInvocation = {
        invocationId,
        command: 'docflow-comment-list',
        args: {
          fileId: request.document.reference.fileId,
          status: request.status
        },
        dataFiles: []
      }
      break
    case 'comment-get':
      rawInvocation = {
        invocationId,
        command: 'docflow-comment-get',
        args: {
          fileId: request.document.reference.fileId,
          commentId: request.commentId
        },
        dataFiles: []
      }
      break
    case 'import': {
      if (!input.source) {
        return {
          success: false,
          receipt: contractViolation(base, 'feature source is required for docflow-import.')
        }
      }
      const bytes = await readSource(input.source)
      if (!bytes.success) {
        return {
          success: false,
          receipt: contractViolation(base, bytes.message)
        }
      }
      rawInvocation = {
        invocationId,
        command: 'docflow-import',
        args: { folderId: request.parent.containerId },
        dataFiles: [{
          role: 'source',
          encoding: 'base64',
          name: input.source.name,
          mediaType: importMediaType(input.source.name),
          content: Buffer.from(bytes.value).toString('base64')
        }]
      }
      break
    }
    case 'export': {
      if (!input.destination) {
        return {
          success: false,
          receipt: contractViolation(base, 'feature destination is required for docflow-export.')
        }
      }
      const format = mapNativeDocumentExportFormat(request.format)
      rawInvocation = {
        invocationId,
        command: 'docflow-export',
        args: {
          fileId: request.document.reference.fileId,
          format
        },
        dataFiles: [{
          role: 'destination',
          encoding: 'managed-stream',
          name: `${request.document.reference.fileId}.${format}`,
          write: input.destination.write
        }]
      }
      break
    }
  }

  const parsedInvocation = docflowCommandInvocationSchema.safeParse(rawInvocation)
  if (parsedInvocation.success) {
    return {
      success: true,
      invocation: parsedInvocation.data,
      ...(reservation ? { reservation } : {})
    }
  }
  releaseManagedStateReservation(reservation, probeStates)
  return {
        success: false,
        receipt: contractViolation(
          base,
          `DocFlow invocation: ${firstIssue(parsedInvocation.error)}`
        )
  }
}

function compositionInvocationId(
  invocationId: string,
  stage: 'readback'
): string {
  return `ocnd_${createHash('sha256')
    .update(`${invocationId}\0${stage}`)
    .digest('hex')
    .slice(0, 48)}`
}

function simpleFileInvocation(
  invocationId: string,
  command: 'docflow-read',
  fileId: string
): unknown {
  return {
    invocationId,
    command,
    args: { fileId },
    dataFiles: []
  }
}

function contentDataFile(content: unknown): unknown {
  return {
    role: 'content',
    encoding: 'json',
    name: 'document.json',
    mediaType: 'application/json',
    content
  }
}

function mapSelector(selector: NativeDocumentSelector): unknown {
  switch (selector.kind) {
    case 'text':
      return {
        targetText: selector.text,
        occurrence: selector.occurrence
      }
    case 'range':
      return {
        startText: selector.startText,
        endText: selector.endText
      }
    case 'component':
      return {
        targetComponent: selector.componentType,
        occurrence: selector.occurrence
      }
  }
}

function mapProbeCapability(
  capability: ProbeState['requestedCapability']
): 'locate' | 'replaceText' | 'insertText' | 'deleteText' |
  'insertBlockAfter' | 'deleteBlock' | 'setInlineFormat' | 'setComponentState' {
  switch (capability) {
    case 'locate': return 'locate'
    case 'replace_text': return 'replaceText'
    case 'insert_text': return 'insertText'
    case 'delete_text': return 'deleteText'
    case 'insert_block': return 'insertBlockAfter'
    case 'delete_block': return 'deleteBlock'
    case 'format_text': return 'setInlineFormat'
    case 'update_component': return 'setComponentState'
  }
}

function probeIncludes(
  capability: ProbeState['requestedCapability']
): readonly ('nodes' | 'text' | 'formats' | 'resources' | 'slots')[] {
  switch (capability) {
    case 'format_text': return ['nodes', 'text', 'formats']
    case 'update_component': return ['nodes', 'slots']
    case 'delete_block': return ['nodes', 'resources']
    case 'insert_block': return ['nodes']
    case 'locate':
    case 'replace_text':
    case 'insert_text':
    case 'delete_text':
      return ['nodes', 'text']
  }
}

type ChangeMapping =
  | Readonly<{ success: true; value: readonly unknown[] }>
  | Readonly<{ success: false; message: string }>

function mapChanges(
  changes: readonly NativeDocumentChange[],
  state: ProbeState
): ChangeMapping {
  if (state.requestedCapability === 'locate') {
    return {
      success: false,
      message: 'A locate-only probe cannot authorize edit operations.'
    }
  }
  const selection = jsonObjectSchema.safeParse(state.selection)
  if (!selection.success) {
    return {
      success: false,
      message: 'probe.json.selection must be an object before planning.'
    }
  }
  const mapped: unknown[] = []
  for (const change of changes) {
    if (change.kind !== state.requestedCapability) {
      return {
        success: false,
        message: `Change ${change.kind} is not authorized by probe capability ${state.requestedCapability}.`
      }
    }
    if (!sameJson(change.target, state.selector)) {
      return {
        success: false,
        message: 'Every plan change must use the exact selector bound to the probe receipt.'
      }
    }
    const operation = mapChange(change, selection.data)
    if (!operation.success) return operation
    mapped.push(operation.value)
  }
  return { success: true, value: Object.freeze(mapped) }
}

type SingleChangeMapping =
  | Readonly<{ success: true; value: unknown }>
  | Readonly<{ success: false; message: string }>

function mapChange(
  change: NativeDocumentChange,
  selection: JsonRecord
): SingleChangeMapping {
  const target = selection.editTarget ?? selection.editSelector
  if (!isJsonObject(target)) {
    return {
      success: false,
      message: 'probe.json.selection.editTarget or editSelector is required for planning.'
    }
  }
  switch (change.kind) {
    case 'replace_text':
    case 'insert_text':
    case 'delete_text': {
      if (!isJsonObject(selection.range) || typeof selection.oldText !== 'string') {
        return {
          success: false,
          message: 'probe.json.selection.range and oldText are required for text planning.'
        }
      }
      const guard = {
        target,
        range: selection.range,
        oldText: selection.oldText,
        ...(typeof selection.oldTextHash === 'string'
          ? { oldTextHash: selection.oldTextHash }
          : {})
      }
      if (change.kind === 'delete_text') {
        return { success: true, value: { op: 'deleteText', ...guard } }
      }
      if (!('value' in change) || typeof change.value !== 'string') {
        return {
          success: false,
          message: `${change.kind} value must be a string.`
        }
      }
      return change.kind === 'replace_text'
        ? { success: true, value: { op: 'replaceText', ...guard, newText: change.value } }
        : { success: true, value: { op: 'insertText', ...guard, text: change.value } }
    }
    case 'insert_block': {
      if (!('value' in change) || !isJsonObject(change.value) ||
        !['before', 'after'].includes(String(change.value.position)) ||
        !isJsonObject(change.value.content)) {
        return {
          success: false,
          message: 'insert_block value requires position before|after and a content object.'
        }
      }
      return {
        success: true,
        value: {
          op: change.value.position === 'before'
            ? 'insertBlockBefore'
            : 'insertBlockAfter',
          target,
          content: change.value.content
        }
      }
    }
    case 'delete_block':
      return { success: true, value: { op: 'deleteBlock', target } }
    case 'format_text': {
      if (!('value' in change) || !isJsonObject(change.value) ||
        typeof change.value.formatter !== 'string' ||
        !Object.hasOwn(change.value, 'value')) {
        return {
          success: false,
          message: 'format_text value requires formatter and value fields.'
        }
      }
      const baseOperation = isJsonObject(selection.inlineFormatOperation)
        ? selection.inlineFormatOperation
        : undefined
      if (!baseOperation) {
        return {
          success: false,
          message: 'probe.json.selection.inlineFormatOperation is required for format_text.'
        }
      }
      return {
        success: true,
        value: {
          ...baseOperation,
          op: 'setInlineFormat',
          formatter: change.value.formatter,
          value: change.value.value
        }
      }
    }
    case 'update_component': {
      if (!('value' in change) || !isJsonObject(change.value)) {
        return {
          success: false,
          message: 'update_component value must be a state object.'
        }
      }
      return {
        success: true,
        value: { op: 'setComponentState', target, state: change.value }
      }
    }
  }
}

async function readSource(
  source: ContentSpaceUploadSource
): Promise<
  | Readonly<{ success: true; value: Uint8Array }>
  | Readonly<{ success: false; message: string }>
> {
  if (!Number.isSafeInteger(source.size) || source.size < 0) {
    return { success: false, message: 'feature source.size must be a non-negative safe integer.' }
  }
  if (source.size > MAX_SOURCE_BYTES) {
    return {
      success: false,
      message: `feature source exceeds the ${MAX_SOURCE_BYTES}-byte typed data-file limit.`
    }
  }
  const result = new Uint8Array(source.size)
  let offset = 0
  try {
    while (offset < source.size) {
      const requested = Math.min(SOURCE_CHUNK_BYTES, source.size - offset)
      const chunk = await source.read({ offset, length: requested })
      if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0 ||
        chunk.byteLength > requested) {
        return {
          success: false,
          message: `feature source returned an invalid chunk at offset ${offset}.`
        }
      }
      result.set(chunk, offset)
      offset += chunk.byteLength
    }
  } catch (error) {
    return {
      success: false,
      message: boundedMessage(error, 'feature source could not be read.')
    }
  }
  return { success: true, value: result }
}

function importMediaType(name: string): string {
  const extension = /(?:\.([^.]+))$/u.exec(name)?.[1]?.toLowerCase()
  switch (extension) {
    case 'md':
    case 'markdown': return 'text/markdown'
    case 'txt': return 'text/plain'
    case 'html':
    case 'htm': return 'text/html'
    case 'doc': return 'application/msword'
    case 'docx': return 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    case 'pdf': return 'application/pdf'
    default: return 'application/octet-stream'
  }
}

function mapNonSuccessReceipt(
  base: ReceiptBase,
  request: SanitizedNativeDocumentRequest,
  receipt: Exclude<DocflowNativeDocumentReceipt, { outcome: 'succeeded' }>
): ContentSpaceProviderNativeDocumentReceipt {
  switch (receipt.outcome) {
    case 'failed':
      return failureReceipt(
        base,
        receipt.error.code,
        receipt.error.message,
        receipt.error.retry
      )
    case 'outcome_unknown':
      return outcomeUnknownReceipt(base, receipt.error.stage, receipt.error.message)
    case 'conflict': {
      const expectedHash = receipt.error.expectedHash ?? requestBaseHash(request)
      if (!expectedHash) {
        return contractViolation(base, 'DocFlow conflict receipt is missing error.expectedHash.')
      }
      return conflictReceipt(
        base,
        receipt.error.reason,
        receipt.error.message,
        expectedHash,
        receipt.error.actualHash
      )
    }
  }
}

function requestBaseHash(request: SanitizedNativeDocumentRequest): string | undefined {
  return 'baseHash' in request ? request.baseHash : undefined
}

function normalizeSuccessReceipt(
  base: ReceiptBase,
  input: FeatureInput,
  request: NonHashBoundRequest,
  receipt: Extract<DocflowNativeDocumentReceipt, { outcome: 'succeeded' }>,
  probeStates: ManagedStateStore<ProbeState>,
  boundPrincipal: string,
  reservation: ManagedStateReservation | undefined,
  now: number
): ContentSpaceProviderNativeDocumentReceipt {
  const json = receipt.json
  switch (request.operation) {
    case 'create':
    case 'import': {
      const documentHash = requiredHash(base, json, 'json.documentHash')
      if (!documentHash.success) return documentHash.receipt
      const revisionId = requiredRevision(base, json)
      if (!revisionId.success) return revisionId.receipt
      const deliveryIdentity = requiredDeliveryIdentity(base, json, receipt)
      if (!deliveryIdentity.success) return deliveryIdentity.receipt
      return successReceipt(base, {
        kind: 'document',
        document: {
          resourceType: NATIVE_DOCUMENT_RESOURCE_TYPE,
          reference: {
            providerInstanceRef: input.context.providerInstanceRef,
            fileId: deliveryIdentity.value
          }
        },
        documentHash: documentHash.value,
        revisionId: revisionId.value
      })
    }
    case 'read': {
      const documentHash = requiredHash(base, json, 'json.documentHash')
      if (!documentHash.success) return documentHash.receipt
      if (!Object.hasOwn(json, 'content') || !z.json().safeParse(json.content).success) {
        return postDispatchProofGap(base, 'CLI output is missing JSON field json.content.')
      }
      return successReceipt(base, {
        kind: 'content',
        document: request.document,
        documentHash: documentHash.value,
        content: json.content
      })
    }
    case 'probe': {
      const documentHash = requiredHash(base, json, 'json.documentHash')
      if (!documentHash.success) return documentHash.receipt
      const supported = isJsonObject(json.capabilities) &&
        typeof json.capabilities.supported === 'boolean'
        ? json.capabilities.supported
        : undefined
      if (supported === undefined) {
        return postDispatchProofGap(base, 'CLI output is missing boolean json.capabilities.supported.')
      }
      if (!supported) {
        return successReceipt(base, {
          kind: 'probe',
          document: request.document,
          documentHash: documentHash.value,
          probeReceiptId: opaqueReceiptId('probe', base.invocationId, documentHash.value),
          capabilitySupported: false,
          ...(Object.hasOwn(json, 'selection') ? { selection: json.selection } : {})
        })
      }
      const template = receipt.managedDataFiles.filter((item) => item.role === 'probe-template')
      if (template.length !== 1) {
        return postDispatchProofGap(base, 'DocFlow receipt requires one managedDataFiles[role=probe-template].')
      }
      if (!Object.hasOwn(json, 'selection') || !z.json().safeParse(json.selection).success) {
        return postDispatchProofGap(base, 'CLI output is missing JSON field json.selection.')
      }
      const probeReceiptId = opaqueReceiptId('probe', base.invocationId, template[0]!.token)
      if (reservation?.kind !== 'probe' || !commitManagedState(
        probeStates,
        reservation.token,
        probeReceiptId,
        Object.freeze({
          providerInstanceRef: request.document.reference.providerInstanceRef,
          fileId: request.document.reference.fileId,
          documentHash: documentHash.value,
          selector: request.selector,
          requestedCapability: request.requestedCapability,
          selection: json.selection,
          templateToken: template[0]!.token
        }),
        boundPrincipal,
        now
      )) {
        return contractViolation(base, 'The probe receipt state reservation is unavailable.')
      }
      return successReceipt(base, {
        kind: 'probe',
        document: request.document,
        documentHash: documentHash.value,
        probeReceiptId,
        capabilitySupported: true,
        selection: json.selection
      })
    }
    case 'plan': {
      if (json.canApply !== true) {
        return postDispatchProofGap(base, 'CLI output is missing literal true json.canApply.')
      }
      const baseHash = json.baseDocumentHash ?? json.documentHash
      if (baseHash !== request.baseHash) {
        return postDispatchProofGap(base, 'CLI output baseDocumentHash does not match request.baseHash.')
      }
      const planReceiptId = opaqueReceiptId('plan', base.invocationId, request.baseHash)
      return successReceipt(base, {
        kind: 'plan',
        document: request.document,
        baseHash: request.baseHash,
        planReceiptId,
        canApply: true,
        changeCount: request.changes.length
      })
    }
    case 'image-upload': {
      const resourceId = resourceIdSchema.safeParse(json.resourceId ?? json.fileId)
      if (!resourceId.success) {
        return postDispatchProofGap(base, 'CLI output is missing string json.resourceId or json.fileId.')
      }
      const mediaType = z.string().trim().min(1).max(128)
        .safeParse(json.mediaType ?? json.mimeType)
      if (!mediaType.success) {
        return postDispatchProofGap(base, 'CLI output is missing string json.mediaType or json.mimeType.')
      }
      return successReceipt(base, {
        kind: 'image',
        resourceId: resourceId.data,
        mediaType: mediaType.data
      })
    }
    case 'comment-list': {
      const comments = z.array(commentSchema).max(10_000).safeParse(json.comments)
      if (!comments.success) {
        return postDispatchProofGap(base, 'CLI output is missing valid array json.comments.')
      }
      return successReceipt(base, {
        kind: 'comments',
        document: request.document,
        comments: comments.data
      })
    }
    case 'comment-get': {
      const comment = commentSchema.safeParse(json.comment)
      if (!comment.success) {
        return postDispatchProofGap(base, 'CLI output is missing valid object json.comment.')
      }
      return successReceipt(base, {
        kind: 'comment',
        document: request.document,
        comment: comment.data
      })
    }
    case 'image-download':
    case 'export': {
      const name = z.string().trim().min(1).max(256).safeParse(json.name ?? json.fileName)
      if (!name.success) {
        return postDispatchProofGap(base, 'CLI output is missing string json.name or json.fileName.')
      }
      const mediaType = z.string().trim().min(1).max(128)
        .safeParse(json.mediaType ?? json.mimeType)
      if (!mediaType.success) {
        return postDispatchProofGap(base, 'CLI output is missing string json.mediaType or json.mimeType.')
      }
      const bytesWritten = z.number().int().nonnegative().safeParse(json.bytesWritten)
      if (!bytesWritten.success) {
        return postDispatchProofGap(base, 'CLI output is missing non-negative integer json.bytesWritten.')
      }
      const digest = z.string().regex(/^[a-f0-9]{64}$/u)
        .safeParse(json.sha256 ?? json.digest)
      return successReceipt(base, {
        kind: 'artifact',
        name: name.data,
        mediaType: mediaType.data,
        bytesWritten: bytesWritten.data,
        ...(digest.success
          ? { digest: { algorithm: 'sha256' as const, value: digest.data } }
          : {})
      })
    }
  }
}

type RequiredField<Value> =
  | Readonly<{ success: true; value: Value }>
  | Readonly<{ success: false; receipt: ContentSpaceProviderNativeDocumentReceipt }>

function requiredHash(
  base: ReceiptBase,
  json: JsonRecord,
  field: string
): RequiredField<string> {
  const parsed = nativeDocumentHashSchema.safeParse(json.documentHash)
  return parsed.success
    ? { success: true, value: parsed.data }
    : {
        success: false,
        receipt: postDispatchProofGap(base, `CLI output is missing 64-hex field ${field}.`)
      }
}

function requiredRevision(
  base: ReceiptBase,
  json: JsonRecord
): RequiredField<string> {
  const parsed = revisionIdSchema.safeParse(json.revisionId ?? json.versionId)
  return parsed.success
    ? { success: true, value: parsed.data }
    : {
        success: false,
        receipt: postDispatchProofGap(base, 'CLI output is missing string json.revisionId or json.versionId.')
      }
}

function requiredDeliveryIdentity(
  base: ReceiptBase,
  json: JsonRecord,
  receipt: Extract<DocflowNativeDocumentReceipt, { outcome: 'succeeded' }>
): RequiredField<string> {
  if (receipt.structuredDeliveryItems.length !== 1) {
    return {
      success: false,
      receipt: postDispatchProofGap(base, 'DocFlow receipt requires exactly one structuredDeliveryItems item.')
    }
  }
  const identity = receipt.structuredDeliveryItems[0]!.businessIdentity
  if (json.fileId !== identity) {
    return {
      success: false,
      receipt: postDispatchProofGap(base, 'CLI json.fileId must equal structuredDeliveryItems[0].businessIdentity.')
    }
  }
  const parsed = resourceIdSchema.safeParse(identity)
  return parsed.success
    ? { success: true, value: parsed.data }
    : {
        success: false,
        receipt: postDispatchProofGap(base, 'CLI delivery businessIdentity is not a valid Provider resource ID.')
      }
}

function opaqueReceiptId(
  kind: 'probe' | 'plan',
  invocationId: string,
  managedValue: string
): string {
  const digest = createHash('sha256')
    .update(`${kind}\0${invocationId}\0${managedValue}`)
    .digest('hex')
  return `${kind}_${digest.slice(0, 48)}`
}

function successReceipt(
  base: ReceiptBase,
  result: unknown
): ContentSpaceProviderNativeDocumentReceipt {
  const parsed = contentSpaceProviderNativeDocumentReceiptSchema.safeParse({
    ...base,
    outcome: 'succeeded',
    result
  })
  return parsed.success
    ? Object.freeze(parsed.data)
    : postDispatchProofGap(
        base,
        `Normalized provider result: ${firstIssue(parsed.error)}`
      )
}

function postDispatchProofGap(
  base: ReceiptBase,
  gap: string
): ContentSpaceProviderNativeDocumentReceipt {
  return WRITE_OPERATIONS.has(base.operation)
    ? outcomeUnknownReceipt(
        base,
        'verify',
        `The write returned success but its proof is incomplete: ${gap}`
      )
    : contractViolation(base, gap)
}

function contractViolation(
  base: ReceiptBase,
  gap: string
): ContentSpaceProviderNativeDocumentReceipt {
  return failureReceipt(base, 'contract_violation', `Contract gap: ${gap}`)
}

function failureReceipt(
  base: ReceiptBase,
  code: 'invalid_input' | 'invalid_reference' | 'not_found' | 'unsupported' |
    'unauthorized' | 'provider_unavailable' | 'contract_violation' | 'cancelled',
  message: string,
  retry: 'never' | 'after-human-action' | 'safe-with-same-invocation' = 'never'
): ContentSpaceProviderNativeDocumentReceipt {
  return Object.freeze(contentSpaceProviderNativeDocumentReceiptSchema.parse({
    ...base,
    outcome: 'failed',
    error: {
      code,
      message: boundedText(message),
      retry
    }
  }))
}

function outcomeUnknownReceipt(
  base: ReceiptBase,
  stage: 'write' | 'publish' | 'verify' | 'comment_commit',
  message: string
): ContentSpaceProviderNativeDocumentReceipt {
  return Object.freeze(contentSpaceProviderNativeDocumentReceiptSchema.parse({
    ...base,
    outcome: 'outcome_unknown',
    error: {
      code: 'outcome_unknown',
      stage,
      message: boundedText(message),
      retry: 'never'
    }
  }))
}

function stalePlanReceipt(
  base: ReceiptBase,
  expectedHash: string
): ContentSpaceProviderNativeDocumentReceipt {
  return conflictReceipt(
    base,
    'stale_plan',
    'The managed receipt is missing, expired, already consumed, or belongs to another adapter instance.',
    expectedHash
  )
}

function managedStateCapacityReceipt(
  base: ReceiptBase
): ContentSpaceProviderNativeDocumentReceipt {
  return failureReceipt(
    base,
    'provider_unavailable',
    'The bounded native-document receipt registry is full; wait for pending probes to expire.'
  )
}

function conflictReceipt(
  base: ReceiptBase,
  reason: 'hash_mismatch' | 'revision_conflict' | 'stale_plan',
  message: string,
  expectedHash: string,
  actualHash?: string
): ContentSpaceProviderNativeDocumentReceipt {
  return Object.freeze(contentSpaceProviderNativeDocumentReceiptSchema.parse({
    ...base,
    outcome: 'conflict',
    error: {
      code: 'conflict',
      reason,
      message: boundedText(message),
      retry: 'never',
      expectedHash,
      ...(actualHash ? { actualHash } : {})
    }
  }))
}

function firstIssue(error: z.ZodError): string {
  const issue = error.issues[0]
  if (!issue) return 'schema validation failed.'
  const path = issue.path.length > 0 ? `${issue.path.join('.')}: ` : ''
  return boundedText(`${path}${issue.message}`)
}

function boundedMessage(error: unknown, fallback: string): string {
  return boundedText(
    error instanceof Error && error.message.trim()
      ? error.message.trim()
      : fallback
  )
}

function boundedText(value: string): string {
  const normalized = value.trim() || 'Native-document operation failed.'
  return normalized.slice(0, 256)
}

function isJsonObject(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function sameJson(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}
