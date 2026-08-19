import { join } from 'node:path'
import type { AgentRuntimeChild, AgentRuntimeId } from '../../../shared/agent-runtime-contract'
import {
  EMPTY_MULTI_AGENT_USAGE,
  FileMultiAgentStore,
  InMemoryMultiAgentStore,
  MultiAgentRuntime,
  type MultiAgentChildEvent,
  type MultiAgentChildRunRecord,
  type MultiAgentExecutorInput,
  type MultiAgentExecutorResult,
  type MultiAgentStore,
  type MultiAgentUsage
} from '../../../../packages/workers/multi-agent/src'
import type {
  AgentRuntimeAdapterContext,
  AgentRuntimeSubagentAdapter,
  AgentRuntimeSubagentThreadRef
} from './adapter'
import type { PrincipalContextSnapshot } from '@sciforge/domain-sdk/principal'
import {
  AgentRuntimeToolError,
  type AgentRuntimeToolSurface
} from './agent-tool-surface'
import type {
  RuntimeToolCallRequest,
  RuntimeToolCallResponse,
  RuntimeToolDefinition
} from './runtime-tool-contract'

export const AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME = 'delegate_task'
export const AGENT_RUNTIME_SUBAGENT_STATUS_TOOL_NAME = 'subagent_status'
export const AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME = 'subagent_wait'
export const AGENT_RUNTIME_SUBAGENT_MESSAGE_TOOL_NAME = 'subagent_send'
export const AGENT_RUNTIME_SUBAGENT_CANCEL_TOOL_NAME = 'subagent_cancel'
export const AGENT_RUNTIME_SUBAGENT_DIAGNOSTICS_TOOL_NAME = 'subagent_diagnostics'
export const AGENT_RUNTIME_SUBAGENT_RESUME_TOOL_NAME = 'subagent_resume'
export const AGENT_RUNTIME_SUBAGENT_DELETE_TOOL_NAME = 'subagent_delete'
const RECENT_CHILD_THREAD_IDENTITY_LIMIT = 200

export type AgentRuntimeSubagentBinding = {
  adapter: AgentRuntimeSubagentAdapter
  context: AgentRuntimeAdapterContext
  enabled: boolean
  maxParallel: number
}

export type AgentRuntimeSubagentToolBridgeOptions = {
  resolveBinding(runtimeId: AgentRuntimeId, parentThreadId: string): Promise<AgentRuntimeSubagentBinding>
  principalForParentTurn?: (
    runtimeId: AgentRuntimeId,
    parentThreadId: string,
    parentTurnId: string
  ) => PrincipalContextSnapshot
  bindChildTurnPrincipal?: (
    runtimeId: AgentRuntimeId,
    threadRef: AgentRuntimeSubagentThreadRef,
    principalContext: PrincipalContextSnapshot
  ) => () => void
  storeRoot?: string
  storeFactory?: (runtimeId: AgentRuntimeId) => MultiAgentStore
  onChildEvent?: (
    runtimeId: AgentRuntimeId,
    event: MultiAgentChildEvent,
    record: MultiAgentChildRunRecord
  ) => Promise<void> | void
  onChildTerminal?: (
    runtimeId: AgentRuntimeId,
    record: MultiAgentChildRunRecord
  ) => Promise<void> | void
}

type ActiveRequest = {
  controller: AbortController
  runtimeId: AgentRuntimeId
  threadId: string
  turnId: string
}

type RuntimeEntry = {
  runtime: MultiAgentRuntime
  maxParallel: number
  ready: Promise<void>
}

type DelegatedTaskInput = {
  prompt: string
  label?: string
  workspace?: string
  model?: string
  allowedToolNames?: string[]
  brokerScope?: Readonly<{ providerFamily: 'managed-mcp'; packageName?: string }>
  deadlineMs?: number
  maxToolCalls?: number
}

type DelegatedTaskBatch = {
  tasks: DelegatedTaskInput[]
}

type DelegatedTaskOutcome =
  | { task: DelegatedTaskInput; record: MultiAgentChildRunRecord }
  | { task: DelegatedTaskInput; error: unknown }

export function createAgentRuntimeSubagentToolBridge(
  options: AgentRuntimeSubagentToolBridgeOptions
): AgentRuntimeSubagentToolBridge {
  return new AgentRuntimeSubagentToolBridge(options)
}

export class AgentRuntimeSubagentToolBridge {
  private readonly runtimes = new Map<AgentRuntimeId, RuntimeEntry>()
  private readonly activeRequests = new Set<ActiveRequest>()
  private readonly childThreadIds = new Map<AgentRuntimeId, Set<string>>()
  private readonly childIdsByThreadId = new Map<AgentRuntimeId, Map<string, string>>()
  private readonly activeChildrenByTurn = new Map<string, Set<string>>()
  private readonly childPrincipalFinalizers = new Map<string, () => void>()

  constructor(private readonly options: AgentRuntimeSubagentToolBridgeOptions) {}

