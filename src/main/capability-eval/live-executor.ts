import {
  createEventId,
  deriveTraceId,
  type TraceEvent,
  type TraceJsonValue
} from '@sciforge/full-trace'
import type {
  AgentRuntimeEvent,
  AgentRuntimeId,
  AgentRuntimeThread,
  AgentRuntimeThreadStartInput,
  AgentRuntimeThreadStatus,
  AgentRuntimeThreadStatusInput,
  AgentRuntimeTurnTargetInput,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput
} from '../../shared/agent-runtime-contract'
import type {
  AgentRuntimeEventSubscribeInput,
  AgentRuntimeThreadDeleteInput
} from '../runtime/agent-runtime/adapter'
import {
  capabilityEvalTraceFromEvents
} from './trace-adapter'
import type {
  CapabilityEvalExecutor,
  EvalIsolationContext
} from './runner'
import type { EvalCase, EvalTrace } from './schema'

export type LiveWorkflowRuntime = Readonly<{
  startThread(input: AgentRuntimeThreadStartInput): Promise<AgentRuntimeThread>
  readThreadStatus(input: AgentRuntimeThreadStatusInput): Promise<AgentRuntimeThreadStatus>
  startTurn(input: AgentRuntimeTurnStartInput): Promise<AgentRuntimeTurnHandle>
  subscribeEvents(input: AgentRuntimeEventSubscribeInput): AsyncIterable<AgentRuntimeEvent>
  interruptTurn?(input: AgentRuntimeTurnTargetInput): Promise<void>
  deleteThread?(input: AgentRuntimeThreadDeleteInput): Promise<void>
}>

export type LiveWorkflowFinalState = Readonly<{
  finalState?: TraceJsonValue
  /** This must be decided by an independent task contract or state inspector. */
  taskSuccess?: boolean
  evidence?: readonly string[]
}>

export type LiveWorkflowFinalStateInspector = (
  evalCase: EvalCase,
  context: EvalIsolationContext,
  input: Readonly<{
    threadId: string
    turnId: string
    events: readonly AgentRuntimeEvent[]
    status: AgentRuntimeThreadStatus
  }>
) => LiveWorkflowFinalState | Promise<LiveWorkflowFinalState>

export type LiveWorkflowTraceObserver = (
  evalCase: EvalCase,
  traceEvents: readonly TraceEvent[],
  trace: EvalTrace
) => void | Promise<void>

export type LiveWorkflowExecutorOptions = Readonly<{
  runtime: LiveWorkflowRuntime
  runtimeId: AgentRuntimeId
  knownActionIds?: ReadonlySet<string>
  timeoutMs?: number
  pollIntervalMs?: number
  model?: string
  mode?: string
  reasoningEffort?: string
  governanceProfile?: AgentRuntimeTurnStartInput['governanceProfile']
  inspectFinalState?: LiveWorkflowFinalStateInspector
  onTrace?: LiveWorkflowTraceObserver
  cleanupThread?: boolean
}>

/**
 * Executes an EvalCase through the real Agent Runtime. The expected case
 * contract is consumed only by the evaluator after the turn finishes.
 */
