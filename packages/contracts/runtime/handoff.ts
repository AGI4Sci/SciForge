export const SCIFORGE_SKILL_DOMAINS = ['literature', 'structure', 'omics', 'knowledge'] as const;
export type SciForgeSharedSkillDomain = typeof SCIFORGE_SKILL_DOMAINS[number];

export const SCIFORGE_AGENT_HANDOFF_SOURCES = ['ui-chat', 'cli', 'workspace-runtime', 'test'] as const;
export type SciForgeAgentHandoffSource = typeof SCIFORGE_AGENT_HANDOFF_SOURCES[number];

export const DEFAULT_AGENT_SERVER_URL = 'http://127.0.0.1:18080';
export const DEFAULT_AGENT_REQUEST_TIMEOUT_MS = 900_000;

export interface SharedAgentHandoffContract {
  schemaVersion: 1;
  source: SciForgeAgentHandoffSource;
  decisionOwner: 'AgentServer';
  dispatchPolicy: 'agentserver-decides';
  answerPolicy: 'backend-reasons-user-visible-answer';
  contextPolicy: 'refs-and-bounded-summaries';
  artifactPolicy: 'explicit-current-turn-or-backend-decides';
}

export function isSharedSkillDomain(value: unknown): value is SciForgeSharedSkillDomain {
  return typeof value === 'string' && (SCIFORGE_SKILL_DOMAINS as readonly string[]).includes(value);
}

export function normalizeSharedSkillDomain(value: unknown): SciForgeSharedSkillDomain | undefined {
  return isSharedSkillDomain(value) ? value : undefined;
}

export function taskProjectSkillDomain(value: unknown): SciForgeSharedSkillDomain {
  return normalizeSharedSkillDomain(value) ?? 'knowledge';
}

export function normalizeAgentHandoffSource(value: unknown, fallback: SciForgeAgentHandoffSource): SciForgeAgentHandoffSource {
  return typeof value === 'string' && (SCIFORGE_AGENT_HANDOFF_SOURCES as readonly string[]).includes(value)
    ? value as SciForgeAgentHandoffSource
    : fallback;
}

export function buildSharedAgentHandoffContract(source: SciForgeAgentHandoffSource): SharedAgentHandoffContract {
  return {
    schemaVersion: 1,
    source,
    decisionOwner: 'AgentServer',
    dispatchPolicy: 'agentserver-decides',
    answerPolicy: 'backend-reasons-user-visible-answer',
    contextPolicy: 'refs-and-bounded-summaries',
    artifactPolicy: 'explicit-current-turn-or-backend-decides',
  };
}

export function agentHandoffSourceMetadata(source: SciForgeAgentHandoffSource) {
  return {
    source,
    sharedContract: buildSharedAgentHandoffContract(source),
  };
}
