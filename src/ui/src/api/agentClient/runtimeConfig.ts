import type { ScenarioId } from '../../data';
import type { AgentBackendId, SendAgentMessageInput } from '../../domain';

export function normalizeAgentBackend(value: string): AgentBackendId {
  return ['codex', 'openteam_agent', 'claude-code', 'hermes-agent', 'openclaw', 'gemini'].includes(value)
    ? value as AgentBackendId
    : 'codex';
}

export function builtInScenarioIdForInput(input: SendAgentMessageInput): ScenarioId {
  const skillDomain = input.scenarioOverride?.skillDomain;
  if (skillDomain === 'structure') return 'structure-exploration';
  if (skillDomain === 'omics') return 'omics-differential-exploration';
  if (skillDomain === 'knowledge') return 'biomedical-knowledge-graph';
  if (skillDomain === 'literature') return 'literature-evidence-review';
  if (input.scenarioId === 'structure-exploration'
    || input.scenarioId === 'omics-differential-exploration'
    || input.scenarioId === 'biomedical-knowledge-graph'
    || input.scenarioId === 'literature-evidence-review') return input.scenarioId as ScenarioId;
  return 'literature-evidence-review';
}
