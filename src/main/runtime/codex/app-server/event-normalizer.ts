import type { CodexThreadEventPayload } from '../codex-runtime-api'
import {
  codexAppServerApprovalToolName,
  isCodexAppServerApprovalRequestMethod,
  isCodexAppServerUserInputRequestMethod
} from './request-registry'

export type CodexEventNormalizeContext = {
  threadId?: string
  turnId?: string
}

type CodexNormalizedChild = NonNullable<CodexThreadEventPayload['child']>

export function normalizeCodexEvent(
  payload: unknown,
  context: CodexEventNormalizeContext = {}
): CodexThreadEventPayload | null {
  const event = asRecord(payload)
  if (!event) return null
  if (stringValue(event.type) === 'event_msg') {
    return normalizeSessionEventMessage(asRecord(event.payload), context)
  }
  if (stringValue(event.type) === 'response_item') {
    return normalizeSessionResponseItem(asRecord(event.payload), context)
  }
  const method = stringValue(event.method)
  const params = asRecord(event.params) ?? {}
  const subagentThreadEvent = normalizeSubagentThreadEvent(method, params, context)
  if (subagentThreadEvent) return subagentThreadEvent
  const threadId = stringValue(params.threadId) ||
    stringValue(params.thread_id) ||
    stringValue(asRecord(params.thread)?.id) ||
    stringValue(context.threadId)
  if (!threadId) return null
  const turnId = stringValue(params.turnId) ||
    stringValue(params.turn_id) ||
    stringValue(asRecord(params.turn)?.id) ||
    stringValue(context.turnId)
  if (isAgentMessageDelta(method)) {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text: deltaText(params), kind: 'agent_message' }]
    }
  }
  if (isReasoningDelta(method)) {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text: deltaText(params), kind: 'agent_reasoning' }]
    }
  }
  if (method === 'item/commandExecution/outputDelta') {
    const callId = stringValue(params.itemId) || 'codex-command-output'
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: callId,
        summary: 'Command output',
        status: 'running',
        toolKind: 'command_execution',
        detail: stringValue(params.delta),
        meta: toolExecutionMeta({
          callId,
          toolName: 'exec_command',
          phase: 'dispatched',
          factSource: 'runtime_lifecycle',
          evidenceStrength: 'runtime_lifecycle'
        })
      }
    }
  }
  if (method === 'item/fileChange/outputDelta') {
    const callId = stringValue(params.itemId) || 'codex-file-change-output'
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: callId,
        summary: 'File changes',
        status: 'running',
        toolKind: 'file_change',
        detail: stringValue(params.delta),
        meta: toolExecutionMeta({
          callId,
          toolName: 'apply_patch',
          phase: 'dispatched',
          factSource: 'runtime_lifecycle',
          evidenceStrength: 'runtime_lifecycle'
        })
      }
    }
  }
  if (method === 'rawResponseItem/completed') {
    return normalizeSessionResponseItem(asRecord(params.item), { threadId, turnId })
  }
  if (method === 'item/started') {
    return normalizeThreadItem(asRecord(params.item), { threadId, turnId }, 'running')
  }
  if (method === 'item/completed') {
    return normalizeThreadItem(asRecord(params.item), { threadId, turnId }, 'completed')
  }
  if (method === 'turn/completed') {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      turnComplete: true
    }
  }
  if (method === 'thread/tokenUsage/updated') {
    const usage = tokenUsageFromParams(params)
    if (!usage) return null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      usage
    }
  }
  if (method === 'error' || method === 'turn/failed') {
    const error = asRecord(params.error)
    const details = error?.details ?? error?.data ?? params.details ?? params.data
    const message = stringValue(error?.message) || 'Codex runtime error'
    const code = normalizeRuntimeErrorCode(stringValue(error?.code), message)
    const transientPhase = transientRuntimeStatusPhase(code, message)
    if (transientPhase) {
      return {
        threadId,
        ...(turnId ? { turnId } : {}),
        runtimeStatus: {
          itemId: runtimeStatusItemId(threadId, turnId, transientPhase),
          phase: transientPhase,
          message
        }
      }
    }
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeError: {
        itemId: turnId || 'codex-error',
        message,
        ...(code ? { code } : {}),
        ...(details !== undefined ? { details } : {}),
        severity: 'error'
      }
    }
  }
  if (method === 'turn/cancelled' || method === 'turn/canceled') {
    const reason = stringValue(params.reason)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeError: {
        itemId: turnId || 'codex-cancelled',
        message: reason ? `Codex turn cancelled: ${reason}` : 'Codex turn cancelled.',
        code: 'cancelled',
        severity: 'warning'
      }
    }
  }
  if (isCodexAppServerApprovalRequestMethod(method)) {
    const itemId = stringValue(params.itemId) || turnId || 'codex-approval'
    const toolName = stringValue(params.toolName) || codexAppServerApprovalToolName(method)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeError: {
        itemId,
        message: `Codex requested approval for ${toolName}, but approval handling is not available.`,
        code: 'approval_required',
        severity: 'warning'
      }
    }
  }
  if (isCodexAppServerUserInputRequestMethod(method)) {
    const itemId = stringValue(params.itemId) || stringValue(params.requestId) || turnId || 'codex-user-input'
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeError: {
        itemId,
        message: 'Codex is blocked on a user input request, but user input handling is not available yet.',
        code: 'user_input_required',
        severity: 'warning'
      }
    }
  }
  return null
}

