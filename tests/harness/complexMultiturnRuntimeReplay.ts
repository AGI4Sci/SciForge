import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import {
  buildComplexDialogueBenchmarkReport,
  complexDialogueEventFromRuntimeEvent,
  validateComplexDialogueBenchmarkReport,
  type ComplexDialogueBenchmarkReport,
  type ComplexDialoguePerformanceGates,
  type ComplexDialogueTimelineEvent,
} from '../../src/runtime/gateway/complex-dialogue-metrics';
import type { WorkspaceRuntimeEvent } from '../../src/runtime/runtime-types';

export const COMPLEX_MULTITURN_RUNTIME_REPLAY_SCHEMA_VERSION = 'sciforge.complex-multiturn-runtime-replay.v1' as const;
export const COMPLEX_MULTITURN_RUNTIME_REPLAY_SUMMARY_SCHEMA_VERSION = 'sciforge.complex-multiturn-runtime-replay-summary.v1' as const;

export type ComplexMultiturnRuntimeReplaySourceKind = 'workspace-runtime-events' | 'session-runtime-events';

export interface ComplexMultiturnRuntimeReplayMetrics {
  artifactReferenceAccuracy: boolean;
  runReferenceAccuracy: boolean;
  resumeCorrectness: boolean;
  historyMutationCorrectness: boolean;
  recoverySuccess: boolean;
  sideEffectDuplicationPrevented: boolean;
  verifyLatencyMs: number;
  blockingVerifyRate: number;
  backgroundVerifyFailureRecoveryRate: number;
}

export interface ComplexMultiturnRuntimeReplaySummary {
  schemaVersion: typeof COMPLEX_MULTITURN_RUNTIME_REPLAY_SUMMARY_SCHEMA_VERSION;
  eventCount: number;
  timelineEventCount: number;
  firstVisibleResponseMs?: number;
  artifactRefCount: number;
  runRefCount: number;
  executionUnitRefCount: number;
  diagnosticRefCount: number;
  failureCount: number;
  recoveryEventCount: number;
  repeatedWorkCount: number;
  resumeCount: number;
  historyMutationCount: number;
  lifecycleRecoveryRate: number;
  verifyLatencyMs: number;
  blockingVerifyRate: number;
  backgroundVerifyFailureRecoveryRate: number;
  metrics: ComplexMultiturnRuntimeReplayMetrics;
}

export interface RuntimeReplayBundleExtraction {
  events: WorkspaceRuntimeEvent[];
  sourceKind: ComplexMultiturnRuntimeReplaySourceKind;
  bundleSchemaVersion?: string;
  sessionId?: string;
}

export interface ComplexMultiturnRuntimeReplayReport {
  schemaVersion: typeof COMPLEX_MULTITURN_RUNTIME_REPLAY_SCHEMA_VERSION;
  generatedAt: string;
  source: {
    kind: ComplexMultiturnRuntimeReplaySourceKind;
    eventCount: number;
    startedAtMs?: number;
    bundleSchemaVersion?: string;
    sessionId?: string;
  };
  benchmarkReport: ComplexDialogueBenchmarkReport;
  replaySummary: ComplexMultiturnRuntimeReplaySummary;
  coverage: {
    firstVisibleResponseMs?: number;
    artifactRefs: string[];
    runRefs: string[];
    executionUnitRefs: string[];
    diagnosticRefs: string[];
    primaryOutputRefs: string[];
    rawDiagnosticRefs: string[];
    resumePreflightSeen: boolean;
    historyBranchRecordSeen: boolean;
    recoveryPlanSeen: boolean;
    rawDiagnosticsFoldedByContract: boolean;
  };
  metrics: ComplexMultiturnRuntimeReplayMetrics;
}

export interface BuildComplexMultiturnRuntimeReplayInput {
  events: WorkspaceRuntimeEvent[];
  benchmarkId?: string;
  generatedAt?: string;
  sourceKind?: ComplexMultiturnRuntimeReplaySourceKind;
  bundleSchemaVersion?: string;
  sessionId?: string;
  gates?: ComplexDialoguePerformanceGates;
}

