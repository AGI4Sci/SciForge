import {
  resolveLocalRuntimeSettings,
  type AppSettingsV1
} from '../../shared/app-settings'
import type {
  AgentRuntimeAuxiliaryInput,
  AgentRuntimeCapabilities,
  AgentRuntimeChild,
  AgentRuntimeChildStatus,
  AgentRuntimeChildTranscriptEntry,
  AgentRuntimeEvent,
  AgentRuntimeItem,
  AgentRuntimeModality,
  AgentRuntimeThread,
  AgentRuntimeThreadGoal,
  AgentRuntimeThreadDetail,
  AgentRuntimeTodoItem,
  AgentRuntimeTodoList,
  AgentRuntimeTodoSource,
  AgentRuntimeTodoStatus,
  AgentRuntimeToolKind,
  AgentRuntimeTurn,
  AgentRuntimeTurnHandle,
  AgentRuntimeUsageQuery,
  AgentRuntimeUsageResponse,
  ReasoningVisibility
} from '../../shared/agent-runtime-contract'
import {
  createAgentRuntimeCapabilityMatrix,
  createDefaultAgentRuntimeCapabilities,
  filterAgentRuntimeThreadChildren
} from '../../shared/agent-runtime-contract'
import {
  configuredComputerUseCapability
} from '../computer-use-mcp-config'
import {
  LOCAL_RUNTIME_ATTACHMENTS_PATH,
  LOCAL_RUNTIME_HEALTH_PATH,
  LOCAL_RUNTIME_MEMORY_PATH,
  LOCAL_RUNTIME_INFO_PATH,
  LOCAL_RUNTIME_TOOLS_PATH,
  LOCAL_RUNTIME_SKILLS_PATH,
  isLocalRuntimeThreadMode,
  localRuntimeAttachmentContentPath,
  localRuntimeApprovalPath,
  localRuntimeMemoryRecordPath,
  localRuntimeSessionResumePath,
  localRuntimeThreadChildTranscriptPath,
  localRuntimeThreadCompactPath,
  localRuntimeThreadChildrenPath,
  localRuntimeThreadForkPath,
  localRuntimeThreadGoalPath,
  localRuntimeThreadInterruptPath,
  localRuntimeThreadPath,
  localRuntimeThreadReviewPath,
  localRuntimeThreadSteerPath,
  localRuntimeThreadTodosPath,
  localRuntimeThreadTurnsPath,
  localRuntimeUserInputPath,
  normalizeThreadMode
} from '../../shared/local-runtime-endpoints'
import type {
  AgentRuntimeAdapter,
  AgentRuntimeAdapterContext
} from './agent-runtime/adapter'

export type LocalRuntimeAgentRuntimeHttpInit = {
  method?: string
  body?: string
  headers?: Record<string, string>
}

export type LocalRuntimeAgentRuntimeHttpResult = {
  ok: boolean
  status: number
  body: string
}

export type LocalRuntimeAgentRuntimeHttpRequest = (
  settings: AppSettingsV1,
  pathAndQuery: string,
  init: LocalRuntimeAgentRuntimeHttpInit
) => Promise<LocalRuntimeAgentRuntimeHttpResult>

export type LocalRuntimeAgentRuntimeEvents = (
  settings: AppSettingsV1,
  threadId: string,
  sinceSeq: number,
  signal: AbortSignal
) => AsyncIterable<unknown>

export type LocalRuntimeAgentRuntimeAdapterOptions = {
  request: LocalRuntimeAgentRuntimeHttpRequest
  events?: LocalRuntimeAgentRuntimeEvents
}

const SCIFORGE_RUNTIME_ID = 'sciforge' as const

export function createLocalRuntimeAgentRuntimeAdapter(options: LocalRuntimeAgentRuntimeAdapterOptions): AgentRuntimeAdapter {
  return {
    id: SCIFORGE_RUNTIME_ID,
    transport: 'http_sse',

    async connect(context) {
      await requestJson(options, context, LOCAL_RUNTIME_HEALTH_PATH, { method: 'GET' })
    },

    async capabilities(context) {
      const response = await options.request(context.settings, LOCAL_RUNTIME_INFO_PATH, { method: 'GET' })
      if (!response.ok) return conservativeLocalRuntimeCapabilities()
      return mapLocalRuntimeCapabilities(readJson(response.body), true)
    },

    async listThreads(context, input) {
      const payload = await requestJson(options, context, `/v1/threads${threadListQuery(input)}`, { method: 'GET' })
      return arrayValue(asRecord(payload)?.threads)
        .map((thread) => mapLocalRuntimeThread(thread))
        .filter((thread) => thread.id)
    },

    async startThread(context, input) {
      const runtime = resolveLocalRuntimeSettings(context.settings)
      const payload = await requestJson(options, context, '/v1/threads', {
        method: 'POST',
        body: JSON.stringify({
          workspace: input.workspace || context.settings.workspaceRoot || '~',
          title: input.title,
          model: resolveLocalRuntimeRequestModel(runtime.model, input.model),
          mode: normalizeThreadMode(input.mode),
          approvalPolicy: runtime.approvalPolicy,
          sandboxMode: runtime.sandboxMode
        })
      })
      return mapLocalRuntimeThread(firstRecord(payload, 'thread'))
    },

    async readThread(context, input) {
      const payload = await requestJson(options, context, localRuntimeThreadPath(input.threadId), { method: 'GET' })
      return mapLocalRuntimeThreadDetail(payload)
    },

    async startTurn(context, input) {
      const runtime = resolveLocalRuntimeSettings(context.settings)
      const body: Record<string, unknown> = {
        prompt: input.text,
        model: resolveLocalRuntimeRequestModel(runtime.model, input.model)
      }
      if (input.reasoningEffort?.trim()) body.reasoningEffort = input.reasoningEffort.trim()
      if (input.displayText?.trim() && input.displayText.trim() !== input.text.trim()) {
        body.displayText = input.displayText.trim()
      }
      if (isLocalRuntimeThreadMode(input.mode)) body.mode = input.mode
      body.approvalPolicy = runtime.approvalPolicy
      body.sandboxMode = runtime.sandboxMode
      if (input.guiPlan) body.guiPlan = input.guiPlan
      if (input.remoteTargetId?.trim()) body.remoteTargetId = input.remoteTargetId.trim()
      if (input.metadata) body.metadata = input.metadata
      if (input.attachmentIds?.length) body.attachmentIds = input.attachmentIds
      const modelObjectReferences = input.fileReferences
        ?.filter((reference) => reference.modelRouterObject === true && reference.relativePath.trim())
        .map((reference) => ({
          path: reference.relativePath.trim() || reference.path,
          name: reference.name,
          ...(reference.mimeType ? { mimeType: reference.mimeType } : {}),
          modelRouterObject: true
        }))
      if (modelObjectReferences?.length) body.attachments = modelObjectReferences
      const payload = await requestJson(options, context, localRuntimeThreadTurnsPath(input.threadId), {
        method: 'POST',
        body: JSON.stringify(body)
      })
      return mapTurnHandle(payload, input.threadId)
    },

    async interruptTurn(context, input) {
      await requestJson(options, context, localRuntimeThreadInterruptPath(input.threadId, input.turnId), {
        method: 'POST',
        body: JSON.stringify({ discard: input.discard === true })
      })
    },

    async steerTurn(context, input) {
      await requestJson(options, context, localRuntimeThreadSteerPath(input.threadId, input.turnId), {
        method: 'POST',
        body: JSON.stringify({ text: input.text })
      })
    },

    async renameThread(context, input) {
      await requestJson(options, context, localRuntimeThreadPath(input.threadId), {
        method: 'PATCH',
        body: JSON.stringify({ title: input.title })
      })
    },

    async deleteThread(context, input) {
      await requestJson(options, context, localRuntimeThreadPath(input.threadId), { method: 'DELETE' })
    },

    async *subscribeEvents(context, input) {
      if (!options.events) return
      const signal = input.signal ?? new AbortController().signal
      for await (const event of options.events(context.settings, input.threadId, input.sinceSeq ?? 0, signal)) {
        const mapped = mapLocalRuntimeEvent(event, input.threadId)
        if (mapped) yield mapped
      }
    },

    async resolveApproval(context, input) {
      await requestJson(options, context, localRuntimeApprovalPath(input.approvalId), {
        method: 'POST',
        body: JSON.stringify({ decision: input.decision === 'allowed' ? 'allow' : 'deny' })
      })
    },

    async resolveUserInput(context, input) {
      await requestJson(options, context, localRuntimeUserInputPath(input.requestId), {
        method: 'POST',
        body: JSON.stringify({ answers: input.answers })
      })
    },

    async compactThread(context, input) {
      await requestJson(options, context, localRuntimeThreadCompactPath(input.threadId), {
        method: 'POST',
        body: JSON.stringify({ reason: input.reason?.trim() || undefined })
      })
    },

    async forkThread(context, input) {
      const body: Record<string, unknown> = {}
      if (input.relation) body.relation = input.relation
      if (input.title) body.title = input.title
      const payload = await requestJson(options, context, localRuntimeThreadForkPath(input.threadId), {
        method: 'POST',
        ...(Object.keys(body).length > 0 ? { body: JSON.stringify(body) } : {})
      })
      return mapLocalRuntimeThread(payload)
    },

    async resumeSession(context, input) {
      const runtime = resolveLocalRuntimeSettings(context.settings)
      const payload = await requestJson(options, context, localRuntimeSessionResumePath(input.sessionId), {
        method: 'POST',
        body: JSON.stringify({
          workspace: context.settings.workspaceRoot || undefined,
          model: resolveLocalRuntimeRequestModel(runtime.model, input.model),
          mode: isLocalRuntimeThreadMode(input.mode) ? input.mode : undefined
        })
      })
      const record = asRecord(payload) ?? {}
      return {
        threadId: stringValue(record.threadId) || stringValue(record.thread_id),
        sessionId: stringValue(record.sessionId) || stringValue(record.session_id) || input.sessionId
      }
    },

    async updateThreadRelation(context, input) {
      await requestJson(options, context, localRuntimeThreadPath(input.threadId), {
        method: 'PATCH',
        body: JSON.stringify({ relation: input.relation })
      })
    },

    async usage(context, input) {
      const payload = await requestJson(options, context, localRuntimeUsagePath(input), { method: 'GET' })
      const response = mapUsageResponse(payload, input)
      if (input.groupBy === 'thread' && input.threadId) {
        await hydrateThreadCacheStats(options, context, input.threadId, response)
      }
      return response
    },

    async auxiliary(context, input) {
      return localRuntimeAuxiliary(options, context, input)
    }
  }
}

