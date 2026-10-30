/**
 * Static-side scenario runner: drives the in-tree static capability factory
 * exactly like `ChangeInspectorRuntime` does (read through the port, enforce
 * the cross-workspace policy, project with the static change-observation),
 * then records the handler result normalized to the plugin's result shape
 * `{ sessionId, resourceId, snapshot }` — the Broker handle wrapper is the
 * host thin layer's concern (G3) and is not compared.
 *
 * It imports the static module by relative path, which is allowed in tests
 * only.
 */
import assert from 'node:assert/strict'
import { createChangeInspectorCapabilityFactory } from '../../../packages/domains/change-inspector/src/main.js'
import { projectSessionChangeSnapshot } from '../../../packages/domains/change-inspector/src/change-observation.js'
import type {
  ChangeInspectorOpenInput,
  ChangeInspectorSnapshot
} from '../src/contract.js'
import type { ChangeInspectorSessionDetail } from '../src/ports/agent-threads.js'
import { WORKSPACE, type ScenarioStep } from './cases.js'
import { fakeAgentThreads } from './runner.js'

type StaticDefinition = {
  id: string
  effect: string
  approval: string
  audiences: readonly string[]
  handler: (
    input: unknown,
    context: Readonly<{
      caller: Readonly<{ workspaceId?: string }>
      issueResource: (registration: unknown) => unknown
    }>
  ) => Promise<Readonly<{ output: unknown }>>
}

type StaticRegistration = Readonly<{
  resourceId: string
  resourceKind: string
  semanticRevision: string
  observe: () => Promise<Readonly<{
    state: ChangeInspectorSnapshot
    semanticRevision: string
    operationIds: readonly string[]
  }>>
}>

// Mirrors `normalizePath` in the static main.ts (private there).
function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}

export async function runStaticScenario(
  steps: readonly ScenarioStep[],
  options: Readonly<{
    sessions: Record<string, ChangeInspectorSessionDetail>
  }>
): Promise<readonly unknown[]> {
  const port = fakeAgentThreads(options.sessions)
  const factory = createChangeInspectorCapabilityFactory<StaticDefinition>({
    defineCapability: (definition) => definition as unknown as StaticDefinition,
    listChanges: async () => { throw new Error('Open-session scenario must not invoke listChanges.') },
    snapshot: async (input: ChangeInspectorOpenInput, workspaceRoot: string) => {
      const detail = await port.read({
        runtimeId: input.runtimeId,
        threadId: input.sessionId
      })
      const observedWorkspace = detail.workspaceRoot?.trim()
      if (observedWorkspace && normalizePath(observedWorkspace) !== normalizePath(workspaceRoot)) {
        throw new Error('The requested session belongs to another workspace.')
      }
      return projectSessionChangeSnapshot(input.sessionId, detail)
    }
  })
  const [definition] = factory.createDefinitions()
  assert.ok(definition, 'static capability definition missing')

  const results: unknown[] = []
  for (const step of steps) {
    const caller = step.caller ?? WORKSPACE
    let registration: StaticRegistration | undefined
    try {
      const result = await definition.handler(step.input, {
        caller: { workspaceId: caller },
        issueResource: (candidate) => {
          registration = candidate as StaticRegistration
          return {
            token: `cap_${'a'.repeat(24)}`,
            semanticRevision: registration.semanticRevision,
            expiresAt: '2026-07-28T12:00:00.000Z'
          }
        }
      })
      assert.ok(registration, 'static handler did not issue a resource')
      const observed = await registration.observe()
      // Broker-side invariants the host thin layer preserves (G3).
      assert.equal(observed.semanticRevision, observed.state.revision)
      assert.deepEqual(observed.operationIds, [])
      const output = result.output as Readonly<{ sessionId: string }>
      results.push({
        value: {
          sessionId: output.sessionId,
          resourceId: registration.resourceId,
          snapshot: observed.state
        }
      })
    } catch (error) {
      results.push({ threw: error instanceof Error ? error.message : String(error) })
    }
  }
  factory.dispose()
  return Object.freeze(results)
}
