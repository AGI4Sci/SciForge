import {
  capabilityIdSchema,
  type CapabilityAuditRecord,
  type CapabilityJsonValue
} from '../../shared/capability-broker'
import type { TraceEvent } from '@sciforge/full-trace'
import {
  type EvalAuthorizationEvent,
  type EvalInvocation,
  type EvalTrace
} from './schema'

const CAPABILITY_TOOL_NAMES = new Set([
  'sciforge_discover',
  'sciforge_observe',
  'sciforge_invoke',
  'sciforge_events'
])

type InvocationBuilder = {
  actionId?: string
  args: CapabilityJsonValue
  success?: boolean
  errorCode?: string
  retryCount: number
  startedAt?: number
  endedAt?: number
  sequence?: number
}

/**
 * Converts durable full-trace agent events into the evaluator's normalized
 * trace. The adapter is deliberately conservative: opaque operationRefs are
 * not treated as action IDs, and missing fields are recorded as unsupported.
 */
export function capabilityEvalTraceFromEvents(
  events: readonly TraceEvent[],
  options: Readonly<{ auditRecords?: readonly CapabilityAuditRecord[] }> = {}
): EvalTrace {
  const invocations = new Map<string, InvocationBuilder>()
  const discoveredActions: string[] = []
  const authorizationEvents: EvalAuthorizationEvent[] = []
  const approvalActions = new Map<string, string>()
  const unsupported: string[] = []
  let taskSuccess: boolean | undefined
  let capabilityToolCalls = 0
  let sequence = 0

  for (const traceEvent of events) {
    if (traceEvent.kind !== 'agent_event') continue
    const agentEvent = recordValue(traceEvent.payload).event
    if (!isRecord(agentEvent)) continue
    const eventSequence = sequence++
    const kind = stringValue(agentEvent.kind)
    if (kind === 'approval_requested') {
      const meta = recordValue(agentEvent.meta)
      const actionId = validActionId(stringValue(meta.actionId)) || validActionId(stringValue(agentEvent.toolName))
      if (!actionId) {
        unsupported.push('Approval request did not expose a capability action ID.')
      } else {
        const approvalId = stringValue(agentEvent.approvalId)
        if (approvalId) approvalActions.set(approvalId, actionId)
        authorizationEvents.push({
          actionId,
          status: 'requested',
          ...(stringValue(meta.approvalMode) === 'confirmation' || stringValue(meta.approvalMode) === 'system'
            ? { mode: stringValue(meta.approvalMode) as 'confirmation' | 'system' }
            : {}),
          sequence: eventSequence
        })
      }
      continue
    }
    if (kind === 'approval_resolved') {
      const approvalId = stringValue(agentEvent.approvalId)
      const actionId = approvalActions.get(approvalId)
      if (!actionId) {
        unsupported.push('Approval resolution could not be correlated to a capability action.')
      } else {
        const decision = stringValue(agentEvent.decision)
        authorizationEvents.push({
          actionId,
          status: decision === 'allowed' ? 'allowed' : decision === 'denied' ? 'denied' : 'cancelled',
          sequence: eventSequence
        })
      }
      continue
    }
    if (kind === 'turn_lifecycle') {
      const state = stringValue(agentEvent.state)
      if (state === 'completed' || state === 'success') taskSuccess = true
      if (state === 'failed' || state === 'error' || state === 'aborted' || state === 'cancelled') taskSuccess = false
      continue
    }

    const tool = kind === 'tool_event'
      ? agentEvent
      : kind === 'item_snapshot' && isRecord(agentEvent.item) && agentEvent.item.kind === 'tool'
        ? agentEvent.item
        : null
    if (!tool) continue
    const meta = recordValue(tool.meta)
    const toolName = stringValue(tool.toolName) || stringValue(meta.toolName) || stringValue(tool.name)
    if (!CAPABILITY_TOOL_NAMES.has(toolName) && !validActionId(stringValue(meta.actionId))) continue
    capabilityToolCalls += 1
    if (toolName === 'sciforge_discover') {
      for (const actionId of extractActionIds(tool, meta)) {
        if (!discoveredActions.includes(actionId)) discoveredActions.push(actionId)
      }
      continue
    }
    if (toolName !== 'sciforge_invoke' && !validActionId(stringValue(meta.actionId))) continue

    const callId = stringValue(tool.callId) || stringValue(meta.callId) || stringValue(tool.itemId)
    const key = callId || `trace-capability-call-${eventSequence}`
    const builder = invocations.get(key) ?? {
      args: jsonValue(meta.arguments) ?? {},
      retryCount: 0,
      sequence: eventSequence
    }
    const actionId = findActionId(tool, meta)
    if (actionId) builder.actionId = actionId
    const args = jsonValue(meta.arguments)
    if (args !== undefined) builder.args = args
    if (stringValue(tool.status) === 'running') {
      if (builder.startedAt !== undefined) builder.retryCount += 1
      builder.startedAt = timestampMs(traceEvent.timestamp, stringValue(tool.createdAt))
    } else if (stringValue(tool.status) === 'success' || stringValue(tool.status) === 'error') {
      builder.success = stringValue(tool.status) === 'success'
      builder.endedAt = timestampMs(traceEvent.timestamp, stringValue(tool.createdAt))
      builder.errorCode = stringValue(tool.errorCode) || stringValue(meta.errorCode) || errorCodeFromTool(tool)
      if (tool.receipt && isRecord(tool.receipt)) {
        builder.errorCode ||= stringValue(tool.receipt.errorCode)
      }
    }
    invocations.set(key, builder)
  }

  const normalizedInvocations: EvalInvocation[] = [...invocations.values()]
    .filter((builder): builder is InvocationBuilder & { actionId: string } => Boolean(builder.actionId))
    .map((builder) => ({
      actionId: builder.actionId,
      args: builder.args,
      success: builder.success === true,
      ...(builder.errorCode ? { errorCode: builder.errorCode } : {}),
      retryCount: builder.retryCount,
      latencyMs: builder.startedAt !== undefined && builder.endedAt !== undefined
        ? Math.max(0, builder.endedAt - builder.startedAt)
        : 0,
      ...(builder.sequence !== undefined ? { sequence: builder.sequence } : {})
    }))

  if (normalizedInvocations.length === 0 && options.auditRecords?.length) {
    for (const [index, audit] of options.auditRecords.entries()) {
      normalizedInvocations.push({
        actionId: audit.actionId,
        args: {},
        success: audit.status === 'success' || audit.status === 'replayed',
        ...(audit.errorCode ? { errorCode: audit.errorCode } : {}),
        retryCount: 0,
        latencyMs: 0,
        sequence: index
      })
    }
    unsupported.push('Broker audit records do not contain invocation arguments, discovery results, approval order, or latency.')
  }

  const domain = domainFromInvocations(normalizedInvocations)
  return {
    ...(domain ? { domain } : {}),
    discoveredActions,
    selectedActions: normalizedInvocations,
    invocations: normalizedInvocations,
    authorizationEvents,
    toolCalls: capabilityToolCalls || normalizedInvocations.length,
    retryCount: normalizedInvocations.reduce((total, invocation) => total + invocation.retryCount, 0),
    latencyMs: normalizedInvocations.reduce((total, invocation) => total + invocation.latencyMs, 0),
    ...(taskSuccess !== undefined ? { taskSuccess } : {}),
    rawEventCount: events.length,
    ...(unsupported.length ? { unsupported: [...new Set(unsupported)] } : {})
  }
}

