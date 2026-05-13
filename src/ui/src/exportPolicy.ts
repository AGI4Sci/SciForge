import { nowIso, type SciForgeRun, type SciForgeSession, type RuntimeArtifact, type RuntimeExecutionUnit } from './domain';
import {
  runtimeArtifactDataRefSource,
  runtimeArtifactPathRefSource,
  runtimeArtifactRef,
} from '@sciforge-ui/runtime-contract/artifacts';

type ExportBundleRefBoundary = 'event-log-truth' | 'restored-projection' | 'artifact-summary' | 'audit-only-raw-attachment';

export interface ExportPolicyDecision {
  allowed: boolean;
  blockedArtifactIds: string[];
  restrictedArtifactIds: string[];
  sensitiveFlags: string[];
  warnings: string[];
}

export interface ExecutionBundleExportOptions {
  activeRun?: SciForgeRun;
  executionUnits?: RuntimeExecutionUnit[];
}

export interface ExportBundleFinalShape {
  schemaVersion: 'sciforge.export-bundle-final-shape.v1';
  truthSource: 'ConversationEventLog';
  projectionRestore: {
    source: 'conversation-event-log';
    restoredCount: number;
    missingEventLogRunIds: string[];
  };
  conversationEventLogs: Array<{
    runId: string;
    ref?: string;
    digest?: string;
    eventLog: ConversationEventLogForExport;
  }>;
  restoredConversationProjections: Array<{
    runId: string;
    projection: RestoredConversationProjectionForExport;
  }>;
  refsManifest: {
    schemaVersion: 'sciforge.export-bundle.refs-manifest.v1';
    refs: Array<{
      ref: string;
      boundary: ExportBundleRefBoundary;
      sources: string[];
      digest?: string;
      mime?: string;
      sizeBytes?: number;
      label?: string;
    }>;
  };
  auditOnlyRawAttachments: {
    boundary: 'audit-only';
    note: string;
    runs: Array<{
      id: string;
      status: SciForgeRun['status'];
      responsePresent: boolean;
      rawPresent: boolean;
      rawRefs: string[];
    }>;
    executionUnits: Array<{
      id: string;
      status: RuntimeExecutionUnit['status'];
      tool: string;
      refs: string[];
    }>;
  };
}

interface ConversationRefForExport {
  ref: string;
  digest?: string;
  mime?: string;
  sizeBytes?: number;
  label?: string;
}

interface ConversationEventForExport {
  id: string;
  type: string;
  timestamp: string;
  actor?: string;
  turnId?: string;
  runId?: string;
  storage: 'inline' | 'ref';
  payload: Record<string, unknown> & { refs?: ConversationRefForExport[] };
}

interface ConversationEventLogForExport {
  schemaVersion: 'sciforge.conversation-event-log.v1';
  conversationId: string;
  events: ConversationEventForExport[];
}

interface RestoredConversationProjectionForExport {
  schemaVersion: 'sciforge.conversation-projection.v1';
  conversationId: string;
  currentTurn?: {
    id: string;
    prompt?: string;
  };
  visibleAnswer?: {
    status: string;
    text?: string;
    artifactRefs: string[];
    diagnostic?: string;
  };
  activeRun?: {
    id: string;
    status: string;
  };
  artifacts: ConversationRefForExport[];
  executionProcess: Array<{
    eventId: string;
    type: string;
    summary: string;
    timestamp: string;
  }>;
  recoverActions: string[];
  verificationState: {
    status: string;
    verifierRef?: string;
    verdict?: string;
  };
  backgroundState?: {
    status: string;
    checkpointRefs: string[];
    revisionPlan: string;
    foregroundPartialRef?: string;
  };
  auditRefs: string[];
  diagnostics: Array<{
    severity: 'error' | 'warning' | 'info';
    code: string;
    message: string;
    eventId?: string;
    refs?: ConversationRefForExport[];
  }>;
}

