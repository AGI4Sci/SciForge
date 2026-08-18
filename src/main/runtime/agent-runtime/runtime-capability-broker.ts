import { createHash, randomUUID } from 'node:crypto'
import {
  CAPABILITY_BROKER_CONTRACT_VERSION,
  capabilityDescriptorSchema,
  type CapabilityCallerContext,
  type CapabilityDescriptor,
  type CapabilityDiscoveryQuery,
  type CapabilityInvocationRequest,
  type CapabilityInvocationResult,
  type CapabilityJsonValue
} from '../../../shared/capability-broker'
import type { AgentRuntimeToolTurnIdentity } from './agent-tool-surface'
import {
  AgentRuntimeToolError as RuntimeToolError
} from './agent-tool-surface'
import type {
  CapabilityAgentBroker,
  CapabilityAgentToolRequestContext
} from '../../capabilities/agent-tools'
import { discoverCapabilityDescriptors } from '../../capabilities/registry'
import {
  type RuntimeMcpToolGateway
} from './runtime-mcp-tool-gateway'
import type { RuntimeToolDefinition } from './runtime-tool-contract'

export type RuntimeCapabilityBrokerOptions = {
  broker: CapabilityAgentBroker
  managedTools: RuntimeMcpToolGateway
  maxManagedInvocations?: number
  assertPrincipalLease?: (
    context: CapabilityAgentToolRequestContext
  ) => void | Promise<void>
  isToolAvailable?: (
    context: CapabilityAgentToolRequestContext,
    tool: RuntimeToolDefinition
  ) => boolean | Promise<boolean>
}

type ManagedOperation = {
  tool: RuntimeToolDefinition
  descriptor: CapabilityDescriptor
}

type ManagedInvocation = {
  fingerprint: string
  promise: Promise<CapabilityInvocationResult>
  settled: boolean
}

/**
 * One capability surface for every agent runtime.
 *
 * Managed MCP tools stay behind discover/invoke and never become provider tool
 * definitions. Runtime adapters therefore expose the same four stable
 * SciForge tools regardless of their native protocol.
 */
export class RuntimeCapabilityBroker implements CapabilityAgentBroker {
  readonly #broker: CapabilityAgentBroker
  readonly #managedTools: RuntimeMcpToolGateway
  readonly #assertPrincipalLease: NonNullable<
    RuntimeCapabilityBrokerOptions['assertPrincipalLease']
  >
  readonly #isToolAvailable: NonNullable<RuntimeCapabilityBrokerOptions['isToolAvailable']>
  readonly #operationsByActionId = new Map<string, ManagedOperation>()
  readonly #invocations = new Map<string, ManagedInvocation>()
  readonly #maxManagedInvocations: number

  constructor(options: RuntimeCapabilityBrokerOptions) {
    this.#broker = options.broker
    this.#managedTools = options.managedTools
    this.#assertPrincipalLease = options.assertPrincipalLease ?? (() => undefined)
    this.#isToolAvailable = options.isToolAvailable ?? (() => true)
    this.#maxManagedInvocations = Math.max(1, options.maxManagedInvocations ?? 2_000)
  }

  async discover(
    caller: CapabilityCallerContext,
    query?: CapabilityDiscoveryQuery,
    options: { context?: CapabilityAgentToolRequestContext } = {}
  ): Promise<CapabilityDescriptor[]> {
    if (query?.providerFamily === 'managed-mcp') {
      if (!options.context) return []
      await this.#assertPrincipalLease(options.context)
      return this.#managedDescriptors(caller, query, options.context)
    }
    return this.#broker.discover(caller, query)
  }

  observe: CapabilityAgentBroker['observe'] = (caller, request) => this.#broker.observe(caller, request)
  bindResourceRef: CapabilityAgentBroker['bindResourceRef'] = (caller, resourceRef) => (
    this.#broker.bindResourceRef(caller, resourceRef)
  )
  listEvents: CapabilityAgentBroker['listEvents'] = (caller, query) => this.#broker.listEvents(caller, query)

