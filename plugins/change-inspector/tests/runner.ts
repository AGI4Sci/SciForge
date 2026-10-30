import { openSession } from '../src/core/operations.js'
import { ChangeInspectorService } from '../src/core/service.js'
import type {
  ChangeInspectorAgentThreadsPort,
  ChangeInspectorSessionDetail
} from '../src/ports/agent-threads.js'
import { WORKSPACE, type ScenarioStep } from './cases.js'

/** Corpus-driven fake port shared by the plugin and static scenario runners. */
export function fakeAgentThreads(
  sessions: Record<string, ChangeInspectorSessionDetail>
): ChangeInspectorAgentThreadsPort {
  return Object.freeze({
    read: async ({ threadId }) => {
      const detail = sessions[threadId]
      if (!detail) throw new Error(`Unknown session: ${threadId}`)
      return detail
    }
  })
}

/**
 * Runs one scenario against the plugin operation and records either the
 * output value or the thrown error message per step. Used by the parity test
 * (against the static handler) and by the golden baseline.
 */
export async function runPluginScenario(
  steps: readonly ScenarioStep[],
  options: Readonly<{
    sessions: Record<string, ChangeInspectorSessionDetail>
  }>
): Promise<readonly unknown[]> {
  const service = new ChangeInspectorService({
    agentThreads: fakeAgentThreads(options.sessions)
  })
  const results: unknown[] = []
  for (const step of steps) {
    const caller = step.caller ?? WORKSPACE
    try {
      const result = await openSession(service, step.input, caller)
      results.push({ value: result.output })
    } catch (error) {
      results.push({ threw: error instanceof Error ? error.message : String(error) })
    }
  }
  return Object.freeze(results)
}
