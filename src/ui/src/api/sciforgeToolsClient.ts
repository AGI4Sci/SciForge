import type { AgentStreamEvent, NormalizedAgentResponse, SendAgentMessageInput } from '../domain';
import type { ScenarioId } from '../data';
import { makeId, nowIso } from '../domain';
import { extractLatencyPolicy, extractResponsePlan, latencyThresholdsFromPolicy, type RuntimeLatencyThresholds } from '../latencyPolicy';
import { buildInitialResponseProgressEvent } from '../processProgress';
import { SCENARIO_SPECS } from '@sciforge/scenario-core/scenario-specs';
import { builtInScenarioIdForRuntimeInput, skillDomainForRuntimeInput } from '@sciforge/scenario-core/scenario-routing-policy';
import { expectedArtifactsForCurrentTurn, selectedComponentsForCurrentTurn } from '../artifactIntent';
import { normalizeAgentResponse } from './agentClient';
import { DEFAULT_AGENT_REQUEST_TIMEOUT_MS, buildSharedAgentHandoffContract } from '@sciforge-ui/runtime-contract/handoff';
import { buildAgentHandoffPayload } from '@sciforge-ui/runtime-contract/handoff-payload';
import { collectRuntimeRefsFromValue } from '@sciforge-ui/runtime-contract/references';
import {
  CURRENT_REFERENCE_EVIDENCE_POLICY_DEFAULT_ACTION,
  EXECUTION_LOG_REF_AUDIT_NOTE,
  EXECUTION_LOG_REF_EXPANSION_POLICY,
  buildSilentStreamDecisionRecord,
  buildSilentStreamRunId,
  normalizeTurnExecutionConstraints,
  projectToolDoneEvent,
  projectToolStartedEvent,
  type SilentStreamDecisionRecord,
  type TurnExecutionConstraints,
} from '@sciforge-ui/runtime-contract';
import { selectedToolContractForRuntime } from '@sciforge-skill/packages/tool-skills-runtime';
import {
  contextWindowTelemetryEvent,
  normalizeWorkspaceRuntimeEvent,
  readWorkspaceToolStream,
  toolEvent,
  withConfiguredContextWindowLimit,
  workspaceResultCompletion,
} from './sciforgeToolsClient/runtimeEvents';

const TRANSPORT_SESSION_MESSAGE_LIMIT = 12;
const TRANSPORT_RUN_LIMIT = 8;
const TRANSPORT_EXECUTION_UNIT_LIMIT = 16;
const TRANSPORT_ARTIFACT_LIMIT = 16;
const TRANSPORT_ARTIFACT_INLINE_DATA_BYTES = 12_000;
const TRANSPORT_TEXT_PREVIEW_CHARS = 500;
const TRANSPORT_REF_KEYS = ['ref', 'dataRef', 'path', 'filePath', 'markdownRef', 'contentRef', 'stdoutRef', 'stderrRef', 'outputRef'] as const;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return out.length ? out : undefined;
}

function uniqueStringList(values: unknown[]) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