  toolSurface(): AgentRuntimeToolSurface {
    return {
      tools: () => this.dynamicTools().map((tool) => ({
        type: tool.type,
        name: tool.name,
        description: tool.description,
        inputSchema: recordArguments(tool.inputSchema)
      })),
      call: async (call) => {
        const response = await this.callTool({
          requestId: call.context.requestId,
          runtimeId: call.context.runtimeId,
          ...(call.context.threadId ? { threadId: call.context.threadId } : {}),
          ...(call.context.turnId ? { turnId: call.context.turnId } : {}),
          ...(call.context.callId ? { callId: call.context.callId } : {}),
          tool: call.name,
          arguments: call.arguments,
          delegationContext: {
            allowedToolNames: call.context.allowedToolNames,
            brokerScope: call.context.brokerScope
          }
        })
        if (!response.success) {
          throw new AgentRuntimeToolError(
            response.contentItems
              .filter((item) => item.type === 'inputText')
              .map((item) => item.text)
              .join('\n') || `AgentRuntime tool ${call.name} failed.`,
            {
              code: response.errorCode ?? 'subagent_operation_failed',
              ...(response.failureClass ? { failureClass: response.failureClass } : {}),
              ...(response.retryable !== undefined ? { retryable: response.retryable } : {}),
              ...(response.recoveryGuidance
                ? {
                    recovery: {
                      action: 'follow_guidance',
                      instruction: response.recoveryGuidance
                    }
                  }
                : {}),
              ...(response.providerStage ? { providerStage: response.providerStage } : {})
            }
          )
        }
        return {
          tool: call.name,
          value: response.structuredContent ?? response.contentItems
        }
      },
      abortTurn: (identity) => this.abortRequestsForTurn(
        identity.runtimeId as AgentRuntimeId,
        identity.threadId,
        identity.turnId
      )
    }
  }

