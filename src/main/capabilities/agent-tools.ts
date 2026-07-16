import { z } from 'zod'
import {
  capabilityCallerContextSchema,
  capabilityDiscoveryQuerySchema,
  capabilityEventQuerySchema,
  capabilityInvocationRequestSchema,
  capabilityObserveRequestSchema,
  type CapabilityCallerContext,
  type CapabilityCallerContextInput,
  type CapabilityDescriptor,
  type CapabilityDiscoveryQuery,
  type CapabilityEventQuery,
  type CapabilityInvocationRequest,
  type CapabilityInvocationResult,
  type CapabilityObservation,
  type CapabilityObserveRequest,
  type CapabilityResourceChangeEvent
} from '../../shared/capability-broker'

export const CAPABILITY_AGENT_TOOL_NAMES = Object.freeze({
  discover: 'sciforge_capability_discover',
  observe: 'sciforge_resource_observe',
  invoke: 'sciforge_capability_invoke',
  events: 'sciforge_capability_events'
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

export type CapabilityAgentToolResult =
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.discover; value: CapabilityDescriptor[] }
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.observe; value: CapabilityObservation }
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.invoke; value: CapabilityInvocationResult }
  | { tool: typeof CAPABILITY_AGENT_TOOL_NAMES.events; value: CapabilityResourceChangeEvent[] }

export type CapabilityAgentBroker = Readonly<{
  discover: (
    caller: CapabilityCallerContext,
    query?: CapabilityDiscoveryQuery
  ) => CapabilityDescriptor[] | Promise<CapabilityDescriptor[]>
  observe: (
    caller: CapabilityCallerContext,
    request: CapabilityObserveRequest
  ) => CapabilityObservation | Promise<CapabilityObservation>
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

const toolDefinitions = Object.freeze([
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.discover,
    'Discover the currently registered SciForge capabilities available to this agent.',
    capabilityDiscoveryQuerySchema
  ),
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.observe,
    'Observe a scoped SciForge resource and receive its current state and executable operations.',
    capabilityObserveRequestSchema
  ),
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.invoke,
    'Invoke a registered SciForge capability through the authoritative capability broker.',
    capabilityInvocationRequestSchema
  ),
  defineTool(
    CAPABILITY_AGENT_TOOL_NAMES.events,
    'Read authorized SciForge resource-change events after a prior event cursor.',
    capabilityEventQuerySchema
  )
]) satisfies readonly CapabilityAgentToolDefinition[]

export class CapabilityAgentToolSurface {
  readonly #broker: CapabilityAgentBroker
  readonly #resolveCaller: CapabilityAgentToolSurfaceOptions['resolveCaller']

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

    const rawArguments = request.arguments === undefined ? {} : request.arguments
    switch (request.name) {
      case CAPABILITY_AGENT_TOOL_NAMES.discover:
        return {
          tool: CAPABILITY_AGENT_TOOL_NAMES.discover,
          value: await this.#broker.discover(caller, capabilityDiscoveryQuerySchema.parse(rawArguments))
        }
      case CAPABILITY_AGENT_TOOL_NAMES.observe:
        return {
          tool: CAPABILITY_AGENT_TOOL_NAMES.observe,
          value: await this.#broker.observe(caller, capabilityObserveRequestSchema.parse(rawArguments))
        }
      case CAPABILITY_AGENT_TOOL_NAMES.invoke:
        return {
          tool: CAPABILITY_AGENT_TOOL_NAMES.invoke,
          value: await this.#broker.invoke(caller, capabilityInvocationRequestSchema.parse(rawArguments), options)
        }
      case CAPABILITY_AGENT_TOOL_NAMES.events:
        return {
          tool: CAPABILITY_AGENT_TOOL_NAMES.events,
          value: await this.#broker.listEvents(caller, capabilityEventQuerySchema.parse(rawArguments))
        }
      default:
        throw new CapabilityAgentToolError('unknown_agent_tool', `Unknown capability agent tool: ${request.name}`)
    }
  }
}

export class CapabilityAgentToolError extends Error {
  readonly code: 'invalid_caller_audience' | 'unknown_agent_tool'

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

function defineTool(
  name: CapabilityAgentToolName,
  description: string,
  schema: z.ZodType
): CapabilityAgentToolDefinition {
  const inputSchema = z.toJSONSchema(schema, { target: 'draft-07', unrepresentable: 'throw' })
  if (!isRecord(inputSchema)) throw new Error(`Agent tool ${name} must use an object input schema.`)
  return Object.freeze({ type: 'function', name, description, inputSchema: deepFreeze(inputSchema) })
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function deepFreeze<T>(value: T): T {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}
