import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceRuntimeEvent } from '../runtime-types.js';
import { readRecentTaskAttempts } from '../task-attempt-history.js';
import { sha1 } from '../workspace-task-runner.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { cleanUrl, errorMessage, headForBackend, isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import { normalizeBackendHandoff } from '../workspace-task-input.js';
import { sessionBundleRelForRequest } from '../session-bundle.js';
import { expectedArtifactTypesForRequest, selectedComponentIdsForRequest } from './gateway-request.js';
import { agentHarnessMetadata, requestWithoutInlineAgentHarness } from './agent-harness-shadow.js';
import { buildContextEnvelope, expectedArtifactSchema, summarizeTaskAttemptsForAgentServer, workspaceTreeSummary } from './context-envelope.js';
import { normalizeBackendWorkspaceEvent as normalizeBackendWorkspaceEventFromModule, withRequestContextWindowLimit as withRequestContextWindowLimitFromModule } from './workspace-event-normalizer.js';
import { backendAgentId, backendContextPolicy, contextCompactionMetadata, contextWindowMetadata, estimateWorkspaceContextWindowState, fetchBackendContextSnapshot, currentTurnReferences, handoffBudgetDecisionRecords, handoffContextWindowState, preflightBackendContextWindow, requestNeedsBackendContinuity } from './backend-context-window.js';
import { backendSelectionDecisionForRequest } from './agent-backend-config.js';
import { classifyPlainAgentText, toolPayloadFromPlainAgentOutput } from './direct-answer-payload.js';
import { backendLlmRuntime, AGENT_BACKEND_ANSWER_PRINCIPLE, buildBackendCompactContext, buildBackendGenerationPrompt, contextEnvelopeMode, missingUserLlmEndpointMessage, requiresUserLlmEndpoint, summarizeRuntimeCapabilitiesForBackend, summarizeToolsForBackend, writeBackendDebugArtifact } from './backend-prompt-policy.js';
import { backendRequestFailureMessage, backendRunFailure, extractBackendOutputText, looksLikeTruncatedBackendResponseText, looksLikeUnparsedGenerationResponseText, parseGenerationResponse, parseToolPayloadResponse } from './backend-run-output.js';
import { diagnosticForFailure, sanitizeBackendError } from './backend-failure-diagnostics.js';
import { finalizeBackendGenerationSuccess, recoverOrReturnBackendGenerationFailure, type BackendGenerationFailureDiagnostics, type BackendGenerationResult } from './generated-task-recovery.js';
import { isBackendRepairContinuationBoundedStopError, backendGenerationTokenGuardLimit, backendSilentStreamGuardAudit, currentReferenceDigestSilentGuardPolicy, dedupeWorkEvidence, mergeBackendStreamWorkEvidence, readBackendRunStream, silentStreamDecisionFromGatewayRequest } from './backend-run-stream.js';
import { collectWorkEvidenceFromBackendEvent, type WorkEvidence } from './work-evidence-types.js';
import {
  captureGeneratedTaskWorkspaceSideEffectSnapshot,
  workEvidenceFromGeneratedTaskWorkspaceSideEffects,
  type GeneratedTaskWorkspaceSideEffectSnapshot,
} from './generated-task-workspace-side-effects.js';
import { hydrateGeneratedTaskResponseFromText } from './generated-task-response-text.js';
import { repairNeededPayload } from './payload-validation.js';
import { requestContextRefs } from './request-context-refs.js';
import { GENERATED_TASK_RETRY_EVENT_TYPE } from '../../../packages/skills/runtime-policy.js';
import { agentHandoffSourceMetadata } from '@sciforge-ui/runtime-contract/handoff';
import { backendConvergenceGuardEvent, backendDispatchEvent, backendSilentStreamGuardEvent } from '@sciforge-ui/runtime-contract/events';
import { backendHandoffDriftEvent, classifyBackendHandoffDrift } from '@sciforge-ui/runtime-contract/backend-handoff-drift';
import { DEFAULT_BACKEND_GENERATION_ADAPTER_MODE, backendAdapterForGenerationAdapter, createInlineBackendGenerationAdapter, type BackendGenerationAdapter, type BackendGenerationAdapterResult } from './backend-generation-adapter.js';
import { createTurnPipeline, createWorkspaceKernel } from '../conversation-kernel/index.js';
import { capabilityDiscoveryBackendToolTransportBrief, type CapabilityDiscoveryToolResultEvent } from './capability-discovery-tool-transport.js';

function requestHandoffSource(request: GatewayRequest) {
  return request.handoffSource ?? 'cli';
}

export function requestUsesRepairContext(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const contextReusePolicy = isRecord(uiState.contextReusePolicy) ? uiState.contextReusePolicy : {};
  const priorWorkSignals = isRecord(contextReusePolicy.priorWorkSignals) ? contextReusePolicy.priorWorkSignals : {};
  const structuredRecoverActionAvailable = currentRecoverActionReferenceAvailable(request, uiState);
  const currentProjectionRepairAvailable = contextReusePolicy.mode === 'repair'
    && (priorWorkSignals.repairTargetAvailable === true || structuredRecoverActionAvailable);
  if (currentProjectionRepairAvailable || structuredRecoverActionAvailable) {
    return requestHasRepairContinuationTarget(request);
  }
  return false;
}

const REPAIR_TARGET_STATUSES = new Set(['failed', 'error', 'repair-needed', 'failed-with-reason', 'needs-human']);

function requestHasRepairContinuationTarget(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const records = [
    ...toRecordList(uiState.recentExecutionRefs),
    ...toRecordList(uiState.recentRuns),
    ...toRecordList(uiState.recentExecutionUnits),
    ...toRecordList(uiState.executionUnits),
    ...toRecordList(isRecord(uiState.workspaceKernelProjection) ? uiState.workspaceKernelProjection.executionUnits : undefined),
    ...toRecordList(isRecord(uiState.workspaceKernelProjection) ? uiState.workspaceKernelProjection.runs : undefined),
    isRecord(uiState.activeRun) ? uiState.activeRun : undefined,
    isRecord(uiState.currentRun) ? uiState.currentRun : undefined,
  ].filter((record): record is Record<string, unknown> => Boolean(record));
  return records.some(isRepairTargetRecord);
}

function currentRecoverActionReferenceAvailable(request: GatewayRequest, uiState: Record<string, unknown>) {
  return [
    ...toRecordList(request.references),
    ...toRecordList(uiState.currentReferences),
    ...toRecordList(uiState.currentReferenceDigests),
  ].some((record) => {
    const source = typeof record.source === 'string'
      ? record.source.trim().toLowerCase()
      : typeof record.sourceId === 'string'
        ? record.sourceId.trim().toLowerCase()
        : '';
    const kind = typeof record.kind === 'string' ? record.kind.trim().toLowerCase() : '';
    const status = typeof record.status === 'string' ? record.status.trim().toLowerCase() : '';
    return source === 'recover-action'
      || source === 'failure-evidence'
      || kind === 'recover-action'
      || REPAIR_TARGET_STATUSES.has(status);
  });
}

