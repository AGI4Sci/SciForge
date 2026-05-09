import type { AgentBackendAdapter, AgentBackendCapabilities, BackendContextCompactionResult, BackendContextWindowState, GatewayRequest, WorkspaceRuntimeCallbacks, WorkspaceRuntimeContextBudget, WorkspaceRuntimeContextCompaction, WorkspaceRuntimeEvent } from '../runtime-types.js';
import {
  compactCapabilityForAgentBackend,
  estimateRuntimeAgentBackendModelContextWindow,
  normalizeRuntimeAgentBackendContextWindowSource,
  runtimeAgentBackendCapabilities,
  runtimeAgentBackendProviderLabel,
} from '@sciforge-ui/runtime-contract/agent-backend-policy';
import { emitWorkspaceRuntimeEvent } from '../workspace-runtime-events.js';
import { sha1 } from '../workspace-task-runner.js';
import { clipForAgentServerJson, clipForAgentServerPrompt, errorMessage, isRecord, toRecordList } from '../gateway-utils.js';
import { retryAfterMsFromText } from './backend-failure-diagnostics.js';

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function finiteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function firstFiniteNumber(...values: unknown[]) {
  for (const value of values) {
    const parsed = finiteNumber(value);
    if (parsed !== undefined) return parsed;
  }
  return undefined;
}

function agentBackendCapabilities(backend: string): AgentBackendCapabilities {
  return runtimeAgentBackendCapabilities(backend);
}

export async function preflightAgentServerContextWindow(params: {
  adapter: AgentBackendAdapter;
  baseUrl: string;
  workspace: string;
  agentId: string;
  callbacks?: WorkspaceRuntimeCallbacks;
}) {
  const sessionRef = {
    agentId: params.agentId,
    workspace: params.workspace,
    baseUrl: params.baseUrl,
  };
  const state = await params.adapter.readContextWindowState?.(sessionRef);
  if (state) {
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'agentserver-context-window-state',
      source: 'workspace-runtime',
      status: state.status,
      message: `AgentServer context window ${state.status}`,
      detail: formatContextWindowState(state),
      contextWindowState: workspaceContextWindowStateFromBackend(state),
      raw: state,
    });
  }
  if (!state || !contextWindowNeedsCompaction(state)) {
    return { state, forceSlimHandoff: false };
  }
  const reason = `preflight:${state.status}:${formatContextWindowState(state)}`;
  const compaction = await params.adapter.compactContext?.(sessionRef, reason);
  if (compaction) {
    const compactionStatus = compaction.status === 'unsupported' || compaction.status === 'skipped'
      ? 'skipped'
      : compaction.ok ? 'completed' : 'failed';
    emitWorkspaceRuntimeEvent(params.callbacks, {
      type: 'contextCompaction',
      source: 'workspace-runtime',
      status: compactionStatus,
      message: `AgentServer context compaction ${compaction.strategy}`,
      detail: compaction.message || compaction.reason,
      contextCompaction: contextCompactionMetadata(compaction),
      contextWindowState: compaction.after ? workspaceContextWindowStateFromBackend(compaction.after) : undefined,
      raw: compaction,
    });
  }
  const after = compaction?.after ?? state;
  return {
    state: after,
    compaction,
    forceSlimHandoff: !compaction?.ok || compaction.strategy === 'handoff-slimming' || compaction.strategy === 'session-rotate',
  };
}

