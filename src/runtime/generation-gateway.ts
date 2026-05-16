import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { agentServerGenerationSkill, loadSkillRegistry } from './skill-registry.js';
import { appendTaskAttempt, readRecentTaskAttempts, readTaskAttempts } from './task-attempt-history.js';
import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceRuntimeEvent, WorkspaceTaskRunResult } from './runtime-types.js';
import { fileExists, runWorkspaceTask, sha1 } from './workspace-task-runner.js';
import { maybeWriteSkillPromotionProposal } from './skill-promotion.js';
import { emitWorkspaceRuntimeEvent, throwIfRuntimeAborted } from './workspace-runtime-events.js';
import { composeRuntimeUiManifest } from './runtime-ui-manifest.js';
import { cleanUrl, clipForAgentServerPrompt, errorMessage, excerptAroundFailureLine, extractLikelyErrorLine, generatedTaskArchiveRel, headForAgentServer, isRecord, isTaskInputRel, readTextIfExists, summarizeTextChange, tailForAgentServer, toRecordList, toStringList } from './gateway-utils.js';
import { normalizeBackendHandoff } from './workspace-task-input.js';
import { sessionBundleRelForRequest } from './session-bundle.js';
import {
  expectedArtifactTypesForRequest,
  normalizeGatewayRequest as normalizeGatewayRequestFromModule,
  normalizeLlmEndpoint,
  selectedComponentIdsForRequest,
} from './gateway/gateway-request.js';
import { agentHarnessMetadata, requestWithAgentHarnessShadow, requestWithoutInlineAgentHarness } from './gateway/agent-harness-shadow.js';
import {
  buildContextEnvelope,
  expectedArtifactSchema,
  summarizeArtifactRefs,
  summarizeConversationLedger,
  summarizeExecutionRefs,
  summarizeTaskAttemptsForAgentServer,
  workspaceTreeSummary,
  type AgentServerContextMode,
} from './gateway/context-envelope.js';
import { applyRuntimeVerificationPolicy } from './gateway/verification-policy.js';
import {
  captureRepairBoundarySnapshot,
  evaluateRepairBoundarySnapshot,
  repairBoundaryDiagnosticPayload,
  repairNeededPayload as buildRepairNeededPayload,
  type RepairPolicyRefs,
} from './gateway/repair-policy.js';
import {
  normalizeAgentServerWorkspaceEvent as normalizeAgentServerWorkspaceEventFromModule,
  withRequestContextWindowLimit as withRequestContextWindowLimitFromModule,
} from './gateway/workspace-event-normalizer.js';
import { runAgentServerGeneratedTask as runAgentServerGeneratedTaskFromModule } from './gateway/generated-task-runner.js';
import {
  agentServerAgentId,
  agentServerContextPolicy,
  contextCompactionMetadata,
  contextWindowMetadata,
  estimateWorkspaceContextWindowState,
  fetchAgentServerContextSnapshot,
  currentTurnReferences,
  handoffBudgetDecisionRecords,
  handoffContextWindowState,
  preflightAgentServerContextWindow,
  requestNeedsAgentServerContinuity,
} from './gateway/agentserver-context-window.js';
import {
  agentServerBackendSelectionDecision,
  isBlockingAgentServerConfigurationFailure,
} from './gateway/agent-backend-config.js';
import {
  coerceAgentServerToolPayload,
  coerceWorkspaceTaskPayload,
  classifyPlainAgentText,
  configureDirectAnswerArtifactContext,
  ensureDirectAnswerReportArtifact,
  extractJson,
  mergeReusableContextArtifactsForDirectPayload,
  normalizeWorkspaceTaskPayloadBoundary,
  normalizeToolPayloadShape,
  toolPayloadFromPlainAgentOutput,
} from './gateway/direct-answer-payload.js';
import {
  agentServerLlmRuntime,
  AGENT_BACKEND_ANSWER_PRINCIPLE,
  buildAgentServerCompactContext,
  buildAgentServerGenerationPrompt,
  buildAgentServerRepairPrompt,
  buildCompactRepairContext,
  contextEnvelopeMode,
  hasExplicitRequestLlmConfig,
  missingUserLlmEndpointMessage,
  readConfiguredAgentServerBaseUrl,
  readConfiguredLlmEndpoint,
  redactSecrets,
  requestAgentServerRepair,
  requiresUserLlmEndpoint,
  summarizeRuntimeCapabilitiesForAgentServer,
  summarizeToolsForAgentServer,
  writeAgentServerDebugArtifact,
} from './gateway/agentserver-prompts.js';
import {
  agentServerRequestFailureMessage,
  agentServerRunFailure,
  extractAgentServerOutputText,
  looksLikeUnparsedGenerationResponseText,
  parseGenerationResponse,
  parseToolPayloadResponse,
} from './gateway/agentserver-run-output.js';
import { evaluateToolPayloadEvidence } from './gateway/work-evidence-guard.js';
import { evaluateGuidanceAdoption } from './gateway/guidance-adoption-guard.js';
import { summarizeWorkEvidenceForHandoff } from './gateway/work-evidence-types.js';
import { createLatencyTelemetry } from './gateway/latency-telemetry.js';
import { attachIntentFirstVerification } from './gateway/intent-first-verification.js';
import { applyRuntimeReplayRecorder, attachRuntimeReplayRecorderRefs } from './gateway/runtime-replay-recorder.js';
import { recordValidationRepairTelemetryForPayload } from './gateway/validation-repair-telemetry-runtime.js';
import {
  agentServerFailurePayloadRefs,
  agentServerGenerationFailureReason,
  configurePayloadValidationContext,
  failedTaskPayload,
  repairNeededPayload,
  schemaErrors,
  schemaValidationRepairPayload,
  validateAndNormalizePayload,
} from './gateway/payload-validation.js';
import { collectArtifactReferenceContext } from './gateway/artifact-reference-context.js';
import { diagnosticForFailure, sanitizeAgentServerError } from './gateway/backend-failure-diagnostics.js';
import {
  finalizeAgentServerGenerationSuccess,
  recoverOrReturnAgentServerGenerationFailure,
  type AgentServerGenerationFailureDiagnostics,
  type AgentServerGenerationResult,
} from './gateway/agentserver-generation-recovery.js';
import {
  activeGuidanceQueueForTaskInput,
  attemptPlanRefs,
  firstPayloadFailureReason,
  payloadHasFailureStatus,
} from './gateway/runtime-routing.js';
import { attachResultPresentationContract } from './gateway/result-presentation-contract.js';
import {
  isAgentServerRepairContinuationBoundedStopError,
  agentServerGenerationTokenGuardLimit,
  currentReferenceDigestSilentGuardPolicy,
  mergeBackendStreamWorkEvidence,
  readAgentServerRunStream,
  silentStreamDecisionFromGatewayRequest,
} from './gateway/agentserver-stream.js';
import {
  hydrateGeneratedTaskResponseFromText,
} from './gateway/generated-task-response-text.js';
import { hasRecoverableRecentAttempt } from './gateway/recoverable-attempts.js';
import { tryRunVisionSenseRuntime } from './vision-sense-runtime.js';
import { applyConversationPolicy } from './conversation-policy/apply.js';
import { toolPackageManifests } from '../../packages/skills/tool_skills';
import { AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE } from '../../packages/skills/runtime-policy';
import { agentHandoffSourceMetadata } from '@sciforge-ui/runtime-contract/handoff';
import {
  agentServerConvergenceGuardEvent,
  agentServerDispatchEvent,
  agentServerSilentStreamGuardEvent,
  conversationPolicyStartedEvent,
  directContextFastPathEvent,
  gatewayRequestReceivedEvent,
  repairAttemptResultEvent,
  repairAttemptStartEvent,
  workspaceSkillSelectedEvent,
} from '@sciforge-ui/runtime-contract/events';
import {
  backendHandoffDriftEvent,
  classifyBackendHandoffDrift,
} from '@sciforge-ui/runtime-contract/backend-handoff-drift';
import { CONVERSATION_POLICY_TOOL_ID } from '@sciforge-ui/runtime-contract/conversation-policy';
import { normalizeTurnExecutionConstraints, TURN_EXECUTION_CONSTRAINTS_TOOL_ID } from '@sciforge-ui/runtime-contract/turn-constraints';
import {
  capabilityProviderRoutesForGatewayInvocation,
  publicCapabilityProviderPreflightResult,
  requestWithDiscoveredCapabilityProviders,
} from './gateway/capability-provider-preflight.js';
import { directContextFastPathPayload } from './gateway/direct-context-fast-path.js';
import { requestAgentServerGeneration } from './gateway/agentserver-generation-dispatch.js';
import { requestContextRefs } from './gateway/request-context-refs.js';

