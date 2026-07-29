import type { AgentRuntimeChild } from '../../../shared/agent-runtime-contract'
import {
  EMPTY_MULTI_AGENT_USAGE,
  FileMultiAgentStore,
  InMemoryMultiAgentStore,
  MultiAgentRuntime,
  type MultiAgentChildEvent,
  type MultiAgentChildRunRecord,
  type MultiAgentExecutor,
  type MultiAgentExecutorResult,
  type MultiAgentStore,
  type MultiAgentUsage
} from '../../../../packages/workers/multi-agent/src'
import type {
  RuntimeToolCallRequest,
  RuntimeToolCallResponse,
  RuntimeToolDefinition
} from '../agent-runtime/runtime-tool-contract'

export const CODEX_MULTI_AGENT_NAMESPACE = 'multi_agent_v1'
export const CODEX_MULTI_AGENT_SPAWN_TOOL = 'spawn_agent'
export const CODEX_MULTI_AGENT_FLAT_TOOL_NAME = 'delegate_task'

export type CodexMultiAgentToolBridgeOptions = {
  enabled?: boolean
  maxParallel?: number
  maxChildren?: number
  childTimeoutMs?: number
  timeoutHandshakeMs?: number
  timeoutSummaryGraceMs?: number
  store?: MultiAgentStore
  storeRoot?: string
  executor: MultiAgentExecutor
  onChildEvent?: (event: MultiAgentChildEvent) => Promise<void> | void
}

type ActiveRequest = {
  controller: AbortController
  threadId?: string
  turnId?: string
}

type CachedMultiAgentRequest = {
  promise: Promise<RuntimeToolCallResponse>
  settled: boolean
}

type DelegatedTaskInput = {
  prompt: string
  label?: string
  workspace?: string
  model?: string
}

type DelegatedTaskBatch = {
  tasks: DelegatedTaskInput[]
}

type DelegatedTaskOutcome =
  | { task: DelegatedTaskInput; record: MultiAgentChildRunRecord }
  | { task: DelegatedTaskInput; error: unknown }

export function createCodexMultiAgentToolBridge(
  options: CodexMultiAgentToolBridgeOptions
): CodexMultiAgentToolBridge {
  return new CodexMultiAgentToolBridge(options)
}

export class CodexMultiAgentToolBridge {
  private readonly runtime: MultiAgentRuntime
  private readonly activeRequests = new Set<ActiveRequest>()
  private readonly requestsByIdempotencyKey = new Map<
    string,
    CachedMultiAgentRequest
  >()

  constructor(private readonly options: CodexMultiAgentToolBridgeOptions) {
    this.runtime = new MultiAgentRuntime({
      config: {
        enabled: options.enabled ?? true,
        maxParallel: options.maxParallel ?? 2,
        maxChildren: options.maxChildren ?? 4,
        ...(options.childTimeoutMs !== undefined ? { childTimeoutMs: options.childTimeoutMs } : {}),
        ...(options.timeoutHandshakeMs !== undefined
          ? { timeoutHandshakeMs: options.timeoutHandshakeMs }
          : {}),
        ...(options.timeoutSummaryGraceMs !== undefined
          ? { timeoutSummaryGraceMs: options.timeoutSummaryGraceMs }
          : {})
      },
      store: options.store ?? (options.storeRoot
        ? new FileMultiAgentStore(options.storeRoot)
        : new InMemoryMultiAgentStore()),
      executor: options.executor,
      events: options.onChildEvent ? { onChildEvent: options.onChildEvent } : undefined
    })
  }

