import type { AgentContextWindowState, AgentStreamEvent, SciForgeConfig, SciForgeSession } from './domain';

export function buildContextWindowMeterModel(state: AgentContextWindowState, running: boolean) {
  const ratio = state.ratio ?? 0;
  const level = contextWindowLevel(state);
  const sourceLabel = contextWindowSourceLabel(state.source);
  const used = state.usedTokens !== undefined ? formatCompactNumber(state.usedTokens) : '未知';
  const windowSize = state.windowTokens !== undefined ? formatCompactNumber(state.windowTokens) : '未知';
  const remainingTokens = state.usedTokens !== undefined && state.windowTokens !== undefined
    ? Math.max(0, state.windowTokens - state.usedTokens)
    : undefined;
  const ratioLabel = state.ratio !== undefined ? `${Math.round(state.ratio * 100)}%` : '未知';
  const ratioDetail = state.ratio !== undefined ? `${Math.round(state.ratio * 1000) / 10}%` : '未知';
  const statusLabel = contextWindowStatusLabel(state);
  const thresholdDetail = contextCompactLabel(state);
  const budgetRows = contextBudgetRows(state);
  const detailRows = [
    { label: '已用', value: `${ratioDetail} 上下文` },
    { label: '剩余', value: remainingTokens !== undefined ? `${formatCompactNumber(remainingTokens)} tokens` : '未知' },
    { label: '状态', value: statusLabel },
    { label: '压缩', value: thresholdDetail },
    ...budgetRows,
  ];
  const title = `上下文 ${ratioDetail} · ${statusLabel}`;

  const memoryBoundaryLine = 'SciForge 会保留当前对话、选中对象和必要摘要。';
  return {
    ratio,
    ratioStyle: `${Math.min(100, Math.max(0, ratio * 100))}%`,
    ratioLabel,
    level,
    sourceLabel,
    statusLabel,
    used,
    windowSize,
    isEstimated: state.source === 'estimate' || state.source === 'agentserver-estimate',
    isUnknown: state.source === 'unknown',
    compactLine: `压缩 ${contextCompactCapabilityLabel(state.compactCapability)}${state.pendingCompact ? ' · 排队中' : ''}`,
    lastLine: `上次 ${state.lastCompactedAt ? formatShortTime(state.lastCompactedAt) : '未压缩'}`,
    remaining: remainingTokens !== undefined ? formatCompactNumber(remainingTokens) : '未知',
    remainingExact: remainingTokens !== undefined ? formatExactNumber(remainingTokens) : '未知',
    ratioDetail,
    thresholdDetail,
    detailRows,
    memoryBoundaryLine,
    title,
  };
}

export function latestContextWindowState(events: AgentStreamEvent[]) {
  const compaction = [...events].reverse().find((event) => event.contextCompaction?.lastCompactedAt)?.contextCompaction;
  const lastCompactedState = [...events].reverse().find((event) => event.contextWindowState?.lastCompactedAt)?.contextWindowState;
  const states = [...events]
    .reverse()
    .map((event) => event.contextWindowState)
    .filter((state): state is AgentContextWindowState => state !== undefined && state.source !== 'provider-usage');
  const state = states.find(isAuthoritativeContextWindowState) ?? states[0];
  if (!state && !compaction) return undefined;
  const compactionState = compaction?.after ?? compaction?.before;
  return {
    ...(state ?? compactionState ?? { source: 'unknown' as const }),
    lastCompactedAt: state?.lastCompactedAt ?? lastCompactedState?.lastCompactedAt ?? compaction?.lastCompactedAt ?? compactionState?.lastCompactedAt,
    compactCapability: state?.compactCapability ?? compaction?.compactCapability ?? compactionState?.compactCapability,
    backend: state?.backend ?? compaction?.backend ?? compactionState?.backend,
  };
}

function isAuthoritativeContextWindowState(state: AgentContextWindowState) {
  return state.source === 'native' || state.source === 'agentserver';
}

