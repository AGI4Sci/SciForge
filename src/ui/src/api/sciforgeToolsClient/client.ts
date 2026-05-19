import type { AgentStreamEvent, NormalizedAgentResponse, ObjectAction, ObjectReference, SendAgentMessageInput } from '../../domain';
import type { ScenarioId } from '../../data';
import { makeId, nowIso } from '../../domain';
import { extractLatencyPolicy, extractResponsePlan, latencyThresholdsFromPolicy, type RuntimeLatencyThresholds } from '../../latencyPolicy';
import { buildInitialResponseProgressEvent } from '../../processProgress';
import { SCENARIO_SPECS } from '@sciforge/scenario-core/scenario-specs';
import { builtInScenarioIdForRuntimeInput, skillDomainForRuntimeInput } from '@sciforge/scenario-core/scenario-routing-policy';
import { expectedArtifactsForCurrentTurn, selectedComponentsForCurrentTurn } from '../../artifactIntent';
import { normalizeAgentResponse } from '../agentClient';
import { DEFAULT_AGENT_REQUEST_TIMEOUT_MS } from '@sciforge-ui/runtime-contract/handoff';
import { collectRuntimeRefsFromValue } from '@sciforge-ui/runtime-contract/references';
import {
  buildSilentStreamDecisionRecord,
  buildSilentStreamRunId,
  projectToolDoneEvent,
  projectToolStartedEvent,
  type SilentStreamDecisionRecord,
} from '@sciforge-ui/runtime-contract';
import { compactSciForgeReference, compactTransportExecutionUnits } from './transportContext';
import {
  contextWindowTelemetryEvent,
  normalizeWorkspaceRuntimeEvent,
  readWorkspaceToolStream,
  toolEvent,
  withConfiguredContextWindowLimit,
  workspaceResultCompletion,
} from './runtimeEvents';

export const CODEX_RUNTIME_STREAM_PATH = '/api/sciforge/runtime/codex/stream';
const CODEX_RUNTIME_REQUEST_SCHEMA_VERSION = 'sciforge.codex-runtime-stream-request.v1';
const DEFAULT_RUNTIME_PROFILE = 'sciforge-runtime-deepseek';

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

function stringRecordField(record: Record<string, unknown>, key: string): string | undefined {
  return asString(record[key]);
}

function asFiniteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function isSeedDemoOrFixtureMessage(message: unknown) {
  if (!isRecord(message)) return false;
  const provenance = isRecord(message.provenance) ? message.provenance : {};
  const marker = [
    message.id,
    message.role,
    provenance.kind,
    provenance.source,
  ].map((value) => String(value ?? '').toLowerCase()).join(' ');
  if (provenance.runtimeRequestEligible === false || provenance.liveAcceptanceEligible === false) return true;
  return /\b(seed|demo|fixture)\b|scenariodemodata/.test(marker) || message.role === 'scenario';
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return out.length ? out : undefined;
}

function uniqueStringList(values: unknown[]) {
  return Array.from(new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0)));
}

function uniqueRuntimeStringList(values: unknown[]) {
  return uniqueStringList(values);
}

