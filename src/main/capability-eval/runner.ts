import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { CapabilityJsonValue } from '../../shared/capability-broker'
import { evaluateCase, type EvalExecutionView } from './evaluators'
import type { CapabilityReference } from './reference'
import {
  type EvalCase,
  type EvalCaseResult,
  type EvalSimulation,
  type EvalTrace
} from './schema'

export type EvalIsolationContext = Readonly<{
  caseId: string
  directory: string
  initialState?: CapabilityJsonValue
  state: CapabilityJsonValue
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
}>

export async function runEvalCases(
  cases: readonly EvalCase[],
  executor: CapabilityEvalExecutor,
  options: RunEvalCasesOptions = {}
): Promise<EvalCaseResult[]> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 1))
  const results = new Array<EvalCaseResult>(cases.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (true) {
      const index = nextIndex++
      const evalCase = cases[index]
      if (!evalCase) return
      results[index] = await runOneCase(evalCase, executor)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, cases.length) }, worker))
  return results
}

export async function createIsolatedEvalContext(evalCase: EvalCase): Promise<{
  context: EvalIsolationContext
  cleanup: () => Promise<void>
}> {
  const directory = await mkdtemp(join(tmpdir(), 'sciforge-capability-eval-'))
  const initialState = evalCase.initialState
  if (initialState !== undefined) {
    await writeFile(
      join(directory, 'initial-state.json'),
      `${JSON.stringify(initialState, null, 2)}\n`,
      'utf8'
    )
  }
  let cleaned = false
  return {
    context: {
      caseId: evalCase.id,
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
  const invocations = simulation.calls.map((call) => ({
    actionId: call.actionId,
    args: call.args,
    success: call.outcome === 'success',
    ...(call.errorCode ? { errorCode: call.errorCode } : {}),
    retryCount: call.retryCount,
    latencyMs: call.latencyMs,
    ...(call.sequence !== undefined ? { sequence: call.sequence } : {})
  }))
  return {
    ...(simulation.domain ? { domain: simulation.domain } : {}),
    discoveredActions,
    selectedActions: invocations,
    invocations,
    authorizationEvents: simulation.authorizationEvents,
    toolCalls: invocations.length,
    retryCount: invocations.reduce((total, invocation) => total + invocation.retryCount, 0),
    latencyMs: simulation.latencyMs ?? invocations.reduce((total, invocation) => total + invocation.latencyMs, 0),
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
  executor: CapabilityEvalExecutor
): Promise<EvalCaseResult> {
  const isolated = await createIsolatedEvalContext(evalCase)
  let result = evaluateCase(evalCase, { trace: emptyTrace() })
  try {
    const execution = await executor.run(evalCase, isolated.context)
    result = evaluateCase(evalCase, execution)
  } catch (error) {
    result = {
      ...result,
      passed: false,
      failures: [
        ...result.failures,
        {
          type: 'execution_error',
          message: error instanceof Error ? error.message : String(error)
        }
      ]
    }
  } finally {
    try {
      await isolated.cleanup()
    } catch (error) {
      result = {
        ...result,
        passed: false,
        failures: [
          ...result.failures,
          {
            type: 'cleanup_failure',
            message: error instanceof Error ? error.message : String(error)
          }
        ]
      }
    }
  }
  return result
}

function emptyTrace(): EvalTrace {
  return {
    discoveredActions: [],
    selectedActions: [],
    invocations: [],
    authorizationEvents: [],
    toolCalls: 0,
    retryCount: 0,
    latencyMs: 0,
    taskSuccess: false
  }
}
