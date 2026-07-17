import {
  ExecutionGovernorCore,
  type ExecutionAttemptInput,
  type ExecutionGovernorContext,
  type ExecutionGovernorDecision,
  type NormalizedExecutionReceipt
} from '@sciforge/execution-governance'
import {
  normalizeRuntimeGuardSettings,
  type RuntimeGuardSettingsV1
} from '../../../shared/app-settings'
import {
  isAgentRuntimeTerminalTurnState,
  type AgentRuntimeCapabilities,
  type AgentRuntimeEvent,
  type AgentRuntimeGovernanceProfile,
  type AgentRuntimeId,
  type AgentRuntimeTurnSteerInput,
  type AgentRuntimeTurnTargetInput
} from '../../../shared/agent-runtime-contract'
import type { AgentRuntimeAdapter, AgentRuntimeAdapterContext } from './adapter'

type RuntimeGovernanceControls = {
  governanceProfile?: AgentRuntimeGovernanceProfile
  ownedSurfaceInspectionAvailable?: boolean
  steerTurn(input: AgentRuntimeTurnSteerInput): Promise<void>
  interruptTurn(input: AgentRuntimeTurnTargetInput): Promise<void>
  publishSyntheticEvent(event: AgentRuntimeEvent): Promise<AgentRuntimeEvent | null>
}

type GovernanceState = {
  governor: ExecutionGovernorCore
  observedRunningToolIds: Set<string>
  callIdsByToolId: Map<string, string>
  exactRecoveryAttempts: Map<string, number>
  receiptsByExactFingerprint: Map<string, NormalizedExecutionReceipt>
  hygieneReplayAttempts: number
  actions: Set<string>
}

const MAX_EXACT_RECOVERY_ATTEMPTS = 2
const MAX_HYGIENE_REPLAY_RECOVERY_ATTEMPTS = 2

export class RuntimeGovernanceSupervisor {
  private readonly states = new Map<string, GovernanceState>()

  observe(
    event: AgentRuntimeEvent,
    capabilities: AgentRuntimeCapabilities,
    settings: RuntimeGuardSettingsV1,
    controls: RuntimeGovernanceControls
  ): void {
    const threadId = event.threadId.trim()
    const turnId = event.turnId?.trim()
    if (!threadId || !turnId) return
    const key = `${capabilities.runtimeId}:${threadId}:${turnId}`
    if (event.kind === 'turn_lifecycle' && isAgentRuntimeTerminalTurnState(event.state)) {
      this.states.delete(key)
      return
    }
    if (event.kind !== 'tool_event') return
    if (capabilities.guard.execution !== 'observe' || !settings.execution.enabled) return

    const state = this.states.get(key) ?? createGovernanceState(settings)
    this.states.set(key, state)
    const toolId = runningToolIdentity(event)
    const callId = toolCallId(event, toolId)
    const context = governanceContext(capabilities, controls)

    if (event.status !== 'running') {
      const correlatedCallId = state.callIdsByToolId.get(toolId) || callId
      const receipt = state.governor.recordReceipt(correlatedCallId, receiptInput(event), context)
      state.receiptsByExactFingerprint.set(
        receipt.decision.attempt.exactFingerprint,
        receipt.receipt
      )
      this.handleReceiptDecision(event, capabilities.runtimeId, state, receipt.receipt, receipt.decision, controls)
      return
    }
    if (toolId && state.observedRunningToolIds.has(toolId)) return
    if (toolId) {
      state.observedRunningToolIds.add(toolId)
      state.callIdsByToolId.set(toolId, callId)
    }

    const attempt = attemptInput(event, callId)
    if (isHistoryHygieneAttempt(attempt)) {
      this.handleHistoryHygieneReplay(event, capabilities.runtimeId, state, controls)
      return
    }
    const decision = state.governor.inspectAttempt(attempt, context)
    this.handleAttemptDecision(event, capabilities.runtimeId, state, decision, controls)
  }

