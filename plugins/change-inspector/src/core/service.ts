import { createHash } from 'node:crypto'
import type {
  ChangeInspectorListChangesInput,
  ChangeInspectorOpenInput,
  ChangeInspectorSnapshot
} from '../contract.js'
import { changeInspectorListChangesOutputSchema } from '../contract.js'
import { projectSessionChangeSummaries, projectSessionChangeSnapshot } from './change-observation.js'
import type { ChangeInspectorAgentThreadsPort } from '../ports/agent-threads.js'

export type ChangeInspectorServiceOptions = Readonly<{
  agentThreads: ChangeInspectorAgentThreadsPort
}>

/**
 * Core orchestration, byte-equivalent to the static
 * `ChangeInspectorRuntime.snapshot` flow: read the session through the
 * agent-threads port, enforce the cross-workspace policy, project the change
 * snapshot.
 */
export class ChangeInspectorService {
  readonly #agentThreads: ChangeInspectorAgentThreadsPort

  constructor(options: ChangeInspectorServiceOptions) {
    this.#agentThreads = options.agentThreads
  }

  async listChanges(input: ChangeInspectorListChangesInput, workspaceRoot: string) {
    if (!this.#agentThreads.list) throw new Error('Change Inspector requires the agent-threads list port.')
    const threads = await this.#agentThreads.list({ includeArchived: false })
    const thread = threads.find(candidate => candidate.id === input.sessionId)
    if (!thread) throw new Error(`The requested session ${input.sessionId} is not available.`)
    const snapshot = await this.snapshot({ sessionId: input.sessionId, runtimeId: thread.runtimeId }, workspaceRoot)
    return changeInspectorListChangesOutputSchema.parse({
      ...projectSessionChangeSummaries(snapshot, input),
      revision: snapshot.revision, truncated: snapshot.truncated
    })
  }

  async snapshot(
    input: ChangeInspectorOpenInput,
    workspaceRoot: string
  ): Promise<ChangeInspectorSnapshot> {
    const detail = await this.#agentThreads.read({
      runtimeId: input.runtimeId,
      threadId: input.sessionId
    })
    const observedWorkspace = detail.workspaceRoot?.trim()
    if (observedWorkspace && normalizePath(observedWorkspace) !== normalizePath(workspaceRoot)) {
      throw new Error('The requested session belongs to another workspace.')
    }
    return projectSessionChangeSnapshot(input.sessionId, detail)
  }
}

export function changeInspectorResourceId(input: ChangeInspectorOpenInput): string {
  // JSON's array encoding is an unambiguous canonical tuple for two strings;
  // hashing keeps the Broker-visible identity bounded and avoids delimiter
  // collisions such as ["a:b", "c"] versus ["a", "b:c"].
  const canonicalTuple = JSON.stringify([input.runtimeId, input.sessionId])
  return `session-changes:${createHash('sha256').update(canonicalTuple).digest('hex')}`
}

export function normalizePath(value: string): string {
  return value.replace(/\\/g, '/').replace(/\/+$/, '')
}