configureDirectAnswerArtifactContext(collectArtifactReferenceContext);
configurePayloadValidationContext(attemptPlanRefs);

export async function runWorkspaceRuntimeGateway(body: Record<string, unknown>, callbacks: WorkspaceRuntimeCallbacks = {}): Promise<ToolPayload> {
  const normalizedRequest = normalizeGatewayRequestFromModule(body);
  const runtimeReplayRecorder = applyRuntimeReplayRecorder(callbacks, normalizedRequest);
  const telemetry = createLatencyTelemetry(normalizedRequest, runtimeReplayRecorder.callbacks);
  try {
    emitWorkspaceRuntimeEvent(telemetry.callbacks, gatewayRequestReceivedEvent(normalizedRequest.skillDomain));
    emitWorkspaceRuntimeEvent(telemetry.callbacks, conversationPolicyStartedEvent());
    const policyApplication = await applyConversationPolicy(normalizedRequest, telemetry.callbacks, { workspace: normalizedRequest.workspacePath });
    telemetry.markPolicyApplication(policyApplication);
    const request = await requestWithDiscoveredCapabilityProviders(
      await requestWithAgentHarnessShadow(policyApplication.request, telemetry.callbacks, policyApplication),
    );
    const providerUnavailablePayload = capabilityProviderUnavailablePayload(request);
    if (providerUnavailablePayload) {
      telemetry.markVerificationStart();
      const verified = await recordValidationRepairTelemetryForPayload(
        await applyRuntimeVerificationPolicy(providerUnavailablePayload, request),
        request,
      );
      telemetry.markVerificationEnd();
      return finalizeGatewayPayload(telemetry.emitFinal(verified) ?? verified, request, runtimeReplayRecorder, telemetry.callbacks);
    }
    const directContextPayload = directContextFastPathPayload(request);
    if (directContextPayload) {
      emitWorkspaceRuntimeEvent(telemetry.callbacks, directContextFastPathEvent({
        claimType: directContextPayload.claimType,
        executionUnitCount: directContextPayload.executionUnits.length,
        artifactCount: directContextPayload.artifacts.length,
      }));
      telemetry.markVerificationStart();
      const verified = await recordValidationRepairTelemetryForPayload(
        await applyRuntimeVerificationPolicy(directContextPayload, request),
        request,
      );
      telemetry.markVerificationEnd();
      return finalizeGatewayPayload(telemetry.emitFinal(verified) ?? verified, request, runtimeReplayRecorder, telemetry.callbacks);
    }
    const runtimeForbiddenPayload = runtimeExecutionForbiddenPayload(request);
    if (runtimeForbiddenPayload) {
      telemetry.markVerificationStart();
      const verified = await recordValidationRepairTelemetryForPayload(
        await applyRuntimeVerificationPolicy(runtimeForbiddenPayload, request),
        request,
      );
      telemetry.markVerificationEnd();
      return finalizeGatewayPayload(telemetry.emitFinal(verified) ?? verified, request, runtimeReplayRecorder, telemetry.callbacks);
    }
    const visionSensePayload = await tryRunVisionSenseRuntime(request, telemetry.callbacks);
    if (visionSensePayload) {
      telemetry.markVerificationStart();
      const verified = await recordValidationRepairTelemetryForPayload(
        await applyRuntimeVerificationPolicy(visionSensePayload, request),
        request,
      );
      telemetry.markVerificationEnd();
      return finalizeGatewayPayload(telemetry.emitFinal(verified) ?? verified, request, runtimeReplayRecorder, telemetry.callbacks);
    }
    const forbiddenPayload = agentServerDispatchForbiddenPayload(request);
    if (forbiddenPayload) {
      telemetry.markVerificationStart();
      const verified = await recordValidationRepairTelemetryForPayload(
        await applyRuntimeVerificationPolicy(forbiddenPayload, request),
        request,
      );
      telemetry.markVerificationEnd();
      return finalizeGatewayPayload(telemetry.emitFinal(verified) ?? verified, request, runtimeReplayRecorder, telemetry.callbacks);
    }
    const skills = await loadSkillRegistry(request);
    const skill = agentServerGenerationSkill(request.skillDomain);
    emitWorkspaceRuntimeEvent(telemetry.callbacks, workspaceSkillSelectedEvent({
      skillId: skill.id,
      skillDomain: request.skillDomain,
      entrypointType: skill.manifest.entrypoint.type,
    }));
    const payload = await runAgentServerGeneratedTask(request, skill, skills, telemetry.callbacks)
      ?? repairNeededPayload(request, skill, 'AgentServer task generation did not produce a runnable task.');
    telemetry.markVerificationStart();
    const verified = await recordValidationRepairTelemetryForPayload(
      await applyRuntimeVerificationPolicy(payload, request),
      request,
    );
    telemetry.markVerificationEnd();
    return finalizeGatewayPayload(telemetry.emitFinal(verified) ?? verified, request, runtimeReplayRecorder, telemetry.callbacks);
  } catch (error) {
    telemetry.markFallback(errorMessage(error));
    telemetry.emitFinal();
    throw error;
  } finally {
    await runtimeReplayRecorder.flush?.();
  }
}

