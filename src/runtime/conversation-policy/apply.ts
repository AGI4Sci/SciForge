import type { GatewayRequest, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { clipForAgentServerJson, isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import {
  CONVERSATION_POLICY_AGENTSERVER_GENERATION_ADAPTER,
  CONVERSATION_POLICY_REQUEST_VERSION,
  CONVERSATION_POLICY_SELECTED_COMPONENT_ADAPTER,
  CONVERSATION_POLICY_SELECTED_COMPONENT_KIND,
  CONVERSATION_POLICY_SELECTED_SENSE_ADAPTER,
  CONVERSATION_POLICY_SELECTED_TOOL_ADAPTER,
  CONVERSATION_POLICY_SELECTED_VERIFIER_ADAPTER,
  SAFE_DEFAULT_BACKGROUND_PLAN,
  SAFE_DEFAULT_CACHE_POLICY,
  SAFE_DEFAULT_LATENCY_POLICY,
  SAFE_DEFAULT_RESPONSE_PLAN,
  type ConversationPolicyRequest,
  type ConversationPolicyResponse,
} from '@sciforge-ui/runtime-contract/conversation-policy';
import { callPythonConversationPolicy, conversationPolicyBridgeConfig, type ConversationPolicyBridgeConfig } from './python-bridge.js';

export interface ConversationPolicyApplication {
  request: GatewayRequest;
  response?: ConversationPolicyResponse;
  status: 'applied' | 'disabled' | 'failed';
  error?: string;
  stderr?: string;
}

export async function applyConversationPolicy(
  request: GatewayRequest,
  callbacks: WorkspaceRuntimeCallbacks = {},
  options: {
    workspace?: string;
    config?: ConversationPolicyBridgeConfig;
  } = {},
): Promise<ConversationPolicyApplication> {
  const config = options.config ?? conversationPolicyBridgeConfig();
  if (config.mode === 'off') {
    return { request, status: 'disabled' };
  }

  const policyRequest = buildConversationPolicyRequest(request, {
    workspace: options.workspace,
    tsDecisions: {},
  });
  const result = await callPythonConversationPolicy(policyRequest, config);
  if (!result.ok) {
    emitWorkspaceRuntimeEvent(callbacks, {
      type: 'conversation-policy',
      source: 'workspace-runtime',
      status: 'failed',
      message: 'Python conversation policy failed; continuing with transport-only request fallback.',
      detail: result.error,
      raw: clipForAgentServerJson({ error: result.error, stderr: result.stderr }, 3),
    });
    return { request, status: 'failed', error: result.error, stderr: result.stderr };
  }

  const enriched = requestWithPolicyResponse(request, result.response);
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'conversation-policy',
    source: 'workspace-runtime',
    status: 'applied',
    message: 'Python conversation policy applied.',
    detail: policySummary(result.response),
    raw: clipForAgentServerJson(result.response, 4),
  });
  return { request: enriched, response: result.response, status: 'applied', stderr: result.stderr };
}

export function requestWithPolicyResponse(
  request: GatewayRequest,
  response: ConversationPolicyResponse,
): GatewayRequest {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const memoryPlan = isRecord(response.memoryPlan) ? response.memoryPlan : {};
  const handoffPlan = isRecord(response.handoffPlan) ? response.handoffPlan : {};
  const handoffPayload = isRecord(handoffPlan.payload) ? handoffPlan.payload : {};
  const contextPolicy = isRecord(response.contextPolicy) ? response.contextPolicy : undefined;
  const acceptancePlan = isRecord(response.acceptancePlan) ? response.acceptancePlan : undefined;
  const recoveryPlan = isRecord(response.recoveryPlan) ? response.recoveryPlan : undefined;
  const capabilityBrief = isRecord(response.capabilityBrief) ? response.capabilityBrief : undefined;
  const latencyPolicy = isRecord(response.latencyPolicy) ? response.latencyPolicy : { ...SAFE_DEFAULT_LATENCY_POLICY };
  const responsePlan = isRecord(response.responsePlan) ? response.responsePlan : { ...SAFE_DEFAULT_RESPONSE_PLAN };
  const backgroundPlan = isRecord(response.backgroundPlan) ? response.backgroundPlan : { ...SAFE_DEFAULT_BACKGROUND_PLAN };
  const cachePolicy = isRecord(response.cachePolicy) ? response.cachePolicy : { ...SAFE_DEFAULT_CACHE_POLICY };
  const executionModeDecision = executionModeDecisionFromPolicy(response.executionModePlan);
  const artifactPolicy = isRecord(handoffPayload.policy) ? handoffPayload.policy : isRecord(handoffPlan) ? handoffPlan : undefined;
  const currentReferences = response.currentReferences?.length
    ? response.currentReferences
    : toRecordList(uiState.currentReferences);
  const currentReferenceDigests = response.currentReferenceDigests?.length
    ? response.currentReferenceDigests
    : toRecordList(uiState.currentReferenceDigests);
  const recentConversation = toRecordList(memoryPlan.recentConversation);
  const recentRuns = toRecordList(memoryPlan.recentRuns);
  const conversationLedger = toRecordList(memoryPlan.conversationLedger);

  return {
    ...request,
    artifactPolicy: artifactPolicy ?? request.artifactPolicy,
    referencePolicy: isRecord(contextPolicy?.referencePriority) ? contextPolicy.referencePriority : request.referencePolicy,
    failureRecoveryPolicy: recoveryPlan ?? request.failureRecoveryPolicy,
    uiState: {
      ...uiState,
      conversationPolicy: {
        ...response,
        latencyPolicy,
        responsePlan,
        backgroundPlan,
        cachePolicy,
      },
      latencyPolicy,
      responsePlan,
      backgroundPlan,
      cachePolicy,
      goalSnapshot: response.goalSnapshot,
      contextReusePolicy: contextPolicy,
      contextIsolation: contextPolicy,
      memoryPlan,
      currentReferences,
      currentReferenceDigests,
      conversationLedger: conversationLedger.length ? conversationLedger : uiState.conversationLedger,
      recentConversation: recentConversation.length ? recentConversation : uiState.recentConversation,
      recentRuns: recentRuns.length ? recentRuns : uiState.recentRuns,
      artifactIndex: response.artifactIndex,
      capabilityBrief,
      executionModeDecision,
      handoffPlan,
      acceptancePlan,
      recoveryPlan,
      userVisiblePlan: response.userVisiblePlan,
    },
  };
}