function resolveLocalRuntimeRequestModel(resolvedRuntimeModel: string, inputModel: string | undefined): string {
  const requestedModel = inputModel?.trim()
  return requestedModel && requestedModel.toLowerCase() !== 'auto'
    ? requestedModel
    : resolvedRuntimeModel
}

async function localRuntimeAuxiliary(
  options: LocalRuntimeAgentRuntimeAdapterOptions,
  context: AgentRuntimeAdapterContext,
  input: AgentRuntimeAuxiliaryInput
): Promise<unknown> {
  const payload = asRecord(input.payload) ?? {}
  switch (input.operation) {
    case 'reviewThread': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      const target = payload.target
      if (target === undefined) throw missingPayload(input.operation, 'target')
      const body: Record<string, unknown> = { target }
      const model = optionalString(payload.model)
      if (model) body.model = model
      return requestJson(options, context, localRuntimeThreadReviewPath(threadId), {
        method: 'POST',
        body: JSON.stringify(body)
      })
    }
    case 'getRuntimeInfo':
      return requestJson(options, context, LOCAL_RUNTIME_INFO_PATH, { method: 'GET' })
    case 'getToolDiagnostics':
      return requestJson(options, context, LOCAL_RUNTIME_TOOLS_PATH, { method: 'GET' })
    case 'listSkills': {
      const result = await requestJson(options, context, LOCAL_RUNTIME_SKILLS_PATH, { method: 'GET' })
      return arrayValue(asRecord(result)?.skills)
    }
    case 'uploadAttachment': {
      const result = await requestJson(options, context, LOCAL_RUNTIME_ATTACHMENTS_PATH, {
        method: 'POST',
        body: JSON.stringify(payload)
      })
      return firstRecord(result, 'attachment')
    }
    case 'getAttachmentContent': {
      const attachmentId = requiredString(payload, 'attachmentId', input.operation)
      const optionsPayload = asRecord(payload.options) ?? {}
      return requestJson(
        options,
        context,
        `${localRuntimeAttachmentContentPath(attachmentId)}${queryString({
          thread_id: optionalString(optionsPayload.threadId),
          workspace: optionalString(optionsPayload.workspace)
        })}`,
        { method: 'GET' }
      )
    }
    case 'listMemories': {
      const optionsPayload = asRecord(payload.options) ?? payload
      let result: unknown
      try {
        result = await requestJson(
          options,
          context,
          `${LOCAL_RUNTIME_MEMORY_PATH}${queryString({
            workspace: optionalString(optionsPayload.workspace),
            include_deleted: booleanOrUndefined(optionsPayload.includeDeleted)
          })}`,
          { method: 'GET' }
        )
      } catch (error) {
        if (isLocalRuntimeCapabilityUnavailableError(error, 'memory store is unavailable')) return []
        throw error
      }
      return arrayValue(asRecord(result)?.memories)
    }
    case 'updateMemory': {
      const memoryId = requiredString(payload, 'memoryId', input.operation)
      const patch = asRecord(payload.patch) ?? {}
      const result = await requestJson(options, context, localRuntimeMemoryRecordPath(memoryId), {
        method: 'PATCH',
        body: JSON.stringify(patch)
      })
      return firstRecord(result, 'memory')
    }
    case 'deleteMemory': {
      const memoryId = requiredString(payload, 'memoryId', input.operation)
      const result = await requestJson(options, context, localRuntimeMemoryRecordPath(memoryId), { method: 'DELETE' })
      return firstRecord(result, 'memory')
    }
    case 'updateThreadWorkspace': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      await requestJson(options, context, localRuntimeThreadPath(threadId), {
        method: 'PATCH',
        body: JSON.stringify({ workspace: requiredString(payload, 'workspace', input.operation) })
      })
      return undefined
    }
    case 'archiveThread': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      await requestJson(options, context, localRuntimeThreadPath(threadId), {
        method: 'PATCH',
        body: JSON.stringify({ status: payload.archived === true ? 'archived' : 'idle' })
      })
      return undefined
    }
    case 'getThreadGoal': {
      const result = await requestJson(
        options,
        context,
        localRuntimeThreadGoalPath(requiredString(payload, 'threadId', input.operation)),
        { method: 'GET' }
      )
      return asRecord(result)?.goal ?? null
    }
    case 'setThreadGoal': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      const patch = asRecord(payload.patch) ?? {}
      const result = await requestJson(options, context, localRuntimeThreadGoalPath(threadId), {
        method: 'POST',
        body: JSON.stringify(patch)
      })
      return asRecord(result)?.goal ?? null
    }
    case 'clearThreadGoal': {
      const result = await requestJson(
        options,
        context,
        localRuntimeThreadGoalPath(requiredString(payload, 'threadId', input.operation)),
        { method: 'DELETE' }
      )
      return asRecord(result)?.cleared === true
    }
    case 'getThreadTodos': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      const result = await requestJson(
        options,
        context,
        localRuntimeThreadTodosPath(threadId),
        { method: 'GET' }
      )
      return mapLocalRuntimeTodoList(asRecord(result)?.todos, threadId)
    }
    case 'setThreadTodos': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      const result = await requestJson(options, context, localRuntimeThreadTodosPath(threadId), {
        method: 'POST',
        body: JSON.stringify({ todos: arrayValue(payload.todos) })
      })
      return mapLocalRuntimeTodoList(asRecord(result)?.todos, threadId)
    }
    case 'clearThreadTodos': {
      const result = await requestJson(
        options,
        context,
        localRuntimeThreadTodosPath(requiredString(payload, 'threadId', input.operation)),
        { method: 'DELETE' }
      )
      return asRecord(result)?.cleared === true
    }
    case 'cancelUserInput':
      await requestJson(options, context, localRuntimeUserInputPath(requiredString(payload, 'requestId', input.operation)), {
        method: 'POST',
        body: JSON.stringify({ cancelled: true })
      })
      return undefined
    case 'listThreadChildren': {
      const threadId = requiredString(payload, 'threadId', input.operation)
      const turnId = optionalString(payload.turnId) ?? optionalString(payload.parentTurnId)
      const activeOnly = booleanOrUndefined(payload.activeOnly)
      let result: unknown
      try {
        result = await requestJson(
          options,
          context,
          `${localRuntimeThreadChildrenPath(threadId)}${queryString({
            turn_id: turnId,
            active_only: activeOnly,
            cursor: optionalString(payload.cursor),
            limit: optionalPositiveIntegerString(payload.limit)
          })}`,
          { method: 'GET' }
        )
      } catch (error) {
        if (!isLocalRuntimeNotFoundError(error)) throw error
        return {
          runtimeId: SCIFORGE_RUNTIME_ID,
          threadId,
          ...(turnId ? { parentTurnId: turnId } : {}),
          children: [],
          degraded: true,
          reason: 'Child run endpoint is unavailable.'
        }
      }
      const record = asRecord(result) ?? {}
      const rawChildren = arrayValue(record.children).length
        ? arrayValue(record.children)
        : arrayValue(record.childRuns)
      const children = filterAgentRuntimeThreadChildren(
        rawChildren
          .map((child) => mapLocalRuntimeChildRun(child, threadId))
          .filter((child): child is AgentRuntimeChild => child != null),
        {
          runtimeId: SCIFORGE_RUNTIME_ID,
          parentThreadId: threadId,
          ...(turnId ? { parentTurnId: turnId } : {}),
          ...(activeOnly !== undefined ? { activeOnly } : {})
        }
      )
      const metadata = asRecord(record.metadata)
      return {
        runtimeId: SCIFORGE_RUNTIME_ID,
        threadId,
        ...(turnId ? { parentTurnId: turnId } : {}),
        children,
        ...(optionalString(record.nextCursor) ? { nextCursor: optionalString(record.nextCursor) } : {}),
        ...(record.degraded === true ? { degraded: true } : {}),
        ...(optionalString(record.reason) ? { reason: optionalString(record.reason) } : {}),
        ...(metadata ? { metadata } : {})
      }
    }
    case 'readChildTranscript': {
      const threadId = optionalString(payload.threadId) ??
        optionalString(payload.parentThreadId) ??
        requiredString(payload, 'threadId', input.operation)
      const parentTurnId = optionalString(payload.parentTurnId) ?? optionalString(payload.turnId)
      const childId = requiredString(payload, 'childId', input.operation)
      let result: unknown
      try {
        result = await requestJson(
          options,
          context,
          `${localRuntimeThreadChildTranscriptPath(threadId, childId)}${queryString({
            cursor: optionalString(payload.cursor),
            limit: optionalPositiveIntegerString(payload.limit)
          })}`,
          { method: 'GET' }
        )
      } catch (error) {
        if (!isLocalRuntimeNotFoundError(error)) throw error
        return degradedLocalRuntimeChildTranscript({
          threadId,
          parentTurnId,
          childId,
          reason: 'Child transcript endpoint is unavailable.'
        })
      }
      const transcriptRecord = asRecord(asRecord(result)?.transcript) ?? {}
      const child = mapLocalRuntimeChildRun(transcriptRecord.child, threadId)
      const transcriptFormat = mapLocalRuntimeTranscriptFormat(transcriptRecord.format)
      return {
        transcript: {
          runtimeId: SCIFORGE_RUNTIME_ID,
          threadId: optionalString(transcriptRecord.threadId) ?? threadId,
          parentThreadId: threadId,
          ...(optionalString(transcriptRecord.parentTurnId) ?? parentTurnId
            ? { parentTurnId: optionalString(transcriptRecord.parentTurnId) ?? parentTurnId }
            : {}),
          childId,
          ...(child ? { child } : {}),
          transcriptRef: mapLocalRuntimeTranscriptRef(
            asRecord(transcriptRecord.transcriptRef) ?? undefined,
            childId,
            child?.label ?? child?.name
          ),
          ...(transcriptFormat ? { format: transcriptFormat } : {}),
          entries: arrayValue(transcriptRecord.entries)
            .map(mapLocalRuntimeTranscriptEntry)
            .filter((entry): entry is NonNullable<ReturnType<typeof mapLocalRuntimeTranscriptEntry>> => entry != null),
          summary: optionalString(transcriptRecord.summary) ?? child?.summary,
          usage: mapUsage(transcriptRecord.usage) ?? child?.usage,
          ...(transcriptRecord.degraded === true ? { degraded: true } : {}),
          ...(optionalString(transcriptRecord.reason) ? { reason: optionalString(transcriptRecord.reason) } : {}),
          ...(asRecord(transcriptRecord.metadata) ? { metadata: asRecord(transcriptRecord.metadata) } : {})
        }
      }
    }
    default:
      throw new Error(`Unsupported runtime auxiliary operation: ${input.operation}.`)
  }
}

