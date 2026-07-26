import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  capabilityAuditRecordSchema,
  capabilityAudienceSchema,
  capabilityCallerContextSchema,
  capabilityEventQuerySchema,
  capabilityInvocationRequestSchema,
  capabilityInvocationResultSchema,
  capabilityJsonValueSchema,
  capabilityObservationSchema,
  capabilityObserveRequestSchema,
  capabilityResourceChangeEventSchema,
  capabilityResourceContentDescriptorSchema,
  capabilityResourceContentRangeSchema,
  capabilityResourceHandleSchema,
  type CapabilityAuditRecord,
  type CapabilityAudience,
  type CapabilityCallerContext,
  type CapabilityCallerContextInput,
  type CapabilityDiscoveryQuery,
  type CapabilityEventQuery,
  type CapabilityInvocationRequest,
  type CapabilityInvocationResult,
  type CapabilityJsonValue,
  type CapabilityObservation,
  type CapabilityObserveRequest,
  type CapabilityResourceChangeEvent,
  type CapabilityResourceContentDescriptor,
  type CapabilityResourceContentRange,
  type CapabilityResourceHandle
} from '../../shared/capability-broker'
import {
  CapabilityRegistry,
  type CapabilityDefinition,
  type CapabilityResourceRegistration,
  type ResolvedCapabilityResource
} from './registry'

const resourceObservationResultSchema = z.object({
  state: capabilityJsonValueSchema,
  semanticRevision: z.string().trim().min(1).max(256),
  layoutRevision: z.string().trim().min(1).max(256).optional(),
  operationIds: z.array(z.string().trim().min(1).max(192)).max(512).optional()
}).strict()

const DEFAULT_HANDLE_TTL_MS = 15 * 60_000
const MAX_HANDLE_TTL_MS = 24 * 60 * 60_000
const DEFAULT_MAX_AUDIT_RECORDS = 2_000
const DEFAULT_MAX_EVENTS = 2_000
const DEFAULT_MAX_IDEMPOTENCY_ENTRIES = 2_000

type BrokerErrorCategory = 'rejected' | 'failed'

export class CapabilityBrokerError extends Error {
  readonly code: string
  readonly category: BrokerErrorCategory
  readonly details?: CapabilityJsonValue

  constructor(
    code: string,
    message: string,
    options: { category?: BrokerErrorCategory; details?: CapabilityJsonValue; cause?: unknown } = {}
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'CapabilityBrokerError'
    this.code = code
    this.category = options.category ?? 'rejected'
    this.details = options.details
  }
}

export type CapabilityBrokerOptions = {
  now?: () => Date
  handleTtlMs?: number
  maxAuditRecords?: number
  maxEvents?: number
  maxIdempotencyEntries?: number
}

type ResourceState = {
  key: string
  resourceRef: string
  resourceId: string
  resourceKind: string
  workspaceId?: string
  allowedAudiences: CapabilityAudience[]
  semanticRevision: string
  layoutRevision?: string
  observe: CapabilityResourceRegistration['observe']
  contentTransport?: CapabilityResourceRegistration['contentTransport']
}

type ResourceGrant = {
  token: string
  resourceKey: string
  workspaceId?: string
  semanticRevision: string
  expiresAt: string
}

type IdempotencyEntry = {
  fingerprint: string
  promise: Promise<CapabilityInvocationResult>
}

type EventSubscription = {
  caller: CapabilityCallerContext
  listener: (event: CapabilityResourceChangeEvent) => void
}

function opaqueId(prefix: 'cap' | 'res' | 'audit' | 'event'): string {
  return `${prefix}_${randomBytes(24).toString('base64url')}`
}