function isRepairTargetRecord(record: Record<string, unknown>) {
  const status = typeof record.status === 'string' ? record.status.trim().toLowerCase() : '';
  if (REPAIR_TARGET_STATUSES.has(status)) return true;
  return Boolean(
    typeof record.failureReason === 'string' && record.failureReason.trim()
      || typeof record.stderrRef === 'string' && record.stderrRef.trim()
      || typeof record.errorRef === 'string' && record.errorRef.trim(),
  );
}

export type BackendGenerationParams = {
  baseUrl: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  skills: SkillAvailability[];
  workspace: string;
  callbacks?: WorkspaceRuntimeCallbacks;
  strictTaskFilesReason?: string;
};

export async function requestBackendGeneration(params: BackendGenerationParams): Promise<BackendGenerationResult> {
  let adapter: BackendGenerationAdapter | undefined;
  adapter = createInlineBackendGenerationAdapter((adapterParams) => dispatchBackendGeneration(adapterParams, requireBackendGenerationAdapter(adapter)), {
    mode: DEFAULT_BACKEND_GENERATION_ADAPTER_MODE,
  });
  return executeBackendGenerationTurnPipeline({ adapter, params });
}

async function executeBackendGenerationTurnPipeline(input: {
  adapter: BackendGenerationAdapter;
  params: BackendGenerationParams;
}): Promise<BackendGenerationResult> {
  let driveResult: BackendGenerationAdapterResult | undefined;
  const turn = backendGenerationTurnPipelineInput(input.params);
  const pipeline = createTurnPipeline({
    kernel: createWorkspaceKernel({ sessionId: `backend-generation-${turn.key}` }),
    hooks: {
      requestContext: () => {
        emitWorkspaceRuntimeEvent(input.params.callbacks, backendGenerationTurnPipelineStageEvent('requestContext', input.adapter, turn));
        return {
          contextRef: `backend-generation://context/${turn.key}`,
          contextRefs: [
            `backend-generation://adapter/${input.adapter.mode}`,
            `backend-generation://backend-boundary/${input.adapter.backendBoundary}`,
            `backend-generation://context/${turn.key}`,
          ],
        };
      },
      driveRun: async () => {
        emitWorkspaceRuntimeEvent(input.params.callbacks, backendGenerationTurnPipelineStageEvent('driveRun', input.adapter, turn));
        driveResult = await input.adapter.generateTask(input.params);
        if (!driveResult.ok) {
          return {
            status: 'failed',
            resultRefs: [],
            failure: {
              failureClass: 'external' as const,
              owner: 'external-provider' as const,
              reason: driveResult.error,
            },
          };
        }
        return {
          status: 'succeeded',
          resultRefs: backendGenerationResultRefs(driveResult, turn.key),
        };
      },
      finalizeRun: (stageInput) => {
        emitWorkspaceRuntimeEvent(input.params.callbacks, backendGenerationTurnPipelineStageEvent('finalizeRun', input.adapter, turn));
        return {
          status: 'satisfied',
          text: 'Backend generation completed through declarative TurnPipeline.',
          artifactRefs: stageInput.resultRefs,
        };
      },
      onFailure: (failure) => ({
        status: 'repair-needed',
        text: failure.reason,
        artifactRefs: failure.evidenceRefs,
      }),
    },
  });
  emitWorkspaceRuntimeEvent(input.params.callbacks, backendGenerationTurnPipelineStageEvent('registerTurn', input.adapter, turn));
  await pipeline.execute({
    turnId: turn.turnId,
    runId: turn.runId,
    currentTurnRef: turn.currentTurnRef,
    summary: 'Backend generation request registered.',
  });
  return finalizeBackendGenerationAdapterResult(driveResult);
}

function finalizeBackendGenerationAdapterResult(
  result: BackendGenerationAdapterResult | undefined,
): BackendGenerationResult {
  if (!result) return { ok: false, error: 'Backend generation TurnPipeline finished without driveRun result' };
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      diagnostics: result.diagnostics as BackendGenerationFailureDiagnostics | undefined,
    };
  }
  if ('response' in result) return { ok: true, runId: result.runId, response: result.response };
  return { ok: true, runId: result.runId, directPayload: result.directPayload as ToolPayload };
}

function backendGenerationTurnPipelineStageEvent(
  stage: 'registerTurn' | 'requestContext' | 'driveRun' | 'finalizeRun',
  adapter: BackendGenerationAdapter,
  turn: ReturnType<typeof backendGenerationTurnPipelineInput>,
): WorkspaceRuntimeEvent {
  return {
    type: 'backend-generation-turn-pipeline-stage',
    source: 'workspace-runtime',
    status: stage,
    message: `Backend generation TurnPipeline stage: ${stage}`,
    raw: {
      schemaVersion: 'sciforge.turn-pipeline-stage.v1',
      stage,
      adapterMode: adapter.mode,
      backendBoundary: adapter.backendBoundary,
      decisionOwner: adapter.decisionOwner,
      turnId: turn.turnId,
      runId: turn.runId,
      currentTurnRef: turn.currentTurnRef,
    },
  };
}

function backendGenerationTurnPipelineInput(params: BackendGenerationParams) {
  const uiState = isRecord(params.request.uiState) ? params.request.uiState : {};
  const sessionId = typeof uiState.sessionId === 'string' && uiState.sessionId.trim()
    ? uiState.sessionId.trim()
    : sha1(JSON.stringify({
      workspace: params.workspace,
      baseUrl: cleanUrl(params.baseUrl),
      skillDomain: params.request.skillDomain,
      skillId: params.skill.id,
    })).slice(0, 16);
  const key = sessionId.replace(/[^a-zA-Z0-9._-]/g, '-').slice(0, 80) || 'default';
  return {
    key,
    turnId: `turn-${key}`,
    runId: `run-${key}`,
    currentTurnRef: `runtime://backend-generation/current-turn/${key}`,
  };
}

function backendGenerationResultRefs(result: BackendGenerationAdapterResult, key: string): string[] {
  if (!result.ok) return [];
  return [
    result.runId ? `backend-generation://run/${result.runId}` : undefined,
    'response' in result
      ? `backend-generation://response/${key}`
      : `backend-generation://direct-payload/${key}`,
  ].filter((ref): ref is string => Boolean(ref));
}

function requireBackendGenerationAdapter(adapter: BackendGenerationAdapter | undefined): BackendGenerationAdapter {
  if (!adapter) throw new Error('BackendGenerationAdapter was not initialized before generation dispatch.');
  return adapter;
}