async function requestJson(
  options: LocalRuntimeAgentRuntimeAdapterOptions,
  context: AgentRuntimeAdapterContext,
  pathAndQuery: string,
  init: LocalRuntimeAgentRuntimeHttpInit
): Promise<unknown> {
  const response = await options.request(context.settings, pathAndQuery, init)
  if (!response.ok) throw localRuntimeHttpError(response)
  return readJson(response.body)
}

function readJson(body: string): unknown {
  if (!body.trim()) return {}
  try {
    return JSON.parse(body) as unknown
  } catch {
    return {}
  }
}

function localRuntimeHttpError(response: LocalRuntimeAgentRuntimeHttpResult): Error {
  const body = asRecord(readJson(response.body))
  const message = stringValue(body?.message) || stringValue(body?.error) || `Local runtime HTTP request failed (${response.status}).`
  const error = new Error(message)
  error.name = stringValue(body?.code) || 'LocalRuntimeHttpError'
  return error
}

function isLocalRuntimeCapabilityUnavailableError(error: unknown, message: string): boolean {
  return error instanceof Error &&
    error.name === 'capability_unavailable' &&
    error.message.toLowerCase().includes(message.toLowerCase())
}

function missingPayload(operation: string, key: string): Error {
  return new Error(`Runtime auxiliary operation ${operation} requires payload.${key}.`)
}

function requiredString(payload: Record<string, unknown>, key: string, operation: string): string {
  const value = optionalString(payload[key])
  if (!value) throw missingPayload(operation, key)
  return value
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function optionalPositiveIntegerString(value: unknown): string | undefined {
  const number = numberValue(value)
  if (number === undefined || !Number.isInteger(number) || number <= 0) return undefined
  return String(number)
}

function queryString(params: Record<string, string | boolean | undefined>): string {
  const query = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') query.set(key, String(value))
  }
  const text = query.toString()
  return text ? `?${text}` : ''
}

function threadListQuery(input: {
  limit?: number
  search?: string
  includeArchived?: boolean
  archivedOnly?: boolean
  includeSide?: boolean
}): string {
  const query = new URLSearchParams()
  if (typeof input.limit === 'number') query.set('limit', String(input.limit))
  if (input.search?.trim()) query.set('search', input.search.trim())
  if (typeof input.includeArchived === 'boolean') query.set('include_archived', String(input.includeArchived))
  if (typeof input.archivedOnly === 'boolean') query.set('archived_only', String(input.archivedOnly))
  if (input.includeSide === true) query.set('include', 'side')
  const value = query.toString()
  return value ? `?${value}` : ''
}

function localRuntimeUsagePath(input: AgentRuntimeUsageQuery): string {
  const query = new URLSearchParams()
  query.set('group_by', input.groupBy)
  if (input.from?.trim()) query.set('from', input.from.trim())
  if (input.to?.trim()) query.set('to', input.to.trim())
  if (input.timezone?.trim()) query.set('timezone', input.timezone.trim())
  return `/v1/usage?${query.toString()}`
}

function mapLocalRuntimeThread(value: unknown): AgentRuntimeThread {
  const record = firstRecord(value, 'thread')
  const id = stringValue(record.id) || stringValue(record.threadId)
  const status = stringValue(record.status)
  const turns = arrayValue(record.turns)
  const latestTurn = asRecord(turns.at(-1)) ?? {}
  return {
    id,
    runtimeId: SCIFORGE_RUNTIME_ID,
    title: stringValue(record.title) || stringValue(record.name) || stringValue(record.preview) || 'Runtime thread',
    updatedAt: stringValue(record.updatedAt) || stringValue(record.updated_at) || new Date().toISOString(),
    createdAt: optionalString(record.createdAt) ?? optionalString(record.created_at),
    model: optionalString(record.model),
    mode: optionalString(record.mode),
    workspace: optionalString(record.workspace),
    status: status || undefined,
    archived: record.archived === true || status === 'archived',
    preview: optionalString(record.preview),
    latestTurnId: optionalString(record.latestTurnId) ?? optionalString(latestTurn.id),
    latestTurnStatus: optionalString(record.latestTurnStatus) ?? optionalString(latestTurn.status),
    backendThreadId: id,
    relation: normalizeThreadRelation(record.relation),
    parentThreadId: optionalString(record.parentThreadId) ?? optionalString(record.parent_thread_id),
    forkedFromThreadId: optionalString(record.forkedFromThreadId) ?? optionalString(record.forked_from_thread_id),
    forkedFromTitle: optionalString(record.forkedFromTitle) ?? optionalString(record.forked_from_title),
    forkedAt: optionalString(record.forkedAt) ?? optionalString(record.forked_at),
    forkedFromMessageCount: numberValue(record.forkedFromMessageCount) ?? numberValue(record.forked_from_message_count),
    forkedFromTurnCount: numberValue(record.forkedFromTurnCount) ?? numberValue(record.forked_from_turn_count),
    goal: mapLocalRuntimeGoal(record.goal, id),
    todos: mapLocalRuntimeTodoList(record.todos, id)
  }
}

