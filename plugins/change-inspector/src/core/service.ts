import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { ChangeInspectorListChangesInput, ChangeInspectorListChangesOutput, ChangeInspectorOpenInput, ChangeInspectorSnapshot } from '../contract.js'
import { projectSessionChangeSnapshot, projectSessionChangeSummaries } from './change-observation.js'
import type { ChangeInspectorAgentThreadsPort, ChangeInspectorSessionDetail } from '../ports/agent-threads.js'
export type { ChangeInspectorSessionDetail } from '../ports/agent-threads.js'

const authorizedDetailSchema = z.object({
  sessionId: z.string().trim().min(1).max(256),
  runtimeId: z.string().trim().min(1).max(256),
  workspaceRoot: z.string().trim().min(1).max(4096),
  watermark: z.string(),
  artifacts: z.array(z.unknown()),
  turns: z.array(z.object({ id: z.string(), artifacts: z.array(z.unknown()) })).optional()
}).strict()

/** The only production source is a Host-authenticated, invocation-bound port. */
export class ChangeInspectorService {
  readonly #agentThreads: ChangeInspectorAgentThreadsPort
  constructor(options: Readonly<{ agentThreads: ChangeInspectorAgentThreadsPort }>) {
    this.#agentThreads = options.agentThreads
  }
  async #read(input: ChangeInspectorOpenInput): Promise<ChangeInspectorSessionDetail> {
    const detail = authorizedDetailSchema.parse(await this.#agentThreads.read({
      ...(input.runtimeId ? { runtimeId: input.runtimeId } : {}),
      ...(input.sessionId ? { threadId: input.sessionId } : {})
    }))
    if ((input.sessionId && input.sessionId !== detail.sessionId) ||
        (input.runtimeId && input.runtimeId !== detail.runtimeId)) {
      throw new Error('Host session identity does not match the requested session.')
    }
    return detail
  }
  async snapshot(input: ChangeInspectorOpenInput): Promise<ChangeInspectorSnapshot> {
    const detail = await this.#read(input)
    return projectSessionChangeSnapshot(detail.sessionId, detail)
  }
  async listChanges(input: ChangeInspectorListChangesInput): Promise<ChangeInspectorListChangesOutput> {
    const snapshot = await this.snapshot({ sessionId: input.sessionId })
    const page = projectSessionChangeSummaries(snapshot, input)
    return { ...page, revision: snapshot.revision, truncated: snapshot.truncated, truncationReasons: snapshot.truncationReasons }
  }
}

export function changeInspectorResourceId(input: Readonly<{ runtimeId?: string; sessionId: string }>): string {
  return `session-changes:${createHash('sha256').update(JSON.stringify([input.runtimeId ?? null, input.sessionId])).digest('hex')}`
}