export function evaluateExecutionBundleExport(session: SciForgeSession, options: ExecutionBundleExportOptions = {}): ExportPolicyDecision {
  const artifacts = scopedArtifacts(session, options.activeRun, uniqueById(options.executionUnits ?? scopedExecutionUnits(session, options.activeRun)));
  const blocked = artifacts.filter((artifact) => artifact.exportPolicy === 'blocked');
  const restricted = artifacts.filter((artifact) => artifact.exportPolicy === 'restricted');
  const sensitiveFlags = unique(artifacts.flatMap((artifact) => artifact.sensitiveDataFlags ?? []));
  const missingAudience = artifacts.filter((artifact) => (
    artifact.exportPolicy === 'restricted'
    && (!artifact.audience || artifact.audience.length === 0)
  ));
  const warnings = [
    ...restricted.map((artifact) => `restricted artifact ${artifact.id} requires audience review`),
    ...missingAudience.map((artifact) => `restricted artifact ${artifact.id} has no explicit audience`),
    ...sensitiveFlags.map((flag) => `sensitive data flag: ${flag}`),
  ];
  return {
    allowed: blocked.length === 0,
    blockedArtifactIds: blocked.map((artifact) => artifact.id),
    restrictedArtifactIds: restricted.map((artifact) => artifact.id),
    sensitiveFlags,
    warnings: unique(warnings),
  };
}

export function buildExecutionBundle(
  session: SciForgeSession,
  decision = evaluateExecutionBundleExport(session),
  options: ExecutionBundleExportOptions = {},
) {
  if (!decision.allowed) {
    throw new Error(`Export blocked by artifact policy: ${decision.blockedArtifactIds.join(', ')}`);
  }
  const activeRun = options.activeRun;
  const runs = activeRun ? [activeRun] : session.runs;
  const executionUnits = uniqueById(options.executionUnits ?? scopedExecutionUnits(session, activeRun));
  const artifacts = scopedArtifacts(session, activeRun, executionUnits);
  const provenance = buildExportProvenance(session, runs, executionUnits, artifacts);
  const finalShape = buildExportBundleFinalShape({
    runs,
    executionUnits,
    artifacts,
    provenance,
  });
  return {
    schemaVersion: 1,
    sessionId: session.sessionId,
    scenarioId: session.scenarioId,
    activeRunId: activeRun?.id,
    exportedAt: nowIso(),
    exportPolicy: {
      restrictedArtifactIds: decision.restrictedArtifactIds,
      sensitiveDataFlags: decision.sensitiveFlags,
      warnings: decision.warnings,
    },
    sessionBundleRefs: provenance.sessionBundleRefs,
    taskGraph: provenance.taskGraph,
    dataLineage: provenance.dataLineage,
    executionCommands: provenance.executionCommands,
    artifactRefs: provenance.artifactRefs,
    auditRefs: provenance.auditRefs,
    conversationEventLogs: finalShape.conversationEventLogs,
    restoredConversationProjections: finalShape.restoredConversationProjections,
    refsManifest: finalShape.refsManifest,
    auditOnlyRawAttachments: finalShape.auditOnlyRawAttachments,
    finalShape,
    executionUnits,
    artifacts: artifacts.map(summarizeArtifactForExport),
    runs: runs.map((run) => ({
      id: run.id,
      scenarioId: run.scenarioId,
      scenarioPackageRef: run.scenarioPackageRef,
      skillPlanRef: run.skillPlanRef,
      uiPlanRef: run.uiPlanRef,
      status: run.status,
      prompt: run.prompt,
      createdAt: run.createdAt,
      completedAt: run.completedAt,
      sessionBundleRef: sessionBundleRefForRun(run),
    })),
  };
}