function normalizeSessionEventMessage(
  payload: Record<string, unknown> | null,
  context: CodexEventNormalizeContext
): CodexThreadEventPayload | null {
  if (!payload) return null
  const threadId = sessionThreadId(payload, context)
  if (!threadId) return null
  const turnId = sessionTurnId(payload, context)
  const type = stringValue(payload.type)
  if (type === 'task_started') {
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeStatus: {
        itemId: runtimeStatusItemId(threadId, turnId, 'task_started'),
        phase: 'tool_running',
        message: 'Codex task started',
        ...(secondsToIso(payload.started_at) ? { createdAt: secondsToIso(payload.started_at) } : {})
      }
    }
  }
  if (type === 'task_complete') {
    const lastAgentMessage = stringValue(payload.last_agent_message)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      ...(lastAgentMessage ? { deltas: [{ text: lastAgentMessage, kind: 'agent_message' as const, snapshot: true }] } : {}),
      turnComplete: true
    }
  }
  if (type === 'turn_aborted') {
    const reason = stringValue(payload.reason)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      runtimeError: {
        itemId: turnId || 'codex-turn-aborted',
        message: reason ? `Codex turn aborted: ${reason}` : 'Codex turn aborted.',
        code: 'aborted',
        severity: 'warning'
      }
    }
  }
  if (type === 'token_count') {
    const usage = tokenUsageFromSessionInfo(asRecord(payload.info))
    if (!usage) return null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      usage
    }
  }
  return null
}

function normalizeSessionResponseItem(
  payload: Record<string, unknown> | null,
  context: CodexEventNormalizeContext
): CodexThreadEventPayload | null {
  if (!payload) return null
  const threadId = sessionThreadId(payload, context)
  if (!threadId) return null
  const turnId = sessionTurnId(payload, context)
  const type = stringValue(payload.type)
  if (type === 'message') {
    if (stringValue(payload.role) !== 'assistant') return null
    const text = responseMessageText(payload)
    if (!text) return null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text, kind: 'agent_message', snapshot: true }]
    }
  }
  if (type === 'reasoning') {
    const text = reasoningText(payload)
    if (!text) return null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text, kind: 'agent_reasoning' }]
    }
  }
  if (type === 'function_call') {
    const toolName = stringValue(payload.name) || 'tool'
    const args = parseJsonObject(stringValue(payload.arguments))
    const callId = stringValue(payload.call_id)
    const itemId = callId || stringValue(payload.id) || `${toolName}-${turnId || threadId}`
    const command = stringValue(args?.cmd) || stringValue(args?.command)
    const cwd = stringValue(args?.workdir) || stringValue(args?.cwd)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId,
        summary: toolName,
        status: 'running',
        toolKind: toolKindForFunction(toolName),
        ...(toolCallDetail(args, payload) ? { detail: toolCallDetail(args, payload) } : {}),
        meta: {
          ...toolExecutionMeta({
            callId: itemId,
            toolName,
            phase: 'requested',
            factSource: 'model_output',
            evidenceStrength: 'intent'
          }),
          ...(command ? { command } : {}),
          ...(cwd ? { cwd } : {}),
          ...(args ? { arguments: args } : {})
        }
      }
    }
  }
  if (type === 'function_call_output') {
    const output = outputText(payload.output)
    const callId = stringValue(payload.call_id) || stringValue(payload.id) || 'codex-tool-output'
    const toolName = stringValue(payload.name) || stringValue(payload.tool_name)
    const status = toolOutputStatus(payload, output)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: callId,
        summary: toolName || 'Tool output',
        status,
        detail: output,
        meta: toolExecutionMeta({
          callId,
          ...(toolName ? { toolName } : {}),
          phase: status === 'success' ? 'succeeded' : 'failed',
          factSource: 'executor_result',
          evidenceStrength: 'executor_receipt',
          success: status === 'success'
        })
      }
    }
  }
  if (type === 'local_shell_call') {
    const action = asRecord(payload.action)
    const command = stringValue(action?.command)
    const callId = stringValue(payload.call_id) || stringValue(payload.id) || 'codex-local-shell-call'
    const status = localShellCallStatus(payload)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: callId,
        summary: command || 'Local shell',
        status,
        toolKind: 'command_execution',
        ...(command ? { detail: command } : {}),
        meta: {
          ...toolExecutionMeta({
            callId,
            toolName: 'local_shell',
            phase: status === 'running' ? 'dispatched' : status === 'success' ? 'succeeded' : 'failed',
            factSource: status === 'running' ? 'runtime_lifecycle' : 'executor_result',
            evidenceStrength: status === 'running' ? 'runtime_lifecycle' : 'executor_receipt',
            ...(status === 'running' ? {} : { success: status === 'success' })
          }),
          ...(command ? { command } : {})
        }
      }
    }
  }
  return null
}

