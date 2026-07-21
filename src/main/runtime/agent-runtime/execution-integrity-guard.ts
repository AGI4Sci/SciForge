import type {
  AgentRuntimeEvent,
  AgentRuntimeExecutionEffectClass,
  AgentRuntimeExecutionIntent,
  AgentRuntimeId,
  AgentRuntimeToolEvidenceStrength,
  AgentRuntimeToolExecutionPhase,
  AgentRuntimeToolFactSource,
  AgentRuntimeTurnStartInput
} from '../../../shared/agent-runtime-contract'
import {
  isVerifiedVisualExecutionEvent,
  VISUAL_EXECUTION_REQUIRED_METADATA_KEY
} from './visual-execution-guard'

export const EXECUTION_INTEGRITY_POLICY_VERSION = 'execution-integrity.v2'
export const EXECUTION_INTEGRITY_POLICY_METADATA_KEY = 'sciforgeExecutionIntegrityPolicy'
export const EXECUTION_OBLIGATIONS_METADATA_KEY = 'sciforgeExecutionObligations'
export const EXECUTION_INTENT_METADATA_KEY = 'sciforgeExecutionIntent'

const EXECUTION_INTEGRITY_MARKER = 'Runtime-enforced execution integrity gate:'
const MAX_REMEMBERED_VIOLATIONS = 2_048

export type ExecutionEffectClass = AgentRuntimeExecutionEffectClass

export type ExecutionObligation = {
  id: string
  kind: 'any_success' | 'visual_inspection' | 'tool' | 'effect'
  toolNames?: string[]
  effectClass?: ExecutionEffectClass
  completion?: 'terminal' | 'success'
  source: 'user' | 'metadata' | 'visual'
}

export type ExecutionIntent = AgentRuntimeExecutionIntent

type ToolReceipt = {
  callId: string
  toolName: string
  phase: AgentRuntimeToolExecutionPhase
  factSource: AgentRuntimeToolFactSource
  evidenceStrength: AgentRuntimeToolEvidenceStrength
  attempt: number
  effectClasses: ExecutionEffectClass[]
  resultDigest?: string
  errorCode?: string
  /** Stable executor handle shared by an asynchronous launch and later poll calls. */
  asyncHandle?: string
  /** True only when the executor reports that the asynchronous handle is terminal. */
  asyncTerminal?: boolean
  trustedTerminal: boolean
  trustedSuccess: boolean
  visualSuccess: boolean
}

type ExecutionIntegrityState = {
  obligations: ExecutionObligation[]
  calls: Map<string, ToolReceipt>
  enabled: boolean
}

export type ExecutionIntegrityViolation = {
  code:
    | 'runtime_execution_incomplete'
    | 'runtime_execution_claim_unverified'
    | 'runtime_visual_execution_missing'
  verdict: 'blocked' | 'unverified'
  message: string
  detail: string
  openCallIds: string[]
  unsatisfiedObligationIds: string[]
}

export type ExecutionIntegrityObservation = {
  event: AgentRuntimeEvent
  violation?: ExecutionIntegrityViolation
}

/**
 * Host-owned receipt ledger. It consumes events the runtimes already emit and
 * never invokes a model, tool, network endpoint, or filesystem operation.
 */
export class RuntimeExecutionIntegrityGuard {
  private readonly states = new Map<string, ExecutionIntegrityState>()
  private readonly violated = new Map<string, ExecutionIntegrityViolation>()

  rememberTurn(runtimeId: AgentRuntimeId, input: AgentRuntimeTurnStartInput, threadId: string, turnId: string): void {
    const key = executionKey(runtimeId, threadId, turnId)
    if (!key) return
    this.states.set(key, {
      obligations: obligationsFromInput(input),
      calls: new Map(),
      enabled: true
    })
  }

  rememberSteer(
    runtimeId: AgentRuntimeId,
    threadId: string,
    turnId: string,
    obligations: ExecutionObligation[]
  ): void {
    const key = executionKey(runtimeId, threadId, turnId)
    const state = key ? this.states.get(key) : undefined
    if (!state) return
    state.obligations = dedupeObligations([...state.obligations, ...obligations])
  }

  rejectedTurnIds(runtimeId: AgentRuntimeId, threadId: string): string[] {
    const prefix = `${runtimeId}:${threadId.trim()}:`
    if (!threadId.trim()) return []
    return [...this.violated.keys()]
      .filter((key) => key.startsWith(prefix))
      .map((key) => key.slice(prefix.length))
      .filter(Boolean)
  }