function runtimeExecutionForbiddenPayload(request: GatewayRequest): ToolPayload | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const constraints = normalizeTurnExecutionConstraints(uiState.turnExecutionConstraints);
  const policyFailure = conversationPolicyFailure(uiState);
  const runtimeForbidden = constraintsForbidCurrentRuntimeWork(request, uiState, constraints);
  if (!policyFailure && !runtimeForbidden) return undefined;
  const refs = requestContextRefs(request, uiState);
  const reasons = [
    ...(constraints?.reasons ?? []),
    policyFailure ? `conversation policy failed: ${policyFailure.error}` : undefined,
  ].filter((reason): reason is string => Boolean(reason));
  if (policyFailure && policyFailureAllowsStatelessFreshGeneration(request, uiState, constraints)) return undefined;
  if (policyFailure && policyFailureAllowsTransportContinuation(request, uiState, constraints)) return undefined;
  return runtimeConstraintDiagnosticPayload(request, {
    artifactId: 'runtime-execution-forbidden',
    executionUnitId: 'EU-runtime-execution-forbidden',
    toolId: policyFailure ? CONVERSATION_POLICY_TOOL_ID : TURN_EXECUTION_CONSTRAINTS_TOOL_ID,
    title: policyFailure ? 'Runtime policy unavailable' : 'Runtime execution forbidden',
    message: policyFailure
      ? '当前回合的 conversation policy 未能成功应用；SciForge 已 fail-closed，没有启动新的 runtime、workspace 或 AgentServer 执行。请重试，或提供结构化引用摘要与明确的执行授权。'
      : '当前回合的结构化 turn constraints 禁止新的 runtime 与 workspace 执行；SciForge 已 fail-closed，没有启动新的执行路径。请提供可用引用摘要，或明确允许执行后再继续。',
    limitationText: policyFailure
      ? 'Runtime execution was not started because the current-turn conversation policy failed to apply.'
      : 'Runtime execution was not started because current-turn constraints forbid workspace/code/external execution.',
    nextStep: policyFailure
      ? 'Retry after policy recovery, or provide structured refs/digests with explicit execution authorization.'
      : 'Continue with explicit refs/digests or grant execution permission.',
    constraints,
    policyFailure,
    refs,
    reasons,
  });
}

function constraintsForbidCurrentRuntimeWork(
  request: GatewayRequest,
  uiState: Record<string, unknown>,
  constraints: ReturnType<typeof normalizeTurnExecutionConstraints>,
) {
  if (!constraints) return false;
  if (constraints.workspaceExecutionForbidden !== true
    && constraints.codeExecutionForbidden !== true
    && constraints.externalIoForbidden !== true) return false;
  return Boolean(
    (request.externalIoRequired === true && constraints.externalIoForbidden === true)
      || (request.actionSideEffects ?? []).length
      || toStringList(uiState.actionSideEffects).length
  );
}

