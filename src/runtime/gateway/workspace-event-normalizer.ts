import type {
  GatewayRequest,
  WorkspaceRuntimeEvent,
} from '../runtime-types.js';
import {
  compactCapabilityForAgentBackend,
  normalizeRuntimeWorkspaceCompactCapability,
  normalizeRuntimeWorkspaceContextWindowSource,
  runtimeAgentBackendCapabilities,
} from '@sciforge-ui/runtime-contract/agent-backend-policy';
import { isRecord, toStringList } from '../gateway-utils.js';
import { redactSecretText, retryAfterMsFromText } from './backend-failure-diagnostics.js';
import { collectWorkEvidenceFromBackendEvent } from './work-evidence-types.js';

const DEFAULT_WORKSPACE_EVENT_KIND = 'runtime-event';

export function normalizeAgentServerWorkspaceEvent(raw: unknown): WorkspaceRuntimeEvent {
  const record = isRecord(raw) ? raw : {};
  const rawType = typeof record.type === 'string' ? record.type : typeof record.kind === 'string' ? record.kind : DEFAULT_WORKSPACE_EVENT_KIND;
  const type = normalizeAgentServerWorkspaceEventType(rawType, record);
  const toolName = typeof record.toolName === 'string' ? record.toolName : undefined;
  const usage = normalizeWorkspaceTokenUsage(record.usage)
    ?? normalizeWorkspaceTokenUsage(isRecord(record.output) ? record.output.usage : undefined)
    ?? normalizeWorkspaceTokenUsage(isRecord(record.result) ? record.result.usage : undefined)
    ?? normalizeWorkspaceTokenUsage(isRecord(record.result) && isRecord(record.result.output) ? record.result.output.usage : undefined);
  const contextCompaction = normalizeWorkspaceContextCompaction(
    record.contextCompaction ?? record.compaction ?? record.context_compaction ?? record.context_compressor ?? record.contextCompressor,
    type,
    record,
  );
  const rateLimit = normalizeWorkspaceRateLimit(
    record.rateLimit ?? record.rate_limit ?? record.rateLimitDiagnostics ?? record.rate_limit_diagnostics ?? hermesCompatRateLimitRecord(record),
    record,
  );
  const workEvidence = collectWorkEvidenceFromBackendEvent(raw);
  const contextWindowState = normalizeWorkspaceContextWindowState(
    workspaceContextWindowCandidate(record),
    type,
    record,
  );
  const baseDetail = typeof record.detail === 'string'
    ? record.detail
    : typeof record.message === 'string'
      ? record.message
      : typeof record.text === 'string'
        ? record.text
        : typeof record.output === 'string'
          ? record.output.slice(0, 600)
          : Array.isArray(record.plan)
            ? record.plan.join(' -> ')
            : record.error !== undefined
              ? summarizeEventValue(record.error)
              : record.result !== undefined
                ? summarizeEventValue(record.result)
                : undefined;
  const usageDetail = formatWorkspaceTokenUsage(usage);
  const detail = [baseDetail, usageDetail].filter(Boolean).join(' | ') || undefined;
  return {
    type,
    source: 'agentserver',
    toolName,
    message: toolName ? `${type}: ${toolName}` : type,
    detail,
    text: typeof record.text === 'string' ? record.text : undefined,
    output: typeof record.output === 'string' ? record.output.slice(0, 2000) : undefined,
    usage,
    contextWindowState,
    contextCompaction,
    rateLimit,
    workEvidence: workEvidence.length ? workEvidence : undefined,
    raw,
  };
}

export function withRequestContextWindowLimit(event: WorkspaceRuntimeEvent, request: GatewayRequest): WorkspaceRuntimeEvent {
  const state = event.contextWindowState;
  const limit = request.maxContextWindowTokens;
  if (!state || state.windowTokens !== undefined || limit === undefined) return event;
  const ratio = state.usedTokens !== undefined ? state.usedTokens / limit : state.ratio;
  return {
    ...event,
    contextWindowState: {
      ...state,
      window: limit,
      windowTokens: limit,
      ratio,
      status: normalizeWorkspaceContextStatus(state.status, ratio, state.autoCompactThreshold),
    },
  };
}

