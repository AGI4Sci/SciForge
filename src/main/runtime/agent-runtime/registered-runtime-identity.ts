import type { AgentRuntimeId } from '../../../shared/agent-runtime-contract'

/** Runtime identity follows the Host adapter registry, including persistence. */
export function requireRegisteredRuntimeId(
  runtimes: ReadonlyMap<AgentRuntimeId, unknown>,
  value: unknown
): AgentRuntimeId {
  if (typeof value !== 'string' || !runtimes.has(value as AgentRuntimeId)) {
    throw new Error('Unsupported Runtime identity.')
  }
  return value as AgentRuntimeId
}