function policyFailureAllowsStatelessFreshGeneration(
  request: GatewayRequest,
  uiState: Record<string, unknown>,
  constraints: ReturnType<typeof normalizeTurnExecutionConstraints>,
) {
  if (constraints) return false;
  if ((request.references ?? []).length || request.artifacts.length) return false;
  if ((request.externalIoRequired === true)
    || (request.actionSideEffects ?? []).length
    || toStringList(uiState.actionSideEffects).length) return false;
  if (toRecordList(uiState.currentReferences).length
    || toRecordList(uiState.currentReferenceDigests).length
    || toRecordList(uiState.recentRuns).length
    || toRecordList(uiState.recentConversation).length
    || toRecordList(uiState.recentExecutionRefs).length
    || toRecordList(uiState.recentExecutionUnits).length
    || toRecordList(uiState.executionUnits).length
    || toRecordList(uiState.artifactIndex).length
    || isRecord(uiState.conversationLedger)
    || isRecord(uiState.contextProjection)
    || isRecord(uiState.workspaceKernelProjection)
    || isRecord(uiState.projectSessionMemoryProjection)) return false;
  const contextReusePolicy = isRecord(uiState.contextReusePolicy) ? uiState.contextReusePolicy : {};
  const contextIsolation = isRecord(uiState.contextIsolation) ? uiState.contextIsolation : {};
  const mode = typeof contextReusePolicy.mode === 'string'
    ? contextReusePolicy.mode
    : typeof contextIsolation.mode === 'string'
      ? contextIsolation.mode
      : 'fresh';
  if (mode !== 'fresh' && mode !== 'isolate') return false;
  const sessionMessages = toRecordList(uiState.sessionMessages);
  const nonSeedMessages = sessionMessages.filter((message) => {
    const id = typeof message.id === 'string' ? message.id : '';
    const role = typeof message.role === 'string' ? message.role : '';
    return !id.startsWith('seed') && role !== 'scenario';
  });
  return nonSeedMessages.length <= 1;
}

/**
 * When the Python conversation policy times out or fails, allow the request to proceed
 * (degraded, without policy enrichment) if the UI transport has already classified this
 * as a continuation or repair turn. This prevents fail-closed on policy timeout for
 * continue turns where the transport's contextReusePolicy is a reliable signal.
 *
 * Only fires when: no explicit turn constraints, AND transport mode is 'continue'/'repair',
 * AND historyReuse.allowed is not explicitly false.
 */
function policyFailureAllowsTransportContinuation(
  request: GatewayRequest,
  uiState: Record<string, unknown>,
  constraints: ReturnType<typeof normalizeTurnExecutionConstraints>,
) {
  if (constraints) return false;
  const contextReusePolicy = isRecord(uiState.contextReusePolicy) ? uiState.contextReusePolicy : {};
  const contextIsolation = isRecord(uiState.contextIsolation) ? uiState.contextIsolation : {};
  const mode = typeof contextReusePolicy.mode === 'string'
    ? contextReusePolicy.mode
    : typeof contextIsolation.mode === 'string'
      ? contextIsolation.mode
      : '';
  if (mode !== 'continue' && mode !== 'repair') return false;
  const historyReuse = isRecord(contextReusePolicy.historyReuse) ? contextReusePolicy.historyReuse : {};
  return historyReuse.allowed !== false;
}

function agentServerDispatchForbiddenPayload(request: GatewayRequest): ToolPayload | undefined {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const constraints = normalizeTurnExecutionConstraints(uiState.turnExecutionConstraints);
  if (!constraints?.agentServerForbidden) return undefined;
  const refs = requestContextRefs(request, uiState);
  return runtimeConstraintDiagnosticPayload(request, {
    artifactId: 'agentserver-dispatch-forbidden',
    executionUnitId: 'EU-agentserver-dispatch-forbidden',
    toolId: TURN_EXECUTION_CONSTRAINTS_TOOL_ID,
    title: 'AgentServer dispatch forbidden',
    message: '当前回合禁止 AgentServer 或新的 workspace 执行；SciForge 已按结构化 turn constraints fail-closed，没有启动 AgentServer。请提供可用 refs/digest，或明确允许执行后再继续。',
    limitationText: 'AgentServer dispatch was not started because current-turn constraints forbid it.',
    nextStep: 'Continue with explicit refs/digests or grant execution permission.',
    constraints,
    refs,
    reasons: constraints.reasons,
  });
}

function capabilityProviderUnavailablePayload(request: GatewayRequest): ToolPayload | undefined {
  const preflight = capabilityProviderRoutesForGatewayInvocation(request);
  if (preflight.ok || preflight.requiredCapabilityIds.length === 0) return undefined;
  const publicPreflight = publicCapabilityProviderPreflightResult(preflight);
  const skill = agentServerGenerationSkill(request.skillDomain);
  const blockerSummaries = publicPreflight.blockingRoutes.map((route) => {
    const provider = route.primaryProviderId ? ` via ${route.primaryProviderId}` : '';
    return `${route.capabilityId}${provider}: ${route.status} (${route.reason})`;
  });
  const reason = [
    'Capability provider route preflight blocked AgentServer dispatch because a required provider/tool route is not ready.',
    ...blockerSummaries,
  ].join(' ');
  return repairNeededPayload(request, skill, reason, {
    blocker: 'capability-provider-preflight',
    executionUnitStatus: 'failed-with-reason',
    evidenceRefs: publicPreflight.blockingRoutes.map((route) => route.routeTraceRef),
    agentServerRefs: {
      capabilityProviderPreflight: publicPreflight,
    },
    recoverActions: [
      'Enable or authorize a provider for every required capability, then retry.',
      'Select a different ready provider route for the blocked capability.',
      'Remove the external provider/tool requirement when the task can be answered from existing refs.',
    ],
  });
}

