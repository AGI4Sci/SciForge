import type {
  DomainMainAgentExecutionHost,
  DomainMainAgentExecutionRequest,
  DomainMainAgentExecutionResult
} from '@sciforge/domain-sdk/agent-execution'
import type {
  AgentRuntimeId,
  AgentRuntimeThreadPage,
  AgentRuntimeThreadStatus
} from '../../../shared/agent-runtime-contract'
import type { AgentRuntimeHost } from './host'

type ExecutionRuntimeHost = Pick<
  AgentRuntimeHost,
  | 'startThread'
  | 'startTurn'
  | 'interruptTurn'
  | 'reclaimEphemeralThread'
  | 'readThreadStatus'
  | 'readThreadPage'
  | 'subscribeTurnLifecycle'
>

export type DomainAgentExecutionHostOptions = Readonly<{
  agentRuntimeHost: ExecutionRuntimeHost
  resolveRuntimeId: (requestedRuntimeId?: string) => AgentRuntimeId | Promise<AgentRuntimeId>
  pollIntervalMs?: number
}>

type ExecutionState = {
  threadId: string
  turnId: string
  terminalState: 'completed' | 'failed' | 'cancelled' | null
}

export function createDomainAgentExecutionHost(
  options: DomainAgentExecutionHostOptions
): DomainMainAgentExecutionHost {
  return Object.freeze({
    run: (request) => executeDomainAgentRequest(options, request, false),
    runEphemeral: (request) => executeDomainAgentRequest(options, request, true)
  })
}