export interface BuildComplexMultiturnRuntimeReplayFromBundleOptions extends Omit<BuildComplexMultiturnRuntimeReplayInput, 'events' | 'sourceKind' | 'bundleSchemaVersion' | 'sessionId'> {
  sourceKind?: ComplexMultiturnRuntimeReplaySourceKind;
}

export function buildComplexMultiturnRuntimeReplayReport(input: BuildComplexMultiturnRuntimeReplayInput): ComplexMultiturnRuntimeReplayReport {
  const startedAtMs = firstTimestamp(input.events);
  const timelineEvents = input.events.map((event, index) => normalizeRuntimeReplayTimelineEvent(
    complexDialogueEventFromRuntimeEvent(event, index, { startedAtMs }),
    event,
  ));
  const benchmarkReport = buildComplexDialogueBenchmarkReport({
    benchmarkId: input.benchmarkId ?? 'complex-multiturn-runtime-replay',
    variant: 'candidate',
    generatedAt: input.generatedAt,
    events: timelineEvents,
    gates: input.gates ?? defaultRuntimeReplayGates(timelineEvents),
    metadata: {
      source: 'workspace-runtime-events',
      runtimeEventCount: input.events.length,
    },
  });
  const coverage = coverageForTimelineEvents(timelineEvents);
  return {
    schemaVersion: COMPLEX_MULTITURN_RUNTIME_REPLAY_SCHEMA_VERSION,
    generatedAt: benchmarkReport.generatedAt,
    source: {
      kind: input.sourceKind ?? 'workspace-runtime-events',
      eventCount: input.events.length,
      startedAtMs,
      bundleSchemaVersion: input.bundleSchemaVersion,
      sessionId: input.sessionId,
    },
    benchmarkReport,
    replaySummary: runtimeReplaySummary(benchmarkReport, coverage),
    coverage,
    metrics: runtimeReplayMetrics(benchmarkReport, coverage, timelineEvents),
  };
}

export function buildComplexMultiturnRuntimeReplayReportFromBundle(
  bundle: unknown,
  options: BuildComplexMultiturnRuntimeReplayFromBundleOptions = {},
): ComplexMultiturnRuntimeReplayReport {
  const extraction = extractWorkspaceRuntimeEventsFromReplayBundle(bundle);
  return buildComplexMultiturnRuntimeReplayReport({
    ...options,
    events: extraction.events,
    sourceKind: options.sourceKind ?? extraction.sourceKind,
    bundleSchemaVersion: extraction.bundleSchemaVersion,
    sessionId: extraction.sessionId,
  });
}

export async function readComplexMultiturnRuntimeReplayBundle(path: string): Promise<RuntimeReplayBundleExtraction> {
  return extractWorkspaceRuntimeEventsFromReplayBundle(JSON.parse(await readFile(path, 'utf8')) as unknown);
}

export function extractWorkspaceRuntimeEventsFromReplayBundle(value: unknown): RuntimeReplayBundleExtraction {
  const bundle = isRecord(value) ? value : undefined;
  const session = isRecord(bundle?.session) ? bundle.session : undefined;
  const runtime = isRecord(bundle?.runtime) ? bundle.runtime : undefined;
  const records = isRecord(bundle?.records) ? bundle.records : undefined;
  const events = Array.isArray(value)
    ? value
    : Array.isArray(bundle?.events)
      ? bundle.events
      : Array.isArray(bundle?.runtimeEvents)
        ? bundle.runtimeEvents
        : Array.isArray(session?.runtimeEvents)
          ? session.runtimeEvents
          : Array.isArray(session?.events)
            ? session.events
            : Array.isArray(runtime?.runtimeEvents)
              ? runtime.runtimeEvents
              : Array.isArray(runtime?.events)
                ? runtime.events
                : Array.isArray(records?.runtimeEvents)
                  ? records.runtimeEvents
                  : undefined;
  if (!events) {
    throw new Error('Runtime replay bundle must be an array, { events }, { runtimeEvents }, { session: { runtimeEvents } }, { runtime: { events } }, or { records: { runtimeEvents } }.');
  }
  const normalized = events.map((event, index) => normalizeWorkspaceRuntimeEventCandidate(event, index));
  const bundleSchemaVersion = stringField(bundle?.schemaVersion);
  return {
    events: normalized,
    sourceKind: session || bundleSchemaVersion?.includes('session') ? 'session-runtime-events' : 'workspace-runtime-events',
    bundleSchemaVersion,
    sessionId: stringField(bundle?.sessionId) ?? stringField(session?.sessionId) ?? stringField(session?.id),
  };
}

