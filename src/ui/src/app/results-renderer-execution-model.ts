import type { ContractValidationFailure, ContractValidationFailureKind } from '@sciforge-ui/runtime-contract';
import type { RuntimeArtifact, RuntimeExecutionUnit, SciForgeRun, SciForgeSession } from '../domain';
import { artifactHasUserFacingDelivery } from '../../../../packages/support/object-references';
import type { RuntimeResolvedViewPlan } from './results/viewPlanResolver';
import { asString, asStringList, isRecord } from './results/resultArtifactHelpers';
import { artifactsForRun, auditExecutionUnitsForRun, executionUnitBelongsToRun, runUsesContextOnlyFastPath } from './results/executionUnitsForRun';
import {
  conversationProjectionArtifactRefs,
  conversationProjectionAuditRefs,
  conversationProjectionForSession,
  conversationProjectionIsRecoverable,
  conversationProjectionPrimaryDiagnostic,
  conversationProjectionRecoverActions,
  conversationProjectionStatus,
  conversationProjectionVisibleText,
  type UiConversationProjection,
} from './conversation-projection-view-model';
import { runtimeDebugValueHasRawLeak, sanitizeRuntimeDebugValue } from '../runtimeDebugScrubber';
import { sanitizeRightPanePreviewValue } from './results/previewSafety';
import { splitFinalMessagePresentation } from './chat/finalMessagePresentation';

export type BackendRepairState = {
  id: string;
  label: string;
  status?: string;
  sourceRunId?: string;
  repairRunId?: string;
  failureReason?: string;
  recoverActions: string[];
  refs: string[];
  history: string[];
};

export type RunPresentationStateKind = 'ready' | 'partial' | 'empty' | 'recoverable' | 'needs-human' | 'failed' | 'running';

export type RunPresentationState = {
  kind: RunPresentationStateKind;
  title: string;
  reason: string;
  progress?: RunPresentationProgress;
  nextSteps: string[];
  availableArtifacts: Array<{ id: string; type: string; title?: string }>;
  refs: string[];
};

export type RunPresentationProgress = {
  completedParts: Array<{ id: string; label: string; ref?: string; status?: string }>;
  currentStage?: { id: string; label: string; status: string; ref?: string };
  backgroundStatus?: string;
  safeActions: Array<{ kind: 'inspect' | 'continue' | 'cancel' | 'resume' | 'rerun' | 'confirm'; label: string; ref?: string; safe: boolean; reason?: string }>;
};

export type BrowserVisibleRuntimeState = {
  sessionId: string;
  runId?: string;
  runStatus?: string;
  runCreatedAt?: string;
  runCompletedAt?: string;
  projectionStatus: string;
  presentationKind: RunPresentationStateKind;
  currentStageId?: string;
  currentStageStatus?: string;
  backgroundStatus?: string;
  tFirstProgressMs?: number;
  tFirstBackendEventMs?: number;
  tTerminalProjectionMs?: number;
  visibleArtifactRefs: string[];
  recoverActionCount: number;
  projectionWaitAtTerminal: boolean;
  rawFallbackUsed: boolean;
  rawLeak: boolean;
};

export function shouldOpenRunAuditDetails(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForSession(session, run);
  if (projection) {
    return conversationProjectionStatus(projection) !== 'satisfied'
      || projection.diagnostics.length > 0
      || projection.executionProcess.length > 0;
  }
  return Boolean(
    run?.status === 'failed'
    || auditFailedExecutionUnits(session, run).length
    || auditContractValidationFailures(session, run).length
    || auditBackendRepairStates(session, run).some((state) => state.failureReason || state.status === 'failed' || state.status === 'failed-with-reason'),
  );
}

export function shouldDefaultOpenRunAuditDetails(session: SciForgeSession, activeRun?: SciForgeRun) {
  return false;
}

export function runPresentationState(session: SciForgeSession, activeRun?: SciForgeRun, viewPlan?: RuntimeResolvedViewPlan): RunPresentationState {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForSession(session, run);
  const availableArtifacts = presentationArtifacts(session, run, viewPlan);
  if (projection) return runPresentationStateFromProjection(projection, run, availableArtifacts);
  return projectionlessRunPresentationState(session, run);
}

