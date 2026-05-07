import { compactAgentContext, sendAgentMessageStream, validateSemanticTurnAcceptance } from '../../api/agentClient';
import { sendSciForgeToolMessage } from '../../api/sciforgeToolsClient';
import { expectedArtifactsForCurrentTurn, selectedComponentsForCurrentTurn } from '../../artifactIntent';
import { buildContextCompactionFailureResult, buildContextCompactionOutcome } from '../../contextCompaction';
import { estimateContextWindowState, latestContextWindowState, shouldStartContextCompaction } from '../../contextWindow';
import type { ScenarioId } from '../../data';
import type {
  AgentStreamEvent,
  NormalizedAgentResponse,
  ScenarioInstanceId,
  ScenarioPackageRef,
  ScenarioRuntimeOverride,
  SciForgeConfig,
  SciForgeMessage,
  SciForgeReference,
  SciForgeSession,
  UserGoalSnapshot,
} from '../../domain';
import { makeId, nowIso } from '../../domain';
import {
  acceptAndRepairAgentResponse,
  buildBackendAcceptanceRepairPrompt,
  buildUserGoalSnapshot,
  shouldRunBackendAcceptanceRepair,
} from '../../turnAcceptance';
import {
  appendFailedRunToSession,
  createOptimisticUserTurnSession,
  failedAcceptanceRepairResponse,
  mergeExecutionUnits,
  mergeRepairSuccessResponse,
  mergeRuntimeArtifacts,
  mergeRuns,
  requestPayloadForTurn,
} from './sessionTransforms';

type AgentRequest = Parameters<typeof sendSciForgeToolMessage>[0];

export interface RunPromptOrchestratorInput {
  prompt: string;
  baseSession: SciForgeSession;
  references: SciForgeReference[];
  scenarioId: ScenarioInstanceId;
  baseScenarioId: ScenarioId;
  scenarioName: string;
  scenarioDomain: string;
  role: string;
  config: SciForgeConfig;
  scenarioOverride?: ScenarioRuntimeOverride;
  availableComponentIds: string[];
  defaultComponentIds: string[];
  scenarioPackageRef: ScenarioPackageRef;
  skillPlanRef: string;
  uiPlanRef: string;
  streamEvents: AgentStreamEvent[];
  signal: AbortSignal;
  userAbortRequested: () => boolean;
  activeSession: () => SciForgeSession;
  onStreamEvent: (event: AgentStreamEvent) => void;
  onOptimisticSession?: (session: SciForgeSession) => void;
}

export type RunPromptOrchestratorResult = {
  status: 'completed';
  optimisticSession: SciForgeSession;
  finalResponse: NormalizedAgentResponse;
} | {
  status: 'failed';
  optimisticSession: SciForgeSession;
  failedSession: SciForgeSession;
  failedRunId: string;
  message: string;
};

