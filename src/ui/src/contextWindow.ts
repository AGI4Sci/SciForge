import type { AgentContextWindowState, AgentStreamEvent, BioAgentConfig, BioAgentSession } from './domain';

export function buildContextWindowMeterModel(state: AgentContextWindowState, running: boolean) {
  const ratio = state.ratio ?? 0;
  const level = contextWindowLevel(state);
  const sourceLabel = contextWindowSourceLabel(state.source);
  const used = state.usedTokens !== undefined ? formatCompactNumber(state.usedTokens) : 'unknown';
  const windowSize = state.windowTokens !== undefined ? formatCompactNumber(state.windowTokens) : 'unknown';
  const remainingTokens = state.usedTokens !== undefined && state.windowTokens !== undefined
    ? Math.max(0, state.windowTokens - state.usedTokens)
    : undefined;
  const ratioLabel = state.ratio !== undefined ? `${Math.round(state.ratio * 100)}%` : 'unknown';
  const ratioDetail = state.ratio !== undefined ? `${Math.round(state.ratio * 1000) / 10}%` : 'unknown';
  const statusLabel = contextWindowStatusLabel(state);
  const thresholdDetail = [
    state.watchThreshold !== undefined ? `watch ${formatPercent(state.watchThreshold)}` : undefined,
    state.autoCompactThreshold !== undefined ? `auto ${formatPercent(state.autoCompactThreshold)}` : undefined,
    state.nearLimitThreshold !== undefined ? `near ${formatPercent(state.nearLimitThreshold)}` : undefined,
  ].filter(Boolean).join(' / ') || 'unknown';
  const budgetRows = contextBudgetRows(state);
  const detailRows = [
    { label: 'used/window', value: `${formatExactNumber(state.usedTokens)} / ${formatExactNumber(state.windowTokens)} tokens` },
    { label: 'remaining', value: remainingTokens !== undefined ? `${formatExactNumber(remainingTokens)} tokens` : 'unknown' },
    { label: 'ratio', value: ratioDetail },
    { label: 'status', value: statusLabel },
    { label: 'source', value: sourceLabel },
    { label: 'backend', value: state.backend || 'unknown' },
    { label: 'model', value: state.model || state.provider || 'unknown' },
    { label: 'compact', value: `${state.compactCapability || 'unknown'}${state.pendingCompact ? ' · pending' : ''}` },
    { label: 'thresholds', value: thresholdDetail },
    { label: 'last compacted', value: state.lastCompactedAt || 'never' },
    ...budgetRows,
  ];
  const title = [
    `used/window: ${formatExactNumber(state.usedTokens)}/${formatExactNumber(state.windowTokens)} tokens`,
    `remaining: ${remainingTokens !== undefined ? formatExactNumber(remainingTokens) : 'unknown'} tokens`,
    `ratio: ${ratioDetail}`,
    `status: ${statusLabel}`,
    `source: ${sourceLabel}`,
    `backend: ${state.backend || 'unknown'}`,
    `compact: ${state.compactCapability || 'unknown'}`,
    `auto threshold: ${state.autoCompactThreshold !== undefined ? `${Math.round(state.autoCompactThreshold * 100)}%` : 'unknown'}`,
    `last compacted: ${state.lastCompactedAt || 'never'}`,
  ].join('\n');

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
    compactLine: `compact ${state.compactCapability || 'unknown'}${state.pendingCompact ? ' · pending' : ''}`,
    lastLine: `last ${state.lastCompactedAt ? formatShortTime(state.lastCompactedAt) : 'never'}`,
    remaining: remainingTokens !== undefined ? formatCompactNumber(remainingTokens) : 'unknown',
    remainingExact: remainingTokens !== undefined ? formatExactNumber(remainingTokens) : 'unknown',
    ratioDetail,
    thresholdDetail,
    detailRows,
    title: `${title}\n只读状态；压缩时机由 AgentServer 自动判断。`,
  };
}