  observe(runtimeId: AgentRuntimeId, event: AgentRuntimeEvent): ExecutionIntegrityObservation {
    const turnId = event.turnId?.trim() ?? ''
    const key = executionKey(runtimeId, event.threadId, turnId)
    if (!key) return { event }

    let state = this.states.get(key)
    if (!state && event.kind === 'user_message' && isIntegrityMarker(event.text)) {
      state = {
        obligations: obligationsFromMarker(event.text),
        calls: new Map(),
        enabled: true
      }
      this.states.set(key, state)
    }
    if (!state?.enabled) {
      const prior = this.violated.get(key)
      if (prior && isCompletedTurn(event)) return { event: failedCompletion(event, prior) }
      return { event }
    }

    const receipt = receiptFromEvent(event)
    if (receipt) rememberReceipt(state, receipt)

    if (event.kind === 'child_event') rememberChildReceipt(state, event)
    if (event.kind !== 'turn_lifecycle') return { event }
    if (event.state === 'failed' || event.state === 'aborted' || event.state === 'cancelled') {
      this.states.delete(key)
      return { event }
    }
    if (event.state !== 'completed' && event.state !== 'success') return { event }

    this.states.delete(key)
    const violation = completionViolation(state)
    if (!violation) return { event }
    const priorViolation = this.violated.get(key)
    if (priorViolation) return { event: failedCompletion(event, priorViolation) }
    this.rememberViolation(key, violation)
    return { event: failedCompletion(event, violation), violation }
  }

  private rememberViolation(key: string, violation: ExecutionIntegrityViolation): void {
    if (this.violated.has(key)) return
    this.violated.set(key, violation)
    while (this.violated.size > MAX_REMEMBERED_VIOLATIONS) {
      const oldest = this.violated.keys().next().value
      if (oldest === undefined) return
      this.violated.delete(oldest)
    }
  }
}

export function withExecutionIntegrityRequirement(
  input: AgentRuntimeTurnStartInput
): AgentRuntimeTurnStartInput {
  const obligations = obligationsFromInput(input)
  if (!obligations.length) return input
  const metadata = {
    ...(input.metadata ?? {}),
    [EXECUTION_INTEGRITY_POLICY_METADATA_KEY]: EXECUTION_INTEGRITY_POLICY_VERSION,
    ...(obligations.length ? { [EXECUTION_OBLIGATIONS_METADATA_KEY]: obligations } : {})
  }
  if (
    input.text.includes(EXECUTION_INTEGRITY_MARKER) ||
    input.text.includes('Runtime-enforced visual completion gate:')
  ) {
    return { ...input, metadata }
  }
  const marker = `${EXECUTION_INTEGRITY_MARKER} ${JSON.stringify(obligations)}`
  const instruction = [
    marker,
    'Only a matching typed terminal executor receipt counts; success requirements also need a successful outcome.'
  ].join('\n')
  return {
    ...input,
    text: `${instruction}\n\n${input.text}`,
    displayText: input.displayText ?? input.text,
    metadata
  }
}

function obligationsFromInput(input: AgentRuntimeTurnStartInput): ExecutionObligation[] {
  const metadata = recordValue(input.metadata)
  const explicit = normalizeObligations(metadata[EXECUTION_OBLIGATIONS_METADATA_KEY])
  const intent = executionObligationsFromIntent(
    input.executionIntent ?? metadata[EXECUTION_INTENT_METADATA_KEY]
  )
  const obligations = [...explicit, ...intent]
  if (metadata[VISUAL_EXECUTION_REQUIRED_METADATA_KEY] === true) {
    obligations.push({ id: 'visual-inspection', kind: 'visual_inspection', source: 'visual' })
  }
  return dedupeObligations(obligations)
}

/**
 * Natural-language understanding belongs to the caller that owns routing.
 * This guard consumes only a typed decision and never reclassifies user text,
 * quoted documents, assistant prose, or historical context.
 */
