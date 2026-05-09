import type { AgentStreamEvent, NormalizedAgentResponse, SendAgentMessageInput } from '../domain';
import type { ScenarioId } from '../data';
import { makeId, nowIso } from '../domain';
import { extractLatencyPolicy, extractResponsePlan, latencyThresholdsFromPolicy, type RuntimeLatencyThresholds } from '../latencyPolicy';
import { buildInitialResponseProgressEvent } from '../processProgress';
import { SCENARIO_SPECS } from '@sciforge/scenario-core/scenario-specs';
import { expectedArtifactsForCurrentTurn, selectedComponentsForCurrentTurn } from '../artifactIntent';
import { normalizeAgentResponse } from './agentClient';
import { DEFAULT_AGENT_REQUEST_TIMEOUT_MS, buildSharedAgentHandoffContract } from '@sciforge-ui/runtime-contract/handoff';
import { buildAgentHandoffPayload } from '@sciforge-ui/runtime-contract/handoff-payload';
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
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const referenceSummary = (input.references ?? []).map(compactSciForgeReference);
  const artifactSummary = (input.artifacts ?? []).slice(-TRANSPORT_ARTIFACT_LIMIT).map(sanitizeTransportArtifact);
  const recentExecutionRefs = compactTransportExecutionUnits(input.executionUnits ?? []);
  const skillDomain = input.scenarioOverride?.skillDomain ?? SCENARIO_SPECS[builtInScenarioId].skillDomain;
  const configuredComponentIds = input.availableComponentIds?.length
    ? input.availableComponentIds
    : (input.scenarioOverride?.defaultComponents?.length
      ? input.scenarioOverride.defaultComponents
      : SCENARIO_SPECS[builtInScenarioId].componentPolicy.defaultComponents);
  const selectedComponentIds = selectedComponentsForCurrentTurn(input.prompt, configuredComponentIds);
  const selectedSkillIds = selectedRuntimeSkillIds(input, skillDomain);
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
  const scheduleTimeout = (thresholds: RuntimeLatencyThresholds) => {
    if (timeout) globalThis.clearTimeout(timeout);
    const elapsed = Date.now() - requestStartedAt;
    const remaining = Math.max(0, thresholds.requestTimeoutMs - elapsed);
    timeout = globalThis.setTimeout(() => {
      timedOut = true;
      activeRequestController?.abort();
    }, remaining);
  };
  scheduleTimeout(latencyThresholds);
  const linkedAbort = () => activeRequestController?.abort();
  signal?.addEventListener('abort', linkedAbort, { once: true });
  let lastRealEventAt = Date.now();
  let emittedInitialResponseStatus = false;
  const silenceWatchdog = globalThis.setInterval(() => {
    const seconds = Math.round((Date.now() - lastRealEventAt) / 1000);
    if (seconds * 1000 < latencyThresholds.firstEventWarningMs || Date.now() - lastSilentNoticeAt < Math.min(18_000, latencyThresholds.firstEventWarningMs)) return;
    lastSilentNoticeAt = Date.now();
    callbacks.onEvent?.(toolEvent('backend-silent', `后端 ${seconds}s 没有输出新事件；HTTP stream 仍在等待 ${input.config.agentBackend || 'codex'} 返回。`));
    if (!sawBackendEvent && seconds * 1000 >= latencyThresholds.silentRetryMs && !timedOut && !signal?.aborted && activeRequestController) {
      retryForSilentFirstEvent = true;
      callbacks.onEvent?.(toolEvent('backend-stream-retry', `首个后端事件 ${seconds}s 未返回；自动中断当前 HTTP stream 并重连一次，避免旧连接/死流让多轮任务挂起。`));
      activeRequestController.abort();
    }
  }, 10_000);
  try {
    callbacks.onEvent?.(toolEvent('current-plan', `当前计划：发送用户原始请求、显式引用和 session 事实到 workspace runtime；上下文选择、digest、能力筛选、验收和恢复由 Python conversation-policy 决定。`));
    callbacks.onEvent?.(toolEvent('project-tool-start', `SciForge ${builtInScenarioId} project tool started`));
    const sharedAgentContract = buildSharedAgentHandoffContract('ui-chat');
    const selectedSenseIds = selectedRuntimeSenseIds(input, selectedToolIds);
    const selectedActionIds = selectedRuntimeActionIds(input);
    const selectedVerifierIds = selectedRuntimeVerifierIds(input);
    const verificationPolicy = configuredVerificationPolicy(input);
    const humanApprovalPolicy = configuredHumanApprovalPolicy(input);
    const unverifiedReason = asString(input.scenarioOverride?.unverifiedReason);
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
      verificationPolicy,
      humanApprovalPolicy,
      unverifiedReason,
      verificationResult: input.verificationResult,
      recentVerificationResults: input.recentVerificationResults,
      uiState: {
        sessionId: input.sessionId,
        scopeCheck: {
          source: sharedAgentContract.source,
          decisionOwner: 'AgentServer',
          dispatchPolicy: sharedAgentContract.dispatchPolicy,
          answerPolicy: sharedAgentContract.answerPolicy,
          note: 'SciForge does not route or reject current-turn intent by keyword; AgentServer decides from rawUserPrompt and context.',
        },
        scenarioOverride: input.scenarioOverride,
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
        recentExecutionRefs,
        recentRuns: compactTransportRuns(input.runs ?? []),
        failureRecoveryPolicy,
        workspacePersistence: workspacePersistenceSummary(input),
        artifactExpectationMode: expectedArtifactTypes.length ? 'explicit-current-turn' : 'backend-decides',
        rawUserPrompt: input.prompt,
        contextPolicyOwner: 'python-conversation-policy',
        agentDispatchPolicy: 'agentserver-decides',
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
          callbacks.onEvent?.(toolEvent('backend-stream-retry', '首个 stream 已中断；准备重新发送同一请求。'));
          continue;
        }
        throw streamError;
      }
    }
  if (!response?.ok || error || !isRecord(result)) {
    throw new Error(error || `SciForge project tool failed: HTTP ${response?.status ?? 'no-response'}`);
  }
  const completion = workspaceResultCompletion(result);
  callbacks.onEvent?.(toolEvent('project-tool-done', completion.status === 'failed'
    ? `SciForge ${builtInScenarioId} 未完成：${completion.reason ?? '后台返回 repair-needed/failed-with-reason 诊断，未产出用户要求的最终结果。'}`
    : `SciForge ${builtInScenarioId} project tool completed`));
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