function runtimeConstraintDiagnosticPayload(
  request: GatewayRequest,
  params: {
    artifactId: string;
    executionUnitId: string;
    toolId: string;
    title: string;
    message: string;
    limitationText: string;
    nextStep: string;
    constraints?: ReturnType<typeof normalizeTurnExecutionConstraints>;
    policyFailure?: Record<string, unknown>;
    refs: Array<Record<string, unknown>>;
    reasons: string[];
  },
): ToolPayload {
  return {
    message: params.message,
    confidence: 0.68,
    claimType: 'runtime-diagnostic',
    evidenceLevel: 'runtime',
    reasoningTrace: [
      params.policyFailure ? 'Conversation policy failed; runtime execution failed closed.' : 'Turn execution constraints forbade runtime dispatch.',
      ...params.reasons.map((reason) => `constraint: ${reason}`),
    ].join('\n'),
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'needs-work',
      status: 'needs-human',
    },
    claims: [{
      id: params.artifactId,
      type: 'limitation',
      text: params.limitationText,
      confidence: 0.86,
      evidenceLevel: 'runtime',
      supportingRefs: params.refs.flatMap((ref) => typeof ref.ref === 'string' ? [ref.ref] : []),
      opposingRefs: [],
    }],
    uiManifest: [{
      componentId: 'runtime-diagnostic',
      artifactRef: params.artifactId,
      title: params.title,
      priority: 1,
    }],
    executionUnits: [{
      id: params.executionUnitId,
      tool: params.toolId,
      status: 'needs-human',
      params: JSON.stringify({
        policyId: params.constraints?.policyId,
        reasons: params.reasons,
        policyFailure: params.policyFailure,
      }),
      hash: sha1(JSON.stringify({ constraints: params.constraints, policyFailure: params.policyFailure, reasons: params.reasons })).slice(0, 16),
      recoverActions: [
        'Provide current refs/digests that can satisfy the request without execution.',
        'Or explicitly allow AgentServer/workspace execution for this turn.',
      ],
      nextStep: params.nextStep,
    }],
    artifacts: [{
      id: params.artifactId,
      type: 'runtime-diagnostic',
      producerScenario: request.skillDomain,
      schemaVersion: '1',
      metadata: {
        source: params.policyFailure ? 'conversation-policy-fail-closed' : 'turn-execution-constraints',
        policyId: params.constraints?.policyId,
        agentServerForbidden: params.constraints?.agentServerForbidden === true,
      },
      data: {
        constraints: params.constraints,
        policyFailure: params.policyFailure,
        refs: params.refs,
      },
    }],
    objectReferences: params.refs.flatMap((ref, index) => {
      const stableRef = typeof ref.ref === 'string' ? ref.ref : undefined;
      if (!stableRef) return [];
      return [{
        id: `obj-forbidden-context-${index + 1}`,
        kind: typeof ref.kind === 'string' ? ref.kind : 'reference',
        title: typeof ref.title === 'string' ? ref.title : stableRef,
        ref: stableRef,
        status: 'available',
      }];
    }),
  };
}

function conversationPolicyFailure(uiState: Record<string, unknown>) {
  const policy = isRecord(uiState.conversationPolicy) ? uiState.conversationPolicy : {};
  if (policy.applicationStatus !== 'failed') return undefined;
  return {
    applicationStatus: 'failed',
    policySource: typeof policy.policySource === 'string' ? policy.policySource : undefined,
    error: typeof policy.error === 'string' ? policy.error : 'conversation policy failed',
    stderrDigest: typeof policy.stderrDigest === 'string' ? policy.stderrDigest : undefined,
  };
}

function finalizeGatewayPayload(
  payload: ToolPayload,
  request: GatewayRequest,
  runtimeReplayRecorder: ReturnType<typeof applyRuntimeReplayRecorder>,
  callbacks: WorkspaceRuntimeCallbacks,
): ToolPayload {
  const verifiedPayload = attachIntentFirstVerification(
    attachRuntimeReplayRecorderRefs(payload, runtimeReplayRecorder),
    request,
    { callbacks, runWorkVerify: true },
  );
  return attachResultPresentationContract(verifiedPayload, { request });
}

