import type { AgentStreamEvent, NormalizedAgentResponse, ObjectAction, ObjectReference, RuntimeProviderPreflightManifest, SendAgentMessageInput } from '../../domain';
import type { ScenarioId } from '../../data';
import { makeId, nowIso } from '../../domain';
import { defaultSciForgeConfig } from '../../config';
import { extractLatencyPolicy, extractResponsePlan, latencyThresholdsFromPolicy, type RuntimeLatencyThresholds } from '../../latencyPolicy';
import { buildInitialResponseProgressEvent } from '../../processProgress';
import { SCENARIO_SPECS } from '@sciforge/scenario-core/scenario-specs';
import { builtInScenarioIdForRuntimeInput } from '@sciforge/scenario-core/scenario-routing-policy';
import { normalizeAgentResponse } from '../agentClient';
import { DEFAULT_AGENT_REQUEST_TIMEOUT_MS } from '@sciforge-ui/runtime-contract/handoff';
import { collectRuntimeRefsFromValue } from '@sciforge-ui/runtime-contract/references';
import { createCodexRealtimeSessionEnvelope } from '@sciforge-ui/runtime-contract/codex-realtime-session';
import {
  composerComputerUseCommandRequiresExactTerminalText,
  composerPromptIsComputerUseSlashCommand,
  composerPromptMentionsRelativeModality as composerPromptMentionsRelativeObject,
} from '@sciforge-ui/runtime-contract/ui-composer-intent-policy';
import {
  buildSilentStreamDecisionRecord,
  buildSilentStreamRunId,
  isSeedDemoOrFixtureMessage,
  projectToolDoneEvent,
  projectToolStartedEvent,
  TEXT_DELTA_EVENT_TYPE,
  type SilentStreamDecisionRecord,
} from '@sciforge-ui/runtime-contract';
import { compactSciForgeReference, compactTransportExecutionUnits } from './transportContext';
import { sameChatContinuityPrompt } from '../../conversationContinuity';
import {
  contextWindowTelemetryEvent,
  normalizeWorkspaceRuntimeEvent,
  readWorkspaceToolStream,
  toolEvent,
  withConfiguredContextWindowLimit,
  workspaceResultCompletion,
} from './runtimeEvents';
import { actionableRuntimeStderrSummary, classifyRuntimeFailure } from './runtimeFailure';
import { assertCodexRealtimeSessionRequestBoundary, createCodexRealtimeSessionClient, CODEX_RUNTIME_STREAM_PATH, type CodexRealtimeControlSender } from './codexRealtimeSession';
import {
  buildComputerUseWorkspaceGatewayRequest,
  computerUseTerminalEquivalentTextRequested,
  computerUseWorkspaceGatewayDiagnosticRequested,
  sanitizedCompletionEvidencePolicy,
  sanitizedComputerUseTaskBindings,
} from './computerUseWorkspaceGatewayRequest';
import { attachRuntimeGuiPresentationToResponse } from './runtimeGuiPresentation';
import { hasAnnotationPlanOnlyEnvelopeMarker, isAnnotationPlanOnlyEnvelope } from '../../feedback/annotationPlanModel';

const CODEX_RUNTIME_REQUEST_SCHEMA_VERSION = 'sciforge.codex-runtime-stream-request.v1';
const DEFAULT_RUNTIME_PROFILE = 'sciforge-runtime-default';
const DEFAULT_RUNTIME_PROVIDER = 'sciforge-model-router';
const DEFAULT_RUNTIME_MODEL_ALIAS = 'sciforge-router';
const UNCONFIGURED_RUNTIME_MODEL = 'unconfigured';
const TRANSPORT_SESSION_MESSAGE_LIMIT = 12;
const TRANSPORT_RUN_LIMIT = 8;
const TRANSPORT_EXECUTION_UNIT_LIMIT = 16;
const TRANSPORT_ARTIFACT_LIMIT = 16;
const TRANSPORT_ARTIFACT_INLINE_DATA_BYTES = 12_000;
const TRANSPORT_TEXT_PREVIEW_CHARS = 500;
const TRANSPORT_REF_KEYS = ['ref', 'dataRef', 'path', 'filePath', 'markdownRef', 'contentRef', 'stdoutRef', 'stderrRef', 'outputRef'] as const;
const WORKSPACE_TOOL_STREAM_PATH = '/api/sciforge/tools/run/stream';
const RUNTIME_PROVIDER_PREFLIGHT_MANIFEST_PATH = '/api/sciforge/runtime-provider-preflight/manifest';
const RUNTIME_PROVIDER_PREFLIGHT_EVIDENCE_REF = 'runtime-provider-preflight:current-env';
const CODEX_RUNTIME_SELECTED_MESSAGE_CONTEXT_LIMIT = 2;
const CODEX_RUNTIME_SELECTED_MESSAGE_TEXT_LIMIT = 2_000;
const MULTITASK_SUMMARY_GUIDANCE = 'Use Multitask for parallel research, long commands, or independent verification. Keep strongly coupled same-file edits or full-chat-history work with the main agent.';

type RuntimeInputObjectSource = 'explicit-reference' | 'recent-visible-message' | 'recent-artifact';

interface RuntimeInputObject {
  schemaVersion: 'sciforge.runtime.input-object.v1';
  ref: string;
  source: RuntimeInputObjectSource;
  mimeType?: string;
  title?: string;
  visionDescriptor?: RuntimeInputObjectVisionDescriptor;
}