function mapLocalRuntimeGoal(value: unknown, threadId: string): AgentRuntimeThreadGoal | null {
  const record = asRecord(value)
  if (!record) return null
  const objective = stringValue(record.objective)
  const status = mapLocalRuntimeGoalStatus(stringValue(record.status))
  const createdAt = optionalString(record.createdAt) ?? optionalString(record.created_at) ?? new Date().toISOString()
  const updatedAt = optionalString(record.updatedAt) ?? optionalString(record.updated_at) ?? createdAt
  const tokenBudget = numberValue(record.tokenBudget) ?? numberValue(record.token_budget)
  if (!objective || !status) return null
  return {
    runtimeId: SCIFORGE_RUNTIME_ID,
    threadId,
    objective,
    status,
    ...(tokenBudget !== undefined ? { tokenBudget } : {}),
    tokensUsed: numberValue(record.tokensUsed) ?? numberValue(record.tokens_used) ?? 0,
    timeUsedSeconds: numberValue(record.timeUsedSeconds) ?? numberValue(record.time_used_seconds) ?? 0,
    createdAt,
    updatedAt
  }
}

function mapLocalRuntimeThreadDetail(value: unknown): AgentRuntimeThreadDetail {
  const record = firstRecord(value, 'thread')
  const thread = mapLocalRuntimeThread(record)
  const turns = arrayValue(record.turns)
    .map((turn) => mapLocalRuntimeTurn(turn, thread.id))
    .filter((turn) => turn.id)
  const items = turns.flatMap((turn) => turn.items ?? [])
  return {
    ...thread,
    latestSeq: numberValue(record.latestSeq) ?? numberValue(record.latest_seq) ?? items.length,
    turns,
    items,
    usage: mapUsage(record.usage)
  }
}

function mapLocalRuntimeTurn(value: unknown, threadId: string): AgentRuntimeTurn {
  const record = asRecord(value) ?? {}
  const id = stringValue(record.id) || stringValue(record.turnId)
  const startedAt = optionalString(record.startedAt) ?? optionalString(record.createdAt)
  const completedAt = optionalString(record.completedAt) ?? optionalString(record.finishedAt)
  const items = arrayValue(record.items)
    .map((item) => mapLocalRuntimeItem(item))
    .filter(Boolean) as AgentRuntimeItem[]
  return {
    id,
    threadId: stringValue(record.threadId) || threadId,
    status: normalizeTurnStatus(record.status),
    startedAt,
    completedAt,
    durationMs: numberValue(record.durationMs),
    items
  }
}

function mapLocalRuntimeItem(value: unknown): AgentRuntimeItem | null {
  const record = asRecord(value)
  if (!record) return null
  const kind = stringValue(record.kind)
  const base = {
    id: stringValue(record.id) || `${kind || 'item'}-${Date.now()}`,
    status: normalizeItemStatus(record.status),
    createdAt: optionalString(record.createdAt)
  }
  if (kind === 'user_message') {
    return { ...base, kind: 'user_message', text: stringValue(record.displayText) || stringValue(record.text) }
  }
  if (kind === 'assistant_text') {
    return { ...base, kind: 'assistant_message', text: stringValue(record.text) }
  }
  if (kind === 'assistant_reasoning') {
    return { ...base, kind: 'reasoning', text: stringValue(record.text) }
  }
  if (kind === 'tool_call') {
    const toolName = stringValue(record.toolName)
    const itemId = localRuntimeToolItemId(record, base.id)
    return {
      ...base,
      id: itemId,
      kind: 'tool',
      toolKind: normalizeToolKind(record.toolKind),
      summary: stringValue(record.summary) || toolName || 'Tool call',
      detail: stringifyDetail(record.arguments),
      meta: localRuntimeToolMeta(record, base.id, toolName)
    }
  }
  if (kind === 'tool_result') {
    const toolName = stringValue(record.toolName)
    const itemId = localRuntimeToolItemId(record, base.id)
    return {
      ...base,
      id: itemId,
      kind: 'tool',
      status: record.isError === true ? 'error' : normalizeItemStatus(record.status) ?? 'success',
      toolKind: normalizeToolKind(record.toolKind),
      summary: stringValue(record.summary) || toolName || 'Tool result',
      detail: stringifyDetail(record.output),
      meta: localRuntimeToolMeta(record, base.id, toolName)
    }
  }
  if (kind === 'approval') {
    return {
      ...base,
      kind: 'approval',
      summary: stringValue(record.summary) || stringValue(record.toolName),
      meta: {
        approvalId: stringValue(record.approvalId),
        toolName: stringValue(record.toolName)
      }
    }
  }
  if (kind === 'user_input') {
    return {
      ...base,
      kind: 'user_input',
      text: stringValue(record.prompt),
      meta: { requestId: stringValue(record.inputId), questions: record.questions }
    }
  }
  if (kind === 'compaction') {
    return {
      ...base,
      kind: 'compaction',
      summary: stringValue(record.summary),
      meta: { replacedTokens: numberValue(record.replacedTokens) }
    }
  }
  if (kind === 'review') {
    return {
      ...base,
      kind: 'review',
      summary: stringValue(record.title),
      text: stringValue(record.reviewText),
      meta: { output: record.output }
    }
  }
  if (kind === 'error') {
    return {
      ...base,
      kind: 'system',
      status: 'error',
      text: stringValue(record.message),
      detail: stringifyDetail(record.details),
      meta: { code: stringValue(record.code), severity: stringValue(record.severity) }
    }
  }
  return {
    ...base,
    kind: 'system',
    text: stringValue(record.text) || stringValue(record.message),
    meta: { sourceKind: kind }
  }
}

function localRuntimeToolItemId(record: Record<string, unknown>, fallbackId: string): string {
  const callId = stringValue(record.callId)
  return callId ? `tool_${callId}` : fallbackId
}

function localRuntimeToolMeta(
  record: Record<string, unknown>,
  sourceItemId: string,
  toolName: string
): Record<string, unknown> {
  const callId = stringValue(record.callId)
  const plan = localRuntimePlanToolMeta(toolName, record.output)
  return {
    sourceItemId,
    ...(callId ? { callId } : {}),
    ...(toolName ? { toolName } : {}),
    ...(plan ? { plan } : {})
  }
}

function localRuntimePlanToolMeta(toolName: string, output: unknown): Record<string, unknown> | null {
  if (toolName !== 'create_plan') return null
  const record = asRecord(output)
  if (!record) return null
  const operation = stringValue(record.operation)
  if (
    !stringValue(record.plan_id) ||
    !stringValue(record.workspace_root) ||
    !stringValue(record.relative_path) ||
    (operation !== 'draft' && operation !== 'refine')
  ) {
    return null
  }
  return record
}

function mapTurnHandle(value: unknown, fallbackThreadId: string): AgentRuntimeTurnHandle {
  const record = firstRecord(value, 'turn')
  return {
    threadId: stringValue(record.threadId) || fallbackThreadId,
    turnId: stringValue(record.turnId) || stringValue(record.id),
    userMessageItemId: optionalString(record.userMessageItemId)
  }
}

function mapLocalRuntimeToolReadyEvent(
  record: Record<string, unknown>,
  common: {
    threadId: string
    seq?: number
    createdAt?: string
    turnId?: string
    sourceItemId?: string
  }
): AgentRuntimeEvent | null {
  const callId = stringValue(record.callId)
  const toolName = stringValue(record.toolName)
  if (!callId || !toolName) return null
  return {
    kind: 'tool_event',
    threadId: common.threadId,
    runtimeId: SCIFORGE_RUNTIME_ID,
    seq: common.seq,
    createdAt: common.createdAt,
    turnId: common.turnId,
    itemId: `tool_${callId}`,
    status: 'running',
    summary: toolName,
    toolKind: 'tool_call',
    meta: {
      ...(common.sourceItemId ? { sourceItemId: common.sourceItemId } : {}),
      callId,
      toolName,
      ...(typeof record.readyCount === 'number' ? { readyCount: record.readyCount } : {}),
      runtimeStatus: 'tool_call_ready'
    }
  }
}

