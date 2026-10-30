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
  AgentRuntimeToolArtifact,
  AgentRuntimeToolArtifactReadInput,
  AgentRuntimeTurnTargetInput,
  AgentRuntimeTurnHandle,
  AgentRuntimeTurnStartInput
} from '../../shared/agent-runtime-contract'
import {
  VISIBLE_CONTEXT_DEFAULT_STALE_AFTER_MS,
  VISIBLE_CONTEXT_SCHEMA_VERSION,
  type VisibleContextPublishInput
} from '../../shared/visible-context'
import type {
  AgentRuntimeApprovalResolveInput,
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
import type { EvalCase, EvalEvaluationDimension, EvalTrace } from './schema'
import type {
  CapabilityEvalInspectRequest,
  CapabilityEvalInspectResponse,
  CapabilityEvalPrepareRequest,
  CapabilityEvalPrepareResponse,
  CapabilityEvalPreflightRequest,
  CapabilityEvalPreflightSnapshot,
  CapabilityEvalVisibleContext
} from './preflight'

const THREAD_CLEANUP_TIMEOUT_MS = 5_000

export type LiveWorkflowRuntime = Readonly<{
  readCapabilityEvalPreflight?: (
    input: CapabilityEvalPreflightRequest
  ) => Promise<CapabilityEvalPreflightSnapshot>
  prepareCapabilityEvalCase?: (
    input: CapabilityEvalPrepareRequest
  ) => Promise<CapabilityEvalPrepareResponse>
  publishVisibleContext?: (
    input: VisibleContextPublishInput
  ) => Promise<unknown>
  inspectCapabilityEvalCase?: (
    input: CapabilityEvalInspectRequest
  ) => Promise<CapabilityEvalInspectResponse>
  startThread(input: AgentRuntimeThreadStartInput): Promise<AgentRuntimeThread>
  readThreadStatus(input: AgentRuntimeThreadStatusInput): Promise<AgentRuntimeThreadStatus>
  startTurn(input: AgentRuntimeTurnStartInput): Promise<AgentRuntimeTurnHandle>
  subscribeEvents(input: AgentRuntimeEventSubscribeInput): AsyncIterable<AgentRuntimeEvent>
  readToolArtifact?(input: AgentRuntimeToolArtifactReadInput): Promise<AgentRuntimeToolArtifact>
  resolveApproval?(input: AgentRuntimeApprovalResolveInput): Promise<void>
  interruptTurn?(input: AgentRuntimeTurnTargetInput): Promise<void>
  deleteThread?(input: AgentRuntimeThreadDeleteInput): Promise<void>
}>

export type LiveWorkflowFinalState = Readonly<{
  finalState?: TraceJsonValue
  /** This must be decided by an independent task contract or state inspector. */
  taskSuccess?: boolean
  evidence?: readonly string[]
  /** Action IDs whose outputs or state changes the inspector independently verified. */
  verifiedActions?: readonly string[]
  /** Dimensions explicitly verified by the independent inspector. */
  verifiedDimensions?: readonly EvalEvaluationDimension[]
  unsupported?: readonly string[]
}>

export type LiveWorkflowFinalStateInspector = (
  evalCase: EvalCase,
  context: EvalIsolationContext,
  input: Readonly<{
    threadId: string
    turnId: string
    events: readonly AgentRuntimeEvent[]
    status: AgentRuntimeThreadStatus
    trace: EvalTrace
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
  /** Explicit live-eval control; never inferred from the case contract or sent to the Agent. */
  approvalDecision?: AgentRuntimeApprovalResolveInput['decision']
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
      let actualModel: string | undefined
      const events: AgentRuntimeEvent[] = []
      const approvalResolutionTasks: Promise<void>[] = []
      let executionStatus: EvalTrace['executionStatus'] = 'unknown'
      let traceObserved = false
      let expectedLatestSeq = 0
      let initialLatestSeq = 0
      let traceCollectionError: string | undefined
      let traceStatusWarning: string | undefined
      let artifactHydrationWarnings: string[] = []
      let artifactHydrationCompleted = false
      const preparedVisibleContext = context.capabilityEvalVisibleContext ?? []
      const hydrateCollectedArtifacts = async (): Promise<void> => {
        if (artifactHydrationCompleted) return
        artifactHydrationCompleted = true
        const hydrated = await hydrateToolArtifacts(options.runtime, options.runtimeId, threadId, events)
        events.splice(0, events.length, ...hydrated.events)
        artifactHydrationWarnings = [...hydrated.warnings]
      }
      const buildCollectedTrace = (errorMessage?: string): Readonly<{
        traceEvents: readonly TraceEvent[]
        trace: EvalTrace
      }> => {
        const traceEvents = agentEventsToTraceEvents(events, {
          runtimeId: options.runtimeId,
          threadId: threadId || 'unstarted-thread',
          turnId
        })
        const sequenceGap = hasTraceSequenceGap({
          initialLatestSeq,
          expectedLatestSeq,
          events
        })
        const sequenceWarning = terminalSequenceBoundaryWarning({
          initialLatestSeq,
          expectedLatestSeq,
          events
        })
        const runtimeError = terminalRuntimeErrorMessage(events, turnId)
        const collectionIssue = traceCollectionError ?? (sequenceGap
          ? `Event stream ended before sequence ${expectedLatestSeq}; observed ${maxEventSequence(events)}.`
          : undefined)
        let partial = capabilityEvalTraceFromEvents(traceEvents, {
          ...(options.knownActionIds ? { knownActionIds: options.knownActionIds } : {})
        })
        partial = {
          ...partial,
          runId: context.runId,
          ...(context.experimentId ? { experimentId: context.experimentId } : {}),
          ...(context.runIndex !== undefined ? { runIndex: context.runIndex } : {}),
          runtimeId: options.runtimeId,
          threadId: threadId || undefined,
          turnId: turnId || undefined,
          runtimeEvidence: {
            runtimeId: options.runtimeId,
            threadId: threadId || undefined,
            turnId: turnId || undefined,
            traceId: partial.traceId,
            ...(options.model ? { requestedModel: options.model } : {}),
            ...(actualModel ? { actualModel } : {}),
            actualModelStatus: actualModel ? 'observed' : 'unknown',
            provider: 'unknown',
            ...(options.mode ? { mode: options.mode } : {}),
            ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {})
          },
          executionStatus: executionStatus === 'unknown' ? 'failed' : executionStatus,
          taskLatencyMs: Date.now() - startedAt,
          evidenceStatus: evidenceStatusFor({
            threadId,
            initialLatestSeq,
            expectedLatestSeq,
            events,
            traceCollectionError: collectionIssue,
            executionError: runtimeError
          }),
          ...(expectedLatestSeq > 0 ? { expectedLatestSeq } : {}),
          ...(maxEventSequence(events) > 0 ? { observedLatestSeq: maxEventSequence(events) } : {}),
          ...(sequenceWarning ? { traceSequenceWarning: sequenceWarning } : {}),
          ...(traceStatusWarning ? { traceStatusWarning } : {}),
          ...(collectionIssue ? { traceCollectionError: collectionIssue } : {}),
          ...(artifactHydrationWarnings.length ? {
            unsupported: [...new Set([...(partial.unsupported ?? []), ...artifactHydrationWarnings])]
          } : {}),
          ...(collectionIssue ? {
            unsupported: [...new Set([...(partial.unsupported ?? []), collectionIssue])]
          } : {}),
          ...(runtimeError ? { executionError: runtimeError } : {}),
          ...(errorMessage ? { executionError: errorMessage } : {})
        }
        return { traceEvents, trace: partial }
      }
      const persistCollectedTrace = async (collected: Readonly<{
        traceEvents: readonly TraceEvent[]
        trace: EvalTrace
      }>, force = false): Promise<void> => {
        if (!options.onTrace || (traceObserved && !force)) return
        try {
          await options.onTrace(evalCase, collected.traceEvents, collected.trace)
          traceObserved = true
        } catch (error) {
          throw new Error(`Trace persistence failed: ${errorMessage(error)}`, { cause: error })
        }
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
      actualModel = thread.model?.trim() || undefined
      if (!threadId) throw new Error(`Live workflow case ${evalCase.id} received an empty thread ID.`)

      // Package-owned fixtures may publish trusted visible state only after
      // the real thread exists. The Agent still receives only the user query;
      // expected actions and oracle data never enter the published snapshot.
      if (preparedVisibleContext.length) {
        if (!options.runtime.publishVisibleContext) {
          throw new Error(
            `Live workflow case ${evalCase.id} requested a visible-context fixture, but the runtime cannot publish it.`
          )
        }
        await withTimeout(
          options.runtime.publishVisibleContext(buildVisibleContextSnapshot(
            preparedVisibleContext,
            threadId,
            context.directory
          )),
          remainingMilliseconds(deadline),
          `Live workflow case ${evalCase.id} timed out while publishing the visible-context fixture.`
        )
      }

      try {
        const subscriptionController = new AbortController()
        const sinceSeq = await withTimeout(options.runtime.readThreadStatus({
          runtimeId: options.runtimeId,
          threadId
        }), remainingMilliseconds(deadline), `Live workflow case ${evalCase.id} timed out while reading the thread.`)
        .then((status) => {
          initialLatestSeq = status.latestSeq
          return status.latestSeq
        })
        let subscriptionError: Error | undefined
        const subscriptionTask = collectEvents(
          options.runtime,
          options.runtimeId,
          threadId,
          sinceSeq,
          subscriptionController,
          events,
          () => (evalCase.priorTurns?.length ? '' : turnId),
          options.approvalDecision,
          approvalResolutionTasks
        ).catch((error: unknown) => {
          subscriptionError = toError(error, 'Live workflow event subscription failed')
        })

        let status!: AgentRuntimeThreadStatus
        try {
          const turnTexts = [...(evalCase.priorTurns ?? []), evalCase.query]
          for (const [turnIndex, text] of turnTexts.entries()) {
            const handle = await withTimeout(options.runtime.startTurn({
              runtimeId: options.runtimeId,
              threadId,
              text,
              workspace: context.directory,
              ...(options.model ? { model: options.model } : {}),
              ...(options.mode ? { mode: options.mode } : {}),
              ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {}),
              ...(options.governanceProfile ? { governanceProfile: options.governanceProfile } : {})
            }), remainingMilliseconds(deadline), `Live workflow case ${evalCase.id} timed out while starting turn ${turnIndex + 1}.`)
            turnId = handle.turnId.trim()
            if (!turnId) throw new Error(`Live workflow case ${evalCase.id} received an empty turn ID.`)
            try {
              status = await waitForTerminalStatus(
                options.runtime,
                options.runtimeId,
                threadId,
                turnId,
                Math.min(timeoutMs, remainingMilliseconds(deadline)),
                pollIntervalMs,
                events
              )
            } catch (error) {
              executionStatus = isTimeoutError(error) ? 'timed-out' : 'failed'
              throw error
            }
            const runtimeError = terminalRuntimeErrorMessage(events, turnId)
            executionStatus = runtimeError
              ? 'failed'
              : statusToExecutionStatus(status.latestTurnStatus ?? status.status)
            expectedLatestSeq = Math.max(expectedLatestSeq, status.latestSeq)
            await waitForEventSequence(events, status.latestSeq, remainingMilliseconds(deadline))
            if (subscriptionError) throw subscriptionError
            if (executionStatus !== 'completed' && turnIndex < turnTexts.length - 1) {
              throw new Error(`Live workflow case ${evalCase.id} could not establish conversation context on turn ${turnIndex + 1}.`)
            }
          }
        } finally {
          // Polling timeouts throw before the success path. Cancel the active turn
          // before draining events and deleting its thread, through this same runtime.
          if (executionStatus === 'timed-out' && turnId && !terminalExecutionStatus(events) && options.runtime.interruptTurn) {
            await withTimeout(
              options.runtime.interruptTurn({ runtimeId: options.runtimeId, threadId, turnId }),
              5_000,
              `Live workflow case ${evalCase.id} timed out while interrupting the turn.`
            ).catch((error) => {
              traceCollectionError = `Turn cancellation failed: ${errorMessage(error)}`
            })
          }
          subscriptionController.abort()
          const subscriptionFinished = await waitForSubscription(subscriptionTask)
          if (!subscriptionFinished && !traceCollectionError) {
            traceCollectionError = 'Event subscription did not stop within the drain timeout.'
          }
          if (subscriptionError && !traceCollectionError) traceCollectionError = errorMessage(subscriptionError)
        }
        await Promise.all(approvalResolutionTasks)
        await hydrateCollectedArtifacts()

        const traceEvents = agentEventsToTraceEvents(events, {
          runtimeId: options.runtimeId,
          threadId,
          turnId
        })
        let trace = capabilityEvalTraceFromEvents(traceEvents, {
          ...(options.knownActionIds ? { knownActionIds: options.knownActionIds } : {})
        })
        const sequenceGap = hasTraceSequenceGap({
          initialLatestSeq,
          expectedLatestSeq,
          events
        })
        const sequenceWarning = terminalSequenceBoundaryWarning({
          initialLatestSeq,
          expectedLatestSeq,
          events
        })
        const runtimeError = terminalRuntimeErrorMessage(events, turnId)
        const collectionIssue = traceCollectionError ?? (sequenceGap
          ? `Event stream ended before sequence ${expectedLatestSeq}; observed ${maxEventSequence(events)}.`
          : undefined)
        trace = {
          ...trace,
          runId: context.runId,
          ...(context.experimentId ? { experimentId: context.experimentId } : {}),
          ...(context.runIndex !== undefined ? { runIndex: context.runIndex } : {}),
          runtimeId: options.runtimeId,
          threadId,
          turnId,
          runtimeEvidence: {
            runtimeId: options.runtimeId,
            threadId,
            turnId,
            traceId: trace.traceId,
            ...(options.model ? { requestedModel: options.model } : {}),
            ...(actualModel ? { actualModel } : {}),
            actualModelStatus: actualModel ? 'observed' : 'unknown',
            provider: 'unknown',
            ...(options.mode ? { mode: options.mode } : {}),
            ...(options.reasoningEffort ? { reasoningEffort: options.reasoningEffort } : {})
          },
          executionStatus,
          taskLatencyMs: Date.now() - startedAt,
          evidenceStatus: evidenceStatusFor({
            threadId,
            initialLatestSeq,
            expectedLatestSeq,
            events,
            traceCollectionError: collectionIssue,
            executionError: runtimeError
          }),
          ...(expectedLatestSeq > 0 ? { expectedLatestSeq } : {}),
          ...(maxEventSequence(events) > 0 ? { observedLatestSeq: maxEventSequence(events) } : {}),
          ...(sequenceWarning ? { traceSequenceWarning: sequenceWarning } : {}),
          ...(traceStatusWarning ? { traceStatusWarning } : {}),
          ...(collectionIssue ? { traceCollectionError: collectionIssue } : {}),
          ...(artifactHydrationWarnings.length ? {
            unsupported: [...new Set([...(trace.unsupported ?? []), ...artifactHydrationWarnings])]
          } : {}),
          ...(collectionIssue ? {
            unsupported: [...new Set([...(trace.unsupported ?? []), collectionIssue])]
          } : {}),
          ...(runtimeError ? { executionError: runtimeError } : {})
        }
        if (options.inspectFinalState) {
          const inspected = await options.inspectFinalState(evalCase, context, {
            threadId,
            turnId,
            events,
            status,
            trace
          })
          trace = applyFinalStateInspection(trace, inspected)
        }
        await persistCollectedTrace({ traceEvents, trace })
        return { trace }
      } finally {
        if (threadId && options.cleanupThread !== false && options.runtime.deleteThread) {
          await withTimeout(
            options.runtime.deleteThread({
              runtimeId: options.runtimeId,
              threadId
            }),
            THREAD_CLEANUP_TIMEOUT_MS,
            `Live workflow case ${evalCase.id} thread cleanup timed out.`
          ).catch((error) => {
            throw new Error(`Live workflow case ${evalCase.id} thread cleanup failed: ${errorMessage(error)}`, {
              cause: error
            })
          })
        }
      }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const recoveredStatus = terminalExecutionStatus(events)
        if (recoveredStatus) {
          const previousStatus = executionStatus
          executionStatus = recoveredStatus
          traceStatusWarning = `Status polling ended with ${message}, but the trace contains a terminal ${recoveredStatus} event; the terminal event is authoritative.`
          if (previousStatus === 'timed-out' || previousStatus === 'failed' || previousStatus === 'unknown') {
            traceCollectionError = undefined
          }
        }
        await hydrateCollectedArtifacts()
        const collected = buildCollectedTrace(recoveredStatus ? undefined : message)
        let finalTrace = collected.trace
        if (recoveredStatus && options.inspectFinalState) {
          try {
            const inspected = await options.inspectFinalState(evalCase, context, {
              threadId,
              turnId,
              events,
              status: {
                id: threadId,
                runtimeId: options.runtimeId,
                latestSeq: maxEventSequence(events),
                latestTurnId: turnId,
                latestTurnStatus: recoveredStatus
              },
              trace: finalTrace
            })
            finalTrace = applyFinalStateInspection(finalTrace, inspected)
          } catch (inspectionError) {
            finalTrace = {
              ...finalTrace,
              unsupported: [...new Set([
                ...(finalTrace.unsupported ?? []),
                `Final-state inspection failed during recovery: ${errorMessage(inspectionError)}`
              ])]
            }
          }
        }
        if (options.onTrace) {
          try {
            await persistCollectedTrace(
              { traceEvents: collected.traceEvents, trace: finalTrace },
              traceObserved
            )
          } catch (persistenceError) {
            finalTrace = {
              ...finalTrace,
              tracePersistenceError: errorMessage(persistenceError),
              executionError: `${message}; ${errorMessage(persistenceError)}`,
              evidenceStatus: 'partial'
            }
          }
        }
        return { trace: finalTrace }
      }
    }
  }
}