function builtInScenarioIdForInput(input: SendAgentMessageInput): ScenarioId {
  const skillDomain = input.scenarioOverride?.skillDomain;
  if (skillDomain === 'structure') return 'structure-exploration';
  if (skillDomain === 'omics') return 'omics-differential-exploration';
  if (skillDomain === 'knowledge') return 'biomedical-knowledge-graph';
  if (skillDomain === 'literature') return 'literature-evidence-review';
  if (input.scenarioId === 'structure-exploration'
    || input.scenarioId === 'omics-differential-exploration'
    || input.scenarioId === 'biomedical-knowledge-graph'
    || input.scenarioId === 'literature-evidence-review') return input.scenarioId as ScenarioId;
  return 'literature-evidence-review';
}

function stableSessionMessages(input: SendAgentMessageInput) {
  return (input.messages ?? [])
    .filter((message) => !message.id.startsWith('seed'))
    .slice(-TRANSPORT_SESSION_MESSAGE_LIMIT)
    .map((message) => ({
      id: message.id,
      role: message.role,
      content: compactConversationContent(message.content, 1600),
      createdAt: message.createdAt,
      status: message.status,
      references: message.references?.slice(-8).map(compactSciForgeReference),
      objectReferences: message.objectReferences?.slice(-12),
      guidanceQueue: message.guidanceQueue ? {
        ...message.guidanceQueue,
        prompt: compactConversationContent(message.guidanceQueue.prompt, 800),
        reason: message.guidanceQueue.reason ? compactConversationContent(message.guidanceQueue.reason, 500) : undefined,
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
    prompt: compactConversationContent(run.prompt, 1200),
    response: compactConversationContent(run.response, 1600),
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
  return {
    ...compactRecord(raw),
    streamProcess: streamProcess ? {
      eventCount: typeof streamProcess.eventCount === 'number' ? streamProcess.eventCount : undefined,
      summary: typeof streamProcess.summary === 'string' ? compactConversationContent(streamProcess.summary, 1400) : undefined,
    } : undefined,
  };
}

function selectedRuntimeSkillIds(input: SendAgentMessageInput, skillDomain: string) {
  return uniqueStrings([
    ...(input.scenarioOverride?.selectedSkillIds ?? []),
    `agentserver.generate.${skillDomain}`,
  ]);
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
  return selectedToolIds.flatMap((toolId) => {
    if (toolId !== 'local.vision-sense') return [{ id: toolId, selected: true }];
    return [{
      id: 'local.vision-sense',
      selected: true,
      kind: 'sense-plugin',
      modality: 'vision',
      packageRoot: 'packages/observe/vision',
      readmePath: 'packages/skills/tool_skills/local/vision-sense/SKILL.md',
      skillTemplate: 'packages/skills/installed/local/vision-gui-task/SKILL.md',
      inputContract: {
        textField: 'text',
        modalitiesField: 'modalities',
        acceptedModalities: ['screenshot', 'image'],
      },
      outputContract: {
        kind: 'text',
        formats: ['text/plain', 'application/json', 'application/x-ndjson'],
        actions: ['click', 'type_text', 'press_key', 'scroll', 'wait'],
      },
      executionBoundary: 'text-signal-only',
      missingRuntimeBridgePolicy: {
        behavior: 'diagnose-or-fail-closed',
        reason: 'local.vision-sense only emits auditable text signals and trace refs; a browser/desktop executor bridge plus screenshot source must execute real GUI actions.',
        noFallbackRepoScan: true,
        expectedFailureUnit: 'Return failed-with-reason when no GUI executor/screenshot bridge is configured for this run.',
      },
      computerUsePolicy: {
        executorOwnedBy: 'upstream Computer Use provider or browser/desktop adapter',
        noDomOrAccessibilityReads: true,
        highRiskPolicy: 'reject unless explicitly confirmed upstream',
        tracePolicy: 'preserve screenshot refs, planned action, grounding summary, execution status, pixel diff, and failureReason; never inline screenshot base64 into chat context',
      },
    }];
  });
}

function buildReferencePolicy(references: Array<Record<string, unknown>>) {
  return {
    mode: 'explicit-refs-first',
    defaultAction: 'Use current references as explicit user-provided evidence; resolve large payloads by ref and bounded summary.',
    currentReferenceCount: references.length,
  };
}

function configuredVerificationPolicy(input: SendAgentMessageInput) {
  const configured = input.scenarioOverride?.verificationPolicy;
  return configured && isRecord(configured) ? configured : undefined;
}

function configuredHumanApprovalPolicy(input: SendAgentMessageInput) {
  const configured = input.scenarioOverride?.humanApprovalPolicy;
  return configured && isRecord(configured) ? configured : undefined;
}

function compactSciForgeReference(reference: NonNullable<SendAgentMessageInput['references']>[number]) {
  return {
    id: reference.id,
    kind: reference.kind,
    title: reference.title,
    ref: reference.ref,
    sourceId: reference.sourceId,
    runId: reference.runId,
    locator: reference.locator,
    summary: reference.summary,
    payload: compactReferencePayload(reference.payload),
  };
}

function compactReferencePayload(payload: unknown): unknown {
  if (typeof payload === 'string') return payload.slice(0, 1600);
  if (Array.isArray(payload)) return payload.slice(0, 8);
  if (!isRecord(payload)) return payload;
  const compact: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(payload).slice(0, 12)) {
    if (typeof value === 'string') {
      compact[key] = value.slice(0, 1600);
    } else if (Array.isArray(value)) {
      compact[key] = value.slice(0, 8);
    } else if (isRecord(value)) {
      compact[key] = compactRecord(value);
    } else {
      compact[key] = value;
    }
  }
  return compact;
}

function compactRecord(value: unknown) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 24)) {
    if (typeof entry === 'string' && isDataUrl(entry)) out[key] = '[image dataUrl omitted; use file/image refs instead]';
    else if (typeof entry === 'string') out[key] = entry.length > 500 ? `${entry.slice(0, 500)}...` : entry;
    else if (typeof entry === 'number' || typeof entry === 'boolean' || entry == null) out[key] = entry;
    else if (Array.isArray(entry)) out[key] = entry.slice(0, 12);
    else if (isRecord(entry)) out[key] = Object.fromEntries(Object.entries(entry).slice(0, 8));
  }
  return Object.keys(out).length ? out : undefined;
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
  if (isRecord(value) && containsDataUrl(value.data)) {
    delete artifact.data;
    artifact.dataSummary = {
      omitted: 'binary-data-url',
      dataRef: typeof value.dataRef === 'string' ? value.dataRef : undefined,
      path: typeof value.path === 'string' ? value.path : undefined,
    };
  }
  return artifact;
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
    sessionRef: sessionId ? `.sciforge/sessions/${safeWorkspaceName(sessionId)}.json` : undefined,
    artifactDir: '.sciforge/artifacts/',
    taskDir: '.sciforge/tasks/',
    taskResultDir: '.sciforge/task-results/',
    logDir: '.sciforge/logs/',
    note: 'Generated task code, task inputs/results/logs, and UI artifacts are persisted under the workspace .sciforge directory when Workspace Writer is online.',
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
  const latestFailedRun = failedRuns.findLast((run) => asString(run.response) || streamProcessSummaryFromRun(run));
  const priorFailureReason = attemptHistory.findLast((attempt) => attempt.failureReason)?.failureReason
    || asString(latestFailedRun?.response)
    || (latestFailedRun ? streamProcessSummaryFromRun(latestFailedRun) : undefined);
  const recoverActions = uniqueStringList(attemptHistory.flatMap((attempt) => attempt.recoverActions ?? [])).slice(0, 6);
  const attemptHistoryRefs = uniqueStringList(attemptHistory.flatMap((attempt) => attempt.evidenceRefs ?? [])).slice(0, 12);
  return {
    mode: 'preserve-context',
    priorFailureReason: joinFailureAndProcessSummary(priorFailureReason, latestFailedRun ? streamProcessSummaryFromRun(latestFailedRun) : undefined),
    recoverActions,
    attemptHistoryRefs,
    attemptHistory,
    nextStep: attemptHistory.findLast((attempt) => attempt.nextStep)?.nextStep,
  };
}

function streamProcessSummaryFromRun(run: Record<string, unknown>) {
  const raw = isRecord(run.raw) ? run.raw : {};
  const streamProcess = isRecord(raw.streamProcess) ? raw.streamProcess : {};
  return asString(streamProcess.summary);
}

function joinFailureAndProcessSummary(reason: string | undefined, summary: string | undefined) {
  if (!reason) return summary;
  if (!summary || reason.includes(summary)) return reason;
  return `${reason}\n\n${summary}`;
}