function stableJson(value: CapabilityJsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
    .join(',')}}`
}

function normalizedWorkspaceId(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function resourceKey(
  registration: Pick<CapabilityResourceRegistration, 'workspaceId' | 'resourceKind' | 'resourceId'>,
  allowedAudiences: readonly CapabilityAudience[]
): string {
  return stableJson({
    workspaceId: registration.workspaceId ?? null,
    resourceKind: registration.resourceKind,
    resourceId: registration.resourceId,
    allowedAudiences: [...allowedAudiences].sort()
  })
}

function isMutation(definition: CapabilityDefinition): boolean {
  return definition.descriptor.effect === 'workspace-write'
    || definition.descriptor.effect === 'external-write'
    || definition.descriptor.effect === 'destructive'
}

export class CapabilityBroker {
  readonly registry: CapabilityRegistry
  readonly #now: () => Date
  readonly #handleTtlMs: number
  readonly #maxAuditRecords: number
  readonly #maxEvents: number
  readonly #maxIdempotencyEntries: number
  readonly #resources = new Map<string, ResourceState>()
  readonly #resourcesByRef = new Map<string, ResourceState>()
  readonly #handles = new Map<string, ResourceGrant>()
  readonly #idempotency = new Map<string, IdempotencyEntry>()
  readonly #auditRecords: CapabilityAuditRecord[] = []
  readonly #events: CapabilityResourceChangeEvent[] = []
  readonly #subscriptions = new Set<EventSubscription>()

  constructor(registry: CapabilityRegistry, options: CapabilityBrokerOptions = {}) {
    this.registry = registry
    this.#now = options.now ?? (() => new Date())
    this.#handleTtlMs = Math.min(MAX_HANDLE_TTL_MS, Math.max(1, options.handleTtlMs ?? DEFAULT_HANDLE_TTL_MS))
    this.#maxAuditRecords = Math.max(1, options.maxAuditRecords ?? DEFAULT_MAX_AUDIT_RECORDS)
    this.#maxEvents = Math.max(1, options.maxEvents ?? DEFAULT_MAX_EVENTS)
    this.#maxIdempotencyEntries = Math.max(1, options.maxIdempotencyEntries ?? DEFAULT_MAX_IDEMPOTENCY_ENTRIES)
  }

  discover(rawCaller: CapabilityCallerContextInput, query?: CapabilityDiscoveryQuery) {
    return this.registry.discover(rawCaller, query)
  }

  issueResourceHandle(
    rawCaller: CapabilityCallerContextInput,
    rawRegistration: CapabilityResourceRegistration
  ): CapabilityResourceHandle {
    const caller = this.#parseCaller(rawCaller)
    const registration = this.#parseResourceRegistration(rawRegistration)
    const workspaceId = registration.workspaceId ?? caller.workspaceId
    if (registration.workspaceId && registration.workspaceId !== caller.workspaceId) {
      throw new CapabilityBrokerError(
        'resource_scope_mismatch',
        'A resource handle can only be issued inside the caller workspace.'
      )
    }

    const allowedAudiences = [...(registration.audiences ?? [caller.audience])].sort()
    if (registration.contentTransport) {
      this.#validateContentAction(registration.resourceKind, registration.contentTransport.describeActionId)
      this.#validateContentAction(registration.resourceKind, registration.contentTransport.readRangeActionId)
    }
    const key = resourceKey({ ...registration, workspaceId }, allowedAudiences)
    const existing = this.#resources.get(key)
    if (!allowedAudiences.includes(caller.audience)) {
      throw new CapabilityBrokerError(
        'resource_audience_denied',
        'A resource handle cannot be issued to an audience outside the resource transfer policy.'
      )
    }
    const resource: ResourceState = existing ?? {
      key,
      resourceRef: opaqueId('res'),
      resourceId: registration.resourceId,
      resourceKind: registration.resourceKind,
      workspaceId,
      allowedAudiences,
      semanticRevision: registration.semanticRevision,
      layoutRevision: registration.layoutRevision,
      observe: registration.observe,
      contentTransport: registration.contentTransport
    }
    resource.semanticRevision = registration.semanticRevision
    resource.layoutRevision = registration.layoutRevision
    resource.allowedAudiences = allowedAudiences
    resource.observe = registration.observe
    resource.contentTransport = registration.contentTransport
    this.#resources.set(key, resource)
    this.#resourcesByRef.set(resource.resourceRef, resource)

    const token = opaqueId('cap')
    const ttl = Math.min(MAX_HANDLE_TTL_MS, Math.max(1, registration.expiresInMs ?? this.#handleTtlMs))
    const expiresAt = new Date(this.#now().getTime() + ttl).toISOString()
    const grant: ResourceGrant = {
      token,
      resourceKey: key,
      workspaceId,
      semanticRevision: registration.semanticRevision,
      expiresAt
    }
    this.#handles.set(token, grant)
    return capabilityResourceHandleSchema.parse({
      token,
      semanticRevision: registration.semanticRevision,
      expiresAt
    })
  }

  bindResourceRef(
    rawCaller: CapabilityCallerContextInput,
    resourceRef: string
  ): CapabilityResourceHandle {
    const caller = this.#parseCaller(rawCaller)
    const state = this.#authorizedResourceRef(caller, resourceRef)
    return this.issueResourceHandle(caller, {
      resourceId: state.resourceId,
      resourceKind: state.resourceKind,
      workspaceId: state.workspaceId,
      audiences: state.allowedAudiences,
      semanticRevision: state.semanticRevision,
      layoutRevision: state.layoutRevision,
      observe: state.observe,
      contentTransport: state.contentTransport
    })
  }

  /**
   * Resolves an opaque resource reference for trusted Host composition without
   * exposing the provider's internal identity to the agent tool result.
   */
  describeResourceRef(
    rawCaller: CapabilityCallerContextInput,
    resourceRef: string
  ): ResolvedCapabilityResource {
    const caller = this.#parseCaller(rawCaller)
    const state = this.#authorizedResourceRef(caller, resourceRef)
    return {
      resourceId: state.resourceId,
      resourceRef: state.resourceRef,
      resourceKind: state.resourceKind,
      ...(state.workspaceId ? { workspaceId: state.workspaceId } : {}),
      semanticRevision: state.semanticRevision,
      ...(state.layoutRevision ? { layoutRevision: state.layoutRevision } : {})
    }
  }

  async observe(
    rawCaller: CapabilityCallerContextInput,
    rawRequest: CapabilityObserveRequest
  ): Promise<CapabilityObservation> {
    const caller = this.#parseCaller(rawCaller)
    const request = capabilityObserveRequestSchema.parse(rawRequest)
    const { state } = this.#resolveHandle(caller, request.resource)
    let rawObservation: Awaited<ReturnType<ResourceState['observe']>>
    try {
      rawObservation = await state.observe(caller)
    } catch (error) {
      throw new CapabilityBrokerError('observation_failed', 'The resource provider failed to observe its state.', {
        category: 'failed',
        cause: error
      })
    }
    const observed = resourceObservationResultSchema.safeParse(rawObservation)
    if (!observed.success) {
      throw new CapabilityBrokerError('invalid_observation', 'The resource provider returned an invalid observation.', {
        category: 'failed',
        details: { issues: observed.error.issues.map((issue) => issue.message) }
      })
    }

    state.semanticRevision = observed.data.semanticRevision
    state.layoutRevision = observed.data.layoutRevision
    const refreshedHandle = this.issueResourceHandle(caller, {
      resourceId: state.resourceId,
      resourceKind: state.resourceKind,
      workspaceId: state.workspaceId,
      audiences: state.allowedAudiences,
      semanticRevision: state.semanticRevision,
      layoutRevision: state.layoutRevision,
      observe: state.observe,
      contentTransport: state.contentTransport
    })
    const discovered = this.registry.discover(caller, { resourceKind: state.resourceKind })
    const operations = observed.data.operationIds
      ? observed.data.operationIds.map((id) => {
          const descriptor = discovered.find((candidate) => candidate.id === id)
          if (!descriptor) {
            throw new CapabilityBrokerError(
              'unregistered_operation',
              `Resource observation advertised unavailable operation ${id}.`,
              { category: 'failed' }
            )
          }
          return descriptor
        })
      : discovered

    return capabilityObservationSchema.parse({
      resource: refreshedHandle,
      resourceRef: state.resourceRef,
      resourceKind: state.resourceKind,
      semanticRevision: state.semanticRevision,
      layoutRevision: state.layoutRevision,
      observedAt: this.#now().toISOString(),
      state: observed.data.state,
      operations
    })
  }

  async invoke(
    rawCaller: CapabilityCallerContextInput,
    rawRequest: CapabilityInvocationRequest,
    options: { signal?: AbortSignal } = {}
  ): Promise<CapabilityInvocationResult> {
    const caller = this.#parseCaller(rawCaller)
    const requestResult = capabilityInvocationRequestSchema.safeParse(rawRequest)
    if (!requestResult.success) {
      throw new CapabilityBrokerError('invalid_invocation', 'Capability invocation is invalid.', {
        details: { issues: requestResult.error.issues.map((issue) => issue.message) }
      })
    }
    const request = requestResult.data
    let definition: CapabilityDefinition | undefined
    let resource: ResourceState | undefined
    try {
      definition = this.registry.get(request.actionId)
      if (!definition) {
        throw new CapabilityBrokerError('unknown_capability', `Capability ${request.actionId} is not registered.`)
      }
      this.#authorizeAudience(caller, definition)
      resource = this.#authorizeScope(caller, definition, request)
      this.#authorizeApproval(caller, definition, request.invocationId)

      const parsedInput = definition.inputSchema.safeParse(request.input)
      if (!parsedInput.success) {
        throw new CapabilityBrokerError('invalid_input', `Input for ${request.actionId} failed validation.`, {
          details: { issues: parsedInput.error.issues.map((issue) => issue.message) }
        })
      }

      if (definition.descriptor.effect !== 'read' && !request.invocationId) {
        throw new CapabilityBrokerError(
          'invocation_id_required',
          `Non-read capability ${request.actionId} requires an invocation ID.`
        )
      }
      if (request.expectedRevision && !resource) {
        throw new CapabilityBrokerError('revision_without_resource', 'Expected revision requires a resource handle.')
      }

      const beforeRevision = resource?.semanticRevision
      const fingerprint = stableJson({
        actionId: request.actionId,
        resourceRef: resource?.resourceRef ?? null,
        expectedRevision: request.expectedRevision ?? null,
        input: request.input
      })
      const idempotencyKey = request.invocationId
        ? `${caller.audience}\u0000${caller.callerId}\u0000${caller.workspaceId ?? ''}\u0000${request.actionId}\u0000${request.invocationId}`
        : undefined

      if (idempotencyKey) {
        const existing = this.#idempotency.get(idempotencyKey)
        if (existing) {
          if (existing.fingerprint !== fingerprint) {
            throw new CapabilityBrokerError(
              'idempotency_conflict',
              'The invocation ID was already used with a different request.'
            )
          }
          const original = await existing.promise
          const replayed = capabilityInvocationResultSchema.parse({ ...original, replayed: true })
          this.#appendAudit({
            status: 'replayed',
            caller,
            definition,
            request,
            resource,
            beforeRevision: replayed.beforeRevision,
            afterRevision: replayed.afterRevision
          })
          return replayed
        }
      }

      if (definition.descriptor.concurrency.revision === 'optimistic') {
        if (!request.expectedRevision) {
          throw new CapabilityBrokerError(
            'expected_revision_required',
            `Capability ${request.actionId} requires an expected semantic revision.`
          )
        }
        if (request.expectedRevision !== beforeRevision) {
          throw new CapabilityBrokerError('revision_conflict', 'The resource semantic revision is stale.', {
            details: { expected: request.expectedRevision, actual: beforeRevision ?? null }
          })
        }
        if (request.resource?.semanticRevision !== request.expectedRevision) {
          throw new CapabilityBrokerError('revision_conflict', 'The resource handle is bound to a stale semantic revision.', {
            details: {
              expected: request.expectedRevision,
              handle: request.resource?.semanticRevision ?? null
            }
          })
        }
      }

      const execution = this.#execute({
        caller,
        definition,
        request,
        parsedInput: parsedInput.data,
        resource,
        beforeRevision,
        signal: options.signal
      })
      if (idempotencyKey) {
        this.#idempotency.set(idempotencyKey, { fingerprint, promise: execution })
        this.#trimMap(this.#idempotency, this.#maxIdempotencyEntries)
        void execution.catch(() => {
          if (this.#idempotency.get(idempotencyKey)?.promise === execution) this.#idempotency.delete(idempotencyKey)
        })
      }
      return await execution
    } catch (error) {
      const brokerError = error instanceof CapabilityBrokerError
        ? error
        : new CapabilityBrokerError('invocation_failed', 'Capability invocation failed.', {
            category: 'failed',
            cause: error
          })
      this.#appendAudit({
        status: brokerError.category === 'failed' ? 'failed' : 'rejected',
        caller,
        definition,
        request,
        resource,
        beforeRevision: resource?.semanticRevision,
        errorCode: brokerError.code
      })
      throw brokerError
    }
  }

  async describeResourceContent(
    rawCaller: CapabilityCallerContextInput,
    rawHandle: CapabilityResourceHandle
  ): Promise<CapabilityResourceContentDescriptor> {
    const caller = this.#parseCaller(rawCaller)
    const handle = capabilityResourceHandleSchema.parse(rawHandle)
    const { state } = this.#resolveHandle(caller, handle)
    const actionId = this.#contentAction(state, 'describeActionId')
    const result = await this.invoke(caller, { actionId, resource: handle, input: {} })
    const parsed = z.object({
      ok: z.literal(true),
      descriptor: z.object({
        file: z.object({
          name: z.string().trim().min(1).max(1_024).optional(),
          mimeType: z.string().trim().min(1).max(256).optional()
        }).passthrough(),
        range: z.object({
          available: z.literal(true),
          size: z.number().int().nonnegative(),
          maxChunkBytes: z.number().int().positive(),
          recommendedChunkBytes: z.number().int().positive()
        }).passthrough()
      }).passthrough()
    }).passthrough().safeParse(result.output)
    if (!parsed.success) {
      throw new CapabilityBrokerError(
        'invalid_resource_content_descriptor',
        `Capability ${actionId} did not return a valid byte-range descriptor.`,
        { category: 'failed' }
      )
    }
    return capabilityResourceContentDescriptorSchema.parse({
      size: parsed.data.descriptor.range.size,
      mimeType: parsed.data.descriptor.file.mimeType || 'application/octet-stream',
      ...(parsed.data.descriptor.file.name ? { fileName: parsed.data.descriptor.file.name } : {}),
      maxChunkBytes: parsed.data.descriptor.range.maxChunkBytes,
      recommendedChunkBytes: parsed.data.descriptor.range.recommendedChunkBytes
    })
  }

  async readResourceContentRange(
    rawCaller: CapabilityCallerContextInput,
    rawHandle: CapabilityResourceHandle,
    range: { offset: number; length: number }
  ): Promise<CapabilityResourceContentRange> {
    const caller = this.#parseCaller(rawCaller)
    const handle = capabilityResourceHandleSchema.parse(rawHandle)
    const { state } = this.#resolveHandle(caller, handle)
    const actionId = this.#contentAction(state, 'readRangeActionId')
    const result = await this.invoke(caller, {
      actionId,
      resource: handle,
      input: {
        range: z.object({
          offset: z.number().int().nonnegative(),
          length: z.number().int().positive()
        }).strict().parse(range)
      }
    })
    const parsed = z.object({
      ok: z.literal(true),
      offset: z.number().int().nonnegative(),
      length: z.number().int().nonnegative(),
      size: z.number().int().nonnegative(),
      dataBase64: z.string()
    }).passthrough().safeParse(result.output)
    if (!parsed.success) {
      throw new CapabilityBrokerError(
        'invalid_resource_content_range',
        `Capability ${actionId} did not return a valid byte range.`,
        { category: 'failed' }
      )
    }
    const decodedLength = Buffer.from(parsed.data.dataBase64, 'base64').length
    if (parsed.data.offset !== range.offset
      || parsed.data.length <= 0
      || parsed.data.length > range.length
      || parsed.data.offset + parsed.data.length > parsed.data.size
      || decodedLength !== parsed.data.length) {
      throw new CapabilityBrokerError(
        'invalid_resource_content_range',
        `Capability ${actionId} returned an inconsistent byte range.`,
        { category: 'failed' }
      )
    }
    return capabilityResourceContentRangeSchema.parse({
      offset: parsed.data.offset,
      length: parsed.data.length,
      size: parsed.data.size,
      dataBase64: parsed.data.dataBase64
    })
  }

  listAuditRecords(): CapabilityAuditRecord[] {
    return [...this.#auditRecords]
  }

  listEvents(
    rawCaller: CapabilityCallerContextInput,
    rawQuery: CapabilityEventQuery | undefined = undefined
  ): CapabilityResourceChangeEvent[] {
    const caller = this.#parseCaller(rawCaller)
    const query = capabilityEventQuerySchema.parse(rawQuery ?? {})
    const afterIndex = query.afterEventId
      ? this.#events.findIndex((event) => event.id === query.afterEventId)
      : -1
    return this.#events
      .slice(afterIndex + 1)
      .filter((event) => this.#eventVisibleToCaller(event, caller))
      .filter((event) => !query.resourceRef || event.resourceRef === query.resourceRef)
      .slice(0, query.limit)
  }

  subscribe(
    rawCaller: CapabilityCallerContextInput,
    listener: (event: CapabilityResourceChangeEvent) => void
  ): () => void {
    const caller = this.#parseCaller(rawCaller)
    if (typeof listener !== 'function') {
      throw new CapabilityBrokerError('invalid_listener', 'Capability event listener must be a function.')
    }
    const subscription = { caller, listener }
    this.#subscriptions.add(subscription)
    return () => this.#subscriptions.delete(subscription)
  }

  async #execute(options: {
    caller: CapabilityCallerContext
    definition: CapabilityDefinition
    request: CapabilityInvocationRequest
    parsedInput: unknown
    resource?: ResourceState
    beforeRevision?: string
    signal?: AbortSignal
  }): Promise<CapabilityInvocationResult> {
    const { caller, definition, request, resource, beforeRevision, signal } = options
    let rawResult: Awaited<ReturnType<CapabilityDefinition['handler']>>
    try {
      rawResult = await definition.handler(options.parsedInput, {
        caller,
        resource: resource && this.#resolvedResource(resource),
        issueResource: (registration) => this.issueResourceHandle(caller, registration),
        signal
      })
    } catch (error) {
      throw new CapabilityBrokerError('handler_failed', `Handler for ${request.actionId} failed.`, {
        category: 'failed',
        cause: error
      })
    }
    if (!rawResult || typeof rawResult !== 'object' || !Object.hasOwn(rawResult, 'output')) {
      throw new CapabilityBrokerError('invalid_handler_result', 'Capability handler must return an output envelope.', {
        category: 'failed'
      })
    }

    const parsedOutput = definition.outputSchema.safeParse(rawResult.output)
    if (!parsedOutput.success) {
      throw new CapabilityBrokerError('invalid_output', `Output for ${request.actionId} failed validation.`, {
        category: 'failed',
        details: { issues: parsedOutput.error.issues.map((issue) => issue.message) }
      })
    }
    const outputResult = capabilityJsonValueSchema.safeParse(parsedOutput.data)
    if (!outputResult.success) {
      throw new CapabilityBrokerError('non_serializable_output', 'Capability output must be JSON serializable.', {
        category: 'failed'
      })
    }

    const mutation = isMutation(definition)
    const changed = rawResult.changed ?? Boolean(mutation && resource)
    if (changed && !mutation) {
      throw new CapabilityBrokerError('invalid_change_effect', 'Only mutation effects may report resource changes.', {
        category: 'failed'
      })
    }
    if (changed && !resource) {
      throw new CapabilityBrokerError('changed_resource_required', 'A changed result requires a resource handle.', {
        category: 'failed'
      })
    }

    let afterRevision = beforeRevision
    let refreshedHandle: CapabilityResourceHandle | undefined
    if (changed && resource) {
      const semanticRevision = rawResult.semanticRevision?.trim()
      if (!semanticRevision || semanticRevision === beforeRevision) {
        throw new CapabilityBrokerError(
          'invalid_semantic_revision',
          'A changed resource result must return a new semantic revision.',
          { category: 'failed' }
        )
      }
      resource.semanticRevision = semanticRevision
      resource.layoutRevision = rawResult.layoutRevision ?? resource.layoutRevision
      afterRevision = semanticRevision
      refreshedHandle = this.issueResourceHandle(caller, {
        resourceId: resource.resourceId,
        resourceKind: resource.resourceKind,
        workspaceId: resource.workspaceId,
        audiences: resource.allowedAudiences,
        semanticRevision,
        layoutRevision: resource.layoutRevision,
        observe: resource.observe,
        contentTransport: resource.contentTransport
      })
    }

    const result = capabilityInvocationResultSchema.parse({
      actionId: request.actionId,
      invocationId: request.invocationId,
      output: outputResult.data,
      resource: refreshedHandle,
      beforeRevision,
      afterRevision,
      changed,
      replayed: false,
      completedAt: this.#now().toISOString()
    })
    this.#appendAudit({
      status: 'success',
      caller,
      definition,
      request,
      resource,
      beforeRevision,
      afterRevision
    })

    if (changed && resource && beforeRevision && afterRevision && request.invocationId) {
      this.#publishEvent(capabilityResourceChangeEventSchema.parse({
        id: opaqueId('event'),
        type: 'resource.changed',
        occurredAt: this.#now().toISOString(),
        workspaceId: resource.workspaceId,
        resourceRef: resource.resourceRef,
        resourceKind: resource.resourceKind,
        actionId: request.actionId,
        invocationId: request.invocationId,
        beforeRevision,
        afterRevision
      }))
    }
    return result
  }

  #parseCaller(rawCaller: CapabilityCallerContextInput): CapabilityCallerContext {
    const result = capabilityCallerContextSchema.safeParse(rawCaller)
    if (!result.success) {
      throw new CapabilityBrokerError('invalid_caller', 'Capability caller context is invalid.', {
        details: { issues: result.error.issues.map((issue) => issue.message) }
      })
    }
    return result.data
  }

  #parseResourceRegistration(raw: CapabilityResourceRegistration): CapabilityResourceRegistration {
    if (!raw || typeof raw !== 'object' || typeof raw.observe !== 'function') {
      throw new CapabilityBrokerError('invalid_resource_registration', 'Resource registration requires an observer.')
    }
    const resourceId = raw.resourceId?.trim()
    const resourceKind = raw.resourceKind?.trim()
    const semanticRevision = raw.semanticRevision?.trim()
    if (!resourceId || !resourceKind || !semanticRevision) {
      throw new CapabilityBrokerError(
        'invalid_resource_registration',
        'Resource ID, kind, and semantic revision are required.'
      )
    }
    return {
      ...raw,
      resourceId,
      resourceKind,
      workspaceId: normalizedWorkspaceId(raw.workspaceId),
      audiences: raw.audiences === undefined
        ? undefined
        : z.array(capabilityAudienceSchema).min(1).max(3).refine(
            (audiences) => new Set(audiences).size === audiences.length,
            'Resource audiences must be unique.'
          ).parse(raw.audiences),
      semanticRevision,
      layoutRevision: raw.layoutRevision?.trim() || undefined,
      contentTransport: raw.contentTransport
        ? z.object({
            describeActionId: z.string().trim().min(1).max(192),
            readRangeActionId: z.string().trim().min(1).max(192)
          }).strict().parse(raw.contentTransport)
        : undefined
    }
  }

  #authorizedResourceRef(
    caller: CapabilityCallerContext,
    resourceRef: string
  ): ResourceState {
    const state = this.#resourcesByRef.get(resourceRef)
    if (!state) {
      throw new CapabilityBrokerError('resource_unavailable', 'Resource reference is no longer available.')
    }
    if (state.workspaceId !== caller.workspaceId) {
      throw new CapabilityBrokerError('resource_scope_mismatch', 'Resource reference is outside the caller scope.')
    }
    if (!state.allowedAudiences.includes(caller.audience)) {
      throw new CapabilityBrokerError('resource_audience_denied', 'Resource reference is not transferable to this audience.')
    }
    return state
  }

  #resolveHandle(
    caller: CapabilityCallerContext,
    rawHandle: CapabilityResourceHandle
  ): { grant: ResourceGrant; state: ResourceState } {
    const handleResult = capabilityResourceHandleSchema.safeParse(rawHandle)
    if (!handleResult.success) {
      throw new CapabilityBrokerError('invalid_resource_handle', 'Resource handle is invalid.')
    }
    const handle = handleResult.data
    const grant = this.#handles.get(handle.token)
    if (!grant
      || grant.semanticRevision !== handle.semanticRevision
      || grant.expiresAt !== handle.expiresAt) {
      throw new CapabilityBrokerError('invalid_resource_handle', 'Resource handle is unknown or forged.')
    }
    if (new Date(grant.expiresAt).getTime() <= this.#now().getTime()) {
      this.#handles.delete(grant.token)
      throw new CapabilityBrokerError('resource_handle_expired', 'Resource handle has expired.')
    }
    if (grant.workspaceId !== caller.workspaceId) {
      throw new CapabilityBrokerError('resource_scope_mismatch', 'Resource handle is outside the caller scope.')
    }
    const state = this.#resources.get(grant.resourceKey)
    if (!state) throw new CapabilityBrokerError('resource_unavailable', 'Resource is no longer available.')
    if (!state.allowedAudiences.includes(caller.audience)) {
      throw new CapabilityBrokerError('resource_audience_denied', 'Resource handle is not transferable to this audience.')
    }
    return { grant, state }
  }

  #authorizeAudience(caller: CapabilityCallerContext, definition: CapabilityDefinition): void {
    if (!definition.descriptor.audiences.includes(caller.audience)) {
      throw new CapabilityBrokerError(
        'audience_denied',
        `Capability ${definition.descriptor.id} is not available to ${caller.audience} callers.`
      )
    }
  }

  #authorizeScope(
    caller: CapabilityCallerContext,
    definition: CapabilityDefinition,
    request: CapabilityInvocationRequest
  ): ResourceState | undefined {
    const { scope, resourceKinds } = definition.descriptor
    if (scope === 'global') {
      if (request.resource) throw new CapabilityBrokerError('unexpected_resource', 'Global capability does not accept a resource.')
      return undefined
    }
    if (scope === 'workspace') {
      if (!caller.workspaceId) {
        throw new CapabilityBrokerError('workspace_required', 'Workspace capability requires caller workspace scope.')
      }
      if (request.resource) throw new CapabilityBrokerError('unexpected_resource', 'Workspace capability does not accept a resource.')
      return undefined
    }
    if (!request.resource) {
      throw new CapabilityBrokerError('resource_required', 'Resource capability requires an opaque resource handle.')
    }
    const { state } = this.#resolveHandle(caller, request.resource)
    if (!resourceKinds.includes(state.resourceKind)) {
      throw new CapabilityBrokerError(
        'resource_kind_mismatch',
        `Capability ${definition.descriptor.id} does not support ${state.resourceKind}.`
      )
    }
    return state
  }

  #authorizeApproval(
    caller: CapabilityCallerContext,
    definition: CapabilityDefinition,
    invocationId: string | undefined
  ): void {
    const approval = definition.descriptor.approval
    if (approval === 'none') return
    if (!invocationId) {
      throw new CapabilityBrokerError('approval_denied', 'Approved capability requires an invocation ID.')
    }
    const grant = caller.approvals.find((candidate) => (
      candidate.actionId === definition.descriptor.id
      && candidate.invocationId === invocationId
      && candidate.mode === approval
    ))
    if (!grant) {
      throw new CapabilityBrokerError(
        'approval_denied',
        `Capability ${definition.descriptor.id} requires ${approval} approval for this invocation.`
      )
    }
  }

  #resolvedResource(resource: ResourceState): ResolvedCapabilityResource {
    return {
      resourceId: resource.resourceId,
      resourceRef: resource.resourceRef,
      resourceKind: resource.resourceKind,
      workspaceId: resource.workspaceId,
      semanticRevision: resource.semanticRevision,
      layoutRevision: resource.layoutRevision
    }
  }

  #contentAction(
    state: ResourceState,
    key: 'describeActionId' | 'readRangeActionId'
  ): string {
    const actionId = state.contentTransport?.[key]?.trim()
    if (!actionId) {
      throw new CapabilityBrokerError(
        'resource_content_unavailable',
        'The resource does not expose broker-managed byte-range content.'
      )
    }
    this.#validateContentAction(state.resourceKind, actionId)
    return actionId
  }

  #validateContentAction(resourceKind: string, actionId: string): void {
    const definition = this.registry.get(actionId)
    if (!definition
      || definition.descriptor.scope !== 'resource'
      || definition.descriptor.effect !== 'read'
      || !definition.descriptor.resourceKinds.includes(resourceKind)) {
      throw new CapabilityBrokerError(
        'invalid_resource_content_registration',
        `Resource content action ${actionId} is not a compatible registered read capability.`,
        { category: 'failed' }
      )
    }
  }

  #appendAudit(input: {
    status: CapabilityAuditRecord['status']
    caller: CapabilityCallerContext
    definition?: CapabilityDefinition
    request: CapabilityInvocationRequest
    resource?: ResourceState
    beforeRevision?: string
    afterRevision?: string
    errorCode?: string
  }): void {
    const record: CapabilityAuditRecord = {
      id: opaqueId('audit'),
      occurredAt: this.#now().toISOString(),
      status: input.status,
      caller: {
        audience: input.caller.audience,
        callerId: input.caller.callerId,
        ...(input.caller.workspaceId ? { workspaceId: input.caller.workspaceId } : {})
      },
      actionId: input.request.actionId,
      ...(input.request.invocationId ? { invocationId: input.request.invocationId } : {}),
      ...(input.resource ? { resourceRef: input.resource.resourceRef } : {}),
      ...(input.definition ? {
        effect: input.definition.descriptor.effect,
        approval: input.definition.descriptor.approval
      } : {}),
      ...(input.beforeRevision ? { beforeRevision: input.beforeRevision } : {}),
      ...(input.afterRevision ? { afterRevision: input.afterRevision } : {}),
      ...(input.errorCode ? { errorCode: input.errorCode } : {})
    }
    this.#auditRecords.push(capabilityAuditRecordSchema.parse(record))
    if (this.#auditRecords.length > this.#maxAuditRecords) {
      this.#auditRecords.splice(0, this.#auditRecords.length - this.#maxAuditRecords)
    }
  }

  #publishEvent(event: CapabilityResourceChangeEvent): void {
    this.#events.push(event)
    if (this.#events.length > this.#maxEvents) this.#events.splice(0, this.#events.length - this.#maxEvents)
    for (const subscription of this.#subscriptions) {
      if (!this.#eventVisibleToCaller(event, subscription.caller)) continue
      try {
        subscription.listener(event)
      } catch {
        // Event consumers are isolated from successful domain mutations.
      }
    }
  }

  #eventVisibleToCaller(event: CapabilityResourceChangeEvent, caller: CapabilityCallerContext): boolean {
    return event.workspaceId === caller.workspaceId
  }

  #trimMap<Key, Value>(map: Map<Key, Value>, maxSize: number): void {
    while (map.size > maxSize) {
      const oldest = map.keys().next().value
      if (oldest === undefined) return
      map.delete(oldest)
    }
  }
}