export function buildExportBundleFinalShape(input: {
  runs: SciForgeRun[];
  executionUnits: RuntimeExecutionUnit[];
  artifacts: RuntimeArtifact[];
  provenance: ReturnType<typeof buildExportProvenance>;
}): ExportBundleFinalShape {
  const eventLogs = input.runs.flatMap((run) => {
    const candidate = conversationEventLogForRun(run);
    return candidate ? [{
      runId: run.id,
      ref: conversationEventLogRefForRun(run),
      digest: conversationEventLogDigestForRun(run),
      eventLog: candidate,
    }] : [];
  });
  const projections = eventLogs.map((entry) => ({
    runId: entry.runId,
    projection: restoreConversationProjectionForExport(entry.eventLog),
  }));
  const missingEventLogRunIds = input.runs
    .filter((run) => !eventLogs.some((entry) => entry.runId === run.id))
    .map((run) => run.id);
  const refsManifest = buildRefsManifestForExport({
    eventLogs,
    projections,
    artifacts: input.artifacts,
    provenance: input.provenance,
    runs: input.runs,
    executionUnits: input.executionUnits,
  });
  return {
    schemaVersion: 'sciforge.export-bundle-final-shape.v1',
    truthSource: 'ConversationEventLog',
    projectionRestore: {
      source: 'conversation-event-log',
      restoredCount: projections.length,
      missingEventLogRunIds,
    },
    conversationEventLogs: eventLogs,
    restoredConversationProjections: projections,
    refsManifest,
    auditOnlyRawAttachments: {
      boundary: 'audit-only',
      note: 'Raw runs and execution units are included only for audit/debug. Restore main state from ConversationEventLog and restoredConversationProjections.',
      runs: input.runs.map((run) => ({
        id: run.id,
        status: run.status,
        responsePresent: Boolean(run.response),
        rawPresent: run.raw !== undefined,
        rawRefs: runRefs(run),
      })),
      executionUnits: input.executionUnits.map((unit) => ({
        id: unit.id,
        status: unit.status,
        tool: unit.tool,
        refs: executionUnitRefs(unit),
      })),
    },
  };
}

function conversationEventLogForRun(run: SciForgeRun): ConversationEventLogForExport | undefined {
  const candidates = conversationKernelRecordsForRun(run).map((record) => record.conversationEventLog);
  return candidates.map(normalizeConversationEventLogForExport).find(Boolean);
}

function conversationEventLogRefForRun(run: SciForgeRun): string | undefined {
  return conversationKernelRecordsForRun(run)
    .map((record) => stringField(record.conversationEventLogRef))
    .find(Boolean);
}

function conversationEventLogDigestForRun(run: SciForgeRun): string | undefined {
  return conversationKernelRecordsForRun(run)
    .map((record) => stringField(record.conversationEventLogDigest))
    .find(Boolean);
}

function conversationKernelRecordsForRun(run: SciForgeRun): Record<string, unknown>[] {
  const raw = parseJsonRecord(run.raw);
  const response = parseJsonRecord(run.response);
  const displayIntent = parseJsonRecord(raw?.displayIntent);
  const rawResultPresentation = parseJsonRecord(raw?.resultPresentation);
  const displayResultPresentation = parseJsonRecord(displayIntent?.resultPresentation);
  const taskOutcomeProjection = parseJsonRecord(displayIntent?.taskOutcomeProjection);
  const responseResultPresentation = parseJsonRecord(response?.resultPresentation);
  return [
    displayIntent,
    taskOutcomeProjection,
    rawResultPresentation,
    displayResultPresentation,
    responseResultPresentation,
    raw,
    response,
  ].filter((record): record is Record<string, unknown> => Boolean(record));
}

function normalizeConversationEventLogForExport(value: unknown): ConversationEventLogForExport | undefined {
  const record = parseJsonRecord(value);
  if (record?.schemaVersion !== 'sciforge.conversation-event-log.v1') return undefined;
  const conversationId = stringField(record.conversationId);
  if (!conversationId || !Array.isArray(record.events)) return undefined;
  const events = record.events.map(normalizeConversationEventForExport);
  if (events.some((event) => !event)) return undefined;
  return {
    schemaVersion: 'sciforge.conversation-event-log.v1',
    conversationId,
    events: events as ConversationEventForExport[],
  };
}

function normalizeConversationEventForExport(value: unknown): ConversationEventForExport | undefined {
  const event = parseJsonRecord(value);
  const id = stringField(event?.id);
  const type = stringField(event?.type);
  const timestamp = stringField(event?.timestamp);
  const storage = event?.storage === 'ref' ? 'ref' : event?.storage === 'inline' ? 'inline' : undefined;
  const payload = parseJsonRecord(event?.payload);
  if (!event || !id || !type || !timestamp || !storage || !payload) return undefined;
  const refs = storage === 'ref' ? normalizeConversationRefsForExport(payload.refs) : undefined;
  if (storage === 'ref' && (!refs || refs.length === 0)) return undefined;
  return {
    id,
    type,
    timestamp,
    actor: stringField(event.actor),
    turnId: stringField(event.turnId),
    runId: stringField(event.runId),
    storage,
    payload: refs ? { ...payload, refs } : payload,
  };
}

