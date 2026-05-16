import type { GatewayRequest, SkillAvailability, ToolPayload, WorkspaceRuntimeCallbacks, WorkspaceRuntimeEvent } from '../runtime-types.js';
import { readRecentTaskAttempts } from '../task-attempt-history.js';
import { sha1 } from '../workspace-task-runner.js';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { cleanUrl, errorMessage, headForAgentServer, isRecord, toRecordList, toStringList } from '../gateway-utils.js';
import { normalizeBackendHandoff } from '../workspace-task-input.js';
import { sessionBundleRelForRequest } from '../session-bundle.js';
import { expectedArtifactTypesForRequest } from './gateway-request.js';
import { agentHarnessMetadata, requestWithoutInlineAgentHarness } from './agent-harness-shadow.js';
import { buildContextEnvelope, expectedArtifactSchema, summarizeTaskAttemptsForAgentServer, workspaceTreeSummary } from './context-envelope.js';
import { normalizeAgentServerWorkspaceEvent as normalizeAgentServerWorkspaceEventFromModule, withRequestContextWindowLimit as withRequestContextWindowLimitFromModule } from './workspace-event-normalizer.js';
import { agentServerAgentId, agentServerContextPolicy, contextCompactionMetadata, contextWindowMetadata, estimateWorkspaceContextWindowState, fetchAgentServerContextSnapshot, currentTurnReferences, handoffBudgetDecisionRecords, handoffContextWindowState, preflightAgentServerContextWindow, requestNeedsAgentServerContinuity } from './agentserver-context-window.js';
import { agentServerBackendSelectionDecision } from './agent-backend-config.js';
import { classifyPlainAgentText, toolPayloadFromPlainAgentOutput } from './direct-answer-payload.js';
import { agentServerLlmRuntime, AGENT_BACKEND_ANSWER_PRINCIPLE, buildAgentServerCompactContext, buildAgentServerGenerationPrompt, contextEnvelopeMode, missingUserLlmEndpointMessage, requiresUserLlmEndpoint, summarizeRuntimeCapabilitiesForAgentServer, summarizeToolsForAgentServer, writeAgentServerDebugArtifact } from './agentserver-prompts.js';
import { agentServerRequestFailureMessage, agentServerRunFailure, extractAgentServerOutputText, looksLikeUnparsedGenerationResponseText, parseGenerationResponse, parseToolPayloadResponse } from './agentserver-run-output.js';
import { diagnosticForFailure, sanitizeAgentServerError } from './backend-failure-diagnostics.js';
import { finalizeAgentServerGenerationSuccess, recoverOrReturnAgentServerGenerationFailure, type AgentServerGenerationFailureDiagnostics, type AgentServerGenerationResult } from './agentserver-generation-recovery.js';
import { isAgentServerRepairContinuationBoundedStopError, agentServerGenerationTokenGuardLimit, agentServerSilentStreamGuardAudit, currentReferenceDigestSilentGuardPolicy, mergeBackendStreamWorkEvidence, readAgentServerRunStream, silentStreamDecisionFromGatewayRequest } from './agentserver-stream.js';
import { hydrateGeneratedTaskResponseFromText } from './generated-task-response-text.js';
import { hasRecoverableRecentAttempt } from './recoverable-attempts.js';
import { repairNeededPayload } from './payload-validation.js';
import { requestContextRefs } from './request-context-refs.js';
import { AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE } from '../../../packages/skills/runtime-policy';
import { agentHandoffSourceMetadata } from '@sciforge-ui/runtime-contract/handoff';
import { agentServerConvergenceGuardEvent, agentServerDispatchEvent, agentServerSilentStreamGuardEvent } from '@sciforge-ui/runtime-contract/events';
import { backendHandoffDriftEvent, classifyBackendHandoffDrift } from '@sciforge-ui/runtime-contract/backend-handoff-drift';
import { DEFAULT_AGENTSERVER_ADAPTER_MODE, backendAdapterForAgentServerAdapter, createInlineAgentServerAdapter, type AgentServerAdapter, type AgentServerGenerationAdapterResult } from './agentserver-adapter.js';
import { createTurnPipeline, createWorkspaceKernel } from '../conversation-kernel/index.js';

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

