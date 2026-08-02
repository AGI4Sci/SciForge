import { randomBytes } from 'node:crypto'
import { z } from 'zod'
import {
  CAPABILITY_BROKER_CONTRACT_VERSION,
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
import {
  agentVisualCaptureInputSchema,
  agentVisualCaptureOutputSchema,
  agentVisualLookInputSchema,
  agentVisualLookOutputSchema,
  type AgentVisualCaptureInput,
  type AgentVisualCaptureOutput,
  type AgentVisualLookInput,
  type AgentVisualLookOutput
} from '../../shared/agent-visual'
import {
  nativeVisualResourceIdentity,
  normalizeNativeVisualToolError,
  type AgentRuntimeToolTurnIdentity,
  type NativeVisualToolErrorContext
} from '../runtime/agent-runtime/agent-tool-surface'

export const CAPABILITY_AGENT_TOOL_NAMES = Object.freeze({
  discover: 'sciforge_discover',
  observe: 'sciforge_observe',
  invoke: 'sciforge_invoke',
  events: 'sciforge_events',
  look: 'sciforge_look',
  capture: 'sciforge_capture'
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
  runtimeId: string
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

export type CapabilityAgentApprovalRequest = Readonly<{
  context: CapabilityAgentToolRequestContext
  actionId: string
  invocationId: string
  mode: 'confirmation'
  title: string
  description: string
  effect: CapabilityDescriptor['effect']
  input: CapabilityJsonValue
  resourceRef?: string
  resourceLabel?: string
}>

export type CapabilityAgentApprovalDecision = 'allowed' | 'denied' | 'cancelled'

export type AgentVisualRuntimeCallContext = Readonly<{
  caller: CapabilityCallerContext
  request: CapabilityAgentToolRequestContext
  signal: AbortSignal
}>

export type AgentVisualRuntime = Readonly<{
  look: (
    input: AgentVisualLookInput,
    context: AgentVisualRuntimeCallContext
  ) => AgentVisualLookOutput | Promise<AgentVisualLookOutput>
  capture: (
    input: AgentVisualCaptureInput,
    context: AgentVisualRuntimeCallContext
  ) => AgentVisualCaptureOutput | Promise<AgentVisualCaptureOutput>
  abortTurn?: (identity: AgentRuntimeToolTurnIdentity, reason?: string) => number
}>

const agentOperationRefSchema = z.string().regex(/^op_[A-Za-z0-9_-]{20,}$/u)
const agentSchemaRefSchema = z.string().regex(/^schema_[A-Za-z0-9_-]{20,}$/u)
const agentResourceRefSchema = z.string().regex(/^res_[A-Za-z0-9_-]{20,}$/u)

const agentDiscoverRequestSchema = capabilityDiscoveryQuerySchema.extend({
  operationRef: agentOperationRefSchema.optional(),
  includeSchema: z.boolean().optional(),
  limit: z.number().int().min(1).max(50).default(8)
}).strict()

const agentObserveRequestSchema = z.object({
  resourceRef: agentResourceRefSchema
}).strict()

const agentInvokeRequestSchema = z.object({
  operationRef: agentOperationRefSchema,
  resourceRef: agentResourceRefSchema.optional(),
  input: capabilityJsonValueSchema.default({})
}).strict()
type AgentInvokeRequest = z.infer<typeof agentInvokeRequestSchema>

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
  providerFamily: 'native' | 'managed-mcp'
  acceptedResourceKinds: string[]
  producedResourceKinds: string[]
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
  resourceStatus: 'live' | 'retired'
  resourceKind: string
  operationRef: string
}>

export type CapabilityAgentToolResult =
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.discover; value: AgentOperationDescriptor[] }
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.observe; value: AgentCapabilityObservation }
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.invoke; value: AgentCapabilityInvocation }
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.events; value: AgentCapabilityEvent[] }
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.look; value: AgentVisualLookOutput }
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.capture; value: AgentVisualCaptureOutput }

