import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { CapabilityJsonValue } from '../../shared/capability-broker'
import { evaluateCase, type EvalExecutionView } from './evaluators'
import type { CapabilityReference } from './reference'
import {
  type EvalCase,
  type EvalCaseResult,
  type EvalFailureStage,
  evalLlmJudgeSidecarSchema,
  type EvalSimulation,
  type EvalTrace
} from './schema'
import { CapabilityEvalPreflightError } from './preflight'
import type { CapabilityEvalVisibleContext } from './preflight'

export type EvalIsolationContext = Readonly<{
  caseId: string
  runId: string
  experimentId?: string
  runIndex?: number
  directory: string
  initialState?: CapabilityJsonValue
  state: CapabilityJsonValue
  /** Prepared trusted UI state, never included in the Agent prompt. */
  capabilityEvalVisibleContext?: readonly CapabilityEvalVisibleContext[]
}>

export type CapabilityEvalExecution = EvalExecutionView

export type CapabilityEvalExecutor = Readonly<{
  run: (
    evalCase: EvalCase,
    context: EvalIsolationContext
  ) => CapabilityEvalExecution | Promise<CapabilityEvalExecution>
}>

export type RunEvalCasesOptions = Readonly<{
  concurrency?: number
  experimentId?: string
  /** Stable occurrence number for each scheduled case; repeats must not reuse it. */
  runIndices?: readonly number[]
  /** Optional persisted run IDs for deterministic trace replay. */
  runIds?: readonly string[]
  onRunState?: (state: EvalRunState) => void | Promise<void>
  /** Retain each isolated workspace under this directory before cleanup. */
  workspaceSnapshotDirectory?: string
  /** Read external LLM Judge results from `<case-id>.json` before scoring. */
  llmJudgeResultsDirectory?: string
}>

export type EvalRunState = Readonly<{
  experimentId: string
  caseId: string
  runId: string
  runIndex: number
  status: 'scheduled' | 'running' | 'completed' | 'failed' | 'inconclusive'
  outcome?: EvalCaseResult['outcome']
  executionStatus?: EvalTrace['executionStatus']
  trace?: EvalTrace
  failureStages?: readonly EvalFailureStage[]
}>

export async function runEvalCases(
  cases: readonly EvalCase[],
  executor: CapabilityEvalExecutor,
  options: RunEvalCasesOptions = {}
): Promise<EvalCaseResult[]> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1))
  const experimentId = options.experimentId ?? randomUUID()
  const runIndices = options.runIndices ?? cases.map((_, index) => index + 1)
  if (runIndices.length !== cases.length) throw new Error('runIndices must align with eval cases.')
  const runIds = options.runIds ?? cases.map(() => randomUUID())
  if (runIds.length !== cases.length) throw new Error('runIds must align with eval cases.')
  if (new Set(runIds).size !== runIds.length) throw new Error('runIds must be unique.')
  const results = new Array<EvalCaseResult>(cases.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++
      const evalCase = cases[index]
      if (!evalCase) return
      results[index] = await runOneCase(evalCase, executor, options, {
        experimentId,
        runIndex: runIndices[index] ?? index + 1,
        runId: runIds[index] ?? randomUUID()
      })
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker))
  return results
}

export async function createIsolatedEvalContext(
  evalCase: EvalCase,
  input: Readonly<{ experimentId?: string; runId?: string; runIndex?: number }> = {}
): Promise<{
  context: EvalIsolationContext
  cleanup: () => Promise<void>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-capability-eval-'))
  try {
    const initialState = evalCase.initialState
    if (initialState !== undefined) {
      await writeFile(
        join(directory, 'initial-state.json'),
        `${JSON.stringify(initialState, null, 2)}\n`,
        'utf8'
      )
    }
    for (const fixture of evalCase.fixtures?.files ?? []) {
      const root = resolve(directory)
      const target = resolve(directory, fixture.path)
      const targetRelative = relative(root, target)
      if (isAbsolute(targetRelative) || targetRelative === '..' || targetRelative.startsWith(`..${sep}`)) {
        throw new Error(`Workspace fixture path escapes the isolated workspace: ${fixture.path}`)
      }
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, fixture.content, 'utf8')
    }
    let cleaned = false
    return {
      context: {
        caseId: evalCase.id,
        runId: input.runId ?? randomUUID(),
        experimentId: input.experimentId ?? randomUUID(),
        runIndex: input.runIndex ?? 1,
        directory,
        ...(initialState !== undefined ? { initialState } : {}),
        state: initialState ?? {}
      },
      cleanup: async () => {
        if (cleaned) return
        cleaned = true
        await rm(directory, { recursive: true, force: true })
      }
    }
  } catch (error) {
    await rm(directory, { recursive: true, force: true }).catch(() => undefined)
    throw error
  }
}

/**
 * Deterministic, offline executor for smoke cases. It validates every
 * simulated action against the generated Registry reference and reports that
 * the resulting trace is a simulation. It never invokes a provider.
 */