function buildVisibleContextSnapshot(
  contexts: readonly CapabilityEvalVisibleContext[],
  threadId: string,
  workspaceDirectory: string
): VisibleContextPublishInput {
  const routes = [...new Set(contexts.map((context) => context.route).filter(Boolean))]
  if (routes.length > 1) {
    throw new Error(`Capability evaluation visible-context fixtures disagree on route: ${routes.join(', ')}`)
  }
  const componentIds = new Set<string>()
  const publishedAt = new Date().toISOString()
  const components = contexts.flatMap((context) => context.components).map((component) => {
    if (componentIds.has(component.id)) {
      throw new Error(`Capability evaluation visible-context fixture duplicated component ${component.id}.`)
    }
    componentIds.add(component.id)
    return {
      id: component.id,
      region: component.region,
      component: component.component,
      ...(component.title ? { title: component.title } : {}),
      visible: component.visible,
      ...(component.priority !== undefined ? { priority: component.priority } : {}),
      updatedAt: publishedAt,
      summary: component.summary,
      ...(component.state !== undefined ? { state: component.state } : {})
    }
  })
  return {
    schemaVersion: VISIBLE_CONTEXT_SCHEMA_VERSION,
    revision: Date.now(),
    publishedAt,
    freshness: {
      stale: false,
      ageMs: 0,
      staleAfterMs: VISIBLE_CONTEXT_DEFAULT_STALE_AFTER_MS
    },
    activeThreadId: threadId,
    workspaceRoot: contexts.find((context) => context.workspaceRoot)?.workspaceRoot ?? workspaceDirectory,
    ...(routes[0] ? { route: routes[0] } : {}),
    components
  }
}

