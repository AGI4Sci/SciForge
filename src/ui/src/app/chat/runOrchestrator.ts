import { compactAgentContext } from '../../api/agentClient';
import { sendSciForgeToolMessage } from '../../api/sciforgeToolsClient';
import type { CodexRealtimeControlSender } from '../../api/sciforgeToolsClient/codexRealtimeSession';
import { buildContextCompactionFailureResult, buildContextCompactionOutcome } from '../../contextCompaction';
import {
  projectToolFailedEvent,
  normalizeRunTermination,
  runtimeDetailIndicatesAbort,
  targetInstanceContextEvent,
  targetIssueLookupFailedEvent,
  targetIssueReadEvent,
  targetRepairModifyingEvent,
  targetRepairTestingEvent,
  targetRepairWrittenBackEvent,
  targetWorktreePreparingEvent,
} from '@sciforge-ui/runtime-contract';
import { estimateContextWindowState, latestContextWindowState, shouldStartContextCompaction } from '../../contextWindow';
import type { ScenarioId } from '../../data';
import { latestLatencyPolicy, latestResponsePlan } from '../../latencyPolicy';
import { buildInitialResponseProgressEvent } from '../../processProgress';
import { hasAnnotationPlanOnlyEnvelopeMarker, isAnnotationPlanOnlyEnvelope } from '../../feedback/annotationPlanModel';
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
  ComposerDeclaredIntentSnapshot,
  ConversationTurnMode,
  RuntimeResumePolicy,
  AgentHostWindowActionHandoff,
  AgentHostWindowActionHandoffBounds,
  AgentHostWindowActionHandoffRef,
} from '../../domain';
import { makeId, nowIso } from '../../domain';
import { buildTargetInstanceContextForPrompt, targetIssueLookupFailureMessage } from './targetInstance';
import {
  appendFailedRunToSession,
  createOptimisticUserTurnSession,
  requestPayloadForTurn,
} from './sessionTransforms';

type AgentRequest = Parameters<typeof sendSciForgeToolMessage>[0];
type TargetInstanceContext = Awaited<ReturnType<typeof buildTargetInstanceContextForPrompt>>;
type TargetRepairStageEventBuilder = typeof targetRepairModifyingEvent;

const HIGH_CONFIDENCE_AUTO_BOUND_THRESHOLD = 0.9;