export function executionObligationsFromIntent(value: unknown): ExecutionObligation[] {
  const intent = recordValue(value)
  const mode = stringValue(intent.mode)
  if (mode === 'answer' || (mode !== 'inspect' && mode !== 'execute')) return []
  const requirements = Array.isArray(intent.requirements) ? intent.requirements : []
  if (requirements.length === 0) {
    return [{
      id: 'requested-execution',
      kind: mode === 'inspect' ? 'effect' : 'any_success',
      ...(mode === 'inspect' ? { effectClass: 'read' as const } : {}),
      completion: 'success',
      source: 'metadata'
    }]
  }
  const obligations: ExecutionObligation[] = []
  requirements.forEach((entry, index) => {
    const requirement = recordValue(entry)
    const effectClass = normalizedEffectClass(requirement.effectClass)
    const toolNames = Array.isArray(requirement.toolNames)
      ? requirement.toolNames.map(stringValue).filter(Boolean).map(normalizedToolName)
      : []
    const completion = requirement.completion === 'terminal' ? 'terminal' : 'success'
    const id = stringValue(requirement.id) || (
      requirements.length === 1 ? 'requested-execution' : `requested-execution-${index + 1}`
    )
    if (toolNames.length > 0) {
      obligations.push({ id, kind: 'tool', toolNames, completion, source: 'metadata' })
      return
    }
    if (effectClass) {
      obligations.push({ id, kind: 'effect', effectClass, completion, source: 'metadata' })
      return
    }
    obligations.push({ id, kind: 'any_success', completion, source: 'metadata' })
  })
  return obligations
}

function obligationsFromMarker(text: string): ExecutionObligation[] {
  const line = text.split(/\r?\n/u).find((value) => value.includes(EXECUTION_INTEGRITY_MARKER)) ?? ''
  if (!line && text.includes('Runtime-enforced visual completion gate:')) {
    return [{ id: 'visual-inspection', kind: 'visual_inspection', source: 'visual' }]
  }
  const start = line.indexOf('[', line.indexOf(EXECUTION_INTEGRITY_MARKER))
  if (start < 0) return []
  try {
    return normalizeObligations(JSON.parse(line.slice(start)))
  } catch {
    return []
  }
}

function normalizeObligations(value: unknown): ExecutionObligation[] {
  if (!Array.isArray(value)) return []
  return value.flatMap((entry, index) => {
    const item = recordValue(entry)
    const kind = stringValue(item.kind)
    if (kind !== 'any_success' && kind !== 'visual_inspection' && kind !== 'tool' && kind !== 'effect') return []
    const source = stringValue(item.source)
    const effectClass = normalizedEffectClass(item.effectClass)
    const completion = item.completion === 'terminal' ? 'terminal' : 'success'
    const toolNames = Array.isArray(item.toolNames)
      ? item.toolNames.map(stringValue).filter(Boolean).map(normalizedToolName)
      : undefined
    return [{
      id: stringValue(item.id) || `obligation-${index + 1}`,
      kind,
      ...(toolNames?.length ? { toolNames } : {}),
      ...(effectClass ? { effectClass } : {}),
      completion,
      source: source === 'metadata' || source === 'visual' ? source : 'user'
    } satisfies ExecutionObligation]
  })
}

function dedupeObligations(obligations: ExecutionObligation[]): ExecutionObligation[] {
  const seen = new Set<string>()
  return obligations.filter((item) => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  })
}

function receiptFromEvent(event: AgentRuntimeEvent): ToolReceipt | null {
  if (event.kind !== 'tool_event' && (event.kind !== 'item_snapshot' || event.item.kind !== 'tool')) return null
  const item = event.kind === 'tool_event' ? event : event.item
  const meta = recordValue(item.meta)
  let phase = normalizedPhase(
    event.kind === 'tool_event' ? event.phase : meta.phase,
    item.status
  )
  if (!phase) return null
  if (phase === 'succeeded' && isAcceptedAsyncResult(meta)) phase = 'dispatched'
  const toolName = normalizedToolName(
    event.kind === 'tool_event'
      ? event.toolName || stringValue(meta.toolName) || stringValue(meta.name) || event.summary || ''
      : stringValue(meta.toolName) || stringValue(meta.name) || item.summary || ''
  )
  const rawCallId = event.kind === 'tool_event'
    ? event.callId || stringValue(meta.callId) || event.itemId
    : stringValue(meta.callId) || event.item.id
  if (!rawCallId) return null
  const factSource = normalizedFactSource(
    event.kind === 'tool_event' ? event.factSource : meta.factSource,
    phase
  )
  const evidenceStrength = normalizedEvidenceStrength(
    event.kind === 'tool_event' ? event.evidenceStrength : meta.evidenceStrength,
    phase
  )
  const attemptValue = event.kind === 'tool_event' ? event.attempt : meta.attempt
  const attempt = typeof attemptValue === 'number' && Number.isInteger(attemptValue) && attemptValue > 0
    ? attemptValue
    : 1
  const visualSuccess = phase === 'succeeded' && isVerifiedVisualExecutionEvent(event)
  const trustedTerminal = (phase === 'succeeded' || phase === 'failed' || phase === 'cancelled') && (
    visualSuccess ||
    factSource === 'executor_result' ||
    evidenceStrength === 'executor_receipt' ||
    evidenceStrength === 'attested'
  )
  const trustedSuccess = phase === 'succeeded' && trustedTerminal
  const asyncReceipt = asyncReceiptFromMeta(meta)
  return {
    callId: rawCallId.trim(),
    toolName,
    phase,
    factSource,
    evidenceStrength,
    attempt,
    effectClasses: effectClassesFromEvent(event, meta),
    ...(event.kind === 'tool_event'
      ? {
          ...(event.resultDigest || stringValue(meta.resultDigest)
            ? { resultDigest: event.resultDigest || stringValue(meta.resultDigest) }
            : {}),
          ...(event.errorCode || stringValue(meta.errorCode)
            ? { errorCode: event.errorCode || stringValue(meta.errorCode) }
            : {})
        }
      : {
          ...(stringValue(meta.resultDigest) ? { resultDigest: stringValue(meta.resultDigest) } : {}),
          ...(stringValue(meta.errorCode) ? { errorCode: stringValue(meta.errorCode) } : {})
        }),
    ...(asyncReceipt.handle ? { asyncHandle: asyncReceipt.handle } : {}),
    ...(asyncReceipt.terminal ? { asyncTerminal: true } : {}),
    trustedTerminal,
    trustedSuccess,
    visualSuccess
  }
}