export async function sendSciForgeToolMessage(
  input: SendAgentMessageInput,
  callbacks: { onEvent?: (event: AgentStreamEvent) => void } = {},
  signal?: AbortSignal,
): Promise<NormalizedAgentResponse> {
  const builtInScenarioId = builtInScenarioIdForRuntimeInput(input);
  const referenceSummary = (input.references ?? []).map(compactSciForgeReference);
  const artifactSummary = (input.artifacts ?? []).slice(-TRANSPORT_ARTIFACT_LIMIT).map(sanitizeTransportArtifact);
  const recentExecutionRefs = compactTransportExecutionUnits(input.executionUnits ?? []);
  const skillDomain = skillDomainForRuntimeInput(input);
  const configuredComponentIds = input.availableComponentIds?.length
    ? input.availableComponentIds
    : (input.scenarioOverride?.defaultComponents?.length
      ? input.scenarioOverride.defaultComponents
      : SCENARIO_SPECS[builtInScenarioId].componentPolicy.defaultComponents);
  const selectedComponentIds = selectedComponentsForCurrentTurn(input.prompt, configuredComponentIds);
  const turnExecutionConstraints = normalizeTurnExecutionConstraints(input.scenarioOverride?.turnExecutionConstraints);
  const selectedSkillIds = selectedRuntimeSkillIds(input, skillDomain, turnExecutionConstraints);
  const selectedToolIds = selectedRuntimeToolIds(input);
  const selectedToolContracts = selectedRuntimeToolContracts(selectedToolIds);
  const expectedArtifactTypes = expectedArtifactsForCurrentTurn({
    scenarioId: builtInScenarioId,
    prompt: input.prompt,
    selectedComponentIds,
  });
  const failureRecoveryPolicy = buildFailureRecoveryPolicy(input.executionUnits ?? [], input.runs ?? []);
  let activeRequestController: AbortController | undefined;
  let timedOut = false;
  let retryForSilentFirstEvent = false;
  let sawBackendEvent = false;
  let lastSilentNoticeAt = 0;
  let latencyThresholds = latencyThresholdsFromPolicy(undefined, {
    requestTimeoutMs: input.config.requestTimeoutMs || DEFAULT_AGENT_REQUEST_TIMEOUT_MS,
  });
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const requestStartedAt = Date.now();
  let timeoutExtensionCount = 0;
  const armRequestTimeout = (delayMs: number, thresholds: RuntimeLatencyThresholds) => {
    if (timeout) globalThis.clearTimeout(timeout);
    timeout = globalThis.setTimeout(() => {
      if (sawBackendEvent && !signal?.aborted) {
        timeoutExtensionCount += 1;
        const detail = `后端仍在产生运行事件；已把 ${thresholds.requestTimeoutMs}ms 请求超时转为软等待（第 ${timeoutExtensionCount} 次），避免中断长任务。`;
        callbacks.onEvent?.(toolEvent('backend-timeout-extended', detail, {
          requestTimeoutMs: thresholds.requestTimeoutMs,
          elapsedMs: Date.now() - requestStartedAt,
          extensionCount: timeoutExtensionCount,
        }));
        armRequestTimeout(Math.max(30_000, Math.min(thresholds.requestTimeoutMs, 60_000)), thresholds);
        return;
      }
      timedOut = true;
      activeRequestController?.abort();
    }, Math.max(0, delayMs));
  };
  const scheduleTimeout = (thresholds: RuntimeLatencyThresholds) => {
    const elapsed = Date.now() - requestStartedAt;
    armRequestTimeout(Math.max(0, thresholds.requestTimeoutMs - elapsed), thresholds);
  };
  scheduleTimeout(latencyThresholds);
  const linkedAbort = () => activeRequestController?.abort();
  signal?.addEventListener('abort', linkedAbort, { once: true });
  const silentStreamRunId = buildSilentStreamRunId({ sessionId: input.sessionId, prompt: input.prompt });
  let silentStreamDecision: SilentStreamDecisionRecord | undefined;
  const noteSilentDecision = (params: {
    decision: string;
    detail: string;
    elapsedMs: number;
    status?: string;
  }) => {
    silentStreamDecision = buildSilentStreamDecisionRecord({
      existing: silentStreamDecision,
      runId: silentStreamRunId,
      source: 'ui.transport.silenceWatchdog',
      layer: 'transport-watchdog',
      decision: params.decision,
      timeoutMs: latencyThresholds.silentRetryMs,
      elapsedMs: params.elapsedMs,
      status: params.status,
      maxRetries: 1,
      detail: params.detail,
      createdAt: nowIso(),
    });
    return silentStreamDecision;
  };
  let lastRealEventAt = Date.now();
  let emittedInitialResponseStatus = false;
  const silenceWatchdog = globalThis.setInterval(() => {
    const seconds = Math.round((Date.now() - lastRealEventAt) / 1000);
    if (seconds * 1000 < latencyThresholds.firstEventWarningMs || Date.now() - lastSilentNoticeAt < Math.min(18_000, latencyThresholds.firstEventWarningMs)) return;
    lastSilentNoticeAt = Date.now();
    const waitingDetail = `后端 ${seconds}s 没有输出新事件；HTTP stream 仍在等待 ${input.config.agentBackend || 'codex'} 返回。`;
    const waitingDecision = noteSilentDecision({
      decision: 'visible-status',
      detail: waitingDetail,
      elapsedMs: seconds * 1000,
      status: 'waiting-for-backend-event',
    });
    callbacks.onEvent?.(toolEvent('backend-silent', waitingDetail, {
      silentStreamRunId,
      silentStreamDecision: waitingDecision,
    }));
    if (!sawBackendEvent && seconds * 1000 >= latencyThresholds.silentRetryMs && !timedOut && !signal?.aborted && activeRequestController) {
      retryForSilentFirstEvent = true;
      const retryDetail = `首个后端事件 ${seconds}s 未返回；自动中断当前 HTTP stream 并重连一次，避免旧连接/死流让多轮任务挂起。`;
      const retryDecision = noteSilentDecision({
        decision: 'retry',
        detail: retryDetail,
        elapsedMs: seconds * 1000,
        status: 'retrying-first-backend-event',
      });
      callbacks.onEvent?.(toolEvent('backend-stream-retry', retryDetail, {
        silentStreamRunId,
        silentStreamDecision: retryDecision,
      }));
      activeRequestController.abort();
    }
  }, 10_000);
  try {
    callbacks.onEvent?.(toolEvent('current-plan', `当前计划：发送用户原始请求、显式引用和 session 事实到 workspace runtime；上下文选择、digest、能力筛选、验收和恢复由 Python conversation-policy 决定。`));
    callbacks.onEvent?.(projectToolStartedEvent({ id: makeId('evt'), createdAt: nowIso() }, builtInScenarioId));
    const sharedAgentContract = buildSharedAgentHandoffContract('ui-chat');
    const selectedSenseIds = selectedRuntimeSenseIds(input, selectedToolIds);
    const selectedActionIds = selectedRuntimeActionIds(input);
    const selectedVerifierIds = selectedRuntimeVerifierIds(input);
    const humanApprovalPolicy = configuredHumanApprovalPolicy(input);
    const unverifiedReason = asString(input.scenarioOverride?.unverifiedReason);
    const scenarioOverride = scenarioOverrideForTransport(input.scenarioOverride);
    const targetInstanceContext = compactTargetInstanceContext(input);
    const repairHandoffRunner = buildRepairHandoffRunnerPayload(input);
    const requestBody = buildAgentHandoffPayload({
      scenarioId: builtInScenarioId,
      handoffSource: 'ui-chat',
      scenarioPackageRef: input.scenarioPackageRef,
      skillPlanRef: input.skillPlanRef,
      uiPlanRef: input.uiPlanRef,
      skillDomain,
      agentBackend: input.config.agentBackend,
      prompt: input.prompt,
      workspacePath: input.config.workspacePath,
      agentServerBaseUrl: input.config.agentServerBaseUrl,
      modelProvider: input.config.modelProvider,
      modelName: input.config.modelName,
      maxContextWindowTokens: input.config.maxContextWindowTokens,
      llmEndpoint: buildToolLlmEndpoint(input),
      roleView: input.roleView,
      artifacts: artifactSummary,
      references: referenceSummary,
      availableSkills: selectedSkillIds,
      selectedToolIds,
      selectedToolContracts,
      selectedSenseIds,
      selectedActionIds,
      selectedVerifierIds,
      expectedArtifactTypes,
      selectedComponentIds,
      availableComponentIds: configuredComponentIds,
      artifactPolicy: undefined,
      referencePolicy: buildReferencePolicy(referenceSummary),
      failureRecoveryPolicy,
      humanApprovalPolicy,
      unverifiedReason,
      verificationResult: input.verificationResult,
      recentVerificationResults: input.recentVerificationResults,
      uiState: {
        sessionId: input.sessionId,
        sessionCreatedAt: input.sessionCreatedAt,
        sessionUpdatedAt: input.sessionUpdatedAt,
        silentStreamRunId,
        scopeCheck: {
          source: sharedAgentContract.source,
          decisionOwner: 'runtime-policy',
          dispatchPolicy: sharedAgentContract.dispatchPolicy,
          answerPolicy: sharedAgentContract.answerPolicy,
          note: 'SciForge dispatch is constrained by versioned current-turn policy records before any AgentServer generation is allowed.',
        },
        scenarioOverride,
        toolProviderRoutes: input.scenarioOverride?.toolProviderRoutes,
        scenarioPackageRef: input.scenarioPackageRef,
        skillPlanRef: input.skillPlanRef,
        uiPlanRef: input.uiPlanRef,
        currentPrompt: input.prompt,
        maxContextWindowTokens: input.config.maxContextWindowTokens,
        sessionMessages: stableSessionMessages(input),
        currentReferences: referenceSummary,
        targetInstance: targetInstanceContext,
        targetInstanceContext,
        repairHandoffRunner,
        turnExecutionConstraints,
        recentExecutionRefs,
        recentRuns: compactTransportRuns(input.runs ?? []),
        failureRecoveryPolicy,
        workspacePersistence: workspacePersistenceSummary(input),
        artifactExpectationMode: expectedArtifactTypes.length ? 'explicit-current-turn' : 'backend-decides',
        rawUserPrompt: input.prompt,
        contextPolicyOwner: 'python-conversation-policy',
        agentDispatchPolicy: 'runtime-policy-decides',
      },
      agentContext: buildTransportAgentContext(input, configuredComponentIds, selectedToolContracts, repairHandoffRunner),
    });
    const requestBodyText = JSON.stringify(requestBody);
    callbacks.onEvent?.(contextWindowTelemetryEvent(
      input,
      requestBodyText,
      'AgentServer handoff preflight estimate',
    ));
    let response: Response | undefined;
    let result: unknown;
    let error: string | undefined;
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      activeRequestController = new AbortController();
      retryForSilentFirstEvent = false;
      sawBackendEvent = false;
      lastRealEventAt = Date.now();
      lastSilentNoticeAt = 0;
      if (attempt > 1) {
        callbacks.onEvent?.(toolEvent('backend-stream-retry-start', `正在重连 workspace stream（第 ${attempt}/2 次），复用同一个请求 payload。`));
      }
      try {
        if (signal?.aborted) activeRequestController.abort();
        response = await fetch(`${input.config.workspaceWriterBaseUrl}/api/sciforge/tools/run/stream`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBodyText,
          signal: activeRequestController.signal,
        });
        const stream = await readWorkspaceToolStream(response, (event) => {
          sawBackendEvent = true;
          lastRealEventAt = Date.now();
          const normalized = withConfiguredContextWindowLimit(
            normalizeWorkspaceRuntimeEvent(event),
            input.config.maxContextWindowTokens,
          );
          const latencyPolicy = extractLatencyPolicy(normalized.raw);
          if (latencyPolicy) {
            latencyThresholds = latencyThresholdsFromPolicy(latencyPolicy, latencyThresholds);
            scheduleTimeout(latencyThresholds);
          }
          if (!emittedInitialResponseStatus) {
            const initialStatus = buildInitialResponseProgressEvent(extractResponsePlan(normalized.raw));
            if (initialStatus) {
              emittedInitialResponseStatus = true;
              callbacks.onEvent?.(initialStatus);
            }
          }
          callbacks.onEvent?.(normalized);
        });
        result = stream.result;
        error = stream.error;
        break;
      } catch (streamError) {
        if (retryForSilentFirstEvent && attempt < 2) {
          const retryDetail = '首个 stream 已中断；准备重新发送同一请求。';
          const retryDecision = noteSilentDecision({
            decision: 'retry',
            detail: retryDetail,
            elapsedMs: Date.now() - lastRealEventAt,
            status: 'retrying-first-backend-event',
          });
          callbacks.onEvent?.(toolEvent('backend-stream-retry', retryDetail, {
            silentStreamRunId,
            silentStreamDecision: retryDecision,
          }));
          continue;
        }
        throw streamError;
      }
    }
  if (!response?.ok || error || !isRecord(result)) {
    throw new Error(error || `SciForge project tool failed: HTTP ${response?.status ?? 'no-response'}`);
  }
  const completion = workspaceResultCompletion(result);
  callbacks.onEvent?.(projectToolDoneEvent({ id: makeId('evt'), createdAt: nowIso() }, builtInScenarioId, completion));
  return normalizeAgentResponse(builtInScenarioId, input.prompt, {
    ok: true,
    data: {
      run: {
        id: makeId(`project-${builtInScenarioId}`),
        status: completion.status,
        createdAt: nowIso(),
        completedAt: nowIso(),
        output: {
          result: JSON.stringify(result),
        },
      },
    },
  });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new Error(timedOut
        ? `SciForge project tool 超时：${input.config.requestTimeoutMs || DEFAULT_AGENT_REQUEST_TIMEOUT_MS}ms 内没有完成。流式面板已显示最后一个真实事件。`
        : 'SciForge project tool 已取消。');
    }
    throw error;
  } finally {
    if (timeout) globalThis.clearTimeout(timeout);
    globalThis.clearInterval(silenceWatchdog);
    signal?.removeEventListener('abort', linkedAbort);
  }
}