  dynamicTools(): RuntimeToolDefinition[] {
    const taskProperties = {
      prompt: { type: 'string', description: 'The child agent task prompt.' },
      task: { type: 'string', description: 'Alias for prompt.' },
      instructions: { type: 'string', description: 'Alias for prompt.' },
      label: { type: 'string', description: 'Short label for the child agent.' },
      name: { type: 'string', description: 'Alias for label.' },
      workspace: { type: 'string', description: 'Workspace root for the child task.' },
      cwd: { type: 'string', description: 'Alias for workspace.' },
      model: { type: 'string', description: 'Optional model override for the child agent.' },
      allowedToolNames: {
        type: 'array',
        minItems: 1,
        maxItems: 32,
        uniqueItems: true,
        items: { type: 'string' },
        description: 'Explicit child tool allowlist, intersected with the parent policy.'
      },
      brokerScope: {
        type: 'object',
        properties: {
          providerFamily: { type: 'string', enum: ['managed-mcp'] },
          packageName: { type: 'string' }
        },
        required: ['providerFamily'],
        additionalProperties: false
      },
      deadlineMs: {
        type: 'number',
        minimum: 1,
        maximum: 600_000,
        description: 'Active child execution budget. Host-managed human approval waits do not consume it.'
      },
      maxToolCalls: { type: 'number', minimum: 1, maximum: 256 }
    }
    return [{
      type: 'function',
      name: AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME,
      description: [
        'Start independent child agents and return stable child IDs immediately.',
        'Each call may start up to the configured parallel capacity.',
        'After children start, use subagent_wait or subagent_status before deciding whether any remaining work needs a later parent turn.'
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          ...taskProperties,
          tasks: {
            type: 'array',
            minItems: 1,
            description: 'Independent child tasks to start concurrently in this single tool call.',
            items: {
              type: 'object',
              properties: taskProperties,
              anyOf: [
                { required: ['prompt'] },
                { required: ['task'] },
                { required: ['instructions'] }
              ],
              additionalProperties: false
            }
          },
        },
        anyOf: [
          { required: ['prompt'] },
          { required: ['task'] },
          { required: ['instructions'] },
          { required: ['tasks'] }
        ],
        additionalProperties: false
      }
    }, {
      type: 'function',
      name: AGENT_RUNTIME_SUBAGENT_STATUS_TOOL_NAME,
      description: 'Inspect one child agent without changing its lifecycle. A missing liveness probe is not a terminal failure.',
      inputSchema: childIdInputSchema()
    }, {
      type: 'function',
      name: AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME,
      description: 'Wait briefly for a child agent. Reaching the wait timeout means the child is still running, not failed.',
      inputSchema: {
        type: 'object',
        properties: {
          childId: { type: 'string', description: 'Child agent ID returned by delegate_task.' },
          timeoutMs: { type: 'number', minimum: 0, maximum: 60_000, description: 'Observation window only; never a child execution deadline.' }
        },
        required: ['childId'],
        additionalProperties: false
      }
    }, {
      type: 'function',
      name: AGENT_RUNTIME_SUBAGENT_MESSAGE_TOOL_NAME,
      description: 'Send guidance or a progress question to a running child agent.',
      inputSchema: {
        type: 'object',
        properties: {
          childId: { type: 'string' },
          message: { type: 'string' }
        },
        required: ['childId', 'message'],
        additionalProperties: false
      }
    }, {
      type: 'function',
      name: AGENT_RUNTIME_SUBAGENT_CANCEL_TOOL_NAME,
      description: 'Explicitly cancel a running child agent.',
      inputSchema: childIdInputSchema()
    }, {
      type: 'function',
      name: AGENT_RUNTIME_SUBAGENT_DIAGNOSTICS_TOOL_NAME,
      description: 'Read redacted multi-agent lifecycle counters without changing child state.',
      inputSchema: {
        type: 'object',
        properties: {},
        additionalProperties: false
      }
    }, {
      type: 'function',
      name: AGENT_RUNTIME_SUBAGENT_RESUME_TOOL_NAME,
      description: 'Resume a failed or interrupted child agent in its existing provider thread and context.',
      inputSchema: {
        type: 'object',
        properties: {
          childId: { type: 'string', description: 'Interrupted child agent ID.' },
          prompt: { type: 'string', description: 'Optional continuation guidance for the resumed child.' }
        },
        required: ['childId'],
        additionalProperties: false
      }
    }, {
      type: 'function',
      name: AGENT_RUNTIME_SUBAGENT_DELETE_TOOL_NAME,
      description: 'Permanently remove a child agent from lifecycle storage and the child-agent sidebar. Running children are cancelled first.',
      inputSchema: childIdInputSchema()
    }]
  }

  canHandle(request: RuntimeToolCallRequest): boolean {
    const name = normalizedToolName(request)
    return name === AGENT_RUNTIME_SUBAGENT_SPAWN_TOOL_NAME ||
      name === AGENT_RUNTIME_SUBAGENT_STATUS_TOOL_NAME ||
      name === AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME ||
      name === AGENT_RUNTIME_SUBAGENT_MESSAGE_TOOL_NAME ||
      name === AGENT_RUNTIME_SUBAGENT_CANCEL_TOOL_NAME ||
      name === AGENT_RUNTIME_SUBAGENT_DIAGNOSTICS_TOOL_NAME ||
      name === AGENT_RUNTIME_SUBAGENT_RESUME_TOOL_NAME ||
      name === AGENT_RUNTIME_SUBAGENT_DELETE_TOOL_NAME
  }

  async callTool(
    request: RuntimeToolCallRequest
  ): Promise<RuntimeToolCallResponse> {
    if (!this.canHandle(request)) {
      return failedMultiAgentResponse(`Unsupported multi-agent tool: ${displayToolName(request)}.`)
    }
    const runtimeId = agentRuntimeId(request.runtimeId)
    if (!runtimeId) return failedMultiAgentResponse(`${displayToolName(request)} requires a supported runtimeId.`)
    if (!request.threadId) return failedMultiAgentResponse(`${displayToolName(request)} requires threadId.`)
    const binding = await this.options.resolveBinding(runtimeId, request.threadId)
    if (!binding.enabled) return failedMultiAgentResponse('Subagent delegation is disabled by runtime settings.')
    const entry = this.runtimeFor(runtimeId, binding)
    await entry.ready
    if (await this.isChildThread(runtimeId, entry.runtime, request.threadId)) {
      return failedMultiAgentResponse('Subagent delegation is disabled inside child agents.')
    }
    const toolName = normalizedToolName(request)
    if (toolName === AGENT_RUNTIME_SUBAGENT_STATUS_TOOL_NAME) return this.statusTool(entry.runtime, request.threadId, request.arguments)
    if (toolName === AGENT_RUNTIME_SUBAGENT_WAIT_TOOL_NAME) return this.waitTool(entry.runtime, request.threadId, request.arguments)
    if (toolName === AGENT_RUNTIME_SUBAGENT_MESSAGE_TOOL_NAME) return this.sendTool(entry.runtime, request.threadId, request.arguments)
    if (toolName === AGENT_RUNTIME_SUBAGENT_CANCEL_TOOL_NAME) return this.cancelTool(entry.runtime, request.threadId, request.arguments)
    if (toolName === AGENT_RUNTIME_SUBAGENT_DIAGNOSTICS_TOOL_NAME) {
      return this.diagnosticsTool(entry.runtime, runtimeId, request.threadId)
    }
    if (toolName === AGENT_RUNTIME_SUBAGENT_RESUME_TOOL_NAME) {
      if (!request.turnId) return failedMultiAgentResponse('subagent_resume requires turnId.')
      const principalContext = this.options.principalForParentTurn?.(
        runtimeId,
        request.threadId,
        request.turnId
      )
      return this.resumeTool(
        entry.runtime,
        request.threadId,
        request.turnId,
        request.arguments,
        principalContext
      )
    }
    if (toolName === AGENT_RUNTIME_SUBAGENT_DELETE_TOOL_NAME) {
      return this.deleteTool(entry.runtime, binding, request.threadId, request.arguments)
    }
    const input = parseDelegateTaskArguments(request.arguments)
    if (input.tasks.length === 0) {
      return failedMultiAgentResponse(
        'delegate_task requires a prompt, task, or instructions string, or a non-empty tasks array.'
      )
    }
    const invalidTaskIndex = input.tasks.findIndex((task) => !task.prompt)
    if (invalidTaskIndex >= 0) {
      return failedMultiAgentResponse(
        `delegate_task tasks[${invalidTaskIndex}] requires a prompt, task, or instructions string.`
      )
    }
    const maxParallel = entry.maxParallel
    if (input.tasks.length > maxParallel) {
      return failedMultiAgentResponse(
        `delegate_task accepts at most ${maxParallel} concurrent tasks in one call. ` +
        'Wait for running children before starting the remaining work.'
      )
    }
    if (!request.turnId) return failedMultiAgentResponse('delegate_task requires turnId.')
    const principalContext = this.options.principalForParentTurn?.(
      runtimeId,
      request.threadId,
      request.turnId
    )
    return this.executeToolCall(entry.runtime, runtimeId, {
      ...request,
      threadId: request.threadId,
      turnId: request.turnId
    }, input, principalContext)
  }

  private async executeToolCall(
    runtime: MultiAgentRuntime,
    runtimeId: AgentRuntimeId,
    request: RuntimeToolCallRequest & { threadId: string; turnId: string },
    input: DelegatedTaskBatch,
    principalContext?: PrincipalContextSnapshot
  ): Promise<RuntimeToolCallResponse> {

    const active = {
      controller: new AbortController(),
      runtimeId,
      threadId: request.threadId,
      turnId: request.turnId
    }
    this.activeRequests.add(active)
    try {
      const batch = input.tasks.length > 1
      const outcomes = await Promise.all(input.tasks.map(async (task, index): Promise<DelegatedTaskOutcome> => {
        try {
          const record = await runtime.startChild({
            parentThreadId: request.threadId,
            parentTurnId: request.turnId,
            requestId: batch ? `batch\u0000${String(request.requestId)}\u0000${index}` : String(request.requestId),
            label: task.label,
            prompt: task.prompt,
            workspace: task.workspace,
            model: task.model,
            allowedToolNames: intersectAllowedToolNames(
              request.delegationContext?.allowedToolNames,
              task.allowedToolNames
            ),
            strictAllowedToolNames: true,
            brokerScope: narrowBrokerScope(
              request.delegationContext?.brokerScope,
              task.brokerScope
            ),
            deadlineMs: task.deadlineMs,
            maxToolCalls: task.maxToolCalls,
            executorContext: principalContext,
            signal: active.controller.signal
          })
          this.trackActiveChild(runtimeId, record)
          return { task, record }
        } catch (error) {
          return { task, error }
        }
      }))
      return responseFromDelegatedTaskOutcomes(outcomes)
    } finally {
      this.activeRequests.delete(active)
    }
  }

  private async statusTool(runtime: MultiAgentRuntime, parentThreadId: string, value: unknown): Promise<RuntimeToolCallResponse> {
    const childId = requiredStringArgument(value, 'childId')
    if (!childId) return failedMultiAgentResponse('subagent_status requires childId.')
    const inspected = await runtime.inspectChild(parentThreadId, childId)
    if (!inspected) return failedMultiAgentResponse(`Subagent ${childId} was not found.`)
    return childObservationResponse(inspected.record, { liveness: inspected.liveness })
  }

  private async waitTool(runtime: MultiAgentRuntime, parentThreadId: string, value: unknown): Promise<RuntimeToolCallResponse> {
    const childId = requiredStringArgument(value, 'childId')
    if (!childId) return failedMultiAgentResponse('subagent_wait requires childId.')
    const args = recordArguments(value)
    const timeoutMs = typeof args.timeoutMs === 'number' ? args.timeoutMs : undefined
    const waited = await runtime.waitForChild(parentThreadId, childId, { timeoutMs })
    if (!waited) return failedMultiAgentResponse(`Subagent ${childId} was not found.`)
    return childObservationResponse(waited.record, { waitTimedOut: waited.timedOut })
  }

  private async sendTool(runtime: MultiAgentRuntime, parentThreadId: string, value: unknown): Promise<RuntimeToolCallResponse> {
    const childId = requiredStringArgument(value, 'childId')
    const message = requiredStringArgument(value, 'message')
    if (!childId || !message) return failedMultiAgentResponse('subagent_send requires childId and message.')
    const established = await runtime.sendMessage(parentThreadId, childId, message)
    return {
      success: established,
      contentItems: [{ type: 'inputText', text: established ? `Message delivered to ${childId}.` : `Subagent ${childId} is not currently accepting messages.` }],
      structuredContent: { childId, established }
    }
  }

  private async cancelTool(runtime: MultiAgentRuntime, parentThreadId: string, value: unknown): Promise<RuntimeToolCallResponse> {
    const childId = requiredStringArgument(value, 'childId')
    if (!childId) return failedMultiAgentResponse('subagent_cancel requires childId.')
    const record = await runtime.cancelChild(parentThreadId, childId)
    if (!record) return failedMultiAgentResponse(`Subagent ${childId} was not found.`)
    return { ...childObservationResponse(record, { cancelled: true }), success: true }
  }

  private async diagnosticsTool(
    runtime: MultiAgentRuntime,
    runtimeId: AgentRuntimeId,
    parentThreadId: string
  ): Promise<RuntimeToolCallResponse> {
    const diagnostics = await runtime.diagnostics(parentThreadId)
    const structuredContent = {
      activeChildExecutions: diagnostics.active,
      activeLifecycleControls: diagnostics.activeLifecycleControls,
      activeBoundaries: diagnostics.activeBoundaries,
      pendingDelegationRequests: [...this.activeRequests].filter((request) => (
        request.runtimeId === runtimeId && request.threadId === parentThreadId
      )).length,
      trackedChildren: diagnostics.childRuns.length,
      statusCounts: diagnostics.statusCounts
    }
    return {
      success: true,
      contentItems: [{ type: 'inputText', text: JSON.stringify(structuredContent) }],
      structuredContent
    }
  }

  private async resumeTool(
    runtime: MultiAgentRuntime,
    parentThreadId: string,
    parentTurnId: string,
    value: unknown,
    principalContext?: PrincipalContextSnapshot
  ): Promise<RuntimeToolCallResponse> {
    const childId = requiredStringArgument(value, 'childId')
    if (!childId) return failedMultiAgentResponse('subagent_resume requires childId.')
    const prompt = requiredStringArgument(value, 'prompt')
    const record = await runtime.resumeChild({
      parentThreadId,
      parentTurnId,
      childId,
      executorContext: principalContext,
      ...(prompt ? { prompt } : {})
    })
    return {
      ...childObservationResponse(record, { resumed: true, attempt: record.attempt }),
      success: true
    }
  }

  private async deleteTool(
    runtime: MultiAgentRuntime,
    binding: AgentRuntimeSubagentBinding,
    parentThreadId: string,
    value: unknown
  ): Promise<RuntimeToolCallResponse> {
    const childId = requiredStringArgument(value, 'childId')
    if (!childId) return failedMultiAgentResponse('subagent_delete requires childId.')
    const record = await runtime.cancelChild(parentThreadId, childId)
    if (!record) return failedMultiAgentResponse(`Subagent ${childId} was not found.`)
    await binding.adapter.delete(binding.context, {
      childId,
      parentThreadId,
      parentTurnId: record.parentTurnId,
      ...(record.threadRef ? { threadRef: record.threadRef } : {}),
      signal: new AbortController().signal
    })
    const deleted = await runtime.deleteChild(parentThreadId, childId)
    if (!deleted) return failedMultiAgentResponse(`Subagent ${childId} was not found.`)
    return {
      success: true,
      contentItems: [{ type: 'inputText', text: `Subagent ${childId} was deleted.` }],
      structuredContent: { childId, deleted: true }
    }
  }

  abortRequestsForTurn(runtimeId: AgentRuntimeId, threadId: string, turnId: string): number {
    let aborted = 0
    for (const request of this.activeRequests) {
      if (request.runtimeId !== runtimeId || request.threadId !== threadId || request.turnId !== turnId) continue
      if (request.controller.signal.aborted) continue
      request.controller.abort(new Error('multi-agent request aborted by parent turn interrupt'))
      aborted += 1
    }
    const runtime = this.runtimes.get(runtimeId)?.runtime
    const childIds = this.activeChildrenByTurn.get(parentTurnKey(runtimeId, threadId, turnId))
    if (runtime && childIds) {
      for (const childId of childIds) {
        void runtime.cancelChild(threadId, childId)
        aborted += 1
      }
    }
    return aborted
  }

  suspendChildExecutionDeadline(runtimeId: AgentRuntimeId, threadId: string, token: string): boolean {
    const childId = this.childIdsByThreadId.get(runtimeId)?.get(threadId)
    const runtime = this.runtimes.get(runtimeId)?.runtime
    return Boolean(childId && runtime?.suspendChildExecutionDeadline(childId, token))
  }

  resumeChildExecutionDeadline(runtimeId: AgentRuntimeId, threadId: string, token: string): boolean {
    const childId = this.childIdsByThreadId.get(runtimeId)?.get(threadId)
    const runtime = this.runtimes.get(runtimeId)?.runtime
    return Boolean(childId && runtime?.resumeChildExecutionDeadline(childId, token))
  }

  dispose(): void {
    for (const request of this.activeRequests) {
      if (!request.controller.signal.aborted) {
        request.controller.abort(new Error('AgentRuntime Host stopped.'))
      }
    }
    for (const { runtime } of this.runtimes.values()) {
      void runtime.diagnostics().then(async (diagnostics) => {
        const running = diagnostics.childRuns.filter((record) =>
          record.status === 'queued' || record.status === 'running'
        )
        await Promise.all(running.map((record) =>
          runtime.cancelChild(record.parentThreadId, record.id)
        ))
      }).catch(() => undefined).finally(() => runtime.dispose())
    }
    for (const finalizePrincipal of this.childPrincipalFinalizers.values()) {
      finalizePrincipal()
    }
    this.childPrincipalFinalizers.clear()
  }

  private runtimeFor(runtimeId: AgentRuntimeId, binding: AgentRuntimeSubagentBinding): RuntimeEntry {
    const existing = this.runtimes.get(runtimeId)
    if (existing) return existing
    const maxParallel = Math.max(1, binding.maxParallel)
    const runtime = new MultiAgentRuntime({
      config: {
        enabled: true,
        maxParallel
      },
      store: this.options.storeFactory?.(runtimeId) ?? (this.options.storeRoot
        ? new FileMultiAgentStore(join(this.options.storeRoot, runtimeId))
        : new InMemoryMultiAgentStore()),
      executor: (input) => this.executeAdapterChild(runtimeId, input),
      events: {
        onChildEvent: (event, record) => this.handleChildEvent(runtimeId, event, record),
        onChildTerminal: (record) => this.handleChildTerminal(runtimeId, record)
      }
    })
    const entry: RuntimeEntry = { runtime, maxParallel, ready: Promise.resolve() }
    this.runtimes.set(runtimeId, entry)
    entry.ready = runtime.recoverStaleChildren().then(() => undefined)
    return entry
  }

  private async isChildThread(
    runtimeId: AgentRuntimeId,
    runtime: MultiAgentRuntime,
    threadId: string
  ): Promise<boolean> {
    if (this.childThreadIds.get(runtimeId)?.has(threadId)) return true
    const record = await runtime.childByThreadId(threadId)
    if (!record) return false
    this.rememberChildThreadId(runtimeId, threadId)
    return true
  }

  private async executeAdapterChild(
    runtimeId: AgentRuntimeId,
    input: MultiAgentExecutorInput
  ): Promise<MultiAgentExecutorResult> {
    const binding = await this.options.resolveBinding(runtimeId, input.parentThreadId)
    const principalContext = isPrincipalContextSnapshot(input.executorContext)
      ? input.executorContext
      : undefined
    const target = {
      childId: input.childId,
      parentThreadId: input.parentThreadId,
      parentTurnId: input.parentTurnId
    }
    input.registerLifecycleControl({
      sendMessage: (request) => binding.adapter.message(binding.context, {
        ...target,
        message: request.message,
        signal: request.signal
      }),
      inspect: (signal) => binding.adapter.inspect(binding.context, {
        ...target,
        signal
      }),
      terminate: (request) => binding.adapter.cancel(binding.context, {
        ...target,
        reason: request.reason,
        signal: request.signal
      })
    })
    const bindThreadIdentity = (threadRef: AgentRuntimeSubagentThreadRef): void => {
      if (threadRef.threadId) {
        this.rememberChildThreadId(runtimeId, threadRef.threadId)
        const childIds = this.childIdsByThreadId.get(runtimeId) ?? new Map<string, string>()
        childIds.set(threadRef.threadId, input.childId)
        this.childIdsByThreadId.set(runtimeId, childIds)
      }
    }
    const adapterInput = {
      ...target,
      ...(input.label ? { label: input.label } : {}),
      prompt: input.prompt,
      ...(input.workspace ? { workspace: input.workspace } : {}),
      ...(input.model ? { model: input.model } : {}),
      ...(input.allowedToolNames ? { allowedTools: input.allowedToolNames } : {}),
      ...(input.brokerScope ? { brokerScope: input.brokerScope } : {}),
      ...(input.maxToolCalls ? { maxToolCalls: input.maxToolCalls } : {}),
      signal: input.signal,
      appendTranscript: input.appendTranscript,
      onThreadBound: bindThreadIdentity,
      onSpawned: async (threadRef: AgentRuntimeSubagentThreadRef) => {
        if (principalContext && this.options.bindChildTurnPrincipal) {
          const principalKey = childPrincipalKey(runtimeId, input.childId)
          if (this.childPrincipalFinalizers.has(principalKey)) {
            throw new Error(`Subagent ${input.childId} already has an active Principal binding.`)
          }
          this.childPrincipalFinalizers.set(
            principalKey,
            this.options.bindChildTurnPrincipal(runtimeId, threadRef, principalContext)
          )
        }
        bindThreadIdentity(threadRef)
        await input.setThreadRef(threadRef)
      }
    }
    if (input.resumeThreadRef) {
      bindThreadIdentity(input.resumeThreadRef)
      return binding.adapter.resume(binding.context, {
        ...adapterInput,
        threadRef: input.resumeThreadRef
      })
    }
    return binding.adapter.spawn(binding.context, adapterInput)
  }

  private async handleChildEvent(
    runtimeId: AgentRuntimeId,
    event: MultiAgentChildEvent,
    record: MultiAgentChildRunRecord
  ): Promise<void> {
    this.trackActiveChild(runtimeId, record)
    await this.options.onChildEvent?.(runtimeId, event, record)
  }

  private async handleChildTerminal(
    runtimeId: AgentRuntimeId,
    record: MultiAgentChildRunRecord
  ): Promise<void> {
    try {
      await this.options.onChildTerminal?.(runtimeId, record)
    } finally {
      const principalKey = childPrincipalKey(runtimeId, record.id)
      const finalizePrincipal = this.childPrincipalFinalizers.get(principalKey)
      this.childPrincipalFinalizers.delete(principalKey)
      finalizePrincipal?.()
    }
  }

  private trackActiveChild(runtimeId: AgentRuntimeId, record: MultiAgentChildRunRecord): void {
    const key = parentTurnKey(runtimeId, record.parentThreadId, record.parentTurnId)
    const children = this.activeChildrenByTurn.get(key) ?? new Set<string>()
    if (record.status === 'queued' || record.status === 'running') {
      children.add(record.id)
      this.activeChildrenByTurn.set(key, children)
      return
    }
    children.delete(record.id)
    if (children.size === 0) this.activeChildrenByTurn.delete(key)
    const threadId = record.threadRef?.threadId
    if (threadId) {
      const childIds = this.childIdsByThreadId.get(runtimeId)
      childIds?.delete(threadId)
      if (childIds?.size === 0) this.childIdsByThreadId.delete(runtimeId)
    }
  }

  private rememberChildThreadId(runtimeId: AgentRuntimeId, threadId: string): void {
    const threadIds = this.childThreadIds.get(runtimeId) ?? new Set<string>()
    threadIds.delete(threadId)
    threadIds.add(threadId)
    while (threadIds.size > RECENT_CHILD_THREAD_IDENTITY_LIMIT) {
      const oldest = threadIds.values().next().value
      if (oldest === undefined) break
      threadIds.delete(oldest)
    }
    this.childThreadIds.set(runtimeId, threadIds)
  }
}