export function browserVisibleRuntimeState(
  session: SciForgeSession,
  activeRun?: SciForgeRun,
  viewPlan?: RuntimeResolvedViewPlan,
): BrowserVisibleRuntimeState {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForSession(session, run);
  const presentationState = runPresentationState(session, activeRun, viewPlan);
  const terminalRun = run?.status === 'completed' || run?.status === 'failed' || run?.status === 'cancelled';
  const rawFallbackUsed = !projection && Boolean(run);
  const timing = browserRuntimeTiming(session, run, presentationState);
  const visibleArtifactRefs = projection
    ? conversationProjectionArtifactRefs(projection).filter(isPublicBrowserStateRef)
    : presentationState.availableArtifacts.map((artifact) => `artifact:${artifact.id}`);
  const rawLeak = runtimeDebugValueHasRawLeak({
    reason: presentationState.reason,
    nextSteps: presentationState.nextSteps,
    visibleArtifactRefs,
  });
  return {
    sessionId: session.sessionId,
    runId: run?.id,
    runStatus: run?.status,
    runCreatedAt: run?.createdAt,
    runCompletedAt: run?.completedAt,
    projectionStatus: projection ? conversationProjectionStatus(projection) : 'missing',
    presentationKind: presentationState.kind,
    currentStageId: presentationState.progress?.currentStage?.id,
    currentStageStatus: presentationState.progress?.currentStage?.status,
    backgroundStatus: presentationState.progress?.backgroundStatus,
    tFirstProgressMs: timing.tFirstProgressMs,
    tFirstBackendEventMs: timing.tFirstBackendEventMs,
    tTerminalProjectionMs: timing.tTerminalProjectionMs,
    visibleArtifactRefs,
    recoverActionCount: runRecoverActions(session, activeRun).length,
    projectionWaitAtTerminal: Boolean(terminalRun && !projection),
    rawFallbackUsed,
    rawLeak,
  };
}

function browserRuntimeTiming(
  session: SciForgeSession,
  run: SciForgeRun | undefined,
  presentationState: RunPresentationState,
) {
  const startedAt = parseTimestampMs(run?.createdAt);
  if (startedAt === undefined) return {};
  const currentRun = run;
  const runUnits = currentRun
    ? session.executionUnits.filter((unit) => executionUnitBelongsToRun(unit, currentRun))
    : [];
  const firstUnitMs = minDefined(runUnits.map((unit) => parseTimestampMs(unit.time)));
  const completedAtMs = parseTimestampMs(run?.completedAt);
  const currentStageMs = presentationState.progress?.currentStage
    ? firstUnitMs ?? completedAtMs
    : undefined;
  return {
    tFirstProgressMs: elapsedMs(startedAt, currentStageMs ?? firstUnitMs ?? completedAtMs),
    tFirstBackendEventMs: elapsedMs(startedAt, firstUnitMs),
    tTerminalProjectionMs: elapsedMs(startedAt, completedAtMs),
  };
}

function parseTimestampMs(value: unknown) {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : undefined;
}

function elapsedMs(startedAt: number, endedAt: number | undefined) {
  if (endedAt === undefined || endedAt < startedAt) return undefined;
  return Math.round(endedAt - startedAt);
}

function minDefined(values: Array<number | undefined>) {
  let min: number | undefined;
  for (const value of values) {
    if (value === undefined) continue;
    min = min === undefined ? value : Math.min(min, value);
  }
  return min;
}

function isPublicBrowserStateRef(ref: string) {
  return /^artifact::?[^/\s]+$/i.test(ref)
    || /^runtime:\/\/capability-provider-route\/[a-z0-9_.-]+$/i.test(ref);
}

function projectionlessRunPresentationState(
  session: SciForgeSession,
  run: SciForgeRun | undefined,
): RunPresentationState {
  const hasAuditDiagnostics = projectionlessAuditHasDiagnostics(session, run);
  const refs = runAuditRefs(session, run).slice(0, 8);
  return {
    kind: 'empty',
    title: 'Waiting for results',
    reason: hasAuditDiagnostics
      ? 'No primary result is ready yet. Supporting activity is folded out of the main view.'
      : 'No result is ready yet. Answers and deliverables will appear here.',
    nextSteps: [],
    availableArtifacts: [],
    refs,
  };
}

