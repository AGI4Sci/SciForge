import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  capabilityCallerContextSchema,
  capabilityDiscoveryQuerySchema,
  capabilityJsonValueSchema,
  capabilityResourceHandleSchema,
  type CapabilityCallerContext,
  type CapabilityCallerContextInput,
  type CapabilityDescriptor,
  type CapabilityDiscoveryQuery,
  type CapabilityEventQuery,
  type CapabilityInvocationRequest,
  type CapabilityInvocationResult,
  type CapabilityJsonValue,
  type CapabilityObservation,
  type CapabilityObserveRequest,
  type CapabilityResourceChangeEvent,
  type CapabilityResourceHandle
} from '../../shared/capability-broker'

export const CAPABILITY_AGENT_TOOL_NAMES = Object.freeze({
  discover: 'sciforge_discover',
  observe: 'sciforge_observe',
  invoke: 'sciforge_invoke',
  events: 'sciforge_events'
} as const)

export type CapabilityAgentToolName = typeof CAPABILITY_AGENT_TOOL_NAMES[keyof typeof CAPABILITY_AGENT_TOOL_NAMES]

export type CapabilityAgentToolDefinition = Readonly<{
  type: 'function'
  name: CapabilityAgentToolName
  description: string
  inputSchema: Record<string, unknown>
}>

export type CapabilityAgentToolRequestContext = Readonly<{
  requestId: string | number
  /** Internal runtime provenance; never included in model-visible schemas. */
  runtimeId?: 'codex' | 'sciforge' | 'claude'
  threadId?: string
  turnId?: string
  callId?: string
  workspaceId?: string
}>

export type CapabilityAgentToolCall = Readonly<{
  name: string
  arguments?: unknown
  context: CapabilityAgentToolRequestContext
}>

const agentOperationRefSchema = z.string().regex(/^op_[A-Za-z0-9_-]{20,}$/u)
const agentSchemaRefSchema = z.string().regex(/^schema_[A-Za-z0-9_-]{20,}$/u)
const agentResourceRefSchema = z.string().regex(/^res_[A-Za-z0-9_-]{20,}$/u)

const agentDiscoverRequestSchema = capabilityDiscoveryQuerySchema.extend({
  operationRef: agentOperationRefSchema.optional(),
  includeSchema: z.boolean().optional()
}).strict()

const agentObserveRequestSchema = z.object({
  resourceRef: agentResourceRefSchema
}).strict()

const agentInvokeRequestSchema = z.object({
  operationRef: agentOperationRefSchema,
  resourceRef: agentResourceRefSchema.optional(),
  input: capabilityJsonValueSchema.default({})
}).strict()

const agentEventsRequestSchema = z.object({
  afterEventId: z.string().regex(/^event_[A-Za-z0-9_-]{20,}$/u).optional(),
  resourceRef: agentResourceRefSchema.optional(),
  limit: z.number().int().min(1).max(500).default(100)
}).strict()

export type AgentOperationDescriptor = Readonly<{
  operationRef: string
  schemaRef: string
  title: string
  description: string
  scope: CapabilityDescriptor['scope']
  effect: CapabilityDescriptor['effect']
  approval: CapabilityDescriptor['approval']
  resourceKinds: string[]
  tags: string[]
  inputShape?: CapabilityJsonValue
}>

export type AgentCapabilityObservation = Readonly<{
  resourceRef: string
  resourceKind: string
  observedAt: string
  state: CapabilityJsonValue
  operations: AgentOperationDescriptor[]
}>

export type AgentCapabilityInvocation = Readonly<{
  operationRef: string
  output: CapabilityJsonValue
  resourceRef?: string
  changed: boolean
  replayed: boolean
  completedAt: string
}>

export type AgentCapabilityEvent = Readonly<{
  eventId: string
  type: 'resource.changed'
  occurredAt: string
  resourceRef: string
  resourceKind: string
  operationRef: string
}>

export type CapabilityAgentToolResult =
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.discover; value: AgentOperationDescriptor[] }
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.observe; value: AgentCapabilityObservation }
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.invoke; value: AgentCapabilityInvocation }
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.events; value: AgentCapabilityEvent[] }