export async function sendSciForgeToolMessage(
  input: SendAgentMessageInput,
  callbacks: { onEvent?: (event: AgentStreamEvent) => void } = {},
  signal?: AbortSignal,
): Promise<NormalizedAgentResponse> {
  const builtInScenarioId = builtInScenarioIdForRuntimeInput(input);
  const referenceSummary = runtimeCodexEligibleReferenceSummary(input);
  let activeRequestController: AbortController | undefined;
  let timedOut = false;
  let retryForSilentFirstEvent = false;
  let sawBackendEvent = false;
  let foregroundReadableResultSeen = false;
  let lastSilentNoticeAt = 0;
  let latencyThresholds = latencyThresholdsFromPolicy(undefined, {
    requestTimeoutMs: input.config.requestTimeoutMs || DEFAULT_AGENT_REQUEST_TIMEOUT_MS,
  });
  let timeout: ReturnType<typeof globalThis.setTimeout> | undefined;
  const requestStartedAt = Date.now();
  let timeoutExtensionCount = 0;
  let boundedStallRecovery: NormalizedAgentResponse | undefined;
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
    const stalledMs = Date.now() - lastRealEventAt;
    if (sawBackendEvent && stalledMs >= latencyThresholds.stallBoundMs && !timedOut && !signal?.aborted && activeRequestController) {
      const recoveryDetail = `后端已有运行事件后 ${Math.round(stalledMs / 1000)}s 未再返回事件；已按 bounded-stop 结束前台等待，并保留当前 Projection refs/digests 供下一轮恢复。`;
      const abortDecision = noteSilentDecision({
        decision: 'abort',
        detail: recoveryDetail,
        elapsedMs: stalledMs,
        status: 'bounded-stop-after-backend-stall',
      });
      boundedStallRecovery = boundedStallRecoveryResponse(input, {
        detail: recoveryDetail,
        silentStreamRunId,
        silentStreamDecision: abortDecision,
        stalledMs,
        foregroundReadableResultSeen,
      });
      callbacks.onEvent?.(toolEvent('backend-stall-bounded-stop', recoveryDetail, {
        silentStreamRunId,
        silentStreamDecision: abortDecision,
        stalledMs,
      }));
      activeRequestController.abort();
      return;
    }
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
    callbacks.onEvent?.(toolEvent('current-plan', `当前计划：把 GUI 用户操作转换为 terminal-equivalent text，交给 Codex Runtime bridge；任务上下文、记忆、工具和展示意图由 Codex/TUI 原生机制负责。`));
    callbacks.onEvent?.(projectToolStartedEvent({ id: makeId('evt'), createdAt: nowIso() }, builtInScenarioId));
    const commandId = makeId('codex-command');
    const requestBody = buildCodexRuntimeStreamRequest({
      input,
      commandId,
      referenceSummary,
      silentStreamRunId,
    });
    assertCodexRuntimeStreamRequestBoundary(requestBody);
    const requestBodyText = JSON.stringify(requestBody);
    callbacks.onEvent?.(contextWindowTelemetryEvent(
      input,
      requestBodyText,
      'Codex Runtime command/projection preflight estimate',
    ));
    callbacks.onEvent?.(codexRuntimeRunEvent(requestBody));
    const runtimeEvents: AgentStreamEvent[] = [];
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
        response = await fetch(`${input.config.workspaceWriterBaseUrl}${CODEX_RUNTIME_STREAM_PATH}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: requestBodyText,
          signal: activeRequestController.signal,
        });
        const stream = await readWorkspaceToolStream(response, (event) => {
          const normalized = withConfiguredContextWindowLimit(
            normalizeWorkspaceRuntimeEvent(event),
            input.config.maxContextWindowTokens,
          );
          runtimeEvents.push(normalized);
          if (isBackendProgressEvent(normalized)) {
            sawBackendEvent = true;
            lastRealEventAt = Date.now();
          }
          if (isForegroundReadableResultEvent(normalized)) foregroundReadableResultSeen = true;
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
  if (error && runtimeEvents.some(isRuntimeCodexFailedEvent)) {
    return runtimeCodexFailedResponse({
      input,
      request: requestBody,
      runtimeEvents,
      error,
    });
  }
  if (!response?.ok || error || !isRecord(result)) {
    throw new Error(error || `SciForge project tool failed: HTTP ${response?.status ?? 'no-response'}`);
  }
  const completion = workspaceResultCompletion(result);
  callbacks.onEvent?.(projectToolDoneEvent({ id: makeId('evt'), createdAt: nowIso() }, builtInScenarioId, completion));
  const normalized = normalizeAgentResponse(builtInScenarioId, input.prompt, {
    ok: true,
    data: {
      run: {
        id: commandId,
        status: completion.status,
        createdAt: nowIso(),
        completedAt: nowIso(),
        output: {
          result: JSON.stringify(result),
        },
      },
    },
  });
  const codexSessionId = codexSessionIdFromRuntimeResult(result);
  if (!codexSessionId) return normalized;
  const codexThreadRef = codexThreadObjectReference(codexSessionId, commandId);
  return {
    ...normalized,
    run: {
      ...normalized.run,
      raw: {
        ...(isRecord(normalized.run.raw) ? normalized.run.raw : {}),
        codexSessionId,
      },
      objectReferences: [
        ...(normalized.run.objectReferences ?? []),
        codexThreadRef,
      ],
    },
    message: {
      ...normalized.message,
      objectReferences: [
        ...(normalized.message.objectReferences ?? []),
        codexThreadRef,
      ],
    },
  };
  } catch (error) {
    if (boundedStallRecovery) return boundedStallRecovery;
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

function buildCodexRuntimeStreamRequest(input: {
  input: SendAgentMessageInput;
  commandId: string;
  referenceSummary: Array<Record<string, unknown>>;
  silentStreamRunId: string;
}) {
  const config = input.input.config;
  const profile = config.runtimeProfile?.trim() || DEFAULT_RUNTIME_PROFILE;
  const provider = config.modelProvider.trim() || 'sciforge-deepseek-proxy';
  const model = config.modelName.trim() || 'bailian/deepseek-v4-flash';
  const commandText = buildCodexRuntimeCommandText(input);
  const codexSessionId = latestCodexSessionId(input.input.runs);
  const attemptId = `${input.commandId}-attempt-1`;
  return {
    schemaVersion: CODEX_RUNTIME_REQUEST_SCHEMA_VERSION,
    commandId: input.commandId,
    attemptId,
    commandText,
    workspacePath: config.workspacePath,
    profile,
    codexSessionId,
    allowOpenAiRuntime: config.allowOpenAiRuntime === true,
    guiExtension: {
      enabled: true,
    },
    auditMetadata: {
      schemaVersion: 'sciforge.codex-runtime-stream-audit.v1',
      boundary: 'GUI-to-TUI input is terminal-equivalent text only; non-text fields are adapter metadata and must not be interpreted as task context.',
      promptCarriedBy: 'commandText',
      legacyHandoffBoundary: 'GUI transcript, artifact bodies, expected results, capability selection, provider routing, and recovery policy stay outside the Runtime Codex task request.',
      runtime: {
        kind: 'codex',
        provider,
        model,
        profile,
        apiKeyConfigured: Boolean(config.apiKey.trim()),
        allowOpenAiRuntime: config.allowOpenAiRuntime === true,
      },
      guiLocalProjection: auditOnlyGuiProjectionRefs(input.input, input.referenceSummary),
      silentStreamRunId: input.silentStreamRunId,
      evidenceRefs: [
        `audit:codex-runtime:${input.commandId}:${attemptId}:raw-jsonl`,
        `audit:codex-runtime:${input.commandId}:${attemptId}:stderr`,
        `audit:codex-runtime:${input.commandId}:${attemptId}:normalized-events`,
      ],
    },
  };
}

function runtimeCodexEligibleReferenceSummary(input: SendAgentMessageInput) {
  const excludedRefs = seedDemoOrFixtureMessageRefs(input);
  return (input.references ?? [])
    .map(compactSciForgeReference)
    .filter((reference) => !referenceMatchesExcludedSeedDemoRef(reference, excludedRefs));
}

function seedDemoOrFixtureMessageRefs(input: SendAgentMessageInput) {
  const refs = new Set<string>();
  for (const message of input.messages ?? []) {
    if (!isSeedDemoOrFixtureMessage(message)) continue;
    refs.add(message.id);
    refs.add(`message:${message.id}`);
    for (const reference of message.references ?? []) refs.add(reference.ref);
    for (const reference of message.objectReferences ?? []) refs.add(reference.ref);
  }
  return refs;
}

function referenceMatchesExcludedSeedDemoRef(reference: Record<string, unknown>, excludedRefs: Set<string>) {
  if (!excludedRefs.size) return false;
  return referenceRuntimeRefs(reference).some((ref) => {
    if (excludedRefs.has(ref)) return true;
    return Array.from(excludedRefs).some((excluded) => ref === `ui-text:${excluded}` || ref.startsWith(`${excluded}#`) || ref.startsWith(`ui-text:${excluded}#`));
  });
}