export function estimateContextWindowState(session: SciForgeSession, config: SciForgeConfig, events: AgentStreamEvent[]): AgentContextWindowState {
  const modelWindow = config.maxContextWindowTokens || estimateModelContextWindow(config.modelName);
  const latestTelemetry = latestContextWindowState(events);
  if (latestTelemetry && latestTelemetry.source !== 'provider-usage') {
    return withFallbackContextWindow(latestTelemetry, modelWindow, config);
  }
  const textChars = session.messages.reduce((sum, message) => sum + message.content.length + (message.expandable?.length ?? 0), 0);
  const artifactChars = session.artifacts.reduce((sum, artifact) => sum + JSON.stringify({
    id: artifact.id,
    type: artifact.type,
    metadata: artifact.metadata,
    dataRef: artifact.dataRef,
    path: artifact.path,
  }).length, 0);
  const runChars = session.runs.reduce((sum, run) => sum + run.prompt.length + run.response.length, 0);
  const executionChars = session.executionUnits.reduce((sum, unit) => sum + JSON.stringify({
    id: unit.id,
    status: unit.status,
    tool: unit.tool,
    codeRef: unit.codeRef,
    outputRef: unit.outputRef,
    stdoutRef: unit.stdoutRef,
    stderrRef: unit.stderrRef,
    failureReason: unit.failureReason,
  }).length, 0);
  const usedTokens = Math.ceil((textChars + artifactChars + runChars + executionChars) / 4);
  return {
    usedTokens: Number.isFinite(usedTokens) ? usedTokens : undefined,
    windowTokens: modelWindow,
    ratio: modelWindow && Number.isFinite(usedTokens) ? usedTokens / modelWindow : undefined,
    source: modelWindow || Number.isFinite(usedTokens) ? 'estimate' : 'unknown',
    backend: config.agentBackend || 'unknown',
    compactCapability: compactCapabilityForBackend(config.agentBackend),
    autoCompactThreshold: 0.82,
    watchThreshold: 0.68,
    nearLimitThreshold: 0.86,
  };
}

function withFallbackContextWindow(
  state: AgentContextWindowState,
  modelWindow: number | undefined,
  config: SciForgeConfig,
): AgentContextWindowState {
  const windowTokens = state.windowTokens ?? state.window ?? modelWindow;
  const ratio = state.ratio ?? (
    state.usedTokens !== undefined && windowTokens ? state.usedTokens / windowTokens : undefined
  );
  return {
    ...state,
    windowTokens,
    ratio,
    backend: state.backend || config.agentBackend || 'unknown',
    compactCapability: state.compactCapability ?? compactCapabilityForBackend(config.agentBackend),
    autoCompactThreshold: state.autoCompactThreshold ?? 0.82,
    watchThreshold: state.watchThreshold ?? 0.68,
    nearLimitThreshold: state.nearLimitThreshold ?? 0.86,
  };
}

export function shouldAutoCompact(state: AgentContextWindowState) {
  const threshold = state.autoCompactThreshold ?? 0.82;
  return state.ratio !== undefined
    && state.ratio >= threshold
    && state.compactCapability !== 'none'
    && !state.pendingCompact
    && state.status !== 'compacting'
    && !wasRecentlyCompacted(state.lastCompactedAt);
}

export function shouldStartContextCompaction({
  state,
  running,
  inFlight,
  reason,
}: {
  state: AgentContextWindowState;
  running: boolean;
  inFlight: boolean;
  reason: string;
}) {
  if (inFlight) return false;
  if (reason === 'auto-threshold-before-send' && running) return false;
  if (reason === 'auto-threshold-before-send') return shouldAutoCompact(state);
  return true;
}

export function contextWindowLevel(state: AgentContextWindowState) {
  const ratio = state.ratio;
  if (ratio !== undefined && ratio >= (state.nearLimitThreshold ?? 0.86)) return 'near-limit';
  if (state.status === 'blocked' || state.status === 'exceeded' || state.status === 'near-limit') return 'near-limit';
  if (ratio !== undefined && ratio >= (state.watchThreshold ?? 0.68)) return 'watch';
  if (state.status === 'watch' || state.status === 'compacting') return 'watch';
  if (ratio === undefined) return 'unknown';
  return 'ok';
}

export function contextWindowSourceLabel(source: AgentContextWindowState['source']) {
  if (source === 'estimate' || source === 'agentserver-estimate') return '估算';
  if (source === 'unknown') return '未知';
  if (source === 'native') return '本机';
  if (source === 'provider-usage') return '用量';
  return source === 'agentserver' ? '服务端' : '运行时';
}