export async function runPromptOrchestrator(input: RunPromptOrchestratorInput): Promise<RunPromptOrchestratorResult> {
  const turnId = makeId('turn');
  const turnComponentHints = selectedComponentsForCurrentTurn(
    input.prompt,
    input.availableComponentIds.length ? input.availableComponentIds : input.defaultComponentIds,
  );
  const goalSnapshot = buildUserGoalSnapshot({
    turnId,
    prompt: input.prompt,
    references: input.references,
    scenarioId: input.scenarioId,
    scenarioOverride: input.scenarioOverride,
    expectedArtifacts: expectedArtifactsForCurrentTurn({
      scenarioId: input.baseScenarioId,
      prompt: input.prompt,
      selectedComponentIds: turnComponentHints,
    }),
    recentMessages: input.baseSession.messages.slice(-8).map((message) => ({ role: message.role, content: message.content })),
  });
  const { session: optimisticSession, userMessage } = createOptimisticUserTurnSession({
    baseSession: input.baseSession,
    prompt: input.prompt,
    references: input.references,
    goalSnapshot,
  });
  input.onOptimisticSession?.(optimisticSession);

  try {
    let latestRoundTokenUsage: AgentStreamEvent['usage'];
    const handleStreamEvent = (event: AgentStreamEvent) => {
      if (event.usage) latestRoundTokenUsage = event.usage;
      input.onStreamEvent(event);
    };
    const turnPayload = requestPayloadForTurn(optimisticSession, userMessage, input.references);
    const request: AgentRequest = {
      sessionId: optimisticSession.sessionId,
      scenarioId: input.scenarioId,
      agentName: input.scenarioName,
      agentDomain: input.scenarioDomain,
      prompt: input.prompt,
      references: input.references,
      roleView: input.role,
      messages: turnPayload.messages,
      artifacts: turnPayload.artifacts,
      executionUnits: turnPayload.executionUnits,
      runs: turnPayload.runs,
      config: input.config,
      scenarioOverride: input.scenarioOverride,
      availableComponentIds: input.availableComponentIds,
      scenarioPackageRef: input.scenarioPackageRef,
      skillPlanRef: input.skillPlanRef,
      uiPlanRef: input.uiPlanRef,
    };

    await runPreflightContextCompaction({
      baseSession: input.baseSession,
      config: input.config,
      request,
      streamEvents: input.streamEvents,
      signal: input.signal,
      onStreamEvent: input.onStreamEvent,
    });

    const response = await runWithBackendFallback(request, input.signal, handleStreamEvent, input.onStreamEvent);
    const responseWithUsage = latestRoundTokenUsage
      ? { ...response, message: { ...response.message, tokenUsage: latestRoundTokenUsage } }
      : response;
    const responseWithReferences = {
      ...responseWithUsage,
      run: {
        ...responseWithUsage.run,
        references: input.references,
        goalSnapshot,
      },
      message: {
        ...responseWithUsage.message,
        references: responseWithUsage.message.references,
        goalSnapshot,
      },
    };
    const deterministicAcceptedResponse = acceptAndRepairAgentResponse({
      snapshot: goalSnapshot,
      response: responseWithReferences,
      session: input.activeSession(),
    });
    const semanticAcceptance = shouldValidateSemanticAcceptance(deterministicAcceptedResponse)
      ? await validateSemanticTurnAcceptance(request, {
        snapshot: goalSnapshot,
        response: deterministicAcceptedResponse,
        deterministicAcceptance: deterministicAcceptedResponse.message.acceptance!,
      }, input.signal)
      : undefined;
    const acceptedResponse = semanticAcceptance
      ? acceptAndRepairAgentResponse({
        snapshot: goalSnapshot,
        response: deterministicAcceptedResponse,
        session: input.activeSession(),
        semanticAcceptance,
      })
      : deterministicAcceptedResponse;
    const finalResponse = await maybeRunBackendAcceptanceRepair({
      prompt: input.prompt,
      references: input.references,
      request,
      acceptedResponse,
      goalSnapshot,
      sessionBeforeMerge: input.activeSession(),
      onStreamEvent: handleStreamEvent,
      signal: input.signal,
      emitEvent: input.onStreamEvent,
    });
    return { status: 'completed', optimisticSession, finalResponse };
  } catch (err) {
    const rawMessage = err instanceof Error ? err.message : String(err);
    const wasUserInterrupted = input.userAbortRequested();
    const wasSystemInterrupted = !wasUserInterrupted && (input.signal.aborted || /cancel|abort|已取消|cancelled|canceled/i.test(rawMessage));
    const message = wasUserInterrupted
      ? '用户已中断当前 backend 运行。'
      : wasSystemInterrupted
        ? `当前 backend 运行被系统或网络中断：${rawMessage}`
        : rawMessage;
    const { failedRunId, session } = appendFailedRunToSession({
      optimisticSession,
      scenarioId: input.scenarioId,
      scenarioPackageRef: input.scenarioPackageRef,
      skillPlanRef: input.skillPlanRef,
      uiPlanRef: input.uiPlanRef,
      prompt: input.prompt,
      message,
      references: input.references,
      goalSnapshot,
    });
    return {
      status: 'failed',
      optimisticSession,
      failedSession: session,
      failedRunId,
      message,
    };
  }
}