function compactTargetInstanceContext(input: SendAgentMessageInput) {
  const target = input.targetInstanceContext;
  if (!target) return undefined;
  return {
    mode: target.mode,
    banner: target.banner,
    selectedAt: target.selectedAt,
    peer: target.peer,
    issueLookup: target.issueLookup ? {
      trigger: target.issueLookup.trigger,
      query: target.issueLookup.query,
      workspaceWriterUrl: target.issueLookup.workspaceWriterUrl,
      workspacePath: target.issueLookup.workspacePath,
      matchedIssueId: target.issueLookup.matchedIssueId,
      githubIssueNumber: target.issueLookup.githubIssueNumber,
      status: target.issueLookup.status,
      error: target.issueLookup.error,
      summaries: target.issueLookup.summaries?.slice(0, 8).map((issue) => ({
        id: issue.id,
        title: issue.title,
        status: issue.status,
        priority: issue.priority,
        github: issue.github,
        runtime: issue.runtime,
        comment: issue.comment.slice(0, 360),
      })),
      bundle: target.issueLookup.bundle ? compactReferencePayload(target.issueLookup.bundle) : undefined,
    } : undefined,
    executionBoundary: target.mode === 'peer' ? {
      mode: 'repair-handoff-runner-target-worktree',
      targetWorkspacePath: target.peer?.workspacePath || undefined,
      targetWorkspaceWriterUrl: target.peer?.workspaceWriterUrl || undefined,
      preventExecutorWorkspaceFallback: true,
    } : undefined,
  };
}