export function normalizeAgentServerWorkspaceEventType(type: string, record: Record<string, unknown>) {
  const lower = type.toLowerCase();
  if (lower === 'text_delta' || lower === 'token_delta' || lower === 'content_delta') return 'text-delta';
  if (lower === 'context_compressor' || lower === 'context-compressor') return 'contextCompaction';
  if (lower === 'ratelimit' || lower === 'rate_limit' || lower === 'rate-limit') return 'rateLimit';
  if (lower.includes('context_compressor') || record.context_compressor || record.contextCompressor) return 'contextCompaction';
  if (lower.includes('rate-limit') || lower.includes('rate_limit') || record.rate_limit || record.rateLimit || record.rate_limit_reset || record.rate_limit_reset_at) return 'rateLimit';
  return type;
}

export function normalizeWorkspaceContextWindowState(
  value: unknown,
  type: string,
  fallback: Record<string, unknown>,
): WorkspaceRuntimeEvent['contextWindowState'] | undefined {
  const record = isRecord(value) ? value : type === 'contextWindowState' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const usage = isRecord(record.usage) ? record.usage : record;
  const input = firstFiniteNumber(record.input, record.inputTokens, record.prompt_tokens, usage.input, usage.inputTokens, usage.promptTokens, usage.prompt_tokens);
  const output = firstFiniteNumber(record.output, record.outputTokens, record.completion_tokens, usage.output, usage.outputTokens, usage.completionTokens, usage.completion_tokens);
  const cacheRead = firstFiniteNumber(record.cacheRead, record.cache_read, record.cacheReadTokens, usage.cacheRead, usage.cache_read, usage.cacheReadTokens);
  const cacheWrite = firstFiniteNumber(record.cacheWrite, record.cache_write, record.cacheWriteTokens, usage.cacheWrite, usage.cache_write, usage.cacheWriteTokens);
  const cache = firstFiniteNumber(record.cache, record.cacheTokens, record.cache_tokens, usage.cache, usage.cacheTokens, usage.cache_tokens)
    ?? (cacheRead !== undefined || cacheWrite !== undefined ? (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined);
  const usedTokens = finiteNumber(record.usedTokens)
    ?? finiteNumber(record.used_tokens)
    ?? finiteNumber(record.used)
    ?? finiteNumber(record.contextWindowTokens)
    ?? finiteNumber(record.context_window_tokens)
    ?? finiteNumber(record.currentContextWindowTokens)
    ?? finiteNumber(record.current_context_window_tokens)
    ?? finiteNumber(record.contextLength)
    ?? finiteNumber(record.context_length)
    ?? finiteNumber(record.currentContextLength)
    ?? finiteNumber(record.current_context_length)
    ?? finiteNumber(record.tokens);
  const windowTokens = finiteNumber(record.windowTokens)
    ?? finiteNumber(record.window_tokens)
    ?? finiteNumber(record.window)
    ?? finiteNumber(record.contextWindowLimit)
    ?? finiteNumber(record.context_window_limit)
    ?? finiteNumber(record.limit)
    ?? finiteNumber(record.contextWindow)
    ?? finiteNumber(record.maxContextLength)
    ?? finiteNumber(record.max_context_length)
    ?? finiteNumber(record.contextLimit)
    ?? finiteNumber(record.context_limit);
  const ratio = finiteNumber(record.ratio)
    ?? finiteNumber(record.contextWindowRatio)
    ?? finiteNumber(record.context_window_ratio)
    ?? finiteNumber(record.usageRatio)
    ?? finiteNumber(record.usage_ratio)
    ?? (usedTokens !== undefined && windowTokens ? usedTokens / windowTokens : undefined);
  const rawAutoCompactThreshold = finiteNumber(record.autoCompactThreshold)
    ?? finiteNumber(record.auto_compact_threshold)
    ?? finiteNumber(record.compressionThreshold)
    ?? finiteNumber(record.compression_threshold);
  const autoCompactThreshold = rawAutoCompactThreshold && rawAutoCompactThreshold > 1 && windowTokens
    ? rawAutoCompactThreshold / windowTokens
    : rawAutoCompactThreshold;
  const hasUsage = input !== undefined || output !== undefined || cache !== undefined || finiteNumber(usage.total) !== undefined;
  const hasContextTelemetry = usedTokens !== undefined || windowTokens !== undefined || ratio !== undefined;
  const explicitSource = stringField(record.source) ?? stringField(record.contextWindowSource) ?? stringField(record.context_window_source);
  const backend = stringField(record.backend) ?? stringField(fallback.backend) ?? stringField(usage.provider);
  const source = normalizeRuntimeWorkspaceContextWindowSource({
    value: explicitSource,
    backend,
    capabilities: backend ? runtimeAgentBackendCapabilities(backend) : undefined,
    hasContextWindowTelemetry: hasContextTelemetry,
    hasUsage,
  });
  const state = {
    backend,
    provider: stringField(record.provider) ?? stringField(usage.provider),
    model: stringField(record.model) ?? stringField(usage.model),
    usedTokens,
    input,
    output,
    cache,
    window: windowTokens,
    windowTokens,
    ratio,
    source,
    status: normalizeWorkspaceContextStatus(stringField(record.status), ratio, autoCompactThreshold),
    compactCapability: normalizeWorkspaceCompactCapability(stringField(record.compactCapability) ?? stringField(record.compactionCapability)),
    budget: isRecord(record.budget) ? record.budget : undefined,
    auditRefs: toStringList(record.auditRefs),
    autoCompactThreshold,
    watchThreshold: finiteNumber(record.watchThreshold),
    nearLimitThreshold: finiteNumber(record.nearLimitThreshold),
    lastCompactedAt: stringField(record.lastCompactedAt) ?? stringField(record.last_compacted_at) ?? stringField(record.lastCompressedAt) ?? stringField(record.last_compressed_at),
    pendingCompact: typeof record.pendingCompact === 'boolean' ? record.pendingCompact : undefined,
  };
  if (state.compactCapability === 'unknown' && state.backend) {
    state.compactCapability = normalizeRuntimeWorkspaceCompactCapability(compactCapabilityForAgentBackend(state.backend));
  }
  return hasContextTelemetry ? state : undefined;
}

export function normalizeWorkspaceContextCompaction(
  value: unknown,
  type: string,
  fallback: Record<string, unknown>,
): WorkspaceRuntimeEvent['contextCompaction'] | undefined {
  const record = isRecord(value) ? value : type === 'contextCompaction' && isRecord(fallback) ? fallback : undefined;
  if (!record) return undefined;
  const status = normalizeWorkspaceCompactionStatus(stringField(record.status) ?? stringField(record.result));
  const completedAt = stringField(record.completedAt) ?? stringField(record.completed_at) ?? stringField(record.compressedAt) ?? stringField(record.compressed_at);
  const lastCompactedAt = stringField(record.lastCompactedAt) ?? stringField(record.last_compacted_at) ?? stringField(record.lastCompressedAt) ?? stringField(record.last_compressed_at) ?? completedAt;
  return {
    status,
    source: normalizeRuntimeWorkspaceContextWindowSource({ value: stringField(record.source) ?? 'native' }),
    backend: stringField(record.backend) ?? stringField(fallback.backend) ?? 'hermes-agent',
    compactCapability: normalizeWorkspaceCompactCapability(stringField(record.compactCapability) ?? stringField(record.compactionCapability) ?? 'native'),
    startedAt: stringField(record.startedAt) ?? stringField(record.started_at),
    completedAt,
    lastCompactedAt,
    reason: stringField(record.reason) ?? stringField(record.trigger),
    message: stringField(record.message) ?? stringField(record.summary),
  };
}

export function normalizeWorkspaceRateLimit(
  value: unknown,
  fallback: Record<string, unknown>,
): WorkspaceRuntimeEvent['rateLimit'] | undefined {
  const record = isRecord(value) ? value : {};
  const rateLimit = {
    limited: typeof record.limited === 'boolean'
      ? record.limited
      : typeof record.rate_limited === 'boolean'
        ? record.rate_limited
        : undefined,
    retryAfterMs: finiteNumber(record.retryAfterMs) ?? finiteNumber(record.retry_after_ms) ?? retryAfterMsFromText(JSON.stringify(record)),
    resetAt: stringField(record.resetAt)
      ?? stringField(record.reset_at)
      ?? stringField(record.rateLimitResetAt)
      ?? stringField(record.rate_limit_reset_at)
      ?? stringField(record.rate_limit_reset)
      ?? stringField(fallback.rate_limit_reset_at)
      ?? stringField(fallback.rate_limit_reset),
    provider: stringField(record.provider) ?? stringField(fallback.provider),
    model: stringField(record.model) ?? stringField(fallback.model),
    backend: stringField(record.backend) ?? stringField(fallback.backend),
    source: stringField(record.source) ?? 'agentserver',
  };
  return rateLimit.limited !== undefined || rateLimit.retryAfterMs !== undefined || rateLimit.resetAt ? rateLimit : undefined;
}

export function normalizeWorkspaceTokenUsage(value: unknown): WorkspaceRuntimeEvent['usage'] | undefined {
  if (!isRecord(value)) return undefined;
  const usage = {
    input: finiteNumber(value.input),
    output: finiteNumber(value.output),
    total: finiteNumber(value.total),
    cacheRead: finiteNumber(value.cacheRead),
    cacheWrite: finiteNumber(value.cacheWrite),
    provider: stringField(value.provider),
    model: stringField(value.model),
    source: stringField(value.source),
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

export type WorkspaceProcessProgressPhase = 'read' | 'write' | 'execute' | 'wait' | 'plan' | 'complete' | 'error' | 'observe';

export interface WorkspaceProcessProgressStep {
  id: string;
  phase: WorkspaceProcessProgressPhase;
  title: string;
  detail: string;
  reading: string[];
  writing: string[];
  waitingFor?: string;
  nextStep?: string;
  lastEvent?: Record<string, string>;
  reason?: string;
  recoveryHint?: string;
  canAbort?: boolean;
  canContinue?: boolean;
  sourceEventType?: string;
  status: string;
}

export interface WorkspaceProcessProgressSummary {
  schemaVersion: 'sciforge.process-events.v1';
  current: Record<string, unknown> | null;
  summary: string;
  timeline: Array<Record<string, unknown>>;
  events: Array<WorkspaceRuntimeEvent & {
    label: string;
    progress: Record<string, unknown>;
    raw: Record<string, unknown>;
  }>;
}

const processPathPattern = /(?<path>(?:\/|\.?\/)?(?:[\w.@-]+\/)+[\w.@-]+\.(?:py|ts|tsx|js|json|md|csv|tsv|txt|log|pdf|r|R|sh|yaml|yml))/g;

export function normalizeWorkspaceProcessEvents(rawEvents: unknown): WorkspaceProcessProgressSummary {
  const events = workspaceProcessEventList(rawEvents);
  const steps: WorkspaceProcessProgressStep[] = [];
  const seen = new Set<string>();
  events.forEach((raw, index) => {
    const step = summarizeWorkspaceProcessEvent(raw, index);
    if (!step) return;
    const key = `${step.phase}\0${step.title}\0${step.detail}`;
    if (seen.has(key)) return;
    seen.add(key);
    steps.push(step);
  });

  const current = currentWorkspaceProcessProgress(steps);
  return {
    schemaVersion: 'sciforge.process-events.v1',
    current: current ? workspaceProcessProgressPayload(current) : null,
    summary: workspaceProcessSummary(steps, current),
    timeline: steps.map(workspaceProcessRawStep),
    events: steps.map(workspaceProcessProgressEvent),
  };
}

export function summarizeWorkspaceProcessEvent(raw: Record<string, unknown>, index = 0): WorkspaceProcessProgressStep | undefined {
  const eventType = processText(raw.type) ?? processText(raw.kind) ?? 'event';
  const status = processText(raw.status) ?? 'running';
  const toolName = processText(raw.toolName) ?? processText(raw.tool_name) ?? '';
  const detail = processFirstText(raw, 'detail', 'message', 'text', 'output', 'error') ?? safeProcessJson(raw);
  const haystack = [eventType, status, toolName, detail].filter(Boolean).join('\n');
  const paths = processPathsFrom(raw, detail);
  const lower = haystack.toLowerCase();

  if (looksLikeBackendWaiting(raw, lower)) {
    return backendWaitingProcessStep(raw, index, eventType, status, detail);
  }

  if (looksLikeProcessFailure(lower)) {
    return processStep(index, 'error', '遇到阻断', trimProcessText(detail || '后端返回失败事件。'), { sourceEventType: eventType, status: 'failed' });
  }

  if (looksLikeProcessPlan(lower) && ['stage-start', 'current-plan', 'plan'].includes(eventType)) {
    return processStep(index, 'plan', '正在规划下一步', trimProcessText(detail || '正在整理计划。'), {
      nextStep: detail ? trimProcessText(detail, 180) : '生成可执行计划。',
      sourceEventType: eventType,
      status,
    });
  }

  if (looksLikeProcessWrite(lower, toolName)) {
    const target = pickProcessPath(paths, raw, ['path', 'outputRef', 'output_ref', 'artifactRef', 'artifact_ref']);
    const title = target ? `正在写入 ${target}` : '正在写入工作文件';
    return processStep(index, 'write', title, trimProcessText(detail || title), {
      writing: target ? [target] : paths.slice(0, 3),
      nextStep: '写入完成后执行或校验生成内容。',
      sourceEventType: eventType,
      status,
    });
  }

  if (looksLikeProcessRead(lower, toolName)) {
    const target = pickProcessPath(paths, raw, ['path', 'inputRef', 'input_ref', 'stdoutRef', 'stderrRef', 'outputRef']);
    const title = target ? `正在读取 ${target}` : '正在读取上下文或文件';
    return processStep(index, 'read', title, trimProcessText(detail || title), {
      reading: target ? [target] : paths.slice(0, 3),
      nextStep: '读取完成后归纳证据并决定下一步。',
      sourceEventType: eventType,
      status,
    });
  }

  if (looksLikeProcessWait(lower)) {
    const waitingFor = processWaitingTarget(detail, lower);
    return processStep(index, 'wait', `正在等待 ${waitingFor}`, trimProcessText(detail || `等待 ${waitingFor} 返回。`), {
      waitingFor,
      nextStep: '收到新事件后继续执行，若超时会给出恢复建议。',
      sourceEventType: eventType,
      status,
    });
  }

  if (looksLikeProcessExecute(lower, toolName)) {
    const command = trimProcessText(processFirstText(raw, 'command', 'cmd') ?? detail ?? toolName ?? 'workspace task', 180);
    return processStep(index, 'execute', `正在执行 ${command}`, trimProcessText(detail || command), {
      reading: paths.slice(0, 2),
      nextStep: '执行完成后读取 stdout/stderr 和产物。',
      sourceEventType: eventType,
      status,
    });
  }

  if (looksLikeProcessComplete(lower)) {
    return processStep(index, 'complete', '阶段完成', trimProcessText(detail || '当前阶段已完成。'), { sourceEventType: eventType, status: 'completed' });
  }

  if (looksLikeProcessPlan(lower)) {
    return processStep(index, 'plan', '正在规划下一步', trimProcessText(detail || '正在整理计划。'), {
      nextStep: detail ? trimProcessText(detail, 180) : '生成可执行计划。',
      sourceEventType: eventType,
      status,
    });
  }

  if (detail && detail.length <= 360) {
    return processStep(index, 'observe', '正在观察后端状态', trimProcessText(detail), { sourceEventType: eventType, status });
  }
  return undefined;
}

function workspaceContextWindowCandidate(record: Record<string, unknown>): unknown {
  return record.contextWindowState
    ?? record.contextWindow
    ?? record.context_window
    ?? record.context_compressor
    ?? record.contextCompressor
    ?? (isExplicitWorkspaceContextWindowRecord(record.usage) ? record.usage : undefined);
}

function workspaceProcessEventList(rawEvents: unknown): Array<Record<string, unknown>> {
  if (isRecord(rawEvents)) {
    return Array.isArray(rawEvents.events)
      ? rawEvents.events.filter(isRecord)
      : [rawEvents];
  }
  return Array.isArray(rawEvents) ? rawEvents.filter(isRecord) : [];
}

function processStep(
  index: number,
  phase: WorkspaceProcessProgressPhase,
  title: string,
  detail: string,
  options: {
    reading?: string[];
    writing?: string[];
    waitingFor?: string;
    nextStep?: string;
    lastEvent?: unknown;
    reason?: string;
    recoveryHint?: string;
    canAbort?: boolean;
    canContinue?: boolean;
    sourceEventType?: string;
    status?: string;
  } = {},
): WorkspaceProcessProgressStep {
  return {
    id: `process-${String(index).padStart(4, '0')}-${phase}`,
    phase,
    title: trimProcessText(title, 160),
    detail: trimProcessText(detail),
    reading: uniqueProcessStrings(options.reading ?? []),
    writing: uniqueProcessStrings(options.writing ?? []),
    waitingFor: options.waitingFor,
    nextStep: options.nextStep,
    lastEvent: lastProcessEventSummary(options.lastEvent),
    reason: options.reason,
    recoveryHint: options.recoveryHint,
    canAbort: options.canAbort,
    canContinue: options.canContinue,
    sourceEventType: options.sourceEventType,
    status: processStatus(options.status ?? 'running', phase),
  };
}

function backendWaitingProcessStep(raw: Record<string, unknown>, index: number, eventType: string, status: string, detail: string): WorkspaceProcessProgressStep {
  const elapsedMs = processNumber(raw.elapsedMs) ?? processNumber(raw.elapsed_ms);
  const lastEvent = isRecord(raw.lastEvent) ? raw.lastEvent : raw.last_event;
  const elapsedText = elapsedMs !== undefined ? `已 ${Math.trunc(elapsedMs / 1000)}s 没有收到新事件` : '长时间没有收到新事件';
  const last = lastProcessEventSummary(isRecord(lastEvent) ? lastEvent : undefined);
  const lastText = last ? `最近事件：${last.label} - ${last.detail}` : '还没有可展示的后端事件。';
  const waitingFor = backendWaitingTarget(detail, `${eventType} ${detail}`.toLowerCase());
  return processStep(index, 'wait', `正在等待 ${waitingFor}`, trimProcessText(detail || `HTTP stream 仍在等待；${elapsedText}。${lastText}`), {
    waitingFor,
    nextStep: '收到新事件后继续执行；也可以安全中止当前 stream 或继续补充指令排队。',
    lastEvent: isRecord(lastEvent) ? lastEvent : undefined,
    reason: 'backend-waiting',
    recoveryHint: '保留最近真实事件和等待原因，下一轮可基于这些线索继续或恢复。',
    canAbort: true,
    canContinue: true,
    sourceEventType: eventType,
    status,
  });
}

function currentWorkspaceProcessProgress(steps: WorkspaceProcessProgressStep[]) {
  for (let index = steps.length - 1; index >= 0; index -= 1) {
    const step = steps[index];
    if (step.phase !== 'error' && step.status !== 'completed') return step;
  }
  return steps.length ? steps[steps.length - 1] : undefined;
}

function workspaceProcessSummary(steps: WorkspaceProcessProgressStep[], current: WorkspaceProcessProgressStep | undefined) {
  if (!current) return '还没有收到可归纳的过程事件。';
  const parts = [current.title];
  if (current.reading.length) parts.push(`读：${current.reading.slice(0, 2).join(', ')}`);
  if (current.writing.length) parts.push(`写：${current.writing.slice(0, 2).join(', ')}`);
  if (current.waitingFor) parts.push(`等待：${current.waitingFor}`);
  if (current.nextStep) parts.push(`下一步：${current.nextStep}`);
  return parts.join('；');
}

function workspaceProcessProgressEvent(step: WorkspaceProcessProgressStep): WorkspaceProcessProgressSummary['events'][number] {
  return {
    type: 'process-progress',
    label: labelForProcessPhase(step.phase),
    status: step.status,
    message: step.title,
    detail: step.detail,
    progress: workspaceProcessProgressPayload(step),
    raw: workspaceProcessRawStep(step),
  };
}

function workspaceProcessProgressPayload(step: WorkspaceProcessProgressStep): Record<string, unknown> {
  return compactProcessRecord({
    phase: step.phase,
    title: step.title,
    detail: step.detail,
    reading: step.reading,
    writing: step.writing,
    waitingFor: step.waitingFor,
    nextStep: step.nextStep,
    lastEvent: step.lastEvent,
    reason: step.reason,
    recoveryHint: step.recoveryHint,
    canAbort: step.canAbort,
    canContinue: step.canContinue,
    status: step.status,
  });
}

function workspaceProcessRawStep(step: WorkspaceProcessProgressStep): Record<string, unknown> {
  return compactProcessRecord({
    id: step.id,
    phase: step.phase,
    title: step.title,
    detail: step.detail,
    reading: step.reading,
    writing: step.writing,
    waiting_for: step.waitingFor,
    next_step: step.nextStep,
    last_event: step.lastEvent,
    reason: step.reason,
    recovery_hint: step.recoveryHint,
    can_abort: step.canAbort,
    can_continue: step.canContinue,
    source_event_type: step.sourceEventType,
    status: step.status,
  });
}

function processPathsFrom(raw: Record<string, unknown>, detail: string): string[] {
  const values: string[] = [];
  for (const key of ['path', 'inputRef', 'input_ref', 'outputRef', 'output_ref', 'stdoutRef', 'stderrRef', 'artifactRef', 'artifact_ref']) {
    const value = processText(raw[key]);
    if (value) values.push(value);
  }
  for (const match of detail.matchAll(processPathPattern)) {
    const path = match.groups?.path;
    if (path) values.push(path);
  }
  if (isRecord(raw.raw)) values.push(...processPathsFrom(raw.raw, safeProcessJson(raw.raw)));
  return uniqueProcessStrings(values);
}

function pickProcessPath(paths: string[], raw: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = processText(raw[key]);
    if (value) return value;
  }
  return paths[0];
}

function processFirstText(raw: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = processText(raw[key]);
    if (value) return value;
  }
  return undefined;
}

function processText(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function safeProcessJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function trimProcessText(value: string, limit = 900) {
  const normalized = value.replace(/\\n/g, '\n').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  return normalized.length <= limit ? normalized : `${normalized.slice(0, limit - 32).trimEnd()} ... ${normalized.slice(-24)}`;
}

function uniqueProcessStrings(values: Iterable<string>) {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const clean = value.trim();
    if (!clean || seen.has(clean)) continue;
    seen.add(clean);
    out.push(clean);
  }
  return out;
}

function processStatus(value: string, phase: WorkspaceProcessProgressPhase) {
  const lowered = value.toLowerCase();
  if (phase === 'error' || lowered.includes('fail') || lowered.includes('error')) return 'failed';
  if (phase === 'complete' || ['done', 'completed', 'success', 'succeeded'].includes(lowered)) return 'completed';
  return 'running';
}

function processNumber(value: unknown) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : undefined;
  }
  return undefined;
}