export function createDeterministicSimulationExecutor(
  reference: CapabilityReference
): CapabilityEvalExecutor {
  return {
    run: async (evalCase) => {
      const simulation = evalCase.simulation
      if (!simulation) {
        throw new Error(`Eval case ${evalCase.id} has no deterministic simulation.`)
      }
      validateSimulationActions(evalCase, simulation, reference)
      return { trace: simulationToTrace(simulation) }
    }
  }
}

function simulationToTrace(simulation: EvalSimulation): EvalTrace {
  const discoveries = simulation.discoveries.flatMap((discovery) => discovery.actions)
  const discoveredActions = [...new Set(discoveries)]
  const invocations = simulation.calls.map((call, index) => {
    const attempts = call.attempts ?? Array.from({ length: call.retryCount + 1 }, (_, attempt) => ({
      success: attempt === call.retryCount ? call.outcome === 'success' : false,
      ...(attempt < call.retryCount && call.errorCode ? { errorCode: call.errorCode } : {}),
      latencyMs: call.latencyMs,
      ...(call.sequence !== undefined ? { sequence: call.sequence } : {})
    }))
    const providerAttempts = attempts.map((attempt, attemptIndex) => ({
      attempt: attemptIndex + 1,
      success: attempt.success,
      ...(attempt.errorCode ? { errorCode: attempt.errorCode } : {}),
      latencyMs: attempt.latencyMs,
      ...(attempt.sequence !== undefined ? { sequence: attempt.sequence } : {})
    }))
    return {
    actionId: call.actionId,
    args: call.args,
    success: call.outcome === 'success',
    outcome: call.outcome,
    logicalInvocationId: `simulation-invocation-${index + 1}`,
    providerAttempts,
    firstAttemptSuccess: providerAttempts[0]?.success ?? call.outcome === 'success',
    eventualSuccess: call.outcome === 'success',
    ...(call.errorCode ? { errorCode: call.errorCode } : {}),
    retryCount: call.retryCount,
    latencyMs: call.latencyMs,
    ...(call.sequence !== undefined ? { sequence: call.sequence } : {})
    }
  })
  return {
    ...(simulation.domain ? { domain: simulation.domain } : {}),
    ...(simulation.domain ? { domains: [simulation.domain] } : {}),
    discoveredActions,
    selectedActions: invocations,
    invocations,
    authorizationEvents: simulation.authorizationEvents,
    toolCalls: invocations.length,
    retryCount: invocations.reduce((total, invocation) => total + invocation.retryCount, 0),
    latencyMs: simulation.latencyMs ?? invocations.reduce((total, invocation) => total + invocation.latencyMs, 0),
    taskLatencyMs: simulation.latencyMs ?? invocations.reduce((total, invocation) => total + invocation.latencyMs, 0),
    approvalCount: simulation.authorizationEvents.filter((event) => event.status === 'requested').length,
    attemptEvidence: 'complete',
    evidenceStatus: 'complete',
    ...(simulation.observedBehavior ? { observedBehavior: simulation.observedBehavior } : {}),
    ...(simulation.finalState !== undefined ? { finalStateSource: 'simulation' as const } : {}),
    executionStatus: simulation.taskSuccess === false ? 'failed' : 'completed',
    ...(simulation.taskSuccess !== undefined ? { taskSuccess: simulation.taskSuccess } : {}),
    ...(simulation.finalState !== undefined ? { finalState: simulation.finalState } : {})
  }
}

function validateSimulationActions(
  evalCase: EvalCase,
  simulation: EvalSimulation,
  reference: CapabilityReference
): void {
  const actionIds = [
    ...simulation.discoveries.flatMap((discovery) => discovery.actions),
    ...simulation.calls.map((call) => call.actionId),
    ...simulation.authorizationEvents.map((event) => event.actionId)
  ]
  const unknown = [...new Set(actionIds)].filter((actionId) => !reference.byId.has(actionId))
  if (unknown.length > 0) {
    throw new Error(
      `Eval case ${evalCase.id} references actions absent from ${reference.source}: ${unknown.join(', ')}`
    )
  }
}