  private handleAttemptDecision(
    event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>,
    runtimeId: AgentRuntimeId,
    state: GovernanceState,
    decision: ExecutionGovernorDecision,
    controls: RuntimeGovernanceControls
  ): void {
    if (decision.action === 'allow') return
    const decisionKey = decision.code === 'semantic_failure_exhausted' ||
      decision.code === 'owned_surface_policy_denied'
      ? `${decision.code}:${decision.attempt.family}:${decision.attempt.resourceIdentity}`
      : `${decision.code || 'governance'}:${decision.attempt.exactFingerprint}`
    if (decision.code === 'exact_repeat' && decision.action === 'deny') {
      const recoveryAttempt = state.exactRecoveryAttempts.get(decisionKey) ?? 0
      if (recoveryAttempt < MAX_EXACT_RECOVERY_ATTEMPTS) {
        const nextAttempt = recoveryAttempt + 1
        state.exactRecoveryAttempts.set(decisionKey, nextAttempt)
        void this.steer(
          event,
          runtimeId,
          controls,
          decision,
          'recovery',
          nextAttempt,
          state.receiptsByExactFingerprint.get(decision.attempt.exactFingerprint)
        )
        return
      }
    }
    if (state.actions.has(`${decisionKey}:${decision.action}`)) return
    state.actions.add(`${decisionKey}:${decision.action}`)
    if (decision.action === 'steer') {
      void this.steer(
        event,
        runtimeId,
        controls,
        decision,
        'soft',
        undefined,
        state.receiptsByExactFingerprint.get(decision.attempt.exactFingerprint)
      )
      return
    }
    void this.interrupt(event, runtimeId, controls, decision)
  }

  private handleReceiptDecision(
    event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>,
    runtimeId: AgentRuntimeId,
    state: GovernanceState,
    receipt: NormalizedExecutionReceipt,
    decision: ExecutionGovernorDecision,
    controls: RuntimeGovernanceControls
  ): void {
    if (decision.action === 'allow') return
    const key = `receipt:${decision.code || 'governance'}:${receipt.family}:${receipt.failureClass}:${receipt.resourceIdentity}`
    if (state.actions.has(key)) return
    state.actions.add(key)
    if (decision.action === 'deny') {
      void this.interrupt(event, runtimeId, controls, decision)
      return
    }
    void this.steer(event, runtimeId, controls, decision, 'recovery', 1, receipt)
  }

  private async steer(
    event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>,
    runtimeId: AgentRuntimeId,
    controls: RuntimeGovernanceControls,
    decision: ExecutionGovernorDecision,
    level: 'soft' | 'recovery',
    recoveryAttempt?: number,
    receipt?: NormalizedExecutionReceipt
  ): Promise<void> {
    const text = governanceInstruction(decision, receipt, recoveryAttempt)
    void controls.steerTurn({
      runtimeId,
      threadId: event.threadId,
      turnId: event.turnId?.trim() || '',
      text
    }).catch(() => undefined)
    await publishGovernanceEvent(controls, event, runtimeId, level, decision, recoveryAttempt)
  }

  private async interrupt(
    event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>,
    runtimeId: AgentRuntimeId,
    controls: RuntimeGovernanceControls,
    decision: ExecutionGovernorDecision
  ): Promise<void> {
    void controls.interruptTurn({
      runtimeId,
      threadId: event.threadId,
      turnId: event.turnId?.trim() || '',
      discard: false
    }).catch(() => undefined)
    await publishGovernanceEvent(controls, event, runtimeId, 'hard', decision)
  }