  async invoke(
    caller: CapabilityCallerContext,
    request: CapabilityInvocationRequest,
    options: { signal?: AbortSignal; context?: CapabilityAgentToolRequestContext } = {}
  ): Promise<CapabilityInvocationResult> {
    const operation = this.#operationsByActionId.get(request.actionId)
    if (!operation) return this.#broker.invoke(caller, request, { signal: options.signal })
    const context = options.context
    if (!context) throw new RuntimeToolError('Managed tool invocation requires runtime context.', {
      code: 'missing_runtime_context',
      failureClass: 'invalid_arguments',
      retryable: false
    })
    await this.#assertPrincipalLease(context)
    if (!caller.workspaceId) throw new RuntimeToolError('Managed tools require a workspace.', {
      code: 'workspace_required',
      failureClass: 'invalid_arguments',
      retryable: false
    })
    assertManagedToolWithinBrokerScope(context, operation.tool)
    if (!await this.#isToolAvailable(context, operation.tool)) {
      throw new RuntimeToolError('The managed operation is unavailable for this runtime.', {
        code: 'operation_unavailable',
        failureClass: 'permission_denied',
        retryable: false
      })
    }
    authorizeManagedApproval(caller, operation.descriptor, request)
    await this.#assertPrincipalLease(context)
    const invocationKey = managedInvocationKey(caller, request, operation.descriptor)
    const fingerprint = managedInvocationFingerprint(request)
    const existing = invocationKey ? this.#invocations.get(invocationKey) : undefined
    if (existing) {
      if (existing.fingerprint !== fingerprint) {
        throw new RuntimeToolError('The invocation ID was already used with different input.', {
          code: 'idempotency_conflict',
          failureClass: 'conflict',
          retryable: false
        })
      }
      return { ...await existing.promise, replayed: true }
    }

    if (invocationKey) {
      this.#reserveInvocationCapacity()
    }
    const execution = this.#invokeManaged(operation, caller, request, context, options.signal)
    if (invocationKey) {
      const entry: ManagedInvocation = { fingerprint, promise: execution, settled: false }
      this.#invocations.set(invocationKey, entry)
      const markSettled = (): void => { entry.settled = true }
      void execution.then(markSettled, markSettled)
    }
    return execution
  }

  abortTurn(identity: AgentRuntimeToolTurnIdentity, reason = 'user_stop'): number {
    return this.#managedTools.abortRequestsForTurn(identity, reason)
  }