function mapLocalRuntimeEvent(value: unknown, fallbackThreadId: string): AgentRuntimeEvent | null {
  const record = asRecord(value)
  if (!record) return null
  const threadId = stringValue(record.threadId) || fallbackThreadId
  const seq = numberValue(record.seq)
  const kind = stringValue(record.kind)
  const createdAt = optionalString(record.timestamp) ?? optionalString(record.createdAt)
  const turnId = optionalString(record.turnId)
  const itemId = stringValue(record.itemId)
  const child = mapLocalRuntimeChildEvent(record, threadId, turnId, createdAt)
  if (child) {
    const message = optionalString(record.message) ?? optionalString(record.text)
    return {
      kind: 'child_event',
      threadId,
      runtimeId: SCIFORGE_RUNTIME_ID,
      seq,
      createdAt,
      turnId,
      itemId: child.id,
      child,
      ...(message ? { message } : {})
    }
  }

  if (kind === 'thread_created' || kind === 'thread_updated') {
    return {
      kind: 'thread_lifecycle',
      threadId,
      runtimeId: SCIFORGE_RUNTIME_ID,
      seq,
      createdAt,
      state: kind === 'thread_created' ? 'created' : 'updated',
      thread: {
        id: threadId,
        runtimeId: SCIFORGE_RUNTIME_ID,
        title: stringValue(record.title) || 'Runtime thread',
        updatedAt: createdAt || new Date().toISOString(),
        status: optionalString(record.status),
        backendThreadId: threadId
      }
    }
  }

  if (
    kind === 'turn_started' ||
    kind === 'turn_completed' ||
    kind === 'turn_failed' ||
    kind === 'turn_aborted' ||
    kind === 'turn_steered'
  ) {
    return {
      kind: 'turn_lifecycle',
      threadId,
      runtimeId: SCIFORGE_RUNTIME_ID,
      seq,
      createdAt,
      turnId,
      state: mapLocalRuntimeTurnLifecycleState(kind),
      message: optionalString(record.message) ?? optionalString(record.text)
    }
  }

  if (kind === 'assistant_text_delta') {
    const item = asRecord(record.item)
    return {
      kind: 'assistant_delta',
      threadId,
      runtimeId: SCIFORGE_RUNTIME_ID,
      seq,
      createdAt,
      turnId,
      itemId: itemId || stringValue(item?.id) || `sciforge-delta-${seq ?? Date.now()}`,
      text: stringValue(record.text) || stringValue(record.delta) || stringValue(item?.text)
    }
  }
  if (kind === 'assistant_reasoning_delta') {
    const item = asRecord(record.item)
    return {
      kind: 'reasoning_delta',
      threadId,
      runtimeId: SCIFORGE_RUNTIME_ID,
      seq,
      createdAt,
      turnId,
      itemId: itemId || stringValue(item?.id) || `sciforge-reasoning-${seq ?? Date.now()}`,
      text: stringValue(record.text) ||
        stringValue(record.delta) ||
        stringValue(record.summary) ||
        stringValue(item?.text) ||
        stringValue(item?.delta) ||
        stringValue(item?.summary),
      visibility: reasoningVisibility(record.visibility) || reasoningVisibility(item?.visibility) || 'summary',
      source: 'model'
    }
  }

  if (kind === 'tool_call_ready') {
    return mapLocalRuntimeToolReadyEvent(record, {
      threadId,
      seq,
      createdAt,
      turnId,
      sourceItemId: itemId || optionalString(record.itemId)
    })
  }

  if (kind === 'compaction_started' || kind === 'compaction_completed') {
    const sourceItemIds = stringArrayValue(record.sourceItemIds)
    return {
      kind: 'compaction_event',
      threadId,
      runtimeId: SCIFORGE_RUNTIME_ID,
      seq,
      createdAt,
      turnId,
      itemId: itemId || optionalString(record.itemId),
      status: kind === 'compaction_started' ? 'running' : 'success',
      summary: stringValue(record.summary),
      detail: compactionEventDetail(record),
      auto: record.auto !== false,
      messagesBefore: sourceItemIds?.length,
      replacedTokens: numberValue(record.replacedTokens),
      sourceDigest: optionalString(record.sourceDigest),
      digestMarker: optionalString(record.digestMarker),
      sourceItemIds
    }
  }

  if (kind === 'user_input_requested') {
    const requestId = stringValue(record.requestId) || stringValue(record.inputId)
    return {
      kind: 'user_input_requested',
      threadId,
      runtimeId: SCIFORGE_RUNTIME_ID,
      seq,
      createdAt,
      turnId,
      itemId: itemId || optionalString(record.itemId),
      requestId,
      questions: localRuntimeInputQuestions(record.questions)
    }
  }

  if (kind === 'user_input_resolved') {
    const requestId = stringValue(record.requestId) || stringValue(record.inputId)
    return {
      kind: 'user_input_resolved',
      threadId,
      runtimeId: SCIFORGE_RUNTIME_ID,
      seq,
      createdAt,
      turnId,
      itemId: itemId || optionalString(record.itemId),
      requestId,
      status: localRuntimeUserInputStatus(record.status),
      answers: localRuntimeInputAnswers(record.answers),
      message: optionalString(record.message) ?? optionalString(record.error)
    }
  }

  if (kind === 'goal_updated' || kind === 'goal_cleared') {
    const goal = asRecord(record.goal)
    return {
      kind: 'goal_event',
      threadId,
      runtimeId: SCIFORGE_RUNTIME_ID,
      seq,
      createdAt,
      turnId,
      itemId: itemId || optionalString(record.itemId),
      objective: stringValue(goal?.objective),
      status: mapLocalRuntimeGoalStatus(stringValue(goal?.status)),
      cleared: kind === 'goal_cleared' || record.cleared === true
    }
  }

  if (kind === 'todos_updated' || kind === 'todos_cleared') {
    const todos = mapLocalRuntimeTodoList(record.todos, threadId)
    return {
      kind: 'todo_event',
      threadId,
      runtimeId: SCIFORGE_RUNTIME_ID,
      seq,
      createdAt: createdAt ?? todos?.updatedAt,
      turnId,
      itemId: itemId || optionalString(record.itemId),
      items: todos?.items ?? [],
      cleared: kind === 'todos_cleared' || record.cleared === true
    }
  }

  if (
    kind === 'item_created' ||
    kind === 'item_updated' ||
    kind === 'item_completed' ||
    kind === 'tool_call_started' ||
    kind === 'tool_call_finished'
  ) {
    const item = mapLocalRuntimeItem(record.item)
    if (item) {
      return {
        kind: 'item_snapshot',
        threadId,
        runtimeId: SCIFORGE_RUNTIME_ID,
        seq,
        createdAt,
        turnId,
        itemId: item.id,
        item
      }
    }
  }

  if (isNeutralEvent(record)) return { ...record, runtimeId: SCIFORGE_RUNTIME_ID } as AgentRuntimeEvent

  return {
    kind: 'item_snapshot',
    threadId,
    runtimeId: SCIFORGE_RUNTIME_ID,
    seq,
    createdAt,
    turnId,
    item: {
      id: itemId || `sciforge-event-${seq ?? Date.now()}`,
      kind: 'system',
      meta: record
    }
  }
}

function mapLocalRuntimeTurnLifecycleState(kind: string): Extract<AgentRuntimeEvent, { kind: 'turn_lifecycle' }>['state'] {
  if (kind === 'turn_completed') return 'completed'
  if (kind === 'turn_failed') return 'failed'
  if (kind === 'turn_aborted') return 'aborted'
  if (kind === 'turn_steered') return 'steered'
  return 'started'
}

function localRuntimeInputQuestions(value: unknown): Extract<
  AgentRuntimeEvent,
  { kind: 'user_input_requested' }
>['questions'] {
  if (!Array.isArray(value)) return []
  return value.flatMap((question) => {
    const record = asRecord(question)
    if (!record) return []
    const id = stringValue(record.id)
    const text = stringValue(record.question)
    if (!id || !text) return []
    return [{
      id,
      header: stringValue(record.header) || 'Input',
      question: text,
      options: Array.isArray(record.options)
        ? record.options.flatMap((option) => {
            const optionRecord = asRecord(option)
            if (!optionRecord) return []
            const label = stringValue(optionRecord.label)
            if (!label) return []
            return [{ label, description: stringValue(optionRecord.description) }]
          })
        : []
    }]
  })
}

function localRuntimeInputAnswers(value: unknown): Extract<
  AgentRuntimeEvent,
  { kind: 'user_input_resolved' }
>['answers'] {
  if (!Array.isArray(value)) return undefined
  const answers = value.flatMap((answer) => {
    const record = asRecord(answer)
    if (!record) return []
    const id = stringValue(record.id)
    const answerValue = stringValue(record.value)
    if (!id || !answerValue) return []
    const label = optionalString(record.label)
    return [{ id, value: answerValue, ...(label ? { label } : {}) }]
  })
  return answers.length > 0 ? answers : undefined
}

function localRuntimeUserInputStatus(value: unknown): Extract<
  AgentRuntimeEvent,
  { kind: 'user_input_resolved' }
>['status'] {
  const status = stringValue(value)
  if (status === 'submitted' || status === 'cancelled' || status === 'error') return status
  return 'cancelled'
}

function compactionEventDetail(record: Record<string, unknown>): string | undefined {
  const replacedTokens = numberValue(record.replacedTokens)
  if (replacedTokens !== undefined) return `replacedTokens=${replacedTokens}`
  return optionalString(record.detail) ?? optionalString(record.reason)
}

function mapLocalRuntimeGoalStatus(value: string): Extract<AgentRuntimeEvent, { kind: 'goal_event' }>['status'] | undefined {
  if (
    value === 'active' ||
    value === 'paused' ||
    value === 'blocked' ||
    value === 'usageLimited' ||
    value === 'budgetLimited' ||
    value === 'complete'
  ) {
    return value
  }
  return undefined
}

function mapLocalRuntimeTodoList(value: unknown, fallbackThreadId: string): AgentRuntimeTodoList | null {
  const record = asRecord(value)
  if (!record) return null
  const items = arrayValue(record.items)
    .map((item) => mapLocalRuntimeTodoItem(item))
    .filter(Boolean) as AgentRuntimeTodoItem[]
  return {
    threadId: stringValue(record.threadId) || stringValue(record.thread_id) || fallbackThreadId,
    updatedAt: optionalString(record.updatedAt) ?? optionalString(record.updated_at) ?? new Date().toISOString(),
    items
  }
}