export function createLiveWorkflowExecutor(
  options: LiveWorkflowExecutorOptions
): CapabilityEvalExecutor {
  const timeoutMs = Math.max(1, options.timeoutMs ?? 15 * 60_000)
  const pollIntervalMs = Math.max(25, options.pollIntervalMs ?? 250)
  return {
    run: async (evalCase, context) => {
      const startedAt = Date.now()
      const deadline = startedAt + timeoutMs
      let threadId = ''
      let turnId = ''
      const events: AgentRuntimeEvent[] = []
      let executionStatus: EvalTrace['executionStatus'] = 'unknown'
      let traceObserved = false
      const buildCollectedTrace = (errorMessage?: string): Readonly<{
        traceEvents: readonly TraceEvent[]
        trace: EvalTrace
      }> => {
        const traceEvents = agentEventsToTraceEvents(events, {
          runtimeId: options.runtimeId,
          threadId,
          turnId
        })
        let partial = capabilityEvalTraceFromEvents(traceEvents, {
          ...(options.knownActionIds ? { knownActionIds: options.knownActionIds } : {})
        })
        partial = {
          ...partial,
          executionStatus: executionStatus === 'unknown' ? 'failed' : executionStatus,
          taskLatencyMs: Date.now() - startedAt,
          ...(errorMessage ? { executionError: errorMessage } : {})
        }
        return { traceEvents, trace: partial }
      }
      const persistCollectedTrace = async (errorMessage?: string): Promise<void> => {
        if (!options.onTrace || traceObserved) return
        traceObserved = true
        const collected = buildCollectedTrace(errorMessage)
        await options.onTrace(evalCase, collected.traceEvents, collected.trace)
      }
      try {
      const thread = await withTimeout(options.runtime.startThread({
        runtimeId: options.runtimeId,
        workspace: context.directory,
        title: `Capability Eval: ${evalCase.id}`,
        ...(options.model ? { model: options.model } : {}),
        ...(options.mode ? { mode: options.mode } : {})
      }), remainingMilliseconds(deadline), `Live workflow case ${evalCase.id} timed out while starting the thread.`)
      threadId = thread.id.trim()
      if (!threadId) throw new Error(`Live workflow case ${evalCase.id} received an empty thread ID.`)

      try {
        const subscriptionController = new AbortController()
        const sinceSeq = await withTimeout(options.runtime.readThreadStatus({
          runtimeId: options.runtimeId,
          threadId
        }), remainingMilliseconds(deadline), `Live workflow case ${evalCase.id} timed out while reading the thread.`)
          .then((status) => status.latestSeq)
        const subscriptionTask = collectEvents(
          options.runtime,
          options.runtimeId,
          threadId,
          sinceSeq,
          subscriptionController,
          events,
          () => turnId
        )

        let status: AgentRuntimeThreadStatus
        try {
          const handle = await withTimeout(options.runtime.startTurn({
            runtimeId: options.runtimeId,
            threadId,
            text: evalCase.query,
            workspace: context.directory,
            ...(options.model ? { model: options.model } : {}),
            ...(options.mode ? { mode: options.mode } : {}),
            ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
            ...(options.governanceProfile ? { governanceProfile: options.governanceProfile } : {})
          }), remainingMilliseconds(deadline), `Live workflow case ${evalCase.id} timed out while starting the turn.`)
          turnId = handle.turnId.trim()
          if (!turnId) throw new Error(`Live workflow case ${evalCase.id} received an empty turn ID.`)
          status = await waitForTerminalStatus(
            options.runtime,
            options.runtimeId,
            threadId,
            turnId,
            Math.min(timeoutMs, remainingMilliseconds(deadline)),
            pollIntervalMs
          )
          executionStatus = statusToExecutionStatus(status.latestTurnStatus ?? status.status)
          if (executionStatus === 'timed-out' && options.runtime.interruptTurn) {
            await withTimeout(
              options.runtime.interruptTurn({ runtimeId: options.runtimeId, threadId, turnId }),
              5_000,
              `Live workflow case ${evalCase.id} timed out while interrupting the turn.`
            ).catch(() => undefined)
          }
        } finally {
          subscriptionController.abort()
          await waitForSubscription(subscriptionTask)
        }

        const traceEvents = agentEventsToTraceEvents(events, {
          runtimeId: options.runtimeId,
          threadId,
          turnId
        })
        let trace = capabilityEvalTraceFromEvents(traceEvents, {
          ...(options.knownActionIds ? { knownActionIds: options.knownActionIds } : {})
        })
        trace = {
          ...trace,
          executionStatus,
          taskLatencyMs: Date.now() - startedAt
        }
        if (options.inspectFinalState) {
          const inspected = await options.inspectFinalState(evalCase, context, {
            threadId,
            turnId,
            events,
            status
          })
          trace = {
            ...trace,
            ...(inspected.finalState !== undefined ? {
              finalState: inspected.finalState,
              finalStateSource: 'inspector' as const
            } : {}),
            ...(inspected.taskSuccess !== undefined ? { taskSuccess: inspected.taskSuccess } : {}),
            ...(inspected.evidence?.length ? {
              evidence: inspected.evidence
            } : {})
          }
        }
        if (options.onTrace) {
          traceObserved = true
          await options.onTrace(evalCase, traceEvents, trace)
        }
        return { trace }
      } finally {
        if (options.cleanupThread !== false && options.runtime.deleteThread) {
          await options.runtime.deleteThread({
            runtimeId: options.runtimeId,
            threadId
          }).catch(() => undefined)
        }
      }
      } catch (error) {
        if (!threadId) throw error
        const message = error instanceof Error ? error.message : String(error)
        await persistCollectedTrace(message).catch(() => undefined)
        return { trace: buildCollectedTrace(message).trace }
      }
    }
  }
}