function projectionlessAuditHasDiagnostics(session: SciForgeSession, run?: SciForgeRun) {
  return Boolean(
    runHasCurrentFailureBoundary(run)
    || auditFailedExecutionUnits(session, run).length
    || auditContractValidationFailures(session, run).length
    || auditBackendRepairStates(session, run).some((state) => state.failureReason || state.status === 'failed' || state.status === 'failed-with-reason'),
  );
}

export function failedExecutionUnits(session: SciForgeSession, activeRun?: SciForgeRun): RuntimeExecutionUnit[] {
  const run = activeRun ?? session.runs.at(-1);
  if (conversationProjectionForSession(session, run)) return [];
  return [];
}

function auditFailedExecutionUnits(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  return auditExecutionUnitsForRun(session, run).filter((unit) => isBlockingExecutionUnitStatus(unit.status));
}

function isBlockingExecutionUnitStatus(status: unknown) {
  return status === 'failed'
    || status === 'failed-with-reason'
    || status === 'repair-needed'
    || status === 'needs-human';
}

export function runAuditBlockers(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForSession(session, run);
  if (projection) {
    const status = conversationProjectionStatus(projection);
    if (status === 'satisfied' || status === 'visible-not-live-acceptance') return [];
    return Array.from(new Set([
      conversationProjectionPrimaryDiagnostic(projection),
      ...projection.diagnostics.map((diagnostic) => diagnostic.message),
    ].filter((line): line is string => Boolean(line))));
  }
  return [];
}

export function runRecoverActions(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForSession(session, run);
  if (projection) {
    return conversationProjectionStatus(projection) === 'visible-not-live-acceptance'
      ? []
      : conversationProjectionRecoverActions(projection);
  }
  return [];
}

export function runAuditRefs(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForSession(session, run);
  if (projection) return conversationProjectionAuditRefs(projection);
  const raw = isRecord(run?.raw) ? run?.raw : undefined;
  return Array.from(new Set([
    ...asStringList(raw?.refs),
    ...asStringList(raw?.auditRefs),
    ...auditContractValidationFailures(session, run).flatMap((failure) => [
      ...failure.relatedRefs,
      ...failure.invalidRefs,
      ...failure.unresolvedUris,
    ]),
    ...auditBackendRepairStates(session, run).flatMap((state) => state.refs),
    ...(run?.references ?? []).map((ref) => ref.ref),
    ...auditExecutionUnitsForRun(session, run).flatMap((unit) => [unit.codeRef, unit.stdoutRef, unit.stderrRef, unit.outputRef, unit.diffRef]).filter((ref): ref is string => Boolean(ref)),
  ]));
}

const CONTRACT_VALIDATION_FAILURE_CONTRACT = 'sciforge.contract-validation-failure.v1';
const contractValidationFailureKinds: ContractValidationFailureKind[] = ['payload-schema', 'artifact-schema', 'reference', 'ui-manifest', 'work-evidence', 'verifier', 'unknown'];

export function contractValidationFailures(session: SciForgeSession, activeRun?: SciForgeRun): ContractValidationFailure[] {
  const run = activeRun ?? session.runs.at(-1);
  if (conversationProjectionForSession(session, run)) return [];
  return [];
}

function auditContractValidationFailures(session: SciForgeSession, activeRun?: SciForgeRun): ContractValidationFailure[] {
  const run = activeRun ?? session.runs.at(-1);
  const failures = [
    ...contractValidationFailureCandidates(run?.raw),
    ...contractValidationFailureCandidates(parseMaybeJsonObject(run?.response ?? '')),
  ].map(normalizeContractValidationFailure).filter((failure): failure is ContractValidationFailure => Boolean(failure));
  const byKey = new Map<string, ContractValidationFailure>();
  for (const failure of failures) byKey.set(contractValidationFailureKey(failure), failure);
  return Array.from(byKey.values());
}

