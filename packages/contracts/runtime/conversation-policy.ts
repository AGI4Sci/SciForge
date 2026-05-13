export const CONVERSATION_POLICY_REQUEST_VERSION = 'sciforge.conversation-policy.request.v1' as const;
export const CONVERSATION_POLICY_RESPONSE_VERSION = 'sciforge.conversation-policy.response.v1' as const;
export const CONVERSATION_POLICY_TOOL_ID = 'sciforge.conversation-policy' as const;
export const CONVERSATION_POLICY_SELECTED_TOOL_ADAPTER = 'runtime:selected-tool' as const;
export const CONVERSATION_POLICY_SELECTED_SENSE_ADAPTER = 'runtime:selected-sense' as const;
export const CONVERSATION_POLICY_SELECTED_VERIFIER_ADAPTER = 'runtime:selected-verifier' as const;
export const CONVERSATION_POLICY_SELECTED_COMPONENT_KIND = 'ui-component' as const;
export const CONVERSATION_POLICY_SELECTED_COMPONENT_ADAPTER = 'ui:component' as const;
export const CONVERSATION_POLICY_AGENTSERVER_GENERATION_ADAPTER = 'agentserver:generation' as const;

export interface SelectedConversationPolicyCapabilityManifestInput {
  skillDomain: string;
  selectedToolIds?: unknown[];
  selectedSenseIds?: unknown[];
  selectedVerifierIds?: unknown[];
  selectedComponentIds?: unknown[];
  expectedArtifactTypes?: unknown[];
  allowAgentServerGeneration?: boolean;
}

export interface ConversationPolicyRequest {
  schemaVersion: typeof CONVERSATION_POLICY_REQUEST_VERSION;
  turn: {
    turnId?: string;
    prompt: string;
    references: Array<Record<string, unknown>>;
  };
  session: {
    sessionId?: string;
    scenarioId?: string;
    messages: Array<string | Record<string, unknown>>;
    runs: Array<Record<string, unknown>>;
    artifacts: Array<Record<string, unknown>>;
    executionUnits: Array<Record<string, unknown>>;
    contextReusePolicy?: Record<string, unknown>;
  };
  workspace: {
    root?: string;
  };
  capabilities: Array<Record<string, unknown>>;
  limits: {
    maxContextWindowTokens?: number;
    maxInlineChars: number;
  };
  tsDecisions: Record<string, unknown>;
}

export interface ConversationPolicyResponse {
  schemaVersion: typeof CONVERSATION_POLICY_RESPONSE_VERSION;
  goalSnapshot?: Record<string, unknown>;
  contextPolicy?: Record<string, unknown>;
  memoryPlan?: Record<string, unknown>;
  currentReferences?: Array<Record<string, unknown>>;
  currentReferenceDigests?: Array<Record<string, unknown>>;
  artifactIndex?: Record<string, unknown>;
  capabilityBrief?: Record<string, unknown>;
  executionModePlan?: Record<string, unknown>;
  turnExecutionConstraints?: Record<string, unknown>;
  handoffPlan?: Record<string, unknown>;
  acceptancePlan?: Record<string, unknown>;
  recoveryPlan?: Record<string, unknown>;
  latencyPolicy?: Record<string, unknown>;
  responsePlan?: Record<string, unknown>;
  backgroundPlan?: Record<string, unknown>;
  cachePolicy?: Record<string, unknown>;
  userVisiblePlan?: Array<Record<string, unknown>>;
  diagnostics?: Record<string, unknown>;
}

export function selectedConversationPolicyCapabilityManifests(
  input: SelectedConversationPolicyCapabilityManifestInput,
) {
  const manifests: Array<Record<string, unknown>> = [];
  for (const id of uniquePolicyStrings(input.selectedToolIds ?? [])) {
    manifests.push({
      id,
      kind: id.includes('sense') ? 'sense' : 'tool',
      summary: `Selected runtime capability ${id}.`,
      triggers: conversationPolicyCapabilityTriggers(id),
      adapter: CONVERSATION_POLICY_SELECTED_TOOL_ADAPTER,
      internalAgent: conversationPolicyCapabilityUsesInternalAgent(id) ? 'optional' : 'none',
    });
  }
  for (const id of uniquePolicyStrings(input.selectedSenseIds ?? [])) {
    manifests.push({
      id,
      kind: 'sense',
      summary: `Selected sense capability ${id}.`,
      triggers: conversationPolicyCapabilityTriggers(id),
      adapter: CONVERSATION_POLICY_SELECTED_SENSE_ADAPTER,
      internalAgent: conversationPolicyCapabilityUsesInternalAgent(id) ? 'optional' : 'none',
    });
  }
  for (const id of uniquePolicyStrings(input.selectedVerifierIds ?? [])) {
    manifests.push({
      id,
      kind: 'verifier',
      summary: `Selected verifier ${id}.`,
      triggers: conversationPolicyCapabilityTriggers(id),
      adapter: CONVERSATION_POLICY_SELECTED_VERIFIER_ADAPTER,
      internalAgent: 'none',
    });
  }
  for (const id of uniquePolicyStrings(input.selectedComponentIds ?? [])) {
    manifests.push({
      id,
      kind: CONVERSATION_POLICY_SELECTED_COMPONENT_KIND,
      summary: `Selected UI component ${id}.`,
      triggers: conversationPolicyCapabilityTriggers(id),
      adapter: CONVERSATION_POLICY_SELECTED_COMPONENT_ADAPTER,
      internalAgent: 'none',
    });
  }
  if (input.allowAgentServerGeneration !== false) {
    manifests.push({
      id: `scenario.${input.skillDomain}.agentserver-generation`,
      kind: 'skill',
      domain: [input.skillDomain],
      summary: `General AgentServer generation for ${input.skillDomain} tasks.`,
      triggers: [input.skillDomain, 'agentserver', 'generation'],
      artifacts: uniquePolicyStrings(input.expectedArtifactTypes ?? []),
      adapter: CONVERSATION_POLICY_AGENTSERVER_GENERATION_ADAPTER,
      internalAgent: 'required',
    });
  }
  return uniquePolicyManifestsById(manifests);
}

