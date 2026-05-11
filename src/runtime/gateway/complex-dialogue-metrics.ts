import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { WorkspaceRuntimeEvent } from '../runtime-types.js';
import { isRecord, toStringList } from '../gateway-utils.js';

export const COMPLEX_DIALOGUE_BENCHMARK_REPORT_SCHEMA_VERSION = 'sciforge.complex-dialogue-benchmark-report.v1' as const;
export const COMPLEX_DIALOGUE_BENCHMARK_COMPARISON_SCHEMA_VERSION = 'sciforge.complex-dialogue-benchmark-comparison.v1' as const;

export type ComplexDialogueBenchmarkVariant = 'baseline' | 'optimized' | 'candidate' | 'reference';

export type ComplexDialogueEventCategory =
  | 'user'
  | 'assistant'
  | 'backend'
  | 'tool'
  | 'progress'
  | 'verification'
  | 'compaction'
  | 'background'
  | 'artifact'
  | 'failure'
  | 'recovery'
  | 'lifecycle'
  | 'diagnostic';

export type ComplexDialogueLifecycleKind =
  | 'restart'
  | 'refresh'
  | 'resume'
  | 'interruption'
  | 'history-edit'
  | 'revert'
  | 'continue'
  | 'branch'
  | 'merge'
  | 'cancellation'
  | 'cross-session'
  | 'conflict';