function buildRepairHandoffRunnerPayload(input: SendAgentMessageInput) {
  const target = input.targetInstanceContext;
  const peer = target?.peer;
  const bundle = target?.issueLookup?.bundle;
  if (!target || target.mode !== 'peer' || !peer || !bundle || peer.trustLevel === 'readonly') return undefined;
  if (!peer.workspacePath.trim()) return undefined;
  return {
    endpoint: `${input.config.workspaceWriterBaseUrl.replace(/\/+$/, '')}/api/sciforge/repair-handoff/run`,
    method: 'POST',
    contract: {
      executorInstance: {
        id: 'current',
        name: input.agentName,
        workspaceWriterUrl: input.config.workspaceWriterBaseUrl,
        workspacePath: input.config.workspacePath,
      },
      targetInstance: {
        name: peer.name,
        appUrl: peer.appUrl,
        workspaceWriterUrl: peer.workspaceWriterUrl,
        workspacePath: peer.workspacePath,
      },
      targetWorkspacePath: peer.workspacePath,
      targetWorkspaceWriterUrl: peer.workspaceWriterUrl,
      issueBundle: bundle,
      expectedTests: [],
      githubSyncRequired: Boolean(bundle.github?.issueNumber || bundle.github?.issueUrl),
      agentServerBaseUrl: input.config.agentServerBaseUrl,
      executionBoundary: {
        mode: 'target-isolated-worktree',
        targetWorkspacePath: peer.workspacePath,
        targetWorkspaceWriterUrl: peer.workspaceWriterUrl,
        forbidExecutorWorkspace: true,
      },
    },
  };
}

function stableSessionMessages(input: SendAgentMessageInput) {
  return (input.messages ?? [])
    .filter((message) => !message.id.startsWith('seed'))
    .slice(-TRANSPORT_SESSION_MESSAGE_LIMIT)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: omittedTransportTextDigestLabel('session-message', message.content),
      contentDigest: transportTextDigest(message.content),
      createdAt: message.createdAt,
      status: message.status,
      references: message.references?.slice(-8).map(compactSciForgeReference),
      objectReferences: message.objectReferences?.slice(-12),
      guidanceQueue: message.guidanceQueue ? {
        ...message.guidanceQueue,
        prompt: omittedTransportTextDigestLabel('guidance-prompt', message.guidanceQueue.prompt),
        reason: message.guidanceQueue.reason ? omittedTransportTextDigestLabel('guidance-reason', message.guidanceQueue.reason) : undefined,
      } : undefined,
    }));
}

function compactConversationContent(value: string, maxChars = 1200) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxChars) return normalized;
  const headChars = Math.max(80, Math.floor(maxChars * 0.66));
  const tailChars = Math.max(40, maxChars - headChars);
  return `${normalized.slice(0, headChars)} ... [${normalized.length - maxChars} chars omitted] ... ${normalized.slice(-tailChars)}`;
}

function uniqueStrings(values: Array<string | undefined>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push(value);
  }
  return out;
}

function compactTransportExecutionUnits(units: NonNullable<SendAgentMessageInput['executionUnits']>) {
  return units.slice(-TRANSPORT_EXECUTION_UNIT_LIMIT).map((unit) => ({
    id: unit.id,
    tool: unit.tool,
    status: unit.status,
    hash: unit.hash,
    params: compactConversationContent(unit.params, 1000),
    codeRef: unit.codeRef,
    stdoutRef: unit.stdoutRef,
    stderrRef: unit.stderrRef,
    outputRef: unit.outputRef,
    diffRef: unit.diffRef,
    failureReason: unit.failureReason ? compactConversationContent(unit.failureReason, 1200) : undefined,
    patchSummary: unit.patchSummary ? compactConversationContent(unit.patchSummary, 800) : undefined,
    recoverActions: unit.recoverActions?.slice(-6).map((action) => compactConversationContent(action, 500)),
    nextStep: unit.nextStep ? compactConversationContent(unit.nextStep, 600) : undefined,
    verificationRef: unit.verificationRef,
    verificationVerdict: unit.verificationVerdict,
    routeDecision: unit.routeDecision,
    scenarioPackageRef: unit.scenarioPackageRef,
    skillPlanRef: unit.skillPlanRef,
    uiPlanRef: unit.uiPlanRef,
  }));
}