function referenceRuntimeRefs(reference: Record<string, unknown>) {
  const payload = isRecord(reference.payload) ? reference.payload : {};
  return uniqueRuntimeStringList([
    reference.id,
    reference.ref,
    reference.path,
    reference.dataRef,
    reference.sourceId,
    payload.sourceRef,
  ]);
}

function auditOnlyGuiProjectionRefs(
  input: SendAgentMessageInput,
  referenceSummary: Array<Record<string, unknown>>,
) {
  const references = uniqueRuntimeStringList(referenceSummary.flatMap((reference) => [
    reference.ref,
    reference.path,
    reference.dataRef,
    reference.id,
  ])).slice(0, 12);
  const runRefs = (input.runs ?? []).slice(-8).map((run) => `run:${run.id}`);
  const artifactRefs = (input.artifacts ?? []).slice(-16).map((artifact) => `artifact:${artifact.id}`);
  const claimRefs = (input.claims ?? []).slice(-16).map((claim) => `claim:${claim.id}`);
  const executionRefs = (input.executionUnits ?? []).slice(-16).map((unit) => `execution-unit:${unit.id}`);
  const nonSeedMessageCount = (input.messages ?? []).filter((message) => !isSeedDemoOrFixtureMessage(message)).length;
  return {
    currentTurnId: input.currentTurnId,
    selectedRefCount: referenceSummary.length,
    refs: uniqueRuntimeStringList([...references, ...runRefs, ...artifactRefs, ...claimRefs, ...executionRefs]).slice(0, 48),
    counts: {
      nonSeedMessages: nonSeedMessageCount,
      seedMessagesExcluded: (input.messages ?? []).length - nonSeedMessageCount,
      runRefs: input.runs?.length ?? 0,
      artifactRefs: input.artifacts?.length ?? 0,
      claimRefs: input.claims?.length ?? 0,
      executionUnitRefs: input.executionUnits?.length ?? 0,
    },
  };
}

