import type {
  AgentRuntimeEvent,
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

export const EXECUTION_INTEGRITY_POLICY_VERSION = 'execution-integrity.v1'
export const EXECUTION_INTEGRITY_POLICY_METADATA_KEY = 'sciforgeExecutionIntegrityPolicy'
export const EXECUTION_OBLIGATIONS_METADATA_KEY = 'sciforgeExecutionObligations'

const EXECUTION_INTEGRITY_MARKER = 'Runtime-enforced execution integrity gate:'
const MAX_ASSISTANT_CLAIM_TEXT = 16_384
const MAX_REMEMBERED_VIOLATIONS = 2_048

export type ExecutionEffectClass =
  | 'read'
  | 'command_execution'
  | 'local_write'
  | 'external_mutation'
  | 'async_job'
  | 'child_agent'
  | 'other'

export type ExecutionObligation = {
  id: string
  kind: 'any_success' | 'visual_inspection' | 'tool' | 'effect'
  toolNames?: string[]
  effectClass?: ExecutionEffectClass
  source: 'user' | 'metadata' | 'visual'
}

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
  trustedSuccess: boolean
  visualSuccess: boolean
}

type ExecutionIntegrityState = {
  obligations: ExecutionObligation[]
  calls: Map<string, ToolReceipt>
  assistantText: string
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
      assistantText: '',
      enabled: true
    })
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
        assistantText: '',
        enabled: true
      }
      this.states.set(key, state)
    }
    if (!state?.enabled) {
      const prior = this.violated.get(key)
      if (prior && isCompletedTurn(event)) return { event: failedCompletion(event, prior) }
      return { event }
    }

    rememberAssistantText(state, event)
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
    'Only a real terminal executor receipt counts; otherwise report the blocker.'
  ].join('\n')
  return {
    ...input,
    text: `${instruction}\n\n${input.text}`,
    displayText: input.displayText ?? input.text,
    metadata
  }
}

export function requiresRuntimeExecution(text: string): boolean {
  return requestedExecutionClass(text) !== null
}

/**
 * Policy text often contains explicit safety boundaries such as "do not edit"
 * or "禁止删除" next to the action that is actually requested. Those negated
 * phrases must not broaden the receipt obligation into a write or mutation.
 */
function executionIntentText(text: string): string {
  return text
    .replace(
      /\b(?:(?:do|does|did)\s+not|don't|doesn't|didn't|must\s+not|should\s+not|cannot|can't|never)\b[^.!?;\n]*?(?=(?:[.!?;\n]|,\s*(?:but|however|instead|only|then)\b|$))/giu,
      ' '
    )
    .replace(
      /(?:不要|不得|禁止|无需|无须|不应|不能|不可|不需要|切勿|勿)[^。；;!！?？\n]*?(?=(?:[。；;!！?？\n]|[，,]\s*(?:但|但是|不过|而是|只|仅|然后|并且|且|同时)|$))/gu,
      ' '
    )
}