function compactTransportRuns(runs: NonNullable<SendAgentMessageInput['runs']>) {
  return runs.slice(-TRANSPORT_RUN_LIMIT).map((run) => ({
    id: run.id,
    scenarioId: run.scenarioId,
    status: run.status,
    prompt: omittedTransportTextDigestLabel('previous-run-prompt', run.prompt),
    response: omittedTransportTextDigestLabel('previous-run-response', run.response),
    promptDigest: transportTextDigest(run.prompt),
    responseDigest: transportTextDigest(run.response),
    createdAt: run.createdAt,
    completedAt: run.completedAt,
    references: run.references?.slice(-8).map(compactSciForgeReference),
    objectReferences: run.objectReferences?.slice(-12),
    scenarioPackageRef: run.scenarioPackageRef,
    skillPlanRef: run.skillPlanRef,
    uiPlanRef: run.uiPlanRef,
    guidanceQueue: run.guidanceQueue?.slice(-8).map((record) => ({
      ...record,
      prompt: compactConversationContent(record.prompt, 800),
      reason: record.reason ? compactConversationContent(record.reason, 500) : undefined,
    })),
    raw: compactTransportRunRaw(run.raw),
  }));
}

function compactTransportRunRaw(raw: unknown) {
  if (!isRecord(raw)) return undefined;
  const streamProcess = isRecord(raw.streamProcess) ? raw.streamProcess : undefined;
  const backgroundCompletion = isRecord(raw.backgroundCompletion) ? raw.backgroundCompletion : undefined;
  return {
    termination: compactTransportRawRecord(raw.termination),
    cancelBoundary: compactTransportRawRecord(raw.cancelBoundary),
    historicalEditConflict: compactTransportRawRecord(raw.historicalEditConflict),
    guidanceQueue: Array.isArray(raw.guidanceQueue)
      ? raw.guidanceQueue.slice(-8).map((entry) => compactTransportRawRecord(entry)).filter(Boolean)
      : undefined,
    backgroundCompletion: backgroundCompletion ? {
      status: asString(backgroundCompletion.status),
      stage: asString(backgroundCompletion.stage),
      runId: asString(backgroundCompletion.runId),
      termination: compactTransportRawRecord(backgroundCompletion.termination),
      lastEventSummary: compactTransportRawEventSummary(backgroundCompletion.lastEvent),
      refs: transportRefsFromValue(backgroundCompletion).slice(0, 16),
    } : undefined,
    refs: transportRefsFromValue(raw).slice(0, 24),
    bodySummary: {
      omitted: 'run-raw-body',
      keys: Object.keys(raw).slice(0, 16),
    },
    streamProcess: streamProcess ? {
      eventCount: typeof streamProcess.eventCount === 'number' ? streamProcess.eventCount : undefined,
      summaryDigest: compactTransportDigest(streamProcess.summaryDigest),
      eventTypes: Array.isArray(streamProcess.events)
        ? streamProcess.events.slice(-24).map(compactTransportRawEventSummary).filter(Boolean)
        : undefined,
    } : undefined,
  };
}

function compactTransportRawRecord(value: unknown) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const key of ['schemaVersion', 'id', 'status', 'reason', 'mode', 'sideEffectPolicy', 'nextStep', 'branchId', 'requiresUserConfirmation', 'handlingRunId']) {
    const entry = value[key];
    if (typeof entry === 'string' || typeof entry === 'boolean' || typeof entry === 'number') out[key] = entry;
  }
  const refs = transportRefsFromValue(value).slice(0, 12);
  if (refs.length) out.refs = refs;
  return Object.keys(out).length ? out : undefined;
}

function compactTransportRawEventSummary(value: unknown) {
  if (!isRecord(value)) return undefined;
  return {
    type: asString(value.type),
    status: asString(value.status),
    source: asString(value.source),
    messageDigest: transportTextDigest(value.message),
    refs: transportRefsFromValue(value).slice(0, 12),
  };
}

function transportRefsFromValue(value: unknown, depth = 0): string[] {
  return collectRuntimeRefsFromValue(value, { maxDepth: 5 - depth, maxRefs: 32, includeIds: true });
}

function transportTextDigest(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return {
    omitted: 'text-body',
    chars: value.length,
    hash: stableTextHash(value),
    refs: transportRefsFromValue(value).slice(0, 12),
  };
}

function compactTransportDigest(value: unknown) {
  if (!isRecord(value)) return undefined;
  const hash = asString(value.hash);
  if (!hash) return undefined;
  return {
    omitted: asString(value.omitted) ?? 'text-body',
    chars: typeof value.chars === 'number' ? value.chars : undefined,
    hash,
    refs: asStringArray(value.refs)?.slice(0, 12),
  };
}

function stableTextHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function selectedRuntimeSkillIds(
  input: SendAgentMessageInput,
  skillDomain: string,
  constraints?: TurnExecutionConstraints,
) {
  const overrideSkillIds = input.scenarioOverride?.selectedSkillIds ?? [];
  if (constraints?.agentServerForbidden) {
    return uniqueStrings(overrideSkillIds.filter((skillId) => !isAgentServerSkillId(skillId)));
  }
  return uniqueStrings([
    ...overrideSkillIds,
    `agentserver.generate.${skillDomain}`,
  ]);
}

function isAgentServerSkillId(value: string) {
  return /^agentserver(?:\.|$)/i.test(value.trim());
}

function selectedRuntimeToolIds(input: SendAgentMessageInput) {
  return uniqueStrings(input.scenarioOverride?.selectedToolIds ?? []);
}

