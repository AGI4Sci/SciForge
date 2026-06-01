import type { AgentContextWindowState, AgentStreamEvent, SciForgeConfig, SciForgeSession } from './domain';
import { localeText, type SupportedLocale } from './i18n';

interface ContextUsageRow {
  kind: string;
  label: string;
  value: string;
  tokens?: number;
  known: boolean;
}

export function buildContextWindowMeterModel(state: AgentContextWindowState, running: boolean, locale?: SupportedLocale) {
  const t = (copy: Record<SupportedLocale, string>) => localeText(locale ?? 'en-US', copy);
  const ratio = state.ratio ?? 0;
  const level = contextWindowLevel(state);
  const sourceLabel = contextWindowSourceLabel(state.source);
  const used = state.usedTokens !== undefined ? formatCompactNumber(state.usedTokens) : t({ 'zh-CN': '未知', 'en-US': 'Unknown' });
  const windowSize = state.windowTokens !== undefined ? formatCompactNumber(state.windowTokens) : t({ 'zh-CN': '未知', 'en-US': 'Unknown' });
  const remainingTokens = state.usedTokens !== undefined && state.windowTokens !== undefined
    ? Math.max(0, state.windowTokens - state.usedTokens)
    : undefined;
  const ratioLabel = state.ratio !== undefined ? `${Math.round(state.ratio * 100)}%` : t({ 'zh-CN': '未知', 'en-US': 'Unknown' });
  const ratioDetail = state.ratio !== undefined ? `${Math.round(state.ratio * 1000) / 10}%` : t({ 'zh-CN': '未知', 'en-US': 'Unknown' });
  const statusLabel = contextWindowStatusLabel(state, locale);
  const thresholdDetail = contextCompactLabel(state, locale);
  const budgetRows = contextBudgetRows(state, locale);
  const usageRows = contextInspectorUsageRows(state, locale);
  const usageSegments = contextUsageSegments(usageRows, state.windowTokens);
  const warningLine = contextWindowWarningLine(state, running, locale);
  const detailRows = [
    { label: t({ 'zh-CN': '已使用', 'en-US': 'Used' }), value: t({ 'zh-CN': `${ratioDetail} 上下文`, 'en-US': `${ratioDetail} context` }) },
    { label: t({ 'zh-CN': '剩余', 'en-US': 'Remaining' }), value: remainingTokens !== undefined ? `${formatCompactNumber(remainingTokens)} tokens` : t({ 'zh-CN': '未知', 'en-US': 'Unknown' }) },
    { label: t({ 'zh-CN': '状态', 'en-US': 'Status' }), value: statusLabel },
    { label: t({ 'zh-CN': '压缩', 'en-US': 'Compaction' }), value: thresholdDetail },
    ...budgetRows,
  ];
  const title = t({ 'zh-CN': `上下文 ${ratioDetail} · ${statusLabel}`, 'en-US': `Context ${ratioDetail} · ${statusLabel}` });

  const memoryBoundaryLine = t({
    'zh-CN': '当前对话、已选对象和必要摘要会被保留。',
    'en-US': 'The current chat, selected objects, and essential summaries are retained.',
  });
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
    compactLine: `${t({ 'zh-CN': '摘要', 'en-US': 'Summary' })} ${contextCompactCapabilityLabel(state.compactCapability, locale)}${state.pendingCompact ? ` · ${t({ 'zh-CN': '已排队', 'en-US': 'queued' })}` : ''}`,
    lastLine: `${t({ 'zh-CN': '上次', 'en-US': 'Last' })} ${state.lastCompactedAt ? formatShortTime(state.lastCompactedAt) : t({ 'zh-CN': '从未压缩', 'en-US': 'never compacted' })}`,
    remaining: remainingTokens !== undefined ? formatCompactNumber(remainingTokens) : t({ 'zh-CN': '未知', 'en-US': 'Unknown' }),
    remainingExact: remainingTokens !== undefined ? formatExactNumber(remainingTokens) : t({ 'zh-CN': '未知', 'en-US': 'Unknown' }),
    ratioDetail,
    thresholdDetail,
    usageRows,
    usageSegments,
    warningLine,
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
    breakdown: Number.isFinite(usedTokens) ? { conversation: usedTokens } : undefined,
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
  if (source === 'estimate' || source === 'agentserver-estimate') return 'Estimate';
  if (source === 'unknown') return 'Unknown';
  if (source === 'native') return 'Native';
  if (source === 'provider-usage') return 'Usage';
  return source === 'agentserver' ? 'Service' : 'Runtime';
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

function contextWindowStatusLabel(state: AgentContextWindowState, locale?: SupportedLocale) {
  const label = (key: 'exceeded' | 'near-limit' | 'watch' | 'good' | 'compacting' | 'blocked' | 'unknown') => {
    const labels: Record<typeof key, Record<SupportedLocale, string>> = {
      exceeded: { 'zh-CN': '已超出', 'en-US': 'Exceeded' },
      'near-limit': { 'zh-CN': '接近上限', 'en-US': 'Near limit' },
      watch: { 'zh-CN': '观察中', 'en-US': 'Watch' },
      good: { 'zh-CN': '良好', 'en-US': 'Good' },
      compacting: { 'zh-CN': '压缩中', 'en-US': 'Compacting' },
      blocked: { 'zh-CN': '已阻塞', 'en-US': 'Blocked' },
      unknown: { 'zh-CN': '未知', 'en-US': 'Unknown' },
    };
    return localeText(locale ?? 'en-US', labels[key]);
  };
  if (state.ratio !== undefined && state.ratio >= 1) return label('exceeded');
  if (state.ratio !== undefined && state.ratio >= (state.nearLimitThreshold ?? 0.86)) return label('near-limit');
  if (state.ratio !== undefined && state.ratio >= (state.watchThreshold ?? 0.68) && (state.status === 'healthy' || state.status === 'unknown' || !state.status)) return label('watch');
  if (state.status === 'healthy') return label('good');
  if (state.status === 'watch') return label('watch');
  if (state.status === 'near-limit') return label('near-limit');
  if (state.status === 'exceeded') return label('exceeded');
  if (state.status === 'compacting') return label('compacting');
  if (state.status === 'blocked') return label('blocked');
  if (state.status === 'unknown') return label('unknown');
  const level = contextWindowLevel(state);
  if (level === 'ok') return label('good');
  if (level === 'watch') return label('watch');
  if (level === 'near-limit') return label('near-limit');
  return label('unknown');
}

function contextWindowWarningLine(state: AgentContextWindowState, running: boolean, locale?: SupportedLocale) {
  const level = contextWindowLevel(state);
  const t = (copy: Record<SupportedLocale, string>) => localeText(locale ?? 'en-US', copy);
  if (state.status === 'exceeded' || (state.ratio !== undefined && state.ratio >= 1)) {
    return t({
      'zh-CN': '上下文已超出窗口；先压缩或缩小引用，已选对象和必要摘要会保留。',
      'en-US': 'Context exceeds the window; compact or slim references first. Selected objects and essential summaries are retained.',
    });
  }
  if (state.status === 'blocked') {
    return t({
      'zh-CN': '上下文已阻塞发送；需要压缩或缩小请求，已选对象不会被静默丢弃。',
      'en-US': 'Context is blocking send; compact or slim the request. Selected objects are not silently dropped.',
    });
  }
  if (level === 'near-limit') {
    return running
      ? t({
        'zh-CN': '本轮已接近上下文窗口；追加指令会排队，已选对象会继续保留。',
        'en-US': 'This turn is near the context window; added guidance queues and selected objects stay attached.',
      })
      : t({
        'zh-CN': '上下文接近窗口；可继续发送，但压缩会优先保留对话、已选对象和必要摘要。',
        'en-US': 'Context is near the window; you can continue, and compaction preserves chat, selected objects, and essential summaries.',
      });
  }
  if (level === 'watch') {
    return t({
      'zh-CN': '上下文用量上升；继续添加大引用前请留意窗口余量。',
      'en-US': 'Context usage is rising; watch remaining space before adding large references.',
    });
  }
  return undefined;
}

function formatCompactNumber(value: number) {
  if (value >= 1_000_000) return `${Math.round(value / 100_000) / 10}M`;
  if (value >= 1_000) return `${Math.round(value / 100) / 10}k`;
  return String(value);
}

function formatExactNumber(value?: number) {
  if (value === undefined || !Number.isFinite(value)) return 'Unknown';
  return Math.trunc(value).toLocaleString('en-US');
}

function contextCompactLabel(state: AgentContextWindowState, locale?: SupportedLocale) {
  if (state.pendingCompact) return localeText(locale ?? 'en-US', { 'zh-CN': '准备中', 'en-US': 'Preparing' });
  if (state.compactCapability === 'native') return localeText(locale ?? 'en-US', { 'zh-CN': '自动', 'en-US': 'Automatic' });
  if (state.compactCapability && state.compactCapability !== 'unknown') return localeText(locale ?? 'en-US', { 'zh-CN': '可用', 'en-US': 'Available' });
  return localeText(locale ?? 'en-US', { 'zh-CN': '按需', 'en-US': 'On demand' });
}

function contextCompactCapabilityLabel(capability: AgentContextWindowState['compactCapability'], locale?: SupportedLocale) {
  if (capability === 'native') return localeText(locale ?? 'en-US', { 'zh-CN': '自动', 'en-US': 'automatic' });
  if (capability === 'agentserver') return localeText(locale ?? 'en-US', { 'zh-CN': '服务', 'en-US': 'service' });
  if (capability === 'session-rotate') return localeText(locale ?? 'en-US', { 'zh-CN': '轮换', 'en-US': 'rotation' });
  if (capability === 'handoff-slimming') return localeText(locale ?? 'en-US', { 'zh-CN': '瘦身', 'en-US': 'slimming' });
  if (capability === 'none') return localeText(locale ?? 'en-US', { 'zh-CN': '关闭', 'en-US': 'off' });
  return localeText(locale ?? 'en-US', { 'zh-CN': '按需', 'en-US': 'on demand' });
}

function formatShortTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function contextBudgetRows(state: AgentContextWindowState, locale?: SupportedLocale) {
  const budget = state.budget;
  if (!budget) return [];
  const t = (copy: Record<SupportedLocale, string>) => localeText(locale ?? 'en-US', copy);
  return [
    budget.rawTokens !== undefined || budget.normalizedTokens !== undefined
      ? { label: t({ 'zh-CN': '请求大小', 'en-US': 'Request size' }), value: `${formatCompactNumber(budget.normalizedTokens ?? 0)} / ${formatCompactNumber(budget.rawTokens ?? 0)} tokens` }
      : undefined,
    budget.savedTokens !== undefined
      ? { label: t({ 'zh-CN': '已节省', 'en-US': 'Saved' }), value: `${formatCompactNumber(budget.savedTokens)} tokens` }
      : undefined,
    budget.maxPayloadBytes !== undefined || budget.normalizedBytes !== undefined
      ? { label: t({ 'zh-CN': 'Payload 大小', 'en-US': 'Payload size' }), value: `${formatCompactNumber(budget.normalizedBytes ?? 0)} / ${formatCompactNumber(budget.maxPayloadBytes ?? 0)} bytes` }
      : undefined,
    budget.normalizedBudgetRatio !== undefined
      ? { label: t({ 'zh-CN': '预算', 'en-US': 'Budget' }), value: `${Math.round(budget.normalizedBudgetRatio * 1000) / 10}%` }
      : undefined,
  ].filter((row): row is { label: string; value: string } => Boolean(row));
}

function contextInspectorUsageRows(state: AgentContextWindowState, locale?: SupportedLocale): ContextUsageRow[] {
  const t = (copy: Record<SupportedLocale, string>) => localeText(locale ?? 'en-US', copy);
  const breakdown = state.breakdown ?? {};
  const knownNonConversation = [
    breakdown.systemPrompt,
    breakdown.toolDefinitions,
    breakdown.rules,
    breakdown.skills,
    breakdown.mcp,
    breakdown.subagentDefinitions,
  ].reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const conversationTokens = breakdown.conversation ?? (
    state.usedTokens !== undefined ? Math.max(0, state.usedTokens - knownNonConversation) : undefined
  );
  const definitions: Array<{ kind: string; label: Record<SupportedLocale, string>; tokens?: number }> = [
    { kind: 'system-prompt', label: { 'zh-CN': 'System prompt', 'en-US': 'System prompt' }, tokens: breakdown.systemPrompt },
    { kind: 'tool-definitions', label: { 'zh-CN': 'Tool definitions', 'en-US': 'Tool definitions' }, tokens: breakdown.toolDefinitions },
    { kind: 'rules', label: { 'zh-CN': 'Rules', 'en-US': 'Rules' }, tokens: breakdown.rules },
    { kind: 'skills', label: { 'zh-CN': 'Skills', 'en-US': 'Skills' }, tokens: breakdown.skills },
    { kind: 'mcp', label: { 'zh-CN': 'MCP', 'en-US': 'MCP' }, tokens: breakdown.mcp },
    { kind: 'subagent-definitions', label: { 'zh-CN': 'Subagent definitions', 'en-US': 'Subagent definitions' }, tokens: breakdown.subagentDefinitions },
    { kind: 'conversation', label: { 'zh-CN': 'Conversation', 'en-US': 'Conversation' }, tokens: conversationTokens },
  ];
  const rows = definitions.map((definition) => ({
    kind: definition.kind,
    label: t(definition.label),
    value: definition.tokens !== undefined ? `${formatCompactNumber(definition.tokens)} tokens` : t({ 'zh-CN': '未知', 'en-US': 'Unknown' }),
    tokens: definition.tokens,
    known: definition.tokens !== undefined,
  }));

  return rows.some((row) => row.known) ? rows : [{
    kind: 'context',
    label: t({ 'zh-CN': '上下文', 'en-US': 'Context' }),
    value: state.ratio !== undefined ? `${Math.round(state.ratio * 1000) / 10}%` : t({ 'zh-CN': '未知', 'en-US': 'Unknown' }),
    known: state.ratio !== undefined,
  }];
}

function contextUsageSegments(rows: ContextUsageRow[], windowTokens: number | undefined) {
  const knownRows = rows.filter((row) => row.tokens !== undefined && row.tokens > 0);
  const denominator = windowTokens && windowTokens > 0
    ? windowTokens
    : knownRows.reduce((sum, row) => sum + (row.tokens ?? 0), 0);
  if (!denominator) return [];
  return knownRows.map((row) => ({
    kind: row.kind,
    label: row.label,
    width: `${Math.max(0.5, Math.min(100, ((row.tokens ?? 0) / denominator) * 100))}%`,
  }));
}