function restoreConversationProjectionForExport(log: ConversationEventLogForExport): RestoredConversationProjectionForExport {
  const state = replayConversationStateForExport(log);
  const currentTurnEvent = [...log.events].reverse().find((event) => event.type === 'TurnReceived');
  const answerEvent = [...log.events].reverse().find((event) => terminalAnswerEventTypes.has(event.type));
  const artifacts = uniqueConversationRefs(log.events.flatMap((event) => event.storage === 'ref' ? event.payload.refs ?? [] : []));
  const auditRefs = unique([
    ...artifacts.map((ref) => ref.ref),
    ...(state.verificationState.verifierRef ? [state.verificationState.verifierRef] : []),
    ...(state.backgroundState?.checkpointRefs ?? []),
  ]);
  return {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: log.conversationId,
    currentTurn: currentTurnEvent ? {
      id: currentTurnEvent.turnId ?? currentTurnEvent.id,
      prompt: stringField(currentTurnEvent.payload.prompt),
    } : undefined,
    visibleAnswer: answerEvent ? {
      status: state.status,
      text: stringField(answerEvent.payload.text),
      artifactRefs: answerEvent.storage === 'ref'
        ? (answerEvent.payload.refs ?? []).map((ref) => ref.ref)
        : asStringArray(answerEvent.payload.artifactRefs),
      diagnostic: state.diagnostics[0]?.message,
    } : undefined,
    activeRun: state.activeRunId ? { id: state.activeRunId, status: state.status } : undefined,
    artifacts,
    executionProcess: log.events.map((event) => ({
      eventId: event.id,
      type: event.type,
      summary: eventSummaryForExport(event),
      timestamp: event.timestamp,
    })),
    recoverActions: recoverActionsForProjectionState(state),
    verificationState: state.verificationState,
    backgroundState: state.backgroundState,
    auditRefs,
    diagnostics: state.diagnostics,
  };
}

const terminalAnswerEventTypes = new Set(['Satisfied', 'DegradedResult', 'ExternalBlocked', 'RepairNeeded', 'NeedsHuman']);

function replayConversationStateForExport(log: ConversationEventLogForExport) {
  let status = 'idle';
  let activeRunId: string | undefined;
  const diagnostics: RestoredConversationProjectionForExport['diagnostics'] = [];
  let verificationState: RestoredConversationProjectionForExport['verificationState'] = { status: 'unverified' };
  let backgroundState: RestoredConversationProjectionForExport['backgroundState'];
  for (const event of log.events) {
    activeRunId = event.runId ?? activeRunId;
    if (event.type === 'TurnReceived' || event.type === 'Planned' || event.type === 'HarnessDecisionRecorded') status = 'planned';
    else if (event.type === 'Dispatched') status = 'dispatched';
    else if (event.type === 'PartialReady') status = 'partial-ready';
    else if (event.type === 'OutputMaterialized') status = 'output-materialized';
    else if (event.type === 'Validated') status = 'validated';
    else if (event.type === 'Satisfied') status = 'satisfied';
    else if (event.type === 'DegradedResult') status = 'degraded-result';
    else if (event.type === 'ExternalBlocked') {
      status = 'external-blocked';
      diagnostics.push(failureDiagnosticForExport(event, 'external-provider'));
    } else if (event.type === 'RepairNeeded') {
      status = 'repair-needed';
      diagnostics.push(failureDiagnosticForExport(event, 'payload-contract'));
    } else if (event.type === 'NeedsHuman') status = 'needs-human';
    else if (event.type === 'BackgroundRunning' || event.type === 'BackgroundCompleted') {
      status = event.type === 'BackgroundCompleted' ? 'degraded-result' : 'background-running';
      backgroundState = backgroundStateForExport(event);
    } else if (event.type === 'VerificationRecorded') {
      verificationState = verificationStateForExport(event);
    }
  }
  return { status, activeRunId, diagnostics, verificationState, backgroundState };
}

