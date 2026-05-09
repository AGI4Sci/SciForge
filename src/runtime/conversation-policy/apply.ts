import type { GatewayRequest, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { clipForAgentServerJson, isRecord, toRecordList } from '../gateway-utils.js';
import { buildConversationPolicyRequest, type ConversationPolicyResponse } from './contracts.js';
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
      conversationPolicy: response,
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