function obligationsFromInput(input: AgentRuntimeTurnStartInput): ExecutionObligation[] {
  const metadata = recordValue(input.metadata)
  const explicit = normalizeObligations(metadata[EXECUTION_OBLIGATIONS_METADATA_KEY])
  const obligations = [...explicit]
  if (metadata[VISUAL_EXECUTION_REQUIRED_METADATA_KEY] === true) {
    obligations.push({ id: 'visual-inspection', kind: 'visual_inspection', source: 'visual' })
  }
  const displayText = input.displayText ?? input.text
  if (requiresRuntimeExecution(displayText) && !obligations.some((item) => item.id === 'requested-execution')) {
    obligations.push(requestedExecutionObligation(displayText))
  }
  return dedupeObligations(obligations)
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
    const toolNames = Array.isArray(item.toolNames)
      ? item.toolNames.map(stringValue).filter(Boolean).map(normalizedToolName)
      : undefined
    return [{
      id: stringValue(item.id) || `obligation-${index + 1}`,
      kind,
      ...(toolNames?.length ? { toolNames } : {}),
      ...(effectClass ? { effectClass } : {}),
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
  const trustedSuccess = phase === 'succeeded' && (
    visualSuccess ||
    factSource === 'executor_result' ||
    evidenceStrength === 'executor_receipt' ||
    evidenceStrength === 'attested'
  )
  const asyncReceipt = asyncReceiptFromMeta(meta)
  return {
    callId: rawCallId.trim(),
    toolName,
    phase,
    factSource,
    evidenceStrength,
    attempt,
    effectClasses: effectClassesFromEvent(event, toolName, meta),
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
    trustedSuccess: phase === 'succeeded',
    visualSuccess: false
  })
}

function completionViolation(state: ExecutionIntegrityState): ExecutionIntegrityViolation | null {
  const receipts = [...state.calls.values()]
  const open = receipts.filter((item) => !isTerminalPhase(item.phase))
  const trusted = receipts.filter((item) => item.trustedSuccess)
  const unsatisfied = state.obligations.filter((obligation) => {
    if (obligation.kind === 'visual_inspection') return !trusted.some((item) => item.visualSuccess)
    if (obligation.kind === 'tool') {
      const names = new Set((obligation.toolNames ?? []).map(normalizedToolName))
      return !trusted.some((item) => names.size === 0 || names.has(item.toolName))
    }
    if (obligation.kind === 'effect') {
      return !trusted.some((item) => obligation.effectClass !== undefined && item.effectClasses.includes(obligation.effectClass))
    }
    return trusted.length === 0
  })
  const claimedEffect = affirmativeExecutionClaim(state.assistantText)
  const claimUnverified = claimedEffect !== null && !trusted.some((item) => (
    claimedEffect === 'any' || item.effectClasses.includes(claimedEffect)
  ))
  if (!open.length && !unsatisfied.length && !claimUnverified) return null

  const visualMissing = unsatisfied.some((item) => item.kind === 'visual_inspection')
  const code = visualMissing
    ? 'runtime_visual_execution_missing'
    : claimUnverified && !open.length && !unsatisfied.length
      ? 'runtime_execution_claim_unverified'
      : 'runtime_execution_incomplete'
  const verdict = code === 'runtime_execution_claim_unverified' ? 'unverified' : 'blocked'
  const openCallIds = open.map((item) => item.callId)
  const unsatisfiedObligationIds = unsatisfied.map((item) => item.id)
  return {
    code,
    verdict,
    message: visualMissing
      ? 'Visual completion rejected: verified visual inspection did not execute.'
      : verdict === 'unverified'
        ? 'Completion rejected: the assistant claimed execution without an executor receipt.'
        : 'Completion rejected: required execution has no successful terminal receipt.',
    detail: [
      openCallIds.length ? `Open calls: ${openCallIds.join(', ')}.` : '',
      unsatisfiedObligationIds.length ? `Unsatisfied obligations: ${unsatisfiedObligationIds.join(', ')}.` : '',
      claimUnverified ? 'An affirmative execution claim was observed without trusted success evidence.' : '',
      'A model statement, request event, dispatch event, or accepted asynchronous job is not proof of completion.'
    ].filter(Boolean).join(' '),
    openCallIds,
    unsatisfiedObligationIds
  }
}

function rememberAssistantText(state: ExecutionIntegrityState, event: AgentRuntimeEvent): void {
  let text = ''
  if (event.kind === 'assistant_delta') text = event.text
  if (event.kind === 'item_snapshot' && event.item.kind === 'assistant_message') {
    text = event.item.text ?? event.item.detail ?? ''
  }
  if (!text) return
  state.assistantText = `${state.assistantText}${text}`.slice(-MAX_ASSISTANT_CLAIM_TEXT)
}

function affirmativeExecutionClaim(text: string): ExecutionEffectClass | 'any' | null {
  if (!text.trim()) return null
  const affirmative = [
    /(?:我|我们|已|已经)(?:成功)?(?:执行|运行|调用|修改|编辑|删除|发送|提交|安装|渲染|部署|发布|修复|实现)(?!不了|失败|尚未|未)/u,
    /(?:我|我们|已|已经)(?:成功)?使用.{0,16}(?:工具|命令|接口|API)/iu,
    /\b(?:i|we)\s+(?:have\s+)?(?:successfully\s+)?(?:ran|executed|called|invoked|edited|modified|deleted|removed|sent|submitted|installed|opened|clicked|downloaded|uploaded|rendered|deployed|published|implemented|fixed)\b/iu,
    /\b(?:i|we)\s+(?:have\s+)?(?:successfully\s+)?used\s+(?:the\s+)?(?:tool|command|api|view_image|gui_visual_capture)\b/iu
  ].some((pattern) => pattern.test(text))
  if (!affirmative) return null
  if (
    /(?:修改|编辑|删除|安装|修复|实现)/u.test(text) ||
    /\b(?:edited|modified|deleted|removed|installed|implemented|fixed)\b/iu.test(text)
  ) return 'local_write'
  if (
    /(?:发送|提交|上传|部署|发布)/u.test(text) ||
    /\b(?:sent|submitted|uploaded|deployed|published)\b/iu.test(text)
  ) return 'external_mutation'
  if (/(?:执行|运行)/u.test(text) || /\b(?:ran|executed)\b/iu.test(text)) return 'command_execution'
  return 'any'
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

function requestedExecutionObligation(text: string): ExecutionObligation {
  const effectClass = requestedExecutionClass(text)
  if (effectClass && effectClass !== 'any_success') {
    return { id: 'requested-execution', kind: 'effect', effectClass, source: 'user' }
  }
  return { id: 'requested-execution', kind: 'any_success', source: 'user' }
}

type RequestedExecutionClass = ExecutionEffectClass | 'any_success'

/** Classify affirmative action requests, not incidental action-word mentions. */
function requestedExecutionClass(text: string): RequestedExecutionClass | null {
  const value = executionIntentText(text).toLowerCase().trim()
  if (!value) return null
  const requested = new Set<RequestedExecutionClass>()
  for (const clause of value.split(/[.!?;,，。；！？？\n]+/u)) {
    for (const root of requestedClauseRoots(clause)) collectRequestedClauseEffects(root, requested)
  }
  if (requested.has('external_mutation')) return 'external_mutation'
  if (requested.has('local_write')) return 'local_write'
  if (requested.has('command_execution')) return 'command_execution'
  return requested.has('any_success') ? 'any_success' : null
}

const ENGLISH_ACTION = /^(run|execute|send|submit|upload|deploy|publish|edit|modify|create|delete|remove|update|install|implement|fix|patch|write|call|invoke|use|open|click|search|query|read|download|render|generate)\b/iu
const CHINESE_ACTION = /^(执行|运行|发送|提交|上传|部署|发布|修改|编辑|新增|创建|新建|删除|移除|更新|安装|修复|实现|写入|调用|使用|打开|点击|搜索|查询|读取|下载|渲染|生成)/u
const EXTERNAL_OBJECT_ACTIONS = new Set([
  'create', 'open', 'delete', 'remove', 'update', '创建', '新建', '打开', '删除', '移除', '更新'
])

function requestedClauseRoots(clause: string): string[] {
  const value = clause.trim()
  const separator = value.search(/[:：]/u)
  if (separator < 0) return [value]
  const header = value.slice(0, separator).trim()
  const body = value.slice(separator + 1).trim()
  if (
    /^(?:task|action|required action|instruction|next step|step|please (?:do|perform) (?:the )?following|do (?:the )?following)$/iu.test(header) ||
    /^(?:任务|操作|必要操作|指令|下一步|步骤|请(?:执行|完成)以下(?:任务|操作|步骤)?)$/u.test(header)
  ) return [body]
  return [header]
}

function collectRequestedClauseEffects(clause: string, requested: Set<RequestedExecutionClass>): void {
  const english = requestedEnglishRoot(clause)
  const englishRoot = ENGLISH_ACTION.exec(english)
  if (englishRoot && !isStatusDescription(englishRoot[1], english.slice(englishRoot[0].length))) {
    requested.add(effectForRequestedAction(englishRoot[1], english.slice(englishRoot[0].length)))
    const coordinated = /\b(?:and|then|also)(?:\s+(?:then|also))?\s+(?:(?:please|kindly|actually|now)\s+)*(run|execute|send|submit|upload|deploy|publish|edit|modify|create|delete|remove|update|install|implement|fix|patch|write|call|invoke|use|open|click|search|query|read|download|render|generate)\b/giu
    for (const match of english.matchAll(coordinated)) {
      requested.add(effectForRequestedAction(match[1], english.slice((match.index ?? 0) + match[0].length)))
    }
    return
  }

  const chinese = requestedChineseRoot(clause)
  const chineseRoot = CHINESE_ACTION.exec(chinese)
  if (!chineseRoot || isStatusDescription(chineseRoot[1], chinese.slice(chineseRoot[0].length))) return
  requested.add(effectForRequestedAction(chineseRoot[1], chinese.slice(chineseRoot[0].length)))
  const coordinated = /(?:并且|然后|同时|且|再)\s*(?:(?:请|务必|直接)\s*)*(执行|运行|发送|提交|上传|部署|发布|修改|编辑|新增|创建|新建|删除|移除|更新|安装|修复|实现|写入|调用|使用|打开|点击|搜索|查询|读取|下载|渲染|生成)/gu
  for (const match of chinese.matchAll(coordinated)) {
    requested.add(effectForRequestedAction(match[1], chinese.slice((match.index ?? 0) + match[0].length)))
  }
}

function requestedEnglishRoot(clause: string): string {
  return clause.trim()
    .replace(/^(?:[-*]\s*|\d+[.)]\s*)/u, '')
    .replace(/^(?:(?:but|however|instead|only|then)\s+)/iu, '')
    .replace(
      /^(?:(?:(?:can|could|would|will)\s+you\s+)(?:(?:please|kindly|actually|now)\s+)*|(?:i|we)\s+(?:(?:need|want)\s+(?:you\s+)?to|must|should|have\s+to)\s+(?:(?:please|kindly|actually|now)\s+)*|you\s+(?:must|should|need\s+to|have\s+to)\s+(?:(?:please|kindly|actually|now)\s+)*|(?:(?:please|kindly|now|actually|just|must|should|need\s+to|have\s+to)\s+)+)/iu,
      ''
    )
}

function requestedChineseRoot(clause: string): string {
  let value = clause.trim()
    .replace(/^(?:[-*]\s*|\d+[.)、]\s*)/u, '')
    .replace(/^(?:但是|不过|而是|然后|并且|同时|但|只|仅|且)\s*/u, '')
  let prefixRemoved = false
  for (;;) {
    const before = value
    value = value
      .replace(/^(?:我|我们)\s*(?:需要|必须|务必|希望|想让)\s*/u, '')
      .replace(/^(?:请|麻烦|现在|直接|继续|只|仅|务必|必须|需要|实际|真正|确实|重新|帮我)\s*/u, '')
    if (value !== before) prefixRemoved = true
    if (prefixRemoved) value = value.replace(/^你\s*/u, '')
    else value = value.replace(/^你\s*(?=(?:需要|必须|务必|希望|想让))/u, '')
    if (value === before) break
  }
  return value
}