function isPrincipalContextSnapshot(value: unknown): value is PrincipalContextSnapshot {
  if (!value || typeof value !== 'object') return false
  const context = value as { identityVersion?: unknown; principal?: unknown }
  return Number.isInteger(context.identityVersion) && (
    context.principal === null || typeof context.principal === 'object'
  )
}

function childPrincipalKey(runtimeId: AgentRuntimeId, childId: string): string {
  return `${runtimeId}\u0000${childId}`
}

export function agentRuntimeChildFromMultiAgentRecord(
  runtimeId: AgentRuntimeId,
  record: MultiAgentChildRunRecord,
  event?: MultiAgentChildEvent
): AgentRuntimeChild {
  const usage = agentUsageFromMultiAgentUsage(record.usage)
  return {
    id: record.id,
    runtimeId,
    parentThreadId: record.parentThreadId,
    parentTurnId: record.parentTurnId,
    kind: 'agent',
    status: record.status,
    ...(record.label ? { label: record.label, name: record.label } : {}),
    prompt: record.prompt,
    ...(record.summary ? { summary: record.summary } : {}),
    ...(usage ? { usage } : {}),
    transcriptRef: {
      runtimeId,
      childId: record.id,
      transcriptId: record.threadRef?.threadId ?? record.id,
      source: 'agent-runtime-subagent',
      kind: record.threadRef?.threadId ? 'runtime' : 'remote'
    },
    ...(record.threadRef?.threadId
      ? {
          openAsThreadRef: {
            runtimeId,
            threadId: record.threadRef.threadId,
            relation: 'side' as const,
            ...(record.threadRef.url ? { url: record.threadRef.url } : {})
          }
        }
      : {}),
    createdAt: record.createdAt,
    ...(record.startedAt ? { startedAt: record.startedAt } : {}),
    updatedAt: record.updatedAt,
    ...(record.finishedAt ? { completedAt: record.finishedAt } : {}),
    metadata: {
      source: `${runtimeId}.agent-runtime.spawn`,
      lifecycleOperation: event?.operation ?? 'upsert',
      attempt: record.attempt,
      ...(record.threadRef?.turnId ? { childTurnId: record.threadRef.turnId } : {}),
      ...(event?.seq !== undefined ? { childSeq: event.seq } : {}),
      ...(record.error ? { error: record.error } : {})
    }
  }
}