export function backendRepairStates(session: SciForgeSession, activeRun?: SciForgeRun): BackendRepairState[] {
  const run = activeRun ?? session.runs.at(-1);
  if (conversationProjectionForSession(session, run)) return [];
  return [];
}

function auditBackendRepairStates(session: SciForgeSession, activeRun?: SciForgeRun): BackendRepairState[] {
  const run = activeRun ?? session.runs.at(-1);
  const raw = isRecord(run?.raw) ? run?.raw : undefined;
  const currentFailureBoundary = runHasCurrentFailureBoundary(run);
  const candidates = [
    backendRepairStateFromRecord('acceptanceRepair', raw?.acceptanceRepair),
    backendRepairStateFromRecord('backendRepair', raw?.backendRepair),
    backendRepairStateFromRecord('repairState', raw?.repairState),
    backendRepairStateFromRecord('backgroundCompletion', raw?.backgroundCompletion),
    run?.acceptance?.repairHistory?.length ? {
      id: `acceptance-${run.id}`,
      label: 'acceptance.repairHistory',
      status: run.acceptance.severity,
      failureReason: run.acceptance.failures.at(-1)?.detail,
      recoverActions: run.acceptance.failures.map((failure) => failure.repairAction).filter((action): action is string => Boolean(action)),
      refs: run.acceptance.objectReferences.map((reference) => reference.ref),
      history: run.acceptance.repairHistory.map((entry) => `${entry.status}: attempt=${entry.attempt}; action=${entry.action}; repairRunId=${entry.repairRunId ?? 'n/a'}${entry.reason ? `; reason=${entry.reason}` : ''}`),
    } : undefined,
  ].filter((state): state is BackendRepairState => Boolean(state))
    .filter((state) => backendRepairStateBelongsToRun(state, run, currentFailureBoundary));
  const byId = new Map<string, BackendRepairState>();
  for (const state of candidates) byId.set(state.id, state);
  return Array.from(byId.values());
}

function backendRepairStateBelongsToRun(state: BackendRepairState, run: SciForgeRun | undefined, currentFailureBoundary: boolean) {
  if (!run) return true;
  const explicitIds = [state.sourceRunId, state.repairRunId].filter((id): id is string => Boolean(id));
  if (explicitIds.includes(run.id)) return true;
  if (!explicitIds.length) return currentFailureBoundary;
  return currentFailureBoundary && run.status === 'failed';
}

function backendRepairStateFromRecord(label: string, value: unknown): BackendRepairState | undefined {
  if (!isRecord(value)) return undefined;
  const repairHistory = Array.isArray(value.repairHistory) ? value.repairHistory.filter(isRecord) : [];
  const stages = Array.isArray(value.stages) ? value.stages.filter(isRecord) : [];
  const refs = [
    ...asStringList(value.refs),
    ...recordRefs(value.refs),
    ...recordRefs(value.objectReferences),
    ...stages.flatMap((stage) => [
      asString(stage.ref),
      ...asStringList(stage.artifactRefs),
      ...asStringList(stage.executionUnitRefs),
      ...asStringList(stage.verificationRefs),
      ...asStringList(stage.workEvidenceRefs),
    ]),
  ].filter((ref): ref is string => Boolean(ref));
  const recoverActions = [
    ...asStringList(value.recoverActions),
    ...stages.flatMap((stage) => asStringList(stage.recoverActions)),
  ];
  const history = [
    ...repairHistory.map((entry) => [
      asString(entry.status) ?? 'repair',
      asString(entry.action) ? `action=${asString(entry.action)}` : undefined,
      asString(entry.sourceRunId) ? `sourceRunId=${asString(entry.sourceRunId)}` : undefined,
      asString(entry.repairRunId) ? `repairRunId=${asString(entry.repairRunId)}` : undefined,
      asString(entry.reason) ? `reason=${asString(entry.reason)}` : undefined,
    ].filter(Boolean).join('; ')),
    ...stages.map((stage) => [
      asString(stage.status) ?? 'stage',
      asString(stage.stageId) ? `stageId=${asString(stage.stageId)}` : undefined,
      asString(stage.failureReason) ? `failureReason=${asString(stage.failureReason)}` : undefined,
      asString(stage.nextStep) ? `nextStep=${asString(stage.nextStep)}` : undefined,
    ].filter(Boolean).join('; ')),
  ];
  const state: BackendRepairState = {
    id: `${label}-${asString(value.sourceRunId) ?? asString(value.runId) ?? asString(value.repairRunId) ?? 'current'}`,
    label,
    status: asString(value.status),
    sourceRunId: asString(value.sourceRunId) ?? asString(value.runId),
    repairRunId: asString(value.repairRunId),
    failureReason: asString(value.failureReason) ?? asString(value.reason),
    recoverActions: Array.from(new Set(recoverActions)),
    refs: Array.from(new Set(refs)),
    history,
  };
  if (!state.status && !state.failureReason && !state.recoverActions.length && !state.refs.length && !state.history.length) return undefined;
  return state;
}