function runtimeEventIdentity() {
  return { id: makeId('evt'), createdAt: nowIso() };
}

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
  composerDeclaredIntents?: ComposerDeclaredIntentSnapshot;
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
  onRealtimeControlReady?: (sender: CodexRealtimeControlSender) => void;
  turnMode?: ConversationTurnMode;
  conversationEnvelope?: unknown;
  conversationLaneId?: string;
  runtimeResumePolicy?: RuntimeResumePolicy;
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
    if (isAnnotationPlanOnlyTurn(input)) {
      const response = buildAnnotationPlanOnlyOrchestratorResponse(input);
      handleStreamEvent(annotationPlanOnlyEvent(input, response.run.id));
      return { status: 'completed', optimisticSession, finalResponse: response };
    }
    const turnPayload = requestPayloadForTurn(optimisticSession, userMessage, input.references);
    const targetInstanceContext = await buildTargetInstanceContextForPrompt({
      config: input.config,
      peer: input.targetPeer,
      prompt: input.prompt,
    });
    const targetLookupFailure = targetIssueLookupFailureMessage(targetInstanceContext);
    if (targetLookupFailure) {
      input.onStreamEvent(targetIssueLookupFailedEvent(runtimeEventIdentity(), targetLookupFailure, targetInstanceContext));
      throw new Error(targetLookupFailure);
    }
    if (targetInstanceContext.mode === 'peer') {
      emitTargetInstanceEvents(targetInstanceContext, input.onStreamEvent);
    }
    const request: AgentRequest = {
      sessionId: optimisticSession.sessionId,
      sessionCreatedAt: optimisticSession.createdAt,
      sessionUpdatedAt: optimisticSession.updatedAt,
      currentTurnId: userMessage.id,
      scenarioId: input.scenarioId,
      agentName: input.scenarioName,
      agentDomain: input.scenarioDomain,
      prompt: input.prompt,
      references: input.references,
      roleView: input.role,
      messages: turnPayload.messages,
      artifacts: turnPayload.artifacts,
      claims: turnPayload.claims,
      executionUnits: turnPayload.executionUnits,
      runs: turnPayload.runs,
      config: input.config,
      scenarioOverride: input.scenarioOverride,
      composerDeclaredIntents: input.composerDeclaredIntents,
      availableComponentIds: input.availableComponentIds,
      scenarioPackageRef: input.scenarioPackageRef,
      skillPlanRef: input.skillPlanRef,
      uiPlanRef: input.uiPlanRef,
      targetInstanceContext,
      turnMode: input.turnMode,
      conversationEnvelope: input.conversationEnvelope,
      conversationLaneId: input.conversationLaneId,
      runtimeResumePolicy: input.runtimeResumePolicy,
      windowActionHandoff: buildAnnotationWindowActionHandoff({
        references: input.references,
        turnMode: input.turnMode,
        conversationEnvelope: input.conversationEnvelope,
        conversationLaneId: input.conversationLaneId,
        currentTurnId: userMessage.id,
      }),
    };

    const initialProgress = buildInitialResponseProgressEvent(latestResponsePlan(input.streamEvents), input.config.locale);
    if (initialProgress) input.onStreamEvent(initialProgress);

    await runPreflightContextCompaction({
      baseSession: input.baseSession,
      config: input.config,
      request,
      streamEvents: input.streamEvents,
      signal: input.signal,
      onStreamEvent: input.onStreamEvent,
    });

    emitPeerRepairStage(targetInstanceContext, input.onStreamEvent, targetRepairModifyingEvent);
    const response = await runWithProjectBackend(request, input.signal, handleStreamEvent, input.onStreamEvent, input.onRealtimeControlReady);
    emitPeerRepairStage(targetInstanceContext, input.onStreamEvent, targetRepairTestingEvent);
    emitPeerRepairStage(targetInstanceContext, input.onStreamEvent, targetRepairWrittenBackEvent);
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
    const wasSystemInterrupted = !wasUserInterrupted && (input.signal.aborted || runtimeDetailIndicatesAbort(rawMessage));
    const termination = normalizeRunTermination({
      detail: rawMessage,
      userRequested: wasUserInterrupted,
      aborted: wasSystemInterrupted,
      timedOut: /timeout|timed out|deadline|超时/i.test(rawMessage),
      backendError: !wasUserInterrupted && !wasSystemInterrupted,
    });
    const message = wasUserInterrupted
      ? 'You stopped the current task.'
      : wasSystemInterrupted
        ? `The current task was interrupted by the system or network: ${rawMessage}`
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
      termination,
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

function isAnnotationPlanOnlyTurn(input: RunPromptOrchestratorInput) {
  if (hasAnnotationPlanOnlyEnvelopeMarker(input.conversationEnvelope) && !isAnnotationPlanOnlyEnvelope(input.conversationEnvelope)) {
    throw new Error('Malformed annotation-plan-only envelope: refusing to continue as a normal runtime turn.');
  }
  return input.turnMode === 'annotation-plan-only'
    || isAnnotationPlanOnlyEnvelope(input.conversationEnvelope);
}

export function buildAnnotationWindowActionHandoff(input: {
  references: SciForgeReference[];
  turnMode?: ConversationTurnMode;
  conversationEnvelope?: unknown;
  conversationLaneId?: string;
  currentTurnId?: string;
}): AgentHostWindowActionHandoff | undefined {
  const intent = annotationWindowActionIntent(input);
  if (!intent) return undefined;
  const promotedRefs = input.references
    .map(annotationWindowActionHandoffRef)
    .filter((ref): ref is AgentHostWindowActionHandoffRef => Boolean(ref));
  if (!promotedRefs.length) return undefined;
  return {
    schemaVersion: 'sciforge.window-action-handoff.v1',
    source: 'run-orchestrator',
    mode: 'enter-or-reuse-window-action-session',
    intent,
    actionFlowRef: windowActionFlowRef(input),
    highConfidenceThreshold: HIGH_CONFIDENCE_AUTO_BOUND_THRESHOLD,
    promotedRefs,
  };
}

