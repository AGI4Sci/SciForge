import type { GatewayRequest } from '../runtime-types.js';
import { isRecord, toRecordList, toStringList } from '../gateway-utils.js';

export const CONVERSATION_POLICY_REQUEST_VERSION = 'sciforge.conversation-policy.request.v1' as const;
export const CONVERSATION_POLICY_RESPONSE_VERSION = 'sciforge.conversation-policy.response.v1' as const;

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
  fallbackMessagePolicy: 'truthful-status-without-background-completion-claim',
  backgroundCompletionSummary: 'No background completion may be declared without a Python backgroundPlan.',
  reason: 'Python conversation policy did not provide responsePlan; use foreground-safe status defaults.',
};

export const SAFE_DEFAULT_BACKGROUND_PLAN: Record<string, unknown> = {
  schemaVersion: 'sciforge.conversation.background-plan.v1',
  enabled: false,
  tasks: [],
  handoffRefsRequired: true,
  cancelOnNewUserTurn: true,
  reason: 'Python conversation policy did not provide backgroundPlan; do not claim background completion.',
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

export function buildConversationPolicyRequest(
  request: GatewayRequest,
  params: {
    workspace?: string;
    tsDecisions: Record<string, unknown>;
  },
): ConversationPolicyRequest {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const ledger = toRecordList(uiState.conversationLedger);
  const ledgerTail = toRecordList(isRecord(uiState.conversationLedger) ? uiState.conversationLedger.tail : undefined);
  const currentReferences = mergeRecordsByRef([
    ...toRecordList(request.references),
    ...toRecordList(uiState.currentReferences),
  ]);
  const sessionMessages = toRecordList(uiState.sessionMessages).length
    ? toRecordList(uiState.sessionMessages)
    : toRecordList(uiState.messages);
  return {
    schemaVersion: CONVERSATION_POLICY_REQUEST_VERSION,
    turn: {
      turnId: stringField(uiState.currentTurnId) ?? stringField(uiState.turnId),
      prompt: request.prompt,
      references: currentReferences.slice(0, 24),
    },
    session: {
      sessionId: stringField(uiState.sessionId),
      scenarioId: request.scenarioPackageRef?.id ?? request.skillDomain,
      messages: sessionMessages.length
        ? sessionMessages.slice(-24)
        : toStringList(uiState.recentConversation).slice(-12),
      runs: toRecordList(uiState.recentRuns).slice(-12),
      artifacts: request.artifacts.slice(-24),
      executionUnits: ledgerTail.length ? ledgerTail.slice(-24) : ledger.slice(-24),
      contextReusePolicy: isRecord(uiState.contextReusePolicy) ? uiState.contextReusePolicy : undefined,
    },
    workspace: {
      root: params.workspace ?? request.workspacePath,
    },
    capabilities: capabilityManifestsForPolicy(request),
    limits: {
      maxContextWindowTokens: request.maxContextWindowTokens,
      maxInlineChars: 2400,
    },
    tsDecisions: params.tsDecisions,
  };
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

function optionalRecord(value: unknown) {
  return isRecord(value) ? value : undefined;
}

function policyRecord(value: unknown, fallback: Record<string, unknown>) {
  return isRecord(value) ? value : { ...fallback };
}

function optionalRecordList(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : undefined;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function capabilityManifestsForPolicy(request: GatewayRequest) {
  const manifests: Array<Record<string, unknown>> = [];
  for (const id of uniqueStrings([
    ...(request.selectedToolIds ?? []),
    ...toStringList(request.uiState?.selectedToolIds),
  ])) {
    manifests.push({
      id,
      kind: id.includes('sense') ? 'sense' : 'tool',
      summary: `Selected runtime capability ${id}.`,
      triggers: id.split(/[./:_-]+/).filter(Boolean),
      adapter: 'runtime:selected-tool',
      internalAgent: id.includes('vision') || id.includes('computer') ? 'optional' : 'none',
    });
  }
  for (const id of uniqueStrings(request.selectedSenseIds ?? [])) {
    manifests.push({
      id,
      kind: 'sense',
      summary: `Selected sense capability ${id}.`,
      triggers: id.split(/[./:_-]+/).filter(Boolean),
      adapter: 'runtime:selected-sense',
      internalAgent: id.includes('vision') || id.includes('computer') ? 'optional' : 'none',
    });
  }
  for (const id of uniqueStrings(request.selectedVerifierIds ?? [])) {
    manifests.push({
      id,
      kind: 'verifier',
      summary: `Selected verifier ${id}.`,
      triggers: id.split(/[./:_-]+/).filter(Boolean),
      adapter: 'runtime:selected-verifier',
      internalAgent: 'none',
    });
  }
  for (const id of uniqueStrings(request.selectedComponentIds ?? toStringList(request.uiState?.selectedComponentIds))) {
    manifests.push({
      id,
      kind: 'ui-component',
      summary: `Selected UI component ${id}.`,
      triggers: id.split(/[./:_-]+/).filter(Boolean),
      adapter: 'ui:component',
      internalAgent: 'none',
    });
  }
  manifests.push({
    id: `scenario.${request.skillDomain}.agentserver-generation`,
    kind: 'skill',
    domain: [request.skillDomain],
    summary: `General AgentServer generation for ${request.skillDomain} tasks.`,
    triggers: [request.skillDomain, 'agentserver', 'generation'],
    artifacts: request.expectedArtifactTypes ?? [],
    adapter: 'agentserver:generation',
    internalAgent: 'required',
  });
  return uniqueById(manifests);
}

function uniqueStrings(values: unknown[]) {
  return [...new Set(toStringList(values))];
}

function uniqueById(values: Array<Record<string, unknown>>) {
  const seen = new Set<string>();
  return values.filter((value) => {
    const id = stringField(value.id);
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

function mergeRecordsByRef(values: Array<Record<string, unknown>>) {
  const out: Array<Record<string, unknown>> = [];
  const seen = new Set<string>();
  for (const value of values) {
    const key = stringField(value.ref) ?? stringField(value.path) ?? stringField(value.id) ?? JSON.stringify(value);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out;
}