function normalizeThreadItem(
  item: Record<string, unknown> | null,
  context: CodexEventNormalizeContext,
  lifecycle: 'running' | 'completed'
): CodexThreadEventPayload | null {
  if (!item) return null
  const threadId = sessionThreadId(item, context)
  if (!threadId) return null
  const turnId = sessionTurnId(item, context)
  const type = stringValue(item.type)
  if (type === 'agentMessage') {
    const text = stringValue(item.text)
    if (!text) return null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text, kind: 'agent_message', snapshot: true }]
    }
  }
  if (type === 'reasoning') {
    const text = [...arrayValue(item.summary), ...arrayValue(item.content)]
      .map((entry) => typeof entry === 'string' ? entry : stringValue(asRecord(entry)?.text))
      .filter(Boolean)
      .join('\n')
    if (!text) return null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      deltas: [{ text, kind: 'agent_reasoning' }]
    }
  }
  if (type === 'commandExecution') {
    const status = threadItemStatus(item, lifecycle)
    const callId = toolItemCallId(item, 'codex-command')
    const output = stringValue(item.aggregatedOutput)
    const command = stringValue(item.command)
    const cwd = stringValue(item.cwd)
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: callId,
        summary: command || 'Command execution',
        status,
        toolKind: 'command_execution',
        ...(output || command ? { detail: output || command } : {}),
        meta: {
          ...terminalAwareToolExecutionMeta(callId, 'exec_command', status),
          ...(command ? { command } : {}),
          ...(cwd ? { cwd } : {}),
          ...(typeof item.exitCode === 'number' ? { exitCode: item.exitCode } : {})
        }
      }
    }
  }
  if (type === 'fileChange') {
    const status = threadItemStatus(item, lifecycle)
    const callId = toolItemCallId(item, 'codex-file-change')
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: callId,
        summary: 'File changes',
        status,
        toolKind: 'file_change',
        detail: threadItemJsonDetail(item.changes),
        meta: terminalAwareToolExecutionMeta(callId, 'apply_patch', status)
      }
    }
  }
  if (type !== 'mcpToolCall' && type !== 'dynamicToolCall' && type !== 'collabAgentToolCall') {
    const threadSourceChild = childFromSubagentThreadRecord(item, context, lifecycle)
    if (threadSourceChild) {
      return {
        threadId: threadSourceChild.parentThreadId,
        ...(threadSourceChild.parentTurnId ? { turnId: threadSourceChild.parentTurnId } : {}),
        child: threadSourceChild
      }
    }
  }
  if (type === 'mcpToolCall' || type === 'dynamicToolCall' || type === 'collabAgentToolCall') {
    const tool = stringValue(item.tool) || stringValue(item.server) || type
    const callId = toolItemCallId(item, `codex-${type}`)
    const status = threadItemStatus(item, lifecycle)
    const args = recordArguments(item)
    const child = type === 'collabAgentToolCall'
      ? childFromCollabAgentToolCall(item, context, lifecycle, threadId, turnId)
      : null
    return {
      threadId,
      ...(turnId ? { turnId } : {}),
      tool: {
        itemId: callId,
        summary: tool,
        status,
        toolKind: 'tool_call',
        detail: threadItemJsonDetail(item.result) || threadItemJsonDetail(item.error) || threadItemJsonDetail(item.contentItems),
        meta: {
          ...terminalAwareToolExecutionMeta(callId, tool, status),
          ...(stringValue(item.server) ? { server: stringValue(item.server) } : {}),
          ...(stringValue(item.namespace) ? { namespace: stringValue(item.namespace) } : {}),
          ...(args ? { arguments: args } : {}),
          ...(type === 'collabAgentToolCall' ? collabAgentToolMetadata(item) : {})
        }
      },
      ...(child ? { child } : {})
    }
  }
  return null
}

function normalizeSubagentThreadEvent(
  method: string,
  params: Record<string, unknown>,
  context: CodexEventNormalizeContext
): CodexThreadEventPayload | null {
  if (!method.includes('thread')) return null
  const thread = asRecord(params.thread) ?? params
  const child = childFromSubagentThreadRecord(thread, {
    threadId: stringValue(params.parentThreadId) ||
      stringValue(params.parent_thread_id) ||
      stringValue(params.sourceThreadId) ||
      stringValue(params.source_thread_id) ||
      stringValue(context.threadId),
    turnId: stringValue(params.parentTurnId) ||
      stringValue(params.parent_turn_id) ||
      stringValue(params.turnId) ||
      stringValue(params.turn_id) ||
      stringValue(context.turnId)
  }, method.includes('completed') || method.includes('complete') ? 'completed' : 'running')
  if (!child) return null
  return {
    threadId: child.parentThreadId,
    ...(child.parentTurnId ? { turnId: child.parentTurnId } : {}),
    child
  }
}