function annotationWindowActionIntent(input: {
  turnMode?: ConversationTurnMode;
  conversationEnvelope?: unknown;
}): AgentHostWindowActionHandoff['intent'] | undefined {
  if (input.turnMode === 'annotation-quick-action') return 'annotation-quick-action';
  const envelope = recordFromUnknown(input.conversationEnvelope);
  if (
    envelope?.windowActionHandoff === true
    || envelope?.windowActionIntent === 'modify'
    || envelope?.modificationIntent === true
  ) return 'explicit-modification';
  return undefined;
}

function windowActionFlowRef(input: { conversationLaneId?: string; currentTurnId?: string }) {
  const flowId = safeRefPart(input.conversationLaneId ?? input.currentTurnId ?? 'annotation-quick-action');
  return `window-action-flow:${flowId || 'annotation-quick-action'}`;
}

function annotationWindowActionHandoffRef(reference: SciForgeReference): AgentHostWindowActionHandoffRef | undefined {
  const payload = recordFromUnknown(reference.payload);
  if (!payload) return undefined;
  const binding = promotedAnnotationWindowBinding(payload.windowBinding, payload);
  if (!binding) return undefined;
  const ref = safeHandoffRef(reference.ref);
  const referenceId = boundedText(reference.id, 96);
  const title = boundedText(reference.title, 120);
  if (!ref || !referenceId || !title) return undefined;
  const sourceKind = boundedText(stringFromUnknown(payload.sourceKind), 64);
  const annotationRef = safeHandoffRef(payload.annotationRef);
  const imageRef = safeHandoffRef(payload.imageRef);
  const screenshotRef = safeHandoffRef(payload.screenshotRef);
  const cropRef = safeHandoffRef(payload.cropRef);
  const targetRef = safeHandoffRef(payload.targetRef);
  const evidenceRefs = uniqueEvidenceRefs([
    annotationRef ? { kind: 'annotation', ref: annotationRef } : undefined,
    screenshotRef ? { kind: 'screenshot', ref: screenshotRef } : undefined,
    cropRef ? { kind: 'crop', ref: cropRef } : undefined,
    imageRef ? { kind: 'image', ref: imageRef } : undefined,
    targetRef ? { kind: 'target', ref: targetRef } : undefined,
  ]);
  return {
    referenceId,
    ref,
    title,
    ...(sourceKind ? { sourceKind } : {}),
    ...(annotationRef ? { annotationRef } : {}),
    ...(imageRef ? { imageRef } : {}),
    ...(screenshotRef ? { screenshotRef } : {}),
    ...(cropRef ? { cropRef } : {}),
    ...(targetRef ? { targetRef } : {}),
    evidenceRefs,
    windowBinding: binding,
  };
}

function promotedAnnotationWindowBinding(
  value: unknown,
  payload: Record<string, unknown>,
): AgentHostWindowActionHandoffRef['windowBinding'] | undefined {
  const record = recordFromUnknown(value);
  if (!record) return undefined;
  const status = stringFromUnknown(record.status);
  if (status !== 'manual-bound' && status !== 'auto-bound') return undefined;
  const confidence = numberFromUnknown(record.confidence);
  if (status === 'auto-bound' && (confidence === undefined || confidence < HIGH_CONFIDENCE_AUTO_BOUND_THRESHOLD)) return undefined;
  const windowRef = safeHandoffRef(record.windowRef);
  if (!windowRef) return undefined;
  const appName = boundedText(stringFromUnknown(record.appName), 80);
  const bundleId = boundedText(stringFromUnknown(record.bundleId), 120);
  const title = boundedText(stringFromUnknown(record.title), 160);
  const reason = boundedText(stringFromUnknown(record.reason), 160);
  const screenId = boundedText(stringFromUnknown(record.screenId) ?? stringFromUnknown(payload.displayId), 80);
  const scale = numberFromUnknown(record.scale) ?? numberFromUnknown(payload.scale);
  const pid = integerFromUnknown(record.pid);
  const windowBounds = boundsFromUnknown(record.windowBounds ?? payload.windowBounds);
  const windowLocalBounds = boundsFromUnknown(record.windowLocalBounds ?? payload.windowLocalBounds);
  return {
    status,
    ...(confidence !== undefined ? { confidence } : {}),
    ...(reason ? { reason } : {}),
    windowRef,
    ...(appName ? { appName } : {}),
    ...(bundleId ? { bundleId } : {}),
    ...(pid !== undefined ? { pid } : {}),
    ...(title ? { title } : {}),
    ...(screenId ? { screenId } : {}),
    ...(scale !== undefined ? { scale } : {}),
    ...(windowBounds ? { windowBounds } : {}),
    ...(windowLocalBounds ? { windowLocalBounds } : {}),
  };
}