function normalizeContractValidationFailure(record: Record<string, unknown>): ContractValidationFailure | undefined {
  if (!isContractValidationFailureRecord(record)) return undefined;
  const failureKind = contractValidationFailureKinds.includes(record.failureKind as ContractValidationFailureKind)
    ? record.failureKind as ContractValidationFailureKind
    : 'unknown';
  return {
    contract: CONTRACT_VALIDATION_FAILURE_CONTRACT,
    schemaPath: asString(record.schemaPath) || '',
    contractId: asString(record.contractId) || asString(record.contract) || CONTRACT_VALIDATION_FAILURE_CONTRACT,
    capabilityId: asString(record.capabilityId) || asString(record.capability) || 'unknown-capability',
    failureKind,
    expected: record.expected,
    actual: record.actual,
    missingFields: asStringList(record.missingFields),
    invalidRefs: asStringList(record.invalidRefs),
    unresolvedUris: asStringList(record.unresolvedUris),
    failureReason: asString(record.failureReason) || asString(record.reason) || asString(record.message) || 'Contract validation failed.',
    recoverActions: asStringList(record.recoverActions),
    nextStep: asString(record.nextStep) || asString(record.repairAction) || '',
    relatedRefs: Array.from(new Set([
      ...asStringList(record.relatedRefs),
      ...asStringList(record.refs),
      ...asStringList(record.invalidRefs),
      ...asStringList(record.unresolvedUris),
    ])),
    issues: recordList(record.issues).map((issue) => ({
      path: asString(issue.path) || '',
      message: asString(issue.message) || asString(issue.detail) || 'Contract validation issue.',
      expected: asString(issue.expected),
      actual: asString(issue.actual),
      missingField: asString(issue.missingField),
      invalidRef: asString(issue.invalidRef),
      unresolvedUri: asString(issue.unresolvedUri),
    })),
    createdAt: asString(record.createdAt),
  };
}

function contractValidationFailureCandidates(value: unknown): Record<string, unknown>[] {
  if (!isRecord(value)) return [];
  const direct = isContractValidationFailureRecord(value) ? [value] : [];
  return [
    ...direct,
    ...recordList(value.contractValidationFailures),
    ...recordList(value.validationFailures),
    ...recordList(value.failures).filter(isContractValidationFailureRecord),
    ...singleRecord(value.contractValidationFailure),
    ...singleRecord(value.validationFailure),
    ...singleRecord(value.failure).filter(isContractValidationFailureRecord),
  ];
}

function isContractValidationFailureRecord(value: Record<string, unknown>) {
  return value.contract === CONTRACT_VALIDATION_FAILURE_CONTRACT
    || (typeof value.failureKind === 'string'
      && (Array.isArray(value.issues) || Array.isArray(value.recoverActions) || Array.isArray(value.relatedRefs))
      && (typeof value.failureReason === 'string' || typeof value.message === 'string' || typeof value.reason === 'string'));
}

export function contractValidationFailureKey(failure: ContractValidationFailure) {
  return [failure.contractId, failure.capabilityId, failure.schemaPath, failure.failureKind, failure.failureReason].join('|');
}