function responseFromChildRecord(record: MultiAgentChildRunRecord): RuntimeToolCallResponse {
  const ok = record.status !== 'failed' && record.status !== 'aborted'
  const errorText = record.error?.message?.trim()
  const summaryText = record.summary?.trim()
  const text = ok
    ? record.status === 'queued' || record.status === 'running'
      ? `Subagent ${record.id} started and is still running.`
      : summaryText || 'Child agent completed without textual output.'
    : errorText && summaryText && errorText !== summaryText
      ? `${errorText}\n\nProgress summary:\n${summaryText}`
      : errorText || summaryText || 'Child agent failed.'
  return {
    success: ok,
    contentItems: [{
      type: 'inputText',
      text
    }],
    structuredContent: {
      childId: record.id,
      status: record.status,
      ...(record.summary ? { summary: record.summary } : {})
    }
  }
}

function childObservationResponse(
  record: MultiAgentChildRunRecord,
  observation: Record<string, unknown>
): RuntimeToolCallResponse {
  const response = responseFromChildRecord(record)
  const stillRunning = record.status === 'queued' || record.status === 'running'
  const waitTimedOut = observation.waitTimedOut === true
  const liveness = recordArguments(observation.liveness)
  const livenessText = liveness.state === 'active'
    ? 'Runtime probe confirms it is active.'
    : liveness.state === 'missing' && stillRunning
      ? 'The runtime probe could not confirm activity; this is not yet a terminal failure.'
      : ''
  const text = waitTimedOut && stillRunning
    ? `Subagent ${record.id} is still running after the observation window.`
    : [response.contentItems[0]?.type === 'inputText' ? response.contentItems[0].text : '', livenessText]
        .filter(Boolean)
        .join('\n')
  return {
    ...response,
    contentItems: [{ type: 'inputText', text }],
    structuredContent: {
      childId: record.id,
      status: record.status,
      terminal: !stillRunning,
      ...observation,
      ...(record.summary ? { summary: record.summary } : {}),
      ...(record.error ? { error: record.error } : {})
    }
  }
}

