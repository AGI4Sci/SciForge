import type { ScenarioId } from '../../data';
import type { AgentBackendId, SendAgentMessageInput } from '../../domain';
import { builtInScenarioIdForRuntimeInput } from '@sciforge/scenario-core/scenario-routing-policy';

export function normalizeAgentBackend(value: string): AgentBackendId {
  return ['codex', 'openteam_agent', 'claude-code', 'hermes-agent', 'openclaw', 'gemini'].includes(value)
    ? value as AgentBackendId
    : 'codex';
}

export function builtInScenarioIdForInput(input: SendAgentMessageInput): ScenarioId {
  return builtInScenarioIdForRuntimeInput(input);
}
