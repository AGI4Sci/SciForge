import { compactAgentContext } from '../../api/agentClient';
import { sendSciForgeToolMessage } from '../../api/sciforgeToolsClient';
import { buildContextCompactionFailureResult, buildContextCompactionOutcome } from '../../contextCompaction';
import { estimateContextWindowState, latestContextWindowState, shouldStartContextCompaction } from '../../contextWindow';
import type { ScenarioId } from '../../data';
import { latestLatencyPolicy, latestResponsePlan } from '../../latencyPolicy';
import { buildInitialResponseProgressEvent } from '../../processProgress';
import type {
  AgentStreamEvent,
  NormalizedAgentResponse,
  PeerInstance,
  ScenarioInstanceId,
  ScenarioPackageRef,
  ScenarioRuntimeOverride,
  SciForgeConfig,
  SciForgeMessage,
  SciForgeReference,
  SciForgeSession,
} from '../../domain';
import { makeId, nowIso } from '../../domain';
import { buildTargetInstanceContextForPrompt, targetIssueLookupFailureMessage } from './targetInstance';
import {
  appendFailedRunToSession,
  createOptimisticUserTurnSession,
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
  targetPeer?: PeerInstance;
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
  const { session: optimisticSession, userMessage } = createOptimisticUserTurnSession({
    baseSession: input.baseSession,
    prompt: input.prompt,
    references: input.references,
    targetInstanceLabel: input.targetPeer ? `${input.targetPeer.name} workspace` : undefined,
  });
  input.onOptimisticSession?.(optimisticSession);

  try {
    let latestRoundTokenUsage: AgentStreamEvent['usage'];
    const handleStreamEvent = (event: AgentStreamEvent) => {
      if (event.usage) latestRoundTokenUsage = event.usage;
      input.onStreamEvent(event);
    };
    const turnPayload = requestPayloadForTurn(optimisticSession, userMessage, input.references);
    const targetInstanceContext = await buildTargetInstanceContextForPrompt({
      config: input.config,
      peer: input.targetPeer,
      prompt: input.prompt,
    });
    const targetLookupFailure = targetIssueLookupFailureMessage(targetInstanceContext);
    if (targetLookupFailure) {
      input.onStreamEvent({
        id: makeId('evt'),
        type: 'target-issue-lookup-failed',
        label: '目标 issue',
        detail: targetLookupFailure,
        createdAt: nowIso(),
        raw: targetInstanceContext,
      });
      throw new Error(targetLookupFailure);
    }
    if (targetInstanceContext.mode === 'peer') {
      emitTargetInstanceEvents(targetInstanceContext, input.onStreamEvent);
    }
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
      targetInstanceContext,
    };

    const initialProgress = buildInitialResponseProgressEvent(latestResponsePlan(input.streamEvents));
    if (initialProgress) input.onStreamEvent(initialProgress);

    await runPreflightContextCompaction({
      baseSession: input.baseSession,
      config: input.config,
      request,
      streamEvents: input.streamEvents,
      signal: input.signal,
      onStreamEvent: input.onStreamEvent,
    });

    emitPeerRepairStage(targetInstanceContext, input.onStreamEvent, 'target-repair-modifying', '正在修改 B');
    const response = await runWithBackendFallback(request, input.signal, handleStreamEvent, input.onStreamEvent);
    emitPeerRepairStage(targetInstanceContext, input.onStreamEvent, 'target-repair-testing', '正在测试');
    emitPeerRepairStage(targetInstanceContext, input.onStreamEvent, 'target-repair-written-back', '已写回 B');
    const responseWithUsage = latestRoundTokenUsage
      ? { ...response, message: { ...response.message, tokenUsage: latestRoundTokenUsage } }
      : response;
    const responseWithReferences = {
      ...responseWithUsage,
      run: {
        ...responseWithUsage.run,
        references: input.references,
      },
      message: {
        ...responseWithUsage.message,
        references: responseWithUsage.message.references,
      },
    };
    return { status: 'completed', optimisticSession, finalResponse: responseWithReferences };
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

function emitTargetInstanceEvents(
  targetInstanceContext: Awaited<ReturnType<typeof buildTargetInstanceContextForPrompt>>,
  onStreamEvent: (event: AgentStreamEvent) => void,
) {
  const peerName = targetInstanceContext.peer?.name ?? 'B';
  if (targetInstanceContext.issueLookup?.bundle) {
    onStreamEvent({
      id: makeId('evt'),
      type: 'target-issue-read',
      label: '已读取 B issue',
      detail: `已从 ${peerName} 读取 issue bundle ${targetInstanceContext.issueLookup.matchedIssueId}。`,
      createdAt: nowIso(),
      raw: targetInstanceContext,
    });
    emitPeerRepairStage(targetInstanceContext, onStreamEvent, 'target-worktree-preparing', '正在准备 B worktree');
    return;
  }
  onStreamEvent({
    id: makeId('evt'),
    type: 'target-instance-context',
    label: '目标实例',
    detail: targetInstanceContext.issueLookup?.summaries
      ? `已从 ${peerName} 读取 ${targetInstanceContext.issueLookup.summaries.length} 条 issue 摘要。`
      : targetInstanceContext.banner,
    createdAt: nowIso(),
    raw: targetInstanceContext,
  });
}

function emitPeerRepairStage(
  targetInstanceContext: Awaited<ReturnType<typeof buildTargetInstanceContextForPrompt>>,
  onStreamEvent: (event: AgentStreamEvent) => void,
  type: string,
  label: string,
) {
  if (targetInstanceContext.mode !== 'peer' || !targetInstanceContext.issueLookup?.bundle) return;
  onStreamEvent({
    id: makeId('evt'),
    type,
    label,
    detail: `${label}：${targetInstanceContext.peer?.name ?? '目标实例'} / ${targetInstanceContext.issueLookup.matchedIssueId ?? targetInstanceContext.issueLookup.query}`,
    createdAt: nowIso(),
    raw: {
      targetInstance: targetInstanceContext.peer,
      issueId: targetInstanceContext.issueLookup.matchedIssueId,
      executionBoundary: 'repair-handoff-runner-target-worktree',
    },
  });
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
  const latencyPolicy = latestLatencyPolicy(streamEvents);
  const blockOnContextCompaction = latencyPolicy?.blockOnContextCompaction !== false;
  onStreamEvent({
    id: makeId('evt'),
    type: 'contextCompaction',
    label: '上下文压缩',
    detail: blockOnContextCompaction
      ? '发送前达到阈值，正在请求 AgentServer/backend 原生压缩。'
      : '发送前达到阈值，已启动非阻塞上下文压缩；当前请求继续发送。',
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
      message: blockOnContextCompaction
        ? '发送前达到阈值，正在请求 AgentServer/backend 原生压缩。'
        : '发送前达到阈值，已启动非阻塞上下文压缩；当前请求继续发送。',
    },
    raw: { latencyPolicy: { blockOnContextCompaction } },
    createdAt: startedAt,
  });
  const compact = async () => {
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
      if (compactError instanceof DOMException && compactError.name === 'AbortError' && blockOnContextCompaction) throw compactError;
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
  };
  if (!blockOnContextCompaction) {
    void compact();
    return;
  }
  await compact();
}

export function shouldBlockOnPreflightContextCompaction(events: AgentStreamEvent[]) {
  return latestLatencyPolicy(events)?.blockOnContextCompaction !== false;
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
      type: 'project-tool-failed',
      label: '项目工具',
      detail: `SciForge project tool unavailable: ${detail}`,
      createdAt: nowIso(),
      raw: { error: detail },
    });
    throw projectToolError;
  }
}