function recordFromUnknown(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function stringFromUnknown(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberFromUnknown(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? Number(value) : undefined;
}

function integerFromUnknown(value: unknown) {
  const number = numberFromUnknown(value);
  return number === undefined ? undefined : Math.trunc(number);
}

function boundsFromUnknown(value: unknown): AgentHostWindowActionHandoffBounds | undefined {
  const record = recordFromUnknown(value);
  if (!record) return undefined;
  const x = numberFromUnknown(record.x);
  const y = numberFromUnknown(record.y);
  const width = numberFromUnknown(record.width);
  const height = numberFromUnknown(record.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return {
    x,
    y,
    width: Math.max(1, width),
    height: Math.max(1, height),
  };
}

function safeHandoffRef(value: unknown) {
  const text = stringFromUnknown(value);
  if (!text) return undefined;
  if (!/^[a-z][a-z0-9+.-]*:[a-z0-9][a-z0-9._:/#?-]*$/i.test(text)) return undefined;
  if (/^(?:data|https?):/i.test(text)) return undefined;
  return text.slice(0, 240);
}

function safeRefPart(value: string) {
  return value.trim().replace(/[^a-z0-9._:-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 96).toLowerCase();
}

function boundedText(value: string | undefined, max: number) {
  if (!value) return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  return text ? text.slice(0, max) : undefined;
}

function uniqueEvidenceRefs(values: Array<{ kind: string; ref: string } | undefined>) {
  const seen = new Set<string>();
  const output: Array<{ kind: string; ref: string }> = [];
  for (const value of values) {
    if (!value) continue;
    const key = `${value.kind}\n${value.ref}`;
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(value);
  }
  return output.slice(0, 8);
}

function buildAnnotationPlanOnlyOrchestratorResponse(input: RunPromptOrchestratorInput): NormalizedAgentResponse {
  const completedAt = nowIso();
  const draftText = input.prompt.trim();
  const referenceMarkers = input.references
    .map((reference, index) => `※${index + 1} ${reference.title}`)
    .join('、');
  const content = [
    '已按 annotation-plan-only policy 处理：本轮只整理澄清问题、选择项、摘要和 feedback draft。',
    '不会启动 Runtime/Codex 执行、repair、workspace write 或 GitHub sync。',
    draftText ? `当前草稿：${draftText}` : undefined,
    referenceMarkers ? `关联对象：${referenceMarkers}` : undefined,
  ].filter(Boolean).join('\n');
  const raw = {
    turnMode: 'annotation-plan-only',
    source: 'runPromptOrchestrator',
    sideEffects: 'forbidden',
    conversationEnvelope: input.conversationEnvelope ?? null,
    allowedOutputs: ['clarifying-question', 'plan-summary', 'feedback-draft', 'acceptance-criteria'],
    forbiddenSideEffects: ['workspace-write', 'repair-start', 'runtime-execution', 'github-sync', 'code-change'],
  };
  return {
    message: {
      id: makeId('msg'),
      role: 'scenario',
      content,
      references: input.references,
      createdAt: completedAt,
      updatedAt: completedAt,
      status: 'completed',
      provenance: {
        kind: 'annotation-plan-only',
        source: 'runPromptOrchestrator',
        runtimeRequestEligible: false,
        liveAcceptanceEligible: false,
        conversationEnvelope: input.conversationEnvelope ?? null,
      },
    },
    run: {
      id: makeId('run'),
      scenarioId: input.scenarioId,
      scenarioPackageRef: input.scenarioPackageRef,
      skillPlanRef: input.skillPlanRef,
      uiPlanRef: input.uiPlanRef,
      status: 'completed',
      prompt: input.prompt,
      response: content,
      references: input.references,
      createdAt: completedAt,
      completedAt,
      raw,
    },
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
  };
}

function annotationPlanOnlyEvent(input: RunPromptOrchestratorInput, runId: string): AgentStreamEvent {
  return {
    id: makeId('evt'),
    type: 'annotation-plan-only',
    label: 'Annotation plan',
    detail: 'annotation-plan-only policy handled locally; runtime transport, repair, workspace writes, and GitHub sync were skipped.',
    raw: {
      runId,
      scenarioId: input.scenarioId,
      conversationEnvelope: input.conversationEnvelope ?? null,
      runtimeRequestEligible: false,
      sideEffects: 'forbidden',
    },
    createdAt: nowIso(),
  };
}

function emitTargetInstanceEvents(
  targetInstanceContext: TargetInstanceContext,
  onStreamEvent: (event: AgentStreamEvent) => void,
) {
  const peerName = targetInstanceContext.peer?.name ?? 'B';
  if (targetInstanceContext.issueLookup?.bundle) {
    onStreamEvent(targetIssueReadEvent(runtimeEventIdentity(), {
      peerName,
      issueId: targetInstanceContext.issueLookup.matchedIssueId,
      raw: targetInstanceContext,
    }));
    emitPeerRepairStage(targetInstanceContext, onStreamEvent, targetWorktreePreparingEvent);
    return;
  }
  onStreamEvent(targetInstanceContextEvent(runtimeEventIdentity(), {
    peerName,
    summaryCount: targetInstanceContext.issueLookup?.summaries?.length,
    banner: targetInstanceContext.banner,
    raw: targetInstanceContext,
  }));
}

function emitPeerRepairStage(
  targetInstanceContext: TargetInstanceContext,
  onStreamEvent: (event: AgentStreamEvent) => void,
  buildEvent: TargetRepairStageEventBuilder,
) {
  if (targetInstanceContext.mode !== 'peer' || !targetInstanceContext.issueLookup?.bundle) return;
  onStreamEvent(buildEvent(runtimeEventIdentity(), {
    targetName: targetInstanceContext.peer?.name ?? '目标实例',
    issueRef: targetInstanceContext.issueLookup.matchedIssueId ?? targetInstanceContext.issueLookup.query,
    targetInstance: targetInstanceContext.peer,
    issueId: targetInstanceContext.issueLookup.matchedIssueId,
  }));
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
      label: 'Context',
      detail: blockOnContextCompaction
      ? 'Context is being compacted before sending.'
      : 'Context compaction started in the background; the request will continue.',
    contextWindowState: {
      ...preflightState,
      pendingCompact: true,
      status: 'compacting',
    },
    contextCompaction: {
      status: 'started',
      source: 'native',
      backend: config.agentBackend,
      compactCapability: preflightState.compactCapability,
      before: preflightState,
      startedAt,
      reason: 'auto-threshold-before-send',
      message: blockOnContextCompaction
        ? 'Context is being compacted before sending.'
        : 'Context compaction started in the background; the request will continue.',
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

export async function runWithProjectBackend(
  request: AgentRequest,
  signal: AbortSignal,
  onEvent: (event: AgentStreamEvent) => void,
  emitEvent: (event: AgentStreamEvent) => void,
  onRealtimeControlReady?: (sender: CodexRealtimeControlSender) => void,
) {
  try {
    return await sendSciForgeToolMessage(request, { onEvent, onRealtimeControlReady }, signal);
  } catch (projectToolError) {
    const detail = projectToolError instanceof Error ? projectToolError.message : String(projectToolError);
    if (runtimeDetailIndicatesAbort(detail)) throw projectToolError;
    emitEvent(projectToolFailedEvent(runtimeEventIdentity(), detail));
    throw projectToolError;
  }
}
