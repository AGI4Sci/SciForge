import type { ScenarioId } from '../../data';
import type { AgentBackendId, SendAgentMessageInput } from '../../domain';
import { builtInScenarioIdForRuntimeInput } from '@sciforge/scenario-core/scenario-routing-policy';
import { SUPPORTED_RUNTIME_AGENT_BACKENDS } from '@sciforge-ui/runtime-contract/agent-backend-policy';

export function normalizeAgentBackend(value: string): AgentBackendId {
  const backend = value.trim();
  return (SUPPORTED_RUNTIME_AGENT_BACKENDS as readonly string[]).includes(backend)
    ? backend as AgentBackendId
    : 'codex';
}

export function builtInScenarioIdForInput(input: SendAgentMessageInput): ScenarioId {
  return builtInScenarioIdForRuntimeInput(input);
}