export async function writeComplexMultiturnRuntimeReplayReport(path: string, report: ComplexMultiturnRuntimeReplayReport): Promise<void> {
  assertComplexMultiturnRuntimeReplayReport(report);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
}

export function assertComplexMultiturnRuntimeReplayReport(report: ComplexMultiturnRuntimeReplayReport): void {
  const issues: string[] = [];
  if (report.schemaVersion !== COMPLEX_MULTITURN_RUNTIME_REPLAY_SCHEMA_VERSION) issues.push('schemaVersion');
  if (report.source.eventCount <= 0) issues.push('source.eventCount');
  const validation = validateComplexDialogueBenchmarkReport(report.benchmarkReport);
  if (!validation.ok) issues.push(`benchmarkReport ${validation.issues.map((issue) => issue.path).join(',')}`);
  if (report.benchmarkReport.gateEvaluation?.passed !== true) issues.push('benchmark gates');
  if (report.replaySummary.schemaVersion !== COMPLEX_MULTITURN_RUNTIME_REPLAY_SUMMARY_SCHEMA_VERSION) issues.push('replay summary schemaVersion');
  if (report.replaySummary.eventCount !== report.source.eventCount) issues.push('replay summary eventCount');
  if (report.coverage.firstVisibleResponseMs === undefined) issues.push('first visible response');
  if (!report.metrics.artifactReferenceAccuracy) issues.push('artifact refs');
  if (!report.metrics.runReferenceAccuracy) issues.push('run refs');
  if (!report.metrics.resumeCorrectness) issues.push('resume correctness');
  if (!report.metrics.historyMutationCorrectness) issues.push('history mutation correctness');
  if (!report.metrics.recoverySuccess) issues.push('recovery success');
  if (!report.metrics.sideEffectDuplicationPrevented) issues.push('side effect duplication');
  if (!report.coverage.rawDiagnosticsFoldedByContract) issues.push('raw diagnostics folding boundary');
  if (issues.length) throw new Error(`Invalid complex multiturn runtime replay report: ${issues.join('; ')}`);
}

function runtimeReplaySummary(
  report: ComplexDialogueBenchmarkReport,
  coverage: ComplexMultiturnRuntimeReplayReport['coverage'],
): ComplexMultiturnRuntimeReplaySummary {
  const summary = report.timeline.summary;
  const metrics = runtimeReplayMetrics(report, coverage, report.timeline.events);
  return {
    schemaVersion: COMPLEX_MULTITURN_RUNTIME_REPLAY_SUMMARY_SCHEMA_VERSION,
    eventCount: report.metadata?.runtimeEventCount as number,
    timelineEventCount: summary.eventCount,
    firstVisibleResponseMs: summary.firstVisibleResponseMs,
    artifactRefCount: coverage.artifactRefs.length,
    runRefCount: coverage.runRefs.length,
    executionUnitRefCount: coverage.executionUnitRefs.length,
    diagnosticRefCount: coverage.diagnosticRefs.length,
    failureCount: summary.failureCount,
    recoveryEventCount: summary.recoveryEventCount,
    repeatedWorkCount: summary.repeatedWorkCount,
    resumeCount: summary.lifecycle.resumeCount,
    historyMutationCount: summary.lifecycle.historyEditCount + summary.lifecycle.revertCount + summary.lifecycle.branchCount + summary.lifecycle.mergeCount,
    lifecycleRecoveryRate: summary.lifecycle.lifecycleRecoveryRate,
    verifyLatencyMs: summary.verify.latencyMs,
    blockingVerifyRate: summary.verify.blockingRate,
    backgroundVerifyFailureRecoveryRate: summary.verify.backgroundFailureRecoveryRate,
    metrics,
  };
}

