import {
  normalizeRuntimeGuardSettings,
  type RuntimeGuardSettingsV1
} from '../../../shared/app-settings'
import type {
  AgentRuntimeCapabilities,
  AgentRuntimeEvent,
  AgentRuntimeGovernanceProfile,
  AgentRuntimeId,
  AgentRuntimeToolKind,
  AgentRuntimeTurnSteerInput,
  AgentRuntimeTurnTargetInput
} from '../../../shared/agent-runtime-contract'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './adapter'

type RuntimeGovernanceControls = {
  governanceProfile?: AgentRuntimeGovernanceProfile
  steerTurn(input: AgentRuntimeTurnSteerInput): Promise<void>
  interruptTurn(input: AgentRuntimeTurnTargetInput): Promise<void>
  publishSyntheticEvent(event: AgentRuntimeEvent): Promise<AgentRuntimeEvent | null>
}

type ToolStormState = {
  events: ToolFingerprint[]
  steered: Set<string>
  interrupted: Set<string>
  recoveryAttempts: Map<string, number>
  hygieneReplayAttempts: Map<string, number>
  observedRunningToolIds: Set<string>
  fingerprintsByToolId: Map<string, ToolFingerprint>
  receiptsByExactCall: Map<string, ToolReceiptState>
}

type ToolFingerprint = {
  exact: string
  family: string
}

type ToolReceiptState = {
  status: 'success' | 'error'
  detail: string
  errorCode: string
}

const MAX_TOOL_STORM_RECOVERY_ATTEMPTS = 2
const MAX_HYGIENE_REPLAY_RECOVERY_ATTEMPTS = 2

export class RuntimeGovernanceSupervisor {
  private readonly toolStormStates = new Map<string, ToolStormState>()

  observe(
    event: AgentRuntimeEvent,
    capabilities: AgentRuntimeCapabilities,
    settings: RuntimeGuardSettingsV1,
    controls: RuntimeGovernanceControls
  ): void {
    if (event.kind !== 'tool_event') return
    if (capabilities.guard.toolStorm !== 'observe') return
    const threadId = event.threadId.trim()
    const turnId = event.turnId?.trim()
    if (!threadId || !turnId) return
    if (!settings.toolStorm.enabled) return
    const key = `${capabilities.runtimeId}:${threadId}:${turnId}`
    const state: ToolStormState = this.toolStormStates.get(key) ?? {
      events: [],
      steered: new Set(),
      interrupted: new Set(),
      recoveryAttempts: new Map(),
      hygieneReplayAttempts: new Map(),
      observedRunningToolIds: new Set(),
      fingerprintsByToolId: new Map(),
      receiptsByExactCall: new Map()
    }
    const toolId = runningToolIdentity(event)
    if (event.status !== 'running') {
      rememberTerminalReceipt(state, event, toolId)
      this.toolStormStates.set(key, state)
      return
    }
    if (toolId && state.observedRunningToolIds.has(toolId)) {
      this.toolStormStates.set(key, state)
      return
    }
    if (toolId) state.observedRunningToolIds.add(toolId)
    const fingerprint = toolFingerprint(event)
    if (toolId) state.fingerprintsByToolId.set(toolId, fingerprint)
    if (fingerprint.family === 'command_execution:shell/history-placeholder') {
      this.handleHistoryHygieneReplay(event, capabilities.runtimeId, state, fingerprint, controls)
      this.toolStormStates.set(key, state)
      return
    }
    state.events.push(fingerprint)
    state.events = state.events.slice(-settings.toolStorm.windowSize)
    this.toolStormStates.set(key, state)

    const softThreshold = settings.toolStorm.threshold
    const hardThreshold = softThreshold + 1
    const exactCount = countMatches(state.events, 'exact', fingerprint.exact)
    const exactSteerKey = `exact:${fingerprint.exact}`
    const exactInterruptKey = `exact:${fingerprint.exact}`
    if (exactCount >= hardThreshold) {
      const recoveryAttempt = state.recoveryAttempts.get(exactInterruptKey) ?? 0
      if (recoveryAttempt < MAX_TOOL_STORM_RECOVERY_ATTEMPTS) {
        const nextRecoveryAttempt = recoveryAttempt + 1
        state.recoveryAttempts.set(exactInterruptKey, nextRecoveryAttempt)
        state.events = state.events.filter((item) => item.exact !== fingerprint.exact)
        void controls.steerTurn({
          runtimeId: capabilities.runtimeId,
          threadId,
          turnId,
          text: toolStormRecoveryInstruction(
            event,
            fingerprint.family,
            nextRecoveryAttempt,
            receiptEvidence(state, fingerprint.exact)
          )
        }).catch(() => undefined)
        void publishToolStormEvent(
          controls,
          event,
          capabilities.runtimeId,
          'recovery',
          fingerprint.family,
          nextRecoveryAttempt
        )
        return
      }
      if (state.interrupted.has(exactInterruptKey)) return
      state.interrupted.add(exactInterruptKey)
      void controls.interruptTurn({
        runtimeId: capabilities.runtimeId,
        threadId,
        turnId,
        discard: false
      }).catch(() => undefined)
      void publishToolStormEvent(controls, event, capabilities.runtimeId, 'hard', fingerprint.family)
      return
    }
    if (exactCount >= softThreshold && !state.steered.has(exactSteerKey)) {
      state.steered.add(exactSteerKey)
      void controls.steerTurn({
        runtimeId: capabilities.runtimeId,
        threadId,
        turnId,
        text: toolStormSteeringInstruction(
          fingerprint.family,
          receiptEvidence(state, fingerprint.exact)
        )
      }).catch(() => undefined)
      void publishToolStormEvent(controls, event, capabilities.runtimeId, 'soft', fingerprint.family)
    }
  }