function assertCodexRuntimeStreamRequestBoundary(request: ReturnType<typeof buildCodexRuntimeStreamRequest>) {
  const forbidden = [
    'prompt',
    'sessionMessages',
    'artifacts',
    'claims',
    'expectedArtifactTypes',
    'selectedSkillIds',
    'toolProviderRoutes',
    'failureRecoveryPolicy',
    'uiState',
    'references',
    'expectedEvidenceKinds',
    'selectedToolIds',
    'selectedSenseIds',
    'selectedActionIds',
    'selectedComponentIds',
    'selectedVerifierIds',
    'transportAgentContext',
  ];
  const hits = forbidden.filter((key) => key in request);
  const audit = isRecord(request.auditMetadata) ? request.auditMetadata : {};
  const auditHits = forbidden.filter((key) => key in audit);
  if (hits.length || auditHits.length) {
    throw new Error(`Runtime Codex request contains legacy GUI handoff fields: ${[...hits, ...auditHits].join(', ')}`);
  }
  if (!request.commandText.trim()) throw new Error('Runtime Codex request commandText is required.');
}

function buildCodexRuntimeCommandText(input: Parameters<typeof buildCodexRuntimeStreamRequest>[0]) {
  const prompt = input.input.prompt.trim();
  const refs = uniqueRuntimeStringList(input.referenceSummary.flatMap((reference) => {
    const readableRefs = [reference.dataRef, reference.path, reference.ref].filter((value): value is string => Boolean(asString(value)));
    return readableRefs.length ? readableRefs : [reference.id];
  })).slice(0, 12);
  if (!refs.length) return prompt;
  const refFlags = refs.map((ref) => `--ref ${quoteTerminalArg(ref)}`).join(' ');
  return `ask ${refFlags} ${quoteTerminalArg(prompt)}`;
}

function latestCodexSessionId(runs: SendAgentMessageInput['runs']): string | undefined {
  for (const run of [...(runs ?? [])].reverse()) {
    const raw = isRecord(run.raw) ? run.raw : undefined;
    const direct = asString(raw?.codexSessionId) ?? asString(raw?.nativeSessionId);
    if (direct) return direct;
    const runtimeFailure = isRecord(raw?.codexRuntimeFailure) ? raw.codexRuntimeFailure : undefined;
    const runtimeRecoverState = isRecord(runtimeFailure?.recoverState) ? runtimeFailure.recoverState : undefined;
    const failureSessionId = asString(runtimeFailure?.codexSessionId) ?? asString(runtimeRecoverState?.codexSessionId);
    if (failureSessionId) return failureSessionId;
    const result = isRecord(raw?.result) ? raw.result : undefined;
    const resultSessionId = asString(result?.codexSessionId) ?? asString(result?.nativeSessionId);
    if (resultSessionId) return resultSessionId;
    const parsed = parsedRuntimeOutputResult(raw);
    const parsedSessionId = codexSessionIdFromRuntimeResult(parsed);
    if (parsedSessionId) return parsedSessionId;
    const objectRefSessionId = run.objectReferences?.map((reference) => asString(reference.ref))
      .find((ref): ref is string => Boolean(ref?.startsWith('codex-thread:')))
      ?.replace(/^codex-thread:/, '')
      .trim();
    if (objectRefSessionId) return objectRefSessionId;
  }
  return undefined;
}

function parsedRuntimeOutputResult(raw: Record<string, unknown> | undefined): unknown {
  const data = isRecord(raw?.data) ? raw.data : undefined;
  const run = isRecord(data?.run) ? data.run : undefined;
  const output = isRecord(run?.output) ? run.output : undefined;
  const resultText = asString(output?.result);
  if (!resultText) return undefined;
  try {
    return JSON.parse(resultText) as unknown;
  } catch {
    return undefined;
  }
}

function codexSessionIdFromRuntimeResult(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  const output = isRecord(value.output) ? value.output : undefined;
  const runtimeFailure = isRecord(value.runtimeFailure) ? value.runtimeFailure : undefined;
  const recoverState = isRecord(runtimeFailure?.recoverState) ? runtimeFailure.recoverState : undefined;
  return asString(value.codexSessionId)
    ?? asString(value.nativeSessionId)
    ?? asString(output?.codexSessionId)
    ?? asString(output?.nativeSessionId)
    ?? asString(runtimeFailure?.codexSessionId)
    ?? asString(recoverState?.codexSessionId);
}

function codexThreadObjectReference(codexSessionId: string, runId: string): ObjectReference {
  return {
    id: `codex-thread-${stableRefId(codexSessionId)}`,
    title: 'Runtime Codex thread',
    kind: 'run' as const,
    ref: `codex-thread:${codexSessionId}`,
    runId,
    actions: ['inspect'] satisfies ObjectAction[],
    status: 'available' as const,
    presentationRole: 'audit' as const,
  };
}

function quoteTerminalArg(value: string) {
  return JSON.stringify(value);
}