function buildConversationPolicyRequest(
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
      adapter: CONVERSATION_POLICY_SELECTED_TOOL_ADAPTER,
      internalAgent: id.includes('vision') || id.includes('computer') ? 'optional' : 'none',
    });
  }
  for (const id of uniqueStrings(request.selectedSenseIds ?? [])) {
    manifests.push({
      id,
      kind: 'sense',
      summary: `Selected sense capability ${id}.`,
      triggers: id.split(/[./:_-]+/).filter(Boolean),
      adapter: CONVERSATION_POLICY_SELECTED_SENSE_ADAPTER,
      internalAgent: id.includes('vision') || id.includes('computer') ? 'optional' : 'none',
    });
  }
  for (const id of uniqueStrings(request.selectedVerifierIds ?? [])) {
    manifests.push({
      id,
      kind: 'verifier',
      summary: `Selected verifier ${id}.`,
      triggers: id.split(/[./:_-]+/).filter(Boolean),
      adapter: CONVERSATION_POLICY_SELECTED_VERIFIER_ADAPTER,
      internalAgent: 'none',
    });
  }
  for (const id of uniqueStrings(request.selectedComponentIds ?? toStringList(request.uiState?.selectedComponentIds))) {
    manifests.push({
      id,
      kind: CONVERSATION_POLICY_SELECTED_COMPONENT_KIND,
      summary: `Selected UI component ${id}.`,
      triggers: id.split(/[./:_-]+/).filter(Boolean),
      adapter: CONVERSATION_POLICY_SELECTED_COMPONENT_ADAPTER,
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
    adapter: CONVERSATION_POLICY_AGENTSERVER_GENERATION_ADAPTER,
    internalAgent: 'required',
  });
  return uniqueById(manifests);
}

function executionModeDecisionFromPolicy(value: unknown): Record<string, unknown> {
  const plan = isRecord(value) ? value : {};
  return {
    executionModeRecommendation: stringField(plan.executionMode) ?? 'unknown',
    complexityScore: numberField(plan.complexityScore) ?? 'unknown',
    uncertaintyScore: numberField(plan.uncertaintyScore) ?? 'unknown',
    reproducibilityLevel: stringField(plan.reproducibilityLevel) ?? 'unknown',
    stagePlanHint: stagePlanHintField(plan.stagePlanHint) ?? 'backend-decides',
    executionModeReason: stringField(plan.reason) ?? stringField(plan.executionModeReason) ?? 'backend-decides',
  };
}

function policySummary(response: ConversationPolicyResponse) {
  const contextMode = isRecord(response.contextPolicy) && typeof response.contextPolicy.mode === 'string'
    ? response.contextPolicy.mode
    : 'unknown';
  const executionMode = isRecord(response.executionModePlan) && typeof response.executionModePlan.executionMode === 'string'
    ? response.executionModePlan.executionMode
    : 'unknown';
  const digestCount = response.currentReferenceDigests?.length ?? 0;
  const selectedCount = isRecord(response.capabilityBrief) && Array.isArray(response.capabilityBrief.selected)
    ? response.capabilityBrief.selected.length
    : 0;
  return `context=${contextMode}; executionMode=${executionMode}; digests=${digestCount}; capabilities=${selectedCount}`;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
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

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stagePlanHintField(value: unknown) {
  if (typeof value === 'string' && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const items = value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim())).map((item) => item.trim());
    return items.length ? items : undefined;
  }
  return undefined;
}