function singleRecord(value: unknown): Record<string, unknown>[] {
  return isRecord(value) ? [value] : [];
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function recordRefs(value: unknown): string[] {
  return recordList(value).map((record) => asString(record.ref) || asString(record.path) || asString(record.url)).filter((ref): ref is string => Boolean(ref));
}

function parseMaybeJsonObject(value: string): Record<string, unknown> | undefined {
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export function rawAuditItems(session: SciForgeSession, activeRun: SciForgeRun | undefined, viewPlan: RuntimeResolvedViewPlan) {
  const run = activeRun ?? session.runs.at(-1);
  const scopedExecutionUnits = auditExecutionUnitsForRun(session, run);
  const scopedArtifacts = artifactsForRun(session, run);
  return [
    run ? { id: `run-${run.id}`, label: '本轮记录', value: JSON.stringify(sanitizeAuditValue(run.raw ?? run), null, 2) } : undefined,
    scopedArtifacts.length ? { id: 'artifacts', label: `结果材料（${scopedArtifacts.length}）`, value: JSON.stringify(sanitizeAuditValue(scopedArtifacts), null, 2) } : undefined,
    scopedExecutionUnits.length ? { id: 'execution-units', label: `过程记录（${scopedExecutionUnits.length}）`, value: JSON.stringify(sanitizeAuditValue(scopedExecutionUnits), null, 2) } : undefined,
    session.notebook.length ? { id: 'notebook', label: `时间线（${session.notebook.length}）`, value: JSON.stringify(sanitizeAuditValue(session.notebook), null, 2) } : undefined,
    viewPlan.allItems.length ? { id: 'view-plan', label: `展示摘要（${viewPlan.allItems.length}）`, value: JSON.stringify(sanitizeAuditValue(viewPlan.allItems), null, 2) } : undefined,
  ].filter((item): item is { id: string; label: string; value: string } => Boolean(item));
}

function presentationArtifacts(session: SciForgeSession, run?: SciForgeRun, viewPlan?: RuntimeResolvedViewPlan) {
  const artifacts = viewPlan
    ? viewPlan.allItems
      .filter((item) => item.status === 'bound' && item.artifact)
      .map((item) => item.artifact!)
    : artifactsForRun(session, run);
  const byId = new Map<string, RuntimeArtifact>();
  for (const artifact of artifacts) {
    if (!artifact?.id || byId.has(artifact.id)) continue;
    if (!artifactHasUserFacingDelivery(artifact)) continue;
    byId.set(artifact.id, artifact);
  }
  return Array.from(byId.values()).map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    title: artifactTitle(artifact),
  }));
}

function runPresentationStateFromProjection(
  projection: UiConversationProjection,
  run: SciForgeRun | undefined,
  availableArtifacts: RunPresentationState['availableArtifacts'],
): RunPresentationState {
  const status = conversationProjectionStatus(projection);
  const projectedArtifacts = projectionAvailableArtifacts(projection, availableArtifacts);
  const nextSteps = status === 'visible-not-live-acceptance' ? [] : conversationProjectionRecoverActions(projection).slice(0, 5);
  const refs = conversationProjectionAuditRefs(projection).slice(0, 8);
  const reason = projectionPresentationReason(projection, projectedArtifacts, run);
  const progress = projectionPresentationProgress(projection, projectedArtifacts);
  const kind = projectionPresentationKind(projection, projectedArtifacts);
  return {
    kind,
    title: projectionPresentationTitle(kind, status, projectedArtifacts),
    reason,
    progress,
    nextSteps,
    availableArtifacts: projectedArtifacts,
    refs,
  };
}

function projectionAvailableArtifacts(
  projection: UiConversationProjection,
  availableArtifacts: RunPresentationState['availableArtifacts'],
) {
  const projectionRefs = conversationProjectionArtifactRefs(projection);
  if (!projectionRefs.length) return availableArtifacts;
  const ids = new Set(projectionRefs.map(artifactIdFromRef));
  return availableArtifacts.filter((artifact) => ids.has(artifact.id));
}