interface RuntimeInputObjectVisionDescriptor {
  schemaVersion: 'sciforge.runtime.input-object.vision-descriptor.v1';
  status: 'pending' | 'ready' | 'failed';
  source: 'upload-preextract' | 'first-reference-preextract' | 'agent-host-cache' | 'model-router-trace' | 'manual';
  summary?: string;
  descriptorRef?: string;
  sha256?: string;
  traceRef?: string;
  createdAt?: string;
}

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
  callbacks: {
    onEvent?: (event: AgentStreamEvent) => void;
    onRealtimeControlReady?: (sender: CodexRealtimeControlSender) => void;
    onRuntimeRequest?: (request: Record<string, unknown>) => void;
  } = {},
  signal?: AbortSignal,
): Promise<NormalizedAgentResponse> {
  assertNotAnnotationPlanOnlyRuntimeRequest(input);
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
    const useComputerUseDiagnosticShim = computerUseWorkspaceGatewayDiagnosticRequested(input);
    const useComputerUseTerminalText = computerUseTerminalEquivalentTextRequested(input);
    callbacks.onEvent?.(toolEvent('current-plan', useComputerUseDiagnosticShim
      ? '当前计划：显式使用 legacy /computer-use Workspace Gateway diagnostic shim；该路径只保留诊断用途，GUI 不拥有 executor 参数或正式执行路由。'
      : useComputerUseTerminalText
        ? '当前计划：把 Computer Use 终端等价文本交给 Codex Runtime；正式执行由 Codex app-server/CLI/native Computer Use plugin/tool 或 module.invoke(actions, execute) 决定。'
      : `当前计划：把 GUI 用户操作转换为 terminal-equivalent text，交给 Codex Runtime bridge；任务上下文、记忆、工具和展示意图由 Codex/TUI 原生机制负责。`));
    callbacks.onEvent?.(projectToolStartedEvent({ id: makeId('evt'), createdAt: nowIso() }, builtInScenarioId));
    const commandId = makeId(useComputerUseDiagnosticShim ? 'computer-use-diagnostic' : 'codex-command');
    const runtimeEvents: AgentStreamEvent[] = [];
    const handleRuntimeEvent = (event: unknown) => {
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
        const initialStatus = buildInitialResponseProgressEvent(extractResponsePlan(normalized.raw), input.config.locale);
        if (initialStatus) {
          emittedInitialResponseStatus = true;
          callbacks.onEvent?.(initialStatus);
        }
      }
      callbacks.onEvent?.(normalized);
    };
    let response: Response | undefined;
    let result: unknown;
    let error: string | undefined;
    let requestBodyForFailure: ReturnType<typeof buildCodexRuntimeStreamRequest> | undefined;
    if (useComputerUseDiagnosticShim) {
      activeRequestController = new AbortController();
      if (signal?.aborted) activeRequestController.abort();
      const requestBody = buildComputerUseWorkspaceGatewayRequest(input, commandId);
      const requestBodyText = JSON.stringify(requestBody);
      callbacks.onEvent?.(contextWindowTelemetryEvent(
        input,
        requestBodyText,
        'Computer Use legacy diagnostic shim request/projection preflight estimate',
      ));
      response = await fetch(`${input.config.workspaceWriterBaseUrl}${WORKSPACE_TOOL_STREAM_PATH}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: requestBodyText,
        signal: activeRequestController.signal,
      });
      const stream = await readWorkspaceToolStream(response, handleRuntimeEvent);
      result = stream.result;
      error = stream.error;
    } else {
      let requestBody = buildCodexRuntimeStreamRequest({
        input,
        commandId,
        referenceSummary,
        silentStreamRunId,
      });
      const providerPreflightBlock = await runtimeProviderPreflightBlock(input, activeRequestController?.signal ?? signal);
      if (providerPreflightBlock) {
        const detail = runtimeProviderPreflightPublicFailureReason(providerPreflightBlock);
        callbacks.onEvent?.(toolEvent('runtime-provider-preflight-blocked', detail, {
          category: providerPreflightBlock.category,
          owner: providerPreflightBlock.owner,
          httpStatus: runtimeProviderPreflightHttpStatus(providerPreflightBlock),
        }));
        return runtimeCodexPreflightBlockedResponse({
          input,
          request: requestBody,
          manifest: providerPreflightBlock,
        });
      }
      let staleResumeRetried = false;
      for (;;) {
        requestBodyForFailure = requestBody;
        assertCodexRuntimeStreamRequestBoundary(requestBody);
        assertCodexRealtimeSessionRequestBoundary(requestBody);
        callbacks.onRuntimeRequest?.(requestBody);
        const requestBodyText = JSON.stringify(requestBody);
        callbacks.onEvent?.(contextWindowTelemetryEvent(
          input,
          requestBodyText,
          'Codex Runtime command/projection preflight estimate',
        ));
        callbacks.onEvent?.(codexRuntimeRunEvent(requestBody));
        const composerDeclaredIntentEvent = composerDeclaredIntentProjectionEvent(requestBody);
        if (composerDeclaredIntentEvent) callbacks.onEvent?.(composerDeclaredIntentEvent);
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
            const client = createCodexRealtimeSessionClient({
              workspaceWriterBaseUrl: input.config.workspaceWriterBaseUrl,
              onControlReady: callbacks.onRealtimeControlReady,
            });
            const stream = await client.stream(requestBodyText, handleRuntimeEvent, activeRequestController.signal);
            response = stream.response;
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
        if (runtimeCodexErrorIsMissingNativeRollout(error) && requestBody.codexSessionId && !staleResumeRetried) {
          staleResumeRetried = true;
          callbacks.onEvent?.(toolEvent('runtime-resume-stale', 'Runtime Codex native session resume is stale; retrying once as a fresh session.', {
            commandId,
            staleCodexSessionId: requestBody.codexSessionId,
            previousAttemptId: requestBody.attemptId,
            retryAttemptId: `${commandId}-attempt-2`,
          }));
          requestBody = buildCodexRuntimeStreamRequest({
            input,
            commandId,
            referenceSummary,
            silentStreamRunId,
            attemptNumber: 2,
            forceFreshSession: true,
          });
          response = undefined;
          result = undefined;
          error = undefined;
          continue;
        }
        break;
      }
    }
    if (!useComputerUseDiagnosticShim && requestBodyForFailure && error && runtimeEvents.some(isRuntimeCodexFailedEvent)) {
      return runtimeCodexFailedResponse({
        input,
        request: requestBodyForFailure,
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
  const presented = attachRuntimeGuiPresentationToResponse(normalized, result);
  const codexSessionId = codexSessionIdFromRuntimeResult(result) ?? codexSessionIdFromRuntimeEvents(runtimeEvents);
  if (!codexSessionId) return presented;
  const conversationLaneId = runtimeConversationLaneId(input);
  const codexThreadRef = codexThreadObjectReference(codexSessionId, commandId);
  return {
    ...presented,
    run: {
      ...presented.run,
      raw: {
        ...(isRecord(presented.run.raw) ? presented.run.raw : {}),
        codexSessionId,
        conversationLaneId,
        runtimeResumePolicy: runtimeResumePolicy(input),
      },
      objectReferences: [
        ...(presented.run.objectReferences ?? []),
        codexThreadRef,
      ],
    },
    message: {
      ...presented.message,
      objectReferences: [
        ...(presented.message.objectReferences ?? []),
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

function assertNotAnnotationPlanOnlyRuntimeRequest(input: SendAgentMessageInput) {
  if (
    input.turnMode !== 'annotation-plan-only'
    && !isAnnotationPlanOnlyEnvelope(input.conversationEnvelope)
    && !hasAnnotationPlanOnlyEnvelopeMarker(input.conversationEnvelope)
  ) return;
  throw new Error('annotation-plan-only requests must be resolved by the plan-only conversation policy before Codex Runtime transport; runtime execution, repair, workspace writes, and GitHub sync are forbidden.');
}

async function runtimeProviderPreflightBlock(
  input: SendAgentMessageInput,
  signal: AbortSignal | undefined,
): Promise<RuntimeProviderPreflightManifest | undefined> {
  if (!runtimeProviderPreflightGateEnabled(input)) return undefined;
  if (localHostBrowserEvidenceCanRunWithoutProvider(input)) return undefined;
  if (currentVSCodeComputerUseNativeRouteCanRunWithoutProvider(input)) return undefined;
  const manifest = await loadRuntimeProviderPreflightManifestForGate(input, signal);
  if (!manifest || manifest.category === 'ready') return undefined;
  return manifest;
}

function localHostBrowserEvidenceCanRunWithoutProvider(input: SendAgentMessageInput): boolean {
  const prompt = (input.prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!prompt) return false;
  const asksForLookup = /(?:搜索|查找|查询|查一下|检索|浏览|打开|阅读|获取|总结|search|look\s*up|find|browse|open|read|summari[sz]e)/iu.test(prompt);
  if (!asksForLookup) return false;
  return /(?:https?:\/\/|www\.|site:|\barxiv\b|\bhugging\s*face\b|\bhuggingface\b|网页|网站|来源|论文|文章|新闻|今天|今日|最新|近期|\bweb\b|\bsite\b|\bsource\b|\bsources\b|\bpaper\b|\bpapers\b|\barticle\b|\barticles\b|\bnews\b|\btoday\b|\blatest\b|\brecent\b|\bcurrent\b)/iu.test(prompt);
}

function currentVSCodeComputerUseNativeRouteCanRunWithoutProvider(input: SendAgentMessageInput): boolean {
  const prompt = (input.prompt ?? '').replace(/\s+/g, ' ').trim();
  if (!prompt) return false;
  const mentionsVSCode = /(?:\bvs\s*code\b|\bvscode\b|visual\s+studio\s+code|当前\s*VSCode|当前\s*vs\s*code)/iu.test(prompt);
  if (!mentionsVSCode) return false;
  const mentionsLocalComputerUse = /(?:\bcomputer\s*use\b|桌面|GUI|窗口|鼠标|键盘|命令面板|command\s+palette)/iu.test(prompt);
  if (!mentionsLocalComputerUse) return false;
  return /(?:操纵|操作|控制|绑定|打开|关闭|点击|输入|读取|观察|observe|bind|control|open|close|command\s+palette|命令面板)/iu.test(prompt);
}

function runtimeProviderPreflightGateEnabled(input: SendAgentMessageInput) {
  if ((input.runtimeHealth ?? []).some((item) => item.id === 'model' && item.source === 'runtime-provider-preflight')) return true;
  return typeof window !== 'undefined';
}

async function loadRuntimeProviderPreflightManifestForGate(
  input: SendAgentMessageInput,
  signal: AbortSignal | undefined,
): Promise<RuntimeProviderPreflightManifest | undefined> {
  let firstSyntheticFailure: RuntimeProviderPreflightManifest | undefined;
  for (const baseUrl of await runtimeProviderPreflightCandidateBaseUrls(input)) {
    let response: Response;
    try {
      response = await fetch(`${baseUrl}${RUNTIME_PROVIDER_PREFLIGHT_MANIFEST_PATH}`, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal,
      });
    } catch {
      firstSyntheticFailure ??= runtimeProviderPreflightSyntheticManifest(0);
      continue;
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) {
      firstSyntheticFailure ??= runtimeProviderPreflightSyntheticManifest(response.status);
      continue;
    }
    if (!/\bjson\b/i.test(contentType)) continue;
    const json = await response.json().catch(() => undefined) as unknown;
    const manifest = isRecord(json) ? json.manifest : undefined;
    if (isRuntimeProviderPreflightManifest(manifest)) return manifest;
  }
  return firstSyntheticFailure;
}

async function runtimeProviderPreflightCandidateBaseUrls(input: SendAgentMessageInput): Promise<string[]> {
  const candidates = [
    input.config.workspaceWriterBaseUrl,
    ...(input.config.peerInstances ?? []).map((peer) => peer.workspaceWriterUrl),
    await desktopRuntimeWorkspaceWriterBaseUrl(),
    defaultSciForgeConfig.workspaceWriterBaseUrl,
  ];
  return uniqueRuntimeStringList(candidates.map((candidate) => candidate?.replace(/\/+$/, '') ?? ''))
    .filter((candidate) => /^https?:\/\//i.test(candidate));
}

async function desktopRuntimeWorkspaceWriterBaseUrl(): Promise<string | undefined> {
  if (typeof window === 'undefined' || !window.sciforgeDesktop?.getRuntimeConfig) return undefined;
  try {
    const raw = await window.sciforgeDesktop.getRuntimeConfig();
    return isRecord(raw) ? asString(raw.workspaceWriterBaseUrl) : undefined;
  } catch {
    return undefined;
  }
}

function isRuntimeProviderPreflightManifest(value: unknown): value is RuntimeProviderPreflightManifest {
  if (!isRecord(value)) return false;
  const category = asString(value.category);
  return value.schemaVersion === 'sciforge.runtime-provider-preflight.current-env.v1'
    && Boolean(category)
    && Array.isArray(value.nextActions);
}

function runtimeProviderPreflightSyntheticManifest(httpStatus: number): RuntimeProviderPreflightManifest {
  return {
    schemaVersion: 'sciforge.runtime-provider-preflight.current-env.v1',
    checkedAt: nowIso(),
    releaseAcceptance: 'not-evaluated',
    runtimeApiKeyPresentInServiceEnv: false,
    upstreamBaseUrlPresent: false,
    upstreamKeySourceKind: 'missing',
    upstreamBaseUrlSourceKind: 'missing',
    category: 'repo-bug',
    owner: 'repo',
    policyViolations: [`runtime-provider-preflight endpoint returned HTTP ${httpStatus}`],
    missingEnv: [],
    evidenceMode: 'current-env-diagnostic-only',
    checkedHealthz: {
      category: 'repo-bug',
      ok: false,
      retryable: httpStatus >= 500,
      httpStatus,
      releaseAcceptance: 'not-evaluated',
    },
    nextActions: [{
      label: 'Fix the runtime provider preflight endpoint before starting Codex Runtime.',
      writesRepo: false,
    }],
  };
}

function buildCodexRuntimeStreamRequest(input: {
  input: SendAgentMessageInput;
  commandId: string;
  referenceSummary: Array<Record<string, unknown>>;
  silentStreamRunId: string;
  attemptNumber?: number;
  forceFreshSession?: boolean;
}) {
  const config = input.input.config;
  const profile = config.runtimeProfile?.trim() || DEFAULT_RUNTIME_PROFILE;
  const provider = runtimeProviderForVisibleMetadata(config.modelProvider);
  const model = runtimeModelForVisibleMetadata(config.modelName);
  const codexSessionId = input.forceFreshSession ? undefined : codexSessionIdForRuntimeResume(input.input);
  const inputObjects = runtimeInputObjectsForRuntimeRequest(input.input, input.referenceSummary);
  const commandText = buildCodexRuntimeCommandText(input, {
    resumeRequested: Boolean(codexSessionId),
    inputObjects,
  });
  const attemptNumber = Math.max(1, Math.trunc(input.attemptNumber ?? 1));
  const attemptId = `${input.commandId}-attempt-${attemptNumber}`;
  const computerUseApproval = computerUseApprovalRuntimeMetadata(input.input, commandText, input.referenceSummary);
  const runtimeIntent = computerUseRuntimeHostIntent(input.input, commandText);
  const agentHostInput = buildCodexAgentHostInput(input.input, input.referenceSummary);
  return {
    schemaVersion: CODEX_RUNTIME_REQUEST_SCHEMA_VERSION,
    realtimeSession: createCodexRealtimeSessionEnvelope({
      commandId: input.commandId,
      attemptId,
      codexSessionId,
    }),
    commandId: input.commandId,
    attemptId,
    commandText,
    workspacePath: config.workspacePath,
    profile,
    codexSessionId,
    allowOpenAiRuntime: false,
    ...(inputObjects.length ? { inputObjects } : {}),
    agentHostInput,
    guiExtension: {
      enabled: false,
    },
    ...(runtimeIntent ? { runtimeIntent } : {}),
    ...(computerUseApproval ? {
      humanApproval: computerUseApproval.humanApproval,
      uiState: computerUseApproval.uiState,
    } : {}),
    auditMetadata: {
      schemaVersion: 'sciforge.codex-runtime-stream-audit.v1',
      boundary: 'GUI-to-TUI input is terminal-equivalent text only; non-text fields are adapter metadata and must not be interpreted as task context.',
      promptCarriedBy: 'commandText',
      legacyHandoffBoundary: 'GUI transcript, artifact bodies, expected results, capability selection, provider routing, and recovery policy stay outside the Runtime Codex task request.',
      declaredPreferenceBoundary: 'Composer model/mode/Autonomy choices are public declared intents for Agent Host policy under guiLocalProjection only; they are not provider routes or concrete runtime model names.',
      runtime: {
        kind: 'codex',
        provider,
        model,
        profile,
        apiKeyConfigured: false,
        allowOpenAiRuntime: false,
      },
      guiLocalProjection: auditOnlyGuiProjectionRefs(input.input, input.referenceSummary),
      silentStreamRunId: input.silentStreamRunId,
      evidenceRefs: [
        `audit:codex-app-server:${input.commandId}:${attemptId}:raw-events`,
        `audit:codex-runtime:${input.commandId}:${attemptId}:stderr`,
        `audit:codex-runtime:${input.commandId}:${attemptId}:normalized-events`,
      ],
    },
  };
}

function computerUseRuntimeHostIntent(input: SendAgentMessageInput, commandText: string) {
  const scenario = input.scenarioOverride;
  const taskBindings = sanitizedComputerUseTaskBindings(scenario);
  const completionEvidencePolicy = sanitizedCompletionEvidencePolicy(scenario?.completionEvidencePolicy);
  if (!taskBindings && !completionEvidencePolicy) return undefined;
  const computerUseCommand = composerPromptIsComputerUseSlashCommand(commandText.trimStart());
  if (!computerUseCommand && !taskBindings && !completionEvidencePolicy) return undefined;
  return {
    schemaVersion: 'sciforge.runtime-codex.host-intent.v1',
    kind: 'computer-use-native-route',
    source: 'host-owned',
    ...(completionEvidencePolicy ? { completionEvidencePolicy } : {}),
    ...(taskBindings ?? {}),
  };
}

function buildCodexAgentHostInput(
  input: SendAgentMessageInput,
  referenceSummary: Array<Record<string, unknown>>,
) {
  const authorization = safeComposerDeclaredIntents(input.composerDeclaredIntents)?.authorization
    ?? defaultComposerDeclaredAuthorization();
  const readiness = buildCodexAgentHostRuntimeReadinessProjection(input.runtimeHealth);
  return {
    schemaVersion: 'sciforge.codex-agent-host-input.v1',
    source: 'ui-normal-composer-transport',
    intentText: input.prompt.trim().slice(0, 2_000),
    authorizationProfileId: authorization.profileId,
    authorizationProfileSource: authorization.source,
    authorizationScope: authorization.scope,
    singleTurnOverride: authorization.singleTurnOverride,
    policyOwner: 'codex-agent-host-runtime',
    refs: uniqueRuntimeStringList(referenceSummary.flatMap((reference) => [
      reference.ref,
      reference.path,
      reference.dataRef,
      reference.id,
    ])).slice(0, 24),
    ...(readiness ? { readiness } : {}),
  };
}

function buildCodexAgentHostRuntimeReadinessProjection(value: SendAgentMessageInput['runtimeHealth']) {
  const items = (value ?? []).flatMap((item) => {
    if (!isRecord(item)) return [];
    const id = knownString(item.id, ['ui', 'workspace', 'codex-runtime', 'agentserver', 'model', 'library']);
    const status = knownString(item.status, ['online', 'checking', 'optional', 'not-configured', 'offline']);
    if (!id || !status) return [];
    const source = knownString(item.source, ['settings', 'runtime-provider-preflight']);
    const capabilities = uniqueRuntimeStringList(Array.isArray(item.capabilities) ? item.capabilities : []).slice(0, 64);
    return [{
      id,
      status,
      ...(source ? { source } : {}),
      ...(capabilities.length ? { capabilities } : {}),
    }];
  }).slice(0, 8);
  if (!items.length) return undefined;
  return {
    schemaVersion: 'sciforge.agent-host-runtime-readiness-projection.v1',
    source: 'ui-runtime-health-projection',
    policyOwner: 'codex-agent-host-runtime',
    items,
    refs: items.map((item) => `runtime-health:${item.id}`).slice(0, 8),
  };
}

function runtimeProviderForVisibleMetadata(value: string) {
  const provider = value.trim();
  if (!provider || provider === 'native' || provider === DEFAULT_RUNTIME_PROVIDER) return DEFAULT_RUNTIME_PROVIDER;
  return DEFAULT_RUNTIME_PROVIDER;
}

function runtimeModelForVisibleMetadata(value: string) {
  const model = value.trim();
  if (!model || model === UNCONFIGURED_RUNTIME_MODEL) return UNCONFIGURED_RUNTIME_MODEL;
  return model === DEFAULT_RUNTIME_MODEL_ALIAS ? DEFAULT_RUNTIME_MODEL_ALIAS : DEFAULT_RUNTIME_MODEL_ALIAS;
}

function codexSessionIdForRuntimeResume(input: SendAgentMessageInput): string | undefined {
  const policy = runtimeResumePolicy(input);
  if (policy === 'none') return undefined;
  const selectedSessionId = selectedCodexSessionId(input);
  if (selectedSessionId) return selectedSessionId;
  if (policy === 'explicit-reference-only') return undefined;
  return latestCodexSessionIdForConversationLane(input);
}

function runtimeResumePolicy(input: SendAgentMessageInput): NonNullable<SendAgentMessageInput['runtimeResumePolicy']> {
  if (input.runtimeResumePolicy) return input.runtimeResumePolicy;
  if (input.turnMode === 'annotation-quick-action') return 'none';
  return 'same-conversation-lane';
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
  const composerDeclaredIntents = safeComposerDeclaredIntents(input.composerDeclaredIntents)
    ?? defaultComposerAuthorizationDeclaredIntents();
  return {
    currentTurnId: input.currentTurnId,
    selectedRefCount: referenceSummary.length,
    refs: uniqueRuntimeStringList([...references, ...runRefs, ...artifactRefs, ...claimRefs, ...executionRefs]).slice(0, 48),
    ...(composerDeclaredIntents ? { composerDeclaredIntents } : {}),
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

function safeComposerDeclaredIntents(value: unknown) {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 'sciforge.composer-declared-intents.v1' || value.source !== 'ui-action-audit-log') return undefined;
  const model = safeComposerDeclaredModelIntent(value.model);
  const mode = safeComposerDeclaredModeIntent(value.mode);
  const authorization = safeComposerDeclaredAuthorization(value.authorization);
  if (!model && !mode && !authorization) return undefined;
  return {
    schemaVersion: 'sciforge.composer-declared-intents.v1',
    source: 'ui-action-audit-log',
    ...(model ? { model } : {}),
    ...(mode ? { mode } : {}),
    ...(authorization ? { authorization } : {}),
  };
}

function defaultComposerDeclaredAuthorization() {
  return {
    profileId: 'high-autonomy',
    publicLabel: 'High Autonomy',
    scope: {
      user: 'current-user',
      workspace: 'current-workspace',
    },
    source: 'composer-autonomy-default',
    singleTurnOverride: false,
    hardConfirmCategories: [...COMPOSER_HARD_CONFIRM_CATEGORIES],
  };
}

function defaultComposerAuthorizationDeclaredIntents() {
  return {
    schemaVersion: 'sciforge.composer-declared-intents.v1',
    source: 'ui-action-audit-log',
    authorization: defaultComposerDeclaredAuthorization(),
  };
}

const COMPOSER_HARD_CONFIRM_CATEGORIES = [
  'payments-transfers-purchases',
  'external-communications',
  'external-system-submission',
  'remote-delete-overwrite-archive',
  'external-upload',
  'account-security-privacy-billing',
  'legal-compliance-contracts',
  'external-system-execution',
] as const;

function safeComposerDeclaredAuthorization(value: unknown) {
  if (!isRecord(value)) return undefined;
  const profileId = knownString(value.profileId, ['assisted-autonomy', 'high-autonomy', 'research-sandbox-max']);
  if (!profileId) return undefined;
  const source = knownString(value.source, ['composer-autonomy-default', 'composer-autonomy-menu']) ?? 'composer-autonomy-default';
  const actionId = asString(value.actionId);
  const declaredAt = asString(value.declaredAt);
  return {
    profileId,
    publicLabel: publicComposerDeclaredAuthorizationLabel(value.publicLabel, profileId),
    scope: {
      user: 'current-user',
      workspace: 'current-workspace',
    },
    source,
    singleTurnOverride: value.singleTurnOverride === true,
    ...(actionId ? { actionId } : {}),
    ...(declaredAt ? { declaredAt } : {}),
    hardConfirmCategories: [...COMPOSER_HARD_CONFIRM_CATEGORIES],
  };
}

function safeComposerDeclaredModelIntent(value: unknown) {
  if (!isRecord(value)) return undefined;
  const modelIntentId = knownString(value.modelIntentId, ['auto', 'max', 'assistant-auto', 'assistant-fast', 'assistant-balanced', 'assistant-deep']);
  const mode = knownString(value.mode, ['auto', 'max', 'assistant']);
  const capabilityTier = knownString(value.capabilityTier, ['auto', 'max', 'fast', 'balanced', 'deep']);
  const publicLabel = publicComposerDeclaredLabel(value.publicLabel, modelIntentId);
  const actionId = asString(value.actionId);
  const declaredAt = asString(value.declaredAt);
  if (!modelIntentId || !mode || !capabilityTier || !actionId || !declaredAt) return undefined;
  return {
    modelIntentId,
    mode,
    capabilityTier,
    publicLabel,
    actionId,
    declaredAt,
  };
}

function safeComposerDeclaredModeIntent(value: unknown) {
  if (!isRecord(value)) return undefined;
  const modeIntentId = knownString(value.modeIntentId, ['plan', 'debug', 'multitask', 'ask']);
  const publicLabel = publicComposerDeclaredModeLabel(value.publicLabel, modeIntentId);
  const actionId = asString(value.actionId);
  const declaredAt = asString(value.declaredAt);
  if (!modeIntentId || !publicLabel || !actionId || !declaredAt) return undefined;
  return {
    modeIntentId,
    publicLabel,
    ...(modeIntentId === 'multitask' ? { summaryGuidance: MULTITASK_SUMMARY_GUIDANCE } : {}),
    actionId,
    declaredAt,
  };
}

function knownString<T extends string>(value: unknown, allowed: readonly T[]): T | undefined {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? value as T : undefined;
}

const PUBLIC_COMPOSER_LABEL_INTERNAL_DETAIL_PATTERN = /(?:secret|token|api.?key|authorization|password|provider|modelName|modelProvider|modelBaseUrl|baseUrl|endpoint|url|workspacePath|profile|https?:\/\/|\/Users\/|\/Applications\/|\/tmp\/|sk-)/i;

function publicComposerDeclaredLabel(value: unknown, modelIntentId: string | undefined) {
  const defaultLabel = modelIntentId === 'max'
    ? 'MAX Mode'
    : modelIntentId === 'assistant-fast'
      ? 'Assistant Fast'
      : modelIntentId === 'assistant-balanced'
        ? 'Assistant Balanced'
        : modelIntentId === 'assistant-deep'
          ? 'Assistant Deep'
          : modelIntentId === 'auto'
            ? 'Auto'
            : 'Assistant Auto';
  return sanitizedPublicComposerDeclaredLabel(value, defaultLabel);
}

function publicComposerDeclaredModeLabel(value: unknown, modeIntentId: string | undefined) {
  const defaultLabel = modeIntentId === 'plan'
    ? 'Plan'
    : modeIntentId === 'debug'
      ? 'Debug'
      : modeIntentId === 'multitask'
        ? 'Multitask'
        : modeIntentId === 'ask'
          ? 'Ask'
          : undefined;
  return sanitizedPublicComposerDeclaredLabel(value, defaultLabel);
}

function publicComposerDeclaredAuthorizationLabel(value: unknown, profileId: string) {
  const defaultLabel = profileId === 'assisted-autonomy'
    ? 'Assisted Autonomy'
    : profileId === 'research-sandbox-max'
      ? 'Research Sandbox Max'
      : 'High Autonomy';
  return sanitizedPublicComposerDeclaredLabel(value, defaultLabel);
}

function sanitizedPublicComposerDeclaredLabel(value: unknown, defaultLabel: string | undefined) {
  if (typeof value !== 'string') return defaultLabel;
  const compact = value.replace(/\s+/g, ' ').trim().slice(0, 48);
  if (!compact || PUBLIC_COMPOSER_LABEL_INTERNAL_DETAIL_PATTERN.test(compact)) return defaultLabel;
  return compact;
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
    'references',
    'expectedEvidenceKinds',
    'selectedToolIds',
    'selectedSenseIds',
    'selectedActionIds',
    'selectedComponentIds',
    'selectedVerifierIds',
    'transportAgentContext',
    'turnMode',
    'conversationEnvelope',
    'conversationLaneId',
    'runtimeResumePolicy',
  ];
  const hits = forbidden.filter((key) => key in request);
  if ('humanApproval' in request || 'uiState' in request) {
    assertCodexRuntimeApprovalMetadataBoundary(request);
  }
  const audit = isRecord(request.auditMetadata) ? request.auditMetadata : {};
  const auditHits = forbidden.filter((key) => key in audit);
  if (hits.length || auditHits.length) {
    throw new Error(`Runtime Codex request contains legacy GUI handoff fields: ${[...hits, ...auditHits].join(', ')}`);
  }
  if (!request.commandText.trim()) throw new Error('Runtime Codex request commandText is required.');
}

function assertCodexRuntimeApprovalMetadataBoundary(request: ReturnType<typeof buildCodexRuntimeStreamRequest>) {
  if (!/(?:^|\n)\s*\/(?:computer-use|computer\s+use)\s+approve\b/i.test(request.commandText)) {
    throw new Error('Runtime Codex approval metadata is only allowed for /computer-use approve commandText.');
  }
  const humanApproval = isRecord((request as Record<string, unknown>).humanApproval)
    ? (request as Record<string, unknown>).humanApproval as Record<string, unknown>
    : {};
  const uiState = isRecord((request as Record<string, unknown>).uiState)
    ? (request as Record<string, unknown>).uiState as Record<string, unknown>
    : {};
  const humanAllowed = new Set(['approvalRef', 'decision', 'source', 'approvalProvenance']);
  const uiAllowed = new Set(['schemaVersion', 'approvalRef', 'computerUseApprovalRef', 'terminalEquivalentText', 'approvalProvenance']);
  const humanExtra = Object.keys(humanApproval).filter((key) => !humanAllowed.has(key));
  const uiExtra = Object.keys(uiState).filter((key) => !uiAllowed.has(key));
  if (humanExtra.length || uiExtra.length) {
    throw new Error(`Runtime Codex approval metadata contains non-confirmation fields: ${[...humanExtra, ...uiExtra].join(', ')}`);
  }
}

function buildCodexRuntimeCommandText(
  input: Parameters<typeof buildCodexRuntimeStreamRequest>[0],
  options: { resumeRequested?: boolean; inputObjects?: RuntimeInputObject[] } = {},
) {
  const prompt = input.input.prompt.trim();
  const inputObjectRefSet = new Set((options.inputObjects ?? runtimeInputObjectsForRuntimeRequest(input.input, input.referenceSummary)).map((ref) => ref.ref));
  const readableRefs = uniqueRuntimeStringList(input.referenceSummary.flatMap((reference) => {
    const readableRefs = [reference.dataRef, reference.path, reference.ref].filter((value): value is string => Boolean(asString(value)));
    return readableRefs.length ? readableRefs : [reference.id];
  })).filter((ref) => !inputObjectRefSet.has(ref));
  const refs = uniqueRuntimeStringList(readableRefs).slice(0, 12);
  const computerUseCommand = composerPromptIsComputerUseSlashCommand(prompt);
  const exactComputerUseCommand = composerComputerUseCommandRequiresExactTerminalText(prompt);
  if (exactComputerUseCommand) return prompt;
  const taskText = computerUseCommand
    ? [prompt, refs.length ? ['Approval/source refs:', ...refs.map((ref) => `- ${ref}`)].join('\n') : undefined].filter(Boolean).join('\n\n')
    : refs.length
    ? `ask ${refs.map((ref) => `--ref ${quoteTerminalArg(ref)}`).join(' ')} ${quoteTerminalArg(prompt)}`
    : prompt;
  if (computerUseCommand) {
    if (!options.resumeRequested) return taskText;
    return [
      taskText,
      'Runtime resume context: continue the active Runtime Codex session only as transport/session context; the slash command above remains the terminal-equivalent task command.',
    ].join('\n\n');
  }
  const selectedMessageContext = selectedVisibleMessageContextForRuntimeCommand(input.input);
  const continuityContext = !options.resumeRequested
    ? sameChatContinuityContextForRuntimeCommand(input.input)
    : undefined;
  if (continuityContext || selectedMessageContext) {
    return [
      continuityContext,
      selectedMessageContext,
      'Current request:',
      taskText,
    ].filter(Boolean).join('\n\n');
  }
  if (!options.resumeRequested) return taskText;
  const resumeContextNeeded =
    refs.length > 0
    || Boolean(selectedMessageContext)
    || composerPromptMentionsRelativeObject(prompt)
    || sameChatContinuityPrompt(prompt)
    || codexRuntimePromptRequestsResumeContext(prompt);
  if (!resumeContextNeeded) return taskText;
  const resumeContext = 'Continue the active Runtime Codex session. Interpret relative references such as "previous turn", "last answer", or "that passphrase" against the immediately preceding non-seed user/assistant exchange in this native Codex session unless selected refs say otherwise.';
  return [
    resumeContext,
    selectedMessageContext,
    'Current request:',
    taskText,
  ].filter(Boolean).join('\n\n');
}

function codexRuntimePromptRequestsResumeContext(prompt: string) {
  return /\b(?:continue|resume|reuse|keep|stay in|use)\b.{0,40}\b(?:same|current|active|existing|previous|prior)\b.{0,20}\b(?:thread|chat|conversation|session)\b/i.test(prompt)
    || /\b(?:do not|don't|dont|without|no)\b.{0,30}\b(?:new|fresh)\b.{0,20}\b(?:thread|chat|conversation|session)\b/i.test(prompt)
    || /(?:继续|沿用|复用|保持|接着).{0,16}(?:同一|同一个|当前|这个|原来|已有|上个|上一).{0,16}(?:对话|会话|线程)/i.test(prompt)
    || /(?:不要|别|无需).{0,8}(?:新开|新建|另开).{0,8}(?:对话|会话|线程)/i.test(prompt);
}

function runtimeInputObjectsForRuntimeRequest(
  input: SendAgentMessageInput,
  referenceSummary: Array<Record<string, unknown>>,
) {
  const explicit = runtimeInputObjectsFromReferenceLikeRecords(referenceSummary, 'explicit-reference');
  const named = namedRuntimeInputObjects(input);
  const relative = !named.length && composerPromptMentionsRelativeObject(input.prompt)
    ? [
        ...recentVisibleRuntimeInputObjects(input),
        ...recentArtifactRuntimeInputObjects(input),
      ]
    : [];
  return uniqueRuntimeInputObjects([...explicit, ...named, ...relative]).slice(0, 8);
}

function recentVisibleRuntimeInputObjects(input: SendAgentMessageInput) {
  const refs: RuntimeInputObject[] = [];
  for (const message of [...(input.messages ?? [])].reverse()) {
    if (isSeedDemoOrFixtureMessage(message)) continue;
    refs.push(...runtimeInputObjectsFromReferenceLikeRecords(message.references ?? [], 'recent-visible-message'));
    refs.push(...runtimeInputObjectsFromObjectReferences(message.objectReferences ?? [], 'recent-visible-message'));
    if (refs.length >= 8) break;
  }
  return uniqueRuntimeInputObjects(refs).slice(0, 8);
}

function allVisibleRuntimeInputObjects(input: SendAgentMessageInput) {
  const refs: RuntimeInputObject[] = [];
  for (const message of [...(input.messages ?? [])].reverse()) {
    if (isSeedDemoOrFixtureMessage(message)) continue;
    refs.push(...runtimeInputObjectsFromReferenceLikeRecords(message.references ?? [], 'recent-visible-message'));
    refs.push(...runtimeInputObjectsFromObjectReferences(message.objectReferences ?? [], 'recent-visible-message'));
  }
  return uniqueRuntimeInputObjects(refs);
}

function runtimeInputObjectsFromReferenceLikeRecords(records: unknown[], source: RuntimeInputObjectSource) {
  return uniqueRuntimeInputObjects(records.flatMap((record) => {
    if (!isRecord(record)) return [];
    const payload = isRecord(record.payload) ? record.payload : {};
    const metadata = isRecord(payload.metadata) ? payload.metadata : {};
    const provenance = isRecord(payload.provenance) ? payload.provenance : {};
    const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
    const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
    return [
      runtimeInputObjectCandidate(record, metadata, source),
      runtimeInputObjectCandidate(record, provenance, source),
      runtimeInputObjectCandidate(currentReference, isRecord(currentReference.provenance) ? currentReference.provenance : {}, source),
      runtimeInputObjectCandidate(objectReference, isRecord(objectReference.provenance) ? objectReference.provenance : {}, source),
    ];
  }));
}

function runtimeInputObjectsFromObjectReferences(records: unknown[], source: RuntimeInputObjectSource) {
  return uniqueRuntimeInputObjects(records.flatMap((record) => {
    if (!isRecord(record)) return [];
    return [runtimeInputObjectCandidate(record, isRecord(record.provenance) ? record.provenance : {}, source)];
  }));
}

function recentArtifactRuntimeInputObjects(input: SendAgentMessageInput) {
  const refs: RuntimeInputObject[] = [];
  for (const artifact of [...(input.artifacts ?? [])].reverse()) {
    if (!isRecord(artifact)) continue;
    refs.push(...runtimeInputObjectsFromArtifactRecord(artifact));
    if (refs.length >= 8) break;
  }
  return uniqueRuntimeInputObjects(refs).slice(0, 8);
}

function allArtifactRuntimeInputObjects(input: SendAgentMessageInput) {
  const refs: RuntimeInputObject[] = [];
  for (const artifact of [...(input.artifacts ?? [])].reverse()) {
    if (!isRecord(artifact)) continue;
    refs.push(...runtimeInputObjectsFromArtifactRecord(artifact));
  }
  return uniqueRuntimeInputObjects(refs);
}

function runtimeInputObjectsFromArtifactRecord(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const previewDescriptor = isRecord(artifact.previewDescriptor) ? artifact.previewDescriptor : {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  const candidates = [
    runtimeInputObjectCandidate(artifact, metadata, 'recent-artifact'),
    runtimeInputObjectCandidate(artifact, previewDescriptor, 'recent-artifact'),
    runtimeInputObjectCandidate(previewDescriptor, { ...metadata, type: artifact.type, artifactType: artifact.type }, 'recent-artifact'),
    runtimeInputObjectCandidate(data, { ...metadata, type: artifact.type, artifactType: artifact.type }, 'recent-artifact'),
  ];
  return uniqueRuntimeInputObjects(candidates);
}

function namedRuntimeInputObjects(input: SendAgentMessageInput) {
  const prompt = normalizedRuntimeInputObjectName(input.prompt);
  if (!prompt) return [];
  return uniqueRuntimeInputObjects([
    ...allVisibleRuntimeInputObjects(input),
    ...allArtifactRuntimeInputObjects(input),
  ].filter((object) => runtimeInputObjectNameMentionedInPrompt(object, prompt))).slice(0, 8);
}

function runtimeInputObjectNameMentionedInPrompt(object: RuntimeInputObject, normalizedPrompt: string) {
  return runtimeInputObjectNameCandidates(object)
    .map(normalizedRuntimeInputObjectName)
    .filter((candidate): candidate is string => Boolean(candidate && candidate.length >= 3))
    .some((candidate) => normalizedPrompt.includes(candidate));
}

function runtimeInputObjectNameCandidates(object: RuntimeInputObject) {
  const title = object.title;
  const basename = runtimeInputObjectRefBasename(object.ref);
  return uniqueRuntimeStringList([
    title,
    runtimeInputObjectNameStem(title),
    basename,
    runtimeInputObjectNameStem(basename),
  ]);
}

function runtimeInputObjectRefBasename(ref: string) {
  const clean = ref.split(/[?#]/, 1)[0] ?? ref;
  const basename = clean.split('/').filter(Boolean).pop() ?? clean;
  try {
    return decodeURIComponent(basename);
  } catch {
    return basename;
  }
}

function runtimeInputObjectNameStem(value: string | undefined) {
  if (!value) return undefined;
  return value.replace(/\.[A-Za-z0-9]{1,10}$/u, '');
}

function normalizedRuntimeInputObjectName(value: string | undefined) {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed
    .toLowerCase()
    .normalize('NFKC')
    .replace(/[\s"'“”‘’「」『』《》【】()[\]{}]+/g, '');
}

function runtimeInputObjectCandidate(
  record: Record<string, unknown>,
  auxiliary: Record<string, unknown> = {},
  source: RuntimeInputObjectSource,
): RuntimeInputObject | undefined {
  const ref = asString(auxiliary.path)
    ?? asString(auxiliary.dataRef)
    ?? asString(auxiliary.workspacePath)
    ?? asString(auxiliary.ref)
    ?? asString(record.path)
    ?? asString(record.dataRef)
    ?? asString(record.workspacePath)
    ?? asString(record.ref);
  if (!ref || !safeRuntimeInputObjectRef(ref)) return undefined;
  const mimeType = runtimeInputObjectMimeType(ref, record, auxiliary);
  if (!runtimeInputObjectHasMaterializableShape(ref, mimeType)) return undefined;
  const title = asString(auxiliary.title)
    ?? asString(record.title)
    ?? asString(auxiliary.name)
    ?? asString(record.name);
  const visionDescriptor = runtimeInputObjectVisionDescriptor(record, auxiliary);
  return {
    schemaVersion: 'sciforge.runtime.input-object.v1',
    ref,
    source,
    ...(mimeType ? { mimeType } : {}),
    ...(title ? { title: title.slice(0, 160) } : {}),
    ...(visionDescriptor ? { visionDescriptor } : {}),
  };
}

function runtimeInputObjectVisionDescriptor(
  record: Record<string, unknown>,
  auxiliary: Record<string, unknown>,
): RuntimeInputObjectVisionDescriptor | undefined {
  const candidates = [
    auxiliary.visionDescriptor,
    record.visionDescriptor,
    isRecord(auxiliary.metadata) ? auxiliary.metadata.visionDescriptor : undefined,
    isRecord(record.metadata) ? record.metadata.visionDescriptor : undefined,
    isRecord(auxiliary.previewDescriptor) ? auxiliary.previewDescriptor.visionDescriptor : undefined,
    isRecord(record.previewDescriptor) ? record.previewDescriptor.visionDescriptor : undefined,
  ];
  for (const candidate of candidates) {
    const descriptor = runtimeInputObjectVisionDescriptorCandidate(candidate);
    if (descriptor) return descriptor;
  }
  return undefined;
}

function runtimeInputObjectVisionDescriptorCandidate(value: unknown): RuntimeInputObjectVisionDescriptor | undefined {
  if (!isRecord(value)) return undefined;
  if (value.schemaVersion !== 'sciforge.runtime.input-object.vision-descriptor.v1') return undefined;
  const status = asString(value.status);
  const source = asString(value.source);
  if (!isRuntimeInputObjectVisionDescriptorStatus(status) || !isRuntimeInputObjectVisionDescriptorSource(source)) return undefined;
  const summary = safeRuntimeInputObjectDescriptorText(value.summary, 4_000);
  const descriptorRef = safeRuntimeInputObjectDescriptorRef(value.descriptorRef);
  const sha256 = safeRuntimeInputObjectDescriptorText(value.sha256, 120);
  const traceRef = safeRuntimeInputObjectDescriptorRef(value.traceRef);
  const createdAt = safeRuntimeInputObjectDescriptorText(value.createdAt, 80);
  return {
    schemaVersion: 'sciforge.runtime.input-object.vision-descriptor.v1',
    status,
    source,
    ...(summary ? { summary } : {}),
    ...(descriptorRef ? { descriptorRef } : {}),
    ...(sha256 ? { sha256 } : {}),
    ...(traceRef ? { traceRef } : {}),
    ...(createdAt ? { createdAt } : {}),
  };
}

function isRuntimeInputObjectVisionDescriptorStatus(value: string | undefined): value is RuntimeInputObjectVisionDescriptor['status'] {
  return value === 'pending' || value === 'ready' || value === 'failed';
}

function isRuntimeInputObjectVisionDescriptorSource(value: string | undefined): value is RuntimeInputObjectVisionDescriptor['source'] {
  return value === 'upload-preextract'
    || value === 'first-reference-preextract'
    || value === 'agent-host-cache'
    || value === 'model-router-trace'
    || value === 'manual';
}

function safeRuntimeInputObjectDescriptorText(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  const text = value.replace(/\s+/g, ' ').trim();
  if (!text || text.length > maxLength) return undefined;
  if (/[\u0000-\u001f<>]|(?:data:|javascript:|file:|blob:|authorization|bearer|api[_-]?key|password|secret|token|<html)/i.test(text)) return undefined;
  return text;
}

function safeRuntimeInputObjectDescriptorRef(value: unknown) {
  const ref = safeRuntimeInputObjectDescriptorText(value, 600);
  return ref && safeRuntimeInputObjectRef(ref) ? ref : undefined;
}

function runtimeInputObjectMimeType(ref: string, record: Record<string, unknown>, auxiliary: Record<string, unknown>) {
  const explicit = asString(auxiliary.mimeType)
    ?? asString(auxiliary.mime_type)
    ?? asString(record.mimeType)
    ?? asString(record.mime_type);
  if (explicit) return explicit;
  switch (ref.split(/[?#]/, 1)[0]?.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1]) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'tif':
    case 'tiff':
      return 'image/tiff';
    case 'bmp':
      return 'image/bmp';
    case 'heic':
      return 'image/heic';
    case 'mp3':
      return 'audio/mpeg';
    case 'wav':
      return 'audio/wav';
    case 'm4a':
      return 'audio/mp4';
    case 'flac':
      return 'audio/flac';
    case 'mp4':
      return 'video/mp4';
    case 'mov':
      return 'video/quicktime';
    case 'webm':
      return 'video/webm';
    case 'csv':
      return 'text/csv';
    case 'tsv':
      return 'text/tab-separated-values';
    case 'pdf':
      return 'application/pdf';
    default:
      return undefined;
  }
}

function runtimeInputObjectHasMaterializableShape(ref: string, mimeType: string | undefined) {
  if (/^(?:artifact|ref|run):/i.test(ref) && !/\.[A-Za-z0-9]+(?:$|[?#])/i.test(ref)) return false;
  return typeof mimeType === 'string' && /^image\//i.test(mimeType);
}

function uniqueRuntimeInputObjects(values: Array<RuntimeInputObject | undefined>) {
  const seen = new Set<string>();
  const out: RuntimeInputObject[] = [];
  for (const value of values) {
    if (!value) continue;
    if (seen.has(value.ref)) {
      const existingIndex = out.findIndex((item) => item.ref === value.ref);
      if (existingIndex >= 0 && !out[existingIndex]?.visionDescriptor && value.visionDescriptor) out[existingIndex] = value;
      continue;
    }
    seen.add(value.ref);
    out.push(value);
  }
  return out;
}

function safeRuntimeInputObjectRef(ref: string) {
  if (ref.length > 600) return false;
  if (/^(?:data|https?|blob|javascript|file):/i.test(ref)) return false;
  return /^[A-Za-z0-9._:@/-]+$/.test(ref)
    && !ref.startsWith('/')
    && !ref.startsWith('~')
    && !ref.includes('\\')
    && !ref.includes('//');
}

function selectedVisibleMessageContextForRuntimeCommand(input: SendAgentMessageInput): string | undefined {
  const selectedMessageRefs = selectedMessageRefsForRuntimeCommand(input.references ?? []);
  if (!selectedMessageRefs.size) return undefined;
  const selectedMessages = (input.messages ?? [])
    .filter((message) => selectedRuntimeMessageRefs(message).some((ref) => selectedMessageRefs.has(ref)))
    .filter((message) => isSelectedReferenceContentMessage(message))
    .filter((message) => !isSeedDemoOrFixtureMessage(message))
    .slice(-CODEX_RUNTIME_SELECTED_MESSAGE_CONTEXT_LIMIT)
    .map((message) => selectedRuntimeMessageContextEntry(message))
    .filter((entry): entry is string => Boolean(entry));
  if (!selectedMessages.length) return undefined;
  return [
    'Selected visible context (bounded terminal-equivalent text; use only when the current request refers to selected refs):',
    ...selectedMessages,
  ].join('\n');
}

function selectedMessageRefsForRuntimeCommand(references: NonNullable<SendAgentMessageInput['references']>) {
  return new Set(references.flatMap((reference) => {
    const refs = selectedReferenceAliases(reference);
    if (reference.kind === 'message') return refs.flatMap(messageRefAliasesForRuntimeCommand);
    return refs.filter((ref) => ref.startsWith('message:'));
  }));
}

function messageRefAliasesForRuntimeCommand(ref: string) {
  if (ref.startsWith('message:')) return [ref, ref.slice('message:'.length)];
  if (ref.startsWith('artifact:') || ref.startsWith('run:') || ref.includes(':')) return [];
  return [ref, `message:${ref}`];
}

function selectedRuntimeMessageRefs(message: NonNullable<SendAgentMessageInput['messages']>[number]) {
  return uniqueRuntimeStringList([message.id, `message:${message.id}`]);
}

function isSelectedReferenceContentMessage(message: NonNullable<SendAgentMessageInput['messages']>[number]) {
  return isRecord(message) && message.selectedReferenceContent === true;
}

function selectedRuntimeMessageContextEntry(message: NonNullable<SendAgentMessageInput['messages']>[number]) {
  const content = selectedRuntimeMessageContextText(message.content);
  if (!content) return undefined;
  const role = String(message.role || 'message').replace(/[^a-z0-9_-]/gi, '').slice(0, 24) || 'message';
  const ref = `message:${message.id}`;
  return `- ${ref} (${role}):\n${indentRuntimeContextText(content)}`;
}

function selectedRuntimeMessageContextText(content: unknown) {
  const text = asString(content);
  if (!text) return undefined;
  return redactSensitiveRuntimeContextText(text)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .slice(0, CODEX_RUNTIME_SELECTED_MESSAGE_TEXT_LIMIT)
    .trim();
}

function redactSensitiveRuntimeContextText(text: string) {
  return text
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, '[redacted-secret]')
    .replace(/\bAuthorization\s*:\s*Bearer\s+[^\s"'`]+/gi, 'Authorization: Bearer [redacted-secret]')
    .replace(/\b(api[_-]?key|token|password|secret)\s*[:=]\s*[^\s"'`]+/gi, '$1=[redacted-secret]')
    .replace(/\b(?:rawProviderBody|providerRawBody|raw_provider_body|rawProviderPayload|providerPayload)\b/gi, '[redacted-provider-payload-label]');
}

function indentRuntimeContextText(text: string) {
  return text.split(/\r?\n/).map((line) => `  ${line}`).join('\n');
}

function computerUseApprovalRuntimeMetadata(
  input: SendAgentMessageInput,
  commandText: string,
  referenceSummary: Array<Record<string, unknown>>,
) {
  const approvalRef = approvalRefFromComputerUseApproveText(input.prompt)
    ?? approvalRefFromComputerUseApproveText(commandText);
  if (!approvalRef) return undefined;
  const approvalProvenance = approvalProvenanceForComputerUseApproval(input, referenceSummary, approvalRef);
  return {
    humanApproval: {
      approvalRef,
      decision: 'approved',
      source: 'runtime-codex-commandText',
      ...(approvalProvenance ? { approvalProvenance } : {}),
    },
    uiState: {
      schemaVersion: 'sciforge.runtime-codex.computer-use-approval-context.v1',
      approvalRef,
      computerUseApprovalRef: approvalRef,
      terminalEquivalentText: true,
      ...(approvalProvenance ? { approvalProvenance } : {}),
    },
  };
}

function approvalRefFromComputerUseApproveText(text: string) {
  if (!/(?:^|\n)\s*\/(?:computer-use|computer\s+use)\s+approve\b/i.test(text)) return undefined;
  const match = /--approval-ref(?:=|\s+)(?:"([^"]+)"|'([^']+)'|([^\s]+))/i.exec(text);
  return (match?.[1] ?? match?.[2] ?? match?.[3])?.trim() || undefined;
}