export async function readBackendContextWindowState(
  sessionRef: { agentId: string; workspace: string; baseUrl: string },
  backend: string,
  capabilities: AgentBackendCapabilities,
): Promise<BackendContextWindowState | undefined> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${sessionRef.baseUrl}/api/agent-server/agents/${encodeURIComponent(sessionRef.agentId)}/context`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) return fallbackContextWindowState(sessionRef.agentId, backend, capabilities);
    const json = await response.json() as unknown;
    const data = isRecord(json) && isRecord(json.data) ? json.data : json;
    if (!isRecord(data)) return fallbackContextWindowState(sessionRef.agentId, backend, capabilities);
    const snapshot = compactAgentServerCoreSnapshot(data);
    return normalizeBackendContextWindowState(data, snapshot, sessionRef.agentId, backend, capabilities);
  } catch {
    return fallbackContextWindowState(sessionRef.agentId, backend, capabilities);
  } finally {
    clearTimeout(timeout);
  }
}

export async function compactBackendContext(
  sessionRef: { agentId: string; workspace: string; baseUrl: string },
  backend: string,
  capabilities: AgentBackendCapabilities,
  reason: string,
): Promise<BackendContextCompactionResult> {
  const before = await readBackendContextWindowState(sessionRef, backend, capabilities);
  const managedByAgentServer = isAgentServerManagedCompactionBackend(backend);
  if (!capabilities.nativeCompaction) {
    const agentServerCompaction = await requestAgentServerCompact(sessionRef, backend, reason, before);
    if (agentServerCompaction.ok) return agentServerCompaction;
    if (managedByAgentServer) {
      return {
        ok: false,
        status: agentServerCompaction.status === 'unsupported' ? 'unsupported' : 'failed',
        backend,
        agentId: sessionRef.agentId,
        strategy: 'agentserver',
        reason,
        before,
        after: markAgentServerManagedFallbackState(before, sessionRef.agentId, backend),
        message: agentServerCompaction.message || 'AgentServer session/current-work compaction was unavailable for this managed backend.',
        auditRefs: agentServerCompaction.auditRefs,
      };
    }
    return {
      ok: false,
      status: agentServerCompaction.status === 'unsupported' ? 'unsupported' : 'skipped',
      backend,
      agentId: sessionRef.agentId,
      strategy: backend === 'gemini' && capabilities.sessionRotationSafe ? 'session-rotate' : capabilities.sessionRotationSafe ? 'handoff-slimming' : 'none',
      reason,
      before,
      after: markHandoffSlimmingState(before, sessionRef.agentId, backend),
      message: agentServerCompaction.message || (backend === 'gemini'
        ? 'Gemini SDK/API has no native compaction/reset; using AgentServer context compaction and session rotation fallback.'
        : 'Backend has no native compaction; using compact handoff refs for this turn.'),
      auditRefs: agentServerCompaction.auditRefs,
    };
  }
  const native = await requestAgentServerCompact(sessionRef, backend, reason, before);
  if (native.ok) return native;
  return {
    ok: false,
    status: native.status === 'unsupported' ? 'unsupported' : 'skipped',
    backend,
    agentId: sessionRef.agentId,
    strategy: 'handoff-slimming',
    reason,
    before,
    after: markHandoffSlimmingState(before, sessionRef.agentId, backend),
    message: native.message || 'Native compaction was unavailable; using compact handoff refs for this turn.',
    auditRefs: native.auditRefs,
  };
}

async function requestAgentServerCompact(
  sessionRef: { agentId: string; workspace: string; baseUrl: string },
  backend: string,
  reason: string,
  before: BackendContextWindowState | undefined,
): Promise<BackendContextCompactionResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${sessionRef.baseUrl}/api/agent-server/agents/${encodeURIComponent(sessionRef.agentId)}/compact`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      signal: controller.signal,
      body: JSON.stringify({
        reason,
        backend,
        workspace: sessionRef.workspace,
        compactionScope: isAgentServerManagedCompactionBackend(backend) ? 'session-current-work' : 'backend-context',
        strategy: isAgentServerManagedCompactionBackend(backend) ? 'agentserver-session-current-work' : undefined,
        contextWindow: before ? contextWindowMetadata(before) : undefined,
      }),
    });
    const text = await response.text();
    let json: unknown = text;
    try {
      json = JSON.parse(text);
    } catch {
      // Compact endpoints may be absent or plain-text in older AgentServer builds.
    }
    if (!response.ok) {
      const compactStatus = response.status === 404 || response.status === 405 || response.status === 501
        ? 'unsupported'
        : 'failed';
      return {
        ok: false,
        status: compactStatus,
        backend,
        agentId: sessionRef.agentId,
        strategy: 'agentserver',
        reason,
        before,
        message: isRecord(json) ? String(json.error || json.message || '') : String(text).slice(0, 500),
        auditRefs: [
          `agentserver:${sessionRef.agentId}:compact:${response.status}`,
          `${sessionRef.baseUrl}/api/agent-server/agents/${encodeURIComponent(sessionRef.agentId)}/compact`,
        ],
      };
    }
    const data = isRecord(json) && isRecord(json.data) ? json.data : isRecord(json) ? json : {};
    const stateData = isRecord(data.state) ? data.state : isRecord(data.contextWindowState) ? data.contextWindowState : data;
    const after = normalizeBackendContextWindowState(stateData, before?.snapshot, sessionRef.agentId, backend, agentBackendCapabilities(backend));
    return {
      ok: true,
      status: 'compacted',
      backend,
      agentId: sessionRef.agentId,
      strategy: before?.compactCapability === 'native' ? 'native' : 'agentserver',
      reason,
      before,
      after,
      runId: stringField(data.runId) ?? stringField(data.id),
      message: stringField(data.message) ?? 'Context compacted before dispatch.',
    };
  } catch (error) {
    return {
      ok: false,
      status: 'failed',
      backend,
      agentId: sessionRef.agentId,
      strategy: 'agentserver',
      reason,
      before,
      message: errorMessage(error),
      auditRefs: [`agentserver:${sessionRef.agentId}:compact:error`],
    };
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeBackendContextWindowState(
  data: Record<string, unknown>,
  snapshot: Record<string, unknown> | undefined,
  agentId: string,
  backend: string,
  capabilities: AgentBackendCapabilities,
): BackendContextWindowState {
  const hermesCompat = backend === 'hermes-agent' ? hermesCompatContextRecord(data) : {};
  const contextWindow = firstRecord(data.contextWindow, data.contextWindowState, hermesCompat);
  const usage = firstRecord(data.usage, data.tokenUsage, contextWindow.usage, hermesCompat);
  const workBudget = isRecord(data.workBudget) ? data.workBudget : {};
  const input = firstFiniteNumber(usage.input, usage.inputTokens, usage.promptTokens, usage.prompt_tokens, contextWindow.input, contextWindow.inputTokens, contextWindow.prompt_tokens);
  const output = firstFiniteNumber(usage.output, usage.outputTokens, usage.completionTokens, usage.completion_tokens, contextWindow.output, contextWindow.outputTokens, contextWindow.completion_tokens);
  const cacheRead = firstFiniteNumber(usage.cacheRead, usage.cache_read, usage.cacheReadTokens, contextWindow.cacheRead, contextWindow.cache_read, contextWindow.cacheReadTokens);
  const cacheWrite = firstFiniteNumber(usage.cacheWrite, usage.cache_write, usage.cacheWriteTokens, contextWindow.cacheWrite, contextWindow.cache_write, contextWindow.cacheWriteTokens);
  const cache = firstFiniteNumber(usage.cache, usage.cacheTokens, usage.cache_tokens, contextWindow.cache, contextWindow.cacheTokens, contextWindow.cache_tokens)
    ?? (cacheRead !== undefined || cacheWrite !== undefined ? (cacheRead ?? 0) + (cacheWrite ?? 0) : undefined);
  const tokens = finiteNumber(contextWindow.tokens)
    ?? finiteNumber(contextWindow.usedTokens)
    ?? finiteNumber(contextWindow.used_tokens)
    ?? finiteNumber(contextWindow.contextWindowTokens)
    ?? finiteNumber(contextWindow.context_window_tokens)
    ?? finiteNumber(contextWindow.contextLength)
    ?? finiteNumber(contextWindow.context_length)
    ?? finiteNumber(contextWindow.currentContextLength)
    ?? finiteNumber(contextWindow.current_context_length)
    ?? finiteNumber(workBudget.approxCurrentWorkTokens);
  const limit = finiteNumber(contextWindow.limit)
    ?? finiteNumber(contextWindow.window)
    ?? finiteNumber(contextWindow.windowTokens)
    ?? finiteNumber(contextWindow.window_tokens)
    ?? finiteNumber(contextWindow.contextWindowLimit)
    ?? finiteNumber(contextWindow.context_window_limit)
    ?? finiteNumber(contextWindow.modelContextWindow)
    ?? finiteNumber(contextWindow.model_context_window)
    ?? finiteNumber(contextWindow.maxContextLength)
    ?? finiteNumber(contextWindow.max_context_length)
    ?? finiteNumber(contextWindow.contextLimit)
    ?? finiteNumber(contextWindow.context_limit)
    ?? finiteNumber(data.maxContextWindowTokens)
    ?? finiteNumber(data.max_context_window_tokens)
    ?? finiteNumber(snapshot?.maxContextWindowTokens)
    ?? finiteNumber(snapshot?.max_context_window_tokens)
    ?? finiteNumber(workBudget.contextWindowLimit);
  const ratio = finiteNumber(contextWindow.ratio)
    ?? finiteNumber(contextWindow.contextWindowRatio)
    ?? finiteNumber(contextWindow.context_window_ratio)
    ?? finiteNumber(contextWindow.usageRatio)
    ?? finiteNumber(contextWindow.usage_ratio)
    ?? (tokens !== undefined && limit ? tokens / limit : undefined);
  const rawAutoCompactThreshold = finiteNumber(contextWindow.autoCompactThreshold)
    ?? finiteNumber(contextWindow.auto_compact_threshold)
    ?? finiteNumber(contextWindow.compressionThreshold)
    ?? finiteNumber(contextWindow.compression_threshold)
    ?? finiteNumber(contextWindow.modelAutoCompactTokenLimit)
    ?? (limit && finiteNumber(workBudget.autoCompactTokenLimit) ? finiteNumber(workBudget.autoCompactTokenLimit)! / limit : undefined);
  const autoCompactThreshold = rawAutoCompactThreshold && rawAutoCompactThreshold > 1 && limit
    ? rawAutoCompactThreshold / limit
    : rawAutoCompactThreshold ?? 0.82;
  const rawStatus = stringField(contextWindow.status) ?? stringField(workBudget.status);
  const status = normalizeContextWindowStatus(rawStatus, ratio, autoCompactThreshold);
  const provider = stringField(contextWindow.provider) ?? stringField(usage.provider) ?? runtimeAgentBackendProviderLabel(backend);
  const model = stringField(contextWindow.model) ?? stringField(usage.model) ?? stringField(data.model) ?? stringField(data.modelName);
  const source = normalizeRuntimeAgentBackendContextWindowSource({
    value: stringField(contextWindow.source) ?? stringField(usage.source) ?? stringField(data.source),
    backend,
    capabilities,
    hasContextWindowTelemetry: Boolean(tokens !== undefined || limit !== undefined || ratio !== undefined),
    hasUsage: Boolean(input !== undefined || output !== undefined || cache !== undefined || finiteNumber(usage.total) !== undefined),
  });
  return {
    backend,
    agentId,
    provider,
    model,
    usedTokens: tokens,
    input,
    output,
    cache,
    window: limit,
    ratio,
    source,
    status,
    contextWindowTokens: tokens,
    contextWindowLimit: limit,
    contextWindowRatio: ratio,
    autoCompactThreshold,
    lastCompactedAt: stringField(contextWindow.lastCompactedAt) ?? stringField(contextWindow.last_compacted_at) ?? stringField(contextWindow.lastCompressedAt) ?? stringField(contextWindow.last_compressed_at) ?? stringField(workBudget.lastCompactedAt),
    rateLimit: normalizeRateLimit(data.rateLimit ?? data.rate_limit ?? contextWindow.rateLimit ?? contextWindow.rate_limit ?? hermesCompatRateLimitRecord(data)),
    compactCapability: capabilities.nativeCompaction
      ? 'native'
      : compactCapabilityForBackend(backend) === 'session-rotate'
        ? 'session-rotate'
        : compactCapabilityForBackend(backend) === 'handoff-only'
          ? 'handoff-only'
          : 'agentserver',
    snapshot,
  };
}

function fallbackContextWindowState(agentId: string, backend: string, capabilities: AgentBackendCapabilities): BackendContextWindowState {
  return {
    backend,
    agentId,
    provider: runtimeAgentBackendProviderLabel(backend),
    source: 'unknown',
    status: 'unknown',
    compactCapability: fallbackCompactCapabilityForBackend(backend, capabilities),
  };
}

function fallbackCompactCapabilityForBackend(
  backend: string,
  capabilities: AgentBackendCapabilities,
): BackendContextWindowState['compactCapability'] {
  if (capabilities.nativeCompaction) return 'native';
  const capability = compactCapabilityForBackend(backend);
  if (capability === 'agentserver' || capability === 'handoff-only' || capability === 'session-rotate' || capability === 'none') {
    return capability;
  }
  if (backend === 'gemini' && capabilities.sessionRotationSafe) return 'session-rotate';
  return capabilities.sessionRotationSafe ? 'handoff-only' : 'none';
}

function isAgentServerManagedCompactionBackend(backend: string) {
  return backend === 'openteam_agent';
}

function markAgentServerManagedFallbackState(
  state: BackendContextWindowState | undefined,
  agentId: string,
  backend: string,
): BackendContextWindowState {
  return {
    ...(state ?? {
      backend,
      agentId,
      source: 'agentserver-estimate' as const,
      status: 'unknown' as const,
      compactCapability: 'agentserver' as const,
    }),
    backend,
    agentId,
    source: state?.source ?? 'agentserver-estimate',
    status: state?.status ?? 'unknown',
    compactCapability: 'agentserver',
  };
}

function markHandoffSlimmingState(
  state: BackendContextWindowState | undefined,
  agentId: string,
  backend: string,
): BackendContextWindowState {
  return {
    ...(state ?? {
      backend,
      agentId,
      source: 'agentserver-estimate' as const,
      status: 'watch' as const,
      compactCapability: 'handoff-only' as const,
    }),
    backend,
    agentId,
    source: 'agentserver-estimate',
    status: 'watch',
    compactCapability: backend === 'gemini' ? 'session-rotate' : 'handoff-only',
  };
}

function firstRecord(...values: unknown[]) {
  return values.find(isRecord) ?? {};
}

function normalizeRateLimit(value: unknown): BackendContextWindowState['rateLimit'] | undefined {
  if (!isRecord(value)) return undefined;
  const rateLimit = {
    limited: typeof value.limited === 'boolean' ? value.limited : typeof value.rate_limited === 'boolean' ? value.rate_limited : undefined,
    retryAfterMs: finiteNumber(value.retryAfterMs) ?? finiteNumber(value.retry_after_ms) ?? retryAfterMsFromText(JSON.stringify(value)),
    resetAt: stringField(value.resetAt) ?? stringField(value.reset_at) ?? stringField(value.rateLimitResetAt) ?? stringField(value.rate_limit_reset_at) ?? stringField(value.rate_limit_reset),
  };
  return rateLimit.limited !== undefined || rateLimit.retryAfterMs !== undefined || rateLimit.resetAt ? rateLimit : undefined;
}

function hermesCompatContextRecord(data: Record<string, unknown>): Record<string, unknown> {
  const hermes = firstRecord(data.hermes, data.hermesAgent, data.hermes_agent, data.compat, data.supervisorCompat, data.supervisor_compat);
  const event = firstRecord(data.event, data.payload, data.data);
  return firstRecord(
    data.context_compressor,
    data.contextCompressor,
    data.hermesContextCompressor,
    data.hermes_context_compressor,
    hermes.context_compressor,
    hermes.contextCompressor,
    event.context_compressor,
    event.contextCompressor,
    /context_compressor|context-compressor|hermes/i.test(String(data.type || data.kind || event.type || event.kind || '')) ? event : undefined,
  );
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

function normalizeContextWindowStatus(
  value: string | undefined,
  ratio: number | undefined,
  autoCompactThreshold: number | undefined,
): BackendContextWindowState['status'] {
  if (value && /exceeded|overflow|max|full/i.test(value)) return 'exceeded';
  if (value && /near|compact|critical|warning/i.test(value)) return 'near-limit';
  if (value && /watch/i.test(value)) return 'watch';
  if (value && /healthy|ok|normal/i.test(value)) return 'healthy';
  if (ratio !== undefined && ratio >= 1) return 'exceeded';
  if (ratio !== undefined && ratio >= (autoCompactThreshold ?? 0.82)) return 'near-limit';
  if (ratio !== undefined && ratio >= 0.68) return 'watch';
  return ratio === undefined ? 'unknown' : 'healthy';
}

export function contextWindowNeedsCompaction(state: BackendContextWindowState) {
  return state.status === 'near-limit'
    || state.status === 'exceeded'
    || (state.contextWindowRatio !== undefined && state.contextWindowRatio >= (state.autoCompactThreshold ?? 0.82));
}

export function formatContextWindowState(state: BackendContextWindowState) {
  const ratio = state.contextWindowRatio !== undefined ? `${Math.round(state.contextWindowRatio * 100)}%` : 'unknown ratio';
  const tokens = state.contextWindowTokens !== undefined ? `${state.contextWindowTokens}` : '?';
  const limit = state.contextWindowLimit !== undefined ? `${state.contextWindowLimit}` : '?';
  return `${state.backend} ${state.status} ${ratio} (${tokens}/${limit}) via ${state.compactCapability}`;
}

export function contextWindowMetadata(state: BackendContextWindowState) {
  return {
    backend: state.backend,
    provider: state.provider,
    model: state.model,
    usedTokens: state.usedTokens,
    input: state.input,
    output: state.output,
    cache: state.cache,
    window: state.window,
    ratio: state.ratio,
    source: state.source,
    status: state.status,
    contextWindowTokens: state.contextWindowTokens,
    contextWindowLimit: state.contextWindowLimit,
    contextWindowRatio: state.contextWindowRatio,
    autoCompactThreshold: state.autoCompactThreshold,
    compactCapability: state.compactCapability,
    rateLimit: state.rateLimit,
    budget: state.budget,
    auditRefs: state.auditRefs,
  };
}

export function workspaceContextWindowStateFromBackend(state: BackendContextWindowState): WorkspaceRuntimeEvent['contextWindowState'] {
  return {
    backend: state.backend,
    provider: state.provider,
    model: state.model,
    usedTokens: state.usedTokens,
    input: state.input,
    output: state.output,
    cache: state.cache,
    window: state.window,
    windowTokens: state.window,
    ratio: state.ratio,
    source: state.source,
    status: state.status,
    compactCapability: state.compactCapability,
    budget: state.budget,
    auditRefs: state.auditRefs,
    autoCompactThreshold: state.autoCompactThreshold,
    lastCompactedAt: state.lastCompactedAt,
  };
}

export function contextCompactionMetadata(compaction: BackendContextCompactionResult): WorkspaceRuntimeContextCompaction & {
  ok: boolean;
  strategy?: BackendContextCompactionResult['strategy'];
  runId?: string;
} {
  const status: WorkspaceRuntimeContextCompaction['status'] = compaction.status === 'unsupported' || compaction.status === 'skipped'
    ? 'skipped'
    : compaction.ok ? 'completed' : 'failed';
  return {
    ok: compaction.ok,
    status,
    strategy: compaction.strategy,
    reason: compaction.reason,
    message: compaction.message,
    runId: compaction.runId,
    auditRefs: compaction.auditRefs,
    before: compaction.before ? workspaceContextWindowStateFromBackend(compaction.before) : undefined,
    after: compaction.after ? workspaceContextWindowStateFromBackend(compaction.after) : undefined,
  };
}

export function agentServerAgentId(request: GatewayRequest, _purpose: string) {
  const sessionId = typeof request.uiState?.sessionId === 'string' ? request.uiState.sessionId : '';
  const packageId = request.scenarioPackageRef?.id || request.skillDomain;
  const referenceScope = currentReferenceScopeKey(request);
  const continuityScope = requestNeedsAgentServerContinuity(request)
    ? referenceScope || sessionId || request.skillPlanRef || request.skillDomain
    : `fresh:${sha1(`${request.prompt}:${Date.now()}:${Math.random()}`).slice(0, 12)}`;
  const stable = [packageId, continuityScope]
    .filter(Boolean)
    .join(':');
  return `sciforge-${request.skillDomain}-${sha1(stable).slice(0, 12)}`;
}

export function agentServerContextPolicy(request: GatewayRequest) {
  const hasSession = typeof request.uiState?.sessionId === 'string' && request.uiState.sessionId.trim().length > 0;
  const isolatedReferenceTurn = currentTurnReferences(request).length > 0;
  const useContinuity = requestNeedsAgentServerContinuity(request);
  return {
    includeCurrentWork: hasSession && useContinuity && !isolatedReferenceTurn,
    includeRecentTurns: hasSession && useContinuity && !isolatedReferenceTurn,
    includePersistent: false,
    includeMemory: false,
    persistRunSummary: hasSession && useContinuity && !isolatedReferenceTurn,
    persistExtractedConstraints: false,
    maxContextWindowTokens: request.maxContextWindowTokens,
    contextWindowLimit: request.maxContextWindowTokens,
    modelContextWindow: request.maxContextWindowTokens,
  };
}

export function requestNeedsAgentServerContinuity(request: GatewayRequest) {
  const policy = isRecord(request.uiState?.contextReusePolicy)
    ? request.uiState.contextReusePolicy
    : isRecord(request.uiState?.contextIsolation)
      ? request.uiState.contextIsolation
      : undefined;
  if (policy) {
    const mode = typeof policy.mode === 'string' ? policy.mode : '';
    const historyReuse = isRecord(policy.historyReuse) ? policy.historyReuse : {};
    return historyReuse.allowed === true || mode === 'continue' || mode === 'repair';
  }
  if (toRecordList(request.uiState?.recentExecutionRefs).length) return true;
  if (request.artifacts.length) return true;
  return false;
}

export function currentTurnReferences(request: GatewayRequest) {
  return toRecordList(request.uiState?.currentReferences);
}

function currentReferenceScopeKey(request: GatewayRequest) {
  const refs = currentTurnReferences(request);
  if (!refs.length) return '';
  const stable = refs.map((ref) => ({
    kind: ref.kind,
    ref: ref.ref,
    title: ref.title,
    sourceId: ref.sourceId,
  }));
  const currentTurnId = currentReferenceTurnId(request);
  return `current-refs:${sha1(JSON.stringify({ refs: stable, currentTurnId })).slice(0, 12)}`;
}

function currentReferenceTurnId(request: GatewayRequest) {
  const uiState = isRecord(request.uiState) ? request.uiState : {};
  const ledger = toRecordList(uiState.conversationLedger);
  const tail = toRecordList(isRecord(uiState.conversationLedger) ? uiState.conversationLedger.tail : undefined);
  const turns = tail.length ? tail : ledger;
  for (let index = turns.length - 1; index >= 0; index -= 1) {
    const turn = turns[index];
    if (String(turn.role || '').toLowerCase() !== 'user') continue;
    return stringField(turn.id) || stringField(turn.turnId) || stringField(turn.createdAt) || stringField(turn.contentDigest);
  }
  return stringField(uiState.currentTurnId) || sha1(String(request.prompt || '')).slice(0, 12);
}

export function estimateWorkspaceContextWindowState(params: {
  backend: string;
  modelName?: string;
  maxContextWindowTokens?: number;
  usedTokens: number;
  source: 'estimate' | 'unknown';
  budget?: WorkspaceRuntimeContextBudget;
  auditRefs?: string[];
}) {
  const windowTokens = params.maxContextWindowTokens ?? estimateModelContextWindow(params.modelName);
  const ratio = windowTokens ? params.usedTokens / windowTokens : undefined;
  return {
    backend: params.backend,
    provider: runtimeAgentBackendProviderLabel(params.backend),
    model: params.modelName,
    usedTokens: params.usedTokens,
    window: windowTokens,
    windowTokens,
    ratio,
    source: windowTokens ? params.source : 'unknown',
    status: normalizeContextWindowStatus(undefined, ratio, 0.82),
    compactCapability: compactCapabilityForBackend(params.backend),
    budget: params.budget,
    auditRefs: params.auditRefs,
    autoCompactThreshold: 0.82,
    watchThreshold: 0.68,
    nearLimitThreshold: 0.86,
  };
}

export function handoffContextWindowState(params: {
  backend: string;
  modelName?: string;
  maxContextWindowTokens?: number;
  rawRef: string;
  rawSha1: string;
  rawBytes: number;
  normalizedBytes: number;
  maxPayloadBytes: number;
  normalizedTokens: number;
  rawTokens: number;
  savedTokens: number;
  decisions: Array<Record<string, unknown>>;
  auditRefs: string[];
}) {
  return estimateWorkspaceContextWindowState({
    backend: params.backend,
    modelName: params.modelName,
    maxContextWindowTokens: params.maxContextWindowTokens,
    usedTokens: params.normalizedTokens,
    source: 'estimate',
    auditRefs: params.auditRefs,
    budget: {
      rawRef: params.rawRef,
      rawSha1: params.rawSha1,
      rawBytes: params.rawBytes,
      normalizedBytes: params.normalizedBytes,
      maxPayloadBytes: params.maxPayloadBytes,
      rawTokens: params.rawTokens,
      normalizedTokens: params.normalizedTokens,
      savedTokens: params.savedTokens,
      normalizedBudgetRatio: params.maxPayloadBytes ? params.normalizedBytes / params.maxPayloadBytes : undefined,
      decisions: params.decisions,
    },
  });
}

export function handoffBudgetDecisionRecords(decisions: unknown[]): Array<Record<string, unknown>> {
  return decisions.filter(isRecord).map((decision) => ({ ...decision }));
}

export function estimateModelContextWindow(modelName?: string) {
  return estimateRuntimeAgentBackendModelContextWindow(modelName);
}

export function compactCapabilityForBackend(backend: string): 'native' | 'agentserver' | 'handoff-only' | 'handoff-slimming' | 'session-rotate' | 'none' | 'unknown' {
  return compactCapabilityForAgentBackend(backend);
}

export async function fetchAgentServerContextSnapshot(baseUrl: string, agentId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(`${baseUrl}/api/agent-server/agents/${encodeURIComponent(agentId)}/context`, {
      method: 'GET',
      signal: controller.signal,
    });
    if (!response.ok) return undefined;
    const json = await response.json() as unknown;
    const data = isRecord(json) && isRecord(json.data) ? json.data : json;
    if (!isRecord(data)) return undefined;
    return compactAgentServerCoreSnapshot(data);
  } catch {
    return undefined;
  } finally {
    clearTimeout(timeout);
  }
}

export function compactAgentServerCoreSnapshot(snapshot: Record<string, unknown>) {
  const recentTurns = toRecordList(snapshot.recentTurns);
  const currentWorkEntries = toRecordList(snapshot.currentWorkEntries);
  return {
    source: 'AgentServer Core /context',
    session: isRecord(snapshot.session) ? {
      id: stringField(snapshot.session.id),
      status: stringField(snapshot.session.status),
      updatedAt: stringField(snapshot.session.updatedAt),
      recovery: isRecord(snapshot.session.recovery) ? clipForAgentServerJson(snapshot.session.recovery, 2) : undefined,
    } : undefined,
    operationalGuidance: clipForAgentServerJson(snapshot.operationalGuidance, 3),
    workLayout: clipForAgentServerJson(snapshot.workLayout, 3),
    workBudget: clipForAgentServerJson(snapshot.workBudget, 2),
    persistentBudget: clipForAgentServerJson(snapshot.persistentBudget, 2),
    memoryBudget: clipForAgentServerJson(snapshot.memoryBudget, 2),
    recentTurns: recentTurns.slice(-6).map((turn) => ({
      turnNumber: typeof turn.turnNumber === 'number' ? turn.turnNumber : undefined,
      role: stringField(turn.role),
      runId: stringField(turn.runId),
      contentRef: stringField(turn.contentRef),
      contentOmitted: turn.contentOmitted === true,
      content: clipForAgentServerPrompt(turn.content, 800),
      createdAt: stringField(turn.createdAt),
    })),
    currentWork: {
      entryCount: currentWorkEntries.length,
      rawTurnCount: currentWorkEntries.filter((entry) => entry.kind === 'turn' || entry.role).length,
      compactionTags: currentWorkEntries
        .filter((entry) => entry.kind === 'compaction' || entry.kind === 'partial_compaction')
        .slice(-8)
        .map((entry) => ({
          kind: stringField(entry.kind),
          id: stringField(entry.id),
          turns: stringField(entry.turns),
          archived: entry.archived,
          summary: Array.isArray(entry.summary) ? entry.summary.slice(0, 4).map((item) => clipForAgentServerPrompt(item, 400)) : undefined,
        })),
    },
  };
}