function rememberReceipt(state: ExecutionIntegrityState, receipt: ToolReceipt): void {
  let key = receiptKey(receipt.callId, receipt.attempt)
  const prior = state.calls.get(key)
  if (!prior && isTerminalPhase(receipt.phase)) {
    const candidates = [...state.calls.entries()].filter(([, value]) => (
      !isTerminalPhase(value.phase) &&
      receipt.toolName !== '' &&
      value.toolName === receipt.toolName &&
      (receipt.asyncHandle || value.asyncHandle
        ? Boolean(receipt.asyncHandle && value.asyncHandle && receipt.asyncHandle === value.asyncHandle)
        : true)
    ))
    if (candidates.length === 1) key = candidates[0][0]
  }
  const existing = state.calls.get(key)
  if (!existing) {
    state.calls.set(key, receipt)
    closeCorrelatedAsyncReceipts(state, key, receipt)
    return
  }
  if (
    isTerminalPhase(existing.phase) &&
    isTerminalPhase(receipt.phase) &&
    (
      existing.phase !== receipt.phase ||
      Boolean(existing.resultDigest && receipt.resultDigest && existing.resultDigest !== receipt.resultDigest)
    )
  ) {
    state.calls.set(key, {
      ...receipt,
      callId: existing.callId,
      phase: 'unresolved',
      trustedTerminal: false,
      trustedSuccess: false,
      visualSuccess: false
    })
    return
  }
  if (isTerminalPhase(existing.phase) && !isTerminalPhase(receipt.phase)) return
  state.calls.set(key, {
    ...receipt,
    callId: existing.callId,
    toolName: receipt.toolName || existing.toolName,
    effectClasses: mergeEffectClasses(existing.effectClasses, receipt.effectClasses),
    asyncHandle: receipt.asyncHandle || existing.asyncHandle,
    asyncTerminal: receipt.asyncTerminal || existing.asyncTerminal
  })
  closeCorrelatedAsyncReceipts(state, key, receipt)
}

function mergeEffectClasses(
  existing: ExecutionEffectClass[],
  incoming: ExecutionEffectClass[]
): ExecutionEffectClass[] {
  const concrete = new Set([...existing, ...incoming].filter((effect) => effect !== 'other'))
  return concrete.size > 0 ? [...concrete] : ['other']
}

/**
 * A long-running executor launch and its poll/write/stop operations have
 * different model call ids, but share the same executor session id. Once a
 * terminal receipt arrives for that session, every still-open receipt for the
 * same tool/session is terminal too; otherwise the launch remains permanently
 * "dispatched" even after a successful poll.
 */