function lastProcessEventSummary(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const label = processText(value.label) ?? processText(value.type) ?? '事件';
  const detail = processFirstText(value, 'detail', 'message', 'text', 'output') ?? '';
  const createdAt = processText(value.createdAt) ?? processText(value.created_at);
  const summary: Record<string, string> = {
    label: trimProcessText(label, 80),
    detail: trimProcessText(detail || label, 180),
  };
  if (createdAt) summary.createdAt = createdAt;
  return summary;
}

function labelForProcessPhase(phase: WorkspaceProcessProgressPhase) {
  return {
    read: '读取',
    write: '写入',
    execute: '执行',
    wait: '等待',
    plan: '下一步',
    complete: '完成',
    error: '阻断',
    observe: '状态',
  }[phase];
}

function looksLikeProcessFailure(lower: string) {
  return /\b(error|failed|exception|traceback|timeout|interrupt)\b|失败|报错|中断/.test(lower);
}

function looksLikeProcessWrite(lower: string, toolName: string) {
  return toolName.toLowerCase().includes('write_file') || /write_file|wrote \d+ bytes|writing|write|保存|写入|生成.*(?:文件|脚本|artifact)/.test(lower);
}

function looksLikeProcessRead(lower: string, toolName: string) {
  return toolName.toLowerCase().includes('read_file') || /read_file|reading|read |cat |sed |rg |grep |open|读取|正在读/.test(lower);
}