function applyFinalStateInspection(
  trace: EvalTrace,
  inspected: LiveWorkflowFinalState
): EvalTrace {
  return {
    ...trace,
    ...(inspected.finalState !== undefined ? {
      finalState: inspected.finalState,
      finalStateSource: 'inspector' as const
    } : {}),
    ...(inspected.taskSuccess !== undefined ? { taskSuccess: inspected.taskSuccess } : {}),
    ...(inspected.evidence?.length ? { evidence: inspected.evidence } : {}),
    ...(inspected.verifiedActions?.length ? { verifiedActionIds: inspected.verifiedActions } : {}),
    ...(inspected.verifiedDimensions?.length ? { verifiedDimensions: inspected.verifiedDimensions } : {}),
    ...(inspected.unsupported?.length ? {
      unsupported: [...(trace.unsupported ?? []), ...inspected.unsupported]
    } : {})
  }
}

type ToolArtifactHydrationResult = Readonly<{
  events: readonly AgentRuntimeEvent[]
  warnings: readonly string[]
}>

async function hydrateToolArtifacts(
  runtime: LiveWorkflowRuntime,
  runtimeId: AgentRuntimeId,
  threadId: string,
  events: readonly AgentRuntimeEvent[]
): Promise<ToolArtifactHydrationResult> {
  const references = new Map<string, { ref: string; size: number }>()
  for (const event of events) {
    const reference = toolArtifactReference(event)
    if (reference) references.set(reference.ref, reference)
  }
  if (references.size === 0) return { events, warnings: [] }
  if (!runtime.readToolArtifact) {
    return {
      events,
      warnings: [`${references.size} tool artifact reference(s) were observed, but the live runtime cannot read them.`]
    }
  }

  const contentByReference = new Map<string, string>()
  const warnings: string[] = []
  await Promise.all([...references.values()].map(async (reference) => {
    try {
      const artifact = await runtime.readToolArtifact!({
        runtimeId,
        threadId,
        ref: reference.ref,
        size: reference.size
      })
      if (artifact.ref !== reference.ref) {
        warnings.push(`Tool artifact ${reference.ref} returned a mismatched reference.`)
        return
      }
      contentByReference.set(reference.ref, artifact.content)
    } catch (error) {
      warnings.push(`Tool artifact ${reference.ref} could not be read: ${errorMessage(error)}.`)
    }
  }))

  if (contentByReference.size === 0) return { events, warnings }
  return {
    events: events.map((event) => {
      const reference = toolArtifactReference(event)
      const content = reference ? contentByReference.get(reference.ref) : undefined
      return content === undefined ? event : replaceToolArtifactContent(event, content)
    }),
    warnings
  }
}

