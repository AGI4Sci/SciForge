/** Recorded sessions for tests only; production always uses the authorized Host port. */
import { z } from 'zod'
import type {
  ChangeInspectorAgentThreadsPort,
  ChangeInspectorSessionDetail
} from '../../src/ports/agent-threads.js'

const fixtureSessionSchema = z.object({
  sessionId: z.string().trim().min(1).max(256).optional(),
  runtimeId: z.string().trim().min(1).max(256),
  workspaceRoot: z.string().trim().min(1).max(4_096),
  watermark: z.string(),
  artifacts: z.array(z.unknown()),
  turns: z.array(z.object({ id: z.string(), artifacts: z.array(z.unknown()) }).strict()).optional()
}).strict()

export const changeInspectorFixtureConfigSchema = z.object({
  currentSessionId: z.string().trim().min(1).max(256).optional(),
  sessions: z.record(z.string().trim().min(1).max(256), fixtureSessionSchema).default({})
}).strict()

export type ChangeInspectorFixtureConfig = z.infer<typeof changeInspectorFixtureConfigSchema>

export function createConfigAgentThreads(
  config: ChangeInspectorFixtureConfig
): ChangeInspectorAgentThreadsPort {
  const parsed = changeInspectorFixtureConfigSchema.parse(config)
  const sessions = new Map<string, ChangeInspectorSessionDetail>()
  for (const [sessionId, detail] of Object.entries(parsed.sessions)) {
    if (detail.sessionId !== undefined && detail.sessionId !== sessionId) {
      throw new Error(`Change Inspector fixture identity does not match '${sessionId}'.`)
    }
    sessions.set(sessionId, Object.freeze({ ...detail, sessionId }))
  }
  if (parsed.currentSessionId !== undefined && !sessions.has(parsed.currentSessionId)) {
    throw new Error(`Change Inspector fixture has no session '${parsed.currentSessionId}'.`)
  }
  return Object.freeze({
    read: async ({ threadId, runtimeId }) => {
      const sessionId = threadId ?? parsed.currentSessionId
      const detail = sessionId === undefined ? undefined : sessions.get(sessionId)
      if (!detail) {
        throw new Error(`Change Inspector fixture has no session '${sessionId ?? '(current)'}'.`)
      }
      if (runtimeId !== undefined && runtimeId !== detail.runtimeId) {
        throw new Error('Change Inspector fixture runtime identity does not match the requested session.')
      }
      return detail
    }
  })
}