async function executeDomainAgentRequest(
  options: DomainAgentExecutionHostOptions,
  request: DomainMainAgentExecutionRequest,
  ephemeral: boolean
): Promise<DomainMainAgentExecutionResult> {
  if (request.signal?.aborted) throw abortReason(request.signal)
  const runtimeId = await options.resolveRuntimeId(request.runtimeId?.trim())
  const thread = await options.agentRuntimeHost.startThread({
    runtimeId,
    ephemeral,
    workspace: request.workspaceRoot,
    mode: request.mode,
    ...(request.model ? { model: request.model } : {}),
    relation: 'side',
    threadSource: 'domain-runtime',
    sidebarVisibility: request.interaction === 'reviewable' ? 'main' : 'hidden',
    ...(request.allowedTools ? { allowedTools: request.allowedTools } : {})
  })
  const state: ExecutionState = {
    threadId: thread.id,
    turnId: '',
    terminalState: null
  }
  let unsubscribe: (() => void | Promise<void>) | null = null
  let abortError: unknown = null
  let wakeTerminal: (() => void) | null = null
  let result: DomainMainAgentExecutionResult | undefined
  let primaryError: unknown

  const wake = (): void => {
    const current = wakeTerminal
    wakeTerminal = null
    current?.()
  }
  const pendingTerminalEvents: Array<Readonly<{
    turnId: string
    state: 'completed' | 'failed' | 'cancelled'
  }>> = []
  const acceptTerminalEvent = (event: Readonly<{
    turnId: string
    state: 'completed' | 'failed' | 'cancelled'
  }>): void => {
    if (!state.turnId) {
      pendingTerminalEvents.push(event)
      return
    }
    if (event.turnId !== state.turnId || state.terminalState) return
    state.terminalState = event.state
    wake()
  }
  const abort = (): void => {
    abortError = abortReason(request.signal)
    wake()
  }

  try {
    unsubscribe = options.agentRuntimeHost.subscribeTurnLifecycle((event) => {
      if (
        event.kind !== 'after-turn' ||
        event.runtimeId !== runtimeId ||
        event.threadId !== state.threadId
      ) return
      acceptTerminalEvent({ turnId: event.turnId, state: event.state })
    })
    request.signal?.addEventListener('abort', abort, { once: true })
    if (request.signal?.aborted) abort()

    const handle = await options.agentRuntimeHost.startTurn({
      runtimeId,
      threadId: state.threadId,
      text: request.prompt,
      workspace: request.workspaceRoot,
      mode: request.mode,
      ...(request.model ? { model: request.model } : {}),
      ...(request.reasoningEffort ? { reasoningEffort: request.reasoningEffort } : {}),
      ...(request.allowedTools ? { allowedTools: request.allowedTools } : {})
    })
    state.turnId = handle.turnId
    for (const event of pendingTerminalEvents) acceptTerminalEvent(event)

    let consecutivePolledTerminalFailures = 0
    while (!state.terminalState) {
      if (abortError) throw abortError
      await waitForWake(options.pollIntervalMs ?? 1_000, (resolve) => {
        wakeTerminal = resolve
      })
      if (abortError) throw abortError
      if (state.terminalState) break
      const detail = await options.agentRuntimeHost.readThreadStatus({
        runtimeId,
        threadId: state.threadId
      })
      const polledStatus = terminalStatus(detail, state.turnId)
      if (polledStatus === 'completed') {
        state.terminalState = 'completed'
        consecutivePolledTerminalFailures = 0
      } else if (polledStatus === 'failed' || polledStatus === 'cancelled') {
        consecutivePolledTerminalFailures += 1
        if (consecutivePolledTerminalFailures >= 3) state.terminalState = polledStatus
      } else {
        consecutivePolledTerminalFailures = 0
      }
    }
    if (state.terminalState !== 'completed') {
      throw new Error(`Agent execution ${state.terminalState ?? 'failed'}.`)
    }
    const page = await options.agentRuntimeHost.readThreadPage({
      runtimeId,
      threadId: state.threadId,
      limit: 20
    })
    result = {
      threadId: state.threadId,
      text: assistantText(page, state.turnId)
    }
  } catch (error) {
    primaryError = error
  }

  const cleanupErrors: unknown[] = []
  if (primaryError !== undefined && state.turnId && !state.terminalState) {
    try {
      await options.agentRuntimeHost.interruptTurn({
        runtimeId,
        threadId: state.threadId,
        turnId: state.turnId,
        discard: ephemeral
      })
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  if (unsubscribe) {
    try {
      await unsubscribe()
    } catch (error) {
      cleanupErrors.push(error)
    }
  }
  request.signal?.removeEventListener('abort', abort)
  if (ephemeral) {
    try {
      await options.agentRuntimeHost.reclaimEphemeralThread({ runtimeId, threadId: state.threadId })
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  if (primaryError !== undefined) {
    if (cleanupErrors.length > 0) {
      throw new AggregateError(
        [primaryError, ...cleanupErrors],
        `${errorMessage(primaryError)} Cleanup also failed: ${cleanupErrors.map(errorMessage).join('; ')}`,
        { cause: primaryError }
      )
    }
    throw primaryError
  }
  if (cleanupErrors.length > 0) {
    throw new AggregateError(
      cleanupErrors,
      `Agent execution succeeded but cleanup failed: ${cleanupErrors.map(errorMessage).join('; ')}`
    )
  }
  return result as DomainMainAgentExecutionResult
}

function terminalStatus(
  detail: AgentRuntimeThreadStatus,
  turnId: string
): AgentRuntimeThreadStatus['status'] | AgentRuntimeThreadStatus['latestTurnStatus'] {
  return detail.latestTurnId === turnId ? (detail.latestTurnStatus ?? detail.status) : detail.status
}

function assistantText(page: AgentRuntimeThreadPage, turnId: string): string {
  const items = page.turns.find((turn) => turn.id === turnId)?.items ?? []
  return items
    .filter((item) => item.kind === 'assistant_message')
    .map((item) => item.text?.trim() || item.summary?.trim() || '')
    .filter(Boolean)
    .join('\n\n')
}

function waitForWake(delayMs: number, register: (resolve: () => void) => void): Promise<void> {
  return new Promise<void>((resolve) => {
    let settled = false
    const finish = (): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(finish, Math.max(1, delayMs))
    register(finish)
  })
}

function abortReason(signal?: AbortSignal): unknown {
  return signal?.reason ?? Object.assign(new Error('Agent execution aborted.'), { name: 'AbortError' })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