export type CapabilityAgentBroker = Readonly<{
  discover: (
    caller: CapabilityCallerContext,
    query?: CapabilityDiscoveryQuery,
    options?: { context?: CapabilityAgentToolRequestContext }
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
    options?: { signal?: AbortSignal; context?: CapabilityAgentToolRequestContext }
  ) => CapabilityInvocationResult | Promise<CapabilityInvocationResult>
  listEvents: (
    caller: CapabilityCallerContext,
    query?: CapabilityEventQuery
  ) => CapabilityResourceChangeEvent[] | Promise<CapabilityResourceChangeEvent[]>
  abortTurn?: (identity: AgentRuntimeToolTurnIdentity, reason?: string) => number
}>

export type CapabilityAgentToolSurfaceOptions = Readonly<{
  broker: CapabilityAgentBroker
  visualRuntime?: AgentVisualRuntime
  resolveCaller: (
    context: CapabilityAgentToolRequestContext
  ) => CapabilityCallerContextInput | Promise<CapabilityCallerContextInput>
  requestApproval?: (
    request: CapabilityAgentApprovalRequest,
    options?: { signal?: AbortSignal }
  ) => CapabilityAgentApprovalDecision | Promise<CapabilityAgentApprovalDecision>
  cancelApprovalTurn?: (identity: AgentRuntimeToolTurnIdentity, reason?: string) => number
}>

type CallerCache = {
  operationsByRef: Map<string, CapabilityDescriptor>
  operationRefsById: Map<string, string>
  schemaRefsById: Map<string, string>
  resources: Map<string, CapabilityResourceHandle>
  resourceLabels: Map<string, string>
}

const toolDefinitions = Object.freeze([
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.discover,
    'Discover current SciForge operations with an exact capabilityId or unordered text tokens. Scope, accepted/produced resource kinds, and provider family are independent filters. Native results are bounded by default; set providerFamily=managed-mcp explicitly to search managed tools. Results use opaque references; request one operation with includeSchema=true for its compact input shape.',
    agentDiscoverRequestSchema
  ),
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.observe,
    'Observe a previously returned opaque SciForge resource reference.',
    agentObserveRequestSchema
  ),
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.invoke,
    'Invoke a discovered operation using its opaque operation reference and domain input. Broker revision and idempotency fields are managed internally; supply any operation-specific IDs described by the domain schema.',
    agentInvokeRequestSchema
  ),
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.events,
    'Read authorized SciForge resource-change events using opaque resource and operation references.',
    agentEventsRequestSchema
  ),
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.look,
    'Visually inspect through the routed vision model whenever the user request, a referenced template, or a discovered task requirement needs visual understanding or extraction. Omit sourceRef for the caller-bound current SciForge surface and optionally use a targetRef published by surface.current. For an existing workspace file, open it through the canonical Workspace Preview operation and pass the returned resourceRef; for a multi-frame resource, frame is a generic 1-based index. Artifact and snapshot refs may be reused for proof-linked inspection. This tool never accepts file paths. If a persisted visual is required, declare capture=snapshot or capture=region. A region capture also requires intent=locate; persist the returned regionRef with sciforge_capture instead of the full source, then inspect the persisted artifact.',
    agentVisualLookInputSchema
  ),
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.capture,
    'Persist a snapshot or opaque region returned by sciforge_look as a content-addressed workspace visual artifact under .sciforge/visual-assets. The runtime binds the parent inspection proof automatically.',
    agentVisualCaptureInputSchema
  )
]) satisfies readonly CapabilityAgentToolDefinition[]

export class CapabilityAgentToolSurface {
  readonly #broker: CapabilityAgentBroker
  readonly #visualRuntime: AgentVisualRuntime | undefined
  readonly #resolveCaller: CapabilityAgentToolSurfaceOptions['resolveCaller']
  readonly #requestApproval: CapabilityAgentToolSurfaceOptions['requestApproval']
  readonly #cancelApprovalTurn: CapabilityAgentToolSurfaceOptions['cancelApprovalTurn']
  readonly #callerCaches = new Map<string, CallerCache>()
  readonly #activeCalls = new Map<string, Set<AbortController>>()