function estimateModelContextWindow(modelName: string) {
  const model = modelName.toLowerCase();
  if (!model) return undefined;
  if (/1m|1000k|gemini-1\.5-pro|gemini-2\./.test(model)) return 1_000_000;
  if (/400k|claude.*sonnet-4|claude.*opus-4/.test(model)) return 400_000;
  if (/200k|claude|gpt-4\.1|gpt-5|o3|o4/.test(model)) return 200_000;
  if (/128k|gpt-4o|gemini/.test(model)) return 128_000;
  if (/32k/.test(model)) return 32_000;
  if (/16k/.test(model)) return 16_000;
  return undefined;
}

function compactCapabilityForBackend(backend: string): AgentContextWindowState['compactCapability'] {
  if (backend === 'codex') return 'native';
  if (backend === 'openteam_agent' || backend === 'hermes-agent') return 'agentserver';
  if (backend === 'gemini') return 'session-rotate';
  if (backend === 'claude-code' || backend === 'openclaw') return 'handoff-slimming';
  return 'unknown';
}

function wasRecentlyCompacted(value?: string) {
  if (!value) return false;
  const time = Date.parse(value);
  if (!Number.isFinite(time)) return false;
  return Date.now() - time < 60_000;
}

function contextWindowStatusLabel(state: AgentContextWindowState) {
  if (state.ratio !== undefined && state.ratio >= 1) return '超限';
  if (state.ratio !== undefined && state.ratio >= (state.nearLimitThreshold ?? 0.86)) return '接近上限';
  if (state.ratio !== undefined && state.ratio >= (state.watchThreshold ?? 0.68) && (state.status === 'healthy' || state.status === 'unknown' || !state.status)) return '注意';
  if (state.status === 'healthy') return '良好';
  if (state.status === 'watch') return '注意';
  if (state.status === 'near-limit') return '接近上限';
  if (state.status === 'exceeded') return '超限';
  if (state.status === 'compacting') return '压缩中';
  if (state.status === 'blocked') return '已阻塞';
  if (state.status === 'unknown') return '未知';
  const level = contextWindowLevel(state);
  if (level === 'ok') return '良好';
  if (level === 'watch') return '注意';
  if (level === 'near-limit') return '接近上限';
  return '未知';
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

function formatExactNumber(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return '未知';
  return Math.trunc(value).toLocaleString('en-US');
}

function contextCompactLabel(state: AgentContextWindowState) {
  if (state.pendingCompact) return '准备压缩';
  if (state.compactCapability === 'native') return '自动管理';
  if (state.compactCapability && state.compactCapability !== 'unknown') return '可压缩';
  return '按需保留';
}

function contextCompactCapabilityLabel(capability: AgentContextWindowState['compactCapability']) {
  if (capability === 'native') return '自动';
  if (capability === 'agentserver') return '服务端';
  if (capability === 'session-rotate') return '轮转';
  if (capability === 'handoff-slimming') return '精简';
  if (capability === 'none') return '关闭';
  return '按需';
}

function formatShortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function contextBudgetRows(state: AgentContextWindowState) {
  const budget = state.budget;
  if (!budget) return [];
  return [
    budget.rawTokens !== undefined || budget.normalizedTokens !== undefined
      ? { label: '请求大小', value: `${formatCompactNumber(budget.normalizedTokens ?? 0)} / ${formatCompactNumber(budget.rawTokens ?? 0)} tokens` }
      : undefined,
    budget.savedTokens !== undefined
      ? { label: '已节省', value: `${formatCompactNumber(budget.savedTokens)} tokens` }
      : undefined,
    budget.maxPayloadBytes !== undefined || budget.normalizedBytes !== undefined
      ? { label: '请求体积', value: `${formatCompactNumber(budget.normalizedBytes ?? 0)} / ${formatCompactNumber(budget.maxPayloadBytes ?? 0)} bytes` }
      : undefined,
    budget.normalizedBudgetRatio !== undefined
      ? { label: '请求预算', value: `${Math.round(budget.normalizedBudgetRatio * 1000) / 10}%` }
      : undefined,
  ].filter((row): row is { label: string; value: string } => Boolean(row));
}
