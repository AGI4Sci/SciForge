/**
 * Config-driven fixture for the agent-threads port. The host passes recorded
 * session details through `dshConfig` (`{ sessions: { [sessionId]: detail } }`)
 * so the plugin can be activated and exercised end-to-end before the host
 * capability bridge for plugins exists (plugins/GAPS.md, G1). This is not the
 * production wiring: production reads go through the host's agent-threads
 * service once the bridge lands.
 */
import { z } from 'zod'
import type {
  ChangeInspectorAgentThreadsPort,
  ChangeInspectorSessionDetail
} from '../ports/agent-threads.js'

export const changeInspectorFixtureConfigSchema = z.object({
  sessions: z.record(z.string(), z.unknown()).default({}),
  threads: z.array(z.object({ id: z.string().min(1), runtimeId: z.string().min(1) }).strict()).default([])
}).strict()

export type ChangeInspectorFixtureConfig = z.infer<typeof changeInspectorFixtureConfigSchema>

export function createConfigAgentThreads(
  config: ChangeInspectorFixtureConfig
): ChangeInspectorAgentThreadsPort {
  return Object.freeze({
    list: async () => config.threads,
    read: async ({ threadId }) => {
      const detail = config.sessions[threadId]
      if (!detail || typeof detail !== 'object' || Array.isArray(detail)) {
        throw new Error(`Change Inspector fixture has no session '${threadId}'.`)
      }
      return detail as ChangeInspectorSessionDetail
    }
  })
}