  #reserveInvocationCapacity(): void {
    if (this.#invocations.size < this.#maxManagedInvocations) return
    for (const [key, invocation] of this.#invocations) {
      if (!invocation.settled) continue
      this.#invocations.delete(key)
      if (this.#invocations.size < this.#maxManagedInvocations) return
    }
    throw new RuntimeToolError('The managed invocation journal is full of pending writes.', {
      code: 'idempotency_capacity_exceeded',
      failureClass: 'resource_exhausted',
      retryable: true
    })
  }

  async #invokeManaged(
    operation: ManagedOperation,
    caller: CapabilityCallerContext,
    request: CapabilityInvocationRequest,
    context: CapabilityAgentToolRequestContext,
    signal?: AbortSignal
  ): Promise<CapabilityInvocationResult> {
    const tool = operation.tool
    const input = managedToolInput(request.input, tool.inputSchema, caller.workspaceId)
    const runtimeRequestId = String(context.requestId ?? request.invocationId ?? randomUUID())
    const response = await this.#managedTools.callTool({
      requestId: runtimeRequestId,
      runtimeId: context.runtimeId,
      threadId: context.threadId ?? runtimeThreadId(caller.callerId),
      ...(context.turnId ? { turnId: context.turnId } : {}),
      ...(context.callId ? { callId: context.callId } : {}),
      namespace: tool.namespace,
      tool: tool.name,
      arguments: input,
      trustedInvocation: {
        requestId: runtimeRequestId,
        runtimeId: context.runtimeId,
        threadId: context.threadId ?? runtimeThreadId(caller.callerId),
        ...(context.turnId ? { turnId: context.turnId } : {}),
        ...(context.callId ? { callId: context.callId } : {}),
        actionId: request.actionId,
        ...(request.invocationId ? { invocationId: request.invocationId } : {}),
        approval: operation.descriptor.approval
      }
    }, { signal })
    if (!response.success) {
      const detail = response.contentItems
        .filter((item) => item.type === 'inputText')
        .map((item) => item.text)
        .filter(Boolean)
        .join('\n')
      throw new RuntimeToolError(detail || `Managed tool ${tool.name} failed.`, {
        code: response.errorCode || 'managed_tool_failed',
        ...(response.failureClass ? { failureClass: response.failureClass } : {}),
        ...(response.retryable !== undefined ? { retryable: response.retryable } : {}),
        ...(response.resourceIdentity ? { resourceIdentity: response.resourceIdentity } : {}),
        ...(response.evidenceDelta !== undefined ? { evidenceDelta: response.evidenceDelta } : {}),
        ...(response.stateChanged !== undefined ? { stateChanged: response.stateChanged } : {})
      })
    }
    return {
      actionId: request.actionId,
      ...(request.invocationId ? { invocationId: request.invocationId } : {}),
      output: capabilityOutput(response.structuredContent, response.contentItems),
      changed: response.stateChanged ?? false,
      replayed: false,
      completedAt: new Date().toISOString()
    }
  }

  async #managedDescriptors(
    caller: CapabilityCallerContext,
    query: CapabilityDiscoveryQuery | undefined,
    context: CapabilityAgentToolRequestContext | undefined
  ): Promise<CapabilityDescriptor[]> {
    if (query?.providerFamily !== 'managed-mcp' || !context || !caller.workspaceId) return []
    await this.#assertPrincipalLease(context)
    const tools = await this.#managedTools.tools(query.capabilityId ? undefined : query.text)
    await this.#assertPrincipalLease(context)
    const available = [] as RuntimeToolDefinition[]
    for (const tool of tools) {
      if (managedToolWithinBrokerScope(context, tool) &&
          await this.#isToolAvailable(context, tool)) available.push(tool)
      await this.#assertPrincipalLease(context)
    }
    const descriptors = available.map((tool) => {
      const descriptor = descriptorForManagedTool(tool)
      this.#operationsByActionId.set(descriptor.id, { tool, descriptor })
      return descriptor
    })
    return discoverCapabilityDescriptors(descriptors, caller, query, 'managed-mcp')
  }
}

export function createRuntimeCapabilityBroker(
  options: RuntimeCapabilityBrokerOptions
): RuntimeCapabilityBroker {
  return new RuntimeCapabilityBroker(options)
}

function descriptorForManagedTool(tool: RuntimeToolDefinition): CapabilityDescriptor {
  const effect = tool.annotations?.readOnlyHint === true
    ? 'read'
    : tool.annotations?.destructiveHint !== false
      ? 'destructive'
      : tool.annotations?.openWorldHint !== false
        ? 'external-write'
        : 'workspace-write'
  return capabilityDescriptorSchema.parse({
    contractVersion: CAPABILITY_BROKER_CONTRACT_VERSION,
    id: managedToolActionId(tool),
    version: '1',
    title: (tool.annotations?.title || tool.name).slice(0, 160),
    description: tool.description.slice(0, 2_000),
    audiences: ['agent'],
    scope: 'workspace',
    resourceKinds: [],
    effect,
    approval: effect === 'external-write' || effect === 'destructive' ? 'confirmation' : 'none',
    concurrency: {
      revision: 'none',
      idempotency: effect === 'read' ? 'none' : 'required'
    },
    inputSchema: jsonValue(tool.inputSchema),
    outputSchema: {},
    tags: [
      'managed-mcp',
      ...(tool.providerPackageId ? [`package-${slug(tool.providerPackageId).slice(0, 55)}`] : []),
      `tool-${slug(tool.name).slice(0, 55)}`
    ]
  })
}