function childFromSubagentThreadRecord(
  record: Record<string, unknown>,
  context: CodexEventNormalizeContext,
  lifecycle: 'running' | 'completed'
): CodexNormalizedChild | null {
  const source = normalizedThreadSource(record)
  if (!isNativeThreadChildSource(source)) return null
  const childThreadId = stringValue(record.id) ||
    stringValue(record.threadId) ||
    stringValue(record.thread_id) ||
    stringValue(record.childThreadId) ||
    stringValue(record.child_thread_id)
  const parentThreadId = stringValue(record.parentThreadId) ||
    stringValue(record.parent_thread_id) ||
    stringValue(record.sourceThreadId) ||
    stringValue(record.source_thread_id) ||
    stringValue(context.threadId)
  if (!childThreadId || !parentThreadId || childThreadId === parentThreadId) return null
  const parentTurnId = stringValue(record.parentTurnId) ||
    stringValue(record.parent_turn_id) ||
    stringValue(record.turnId) ||
    stringValue(record.turn_id) ||
    stringValue(context.turnId)
  const name = stringValue(record.agentNickname) ||
    stringValue(record.agent_nickname) ||
    stringValue(record.workflowName) ||
    stringValue(record.workflow_name) ||
    stringValue(record.name) ||
    stringValue(record.title)
  const role = stringValue(record.agentRole) || stringValue(record.agent_role) || stringValue(record.label)
  const status = childStatus(record, lifecycle)
  return withCleanMetadata({
    id: childThreadId,
    runtimeId: 'codex',
    parentThreadId,
    ...(parentTurnId ? { parentTurnId } : {}),
    kind: childKindFromThreadSource(source),
    status,
    ...(name ? { name } : {}),
    ...(role ? { label: role } : {}),
    ...(childPrompt(record) ? { prompt: childPrompt(record) } : {}),
    ...(childSummary(record) ? { summary: childSummary(record) } : {}),
    ...(usageFromRecord(record) ? { usage: usageFromRecord(record) } : {}),
    transcriptRef: runtimeTranscriptRef(childThreadId, childThreadId),
    openAsThreadRef: openAsThreadRef(childThreadId),
    ...(eventIso(record.createdAt) ? { createdAt: eventIso(record.createdAt) } : {}),
    ...(eventIso(record.startedAt) ? { startedAt: eventIso(record.startedAt) } : {}),
    ...(eventIso(record.updatedAt) ? { updatedAt: eventIso(record.updatedAt) } : {}),
    ...(status === 'completed' && eventIso(record.completedAt) ? { completedAt: eventIso(record.completedAt) } : {}),
    metadata: {
      threadSource: source,
      ...(role ? { agentRole: role } : {}),
      ...(stringValue(record.workflowName) || stringValue(record.workflow_name)
        ? { workflowName: stringValue(record.workflowName) || stringValue(record.workflow_name) }
        : {})
    }
  })
}

function childFromCollabAgentToolCall(
  item: Record<string, unknown>,
  context: CodexEventNormalizeContext,
  lifecycle: 'running' | 'completed',
  parentThreadId: string,
  parentTurnId: string
): CodexNormalizedChild | null {
  const receiverThreadIds = receiverThreadIdsFromItem(item)
  const childThreadId = receiverThreadIds[0]
  const id = stringValue(item.id) ||
    stringValue(item.callId) ||
    stringValue(item.call_id) ||
    childThreadId
  const resolvedParentThreadId = parentThreadId || stringValue(context.threadId)
  if (!id || !resolvedParentThreadId) return null
  const resolvedParentTurnId = parentTurnId || stringValue(context.turnId)
  const name = stringValue(item.agentNickname) ||
    stringValue(item.agent_nickname) ||
    stringValue(item.agentName) ||
    stringValue(item.agent_name) ||
    stringValue(item.name)
  const role = stringValue(item.agentRole) ||
    stringValue(item.agent_role) ||
    stringValue(item.role) ||
    stringValue(item.label)
  const status = childStatus(item, lifecycle)
  return withCleanMetadata({
    id,
    runtimeId: 'codex',
    parentThreadId: resolvedParentThreadId,
    ...(resolvedParentTurnId ? { parentTurnId: resolvedParentTurnId } : {}),
    kind: 'agent',
    status,
    ...(name ? { name } : {}),
    ...(role ? { label: role } : {}),
    ...(childPrompt(item) ? { prompt: childPrompt(item) } : {}),
    ...(childSummary(item) ? { summary: childSummary(item) } : {}),
    ...(usageFromRecord(item) ? { usage: usageFromRecord(item) } : {}),
    ...(childThreadId ? { transcriptRef: runtimeTranscriptRef(id, childThreadId) } : {}),
    ...(childThreadId ? { openAsThreadRef: openAsThreadRef(childThreadId) } : {}),
    ...(eventIso(item.createdAt) ? { createdAt: eventIso(item.createdAt) } : {}),
    ...(eventIso(item.startedAt) ? { startedAt: eventIso(item.startedAt) } : {}),
    ...(eventIso(item.updatedAt) ? { updatedAt: eventIso(item.updatedAt) } : {}),
    ...(status === 'completed' && eventIso(item.completedAt) ? { completedAt: eventIso(item.completedAt) } : {}),
    metadata: {
      toolType: 'collabAgentToolCall',
      threadSource: threadSource(item),
      receiverThreadIds,
      ...(name ? { agentNickname: name } : {}),
      ...(role ? { agentRole: role } : {})
    }
  })
}