export type AgentServerGenerationParams = {
  baseUrl: string;
  request: GatewayRequest;
  skill: SkillAvailability;
  skills: SkillAvailability[];
  workspace: string;
  callbacks?: WorkspaceRuntimeCallbacks;
  strictTaskFilesReason?: string;
};

export async function requestAgentServerGeneration(params: AgentServerGenerationParams): Promise<AgentServerGenerationResult> {
  let adapter: AgentServerAdapter | undefined;
  adapter = createInlineAgentServerAdapter((adapterParams) => dispatchAgentServerGeneration(adapterParams, requireAgentServerAdapter(adapter)), {
    mode: DEFAULT_AGENTSERVER_ADAPTER_MODE,
  });
  return executeAgentServerGenerationTurnPipeline({ adapter, params });
}

async function executeAgentServerGenerationTurnPipeline(input: {
  adapter: AgentServerAdapter;
  params: AgentServerGenerationParams;
}): Promise<AgentServerGenerationResult> {
  let driveResult: AgentServerGenerationAdapterResult | undefined;
  const turn = agentServerGenerationTurnPipelineInput(input.params);
  const pipeline = createTurnPipeline({
    kernel: createWorkspaceKernel({ sessionId: `agentserver-generation-${turn.key}` }),
    hooks: {
      requestContext: () => {
        emitWorkspaceRuntimeEvent(input.params.callbacks, agentServerTurnPipelineStageEvent('requestContext', input.adapter, turn));
        return {
          contextRef: `agentserver://generation/context/${turn.key}`,
          contextRefs: [
            `agentserver://adapter/${input.adapter.mode}`,
            `agentserver://backend-boundary/${input.adapter.backendBoundary}`,
            `agentserver://generation/context/${turn.key}`,
          ],
        };
      },
      driveRun: async () => {
        emitWorkspaceRuntimeEvent(input.params.callbacks, agentServerTurnPipelineStageEvent('driveRun', input.adapter, turn));
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
          resultRefs: agentServerGenerationResultRefs(driveResult, turn.key),
        };
      },
      finalizeRun: (stageInput) => {
        emitWorkspaceRuntimeEvent(input.params.callbacks, agentServerTurnPipelineStageEvent('finalizeRun', input.adapter, turn));
        return {
          status: 'satisfied',
          text: 'AgentServer generation completed through declarative TurnPipeline.',
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
  emitWorkspaceRuntimeEvent(input.params.callbacks, agentServerTurnPipelineStageEvent('registerTurn', input.adapter, turn));
  await pipeline.execute({
    turnId: turn.turnId,
    runId: turn.runId,
    currentTurnRef: turn.currentTurnRef,
    summary: 'AgentServer generation request registered.',
  });
  return finalizeAgentServerAdapterGenerationResult(driveResult);
}

function finalizeAgentServerAdapterGenerationResult(
  result: AgentServerGenerationAdapterResult | undefined,
): AgentServerGenerationResult {
  if (!result) return { ok: false, error: 'AgentServer TurnPipeline finished without driveRun result' };
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      diagnostics: result.diagnostics as AgentServerGenerationFailureDiagnostics | undefined,
    };
  }
  if ('response' in result) return { ok: true, runId: result.runId, response: result.response };
  return { ok: true, runId: result.runId, directPayload: result.directPayload as ToolPayload };
}

function agentServerTurnPipelineStageEvent(
  stage: 'registerTurn' | 'requestContext' | 'driveRun' | 'finalizeRun',
  adapter: AgentServerAdapter,
  turn: ReturnType<typeof agentServerGenerationTurnPipelineInput>,
): WorkspaceRuntimeEvent {
  return {
    type: 'agentserver-turn-pipeline-stage',
    source: 'workspace-runtime',
    status: stage,
    message: `AgentServer TurnPipeline stage: ${stage}`,
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

function agentServerGenerationTurnPipelineInput(params: AgentServerGenerationParams) {
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
    currentTurnRef: `runtime://agentserver-generation/current-turn/${key}`,
  };
}

function agentServerGenerationResultRefs(result: AgentServerGenerationAdapterResult, key: string): string[] {
  if (!result.ok) return [];
  return [
    result.runId ? `agentserver://run/${result.runId}` : undefined,
    'response' in result
      ? `agentserver://generation-response/${key}`
      : `agentserver://direct-payload/${key}`,
  ].filter((ref): ref is string => Boolean(ref));
}

function requireAgentServerAdapter(adapter: AgentServerAdapter | undefined): AgentServerAdapter {
  if (!adapter) throw new Error('AgentServerAdapter was not initialized before generation dispatch.');
  return adapter;
}

async function dispatchAgentServerGeneration(params: AgentServerGenerationParams, agentServerAdapter: AgentServerAdapter): Promise<AgentServerGenerationResult> {
  const controller = new AbortController();
  const timeoutMs = Number(process.env.SCIFORGE_AGENTSERVER_GENERATION_TIMEOUT_MS || 900000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const abortGeneration = () => controller.abort();
  params.callbacks?.signal?.addEventListener('abort', abortGeneration, { once: true });
  if (params.callbacks?.signal?.aborted) controller.abort();
  let runPayload: unknown;
  let contextRecovery: AgentServerGenerationFailureDiagnostics | undefined;
  let strictTaskFilesReason = params.strictTaskFilesReason;
  try {
    const request = params.request;
    const promptRequest = requestWithoutInlineAgentHarness(request);
    const { llmEndpointSource, ...llmRuntime } = await agentServerLlmRuntime(request, params.workspace);
    const backendSelectionDecision = agentServerBackendSelectionDecision(request, llmRuntime.llmEndpoint);
    const backend = backendSelectionDecision.backend;
    const needsContinuity = requestNeedsAgentServerContinuity(promptRequest);
    const repairContinuation = requestUsesRepairContext(promptRequest);
    const generationPurpose = needsContinuity ? 'workspace-task-generation' : 'workspace-task-generation-inline';
    if (!llmRuntime.llmEndpoint && requiresUserLlmEndpoint(params.baseUrl)) {
      return { ok: false, error: missingUserLlmEndpointMessage() };
    }
    const adapter = backendAdapterForAgentServerAdapter(agentServerAdapter, backend);
    const agentId = agentServerAgentId(promptRequest, 'task-generation');
    for (let dispatchAttempt = 1; dispatchAttempt <= 2; dispatchAttempt += 1) {
    const preflight = await preflightAgentServerContextWindow({
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
    const attachPriorAttempts = needsContinuity || hasRecoverableRecentAttempt(recentAttempts, promptRequest.prompt);
    const priorAttempts = currentTurnReferences(promptRequest).length || !attachPriorAttempts
      ? []
      : summarizeTaskAttemptsForAgentServer(recentAttempts);
    const agentServerSnapshot = preflight.state?.snapshot ?? await fetchAgentServerContextSnapshot(params.baseUrl, agentId);
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
      contextEnvelope.retryReason = 'Previous AgentServer generation attempt hit provider/rate-limit or retry-budget pressure; this is the only compact retry.';
    }
    const compactContext = buildAgentServerCompactContext(promptRequest, {
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
      availableTools: summarizeToolsForAgentServer(promptRequest),
      availableRuntimeCapabilities: summarizeRuntimeCapabilitiesForAgentServer(promptRequest),
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
      selectedComponentIds: promptRequest.selectedComponentIds ?? toStringList(promptRequest.uiState?.selectedComponentIds),
      priorAttempts: compactContext.priorAttempts,
      strictTaskFilesReason,
      retryAudit: contextRecovery?.retryAudit,
      freshCurrentTurn: !needsContinuity,
      repairContinuation,
    };
    const generationPrompt = buildAgentServerGenerationPrompt(generationRequest);
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
      message: 'Estimated context window before AgentServer dispatch',
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
            ? 'Fresh-generation hard rule: do not call shell/filesystem/browser tools to inspect the workspace, .sciforge, old task attempts, logs, artifacts, installed packages, or prior generated code before returning. If the user task needs network, downloads, PDF/full-text reading, computation, or file creation, generate a bounded runnable task that performs that work at execution time. Your first substantive assistant output must be the final compact JSON for a direct ToolPayload or a runnable AgentServerGenerationResponse.'
            : 'Continuity-generation mode: treat visible summaries and current refs as authoritative. Inspect only explicitly supplied refs needed for the user-requested continuation, never scan broad .sciforge/session history or workspace trees, and return a compact direct ToolPayload when the supplied summary is sufficient.',
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
          ...harnessMetadata,
        },
      },
      contextPolicy: agentServerContextPolicy(promptRequest),
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
      purpose: contextRecovery ? 'agentserver-generation-rate-limit-retry' : 'agentserver-generation',
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
    runPayload = withAgentServerDispatchMetadata(normalizedHandoff.payload, {
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
    emitWorkspaceRuntimeEvent(params.callbacks, agentServerDispatchEvent({
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
      const audit = agentServerSilentStreamGuardAudit(silentGuardPolicy, {
        elapsedMs: Date.now() - preResponseSilentStartedAt,
        retryCount: Math.max(0, dispatchAttempt - 1),
        runId: silentRunId,
        existingDecision: silentStreamDecision,
      });
      controller.abort();
      emitWorkspaceRuntimeEvent(params.callbacks, {
        ...agentServerSilentStreamGuardEvent(audit.message),
        detail: audit.detail,
        raw: audit,
      });
    }, silentGuardPolicy.timeoutMs);
    let response: Response;
    try {
      response = await fetch(`${params.baseUrl}/api/agent-server/runs/stream`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: controller.signal,
        body: JSON.stringify(runPayload),
      });
    } finally {
      clearTimeout(preResponseSilentTimeout);
    }
    const { json, run, error, streamText, workEvidence } = await readAgentServerRunStream(response, (event) => {
      emitWorkspaceRuntimeEvent(params.callbacks, withRequestContextWindowLimit(
        normalizeAgentServerWorkspaceEvent(event),
        request,
      ));
    }, {
      maxTotalUsage: agentServerGenerationTokenGuardLimit(request, { repairContinuation }),
      convergenceGuardMode: repairContinuation ? 'repair-continuation' : 'generation',
      maxSilentMs: silentGuardPolicy.timeoutMs,
      silencePolicy: silentGuardPolicy,
      silentRetryCount: Math.max(0, dispatchAttempt - 1),
      silentRunId,
      silentStreamDecision,
      onGuardTrip: (message) => {
        controller.abort();
        emitWorkspaceRuntimeEvent(params.callbacks, agentServerConvergenceGuardEvent(message));
      },
      onSilentTimeout: (message, audit) => {
        controller.abort();
        emitWorkspaceRuntimeEvent(params.callbacks, {
          ...agentServerSilentStreamGuardEvent(message),
          detail: audit.detail,
          raw: audit,
        });
      },
    });
    await writeAgentServerDebugArtifact(params.workspace, 'generation', runPayload, response.status, json, sessionBundleRelForRequest(request));
    if (!response.ok) {
      const detail = isRecord(json) ? String(json.error || json.message || '') : '';
      const failure = await recoverOrReturnAgentServerGenerationFailure({
        error: detail || error || `AgentServer generation HTTP ${response.status}`,
        sanitizedError: sanitizeAgentServerError(detail || error || `AgentServer generation HTTP ${response.status}`),
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
      });
      if (failure.retry) {
        contextRecovery = failure.diagnostics;
        continue;
      }
      return failure.result;
    }
    if (error) {
      const failure = await recoverOrReturnAgentServerGenerationFailure({
        error,
        sanitizedError: sanitizeAgentServerError(error),
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
      });
      if (failure.retry) {
        contextRecovery = failure.diagnostics;
        continue;
      }
      return failure.result;
    }
    const runFailure = agentServerRunFailure(run);
    if (runFailure) {
      const failure = await recoverOrReturnAgentServerGenerationFailure({
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
        source: 'agentserver-run-output',
        runId: typeof run.id === 'string' ? run.id : undefined,
      });
      const payload = mergeBackendStreamWorkEvidence(directPayload, workEvidence);
      return await finalizeAgentServerGenerationSuccess({
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
    const directText = extractAgentServerOutputText(run) || streamText || '';
    const parsedRaw = parseGenerationResponse(run.output) ?? parseGenerationResponse(run) ?? parseGenerationResponse(streamText) ?? parseGenerationResponse(directText);
    const parsed = parsedRaw && directText ? hydrateGeneratedTaskResponseFromText(parsedRaw, directText) : parsedRaw;
    if (!parsed) {
      if (directText && looksLikeUnparsedGenerationResponseText(directText)) {
        const malformedGenerationReason = 'AgentServer returned a malformed or incomplete AgentServerGenerationResponse-looking JSON payload; retry with compact executable taskFiles JSON and no markdown fences.';
        emitBackendHandoffDrift(params.callbacks, {
          raw: run.output ?? run,
          text: directText,
          source: 'agentserver-run-output',
          runId: typeof run.id === 'string' ? run.id : undefined,
        });
        if (!strictTaskFilesReason && dispatchAttempt < 2) {
          strictTaskFilesReason = malformedGenerationReason;
          emitWorkspaceRuntimeEvent(params.callbacks, {
            type: AGENTSERVER_GENERATED_TASK_RETRY_EVENT_TYPE,
            source: 'workspace-runtime',
            status: 'running',
            message: malformedGenerationReason,
            detail: 'Retrying AgentServer generation with a stricter taskFiles-only contract because the prior response looked like task code JSON but could not be parsed as a runnable generation response.',
          });
          continue;
        }
        return { ok: false, error: malformedGenerationReason };
      }
      if (directText) {
        const directTextClassification = classifyPlainAgentText(directText);
        emitBackendHandoffDrift(params.callbacks, {
          raw: run.output ?? run,
          text: directText,
          plainTextClassificationKind: directTextClassification.kind,
          source: 'agentserver-run-output',
          runId: typeof run.id === 'string' ? run.id : undefined,
        });
        return await finalizeAgentServerGenerationSuccess({
          result: {
          ok: true,
          runId: typeof run.id === 'string' ? run.id : undefined,
          directPayload: toolPayloadFromPlainAgentOutput(directText, request),
          },
          contextRecovery,
          workspace: params.workspace,
        request,
        skill: params.skill,
        callbacks: params.callbacks,
      });
      }
      return { ok: false, error: 'AgentServer generation response did not include taskFiles and entrypoint or a SciForge ToolPayload.' };
    }
    emitBackendHandoffDrift(params.callbacks, {
      raw: run.output ?? run,
      text: directText,
      parsedGeneration: true,
      source: 'agentserver-run-output',
      runId: typeof run.id === 'string' ? run.id : undefined,
    });
    return await finalizeAgentServerGenerationSuccess({
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
      error: contextRecovery?.originalErrorSummary ?? 'AgentServer generation failed after context recovery.',
      diagnostics: contextRecovery,
    };
  } catch (error) {
    const requestFailure = agentServerRequestFailureMessage('generation', error, timeoutMs);
    const diagnostic = diagnosticForFailure(requestFailure, {
      backend: params.request.agentBackend,
      provider: params.request.modelProvider,
      model: params.request.modelName,
    });
    await writeAgentServerDebugArtifact(params.workspace, 'generation', runPayload, 0, {
      error: errorMessage(error),
      diagnostic,
    }, sessionBundleRelForRequest(params.request));
    if (requestUsesRepairContext(params.request) && isAgentServerRepairContinuationBoundedStopError(error)) {
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
      },
    };
  } finally {
    clearTimeout(timeout);
    params.callbacks?.signal?.removeEventListener('abort', abortGeneration);
  }
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
    'Ask AgentServer for exactly one minimal repair/continue adapter step, or return failed-with-reason when the supplied refs are insufficient.',
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
        failureReason: typeof entry.failureReason === 'string' ? headForAgentServer(entry.failureReason, 500) : undefined,
      })).slice(0, 12),
    },
  });
}

function withAgentServerDispatchMetadata<T>(
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

function normalizeAgentServerWorkspaceEvent(raw: unknown): WorkspaceRuntimeEvent {
  return normalizeAgentServerWorkspaceEventFromModule(raw);
}

function withRequestContextWindowLimit(event: WorkspaceRuntimeEvent, request: GatewayRequest): WorkspaceRuntimeEvent {
  return withRequestContextWindowLimitFromModule(event, request);
}