function childIdInputSchema(): RuntimeToolDefinition['inputSchema'] {
  return {
    type: 'object',
    properties: {
      childId: { type: 'string', description: 'Child agent ID returned by delegate_task.' }
    },
    required: ['childId'],
    additionalProperties: false
  }
}

function requiredStringArgument(value: unknown, key: string): string {
  const candidate = recordArguments(value)[key]
  return typeof candidate === 'string' ? candidate.trim() : ''
}

function responseFromDelegatedTaskOutcomes(
  outcomes: readonly DelegatedTaskOutcome[]
): RuntimeToolCallResponse {
  if (outcomes.length === 1) {
    const outcome = outcomes[0]
    return 'record' in outcome
      ? responseFromChildRecord(outcome.record)
      : failedMultiAgentResponse(errorMessage(outcome.error))
  }

  const results = outcomes.map((outcome, index) => {
    const label = outcome.task.label || `Task ${index + 1}`
    if ('record' in outcome) {
      const response = responseFromChildRecord(outcome.record)
      return {
        index,
        label,
        success: response.success,
        childId: outcome.record.id,
        status: outcome.record.status,
        text: response.contentItems[0]?.type === 'inputText'
          ? response.contentItems[0].text
          : ''
      }
    }
    return {
      index,
      label,
      success: false,
      status: 'failed',
      text: errorMessage(outcome.error)
    }
  })
  return {
    success: results.every((result) => result.success),
    contentItems: [{
      type: 'inputText',
      text: results.map((result) => [
        `${result.label} — ${result.status}`,
        result.text
      ].filter(Boolean).join('\n')).join('\n\n')
    }],
    structuredContent: {
      mode: 'parallel',
      children: results
    }
  }
}