export type CapabilityAgentBroker = Readonly<{
  discover: (
    caller: CapabilityCallerContext,
    query?: CapabilityDiscoveryQuery
  ) => CapabilityDescriptor[] | Promise<CapabilityDescriptor[]>
  observe: (
    caller: CapabilityCallerContext,
    request: CapabilityObserveRequest
  ) => CapabilityObservation | Promise<CapabilityObservation>
  bindResourceRef: (
    caller: CapabilityCallerContext,
    resourceRef: string
  ) => CapabilityResourceHandle | Promise<CapabilityResourceHandle>
  invoke: (
    caller: CapabilityCallerContext,
    request: CapabilityInvocationRequest,
    options?: { signal?: AbortSignal }
  ) => CapabilityInvocationResult | Promise<CapabilityInvocationResult>
  listEvents: (
    caller: CapabilityCallerContext,
    query?: CapabilityEventQuery
  ) => CapabilityResourceChangeEvent[] | Promise<CapabilityResourceChangeEvent[]>
}>

export type CapabilityAgentToolSurfaceOptions = Readonly<{
  broker: CapabilityAgentBroker
  resolveCaller: (
    context: CapabilityAgentToolRequestContext
  ) => CapabilityCallerContextInput | Promise<CapabilityCallerContextInput>
}>

type CallerCache = {
  operationsByRef: Map<string, CapabilityDescriptor>
  operationRefsById: Map<string, string>
  schemaRefsById: Map<string, string>
  resources: Map<string, CapabilityResourceHandle>
}

const toolDefinitions = Object.freeze([
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.discover,
    'Discover current SciForge operations. Results use opaque operation and schema references; request one operation with includeSchema=true for its compact input shape.',
    agentDiscoverRequestSchema
  ),
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.observe,
    'Observe a previously returned opaque SciForge resource reference.',
    agentObserveRequestSchema
  ),
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.invoke,
    'Invoke a discovered operation using its opaque operation reference and domain input. Revision and idempotency fields are managed internally.',
    agentInvokeRequestSchema
  ),
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.events,
    'Read authorized SciForge resource-change events using opaque resource and operation references.',
    agentEventsRequestSchema
  )
]) satisfies readonly CapabilityAgentToolDefinition[]

export class CapabilityAgentToolSurface {
  readonly #broker: CapabilityAgentBroker
  readonly #resolveCaller: CapabilityAgentToolSurfaceOptions['resolveCaller']
  readonly #callerCaches = new Map<string, CallerCache>()

  constructor(options: CapabilityAgentToolSurfaceOptions) {
    this.#broker = options.broker
    this.#resolveCaller = options.resolveCaller
  }

  tools(): readonly CapabilityAgentToolDefinition[] {
    return toolDefinitions
  }