function toolArtifactReference(event: AgentRuntimeEvent): { ref: string; size: number } | undefined {
  if (event.kind === 'tool_event' && event.detailArtifact) {
    return { ref: event.detailArtifact.ref, size: event.detailArtifact.size }
  }
  if (event.kind === 'item_snapshot' && event.item.kind === 'tool' && event.item.detailArtifact) {
    return { ref: event.item.detailArtifact.ref, size: event.item.detailArtifact.size }
  }
  return undefined
}

function replaceToolArtifactContent(event: AgentRuntimeEvent, content: string): AgentRuntimeEvent {
  if (event.kind === 'tool_event') return { ...event, detail: content }
  if (event.kind === 'item_snapshot' && event.item.kind === 'tool') {
    return { ...event, item: { ...event.item, detail: content } }
  }
  return event
}

async function collectEvents(
  runtime: LiveWorkflowRuntime,
  runtimeId: AgentRuntimeId,
  threadId: string,
  sinceSeq: number,
  controller: AbortController,
  output: AgentRuntimeEvent[],
  turnId: () => string,
  approvalDecision: AgentRuntimeApprovalResolveInput['decision'] | undefined,
  approvalResolutionTasks: Promise<void>[]
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
      if (event.kind === 'approval_requested' && approvalDecision && runtime.resolveApproval) {
        const approvalResolution = runtime.resolveApproval({
          runtimeId,
          threadId,
          approvalId: event.approvalId,
          decision: approvalDecision
        })
        approvalResolutionTasks.push(approvalResolution)
        await approvalResolution
      }
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
  pollIntervalMs: number,
  events: readonly AgentRuntimeEvent[]
): Promise<AgentRuntimeThreadStatus> {
  const deadline = Date.now() + timeoutMs
  let status: AgentRuntimeThreadStatus
  try {
    status = await withTimeout(
      runtime.readThreadStatus({ runtimeId, threadId }),
      remainingMilliseconds(deadline),
      `Live workflow turn ${turnId} timed out while reading its initial status.`
    )
  } catch (error) {
    const terminal = terminalStatusFromEvents({ runtimeId, threadId, turnId, events })
    if (terminal) return terminal
    throw toError(error, `Live workflow turn ${turnId} failed while reading its initial status`)
  }
  while (Date.now() < deadline) {
    const terminal = terminalStatusFromEvents({ runtimeId, threadId, turnId, events, status })
    if (terminal) return terminal
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
    } catch (error) {
      const terminal = terminalStatusFromEvents({ runtimeId, threadId, turnId, events, status })
      if (terminal) return terminal
      throw toError(error, `Live workflow turn ${turnId} failed while polling status`)
    }
  }
  const terminal = terminalStatusFromEvents({ runtimeId, threadId, turnId, events, status })
  if (terminal) return terminal
  return {
    ...status,
    latestTurnId: turnId,
    latestTurnStatus: 'timed-out'
  }
}