function parseDelegateTaskArguments(value: unknown): DelegatedTaskBatch {
  const args = recordArguments(value)
  const defaults = parseDelegatedTask(args)
  const values = Array.isArray(args.tasks) ? args.tasks : []
  const tasks = values.length > 0
    ? values
        .map((task) => parseDelegatedTask(recordArguments(task), defaults))
    : defaults.prompt
      ? [defaults]
      : []
  return { tasks }
}

function parseDelegatedTask(
  args: Record<string, unknown>,
  defaults: Partial<DelegatedTaskInput> = {}
): DelegatedTaskInput {
  const prompt = firstString(args.prompt, args.task, args.instructions, args.input, args.message)
  const label = firstString(args.label, args.name, args.agentName, args.agent)
  const workspace = firstString(args.workspace, args.cwd, args.workspaceRoot, defaults.workspace)
  const model = firstString(args.model, defaults.model)
  const allowedToolNames = stringArray(args.allowedToolNames) ?? defaults.allowedToolNames
  const brokerScope = delegatedBrokerScope(args.brokerScope) ?? defaults.brokerScope
  const deadlineMs = boundedInteger(args.deadlineMs, 1, 600_000) ?? defaults.deadlineMs
  const maxToolCalls = boundedInteger(args.maxToolCalls, 1, 256) ?? defaults.maxToolCalls
  return {
    prompt,
    ...(label ? { label } : {}),
    ...(workspace ? { workspace } : {}),
    ...(model ? { model } : {}),
    ...(allowedToolNames ? { allowedToolNames } : {}),
    ...(brokerScope ? { brokerScope } : {}),
    ...(deadlineMs ? { deadlineMs } : {}),
    ...(maxToolCalls ? { maxToolCalls } : {})
  }
}

function stringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const names = value.map((entry) => typeof entry === 'string' ? entry.trim() : '').filter(Boolean)
  return names.length ? [...new Set(names)] : undefined
}

function delegatedBrokerScope(value: unknown): DelegatedTaskInput['brokerScope'] | undefined {
  const record = recordArguments(value)
  if (record.providerFamily !== 'managed-mcp') return undefined
  const packageName = firstString(record.packageName)
  return Object.freeze({ providerFamily: 'managed-mcp', ...(packageName ? { packageName } : {}) })
}

function boundedInteger(value: unknown, minimum: number, maximum: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  const normalized = Math.trunc(value)
  return normalized >= minimum && normalized <= maximum ? normalized : undefined
}

function intersectAllowedToolNames(
  parent: readonly string[] | undefined,
  requested: readonly string[] | undefined
): string[] | undefined {
  if (parent === undefined) return requested ? [...requested] : undefined
  const inherited = new Set(parent)
  if (requested === undefined) return [...inherited]
  return requested.filter((name) => inherited.has(name))
}

function narrowBrokerScope(
  parent: DelegatedTaskInput['brokerScope'] | undefined,
  requested: DelegatedTaskInput['brokerScope'] | undefined
): DelegatedTaskInput['brokerScope'] | undefined {
  if (!parent) return requested
  if (!requested) return parent
  if (parent.providerFamily !== requested.providerFamily ||
      (parent.packageName && requested.packageName && parent.packageName !== requested.packageName)) {
    throw new Error('Delegated broker scope cannot exceed or conflict with the parent scope.')
  }
  return Object.freeze({
    providerFamily: parent.providerFamily,
    packageName: parent.packageName ?? requested.packageName
  })
}

function normalizedToolName(request: RuntimeToolCallRequest): string {
  if (request.namespace) return `${request.namespace}.${request.tool}`.trim()
  return request.tool.trim()
}

function displayToolName(request: RuntimeToolCallRequest): string {
  return request.namespace ? `${request.namespace}.${request.tool}` : request.tool
}

function recordArguments(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>
  if (typeof value !== 'string' || !value.trim()) return {}
  try {
    const parsed = JSON.parse(value) as unknown
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {}
  } catch {
    return {}
  }
}

function firstString(...values: unknown[]): string {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) return value.trim()
  }
  return ''
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function agentUsageFromMultiAgentUsage(usage: MultiAgentUsage = EMPTY_MULTI_AGENT_USAGE): AgentRuntimeChild['usage'] | undefined {
  const normalized = {
    ...(usage.promptTokens ? { inputTokens: usage.promptTokens } : {}),
    ...(usage.completionTokens ? { outputTokens: usage.completionTokens } : {}),
    ...(usage.totalTokens ? { totalTokens: usage.totalTokens } : {}),
    ...(usage.cachedTokens ? { cacheReadTokens: usage.cachedTokens } : {})
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function failedMultiAgentResponse(message: string): RuntimeToolCallResponse {
  return {
    success: false,
    contentItems: [{ type: 'inputText', text: message }]
  }
}

function agentRuntimeId(value: string | undefined): AgentRuntimeId | null {
  const normalized = value?.trim()
  return normalized ? normalized as AgentRuntimeId : null
}

function parentTurnKey(
  runtimeId: AgentRuntimeId,
  parentThreadId: string,
  parentTurnId: string
): string {
  return `${runtimeId}\u0000${parentThreadId}\u0000${parentTurnId}`
}