export async function runPreflightContextCompaction({
  baseSession,
  config,
  request,
  streamEvents,
  signal,
  onStreamEvent,
}: {
  baseSession: SciForgeSession;
  config: SciForgeConfig;
  request: AgentRequest;
  streamEvents: AgentStreamEvent[];
  signal: AbortSignal;
  onStreamEvent: (event: AgentStreamEvent) => void;
}) {
  const preflightState = latestContextWindowState(streamEvents)
    ?? estimateContextWindowState(baseSession, config, streamEvents);
  if (!shouldStartContextCompaction({
    state: preflightState,
    running: false,
    inFlight: false,
    reason: 'auto-threshold-before-send',
  })) return;

  const startedAt = nowIso();
  onStreamEvent({
    id: makeId('evt'),
    type: 'contextCompaction',
    label: '上下文压缩',
    detail: '发送前达到阈值，正在请求 AgentServer/backend 原生压缩。',
    contextWindowState: {
      ...preflightState,
      pendingCompact: true,
      status: 'compacting',
    },
    contextCompaction: {
      status: 'started',
      source: 'agentserver',
      backend: config.agentBackend,
      compactCapability: preflightState.compactCapability,
      before: preflightState,
      startedAt,
      reason: 'auto-threshold-before-send',
      message: '发送前达到阈值，正在请求 AgentServer/backend 原生压缩。',
    },
    createdAt: startedAt,
  });
  try {
    const compactResult = await compactAgentContext(request, 'auto-threshold-before-send', signal);
    const completedAt = nowIso();
    const outcome = buildContextCompactionOutcome({
      eventId: makeId('evt'),
      messageId: makeId('msg'),
      result: compactResult,
      beforeState: preflightState,
      reason: 'auto-threshold-before-send',
      startedAt,
      completedAt,
      fallbackBackend: config.agentBackend,
    });
    onStreamEvent(outcome.event);
  } catch (compactError) {
    if (compactError instanceof DOMException && compactError.name === 'AbortError') throw compactError;
    const completedAt = nowIso();
    const outcome = buildContextCompactionOutcome({
      eventId: makeId('evt'),
      messageId: makeId('msg'),
      result: buildContextCompactionFailureResult({
        error: compactError,
        reason: 'auto-threshold-before-send',
        backend: config.agentBackend,
        compactCapability: preflightState.compactCapability,
        startedAt,
      }),
      beforeState: preflightState,
      reason: 'auto-threshold-before-send',
      startedAt,
      completedAt,
      fallbackBackend: config.agentBackend,
    });
    onStreamEvent(outcome.event);
  }
}

export async function runWithBackendFallback(
  request: AgentRequest,
  signal: AbortSignal,
  onEvent: (event: AgentStreamEvent) => void,
  emitEvent: (event: AgentStreamEvent) => void,
) {
  try {
    return await sendSciForgeToolMessage(request, { onEvent }, signal);
  } catch (projectToolError) {
    const detail = projectToolError instanceof Error ? projectToolError.message : String(projectToolError);
    if (/cancel|abort|已取消|cancelled|canceled/i.test(detail)) throw projectToolError;
    emitEvent({
      id: makeId('evt'),
      type: 'project-tool-fallback',
      label: '项目工具',
      detail: `SciForge project tool unavailable, falling back to AgentServer: ${detail}`,
      createdAt: nowIso(),
      raw: { error: detail },
    });
    return sendAgentMessageStream(request, { onEvent }, signal);
  }
}