function isStatusDescription(action: string, remainder: string): boolean {
  if (remainder.startsWith('-')) return true
  if (/^[a-z]/iu.test(action)) {
    return /^(?:\s+[\w@./:-]+){0,5}\s+(?:is|are|was|were|shows?|failed|succeeded|completed|enabled|open|closed|pending)\b/iu
      .test(remainder)
  }
  return /^.{0,20}?(?:已|已经|曾经|当前|仍然)?(?:失败|成功|完成|开启|打开|关闭|待处理|运行中)$/u
    .test(remainder.trim())
}

function effectForRequestedAction(action: string, remainder: string): RequestedExecutionClass {
  if (isExternalObjectMutation(action, remainder)) return 'external_mutation'
  if (/^(?:send|submit|upload|deploy|publish|发送|提交|上传|部署|发布)$/iu.test(action)) {
    if (/^(?:publish|发布)$/iu.test(action) && requestsLocalDatasetPublication(remainder)) return 'local_write'
    return 'external_mutation'
  }
  if (/^(?:edit|modify|create|delete|remove|update|install|implement|fix|patch|write|修改|编辑|新增|创建|新建|删除|移除|更新|安装|修复|实现|写入)$/iu.test(action)) {
    return 'local_write'
  }
  if (/^(?:run|execute|执行|运行)$/iu.test(action)) {
    return requestsCommandSurface(remainder) ? 'command_execution' : 'any_success'
  }
  return 'any_success'
}