function codexRuntimeRunEvent(request: ReturnType<typeof buildCodexRuntimeStreamRequest>): AgentStreamEvent {
  const auditMetadata: Record<string, unknown> = isRecord(request.auditMetadata) ? request.auditMetadata : {};
  const runtime: Record<string, unknown> = isRecord(auditMetadata.runtime) ? auditMetadata.runtime : {};
  const provider = asString(runtime.provider) ?? 'unknown';
  const model = asString(runtime.model) ?? 'unknown';
  const detail = [
    `provider ${provider}`,
    `model ${model}`,
    `profile ${request.profile}`,
    `workspace ${request.workspacePath}`,
    `command ${request.commandId}`,
  ].join(' · ');
  return {
    id: makeId('evt'),
    type: 'codex-runtime-run',
    label: 'Codex Runtime',
    detail,
    createdAt: nowIso(),
    raw: {
      type: 'codex-runtime-run',
      provider,
      model,
      profile: request.profile,
      workspacePath: request.workspacePath,
      commandId: request.commandId,
      attemptId: request.attemptId,
      codexSessionId: request.codexSessionId,
      allowOpenAiRuntime: request.allowOpenAiRuntime,
      boundary: asString(auditMetadata.boundary),
    },
  };
}

function runtimeCodexFailedResponse(input: {
  input: SendAgentMessageInput;
  request: ReturnType<typeof buildCodexRuntimeStreamRequest>;
  runtimeEvents: AgentStreamEvent[];
  error: string;
}): NormalizedAgentResponse {
  const failureEvent = [...input.runtimeEvents].reverse().find(isRuntimeCodexFailedEvent);
  const metadata = runtimeFailureMetadata(input.request, failureEvent, input.runtimeEvents);
  const message = 'Runtime Codex 运行未完成；失败 run、审计 refs 和恢复状态已保留。';
  const structuredFailure = {
    status: 'failed',
    message,
    runtimeFailure: metadata,
    displayIntent: {
      status: 'repair-needed',
      conversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        conversationId: input.input.sessionId,
        currentTurn: {
          id: input.input.currentTurnId ?? input.request.commandId,
          prompt: input.input.prompt,
        },
        visibleAnswer: {
          status: 'repair-needed',
          text: message,
          artifactRefs: [],
          diagnostic: `Runtime Codex exited with code ${metadata.exitCode ?? 'unknown'}.`,
        },
        activeRun: {
          id: input.request.commandId,
          status: 'repair-needed',
        },
        artifacts: [],
        executionProcess: [{
          eventId: `${input.request.commandId}:runtime-codex-failed`,
          type: 'RunFailed',
          summary: `Runtime Codex failed with exit code ${metadata.exitCode ?? 'unknown'}.`,
          timestamp: nowIso(),
        }],
        recoverActions: [
          'Retry or continue from this failed Runtime Codex run with the preserved command id, attempt id, profile, workspace, and audit refs.',
          'Inspect folded audit/debug refs before rerunning if the same profile or workspace may fail again.',
        ],
        verificationState: {
          status: 'failed',
          verdict: 'fail',
        },
        auditRefs: metadata.evidenceRefs,
        diagnostics: [{
          severity: 'error',
          code: 'runtime-codex-nonzero-exit',
          message: `Runtime Codex exited with code ${metadata.exitCode ?? 'unknown'}.`,
          refs: metadata.evidenceRefs.map((ref) => ({ ref })),
        }],
      },
    },
    executionUnits: [{
      id: `EU-${input.request.commandId}`,
      status: 'failed',
      title: 'Runtime Codex turn',
      provider: metadata.provider,
      model: metadata.model,
      profile: metadata.profile,
      workspace: metadata.workspace,
      commandId: metadata.commandId,
      attemptId: metadata.attemptId,
      codexSessionId: metadata.codexSessionId,
      exitCode: metadata.exitCode,
      failureReason: `Runtime Codex exited with code ${metadata.exitCode ?? 'unknown'}.`,
      recoverActions: [
        'Retry or continue from preserved Runtime Codex audit refs.',
      ],
      evidenceRefs: metadata.evidenceRefs,
    }],
    objectReferences: metadata.evidenceRefs.map((ref) => ({
      id: `audit-${stableRefId(ref)}`,
      kind: 'run',
      ref,
      title: ref.includes('stderr') ? 'Runtime Codex stderr audit' : ref.includes('raw-jsonl') ? 'Runtime Codex raw JSONL audit' : 'Runtime Codex audit',
      status: 'available',
      actions: ['inspect'] satisfies ObjectAction[],
      runId: input.request.commandId,
      presentationRole: 'audit',
    })),
  };
  const response = normalizeAgentResponse(builtInScenarioIdForRuntimeInput(input.input), input.input.prompt, {
    ok: true,
    data: {
      run: {
        id: input.request.commandId,
        status: 'failed',
        createdAt: nowIso(),
        completedAt: nowIso(),
        output: {
          result: JSON.stringify(structuredFailure),
        },
      },
    },
  });
  return {
    ...response,
    run: {
      ...response.run,
      status: 'failed',
      raw: {
        ...(isRecord(response.run.raw) ? response.run.raw : {}),
        codexRuntimeFailure: metadata,
        runtimeAudit: {
          foldedByDefault: true,
          policy: 'raw stderr/jsonl/stdout/plugin warning are audit/debug only and must not render in the primary reply DOM',
          eventCount: input.runtimeEvents.length,
          eventSummaries: input.runtimeEvents.slice(-24).map(runtimeAuditEventSummary),
        },
      },
    },
    message: {
      ...response.message,
      status: 'failed',
      content: message,
    },
  };
}