function runtimeReplayMetrics(
  report: ComplexDialogueBenchmarkReport,
  coverage: ComplexMultiturnRuntimeReplayReport['coverage'],
  events: ComplexDialogueTimelineEvent[],
): ComplexMultiturnRuntimeReplayMetrics {
  return {
    artifactReferenceAccuracy: coverage.artifactRefs.length > 0,
    runReferenceAccuracy: coverage.runRefs.length > 0,
    resumeCorrectness: coverage.resumePreflightSeen && report.timeline.summary.lifecycle.resumeCount > 0,
    historyMutationCorrectness: coverage.historyBranchRecordSeen,
    recoverySuccess: report.timeline.summary.failureCount === 0 || (report.timeline.summary.recoveryEventCount > 0 && coverage.recoveryPlanSeen),
    sideEffectDuplicationPrevented: report.timeline.summary.repeatedWorkCount === 0 && hasSideEffectBoundary(events) && !hasActualDuplicateSideEffect(events),
    verifyLatencyMs: report.timeline.summary.verify.latencyMs,
    blockingVerifyRate: report.timeline.summary.verify.blockingRate,
    backgroundVerifyFailureRecoveryRate: report.timeline.summary.verify.backgroundFailureRecoveryRate,
  };
}

function coverageForTimelineEvents(events: ComplexDialogueTimelineEvent[]): ComplexMultiturnRuntimeReplayReport['coverage'] {
  const refs = unique(events.flatMap((event) => event.refs ?? []));
  const rawDiagnosticRefs = refs.filter((ref) => /raw|trace|log|stderr|stdout|diagnostic/i.test(ref));
  const primaryOutputRefs = unique(events.filter(isPrimaryOutputEvent).flatMap((event) => event.refs ?? []));
  const text = events.map((event) => `${event.type} ${event.status ?? ''} ${event.message ?? ''}`).join('\n').toLowerCase();
  return {
    firstVisibleResponseMs: events.find((event) => event.qualitySignals?.userVisible === true)?.timeMs,
    artifactRefs: refs.filter((ref) => /artifact/i.test(ref)),
    runRefs: refs.filter((ref) => /(^|[:/])run[:/]/i.test(ref) || /^run[:/]/i.test(ref)),
    executionUnitRefs: refs.filter((ref) => /execution-unit|unit[:/]/i.test(ref)),
    diagnosticRefs: rawDiagnosticRefs,
    primaryOutputRefs,
    rawDiagnosticRefs,
    resumePreflightSeen: /resume-preflight|resume/.test(text),
    historyBranchRecordSeen: /history-branch-record|history.*branch|branch.*history|revert|merge/.test(text),
    recoveryPlanSeen: /recovery-plan|recover|repair/.test(text),
    rawDiagnosticsFoldedByContract: rawDiagnosticRefs.length > 0
      && rawDiagnosticRefs.every((ref) => !primaryOutputRefs.includes(ref))
      && events.filter((event) => event.refs?.some((ref) => rawDiagnosticRefs.includes(ref))).every((event) => !isPrimaryOutputEvent(event)),
  };
}

function normalizeRuntimeReplayTimelineEvent(event: ComplexDialogueTimelineEvent, runtimeEvent: WorkspaceRuntimeEvent): ComplexDialogueTimelineEvent {
  const refs = unique([...(event.refs ?? []), ...collectRuntimeReplayRefs(runtimeEvent)]);
  const text = `${event.type} ${event.message ?? ''}`.toLowerCase();
  const repeatedWork = event.qualitySignals?.repeatedWork === true && !/avoid|prevent|blocked|skipped|no duplicate|no repeated|idempotent/.test(text);
  return {
    ...event,
    refs,
    qualitySignals: {
      ...(event.qualitySignals ?? {}),
      repeatedWork,
      artifactRefs: refs.filter((ref) => /artifact/i.test(ref)).length || event.qualitySignals?.artifactRefs,
      evidenceRefs: refs.filter((ref) => /evidence|trace|log|raw|result|stdout|stderr/i.test(ref)).length || event.qualitySignals?.evidenceRefs,
    },
  };
}

function normalizeWorkspaceRuntimeEventCandidate(value: unknown, index: number): WorkspaceRuntimeEvent {
  const candidate = isRecord(value) && isRecord(value.event)
    ? value.event
    : isRecord(value) && isRecord(value.runtimeEvent)
      ? value.runtimeEvent
      : value;
  if (!isRecord(candidate) || !stringField(candidate.type)) {
    throw new Error(`Runtime replay event ${index} must be a WorkspaceRuntimeEvent-like object with type.`);
  }
  return candidate as unknown as WorkspaceRuntimeEvent;
}