async function dispatchBackendGeneration(params: BackendGenerationParams, generationAdapter: BackendGenerationAdapter): Promise<BackendGenerationResult> {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.SCIFORGE_AGENTSERVER_GENERATION_TIMEOUT_MS || 900000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortGeneration = () => controller.abort();
  params.callbacks?.signal?.addEventListener('abort', abortGeneration, { once: true });
  if (params.callbacks?.signal?.aborted) controller.abort();
  let runPayload: unknown;
  let contextRecovery: BackendGenerationFailureDiagnostics | undefined;
  let strictTaskFilesReason = params.strictTaskFilesReason;
  let partialStreamWorkEvidence: WorkEvidence[] = [];
  let sideEffectSnapshot: GeneratedTaskWorkspaceSideEffectSnapshot | undefined;
  let capabilityDiscoveryToolResultsForRetry: CapabilityDiscoveryToolResultEvent[] = [];
  try {
    const request = params.request;
    const promptRequest = requestWithoutInlineAgentHarness(request);
    const { llmEndpointSource, ...llmRuntime } = await backendLlmRuntime(request, params.workspace);
    const backendSelectionDecision = backendSelectionDecisionForRequest(request, llmRuntime.llmEndpoint);
    const backend = backendSelectionDecision.backend;
    const needsContinuity = requestNeedsBackendContinuity(promptRequest);
    const repairContinuation = requestUsesRepairContext(promptRequest);
    const generationPurpose = needsContinuity ? 'workspace-task-generation' : 'workspace-task-generation-inline';
    if (!llmRuntime.llmEndpoint && requiresUserLlmEndpoint(params.baseUrl)) {
      return { ok: false, error: missingUserLlmEndpointMessage() };
    }
    const adapter = backendAdapterForGenerationAdapter(generationAdapter, backend);
    const agentId = backendAgentId(promptRequest, 'task-generation');
    for (let dispatchAttempt = 1; dispatchAttempt <= 2; dispatchAttempt += 1) {
    const preflight = await preflightBackendContextWindow({
      adapter,
      baseUrl: params.baseUrl,
      workspace: params.workspace,
      agentId,
      callbacks: params.callbacks,
    });
    const workspaceTree = await workspaceTreeSummary(params.workspace);
    const recentAttempts = await readRecentTaskAttempts(params.workspace, promptRequest.skillDomain, 8, {
        scenarioPackageId: promptRequest.scenarioPackageRef?.id,
        skillPlanRef: promptRequest.skillPlanRef,
        prompt: promptRequest.prompt,
      });
    const attachPriorAttempts = needsContinuity || repairContinuation;
    const priorAttempts = currentTurnReferences(promptRequest).length || !attachPriorAttempts
      ? []
      : summarizeTaskAttemptsForAgentServer(recentAttempts);
    const agentServerSnapshot = preflight.state?.snapshot ?? await fetchBackendContextSnapshot(params.baseUrl, agentId);
    const contextMode = contextEnvelopeMode(promptRequest, {
      agentServerCoreAvailable: Boolean(agentServerSnapshot),
      forceSlimHandoff: preflight.forceSlimHandoff || Boolean(contextRecovery),
    });
    const contextEnvelope: Record<string, unknown> = buildContextEnvelope(promptRequest, {
      workspace: params.workspace,
      workspaceTreeSummary: workspaceTree,
      priorAttempts,
      selectedSkill: params.skill,
      mode: contextMode,
      agentId,
      agentServerCoreSnapshotAvailable: Boolean(agentServerSnapshot),
    });
    if (agentServerSnapshot) {
      contextEnvelope.agentServerCoreSnapshot = agentServerSnapshot;
    }
    if (contextRecovery?.retryAudit) {
      contextEnvelope.backendRetryAudit = contextRecovery.retryAudit;
      contextEnvelope.retryReason = 'Previous backend generation attempt hit provider/rate-limit or retry-budget pressure; this is the only compact retry.';
    }
    if (capabilityDiscoveryToolResultsForRetry.length) {
      contextEnvelope.capabilityDiscoveryToolResults = compactCapabilityDiscoveryToolResults(capabilityDiscoveryToolResultsForRetry);
    }
    const compactContext = buildBackendCompactContext(promptRequest, {
      contextEnvelope,
      workspaceTree,
      priorAttempts,
      mode: contextMode,
    });
    const generationRequest = {
      prompt: promptRequest.prompt,
      skillDomain: promptRequest.skillDomain,
      contextEnvelope,
      workspaceTreeSummary: compactContext.workspaceTreeSummary,
      availableSkills: [],
      availableTools: summarizeToolsForBackend(promptRequest),
      availableRuntimeCapabilities: summarizeRuntimeCapabilitiesForBackend(promptRequest),
      artifactSchema: expectedArtifactSchema(promptRequest),
      uiManifestContract: {
        type: 'array',
        slotType: 'object',
        requiredKeys: ['componentId'],
        optionalKeys: ['artifactRef', 'encoding', 'layout', 'compare', 'title', 'priority'],
        contentRule: 'Do not put result rows/items/content in uiManifest; put them in artifacts[].data or artifacts[].dataRef.',
      },
      uiStateSummary: compactContext.uiStateSummary,
      artifacts: compactContext.artifacts,
      recentExecutionRefs: compactContext.recentExecutionRefs,
      expectedArtifactTypes: expectedArtifactTypesForRequest(promptRequest),
      selectedComponentIds: selectedComponentIdsForGenerationRequest(promptRequest),
      priorAttempts: compactContext.priorAttempts,
      strictTaskFilesReason,
      retryAudit: contextRecovery?.retryAudit,
      capabilityDiscoveryToolResults: compactCapabilityDiscoveryToolResults(capabilityDiscoveryToolResultsForRetry),
      freshCurrentTurn: !needsContinuity,
      repairContinuation,
    };
    const generationPrompt = buildBackendGenerationPrompt(generationRequest);
    const compactDiscoveryToolResults = compactCapabilityDiscoveryToolResults(capabilityDiscoveryToolResultsForRetry);
    const contextEnvelopeBytes = Buffer.byteLength(JSON.stringify(contextEnvelope), 'utf8');
    const harnessMetadata = agentHarnessMetadata(request, {
      backendSelectionDecision,
      llmEndpoint: llmRuntime.llmEndpoint,
      startupContextEnvelope: contextEnvelope.startupContextEnvelope as Record<string, unknown> | undefined,
    });
    const harnessRefMetadata = agentHarnessRefMetadata(harnessMetadata);
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'contextWindowState',
      source: 'workspace-runtime',
      message: 'Estimated context window before backend dispatch',
      contextWindowState: estimateWorkspaceContextWindowState({
        backend,
        modelName: llmRuntime.llmEndpoint?.modelName ?? request.modelName,
        maxContextWindowTokens: request.maxContextWindowTokens,
        usedTokens: Math.ceil((contextEnvelopeBytes + generationPrompt.length) / 4),
        source: 'estimate',
      }),
    });
    runPayload = {
      agent: {
        id: agentId,
        name: `SciForge ${request.skillDomain} Task Generation`,
        backend,
        workspace: params.workspace,
        workingDirectory: params.workspace,
        reconcileExisting: needsContinuity,
        systemPrompt: [
          AGENT_BACKEND_ANSWER_PRINCIPLE,
          'You generate SciForge workspace-local task code.',
          repairContinuation
            ? 'Repair-continuation hard rule: complete exactly one minimal repair/continue step from supplied refs, then stop with final compact JSON. Do not inspect broad history, do not regenerate the full pipeline, and return a failed-with-reason ToolPayload when refs are insufficient.'
            : !needsContinuity
            ? 'Fresh-generation hard rule: do not call shell/filesystem/browser tools to inspect the workspace, .sciforge, old task attempts, logs, artifacts, installed packages, or prior generated code before returning. If the user task needs network, downloads, PDF/full-text reading, computation, or file creation, generate a bounded runnable task that performs that work at execution time. Your first substantive assistant output must be the final compact JSON for a direct ToolPayload or a runnable GeneratedTaskResponse.'
            : 'Continuity-generation mode: treat visible summaries and current refs as authoritative. Inspect only explicitly supplied refs needed for the user-requested continuation, never scan broad .sciforge/session history or workspace trees, and return a compact direct ToolPayload when the supplied summary is sufficient.',
          'Transport budget hard rule: keep terminal JSON compact; for multi-artifact reports or long markdown/data, return executable taskFiles that write files beside outputPath and cite artifact refs instead of inlining large artifact bodies.',
          'Write task files that accept inputPath and outputPath argv values and write a SciForge ToolPayload JSON object.',
          'For current-reference document requests, use uiStateSummary.currentReferenceDigests/contextEnvelope.sessionFacts.currentReferenceDigests first; do not spend generation-stage tool calls dumping long files into model context.',
          'For fresh current-turn requests, do not browse old .sciforge task attempts, logs, artifacts, or generated tasks for diagnostics; generate the requested runnable task or direct ToolPayload from the current turn.',
          'Do not create demo/default success artifacts; if the real task cannot be generated, explain the missing condition.',
        ].join(' '),
      },
      input: {
        text: generationPrompt,
        metadata: {
          project: 'SciForge',
          purpose: generationPurpose,
          skillDomain: request.skillDomain,
          skillId: params.skill.id,
          expectedArtifactTypes: generationRequest.expectedArtifactTypes,
          selectedComponentIds: generationRequest.selectedComponentIds,
          priorAttemptCount: generationRequest.priorAttempts.length,
          repairContinuation,
          contextEnvelopeVersion: 'sciforge.context-envelope.v1',
          contextMode: compactContext.mode,
          retryAudit: contextRecovery?.retryAudit,
          contextEnvelopeBytes,
          promptChars: generationPrompt.length,
          maxContextWindowTokens: request.maxContextWindowTokens,
          contextWindowLimit: request.maxContextWindowTokens,
          modelContextWindow: request.maxContextWindowTokens,
          workspaceTreeEntryCount: workspaceTree.length,
          contextWindow: preflight.state ? contextWindowMetadata(preflight.state) : undefined,
          contextCompaction: preflight.compaction ? contextCompactionMetadata(preflight.compaction) : undefined,
          backendCapabilities: adapter.capabilities,
          capabilityDiscoveryToolTransport: capabilityDiscoveryBackendToolTransportBrief(),
          capabilityDiscoveryToolResults: compactDiscoveryToolResults,
          ...harnessMetadata,
        },
      },
      contextPolicy: backendContextPolicy(promptRequest),
      runtime: {
        backend,
        cwd: params.workspace,
        ...llmRuntime,
        metadata: {
          autoApprove: true,
          sandbox: 'danger-full-access',
          ...agentHandoffSourceMetadata(requestHandoffSource(request)),
          source: 'sciforge-workspace-runtime-gateway',
          purpose: 'workspace-task-generation',
          maxContextWindowTokens: request.maxContextWindowTokens,
          contextWindowLimit: request.maxContextWindowTokens,
          modelContextWindow: request.maxContextWindowTokens,
          requiresNativeWorkspaceCapabilities: needsContinuity,
          nativeToolFirst: needsContinuity,
          llmEndpointSource: llmRuntime.llmEndpoint ? llmEndpointSource : undefined,
          capabilityDiscoveryToolTransport: capabilityDiscoveryBackendToolTransportBrief(),
          capabilityDiscoveryToolResults: compactDiscoveryToolResults,
          retryAudit: contextRecovery?.retryAudit,
          toolPolicy: repairContinuation ? {
            mode: 'repair-continuation-minimal',
            inspectOnlyReferencedWorkspaceRefs: true,
            maxStages: 1,
            failedWithReasonOnInsufficientRefs: true,
          } : needsContinuity ? {
            mode: 'continuity-read-limited',
            inspectOnlyReferencedWorkspaceRefs: true,
          } : {
            mode: 'fresh-generation-no-native-inspection',
            generateRunnableTaskForExternalWork: true,
            finalJsonFirst: true,
          },
          ...harnessRefMetadata,
        },
      },
      metadata: {
        project: 'SciForge',
        ...agentHandoffSourceMetadata(requestHandoffSource(request)),
        source: 'workspace-runtime-gateway',
        task: 'generation',
        purpose: generationPurpose,
        workspace: params.workspace,
        workingDirectory: params.workspace,
        maxContextWindowTokens: request.maxContextWindowTokens,
        contextWindowLimit: request.maxContextWindowTokens,
        modelContextWindow: request.maxContextWindowTokens,
        orchestrator: {
          mode: 'multi_stage',
          planKind: 'implement-only',
          failureStrategy: 'retry_stage',
          maxRetries: 1,
        },
        retryAudit: contextRecovery?.retryAudit,
        capabilityDiscoveryToolResults: compactDiscoveryToolResults,
        repairContinuation,
        toolPolicy: repairContinuation ? {
          mode: 'repair-continuation-minimal',
          inspectOnlyReferencedWorkspaceRefs: true,
          maxStages: 1,
          failedWithReasonOnInsufficientRefs: true,
        } : needsContinuity ? {
          mode: 'continuity-read-limited',
          inspectOnlyReferencedWorkspaceRefs: true,
        } : {
          mode: 'fresh-generation-no-native-inspection',
          generateRunnableTaskForExternalWork: true,
          finalJsonFirst: true,
        },
        ...harnessRefMetadata,
      },
    };
    const normalizedHandoff = await normalizeBackendHandoff(runPayload, {
      workspacePath: params.workspace,
      purpose: contextRecovery ? 'backend-generation-rate-limit-retry' : 'backend-generation',
      sessionBundleRel: sessionBundleRelForRequest(request),
      budget: contextRecovery ? {
        maxPayloadBytes: 96_000,
        maxInlineStringChars: 6_000,
        maxInlineJsonBytes: 18_000,
        maxArrayItems: 10,
        maxObjectKeys: 48,
        maxDepth: 5,
        headChars: 1_200,
        tailChars: 1_200,
        maxPriorAttempts: 1,
      } : !needsContinuity ? {
        maxPayloadBytes: 96_000,
        maxInlineStringChars: 12_000,
        maxInlineJsonBytes: 24_000,
        maxArrayItems: 12,
        maxObjectKeys: 64,
        maxDepth: 5,
        headChars: 2_000,
        tailChars: 2_000,
        maxPriorAttempts: 0,
      } : repairContinuation ? {
        maxPayloadBytes: 96_000,
        maxInlineStringChars: 0,
        maxInlineJsonBytes: 0,
        maxArrayItems: 8,
        maxObjectKeys: 48,
        maxDepth: 5,
        headChars: 0,
        tailChars: 0,
        maxPriorAttempts: 1,
      } : {
        maxPayloadBytes: 96_000,
        maxInlineStringChars: 6_000,
        maxInlineJsonBytes: 18_000,
        maxArrayItems: 10,
        maxObjectKeys: 48,
        maxDepth: 5,
        headChars: 1_200,
        tailChars: 1_200,
        maxPriorAttempts: 1,
      },
    });
    runPayload = withBackendDispatchMetadata(normalizedHandoff.payload, {
      contextMode: compactContext.mode,
      retryAudit: contextRecovery?.retryAudit,
    }, {
      backend,
    });
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'contextWindowState',
      source: 'workspace-runtime',
      message: 'Estimated context window after handoff slimming',
      contextWindowState: handoffContextWindowState({
        backend,
        modelName: llmRuntime.llmEndpoint?.modelName ?? request.modelName,
        maxContextWindowTokens: request.maxContextWindowTokens,
        rawRef: normalizedHandoff.rawRef,
        rawSha1: normalizedHandoff.rawSha1,
        rawBytes: normalizedHandoff.rawBytes,
        normalizedBytes: normalizedHandoff.normalizedBytes,
        maxPayloadBytes: normalizedHandoff.budget.maxPayloadBytes,
        rawTokens: normalizedHandoff.contextEstimate.rawTokens,
        normalizedTokens: normalizedHandoff.contextEstimate.normalizedTokens,
        savedTokens: normalizedHandoff.contextEstimate.savedTokens,
        decisions: handoffBudgetDecisionRecords(normalizedHandoff.decisions),
        auditRefs: normalizedHandoff.auditRefs,
      }),
      raw: {
        handoffBudget: normalizedHandoff.budget,
        handoffDecisions: normalizedHandoff.decisions,
        auditRefs: normalizedHandoff.auditRefs,
      },
    });
    emitWorkspaceRuntimeEvent(params.callbacks, backendDispatchEvent({
      backend,
      baseUrl: params.baseUrl,
      normalizedBytes: normalizedHandoff.normalizedBytes,
      maxPayloadBytes: normalizedHandoff.budget.maxPayloadBytes,
      rawRef: normalizedHandoff.rawRef,
    }));
    const silentGuardPolicy = currentReferenceDigestSilentGuardPolicy(request);
    const silentRunId = typeof request.uiState?.silentStreamRunId === 'string'
      ? request.uiState.silentStreamRunId
      : typeof request.uiState?.sessionId === 'string'
        ? request.uiState.sessionId
        : undefined;
    const silentStreamDecision = silentStreamDecisionFromGatewayRequest(request);
    const preResponseSilentStartedAt = Date.now();
    const preResponseSilentTimeout = setTimeout(() => {
      const audit = backendSilentStreamGuardAudit(silentGuardPolicy, {
        elapsedMs: Date.now() - preResponseSilentStartedAt,
        retryCount: Math.max(0, dispatchAttempt - 1),
        runId: silentRunId,
        existingDecision: silentStreamDecision,
      });
      controller.abort();
      emitWorkspaceRuntimeEvent(params.callbacks, {
        ...backendSilentStreamGuardEvent(audit.message),
        detail: audit.detail,
        raw: audit,
      });
    }, silentGuardPolicy.timeoutMs);
    let response: Response;
    try {
      sideEffectSnapshot = await captureGeneratedTaskWorkspaceSideEffectSnapshot(params.workspace);
      response = await fetch(`${params.baseUrl}/api/agent-server/runs/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(runPayload),
      });
    } finally {
      clearTimeout(preResponseSilentTimeout);
    }
    partialStreamWorkEvidence = [];
    const { json, run, error, streamText, workEvidence, capabilityDiscoveryToolResults } = await readBackendRunStream(response, (event) => {
      partialStreamWorkEvidence.push(...collectWorkEvidenceFromBackendEvent(event));
      emitWorkspaceRuntimeEvent(params.callbacks, withRequestContextWindowLimit(
        normalizeBackendWorkspaceEvent(event),
        request,
      ));
    }, {
      maxTotalUsage: backendGenerationTokenGuardLimit(request, { repairContinuation }),
      convergenceGuardMode: repairContinuation ? 'repair-continuation' : 'generation',
      capabilityDiscoveryToolTransport: {
        workspace: params.workspace,
        sessionBundleRel: sessionBundleRelForRequest(request),
        auditSeed: `${agentId}:${silentRunId ?? 'run'}:${dispatchAttempt}`,
      },
      maxSilentMs: silentGuardPolicy.timeoutMs,
      silencePolicy: silentGuardPolicy,
      silentRetryCount: Math.max(0, dispatchAttempt - 1),
      silentRunId,
      silentStreamDecision,
      onGuardTrip: (message) => {
        controller.abort();
        emitWorkspaceRuntimeEvent(params.callbacks, backendConvergenceGuardEvent(message));
      },
      onSilentTimeout: (message, audit) => {
        controller.abort();
        emitWorkspaceRuntimeEvent(params.callbacks, {
          ...backendSilentStreamGuardEvent(message),
          detail: audit.detail,
          raw: audit,
        });
      },
    });
    await writeBackendDebugArtifact(params.workspace, 'generation', runPayload, response.status, json, sessionBundleRelForRequest(request));
    const workspaceSideEffectEvidence = await workEvidenceFromGeneratedTaskWorkspaceSideEffects(sideEffectSnapshot, params.workspace);
    const streamAndWorkspaceWorkEvidence = dedupeWorkEvidence([...workEvidence, ...workspaceSideEffectEvidence]);
    if (!response.ok) {
      const detail = isRecord(json) ? String(json.error || json.message || '') : '';
      const failure = await recoverOrReturnBackendGenerationFailure({
        error: detail || error || `backend generation HTTP ${response.status}`,
        sanitizedError: sanitizeBackendError(detail || error || `backend generation HTTP ${response.status}`),
        dispatchAttempt,
        contextRecovery,
        adapter,
        baseUrl: params.baseUrl,
        workspace: params.workspace,
        agentId,
        provider: llmRuntime.llmEndpoint?.provider,
        model: llmRuntime.llmEndpoint?.modelName ?? request.modelName,
        request,
        skill: params.skill,
        callbacks: params.callbacks,
        httpStatus: response.status,
        headers: response.headers,
        priorHandoff: normalizedHandoff,
        workEvidence: streamAndWorkspaceWorkEvidence,
      });
      if (failure.retry) {
        contextRecovery = failure.diagnostics;
        continue;
      }
      return failure.result;
    }
    if (error) {
      const failure = await recoverOrReturnBackendGenerationFailure({
        error,
        sanitizedError: sanitizeBackendError(error),
        dispatchAttempt,
        contextRecovery,
        adapter,
        baseUrl: params.baseUrl,
        workspace: params.workspace,
        agentId,
        provider: llmRuntime.llmEndpoint?.provider,
        model: llmRuntime.llmEndpoint?.modelName ?? request.modelName,
        request,
        skill: params.skill,
        callbacks: params.callbacks,
        priorHandoff: normalizedHandoff,
        workEvidence: streamAndWorkspaceWorkEvidence,
      });
      if (failure.retry) {
        contextRecovery = failure.diagnostics;
        continue;
      }
      return failure.result;
    }
    const runFailure = backendRunFailure(run);
    if (runFailure) {
      const failure = await recoverOrReturnBackendGenerationFailure({
        error: runFailure,
        sanitizedError: runFailure,
        dispatchAttempt,
        contextRecovery,
        adapter,
        baseUrl: params.baseUrl,
        workspace: params.workspace,
        agentId,
        provider: llmRuntime.llmEndpoint?.provider,
        model: llmRuntime.llmEndpoint?.modelName ?? request.modelName,
        request,
        skill: params.skill,
        callbacks: params.callbacks,
        priorHandoff: normalizedHandoff,
        workEvidence: streamAndWorkspaceWorkEvidence,
      });
      if (failure.retry) {
        contextRecovery = failure.diagnostics;
        continue;
      }
      return failure.result;
    }
    const directPayload = parseToolPayloadResponse(run);
    if (directPayload) {
      emitBackendHandoffDrift(params.callbacks, {
        raw: run.output ?? run,
        parsedToolPayload: true,
        source: 'backend-run-output',
        runId: typeof run.id === 'string' ? run.id : undefined,
      });
      const payload = mergeBackendStreamWorkEvidence(directPayload, streamAndWorkspaceWorkEvidence);
      return await finalizeBackendGenerationSuccess({
        result: {
        ok: true,
        runId: typeof run.id === 'string' ? run.id : undefined,
        directPayload: payload,
        },
        contextRecovery,
        workspace: params.workspace,
        request,
        skill: params.skill,
        callbacks: params.callbacks,
      });
    }
    const runOutputText = extractBackendOutputText(run);
    const directText = preferUntruncatedBackendText(runOutputText, streamText);
    const parsedRaw = parseGenerationResponse(run.output) ?? parseGenerationResponse(run) ?? parseGenerationResponse(streamText) ?? parseGenerationResponse(directText);
    const parsed = parsedRaw && directText ? hydrateGeneratedTaskResponseFromText(parsedRaw, directText) : parsedRaw;
    if (!parsed) {
      if (capabilityDiscoveryToolResults.length && !directText && dispatchAttempt < 2) {
        capabilityDiscoveryToolResultsForRetry = capabilityDiscoveryToolResults;
        strictTaskFilesReason = 'Backend generation emitted capability_discovery tool-call events without a terminal generation result. Retrying once with the discovery tool-result records included in the compact handoff; consume those results, then return the final compact JSON.';
        emitWorkspaceRuntimeEvent(params.callbacks, {
          type: 'backend-generation-retry',
          source: 'workspace-runtime',
          status: 'running',
          message: 'Retrying backend generation with capability discovery tool results.',
          detail: strictTaskFilesReason,
          raw: {
            schemaVersion: 'sciforge.backend-generation-retry.v1',
            reason: 'capability-discovery-tool-result-consumption',
            toolResultCount: capabilityDiscoveryToolResults.length,
            auditRefs: capabilityDiscoveryToolResults.flatMap((event) => event.auditRefs).slice(0, 12),
          },
        });
        continue;
      }
      if (directText && looksLikeUnparsedGenerationResponseText(directText)) {
        const malformedGenerationReason = looksLikeTruncatedBackendResponseText(directText)
          ? 'Backend generation returned a transport-truncated GeneratedTaskResponse-looking JSON payload. Retry with terminal JSON under 6000 characters, one tiny executable task file under 3500 characters, no long comments/templates/tables, and no markdown fences; if the task cannot fit, return a valid failed-with-reason ToolPayload instead.'
          : 'Backend generation returned a malformed or incomplete GeneratedTaskResponse-looking JSON payload; retry with compact executable taskFiles JSON and no markdown fences.';
        emitBackendHandoffDrift(params.callbacks, {
          raw: run.output ?? run,
          text: directText,
          source: 'backend-run-output',
          runId: typeof run.id === 'string' ? run.id : undefined,
        });
        if (!strictTaskFilesReason
          && dispatchAttempt < 2
          && !shouldPreferProviderRecoveryOverMalformedRetry(params.request, params.skill)) {
          strictTaskFilesReason = malformedGenerationReason;
          emitWorkspaceRuntimeEvent(params.callbacks, {
            type: GENERATED_TASK_RETRY_EVENT_TYPE,
            source: 'workspace-runtime',
            status: 'running',
            message: malformedGenerationReason,
            detail: looksLikeTruncatedBackendResponseText(directText)
              ? 'Retrying backend generation with an ultra-compact taskFiles contract because the prior response was cut by transport compaction before it could be parsed.'
              : 'Retrying backend generation with a stricter taskFiles-only contract because the prior response looked like task code JSON but could not be parsed as a runnable generation response.',
          });
          continue;
        }
        return backendGenerationFailureWithWorkEvidence(
          malformedGenerationReason,
          params.request,
          llmRuntime,
          streamAndWorkspaceWorkEvidence,
        );
      }
      if (directText) {
        const directTextClassification = classifyPlainAgentText(directText);
        emitBackendHandoffDrift(params.callbacks, {
          raw: run.output ?? run,
          text: directText,
          plainTextClassificationKind: directTextClassification.kind,
          source: 'backend-run-output',
          runId: typeof run.id === 'string' ? run.id : undefined,
        });
        if (
          directTextClassification.kind === 'tool-payload-json'
          && looksLikeTruncatedBackendResponseText(directText)
          && dispatchAttempt < 2
        ) {
          strictTaskFilesReason = 'Backend generation returned a ToolPayload-looking JSON string that was compacted/truncated by the HTTP response transport. Retry with terminal JSON under 6000 characters: prefer a compact executable GeneratedTaskResponse whose task writes long report/data artifacts beside outputPath and returns only artifact refs; do not inline long markdown/data bodies in a direct ToolPayload.';
          emitWorkspaceRuntimeEvent(params.callbacks, {
            type: GENERATED_TASK_RETRY_EVENT_TYPE,
            source: 'workspace-runtime',
            status: 'running',
            message: 'Backend generation returned a truncated ToolPayload-looking response; retrying with compact task-file output contract.',
            detail: strictTaskFilesReason,
          });
          continue;
        }
        const directPayload = mergeBackendStreamWorkEvidence(
          toolPayloadFromPlainAgentOutput(directText, request),
          streamAndWorkspaceWorkEvidence,
        );
        if (!strictTaskFilesReason && dispatchAttempt < 2 && directPayloadNeedsStrictTaskFilesRetry(directPayload)) {
          strictTaskFilesReason = directTextStrictTaskFilesRetryReason(directPayload);
          emitWorkspaceRuntimeEvent(params.callbacks, {
            type: GENERATED_TASK_RETRY_EVENT_TYPE,
            source: 'workspace-runtime',
            status: 'running',
            message: 'Backend direct text could not satisfy the reproducible task contract; retrying with taskFiles.',
            detail: strictTaskFilesReason,
          });
          continue;
        }
        return await finalizeBackendGenerationSuccess({
          result: {
          ok: true,
          runId: typeof run.id === 'string' ? run.id : undefined,
          directPayload,
          },
          contextRecovery,
          workspace: params.workspace,
        request,
        skill: params.skill,
        callbacks: params.callbacks,
      });
      }
      return backendGenerationFailureWithWorkEvidence(
        'Backend generation response did not include taskFiles and entrypoint or a SciForge ToolPayload.',
        params.request,
        llmRuntime,
        streamAndWorkspaceWorkEvidence,
      );
    }
    emitBackendHandoffDrift(params.callbacks, {
      raw: run.output ?? run,
      text: directText,
      parsedGeneration: true,
      source: 'backend-run-output',
      runId: typeof run.id === 'string' ? run.id : undefined,
    });
    return await finalizeBackendGenerationSuccess({
      result: {
      ok: true,
      runId: typeof run.id === 'string' ? run.id : undefined,
      response: parsed,
      },
      contextRecovery,
      workspace: params.workspace,
      request,
      skill: params.skill,
      callbacks: params.callbacks,
    });
    }
    return {
      ok: false,
      error: contextRecovery?.originalErrorSummary ?? 'Backend generation failed after context recovery.',
      diagnostics: contextRecovery,
    };
  } catch (error) {
    const requestFailure = backendRequestFailureMessage('generation', error, timeoutMs);
    const workspaceSideEffectEvidence = await workEvidenceFromGeneratedTaskWorkspaceSideEffects(sideEffectSnapshot, params.workspace);
    const diagnostic = diagnosticForFailure(requestFailure, {
      backend: params.request.agentBackend,
      provider: params.request.modelProvider,
      model: params.request.modelName,
    });
    await writeBackendDebugArtifact(params.workspace, 'generation', runPayload, 0, {
      error: errorMessage(error),
      diagnostic,
    }, sessionBundleRelForRequest(params.request));
    if (requestUsesRepairContext(params.request) && isBackendRepairContinuationBoundedStopError(error)) {
      return {
        ok: true,
        directPayload: repairContinuationBoundedStopPayload(params.request, params.skill, requestFailure, error),
      };
    }
    return {
      ok: false,
      error: requestFailure,
      diagnostics: {
        kind: 'agentserver',
        categories: diagnostic.categories,
        retryAfterMs: diagnostic.retryAfterMs,
        resetAt: diagnostic.resetAt,
        backend: diagnostic.backend,
        provider: diagnostic.provider,
        model: diagnostic.model,
        originalErrorSummary: diagnostic.userReason ?? requestFailure,
        sideEffectWorkEvidence: dedupeWorkEvidence([...partialStreamWorkEvidence, ...workspaceSideEffectEvidence]),
      },
    };
  } finally {
    clearTimeout(timeout);
    params.callbacks?.signal?.removeEventListener('abort', abortGeneration);
  }
}

function shouldPreferProviderRecoveryOverMalformedRetry(request: GatewayRequest, skill: SkillAvailability) {
  if (request.skillDomain === 'literature') return true;
  if (request.scenarioPackageRef?.id === 'literature-evidence-review') return true;
  if (skill.id.includes('literature')) return true;
  return skill.manifest.skillDomains.includes('literature');
}

function backendGenerationFailureWithWorkEvidence(
  error: string,
  request: GatewayRequest,
  llmRuntime: Awaited<ReturnType<typeof backendLlmRuntime>>,
  workEvidence: WorkEvidence[],
): BackendGenerationResult {
  const diagnostic = diagnosticForFailure(error, {
    backend: request.agentBackend,
    provider: llmRuntime.llmEndpoint?.provider ?? request.modelProvider,
    model: llmRuntime.llmEndpoint?.modelName ?? request.modelName,
  });
  return {
    ok: false,
    error,
    diagnostics: {
      kind: 'agentserver',
      categories: diagnostic.categories,
      retryAfterMs: diagnostic.retryAfterMs,
      resetAt: diagnostic.resetAt,
      backend: diagnostic.backend,
      provider: diagnostic.provider,
      model: diagnostic.model,
      originalErrorSummary: diagnostic.userReason ?? error,
      sideEffectWorkEvidence: workEvidence,
    },
  };
}

function selectedComponentIdsForGenerationRequest(request: GatewayRequest) {
  const selected = request.selectedComponentIds ?? toStringList(request.uiState?.selectedComponentIds);
  return selectedComponentIdsForPromptAwareRequest(request, selected);
}

function selectedComponentIdsForPromptAwareRequest(request: GatewayRequest, selectedComponentIds: string[]) {
  return selectedComponentIdsForRequest({
    prompt: request.prompt,
    selectedComponentIds,
    uiState: {},
  });
}

function compactCapabilityDiscoveryToolResults(results: CapabilityDiscoveryToolResultEvent[] | undefined): Array<Record<string, unknown>> | undefined {
  if (!results?.length) return undefined;
  return results.slice(0, 8).map((event) => ({
    schemaVersion: 'sciforge.capability-discovery.tool-result-summary.v1',
    toolName: event.toolName,
    status: event.status,
    callId: event.callId,
    discoveryRef: event.discoveryRef,
    auditRefs: event.auditRefs.slice(0, 8),
    completionEvidence: 'not-evidence',
    result: compactCapabilityDiscoveryResultForRetry(event.result),
    error: event.error,
  }));
}

function compactCapabilityDiscoveryResultForRetry(result: unknown): unknown {
  if (!isRecord(result)) return result;
  if (Array.isArray(result.candidates)) {
    return {
      contract: result.contract,
      discoveryRef: result.discoveryRef,
      auditRef: result.auditRef,
      candidates: result.candidates.slice(0, 6),
      next: result.next,
    };
  }
  if (Array.isArray(result.expanded)) {
    return {
      contract: result.contract,
      discoveryRef: result.discoveryRef,
      auditRef: result.auditRef,
      expanded: result.expanded.slice(0, 4),
      excluded: Array.isArray(result.excluded) ? result.excluded.slice(0, 8) : undefined,
    };
  }
  if (Array.isArray(result.steps)) {
    return {
      contract: result.contract,
      planId: result.planId,
      discoveryRef: result.discoveryRef,
      auditRef: result.auditRef,
      summary: result.summary,
      steps: result.steps.slice(0, 8),
      missingProviders: Array.isArray(result.missingProviders) ? result.missingProviders.slice(0, 8) : undefined,
      missingPermissions: Array.isArray(result.missingPermissions) ? result.missingPermissions.slice(0, 8) : undefined,
      completionEvidence: 'not-evidence',
    };
  }
  return result;
}

function directPayloadNeedsStrictTaskFilesRetry(payload: ToolPayload) {
  return payload.claimType === 'runtime-diagnostic'
    && payload.evidenceLevel === 'backend-direct-text-guard'
    && payload.executionUnits.some((unit) => isRecord(unit) && (
      unit.status === 'needs-human'
      || unit.status === 'repair-needed'
      || unit.status === 'failed-with-reason'
    ));
}

function directTextStrictTaskFilesRetryReason(payload: ToolPayload) {
  const reason = payload.executionUnits
    .map((unit) => isRecord(unit) && typeof unit.failureReason === 'string' ? unit.failureReason : undefined)
    .find(Boolean);
  return [
    'backend returned direct text that cannot satisfy this generated-work request.',
    reason ?? 'Retry with compact executable taskFiles JSON, no markdown fences, and a workspace task that writes long artifacts beside outputPath.',
  ].join(' ');
}

function preferUntruncatedBackendText(runOutputText: string | undefined, streamText: string | undefined) {
  const runText = runOutputText || '';
  const streamed = streamText || '';
  if (runText && !looksLikeTruncatedBackendResponseText(runText)) return runText;
  if (streamed && !looksLikeTruncatedBackendResponseText(streamed)) return streamed;
  return runText || streamed;
}

function repairContinuationBoundedStopPayload(
  request: GatewayRequest,
  skill: SkillAvailability,
  failureReason: string,
  error: unknown,
): ToolPayload {
  const totalUsage = isRecord(error) && typeof error.totalUsage === 'number' ? error.totalUsage : undefined;
  const limit = isRecord(error) && typeof error.limit === 'number' ? error.limit : undefined;
  const evidenceRefs = requestContextRefs(request, isRecord(request.uiState) ? request.uiState : {})
    .flatMap((ref) => typeof ref.ref === 'string' ? [ref.ref] : [])
    .slice(0, 12);
  const recoverActions = [
    'Continue from currentReferenceDigests, recentExecutionRefs, and stable artifact/log refs only; do not replay broad history or inline raw artifact/log bodies.',
    'Ask the backend for exactly one minimal repair/continue adapter step, or return failed-with-reason when the supplied refs are insufficient.',
    'If required evidence is missing, ask the user for the specific missing ref instead of restarting the full task pipeline.',
  ];
  const nextStep = 'Retry the continuation with a refs/digests-only handoff scoped to one minimal repair step, or ask for the missing execution/artifact ref.';
  const diagnostic = diagnosticForFailure(failureReason, {
    backend: request.agentBackend,
    provider: request.modelProvider,
    model: request.modelName,
    evidenceRefs,
  });
  return repairNeededPayload(request, skill, failureReason, {
    blocker: 'repair-continuation-bounded-stop',
    evidenceRefs,
    recoverActions,
    backendFailure: {
      contract: 'sciforge.backend-repair-failure.v1',
      failureKind: 'backend-diagnostic',
      capabilityId: skill.id,
      failureReason,
      diagnostic,
      recoverActions,
      nextStep,
      relatedRefs: evidenceRefs,
      createdAt: new Date().toISOString(),
    },
    agentServerRefs: {
      boundedStop: {
        mode: 'repair-continuation',
        totalUsage,
        limit,
        guidance: 'refs/digests-only minimal continuation',
      },
      currentReferenceDigestRefs: toRecordList(request.uiState?.currentReferenceDigests).map((entry) => ({
        ref: typeof entry.ref === 'string' ? entry.ref : undefined,
        digestRef: typeof entry.digestRef === 'string' ? entry.digestRef : undefined,
        title: typeof entry.title === 'string' ? entry.title : undefined,
      })).slice(0, 12),
      recentExecutionRefs: toRecordList(request.uiState?.recentExecutionRefs).map((entry) => ({
        id: typeof entry.id === 'string' ? entry.id : undefined,
        status: typeof entry.status === 'string' ? entry.status : undefined,
        outputRef: typeof entry.outputRef === 'string' ? entry.outputRef : undefined,
        stdoutRef: typeof entry.stdoutRef === 'string' ? entry.stdoutRef : undefined,
        stderrRef: typeof entry.stderrRef === 'string' ? entry.stderrRef : undefined,
        failureReason: typeof entry.failureReason === 'string' ? headForBackend(entry.failureReason, 500) : undefined,
      })).slice(0, 12),
    },
  });
}

function withBackendDispatchMetadata<T>(
  payload: T,
  metadata: Record<string, unknown>,
  required: { backend?: string } = {},
): T {
  if (!isRecord(payload)) return payload;
  const next: Record<string, unknown> = { ...payload };
  if (required.backend) {
    const agent: Record<string, unknown> = isRecord(next.agent) ? { ...next.agent } : {};
    agent.backend = required.backend;
    next.agent = agent;
    const runtime: Record<string, unknown> = isRecord(next.runtime) ? { ...next.runtime } : {};
    runtime.backend = required.backend;
    next.runtime = runtime;
  }
  const input: Record<string, unknown> = isRecord(next.input) ? { ...next.input } : {};
  input.metadata = {
    ...(isRecord(input.metadata) ? input.metadata : {}),
    ...metadata,
  };
  next.input = input;
  next.metadata = {
    ...(isRecord(next.metadata) ? next.metadata : {}),
    ...metadata,
  };
  return next as T;
}

function agentHarnessRefMetadata(metadata: Record<string, unknown>) {
  const {
    agentHarnessHandoff: _agentHarnessHandoff,
    ...refMetadata
  } = metadata;
  return refMetadata;
}

function emitBackendHandoffDrift(
  callbacks: WorkspaceRuntimeCallbacks | undefined,
  input: Parameters<typeof classifyBackendHandoffDrift>[0],
) {
  emitWorkspaceRuntimeEvent(callbacks, backendHandoffDriftEvent(classifyBackendHandoffDrift(input)));
}

function normalizeBackendWorkspaceEvent(raw: unknown): WorkspaceRuntimeEvent {
  return normalizeBackendWorkspaceEventFromModule(raw);
}

function withRequestContextWindowLimit(event: WorkspaceRuntimeEvent, request: GatewayRequest): WorkspaceRuntimeEvent {
  return withRequestContextWindowLimitFromModule(event, request);
}