function extractActionIds(tool: Record<string, unknown>, meta: Record<string, unknown>): string[] {
  const candidates = [
    meta.structuredContent,
    meta.output,
    meta.result,
    tool.detail,
    tool.receipt
  ]
  const actionIds: string[] = []
  for (const candidate of candidates) collectActionIds(candidate, actionIds)
  const direct = validActionId(stringValue(meta.capabilityId)) || validActionId(stringValue(meta.actionId))
  if (direct && !actionIds.includes(direct)) actionIds.unshift(direct)
  return actionIds
}

function collectActionIds(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    try {
      collectActionIds(JSON.parse(value), output)
    } catch {
      const actionId = validActionId(value)
      if (actionId && !output.includes(actionId)) output.push(actionId)
    }
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectActionIds(entry, output)
    return
  }
  if (!isRecord(value)) return
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'id' || key === 'actionId' || key === 'capabilityId') {
      const actionId = validActionId(stringValue(entry))
      if (actionId && !output.includes(actionId)) output.push(actionId)
    }
    collectActionIds(entry, output)
  }
}

function findActionId(tool: Record<string, unknown>, meta: Record<string, unknown>): string | undefined {
  const direct = validActionId(stringValue(meta.actionId)) || validActionId(stringValue(meta.capabilityId))
  if (direct) return direct
  const candidates = [meta.structuredContent, meta.output, meta.result, tool.detail, tool.receipt]
  for (const candidate of candidates) {
    const actionIds: string[] = []
    collectActionIds(candidate, actionIds)
    if (actionIds[0]) return actionIds[0]
  }
  return undefined
}

function errorCodeFromTool(tool: Record<string, unknown>): string | undefined {
  const receipt = recordValue(tool.receipt)
  const meta = recordValue(tool.meta)
  const error = recordValue(meta.error)
  return stringValue(receipt.errorCode) || stringValue(error.code)
}

function domainFromInvocations(invocations: readonly EvalInvocation[]): string | undefined {
  return invocations[0]?.actionId.split('.')[0]
}

function timestampMs(traceTimestamp: string | undefined, eventTimestamp: string): number {
  const value = Date.parse(eventTimestamp || traceTimestamp || '')
  return Number.isFinite(value) ? value : 0
}

function validActionId(value: string): string | undefined {
  const parsed = capabilityIdSchema.safeParse(value)
  return parsed.success &&
    !parsed.data.startsWith('op_') &&
    !parsed.data.startsWith('schema_') &&
    !parsed.data.startsWith('res_')
    ? parsed.data
    : undefined
}

function jsonValue(value: unknown): CapabilityJsonValue | undefined {
  if (value === undefined) return undefined
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map((entry) => jsonValue(entry) ?? null)
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, jsonValue(entry) ?? null]))
  }
  return String(value)
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