function closeCorrelatedAsyncReceipts(
  state: ExecutionIntegrityState,
  terminalKey: string,
  terminal: ToolReceipt
): void {
  if (!terminal.asyncHandle || terminal.asyncTerminal !== true || !isTerminalPhase(terminal.phase)) return
  for (const [key, existing] of state.calls) {
    if (
      key === terminalKey ||
      isTerminalPhase(existing.phase) ||
      existing.asyncHandle !== terminal.asyncHandle
    ) {
      continue
    }
    state.calls.set(key, {
      ...terminal,
      callId: existing.callId,
      toolName: existing.toolName,
      effectClasses: mergeEffectClasses(existing.effectClasses, terminal.effectClasses),
      asyncHandle: existing.asyncHandle,
      asyncTerminal: true
    })
  }
}

function asyncReceiptFromMeta(meta: Record<string, unknown>): { handle: string; terminal: boolean } {
  const output = recordValue(meta.output ?? meta.result)
  const argumentsRecord = recordValue(meta.arguments)
  const sessionId = stringValue(
    output.session_id ?? output.sessionId ?? argumentsRecord.session_id ?? argumentsRecord.sessionId
  ).trim()
  if (!sessionId) return { handle: '', terminal: false }
  const status = stringValue(output.status).trim().toLowerCase()
  const exitCode = output.exit_code ?? output.exitCode
  return {
    handle: `session:${sessionId}`,
    terminal: status === 'completed' || status === 'failed' || status === 'stopped' ||
      status === 'aborted' || status === 'cancelled' || typeof exitCode === 'number'
  }
}

function rememberChildReceipt(
  state: ExecutionIntegrityState,
  event: Extract<AgentRuntimeEvent, { kind: 'child_event' }>
): void {
  const status = event.child.status
  const phase: AgentRuntimeToolExecutionPhase = status === 'completed'
    ? 'succeeded'
    : status === 'failed'
      ? 'failed'
      : status === 'aborted'
        ? 'cancelled'
        : status === 'unknown'
          ? 'unresolved'
          : status === 'running'
            ? 'dispatched'
            : 'requested'
  rememberReceipt(state, {
    callId: `child:${event.child.id}`,
    toolName: normalizedToolName(event.child.name || event.child.kind || 'child_agent'),
    phase,
    factSource: 'runtime_lifecycle',
    evidenceStrength: 'runtime_lifecycle',
    attempt: 1,
    effectClasses: ['child_agent'],
    trustedTerminal: phase === 'succeeded' || phase === 'failed' || phase === 'cancelled',
    trustedSuccess: phase === 'succeeded',
    visualSuccess: false
  })
}

function completionViolation(state: ExecutionIntegrityState): ExecutionIntegrityViolation | null {
  const receipts = [...state.calls.values()]
  const open = receipts.filter((item) => !isTerminalPhase(item.phase))
  const trustedTerminal = receipts.filter((item) => item.trustedTerminal)
  const trustedSuccess = receipts.filter((item) => item.trustedSuccess)
  const unsatisfied = state.obligations.filter((obligation) => {
    const trusted = obligation.completion === 'terminal' ? trustedTerminal : trustedSuccess
    if (obligation.kind === 'visual_inspection') return !trustedSuccess.some((item) => item.visualSuccess)
    if (obligation.kind === 'tool') {
      const names = new Set((obligation.toolNames ?? []).map(normalizedToolName))
      return !trusted.some((item) => names.size === 0 || names.has(item.toolName))
    }
    if (obligation.kind === 'effect') {
      return !trusted.some((item) => obligation.effectClass !== undefined && item.effectClasses.includes(obligation.effectClass))
    }
    return trusted.length === 0
  })
  if (!open.length && !unsatisfied.length) return null

  const visualMissing = unsatisfied.some((item) => item.kind === 'visual_inspection')
  const code = visualMissing ? 'runtime_visual_execution_missing' : 'runtime_execution_incomplete'
  const verdict = 'blocked'
  const openCallIds = open.map((item) => item.callId)
  const unsatisfiedObligationIds = unsatisfied.map((item) => item.id)
  return {
    code,
    verdict,
    message: visualMissing
      ? 'Visual completion rejected: verified visual inspection did not execute.'
      : 'Completion rejected: required execution has no matching terminal receipt.',
    detail: [
      openCallIds.length ? `Open calls: ${openCallIds.join(', ')}.` : '',
      unsatisfiedObligationIds.length ? `Unsatisfied obligations: ${unsatisfiedObligationIds.join(', ')}.` : '',
      'A model statement, request event, dispatch event, or accepted asynchronous job is not proof of completion.'
    ].filter(Boolean).join(' '),
    openCallIds,
    unsatisfiedObligationIds
  }
}