async function runOneCase(
  evalCase: EvalCase,
  executor: CapabilityEvalExecutor,
  options: RunEvalCasesOptions,
  run: Readonly<{ experimentId: string; runIndex: number; runId: string }>
): Promise<EvalCaseResult> {
  const runId = run.runId
  await options.onRunState?.({
    ...run,
    caseId: evalCase.id,
    runId,
    status: 'scheduled'
  })
  let isolated: Awaited<ReturnType<typeof createIsolatedEvalContext>> | undefined
  let result = evaluateCase(evalCase, { trace: emptyTrace('unavailable', run) })
  try {
    await options.onRunState?.({ ...run, caseId: evalCase.id, runId, status: 'running' })
    isolated = await createIsolatedEvalContext(evalCase, { ...run, runId })
    const execution = await executor.run(evalCase, isolated.context)
    const enrichedExecution = await attachLlmJudgeResults(execution, options.llmJudgeResultsDirectory, evalCase.id)
    result = evaluateCase(evalCase, enrichedExecution)
  } catch (error) {
    const executionError = {
      type: 'execution_error' as const,
      message: error instanceof Error ? error.message : String(error)
    }
    result = {
      ...evaluateCase(evalCase, {
        trace: {
          ...emptyTrace('unavailable', run),
          runId,
          executionStatus: 'failed',
          executionError: error instanceof Error ? error.message : String(error),
          ...(error instanceof CapabilityEvalPreflightError ? { preflight: error.snapshot } : {})
        }
      }),
      passed: false,
      outcome: 'INCONCLUSIVE',
      // With no execution result, an empty trace is not evidence that the
      // Agent missed an action. Keep only the infrastructure failure.
      failures: [executionError]
    }
  } finally {
    if (isolated && options.workspaceSnapshotDirectory) {
      try {
        const snapshotDirectory = await preserveWorkspaceSnapshot(
          isolated.context.directory,
          options.workspaceSnapshotDirectory,
          evalCase.id,
          isolated.context
        )
        result = {
          ...result,
          actual: {
            ...result.actual,
            workspaceSnapshotDirectory: snapshotDirectory
          }
        }
      } catch (error) {
        const persistenceFailure = {
          type: 'workspace_persistence_failure' as const,
          message: error instanceof Error ? error.message : String(error)
        }
        result = {
          ...result,
          passed: false,
          outcome: outcomeAfterInfrastructureFailure([
            ...result.failures,
            persistenceFailure
          ]),
          failures: [...result.failures, persistenceFailure]
        }
      }
    }
    try {
      await isolated?.cleanup()
    } catch (error) {
      result = {
        ...result,
        passed: false,
        outcome: outcomeAfterInfrastructureFailure(result.failures),
        failures: [
          ...result.failures,
          {
            type: 'cleanup_failure',
            message: error instanceof Error ? error.message : String(error)
          }
        ]
      }
    }
    const finalResult: EvalCaseResult = {
      ...result,
      actual: {
        ...result.actual,
        experimentId: run.experimentId,
        runId,
        runIndex: run.runIndex
      }
    }
    await options.onRunState?.({
      ...run,
      caseId: evalCase.id,
      runId,
      status: finalResult.outcome === 'PASS' ? 'completed' : finalResult.outcome === 'FAIL' ? 'failed' : 'inconclusive',
      outcome: finalResult.outcome,
      executionStatus: finalResult.actual.executionStatus,
      trace: finalResult.actual,
      failureStages: finalResult.failureStages
    })
    result = finalResult
  }
  return result
}

async function attachLlmJudgeResults(
  execution: CapabilityEvalExecution,
  directory: string | undefined,
  caseId: string
): Promise<CapabilityEvalExecution> {
  if (!directory) return execution
  const sidecarPath = resolve(directory, `${caseId}.json`)
  let raw: string
  try {
    raw = await readFile(sidecarPath, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return execution
    throw error
  }
  const sidecar = evalLlmJudgeSidecarSchema.parse(JSON.parse(raw))
  if (sidecar.caseId !== caseId) {
    throw new Error(`LLM Judge sidecar ${sidecarPath} is for ${sidecar.caseId}, not ${caseId}.`)
  }
  return {
    ...execution,
    trace: {
      ...execution.trace,
      llmJudgeResults: sidecar.results
    }
  }
}

function outcomeAfterInfrastructureFailure(
  failures: EvalCaseResult['failures']
): 'FAIL' | 'INCONCLUSIVE' {
  const decisive = failures.some((failure) => ![
    'trace_unsupported',
    'execution_error',
    'cleanup_failure',
    'workspace_persistence_failure'
  ].includes(failure.type))
  return decisive ? 'FAIL' : 'INCONCLUSIVE'
}

async function preserveWorkspaceSnapshot(
  workspaceDirectory: string,
  outputDirectory: string,
  caseId: string,
  run: Pick<EvalIsolationContext, 'runId' | 'runIndex'>
): Promise<string> {
  const root = resolve(outputDirectory)
  const safeCaseId = caseId.replace(/[^A-Za-z0-9._-]/gu, '_') || 'unknown'
  const safeRunId = run.runId.replace(/[^A-Za-z0-9._-]/gu, '_') || 'unknown'
  const caseDirectory = join(root, `case-${safeCaseId}`, `run-${run.runIndex}-${safeRunId}`)
  await mkdir(root, { recursive: true })
  await rm(caseDirectory, { recursive: true, force: true })
  await cp(workspaceDirectory, caseDirectory, {
    recursive: true,
    force: true,
    errorOnExist: false
  })
  return caseDirectory
}

function emptyTrace(
  evidenceStatus: EvalTrace['evidenceStatus'] = 'complete',
  run: Readonly<{ experimentId?: string; runIndex?: number }> = {}
): EvalTrace {
  return {
    ...(run.experimentId ? { experimentId: run.experimentId } : {}),
    ...(run.runIndex !== undefined ? { runIndex: run.runIndex } : {}),
    discoveredActions: [],
    selectedActions: [],
    invocations: [],
    authorizationEvents: [],
    toolCalls: 0,
    retryCount: 0,
    latencyMs: 0,
    evidenceStatus
  }
}