function approvalProvenanceForComputerUseApproval(
  input: SendAgentMessageInput,
  referenceSummary: Array<Record<string, unknown>>,
  approvalRef: string,
) {
  const sidecars = approvalSidecarsForRef(input, approvalRef);
  const refs = approvalSourceRefs(referenceSummary, sidecars);
  if (!sidecars.approvalRequestSidecar && !sidecars.guiAskUserSidecar && !sidecars.riskAuditSidecar && !Object.keys(refs).length) return undefined;
  return compactRuntimeRecord({
    schemaVersion: 'sciforge.computer-use.approval-provenance.v1',
    source: 'runtime-codex-commandText-approval-context',
    sourceStatus: 'needs-confirmation',
    approvalRef,
    approvalRequestId: approvalIdentity(sidecars, 'approvalRequestId') ?? approvalRef,
    riskActionHash: approvalIdentity(sidecars, 'riskActionHash'),
    sourceApprovalRequestRef: refs.sourceApprovalRequestRef,
    sourceGuiAskUserRecordRef: refs.sourceGuiAskUserRecordRef,
    sourceRiskAuditRef: refs.sourceRiskAuditRef,
    approvalRequestSidecar: sidecars.approvalRequestSidecar,
    guiAskUserSidecar: sidecars.guiAskUserSidecar,
    riskAuditSidecar: sidecars.riskAuditSidecar,
    highRiskAction: recordField(sidecars.riskAuditSidecar, 'highRiskAction')
      ?? recordField(recordField(sidecars.riskAuditSidecar, 'approvalBoundary'), 'highRiskAction')
      ?? recordField(recordField(sidecars.approvalRequestSidecar, 'approvalBoundary'), 'highRiskAction'),
  });
}