function isRuntimeCodexFailedEvent(event: AgentStreamEvent) {
  return String(event.type || '').toLowerCase().includes('failed')
    || String(isRecord(event.raw) ? event.raw.type : '').toLowerCase() === 'failed'
    || String(isRecord(event.raw) ? stringRecordField(event.raw, 'status') : '').toLowerCase() === 'failed';
}

function runtimeFailureMetadata(
  request: ReturnType<typeof buildCodexRuntimeStreamRequest>,
  failureEvent: AgentStreamEvent | undefined,
  events: AgentStreamEvent[],
) {
  const raw = isRecord(failureEvent?.raw) ? failureEvent.raw : {};
  const rawNested = isRecord(raw.raw) ? raw.raw : {};
  const auditMetadata: Record<string, unknown> = isRecord(request.auditMetadata) ? request.auditMetadata : {};
  const runtime: Record<string, unknown> = isRecord(auditMetadata.runtime) ? auditMetadata.runtime : {};
  const auditEvidenceRefs = asStringArray(auditMetadata.evidenceRefs);
  const evidenceRefs = uniqueRuntimeStringList([
    ...(asStringArray(raw.evidenceRefs) ?? []),
    ...(asStringArray(rawNested.evidenceRefs) ?? []),
    ...(auditEvidenceRefs ?? []),
    `audit:codex-runtime:${request.commandId}:${asString(raw.attemptId) ?? request.attemptId ?? `${request.commandId}:attempt`}:normalized-events`,
    `audit:codex-runtime:${request.commandId}:${asString(raw.attemptId) ?? request.attemptId ?? `${request.commandId}:attempt`}:stderr`,
  ]);
  return {
    schemaVersion: 'sciforge.runtime-codex-failed-run.v1',
    commandId: asString(raw.commandId) ?? request.commandId,
    attemptId: asString(raw.attemptId) ?? request.attemptId,
    workspace: asString(raw.workspace) ?? asString(rawNested.workspace) ?? request.workspacePath,
    profile: asString(raw.profile) ?? asString(rawNested.profile) ?? request.profile,
    provider: asString(raw.provider) ?? asString(rawNested.provider) ?? asString(runtime.provider) ?? 'unknown',
    model: asString(raw.model) ?? asString(rawNested.model) ?? asString(runtime.model) ?? 'unknown',
    codexSessionId: asString(raw.codexSessionId) ?? asString(rawNested.codexSessionId) ?? request.codexSessionId,
    exitCode: asFiniteNumber(raw.exitCode) ?? asFiniteNumber(rawNested.exitCode),
    stderrSummary: asString(rawNested.stderrSummary) ?? summarizeRuntimeStderr(events),
    evidenceRefs,
    recoverState: {
      status: 'repair-needed',
      retryable: true,
      commandId: asString(raw.commandId) ?? request.commandId,
      attemptId: asString(raw.attemptId) ?? request.attemptId,
      workspace: asString(raw.workspace) ?? asString(rawNested.workspace) ?? request.workspacePath,
      profile: asString(raw.profile) ?? asString(rawNested.profile) ?? request.profile,
      provider: asString(raw.provider) ?? asString(rawNested.provider) ?? asString(runtime.provider) ?? 'unknown',
      model: asString(raw.model) ?? asString(rawNested.model) ?? asString(runtime.model) ?? 'unknown',
      codexSessionId: asString(raw.codexSessionId) ?? asString(rawNested.codexSessionId) ?? request.codexSessionId,
      stderrSummary: asString(rawNested.stderrSummary) ?? summarizeRuntimeStderr(events),
      evidenceRefs,
      recoverActions: [
        'Retry or continue from this failed Runtime Codex run using preserved audit refs only.',
        'Keep the same Runtime Codex profile/workspace unless the audit refs show a configuration failure.',
      ],
    },
  };
}

function summarizeRuntimeStderr(events: AgentStreamEvent[]) {
  const chunks = events.flatMap((event) => {
    const raw = isRecord(event.raw) ? event.raw : {};
    const nested = isRecord(raw.raw) ? raw.raw : {};
    const stream = asString(nested.stream) ?? asString(raw.stream) ?? stringRecordField(raw, 'status');
    if (stream !== 'stderr') return [];
    return [asString(nested.chunk) ?? asString(raw.message) ?? asString(raw.detail)].filter((value): value is string => Boolean(value));
  });
  const compact = chunks.join(' ').replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

function runtimeAuditEventSummary(event: AgentStreamEvent) {
  const raw = isRecord(event.raw) ? event.raw : {};
  return {
    type: event.type,
    status: stringRecordField(raw, 'status'),
    commandId: asString(raw.commandId),
    attemptId: asString(raw.attemptId),
    evidenceRefs: asStringArray(raw.evidenceRefs),
    detailDigest: digestRuntimeText(event.detail),
  };
}

function digestRuntimeText(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }
  return {
    omitted: 'text-body',
    chars: value.length,
    hash: Math.abs(hash).toString(36),
  };
}