function selectedRuntimeSenseIds(input: SendAgentMessageInput, selectedToolIds = selectedRuntimeToolIds(input)) {
  return uniqueStrings([
    ...(input.scenarioOverride?.selectedSenseIds ?? []),
    ...selectedToolIds.filter((id) => id.includes('sense')),
  ]);
}

function selectedRuntimeActionIds(input: SendAgentMessageInput) {
  return uniqueStrings(input.scenarioOverride?.selectedActionIds ?? []);
}

function selectedRuntimeVerifierIds(input: SendAgentMessageInput) {
  return uniqueStrings(input.scenarioOverride?.selectedVerifierIds ?? []);
}

function selectedRuntimeToolContracts(selectedToolIds: string[]) {
  return selectedToolIds.map(selectedToolContractForRuntime);
}

function buildReferencePolicy(references: Array<Record<string, unknown>>) {
  return {
    mode: 'explicit-refs-first',
    defaultAction: CURRENT_REFERENCE_EVIDENCE_POLICY_DEFAULT_ACTION,
    currentReferenceCount: references.length,
  };
}

function configuredHumanApprovalPolicy(input: SendAgentMessageInput) {
  const configured = input.scenarioOverride?.humanApprovalPolicy;
  return configured && isRecord(configured) ? configured : undefined;
}

function scenarioOverrideForTransport(input: SendAgentMessageInput['scenarioOverride']) {
  if (!input || !isRecord(input.verificationPolicy)) return input;
  const out = { ...input };
  delete out.verificationPolicy;
  return out;
}

function compactSciForgeReference(reference: NonNullable<SendAgentMessageInput['references']>[number]) {
  const payload = compactReferenceInlinePayload(reference);
  return {
    id: reference.id,
    kind: reference.kind,
    title: reference.title,
    ref: reference.ref,
    sourceId: reference.sourceId,
    runId: reference.runId,
    locator: reference.locator,
    summary: reference.summary,
    payload,
    payloadDigest: compactReferencePayload(reference.payload),
  };
}

function compactReferenceInlinePayload(reference: NonNullable<SendAgentMessageInput['references']>[number]) {
  const payload = isRecord(reference.payload) ? reference.payload : undefined;
  if (!payload) return undefined;
  const out: Record<string, unknown> = {};
  const composerMarker = clippedString(payload.composerMarker, 16);
  if (composerMarker) out.composerMarker = composerMarker;
  if (reference.kind === 'ui' && reference.ref.startsWith('ui-text:')) {
    const selectedText = clippedString(payload.selectedText, 2400);
    const sourceTitle = clippedString(payload.sourceTitle, 160);
    const sourceRef = clippedString(payload.sourceRef, 600);
    const sourceKind = clippedString(payload.sourceKind, 40);
    const sourceSummary = clippedString(payload.sourceSummary, 600);
    if (selectedText) out.selectedText = selectedText;
    if (sourceTitle) out.sourceTitle = sourceTitle;
    if (sourceRef) out.sourceRef = sourceRef;
    if (sourceKind) out.sourceKind = sourceKind;
    if (sourceSummary) out.sourceSummary = sourceSummary;
  }
  return Object.keys(out).length ? out : undefined;
}

function clippedString(value: unknown, maxChars: number) {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxChars ? `${trimmed.slice(0, maxChars)}...` : trimmed;
}

function compactReferencePayload(payload: unknown) {
  if (payload === undefined) return undefined;
  const stable = typeof payload === 'string'
    ? payload
    : JSON.stringify(compactTransportRecordValue(payload, 0));
  return {
    omitted: 'reference-payload-body',
    hash: stableTextHash(stable ?? String(payload)),
    shape: transportValueShape(payload),
    refs: transportRefsFromValue(payload).slice(0, 12),
  };
}

function transportValueShape(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { type: 'string', chars: value.length };
  if (typeof value === 'number') return { type: 'number' };
  if (typeof value === 'boolean') return { type: 'boolean' };
  if (value === null) return { type: 'null' };
  if (Array.isArray(value)) {
    return {
      type: 'array',
      length: value.length,
      itemTypes: Array.from(new Set(value.slice(0, 12).map((item) => Array.isArray(item) ? 'array' : item === null ? 'null' : typeof item))),
    };
  }
  if (!isRecord(value)) return { type: typeof value };
  const keys = Object.keys(value);
  return {
    type: 'object',
    keyCount: keys.length,
    keys: keys.slice(0, 12),
  };
}

function compactRecord(value: unknown) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 24)) {
    out[key] = compactTransportRecordValue(entry, 1);
  }
  return Object.keys(out).length ? out : undefined;
}

function compactTransportRecordValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return compactTransportString(value, TRANSPORT_TEXT_PREVIEW_CHARS);
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) {
    if (depth >= 4) return { omitted: 'array-depth-limit', count: value.length };
    return value.slice(0, 12).map((entry) => compactTransportRecordValue(entry, depth + 1));
  }
  if (!isRecord(value)) return undefined;
  if (depth >= 4) return { omitted: 'object-depth-limit', keys: Object.keys(value).slice(0, 12) };
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, depth <= 1 ? 16 : 8)) {
    out[key] = compactTransportRecordValue(entry, depth + 1);
  }
  if (Object.keys(value).length > Object.keys(out).length) {
    out.omittedKeyCount = Object.keys(value).length - Object.keys(out).length;
  }
  return out;
}

function compactTransportString(value: string, maxChars: number) {
  if (isDataUrl(value)) return '[image dataUrl omitted; use file/image refs instead]';
  return value.length > maxChars
    ? `${value.slice(0, maxChars)}... [${value.length - maxChars} chars omitted]`
    : value;
}