export interface ComplexDialogueTimelineEvent {
  id: string;
  type: string;
  category: ComplexDialogueEventCategory;
  timeMs: number;
  durationMs?: number;
  turnIndex?: number;
  runId?: string;
  phase?: string;
  status?: string;
  message?: string;
  refs?: string[];
  tokens?: {
    input?: number;
    output?: number;
    total?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  qualitySignals?: {
    userVisible?: boolean;
    partialResult?: boolean;
    finalResult?: boolean;
    failure?: boolean;
    recoverable?: boolean;
    repeatedWork?: boolean;
    staleState?: boolean;
    conflict?: boolean;
    humanBlocked?: boolean;
    evidenceRefs?: number;
    artifactRefs?: number;
    lifecycleKind?: ComplexDialogueLifecycleKind;
  };
  raw?: Record<string, unknown>;
}

export interface ComplexDialogueTimelineSummary {
  eventCount: number;
  turnCount: number;
  totalDurationMs: number;
  firstVisibleResponseMs?: number;
  firstBackendEventMs?: number;
  firstPartialResultMs?: number;
  firstFinalResultMs?: number;
  p50InterEventGapMs: number;
  p95InterEventGapMs: number;
  userVisibleEventCount: number;
  backendEventCount: number;
  toolEventCount: number;
  progressEventCount: number;
  partialResultCount: number;
  finalResultCount: number;
  failureCount: number;
  recoveryEventCount: number;
  recoverableFailureCount: number;
  repeatedWorkCount: number;
  staleStateCount: number;
  conflictCount: number;
  humanBlockedCount: number;
  artifactRefCount: number;
  evidenceRefCount: number;
  tokenUsage: {
    input: number;
    output: number;
    total: number;
    cacheRead: number;
    cacheWrite: number;
  };
  waits: {
    compactionWaitMs: number;
    verificationWaitMs: number;
    backgroundCompletionMs: number;
  };
  lifecycle: ComplexDialogueLifecycleMetrics;
  qualityScore: number;
}

export interface ComplexDialogueLifecycleMetrics {
  restartCount: number;
  refreshCount: number;
  resumeCount: number;
  interruptionCount: number;
  historyEditCount: number;
  revertCount: number;
  continueCount: number;
  branchCount: number;
  mergeCount: number;
  cancellationCount: number;
  crossSessionCount: number;
  conflictCount: number;
  recoveredLifecycleCount: number;
  lifecycleRecoveryRate: number;
}

export interface ComplexDialoguePerformanceGates {
  maxFirstVisibleMs?: number;
  maxFirstBackendMs?: number;
  maxTotalDurationMs?: number;
  maxP95InterEventGapMs?: number;
  maxCompactionWaitMs?: number;
  maxVerificationWaitMs?: number;
  maxBackgroundCompletionMs?: number;
  maxRepeatedWorkCount?: number;
  maxFailureCount?: number;
  minProgressEventCount?: number;
  minRecoveryEventCount?: number;
  minLifecycleRecoveryRate?: number;
  minQualityScore?: number;
}

export interface ComplexDialogueGateResult {
  name: keyof ComplexDialoguePerformanceGates;
  passed: boolean;
  actual: number | undefined;
  expected: number;
  direction: 'max' | 'min';
  severity: 'warning' | 'failure';
  message: string;
}

export interface ComplexDialogueGateEvaluation {
  passed: boolean;
  results: ComplexDialogueGateResult[];
}

export interface ComplexDialogueBenchmarkReport {
  schemaVersion: typeof COMPLEX_DIALOGUE_BENCHMARK_REPORT_SCHEMA_VERSION;
  benchmarkId: string;
  variant: ComplexDialogueBenchmarkVariant;
  generatedAt: string;
  metadata?: Record<string, unknown>;
  timeline: {
    events: ComplexDialogueTimelineEvent[];
    summary: ComplexDialogueTimelineSummary;
  };
  gates?: ComplexDialoguePerformanceGates;
  gateEvaluation?: ComplexDialogueGateEvaluation;
}

export interface BuildComplexDialogueBenchmarkReportInput {
  benchmarkId: string;
  variant?: ComplexDialogueBenchmarkVariant;
  generatedAt?: string;
  events: ComplexDialogueTimelineEvent[];
  gates?: ComplexDialoguePerformanceGates;
  metadata?: Record<string, unknown>;
}

export interface ComplexDialogueBenchmarkComparison {
  schemaVersion: typeof COMPLEX_DIALOGUE_BENCHMARK_COMPARISON_SCHEMA_VERSION;
  benchmarkId: string;
  generatedAt: string;
  baselineVariant: ComplexDialogueBenchmarkVariant;
  optimizedVariant: ComplexDialogueBenchmarkVariant;
  deltas: {
    firstVisibleResponseMs?: number;
    firstBackendEventMs?: number;
    totalDurationMs: number;
    p95InterEventGapMs: number;
    qualityScore: number;
    progressEventCount: number;
    failureCount: number;
    repeatedWorkCount: number;
    lifecycleRecoveryRate: number;
  };
  speedups: {
    firstVisibleResponsePercent?: number;
    firstBackendEventPercent?: number;
    totalDurationPercent: number;
    p95InterEventGapPercent: number;
  };
  gateComparison: {
    baselinePassed?: boolean;
    optimizedPassed?: boolean;
    optimizedFailedGateNames: string[];
  };
  baseline: ComplexDialogueTimelineSummary;
  optimized: ComplexDialogueTimelineSummary;
}

export interface ComplexDialogueRegressionGuardOptions {
  maxFirstVisibleSlowdownPercent?: number;
  maxFirstBackendSlowdownPercent?: number;
  maxTotalSlowdownPercent?: number;
  maxP95GapSlowdownPercent?: number;
  maxQualityScoreDrop?: number;
  maxNewFailures?: number;
  maxNewRepeatedWork?: number;
  requireOptimizedGatePass?: boolean;
}

export interface ComplexDialogueRegressionGuardResult {
  passed: boolean;
  regressions: string[];
  improvements: string[];
}

export interface ComplexDialogueValidationIssue {
  path: string;
  message: string;
}

export function buildComplexDialogueBenchmarkReport(input: BuildComplexDialogueBenchmarkReportInput): ComplexDialogueBenchmarkReport {
  const events = sortEvents(input.events.map(normalizeTimelineEvent));
  const summary = aggregateComplexDialogueTimeline(events);
  const gateEvaluation = input.gates ? evaluateComplexDialoguePerformanceGates(summary, input.gates) : undefined;
  return stripUndefined({
    schemaVersion: COMPLEX_DIALOGUE_BENCHMARK_REPORT_SCHEMA_VERSION,
    benchmarkId: input.benchmarkId,
    variant: input.variant ?? 'candidate',
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    metadata: input.metadata,
    timeline: { events, summary },
    gates: input.gates,
    gateEvaluation,
  });
}

export function aggregateComplexDialogueTimeline(events: ComplexDialogueTimelineEvent[]): ComplexDialogueTimelineSummary {
  const sorted = sortEvents(events.map(normalizeTimelineEvent));
  const startMs = sorted[0]?.timeMs ?? 0;
  const endMs = sorted.reduce((max, event) => Math.max(max, event.timeMs + Math.max(0, event.durationMs ?? 0)), startMs);
  const gaps = sorted.slice(1).map((event, index) => Math.max(0, event.timeMs - sorted[index]!.timeMs));
  const tokenUsage = sorted.reduce((acc, event) => {
    acc.input += nonNegative(event.tokens?.input);
    acc.output += nonNegative(event.tokens?.output);
    acc.total += nonNegative(event.tokens?.total);
    acc.cacheRead += nonNegative(event.tokens?.cacheRead);
    acc.cacheWrite += nonNegative(event.tokens?.cacheWrite);
    return acc;
  }, { input: 0, output: 0, total: 0, cacheRead: 0, cacheWrite: 0 });
  if (!tokenUsage.total) tokenUsage.total = tokenUsage.input + tokenUsage.output;

  const lifecycle = aggregateLifecycleMetrics(sorted);
  const summaryWithoutScore = {
    eventCount: sorted.length,
    turnCount: new Set(sorted.map((event) => event.turnIndex).filter((turn): turn is number => turn !== undefined)).size,
    totalDurationMs: Math.max(0, endMs - startMs),
    firstVisibleResponseMs: firstElapsed(sorted, isUserVisibleEvent, startMs),
    firstBackendEventMs: firstElapsed(sorted, (event) => event.category === 'backend', startMs),
    firstPartialResultMs: firstElapsed(sorted, (event) => event.qualitySignals?.partialResult === true, startMs),
    firstFinalResultMs: firstElapsed(sorted, (event) => event.qualitySignals?.finalResult === true, startMs),
    p50InterEventGapMs: percentile(gaps, 50),
    p95InterEventGapMs: percentile(gaps, 95),
    userVisibleEventCount: sorted.filter(isUserVisibleEvent).length,
    backendEventCount: sorted.filter((event) => event.category === 'backend').length,
    toolEventCount: sorted.filter((event) => event.category === 'tool').length,
    progressEventCount: sorted.filter((event) => event.category === 'progress' || event.type.includes('progress')).length,
    partialResultCount: sorted.filter((event) => event.qualitySignals?.partialResult === true).length,
    finalResultCount: sorted.filter((event) => event.qualitySignals?.finalResult === true).length,
    failureCount: sorted.filter((event) => event.category === 'failure' || event.qualitySignals?.failure === true).length,
    recoveryEventCount: sorted.filter((event) => event.category === 'recovery').length,
    recoverableFailureCount: sorted.filter((event) => event.qualitySignals?.recoverable === true).length,
    repeatedWorkCount: sorted.filter((event) => event.qualitySignals?.repeatedWork === true).length,
    staleStateCount: sorted.filter((event) => event.qualitySignals?.staleState === true).length,
    conflictCount: sorted.filter((event) => event.qualitySignals?.conflict === true).length,
    humanBlockedCount: sorted.filter((event) => event.qualitySignals?.humanBlocked === true).length,
    artifactRefCount: sorted.reduce((sum, event) => sum + nonNegative(event.qualitySignals?.artifactRefs), 0),
    evidenceRefCount: sorted.reduce((sum, event) => sum + nonNegative(event.qualitySignals?.evidenceRefs), 0),
    tokenUsage,
    waits: {
      compactionWaitMs: sumPhaseDurations(sorted, 'compaction'),
      verificationWaitMs: sumPhaseDurations(sorted, 'verification'),
      backgroundCompletionMs: sumPhaseDurations(sorted, 'background'),
    },
    lifecycle,
  };
  return stripUndefined({
    ...summaryWithoutScore,
    qualityScore: scoreComplexDialogueQuality(summaryWithoutScore),
  });
}

export function complexDialogueEventFromRuntimeEvent(
  event: WorkspaceRuntimeEvent,
  index = 0,
  options: { startedAtMs?: number } = {},
): ComplexDialogueTimelineEvent {
  const raw = isRecord(event.raw) ? event.raw : {};
  const category = categoryForRuntimeEvent(event);
  const timestampMs = eventTimeMs(event, raw, options.startedAtMs) ?? index;
  const refs = [
    ...refsFromRecord(event as unknown as Record<string, unknown>),
    ...refsFromRecord(raw),
  ];
  return normalizeTimelineEvent({
    id: stringField(raw.id) ?? `${event.type || 'event'}-${index}`,
    type: event.type || category,
    category,
    timeMs: timestampMs,
    durationMs: numberField(raw.durationMs) ?? numberField(raw.elapsedMs),
    phase: stringField(raw.phase) ?? stringField(raw.stageId),
    status: event.status ?? stringField(raw.status),
    message: event.message ?? event.detail ?? event.text,
    refs,
    tokens: event.usage,
    qualitySignals: inferQualitySignals(event, raw, category, refs),
    raw: Object.keys(raw).length ? raw : undefined,
  });
}

export function evaluateComplexDialoguePerformanceGates(
  summary: ComplexDialogueTimelineSummary,
  gates: ComplexDialoguePerformanceGates,
): ComplexDialogueGateEvaluation {
  const results: ComplexDialogueGateResult[] = [];
  addMaxGate(results, 'maxFirstVisibleMs', summary.firstVisibleResponseMs, gates.maxFirstVisibleMs, 'first visible response');
  addMaxGate(results, 'maxFirstBackendMs', summary.firstBackendEventMs, gates.maxFirstBackendMs, 'first backend event');
  addMaxGate(results, 'maxTotalDurationMs', summary.totalDurationMs, gates.maxTotalDurationMs, 'total duration');
  addMaxGate(results, 'maxP95InterEventGapMs', summary.p95InterEventGapMs, gates.maxP95InterEventGapMs, 'p95 inter-event gap');
  addMaxGate(results, 'maxCompactionWaitMs', summary.waits.compactionWaitMs, gates.maxCompactionWaitMs, 'compaction wait');
  addMaxGate(results, 'maxVerificationWaitMs', summary.waits.verificationWaitMs, gates.maxVerificationWaitMs, 'verification wait');
  addMaxGate(results, 'maxBackgroundCompletionMs', summary.waits.backgroundCompletionMs, gates.maxBackgroundCompletionMs, 'background completion');
  addMaxGate(results, 'maxRepeatedWorkCount', summary.repeatedWorkCount, gates.maxRepeatedWorkCount, 'repeated work');
  addMaxGate(results, 'maxFailureCount', summary.failureCount, gates.maxFailureCount, 'failures');
  addMinGate(results, 'minProgressEventCount', summary.progressEventCount, gates.minProgressEventCount, 'progress events');
  addMinGate(results, 'minRecoveryEventCount', summary.recoveryEventCount, gates.minRecoveryEventCount, 'recovery events');
  addMinGate(results, 'minLifecycleRecoveryRate', summary.lifecycle.lifecycleRecoveryRate, gates.minLifecycleRecoveryRate, 'lifecycle recovery rate');
  addMinGate(results, 'minQualityScore', summary.qualityScore, gates.minQualityScore, 'quality score');
  return { passed: results.every((result) => result.passed), results };
}

export function compareComplexDialogueBenchmarkReports(
  baseline: ComplexDialogueBenchmarkReport,
  optimized: ComplexDialogueBenchmarkReport,
  generatedAt = new Date().toISOString(),
): ComplexDialogueBenchmarkComparison {
  const before = baseline.timeline.summary;
  const after = optimized.timeline.summary;
  return {
    schemaVersion: COMPLEX_DIALOGUE_BENCHMARK_COMPARISON_SCHEMA_VERSION,
    benchmarkId: optimized.benchmarkId || baseline.benchmarkId,
    generatedAt,
    baselineVariant: baseline.variant,
    optimizedVariant: optimized.variant,
    deltas: {
      firstVisibleResponseMs: delta(after.firstVisibleResponseMs, before.firstVisibleResponseMs),
      firstBackendEventMs: delta(after.firstBackendEventMs, before.firstBackendEventMs),
      totalDurationMs: after.totalDurationMs - before.totalDurationMs,
      p95InterEventGapMs: after.p95InterEventGapMs - before.p95InterEventGapMs,
      qualityScore: round(after.qualityScore - before.qualityScore, 4),
      progressEventCount: after.progressEventCount - before.progressEventCount,
      failureCount: after.failureCount - before.failureCount,
      repeatedWorkCount: after.repeatedWorkCount - before.repeatedWorkCount,
      lifecycleRecoveryRate: round(after.lifecycle.lifecycleRecoveryRate - before.lifecycle.lifecycleRecoveryRate, 4),
    },
    speedups: {
      firstVisibleResponsePercent: speedupPercent(before.firstVisibleResponseMs, after.firstVisibleResponseMs),
      firstBackendEventPercent: speedupPercent(before.firstBackendEventMs, after.firstBackendEventMs),
      totalDurationPercent: speedupPercent(before.totalDurationMs, after.totalDurationMs) ?? 0,
      p95InterEventGapPercent: speedupPercent(before.p95InterEventGapMs, after.p95InterEventGapMs) ?? 0,
    },
    gateComparison: {
      baselinePassed: baseline.gateEvaluation?.passed,
      optimizedPassed: optimized.gateEvaluation?.passed,
      optimizedFailedGateNames: optimized.gateEvaluation?.results.filter((result) => !result.passed).map((result) => result.name) ?? [],
    },
    baseline: before,
    optimized: after,
  };
}

export function evaluateComplexDialogueRegressionGuard(
  comparison: ComplexDialogueBenchmarkComparison,
  options: ComplexDialogueRegressionGuardOptions = {},
): ComplexDialogueRegressionGuardResult {
  const settings = {
    maxFirstVisibleSlowdownPercent: options.maxFirstVisibleSlowdownPercent ?? 10,
    maxFirstBackendSlowdownPercent: options.maxFirstBackendSlowdownPercent ?? 10,
    maxTotalSlowdownPercent: options.maxTotalSlowdownPercent ?? 10,
    maxP95GapSlowdownPercent: options.maxP95GapSlowdownPercent ?? 15,
    maxQualityScoreDrop: options.maxQualityScoreDrop ?? 0.03,
    maxNewFailures: options.maxNewFailures ?? 0,
    maxNewRepeatedWork: options.maxNewRepeatedWork ?? 0,
    requireOptimizedGatePass: options.requireOptimizedGatePass ?? true,
  };
  const regressions: string[] = [];
  const improvements: string[] = [];
  checkSlowdown(regressions, improvements, 'first visible response', comparison.speedups.firstVisibleResponsePercent, settings.maxFirstVisibleSlowdownPercent);
  checkSlowdown(regressions, improvements, 'first backend event', comparison.speedups.firstBackendEventPercent, settings.maxFirstBackendSlowdownPercent);
  checkSlowdown(regressions, improvements, 'total duration', comparison.speedups.totalDurationPercent, settings.maxTotalSlowdownPercent);
  checkSlowdown(regressions, improvements, 'p95 inter-event gap', comparison.speedups.p95InterEventGapPercent, settings.maxP95GapSlowdownPercent);
  if (comparison.deltas.qualityScore < -settings.maxQualityScoreDrop) {
    regressions.push(`quality score dropped by ${Math.abs(comparison.deltas.qualityScore).toFixed(3)}`);
  } else if (comparison.deltas.qualityScore > 0) {
    improvements.push(`quality score improved by ${comparison.deltas.qualityScore.toFixed(3)}`);
  }
  if (comparison.deltas.failureCount > settings.maxNewFailures) regressions.push(`failure count increased by ${comparison.deltas.failureCount}`);
  if (comparison.deltas.failureCount < 0) improvements.push(`failure count decreased by ${Math.abs(comparison.deltas.failureCount)}`);
  if (comparison.deltas.repeatedWorkCount > settings.maxNewRepeatedWork) regressions.push(`repeated work increased by ${comparison.deltas.repeatedWorkCount}`);
  if (comparison.deltas.repeatedWorkCount < 0) improvements.push(`repeated work decreased by ${Math.abs(comparison.deltas.repeatedWorkCount)}`);
  if (settings.requireOptimizedGatePass && comparison.gateComparison.optimizedPassed === false) {
    regressions.push(`optimized report failed gates: ${comparison.gateComparison.optimizedFailedGateNames.join(', ') || 'unknown'}`);
  }
  return { passed: regressions.length === 0, regressions, improvements };
}

export function validateComplexDialogueBenchmarkReport(value: unknown): { ok: boolean; issues: ComplexDialogueValidationIssue[] } {
  const issues: ComplexDialogueValidationIssue[] = [];
  if (!isRecord(value)) return { ok: false, issues: [{ path: '', message: 'report must be an object' }] };
  if (value.schemaVersion !== COMPLEX_DIALOGUE_BENCHMARK_REPORT_SCHEMA_VERSION) issues.push({ path: 'schemaVersion', message: 'unsupported schema version' });
  if (!stringField(value.benchmarkId)) issues.push({ path: 'benchmarkId', message: 'benchmarkId is required' });
  if (!stringField(value.variant)) issues.push({ path: 'variant', message: 'variant is required' });
  const timeline = isRecord(value.timeline) ? value.timeline : undefined;
  if (!timeline) {
    issues.push({ path: 'timeline', message: 'timeline is required' });
  } else {
    if (!Array.isArray(timeline.events)) issues.push({ path: 'timeline.events', message: 'timeline.events must be an array' });
    if (!isRecord(timeline.summary)) issues.push({ path: 'timeline.summary', message: 'timeline.summary is required' });
  }
  return { ok: issues.length === 0, issues };
}

export async function writeComplexDialogueBenchmarkReport(path: string, report: ComplexDialogueBenchmarkReport): Promise<void> {
  const validation = validateComplexDialogueBenchmarkReport(report);
  if (!validation.ok) throw new Error(`Invalid complex dialogue benchmark report: ${validation.issues.map((issue) => `${issue.path}: ${issue.message}`).join('; ')}`);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

function normalizeTimelineEvent(event: ComplexDialogueTimelineEvent): ComplexDialogueTimelineEvent {
  const id = stringField(event.id) ?? `${event.category || 'event'}-${Math.max(0, Math.round(event.timeMs || 0))}`;
  return stripUndefined({
    ...event,
    id,
    type: stringField(event.type) ?? event.category,
    timeMs: nonNegative(event.timeMs),
    durationMs: event.durationMs === undefined ? undefined : nonNegative(event.durationMs),
    refs: event.refs ? Array.from(new Set(event.refs.filter(Boolean))) : undefined,
  });
}

function aggregateLifecycleMetrics(events: ComplexDialogueTimelineEvent[]): ComplexDialogueLifecycleMetrics {
  const count = (kind: ComplexDialogueLifecycleKind) => events.filter((event) => lifecycleKind(event) === kind).length;
  const disruptive = events.filter((event) =>
    event.category === 'lifecycle'
    && ['restart', 'refresh', 'resume', 'interruption', 'history-edit', 'branch', 'conflict', 'cross-session', 'cancellation'].includes(lifecycleKind(event) ?? '')
  ).length;
  const recoveredLifecycleCount = events.filter((event) =>
    event.category === 'recovery'
    || (event.category === 'lifecycle' && ['completed', 'recovered', 'continued', 'merged'].includes(String(event.status ?? '').toLowerCase()))
  ).length;
  return {
    restartCount: count('restart'),
    refreshCount: count('refresh'),
    resumeCount: count('resume'),
    interruptionCount: count('interruption'),
    historyEditCount: count('history-edit'),
    revertCount: count('revert'),
    continueCount: count('continue'),
    branchCount: count('branch'),
    mergeCount: count('merge'),
    cancellationCount: count('cancellation'),
    crossSessionCount: count('cross-session'),
    conflictCount: count('conflict'),
    recoveredLifecycleCount,
    lifecycleRecoveryRate: disruptive ? round(Math.min(1, recoveredLifecycleCount / disruptive), 4) : 1,
  };
}

function scoreComplexDialogueQuality(summary: Omit<ComplexDialogueTimelineSummary, 'qualityScore'>): number {
  const progressCoverage = summary.eventCount ? Math.min(1, summary.progressEventCount / Math.max(1, summary.turnCount || 1)) : 0;
  const recoveryRate = summary.recoverableFailureCount ? Math.min(1, summary.recoveryEventCount / summary.recoverableFailureCount) : 1;
  const evidencePresence = summary.evidenceRefCount > 0 ? 1 : 0;
  const artifactPresence = summary.artifactRefCount > 0 ? 1 : 0;
  const finalPresence = summary.finalResultCount > 0 ? 1 : 0;
  const penalties = Math.min(0.6, (summary.failureCount * 0.08) + (summary.repeatedWorkCount * 0.08) + (summary.staleStateCount * 0.06) + (summary.conflictCount * 0.06));
  return round(clamp((progressCoverage * 0.25) + (recoveryRate * 0.25) + (evidencePresence * 0.15) + (artifactPresence * 0.1) + (finalPresence * 0.15) + (summary.lifecycle.lifecycleRecoveryRate * 0.1) - penalties, 0, 1), 4);
}

function categoryForRuntimeEvent(event: WorkspaceRuntimeEvent): ComplexDialogueEventCategory {
  const text = `${event.type} ${event.source ?? ''} ${event.status ?? ''}`.toLowerCase();
  if (text.includes('user-turn') || text.includes('user-message')) return 'user';
  if (text.includes('assistant') || text.includes('result-final')) return 'assistant';
  if (text.includes('contextcompaction') || text.includes('compaction')) return 'compaction';
  if (text.includes('background')) return 'background';
  if (text.includes('verification') || text.includes('verifier')) return 'verification';
  if (text.includes('artifact')) return 'artifact';
  if (text.includes('repair') || text.includes('recover')) return 'recovery';
  if (/(resume|restart|refresh|history|branch|merge|cancel|interrupt|cross-session|conflict)/.test(text)) return 'lifecycle';
  if (/(failed|failure|error|timeout)/.test(text)) return 'failure';
  if (text.includes('tool') || text.includes('capability') || text.includes('action')) return 'tool';
  if (text.includes('backend') || event.text || event.output) return 'backend';
  if (text.includes('progress') || event.message || event.detail) return 'progress';
  return 'diagnostic';
}

function inferQualitySignals(
  event: WorkspaceRuntimeEvent,
  raw: Record<string, unknown>,
  category: ComplexDialogueEventCategory,
  refs: string[],
): ComplexDialogueTimelineEvent['qualitySignals'] {
  const text = `${event.type} ${event.status ?? ''} ${event.message ?? ''} ${event.detail ?? ''} ${event.text ?? ''}`.toLowerCase();
  const evidenceRefs = refs.filter((ref) => /evidence|trace|log|raw|result/.test(ref)).length + (event.workEvidence?.length ?? 0);
  const artifactRefs = refs.filter((ref) => /artifact/.test(ref)).length;
  return stripUndefined({
    userVisible: category !== 'user' && Boolean(event.message || event.detail || event.text || category === 'assistant' || category === 'progress'),
    partialResult: text.includes('partial') || text.includes('first result'),
    finalResult: text.includes('final') || text.includes('completed') || text.includes('complete'),
    failure: category === 'failure',
    recoverable: text.includes('recover') || text.includes('repair') || Array.isArray(raw.recoverActions),
    repeatedWork: text.includes('repeated') || text.includes('duplicate'),
    staleState: text.includes('stale') || text.includes('expired'),
    conflict: text.includes('conflict'),
    humanBlocked: text.includes('needs-human') || text.includes('human approval') || text.includes('clarification'),
    evidenceRefs: evidenceRefs || undefined,
    artifactRefs: artifactRefs || undefined,
    lifecycleKind: lifecycleKindFromText(text),
  });
}

function sumPhaseDurations(events: ComplexDialogueTimelineEvent[], category: ComplexDialogueEventCategory): number {
  let total = 0;
  const started = new Map<string, number>();
  for (const event of events.filter((item) => item.category === category)) {
    if (event.durationMs !== undefined) {
      total += Math.max(0, event.durationMs);
      continue;
    }
    const key = `${event.runId ?? 'run'}:${event.phase ?? category}`;
    const status = String(event.status ?? '').toLowerCase();
    if (['started', 'running', 'pending'].includes(status) && !started.has(key)) started.set(key, event.timeMs);
    if (['completed', 'failed', 'skipped', 'cancelled'].includes(status) && started.has(key)) {
      total += Math.max(0, event.timeMs - started.get(key)!);
      started.delete(key);
    }
  }
  return Math.round(total);
}

function addMaxGate(
  results: ComplexDialogueGateResult[],
  name: keyof ComplexDialoguePerformanceGates,
  actual: number | undefined,
  expected: number | undefined,
  label: string,
): void {
  if (expected === undefined) return;
  const passed = actual !== undefined && actual <= expected;
  results.push({
    name,
    passed,
    actual,
    expected,
    direction: 'max',
    severity: passed ? 'warning' : 'failure',
    message: `${label} ${actual ?? 'n/a'} <= ${expected}`,
  });
}

function addMinGate(
  results: ComplexDialogueGateResult[],
  name: keyof ComplexDialoguePerformanceGates,
  actual: number | undefined,
  expected: number | undefined,
  label: string,
): void {
  if (expected === undefined) return;
  const passed = actual !== undefined && actual >= expected;
  results.push({
    name,
    passed,
    actual,
    expected,
    direction: 'min',
    severity: passed ? 'warning' : 'failure',
    message: `${label} ${actual ?? 'n/a'} >= ${expected}`,
  });
}

function checkSlowdown(regressions: string[], improvements: string[], label: string, speedup: number | undefined, allowedSlowdownPercent: number): void {
  if (speedup === undefined) return;
  if (speedup < -allowedSlowdownPercent) regressions.push(`${label} slowed by ${Math.abs(speedup).toFixed(1)}%`);
  if (speedup > 0) improvements.push(`${label} improved by ${speedup.toFixed(1)}%`);
}

function firstElapsed(events: ComplexDialogueTimelineEvent[], predicate: (event: ComplexDialogueTimelineEvent) => boolean, startMs: number): number | undefined {
  const event = events.find(predicate);
  return event ? Math.max(0, Math.round(event.timeMs - startMs)) : undefined;
}

function isUserVisibleEvent(event: ComplexDialogueTimelineEvent): boolean {
  if (event.qualitySignals?.userVisible !== undefined) return event.qualitySignals.userVisible;
  return ['assistant', 'progress', 'artifact', 'failure', 'recovery'].includes(event.category);
}

function lifecycleKind(event: ComplexDialogueTimelineEvent): ComplexDialogueLifecycleKind | undefined {
  return event.qualitySignals?.lifecycleKind ?? lifecycleKindFromText(`${event.type} ${event.status ?? ''} ${event.message ?? ''}`.toLowerCase());
}

function lifecycleKindFromText(text: string): ComplexDialogueLifecycleKind | undefined {
  if (text.includes('cross-session') || text.includes('cross device')) return 'cross-session';
  if (text.includes('restart')) return 'restart';
  if (text.includes('refresh')) return 'refresh';
  if (text.includes('resume')) return 'resume';
  if (text.includes('interrupt') || text.includes('stop')) return 'interruption';
  if (text.includes('history-edit') || text.includes('edit')) return 'history-edit';
  if (text.includes('revert')) return 'revert';
  if (text.includes('continue')) return 'continue';
  if (text.includes('branch')) return 'branch';
  if (text.includes('merge')) return 'merge';
  if (text.includes('cancel')) return 'cancellation';
  if (text.includes('conflict')) return 'conflict';
  return undefined;
}

function eventTimeMs(event: WorkspaceRuntimeEvent, raw: Record<string, unknown>, startedAtMs?: number): number | undefined {
  const explicit = numberField(raw.timeMs) ?? numberField(raw.elapsedMs) ?? numberField(raw.timestampMs);
  if (explicit !== undefined) return explicit;
  const timestamp = stringField(raw.timestamp) ?? stringField(raw.createdAt) ?? stringField(raw.startedAt);
  if (!timestamp) return undefined;
  const parsed = Date.parse(timestamp);
  if (!Number.isFinite(parsed)) return undefined;
  return startedAtMs === undefined ? parsed : Math.max(0, parsed - startedAtMs);
}

function refsFromRecord(record: Record<string, unknown>): string[] {
  return [
    ...toStringList(record.refs),
    ...toStringList(record.evidenceRefs),
    ...toStringList(record.artifactRefs),
    ...toStringList(record.diagnosticsRefs),
    stringField(record.ref),
    stringField(record.rawRef),
    stringField(record.outputRef),
    stringField(record.stdoutRef),
    stringField(record.stderrRef),
  ].filter((value): value is string => Boolean(value));
}

function sortEvents(events: ComplexDialogueTimelineEvent[]): ComplexDialogueTimelineEvent[] {
  return [...events].sort((left, right) => left.timeMs - right.timeMs || left.id.localeCompare(right.id));
}

function percentile(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return Math.round(sorted[Math.max(0, index)] ?? 0);
}

function speedupPercent(before?: number, after?: number): number | undefined {
  if (before === undefined || after === undefined || before <= 0) return undefined;
  return round(((before - after) / before) * 100, 2);
}

function delta(after?: number, before?: number): number | undefined {
  return after === undefined || before === undefined ? undefined : after - before;
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round(value: number, digits = 0): number {
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

function stripUndefined<T extends object>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined)) as T;
}