export const SAFE_DEFAULT_LATENCY_POLICY: Record<string, unknown> = {
  schemaVersion: 'sciforge.conversation.latency-policy.v1',
  firstVisibleResponseMs: 8000,
  firstEventWarningMs: 12000,
  silentRetryMs: 45000,
  allowBackgroundCompletion: false,
  blockOnContextCompaction: true,
  blockOnVerification: true,
  reason: 'Python conversation policy did not provide latencyPolicy; fail closed for verification and context compaction while allowing ordinary UI status.',
};

export const SAFE_DEFAULT_RESPONSE_PLAN: Record<string, unknown> = {
  schemaVersion: 'sciforge.conversation.response-plan.v1',
  initialResponseMode: 'wait-for-result',
  finalizationMode: 'append-final',
  userVisibleProgress: ['received', 'planning', 'running'],
  progressPhases: ['received', 'planning', 'running'],
  fallbackMessagePolicy: 'truthful-status-without-deferred-result-claim',
  backgroundCompletionSummary: 'No deferred result may be declared without a Python backgroundPlan.',
  reason: 'Python conversation policy did not provide responsePlan; use foreground-safe status defaults.',
};

export const SAFE_DEFAULT_BACKGROUND_PLAN: Record<string, unknown> = {
  schemaVersion: 'sciforge.conversation.background-plan.v1',
  enabled: false,
  tasks: [],
  handoffRefsRequired: true,
  cancelOnNewUserTurn: true,
  reason: 'Python conversation policy did not provide backgroundPlan; do not claim deferred work.',
};

export const SAFE_DEFAULT_CACHE_POLICY: Record<string, unknown> = {
  schemaVersion: 'sciforge.conversation.cache-policy.v1',
  reuseScenarioPlan: false,
  reuseSkillPlan: false,
  reuseUiPlan: false,
  reuseUIPlan: false,
  reuseReferenceDigests: false,
  reuseArtifactIndex: false,
  reuseLastSuccessfulStage: false,
  reuseBackendSession: false,
  reason: 'Python conversation policy did not provide cachePolicy; do not reuse cached planning or execution state.',
};

export function currentUserRequestFromPrompt(prompt: string): string {
  const lines = prompt.split('\n').map((line) => line.trim()).filter(Boolean);
  const userLine = [...lines].reverse().find((line) => /^user\s*:/i.test(line));
  return userLine ? userLine.replace(/^user\s*:\s*/i, '') : prompt;
}

export function conversationSummaryLooksDigestOnly(summary: unknown): boolean {
  return typeof summary === 'string'
    && /\b(?:omitted|digest|hash|refs=)\b/i.test(summary);
}

export function normalizeConversationPolicyResponse(value: unknown): ConversationPolicyResponse | undefined {
  const record = isRecord(value) && isRecord(value.data) ? value.data : value;
  if (!isRecord(record)) return undefined;
  if (record.schemaVersion !== CONVERSATION_POLICY_RESPONSE_VERSION) return undefined;
  return {
    schemaVersion: CONVERSATION_POLICY_RESPONSE_VERSION,
    goalSnapshot: optionalRecord(record.goalSnapshot),
    contextPolicy: optionalRecord(record.contextPolicy),
    memoryPlan: optionalRecord(record.memoryPlan),
    currentReferences: optionalRecordList(record.currentReferences),
    currentReferenceDigests: optionalRecordList(record.currentReferenceDigests),
    artifactIndex: optionalRecord(record.artifactIndex),
    capabilityBrief: optionalRecord(record.capabilityBrief),
    executionModePlan: optionalRecord(record.executionModePlan),
    turnExecutionConstraints: optionalRecord(record.turnExecutionConstraints),
    handoffPlan: optionalRecord(record.handoffPlan),
    acceptancePlan: optionalRecord(record.acceptancePlan),
    recoveryPlan: optionalRecord(record.recoveryPlan),
    latencyPolicy: policyRecord(record.latencyPolicy, SAFE_DEFAULT_LATENCY_POLICY),
    responsePlan: policyRecord(record.responsePlan, SAFE_DEFAULT_RESPONSE_PLAN),
    backgroundPlan: policyRecord(record.backgroundPlan, SAFE_DEFAULT_BACKGROUND_PLAN),
    cachePolicy: policyRecord(record.cachePolicy, SAFE_DEFAULT_CACHE_POLICY),
    userVisiblePlan: optionalRecordList(record.userVisiblePlan),
    diagnostics: optionalRecord(record.diagnostics),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function optionalRecord(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function policyRecord(value: unknown, fallback: Record<string, unknown>) {
  return isRecord(value) ? value : { ...fallback };
}

function optionalRecordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : undefined;
}

function conversationPolicyCapabilityTriggers(id: string) {
  return id.split(/[./:_-]+/).filter(Boolean);
}

function conversationPolicyCapabilityUsesInternalAgent(id: string) {
  return id.includes('vision') || id.includes('computer');
}

function uniquePolicyStrings(values: unknown[]) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && Boolean(value.trim())).map((value) => value.trim()))];
}

function uniquePolicyManifestsById(values: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = typeof value.id === 'string' && value.id.trim() ? value.id.trim() : undefined;
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}