function sanitizeTransportValue(value: unknown, depth = 0): unknown {
  if (typeof value === 'string') return isDataUrl(value) ? '[image dataUrl omitted; use file/image refs instead]' : value;
  if (typeof value === 'number' || typeof value === 'boolean' || value == null) return value;
  if (Array.isArray(value)) return depth > 8 ? { omitted: 'array-depth-limit', count: value.length } : value.map((item) => sanitizeTransportValue(item, depth + 1));
  if (!isRecord(value)) return undefined;
  if (depth > 8) return { omitted: 'object-depth-limit' };
  return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeTransportValue(entry, depth + 1)]));
}

function sanitizeTransportArtifact(value: unknown): Record<string, unknown> {
  const artifact = sanitizeTransportValue(value) as Record<string, unknown>;
  if (!isRecord(value)) return artifact;
  const dataBytes = estimateTransportBytes(value.data);
  const refBacked = hasStableTransportRef(value) || (isRecord(value.metadata) && hasStableTransportRef(value.metadata));
  if (value.data !== undefined && (containsDataUrl(value.data) || refBacked || dataBytes > TRANSPORT_ARTIFACT_INLINE_DATA_BYTES)) {
    delete artifact.data;
    artifact.dataSummary = {
      omitted: containsDataUrl(value.data)
        ? 'binary-data-url'
        : refBacked
          ? 'ref-backed-artifact-data'
          : 'artifact-data-budget',
      estimatedBytes: dataBytes,
      ...transportRefsFromRecord(value),
      shape: transportDataShape(value.data),
    };
  }
  return artifact;
}

function estimateTransportBytes(value: unknown) {
  if (value === undefined) return 0;
  try {
    return new TextEncoder().encode(JSON.stringify(value)).length;
  } catch {
    return String(value).length;
  }
}

function hasStableTransportRef(value: Record<string, unknown>) {
  return TRANSPORT_REF_KEYS.some((key) => typeof value[key] === 'string' && value[key].trim().length > 0);
}

function transportRefsFromRecord(value: Record<string, unknown>) {
  const refs: Record<string, unknown> = {};
  for (const key of TRANSPORT_REF_KEYS) {
    const ref = typeof value[key] === 'string' && value[key].trim() ? value[key] : undefined;
    if (ref) refs[key] = ref;
  }
  return refs;
}

function transportDataShape(value: unknown): Record<string, unknown> {
  if (typeof value === 'string') return { kind: 'string', chars: value.length };
  if (Array.isArray(value)) return { kind: 'array', count: value.length, firstItem: transportDataShape(value[0]) };
  if (isRecord(value)) {
    const markdown = typeof value.markdown === 'string' ? value.markdown : undefined;
    return {
      kind: 'object',
      keys: Object.keys(value).slice(0, 16),
      markdownChars: markdown?.length,
    };
  }
  return { kind: typeof value };
}

function containsDataUrl(value: unknown): boolean {
  if (typeof value === 'string') return isDataUrl(value);
  if (Array.isArray(value)) return value.some(containsDataUrl);
  if (!isRecord(value)) return false;
  return Object.values(value).some(containsDataUrl);
}

function isDataUrl(value: string) {
  return /^data:image\/[a-z0-9.+-]+;base64,/i.test(value);
}

function safeWorkspaceName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

function workspacePersistenceSummary(input: SendAgentMessageInput) {
  const workspacePath = input.config.workspacePath.trim();
  const sessionId = input.sessionId;
  return {
    workspacePath,
    sciforgeDir: workspacePath ? `${workspacePath}/.sciforge` : '.sciforge',
    workspaceStateRef: '.sciforge/workspace-state.json',
    sessionBundlePattern: sessionId ? `.sciforge/sessions/YYYY-MM-DD_*_${safeWorkspaceName(sessionId)}/` : '.sciforge/sessions/YYYY-MM-DD_*_session/',
    sessionRef: sessionId ? `.sciforge/sessions/YYYY-MM-DD_*_${safeWorkspaceName(sessionId)}/records/session.json` : undefined,
    artifactDir: '.sciforge/sessions/<date>_<scenario>_<session>/artifacts/',
    dataDir: '.sciforge/sessions/<date>_<scenario>_<session>/data/',
    exportDir: '.sciforge/sessions/<date>_<scenario>_<session>/exports/',
    taskDir: '.sciforge/sessions/<date>_<scenario>_<session>/tasks/',
    taskResultDir: '.sciforge/sessions/<date>_<scenario>_<session>/task-results/',
    logDir: '.sciforge/sessions/<date>_<scenario>_<session>/logs/',
    note: 'Each multi-turn conversation must persist resources only inside its date-prefixed portable bundle under .sciforge/sessions/: records, task code, inputs/results, logs, artifacts, versions, data, and exports grouped together for packaging and restore.',
  };
}

function buildToolLlmEndpoint(input: SendAgentMessageInput) {
  const provider = input.config.modelProvider.trim();
  const modelName = input.config.modelName.trim();
  const baseUrl = input.config.modelBaseUrl.trim().replace(/\/+$/, '');
  const apiKey = input.config.apiKey.trim();
  const useNative = !provider || provider === 'native';
  if (!baseUrl && !modelName && !apiKey) return undefined;
  return {
    provider: useNative ? 'native' : provider,
    baseUrl: baseUrl || undefined,
    apiKey: apiKey || undefined,
    modelName: modelName || undefined,
  };
}