  private handleHistoryHygieneReplay(
    event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>,
    runtimeId: AgentRuntimeId,
    state: GovernanceState,
    controls: RuntimeGovernanceControls
  ): void {
    state.hygieneReplayAttempts += 1
    const attempt = state.hygieneReplayAttempts
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
    if (state.actions.has('history-hygiene:hard')) return
    state.actions.add('history-hygiene:hard')
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

function createGovernanceState(settings: RuntimeGuardSettingsV1): GovernanceState {
  return {
    governor: new ExecutionGovernorCore({
      windowSize: settings.execution.windowSize,
      threshold: settings.execution.exactRepeatThreshold,
      semanticFailureThreshold: settings.execution.semanticFailureThreshold
    }),
    observedRunningToolIds: new Set(),
    callIdsByToolId: new Map(),
    exactRecoveryAttempts: new Map(),
    receiptsByExactFingerprint: new Map(),
    hygieneReplayAttempts: 0,
    actions: new Set()
  }
}

function attemptInput(
  event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>,
  callId: string
): ExecutionAttemptInput {
  const meta = recordValue(event.meta)
  const toolName = event.toolName?.trim() || stringValue(meta.toolName) || event.summary?.trim() || event.toolKind || 'tool'
  const rawArguments = recordValue(meta.arguments)
  const argumentsValue = Object.keys(rawArguments).length
    ? rawArguments
    : {
        ...(stringValue(meta.command) ? { command: stringValue(meta.command) } : {}),
        ...(stringValue(meta.path) ? { path: stringValue(meta.path) } : {}),
        ...(stringValue(meta.filePath) ? { filePath: stringValue(meta.filePath) } : {}),
        ...(stringValue(meta.query) ? { query: stringValue(meta.query) } : {})
      }
  return {
    callId,
    toolName,
    providerId: stringValue(meta.providerId) || undefined,
    toolKind: event.toolKind,
    arguments: argumentsValue,
    metadata: {
      ...meta,
      ...(event.detail ? { detail: event.detail } : {})
    }
  }
}

function receiptInput(event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>) {
  const meta = recordValue(event.meta)
  return {
    status: event.status === 'success' ? 'success' as const : 'error' as const,
    output: meta.structuredContent ?? meta.output ?? meta.result ?? event.detail,
    errorCode: event.errorCode || stringValue(meta.errorCode) || stringValue(meta.code),
    failureClass: stringValue(meta.failureClass),
    resourceIdentity: stringValue(meta.resourceIdentity) || stringValue(meta.resourceRef),
    evidenceDelta: booleanValue(meta.evidenceDelta),
    stateChanged: booleanValue(meta.stateChanged) ?? booleanValue(meta.changed),
    detail: event.detail || stringValue(meta.error) || stringValue(meta.message)
  }
}

function governanceContext(
  capabilities: AgentRuntimeCapabilities,
  controls: RuntimeGovernanceControls
): ExecutionGovernorContext {
  const registryAdvertisesSurfaceInspect = (capabilities.capabilityDescriptors ?? []).some(
    (descriptor) => String(descriptor.id) === 'surface.inspect' && descriptor.available
  )
  return {
    ownedSurfaceInspectionAvailable:
      controls.ownedSurfaceInspectionAvailable === true || registryAdvertisesSurfaceInspect
  }
}

function governanceInstruction(
  decision: ExecutionGovernorDecision,
  receipt?: NormalizedExecutionReceipt,
  recoveryAttempt?: number
): string {
  const evidence = receipt
    ? [
        `failure class: ${receipt.failureClass}`,
        receipt.errorCode ? `error code: ${receipt.errorCode}` : '',
        receipt.resourceIdentity ? `resource: ${receipt.resourceIdentity}` : '',
        receipt.detail ? `detail: ${boundedDetail(receipt.detail)}` : ''
      ].filter(Boolean).join('; ')
    : ''
  return [
    recoveryAttempt ? `Runtime recovery ${recoveryAttempt}/${MAX_EXACT_RECOVERY_ATTEMPTS}.` : '',
    decision.reason,
    evidence,
    decision.guidance,
    'Continue the original task only with a distinct, verifiable action.'
  ].filter(Boolean).join(' ')
}

async function publishGovernanceEvent(
  controls: RuntimeGovernanceControls,
  source: AgentRuntimeEvent,
  runtimeId: AgentRuntimeId,
  level: 'soft' | 'recovery' | 'hard',
  decision: ExecutionGovernorDecision,
  recoveryAttempt?: number
): Promise<void> {
  await controls.publishSyntheticEvent({
    kind: 'runtime_status',
    threadId: source.threadId,
    runtimeId,
    turnId: source.turnId,
    phase: 'tool_running',
    message: level === 'hard'
      ? `Execution governance interrupted ${decision.attempt.family} activity.`
      : `Execution governance ${level === 'soft' ? 'steered' : 'requested recovery for'} ${decision.attempt.family} activity.`,
    metadata: {
      synthetic: true,
      guard: 'execution',
      governor: 'execution-governance-v2',
      level,
      code: decision.code,
      family: decision.attempt.family,
      resourceIdentity: decision.attempt.resourceIdentity,
      ...(recoveryAttempt ? { recoveryAttempt } : {})
    }
  })
  if (level === 'hard') {
    await controls.publishSyntheticEvent({
      kind: 'error',
      threadId: source.threadId,
      runtimeId,
      turnId: source.turnId,
      itemId: `execution-governance-${source.turnId || source.threadId}`,
      recoverable: true,
      severity: 'error',
      code: decision.code === 'owned_surface_policy_denied'
        ? 'runtime_execution_policy_denied'
        : 'runtime_execution_interrupted',
      message: decision.reason || `Execution governance stopped ${decision.attempt.family} activity.`,
      detail: decision.guidance
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
      detail: 'Resume from verified task state and create a fresh, smaller action.'
    })
  }
}

function historyHygieneRecoveryInstruction(attempt: number): string {
  return [
    `Runtime history-argument recovery ${attempt}/${MAX_HYGIENE_REPLAY_RECOVERY_ATTEMPTS}: the latest tool argument is compressed history metadata, not an executable action.`,
    'Discard it completely; do not retry it and do not reconstruct the omitted command from its marker.',
    'Re-read current task state, create a fresh smaller action, and verify a concrete state change.'
  ].join(' ')
}

function isHistoryHygieneAttempt(attempt: ExecutionAttemptInput): boolean {
  if (attempt.toolKind !== 'command_execution') return false
  const command = effectiveCommand(attempt)
  if (command.length >= 4_096) return false
  return command.startsWith('[cache hygiene:') ||
    command.startsWith('[sciforge request_hygiene') ||
    /^(?::|false)\s*#\s*sciforge\s+(?:history metadata only|history omitted prior (?:bash|shell) command|request hygiene omitted prior shell command)\b/iu.test(command)
}

function effectiveCommand(attempt: ExecutionAttemptInput): string {
  const command = stringValue(attempt.arguments.command) ||
    stringValue(attempt.arguments.cmd) ||
    stringValue(attempt.metadata?.command)
  const args = firstStringArray(attempt.arguments.args, attempt.arguments.argv)
  const shell = command.split(/[\\/]/u).pop()?.toLowerCase()
  if (!['sh', 'bash', 'zsh', 'dash', 'fish'].includes(shell || '')) return command
  const commandIndex = args.findIndex((value) => value === '-c' || value === '-lc' || /^-[^-]*c/u.test(value))
  return commandIndex >= 0 ? args[commandIndex + 1]?.trim() || command : command
}

function runningToolIdentity(event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>): string {
  const meta = recordValue(event.meta)
  const callId = event.callId?.trim() ||
    stringValue(meta.callId) ||
    stringValue(meta.toolCallId) ||
    stringValue(meta.call_id) ||
    stringValue(meta.tool_call_id)
  if (callId) return `call:${callId}`
  const itemId = event.itemId.trim()
  if (!itemId || itemId === 'codex-local-shell-call' || itemId === 'codex-tool-output') return ''
  return `item:${itemId}`
}

function toolCallId(
  event: Extract<AgentRuntimeEvent, { kind: 'tool_event' }>,
  toolId: string
): string {
  const meta = recordValue(event.meta)
  return event.callId?.trim() ||
    stringValue(meta.callId) ||
    stringValue(meta.toolCallId) ||
    stringValue(meta.call_id) ||
    stringValue(meta.tool_call_id) ||
    toolId ||
    event.itemId
}

function boundedDetail(value: string): string {
  return value.trim().replace(/\s+/gu, ' ').slice(0, 800)
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {}
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function firstStringArray(...values: unknown[]): string[] {
  for (const value of values) {
    if (!Array.isArray(value)) continue
    const result = value.map(stringValue).filter(Boolean)
    if (result.length) return result
  }
  return []
}