function failureDiagnosticForExport(event: ConversationEventForExport, fallbackCode: string): RestoredConversationProjectionForExport['diagnostics'][number] {
  const refs = event.storage === 'ref' ? event.payload.refs ?? [] : [];
  return {
    severity: 'error',
    code: fallbackCode,
    message: stringField(event.payload.reason)
      ?? stringField(event.payload.failureReason)
      ?? stringField(event.payload.summary)
      ?? 'Conversation event recorded a recoverable failure.',
    eventId: event.id,
    refs,
  };
}

function backgroundStateForExport(event: ConversationEventForExport): NonNullable<RestoredConversationProjectionForExport['backgroundState']> {
  return {
    status: event.type === 'BackgroundCompleted' ? 'completed' : 'running',
    checkpointRefs: event.storage === 'ref'
      ? (event.payload.refs ?? []).map((ref) => ref.ref)
      : asStringArray(event.payload.checkpointRefs),
    revisionPlan: stringField(event.payload.revisionPlan) ?? '',
    foregroundPartialRef: stringField(event.payload.foregroundPartialRef),
  };
}

function verificationStateForExport(event: ConversationEventForExport): RestoredConversationProjectionForExport['verificationState'] {
  const verifierRef = event.storage === 'ref' ? event.payload.refs?.[0]?.ref : stringField(event.payload.verifierRef);
  const verdict = stringField(event.payload.verdict);
  if (!verifierRef) return { status: 'unverified', verdict };
  return {
    status: verdict === 'failed' || verdict === 'fail' ? 'failed' : 'verified',
    verifierRef,
    verdict,
  };
}

function recoverActionsForProjectionState(state: ReturnType<typeof replayConversationStateForExport>) {
  if (state.diagnostics.length) return unique(state.diagnostics.map((diagnostic) => diagnostic.message));
  if (state.backgroundState?.revisionPlan) return [state.backgroundState.revisionPlan];
  if (state.status === 'degraded-result') return ['Reuse available refs or request a supplement for missing evidence.'];
  return [];
}

function eventSummaryForExport(event: ConversationEventForExport) {
  return stringField(event.payload.summary)
    ?? stringField(event.payload.prompt)
    ?? stringField(event.payload.text)
    ?? (event.storage === 'ref' ? `${event.type} referenced ${event.payload.refs?.length ?? 0} refs` : event.type);
}

function buildRefsManifestForExport(input: {
  eventLogs: ExportBundleFinalShape['conversationEventLogs'];
  projections: ExportBundleFinalShape['restoredConversationProjections'];
  artifacts: RuntimeArtifact[];
  provenance: ReturnType<typeof buildExportProvenance>;
  runs: SciForgeRun[];
  executionUnits: RuntimeExecutionUnit[];
}): ExportBundleFinalShape['refsManifest'] {
  const refs = new Map<string, ExportBundleFinalShape['refsManifest']['refs'][number]>();
  const add = (ref: string | undefined, boundary: ExportBundleRefBoundary, source: string, meta: Partial<ConversationRefForExport> = {}) => {
    if (!ref) return;
    const existing = refs.get(ref);
    if (existing) {
      existing.sources = unique([...existing.sources, source]);
      existing.boundary = strongerRefBoundary(existing.boundary, boundary);
      return;
    }
    refs.set(ref, {
      ref,
      boundary,
      sources: [source],
      digest: meta.digest,
      mime: meta.mime,
      sizeBytes: meta.sizeBytes,
      label: meta.label,
    });
  };
  for (const entry of input.eventLogs) {
    add(entry.ref, 'event-log-truth', `${entry.runId}:conversationEventLog`, { digest: entry.digest, label: 'ConversationEventLog' });
    for (const event of entry.eventLog.events) {
      for (const ref of event.storage === 'ref' ? event.payload.refs ?? [] : []) {
        add(ref.ref, 'event-log-truth', `${entry.runId}:${event.id}`, ref);
      }
    }
  }
  for (const entry of input.projections) {
    for (const ref of entry.projection.auditRefs) add(ref, 'restored-projection', `${entry.runId}:projection.auditRefs`);
    for (const ref of entry.projection.artifacts) add(ref.ref, 'restored-projection', `${entry.runId}:projection.artifacts`, ref);
  }
  for (const artifact of input.artifacts) {
    add(runtimeArtifactRef(artifact.id), 'artifact-summary', runtimeArtifactRef(artifact.id), { label: artifact.type });
    add(artifact.dataRef, 'artifact-summary', runtimeArtifactDataRefSource(artifact.id));
    add(artifact.path, 'artifact-summary', runtimeArtifactPathRefSource(artifact.id));
  }
  for (const ref of input.provenance.auditRefs) add(ref, 'audit-only-raw-attachment', 'legacy-provenance.auditRefs');
  for (const run of input.runs) {
    for (const ref of runRefs(run)) add(ref, 'audit-only-raw-attachment', `${run.id}:raw-run`);
  }
  for (const unit of input.executionUnits) {
    for (const ref of executionUnitRefs(unit)) add(ref, 'audit-only-raw-attachment', `${unit.id}:execution-unit`);
  }
  return {
    schemaVersion: 'sciforge.export-bundle.refs-manifest.v1',
    refs: Array.from(refs.values()),
  };
}

