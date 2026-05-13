import type { GatewayRequest, WorkspaceRuntimeCallbacks } from '../runtime-types.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { clipForAgentServerJson, isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import { sha1 } from '../workspace-task-runner.js';
import {
  CONVERSATION_POLICY_REQUEST_VERSION,
  SAFE_DEFAULT_BACKGROUND_PLAN,
  SAFE_DEFAULT_CACHE_POLICY,
  SAFE_DEFAULT_LATENCY_POLICY,
  SAFE_DEFAULT_RESPONSE_PLAN,
  selectedConversationPolicyCapabilityManifests,
  type ConversationPolicyRequest,
  type ConversationPolicyResponse,
} from '@sciforge-ui/runtime-contract/conversation-policy';
import { normalizeTurnExecutionConstraints } from '@sciforge-ui/runtime-contract/turn-constraints';
import { CONVERSATION_POLICY_EVENT_TYPE, WORKSPACE_RUNTIME_SOURCE } from '@sciforge-ui/runtime-contract/events';
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
  });
  const result = await callPythonConversationPolicy(policyRequest, config);
  if (!result.ok) {
    const failedRequest = requestWithFailedConversationPolicy(request, result.error, result.stderr);
    emitWorkspaceRuntimeEvent(callbacks, {
      type: CONVERSATION_POLICY_EVENT_TYPE,
      source: WORKSPACE_RUNTIME_SOURCE,
      status: 'failed',
      message: 'Python conversation policy failed; continuing only with versioned transport constraints and fail-closed runtime gates.',
      detail: result.error,
      raw: clipForAgentServerJson({ error: result.error, stderr: result.stderr }, 3),
    });
    return {
      request: failedRequest,
      status: 'failed',
      error: result.error,
      stderr: result.stderr,
    };
  }

  const enriched = requestWithPolicyResponse(request, result.response);
  emitWorkspaceRuntimeEvent(callbacks, {
    type: CONVERSATION_POLICY_EVENT_TYPE,
    source: WORKSPACE_RUNTIME_SOURCE,
    status: 'applied',
    message: 'Python conversation policy applied.',
    detail: policySummary(result.response),
    raw: clipForAgentServerJson(result.response, 4),
  });
  return { request: enriched, response: result.response, status: 'applied', stderr: result.stderr };
}

function requestWithFailedConversationPolicy(
  request: GatewayRequest,
  error: string,
  stderr?: string,
): GatewayRequest {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  return {
    ...request,
    uiState: {
      ...uiState,
      conversationPolicy: {
        applicationStatus: 'failed',
        policySource: 'python-conversation-policy',
        error,
        stderrDigest: stderr ? sha1(stderr) : undefined,
        latencyPolicy: { ...SAFE_DEFAULT_LATENCY_POLICY },
        responsePlan: { ...SAFE_DEFAULT_RESPONSE_PLAN },
        backgroundPlan: { ...SAFE_DEFAULT_BACKGROUND_PLAN },
        cachePolicy: { ...SAFE_DEFAULT_CACHE_POLICY },
        turnExecutionConstraints: isRecord(uiState.turnExecutionConstraints) ? uiState.turnExecutionConstraints : undefined,
      },
      latencyPolicy: { ...SAFE_DEFAULT_LATENCY_POLICY },
      responsePlan: { ...SAFE_DEFAULT_RESPONSE_PLAN },
      backgroundPlan: { ...SAFE_DEFAULT_BACKGROUND_PLAN },
      cachePolicy: { ...SAFE_DEFAULT_CACHE_POLICY },
    },
  };
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
  const turnExecutionConstraints = normalizeTurnExecutionConstraints(response.turnExecutionConstraints)
    ?? normalizeTurnExecutionConstraints(uiState.turnExecutionConstraints);
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
        applicationStatus: 'applied',
        policySource: 'python-conversation-policy',
        latencyPolicy,
        responsePlan,
        backgroundPlan,
        cachePolicy,
        turnExecutionConstraints,
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
      turnExecutionConstraints,
    },
  };
}