function approvalSidecarsForRef(input: SendAgentMessageInput, approvalRef: string) {
  for (const run of [...(input.runs ?? [])].reverse()) {
    const raw = isRecord(run.raw) ? run.raw : {};
    const guiAskUser = isRecord(raw.guiAskUser) ? raw.guiAskUser : {};
    const approvalRequestSidecar = firstApprovalSidecarForRef(approvalRef, raw.approvalRequestSidecar, guiAskUser.approvalRequestSidecar);
    const guiAskUserSidecar = firstApprovalSidecarForRef(approvalRef, raw.guiAskUserSidecar, guiAskUser.guiAskUserSidecar);
    const riskAuditSidecar = firstApprovalSidecarForRef(approvalRef, raw.riskAuditSidecar, guiAskUser.riskAuditSidecar);
    if (approvalRequestSidecar || guiAskUserSidecar || riskAuditSidecar) {
      return { approvalRequestSidecar, guiAskUserSidecar, riskAuditSidecar };
    }
  }
  return {};
}

function firstApprovalSidecarForRef(approvalRef: string, ...values: unknown[]) {
  return values.find((value): value is Record<string, unknown> => (
    isRecord(value) && approvalRefFromSidecar(value) === approvalRef
  ));
}

function approvalSourceRefs(
  referenceSummary: Array<Record<string, unknown>>,
  sidecars: {
    approvalRequestSidecar?: Record<string, unknown>;
    guiAskUserSidecar?: Record<string, unknown>;
    riskAuditSidecar?: Record<string, unknown>;
  },
) {
  const refs = uniqueRuntimeStringList(referenceSummary.flatMap((reference) => [
    asString(reference.ref),
    asString(reference.path),
    asString(reference.dataRef),
    asString(reference.id),
  ]));
  return {
    sourceApprovalRequestRef: asString(sidecars.approvalRequestSidecar?.approvalRequestRef) ?? refs.find((ref) => /(?:^|\/)approval-request\.json$/i.test(ref)),
    sourceGuiAskUserRecordRef: asString(sidecars.guiAskUserSidecar?.guiAskUserRecordRef) ?? refs.find((ref) => /(?:^|\/)gui-ask-user\.json$/i.test(ref)),
    sourceRiskAuditRef: asString(sidecars.riskAuditSidecar?.riskAuditRef) ?? refs.find((ref) => /(?:^|\/)risk-audit\.json$/i.test(ref)),
  };
}