function looksLikeProcessWait(lower: string) {
  return /silent|waiting|wait |rate.?limit|retry|poll|pending|等待|排队|配额/.test(lower);
}

function looksLikeBackendWaiting(raw: Record<string, unknown>, lower: string) {
  const eventType = (processText(raw.type) ?? processText(raw.kind) ?? '').toLowerCase();
  if (['backend-waiting', 'backend-silent', 'silent-stream-wait', 'process-waiting'].includes(eventType)) return true;
  return lower.includes('http stream') && /still waiting|仍在等待|没有.*新事件|no new events?/.test(lower);
}

function looksLikeProcessExecute(lower: string, toolName: string) {
  return toolName.toLowerCase().includes('run_command') || /run_command|execute|executing|python3?|pytest|npm |tsx|bash|workspace task|执行|运行/.test(lower);
}

function looksLikeProcessComplete(lower: string) {
  return /\b(done|completed|success|succeeded)\b|完成|成功/.test(lower);
}

function looksLikeProcessPlan(lower: string) {
  return /plan|next step|stage-start|current-plan|规划|计划|下一步/.test(lower);
}

function processWaitingTarget(detail: string, lower: string) {
  if (lower.includes('rate') || lower.includes('配额')) return 'provider 配额或 retry budget';
  if (lower.includes('agentserver')) return 'AgentServer 返回';
  if (lower.includes('workspace')) return 'workspace task 返回';
  const match = detail.match(/waiting(?: for)? ([^.;。]+)/i);
  return match?.[1] ? trimProcessText(match[1], 80) : '后端返回新事件';
}