function stableRefId(value: string) {
  return value.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').slice(0, 80) || 'runtime-audit';
}

function isBackendProgressEvent(event: AgentStreamEvent) {
  const type = String(event.type || '').toLowerCase();
  const label = String(event.label || '').toLowerCase();
  const raw = isRecord(event.raw) ? event.raw : {};
  const rawType = String(raw.type || '').toLowerCase();
  const progress = isRecord(raw.progress) ? raw.progress : undefined;
  if (type.includes('silent') || rawType.includes('silent')) return false;
  if (type.includes('timeout-extended') || rawType.includes('timeout-extended')) return false;
  if (type === 'backend-silent' || rawType === 'backend-silent') return false;
  if (raw.silentStreamWaiting === true) return false;
  if (String(raw.reason || '').toLowerCase() === 'backend-waiting') return false;
  if (String(progress?.reason || '').toLowerCase() === 'backend-waiting') return false;
  if (String(event.detail || '').toLowerCase().includes('reason: backend-waiting')) return false;
  if (label === 'wait' || label === 'waiting' || label === '等待') return false;
  return true;
}

function isForegroundReadableResultEvent(event: AgentStreamEvent) {
  const raw = isRecord(event.raw) ? event.raw : {};
  const type = String(event.type || raw.type || raw.kind || '').trim().toLowerCase();
  const status = String(raw['status'] || '').trim().toLowerCase();
  const readableRef = asString(raw.readableRef) || asString(raw.foregroundPartialRef);
  const refs = asStringArray(raw.refs) ?? asStringArray(raw.evidenceRefs) ?? asStringArray(raw.artifactRefs);
  const qualitySignals = isRecord(raw.qualitySignals) ? raw.qualitySignals : undefined;
  if (type === 'first-readable-result') return true;
  if (qualitySignals?.userVisible === true && (qualitySignals.partialResult === true || readableRef || refs?.length)) return true;
  if (readableRef && /partial|readable|foreground|background-running/.test(type || status)) return true;
  return false;
}

function buildTransportContextReusePolicy(input: SendAgentMessageInput) {
  const nonSeedMessageCount = (input.messages ?? []).filter((message) => !message.id.startsWith('seed')).length;
  const hasPriorWork = nonSeedMessageCount > 1
    || (input.runs?.length ?? 0) > 0
    || (input.artifacts?.length ?? 0) > 0
    || (input.executionUnits?.length ?? 0) > 0;
  const failedExecutionRefCount = (input.executionUnits ?? [])
    .filter((unit) => /failed|repair-needed|needs-human/i.test(String(unit.status || ''))).length;
  const repairTargetAvailable = currentProjectionRepairTargetAvailable(input);
  return {
    schemaVersion: 'sciforge.context-reuse-policy.v1',
    decisionOwner: 'python-conversation-policy',
    historyReuse: {
      allowed: hasPriorWork,
      source: 'ui-transport-prior-work',
    },
    selectedRefsOnly: (input.references?.length ?? 0) > 0,
    priorWorkSignals: {
      nonSeedMessageCount,
      runCount: input.runs?.length ?? 0,
      artifactCount: input.artifacts?.length ?? 0,
      executionUnitCount: input.executionUnits?.length ?? 0,
      failedExecutionRefCount,
      repairTargetAvailable,
    },
    reason: hasPriorWork
      ? 'Current turn belongs to an existing session with projection/audit refs available; reuse must stay bounded by Projection and refs.'
      : 'Fresh session turn; no prior session work is eligible for history reuse.',
  };
}

function currentProjectionRepairTargetAvailable(input: SendAgentMessageInput) {
  return recentRecordHasRepairTarget(input.executionUnits)
    || recentRecordHasRepairTarget(input.runs)
    || currentRecoverActionReferenceAvailable(input.references);
}

function recentRecordHasRepairTarget(records: unknown[] | undefined) {
  return (records ?? []).slice(-4).some((item) => {
    if (!isRecord(item)) return false;
    const status = String(item.status || '').trim().toLowerCase();
    const hasFailureStatus = /^(failed|error|repair-needed|failed-with-reason|needs-human)$/.test(status);
    if (!hasFailureStatus) return false;
    const recoverActions = asStringArray(item.recoverActions);
    const refs = uniqueStringList([
      item.ref,
      item.outputRef,
      item.stdoutRef,
      item.stderrRef,
      item.errorRef,
      item.failureRef,
      item.diagnosticRef,
      ...(asStringArray(item.artifacts) ?? []),
      ...(asStringArray(item.outputArtifacts) ?? []),
    ]);
    return Boolean(
      recoverActions?.length
      || refs.length
      || asString(item.failureReason)
      || asString(item.nextStep),
    );
  });
}