function artifactIdFromRef(ref: string) {
  return ref.replace(/^artifact::?/, '');
}

function projectionPresentationKind(
  projection: UiConversationProjection,
  artifacts: RunPresentationState['availableArtifacts'],
): RunPresentationStateKind {
  const status = conversationProjectionStatus(projection);
  if (status === 'satisfied') return projectionVisibleTextHasRightPaneValue(projection, artifacts) ? 'ready' : 'empty';
  if (status === 'visible-not-live-acceptance') {
    return projectionVisibleTextHasRightPaneValue(projection, artifacts) ? 'ready' : 'empty';
  }
  if (status === 'needs-human') return 'needs-human';
  if (status === 'external-blocked' || status === 'repair-needed') return conversationProjectionIsRecoverable(projection) ? 'recoverable' : 'failed';
  if (status === 'degraded-result' && !artifacts.length && projectionHasEmptyResultRecovery(projection)) return 'recoverable';
  if (status === 'degraded-result' || status === 'partial-ready' || status === 'output-materialized' || status === 'background-running') return 'partial';
  if (status === 'planned' || status === 'dispatched' || status === 'validated') return 'running';
  return artifacts.length ? 'ready' : 'empty';
}

function projectionVisibleTextHasRightPaneValue(
  projection: UiConversationProjection,
  artifacts: RunPresentationState['availableArtifacts'],
) {
  if (artifacts.length) return true;
  if (conversationProjectionArtifactRefs(projection).some(isPublicBrowserStateRef)) return true;
  const visibleText = conversationProjectionVisibleText(projection);
  if (!visibleText) return false;
  const presentation = splitFinalMessagePresentation(visibleText);
  if (!presentation.auditSections.length) return false;
  const primaryText = presentation.primaryContent;
  const auditText = presentation.auditSections.map((section) => section.text).join('\n');
  const primaryLooksDiagnostic = /(?:task did not finish|error details are folded|additional details|Traceback \(most recent call last\)|\b(?:failureReason|stderrRef|stdoutRef|traceRef|recoverActions?|execution-failed|raw JSONL|tool payload|runtime metadata|MaxRetryError|ProxyError|ConnectionError|TimeoutError|HTTPError)\b|(?:失败原因|错误输出|标准输出|恢复动作|执行失败|诊断|调试信息|运行日志|原始输出))/i.test(primaryText);
  const foldedTraceback = /(?:Traceback \(most recent call last\)|\b(?:MaxRetryError|ProxyError|ConnectionError|TimeoutError|HTTPError)\b)/i.test(auditText)
    && /(?:task did not finish|error details are folded|未完成|错误详情)/i.test(primaryText);
  return primaryLooksDiagnostic || foldedTraceback;
}

function projectionHasEmptyResultRecovery(projection: UiConversationProjection) {
  const hasEmptyDiagnostic = projection.diagnostics.some((diagnostic) =>
    /empty|zero.?result|no.?result/i.test(`${diagnostic.code ?? ''} ${diagnostic.message}`)
  );
  return hasEmptyDiagnostic && conversationProjectionRecoverActions(projection).length > 0;
}

function projectionPresentationTitle(
  kind: RunPresentationStateKind,
  status: ReturnType<typeof conversationProjectionStatus>,
  artifacts: RunPresentationState['availableArtifacts'],
) {
  if ((status === 'visible-not-live-acceptance' || status === 'satisfied') && kind !== 'empty' && !artifacts.length) return 'Answer shown';
  if (kind === 'ready') return 'Results ready';
  if (kind === 'partial') return status === 'background-running' ? 'Partial results ready; still working' : 'Partial result';
  if (kind === 'needs-human') return 'Needs input';
  if (kind === 'recoverable') return 'Needs recovery';
  if (kind === 'failed') return 'Run failed';
  if (kind === 'running') return 'Still running';
  return artifacts.length ? 'Results ready' : 'No previewable content';
}