function mapLocalRuntimeTodoItem(value: unknown): AgentRuntimeTodoItem | null {
  const record = asRecord(value)
  if (!record) return null
  const id = stringValue(record.id)
  const content = stringValue(record.content).trim()
  const status = mapLocalRuntimeTodoStatus(record.status)
  const source = mapLocalRuntimeTodoSource(record.source)
  if (!id || !content || !status) return null
  return {
    id,
    content,
    status,
    ...(source ? { source } : {}),
    createdAt: optionalString(record.createdAt) ?? optionalString(record.created_at) ?? new Date().toISOString(),
    updatedAt: optionalString(record.updatedAt) ?? optionalString(record.updated_at) ?? new Date().toISOString()
  }
}

function mapLocalRuntimeTodoStatus(value: unknown): AgentRuntimeTodoStatus | null {
  return value === 'pending' || value === 'in_progress' || value === 'completed' ? value : null
}

function mapLocalRuntimeTodoSource(value: unknown): AgentRuntimeTodoSource | undefined {
  const record = asRecord(value)
  if (!record || record.kind !== 'plan') return undefined
  const planId = stringValue(record.planId) || stringValue(record.plan_id)
  const relativePath = stringValue(record.relativePath) || stringValue(record.relative_path)
  const ordinal = numberValue(record.ordinal)
  const contentHash = stringValue(record.contentHash) || stringValue(record.content_hash)
  if (!planId || !relativePath || ordinal === undefined || !contentHash) return undefined
  return { kind: 'plan', planId, relativePath, ordinal, contentHash }
}

function isNeutralEvent(record: Record<string, unknown>): boolean {
  return [
    'thread_lifecycle',
    'turn_lifecycle',
    'runtime_status',
    'user_message',
    'assistant_delta',
    'reasoning_delta',
    'item_snapshot',
    'tool_event',
    'approval_requested',
    'approval_resolved',
    'user_input_requested',
    'user_input_resolved',
    'compaction_event',
    'review_event',
    'goal_event',
    'todo_event',
    'child_event',
    'usage',
    'error',
    'heartbeat'
  ].includes(stringValue(record.kind))
}

function conservativeLocalRuntimeCapabilities(): AgentRuntimeCapabilities {
  const caps = createDefaultAgentRuntimeCapabilities({ runtimeId: SCIFORGE_RUNTIME_ID, transport: 'http_sse' })
  return {
    ...caps,
    matrix: createAgentRuntimeCapabilityMatrix({
      nativeHistory: true,
      nativeCompact: true,
      nativeResume: true,
      steer: true,
      fork: true,
      handoffImport: false,
      usage: true,
      eventReplay: true,
      reasons: {
        handoffImport: 'Handoff import is provided by AgentRuntimeHost when a context ledger is configured.'
      }
    }),
    events: {
      live: true,
      replayable: true,
      sequenced: true,
      delivery: 'sse'
    },
    latency: {
      phaseEvents: true,
      firstTokenMetric: true,
      turnDurationMetric: true
    },
    reasoning: {
      available: true,
      streaming: true,
      visibility: 'summary',
      source: 'model'
    },
    model: {
      ...caps.model,
      supportsToolCalling: true
    },
    tools: {
      ...caps.tools,
      toolCalling: true,
      commandExecution: { available: true },
      fileChange: { available: true },
      diagnostics: { available: false, reason: 'runtime info unavailable', degraded: true }
    },
    controls: {
      interrupt: true,
      steer: true,
      approval: 'async',
      userInput: 'async',
      compact: 'native',
      fork: true,
      review: true,
      goals: true,
      todos: true,
      resumeSession: true
    },
    guard: {
      toolStorm: 'native'
    },
    storage: {
      ...caps.storage,
      backendThreadIdStable: true,
      usage: true
    }
  }
}

function mapLocalRuntimeCapabilities(value: unknown, diagnosticsAvailable: boolean): AgentRuntimeCapabilities {
  const caps = conservativeLocalRuntimeCapabilities()
  const manifest = asRecord(asRecord(value)?.capabilities) ?? asRecord(value) ?? {}
  const model = asRecord(manifest.model) ?? {}
  const mcp = asRecord(manifest.mcp) ?? {}
  const web = asRecord(manifest.web) ?? {}
  const research = asRecord(manifest.research) ?? {}
  const skills = asRecord(manifest.skills) ?? {}
  const subagents = asRecord(manifest.subagents) ?? {}
  const attachments = asRecord(manifest.attachments) ?? {}
  const memory = asRecord(manifest.memory) ?? {}
  return {
    ...caps,
    model: {
      id: optionalString(model.id),
      inputModalities: modalities(model.inputModalities, caps.model.inputModalities),
      outputModalities: modalities(model.outputModalities, caps.model.outputModalities),
      supportsToolCalling: booleanValue(model.supportsToolCalling, caps.model.supportsToolCalling),
      contextWindowTokens: numberValue(model.contextWindowTokens)
    },
    tools: {
      toolCalling: booleanValue(model.supportsToolCalling, true),
      commandExecution: { available: true },
      fileChange: { available: true },
      mcp: {
        ...capabilityState(mcp),
        search: mcpSearchCapabilityState(asRecord(mcp.search) ?? {}),
        toolCount: numberValue(mcp.toolCount)
      },
      web: {
        ...capabilityState(web),
        fetch: capabilityState(asRecord(web.fetch) ?? {}),
        search: capabilityState(asRecord(web.search) ?? {})
      },
      research: researchCapabilityState(research),
      computerUse: computerUseCapabilityState(asRecord(manifest.computerUse) ?? {
        ...configuredComputerUseCapability(),
        degraded: true,
        reason: 'GUI-managed computer-use MCP server is configured by the host.'
      }),
      skills: capabilityState(skills),
      subagents: {
        ...capabilityState(subagents),
        maxParallel: numberValue(subagents.maxParallel),
        maxChildren: numberValue(subagents.maxChildRuns) ?? numberValue(subagents.maxChildren)
      },
      diagnostics: diagnosticsAvailable
        ? { available: true }
        : { available: false, reason: 'runtime info unavailable', degraded: true }
    },
    storage: {
      ...caps.storage,
      attachments: capabilityState(attachments),
      memory: capabilityState(memory)
    }
  }
}

function capabilityState(value: Record<string, unknown>): { available: boolean; reason?: string; degraded?: boolean } {
  const available = value.available === true || value.status === 'available'
  const reason = optionalString(value.reason)
  return {
    available,
    ...(reason ? { reason } : {}),
    ...(value.degraded === true || (value.status === 'unavailable' && value.enabled === true)
      ? { degraded: true }
      : {})
  }
}

function mcpSearchCapabilityState(value: Record<string, unknown>): { available: boolean; reason?: string } {
  const reason = optionalString(value.reason)
  return {
    available: value.available === true || value.active === true,
    ...(reason ? { reason } : {})
  }
}

function researchCapabilityState(value: Record<string, unknown>): AgentRuntimeCapabilities['tools']['research'] {
  const base = capabilityState(value)
  const sources = researchSources(value)
  const available = base.available || value.active === true || (hasResearchProviderState(value) && sources.length > 0)
  const toolName = optionalString(value.toolName) ?? optionalString(value.tool) ?? 'research_search'
  return {
    ...base,
    available,
    ...(available ? { server: 'mcp' as const, toolName } : {}),
    ...(sources.length ? { sources } : {}),
    ...(numberValue(value.maxResults) ? { maxResults: numberValue(value.maxResults) } : {})
  }
}

function computerUseCapabilityState(value: Record<string, unknown>): AgentRuntimeCapabilities['tools']['computerUse'] {
  const base = capabilityState(value)
  const available = base.available || value.active === true || value.enabled === true
  const isolated = configuredComputerUseCapability()
  return {
    ...base,
    available,
    ...(available ? { server: isolated.server, toolName: isolated.toolName } : {}),
    backend: isolated.backend,
    inputIsolation: isolated.inputIsolation,
    affectsUserInput: isolated.affectsUserInput,
    requiresHostFocus: isolated.requiresHostFocus,
    usesHostClipboard: isolated.usesHostClipboard
  }
}

function hasResearchProviderState(value: Record<string, unknown>): boolean {
  return Boolean(
    asRecord(value.arxiv) ||
    asRecord(value.biorxiv) ||
    asRecord(value.semanticScholar) ||
    asRecord(value.semantic_scholar) ||
    asRecord(value.tavily) ||
    asRecord(value.web) ||
    asRecord(value.cns)
  )
}