function backendWaitingTarget(detail: string, lower: string) {
  if (lower.includes('rate') || lower.includes('配额')) return 'provider 配额或 retry budget';
  if (lower.includes('agentserver')) return 'AgentServer 返回';
  if (lower.includes('workspace')) return 'workspace task 返回';
  return '后端返回新事件';
}

function compactProcessRecord(record: Record<string, unknown>) {
  return Object.fromEntries(Object.entries(record).filter(([, value]) => {
    if (value === undefined || value === null || value === '' || value === false) return false;
    if (Array.isArray(value) && value.length === 0) return false;
    return true;
  }));
}

function isExplicitWorkspaceContextWindowRecord(value: unknown): value is Record<string, unknown> {
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

function hermesCompatRateLimitRecord(data: Record<string, unknown>): Record<string, unknown> {
  const hermes = firstRecord(data.hermes, data.hermesAgent, data.hermes_agent, data.compat, data.supervisorCompat, data.supervisor_compat);
  const event = firstRecord(data.event, data.payload, data.data);
  return firstRecord(
    data.rate_limit,
    data.rateLimit,
    data.rateLimitDiagnostics,
    data.rate_limit_diagnostics,
    hermes.rate_limit,
    hermes.rateLimit,
    event.rate_limit,
    event.rateLimit,
    event.rateLimitDiagnostics,
    event.rate_limit_diagnostics,
    data.rate_limit_reset || data.rate_limit_reset_at || data.retry_after_ms ? data : undefined,
    event.rate_limit_reset || event.rate_limit_reset_at || event.retry_after_ms ? event : undefined,
  );
}

function normalizeWorkspaceCompactionStatus(value?: string): NonNullable<WorkspaceRuntimeEvent['contextCompaction']>['status'] {
  if (value === 'started' || value === 'completed' || value === 'failed' || value === 'pending' || value === 'skipped') return value;
  if (value && /fail|error/i.test(value)) return 'failed';
  if (value && /start|running|compact/i.test(value) && !/complete|done|success|compressed/i.test(value)) return 'started';
  if (value && /skip|unsupported/i.test(value)) return 'skipped';
  if (value && /complete|done|success|compressed/i.test(value)) return 'completed';
  return 'completed';
}

function normalizeWorkspaceCompactCapability(value?: string): NonNullable<WorkspaceRuntimeEvent['contextWindowState']>['compactCapability'] {
  return normalizeRuntimeWorkspaceCompactCapability(value);
}

function normalizeWorkspaceContextStatus(
  value: string | undefined,
  ratio: number | undefined,
  autoCompactThreshold: number | undefined,
): NonNullable<WorkspaceRuntimeEvent['contextWindowState']>['status'] {
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

function formatWorkspaceTokenUsage(usage: WorkspaceRuntimeEvent['usage'] | undefined) {
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

function summarizeEventValue(value: unknown) {
  if (typeof value === 'string') return value.slice(0, 1200);
  try {
    return JSON.stringify(redactSecrets(value)).slice(0, 1200);
  } catch {
    return String(value).slice(0, 1200);
  }
}

function redactSecrets(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (!isRecord(value)) return typeof value === 'string' ? redactSecretText(value) : value;
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (/api[-_]?key|token|authorization|secret|password|credential/i.test(key)) {
      out[key] = entry ? '[redacted]' : entry;
      continue;
    }
    out[key] = redactSecrets(entry);
  }
  return out;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstFiniteNumber(...values: unknown[]) {
  return values.map(finiteNumber).find((value): value is number => value !== undefined);
}

function firstRecord(...values: unknown[]) {
  return values.find(isRecord) ?? {};
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