function strongerRefBoundary(current: ExportBundleRefBoundary, next: ExportBundleRefBoundary): ExportBundleRefBoundary {
  const rank: Record<ExportBundleRefBoundary, number> = {
    'event-log-truth': 4,
    'restored-projection': 3,
    'artifact-summary': 2,
    'audit-only-raw-attachment': 1,
  };
  return rank[next] > rank[current] ? next : current;
}

function normalizeConversationRefsForExport(value: unknown): ConversationRefForExport[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): ConversationRefForExport[] => {
    if (typeof entry === 'string' && entry.trim()) return [{ ref: entry.trim() }];
    const record = parseJsonRecord(entry);
    const ref = asString(record?.ref);
    if (!record || !ref) return [];
    return [{
      ref,
      digest: asString(record.digest),
      mime: asString(record.mime),
      sizeBytes: typeof record.sizeBytes === 'number' ? record.sizeBytes : undefined,
      label: asString(record.label),
    }];
  });
}

function uniqueConversationRefs(refs: ConversationRefForExport[]): ConversationRefForExport[] {
  const byRef = new Map<string, ConversationRefForExport>();
  for (const ref of refs) {
    if (!ref.ref || byRef.has(ref.ref)) continue;
    byRef.set(ref.ref, ref);
  }
  return Array.from(byRef.values());
}

function summarizeArtifactForExport(artifact: RuntimeArtifact) {
  return {
    id: artifact.id,
    type: artifact.type,
    producerScenario: artifact.producerScenario,
    scenarioPackageRef: artifact.scenarioPackageRef,
    schemaVersion: artifact.schemaVersion,
    metadata: artifact.metadata,
    dataRef: artifact.dataRef,
    visibility: artifact.visibility,
    audience: artifact.audience,
    sensitiveDataFlags: artifact.sensitiveDataFlags,
    exportPolicy: artifact.exportPolicy,
  };
}

function unique(values: Array<string | undefined>) {
  return [...new Set(values.filter((value): value is string => typeof value === 'string' && value.trim().length > 0))];
}

function scopedExecutionUnits(session: SciForgeSession, activeRun?: SciForgeRun) {
  if (!activeRun) return session.executionUnits;
  const refs = runRefs(activeRun);
  const artifactIds = new Set(refs.filter((ref) => ref.startsWith('artifact:')).map(stripArtifactPrefix));
  const unitIds = new Set(refs.filter((ref) => ref.startsWith('execution-unit:')).map(stripExecutionUnitPrefix));
  const matched = session.executionUnits.filter((unit) => {
    if (unitIds.has(stripExecutionUnitPrefix(unit.id))) return true;
    const unitRefs = executionUnitRefs(unit);
    if (unitRefs.some((ref) => ref.includes(activeRun.id) || refs.includes(ref))) return true;
    if (unit.outputArtifacts?.some((ref) => artifactIds.has(stripArtifactPrefix(ref)))) return true;
    if (unit.artifacts?.some((ref) => artifactIds.has(stripArtifactPrefix(ref)))) return true;
    return Boolean(unit.outputRef && artifactIds.has(stripArtifactPrefix(unit.outputRef)));
  });
  if (matched.length) return matched;
  return session.runs.length <= 1 ? session.executionUnits : [];
}