function researchSources(value: Record<string, unknown>): NonNullable<AgentRuntimeCapabilities['tools']['research']['sources']> {
  const explicit = arrayValue(value.sources)
    .filter((entry): entry is NonNullable<AgentRuntimeCapabilities['tools']['research']['sources']>[number] =>
      entry === 'arxiv' ||
      entry === 'biorxiv' ||
      entry === 'semantic_scholar' ||
      entry === 'web' ||
      entry === 'cns'
    )
  if (explicit.length) return [...new Set(explicit)]
  const sources: NonNullable<AgentRuntimeCapabilities['tools']['research']['sources']> = []
  if (capabilityState(asRecord(value.arxiv) ?? {}).available) sources.push('arxiv')
  if (capabilityState(asRecord(value.biorxiv) ?? {}).available) sources.push('biorxiv')
  if (capabilityState(asRecord(value.semanticScholar) ?? {}).available) sources.push('semantic_scholar')
  if (capabilityState(asRecord(value.semantic_scholar) ?? {}).available) sources.push('semantic_scholar')
  if (capabilityState(asRecord(value.tavily) ?? {}).available) sources.push('web')
  if (capabilityState(asRecord(value.web) ?? {}).available) sources.push('web')
  if (capabilityState(asRecord(value.cns) ?? {}).available) sources.push('cns')
  return [...new Set(sources)]
}

function modalities(value: unknown, fallback: AgentRuntimeModality[]): AgentRuntimeModality[] {
  const parsed = arrayValue(value).filter((entry): entry is AgentRuntimeModality => entry === 'text' || entry === 'image')
  return parsed.length ? parsed : fallback
}

function mapUsage(value: unknown): AgentRuntimeThreadDetail['usage'] {
  const record = asRecord(value)
  if (!record) return undefined
  const inputTokens = numberValue(record.inputTokens) ?? numberValue(record.promptTokens) ?? numberValue(record.prompt_tokens)
  const outputTokens = numberValue(record.outputTokens) ?? numberValue(record.completionTokens) ?? numberValue(record.completion_tokens)
  return {
    inputTokens,
    outputTokens,
    totalTokens: numberValue(record.totalTokens) ??
      numberValue(record.total_tokens) ??
      (inputTokens !== undefined || outputTokens !== undefined ? (inputTokens ?? 0) + (outputTokens ?? 0) : undefined),
    cacheReadTokens: numberValue(record.cacheReadTokens) ??
      numberValue(record.cachedTokens) ??
      numberValue(record.cacheHitTokens) ??
      numberValue(record.cache_hit_tokens),
    cacheWriteTokens: numberValue(record.cacheWriteTokens) ??
      numberValue(record.cacheMissTokens) ??
      numberValue(record.cache_miss_tokens),
    costUsd: numberValue(record.costUsd) ?? numberValue(record.cost_usd)
  }
}