async function collectEvents(
  runtime: LiveWorkflowRuntime,
  runtimeId: AgentRuntimeId,
  threadId: string,
  sinceSeq: number,
  controller: AbortController,
  output: AgentRuntimeEvent[],
  turnId: () => string
): Promise<void> {
  try {
    for await (const event of runtime.subscribeEvents({
      runtimeId,
      threadId,
      sinceSeq,
      signal: controller.signal
    })) {
      if (event.threadId !== threadId) continue
      const currentTurnId = turnId()
      if (currentTurnId && event.turnId && event.turnId !== currentTurnId) continue
      output.push(event)
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      throw new Error(
        `Live workflow event subscription failed: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error }
      )
    }
  }
}

async function waitForTerminalStatus(
  runtime: LiveWorkflowRuntime,
  runtimeId: AgentRuntimeId,
  threadId: string,
  turnId: string,
  timeoutMs: number,
  pollIntervalMs: number
): Promise<AgentRuntimeThreadStatus> {
  const deadline = Date.now() + timeoutMs
  let status: AgentRuntimeThreadStatus
  try {
    status = await withTimeout(
      runtime.readThreadStatus({ runtimeId, threadId }),
      remainingMilliseconds(deadline),
      `Live workflow turn ${turnId} timed out while reading its initial status.`
    )
  } catch {
    return {
      id: threadId,
      runtimeId,
      latestTurnId: turnId,
      latestTurnStatus: 'timed-out',
      latestSeq: 0
    }
  }
  while (Date.now() < deadline) {
    const statusTurnId = status.latestTurnId?.trim()
    const state = status.latestTurnStatus ?? status.status
    if (statusTurnId === turnId && isTerminalStatus(state)) return status
    await delay(Math.min(pollIntervalMs, remainingMilliseconds(deadline)))
    try {
      status = await withTimeout(
        runtime.readThreadStatus({ runtimeId, threadId }),
        remainingMilliseconds(deadline),
        `Live workflow turn ${turnId} timed out while polling status.`
      )
    } catch {
      return {
        ...status,
        latestTurnId: turnId,
        latestTurnStatus: 'timed-out'
      }
    }
  }
  return {
    ...status,
    latestTurnId: turnId,
    latestTurnStatus: 'timed-out'
  }
}

function agentEventsToTraceEvents(
  events: readonly AgentRuntimeEvent[],
  correlation: Readonly<{ runtimeId: AgentRuntimeId; threadId: string; turnId: string }>
): TraceEvent[] {
  const normalizedCorrelation = {
    ...correlation,
    turnId: correlation.turnId || 'unstarted-turn'
  }
  const traceId = deriveTraceId(normalizedCorrelation)
  return events.map((event, index) => {
    const timestamp = event.createdAt ?? new Date().toISOString()
    return {
      schemaVersion: 'sciforge.trace.v1',
      eventId: createEventId(),
      traceId,
      runtimeId: normalizedCorrelation.runtimeId,
      threadId: normalizedCorrelation.threadId,
      turnId: normalizedCorrelation.turnId,
      source: 'agent-runtime-live-eval',
      kind: 'agent_event',
      timestamp,
      recordedAt: timestamp,
      payload: {
        eventKind: traceEventKind(event),
        event: toTraceJson({ ...event, sequence: index })
      }
    }
  })
}

function traceEventKind(event: AgentRuntimeEvent): 'lifecycle' | 'assistant' | 'reasoning' | 'tool' | 'approval' | 'usage' | 'error' {
  if (event.kind === 'tool_event' || event.kind === 'item_snapshot') return 'tool'
  if (event.kind === 'approval_requested' || event.kind === 'approval_resolved') return 'approval'
  if (event.kind === 'assistant_delta') return 'assistant'
  if (event.kind === 'reasoning_delta') return 'reasoning'
  if (event.kind === 'usage') return 'usage'
  if (event.kind === 'error') return 'error'
  return 'lifecycle'
}

function statusToExecutionStatus(status: string | undefined): EvalTrace['executionStatus'] {
  if (status === 'completed' || status === 'success') return 'completed'
  if (status === 'failed' || status === 'error') return 'failed'
  if (status === 'aborted' || status === 'interrupted') return 'aborted'
  if (status === 'cancelled' || status === 'canceled') return 'cancelled'
  if (status === 'timed-out') return 'timed-out'
  if (status === 'running' || status === 'in_progress' || status === 'submitted') return 'running'
  return 'unknown'
}

function isTerminalStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'success' || status === 'failed' || status === 'error' ||
    status === 'aborted' || status === 'cancelled' || status === 'canceled' || status === 'interrupted'
}

function toTraceJson(value: unknown): TraceJsonValue {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (Array.isArray(value)) return value.map(toTraceJson)
  if (typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, entry]) => [key, toTraceJson(entry)]))
  }
  return String(value)
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

function remainingMilliseconds(deadline: number): number {
  return Math.max(1, deadline - Date.now())
}

async function withTimeout<T>(promise: Promise<T>, milliseconds: number, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => reject(new Error(message)), milliseconds)
      })
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

async function waitForSubscription(subscriptionTask: Promise<void>): Promise<void> {
  await Promise.race([subscriptionTask, delay(2_000)])
}