function terminalStatusFromEvents(input: Readonly<{
  runtimeId: AgentRuntimeId
  threadId: string
  turnId: string
  events: readonly AgentRuntimeEvent[]
  status?: AgentRuntimeThreadStatus
}>): AgentRuntimeThreadStatus | undefined {
  const terminal = terminalExecutionStatus(input.events, input.turnId)
  if (!terminal) return undefined
  return {
    ...(input.status ?? {
      id: input.threadId,
      runtimeId: input.runtimeId
    }),
    latestSeq: Math.max(input.status?.latestSeq ?? 0, maxEventSequence(input.events)),
    latestTurnId: input.turnId,
    latestTurnStatus: terminal,
    status: terminal
  }
}

function agentEventsToTraceEvents(
  events: readonly AgentRuntimeEvent[],
  correlation: Readonly<{ runtimeId: AgentRuntimeId; threadId: string; turnId: string }>
): TraceEvent[] {
  const normalizedCorrelation = {
    ...correlation,
    threadId: correlation.threadId || 'unstarted-thread',
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
      turnId: event.turnId?.trim() || normalizedCorrelation.turnId,
      source: 'agent-runtime-live-eval',
      kind: 'agent_event',
      timestamp,
      recordedAt: timestamp,
      payload: {
        eventKind: traceEventKind(event),
        event: toTraceJson({ ...event, sequence: event.seq ?? index })
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

function terminalExecutionStatus(
  events: readonly AgentRuntimeEvent[],
  turnId?: string
): EvalTrace['executionStatus'] | undefined {
  if (terminalRuntimeErrorMessage(events, turnId)) return 'failed'
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (turnId && event?.turnId && event.turnId !== turnId) continue
    if (event?.kind === 'turn_lifecycle' && isTerminalStatus(event.state)) {
      return statusToExecutionStatus(event.state)
    }
  }
  return undefined
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

async function waitForSubscription(subscriptionTask: Promise<void>): Promise<boolean> {
  return await Promise.race([
    subscriptionTask.then(() => true),
    delay(2_000).then(() => false)
  ])
}

async function waitForEventSequence(
  events: readonly AgentRuntimeEvent[],
  expectedLatestSeq: number,
  timeoutMs: number
): Promise<void> {
  if (expectedLatestSeq <= 0) return
  const deadline = Date.now() + Math.min(2_000, timeoutMs)
  while (maxEventSequence(events) < expectedLatestSeq && Date.now() < deadline) {
    await delay(Math.min(25, Math.max(1, deadline - Date.now())))
  }
}

function evidenceStatusFor(input: Readonly<{
  threadId: string
  initialLatestSeq: number
  expectedLatestSeq: number
  events: readonly AgentRuntimeEvent[]
  traceCollectionError?: string
  executionError?: string
}>): EvalTrace['evidenceStatus'] {
  if (!input.threadId) return 'unavailable'
  if (input.executionError) return 'partial'
  if (input.traceCollectionError) return 'partial'
  if (!hasTerminalTurnLifecycleEvent(input.events)) return 'partial'
  if (hasTraceSequenceGap(input)) return 'partial'
  return 'complete'
}

function terminalRuntimeErrorMessage(
  events: readonly AgentRuntimeEvent[],
  turnId?: string
): string | undefined {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]
    if (event?.kind !== 'error' || event.recoverable) continue
    if (turnId && event.turnId && event.turnId !== turnId) continue
    const message = event.message.trim()
    if (!message) continue
    return event.code?.trim() ? `${event.code.trim()}: ${message}` : message
  }
  return undefined
}

function hasTerminalTurnLifecycleEvent(events: readonly AgentRuntimeEvent[]): boolean {
  return events.some((event) => event.kind === 'turn_lifecycle' && isTerminalStatus(event.state))
}

function hasTraceSequenceGap(input: Readonly<{
  initialLatestSeq: number
  expectedLatestSeq: number
  events: readonly AgentRuntimeEvent[]
}>): boolean {
  if (input.expectedLatestSeq <= input.initialLatestSeq) return false
  const observedLatestSeq = maxEventSequence(input.events)
  if (terminalSequenceBoundaryWarning(input)) return false
  if (observedLatestSeq < input.expectedLatestSeq) return true
  const observedSequences = [...new Set(input.events
    .map((event) => event.seq)
    .filter((seq): seq is number => typeof seq === 'number' && Number.isSafeInteger(seq)))]
    .sort((left, right) => left - right)
  let expectedSequence = input.initialLatestSeq + 1
  for (const observedSequence of observedSequences) {
    if (observedSequence < expectedSequence) continue
    if (observedSequence > expectedSequence) return true
    expectedSequence += 1
  }
  return false
}

function terminalSequenceBoundaryWarning(input: Readonly<{
  initialLatestSeq: number
  expectedLatestSeq: number
  events: readonly AgentRuntimeEvent[]
}>): string | undefined {
  const observedLatestSeq = maxEventSequence(input.events)
  if (input.expectedLatestSeq !== observedLatestSeq + 1) return undefined
  const terminalEvent = input.events.find((event) =>
    event.kind === 'turn_lifecycle' && isTerminalStatus(event.state) && event.seq === observedLatestSeq
  )
  if (!terminalEvent) return undefined
  const sequences = [...new Set(input.events
    .map((event) => event.seq)
    .filter((seq): seq is number => typeof seq === 'number' && Number.isSafeInteger(seq)))]
    .sort((left, right) => left - right)
  let expectedSequence = input.initialLatestSeq + 1
  for (const sequence of sequences) {
    if (sequence < expectedSequence) continue
    if (sequence !== expectedSequence) return undefined
    expectedSequence += 1
  }
  return `Status reported latestSeq ${input.expectedLatestSeq}, while the terminal event ended at sequence ${observedLatestSeq}; no internal event sequence gap was observed.`
}

function maxEventSequence(events: readonly AgentRuntimeEvent[]): number {
  return events.reduce((maximum, event) => Math.max(maximum, typeof event.seq === 'number' ? event.seq : 0), 0)
}

function toError(error: unknown, prefix: string): Error {
  return new Error(`${prefix}: ${errorMessage(error)}`, { cause: error })
}

function isTimeoutError(error: unknown): boolean {
  return errorMessage(error).toLowerCase().includes('timed out')
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