function projectionPresentationReason(
  projection: UiConversationProjection,
  artifacts: RunPresentationState['availableArtifacts'],
  run: SciForgeRun | undefined,
) {
  if (conversationProjectionStatus(projection) === 'visible-not-live-acceptance') {
    return compactHumanReason(conversationProjectionVisibleText(projection) ?? 'The answer is shown in chat; no separate result was created.');
  }
  const explicit = conversationProjectionPrimaryDiagnostic(projection) ?? conversationProjectionVisibleText(projection);
  if (explicit) return compactHumanReason(explicit);
  if (projection.backgroundState?.revisionPlan) return compactHumanReason(projection.backgroundState.revisionPlan);
  if (!artifacts.length && run?.status === 'completed') return 'The run finished without a separate right-pane result.';
  if (conversationProjectionStatus(projection) === 'background-running') return 'Results are still being prepared. Ready items are shown first.';
  return artifacts.length ? `${artifacts.length} result${artifacts.length === 1 ? '' : 's'} available.` : 'No result is ready yet.';
}

function projectionPresentationProgress(
  projection: UiConversationProjection,
  artifacts: RunPresentationState['availableArtifacts'],
): RunPresentationProgress {
  const completedParts = artifacts.slice(0, 8).map((artifact) => ({
    id: artifact.id,
    label: artifact.title ?? 'Result',
    ref: `artifact:${artifact.id}`,
    status: 'available',
  }));
  const latestEvent = [...projection.executionProcess].reverse().find((event) => event.summary || event.type);
  const status = conversationProjectionStatus(projection);
  const nextSteps = status === 'visible-not-live-acceptance' ? [] : conversationProjectionRecoverActions(projection);
  return {
    completedParts,
    currentStage: latestEvent ? {
      id: latestEvent.eventId,
      label: projectionProgressEventLabel(latestEvent.summary || latestEvent.type, status),
      status: projectionStatusLabel(status),
    } : undefined,
    backgroundStatus: projection.backgroundState?.status,
    safeActions: nextSteps.map((step) => ({
      kind: 'continue' as const,
      label: step,
      safe: true,
      reason: 'Recovery action from the current result, not inferred from raw execution state.',
    })).slice(0, 6),
  };
}

function artifactTitle(artifact: RuntimeArtifact) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : undefined;
  return asString(metadata?.title) || asString(metadata?.label) || artifact.id;
}

function compactHumanReason(value: string) {
  const presentation = splitFinalMessagePresentation(value);
  const text = (presentation.primaryContent || value).replace(/\s+/g, ' ').trim();
  return text.length > 320 ? `${text.slice(0, 317).trim()}...` : text;
}

function projectionProgressEventLabel(value: string, status: ReturnType<typeof conversationProjectionStatus>) {
  if (status === 'visible-not-live-acceptance' || /native.?codex.?message/i.test(value)) {
    return 'Answer shown in chat';
  }
  return value;
}

function projectionStatusLabel(status: ReturnType<typeof conversationProjectionStatus>) {
  const labels: Record<ReturnType<typeof conversationProjectionStatus>, string> = {
    idle: 'Not run',
    planned: 'Planned',
    dispatched: 'Started',
    'partial-ready': 'Partial result',
    'output-materialized': 'Output saved',
    validated: 'Validated',
    'visible-not-live-acceptance': 'Answer shown',
    satisfied: 'Complete',
    'degraded-result': 'Partial result',
    'external-blocked': 'Blocked',
    'repair-needed': 'Needs recovery',
    'needs-human': 'Needs input',
    'background-running': 'Still running',
  };
  return labels[status];
}

function runHasCurrentFailureBoundary(run?: SciForgeRun) {
  if (!run) return false;
  const raw = isRecord(run.raw) ? run.raw : undefined;
  if (runUsesContextOnlyFastPath(run)) return false;
  if (run.status === 'failed') return true;
  const rawStatus = String(raw?.status ?? '').toLowerCase();
  if (['failed', 'repair-needed', 'needs-human'].includes(rawStatus)) return true;
  return Boolean(asString(raw?.failureReason) || asString(raw?.blocker));
}

function sanitizeAuditValue(value: unknown, key = '', depth = 0): unknown {
  return sanitizeRightPanePreviewValue(sanitizeRuntimeDebugValue(value, key, depth));
}