function mapLocalRuntimeTranscriptRef(
  record: Record<string, unknown> | undefined,
  childId: string,
  label?: string
): NonNullable<AgentRuntimeChild['transcriptRef']> {
  const path = optionalString(record?.path)
  const url = optionalString(record?.url)
  const mimeType = optionalString(record?.mimeType)
  const metadata = asRecord(record?.metadata) ?? undefined
  return {
    id: optionalString(record?.id) ?? childId,
    kind: mapLocalRuntimeTranscriptRefKind(record?.kind) ?? 'runtime',
    runtimeId: SCIFORGE_RUNTIME_ID,
    childId,
    transcriptId: optionalString(record?.transcriptId) ?? childId,
    source: optionalString(record?.source) ?? 'local-runtime-child-run',
    label: optionalString(record?.label) ?? label ?? childId,
    ...(path ? { path } : {}),
    ...(url ? { url } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(metadata ? { metadata } : {})
  }
}

function mapLocalRuntimeTranscriptRefKind(value: unknown): NonNullable<AgentRuntimeChild['transcriptRef']>['kind'] | undefined {
  if (value === 'runtime' || value === 'file' || value === 'directory' || value === 'url' || value === 'remote') {
    return value
  }
  return undefined
}

function mapLocalRuntimeTranscriptFormat(value: unknown): 'jsonl' | 'markdown' | 'text' | 'unknown' | undefined {
  if (value === 'jsonl' || value === 'markdown' || value === 'text' || value === 'unknown') return value
  return undefined
}

function mapLocalRuntimeTranscriptEntry(value: unknown): AgentRuntimeChildTranscriptEntry | null {
  const record = asRecord(value)
  if (!record) return null
  const id = optionalString(record.id)
  const kind = mapLocalRuntimeTranscriptEntryKind(record.kind)
  if (!id || !kind) return null
  const text = optionalString(record.text)
  const summary = optionalString(record.summary)
  const status = optionalString(record.status)
  const createdAt = optionalString(record.createdAt)
  const metadata = asRecord(record.metadata) ?? undefined
  return {
    id,
    kind,
    ...(text ? { text } : {}),
    ...(summary ? { summary } : {}),
    ...(status ? { status } : {}),
    ...(createdAt ? { createdAt } : {}),
    ...(metadata ? { metadata } : {})
  }
}

function mapLocalRuntimeTranscriptEntryKind(value: unknown): AgentRuntimeChildTranscriptEntry['kind'] | null {
  if (
    value === 'user_message' ||
    value === 'assistant_message' ||
    value === 'reasoning' ||
    value === 'tool' ||
    value === 'system' ||
    value === 'event'
  ) {
    return value
  }
  return null
}

function degradedLocalRuntimeChildTranscript(input: {
  threadId: string
  parentTurnId?: string
  childId: string
  reason: string
}): {
  transcript: {
    runtimeId: typeof SCIFORGE_RUNTIME_ID
    threadId: string
    parentThreadId: string
    parentTurnId?: string
    childId: string
    format: 'unknown'
    entries: []
    degraded: true
    reason: string
  }
} {
  return {
    transcript: {
      runtimeId: SCIFORGE_RUNTIME_ID,
      threadId: input.threadId,
      parentThreadId: input.threadId,
      ...(input.parentTurnId ? { parentTurnId: input.parentTurnId } : {}),
      childId: input.childId,
      format: 'unknown',
      entries: [],
      degraded: true,
      reason: input.reason
    }
  }
}

function mapLocalRuntimeChildRun(value: unknown, fallbackParentThreadId: string): AgentRuntimeChild | null {
  const record = asRecord(value)
  if (!record) return null
  const id = stringValue(record.id) || stringValue(record.childId)
  const parentThreadId = stringValue(record.parentThreadId) || fallbackParentThreadId
  if (!id || !parentThreadId) return null
  const label = optionalString(record.label) ?? optionalString(record.childLabel)
  const status = mapLocalRuntimeChildStatus(stringValue(record.status) || stringValue(record.childStatus))
  const updatedAt = optionalString(record.updatedAt) ?? optionalString(record.updated_at)
  const completedAt = status === 'completed' || status === 'failed' || status === 'aborted'
    ? updatedAt
    : undefined
  const workspace = optionalString(record.workspace)
  const model = optionalString(record.model)
  const errorRecord = asRecord(record.error)
  const error = optionalString(record.error) ?? optionalString(errorRecord?.message)
  return {
    id,
    runtimeId: SCIFORGE_RUNTIME_ID,
    parentThreadId,
    parentTurnId: optionalString(record.parentTurnId) ?? optionalString(record.parent_turn_id),
    kind: 'agent',
    status,
    ...(label ? { label, name: label } : {}),
    prompt: optionalString(record.prompt),
    summary: optionalString(record.summary) ?? optionalString(record.text) ?? error,
    usage: mapUsage(record.usage),
    transcriptRef: mapLocalRuntimeTranscriptRef(asRecord(record.transcriptRef) ?? undefined, id, label),
    createdAt: optionalString(record.createdAt) ?? optionalString(record.created_at),
    startedAt: optionalString(record.startedAt) ?? optionalString(record.started_at) ?? optionalString(record.createdAt) ?? optionalString(record.created_at),
    updatedAt,
    ...(completedAt ? { completedAt } : {}),
    metadata: {
      source: 'local-runtime.delegate_task',
      ...(workspace ? { workspace } : {}),
      ...(model ? { model } : {}),
      ...(error ? { error } : {}),
      ...(errorRecord ? { errorInfo: errorRecord } : {})
    }
  }
}

function mapLocalRuntimeChildStatus(value: string): AgentRuntimeChildStatus {
  if (
    value === 'queued' ||
    value === 'running' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'aborted'
  ) {
    return value
  }
  return 'unknown'
}

function mapLocalRuntimeChildEvent(
  value: Record<string, unknown>,
  fallbackParentThreadId: string,
  fallbackParentTurnId: string | undefined,
  createdAt: string | undefined
): AgentRuntimeChild | null {
  const event = value
  const record = asRecord(event.child)
  if (!record) return null
  const id = stringValue(record.childId)
  const parentThreadId = stringValue(record.parentThreadId) || fallbackParentThreadId
  if (!id || !parentThreadId) return null
  const label = optionalString(record.childLabel)
  const status = mapLocalRuntimeChildStatus(stringValue(record.childStatus))
  const summary = optionalString(event.text) ?? optionalString(event.message)
  return {
    id,
    runtimeId: SCIFORGE_RUNTIME_ID,
    parentThreadId,
    parentTurnId: optionalString(record.parentTurnId) ?? fallbackParentTurnId,
    kind: 'agent',
    status,
    ...(label ? { label, name: label } : {}),
    ...(summary ? { summary } : {}),
    updatedAt: createdAt,
    ...(status === 'completed' || status === 'failed' || status === 'aborted' ? { completedAt: createdAt } : {}),
    metadata: {
      source: 'local-runtime.runtime_event',
      ...(numberValue(record.childSeq) !== undefined ? { childSeq: numberValue(record.childSeq) } : {})
    }
  }
}

function mapUsageResponse(
  value: unknown,
  input: AgentRuntimeUsageQuery
): Extract<AgentRuntimeUsageResponse, { supported: true }> {
  const record = asRecord(value) ?? {}
  const buckets = arrayValue(record.buckets)
    .map((item) => normalizeUsageBucket(asRecord(item) ?? {}, input.groupBy))
  const days = arrayValue(record.days)
    .map((item) => normalizeUsageBucket(asRecord(item) ?? {}, 'day'))
  return {
    supported: true,
    groupBy: input.groupBy,
    from: optionalString(record.from) ?? input.from,
    to: optionalString(record.to) ?? input.to,
    timezone: optionalString(record.timezone) ?? input.timezone,
    buckets,
    ...(days.length ? { days } : {}),
    totals: normalizeUsageTotals(asRecord(record.totals) ?? {})
  }
}

function normalizeUsageBucket(
  record: Record<string, unknown>,
  groupBy: AgentRuntimeUsageQuery['groupBy']
): Record<string, unknown> {
  const inputTokens = usageNumber(record, 'inputTokens', 'input_tokens', 'prompt_tokens')
  const outputTokens = usageNumber(record, 'outputTokens', 'output_tokens', 'completion_tokens')
  const totalTokens = usageNumber(record, 'totalTokens', 'total_tokens') || inputTokens + outputTokens
  const bucket: Record<string, unknown> = {
    inputTokens,
    outputTokens,
    reasoningTokens: usageNumber(record, 'reasoningTokens', 'reasoning_tokens'),
    cachedTokens: usageNumber(record, 'cachedTokens', 'cached_tokens', 'cacheReadTokens', 'cache_read_tokens', 'cache_hit_tokens'),
    cacheMissTokens: usageNumber(record, 'cacheMissTokens', 'cache_miss_tokens', 'cacheWriteTokens', 'cache_write_tokens'),
    totalTokens,
    costUsd: usageNumber(record, 'costUsd', 'cost_usd'),
    costCny: usageNullableNumber(record, 'costCny', 'cost_cny'),
    cacheSavingsUsd: usageNumber(record, 'cacheSavingsUsd', 'cache_savings_usd'),
    cacheSavingsCny: usageNullableNumber(record, 'cacheSavingsCny', 'cache_savings_cny'),
    tokenEconomySavingsTokens: usageNumber(record, 'tokenEconomySavingsTokens', 'token_economy_savings_tokens'),
    tokenEconomySavingsUsd: usageNumber(record, 'tokenEconomySavingsUsd', 'token_economy_savings_usd'),
    tokenEconomySavingsCny: usageNullableNumber(record, 'tokenEconomySavingsCny', 'token_economy_savings_cny'),
    turns: usageNumber(record, 'turns'),
    threadCount: usageNumber(record, 'threadCount', 'thread_count'),
    cacheHitRate: usageNullableRate(record, 'cacheHitRate', 'cache_hit_rate')
  }
  if (groupBy === 'day') bucket.date = optionalString(record.date) ?? ''
  if (groupBy === 'model') bucket.model = optionalString(record.model) ?? 'unknown'
  if (groupBy === 'thread') {
    bucket.threadId = optionalString(record.threadId) ??
      optionalString(record.thread_id) ??
      optionalString(record.id) ??
      optionalString(record.key) ??
      optionalString(record.label) ??
      ''
    if (typeof record.title === 'string') bucket.title = record.title
  }
  return bucket
}

function normalizeUsageTotals(record: Record<string, unknown>): Record<string, unknown> {
  return {
    ...normalizeUsageBucket(record, 'thread'),
    days: usageNumber(record, 'days'),
    activeDays: usageNumber(record, 'activeDays', 'active_days')
  }
}

async function hydrateThreadCacheStats(
  options: LocalRuntimeAgentRuntimeAdapterOptions,
  context: AgentRuntimeAdapterContext,
  threadId: string,
  response: Extract<AgentRuntimeUsageResponse, { supported: true }>
): Promise<void> {
  let payload: unknown
  try {
    payload = await requestJson(options, context, localRuntimeThreadPath(threadId), { method: 'GET' })
  } catch (error) {
    if (isLocalRuntimeNotFoundError(error)) return
    throw error
  }
  const stats = threadCacheStats(payload)
  if (!stats) return
  const bucket = response.buckets.find((item) => {
    const record = asRecord(item) ?? {}
    return [record.threadId, record.thread_id, record.id, record.key, record.label].some((candidate) => candidate === threadId)
  })
  if (!bucket) return
  const cacheTotal = stats.hitTokens + stats.missTokens
  bucket.cachedTokens = stats.hitTokens
  bucket.cacheMissTokens = stats.missTokens
  bucket.cacheHitRate = cacheTotal > 0 ? stats.hitTokens / cacheTotal : null
}

function isLocalRuntimeNotFoundError(error: unknown): boolean {
  return error instanceof Error && error.name === 'not_found'
}

function threadCacheStats(value: unknown): { hitTokens: number; missTokens: number } | null {
  const record = firstRecord(value, 'thread')
  let hitTokens = 0
  let missTokens = 0
  let hasCacheTelemetry = false
  for (const turn of arrayValue(record.turns)) {
    const usage = asRecord(asRecord(turn)?.usage)
    if (!usage) continue
    const hasHit = numberValue(usage.prompt_cache_hit_tokens) !== undefined ||
      numberValue(usage.promptCacheHitTokens) !== undefined
    const hasMiss = numberValue(usage.prompt_cache_miss_tokens) !== undefined ||
      numberValue(usage.promptCacheMissTokens) !== undefined
    if (!hasHit && !hasMiss) continue
    hasCacheTelemetry = true
    hitTokens += usageNumber(usage, 'promptCacheHitTokens', 'prompt_cache_hit_tokens')
    missTokens += usageNumber(usage, 'promptCacheMissTokens', 'prompt_cache_miss_tokens')
  }
  return hasCacheTelemetry ? { hitTokens, missTokens } : null
}

function usageNumber(record: Record<string, unknown>, ...keys: string[]): number {
  for (const key of keys) {
    const value = numberValue(record[key])
    if (value !== undefined) return value
  }
  return 0
}

function usageNullableNumber(record: Record<string, unknown>, ...keys: string[]): number | null {
  for (const key of keys) {
    const value = numberValue(record[key])
    if (value !== undefined) return value
  }
  return null
}

function usageNullableRate(record: Record<string, unknown>, ...keys: string[]): number | null {
  const value = usageNullableNumber(record, ...keys)
  return value === null ? null : Math.max(0, Math.min(1, value))
}

function normalizeThreadRelation(value: unknown): AgentRuntimeThread['relation'] {
  return value === 'primary' || value === 'fork' || value === 'side' ? value : undefined
}

function normalizeTurnStatus(value: unknown): AgentRuntimeTurn['status'] {
  if (value === 'queued' || value === 'running' || value === 'completed' ||
    value === 'failed' || value === 'aborted' || value === 'steered') {
    return value
  }
  return 'queued'
}

function normalizeItemStatus(value: unknown): AgentRuntimeItem['status'] | undefined {
  if (
    value === 'pending' ||
    value === 'running' ||
    value === 'success' ||
    value === 'error' ||
    value === 'completed' ||
    value === 'failed' ||
    value === 'aborted'
  ) {
    return value
  }
  return undefined
}

function normalizeToolKind(value: unknown): AgentRuntimeToolKind | undefined {
  if (value === 'tool_call' || value === 'command_execution' || value === 'file_change') return value
  return undefined
}

function stringifyDetail(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value === undefined || value === null) return undefined
  try {
    return JSON.stringify(value, null, 2)
  } catch {
    return String(value)
  }
}

function firstRecord(value: unknown, nestedKey: string): Record<string, unknown> {
  const record = asRecord(value) ?? {}
  return asRecord(record[nestedKey]) ?? record
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function optionalString(value: unknown): string | undefined {
  const text = stringValue(value)
  return text || undefined
}

function reasoningVisibility(value: unknown): ReasoningVisibility | undefined {
  switch (stringValue(value)) {
    case 'none':
    case 'summary':
    case 'trace':
    case 'full_runtime_text':
      return value as ReasoningVisibility
    default:
      return undefined
  }
}

function stringArrayValue(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined
  const values = value
    .filter((item): item is string => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean)
  return values.length ? values : undefined
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function booleanValue(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback
}