function requestsLocalDatasetPublication(value: string): boolean {
  if (!/(?:\bdatasets?\b|数据集|数据制品)/iu.test(value)) return false
  return !/(?:\b(?:github|gitlab|hugging\s*face|registry|remote|server|cloud|repository)\b|远程|云端|仓库|服务器|注册表)/iu
    .test(value)
}

/**
 * "Run/execute" often describes a tool-backed workflow rather than a shell
 * command (for example, "执行一次 Dataset 验收"). Requiring a command receipt
 * in that case rejects successful MCP receipts. Keep the stricter command
 * obligation only when the requested object names a command-oriented surface.
 */
function requestsCommandSurface(value: string): boolean {
  return /\b(?:tests?|checks?|commands?|scripts?|build|lint|typecheck|shell|terminal|server|service|process|binary|executable|npm|pnpm|yarn|vitest|jest|pytest)\b/iu.test(value) ||
    /(?:测试|检查|命令|脚本|构建|编译|类型检查|终端|服务|进程|可执行文件)/u.test(value)
}

function isExternalObjectMutation(action: string, objectText: string): boolean {
  return EXTERNAL_OBJECT_ACTIONS.has(action.toLowerCase()) && hasExternalObject(objectText)
}

function hasExternalObject(value: string): boolean {
  const normalized = value.replace(/[_-]+/gu, ' ')
  if (
    /(?:^|\s)(?:file|report|summary|cache|cached|note|artifact|document|record|copy|folder|directory|code)(?:\s|$)/iu.test(normalized) ||
    /(?:文件|报告|摘要|缓存|笔记|制品|文档|记录|副本|目录|代码)/u.test(normalized)
  ) return false
  return /(?:^|\s)(?:message|email|issue|ticket|pr|pull\s+request|comment|release)(?:\s|$)/iu.test(normalized) ||
    /(?:消息|邮件|工单|议题|评论|发布项)/u.test(normalized)
}

