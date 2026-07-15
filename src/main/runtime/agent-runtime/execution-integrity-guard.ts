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
  effectClass: ExecutionEffectClass
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
  const value = executionIntentText(text).trim()
  if (!value) return false
  return [
    /(?:^|[，。；;!?\n])\s*(?:请|麻烦|现在|直接|继续|只)?\s*(?:帮我)?\s*(?:调用|使用|执行|运行|修改|编辑|创建|新增|删除|移除|发送|提交|安装|打开|点击|搜索|查询|读取|下载|上传|渲染|生成|部署|发布|修复|实现)/iu,
    /(?:需要|必须|务必|请).{0,12}(?:真正|实际|确实)?(?:调用|使用|执行|运行|修改|编辑|创建|删除|发送|提交|安装|渲染|生成|部署|发布)/u,
    /\b(?:please\s+|now\s+|actually\s+)?(?:run|execute|call|invoke|use|edit|modify|create|delete|remove|send|submit|install|open|click|search|download|upload|render|generate|deploy|publish|implement|fix)\b/iu
  ].some((pattern) => pattern.test(value))
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
    effectClass: effectClassFromEvent(event, toolName, meta),
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
      value.toolName === receipt.toolName
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
    effectClass: receipt.effectClass === 'other' ? existing.effectClass : receipt.effectClass,
    asyncHandle: receipt.asyncHandle || existing.asyncHandle,
    asyncTerminal: receipt.asyncTerminal || existing.asyncTerminal
  })
  closeCorrelatedAsyncReceipts(state, key, receipt)
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
      existing.toolName !== terminal.toolName ||
      existing.asyncHandle !== terminal.asyncHandle
    ) {
      continue
    }
    state.calls.set(key, {
      ...terminal,
      callId: existing.callId,
      toolName: existing.toolName,
      effectClass: existing.effectClass,
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
    effectClass: 'child_agent',
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
      return !trusted.some((item) => item.effectClass === obligation.effectClass)
    }
    return trusted.length === 0
  })
  const claimedEffect = affirmativeExecutionClaim(state.assistantText)
  const claimUnverified = claimedEffect !== null && !trusted.some((item) => (
    claimedEffect === 'any' || item.effectClass === claimedEffect
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
  const value = executionIntentText(text).toLowerCase()
  if (
    /(?:发送|提交|上传|部署|发布|创建).{0,12}(?:消息|邮件|工单|issue|pr|pull request)/u.test(value) ||
    /\b(?:send|submit|upload|deploy|publish|create|open)\b.{0,16}\b(?:message|email|issue|ticket|pr|pull request)\b/iu.test(value)
  ) {
    return {
      id: 'requested-execution',
      kind: 'effect',
      effectClass: 'external_mutation',
      source: 'user'
    }
  }
  if (
    /(?:修改|编辑|新增|创建|删除|移除|安装|修复|实现).{0,16}(?:文件|代码|项目|应用|依赖|功能)?/u.test(value) ||
    /\b(?:edit|modify|create|delete|remove|install|implement|fix|patch|write)\b/iu.test(value)
  ) {
    return {
      id: 'requested-execution',
      kind: 'effect',
      effectClass: 'local_write',
      source: 'user'
    }
  }
  if (
    /(?:发送|提交|上传|部署|发布)/u.test(value) ||
    /\b(?:send|submit|upload|deploy|publish)\b/iu.test(value)
  ) {
    return {
      id: 'requested-execution',
      kind: 'effect',
      effectClass: 'external_mutation',
      source: 'user'
    }
  }
  if (/(?:执行|运行)/u.test(value) || /\b(?:run|execute)\b/iu.test(value)) {
    return {
      id: 'requested-execution',
      kind: 'effect',
      effectClass: 'command_execution',
      source: 'user'
    }
  }
  return { id: 'requested-execution', kind: 'any_success', source: 'user' }
}

function effectClassFromEvent(
  event: Extract<AgentRuntimeEvent, { kind: 'tool_event' | 'item_snapshot' }>,
  toolName: string,
  meta: Record<string, unknown>
): ExecutionEffectClass {
  const toolKind = event.kind === 'tool_event' ? event.toolKind : event.item.toolKind
  if (toolKind === 'file_change') return 'local_write'
  const name = normalizedToolName(toolName)
  if (/(?:^|_)(?:apply_patch|write|edit|delete|remove|move|copy|mkdir|install)(?:_|$)/u.test(name)) {
    return 'local_write'
  }
  if (/(?:^|_)(?:send|submit|upload|deploy|publish|create_issue|github|slack)(?:_|$)/u.test(name)) {
    return 'external_mutation'
  }
  const argumentsValue = recordValue(meta.arguments)
  const command = [
    stringValue(meta.command),
    stringValue(argumentsValue.command),
    stringValue(argumentsValue.cmd)
  ].filter(Boolean).join(' ')
  if (
    toolKind === 'command_execution' &&
    /(?:^|\s)(?:apply_patch|rm|mv|cp|mkdir|touch|install)(?:\s|$)|(?:sed\s+-i|>>?|\btee\b)/iu.test(command)
  ) {
    return 'local_write'
  }
  if (
    toolKind === 'command_execution' ||
    /(?:^|_)(?:local_shell|shell|bash|exec|execute_command)(?:_|$)/u.test(name)
  ) return 'command_execution'
  if (/(?:^|_)(?:read|view|find|search|list|get|fetch|open)(?:_|$)/u.test(name)) return 'read'
  return 'other'
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
