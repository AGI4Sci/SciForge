export const TURN_EXECUTION_CONSTRAINTS_SCHEMA_VERSION = 'sciforge.turn-execution-constraints.v1' as const;
export const TURN_EXECUTION_CONSTRAINTS_TOOL_ID = 'sciforge.turn-execution-constraints' as const;

export interface TurnExecutionConstraints {
  schemaVersion: typeof TURN_EXECUTION_CONSTRAINTS_SCHEMA_VERSION;
  policyId: 'sciforge.current-turn-execution-constraints.v1';
  source: 'runtime-contract.turn-constraints';
  contextOnly: boolean;
  agentServerForbidden: boolean;
  workspaceExecutionForbidden: boolean;
  externalIoForbidden: boolean;
  codeExecutionForbidden: boolean;
  preferredCapabilityIds: string[];
  executionModeHint?: 'direct-context-answer';
  initialResponseModeHint?: 'direct-context-answer';
  reasons: string[];
  evidence: {
    hasPriorContext: boolean;
    referenceCount: number;
    artifactCount: number;
    executionRefCount: number;
    runCount: number;
  };
}

export function normalizeTurnExecutionConstraints(value: unknown): TurnExecutionConstraints | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== TURN_EXECUTION_CONSTRAINTS_SCHEMA_VERSION) return undefined;
  const preferredCapabilityIds = Array.isArray(value.preferredCapabilityIds)
    ? value.preferredCapabilityIds.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const evidence = isRecord(value.evidence) ? value.evidence : {};
  return {
    schemaVersion: TURN_EXECUTION_CONSTRAINTS_SCHEMA_VERSION,
    policyId: 'sciforge.current-turn-execution-constraints.v1',
    source: 'runtime-contract.turn-constraints',
    contextOnly: value.contextOnly === true,
    agentServerForbidden: value.agentServerForbidden === true,
    workspaceExecutionForbidden: value.workspaceExecutionForbidden === true,
    externalIoForbidden: value.externalIoForbidden === true,
    codeExecutionForbidden: value.codeExecutionForbidden === true,
    preferredCapabilityIds,
    executionModeHint: value.executionModeHint === 'direct-context-answer' ? 'direct-context-answer' : undefined,
    initialResponseModeHint: value.initialResponseModeHint === 'direct-context-answer' ? 'direct-context-answer' : undefined,
    reasons: Array.isArray(value.reasons)
      ? value.reasons.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
      : [],
    evidence: {
      hasPriorContext: evidence.hasPriorContext === true,
      referenceCount: positiveInteger(evidence.referenceCount),
      artifactCount: positiveInteger(evidence.artifactCount),
      executionRefCount: positiveInteger(evidence.executionRefCount),
      runCount: positiveInteger(evidence.runCount),
    },
  };
}

function positiveInteger(value: unknown) {
  const number = typeof value === 'number' ? value : Number.NaN;
  return Number.isInteger(number) && number > 0 ? number : 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