async function maybeRunBackendAcceptanceRepair({
  prompt,
  references,
  request,
  acceptedResponse,
  goalSnapshot,
  sessionBeforeMerge,
  onStreamEvent,
  signal,
  emitEvent,
}: {
  prompt: string;
  references: SciForgeReference[];
  request: AgentRequest;
  acceptedResponse: NormalizedAgentResponse;
  goalSnapshot: UserGoalSnapshot;
  sessionBeforeMerge: SciForgeSession;
  onStreamEvent: (event: AgentStreamEvent) => void;
  signal: AbortSignal;
  emitEvent: (event: AgentStreamEvent) => void;
}): Promise<NormalizedAgentResponse> {
  const acceptance = acceptedResponse.message.acceptance;
  if (!shouldRunBackendAcceptanceRepair(acceptance, 1)) return acceptedResponse;

  const startedAt = nowIso();
  const repairPrompt = buildBackendAcceptanceRepairPrompt({
    snapshot: goalSnapshot,
    acceptance: acceptance!,
    response: acceptedResponse,
    session: sessionBeforeMerge,
  });
  const action = acceptance!.failures.find((failure) => /artifact-repair|execution-repair/.test(failure.repairAction ?? ''))?.repairAction ?? 'artifact-repair';
  const baseHistory = acceptance!.repairHistory ?? [];
  emitEvent({
    id: makeId('evt'),
    type: 'acceptance-repair-start',
    label: '验收修复',
    detail: 'TurnAcceptanceGate 触发一次 backend artifact/execution repair rerun。',
    createdAt: startedAt,
    raw: { sourceRunId: acceptedResponse.run.id, failures: acceptance!.failures },
  });

  try {
    const repairResponse = await sendSciForgeToolMessage({
      ...request,
      prompt: repairPrompt,
      references,
      messages: [
        ...request.messages,
        {
          id: makeId('msg'),
          role: 'system',
          content: `Acceptance repair rerun for original user prompt: ${prompt}`,
          createdAt: startedAt,
          status: 'running',
          goalSnapshot,
        },
      ],
      artifacts: mergeRuntimeArtifacts(acceptedResponse.artifacts, request.artifacts ?? []),
      executionUnits: mergeExecutionUnits(acceptedResponse.executionUnits, request.executionUnits ?? []),
      runs: mergeRuns([acceptedResponse.run], request.runs ?? []),
    }, {
      onEvent: onStreamEvent,
    }, signal);
    const repairAccepted = acceptAndRepairAgentResponse({
      snapshot: goalSnapshot,
      response: {
        ...repairResponse,
        run: {
          ...repairResponse.run,
          references,
          goalSnapshot,
        },
        message: {
          ...repairResponse.message,
          goalSnapshot,
        },
      },
      session: {
        ...sessionBeforeMerge,
        artifacts: mergeRuntimeArtifacts(acceptedResponse.artifacts, sessionBeforeMerge.artifacts),
        executionUnits: mergeExecutionUnits(acceptedResponse.executionUnits, sessionBeforeMerge.executionUnits),
        runs: mergeRuns([acceptedResponse.run], sessionBeforeMerge.runs),
      },
    });
    const completedAt = nowIso();
    if (repairAccepted.message.acceptance?.pass && repairAccepted.run.status !== 'failed') {
      const repairHistory = [...baseHistory, {
        attempt: baseHistory.length + 1,
        action,
        status: 'completed' as const,
        startedAt,
        completedAt,
        sourceRunId: acceptedResponse.run.id,
        repairRunId: repairAccepted.run.id,
        failureCodes: acceptance!.failures.map((failure) => failure.code),
      }];
      return mergeRepairSuccessResponse(acceptedResponse, repairAccepted, repairHistory);
    }
    return failedAcceptanceRepairResponse(
      acceptedResponse,
      repairAccepted,
      action,
      startedAt,
      completedAt,
      baseHistory,
      repairAccepted.message.acceptance?.failures.map((failure) => `${failure.code}: ${failure.detail}`).join('; ')
        || repairAccepted.executionUnits.find((unit) => unit.failureReason)?.failureReason
        || 'repair rerun did not satisfy TurnAcceptanceGate',
    );
  } catch (error) {
    const completedAt = nowIso();
    const reason = error instanceof Error ? error.message : String(error);
    return failedAcceptanceRepairResponse(acceptedResponse, undefined, action, startedAt, completedAt, baseHistory, reason);
  }
}

function shouldValidateSemanticAcceptance(response: NormalizedAgentResponse) {
  const acceptance = response.message.acceptance;
  if (!acceptance || acceptance.pass) return false;
  return shouldRunBackendAcceptanceRepair(acceptance, 1);
}
