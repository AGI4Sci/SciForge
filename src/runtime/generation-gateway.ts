import type { GatewayRequest, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceRuntimeEvent } from './runtime-types.js';
import { sha1 } from './workspace-task-runner.js';
import { emitWorkspaceRuntimeEvent } from './workspace-runtime-events.js';
import { composeRuntimeUiManifest } from './runtime-ui-manifest.js';
import { cleanUrl, clipForBackendPrompt, errorMessage, excerptAroundFailureLine, extractLikelyErrorLine, generatedTaskArchiveRel, headForBackend, isRecord, isTaskInputRel, readTextIfExists, tailForBackend, toRecordList, toStringList } from './gateway-utils.js';
import { normalizeBackendHandoff } from './workspace-task-input.js';
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
  repairNeededPayload as buildRepairNeededPayload,
} from './gateway/repair-policy.js';
import {
  coerceBackendToolPayload,
  classifyPlainAgentText,
  configureDirectAnswerArtifactContext,
  extractJson,
  toolPayloadFromPlainAgentOutput,
} from './gateway/direct-answer-payload.js';
import { evaluateToolPayloadEvidence } from './gateway/work-evidence-guard.js';
import { createLatencyTelemetry } from './gateway/latency-telemetry.js';
import { attachIntentFirstVerification } from './gateway/intent-first-verification.js';
import { applyRuntimeReplayRecorder, attachRuntimeReplayRecorderRefs } from './gateway/runtime-replay-recorder.js';
import { recordValidationRepairTelemetryForPayload } from './gateway/validation-repair-telemetry-runtime.js';
import { persistFinalGatewayPayloadIfManagedOutputRef } from './gateway/final-payload-persistence.js';
import {
  configurePayloadValidationContext,
  repairNeededPayload,
  schemaErrors,
} from './gateway/payload-validation.js';
import { collectArtifactReferenceContext } from './gateway/artifact-reference-context.js';
import { diagnosticForFailure, sanitizeBackendError } from './gateway/backend-failure-diagnostics.js';
import {
  attemptPlanRefs,
} from './gateway/runtime-routing.js';
import { attachResultPresentationContract } from './gateway/result-presentation-contract.js';
import {
  hydrateGeneratedTaskResponseFromText,
} from './gateway/generated-task-response-text.js';
import { hasRecoverableRecentAttempt } from './gateway/recoverable-attempts.js';
import { tryRunVisionSenseRuntime } from './vision-sense-runtime.js';
import { tryRunPlaywrightEdgeBrowserRuntime } from './playwright-edge-browser-runtime.js';
import { tryRunBrowserComputerUseCapabilityRuntime } from './browser-computer-use-capability-runtime.js';
import { tryRunRequestClarificationRuntime } from './request-clarification-runtime.js';
import { tryRunLocalDataSensitivityRuntime } from './local-data-sensitivity-runtime.js';
import { tryRunLocalTabularAnalysisRuntime } from './local-tabular-analysis-runtime.js';
import { tryRunLocalCodeDebugRuntime } from './local-code-debug-runtime.js';
import { tryRunLocalReproducibleMethodRuntime } from './local-reproducible-method-runtime.js';
import { tryRunLocalMethodologyFinalizerRuntime } from './local-methodology-finalizer-runtime.js';
import { applyConversationPolicy } from './conversation-policy/apply.js';
import { toolPackageManifests } from '../../packages/skills/tool_skills/index.js';
import { agentHandoffSourceMetadata } from '@sciforge-ui/runtime-contract/handoff';
import {
  backendConvergenceGuardEvent,
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
import { directContextFastPathPayload, requestWithDirectContextReadableArtifactData } from './gateway/direct-context-fast-path.js';
import { tryRunArtifactMutationFastPath } from './gateway/artifact-mutation-fast-path.js';
import { tryRunMarkdownReadonlyFastPath } from './gateway/markdown-readonly-fast-path.js';
import { requestContextRefs } from './gateway/request-context-refs.js';
import { tryRunCodexRuntimeGateway } from './codex/codex-runtime-gateway.js';

configureDirectAnswerArtifactContext(collectArtifactReferenceContext);
configurePayloadValidationContext(attemptPlanRefs);

export const STAGE_CONVERSATION_POLICY = 'conversation-policy';
export const STAGE_REQUEST_ENRICHMENT = 'request-enrichment';
export const STAGE_REQUEST_CLARIFICATION_RUNTIME = 'request-clarification-runtime';
export const STAGE_BROWSER_COMPUTER_USE_CAPABILITY_TRUTH = 'browser-computer-use-capability-truth';
export const STAGE_CAPABILITY_PROVIDER_PREFLIGHT = 'capability-provider-preflight';
export const STAGE_DIRECT_CONTEXT_FAST_PATH = 'direct-context-fast-path';
export const STAGE_ARTIFACT_MUTATION_FAST_PATH = 'artifact-mutation-fast-path';
export const STAGE_PLAYWRIGHT_EDGE_BROWSER_RUNTIME = 'playwright-edge-browser-runtime';
export const STAGE_RUNTIME_EXECUTION_CONSTRAINTS = 'runtime-execution-constraints';
export const STAGE_CODEX_RUNTIME_BRIDGE = 'codex-runtime-bridge';
export const STAGE_VISION_SENSE_RUNTIME = 'vision-sense-runtime';
export const STAGE_LOCAL_TABULAR_ANALYSIS_RUNTIME = 'local-tabular-analysis-runtime';
export const STAGE_LOCAL_DATA_SENSITIVITY_RUNTIME = 'local-data-sensitivity-runtime';
export const STAGE_LOCAL_CODE_DEBUG_RUNTIME = 'local-code-debug-runtime';
export const STAGE_LOCAL_REPRODUCIBLE_METHOD_RUNTIME = 'local-reproducible-method-runtime';
export const STAGE_LOCAL_METHODOLOGY_FINALIZER_RUNTIME = 'local-methodology-finalizer-runtime';
export const STAGE_RUNTIME_UNHANDLED = 'runtime-unhandled';

export type GatewayPipelineStageName =
  | typeof STAGE_CONVERSATION_POLICY
  | typeof STAGE_REQUEST_ENRICHMENT
  | typeof STAGE_REQUEST_CLARIFICATION_RUNTIME
  | typeof STAGE_BROWSER_COMPUTER_USE_CAPABILITY_TRUTH
  | typeof STAGE_CAPABILITY_PROVIDER_PREFLIGHT
  | typeof STAGE_DIRECT_CONTEXT_FAST_PATH
  | typeof STAGE_ARTIFACT_MUTATION_FAST_PATH
  | typeof STAGE_PLAYWRIGHT_EDGE_BROWSER_RUNTIME
  | typeof STAGE_RUNTIME_EXECUTION_CONSTRAINTS
  | typeof STAGE_CODEX_RUNTIME_BRIDGE
  | typeof STAGE_VISION_SENSE_RUNTIME
  | typeof STAGE_LOCAL_TABULAR_ANALYSIS_RUNTIME
  | typeof STAGE_LOCAL_DATA_SENSITIVITY_RUNTIME
  | typeof STAGE_LOCAL_CODE_DEBUG_RUNTIME
  | typeof STAGE_LOCAL_REPRODUCIBLE_METHOD_RUNTIME
  | typeof STAGE_LOCAL_METHODOLOGY_FINALIZER_RUNTIME
  | typeof STAGE_RUNTIME_UNHANDLED;

type GatewayPipelineStageResult =
  | { kind: 'continue'; request?: GatewayRequest }
  | { kind: 'short-circuit'; payload: ToolPayload; request?: GatewayRequest };

interface GatewayPipelineContext {
  request: GatewayRequest;
  normalizedRequest: GatewayRequest;
  policyApplication?: Awaited<ReturnType<typeof applyConversationPolicy>>;
  telemetry: ReturnType<typeof createLatencyTelemetry>;
  runtimeReplayRecorder: ReturnType<typeof applyRuntimeReplayRecorder>;
}

export interface GatewayPipelineStage {
  name: GatewayPipelineStageName;
  execute(context: GatewayPipelineContext): Promise<GatewayPipelineStageResult>;
}

export const GATEWAY_PIPELINE_STAGE_ORDER: GatewayPipelineStageName[] = [
  STAGE_CONVERSATION_POLICY,
  STAGE_REQUEST_ENRICHMENT,
  STAGE_REQUEST_CLARIFICATION_RUNTIME,
  STAGE_BROWSER_COMPUTER_USE_CAPABILITY_TRUTH,
  STAGE_CAPABILITY_PROVIDER_PREFLIGHT,
  STAGE_PLAYWRIGHT_EDGE_BROWSER_RUNTIME,
  STAGE_DIRECT_CONTEXT_FAST_PATH,
  STAGE_ARTIFACT_MUTATION_FAST_PATH,
  STAGE_RUNTIME_EXECUTION_CONSTRAINTS,
  STAGE_CODEX_RUNTIME_BRIDGE,
  STAGE_VISION_SENSE_RUNTIME,
  STAGE_LOCAL_CODE_DEBUG_RUNTIME,
  STAGE_LOCAL_METHODOLOGY_FINALIZER_RUNTIME,
  STAGE_LOCAL_TABULAR_ANALYSIS_RUNTIME,
  STAGE_LOCAL_DATA_SENSITIVITY_RUNTIME,
  STAGE_LOCAL_REPRODUCIBLE_METHOD_RUNTIME,
  STAGE_RUNTIME_UNHANDLED,
];

export const GATEWAY_PIPELINE_STAGES: GatewayPipelineStage[] = [
  {
    name: STAGE_CONVERSATION_POLICY,
    async execute(context) {
      emitWorkspaceRuntimeEvent(context.telemetry.callbacks, conversationPolicyStartedEvent());
      const policyApplication = await applyConversationPolicy(
        context.request,
        context.telemetry.callbacks,
        { workspace: context.request.workspacePath },
      );
      context.policyApplication = policyApplication;
      context.telemetry.markPolicyApplication(policyApplication);
      return { kind: 'continue', request: policyApplication.request };
    },
  },
  {
    name: STAGE_REQUEST_ENRICHMENT,
    async execute(context) {
      if (!context.policyApplication) {
        throw new Error('Gateway pipeline request enrichment requires conversation policy stage output.');
      }
      return {
        kind: 'continue',
        request: await requestWithDiscoveredCapabilityProviders(
          await requestWithAgentHarnessShadow(context.request, context.telemetry.callbacks, context.policyApplication),
        ),
      };
    },
  },
  {
    name: STAGE_REQUEST_CLARIFICATION_RUNTIME,
    async execute(context) {
      const payload = tryRunRequestClarificationRuntime(context.request);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_BROWSER_COMPUTER_USE_CAPABILITY_TRUTH,
    async execute(context) {
      const payload = tryRunBrowserComputerUseCapabilityRuntime(context.request);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_CAPABILITY_PROVIDER_PREFLIGHT,
    async execute(context) {
      const payload = capabilityProviderUnavailablePayload(context.request);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_PLAYWRIGHT_EDGE_BROWSER_RUNTIME,
    async execute(context) {
      const payload = await tryRunPlaywrightEdgeBrowserRuntime(context.request, context.telemetry.callbacks);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_DIRECT_CONTEXT_FAST_PATH,
    async execute(context) {
      const uiState = isRecord(context.request.uiState) ? context.request.uiState : {};
      const constraints = normalizeTurnExecutionConstraints(uiState.turnExecutionConstraints);
      if (conversationPolicyFailure(uiState)
        && !policyFailureAllowsStatelessFreshGeneration(context.request, uiState, constraints)
        && !policyFailureAllowsTransportContinuation(context.request, uiState, constraints)) {
        return { kind: 'continue' };
      }
      const markdownReadonlyPayload = await tryRunMarkdownReadonlyFastPath(context.request);
      if (markdownReadonlyPayload) {
        emitWorkspaceRuntimeEvent(context.telemetry.callbacks, directContextFastPathEvent({
          claimType: markdownReadonlyPayload.claimType,
          executionUnitCount: markdownReadonlyPayload.executionUnits.length,
          artifactCount: markdownReadonlyPayload.artifacts.length,
        }));
        return { kind: 'short-circuit', payload: markdownReadonlyPayload };
      }
      const request = await requestWithDirectContextReadableArtifactData(context.request);
      const payload = directContextFastPathPayload(request);
      if (!payload) return { kind: 'continue' };
      emitWorkspaceRuntimeEvent(context.telemetry.callbacks, directContextFastPathEvent({
        claimType: payload.claimType,
        executionUnitCount: payload.executionUnits.length,
        artifactCount: payload.artifacts.length,
      }));
      return { kind: 'short-circuit', payload, request };
    },
  },
  {
    name: STAGE_ARTIFACT_MUTATION_FAST_PATH,
    async execute(context) {
      const payload = await tryRunArtifactMutationFastPath(context.request);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_RUNTIME_EXECUTION_CONSTRAINTS,
    async execute(context) {
      const payload = runtimeExecutionForbiddenPayload(context.request);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_CODEX_RUNTIME_BRIDGE,
    async execute(context) {
      const payload = await tryRunCodexRuntimeGateway(context.request, context.telemetry.callbacks);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_VISION_SENSE_RUNTIME,
    async execute(context) {
      const payload = await tryRunVisionSenseRuntime(context.request, context.telemetry.callbacks);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_LOCAL_CODE_DEBUG_RUNTIME,
    async execute(context) {
      const payload = await tryRunLocalCodeDebugRuntime(context.request, context.telemetry.callbacks);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_LOCAL_METHODOLOGY_FINALIZER_RUNTIME,
    async execute(context) {
      const payload = await tryRunLocalMethodologyFinalizerRuntime(context.request, context.telemetry.callbacks);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_LOCAL_TABULAR_ANALYSIS_RUNTIME,
    async execute(context) {
      const payload = await tryRunLocalTabularAnalysisRuntime(context.request, context.telemetry.callbacks);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_LOCAL_DATA_SENSITIVITY_RUNTIME,
    async execute(context) {
      const payload = await tryRunLocalDataSensitivityRuntime(context.request, context.telemetry.callbacks);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_LOCAL_REPRODUCIBLE_METHOD_RUNTIME,
    async execute(context) {
      const payload = await tryRunLocalReproducibleMethodRuntime(context.request, context.telemetry.callbacks);
      return payload ? { kind: 'short-circuit', payload } : { kind: 'continue' };
    },
  },
  {
    name: STAGE_RUNTIME_UNHANDLED,
    async execute(context) {
      return { kind: 'short-circuit', payload: runtimeUnhandledPayload(context.request) };
    },
  },
];

export async function runWorkspaceRuntimeGateway(body: Record<string, unknown>, callbacks: WorkspaceRuntimeCallbacks = {}): Promise<ToolPayload> {
  const normalizedRequest = normalizeGatewayRequestFromModule(body);
  const runtimeReplayRecorder = applyRuntimeReplayRecorder(callbacks, normalizedRequest);
  const telemetry = createLatencyTelemetry(normalizedRequest, runtimeReplayRecorder.callbacks);
  try {
    emitWorkspaceRuntimeEvent(telemetry.callbacks, gatewayRequestReceivedEvent(normalizedRequest.skillDomain));
    emitGatewayPipelineRegistryAudit(telemetry.callbacks);
    const context: GatewayPipelineContext = {
      request: normalizedRequest,
      normalizedRequest,
      telemetry,
      runtimeReplayRecorder,
    };
    for (let index = 0; index < GATEWAY_PIPELINE_STAGES.length; index += 1) {
      const stage = GATEWAY_PIPELINE_STAGES[index]!;
      const result = await stage.execute(context);
      if (result.request) context.request = result.request;
      emitGatewayPipelineStageAudit(telemetry.callbacks, stage.name, index, result);
      if (result.kind === 'short-circuit') {
        return await verifyAndFinalizeGatewayPayload(result.payload, context.request, runtimeReplayRecorder, telemetry);
      }
    }
    throw new Error('Gateway pipeline completed without producing a payload.');
  } catch (error) {
    telemetry.markFallback(errorMessage(error));
    telemetry.emitFinal();
    throw error;
  } finally {
    await runtimeReplayRecorder.flush?.();
  }
}

async function verifyAndFinalizeGatewayPayload(
  payload: ToolPayload,
  request: GatewayRequest,
  runtimeReplayRecorder: ReturnType<typeof applyRuntimeReplayRecorder>,
  telemetry: ReturnType<typeof createLatencyTelemetry>,
) {
  telemetry.markVerificationStart();
  const verified = await recordValidationRepairTelemetryForPayload(
    await applyRuntimeVerificationPolicy(payload, request),
    request,
  );
  telemetry.markVerificationEnd();
  return await finalizeGatewayPayload(telemetry.emitFinal(verified) ?? verified, request, runtimeReplayRecorder, telemetry.callbacks);
}

function emitGatewayPipelineRegistryAudit(callbacks: WorkspaceRuntimeCallbacks) {
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'gateway-pipeline-registry-audit',
    status: 'registered',
    source: 'workspace-runtime-gateway',
    raw: {
      schemaVersion: 'sciforge.gateway-pipeline-registry-audit.v1',
      stageOrder: [...GATEWAY_PIPELINE_STAGE_ORDER],
      stages: GATEWAY_PIPELINE_STAGES.map((stage, index) => ({ index, name: stage.name })),
    },
  });
}

function emitGatewayPipelineStageAudit(
  callbacks: WorkspaceRuntimeCallbacks,
  stageName: GatewayPipelineStageName,
  index: number,
  result: GatewayPipelineStageResult,
) {
  emitWorkspaceRuntimeEvent(callbacks, {
    type: 'gateway-pipeline-stage-audit',
    status: result.kind === 'short-circuit' ? 'short-circuit' : 'continue',
    source: 'workspace-runtime-gateway',
    raw: {
      schemaVersion: 'sciforge.gateway-pipeline-stage-audit.v1',
      index,
      stage: stageName,
      shortCircuit: result.kind === 'short-circuit',
      payloadSummary: result.kind === 'short-circuit' ? summarizeGatewayPayloadForAudit(result.payload) : undefined,
    },
  });
}

function summarizeGatewayPayloadForAudit(payload: ToolPayload) {
  return {
    message: headForBackend(payload.message, 160),
    claimType: payload.claimType,
    evidenceLevel: payload.evidenceLevel,
    artifactCount: payload.artifacts.length,
    executionUnitCount: payload.executionUnits.length,
    claimCount: payload.claims.length,
    uiManifestCount: payload.uiManifest.length,
    artifactIds: payload.artifacts.map((artifact) => typeof artifact.id === 'string' ? artifact.id : undefined).filter(Boolean).slice(0, 6),
    executionUnitIds: payload.executionUnits.map((unit) => typeof unit.id === 'string' ? unit.id : undefined).filter(Boolean).slice(0, 6),
  };
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
  const mode = typeof contextReusePolicy.mode === 'string' ? contextReusePolicy.mode : 'fresh';
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
 * continue turns where the transport's raw session-state signals show prior work.
 *
 * Only fires when: no explicit turn constraints, AND transport reports prior work,
 * AND historyReuse.allowed is not explicitly false.
 */
function policyFailureAllowsTransportContinuation(
  request: GatewayRequest,
  uiState: Record<string, unknown>,
  constraints: ReturnType<typeof normalizeTurnExecutionConstraints>,
) {
  if (constraints) return false;
  const contextReusePolicy = isRecord(uiState.contextReusePolicy) ? uiState.contextReusePolicy : {};
  const historyReuse = isRecord(contextReusePolicy.historyReuse) ? contextReusePolicy.historyReuse : {};
  const priorWorkSignals = isRecord(contextReusePolicy.priorWorkSignals) ? contextReusePolicy.priorWorkSignals : {};
  const priorCount = numericSignal(priorWorkSignals.nonSeedMessageCount)
    + numericSignal(priorWorkSignals.runCount)
    + numericSignal(priorWorkSignals.artifactCount)
    + numericSignal(priorWorkSignals.executionUnitCount);
  return historyReuse.allowed !== false && priorCount > 0;
}

function numericSignal(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function capabilityProviderUnavailablePayload(request: GatewayRequest): ToolPayload | undefined {
  const preflight = capabilityProviderRoutesForGatewayInvocation(request);
  if (preflight.ok || preflight.requiredCapabilityIds.length === 0) return undefined;
  const publicPreflight = publicCapabilityProviderPreflightResult(preflight);
  const blockerSummaries = publicPreflight.blockingRoutes.map((route) => {
    const provider = route.primaryProviderId ? ` via ${route.primaryProviderId}` : '';
    return `${route.capabilityId}${provider}: ${route.status} (${route.reason})`;
  });
  const reason = [
    'Capability provider route preflight blocked runtime dispatch because a required provider/tool route is not ready.',
    ...blockerSummaries,
  ].join(' ');
  return runtimeConstraintDiagnosticPayload(request, {
    artifactId: 'capability-provider-preflight',
    executionUnitId: 'EU-capability-provider-preflight',
    toolId: 'sciforge.capability-provider-preflight',
    title: 'Capability provider preflight blocked',
    message: reason,
    limitationText: 'Runtime dispatch was not started because a required capability provider route is unavailable.',
    nextStep: 'Enable or authorize the required provider route, select a ready route, or continue from existing refs.',
    refs: publicPreflight.blockingRoutes.map((route) => ({
      kind: 'capability-route',
      title: route.capabilityId,
      ref: route.routeTraceRef,
    })),
    reasons: blockerSummaries,
  });
}

function runtimeUnhandledPayload(request: GatewayRequest): ToolPayload {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const refs = requestContextRefs(request, uiState);
  return runtimeConstraintDiagnosticPayload(request, {
    artifactId: 'runtime-unhandled',
    executionUnitId: 'EU-runtime-unhandled',
    toolId: 'sciforge.runtime-codex',
    title: 'Runtime request not handled',
    message: '当前请求没有被 Runtime Codex 或本地 deterministic runtime 接住；SciForge 已 fail-closed，没有回落到旧 AgentServer generation。请提供可用 refs/digest，或把任务改写为 Browser、Computer Use、文件分析、代码修复等已迁移能力。',
    limitationText: 'No active Runtime Codex/local runtime accepted the request, and legacy AgentServer generation fallback is retired.',
    nextStep: 'Continue with explicit refs/digests, or route the task through a migrated Runtime Codex capability.',
    refs,
    reasons: ['Runtime Codex/local runtimes did not accept the request; legacy AgentServer generation fallback is retired.'],
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
        'Or route the request through a migrated Runtime Codex/local runtime capability.',
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

async function finalizeGatewayPayload(
  payload: ToolPayload,
  request: GatewayRequest,
  runtimeReplayRecorder: ReturnType<typeof applyRuntimeReplayRecorder>,
  callbacks: WorkspaceRuntimeCallbacks,
): Promise<ToolPayload> {
  const verifiedPayload = attachIntentFirstVerification(
    attachRuntimeReplayRecorderRefs(payload, runtimeReplayRecorder),
    request,
    { callbacks, runWorkVerify: true },
  );
  const finalPayload = attachResultPresentationContract(verifiedPayload, { request });
  await persistFinalGatewayPayloadIfManagedOutputRef(finalPayload, request);
  return finalPayload;
}