export function latestContextWindowState(events: AgentStreamEvent[]) {
  const compaction = [...events].reverse().find((event) => event.contextCompaction?.lastCompactedAt)?.contextCompaction;
  const state = [...events].reverse().find((event) => event.contextWindowState)?.contextWindowState;
  if (!state && !compaction) return undefined;
  return {
    ...(state ?? { source: 'unknown' as const }),
    lastCompactedAt: state?.lastCompactedAt ?? compaction?.lastCompactedAt,
    compactCapability: state?.compactCapability ?? compaction?.compactCapability,
    backend: state?.backend ?? compaction?.backend,
  };
}

export function estimateContextWindowState(session: BioAgentSession, config: BioAgentConfig, events: AgentStreamEvent[]): AgentContextWindowState {
  const modelWindow = config.maxContextWindowTokens || estimateModelContextWindow(config.modelName);
  const textChars = session.messages.slice(-24).reduce((sum, message) => sum + message.content.length + (message.expandable?.length ?? 0), 0);
  const artifactChars = session.artifacts.slice(-12).reduce((sum, artifact) => sum + JSON.stringify({
    id: artifact.id,
    type: artifact.type,
    metadata: artifact.metadata,
    dataRef: artifact.dataRef,
    path: artifact.path,
  }).length, 0);
  const usedTokens = Math.ceil((textChars + artifactChars) / 4);
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

export function shouldAutoCompact(state: AgentContextWindowState) {
  const threshold = state.autoCompactThreshold ?? 0.82;
  return state.ratio !== undefined
    && state.ratio >= threshold
    && state.compactCapability !== 'none'
    && !state.pendingCompact
    && state.status !== 'compacting';
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
  if (state.status === 'blocked' || state.status === 'exceeded' || state.status === 'near-limit') return 'near-limit';
  if (state.status === 'watch' || state.status === 'compacting') return 'watch';
  if (state.ratio === undefined) return 'unknown';
  if (state.ratio >= (state.nearLimitThreshold ?? 0.86)) return 'near-limit';
  if (state.ratio >= (state.watchThreshold ?? 0.68)) return 'watch';
  return 'ok';
}

export function contextWindowSourceLabel(source: AgentContextWindowState['source']) {
  if (source === 'estimate' || source === 'agentserver-estimate') return '估算';
  if (source === 'unknown') return '未知';
  if (source === 'native') return 'native';
  if (source === 'provider-usage') return 'provider';
  return 'AgentServer';
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

function contextWindowStatusLabel(state: AgentContextWindowState) {
  if (state.status === 'healthy') return 'healthy';
  if (state.status === 'watch') return 'watch';
  if (state.status === 'near-limit') return 'near-limit';
  if (state.status === 'exceeded') return 'exceeded';
  if (state.status === 'compacting') return 'compacting';
  if (state.status === 'blocked') return 'blocked';
  if (state.status === 'unknown') return 'unknown';
  return contextWindowLevel(state);
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

function formatExactNumber(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return 'unknown';
  return Math.trunc(value).toLocaleString('en-US');
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
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
      ? { label: 'payload tokens', value: `${formatExactNumber(budget.normalizedTokens)} normalized / ${formatExactNumber(budget.rawTokens)} raw` }
      : undefined,
    budget.savedTokens !== undefined
      ? { label: 'saved tokens', value: formatExactNumber(budget.savedTokens) }
      : undefined,
    budget.maxPayloadBytes !== undefined || budget.normalizedBytes !== undefined
      ? { label: 'payload bytes', value: `${formatExactNumber(budget.normalizedBytes)} / ${formatExactNumber(budget.maxPayloadBytes)}` }
      : undefined,
    budget.normalizedBudgetRatio !== undefined
      ? { label: 'payload budget', value: `${Math.round(budget.normalizedBudgetRatio * 1000) / 10}%` }
      : undefined,
  ].filter((row): row is { label: string; value: string } => Boolean(row));
}