function isExternalMutationToolName(name: string): boolean {
  if (/(?:^|_)(?:send|submit|upload|deploy|publish)(?:_|$)/u.test(name)) return true
  const match = name.match(/(?:^|_)(create|open|delete|remove|update)_(.+)$/u)
  return Boolean(match && isExternalObjectMutation(match[1], match[2]))
}

function isExternalMutationCommand(command: string): boolean {
  return command.split(/&&|\|\||[;|\n]/u).some((part) => {
    const segment = part.trim()
    if (!segment || /(?:^|\s)--(?:dry[-_]?run|preview|no[-_]?act|noop)(?:[=\s]|$)/iu.test(segment)) {
      return false
    }
    const shortNoOp = /(?:^|\s)-n(?:\s|$)/u.test(segment) &&
      /^(?:sudo\s+)?(?:git\b|(?:npm|pnpm|yarn)\b)/iu.test(segment)
    if (shortNoOp) return false
    return [
      /^(?:sudo\s+)?(?:deploy|publish|submit|upload|send)(?:\s|$)/iu,
      /^(?:sudo\s+)?git(?:\s+(?:-[a-z]\s+\S+|--[\w-]+(?:=\S+)?))*\s+push(?:\s|$)/iu,
      /^(?:sudo\s+)?gh\s+(?:issue|pr|release)\s+(?:create|edit|delete|close|reopen|merge|upload)(?:\s|$)/iu,
      /^(?:sudo\s+)?(?:docker|podman)\s+push(?:\s|$)/iu,
      /^(?:sudo\s+)?kubectl\s+(?:apply|create|delete|patch|replace|set|rollout)(?:\s|$)/iu,
      /^(?:npm|pnpm|yarn)\s+(?:run\s+)?(?:deploy|publish)(?:\s|$)/iu
    ].some((pattern) => pattern.test(segment))
  })
}