function collabAgentToolMetadata(item: Record<string, unknown>): Record<string, unknown> {
  const receiverThreadIds = receiverThreadIdsFromItem(item)
  const agentNickname = stringValue(item.agentNickname) || stringValue(item.agent_nickname)
  const agentRole = stringValue(item.agentRole) || stringValue(item.agent_role)
  const source = threadSource(item)
  return {
    ...(receiverThreadIds.length ? { receiverThreadIds } : {}),
    ...(agentNickname ? { agentNickname } : {}),
    ...(agentRole ? { agentRole } : {}),
    ...(source ? { threadSource: source } : {})
  }
}

function threadSource(record: Record<string, unknown>): string {
  return stringValue(record.threadSource) ||
    stringValue(record.thread_source) ||
    stringValue(asRecord(record.thread)?.threadSource) ||
    stringValue(asRecord(record.thread)?.thread_source)
}

function normalizedThreadSource(record: Record<string, unknown>): string {
  return threadSource(record).trim().toLowerCase()
}

function isNativeThreadChildSource(source: string): boolean {
  return source === 'subagent' || source === 'workflow' || source === 'local_workflow'
}

function childKindFromThreadSource(source: string): CodexNormalizedChild['kind'] {
  return source === 'workflow' || source === 'local_workflow' ? 'workflow' : 'thread'
}

function receiverThreadIdsFromItem(item: Record<string, unknown>): string[] {
  return uniqueStrings([
    ...stringsFromValue(item.receiverThreadIds),
    ...stringsFromValue(item.receiver_thread_ids),
    stringValue(item.receiverThreadId),
    stringValue(item.receiver_thread_id),
    stringValue(asRecord(item.receiverThread)?.id),
    stringValue(asRecord(item.receiver_thread)?.id)
  ])
}

function stringsFromValue(value: unknown): string[] {
  if (typeof value === 'string') return [value.trim()].filter(Boolean)
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim()
      return stringValue(asRecord(entry)?.id)
    })
    .filter(Boolean)
}