function approvalIdentity(
  sidecars: {
    approvalRequestSidecar?: Record<string, unknown>;
    guiAskUserSidecar?: Record<string, unknown>;
    riskAuditSidecar?: Record<string, unknown>;
  },
  key: 'approvalRequestId' | 'riskActionHash',
) {
  return asString(sidecars.approvalRequestSidecar?.[key])
    ?? asString(sidecars.guiAskUserSidecar?.[key])
    ?? asString(sidecars.riskAuditSidecar?.[key]);
}

function approvalRefFromSidecar(sidecar: Record<string, unknown>) {
  const approvalRequest = recordField(sidecar, 'approvalRequest')
    ?? recordField(recordField(sidecar, 'payload'), 'approvalRequest');
  const metadata = recordField(approvalRequest, 'metadata');
  return asString(sidecar.approvalRef)
    ?? asString(sidecar.canonicalApprovalRef)
    ?? asString(approvalRequest?.approvalRef)
    ?? asString(approvalRequest?.approval_ref)
    ?? asString(metadata?.approvalRef)
    ?? asString(metadata?.approval_ref);
}

function recordField(value: unknown, key: string) {
  return isRecord(value) ? (isRecord(value[key]) ? value[key] : undefined) : undefined;
}

function compactRuntimeRecord<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as T;
}