  async call(request: CapabilityAgentToolCall, options: { signal?: AbortSignal } = {}): Promise<CapabilityAgentToolResult> {
    const caller = capabilityCallerContextSchema.parse(await this.#resolveCaller(request.context))
    if (caller.audience !== 'agent') {
      throw new CapabilityAgentToolError(
        'invalid_caller_audience',
        `The agent capability surface requires an agent caller, received ${caller.audience}.`
      )
    }
    const cache = this.#cacheFor(caller)
    const rawArguments = request.arguments === undefined ? {} : request.arguments

    switch (request.name) {
      case CAPABILITY_AGENT_TOOL_NAMES.discover: {
        const parsed = agentDiscoverRequestSchema.parse(rawArguments)
        if (parsed.operationRef) {
          const descriptor = this.#operation(cache, parsed.operationRef)
          return {
            tool: CAPABILITY_AGENT_TOOL_NAMES.discover,
            value: [this.#agentOperation(cache, descriptor, parsed.includeSchema === true)]
          }
        }
        const descriptors = await this.#broker.discover(caller, {
          ...(parsed.text ? { text: parsed.text } : {}),
          ...(parsed.resourceKind ? { resourceKind: parsed.resourceKind } : {}),
          ...(parsed.effects ? { effects: parsed.effects } : {}),
          ...(parsed.tags ? { tags: parsed.tags } : {})
        })
        return {
          tool: CAPABILITY_AGENT_TOOL_NAMES.discover,
          value: descriptors.map((descriptor) => this.#agentOperation(cache, descriptor, false))
        }
      }
      case CAPABILITY_AGENT_TOOL_NAMES.observe: {
        const parsed = agentObserveRequestSchema.parse(rawArguments)
        const observation = await this.#observe(caller, cache, parsed.resourceRef)
        return { tool: CAPABILITY_AGENT_TOOL_NAMES.observe, value: observation }
      }
      case CAPABILITY_AGENT_TOOL_NAMES.invoke: {
        const parsed = agentInvokeRequestSchema.parse(rawArguments)
        const descriptor = this.#operation(cache, parsed.operationRef)
        let handle = parsed.resourceRef ? this.#resource(cache, parsed.resourceRef) : undefined
        const invocationId = descriptor.effect === 'read' ? undefined : opaqueId('agent_inv')
        const invoke = (resource: CapabilityResourceHandle | undefined) => this.#broker.invoke(caller, {
          actionId: descriptor.id,
          ...(resource ? { resource } : {}),
          ...(descriptor.concurrency.revision === 'optimistic' && resource
            ? { expectedRevision: resource.semanticRevision }
            : {}),
          ...(invocationId ? { invocationId } : {}),
          input: parsed.input
        }, options)
        let result: CapabilityInvocationResult
        try {
          result = await invoke(handle)
        } catch (error) {
          if (!parsed.resourceRef || !handle || !isExpiredResourceHandleError(error)) throw error
          const renewed = await this.#bindResourceRef(caller, parsed.resourceRef)
          if (renewed.semanticRevision !== handle.semanticRevision) {
            throw new CapabilityAgentToolError(
              'stale_resource_ref',
              'The resource changed while its handle was expired. Observe the resource again before invoking an operation.'
            )
          }
          handle = renewed
          cache.resources.set(parsed.resourceRef, renewed)
          result = await invoke(renewed)
        }
        const sanitizedOutput = await this.#sanitizeOutput(caller, cache, result.output)
        let resourceRef = parsed.resourceRef
        if (result.resource) {
          const observed = await this.#broker.observe(caller, { resource: result.resource })
          this.#rememberObservation(cache, observed)
          resourceRef = observed.resourceRef
        }
        return {
          tool: CAPABILITY_AGENT_TOOL_NAMES.invoke,
          value: {
            operationRef: parsed.operationRef,
            output: sanitizedOutput,
            ...(resourceRef ? { resourceRef } : {}),
            changed: result.changed,
            replayed: result.replayed,
            completedAt: result.completedAt
          }
        }
      }
      case CAPABILITY_AGENT_TOOL_NAMES.events: {
        const parsed = agentEventsRequestSchema.parse(rawArguments)
        const [events, descriptors] = await Promise.all([
          this.#broker.listEvents(caller, {
          ...(parsed.afterEventId ? { afterEventId: parsed.afterEventId } : {}),
          ...(parsed.resourceRef ? { resourceRef: parsed.resourceRef } : {}),
          limit: parsed.limit
          }),
          this.#broker.discover(caller)
        ])
        return {
          tool: CAPABILITY_AGENT_TOOL_NAMES.events,
          value: events.map((event) => ({
            eventId: event.id,
            type: event.type,
            occurredAt: event.occurredAt,
            resourceRef: event.resourceRef,
            resourceKind: event.resourceKind,
            operationRef: this.#operationRef(cache, this.#descriptorForId(descriptors, event.actionId))
          }))
        }
      }
      default:
        throw new CapabilityAgentToolError('unknown_agent_tool', `Unknown capability agent tool: ${request.name}`)
    }
  }

  #cacheFor(caller: CapabilityCallerContext): CallerCache {
    const key = `${caller.callerId}\u0000${caller.workspaceId ?? ''}`
    let cache = this.#callerCaches.get(key)
    if (!cache) {
      cache = {
        operationsByRef: new Map(),
        operationRefsById: new Map(),
        schemaRefsById: new Map(),
        resources: new Map()
      }
      this.#callerCaches.set(key, cache)
    }
    return cache
  }

  #agentOperation(cache: CallerCache, descriptor: CapabilityDescriptor, includeSchema: boolean): AgentOperationDescriptor {
    const operationRef = this.#operationRef(cache, descriptor)
    const schemaRef = this.#schemaRef(cache, descriptor)
    return {
      operationRef,
      schemaRef,
      title: descriptor.title,
      description: descriptor.description,
      scope: descriptor.scope,
      effect: descriptor.effect,
      approval: descriptor.approval,
      resourceKinds: [...descriptor.resourceKinds],
      tags: [...descriptor.tags],
      ...(includeSchema ? { inputShape: compactInputShape(descriptor.inputSchema) } : {})
    }
  }

  #operationRef(cache: CallerCache, descriptor: CapabilityDescriptor): string {
    const existing = cache.operationRefsById.get(descriptor.id)
    if (existing) return existing
    const ref = opaqueId('op')
    cache.operationRefsById.set(descriptor.id, ref)
    cache.operationsByRef.set(ref, descriptor)
    return ref
  }

  #schemaRef(cache: CallerCache, descriptor: CapabilityDescriptor): string {
    const existing = cache.schemaRefsById.get(descriptor.id)
    if (existing) return existing
    const ref = opaqueId('schema')
    cache.schemaRefsById.set(descriptor.id, ref)
    return ref
  }

  #operation(cache: CallerCache, ref: string): CapabilityDescriptor {
    const descriptor = cache.operationsByRef.get(ref)
    if (!descriptor) throw new CapabilityAgentToolError('unknown_operation_ref', 'The operation reference is unknown or expired.')
    return descriptor
  }

  #resource(cache: CallerCache, ref: string): CapabilityResourceHandle {
    const handle = cache.resources.get(ref)
    if (!handle) throw new CapabilityAgentToolError('unknown_resource_ref', 'The resource reference is unknown or expired.')
    return handle
  }

  async #observe(
    caller: CapabilityCallerContext,
    cache: CallerCache,
    resourceRef: string
  ): Promise<AgentCapabilityObservation> {
    let resource = cache.resources.get(resourceRef)
    if (!resource) resource = await this.#bindResourceRef(caller, resourceRef)
    let observation: CapabilityObservation
    try {
      observation = await this.#broker.observe(caller, { resource })
    } catch (error) {
      if (!isExpiredResourceHandleError(error)) throw error
      resource = await this.#bindResourceRef(caller, resourceRef)
      observation = await this.#broker.observe(caller, { resource })
    }
    this.#rememberObservation(cache, observation)
    const state = await this.#sanitizeOutput(caller, cache, observation.state)
    return {
      resourceRef: observation.resourceRef,
      resourceKind: observation.resourceKind,
      observedAt: observation.observedAt,
      state,
      operations: observation.operations.map((descriptor) => this.#agentOperation(cache, descriptor, false))
    }
  }

  async #bindResourceRef(
    caller: CapabilityCallerContext,
    resourceRef: string
  ): Promise<CapabilityResourceHandle> {
    try {
      return capabilityResourceHandleSchema.parse(await this.#broker.bindResourceRef(caller, resourceRef))
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''
      if (code === 'resource_unavailable' || error instanceof z.ZodError) {
        throw new CapabilityAgentToolError('unknown_resource_ref', 'The resource reference is unknown or expired.')
      }
      throw error
    }
  }

  #rememberObservation(cache: CallerCache, observation: CapabilityObservation): void {
    cache.resources.set(observation.resourceRef, observation.resource)
    for (const descriptor of observation.operations) this.#operationRef(cache, descriptor)
  }

  async #sanitizeOutput(
    caller: CapabilityCallerContext,
    cache: CallerCache,
    value: CapabilityJsonValue
  ): Promise<CapabilityJsonValue> {
    const handle = capabilityResourceHandleSchema.safeParse(value)
    if (handle.success) {
      const observation = await this.#broker.observe(caller, { resource: handle.data })
      this.#rememberObservation(cache, observation)
      return { resourceRef: observation.resourceRef }
    }
    if (isRecord(value) && 'resource' in value) {
      const nestedHandle = capabilityResourceHandleSchema.safeParse(value.resource)
      if (nestedHandle.success) {
        const observation = await this.#broker.observe(caller, { resource: nestedHandle.data })
        this.#rememberObservation(cache, observation)
        const entries = await Promise.all(Object.entries(value)
          .filter(([key]) => key !== 'resource')
          .map(async ([key, entry]) => [key, await this.#sanitizeOutput(caller, cache, entry)] as const))
        return { ...Object.fromEntries(entries), resourceRef: observation.resourceRef }
      }
    }
    if (Array.isArray(value)) {
      return Promise.all(value.map((entry) => this.#sanitizeOutput(caller, cache, entry)))
    }
    if (value && typeof value === 'object') {
      const entries = await Promise.all(Object.entries(value).map(async ([key, entry]) => [
        key,
        await this.#sanitizeOutput(caller, cache, entry)
      ] as const))
      return Object.fromEntries(entries)
    }
    return value
  }

  #descriptorForId(descriptors: CapabilityDescriptor[], actionId: string): CapabilityDescriptor {
    const descriptor = descriptors.find((candidate) => candidate.id === actionId)
    if (!descriptor) throw new CapabilityAgentToolError('unknown_operation_ref', 'An event referenced an unavailable operation.')
    return descriptor
  }
}

export class CapabilityAgentToolError extends Error {
  readonly code:
    | 'invalid_caller_audience'
    | 'unknown_agent_tool'
    | 'unknown_operation_ref'
    | 'unknown_resource_ref'
    | 'stale_resource_ref'

  constructor(code: CapabilityAgentToolError['code'], message: string) {
    super(message)
    this.name = 'CapabilityAgentToolError'
    this.code = code
  }
}

export function createCapabilityAgentToolSurface(
  options: CapabilityAgentToolSurfaceOptions
): CapabilityAgentToolSurface {
  return new CapabilityAgentToolSurface(options)
}

export function capabilityAgentCallerId(
  context: Pick<CapabilityAgentToolRequestContext, 'requestId' | 'runtimeId' | 'threadId'>
): string {
  return context.threadId
    ? `${context.runtimeId ?? 'codex'}:${context.threadId}`
    : `${context.runtimeId ?? 'codex'}-request:${context.requestId}`
}

function isExpiredResourceHandleError(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const code = 'code' in error ? String(error.code) : ''
  return code === 'resource_handle_expired' || code === 'invalid_resource_handle'
}

function defineTool(
  name: CapabilityAgentToolName,
  description: string,
  schema: z.ZodType
): CapabilityAgentToolDefinition {
  const inputSchema = z.toJSONSchema(schema, { target: 'draft-07', unrepresentable: 'throw' })
  if (!isRecord(inputSchema)) throw new Error(`Agent tool ${name} must use an object input schema.`)
  return Object.freeze({ type: 'function', name, description, inputSchema: deepFreeze(inputSchema) })
}

function compactInputShape(value: CapabilityJsonValue): CapabilityJsonValue {
  if (!isRecord(value)) return {}
  const properties = isRecord(value.properties) ? value.properties : {}
  const required = new Set(Array.isArray(value.required)
    ? value.required.filter((entry): entry is string => typeof entry === 'string')
    : [])
  return {
    type: typeof value.type === 'string' ? value.type : 'object',
    properties: Object.fromEntries(Object.entries(properties).slice(0, 64).map(([name, raw]) => {
      const property = isRecord(raw) ? raw : {}
      return [name, {
        type: typeof property.type === 'string' ? property.type : inferSchemaType(property),
        required: required.has(name),
        ...(Array.isArray(property.enum) ? { enum: property.enum.slice(0, 32) as CapabilityJsonValue[] } : {}),
        ...(typeof property.description === 'string' ? { description: property.description.slice(0, 500) } : {})
      }]
    }))
  }
}

function inferSchemaType(value: Record<string, unknown>): string {
  if (Array.isArray(value.oneOf) || Array.isArray(value.anyOf)) return 'union'
  if (value.properties && typeof value.properties === 'object') return 'object'
  if (value.items) return 'array'
  return 'unknown'
}

function opaqueId(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString('base64url')}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}