  dynamicTools(): RuntimeToolDefinition[] {
    if (this.options.enabled === false) return []
    const maxParallel = Math.max(1, this.options.maxParallel ?? 2)
    const taskProperties = {
      prompt: { type: 'string', description: 'The child agent task prompt.' },
      task: { type: 'string', description: 'Alias for prompt.' },
      instructions: { type: 'string', description: 'Alias for prompt.' },
      label: { type: 'string', description: 'Short label for the child agent.' },
      name: { type: 'string', description: 'Alias for label.' },
      workspace: { type: 'string', description: 'Workspace root for the child task.' },
      cwd: { type: 'string', description: 'Alias for workspace.' },
      model: { type: 'string', description: 'Optional model override for the child agent.' }
    }
    return [{
      type: 'function',
      name: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      description: [
        'Delegate independent work to bounded child agents and return their outputs.',
        `For parallel work, send one call with a tasks array containing up to ${maxParallel} tasks;`,
        'do not issue independent delegate_task calls serially.'
      ].join(' '),
      inputSchema: {
        type: 'object',
        properties: {
          ...taskProperties,
          tasks: {
            type: 'array',
            minItems: 1,
            maxItems: maxParallel,
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
    }]
  }

  canHandle(request: RuntimeToolCallRequest): boolean {
    const name = normalizedToolName(request)
    return name === CODEX_MULTI_AGENT_FLAT_TOOL_NAME ||
      name === `${CODEX_MULTI_AGENT_NAMESPACE}.${CODEX_MULTI_AGENT_SPAWN_TOOL}` ||
      name === 'multi_agent_v1_spawn_agent'
  }

  async callTool(
    request: RuntimeToolCallRequest
  ): Promise<RuntimeToolCallResponse> {
    if (!this.canHandle(request)) {
      return failedMultiAgentResponse(`Unsupported multi-agent tool: ${displayToolName(request)}.`)
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
    const maxParallel = this.options.maxParallel ?? 2
    if (input.tasks.length > maxParallel) {
      return failedMultiAgentResponse(
        `delegate_task accepts at most ${maxParallel} parallel tasks in one call.`
      )
    }
    if (!request.threadId) return failedMultiAgentResponse('delegate_task requires threadId.')
    if (!request.turnId) return failedMultiAgentResponse('delegate_task requires turnId.')

    // App-server can replay the same dynamic tool request while reconnecting.
    // Reuse the original promise so one logical request cannot create two child
    // runs. The turn is part of the key deliberately: restarting the parent
    // creates a new, visible attempt instead of reviving an interrupted run.
    const idempotencyKey = multiAgentRequestKey(request.threadId, request.turnId, request.requestId)
    const existing = this.requestsByIdempotencyKey.get(idempotencyKey)
    if (existing) return existing.promise

    const execution = this.executeToolCall({
      ...request,
      threadId: request.threadId,
      turnId: request.turnId
    }, input)
    const cachedRequest: CachedMultiAgentRequest = { promise: execution, settled: false }
    this.requestsByIdempotencyKey.set(idempotencyKey, cachedRequest)
    // Keep both successful and failed outcomes in the bounded settled cache.
    // In-flight entries are never capacity-evicted, preserving exactly-once
    // execution even when more than the settled cache limit run concurrently.
    void execution.then(
      () => this.settleCachedRequest(idempotencyKey, cachedRequest),
      () => this.settleCachedRequest(idempotencyKey, cachedRequest)
    )
    return execution
  }

  private async executeToolCall(
    request: RuntimeToolCallRequest & { threadId: string; turnId: string },
    input: DelegatedTaskBatch
  ): Promise<RuntimeToolCallResponse> {

    const active = { controller: new AbortController(), threadId: request.threadId, turnId: request.turnId }
    this.activeRequests.add(active)
    try {
      const batch = input.tasks.length > 1
      const outcomes = await Promise.all(input.tasks.map(async (task, index): Promise<DelegatedTaskOutcome> => {
        try {
          const record = await this.runtime.runChild({
            parentThreadId: request.threadId,
            parentTurnId: request.turnId,
            requestId: batch ? `batch\u0000${String(request.requestId)}\u0000${index}` : String(request.requestId),
            label: task.label,
            prompt: task.prompt,
            workspace: task.workspace,
            model: task.model,
            signal: active.controller.signal
          })
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

  private settleCachedRequest(key: string, cachedRequest: CachedMultiAgentRequest): void {
    if (this.requestsByIdempotencyKey.get(key) !== cachedRequest) return
    cachedRequest.settled = true
    this.trimSettledRequestCache()
  }

  private trimSettledRequestCache(): void {
    const maxSettledEntries = 256
    const settledKeys = [...this.requestsByIdempotencyKey.entries()]
      .filter(([, request]) => request.settled)
      .map(([key]) => key)
    for (let index = 0; index < settledKeys.length - maxSettledEntries; index += 1) {
      this.requestsByIdempotencyKey.delete(settledKeys[index])
    }
  }

  abortRequestsForTurn(threadId: string, turnId: string): number {
    let aborted = 0
    for (const request of this.activeRequests) {
      if (request.threadId !== threadId || request.turnId !== turnId) continue
      if (request.controller.signal.aborted) continue
      request.controller.abort(new Error('multi-agent request aborted by parent turn interrupt'))
      aborted += 1
    }
    return aborted
  }

  async child(parentThreadId: string, childId: string): Promise<MultiAgentChildRunRecord | null> {
    return this.runtime.child(parentThreadId, childId)
  }
}

function multiAgentRequestKey(threadId: string, turnId: string, requestId: string | number): string {
  return `${threadId}\u0000${turnId}\u0000${String(requestId)}`
}

export function codexChildFromMultiAgentRecord(
  record: MultiAgentChildRunRecord,
  event?: MultiAgentChildEvent
): AgentRuntimeChild {
  const usage = agentUsageFromMultiAgentUsage(record.usage)
  return {
    id: record.id,
    runtimeId: 'codex',
    parentThreadId: record.parentThreadId,
    parentTurnId: record.parentTurnId,
    kind: 'agent',
    status: record.status,
    ...(record.label ? { label: record.label, name: record.label } : {}),
    prompt: record.prompt,
    ...(record.summary ? { summary: record.summary } : {}),
    ...(usage ? { usage } : {}),
    transcriptRef: {
      runtimeId: 'codex',
      childId: record.id,
      transcriptId: record.threadRef?.threadId ?? record.id,
      source: 'codex-multi-agent',
      kind: record.threadRef?.threadId ? 'runtime' : 'remote'
    },
    ...(record.threadRef?.threadId
      ? {
          openAsThreadRef: {
            runtimeId: 'codex',
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
      source: 'codex.multi_agent_v1.spawn_agent',
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
    ? summaryText || 'Child agent completed without textual output.'
    : errorText && summaryText && errorText !== summaryText
      ? `${errorText}\n\nProgress summary:\n${summaryText}`
      : errorText || summaryText || 'Child agent failed.'
  return {
    success: ok,
    contentItems: [{
      type: 'inputText',
      text
    }]
  }
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
  return {
    prompt,
    ...(label ? { label } : {}),
    ...(workspace ? { workspace } : {}),
    ...(model ? { model } : {})
  }
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
