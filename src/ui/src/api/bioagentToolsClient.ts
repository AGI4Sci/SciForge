import type { AgentStreamEvent, NormalizedAgentResponse, SendAgentMessageInput } from '../domain';
import type { ScenarioId } from '../data';
import { makeId, nowIso } from '../domain';
import { SCENARIO_SPECS } from '../scenarioSpecs';
import { artifactTypesForComponents } from '../uiModuleRegistry';
import { normalizeAgentResponse } from './agentClient';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return entries.length ? entries : undefined;
}

export async function sendBioAgentToolMessage(
  input: SendAgentMessageInput,
  callbacks: { onEvent?: (event: AgentStreamEvent) => void } = {},
  signal?: AbortSignal,
): Promise<NormalizedAgentResponse> {
  const builtInScenarioId = builtInScenarioIdForInput(input);
  const rawArtifactSummary = summarizeArtifacts(input);
  const referenceSummary = summarizeBioAgentReferences(input);
  const rawRecentExecutionRefs = summarizeExecutionRefs(input);
  const contextPolicy = currentTurnContextPolicy(input, rawArtifactSummary, rawRecentExecutionRefs);
  const artifactSummary = contextPolicy.isolated ? [] : rawArtifactSummary;
  const recentExecutionRefs = contextPolicy.isolated ? [] : rawRecentExecutionRefs;
  const recentConversation = contextPolicy.isolated
    ? [`user: ${input.prompt}`]
    : currentTurnConversation(input, artifactSummary, recentExecutionRefs);
  const skillDomain = input.scenarioOverride?.skillDomain ?? SCENARIO_SPECS[builtInScenarioId].skillDomain;
  const selectedComponentIds = input.scenarioOverride?.defaultComponents?.length
    ? input.scenarioOverride.defaultComponents
    : SCENARIO_SPECS[builtInScenarioId].componentPolicy.defaultComponents;
  const expectedArtifactTypes = expectedArtifactsForScenario(builtInScenarioId, selectedComponentIds);
  const priorFailure = hasPriorFailure(artifactSummary, recentExecutionRefs);
  const requestController = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    requestController.abort();
  }, input.config.requestTimeoutMs || 900_000);
  const linkedAbort = () => requestController.abort();
  signal?.addEventListener('abort', linkedAbort, { once: true });
  let lastRealEventAt = Date.now();
  const silenceWatchdog = globalThis.setInterval(() => {
    const seconds = Math.round((Date.now() - lastRealEventAt) / 1000);
    if (seconds < 20) return;
    callbacks.onEvent?.(toolEvent('backend-silent', `后端 ${seconds}s 没有输出新事件；HTTP stream 仍在等待 ${input.config.agentBackend || 'codex'} 返回。`));
    lastRealEventAt = Date.now();
  }, 10_000);
  try {
    callbacks.onEvent?.(toolEvent('current-plan', `当前计划：发送用户原始请求到 AgentServer/workspace runtime，由后台判断回答、生成、修复或执行；UI 仅附带目标 artifacts=${expectedArtifactTypes.join(', ') || 'default'}`));
  callbacks.onEvent?.(toolEvent(
    'context-loaded',
    contextPolicy.isolated
      ? `已隔离历史上下文：${contextPolicy.reason}。本轮只发送用户原始请求和显式引用。`
      : artifactSummary.length || recentExecutionRefs.length
      ? `读取上一轮上下文：artifacts=${artifactSummary.length}, refs=${recentExecutionRefs.length}`
      : '当前轮没有可复用 artifact/ref，上下文从场景目标和对话开始。',
  ));
  if (priorFailure) {
    callbacks.onEvent?.(toolEvent('repair-start', `正在修复：已发现上一轮 failureReason=${priorFailure}`));
  }
  callbacks.onEvent?.(toolEvent('project-tool-start', `BioAgent ${builtInScenarioId} project tool started`));
  const response = await fetch(`${input.config.workspaceWriterBaseUrl}/api/bioagent/tools/run/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        scenarioId: builtInScenarioId,
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
        availableSkills: [`agentserver.generate.${skillDomain}`],
        expectedArtifactTypes,
        selectedComponentIds,
        uiState: {
          sessionId: input.sessionId,
          scopeCheck: {
            source: 'structured-scenario-hint',
            decisionOwner: 'AgentServer',
            note: 'BioAgent does not route or reject current-turn intent by keyword; AgentServer decides from rawUserPrompt and context.',
          },
          scenarioOverride: input.scenarioOverride,
          scenarioPackageRef: input.scenarioPackageRef,
          skillPlanRef: input.skillPlanRef,
          uiPlanRef: input.uiPlanRef,
          currentPrompt: input.prompt,
          maxContextWindowTokens: input.config.maxContextWindowTokens,
          recentConversation,
          currentReferences: referenceSummary,
          recentExecutionRefs,
          recentRuns: contextPolicy.isolated ? [] : summarizeRuns(input),
          workspacePersistence: workspacePersistenceSummary(input),
          expectedArtifactTypes,
          selectedComponentIds,
          rawUserPrompt: input.prompt,
          contextIsolation: contextPolicy,
          agentDispatchPolicy: 'agentserver-decides',
          agentContext: buildAgentContext(input, recentConversation, artifactSummary, recentExecutionRefs),
        },
      }),
      signal: requestController.signal,
    });
  const { result, error } = await readWorkspaceToolStream(response, (event) => {
    lastRealEventAt = Date.now();
    callbacks.onEvent?.(withConfiguredContextWindowLimit(
      normalizeWorkspaceRuntimeEvent(event),
      input.config.maxContextWindowTokens,
    ));
  });
  if (!response.ok || error || !isRecord(result)) {
    throw new Error(error || `BioAgent project tool failed: HTTP ${response.status}`);
  }
  const completion = workspaceResultCompletion(result);
  callbacks.onEvent?.(toolEvent('project-tool-done', completion.status === 'failed'
    ? `BioAgent ${builtInScenarioId} 未完成：${completion.reason ?? '后台返回 repair-needed/failed-with-reason 诊断，未产出用户要求的最终结果。'}`
    : priorFailure
      ? `BioAgent ${builtInScenarioId} 已完成，并保留上一轮修复上下文`
      : `BioAgent ${builtInScenarioId} project tool completed`));
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
        ? `BioAgent project tool 超时：${input.config.requestTimeoutMs || 900_000}ms 内没有完成。流式面板已显示最后一个真实事件。`
        : 'BioAgent project tool 已取消。');
    }
    throw error;
  } finally {
    globalThis.clearTimeout(timeout);
    globalThis.clearInterval(silenceWatchdog);
    signal?.removeEventListener('abort', linkedAbort);
  }
}

function withConfiguredContextWindowLimit(event: AgentStreamEvent, maxContextWindowTokens: number): AgentStreamEvent {
  const state = event.contextWindowState;
  if (!state || state.windowTokens !== undefined || !maxContextWindowTokens) return event;
  const ratio = state.usedTokens !== undefined ? state.usedTokens / maxContextWindowTokens : state.ratio;
  return {
    ...event,
    contextWindowState: {
      ...state,
      window: maxContextWindowTokens,
      windowTokens: maxContextWindowTokens,
      ratio,
      status: normalizeContextWindowStatus(state.status, ratio, state.autoCompactThreshold),
    },
  };
}

function expectedArtifactsForScenario(scenarioId: ScenarioId, componentIds: string[]) {
  const builtInTypes = SCENARIO_SPECS[scenarioId].outputArtifacts.map((artifact) => artifact.type);
  return uniqueStrings([
    ...builtInTypes,
    ...artifactTypesForComponents(componentIds),
  ]);
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function workspaceResultCompletion(result: Record<string, unknown>): { status: 'completed' | 'failed'; reason?: string } {
  const failure = firstBlockingResultReason(result);
  return failure ? { status: 'failed', reason: failure } : { status: 'completed' };
}

function firstBlockingResultReason(result: Record<string, unknown>) {
  const units = arrayRecords(result.executionUnits);
  for (const unit of units) {
    const status = String(unit.status || '').trim().toLowerCase();
    if (status === 'repair-needed' || status === 'failed-with-reason' || status === 'failed') {
      return asString(unit.failureReason)
        || asString(unit.message)
        || `${asString(unit.id) || 'execution unit'} status=${status}`;
    }
  }
  const artifacts = arrayRecords(result.artifacts);
  for (const artifact of artifacts) {
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const data = isRecord(artifact.data) ? artifact.data : {};
    const status = String(metadata.status || data.status || '').trim().toLowerCase();
    if (status === 'repair-needed' || status === 'failed-with-reason' || status === 'failed') {
      return asString(metadata.failureReason)
        || asString(data.failureReason)
        || `${asString(artifact.id) || asString(artifact.type) || 'artifact'} status=${status}`;
    }
  }
  const message = asString(result.message);
  if (message && /\brepair-needed\b|\bfailed-with-reason\b/i.test(message) && shouldTreatMessageAsBlocking(message, units, artifacts)) {
    return message.slice(0, 240);
  }
  return undefined;
}

function shouldTreatMessageAsBlocking(message: string, units: Record<string, unknown>[], artifacts: Record<string, unknown>[]) {
  if (/^\s*(?:repair-needed|failed-with-reason|failed)\s*$/i.test(message)) return true;
  if (looksLikeBlockingDiagnosticMessage(message)) return true;
  return !hasSuccessfulResultEvidence(units, artifacts);
}

function looksLikeBlockingDiagnosticMessage(message: string) {
  return /^(?:BioAgent runtime gateway needs repair|Agent backend .* failed|AgentServer .* failed|No validated local skill|Task output failed|AgentServer .* did not|Generated artifacts did not)/i.test(message)
    || /\b(?:execution unit|artifact|research-report|paper-list)\s+status=(?:repair-needed|failed-with-reason|failed)\b/i.test(message);
}

function hasSuccessfulResultEvidence(units: Record<string, unknown>[], artifacts: Record<string, unknown>[]) {
  const hasCompletedUnit = units.some((unit) => {
    const status = String(unit.status || '').trim().toLowerCase();
    return status === 'done' || status === 'record-only' || status === 'self-healed' || status === 'completed' || status === 'success';
  });
  const hasUsableArtifact = artifacts.some((artifact) => {
    const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
    const data = isRecord(artifact.data) ? artifact.data : {};
    const status = String(metadata.status || data.status || '').trim().toLowerCase();
    return status !== 'repair-needed'
      && status !== 'failed-with-reason'
      && status !== 'failed'
      && Boolean(asString(artifact.id) || asString(artifact.type));
  });
  return hasCompletedUnit || hasUsableArtifact;
}

function arrayRecords(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

async function readWorkspaceToolStream(
  response: Response,
  onEvent: (event: unknown) => void,
): Promise<{ result?: unknown; error?: string }> {
  if (!response.body) {
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Keep raw text for diagnostics.
    }
    if (isRecord(json) && json.ok === true) return { result: json.result };
    return { error: isRecord(json) ? asString(json.error) || asString(json.message) : text || `HTTP ${response.status}` };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let result: unknown;
  let error: string | undefined;
  function consumeLine(rawLine: string) {
    const line = rawLine.trim();
    if (!line) return;
    const envelope = JSON.parse(line) as unknown;
    if (!isRecord(envelope)) return;
    if ('event' in envelope) onEvent(envelope.event);
    if ('result' in envelope) result = envelope.result;
    if ('error' in envelope) error = asString(envelope.error) || JSON.stringify(envelope.error);
  }
  for (;;) {
    const { value, done } = await reader.read();
    buffer += decoder.decode(value ?? new Uint8Array(), { stream: !done });
    while (buffer.includes('\n')) {
      const index = buffer.indexOf('\n');
      consumeLine(buffer.slice(0, index));
      buffer = buffer.slice(index + 1);
    }
    if (done) break;
  }
  if (buffer.trim()) consumeLine(buffer);
  return { result, error };
}

function normalizeWorkspaceRuntimeEvent(raw: unknown): AgentStreamEvent {
  const record = isRecord(raw) ? raw : {};
  const type = asString(record.type) || asString(record.kind) || 'workspace-runtime-event';
  const source = asString(record.source);
  const toolName = asString(record.toolName);
  const usage = normalizeTokenUsage(record.usage)
    ?? normalizeTokenUsage(isRecord(record.output) ? record.output.usage : undefined)
    ?? normalizeTokenUsage(isRecord(record.result) ? record.result.usage : undefined)
    ?? normalizeTokenUsage(isRecord(record.result) && isRecord(record.result.output) ? record.result.output.usage : undefined);
  const contextWindowState = normalizeContextWindowState(contextWindowCandidate(record), type, record);
  const contextCompaction = normalizeContextCompaction(record.contextCompaction ?? record.compaction ?? record.context_compaction, type, record);
  const baseDetail = asString(record.detail)
    || asString(record.message)
    || asString(record.text)
    || asString(record.output)
    || asString(record.status)
    || asString(record.error)
    || (Object.keys(record).length ? JSON.stringify(record) : undefined);
  const usageDetail = formatTokenUsage(usage);
  const detail = [baseDetail, usageDetail].filter(Boolean).join(' | ') || undefined;
  return {
    id: makeId('evt'),
    type,
    label: streamEventLabel(type, source, toolName),
    detail,
    usage,
    contextWindowState,
    contextCompaction,
    createdAt: nowIso(),
    raw,
  };
}

function normalizeContextWindowState(value: unknown, type: string, fallback: Record<string, unknown>): AgentStreamEvent['contextWindowState'] | undefined {
  const record = isRecord(value) ? value : type === 'contextWindowState' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const usage = isRecord(record.usage) ? record.usage : record;
  const input = asNumber(record.input) ?? asNumber(record.inputTokens) ?? asNumber(usage.input) ?? asNumber(usage.promptTokens);
  const output = asNumber(record.output) ?? asNumber(record.outputTokens) ?? asNumber(usage.output) ?? asNumber(usage.completionTokens);
  const cacheRead = asNumber(record.cacheRead) ?? asNumber(record.cacheReadTokens) ?? asNumber(usage.cacheRead);
  const cacheWrite = asNumber(record.cacheWrite) ?? asNumber(record.cacheWriteTokens) ?? asNumber(usage.cacheWrite);
  const cache = asNumber(record.cache) ?? asNumber(record.cacheTokens) ?? asNumber(usage.cache) ?? (
    cacheRead !== undefined || cacheWrite !== undefined ? (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined
  );
  const explicitUsedTokens = asNumber(record.usedTokens)
    ?? asNumber(record.used_tokens)
    ?? asNumber(record.used)
    ?? asNumber(record.contextWindowTokens)
    ?? asNumber(record.currentContextWindowTokens)
    ?? asNumber(record.context_window_tokens)
    ?? asNumber(record.current_context_window_tokens)
    ?? asNumber(record.contextLength)
    ?? asNumber(record.context_length)
    ?? asNumber(record.currentContextLength)
    ?? asNumber(record.current_context_length)
    ?? asNumber(record.tokens);
  const usedTokens = explicitUsedTokens;
  const windowTokens = asNumber(record.windowTokens) ?? asNumber(record.window) ?? asNumber(record.contextWindowLimit) ?? asNumber(record.context_window_limit) ?? asNumber(record.limit) ?? asNumber(record.contextWindow);
  const ratio = clampRatio(asNumber(record.ratio) ?? asNumber(record.contextWindowRatio) ?? (
    usedTokens !== undefined && windowTokens ? usedTokens / windowTokens : undefined
  ));
  const hasUsage = input !== undefined || output !== undefined || cache !== undefined || asNumber(usage.total) !== undefined;
  const hasContextTelemetry = usedTokens !== undefined || windowTokens !== undefined || ratio !== undefined;
  const explicitSource = asString(record.source) ?? asString(record.contextWindowSource) ?? asString(record.context_window_source);
  const source = explicitSource
    ? (normalizeContextWindowSource(explicitSource) === 'unknown' && hasUsage ? 'provider-usage' : normalizeContextWindowSource(explicitSource))
    : (hasUsage ? 'provider-usage' : 'unknown');
  const state = {
    backend: asString(record.backend) ?? asString(usage.provider),
    provider: asString(record.provider) ?? asString(usage.provider),
    model: asString(record.model) ?? asString(usage.model),
    usedTokens,
    input,
    output,
    cache,
    window: windowTokens,
    windowTokens,
    ratio,
    source,
    status: normalizeContextWindowStatus(asString(record.status), ratio, clampRatio(asNumber(record.autoCompactThreshold))),
    compactCapability: normalizeCompactCapability(asString(record.compactCapability) ?? asString(record.compactionCapability)),
    budget: normalizeContextBudget(record.budget),
    auditRefs: asStringArray(record.auditRefs),
    autoCompactThreshold: clampRatio(asNumber(record.autoCompactThreshold)),
    watchThreshold: clampRatio(asNumber(record.watchThreshold)),
    nearLimitThreshold: clampRatio(asNumber(record.nearLimitThreshold)),
    lastCompactedAt: asString(record.lastCompactedAt),
    pendingCompact: typeof record.pendingCompact === 'boolean' ? record.pendingCompact : undefined,
  };
  if (state.compactCapability === 'unknown' && state.backend) {
    state.compactCapability = compactCapabilityForBackend(state.backend);
  }
  return hasContextTelemetry
    ? state
    : undefined;
}

function contextWindowCandidate(record: Record<string, unknown>): unknown {
  return record.contextWindowState
    ?? record.contextWindow
    ?? record.context_window
    ?? (isExplicitContextWindowRecord(record.usage) ? record.usage : undefined);
}

function isExplicitContextWindowRecord(value: unknown): value is Record<string, unknown> {
  if (!isRecord(value)) return false;
  return [
    'usedTokens',
    'used_tokens',
    'contextWindowTokens',
    'context_window_tokens',
    'currentContextWindowTokens',
    'current_context_window_tokens',
    'contextLength',
    'context_length',
    'currentContextLength',
    'current_context_length',
    'windowTokens',
    'window_tokens',
    'contextWindowLimit',
    'context_window_limit',
    'modelContextWindow',
    'model_context_window',
    'contextWindowRatio',
    'context_window_ratio',
    'contextWindowSource',
    'context_window_source',
  ].some((key) => key in value);
}

function normalizeContextCompaction(value: unknown, type: string, fallback: Record<string, unknown>): AgentStreamEvent['contextCompaction'] | undefined {
  const record = isRecord(value) ? value : type === 'contextCompaction' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const completedAt = asString(record.completedAt);
  const lastCompactedAt = asString(record.lastCompactedAt) ?? completedAt;
  const message = asString(record.message) ?? asString(record.userVisibleSummary) ?? asString(record.detail);
  return {
    status: normalizeCompactionStatus(asString(record.status), {
      ok: asBoolean(record.ok),
      completedAt,
      lastCompactedAt,
      message,
    }),
    source: normalizeContextWindowSource(asString(record.source)),
    backend: asString(record.backend),
    compactCapability: normalizeCompactCapability(asString(record.compactCapability) ?? asString(record.compactionCapability)),
    before: normalizeContextWindowState(record.before, 'contextWindowState', {}),
    after: normalizeContextWindowState(record.after, 'contextWindowState', {}),
    auditRefs: asStringArray(record.auditRefs),
    startedAt: asString(record.startedAt),
    completedAt,
    lastCompactedAt,
    reason: asString(record.reason),
    message,
  };
}

function normalizeContextWindowSource(value?: string): NonNullable<AgentStreamEvent['contextWindowState']>['source'] {
  if (value === 'native' || value === 'provider-usage' || value === 'agentserver-estimate' || value === 'agentserver' || value === 'estimate' || value === 'unknown') return value;
  if (value === 'usage' || value === 'provider') return 'provider-usage';
  if (value === 'backend') return 'native';
  if (value === 'handoff') return 'agentserver-estimate';
  return 'unknown';
}

function normalizeCompactCapability(value?: string): NonNullable<AgentStreamEvent['contextWindowState']>['compactCapability'] {
  if (value === 'native' || value === 'agentserver' || value === 'handoff-only' || value === 'handoff-slimming' || value === 'session-rotate' || value === 'none' || value === 'unknown') return value;
  return 'unknown';
}

function compactCapabilityForBackend(backend: string): NonNullable<AgentStreamEvent['contextWindowState']>['compactCapability'] {
  if (backend === 'codex') return 'native';
  if (backend === 'openteam_agent' || backend === 'hermes-agent') return 'agentserver';
  if (backend === 'gemini') return 'session-rotate';
  if (backend === 'claude-code' || backend === 'openclaw') return 'handoff-only';
  return 'unknown';
}

function normalizeContextWindowStatus(
  value: string | undefined,
  ratio: number | undefined,
  autoCompactThreshold: number | undefined,
): NonNullable<AgentStreamEvent['contextWindowState']>['status'] {
  if (value === 'healthy' || value === 'watch' || value === 'near-limit' || value === 'exceeded' || value === 'compacting' || value === 'blocked' || value === 'unknown') return value;
  if (value && /exceeded|overflow|max|full/i.test(value)) return 'exceeded';
  if (value && /compact/i.test(value)) return 'compacting';
  if (value && /blocked|rate/i.test(value)) return 'blocked';
  if (value && /near|critical|warning/i.test(value)) return 'near-limit';
  if (value && /watch/i.test(value)) return 'watch';
  if (value && /healthy|ok|normal/i.test(value)) return 'healthy';
  if (ratio !== undefined && ratio >= 1) return 'exceeded';
  if (ratio !== undefined && ratio >= (autoCompactThreshold ?? 0.82)) return 'near-limit';
  if (ratio !== undefined && ratio >= 0.68) return 'watch';
  return ratio === undefined ? 'unknown' : 'healthy';
}

function normalizeContextBudget(value: unknown): NonNullable<AgentStreamEvent['contextWindowState']>['budget'] | undefined {
  if (!isRecord(value)) return undefined;
  return {
    rawRef: asString(value.rawRef),
    rawSha1: asString(value.rawSha1),
    rawBytes: asNumber(value.rawBytes),
    normalizedBytes: asNumber(value.normalizedBytes),
    maxPayloadBytes: asNumber(value.maxPayloadBytes),
    rawTokens: asNumber(value.rawTokens),
    normalizedTokens: asNumber(value.normalizedTokens),
    savedTokens: asNumber(value.savedTokens),
    normalizedBudgetRatio: clampRatio(asNumber(value.normalizedBudgetRatio)),
    decisions: Array.isArray(value.decisions) ? value.decisions.filter(isRecord) : undefined,
  };
}

function normalizeCompactionStatus(
  value?: string,
  inferred: { ok?: boolean; completedAt?: string; lastCompactedAt?: string; message?: string } = {},
): NonNullable<AgentStreamEvent['contextCompaction']>['status'] {
  if (value === 'started' || value === 'completed' || value === 'failed' || value === 'pending' || value === 'skipped') return value;
  if (value === 'compacted') return 'completed';
  if (value === 'unsupported') return 'skipped';
  if (value && /fail|error/i.test(value)) return 'failed';
  if (value && /skip|unsupported|handoff/i.test(value)) return 'skipped';
  if (value && /complete|done|success|compact(ed)?|compressed/i.test(value)) return 'completed';
  if (inferred.ok === true || inferred.completedAt || inferred.lastCompactedAt || (inferred.message && /complete|done|success|compact(ed)?|compressed|完成/i.test(inferred.message))) return 'completed';
  if (inferred.ok === false || (inferred.message && /fail|error|失败|未完成/i.test(inferred.message))) return 'failed';
  return 'pending';
}

function clampRatio(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return undefined;
  return Math.max(0, Math.min(1.5, value));
}

function normalizeTokenUsage(value: unknown): AgentStreamEvent['usage'] | undefined {
  if (!isRecord(value)) return undefined;
  const usage = {
    input: asNumber(value.input),
    output: asNumber(value.output),
    total: asNumber(value.total),
    cacheRead: asNumber(value.cacheRead),
    cacheWrite: asNumber(value.cacheWrite),
    provider: asString(value.provider),
    model: asString(value.model),
    source: asString(value.source),
  };
  if (
    usage.input === undefined
    && usage.output === undefined
    && usage.total === undefined
    && usage.cacheRead === undefined
    && usage.cacheWrite === undefined
  ) {
    return undefined;
  }
  return usage;
}

function formatTokenUsage(usage: AgentStreamEvent['usage'] | undefined) {
  if (!usage) return undefined;
  const parts = [
    usage.input !== undefined ? `in ${usage.input}` : '',
    usage.output !== undefined ? `out ${usage.output}` : '',
    usage.total !== undefined ? `total ${usage.total}` : '',
    usage.cacheRead !== undefined ? `cache read ${usage.cacheRead}` : '',
    usage.cacheWrite !== undefined ? `cache write ${usage.cacheWrite}` : '',
  ].filter(Boolean);
  const model = [usage.provider, usage.model].filter(Boolean).join('/');
  const suffix = [model, usage.source].filter(Boolean).join(' ');
  return `tokens ${parts.join(', ')}${suffix ? ` (${suffix})` : ''}`;
}

function streamEventLabel(type: string, source?: string, toolName?: string) {
  if (type === 'contextWindowState') return '上下文窗口';
  if (type === 'contextCompaction') return '上下文压缩';
  if (type === 'run-plan') return '计划';
  if (type === 'stage-start') return '阶段';
  if (type === 'text-delta') return '思考';
  if (type === 'tool-call') return toolName ? `调用 ${toolName}` : '工具调用';
  if (type === 'tool-result') return toolName ? `结果 ${toolName}` : '工具结果';
  if (type === 'status') return source === 'agentserver' ? 'AgentServer 状态' : '运行状态';
  if (type.includes('error')) return '错误';
  if (type.includes('silent')) return '等待';
  return source === 'agentserver' ? 'AgentServer' : 'Workspace Runtime';
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

export function currentTurnContextPolicy(
  input: SendAgentMessageInput,
  artifacts: ReturnType<typeof summarizeArtifacts> = summarizeArtifacts(input),
  recentExecutionRefs: ReturnType<typeof summarizeExecutionRefs> = summarizeExecutionRefs(input),
) {
  const prompt = input.prompt.trim();
  const hasExplicitReferences = (input.references?.length ?? 0) > 0;
  if (hasExplicitReferences) return { isolated: false, reason: 'explicit-user-reference' };
  if (!artifacts.length && !recentExecutionRefs.length && !(input.runs?.length ?? 0)) {
    return { isolated: false, reason: 'no-prior-context' };
  }
  if (isContinuationLikePrompt(prompt)) return { isolated: false, reason: 'continuation-or-repair-request' };
  if (isFreshRetrievalPrompt(prompt)) return { isolated: true, reason: 'fresh-retrieval-request' };
  if (isPromptFarFromPriorContext(prompt, artifacts, input.runs ?? [])) return { isolated: true, reason: 'current-prompt-drifted-from-prior-context' };
  return { isolated: false, reason: 'context-may-be-relevant' };
}

function isContinuationLikePrompt(prompt: string) {
  return /继续|基于|根据|上面|上述|这个|这个文件|该文件|这些|前面|之前|上一轮|刚才|已有|已上传|上传|PDF|pdf|总结已有|解释上一轮|修复|重试|重新跑|rerun|repair|retry|continue|existing|previous|uploaded/i.test(prompt);
}

function isFreshRetrievalPrompt(prompt: string) {
  return /今天|今日|最新|新近|刚发布|检索|搜索|查找|arxiv|bioRxiv|medRxiv|PubMed|Semantic Scholar|Google Scholar|latest|today|new|recent|search|retrieve/i.test(prompt);
}

function isPromptFarFromPriorContext(
  prompt: string,
  artifacts: ReturnType<typeof summarizeArtifacts>,
  runs: NonNullable<SendAgentMessageInput['runs']>,
) {
  const promptTokens = keywordTokens(prompt);
  if (!promptTokens.size) return false;
  const priorText = [
    ...artifacts.map((artifact) => JSON.stringify({
      id: artifact.id,
      type: artifact.type,
      metadata: artifact.metadata,
      dataSummary: artifact.dataSummary,
    })),
    ...runs.slice(-4).map((run) => `${run.prompt} ${run.response}`),
  ].join('\n');
  const priorTokens = keywordTokens(priorText);
  if (!priorTokens.size) return false;
  let overlap = 0;
  for (const token of promptTokens) {
    if (priorTokens.has(token)) overlap += 1;
  }
  return overlap / promptTokens.size < 0.18;
}

function keywordTokens(value: string) {
  const normalized = value.toLowerCase();
  const tokens = new Set<string>();
  for (const match of normalized.matchAll(/[a-z][a-z0-9-]{2,}|[\u4e00-\u9fff]{2,}/g)) {
    const token = match[0];
    if (STOPWORDS.has(token)) continue;
    tokens.add(token);
  }
  return tokens;
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'are', 'was', 'were', 'have', 'has', 'had',
  '请', '帮我', '提供', '一个', '一份', '简要', '总结', '报告', '相关', '论文', '阅读',
]);

function currentTurnConversation(
  input: SendAgentMessageInput,
  artifactSummary: ReturnType<typeof summarizeArtifacts>,
  recentExecutionRefs: ReturnType<typeof summarizeExecutionRefs>,
) {
  const hasCurrentSessionWork = (input.runs?.length ?? 0) > 0
    || artifactSummary.length > 0
    || recentExecutionRefs.length > 0
    || (input.references?.length ?? 0) > 0;
  if (!hasCurrentSessionWork) return [`user: ${input.prompt}`];
  const conversation = input.messages.slice(-12).map((message) => {
    const references = message.references?.length
      ? `\n  references: ${JSON.stringify(message.references.map(compactBioAgentReference))}`
      : '';
    return `${message.role}: ${compactConversationContent(message.content)}${references}`;
  });
  const lastUser = [...input.messages].reverse().find((message) => message.role === 'user');
  if (!lastUser || normalizePromptText(lastUser.content) !== normalizePromptText(input.prompt)) {
    conversation.push(`user: ${compactConversationContent(input.prompt)}`);
  }
  return conversation;
}

function normalizePromptText(value: string) {
  return value.replace(/^运行中引导：/, '').trim();
}

function compactConversationContent(value: string) {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= 1200) return normalized;
  return `${normalized.slice(0, 800)} ... [${normalized.length - 1200} chars omitted] ... ${normalized.slice(-400)}`;
}

function summarizeArtifacts(input: SendAgentMessageInput) {
  return (input.artifacts ?? []).slice(0, 8).map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    producerScenario: artifact.producerScenario,
    producer: artifact.producerScenario,
    schemaVersion: artifact.schemaVersion,
    dataRef: artifact.dataRef,
    path: artifact.path,
    workspaceArtifactRef: input.sessionId ? `.bioagent/artifacts/${safeWorkspaceName(input.sessionId)}-${safeWorkspaceName(artifact.id || artifact.type || 'artifact')}.json` : undefined,
    runId: artifactRunId(artifact),
    status: artifactStatus(artifact),
    failureReason: artifactFailureReason(artifact),
    fileRefs: collectArtifactFileRefs(artifact),
    metadata: compactRecord(artifact.metadata),
    dataSummary: summarizeArtifactData(artifact.data),
  }));
}

function summarizeBioAgentReferences(input: SendAgentMessageInput) {
  return (input.references ?? []).slice(0, 8).map(compactBioAgentReference);
}

function compactBioAgentReference(reference: NonNullable<SendAgentMessageInput['references']>[number]) {
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

function summarizeExecutionRefs(input: SendAgentMessageInput) {
  return (input.executionUnits ?? []).slice(0, 8).map((unit) => ({
    id: unit.id,
    status: unit.status,
    tool: unit.tool,
    attempt: unit.attempt,
    parentAttempt: unit.parentAttempt,
    codeRef: unit.codeRef,
    inputRef: unit.params && looksLikeRef(unit.params) ? unit.params : undefined,
    outputRef: unit.outputRef,
    stdoutRef: unit.stdoutRef,
    stderrRef: unit.stderrRef,
    failureReason: unit.failureReason,
    selfHealReason: unit.selfHealReason,
    recoverActions: unit.recoverActions,
    nextStep: unit.nextStep,
    routeDecision: unit.routeDecision,
  })).filter((item) => item.codeRef || item.outputRef || item.stdoutRef || item.stderrRef || item.failureReason || item.status === 'repair-needed' || item.status === 'failed-with-reason');
}

function summarizeRuns(input: SendAgentMessageInput) {
  return (input.runs ?? []).slice(-6).map((run) => ({
    id: run.id,
    status: run.status,
    prompt: run.prompt.slice(0, 360),
    responsePreview: run.response.slice(0, 360),
    scenarioPackageRef: run.scenarioPackageRef,
    skillPlanRef: run.skillPlanRef,
    uiPlanRef: run.uiPlanRef,
    createdAt: run.createdAt,
    completedAt: run.completedAt,
  }));
}

function artifactRunId(artifact: { metadata?: Record<string, unknown> }) {
  const metadata = artifact.metadata ?? {};
  return asString(metadata.runId) || asString(metadata.agentServerRunId) || asString(metadata.producerRunId) || asString(metadata.lastRunId);
}

function artifactStatus(artifact: { metadata?: Record<string, unknown>; data?: unknown }) {
  const metadata = artifact.metadata ?? {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return asString(metadata.status) || asString(data.status);
}

function artifactFailureReason(artifact: { metadata?: Record<string, unknown>; data?: unknown }) {
  const metadata = artifact.metadata ?? {};
  const data = isRecord(artifact.data) ? artifact.data : {};
  return asString(metadata.failureReason) || asString(data.failureReason) || asString(metadata.reason) || asString(data.reason);
}

function summarizeArtifactData(data: unknown) {
  if (typeof data === 'string') {
    return {
      valueType: 'string',
      textPreview: data.slice(0, 1200),
      markdownPreview: data.slice(0, 1200),
    };
  }
  if (!isRecord(data)) return data === undefined ? undefined : { valueType: Array.isArray(data) ? 'array' : typeof data };
  const keys = Object.keys(data).slice(0, 20);
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.records) ? data.records : undefined;
  const sections = Array.isArray(data.sections) ? data.sections : undefined;
  const collections = summarizeArtifactCollections(data);
  return {
    keys,
    rowCount: rows?.length,
    collections,
    sectionTitles: sections?.slice(0, 8).map((section) => isRecord(section) ? asString(section.title) : undefined).filter(Boolean),
    markdownPreview: typeof data.markdown === 'string' ? data.markdown.slice(0, 500) : undefined,
    refs: compactRecord({
      dataRef: data.dataRef,
      codeRef: data.codeRef,
      outputRef: data.outputRef,
      stdoutRef: data.stdoutRef,
      stderrRef: data.stderrRef,
      logRef: data.logRef,
      reportRef: data.reportRef,
      paperListRef: data.paperListRef,
      pdfDir: data.pdfDir,
      downloadDir: data.downloadDir,
    }),
  };
}

function summarizeArtifactCollections(data: Record<string, unknown>) {
  const collections: Record<string, unknown> = {};
  for (const key of ['papers', 'items', 'records', 'rows', 'nodes', 'edges', 'files', 'results']) {
    const value = data[key];
    if (!Array.isArray(value)) continue;
    collections[key] = {
      count: value.length,
      refs: summarizeCollectionRefs(value),
    };
  }
  return Object.keys(collections).length ? collections : undefined;
}

function summarizeCollectionRefs(items: unknown[]) {
  return items.slice(0, 8).map((item) => {
    const record = isRecord(item) ? item : {};
    return compactRecord({
      title: record.title,
      name: record.name,
      id: record.id,
      accession: record.accession,
      doi: record.doi,
      url: record.url,
      remoteUrl: record.remoteUrl,
      downloadUrl: record.downloadUrl,
      localPath: record.localPath,
      path: record.path,
      filePath: record.filePath,
      downloadedPath: record.downloadedPath,
      sourcePath: record.sourcePath,
      dataRef: record.dataRef,
    });
  }).filter(Boolean);
}

function collectArtifactFileRefs(value: unknown) {
  const refs = new Set<string>();
  const visit = (entry: unknown, key = '') => {
    if (refs.size >= 24) return;
    if (typeof entry === 'string') {
      if (looksLikeRef(entry) || /path|ref|file|dir|pdf|download|log|stdout|stderr|output|code/i.test(key)) refs.add(entry);
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry.slice(0, 24)) visit(item, key);
      return;
    }
    if (!isRecord(entry)) return;
    for (const [childKey, childValue] of Object.entries(entry).slice(0, 48)) {
      visit(childValue, childKey);
    }
  };
  visit(value);
  return refs.size ? Array.from(refs) : undefined;
}

function compactRecord(value: unknown) {
  if (!isRecord(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value).slice(0, 24)) {
    if (typeof entry === 'string') out[key] = entry.length > 500 ? `${entry.slice(0, 500)}...` : entry;
    else if (typeof entry === 'number' || typeof entry === 'boolean' || entry == null) out[key] = entry;
    else if (Array.isArray(entry)) out[key] = entry.slice(0, 12);
    else if (isRecord(entry)) out[key] = Object.fromEntries(Object.entries(entry).slice(0, 8));
  }
  return Object.keys(out).length ? out : undefined;
}

function looksLikeRef(value: string) {
  return /\.bioagent\/|stdout|stderr|output|input|\.json|\.log|\.py|\.ipynb|\.r$/i.test(value);
}

function safeWorkspaceName(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120);
}

function workspacePersistenceSummary(input: SendAgentMessageInput) {
  const workspacePath = input.config.workspacePath.trim();
  const sessionId = input.sessionId;
  return {
    workspacePath,
    bioagentDir: workspacePath ? `${workspacePath}/.bioagent` : '.bioagent',
    workspaceStateRef: '.bioagent/workspace-state.json',
    sessionRef: sessionId ? `.bioagent/sessions/${safeWorkspaceName(sessionId)}.json` : undefined,
    artifactDir: '.bioagent/artifacts/',
    taskDir: '.bioagent/tasks/',
    taskResultDir: '.bioagent/task-results/',
    logDir: '.bioagent/logs/',
    note: 'Generated task code, task inputs/results/logs, and UI artifacts are persisted under the workspace .bioagent directory when Workspace Writer is online.',
  };
}

function hasPriorFailure(
  artifactSummary: ReturnType<typeof summarizeArtifacts>,
  recentExecutionRefs: ReturnType<typeof summarizeExecutionRefs>,
) {
  const artifactFailure = artifactSummary
    .map((artifact) => artifact.failureReason || (artifact.status === 'repair-needed' ? 'artifact marked repair-needed' : undefined))
    .find(Boolean);
  if (artifactFailure) return String(artifactFailure).slice(0, 220);
  const executionFailure = recentExecutionRefs
    .map((unit) => unit.failureReason || (unit.status === 'repair-needed' || unit.status === 'failed-with-reason' ? `${unit.id} status=${unit.status}` : undefined))
    .find(Boolean);
  return executionFailure ? String(executionFailure).slice(0, 220) : undefined;
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

function buildAgentContext(
  input: SendAgentMessageInput,
  recentConversation: string[],
  artifactSummary: ReturnType<typeof summarizeArtifacts>,
  recentExecutionRefs: ReturnType<typeof summarizeExecutionRefs>,
) {
  const scenario = input.scenarioOverride;
  return {
    scenario: scenario ? {
      title: scenario.title,
      goal: scenario.description,
      markdownPreview: compactConversationContent(scenario.scenarioMarkdown),
      markdownChars: scenario.scenarioMarkdown.length,
    } : undefined,
    recentConversation,
    currentReferences: summarizeBioAgentReferences(input),
    artifacts: artifactSummary,
    recentExecutionRefs,
    workspacePersistence: workspacePersistenceSummary(input),
    notes: [
      'User prompt is carried separately as the authoritative request.',
      'Use this context only as supporting evidence for AgentServer-side intent reasoning.',
      'Do not let UI hints, scenario text, or historical requests override the current raw user prompt.',
    ],
  };
}

function toolEvent(type: string, detail: string): AgentStreamEvent {
  return {
    id: makeId('evt'),
    type,
    label: '项目工具',
    detail,
    createdAt: nowIso(),
    raw: { type, detail },
  };
}