function sameChatContinuityContextForRuntimeCommand(input: SendAgentMessageInput): string | undefined {
  if (!sameChatContinuityPrompt(input.prompt)) return undefined;
  const entries = (input.messages ?? [])
    .filter((message) => !isSeedDemoOrFixtureMessage(message))
    .map((message) => {
      const record = (isRecord(message) ? message : {}) as Record<string, unknown>;
      const content = asString(record.continuityContent);
      if (!content) return undefined;
      const role = asString(record.role) ?? 'message';
      return `- ${role}: ${content}`;
    })
    .filter((entry): entry is string => Boolean(entry))
    .slice(-4);
  if (!entries.length) return undefined;
  return [
    'Same-chat continuity context for relative references. Use this bounded non-seed context only to resolve phrases such as "previous turn", "last answer", "what I asked first", "一开始问的问题", or "that passphrase"; do not treat it as artifact content or hidden GUI state.',
    ...entries,
  ].join('\n');
}

function latestCodexSessionIdForConversationLane(input: SendAgentMessageInput): string | undefined {
  const laneId = runtimeConversationLaneId(input);
  for (const run of [...(input.runs ?? [])].reverse()) {
    if (!runMatchesConversationLane(run, laneId, input.sessionId)) continue;
    const sessionId = codexSessionIdFromRun(run);
    if (sessionId) return sessionId;
  }
  return undefined;
}

function runtimeConversationLaneId(input: SendAgentMessageInput): string {
  const explicit = input.conversationLaneId?.trim();
  if (explicit) return explicit;
  if (input.sessionId?.trim()) return defaultSessionConversationLaneId(input.sessionId);
  return `scenario:${input.scenarioId}`;
}

function defaultSessionConversationLaneId(sessionId: string) {
  return `session:${sessionId}`;
}

function runMatchesConversationLane(
  run: NonNullable<SendAgentMessageInput['runs']>[number],
  laneId: string,
  sessionId?: string,
) {
  const raw = isRecord(run.raw) ? run.raw : {};
  const runLaneId = asString(raw.conversationLaneId)
    ?? asString(raw.runtimeConversationLaneId)
    ?? asString(raw.conversationLane);
  if (runLaneId) return runLaneId === laneId;
  if (laneId.startsWith('session:')) return true;
  const legacyWorkbenchLane = sessionId?.trim()
    ? `workbench:${run.scenarioId}:${sessionId.trim()}`
    : undefined;
  if (legacyWorkbenchLane && laneId === legacyWorkbenchLane) return true;
  return false;
}

function selectedCodexSessionId(input: SendAgentMessageInput): string | undefined {
  if (!input.references?.length) return undefined;
  const selectedRefs = selectedReferenceScope(input.references);
  if (!selectedRefs.size) return undefined;
  const runById = new Map((input.runs ?? []).map((run) => [run.id, run]));
  for (const runId of selectedRunIdsFromReferences(input.references)) {
    const sessionId = codexSessionIdFromRun(runById.get(runId));
    if (sessionId) return sessionId;
  }
  for (const artifact of input.artifacts ?? []) {
    if (!artifactReferenceAliases(artifact).some((ref) => selectedRefs.has(ref))) continue;
    const runId = artifactRunId(artifact);
    const sessionId = runId ? codexSessionIdFromRun(runById.get(runId)) : undefined;
    if (sessionId) return sessionId;
  }
  for (const run of [...(input.runs ?? [])].reverse()) {
    if (!runObjectReferenceAliases(run).some((ref) => selectedRefs.has(ref))) continue;
    const sessionId = codexSessionIdFromRun(run);
    if (sessionId) return sessionId;
  }
  for (const run of [...(input.runs ?? [])].reverse()) {
    if (!runReferenceAliases(run).some((ref) => selectedRefs.has(ref))) continue;
    const sessionId = codexSessionIdFromRun(run);
    if (sessionId) return sessionId;
  }
  return undefined;
}

function codexSessionIdFromRun(run: NonNullable<SendAgentMessageInput['runs']>[number] | undefined): string | undefined {
  if (!run) return undefined;
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const direct = runtimeThreadIdFromRecord(raw);
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
  return objectRefSessionId || undefined;
}

function selectedReferenceScope(references: NonNullable<SendAgentMessageInput['references']>) {
  return new Set(references.flatMap(selectedReferenceAliases));
}

function selectedReferenceAliases(reference: NonNullable<SendAgentMessageInput['references']>[number]): string[] {
  const payload = isRecord(reference.payload) ? reference.payload : {};
  const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
  const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
  const provenance = isRecord(currentReference.provenance) ? currentReference.provenance : {};
  const objectProvenance = isRecord(objectReference.provenance) ? objectReference.provenance : {};
  const aliases = [
    reference.ref,
    reference.sourceId,
    reference.runId ? `run:${reference.runId}` : undefined,
    asString(payload.ref),
    asString(payload.path),
    asString(payload.dataRef),
    asString(payload.sourceRef),
    asString(currentReference.ref),
    asString(currentReference.id),
    asString(currentReference.runId) ? `run:${asString(currentReference.runId)}` : undefined,
    asString(currentReference.artifactType),
    asString(provenance.path),
    asString(provenance.dataRef),
    asString(objectReference.ref),
    asString(objectReference.id),
    asString(objectReference.runId) ? `run:${asString(objectReference.runId)}` : undefined,
    asString(objectReference.artifactType),
    asString(objectProvenance.path),
    asString(objectProvenance.dataRef),
  ];
  if (reference.sourceId) aliases.push(`artifact:${reference.sourceId}`);
  if (reference.kind === 'message' && reference.sourceId) aliases.push(`message:${reference.sourceId}`);
  const currentId = asString(currentReference.id);
  if (currentId) aliases.push(`artifact:${currentId}`);
  if (reference.kind === 'message' && currentId) aliases.push(`message:${currentId}`);
  const objectId = asString(objectReference.id);
  if (objectId) aliases.push(`artifact:${objectId}`);
  return uniqueRuntimeStringList(aliases);
}

function selectedRunIdsFromReferences(references: NonNullable<SendAgentMessageInput['references']>) {
  return uniqueRuntimeStringList(references.flatMap((reference) => {
    const payload = isRecord(reference.payload) ? reference.payload : {};
    const currentReference = isRecord(payload.currentReference) ? payload.currentReference : {};
    const objectReference = isRecord(payload.objectReference) ? payload.objectReference : {};
    return [
      reference.runId,
      asString(payload.runId),
      asString(currentReference.runId),
      asString(objectReference.runId),
    ];
  }));
}

function artifactReferenceAliases(artifact: NonNullable<SendAgentMessageInput['artifacts']>[number]) {
  return uniqueRuntimeStringList([
    artifact.id,
    `artifact:${artifact.id}`,
    artifact.dataRef,
    artifact.path,
    artifact.delivery?.ref,
    artifact.delivery?.readableRef,
    artifact.delivery?.rawRef,
    stringRecordField(artifact.metadata ?? {}, 'markdownRef'),
    stringRecordField(artifact.metadata ?? {}, 'outputRef'),
    stringRecordField(artifact.metadata ?? {}, 'artifactRef'),
  ]);
}

function artifactRunId(artifact: NonNullable<SendAgentMessageInput['artifacts']>[number]) {
  const metadata = artifact.metadata ?? {};
  return stringRecordField(metadata, 'runId')
    ?? stringRecordField(metadata, 'sourceRunId')
    ?? stringRecordField(metadata, 'producerRunId');
}

function runReferenceAliases(run: NonNullable<SendAgentMessageInput['runs']>[number]) {
  return uniqueRuntimeStringList([
    run.id,
    `run:${run.id}`,
    ...(run.references ?? []).flatMap((reference) => [
      reference.ref,
      reference.sourceId,
      reference.runId ? `run:${reference.runId}` : undefined,
    ]),
    ...(run.objectReferences ?? []).flatMap((reference) => [
      reference.ref,
      reference.id,
      reference.runId ? `run:${reference.runId}` : undefined,
      reference.provenance?.path,
      reference.provenance?.dataRef,
    ]),
    ...collectRuntimeRefsFromValue(run.raw, { maxDepth: 4, maxRefs: 48, includeIds: true }),
  ]);
}