function scopedArtifacts(session: SciForgeSession, activeRun: SciForgeRun | undefined, executionUnits: RuntimeExecutionUnit[]) {
  if (!activeRun) return session.artifacts;
  const artifactIds = new Set([
    ...runRefs(activeRun).filter((ref) => ref.startsWith('artifact:')).map(stripArtifactPrefix),
    ...executionUnits.flatMap((unit) => [
      unit.outputRef,
      ...(unit.outputArtifacts ?? []),
      ...(unit.artifacts ?? []),
    ]).filter((ref): ref is string => Boolean(ref)).map(stripArtifactPrefix),
  ]);
  const matched = session.artifacts.filter((artifact) => artifactIds.has(artifact.id) || artifact.metadata?.runId === activeRun.id);
  if (matched.length) return matched;
  return session.runs.length <= 1 ? session.artifacts : [];
}

function buildExportProvenance(
  session: SciForgeSession,
  runs: SciForgeRun[],
  executionUnits: RuntimeExecutionUnit[],
  artifacts: RuntimeArtifact[],
) {
  const artifactRefs = unique(artifacts.flatMap((artifact) => [
    `artifact:${artifact.id}`,
    artifact.dataRef,
    artifact.path,
  ].filter((ref): ref is string => Boolean(ref))));
  const sessionBundleRefs = unique([
    ...runs.flatMap((run) => [
      firstStringRef(run, ['sessionBundleRef', 'sessionBundle', 'bundleRef']),
      ...runRefs(run).filter(isSessionBundleRef),
    ]),
    ...executionUnits.flatMap(executionUnitRefs).filter(isSessionBundleRef),
    ...artifacts.flatMap((artifact) => [artifact.dataRef, artifact.path].filter((ref): ref is string => Boolean(ref))).filter(isSessionBundleRef),
  ]);
  return {
    sessionBundleRefs,
    artifactRefs,
    auditRefs: unique([
      ...sessionBundleRefs,
      ...runs.flatMap(runRefs),
      ...executionUnits.flatMap(executionUnitRefs),
      ...artifactRefs,
    ]),
    taskGraph: {
      nodes: [
        ...runs.map((run) => ({ id: run.id, kind: 'run', status: run.status })),
        ...executionUnits.map((unit) => ({ id: unit.id, kind: 'execution-unit', status: unit.status, tool: unit.tool })),
        ...artifacts.map((artifact) => ({ id: artifact.id, kind: 'artifact', type: artifact.type })),
      ],
      edges: uniqueEdges([
        ...executionUnits.flatMap((unit) => unit.inputData?.map((ref) => ({ from: ref, to: unit.id, kind: 'input' })) ?? []),
        ...executionUnits.flatMap((unit) => [
          unit.outputRef,
          ...(unit.outputArtifacts ?? []),
          ...(unit.artifacts ?? []),
        ].filter((ref): ref is string => Boolean(ref)).map((ref) => ({ from: unit.id, to: graphOutputTarget(ref, artifacts), kind: 'output' }))),
      ]),
    },
    dataLineage: executionUnits.map((unit) => ({
      executionUnitId: unit.id,
      inputRefs: unique(unit.inputData ?? []),
      outputRefs: unique([unit.outputRef, ...(unit.outputArtifacts ?? []), ...(unit.artifacts ?? [])].filter((ref): ref is string => Boolean(ref))),
      codeRef: unit.codeRef,
      stdoutRef: unit.stdoutRef,
      stderrRef: unit.stderrRef,
      verificationRef: unit.verificationRef,
      dataFingerprint: unit.dataFingerprint,
    })),
    executionCommands: executionUnits.map((unit) => ({
      executionUnitId: unit.id,
      tool: unit.tool,
      command: unit.code,
      entrypoint: unit.entrypoint,
      params: unit.params,
      codeRef: unit.codeRef,
      stdoutRef: unit.stdoutRef,
      stderrRef: unit.stderrRef,
      outputRef: unit.outputRef,
    })),
  };
}

function executionUnitRefs(unit: RuntimeExecutionUnit) {
  return [
    unit.id,
    unit.codeRef,
    unit.stdoutRef,
    unit.stderrRef,
    unit.outputRef,
    unit.diffRef,
    unit.verificationRef,
    ...(unit.inputData ?? []),
    ...(unit.outputArtifacts ?? []),
    ...(unit.artifacts ?? []),
  ].filter((ref): ref is string => Boolean(ref));
}