  private handleHistoryHygieneReplay(
    event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>,
    runtimeId: AgentRuntimeId,
    state: ToolStormState,
    fingerprint: ToolFingerprint,
    controls: RuntimeGovernanceControls
  ): void {
    const replayKey = fingerprint.family
    const attempt = (state.hygieneReplayAttempts.get(replayKey) ?? 0) + 1
    state.hygieneReplayAttempts.set(replayKey, attempt)
    if (attempt <= MAX_HYGIENE_REPLAY_RECOVERY_ATTEMPTS) {
      void controls.steerTurn({
        runtimeId,
        threadId: event.threadId,
        turnId: event.turnId?.trim() || '',
        text: historyHygieneRecoveryInstruction(attempt)
      }).catch(() => undefined)
      void publishHistoryHygieneEvent(controls, event, runtimeId, 'recovery', attempt)
      return
    }
    const interruptKey = `hygiene:${replayKey}`
    if (state.interrupted.has(interruptKey)) return
    state.interrupted.add(interruptKey)
    void controls.interruptTurn({
      runtimeId,
      threadId: event.threadId,
      turnId: event.turnId?.trim() || '',
      discard: false
    }).catch(() => undefined)
    void publishHistoryHygieneEvent(controls, event, runtimeId, 'hard', attempt)
  }
}

export async function adapterCapabilities(
  adapter: AgentRuntimeAdapter,
  context: AgentRuntimeAdapterContext
): Promise<AgentRuntimeCapabilities> {
  return adapter.capabilities(context)
}

export function runtimeGuardSettings(context: AgentRuntimeAdapterContext): RuntimeGuardSettingsV1 {
  return normalizeRuntimeGuardSettings(context.settings.runtimeGuards)
}

function toolFingerprint(event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>): ToolFingerprint {
  const meta = recordValue(event.meta)
  const toolName = stringValue(meta.toolName) || event.summary?.trim() || event.toolKind || 'tool'
  const args = meta.arguments ?? argumentLikeMeta(meta)
  const kind = event.toolKind ?? 'tool_call'
  const family = behaviorFamily(toolName, kind, meta, event.detail)
  const exactArgs = exactArgumentsForFingerprint(args, event, toolName, meta)
  return {
    exact: `${kind}:${toolName}:${canonicalJson(exactArgs)}`,
    family: `${kind}:${family}`
  }
}

function exactArgumentsForFingerprint(
  args: unknown,
  event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>,
  toolName: string,
  meta: Record<string, unknown>
): unknown {
  if (!isComputerUseTool(toolName, meta)) return args
  return {
    args,
    invocation: runningToolIdentity(event) || event.itemId || stringValue(meta.callId)
  }
}