function normalizedPhase(value: unknown, status: unknown): AgentRuntimeToolExecutionPhase | null {
  const explicit = stringValue(value)
  if (['requested', 'dispatched', 'succeeded', 'failed', 'cancelled', 'unresolved'].includes(explicit)) {
    return explicit as AgentRuntimeToolExecutionPhase
  }
  switch (stringValue(status).toLowerCase()) {
    case 'pending':
    case 'running':
      return 'requested'
    case 'success':
    case 'completed':
      return 'succeeded'
    case 'error':
    case 'failed':
      return 'failed'
    case 'aborted':
    case 'cancelled':
    case 'canceled':
      return 'cancelled'
    default:
      return null
  }
}

function isAcceptedAsyncResult(meta: Record<string, unknown>): boolean {
  const output = recordValue(meta.output ?? meta.result)
  if (output.accepted === true) return true
  const status = stringValue(output.status ?? output.state).toLowerCase()
  return status === 'accepted' || status === 'submitted' || status === 'queued' || status === 'pending' || status === 'running'
}

function effectClassesFromEvent(
  event: Extract<AgentRuntimeEvent, { kind: 'tool_event' | 'item_snapshot' }>,
  meta: Record<string, unknown>
): ExecutionEffectClass[] {
  const toolKind = event.kind === 'tool_event' ? event.toolKind : event.item.toolKind
  const typedEffects = event.kind === 'tool_event' ? event.effects : event.item.effects
  const declared = Array.isArray(typedEffects)
    ? typedEffects
    : Array.isArray(meta.effectClasses)
      ? meta.effectClasses
      : Array.isArray(meta.effects)
        ? meta.effects
        : []
  const effects = new Set(declared.map(normalizedEffectClass).filter((effect): effect is ExecutionEffectClass => Boolean(effect)))
  if (toolKind === 'command_execution') effects.add('command_execution')
  if (toolKind === 'file_change') effects.add('local_write')
  return effects.size > 0 ? [...effects] : ['other']
}

function normalizedEffectClass(value: unknown): ExecutionEffectClass | undefined {
  const effect = stringValue(value)
  if (
    effect === 'read' ||
    effect === 'command_execution' ||
    effect === 'local_write' ||
    effect === 'external_mutation' ||
    effect === 'async_job' ||
    effect === 'child_agent' ||
    effect === 'other'
  ) {
    return effect
  }
  return undefined
}

function normalizedFactSource(value: unknown, phase: AgentRuntimeToolExecutionPhase): AgentRuntimeToolFactSource {
  const explicit = stringValue(value)
  if (['model_output', 'runtime_lifecycle', 'executor_result', 'host_synthetic'].includes(explicit)) {
    return explicit as AgentRuntimeToolFactSource
  }
  return isTerminalPhase(phase) ? 'executor_result' : 'model_output'
}

function normalizedEvidenceStrength(
  value: unknown,
  phase: AgentRuntimeToolExecutionPhase
): AgentRuntimeToolEvidenceStrength {
  const explicit = stringValue(value)
  if (['intent', 'runtime_lifecycle', 'executor_receipt', 'attested'].includes(explicit)) {
    return explicit as AgentRuntimeToolEvidenceStrength
  }
  return isTerminalPhase(phase) ? 'executor_receipt' : 'intent'
}

function isTerminalPhase(phase: AgentRuntimeToolExecutionPhase): boolean {
  return phase === 'succeeded' || phase === 'failed' || phase === 'cancelled' || phase === 'unresolved'
}

function isCompletedTurn(
  event: AgentRuntimeEvent
): event is Extract<AgentRuntimeEvent, { kind: 'turn_lifecycle' }> {
  return event.kind === 'turn_lifecycle' && (event.state === 'completed' || event.state === 'success')
}

function failedCompletion(
  event: Extract<AgentRuntimeEvent, { kind: 'turn_lifecycle' }>,
  violation: ExecutionIntegrityViolation
): AgentRuntimeEvent {
  return { ...event, state: 'failed', message: violation.message }
}

function isIntegrityMarker(text: string): boolean {
  return text.includes(EXECUTION_INTEGRITY_MARKER) || text.includes('Runtime-enforced visual completion gate:')
}

function executionKey(runtimeId: AgentRuntimeId, threadId: string, turnId: string): string {
  const thread = threadId.trim()
  const turn = turnId.trim()
  return thread && turn ? `${runtimeId}:${thread}:${turn}` : ''
}

function receiptKey(callId: string, attempt: number): string {
  return `${callId}#${attempt}`
}

function normalizedToolName(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]+/gu, '_').replace(/^_+|_+$/gu, '')
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}