function runObjectReferenceAliases(run: NonNullable<SendAgentMessageInput['runs']>[number]) {
  return uniqueRuntimeStringList((run.objectReferences ?? []).flatMap((reference) => [
    reference.ref,
    reference.id,
    reference.runId ? `run:${reference.runId}` : undefined,
    reference.provenance?.path,
    reference.provenance?.dataRef,
  ]));
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
  const direct = runtimeThreadIdFromRecord(value);
  if (direct) return direct;
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

function codexSessionIdFromRuntimeEvents(events: AgentStreamEvent[]): string | undefined {
  for (const event of [...events].reverse()) {
    const eventRecord = isRecord(event) ? event as Record<string, unknown> : {};
    const eventId = runtimeThreadIdFromRecord(eventRecord);
    if (eventId) return eventId;
    const raw = isRecord(event.raw) ? event.raw : {};
    const nestedRaw = isRecord(raw.raw) ? raw.raw : {};
    const payload = isRecord(raw.payload) ? raw.payload : {};
    const nestedPayload = isRecord(nestedRaw.payload) ? nestedRaw.payload : {};
    const id = asString(eventRecord.codexSessionId)
      ?? asString(raw.codexSessionId)
      ?? asString(raw.nativeSessionId)
      ?? asString(raw.thread_id)
      ?? asString(nestedRaw.codexSessionId)
      ?? asString(nestedRaw.nativeSessionId)
      ?? asString(nestedRaw.thread_id)
      ?? asString(payload.codexSessionId)
      ?? asString(payload.nativeSessionId)
      ?? asString(payload.thread_id)
      ?? asString(nestedPayload.codexSessionId)
      ?? asString(nestedPayload.nativeSessionId)
      ?? asString(nestedPayload.thread_id);
    if (id) return id;
  }
  return undefined;
}

function runtimeThreadIdFromRecord(record: Record<string, unknown> | undefined, depth = 0): string | undefined {
  if (!record) return undefined;
  const direct = asString(record.codexSessionId)
    ?? asString(record.nativeSessionId)
    ?? asString(record.threadId)
    ?? asString(record.thread_id);
  if (direct) return direct.trim();
  const thread = isRecord(record.thread) ? record.thread : undefined;
  const threadId = asString(thread?.id)
    ?? asString(thread?.threadId)
    ?? asString(thread?.thread_id);
  if (threadId) return threadId.trim();
  if (depth >= 3) return undefined;
  for (const key of ['output', 'result', 'runtimeFailure', 'recoverState', 'payload', 'params', 'event', 'raw', 'data', 'session']) {
    const nested = isRecord(record[key]) ? record[key] as Record<string, unknown> : undefined;
    const id = runtimeThreadIdFromRecord(nested, depth + 1);
    if (id) return id;
  }
  return undefined;
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
  const detail = [
    'Runtime Codex run started',
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
      runtimeLane: 'codex',
      status: 'started',
      commandId: request.commandId,
      attemptId: request.attemptId,
      codexSessionRestored: Boolean(request.codexSessionId),
      allowOpenAiRuntime: false,
      boundary: asString(auditMetadata.boundary),
    },
  };
}