function buildConversationPolicyRequest(
  request: GatewayRequest,
  params: {
    workspace?: string;
  },
): ConversationPolicyRequest {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const ledger = toRecordList(uiState.conversationLedger);
  const ledgerTail = toRecordList(isRecord(uiState.conversationLedger) ? uiState.conversationLedger.tail : undefined);
  const recentExecutionRefs = toRecordList(uiState.recentExecutionRefs);
  const turnExecutionConstraints = normalizeTurnExecutionConstraints(uiState.turnExecutionConstraints);
  const currentTurnReferences = mergeRecordsByRef([
    ...toRecordList(request.references),
    ...toRecordList(uiState.currentReferences),
  ]);
  const sessionMessages = policySessionMessages(uiState);
  return {
    schemaVersion: CONVERSATION_POLICY_REQUEST_VERSION,
    turn: {
      turnId: stringField(uiState.currentTurnId) ?? stringField(uiState.turnId),
      prompt: request.prompt,
      references: currentTurnReferences.slice(0, 24),
    },
    session: {
      sessionId: stringField(uiState.sessionId),
      scenarioId: request.scenarioPackageRef?.id ?? request.skillDomain,
      messages: sessionMessages.length
        ? sessionMessages.slice(-24)
        : toStringList(uiState.recentConversation).slice(-12),
      runs: toRecordList(uiState.recentRuns).slice(-12),
      artifacts: request.artifacts.slice(-24),
      executionUnits: mergeRecordsByRef([
        ...(ledgerTail.length ? ledgerTail.slice(-24) : ledger.slice(-24)),
        ...recentExecutionRefs.slice(-24),
      ]).slice(-24),
      contextReusePolicy: isRecord(uiState.contextReusePolicy) ? uiState.contextReusePolicy : undefined,
    },
    workspace: {
      root: params.workspace ?? request.workspacePath,
    },
    capabilities: selectedConversationPolicyCapabilityManifests({
      skillDomain: request.skillDomain,
      selectedToolIds: [
        ...(request.selectedToolIds ?? []),
        ...toStringList(request.uiState?.selectedToolIds),
      ],
      selectedSenseIds: request.selectedSenseIds ?? [],
      selectedVerifierIds: request.selectedVerifierIds ?? [],
      selectedComponentIds: request.selectedComponentIds ?? toStringList(request.uiState?.selectedComponentIds),
      expectedArtifactTypes: request.expectedArtifactTypes ?? [],
      allowAgentServerGeneration: turnExecutionConstraints?.agentServerForbidden === true ? false : undefined,
    }),
    limits: {
      maxContextWindowTokens: request.maxContextWindowTokens,
      maxInlineChars: 2400,
    },
    tsDecisions: {
      turnExecutionConstraints: isRecord(uiState.turnExecutionConstraints) ? uiState.turnExecutionConstraints : undefined,
    },
  };
}

function policySessionMessages(uiState: Record<string, unknown>) {
  const source = toRecordList(uiState.sessionMessages).length
    ? toRecordList(uiState.sessionMessages)
    : toRecordList(uiState.messages);
  return source.map((message, index) => {
    const existingDigest = isRecord(message.contentDigest) ? message.contentDigest : undefined;
    const bodyStatus = stringField(message.bodyStatus) ?? (message.contentOmitted === true || existingDigest ? 'omitted' : undefined);
    const content = bodyStatus === 'omitted' ? undefined : typeof message.content === 'string' ? message.content : undefined;
    const text = bodyStatus === 'omitted' ? undefined : typeof message.text === 'string' ? message.text : undefined;
    const prompt = bodyStatus === 'omitted' ? undefined : typeof message.prompt === 'string' ? message.prompt : undefined;
    const body = content ?? text ?? prompt ?? '';
    return {
      id: stringField(message.id) ?? `session-message-${index + 1}`,
      role: stringField(message.role) ?? 'unknown',
      bodyStatus: bodyStatus ?? (body ? 'omitted' : undefined),
      contentOmitted: Boolean(body) || bodyStatus === 'omitted',
      contentDigest: existingDigest ?? (body ? {
        omitted: 'session-message-body',
        chars: body.length,
        hash: sha1(body),
      } : undefined),
      references: toRecordList(message.references).slice(-8),
      objectReferences: toRecordList(message.objectReferences).slice(-12),
      guidanceQueue: isRecord(message.guidanceQueue)
        ? {
          status: stringField(message.guidanceQueue.status),
          refs: toStringList(message.guidanceQueue.refs).slice(-8),
        }
        : undefined,
      status: stringField(message.status),
      createdAt: stringField(message.createdAt),
    };
  });
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
