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
import { createCodexRealtimeSessionEnvelope } from '@sciforge-ui/runtime-contract/codex-realtime-session';
import {
  buildSilentStreamDecisionRecord,
  buildSilentStreamRunId,
  isSeedDemoOrFixtureMessage,
  projectToolDoneEvent,
  projectToolStartedEvent,
  type SilentStreamDecisionRecord,
} from '@sciforge-ui/runtime-contract';
import { compactSciForgeReference, compactTransportExecutionUnits } from './transportContext';
import {
  contextWindowTelemetryEvent,
  normalizeWorkspaceRuntimeEvent,
  toolEvent,
  withConfiguredContextWindowLimit,
  workspaceResultCompletion,
} from './runtimeEvents';
import { assertCodexRealtimeSessionRequestBoundary, createCodexRealtimeSessionClient, CODEX_RUNTIME_STREAM_PATH, type CodexRealtimeControlSender } from './codexRealtimeSession';

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
  } = {},
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
    assertCodexRealtimeSessionRequestBoundary(requestBody);
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
        const client = createCodexRealtimeSessionClient({
          workspaceWriterBaseUrl: input.config.workspaceWriterBaseUrl,
          onControlReady: callbacks.onRealtimeControlReady,
        });
        const stream = await client.stream(requestBodyText, (event) => {
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
        }, activeRequestController.signal);
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
  const presented = attachRuntimeGuiPresentationToResponse(normalized, result);
  const codexSessionId = codexSessionIdFromRuntimeResult(result) ?? codexSessionIdFromRuntimeEvents(runtimeEvents);
  if (!codexSessionId) return presented;
  const codexThreadRef = codexThreadObjectReference(codexSessionId, commandId);
  return {
    ...presented,
    run: {
      ...presented.run,
      raw: {
        ...(isRecord(presented.run.raw) ? presented.run.raw : {}),
        codexSessionId,
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

function attachRuntimeGuiPresentationToResponse(
  response: NormalizedAgentResponse,
  result: unknown,
): NormalizedAgentResponse {
  const presentation = isRecord(result) && isRecord(result.guiPresentation)
    ? result.guiPresentation
    : isRecord(result) && isRecord(result.output) && isRecord(result.output.guiPresentation)
      ? result.output.guiPresentation
      : undefined;
  const source = asString(presentation?.source);
  if (source?.startsWith('gui.present:')) {
    const presentedObjectReference = objectReferenceFromGuiPresentation(presentation, response.run.id);
    return {
      ...response,
      message: {
        ...response.message,
        provenance: {
          ...(response.message.provenance ?? {}),
          kind: 'live-runtime-codex',
          source,
          runtimeRequestEligible: false,
          liveAcceptanceEligible: true,
          commandId: asString(presentation?.commandId),
          attemptId: asString(presentation?.attemptId),
          provider: asString(presentation?.provider),
          model: asString(presentation?.model),
          profile: asString(presentation?.profile),
          workspace: asString(presentation?.workspace),
        },
        objectReferences: appendObjectReference(response.message.objectReferences, presentedObjectReference),
      },
      run: {
        ...response.run,
        raw: {
          ...(isRecord(response.run.raw) ? response.run.raw : {}),
          guiPresentation: presentation,
        },
        objectReferences: appendObjectReference(response.run.objectReferences, presentedObjectReference),
      },
    };
  }
  const nativeMessage = isRecord(result) && isRecord(result.nativeCodexMessage)
    ? result.nativeCodexMessage
    : isRecord(result) && isRecord(result.output) && isRecord(result.output.nativeCodexMessage)
      ? result.output.nativeCodexMessage
      : undefined;
  const nativeSource = asString(nativeMessage?.source);
  if (!nativeSource?.startsWith('codex.native-message:')) return response;
  return {
    ...response,
    message: {
      ...response.message,
      provenance: {
        ...(response.message.provenance ?? {}),
        kind: 'live-runtime-codex',
        source: nativeSource,
        runtimeRequestEligible: false,
        liveAcceptanceEligible: false,
        commandId: asString(nativeMessage?.commandId),
        attemptId: asString(nativeMessage?.attemptId),
        provider: asString(nativeMessage?.provider),
        model: asString(nativeMessage?.model),
        profile: asString(nativeMessage?.profile),
        workspace: asString(nativeMessage?.workspace),
      },
    },
    run: {
      ...response.run,
      raw: {
        ...(isRecord(response.run.raw) ? response.run.raw : {}),
        nativeCodexMessage: nativeMessage,
      },
    },
  };
}

function objectReferenceFromGuiPresentation(presentation: Record<string, unknown> | undefined, runId: string): ObjectReference | undefined {
  const rawRef = asString(presentation?.ref);
  if (!rawRef) return undefined;
  const kind = objectReferenceKindFromPresentationRef(rawRef);
  const target = targetFromPresentationRef(rawRef, kind);
  const id = objectReferenceIdFromPresentationRef(kind, target);
  const hint = asString(presentation?.hint);
  const isArtifact = kind === 'artifact';
  return {
    id,
    kind,
    title: asString(presentation?.title) ?? presentationTitleFromRef(target),
    ref: kind === 'url' ? `url:${target}` : `${kind}:${target}`,
    artifactType: isArtifact ? artifactTypeFromPresentationHint(hint) : undefined,
    runId,
    executionUnitId: kind === 'execution-unit' ? target : undefined,
    preferredView: preferredViewFromPresentationHint(hint, kind),
    presentationRole: 'primary-deliverable',
    status: 'available',
    summary: asString(presentation?.text)?.slice(0, 360) ?? rawRef,
    provenance: {
      dataRef: isArtifact || kind === 'url' ? target : undefined,
      path: kind === 'file' || kind === 'folder' ? target : undefined,
      producer: asString(presentation?.source),
    },
  };
}

function appendObjectReference(
  references: ObjectReference[] | undefined,
  reference: ObjectReference | undefined,
): ObjectReference[] | undefined {
  if (!reference) return references;
  const existing = references ?? [];
  if (existing.some((item) => item.ref === reference.ref || item.id === reference.id)) return existing;
  return [...existing, reference];
}

function objectReferenceKindFromPresentationRef(ref: string): ObjectReference['kind'] {
  if (/^https?:\/\//i.test(ref)) return 'url';
  const prefix = ref.match(/^([a-z-]+)::?/i)?.[1]?.toLowerCase();
  if (prefix === 'artifact' || prefix === 'file' || prefix === 'folder' || prefix === 'run' || prefix === 'execution-unit' || prefix === 'scenario-package' || prefix === 'url') {
    return prefix;
  }
  if (/[\\/]/.test(ref) || /\.[a-z0-9]+(?:$|[?#])/i.test(ref)) return 'file';
  return 'artifact';
}

function targetFromPresentationRef(ref: string, kind: ObjectReference['kind']): string {
  if (kind === 'url') return ref.replace(/^url::?/i, '');
  return ref.replace(new RegExp(`^${kind}::?`, 'i'), '');
}

function objectReferenceIdFromPresentationRef(kind: ObjectReference['kind'], target: string): string {
  return `gui-present-${kind}-${target.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 72) || 'ref'}`;
}

function presentationTitleFromRef(ref: string): string {
  const lastSegment = ref.split(/[\\/]/).filter(Boolean).at(-1) ?? ref;
  return lastSegment || ref;
}

function artifactTypeFromPresentationHint(hint: string | undefined): string {
  if (hint === 'table') return 'table';
  if (hint === 'diff') return 'diff';
  if (hint === 'image') return 'image';
  if (hint === 'notebook') return 'notebook';
  return 'research-report';
}

function preferredViewFromPresentationHint(hint: string | undefined, kind: ObjectReference['kind']): string | undefined {
  if (kind === 'file' && hint === 'markdown') return 'report-viewer';
  if (kind !== 'artifact' && kind !== 'file') return undefined;
  if (hint === 'table') return 'record-table';
  if (hint === 'diff') return 'diff-viewer';
  if (hint === 'image') return 'image-viewer';
  if (hint === 'notebook') return 'notebook-viewer';
  if (hint === 'markdown' || hint === 'auto' || !hint) return 'report-viewer';
  return undefined;
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
  const codexSessionId = selectedCodexSessionId(input.input) ?? latestCodexSessionId(input.input.runs);
  const commandText = buildCodexRuntimeCommandText(input, { resumeRequested: Boolean(codexSessionId) });
  const attemptId = `${input.commandId}-attempt-1`;
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

function buildCodexRuntimeCommandText(
  input: Parameters<typeof buildCodexRuntimeStreamRequest>[0],
  options: { resumeRequested?: boolean } = {},
) {
  const prompt = input.input.prompt.trim();
  const refs = uniqueRuntimeStringList(input.referenceSummary.flatMap((reference) => {
    const readableRefs = [reference.dataRef, reference.path, reference.ref].filter((value): value is string => Boolean(asString(value)));
    return readableRefs.length ? readableRefs : [reference.id];
  })).slice(0, 12);
  const taskText = refs.length
    ? `ask ${refs.map((ref) => `--ref ${quoteTerminalArg(ref)}`).join(' ')} ${quoteTerminalArg(prompt)}`
    : prompt;
  if (!options.resumeRequested) return taskText;
  return [
    'Continue the active Runtime Codex session. Interpret relative references such as "previous turn", "last answer", or "that passphrase" against the immediately preceding non-seed user/assistant exchange in this native Codex session unless selected refs say otherwise.',
    taskText,
  ].join('\n\n');
}

function latestCodexSessionId(runs: SendAgentMessageInput['runs']): string | undefined {
  for (const run of [...(runs ?? [])].reverse()) {
    const sessionId = codexSessionIdFromRun(run);
    if (sessionId) return sessionId;
  }
  return undefined;
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
  const currentId = asString(currentReference.id);
  if (currentId) aliases.push(`artifact:${currentId}`);
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
  const publicFailureReason = metadata.publicFailureReason ?? `Runtime Codex exited with code ${metadata.exitCode ?? 'unknown'}.`;
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
  const exitCode = asFiniteNumber(raw.exitCode) ?? asFiniteNumber(rawNested.exitCode);
  const stderrSummary = asString(rawNested.stderrSummary) ?? summarizeRuntimeStderr(events);
  const boundary = asString(raw.boundary) ?? asString(rawNested.boundary);
  const boundaryReason = boundary === 'gui-present-required'
    ? 'Runtime Codex completed without gui.present; SciForge withheld raw provider text from the primary result.'
    : undefined;
  const failureSignal = boundaryReason
    ?? actionableRuntimeStderrSummary([
      stderrSummary,
      summarizeRuntimeFailureMessages(events),
    ].filter(Boolean).join(' '))
    ?? stderrSummary;
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
    workspace: asString(raw.workspace) ?? asString(rawNested.workspace) ?? request.workspacePath,
    profile: asString(raw.profile) ?? asString(rawNested.profile) ?? request.profile,
    provider: asString(raw.provider) ?? asString(rawNested.provider) ?? asString(runtime.provider) ?? 'unknown',
    model: asString(raw.model) ?? asString(rawNested.model) ?? asString(runtime.model) ?? 'unknown',
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
      workspace: asString(raw.workspace) ?? asString(rawNested.workspace) ?? request.workspacePath,
      profile: asString(raw.profile) ?? asString(rawNested.profile) ?? request.profile,
      provider: asString(raw.provider) ?? asString(rawNested.provider) ?? asString(runtime.provider) ?? 'unknown',
      model: asString(raw.model) ?? asString(rawNested.model) ?? asString(runtime.model) ?? 'unknown',
      codexSessionId,
      stderrSummary,
      publicFailureReason: classification.publicFailureReason,
      evidenceRefs,
      recoverActions: [
        codexSessionId
          ? 'Resume the native Runtime Codex session with the preserved codexSessionId and audit refs.'
          : 'Retry this Runtime Codex command from preserved audit refs; native resume is unavailable because no codexSessionId was produced.',
        'Keep the same Runtime Codex profile/workspace unless the audit refs show a configuration failure.',
      ],
    },
  };
}

function publicRuntimeFailureReason(stderrSummary: string | undefined, exitCode: number | undefined) {
  return classifyRuntimeFailure(stderrSummary, exitCode).publicFailureReason;
}

function classifyRuntimeFailure(stderrSummary: string | undefined, exitCode: number | undefined) {
  const text = stderrSummary ?? '';
  if (/completed without gui\.present|gui-present-required/i.test(text)) {
    return runtimeFailureClassification('missing-gui-present', 'runtime-projection', true, 'Runtime Codex completed without gui.present; SciForge withheld raw provider text from the primary result.');
  }
  if (/401|unauthorized|invalid token/i.test(text)) {
    return runtimeFailureClassification('provider-auth', 'provider-config', false, 'Runtime Codex provider rejected credentials (401 Unauthorized). Check SCIFORGE_RUNTIME_API_KEY and the configured proxy upstream.');
  }
  if (/403|forbidden/i.test(text)) {
    return runtimeFailureClassification('provider-forbidden', 'provider-access', false, 'Runtime Codex provider or plugin access was forbidden (403). Check the configured proxy upstream credentials and account access.');
  }
  if (/429|rate limit|quota|insufficient_quota/i.test(text)) {
    return runtimeFailureClassification('provider-quota', 'provider-budget', false, 'Runtime Codex provider rate limit or quota blocked the run. Check the configured proxy upstream account limits.');
  }
  if (/502|bad gateway/i.test(text)) {
    return runtimeFailureClassification('provider-gateway', 'provider-upstream', true, 'Runtime Codex provider gateway returned 502 Bad Gateway. Treat this as an upstream/transient provider failure and retry with preserved audit refs.');
  }
  if (/ECONNREFUSED|connection refused|failed to connect/i.test(text)) {
    return runtimeFailureClassification('provider-proxy-unreachable', 'provider-proxy', true, 'Runtime Codex could not reach the configured provider proxy. Check that the proxy is running and the base URL is correct.');
  }
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo|nodename nor servname|DNS|network|timeout|timed out/i.test(text)) {
    return runtimeFailureClassification('external-network', 'external-network', true, 'Runtime Codex provider network request failed. Check network access and the configured proxy upstream.');
  }
  if (/ENOENT|spawn .*ENOENT|command not found|executable not found|No such file or directory/i.test(text)) {
    return runtimeFailureClassification('runtime-tool-missing', 'local-runtime', false, 'Runtime Codex could not start a required local tool or executable. Check the Runtime Codex installation and PATH.');
  }
  if (/ENOSPC|no space left|tmpdir|temporary directory|permission denied|EACCES/i.test(text)) {
    return runtimeFailureClassification('local-environment', 'local-environment', false, 'Runtime Codex failed in the local environment. Check disk space, temporary directory access, and workspace permissions.');
  }
  return runtimeFailureClassification('runtime-exit', 'runtime-codex', true, `Runtime Codex exited with code ${exitCode ?? 'unknown'}.`);
}

function runtimeFailureClassification(
  failureKind: string,
  ownerLayer: string,
  retryable: boolean,
  publicFailureReason: string,
) {
  return {
    failureKind,
    ownerLayer,
    retryable,
    publicFailureReason,
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
      asString(nested.message),
      asString(error.message),
    ];
  }).filter((value): value is string => Boolean(value)).join(' ').replace(/\s+/g, ' ').trim();
  if (!compact) return undefined;
  return actionableRuntimeStderrSummary(compact) ?? (compact.length > 240 ? `${compact.slice(0, 237)}...` : compact);
}

function actionableRuntimeStderrSummary(compact: string): string | undefined {
  for (const pattern of [
    /unexpected status\s+401[^.]*|401\s+Unauthorized[^.]*|Invalid token[^.]*/i,
    /unexpected status\s+429[^.]*|429\s+Too Many Requests[^.]*|rate limit[^.]*|quota[^.]*/i,
    /unexpected status\s+502[^.]*|502\s+Bad Gateway[^.]*|Bad Gateway[^.]*/i,
    /ECONNREFUSED[^.]*|connection refused[^.]*|failed to connect[^.]*/i,
    /ENOTFOUND[^.]*|timed out[^.]*/i,
    /unexpected status\s+403[^.]*|403\s+Forbidden[^.]*/i,
  ]) {
    const match = pattern.exec(compact);
    if (match?.[0] && !isRemotePluginAuthWarning(compact, match.index)) {
      return match[0].length > 240 ? `${match[0].slice(0, 237)}...` : match[0];
    }
  }
  return undefined;
}

function isRemotePluginAuthWarning(text: string, matchIndex: number) {
  const context = text.slice(Math.max(0, matchIndex - 180), matchIndex + 240);
  return /codex_core_plugins|remote plugin sync|chatgpt\.com\/backend-api\/plugins|featured plugin ids/i.test(context);
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
  if ((type === 'message' || type === 'message_delta') && asString(raw.text) && String(raw.schemaVersion || '').startsWith('sciforge.codex.')) return true;
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