async function runAgentServerGeneratedTask(
  request: GatewayRequest,
  skill: SkillAvailability,
  skills: SkillAvailability[],
  callbacks: WorkspaceRuntimeCallbacks = {},
  options: { allowSupplement?: boolean } = {},
): Promise<ToolPayload | undefined> {
  return runAgentServerGeneratedTaskFromModule(request, skill, skills, callbacks, {
    agentServerFailurePayloadRefs,
    agentServerGenerationFailureReason,
    attemptPlanRefs,
    coerceWorkspaceTaskPayload,
    failedTaskPayload,
    firstPayloadFailureReason,
    mergeReusableContextArtifactsForDirectPayload,
    payloadHasFailureStatus,
    readConfiguredAgentServerBaseUrl,
    repairNeededPayload,
    requestAgentServerGeneration,
    schemaErrors,
    tryAgentServerRepairAndRerun,
    validateAndNormalizePayload,
    ensureDirectAnswerReportArtifact,
  }, options);
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstFiniteNumber(...values: unknown[]) {
  return values.map(finiteNumber).find((value): value is number => value !== undefined);
}

function executionPromptForWorkspaceSkill(request: GatewayRequest) {
  const currentPrompt = request.uiState && typeof request.uiState.currentPrompt === 'string'
    ? request.uiState.currentPrompt.trim()
    : '';
  return currentPrompt || request.prompt;
}

function artifactNeedsRepair(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return metadata.status === 'repair-needed'
    || metadata.requiresAgentServerGeneration === true
    || data.requiresAgentServerGeneration === true;
}

function normalizeExecutionUnitStatus(value: unknown) {
  const status = String(value || '').trim().toLowerCase();
  if (status === 'completed' || status === 'complete' || status === 'success' || status === 'succeeded') return 'done';
  if (status === 'failure' || status === 'errored' || status === 'error') return 'failed-with-reason';
  if (status === 'needs-repair' || status === 'repair_needed') return 'repair-needed';
  if (status === 'self_healed' || status === 'self-heal') return 'self-healed';
  if (['planned', 'running', 'done', 'failed', 'record-only', 'repair-needed', 'self-healed', 'failed-with-reason', 'needs-human'].includes(status)) return status;
  return 'done';
}

async function tryAgentServerRepairAndRerun(params: {
  request: GatewayRequest;
  skill: SkillAvailability;
  taskId: string;
  taskPrefix: string;
  run: WorkspaceTaskRunResult;
  schemaErrors: string[];
  failureReason: string;
  callbacks?: WorkspaceRuntimeCallbacks;
}): Promise<ToolPayload | undefined> {
  const baseUrl = params.request.agentServerBaseUrl || await readConfiguredAgentServerBaseUrl(params.run.workspace);
  if (!baseUrl || process.env.SCIFORGE_ENABLE_AGENTSERVER_REPAIR === '0') return undefined;
  throwIfRuntimeAborted(params.callbacks);
  const workspace = params.run.workspace;
  const taskPath = join(workspace, params.run.spec.taskRel);
  const beforeCode = await readTextIfExists(taskPath);
  const repairBoundaryBefore = await captureRepairBoundarySnapshot(workspace);
  const priorAttempts = await readTaskAttempts(workspace, params.taskId);
  const maxAttempts = agentServerRepairMaxAttempts();
  const attempt = Math.max(2, priorAttempts.length + 1);
  const parentAttempt = attempt - 1;
  if (attempt > maxAttempts) {
    return terminalAgentServerRepairFailurePayload(params, `AgentServer repair reached the maximum attempt budget (${maxAttempts}) before producing a valid ToolPayload.`);
  }
  emitWorkspaceRuntimeEvent(params.callbacks, repairAttemptStartEvent({
    attempt,
    maxAttempts,
    failureReason: params.failureReason,
  }));
  const repair = await requestAgentServerRepair({
    baseUrl,
    request: params.request,
    skill: params.skill,
    run: params.run,
    schemaErrors: params.schemaErrors,
    failureReason: params.failureReason,
    priorAttempts,
  });
  throwIfRuntimeAborted(params.callbacks);
  const afterCode = await readTextIfExists(taskPath);
  const repairBoundaryAfter = await captureRepairBoundarySnapshot(workspace);
  const repairBoundaryViolation = evaluateRepairBoundarySnapshot(repairBoundaryBefore, repairBoundaryAfter, {
    taskRel: params.run.spec.taskRel,
    allowedPrefixes: [
      params.run.spec.sessionBundleRel ? `${params.run.spec.sessionBundleRel.replace(/\/+$/, '')}/tasks/` : undefined,
      params.run.spec.sessionBundleRel ? `${params.run.spec.sessionBundleRel.replace(/\/+$/, '')}/debug/agentserver/` : undefined,
      params.run.spec.sessionBundleRel ? `${params.run.spec.sessionBundleRel.replace(/\/+$/, '')}/handoffs/` : undefined,
      `${sessionBundleRelForRequest(params.request).replace(/\/+$/, '')}/debug/agentserver/`,
      `${sessionBundleRelForRequest(params.request).replace(/\/+$/, '')}/handoffs/`,
    ].filter((value): value is string => Boolean(value)),
  });
  const diffSummary = repair.ok
    ? summarizeTextChange(beforeCode, afterCode, repair.diffSummary)
    : repair.error;
  const diffRel = `.sciforge/task-diffs/${params.taskId}-attempt-${attempt}.diff.txt`;
  await mkdir(dirname(join(workspace, diffRel)), { recursive: true });
  await writeFile(join(workspace, diffRel), diffSummary || 'AgentServer repair produced no diff summary.');

  if (repairBoundaryViolation) {
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt,
      parentAttempt,
      selfHealReason: params.failureReason,
      patchSummary: [diffSummary, repairBoundaryViolation.reason].filter(Boolean).join('\n\n'),
      diffRef: diffRel,
      status: 'repair-needed',
      codeRef: params.run.spec.taskRel,
      inputRef: params.run.spec.id ? `.sciforge/task-inputs/${params.run.spec.id}.json` : undefined,
      outputRef: params.run.outputRef,
      stdoutRef: params.run.stdoutRef,
      stderrRef: params.run.stderrRef,
      exitCode: params.run.exitCode,
      failureReason: repairBoundaryViolation.reason,
      createdAt: new Date().toISOString(),
    });
    return await repairBoundaryDiagnosticPayload({
      workspace,
      request: params.request,
      skill: params.skill,
      violation: repairBoundaryViolation,
      refs: {
        taskRel: params.run.spec.taskRel,
        outputRel: params.run.outputRef,
        stdoutRel: params.run.stdoutRef,
        stderrRel: params.run.stderrRef,
        blocker: 'repair-boundary',
        agentServerRefs: {
          diffRef: diffRel,
          repairRunId: repair.ok ? repair.runId : undefined,
        },
      },
    });
  }

  if (!repair.ok) {
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt,
      parentAttempt,
      selfHealReason: params.failureReason,
      patchSummary: repair.error,
      diffRef: diffRel,
      status: 'failed-with-reason',
      codeRef: params.run.spec.taskRel,
      inputRef: params.run.spec.id ? `.sciforge/task-inputs/${params.run.spec.id}.json` : undefined,
      outputRef: params.run.outputRef,
      stdoutRef: params.run.stdoutRef,
      stderrRef: params.run.stderrRef,
      failureReason: repair.error,
      createdAt: new Date().toISOString(),
    });
    return terminalAgentServerRepairFailurePayload(params, repair.error);
  }

  if (repairShouldStopForNoCodeChange(beforeCode, afterCode, priorAttempts, params.failureReason)) {
    const failureReason = [
      'Repair no-op: AgentServer repair produced no task code changes; stopping repair reruns to avoid repeating the same failed workspace task.',
      `Previous failure: ${params.failureReason}`,
    ].join(' ');
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt,
      parentAttempt,
      selfHealReason: params.failureReason,
      patchSummary: diffSummary,
      diffRef: diffRel,
      status: 'failed-with-reason',
      codeRef: params.run.spec.taskRel,
      inputRef: params.run.spec.id ? `.sciforge/task-inputs/${params.run.spec.id}.json` : undefined,
      outputRef: params.run.outputRef,
      stdoutRef: params.run.stdoutRef,
      stderrRef: params.run.stderrRef,
      exitCode: params.run.exitCode,
      failureReason,
      createdAt: new Date().toISOString(),
    });
    return terminalAgentServerRepairFailurePayload(params, failureReason);
  }

  const outputRel = `.sciforge/task-results/${params.taskId}-attempt-${attempt}.json`;
  const stdoutRel = `.sciforge/logs/${params.taskId}-attempt-${attempt}.stdout.log`;
  const stderrRel = `.sciforge/logs/${params.taskId}-attempt-${attempt}.stderr.log`;
  const rerun = await runWorkspaceTask(workspace, {
    id: `${params.taskId}-attempt-${attempt}`,
    language: params.run.spec.language,
    entrypoint: params.run.spec.entrypoint,
    entrypointArgs: params.run.spec.entrypointArgs,
    taskRel: params.run.spec.taskRel,
    input: {
      prompt: params.request.prompt,
      attempt,
      parentAttempt,
      skillId: params.skill.id,
      selfHealReason: params.failureReason,
      agentServerRunId: repair.runId,
      artifacts: params.request.artifacts,
      uiStateSummary: params.request.uiState,
      taskProjectHandoff: isRecord(params.request.uiState?.taskProjectHandoff) ? params.request.uiState.taskProjectHandoff : undefined,
      userGuidanceQueue: activeGuidanceQueueForTaskInput(params.request),
      recentExecutionRefs: toRecordList(params.request.uiState?.recentExecutionRefs),
      priorAttempts,
    },
    outputRel,
    stdoutRel,
    stderrRel,
  });
  throwIfRuntimeAborted(params.callbacks);
  emitWorkspaceRuntimeEvent(params.callbacks, repairAttemptResultEvent({
    attempt,
    maxAttempts,
    exitCode: rerun.exitCode,
    stdout: rerun.stdout,
    stderr: rerun.stderr,
  }));

  if (rerun.exitCode !== 0 && !await fileExists(join(workspace, outputRel))) {
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt,
      parentAttempt,
      selfHealReason: params.failureReason,
      patchSummary: diffSummary,
      diffRef: diffRel,
      status: 'failed-with-reason',
      codeRef: params.run.spec.taskRel,
      inputRef: `.sciforge/task-inputs/${params.taskId}-attempt-${attempt}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: rerun.exitCode,
      failureReason: rerun.stderr || 'AgentServer repair rerun failed before writing output.',
      createdAt: new Date().toISOString(),
    });
    if (attempt < maxAttempts) {
      return tryAgentServerRepairAndRerun({
        ...params,
        run: rerun,
        schemaErrors: [],
        failureReason: rerun.stderr || 'AgentServer repair rerun failed before writing output.',
        callbacks: params.callbacks,
      });
    }
    return terminalAgentServerRepairFailurePayload(params, rerun.stderr || 'AgentServer repair rerun failed before writing output.', {
      outputRel,
      stdoutRel,
      stderrRel,
    });
  }

  try {
    const rawPayload = JSON.parse(await readFile(join(workspace, outputRel), 'utf8')) as ToolPayload;
    const boundaryPayload = normalizeWorkspaceTaskPayloadBoundary(rawPayload) as ToolPayload;
    const payload = coerceWorkspaceTaskPayload(boundaryPayload) ?? boundaryPayload;
    const rawErrors = schemaErrors(rawPayload);
    const payloadErrors = schemaErrors(payload);
    const errors = payloadErrors.length ? payloadErrors : [];
    const normalized = errors.length ? undefined : await validateAndNormalizePayload(payload, params.request, params.skill, {
      taskRel: params.run.spec.taskRel,
      outputRel,
      stdoutRel,
      stderrRel,
      runtimeFingerprint: rerun.runtimeFingerprint,
    });
    const evidenceFinding = normalized ? evaluateToolPayloadEvidence(normalized, params.request) : undefined;
    const guidanceFinding = normalized ? evaluateGuidanceAdoption(normalized, params.request) : undefined;
    const workEvidenceSummary = summarizeWorkEvidenceForHandoff(normalized ?? payload);
    const payloadFailureReason = firstPayloadFailureReason(payload, rerun);
    const payloadFailureStatus = payloadHasFailureStatus(payload);
    const evidenceFailureReason = !payloadFailureStatus ? guidanceFinding?.reason ?? evidenceFinding?.reason : undefined;
    const failureReason = payloadFailureReason ?? evidenceFailureReason;
    const shouldRepairExecutionFailure = errors.length === 0 && Boolean(failureReason)
      && (Boolean(evidenceFailureReason) || (rerun.exitCode !== 0 && !payloadFailureStatus));
    const attemptStatus = errors.length
      ? 'repair-needed'
      : shouldRepairExecutionFailure
        ? guidanceFinding?.severity ?? evidenceFinding?.severity ?? 'repair-needed'
        : payloadFailureStatus || rerun.exitCode !== 0
          ? 'failed-with-reason'
          : 'done';
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt,
      parentAttempt,
      selfHealReason: params.failureReason,
      patchSummary: diffSummary,
      diffRef: diffRel,
      status: attemptStatus,
      codeRef: params.run.spec.taskRel,
      inputRef: `.sciforge/task-inputs/${params.taskId}-attempt-${attempt}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: rerun.exitCode,
      schemaErrors: errors,
      workEvidenceSummary,
      failureReason: errors.length ? `AgentServer repair rerun output failed schema validation: ${errors.join('; ')}` : failureReason,
      createdAt: new Date().toISOString(),
    });
    if (payloadFailureStatus && !errors.length && !shouldRepairExecutionFailure) {
      return normalized ?? payload;
    }
    if (errors.length || shouldRepairExecutionFailure || (rerun.exitCode !== 0 && !payloadFailureStatus)) {
      if (attempt < maxAttempts) {
        const nextFailureReason = errors.length
          ? `AgentServer repair rerun output failed schema validation: ${errors.join('; ')}`
          : evidenceFailureReason
            ? evidenceFailureReason
          : failureReason ?? `AgentServer repair rerun exited ${rerun.exitCode}.`;
        return tryAgentServerRepairAndRerun({
          ...params,
          run: rerun,
          schemaErrors: errors,
      failureReason: nextFailureReason,
      callbacks: params.callbacks,
    });
  }
      if (errors.length) {
        return schemaValidationRepairPayload({
          payload,
          sourcePayload: rawPayload,
          errors,
          request: params.request,
          skill: params.skill,
          refs: {
            taskRel: params.run.spec.taskRel,
            outputRel,
            stdoutRel,
            stderrRel,
          },
        });
      }
      return terminalAgentServerRepairFailurePayload(params, failureReason ?? `AgentServer repair rerun exited ${rerun.exitCode}.`, {
        outputRel,
        stdoutRel,
        stderrRel,
      });
    }
    if (!normalized) {
      return undefined;
    }
    const proposal = await maybeWriteSkillPromotionProposal({
      workspacePath: workspace,
      request: params.request,
      skill: params.skill,
      taskId: params.taskId,
      taskRel: params.run.spec.taskRel,
      inputRef: `.sciforge/task-inputs/${params.taskId}-attempt-${attempt}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      payload: normalized,
      selfHealed: true,
      patchSummary: diffSummary,
    });
    return {
      ...normalized,
      reasoningTrace: [
        normalized.reasoningTrace,
        `AgentServer repair run: ${repair.runId || 'unknown'} (attempt ${attempt}/${maxAttempts})`,
        `Self-heal reason: ${params.failureReason}`,
        `Diff ref: ${diffRel}`,
        proposal ? `Skill promotion proposal: .sciforge/skill-proposals/${proposal.id}` : '',
      ].filter(Boolean).join('\n'),
      executionUnits: normalized.executionUnits.map((unit) => isRecord(unit) ? {
        ...unit,
        ...attemptPlanRefs(params.request, params.skill, params.failureReason),
        status: 'self-healed',
        attempt,
        parentAttempt,
        selfHealReason: params.failureReason,
        patchSummary: diffSummary,
        diffRef: diffRel,
        agentServerRunId: repair.runId,
      } : unit),
      logs: [
        ...(normalized.logs ?? []),
        { kind: 'agentserver-repair-diff', ref: diffRel },
      ],
    };
  } catch (error) {
    await appendTaskAttempt(workspace, {
      id: params.taskId,
      prompt: params.request.prompt,
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
      ...attemptPlanRefs(params.request, params.skill, params.failureReason),
      attempt,
      parentAttempt,
      selfHealReason: params.failureReason,
      patchSummary: diffSummary,
      diffRef: diffRel,
      status: 'failed-with-reason',
      codeRef: params.run.spec.taskRel,
      inputRef: `.sciforge/task-inputs/${params.taskId}-attempt-${attempt}.json`,
      outputRef: outputRel,
      stdoutRef: stdoutRel,
      stderrRef: stderrRel,
      exitCode: rerun.exitCode,
      failureReason: `AgentServer repair rerun output could not be parsed: ${errorMessage(error)}`,
      createdAt: new Date().toISOString(),
    });
    if (attempt < maxAttempts) {
      return tryAgentServerRepairAndRerun({
        ...params,
        run: rerun,
        schemaErrors: [],
        failureReason: `AgentServer repair rerun output could not be parsed: ${errorMessage(error)}`,
        callbacks: params.callbacks,
      });
    }
    return terminalAgentServerRepairFailurePayload(params, `AgentServer repair rerun output could not be parsed: ${errorMessage(error)}`, {
      outputRel,
      stdoutRel,
      stderrRel,
    });
  }
}

function terminalAgentServerRepairFailurePayload(
  params: {
    request: GatewayRequest;
    skill: SkillAvailability;
    run: WorkspaceTaskRunResult;
  },
  reason: string,
  refs: Partial<RepairPolicyRefs> = {},
) {
  return repairNeededPayload(params.request, params.skill, reason, {
    taskRel: params.run.spec.taskRel,
    outputRel: params.run.outputRef,
    stdoutRel: params.run.stdoutRef,
    stderrRel: params.run.stderrRef,
    ...refs,
  });
}

export function agentServerRepairMaxAttempts() {
  const value = Number(process.env.SCIFORGE_AGENTSERVER_REPAIR_MAX_ATTEMPTS || 4);
  return Number.isFinite(value) ? Math.max(2, Math.min(50, Math.floor(value))) : 4;
}

export function repairShouldStopForNoCodeChange(
  beforeCode: string,
  afterCode: string,
  priorAttempts: unknown[],
  failureReason: string,
) {
  if (beforeCode !== afterCode) return false;
  void priorAttempts;
  const normalizedFailure = normalizeRepairFailureReason(failureReason);
  if (!normalizedFailure) return false;
  return true;
}

function normalizeRepairFailureReason(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return '';
  return value
    .replace(/-attempt-\d+/g, '-attempt-N')
    .replace(/generated-[a-z]+-[a-f0-9]{12}/g, 'generated-domain-id')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
}

export { requestUsesRepairContext } from './gateway/agentserver-generation-dispatch.js';