function uniqueStrings(values: string[]): string[] {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function childPrompt(record: Record<string, unknown>): string {
  const args = recordArguments(record)
  return stringValue(record.prompt) ||
    stringValue(record.input) ||
    stringValue(record.instructions) ||
    stringValue(record.task) ||
    stringValue(args?.prompt) ||
    stringValue(args?.input) ||
    stringValue(args?.instructions) ||
    stringValue(args?.task)
}

function childSummary(record: Record<string, unknown>): string {
  const result = asRecord(record.result)
  return stringValue(record.summary) ||
    stringValue(record.preview) ||
    stringValue(record.output) ||
    stringValue(record.message) ||
    stringValue(record.text) ||
    stringValue(result?.summary) ||
    stringValue(result?.output) ||
    stringValue(result?.message) ||
    stringValue(result?.text) ||
    contentItemsText(record.contentItems) ||
    contentItemsText(result?.contentItems)
}

function contentItemsText(value: unknown): string {
  return arrayValue(value)
    .map((entry) => {
      if (typeof entry === 'string') return entry
      const record = asRecord(entry)
      return stringValue(record?.text) || stringValue(record?.content) || stringValue(record?.output)
    })
    .filter(Boolean)
    .join('\n')
}

function recordArguments(record: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(record.arguments) ||
    asRecord(record.args) ||
    asRecord(record.input) ||
    parseJsonObject(stringValue(record.arguments)) ||
    parseJsonObject(stringValue(record.args)) ||
    parseJsonObject(stringValue(record.input))
}

function childStatus(
  record: Record<string, unknown>,
  lifecycle: 'running' | 'completed'
): CodexNormalizedChild['status'] {
  const status = stringValue(record.status).toLowerCase()
  if (status === 'queued' || status === 'pending') return 'queued'
  if (status === 'running' || status === 'inprogress' || status === 'in_progress' || status === 'started') return 'running'
  if (status === 'completed' || status === 'complete' || status === 'success' || status === 'succeeded' || status === 'done') {
    return 'completed'
  }
  if (status === 'failed' || status === 'error' || status === 'declined') return 'failed'
  if (status === 'aborted' || status === 'cancelled' || status === 'canceled' || status === 'interrupted') return 'aborted'
  if (typeof record.exitCode === 'number' && record.exitCode !== 0) return 'failed'
  return lifecycle === 'completed' ? 'completed' : 'running'
}

function usageFromRecord(record: Record<string, unknown>): CodexNormalizedChild['usage'] | undefined {
  const usage = asRecord(record.usage) ??
    asRecord(record.tokenUsage) ??
    asRecord(record.token_usage) ??
    asRecord(asRecord(record.result)?.usage) ??
    asRecord(asRecord(record.result)?.tokenUsage) ??
    asRecord(asRecord(record.result)?.token_usage)
  if (!usage) return undefined
  const inputTokens = integerValue(
    usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens ?? usage.prompt_tokens
  )
  const outputTokens = integerValue(
    usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens ?? usage.completion_tokens
  )
  const reasoningTokens = integerValue(
    usage.reasoningTokens ?? usage.reasoning_tokens ?? usage.reasoningOutputTokens ?? usage.reasoning_output_tokens
  )
  const totalTokens = integerValue(usage.totalTokens ?? usage.total_tokens) ||
    inputTokens + outputTokens + reasoningTokens
  const cacheReadTokens = integerValue(usage.cacheReadTokens ?? usage.cache_read_tokens ?? usage.cachedInputTokens)
  const cacheWriteTokens = integerValue(usage.cacheWriteTokens ?? usage.cache_write_tokens)
  if (inputTokens + outputTokens + reasoningTokens + totalTokens + cacheReadTokens + cacheWriteTokens <= 0) {
    return undefined
  }
  return {
    ...(inputTokens ? { inputTokens } : {}),
    ...(outputTokens ? { outputTokens } : {}),
    ...(reasoningTokens ? { reasoningTokens } : {}),
    ...(totalTokens ? { totalTokens } : {}),
    ...(cacheReadTokens ? { cacheReadTokens } : {}),
    ...(cacheWriteTokens ? { cacheWriteTokens } : {})
  }
}

function runtimeTranscriptRef(
  childId: string,
  transcriptId: string
): NonNullable<CodexNormalizedChild['transcriptRef']> {
  return {
    id: `codex-child:${childId}`,
    kind: 'runtime',
    runtimeId: 'codex',
    childId,
    transcriptId,
    source: 'codex-app-server'
  } as NonNullable<CodexNormalizedChild['transcriptRef']>
}

function openAsThreadRef(threadId: string): NonNullable<CodexNormalizedChild['openAsThreadRef']> {
  return {
    runtimeId: 'codex',
    threadId,
    relation: 'side'
  } as NonNullable<CodexNormalizedChild['openAsThreadRef']>
}

function withCleanMetadata(child: CodexNormalizedChild): CodexNormalizedChild {
  const metadata = asRecord(child.metadata)
  if (!metadata) return child
  const cleaned = Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => {
      if (Array.isArray(value)) return value.length > 0
      return value !== undefined && value !== null && value !== ''
    })
  )
  if (Object.keys(cleaned).length > 0) return { ...child, metadata: cleaned }
  const { metadata: _metadata, ...withoutMetadata } = child
  return withoutMetadata
}

function eventIso(value: unknown): string | undefined {
  if (typeof value === 'string' && value.trim()) return value
  if (typeof value === 'number' && Number.isFinite(value)) {
    return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString()
  }
  return undefined
}

function isAgentMessageDelta(method: string): boolean {
  return method === 'item/agentMessage/delta' ||
    method === 'item/agentMessage/textDelta' ||
    method === 'item/agentMessage/contentDelta' ||
    method === 'item/assistantMessage/delta' ||
    method === 'item/assistantMessage/textDelta' ||
    method === 'item/assistantMessage/contentDelta'
}

function isReasoningDelta(method: string): boolean {
  return method === 'item/reasoning/textDelta' ||
    method === 'item/reasoning/summaryTextDelta' ||
    method === 'item/reasoning/delta' ||
    method === 'item/reasoning/summaryDelta' ||
    method === 'item/reasoning/contentDelta' ||
    method === 'item/agentReasoning/delta' ||
    method === 'item/agentReasoning/textDelta'
}

function normalizeRuntimeErrorCode(code: string, message: string): string {
  const normalizedCode = code.trim()
  if (normalizedCode) return normalizedCode
  const lowered = message.toLowerCase()
  if (
    lowered.includes('provider_http_401') ||
    lowered.includes('provider_http_403') ||
    lowered.includes('provider auth') ||
    lowered.includes('provider credentials')
  ) {
    return 'provider_auth_blocked'
  }
  return ''
}