function isComputerUseTool(toolName: string, meta: Record<string, unknown>): boolean {
  const normalizedName = toolName.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  const server = stringValue(meta.server).toLowerCase()
  return normalizedName === 'computer_use' ||
    normalizedName.endsWith('_computer_use') ||
    server === 'gui_owl_computer_use'
}

function behaviorFamily(
  toolName: string,
  kind: AgentRuntimeToolKind,
  meta: Record<string, unknown>,
  detail?: string
): string {
  if (kind === 'file_change') return 'file-change'
  const command = commandExecutionText(meta, detail)
  if (kind === 'command_execution') return commandFamily(command)
  const normalized = toolName.toLowerCase()
  if (/(search|grep|find|rg|query)/.test(normalized)) return 'search-read'
  if (/(read|open|cat|fetch|get|list)/.test(normalized)) return 'read'
  if (/(write|create|update|delete|patch|edit)/.test(normalized)) return 'write'
  return normalized || 'tool'
}

function commandExecutionText(meta: Record<string, unknown>, detail?: string): string {
  const command = stringValue(meta.command)
  const args = recordValue(meta.arguments)
  const argumentCommand = stringValue(args.cmd) || stringValue(args.command)
  const argumentArgs = firstStringArray(args.args, args.argv)
  const wrappedCommand = shellScriptFromCommandAndArgs(command || argumentCommand, argumentArgs)
  if (wrappedCommand) return wrappedCommand
  const wrappedArgumentCommand = shellScriptFromCommand(argumentCommand)
  if (wrappedArgumentCommand) return wrappedArgumentCommand
  const wrappedDetail = shellScriptFromCommand(detail?.trim() || '')
  if (wrappedDetail) return wrappedDetail
  return command || argumentCommand || detail?.trim() || ''
}

function commandFamily(command: string): string {
  const effectiveCommand = shellScriptFromCommand(command) || command
  if (isHistoryHygieneCommand(effectiveCommand)) return 'shell/history-placeholder'
  const head = commandName(shellTokens(effectiveCommand)[0] || 'shell')
  if (head === 'date' || head === 'time') return 'shell/date'
  if (['cat', 'sed', 'head', 'tail', 'nl', 'less'].includes(head)) return 'shell/read-file'
  if (['rg', 'grep', 'find', 'fd'].includes(head)) return 'shell/search'
  if (['ls', 'pwd', 'stat'].includes(head)) return 'shell/list'
  if (['curl', 'wget'].includes(head)) return 'shell/fetch'
  return `shell/${head}`
}

function isHistoryHygieneCommand(command: string): boolean {
  const trimmed = command.trim()
  if (trimmed.length >= 4096) return false
  return (
    trimmed.startsWith('[cache hygiene:') ||
    trimmed.startsWith('[sciforge request_hygiene') ||
    /^(?::|false)\s*#\s*sciforge\s+(?:history metadata only|history omitted prior (?:bash|shell) command|request hygiene omitted prior shell command)\b/iu.test(trimmed)
  )
}

function shellScriptFromCommandAndArgs(command: string, args: string[]): string {
  const tokens = shellTokens(command)
  if (!args.length) return shellScriptFromTokens(tokens)
  if (!tokens.length) return shellScriptFromTokens(args)
  return shellScriptFromTokens([...tokens, ...args])
}

function shellScriptFromCommand(command: string): string {
  return shellScriptFromTokens(shellTokens(command))
}

function shellScriptFromTokens(tokens: string[]): string {
  if (tokens.length < 2) return ''
  const shellIndex = shellExecutableIndex(tokens)
  if (shellIndex < 0) return ''
  for (let index = shellIndex + 1; index < tokens.length - 1; index += 1) {
    const token = tokens[index]
    if (token === '--') continue
    if (!token.startsWith('-')) break
    if (token === '-c' || /^-[^-]*c/.test(token)) return tokens[index + 1]?.trim() || ''
  }
  return ''
}

function shellExecutableIndex(tokens: string[]): number {
  if (isShellExecutable(tokens[0])) return 0
  if (commandName(tokens[0]) !== 'env') return -1
  return tokens.findIndex((token, index) =>
    index > 0 &&
    !token.startsWith('-') &&
    !/^[A-Za-z_][A-Za-z0-9_]*=/.test(token) &&
    isShellExecutable(token)
  )
}

function isShellExecutable(token: string | undefined): boolean {
  return ['sh', 'bash', 'zsh', 'dash', 'fish'].includes(commandName(token || ''))
}

