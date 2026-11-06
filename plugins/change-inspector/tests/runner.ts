import { openSession } from '../src/core/operations.js'
import { ChangeInspectorService } from '../src/core/service.js'
import type { ChangeInspectorAgentThreadsPort, ChangeInspectorSessionDetail } from '../src/ports/agent-threads.js'
import type { ScenarioStep } from './cases.js'
import { createConfigAgentThreads } from './fixtures/config-agent-threads.js'

/** Recorded corpus only; does not substitute for Host authorization acceptance. */
export function fakeAgentThreads(
  sessions: Record<string, ChangeInspectorSessionDetail>,
  currentSessionId = Object.keys(sessions)[0]
): ChangeInspectorAgentThreadsPort {
  const recorded = Object.fromEntries(Object.entries(sessions).map(([id, detail]) => [id, {
    sessionId: detail.sessionId, runtimeId: detail.runtimeId, workspaceRoot: detail.workspaceRoot, watermark: detail.watermark,
    artifacts: [...detail.artifacts],
    ...(detail.turns ? { turns: detail.turns.map(turn => ({ id: turn.id, artifacts: [...turn.artifacts] })) } : {})
  }]))
  return createConfigAgentThreads({ sessions: recorded, ...(currentSessionId ? { currentSessionId } : {}) })
}

export async function runPluginScenario(
  steps: readonly ScenarioStep[],
  options: Readonly<{ sessions: Record<string, ChangeInspectorSessionDetail> }>
): Promise<readonly unknown[]> {
  const service = new ChangeInspectorService({ agentThreads: fakeAgentThreads(options.sessions) })
  const results: unknown[] = []
  for (const step of steps) {
    try {
      const result = await openSession(service, step.input)
      results.push({ value: result.output })
    } catch (error) {
      results.push({ threw: error instanceof Error ? error.message : String(error) })
    }
  }
  return Object.freeze(results)
}