function isPrimaryOutputEvent(event: ComplexDialogueTimelineEvent): boolean {
  if (event.category === 'assistant' || event.category === 'artifact') return true;
  if (event.qualitySignals?.finalResult === true || event.qualitySignals?.partialResult === true) return true;
  return event.category === 'progress' && event.qualitySignals?.userVisible === true;
}

function defaultRuntimeReplayGates(events: ComplexDialogueTimelineEvent[]): ComplexDialoguePerformanceGates {
  const summaryFailureCount = events.filter((event) => event.category === 'failure' || event.qualitySignals?.failure === true).length;
  return {
    maxFirstVisibleMs: 1500,
    maxRepeatedWorkCount: 0,
    maxFailureCount: summaryFailureCount,
    maxBlockingVerifyRate: 0,
    minBackgroundVerifyFailureRecoveryRate: 1,
    minProgressEventCount: 1,
    minRecoveryEventCount: summaryFailureCount ? 1 : undefined,
    minLifecycleRecoveryRate: 0.5,
    minQualityScore: 0.2,
  };
}

function firstTimestamp(events: WorkspaceRuntimeEvent[]): number | undefined {
  for (const event of events) {
    if (!isRecord(event.raw)) continue;
    const value = stringField(event.raw.timestamp) ?? stringField(event.raw.createdAt) ?? stringField(event.raw.startedAt);
    if (!value) continue;
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function hasSideEffectBoundary(events: ComplexDialogueTimelineEvent[]): boolean {
  return events.some((event) => /side.?effect|duplicate|idempotent|no duplicate/i.test(`${event.type} ${event.message ?? ''} ${(event.refs ?? []).join(' ')}`));
}

function hasActualDuplicateSideEffect(events: ComplexDialogueTimelineEvent[]): boolean {
  return events.some((event) => {
    const text = `${event.type} ${event.status ?? ''} ${event.message ?? ''}`.toLowerCase();
    return /side.?effect/.test(text) && /repeated|duplicated|duplicate.*executed|executed.*duplicate/.test(text) && !/avoid|prevent|blocked|skipped|no duplicate|idempotent/.test(text);
  });
}

function collectRuntimeReplayRefs(value: unknown): string[] {
  const refs: string[] = [];
  visitRuntimeReplayValue(value, refs, 0);
  return unique(refs);
}

function visitRuntimeReplayValue(value: unknown, refs: string[], depth: number): void {
  if (depth > 5) return;
  if (typeof value === 'string') {
    if (looksLikeReplayRef(value)) refs.push(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) visitRuntimeReplayValue(item, refs, depth + 1);
    return;
  }
  if (!isRecord(value)) return;
  if (typeof value.ref === 'string') refs.push(value.ref);
  if (typeof value.runId === 'string') refs.push(value.runId.startsWith('run:') ? value.runId : `run:${value.runId}`);
  if (typeof value.artifactId === 'string') refs.push(value.artifactId.startsWith('artifact:') ? value.artifactId : `artifact:${value.artifactId}`);
  if (typeof value.executionUnitId === 'string') refs.push(value.executionUnitId.startsWith('execution-unit:') ? value.executionUnitId : `execution-unit:${value.executionUnitId}`);
  if (value.kind === 'run' && typeof value.id === 'string') refs.push(value.id.startsWith('run:') ? value.id : `run:${value.id}`);
  if (value.kind === 'artifact' && typeof value.id === 'string') refs.push(value.id.startsWith('artifact:') ? value.id : `artifact:${value.id}`);
  for (const [key, entry] of Object.entries(value)) {
    if (/refs?$|artifactRefs|runRefs|diagnosticRefs|evidenceRefs|objectReferences|workEvidence|artifacts|executionUnits|logs/i.test(key)) {
      visitRuntimeReplayValue(entry, refs, depth + 1);
    } else if (typeof entry === 'string' && looksLikeReplayRef(entry)) {
      refs.push(entry);
    }
  }
}

function looksLikeReplayRef(value: string): boolean {
  return /^(artifact|run|execution-unit|unit|trace|raw|log|stdout|stderr|diagnostic|evidence|checkpoint)[:/]/i.test(value);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter(Boolean)));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