function effectClassesFromEvent(
  event: Extract<AgentRuntimeEvent, { kind: 'tool_event' | 'item_snapshot' }>,
  toolName: string,
  meta: Record<string, unknown>
): ExecutionEffectClass[] {
  const toolKind = event.kind === 'tool_event' ? event.toolKind : event.item.toolKind
  const name = normalizedToolName(toolName)
  const argumentsValue = recordValue(meta.arguments)
  const outputValue = recordValue(meta.output)
  const delegatedName = delegatedMcpToolName(name, argumentsValue, outputValue)
  const names = delegatedName ? [name, delegatedName] : [name]
  const effects = new Set<ExecutionEffectClass>()
  const isCommand = toolKind === 'command_execution' ||
    names.some((value) => /(?:^|_)(?:local_shell|shell|bash|exec|execute_command)(?:_|$)/u.test(value))
  if (isCommand) effects.add('command_execution')

  const command = [
    stringValue(meta.command),
    stringValue(argumentsValue.command),
    stringValue(argumentsValue.cmd)
  ].filter(Boolean).join(' ')
  const externalTool = names.some((value) => (
    isExternalMutationToolName(value) && !isLocalDatasetWriteToolName(value)
  ))
  if (
    toolKind === 'file_change' ||
    (!externalTool && names.some(isLocalWriteToolName)) ||
    (isCommand && /(?:^|\s)(?:apply_patch|rm|mv|cp|mkdir|touch|install)(?:\s|$)|(?:sed\s+-i|>>?|\btee\b|--(?:fix|write)\b)/iu.test(command))
  ) {
    effects.add('local_write')
  }
  if (externalTool || (isCommand && isExternalMutationCommand(command))) {
    effects.add('external_mutation')
  }
  if (names.some((value) => /(?:^|_)(?:read|view|find|search|list|get|fetch|open)(?:_|$)/u.test(value))) {
    effects.add('read')
  }
  return effects.size > 0 ? [...effects] : ['other']
}

function delegatedMcpToolName(
  wrapperName: string,
  argumentsValue: Record<string, unknown>,
  outputValue: Record<string, unknown>
): string {
  if (wrapperName !== 'mcp_call') return ''
  const candidate = stringValue(outputValue.toolName) ||
    stringValue(outputValue.toolId) ||
    stringValue(argumentsValue.toolName) ||
    stringValue(argumentsValue.toolId)
  const leaf = candidate.split('/').filter(Boolean).at(-1) ?? ''
  return normalizedToolName(leaf)
}

function isLocalWriteToolName(name: string): boolean {
  if (/(?:^|_)(?:apply_patch|write|edit|delete|remove|move|copy|mkdir|install)(?:_|$)/u.test(name)) {
    return true
  }
  return isLocalDatasetWriteToolName(name)
}

function isLocalDatasetWriteToolName(name: string): boolean {
  return /^dataset_(?:api_(?:register(?:_provider)?|metadata|raw_data)|prepare_plan|profile|filter|select_columns|transform|deduplicate|id_map(?:_provider)?|join|structure_(?:profile|validate)|graph_organize|validate|publish)$/u
    .test(name)
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