function transientRuntimeStatusPhase(
  code: string,
  message: string
): NonNullable<CodexThreadEventPayload['runtimeStatus']>['phase'] | null {
  const normalizedCode = code.trim().toLowerCase()
  if (normalizedCode === 'reconnecting') return 'reconnecting'
  if (normalizedCode === 'tool_waiting') return 'tool_waiting'
  if (normalizedCode === 'stream_recovering') return 'stream_recovering'
  if (/^Reconnecting\.\.\.\s+\d+\s*\/\s*\d+$/iu.test(message.trim())) return 'reconnecting'
  return null
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

function sessionThreadId(
  payload: Record<string, unknown>,
  context: CodexEventNormalizeContext
): string {
  return stringValue(payload.threadId) ||
    stringValue(payload.thread_id) ||
    stringValue(asRecord(payload.thread)?.id) ||
    stringValue(context.threadId)
}

function sessionTurnId(
  payload: Record<string, unknown>,
  context: CodexEventNormalizeContext
): string {
  return stringValue(payload.turnId) ||
    stringValue(payload.turn_id) ||
    stringValue(asRecord(payload.turn)?.id) ||
    stringValue(context.turnId)
}

function deltaText(params: Record<string, unknown>): string {
  return stringValue(params.delta) ||
    stringValue(params.text) ||
    stringValue(params.content) ||
    stringValue(params.summary)
}

function responseMessageText(payload: Record<string, unknown>): string {
  if (typeof payload.content === 'string') return payload.content
  return arrayValue(payload.content)
    .map(contentText)
    .filter(Boolean)
    .join('\n')
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value
  const entry = asRecord(value)
  if (!entry) return ''
  return stringValue(entry.text) ||
    stringValue(entry.output) ||
    stringValue(entry.content) ||
    outputText(entry.output)
}

function reasoningText(payload: Record<string, unknown>): string {
  return [...arrayValue(payload.summary), ...arrayValue(payload.content)]
    .map((entry) => {
      if (typeof entry === 'string') return entry
      const record = asRecord(entry)
      return stringValue(record?.text) ||
        stringValue(record?.summary) ||
        stringValue(record?.content)
    })
    .filter(Boolean)
    .join('\n')
}

function toolKindForFunction(
  toolName: string
): NonNullable<CodexThreadEventPayload['tool']>['toolKind'] {
  if (toolName === 'exec_command') return 'command_execution'
  if (toolName === 'apply_patch') return 'file_change'
  return 'tool_call'
}

function toolCallDetail(
  args: Record<string, unknown> | null,
  payload: Record<string, unknown>
): string {
  if (args) return JSON.stringify(args, null, 2)
  return stringValue(payload.arguments)
}

type CodexToolExecutionPhase = 'requested' | 'dispatched' | 'succeeded' | 'failed' | 'cancelled' | 'unresolved'
type CodexToolFactSource = 'model_output' | 'runtime_lifecycle' | 'executor_result' | 'host_synthetic'
type CodexToolEvidenceStrength = 'intent' | 'runtime_lifecycle' | 'executor_receipt' | 'attested'

function toolExecutionMeta(input: {
  callId: string
  toolName?: string
  phase: CodexToolExecutionPhase
  factSource: CodexToolFactSource
  evidenceStrength: CodexToolEvidenceStrength
  success?: boolean
}): Record<string, unknown> {
  return {
    callId: input.callId,
    ...(input.toolName ? { toolName: input.toolName } : {}),
    phase: input.phase,
    factSource: input.factSource,
    evidenceStrength: input.evidenceStrength,
    ...(typeof input.success === 'boolean' ? { success: input.success } : {})
  }
}

function terminalAwareToolExecutionMeta(
  callId: string,
  toolName: string,
  status: NonNullable<CodexThreadEventPayload['tool']>['status']
): Record<string, unknown> {
  if (status === 'running') {
    return toolExecutionMeta({
      callId,
      toolName,
      phase: 'dispatched',
      factSource: 'runtime_lifecycle',
      evidenceStrength: 'runtime_lifecycle'
    })
  }
  return toolExecutionMeta({
    callId,
    toolName,
    phase: status === 'success' ? 'succeeded' : 'failed',
    factSource: 'executor_result',
    evidenceStrength: 'executor_receipt',
    success: status === 'success'
  })
}

function toolItemCallId(item: Record<string, unknown>, fallback: string): string {
  return stringValue(item.callId) || stringValue(item.call_id) || stringValue(item.id) || fallback
}

function toolOutputStatus(
  payload: Record<string, unknown>,
  output: string
): NonNullable<CodexThreadEventPayload['tool']>['status'] {
  if (typeof payload.success === 'boolean') return payload.success ? 'success' : 'error'
  if (payload.error !== undefined && payload.error !== null) return 'error'
  const status = stringValue(payload.status).toLowerCase()
  if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') return 'error'
  if (status === 'completed' || status === 'success' || status === 'succeeded') return 'success'
  const exitCode = output.match(/Process exited with code\s+(-?\d+)/i)
  if (!exitCode) return 'success'
  return exitCode[1] === '0' ? 'success' : 'error'
}

function localShellCallStatus(
  payload: Record<string, unknown>
): NonNullable<CodexThreadEventPayload['tool']>['status'] {
  const status = stringValue(payload.status).toLowerCase()
  if (status === 'failed' || status === 'error' || status === 'cancelled' || status === 'canceled') return 'error'
  if (typeof payload.exit_code === 'number' && payload.exit_code !== 0) return 'error'
  if (typeof payload.exitCode === 'number' && payload.exitCode !== 0) return 'error'
  if (status === 'completed' || status === 'success' || status === 'succeeded') return 'success'
  return 'running'
}

function threadItemStatus(
  item: Record<string, unknown>,
  lifecycle: 'running' | 'completed'
): NonNullable<CodexThreadEventPayload['tool']>['status'] {
  const status = stringValue(item.status)
  if (status === 'failed' || status === 'declined' || status === 'error') return 'error'
  if (item.error !== undefined && item.error !== null) return 'error'
  if (typeof item.success === 'boolean' && !item.success) return 'error'
  if (typeof item.exitCode === 'number' && item.exitCode !== 0) return 'error'
  if (status === 'completed' || lifecycle === 'completed') return 'success'
  return 'running'
}

function outputText(value: unknown): string {
  if (typeof value === 'string') return value
  return arrayValue(value)
    .map(asRecord)
    .filter(Boolean)
    .map((entry) => stringValue(entry?.text))
    .filter(Boolean)
    .join('\n')
}

function threadItemJsonDetail(value: unknown): string | undefined {
  if (value === undefined || value === null) return undefined
  if (typeof value === 'string') return value
  try {
    const detail = JSON.stringify(redactImagePayloads(value), null, 2)
    return detail === undefined ? undefined : detail
  } catch {
    return undefined
  }
}

function redactImagePayloads(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactImagePayloads)
  const record = asRecord(value)
  if (!record) return value
  const output: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(record)) {
    if (key === 'imageUrl' && typeof entry === 'string' && entry.startsWith('data:')) {
      output[key] = '[image data omitted]'
      continue
    }
    if (key === 'data' && record.type === 'image') {
      output[key] = '[image data omitted]'
      continue
    }
    if (key === 'data_base64') {
      output[key] = '[image data omitted]'
      continue
    }
    output[key] = redactImagePayloads(entry)
  }
  return output
}