  constructor(options: CapabilityAgentToolSurfaceOptions) {
    this.#broker = options.broker
    this.#visualRuntime = options.visualRuntime
    this.#resolveCaller = options.resolveCaller
    this.#requestApproval = options.requestApproval
    this.#cancelApprovalTurn = options.cancelApprovalTurn
  }

  tools(): readonly CapabilityAgentToolDefinition[] {
    return toolDefinitions
  }

  abortTurn(identity: AgentRuntimeToolTurnIdentity, reason = 'user_stop'): number {
    const key = activeTurnKey(identity)
    const active = key ? this.#activeCalls.get(key) : undefined
    let calls = 0
    if (active && key) {
      this.#activeCalls.delete(key)
      for (const controller of active) {
        if (controller.signal.aborted) continue
        controller.abort(reason)
        calls += 1
      }
    }
    const approvals = this.#cancelApprovalTurn?.(identity, reason) ?? 0
    const invocations = this.#broker.abortTurn?.(identity, reason) ?? 0
    const visualCalls = this.#visualRuntime?.abortTurn?.(identity, reason) ?? 0
    return calls + approvals + invocations + visualCalls
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
          ...(parsed.capabilityId ? { capabilityId: parsed.capabilityId } : {}),
          ...(parsed.text ? { text: parsed.text } : {}),
          ...(parsed.scope ? { scope: parsed.scope } : {}),
          ...(parsed.acceptedResourceKind ? { acceptedResourceKind: parsed.acceptedResourceKind } : {}),
          ...(parsed.producedResourceKind ? { producedResourceKind: parsed.producedResourceKind } : {}),
          ...(parsed.providerFamily ? { providerFamily: parsed.providerFamily } : {}),
          ...(parsed.effects ? { effects: parsed.effects } : {}),
          ...(parsed.tags ? { tags: parsed.tags } : {}),
          limit: parsed.limit
        }, { context: request.context })
        if (descriptors.length === 0) {
          const diagnostic = emptyDiscoveryDiagnostic(parsed)
          throw new CapabilityAgentToolError(
            'capability_discovery_empty',
            `No capability matched the discovery request. ${JSON.stringify(diagnostic)}`,
            { details: diagnostic }
          )
        }
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
        return this.#invokeOperation(caller, cache, parsed, request.context, options.signal)
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
            resourceStatus: event.resourceStatus,
            resourceKind: event.resourceKind,
            operationRef: this.#operationRef(cache, this.#descriptorForId(descriptors, event.actionId))
          }))
        }
      }
      case CAPABILITY_AGENT_TOOL_NAMES.look: {
        const resourceIdentity = nativeVisualResourceIdentity(rawArguments)
        let parsed: AgentVisualLookInput
        try {
          parsed = agentVisualLookInputSchema.parse(rawArguments)
        } catch (error) {
          throw normalizeNativeVisualToolError(error, {
            operation: 'look',
            phase: 'arguments',
            resourceIdentity
          })
        }
        return this.#runVisualCall(
          request.context,
          options.signal,
          { operation: 'look', resourceIdentity },
          async (visualRuntime, signal) => ({
            tool: CAPABILITY_AGENT_TOOL_NAMES.look,
            value: parseVisualResult(
              agentVisualLookOutputSchema,
              await visualRuntime.look(parsed, { caller, request: request.context, signal })
            )
          })
        )
      }
      case CAPABILITY_AGENT_TOOL_NAMES.capture: {
        const resourceIdentity = nativeVisualResourceIdentity(rawArguments)
        let parsed: AgentVisualCaptureInput
        try {
          parsed = agentVisualCaptureInputSchema.parse(rawArguments)
        } catch (error) {
          throw normalizeNativeVisualToolError(error, {
            operation: 'capture',
            phase: 'arguments',
            resourceIdentity
          })
        }
        return this.#runVisualCall(
          request.context,
          options.signal,
          { operation: 'capture', resourceIdentity },
          async (visualRuntime, signal) => ({
            tool: CAPABILITY_AGENT_TOOL_NAMES.capture,
            value: parseVisualResult(
              agentVisualCaptureOutputSchema,
              await visualRuntime.capture(parsed, { caller, request: request.context, signal })
            )
          })
        )
      }
      default:
        throw new CapabilityAgentToolError('unknown_agent_tool', `Unknown capability agent tool: ${request.name}`)
    }
  }

  async #runVisualCall<Result extends CapabilityAgentToolResult>(
    context: CapabilityAgentToolRequestContext,
    sourceSignal: AbortSignal | undefined,
    errorContext: NativeVisualToolErrorContext,
    call: (visualRuntime: AgentVisualRuntime, signal: AbortSignal) => Promise<Result>
  ): Promise<Result> {
    const visualRuntime = this.#visualRuntime
    if (!visualRuntime) {
      throw normalizeNativeVisualToolError(
        new CapabilityAgentToolError(
          'visual_runtime_unavailable',
          'The native SciForge visual runtime is unavailable.'
        ),
        errorContext
      )
    }
    const active = this.#beginActiveCall(context, sourceSignal)
    try {
      return await call(visualRuntime, active.signal)
    } catch (error) {
      const code = error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : ''
      throw normalizeNativeVisualToolError(error, {
        ...errorContext,
        phase: code === 'invalid_visual_result' ? 'result' : 'runtime'
      })
    } finally {
      active.close()
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
        resources: new Map(),
        resourceLabels: new Map()
      }
      this.#callerCaches.set(key, cache)
    }
    return cache
  }

  async #invokeOperation(
    caller: CapabilityCallerContext,
    cache: CallerCache,
    parsed: AgentInvokeRequest,
    context: CapabilityAgentToolRequestContext,
    signal?: AbortSignal
  ): Promise<CapabilityAgentToolResult> {
    const active = this.#beginActiveCall(context, signal)
    try {
      const descriptor = this.#operation(cache, parsed.operationRef)
      let handle = parsed.resourceRef ? this.#resource(cache, parsed.resourceRef) : undefined
      const invocationId = descriptor.effect === 'read' ? undefined : opaqueId('agent_inv')
      const invokeCaller = await this.#callerForInvocation(
        caller,
        descriptor,
        invocationId,
        context,
        { signal: active.signal },
        parsed.input,
        parsed.resourceRef,
        parsed.resourceRef ? cache.resourceLabels.get(parsed.resourceRef) : undefined
      )
      const invoke = (resource: CapabilityResourceHandle | undefined) => this.#broker.invoke(invokeCaller, {
        actionId: descriptor.id,
        ...(resource ? { resource } : {}),
        ...(descriptor.concurrency.revision === 'optimistic' && resource
          ? { expectedRevision: resource.semanticRevision }
          : {}),
        ...(invocationId ? { invocationId } : {}),
        input: parsed.input
      }, { signal: active.signal, context })
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
    } finally {
      active.close()
    }
  }

  #beginActiveCall(
    context: CapabilityAgentToolRequestContext,
    sourceSignal?: AbortSignal
  ): { signal: AbortSignal; close: () => void } {
    const controller = new AbortController()
    const onSourceAbort = (): void => controller.abort(sourceSignal?.reason)
    if (sourceSignal?.aborted) controller.abort(sourceSignal.reason)
    else sourceSignal?.addEventListener('abort', onSourceAbort, { once: true })

    const key = activeTurnKey(context)
    if (key) {
      let active = this.#activeCalls.get(key)
      if (!active) {
        active = new Set()
        this.#activeCalls.set(key, active)
      }
      active.add(controller)
    }
    return {
      signal: controller.signal,
      close: () => {
        sourceSignal?.removeEventListener('abort', onSourceAbort)
        if (!key) return
        const active = this.#activeCalls.get(key)
        active?.delete(controller)
        if (active?.size === 0) this.#activeCalls.delete(key)
      }
    }
  }

  async #callerForInvocation(
    caller: CapabilityCallerContext,
    descriptor: CapabilityDescriptor,
    invocationId: string | undefined,
    context: CapabilityAgentToolRequestContext,
    options: { signal?: AbortSignal },
    input: CapabilityJsonValue,
    resourceRef?: string,
    resourceLabel?: string
  ): Promise<CapabilityCallerContext> {
    if (descriptor.approval === 'none') return caller
    if (descriptor.approval !== 'confirmation' || !invocationId || !this.#requestApproval) {
      throw new CapabilityAgentToolError(
        'approval_denied',
        `Capability ${descriptor.title} requires an unavailable human confirmation.`
      )
    }
    const decision = await this.#requestApproval({
      context,
      actionId: descriptor.id,
      invocationId,
      mode: descriptor.approval,
      title: descriptor.title,
      description: descriptor.description,
      effect: descriptor.effect,
      input,
      ...(resourceRef ? { resourceRef } : {}),
      ...(resourceLabel ? { resourceLabel } : {})
    }, options)
    if (decision !== 'allowed') {
      throw new CapabilityAgentToolError(
        decision === 'cancelled' ? 'approval_cancelled' : 'approval_denied',
        decision === 'cancelled'
          ? `Confirmation for ${descriptor.title} was cancelled before execution.`
          : `Confirmation for ${descriptor.title} was denied.`
      )
    }
    return capabilityCallerContextSchema.parse({
      ...caller,
      approvals: [{
        actionId: descriptor.id,
        invocationId,
        mode: descriptor.approval
      }]
    })
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
      providerFamily: descriptor.tags.includes('managed-mcp') ? 'managed-mcp' : 'native',
      acceptedResourceKinds: [...descriptor.resourceKinds],
      producedResourceKinds: [...(descriptor.producedResourceKinds ?? [])],
      tags: [...descriptor.tags],
      ...(includeSchema ? { inputShape: compactInputShape(descriptor.inputSchema) } : {})
    }
  }

  #operationRef(cache: CallerCache, descriptor: CapabilityDescriptor): string {
    const existing = cache.operationRefsById.get(descriptor.id)
    if (existing) {
      cache.operationsByRef.set(existing, descriptor)
      return existing
    }
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
      if (code === 'resource_ref_retired') {
        throw new CapabilityAgentToolError(
          'resource_ref_retired',
          'The historical resource reference has been retired and cannot be renewed or invoked.'
        )
      }
      if (code === 'resource_unavailable' || error instanceof z.ZodError) {
        throw new CapabilityAgentToolError('unknown_resource_ref', 'The resource reference is unknown or expired.')
      }
      throw error
    }
  }

  #rememberObservation(cache: CallerCache, observation: CapabilityObservation): void {
    cache.resources.set(observation.resourceRef, observation.resource)
    const label = capabilityResourceDisplayLabel(observation.state)
    if (label) cache.resourceLabels.set(observation.resourceRef, label)
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
    | 'resource_ref_retired'
    | 'capability_discovery_empty'
    | 'stale_resource_ref'
    | 'approval_denied'
    | 'approval_cancelled'
    | 'visual_runtime_unavailable'
    | 'invalid_visual_result'
  readonly details?: CapabilityJsonValue

  constructor(
    code: CapabilityAgentToolError['code'],
    message: string,
    options: { details?: CapabilityJsonValue } = {}
  ) {
    super(message)
    this.name = 'CapabilityAgentToolError'
    this.code = code
    this.details = options.details
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
    ? `${context.runtimeId}:${context.threadId}`
    : `${context.runtimeId}-request:${context.requestId}`
}

