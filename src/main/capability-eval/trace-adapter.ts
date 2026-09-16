import {
  capabilityIdSchema,
  type CapabilityAuditRecord,
  type CapabilityJsonValue
} from '../../shared/capability-broker'
import type { TraceEvent } from '@sciforge/full-trace'
import {
  type EvalAuthorizationEvent,
  type EvalInvocation,
  type EvalProviderAttempt,
  type EvalToolCallDetail,
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
  operationRef?: string
  args: CapabilityJsonValue
  logicalInvocationId: string
  providerAttempts: AttemptBuilder[]
  success?: boolean
  errorCode?: string
  retryCount: number
  startedAt?: number
  endedAt?: number
  sequence?: number
  lastStatus?: 'running' | 'success' | 'error'
}

type AttemptBuilder = {
  attempt: number
  success?: boolean
  errorCode?: string
  startedAt?: number
  endedAt?: number
  sequence?: number
}

/**
 * Converts durable full-trace agent events into the evaluator's normalized
 * trace. Host-emitted capability identities are authoritative for both success
 * and failure events. The later-receipt correlation remains only as a
 * compatibility fallback for older traces that predate the Host mapping.
 */
export function capabilityEvalTraceFromEvents(
  events: readonly TraceEvent[],
  options: Readonly<{
    auditRecords?: readonly CapabilityAuditRecord[]
    knownActionIds?: ReadonlySet<string>
  }> = {}
): EvalTrace {
  const resolveKnownActionId = (value: string): string | undefined => resolveActionId(value, options.knownActionIds)
  const invocations = new Map<string, InvocationBuilder>()
  const toolCallDetails = new Map<string, EvalToolCallDetail>()
  const discoveredActions: string[] = []
  const discoveredOperationRefs = new Set<string>()
  const actionIdsByOperationRef = new Map<string, string>()
  const authorizationEvents: EvalAuthorizationEvent[] = []
  const approvalActions = new Map<string, string>()
  const assistantMessageSnapshots = new Map<string, { sequence: number; text: string }>()
  const assistantDeltas: string[] = []
  const unsupported: string[] = []
  let executionStatus: EvalTrace['executionStatus']
  let explicitAttemptObserved = false
  const capabilityToolCalls = new Set<string>()
  let sequence = 0

  for (const traceEvent of events) {
    if (traceEvent.kind !== 'agent_event') continue
    const agentEvent = recordValue(traceEvent.payload).event
    if (!isRecord(agentEvent)) continue
    const eventSequence = sequence++
    const kind = stringValue(agentEvent.kind)
    if (kind === 'assistant_delta') {
      const text = stringValue(agentEvent.text)
      if (text) assistantDeltas.push(text)
      continue
    }
    if (kind === 'item_snapshot' && isRecord(agentEvent.item) && agentEvent.item.kind === 'assistant_message') {
      const item = recordValue(agentEvent.item)
      const text = stringValue(item.text)
      if (text) {
        const itemId = stringValue(item.id) || `assistant-message-${eventSequence}`
        assistantMessageSnapshots.set(itemId, { sequence: eventSequence, text })
      }
      continue
    }
    if (kind === 'approval_requested') {
      const meta = recordValue(agentEvent.meta)
      const actionId = resolveKnownActionId(stringValue(meta.actionId)) || resolveKnownActionId(stringValue(agentEvent.toolName))
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
      executionStatus = normalizeExecutionStatus(state)
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
    const detailKey = stringValue(tool.callId) || stringValue(meta.callId) || stringValue(tool.itemId) || stringValue(tool.id) || `trace-tool-${eventSequence}`
    const previousDetail = toolCallDetails.get(detailKey)
    const toolStatus = stringValue(tool.status)
    const toolArgs = jsonValue(meta.arguments)
    const toolError = stringValue(tool.errorCode) || stringValue(meta.errorCode) || errorCodeFromTool(tool)
    const capabilityIdentity = capabilityIdentityFromTool(tool, meta, options.knownActionIds)
    const toolOperationRef = capabilityIdentity?.operationRef || stringValue(recordValue(meta.arguments).operationRef)
    toolCallDetails.set(detailKey, {
      ...previousDetail,
      callId: detailKey,
      toolName: toolName || previousDetail?.toolName || 'unknown',
      status: toolStatus === 'running' || toolStatus === 'success' || toolStatus === 'error'
        ? toolStatus : previousDetail?.status ?? 'unknown',
      sequence: previousDetail?.sequence ?? eventSequence,
      ...(toolArgs !== undefined ? { args: toolArgs } : {}),
      ...(toolOperationRef ? { operationRef: toolOperationRef } : {}),
      ...(capabilityIdentity?.capabilityId ? { actionId: capabilityIdentity.capabilityId } : {}),
      ...(toolError ? { errorCode: toolError } : {})
    })
    if (!CAPABILITY_TOOL_NAMES.has(toolName) && !resolveKnownActionId(stringValue(meta.actionId))) continue
    const toolCallKey = stringValue(tool.callId) || stringValue(meta.callId) || stringValue(tool.itemId)
    capabilityToolCalls.add(toolCallKey || `trace-capability-tool-${eventSequence}`)
    if (toolName === 'sciforge_discover') {
      for (const operationRef of extractOperationRefs(tool, meta)) {
        discoveredOperationRefs.add(operationRef)
        const requestedActionId = resolveKnownActionId(stringValue(recordValue(meta.arguments).capabilityId))
        if (requestedActionId) rememberOperationAction(
          actionIdsByOperationRef,
          operationRef,
          requestedActionId,
          unsupported
        )
      }
      for (const actionId of extractActionIds(tool, meta, options.knownActionIds)) {
        if (!discoveredActions.includes(actionId)) discoveredActions.push(actionId)
      }
      continue
    }
    if (toolName !== 'sciforge_invoke' && !resolveKnownActionId(stringValue(meta.actionId))) continue

    const callId = stringValue(tool.callId) || stringValue(meta.callId) || stringValue(tool.itemId)
    const key = callId || `trace-capability-call-${eventSequence}`
    const builder = invocations.get(key) ?? {
      args: invocationArguments(meta),
      logicalInvocationId: key,
      providerAttempts: [],
      retryCount: 0,
      sequence: eventSequence
    }
    const actionId = capabilityIdentity?.capabilityId || findActionId(tool, meta, options.knownActionIds)
    if (actionId) builder.actionId = actionId
    const operationRef = operationRefFrom(meta)
    if (operationRef) builder.operationRef = operationRef
    if (operationRef && actionId) rememberOperationAction(
      actionIdsByOperationRef,
      operationRef,
      actionId,
      unsupported
    )
    if (meta.arguments !== undefined) builder.args = invocationArguments(meta)
    const explicitAttempt = positiveInteger(tool.attempt) ?? positiveInteger(meta.attempt)
    if (explicitAttempt !== undefined) explicitAttemptObserved = true
    if (stringValue(tool.status) === 'running') {
      const lastAttempt = builder.providerAttempts.at(-1)
      const attemptNumber = explicitAttempt ?? (
        builder.lastStatus === 'running'
          ? lastAttempt?.attempt ?? 1
          : (lastAttempt?.attempt ?? 0) + 1
      )
      const startsNewAttempt = !lastAttempt || attemptNumber > lastAttempt.attempt
      if (startsNewAttempt) {
        const attempt: AttemptBuilder = {
          attempt: attemptNumber,
          startedAt: timestampMs(traceEvent.timestamp, stringValue(tool.createdAt)),
          sequence: eventSequence
        }
        builder.providerAttempts.push(attempt)
        builder.retryCount = Math.max(builder.retryCount, attemptNumber - 1)
      }
      if (builder.lastStatus !== 'running') {
        builder.startedAt ??= timestampMs(traceEvent.timestamp, stringValue(tool.createdAt))
      }
      builder.lastStatus = 'running'
    } else if (stringValue(tool.status) === 'success' || stringValue(tool.status) === 'error') {
      const success = stringValue(tool.status) === 'success'
      const lastAttempt = builder.providerAttempts.at(-1)
      const attemptNumber = explicitAttempt ?? lastAttempt?.attempt ?? 1
      const attempt = lastAttempt?.attempt === attemptNumber
        ? lastAttempt
        : {
            attempt: attemptNumber,
            sequence: eventSequence
          }
      if (!lastAttempt || lastAttempt.attempt !== attemptNumber) builder.providerAttempts.push(attempt)
      attempt.success = success
      attempt.errorCode = stringValue(tool.errorCode) || stringValue(meta.errorCode) || errorCodeFromTool(tool)
      if (attempt.startedAt === undefined) attempt.startedAt = builder.startedAt
      if (builder.lastStatus !== tool.status) {
        const timestamp = timestampMs(traceEvent.timestamp, stringValue(tool.createdAt))
        builder.endedAt = timestamp
        attempt.endedAt = timestamp
      }
      builder.retryCount = Math.max(builder.retryCount, attemptNumber - 1)
      builder.success = success
      if (builder.lastStatus !== tool.status) {
        builder.errorCode = attempt.errorCode
      }
      builder.lastStatus = stringValue(tool.status) as 'success' | 'error'
      builder.errorCode ||= attempt.errorCode
      if (tool.receipt && isRecord(tool.receipt)) {
        builder.errorCode ||= stringValue(tool.receipt.errorCode)
      }
    }
    invocations.set(key, builder)
  }

  // A failed invocation often exposes only the opaque operationRef in its
  // arguments. If a later retry returns a capability receipt, backfill the
  // earlier logical invocation from that exact reference instead of dropping
  // the failure from invocation metrics.
  for (const builder of invocations.values()) {
    if (builder.actionId || !builder.operationRef) continue
    const actionId = actionIdsByOperationRef.get(builder.operationRef)
    if (actionId) builder.actionId = actionId
  }

  for (const operationRef of discoveredOperationRefs) {
    const actionId = actionIdsByOperationRef.get(operationRef)
    if (actionId && !discoveredActions.includes(actionId)) discoveredActions.push(actionId)
  }

  const normalizedInvocations: EvalInvocation[] = [...invocations.values()]
    .filter((builder): builder is InvocationBuilder & { actionId: string } => Boolean(builder.actionId))
    .map((builder) => ({
      actionId: builder.actionId,
      args: builder.args,
      success: builder.success === true,
      logicalInvocationId: builder.logicalInvocationId,
      ...(builder.providerAttempts.length > 0
        ? { providerAttempts: providerAttemptsFrom(builder.providerAttempts) }
        : {}),
      ...(builder.providerAttempts.length > 0 && builder.providerAttempts[0]?.success !== undefined
        ? { firstAttemptSuccess: builder.providerAttempts[0].success }
        : {}),
      ...(builder.success !== undefined ? { eventualSuccess: builder.success } : {}),
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
  const domains = [...new Set([
    ...discoveredActions.map((actionId) => actionId.split('.')[0]),
    ...normalizedInvocations.map((invocation) => invocation.actionId.split('.')[0])
  ])]
  const traceTimes = events
    .map((event) => Date.parse(event.timestamp))
    .filter((value) => Number.isFinite(value))
  const attemptEvidence = normalizedInvocations.length === 0
    ? 'unavailable'
    : explicitAttemptObserved ? 'complete' : 'partial'
  const assistantMessages = [...assistantMessageSnapshots.values()]
    .sort((left, right) => left.sequence - right.sequence)
    .map((entry) => entry.text)
  const finalAnswer = assistantMessages.at(-1) || assistantDeltas.join('') || undefined
  return {
    ...(domain ? { domain } : {}),
    ...(domains.length > 0 ? { domains } : {}),
    discoveredActions,
    selectedActions: normalizedInvocations,
    invocations: normalizedInvocations,
    toolCallDetails: [...toolCallDetails.values()].map((detail) => {
      const actionId = invocations.get(detail.callId)?.actionId
      return actionId ? { ...detail, actionId } : detail
    }),
    authorizationEvents,
    toolCalls: toolCallDetails.size || normalizedInvocations.length,
    capabilityToolCalls: normalizedInvocations.length,
    ...(assistantMessages.length > 0 ? { assistantMessages } : {}),
    ...(finalAnswer ? { finalAnswer } : {}),
    retryCount: normalizedInvocations.reduce((total, invocation) => total + invocation.retryCount, 0),
    latencyMs: normalizedInvocations.reduce((total, invocation) => total + invocation.latencyMs, 0),
    ...(executionStatus ? { executionStatus } : {}),
    ...(traceTimes.length > 1 ? { taskLatencyMs: Math.max(...traceTimes) - Math.min(...traceTimes) } : {}),
    approvalCount: authorizationEvents.filter((event) => event.status === 'requested').length,
    attemptEvidence,
    rawEventCount: events.length,
    ...(unsupported.length ? { unsupported: [...new Set(unsupported)] } : {})
  }
}

function providerAttemptsFrom(attempts: readonly AttemptBuilder[]): EvalProviderAttempt[] {
  return attempts.map((attempt) => ({
    attempt: attempt.attempt,
    success: attempt.success === true,
    ...(attempt.errorCode ? { errorCode: attempt.errorCode } : {}),
    latencyMs: attempt.startedAt !== undefined && attempt.endedAt !== undefined
      ? Math.max(0, attempt.endedAt - attempt.startedAt)
      : 0,
    ...(attempt.sequence !== undefined ? { sequence: attempt.sequence } : {})
  }))
}

function normalizeExecutionStatus(state: string): EvalTrace['executionStatus'] | undefined {
  if (state === 'completed' || state === 'success') return 'completed'
  if (state === 'failed' || state === 'error') return 'failed'
  if (state === 'aborted' || state === 'interrupted') return 'aborted'
  if (state === 'cancelled' || state === 'canceled') return 'cancelled'
  if (state === 'running' || state === 'in_progress') return 'running'
  return undefined
}

function positiveInteger(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : undefined
}

function extractActionIds(
  tool: Record<string, unknown>,
  meta: Record<string, unknown>,
  knownActionIds?: ReadonlySet<string>
): string[] {
  const candidates = [
    meta.capabilityIdentity,
    meta.structuredContent,
    meta.output,
    meta.result,
    tool.detail,
    tool.receipt
  ]
  const actionIds: string[] = []
  for (const candidate of candidates) collectActionIds(candidate, actionIds, knownActionIds)
  const direct = resolveActionId(stringValue(meta.capabilityId), knownActionIds) || resolveActionId(stringValue(meta.actionId), knownActionIds)
  if (direct && !actionIds.includes(direct)) actionIds.unshift(direct)
  return actionIds
}

function extractOperationRefs(tool: Record<string, unknown>, meta: Record<string, unknown>): string[] {
  const candidates = [
    meta.capabilityIdentity,
    meta.arguments,
    meta.structuredContent,
    meta.output,
    meta.result,
    tool.detail,
    tool.receipt
  ]
  const operationRefs: string[] = []
  for (const candidate of candidates) collectOperationRefs(candidate, operationRefs)
  return operationRefs
}

function collectOperationRefs(value: unknown, output: string[]): void {
  if (typeof value === 'string') {
    try {
      collectOperationRefs(JSON.parse(value), output)
    } catch { /* Opaque text is not an operation reference. */ }
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectOperationRefs(entry, output)
    return
  }
  if (!isRecord(value)) return
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'operationRef' && typeof entry === 'string' && entry.startsWith('op_') && !output.includes(entry)) {
      output.push(entry)
    }
    collectOperationRefs(entry, output)
  }
}

function operationRefFrom(meta: Record<string, unknown>): string | undefined {
  const operationRefs = extractOperationRefs({}, meta)
  return operationRefs[0]
}

function rememberOperationAction(
  actionIdsByOperationRef: Map<string, string>,
  operationRef: string,
  actionId: string,
  unsupported: string[]
): void {
  const existing = actionIdsByOperationRef.get(operationRef)
  if (existing && existing !== actionId) {
    unsupported.push(`Operation reference ${operationRef} resolved to conflicting capability IDs.`)
    return
  }
  actionIdsByOperationRef.set(operationRef, actionId)
}

function collectActionIds(value: unknown, output: string[], knownActionIds?: ReadonlySet<string>): void {
  if (typeof value === 'string') {
    try {
      collectActionIds(JSON.parse(value), output, knownActionIds)
    } catch { /* Opaque text is not an action ID. */ }
    return
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectActionIds(entry, output, knownActionIds)
    return
  }
  if (!isRecord(value)) return
  for (const [key, entry] of Object.entries(value)) {
    if (key === 'id' || key === 'actionId' || key === 'capabilityId') {
      const actionId = resolveActionId(stringValue(entry), knownActionIds)
      if (actionId && !output.includes(actionId)) output.push(actionId)
    }
    collectActionIds(entry, output, knownActionIds)
  }
}

function findActionId(
  tool: Record<string, unknown>,
  meta: Record<string, unknown>,
  knownActionIds?: ReadonlySet<string>
): string | undefined {
  const capabilityIdentity = capabilityIdentityFromTool(tool, meta, knownActionIds)
  if (capabilityIdentity?.capabilityId) return capabilityIdentity.capabilityId
  const direct = resolveActionId(stringValue(meta.actionId), knownActionIds) || resolveActionId(stringValue(meta.capabilityId), knownActionIds)
  if (direct) return direct
  const candidates = [meta.structuredContent, meta.output, meta.result, tool.detail, tool.receipt]
  for (const candidate of candidates) {
    const actionIds: string[] = []
    collectActionIds(candidate, actionIds, knownActionIds)
    if (actionIds[0]) return actionIds[0]
  }
  return undefined
}

function capabilityIdentityFromTool(
  tool: Record<string, unknown>,
  meta: Record<string, unknown>,
  knownActionIds?: ReadonlySet<string>
): { operationRef?: string; capabilityId?: string } | undefined {
  const candidates = [
    meta.capabilityIdentity,
    tool.capabilityIdentity,
    meta
  ]
  for (const candidate of candidates) {
    const record = recordValue(candidate)
    const operationRef = stringValue(record.operationRef)
    const capabilityId = resolveActionId(stringValue(record.capabilityId), knownActionIds)
    if (operationRef || capabilityId) {
      return {
        ...(operationRef ? { operationRef } : {}),
        ...(capabilityId ? { capabilityId } : {})
      }
    }
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

function resolveActionId(value: string, knownActionIds?: ReadonlySet<string>): string | undefined {
  const actionId = validActionId(value)
  return actionId && (!knownActionIds || knownActionIds.has(actionId)) ? actionId : undefined
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

function invocationArguments(meta: Record<string, unknown>): CapabilityJsonValue {
  const argumentsValue = jsonValue(meta.arguments)
  if (isRecord(argumentsValue) && Object.hasOwn(argumentsValue, 'input')) {
    return argumentsValue.input ?? {}
  }
  return argumentsValue ?? {}
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
