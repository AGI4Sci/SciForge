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
  CodexAppServerDynamicToolCallRequest,
  CodexAppServerDynamicToolCallResponse,
  CodexAppServerDynamicToolSpec
} from './codex-dynamic-mcp-tools'

export const CODEX_MULTI_AGENT_NAMESPACE = 'multi_agent_v1'
export const CODEX_MULTI_AGENT_SPAWN_TOOL = 'spawn_agent'
export const CODEX_MULTI_AGENT_FLAT_TOOL_NAME = 'delegate_task'

export type CodexMultiAgentToolBridgeOptions = {
  enabled?: boolean
  maxParallel?: number
  maxChildren?: number
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
  promise: Promise<CodexAppServerDynamicToolCallResponse>
  settled: boolean
}

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
        maxChildren: options.maxChildren ?? 4
      },
      store: options.store ?? (options.storeRoot
        ? new FileMultiAgentStore(options.storeRoot)
        : new InMemoryMultiAgentStore()),
      executor: options.executor,
      events: options.onChildEvent ? { onChildEvent: options.onChildEvent } : undefined
    })
  }

  dynamicTools(): CodexAppServerDynamicToolSpec[] {
    if (this.options.enabled === false) return []
    return [{
      type: 'function',
      name: CODEX_MULTI_AGENT_FLAT_TOOL_NAME,
      description: 'Send a query to a bounded child agent and return the child agent output.',
      inputSchema: {
        type: 'object',
        properties: {
          prompt: { type: 'string', description: 'The child agent task prompt.' },
          task: { type: 'string', description: 'Alias for prompt.' },
          instructions: { type: 'string', description: 'Alias for prompt.' },
          label: { type: 'string', description: 'Short label for the child agent.' },
          name: { type: 'string', description: 'Alias for label.' },
          workspace: { type: 'string', description: 'Workspace root for the child task.' },
          cwd: { type: 'string', description: 'Alias for workspace.' }
        },
        additionalProperties: false
      }
    }]
  }

  canHandle(request: CodexAppServerDynamicToolCallRequest): boolean {
    const name = normalizedToolName(request)
    return name === CODEX_MULTI_AGENT_FLAT_TOOL_NAME ||
      name === `${CODEX_MULTI_AGENT_NAMESPACE}.${CODEX_MULTI_AGENT_SPAWN_TOOL}` ||
      name === 'multi_agent_v1_spawn_agent'
  }

  async callTool(
    request: CodexAppServerDynamicToolCallRequest
  ): Promise<CodexAppServerDynamicToolCallResponse> {
    if (!this.canHandle(request)) {
      return failedMultiAgentResponse(`Unsupported multi-agent tool: ${displayToolName(request)}.`)
    }
    const input = parseSpawnAgentArguments(request.arguments)
    if (!input.prompt) return failedMultiAgentResponse('delegate_task requires a prompt, task, or instructions string.')
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
    request: CodexAppServerDynamicToolCallRequest & { threadId: string; turnId: string },
    input: ReturnType<typeof parseSpawnAgentArguments>
  ): Promise<CodexAppServerDynamicToolCallResponse> {

    const active = { controller: new AbortController(), threadId: request.threadId, turnId: request.turnId }
    this.activeRequests.add(active)
    try {
      const record = await this.runtime.runChild({
        parentThreadId: request.threadId,
        parentTurnId: request.turnId,
        requestId: String(request.requestId),
        label: input.label,
        prompt: input.prompt,
        workspace: input.workspace,
        model: input.model,
        signal: active.controller.signal
      })
      return responseFromChildRecord(record)
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

function responseFromChildRecord(record: MultiAgentChildRunRecord): CodexAppServerDynamicToolCallResponse {
  const ok = record.status !== 'failed' && record.status !== 'aborted'
  const text = ok
    ? record.summary?.trim() || 'Child agent completed without textual output.'
    : record.error?.message || record.summary?.trim() || 'Child agent failed.'
  return {
    success: ok,
    contentItems: [{
      type: 'inputText',
      text
    }]
  }
}

function parseSpawnAgentArguments(value: unknown): {
  prompt: string
  label?: string
  workspace?: string
  model?: string
} {
  const args = recordArguments(value)
  const prompt = firstString(args.prompt, args.task, args.instructions, args.input, args.message)
  const label = firstString(args.label, args.name, args.agentName, args.agent)
  const workspace = firstString(args.workspace, args.cwd, args.workspaceRoot)
  const model = firstString(args.model)
  return {
    prompt,
    ...(label ? { label } : {}),
    ...(workspace ? { workspace } : {}),
    ...(model ? { model } : {})
  }
}

function normalizedToolName(request: CodexAppServerDynamicToolCallRequest): string {
  if (request.namespace) return `${request.namespace}.${request.tool}`.trim()
  return request.tool.trim()
}

function displayToolName(request: CodexAppServerDynamicToolCallRequest): string {
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

function agentUsageFromMultiAgentUsage(usage: MultiAgentUsage = EMPTY_MULTI_AGENT_USAGE): AgentRuntimeChild['usage'] | undefined {
  const normalized = {
    ...(usage.promptTokens ? { inputTokens: usage.promptTokens } : {}),
    ...(usage.completionTokens ? { outputTokens: usage.completionTokens } : {}),
    ...(usage.totalTokens ? { totalTokens: usage.totalTokens } : {}),
    ...(usage.cachedTokens ? { cacheReadTokens: usage.cachedTokens } : {})
  }
  return Object.keys(normalized).length ? normalized : undefined
}

function failedMultiAgentResponse(message: string): CodexAppServerDynamicToolCallResponse {
  return {
    success: false,
    contentItems: [{ type: 'inputText', text: message }]
  }
}