function buildTransportAgentContext(
  input: SendAgentMessageInput,
  availableComponentIds: string[],
  selectedToolContracts = selectedRuntimeToolContracts(selectedRuntimeToolIds(input)),
  repairHandoffRunner?: ReturnType<typeof buildRepairHandoffRunnerPayload>,
) {
  const targetInstanceContext = compactTargetInstanceContext(input);
  const scenario = input.scenarioOverride;
  return {
    scenario: scenario ? {
      title: scenario.title,
      goal: scenario.description,
      markdownPreview: compactConversationContent(scenario.scenarioMarkdown),
      markdownChars: scenario.scenarioMarkdown.length,
    } : undefined,
    currentReferences: (input.references ?? []).map(compactSciForgeReference),
    targetInstance: targetInstanceContext,
    targetInstanceContext,
    repairHandoffRunner,
    availableComponentIds,
    selectedToolIds: selectedRuntimeToolIds(input),
    toolProviderRoutes: input.scenarioOverride?.toolProviderRoutes,
    selectedToolContracts,
    sessionStats: {
      messageCount: input.messages.length,
      artifactCount: input.artifacts?.length ?? 0,
      executionUnitCount: input.executionUnits?.length ?? 0,
      runCount: input.runs?.length ?? 0,
    },
    workspacePersistence: workspacePersistenceSummary(input),
    failureRecoveryPolicy: buildFailureRecoveryPolicy(input.executionUnits ?? [], input.runs ?? []),
    notes: [
      'User prompt is carried separately as the authoritative request.',
      'The browser only transports UI/session facts; Python conversation-policy owns context selection, digests, capability brief, handoff, acceptance, and recovery.',
      EXECUTION_LOG_REF_AUDIT_NOTE,
      'When local.vision-sense is selected, treat it as an optional vision sense plugin: build text + screenshot/image modality requests, emit text-form Computer Use commands, and keep trace refs compact across follow-up turns.',
    ],
  };
}

function buildFailureRecoveryPolicy(executionUnits: unknown[], runs: unknown[]) {
  const failedUnits = executionUnits
    .filter(isRecord)
    .filter((unit) => {
      const status = asString(unit.status);
      return Boolean(asString(unit.failureReason))
        || status === 'failed'
        || status === 'failed-with-reason'
        || status === 'repair-needed';
    })
    .slice(-6);
  const failedRuns = runs
    .filter(isRecord)
    .filter((run) => asString(run.status) === 'failed')
    .slice(-4);
  if (!failedUnits.length && !failedRuns.length) return undefined;
  const attemptHistory = failedUnits.map((unit) => ({
    id: asString(unit.id),
    status: asString(unit.status),
    tool: asString(unit.tool),
    failureReason: asString(unit.failureReason) || asString(unit.selfHealReason),
    recoverActions: asStringArray(unit.recoverActions),
    nextStep: asString(unit.nextStep),
    codeRef: asString(unit.codeRef),
    outputRef: asString(unit.outputRef),
    stdoutRef: asString(unit.stdoutRef),
    stderrRef: asString(unit.stderrRef),
    evidenceRefs: uniqueStringList([
      asString(unit.codeRef),
      asString(unit.outputRef),
      asString(unit.stdoutRef),
      asString(unit.stderrRef),
      ...(asStringArray(unit.artifacts) ?? []),
      ...(asStringArray(unit.outputArtifacts) ?? []),
    ]),
  }));
  const latestFailedRun = failedRuns.findLast((run) => streamProcessSummaryFromRun(run) || transportTextDigest(run.response));
  const priorFailureReason = attemptHistory.findLast((attempt) => attempt.failureReason)?.failureReason
    || failedRunResponseDigestSummary(latestFailedRun)
    || (latestFailedRun ? streamProcessSummaryFromRun(latestFailedRun) : undefined);
  const recoverActions = uniqueStringList(attemptHistory.flatMap((attempt) => attempt.recoverActions ?? [])).slice(0, 6);
  const attemptHistoryRefs = uniqueStringList(attemptHistory.flatMap((attempt) => attempt.evidenceRefs ?? [])).slice(0, 12);
  return {
    mode: 'preserve-context',
    evidenceExpansionPolicy: {
      defaultAction: 'refs-and-digests-only',
      logRefs: EXECUTION_LOG_REF_EXPANSION_POLICY,
      artifactRefs: 'prefer dataRef, path, markdownRef, or currentReferenceDigests before reading full artifact bodies',
    },
    priorFailureReason: joinFailureAndProcessSummary(priorFailureReason, latestFailedRun ? streamProcessSummaryFromRun(latestFailedRun) : undefined),
    recoverActions,
    attemptHistoryRefs,
    attemptHistory,
    nextStep: attemptHistory.findLast((attempt) => attempt.nextStep)?.nextStep,
  };
}

function omittedTransportTextDigestLabel(label: string, value: string) {
  const digest = transportTextDigest(value);
  return digest?.hash
    ? `[${label} omitted; digest=${digest.hash}; chars=${digest.chars ?? value.length}]`
    : `[${label} omitted]`;
}

function failedRunResponseDigestSummary(run: Record<string, unknown> | undefined) {
  const digest = transportTextDigest(run?.response);
  return digest?.hash
    ? `Prior failed run response omitted from prompt payload; digest=${digest.hash}${digest.chars ? `, chars=${digest.chars}` : ''}.`
    : undefined;
}

function streamProcessSummaryFromRun(run: Record<string, unknown>) {
  const raw = isRecord(run.raw) ? run.raw : {};
  const streamProcess = isRecord(raw.streamProcess) ? raw.streamProcess : {};
  const digest = isRecord(streamProcess.summaryDigest) ? streamProcess.summaryDigest : undefined;
  const hash = asString(digest?.hash);
  const chars = typeof digest?.chars === 'number' ? digest.chars : undefined;
  return hash ? `Stream process transcript omitted from prompt payload; digest=${hash}${chars ? `, chars=${chars}` : ''}.` : undefined;
}

function joinFailureAndProcessSummary(reason: string | undefined, summary: string | undefined) {
  if (!reason) return summary;
  if (!summary || reason.includes(summary)) return reason;
  return `${reason}\n\n${summary}`;
}