function commandName(token: string): string {
  return token.trim().split(/[\\/]/).pop()?.toLowerCase() || 'shell'
}

function shellTokens(command: string): string[] {
  const tokens: string[] = []
  let current = ''
  let quote: '"' | "'" | '' = ''
  let escaped = false
  for (const char of command.trim()) {
    if (escaped) {
      current += char
      escaped = false
      continue
    }
    if (char === '\\' && quote !== "'") {
      escaped = true
      continue
    }
    if (quote) {
      if (char === quote) {
        quote = ''
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      continue
    }
    if (/\s/.test(char)) {
      if (current) {
        tokens.push(current)
        current = ''
      }
      continue
    }
    current += char
  }
  if (escaped) current += '\\'
  if (current) tokens.push(current)
  return tokens
}

async function publishToolStormEvent(
  controls: RuntimeGovernanceControls,
  source: AgentRuntimeEvent,
  runtimeId: AgentRuntimeId,
  level: 'soft' | 'recovery' | 'hard',
  family: string,
  recoveryAttempt?: number
): Promise<void> {
  await controls.publishSyntheticEvent({
    kind: 'runtime_status',
    threadId: source.threadId,
    runtimeId,
    turnId: source.turnId,
    phase: 'tool_running',
    message: level === 'hard'
      ? `Runtime guard interrupted repeated ${family} tool activity after recovery was exhausted.`
      : level === 'recovery'
        ? `Runtime guard supplied missing-receipt context and asked the model to recover repeated ${family} tool activity.`
        : `Runtime guard steered repeated ${family} tool activity.`,
    metadata: {
      synthetic: true,
      guard: 'toolStorm',
      level,
      family,
      ...(recoveryAttempt ? { recoveryAttempt } : {})
    }
  })
  if (level === 'hard') {
    await controls.publishSyntheticEvent({
      kind: 'error',
      threadId: source.threadId,
      runtimeId,
      turnId: source.turnId,
      itemId: `runtime-guard-tool-storm-${source.turnId || source.threadId}`,
      recoverable: true,
      severity: 'error',
      code: 'runtime_tool_storm_interrupted',
      message: `Runtime guard stopped this turn after repeated ${family} tool activity could not be recovered.`,
      detail: `The runtime supplied ${MAX_TOOL_STORM_RECOVERY_ATTEMPTS} recovery instructions before interrupting the repeated tool-call loop. Tool family: ${family}.`
    })
  }
}

async function publishHistoryHygieneEvent(
  controls: RuntimeGovernanceControls,
  source: AgentRuntimeEvent,
  runtimeId: AgentRuntimeId,
  level: 'recovery' | 'hard',
  attempt: number
): Promise<void> {
  await controls.publishSyntheticEvent({
    kind: 'runtime_status',
    threadId: source.threadId,
    runtimeId,
    turnId: source.turnId,
    phase: 'tool_running',
    message: level === 'hard'
      ? 'Runtime guard interrupted repeated execution of history-only tool arguments.'
      : 'Runtime guard rejected a history-only tool argument and requested a fresh action.',
    metadata: {
      synthetic: true,
      guard: 'toolArgumentHygiene',
      level,
      family: 'command_execution:shell/history-placeholder',
      recoveryAttempt: attempt
    }
  })
  if (level === 'hard') {
    await controls.publishSyntheticEvent({
      kind: 'error',
      threadId: source.threadId,
      runtimeId,
      turnId: source.turnId,
      itemId: `runtime-guard-history-hygiene-${source.turnId || source.threadId}`,
      recoverable: true,
      severity: 'error',
      code: 'runtime_history_hygiene_replay',
      message: 'Runtime guard stopped this turn after history-only tool arguments were repeatedly replayed.',
      detail: [
        `The runtime supplied ${MAX_HYGIENE_REPLAY_RECOVERY_ATTEMPTS} targeted recovery instructions.`,
        'The repeated argument was compressed history metadata, not an executable action.',
        'Resume from verified task state and create a fresh, smaller action.'
      ].join(' ')
    })
  }
}

function historyHygieneRecoveryInstruction(attempt: number): string {
  return [
    `Runtime history-argument recovery ${attempt}/${MAX_HYGIENE_REPLAY_RECOVERY_ATTEMPTS}: the latest tool argument is compressed history metadata, not an executable action.`,
    'Discard it completely; do not retry it and do not reconstruct the omitted command from its marker.',
    'Re-read the current task or workspace state, create a fresh smaller action with newly authored arguments, and verify a concrete state change before continuing.'
  ].join(' ')
}

function toolStormSteeringInstruction(family: string, receipt: string): string {
  return [
    `Runtime detected a repeated ${family} tool call; ${receipt}.`,
    'A successful process exit alone is not evidence of task progress.',
    'Inspect the latest result, do not repeat the identical call, and continue with a different verifiable action.'
  ].join(' ')
}

function toolStormRecoveryInstruction(
  event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>,
  family: string,
  recoveryAttempt: number,
  receipt: string
): string {
  const meta = recordValue(event.meta)
  const callId = stringValue(event.callId) ||
    stringValue(meta.callId) ||
    stringValue(meta.toolCallId) ||
    event.itemId.trim()
  const errorCode = stringValue(event.errorCode) || stringValue(meta.errorCode)
  const detail = boundedRecoveryDetail(event.detail || stringValue(meta.error) || stringValue(meta.message))
  const evidence = [
    `tool family: ${family}`,
    callId ? `latest call: ${callId}` : '',
    errorCode ? `error code: ${errorCode}` : '',
    detail ? `latest detail: ${detail}` : '',
    `receipt status: ${receipt}`
  ].filter(Boolean).join('; ')
  return [
    `Runtime recovery ${recoveryAttempt}/${MAX_TOOL_STORM_RECOVERY_ATTEMPTS}: ${evidence}.`,
    'Use this failure information to diagnose the problem. Do not repeat the identical call.',
    'Try a different tool, corrected arguments, or another verifiable method, then continue and complete the original user task.',
    'Only report a blocker after the available recovery paths have genuinely failed.'
  ].join(' ')
}

function rememberTerminalReceipt(
  state: ToolStormState,
  event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>,
  toolId: string
): void {
  if (!toolId) return
  const fingerprint = state.fingerprintsByToolId.get(toolId)
  if (!fingerprint) return
  const meta = recordValue(event.meta)
  state.receiptsByExactCall.set(fingerprint.exact, {
    status: event.status === 'success' ? 'success' : 'error',
    detail: boundedRecoveryDetail(event.detail || stringValue(meta.error) || stringValue(meta.message)),
    errorCode: stringValue(event.errorCode) || stringValue(meta.errorCode)
  })
}

function receiptEvidence(state: ToolStormState, exact: string): string {
  const receipt = state.receiptsByExactCall.get(exact)
  if (!receipt) return 'no terminal executor receipt observed for a prior identical call'
  if (receipt.status === 'success') {
    return 'a prior identical call completed successfully, but repeating it does not demonstrate task progress'
  }
  const context = [
    receipt.errorCode ? `error code ${receipt.errorCode}` : '',
    receipt.detail
  ].filter(Boolean).join(': ')
  return context
    ? `a prior identical call failed (${context})`
    : 'a prior identical call failed'
}

function boundedRecoveryDetail(value: string): string {
  return value.trim().replace(/\s+/g, ' ').slice(0, 800)
}

function countMatches<T extends keyof ToolFingerprint>(
  events: ToolFingerprint[],
  key: T,
  value: ToolFingerprint[T]
): number {
  return events.filter((event) => event[key] === value).length
}

function runningToolIdentity(event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>): string {
  const meta = recordValue(event.meta)
  const callId = stringValue(meta.callId) ||
    stringValue(meta.toolCallId) ||
    stringValue(meta.call_id) ||
    stringValue(meta.tool_call_id)
  if (callId) return `call:${callId}`
  const itemId = event.itemId.trim()
  if (!itemId || itemId === 'codex-local-shell-call' || itemId === 'codex-tool-output') return ''
  return `item:${itemId}`
}

function argumentLikeMeta(meta: Record<string, unknown>): unknown {
  return {
    command: meta.command,
    cwd: meta.cwd,
    filePath: meta.filePath,
    path: meta.path,
    query: meta.query
  }
}

function canonicalJson(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  return JSON.stringify(value)
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function stringArrayValue(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(stringValue).filter(Boolean)
}

function firstStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    const strings = stringArrayValue(value)
    if (strings.length) return strings
  }
  return []
}