function tokenUsageFromParams(params: Record<string, unknown>): NonNullable<CodexThreadEventPayload['usage']> | null {
  const tokenUsage = asRecord(params.tokenUsage)
  const breakdown = asRecord(tokenUsage?.last) ?? asRecord(tokenUsage?.total)
  if (!breakdown) return null
  const inputTokens = integerValue(breakdown.inputTokens)
  const cachedInputTokens = integerValue(breakdown.cachedInputTokens)
  const outputTokens = integerValue(breakdown.outputTokens)
  const reasoningTokens = integerValue(breakdown.reasoningOutputTokens)
  const totalTokens = integerValue(breakdown.totalTokens) || inputTokens + outputTokens + reasoningTokens
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    cacheReadTokens: cachedInputTokens,
    cacheWriteTokens: Math.max(0, inputTokens - cachedInputTokens),
    modelContextWindow: nullableInteger(tokenUsage?.modelContextWindow)
  }
}

function tokenUsageFromSessionInfo(info: Record<string, unknown> | null): NonNullable<CodexThreadEventPayload['usage']> | null {
  if (!info) return null
  const usage = asRecord(info.last_token_usage) ?? asRecord(info.total_token_usage)
  if (!usage) return null
  const inputTokens = integerValue(usage.input_tokens)
  const cachedInputTokens = integerValue(usage.cached_input_tokens)
  const outputTokens = integerValue(usage.output_tokens)
  const reasoningTokens = integerValue(usage.reasoning_output_tokens)
  const totalTokens = integerValue(usage.total_tokens) || inputTokens + outputTokens + reasoningTokens
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    totalTokens,
    cacheReadTokens: cachedInputTokens,
    cacheWriteTokens: Math.max(0, inputTokens - cachedInputTokens),
    modelContextWindow: nullableInteger(info.model_context_window)
  }
}

function integerValue(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0
}

function nullableInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : null
}

function secondsToIso(value: unknown): string | undefined {
  return typeof value === 'number' && Number.isFinite(value)
    ? new Date(value * 1000).toISOString()
    : undefined
}

function arrayValue(value: unknown): unknown[] {
  return Array.isArray(value) ? value : []
}

function parseJsonObject(value: string): Record<string, unknown> | null {
  if (!value.trim()) return null
  try {
    return asRecord(JSON.parse(value))
  } catch {
    return null
  }
}

function runtimeStatusItemId(threadId: string, turnId: string, phase: string): string {
  return `codex-runtime-status-${turnId || threadId}-${phase}`
}