function composerDeclaredIntentProjectionEvent(request: ReturnType<typeof buildCodexRuntimeStreamRequest>): AgentStreamEvent | undefined {
  const auditMetadata: Record<string, unknown> = isRecord(request.auditMetadata) ? request.auditMetadata : {};
  const projection = isRecord(auditMetadata.guiLocalProjection) ? auditMetadata.guiLocalProjection : {};
  const declaredIntents = safeComposerDeclaredIntents(projection.composerDeclaredIntents);
  const model = declaredIntents?.model;
  const mode = declaredIntents?.mode;
  if (!model && !mode) return undefined;
  const text = model
    ? `Shared ${model.publicLabel} preference with Agent Host.`
    : `Shared ${mode?.publicLabel} mode preference with Agent Host.`;
  return {
    id: makeId('evt'),
    type: 'composer-declared-intent-projection',
    label: 'Composer preference',
    detail: text,
    createdAt: nowIso(),
    raw: {
      native: {
        rawType: 'composer_declared_intent_projection',
        operationKind: 'message',
        status: 'completed',
        text,
        ...(model ? {
          modelIntentId: model.modelIntentId,
          mode: model.mode,
          capabilityTier: model.capabilityTier,
          sourceActionId: model.actionId,
          declaredAt: model.declaredAt,
        } : {}),
        ...(mode ? {
          modeIntentId: mode.modeIntentId,
          ...(mode.summaryGuidance ? { summaryGuidance: mode.summaryGuidance } : {}),
          sourceActionId: mode.actionId,
          declaredAt: mode.declaredAt,
        } : {}),
      },
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
  return runtimeCodexFailureResponseFromMetadata({
    input: input.input,
    request: input.request,
    runtimeEvents: input.runtimeEvents,
    metadata,
  });
}

function runtimeCodexPreflightBlockedResponse(input: {
  input: SendAgentMessageInput;
  request: ReturnType<typeof buildCodexRuntimeStreamRequest>;
  manifest: RuntimeProviderPreflightManifest;
}): NormalizedAgentResponse {
  return runtimeCodexFailureResponseFromMetadata({
    input: input.input,
    request: input.request,
    runtimeEvents: [],
    metadata: runtimeProviderPreflightFailureMetadata(input.request, input.manifest),
  });
}

function runtimeCodexFailureResponseFromMetadata(input: {
  input: SendAgentMessageInput;
  request: ReturnType<typeof buildCodexRuntimeStreamRequest>;
  runtimeEvents: AgentStreamEvent[];
  metadata: ReturnType<typeof runtimeFailureMetadata> | ReturnType<typeof runtimeProviderPreflightFailureMetadata>;
}): NormalizedAgentResponse {
  const metadata = input.metadata;
  const publicFailureReason = metadata.publicFailureReason ?? `Runtime Codex exited with code ${metadata.exitCode ?? 'unknown'}.`;
  const message = `${publicFailureReason}\n\nRuntime Codex 运行未完成；失败 run、审计 refs 和恢复状态已保留。`;
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
          diagnostic: publicFailureReason,
        },
        activeRun: {
          id: input.request.commandId,
          status: 'repair-needed',
        },
        artifacts: [],
        executionProcess: [{
          eventId: `${input.request.commandId}:runtime-codex-failed`,
          type: 'RunFailed',
          summary: publicFailureReason,
          timestamp: nowIso(),
        }],
        recoverActions: [
          'Retry or continue from the preserved audit refs for this failed Runtime Codex run.',
          'Inspect folded audit/debug refs before rerunning if the same runtime configuration may fail again.',
        ],
        verificationState: {
          status: 'failed',
          verdict: 'fail',
        },
        auditRefs: metadata.evidenceRefs,
        diagnostics: [{
          severity: 'error',
          code: 'runtime-codex-nonzero-exit',
          message: publicFailureReason,
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
      failureReason: publicFailureReason,
      recoverActions: [
        'Retry or continue from preserved Runtime Codex audit refs.',
      ],
      evidenceRefs: metadata.evidenceRefs,
    }],
    objectReferences: metadata.evidenceRefs.map((ref) => ({
      id: `audit-${stableRefId(ref)}`,
      kind: 'run',
      ref,
      title: ref.includes('stderr') ? 'Runtime Codex stderr audit' : ref.includes('raw-events') ? 'Runtime Codex runtime-event audit' : 'Runtime Codex audit',
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
        conversationLaneId: runtimeConversationLaneId(input.input),
        runtimeResumePolicy: runtimeResumePolicy(input.input),
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
      provenance: {
        ...(response.message.provenance ?? {}),
        kind: 'live-runtime-codex',
        source: `codex.runtime-failure:${input.request.commandId}`,
        runtimeRequestEligible: false,
        liveAcceptanceEligible: false,
      },
    },
  };
}

function isRuntimeCodexFailedEvent(event: AgentStreamEvent) {
  return String(event.type || '').toLowerCase().includes('failed')
    || String(isRecord(event.raw) ? event.raw.type : '').toLowerCase() === 'failed'
    || String(isRecord(event.raw) ? stringRecordField(event.raw, 'status') : '').toLowerCase() === 'failed';
}

function runtimeCodexErrorIsMissingNativeRollout(error: string | undefined) {
  return typeof error === 'string' && /\bno rollout found for thread id\b/i.test(error);
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
  const exitCode = asFiniteNumber(raw.exitCode) ?? asFiniteNumber(rawNested.exitCode);
  const rawWorkspace = asString(raw.workspace) ?? asString(rawNested.workspace) ?? request.workspacePath;
  const workspace = publicRuntimeWorkspaceRef(rawWorkspace);
  const profile = publicRuntimeProfile(asString(raw.profile) ?? asString(rawNested.profile) ?? request.profile);
  const provider = publicRuntimeProvider(asString(raw.provider) ?? asString(rawNested.provider) ?? asString(runtime.provider));
  const model = publicRuntimeModel(asString(raw.model) ?? asString(rawNested.model) ?? asString(runtime.model));
  const rawStderrSummary = asString(rawNested.stderrSummary) ?? summarizeRuntimeStderr(events);
  const stderrSummary = scrubRuntimeCodexFailureText(rawStderrSummary, {
    workspace: rawWorkspace,
  });
  const boundary = asString(raw.boundary) ?? asString(rawNested.boundary);
  const boundaryReason = boundary === 'final-answer-required'
    ? 'Runtime Codex completed without a safe final assistant answer; SciForge withheld raw runtime diagnostics from the primary result.'
    : undefined;
  const failureSignal = boundaryReason
    ?? actionableRuntimeStderrSummary([
      rawStderrSummary,
      summarizeRuntimeFailureMessages(events),
    ].filter(Boolean).join(' '))
    ?? rawStderrSummary;
  const classification = classifyRuntimeFailure(failureSignal, exitCode);
  const codexSessionId = asString(raw.codexSessionId) ?? asString(rawNested.codexSessionId) ?? request.codexSessionId;
  return {
    schemaVersion: 'sciforge.runtime-codex-failed-run.v1',
    failureKind: classification.failureKind,
    ownerLayer: classification.ownerLayer,
    retryable: classification.retryable,
    nativeResumeSupported: Boolean(codexSessionId),
    commandId: asString(raw.commandId) ?? request.commandId,
    attemptId: asString(raw.attemptId) ?? request.attemptId,
    workspace,
    profile,
    provider,
    model,
    codexSessionId,
    exitCode,
    stderrSummary,
    publicFailureReason: classification.publicFailureReason,
    evidenceRefs,
    recoverState: {
      status: 'repair-needed',
      failureKind: classification.failureKind,
      ownerLayer: classification.ownerLayer,
      retryable: classification.retryable,
      nativeResumeSupported: Boolean(codexSessionId),
      resumeStrategy: codexSessionId ? 'native-session-resume' : 'audit-only-retry',
      commandId: asString(raw.commandId) ?? request.commandId,
      attemptId: asString(raw.attemptId) ?? request.attemptId,
      workspace,
      profile,
      provider,
      model,
      codexSessionId,
      stderrSummary,
      publicFailureReason: classification.publicFailureReason,
      evidenceRefs,
      recoverActions: [
        codexSessionId
          ? 'Resume this native Runtime Codex session from preserved audit refs.'
          : 'Retry this Runtime Codex turn from preserved audit refs; native resume is unavailable for this run.',
        'Keep the same runtime configuration unless the audit refs show a configuration failure.',
      ],
    },
  };
}

function runtimeProviderPreflightFailureMetadata(
  request: ReturnType<typeof buildCodexRuntimeStreamRequest>,
  manifest: RuntimeProviderPreflightManifest,
) {
  const auditMetadata: Record<string, unknown> = isRecord(request.auditMetadata) ? request.auditMetadata : {};
  const runtime: Record<string, unknown> = isRecord(auditMetadata.runtime) ? auditMetadata.runtime : {};
  const httpStatus = runtimeProviderPreflightHttpStatus(manifest);
  const retryable = runtimeProviderPreflightRetryable(manifest);
  const publicFailureReason = runtimeProviderPreflightPublicFailureReason(manifest);
  const evidenceRefs = [RUNTIME_PROVIDER_PREFLIGHT_EVIDENCE_REF];
  const workspace = publicRuntimeWorkspaceRef(request.workspacePath);
  const profile = publicRuntimeProfile(request.profile);
  const provider = publicRuntimeProvider(asString(runtime.provider));
  const model = publicRuntimeModel(asString(runtime.model));
  const recoverAction = runtimeProviderPreflightRecoverAction(manifest);
  return {
    schemaVersion: 'sciforge.runtime-codex-failed-run.v1',
    failureKind: 'runtime-provider-preflight-blocked',
    ownerLayer: runtimeProviderPreflightOwnerLayer(manifest),
    retryable,
    nativeResumeSupported: false,
    commandId: request.commandId,
    attemptId: request.attemptId,
    workspace,
    profile,
    provider,
    model,
    codexSessionId: undefined,
    exitCode: undefined,
    stderrSummary: publicFailureReason,
    publicFailureReason,
    runtimeProviderPreflightCategory: manifest.category,
    preflightHttpStatus: httpStatus,
    evidenceRefs,
    recoverState: {
      status: 'repair-needed',
      failureKind: 'runtime-provider-preflight-blocked',
      ownerLayer: runtimeProviderPreflightOwnerLayer(manifest),
      retryable,
      nativeResumeSupported: false,
      resumeStrategy: 'preflight-retry',
      commandId: request.commandId,
      attemptId: request.attemptId,
      workspace,
      profile,
      provider,
      model,
      stderrSummary: publicFailureReason,
      publicFailureReason,
      runtimeProviderPreflightCategory: manifest.category,
      preflightHttpStatus: httpStatus,
      evidenceRefs,
      recoverActions: [
        recoverAction,
        'Retry the same user request after the runtime provider preflight reports ready.',
      ],
    },
  };
}

function runtimeProviderPreflightPublicFailureReason(manifest: RuntimeProviderPreflightManifest) {
  const httpStatus = runtimeProviderPreflightHttpStatus(manifest);
  const statusText = httpStatus ? ` (HTTP ${httpStatus})` : '';
  const recoverAction = runtimeProviderPreflightRecoverAction(manifest);
  return `Runtime provider preflight blocked before starting Codex Runtime: ${manifest.category}${statusText}. ${recoverAction}`;
}

function runtimeProviderPreflightRecoverAction(manifest: RuntimeProviderPreflightManifest) {
  const label = manifest.nextActions
    .map((action) => scrubRuntimeCodexFailureText(asString(action.label)))
    .find((action): action is string => Boolean(action));
  return label ?? 'Fix the runtime provider or local runtime configuration, then rerun the preflight.';
}

function runtimeProviderPreflightHttpStatus(manifest: RuntimeProviderPreflightManifest): number | undefined {
  const inference = runtimeProviderPreflightDiagnosticRecord(manifest, 'checkedInference');
  const healthz = runtimeProviderPreflightDiagnosticRecord(manifest, 'checkedHealthz');
  return asFiniteNumber(inference?.httpStatus) ?? asFiniteNumber(healthz?.httpStatus);
}

function runtimeProviderPreflightRetryable(manifest: RuntimeProviderPreflightManifest) {
  const inference = runtimeProviderPreflightDiagnosticRecord(manifest, 'checkedInference');
  const healthz = runtimeProviderPreflightDiagnosticRecord(manifest, 'checkedHealthz');
  const retryable = typeof inference?.retryable === 'boolean'
    ? inference.retryable
    : typeof healthz?.retryable === 'boolean'
      ? healthz.retryable
      : undefined;
  if (retryable !== undefined) return retryable;
  return manifest.category === 'rate-limited' || manifest.category === 'upstream-outage' || manifest.category === 'unknown';
}

function runtimeProviderPreflightDiagnosticRecord(
  manifest: RuntimeProviderPreflightManifest,
  key: 'checkedInference' | 'checkedHealthz',
) {
  const record = (manifest as unknown as Record<string, unknown>)[key];
  return isRecord(record) ? record : undefined;
}

function runtimeProviderPreflightOwnerLayer(manifest: RuntimeProviderPreflightManifest) {
  if (manifest.owner === 'provider') return 'provider-preflight';
  if (manifest.owner === 'environment') return 'runtime-config';
  return 'repo-runtime-preflight';
}

function scrubRuntimeCodexFailureText(
  text: string | undefined,
  options: { workspace?: string | undefined } = {},
): string | undefined {
  if (!text) return undefined;
  return text
    .replace(/(?:<!doctype\s+html[^>]*>\s*)?<html\b[\s\S]*?(?:<\/html>|$)/gi, (html) => publicRedactedDigest('html', html))
    .replace(
      /\b(api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password)\b\s*[:=]\s*["']?([^"'\s,;)}\]]{8,})/gi,
      (_match, label: string, secret: string) => `${label}=${publicRedactedDigest('secret', secret)}`,
    )
    .replace(/\bBearer\s+([A-Za-z0-9._~+/=-]{8,})/gi, (_match, secret: string) => `Bearer ${publicRedactedDigest('secret', secret)}`)
    .replace(/\b(?:sk|rk|pk)-[A-Za-z0-9_-]{8,}\b/g, (secret) => publicRedactedDigest('secret', secret))
    .replace(/https?:\/\/[^\s"'<>\\)]+/gi, (url) => publicRedactedDigest('url', url))
    .replace(runtimeWorkspacePathPattern(options.workspace), () => publicRuntimeWorkspaceRef(options.workspace))
    .replace(runtimeLocalPathPattern(), (path) => publicRedactedDigest('local-path', path));
}

function publicRuntimeWorkspaceRef(value: string | undefined): string {
  return value?.trim()
    ? `[workspace:hash:${stableRuntimePublicHash(value)}]`
    : '[workspace:unknown]';
}

function publicRuntimeProvider(value: string | undefined): string {
  const provider = value?.trim();
  if (!provider || provider === 'native' || provider === DEFAULT_RUNTIME_PROVIDER) return DEFAULT_RUNTIME_PROVIDER;
  return DEFAULT_RUNTIME_PROVIDER;
}

function publicRuntimeModel(value: string | undefined): string {
  const model = value?.trim();
  if (!model || model === UNCONFIGURED_RUNTIME_MODEL) return UNCONFIGURED_RUNTIME_MODEL;
  return model === DEFAULT_RUNTIME_MODEL_ALIAS ? DEFAULT_RUNTIME_MODEL_ALIAS : DEFAULT_RUNTIME_MODEL_ALIAS;
}

function publicRuntimeProfile(value: string | undefined): string {
  const profile = value?.trim();
  if (!profile || isPrivateRuntimeMetadataText(profile) || !/^[A-Za-z0-9._:-]{1,80}$/.test(profile)) return DEFAULT_RUNTIME_PROFILE;
  return profile;
}

function isPrivateRuntimeMetadataText(value: string): boolean {
  return /(?:secret|token|api.?key|authorization|password|provider|modelName|modelProvider|modelBaseUrl|baseUrl|endpoint|https?:\/\/|\/Users\/|\/Applications\/|\/tmp\/|\/var\/|\/private\/|sk-)/i.test(value);
}

function publicRedactedDigest(kind: 'html' | 'secret' | 'url' | 'local-path', value: string): string {
  return `[redacted-${kind}:hash:${stableRuntimePublicHash(value)}]`;
}

function runtimeWorkspacePathPattern(workspace: string | undefined): RegExp {
  const clean = workspace?.trim();
  if (!clean) return /a^/g;
  const suffix = String.raw`(?:[/\\][^\s"'<>),;\]}]+)*`;
  return new RegExp(`${escapeRuntimeRegExp(clean)}${suffix}`, 'g');
}

function runtimeLocalPathPattern(): RegExp {
  return /(?:\/(?:Users|Applications|tmp|var|private|Volumes|home|opt|workspace)(?:\/[^\s"'<>),;\]}]+)+|[A-Za-z]:\\[^\s"'<>),;\]}]+)/g;
}

function stableRuntimePublicHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

function escapeRuntimeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
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
  const actionable = actionableRuntimeStderrSummary(compact);
  if (actionable) return actionable;
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

function summarizeRuntimeFailureMessages(events: AgentStreamEvent[]) {
  const compact = events.flatMap((event) => {
    const raw = isRecord(event.raw) ? event.raw : {};
    const nested = isRecord(raw.raw) ? raw.raw : {};
    const error = isRecord(raw.error) ? raw.error : isRecord(nested.error) ? nested.error : {};
    return [
      event.detail,
      (event as { message?: unknown }).message,
      asString(raw.message),
      asString(raw.summary),
      asString(raw.detail),
      asString(raw.reason),
      asString(raw.error),
      asString(nested.message),
      asString(nested.summary),
      asString(nested.detail),
      asString(nested.reason),
      asString(nested.error),
      asString(error.message),
      asString(error.summary),
      asString(error.detail),
    ];
  }).filter((value): value is string => Boolean(value)).join(' ').replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  return actionableRuntimeStderrSummary(compact) ?? (compact.length > 240 ? `${compact.slice(0, 237)}...` : compact);
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

export function isBackendProgressEvent(event: AgentStreamEvent) {
  const type = String(event.type || '').toLowerCase();
  const label = String(event.label || '').toLowerCase();
  const raw = isRecord(event.raw) ? event.raw : {};
  const rawType = String(raw.type || '').toLowerCase();
  const progress = isRecord(raw.progress) ? raw.progress : undefined;
  const progressReason = String(progress?.reason || raw.reason || '').toLowerCase();
  const progressPhase = String(progress?.phase || '').toLowerCase();
  if (type.includes('silent') || rawType.includes('silent')) return false;
  if (type.includes('timeout-extended') || rawType.includes('timeout-extended')) return false;
  if (type === 'backend-silent' || rawType === 'backend-silent') return false;
  if (raw.silentStreamWaiting === true) return false;
  if (raw.heartbeat) return false;
  if (progressReason === 'backend-waiting') return false;
  if (progressReason === 'runtime-codex-waiting-for-app-server-event') return false;
  if (progressPhase === 'wait' && /waiting|等待|app-server/.test(`${progressReason} ${progress?.title ?? ''} ${progress?.detail ?? ''}`.toLowerCase())) return false;
  if (String(event.detail || '').toLowerCase().includes('reason: backend-waiting')) return false;
  if (label === 'wait' || label === 'waiting' || label === '等待') return false;
  return true;
}

function isForegroundReadableResultEvent(event: AgentStreamEvent) {
  const raw = isRecord(event.raw) ? event.raw : {};
  const type = String(event.type || raw.type || raw.kind || '').trim().toLowerCase();
  const rawType = String(raw.type || raw.kind || '').trim().toLowerCase();
  const status = String(raw['status'] || '').trim().toLowerCase();
  const readableRef = asString(raw.readableRef) || asString(raw.foregroundPartialRef);
  const refs = asStringArray(raw.refs) ?? asStringArray(raw.evidenceRefs) ?? asStringArray(raw.artifactRefs);
  const qualitySignals = isRecord(raw.qualitySignals) ? raw.qualitySignals : undefined;
  if (type === 'first-readable-result') return true;
  if (
    (type === TEXT_DELTA_EVENT_TYPE || type === 'message' || type === 'message_delta' || rawType === 'message_delta')
    && asString(raw.text)
    && String(raw.schemaVersion || '').startsWith('sciforge.codex.')
  ) return true;
  if (qualitySignals?.userVisible === true && (qualitySignals.partialResult === true || readableRef || refs?.length)) return true;
  if (readableRef && /partial|readable|foreground|background-running/.test(type || status)) return true;
  return false;
}

function buildTransportContextReusePolicy(input: SendAgentMessageInput) {
  const nonSeedMessageCount = (input.messages ?? []).filter((message) => !isSeedDemoOrFixtureMessage(message)).length;
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