function currentRecoverActionReferenceAvailable(references: unknown[] | undefined) {
  return (references ?? []).some((reference) => {
    if (!isRecord(reference)) return false;
    const source = String(reference.source || reference.sourceId || reference.kind || '').trim().toLowerCase();
    const status = String(reference.status || '').trim().toLowerCase();
    return source === 'recover-action'
      || source === 'failure-evidence'
      || status === 'repair-needed'
      || status === 'failed-with-reason'
      || status === 'needs-human';
  });
}

function boundedStallRecoveryResponse(
  input: SendAgentMessageInput,
  recovery: {
    detail: string;
    silentStreamRunId: string;
    silentStreamDecision: SilentStreamDecisionRecord;
    stalledMs: number;
    foregroundReadableResultSeen: boolean;
  },
): NormalizedAgentResponse {
  const builtInScenarioId = builtInScenarioIdForRuntimeInput(input);
  const runId = makeId(`bounded-stop-${builtInScenarioId}`);
  const createdAt = nowIso();
  const evidenceRefs = uniqueStringList([
    recovery.silentStreamRunId,
    ...compactTransportExecutionUnits(input.executionUnits ?? []).flatMap((unit) => [
      unit.outputRef,
      unit.stdoutRef,
      unit.stderrRef,
      unit.codeRef,
    ]),
    ...(input.runs ?? []).slice(-3).flatMap((run) => [
      run.id ? `run:${run.id}` : undefined,
      asString(isRecord(run.raw) ? run.raw.conversationProjectionRef : undefined),
    ]),
  ]).slice(0, 12);
  const foregroundReadableResultSeen = recovery.foregroundReadableResultSeen;
  const runStatus = foregroundReadableResultSeen ? 'background-running' : 'failed';
  const projectionStatus = foregroundReadableResultSeen ? 'background-running' : 'failed-with-reason';
  const executionStatus = foregroundReadableResultSeen ? 'running' : 'failed-with-reason';
  const statusDetail = foregroundReadableResultSeen
    ? recovery.detail
    : `${recovery.detail} 当前 stream 没有 first-readable-result/foreground partial ref，不能声明 background-running。`;
  const recoverActions = [
    'Continue from current Projection refs/digests and recent execution refs only; do not replay raw run, stdout, stderr, or artifact bodies.',
    'Ask the backend for one minimal repair/continue step, or return failed-with-reason if the preserved refs are insufficient.',
  ];
  const markerEvent = {
    schemaVersion: 'sciforge.bounded-stall-marker-event.v1',
    eventId: `${runId}:bounded-stall`,
    type: 'bounded-stall-marker',
    status: projectionStatus,
    detail: statusDetail,
    silentStreamRunId: recovery.silentStreamRunId,
    stalledMs: recovery.stalledMs,
    createdAt,
    evidenceRefs,
  };
  return normalizeAgentResponse(builtInScenarioId, input.prompt, {
    ok: true,
    data: {
      run: {
        id: runId,
        status: runStatus,
        createdAt,
        completedAt: createdAt,
        raw: { boundedStallMarkerEvent: markerEvent },
      },
      output: {
        message: JSON.stringify({
          message: statusDetail,
          confidence: 0.2,
          claimType: 'inference',
          evidenceLevel: 'runtime',
          executionUnits: [{
            id: `EU-${runId.slice(-8)}`,
            tool: 'sciforge.runtime.bounded-stop',
            status: executionStatus,
            params: JSON.stringify({
              silentStreamRunId: recovery.silentStreamRunId,
              stalledMs: recovery.stalledMs,
              evidenceRefs,
              markerEvent,
            }),
            failureReason: statusDetail,
            recoverActions,
            nextStep: recoverActions[0],
            outputArtifacts: [],
            artifacts: [],
          }],
          claims: [{
            text: statusDetail,
            type: 'inference',
            confidence: 0.2,
            evidenceLevel: 'runtime',
            supportingRefs: evidenceRefs,
            opposingRefs: [],
          }],
          artifacts: [],
          objectReferences: evidenceRefs.map((ref, index) => ({
            id: `bounded-stop-ref-${index + 1}`,
            ref,
            label: ref,
            kind: 'runtime-ref',
            role: 'audit',
          })),
          displayIntent: { status: projectionStatus, boundedStallMarkerEvent: markerEvent },
          boundedStallMarkerEvent: markerEvent,
          silentStreamDecision: recovery.silentStreamDecision,
        }),
      },
    },
  });
}