function runRefs(run: SciForgeRun) {
  return unique([
    ...(run.references ?? []).map((reference) => reference.ref),
    ...(run.objectReferences ?? []).flatMap((reference) => [reference.ref, reference.executionUnitId].filter((ref): ref is string => Boolean(ref))),
    ...refsFromUnknown(run.raw),
    ...refsFromUnknown(parseJsonRecord(run.response)),
  ]);
}

function sessionBundleRefForRun(run: SciForgeRun) {
  return firstStringRef(run, ['sessionBundleRef', 'sessionBundle', 'bundleRef'])
    ?? runRefs(run).find(isSessionBundleRef);
}

function refsFromUnknown(value: unknown): string[] {
  const record = parseJsonRecord(value);
  if (!record) return [];
  const nested = [
    record.displayIntent,
    record.taskRunCard,
    record.taskOutcomeProjection,
    record.contractValidationFailure,
    record.validationFailure,
    record.failure,
    record.backendRepair,
    record.acceptanceRepair,
    record.repairState,
    record.backgroundCompletion,
    ...(Array.isArray(record.taskRunCards) ? record.taskRunCards : []),
    ...(Array.isArray(record.contractValidationFailures) ? record.contractValidationFailures : []),
    ...(Array.isArray(record.validationFailures) ? record.validationFailures : []),
    ...(Array.isArray(record.failures) ? record.failures : []),
    ...(Array.isArray(record.stages) ? record.stages : []),
  ];
  return [
    asString(record.ref),
    firstStringRef(record, ['sessionBundleRef', 'sessionBundle', 'bundleRef']),
    ...asStringArray(record.refs),
    ...refsFromRefLikeArray(record.refs),
    ...asStringArray(record.auditRefs),
    ...refsFromRefLikeArray(record.auditRefs),
    ...asStringArray(record.relatedRefs),
    ...refsFromRefLikeArray(record.relatedRefs),
    ...asStringArray(record.artifactRefs),
    ...refsFromRefLikeArray(record.artifactRefs),
    ...asStringArray(record.executionUnitRefs),
    ...refsFromRefLikeArray(record.executionUnitRefs),
    ...asStringArray(record.verificationRefs),
    ...refsFromRefLikeArray(record.verificationRefs),
    ...asStringArray(record.workEvidenceRefs),
    ...refsFromRefLikeArray(record.workEvidenceRefs),
    ...nested.flatMap(refsFromUnknown),
  ].filter((ref): ref is string => Boolean(ref));
}

function firstStringRef(value: unknown, keys: string[]) {
  const record = parseJsonRecord(value);
  if (!record) return undefined;
  for (const key of keys) {
    const ref = asString(record[key]);
    if (ref) return ref;
  }
  return undefined;
}

function uniqueById<T extends { id: string }>(items: T[]) {
  const byId = new Map<string, T>();
  for (const item of items) {
    if (!item.id || byId.has(item.id)) continue;
    byId.set(item.id, item);
  }
  return Array.from(byId.values());
}

function uniqueEdges(edges: Array<{ from: string; to: string; kind: string }>) {
  const byKey = new Map<string, { from: string; to: string; kind: string }>();
  for (const edge of edges) byKey.set(`${edge.from}\0${edge.to}\0${edge.kind}`, edge);
  return Array.from(byKey.values());
}

function parseJsonRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed) ? parsed as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function asString(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function stringField(value: unknown) {
  return asString(value);
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function refsFromRefLikeArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = parseJsonRecord(entry);
    if (!record) return [];
    return [asString(record.ref), asString(record.executionUnitId)].filter((ref): ref is string => Boolean(ref));
  });
}

function graphOutputTarget(ref: string, artifacts: RuntimeArtifact[]) {
  const artifactId = stripArtifactPrefix(ref);
  return artifacts.some((artifact) => artifact.id === artifactId) ? artifactId : ref;
}

function stripArtifactPrefix(value: string) {
  return value.replace(/^artifact::?/i, '');
}

function stripExecutionUnitPrefix(value: string) {
  return value.replace(/^execution-unit::?/i, '');
}

function isSessionBundleRef(ref: string) {
  return /^\.sciforge\/sessions\//.test(ref) || /\/records\/session-bundle-audit\.json$/.test(ref);
}