function emptyDiscoveryDiagnostic(
  request: z.infer<typeof agentDiscoverRequestSchema>
): CapabilityJsonValue {
  const appliedFilters: Record<string, CapabilityJsonValue> = {
    ...(request.capabilityId ? { capabilityId: request.capabilityId } : {}),
    ...(request.text ? { text: request.text } : {}),
    ...(request.scope ? { scope: request.scope } : {}),
    ...(request.acceptedResourceKind ? { acceptedResourceKind: request.acceptedResourceKind } : {}),
    ...(request.producedResourceKind ? { producedResourceKind: request.producedResourceKind } : {}),
    ...(request.providerFamily ? { providerFamily: request.providerFamily } : {}),
    ...(request.effects ? { effects: request.effects } : {}),
    ...(request.tags ? { tags: request.tags } : {}),
    limit: request.limit
  }
  const suggestions: CapabilityJsonValue[] = []
  if (request.capabilityId) {
    suggestions.push({
      text: request.capabilityId.replace(/[._-]+/gu, ' '),
      ...(request.providerFamily ? { providerFamily: request.providerFamily } : {}),
      limit: request.limit
    })
  }
  const textTokens = request.text?.match(/[\p{L}\p{N}]+/gu) ?? []
  if (textTokens.length > 1) {
    suggestions.push({
      text: textTokens.slice(0, -1).join(' '),
      ...(request.providerFamily ? { providerFamily: request.providerFamily } : {}),
      limit: request.limit
    })
  }
  for (const filter of [
    'scope',
    'acceptedResourceKind',
    'producedResourceKind',
    'effects',
    'tags'
  ] as const) {
    if (!(filter in appliedFilters)) continue
    const relaxed = { ...appliedFilters }
    delete relaxed[filter]
    suggestions.push(relaxed)
  }
  if (request.text && request.providerFamily !== 'managed-mcp') {
    suggestions.push({
      text: request.text,
      providerFamily: 'managed-mcp',
      limit: request.limit
    })
  }
  if (suggestions.length === 0) suggestions.push({ scope: 'workspace', limit: request.limit })

  return {
    outcome: 'empty',
    registryReadiness: {
      status: 'ready',
      contractVersion: CAPABILITY_BROKER_CONTRACT_VERSION
    },
    appliedFilters,
    suggestedQueries: suggestions.slice(0, 6)
  }
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

function parseVisualResult<Output>(
  schema: z.ZodType<Output>,
  value: unknown
): Output {
  const parsed = schema.safeParse(value)
  if (parsed.success) return parsed.data
  throw new CapabilityAgentToolError(
    'invalid_visual_result',
    `The native visual runtime returned an invalid typed result: ${parsed.error.issues[0]?.message ?? 'schema validation failed'}.`
  )
}

const COMPACT_SCHEMA_MAX_DEPTH = 6
const COMPACT_SCHEMA_MAX_PROPERTIES = 64
const COMPACT_SCHEMA_MAX_VARIANTS = 16

function compactInputShape(value: CapabilityJsonValue): CapabilityJsonValue {
  return compactSchemaNode(value, 0, true)
}

function compactSchemaNode(
  value: CapabilityJsonValue,
  depth: number,
  root = false
): CapabilityJsonValue {
  if (!isRecord(value)) return {}
  const variants = schemaVariants(value)
  const type = typeof value.type === 'string'
    ? value.type
    : variants.length > 0
      ? 'union'
      : inferSchemaType(value)
  const output: Record<string, CapabilityJsonValue> = { type: root && type === 'unknown' ? 'object' : type }

  if (typeof value.description === 'string') output.description = value.description.slice(0, 500)
  if (typeof value.pattern === 'string') output.pattern = value.pattern.slice(0, 500)
  if (typeof value.format === 'string') output.format = value.format.slice(0, 100)
  if (typeof value.minimum === 'number' && Number.isFinite(value.minimum)) output.minimum = value.minimum
  if (typeof value.maximum === 'number' && Number.isFinite(value.maximum)) output.maximum = value.maximum
  if (typeof value.minLength === 'number' && Number.isSafeInteger(value.minLength)) output.minLength = value.minLength
  if (typeof value.maxLength === 'number' && Number.isSafeInteger(value.maxLength)) output.maxLength = value.maxLength
  if (typeof value.minItems === 'number' && Number.isSafeInteger(value.minItems)) output.minItems = value.minItems
  if (typeof value.maxItems === 'number' && Number.isSafeInteger(value.maxItems)) output.maxItems = value.maxItems
  if (isPrimitiveJsonValue(value.const)) output.const = value.const
  if (Array.isArray(value.enum)) {
    output.enum = value.enum.filter(isPrimitiveJsonValue).slice(0, 32)
  }

  if (depth >= COMPACT_SCHEMA_MAX_DEPTH) return output
  if (variants.length > 0) {
    output.variants = variants
      .slice(0, COMPACT_SCHEMA_MAX_VARIANTS)
      .map((variant) => compactSchemaNode(variant as CapabilityJsonValue, depth + 1))
  }
  if (isRecord(value.properties)) {
    const required = new Set(Array.isArray(value.required)
      ? value.required.filter((entry): entry is string => typeof entry === 'string')
      : [])
    const properties: { [key: string]: CapabilityJsonValue } = {}
    for (const [name, property] of Object.entries(value.properties).slice(0, COMPACT_SCHEMA_MAX_PROPERTIES)) {
      const compact = compactSchemaNode(
        isCapabilityJsonValue(property) ? property : {},
        depth + 1
      )
      properties[name] = isRecord(compact)
        ? { ...(compact as { [key: string]: CapabilityJsonValue }), required: required.has(name) }
        : { type: 'unknown', required: required.has(name) }
    }
    output.properties = properties
  }
  if (isCapabilityJsonValue(value.items)) {
    output.items = compactSchemaNode(value.items, depth + 1)
  }
  return output
}

function schemaVariants(value: Record<string, unknown>): unknown[] {
  if (Array.isArray(value.oneOf)) return value.oneOf
  if (Array.isArray(value.anyOf)) return value.anyOf
  return []
}

function inferSchemaType(value: Record<string, unknown>): string {
  if (value.properties && typeof value.properties === 'object') return 'object'
  if (value.items) return 'array'
  return 'unknown'
}

function isPrimitiveJsonValue(value: unknown): value is null | boolean | number | string {
  return value === null ||
    typeof value === 'boolean' ||
    typeof value === 'string' ||
    (typeof value === 'number' && Number.isFinite(value))
}

function isCapabilityJsonValue(value: unknown): value is CapabilityJsonValue {
  return capabilityJsonValueSchema.safeParse(value).success
}

function opaqueId(prefix: string): string {
  return `${prefix}_${randomBytes(18).toString('base64url')}`
}

function activeTurnKey(
  identity: Pick<CapabilityAgentToolRequestContext, 'runtimeId' | 'threadId' | 'turnId'>
): string | undefined {
  const runtimeId = identity.runtimeId.trim()
  const threadId = identity.threadId?.trim()
  const turnId = identity.turnId?.trim()
  return runtimeId && threadId && turnId ? `${runtimeId}\u0000${threadId}\u0000${turnId}` : undefined
}

function capabilityResourceDisplayLabel(value: CapabilityJsonValue): string | undefined {
  const queue: Array<{ value: CapabilityJsonValue; depth: number }> = [{ value, depth: 0 }]
  const preferredKeys = ['displayName', 'title', 'name', 'label']
  while (queue.length > 0) {
    const current = queue.shift()
    if (!current || current.depth > 3 || !isRecord(current.value)) continue
    for (const key of preferredKeys) {
      const candidate = current.value[key]
      if (typeof candidate === 'string' && candidate.trim()) return candidate.trim().slice(0, 256)
    }
    for (const nested of Object.values(current.value)) {
      if (Array.isArray(nested)) {
        for (const entry of nested.slice(0, 16)) queue.push({ value: entry, depth: current.depth + 1 })
      } else if (isRecord(nested)) {
        queue.push({ value: nested, depth: current.depth + 1 })
      }
    }
  }
  return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}