function managedToolActionId(tool: RuntimeToolDefinition): string {
  const identity = `${tool.providerId ?? tool.namespace ?? 'managed'}\u0000${tool.providerToolName ?? tool.name}`
  const base = slug(tool.providerToolName ?? tool.name).slice(0, 120)
  const digest = createHash('sha256').update(identity).digest('hex').slice(0, 12)
  return `managed-mcp.${base}.${digest}`
}

function managedToolWithinBrokerScope(
  context: CapabilityAgentToolRequestContext,
  tool: RuntimeToolDefinition
): boolean {
  const scope = context.brokerScope
  if (!scope) return true
  if (scope.providerFamily !== 'managed-mcp') return false
  return !scope.packageId || tool.providerPackageId === scope.packageId
}

function assertManagedToolWithinBrokerScope(
  context: CapabilityAgentToolRequestContext,
  tool: RuntimeToolDefinition
): void {
  if (managedToolWithinBrokerScope(context, tool)) return
  throw new RuntimeToolError('The managed operation is outside the delegated broker scope.', {
    code: 'broker_scope_denied',
    failureClass: 'permission_denied',
    retryable: false
  })
}

function authorizeManagedApproval(
  caller: CapabilityCallerContext,
  descriptor: CapabilityDescriptor,
  request: CapabilityInvocationRequest
): void {
  if (descriptor.approval === 'none') return
  const approved = caller.approvals.some((grant) => (
    grant.actionId === descriptor.id
    && grant.mode === descriptor.approval
    && (!grant.invocationId || grant.invocationId === request.invocationId)
  ))
  if (!approved) {
    throw new RuntimeToolError(`Managed operation ${descriptor.id} requires confirmation.`, {
      code: 'approval_denied',
      failureClass: 'permission_denied',
      retryable: false
    })
  }
}

function managedInvocationKey(
  caller: CapabilityCallerContext,
  request: CapabilityInvocationRequest,
  descriptor: CapabilityDescriptor
): string | undefined {
  if (descriptor.effect === 'read') return undefined
  if (!request.invocationId) {
    throw new RuntimeToolError(`Managed operation ${descriptor.id} requires an invocation ID.`, {
      code: 'invocation_id_required',
      failureClass: 'invalid_arguments',
      retryable: false
    })
  }
  return `${caller.callerId}\u0000${caller.workspaceId ?? ''}\u0000${descriptor.id}\u0000${request.invocationId}`
}

function managedInvocationFingerprint(request: CapabilityInvocationRequest): string {
  return createHash('sha256').update(JSON.stringify({
    actionId: request.actionId,
    input: request.input,
    resource: request.resource ?? null,
    expectedRevision: request.expectedRevision ?? null
  })).digest('hex')
}

function slug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'tool'
}

function managedToolInput(
  input: CapabilityJsonValue,
  schema: unknown,
  workspaceId: string | undefined
): Record<string, unknown> {
  const record = isRecord(input) ? { ...input } : {}
  const properties = isRecord(schema) && isRecord(schema.properties) ? schema.properties : undefined
  if (workspaceId && properties && Object.prototype.hasOwnProperty.call(properties, 'workspaceRoot')) {
    record.workspaceRoot = workspaceId
  }
  return record
}

function runtimeThreadId(callerId: string): string {
  const separator = callerId.indexOf(':')
  return separator >= 0 ? callerId.slice(separator + 1) : callerId
}

function capabilityOutput(
  structuredContent: unknown,
  contentItems: unknown
): CapabilityJsonValue {
  if (structuredContent !== undefined) return jsonValue(structuredContent)
  return { content: jsonValue(contentItems) }
}

function jsonValue(value: unknown): CapabilityJsonValue {
  const text = JSON.stringify(value ?? null)
  return JSON.parse(text) as CapabilityJsonValue
}

function isRecord(value: unknown): value is Record<string, CapabilityJsonValue> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
