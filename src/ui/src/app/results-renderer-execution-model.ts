import type { ContractValidationFailure, ContractValidationFailureKind } from '@sciforge-ui/runtime-contract';
import type { SciForgeRun, SciForgeSession } from '../domain';
import type { RuntimeResolvedViewPlan } from './results/viewPlanResolver';
import { asString, asStringList, isRecord } from './results/resultArtifactHelpers';
import { executionUnitsForRun } from './results/executionUnitsForRun';

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

export function shouldOpenRunAuditDetails(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  return Boolean(
    run?.status === 'failed'
    || failedExecutionUnits(session, run).length
    || contractValidationFailures(session, run).length
    || backendRepairStates(session, run).some((state) => state.failureReason || state.status === 'failed' || state.status === 'failed-with-reason'),
  );
}

export function failedExecutionUnits(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  return executionUnitsForRun(session, run).filter((unit) => isBlockingExecutionUnitStatus(unit.status));
}

function isBlockingExecutionUnitStatus(status: unknown) {
  return status === 'failed'
    || status === 'failed-with-reason'
    || status === 'repair-needed'
    || status === 'needs-human';
}

export function runAuditBlockers(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const raw = isRecord(run?.raw) ? run?.raw : undefined;
  const lines = [
    run?.status === 'failed' ? `blocker: run ${run.id} failed` : undefined,
    asString(raw?.blocker) ? `blocker: ${asString(raw?.blocker)}` : undefined,
    asString(raw?.failureReason) ? `failureReason: ${asString(raw?.failureReason)}` : undefined,
    ...failedExecutionUnits(session, run).map((unit) => `failureReason: ${unit.failureReason || unit.id}`),
    ...contractValidationFailures(session, run).map((failure) => `ContractValidationFailure(${failure.failureKind}): ${failure.failureReason}`),
    ...backendRepairStates(session, run).flatMap((state) => state.failureReason ? [`backend repair ${state.label}: ${state.failureReason}`] : []),
  ].filter((line): line is string => Boolean(line));
  return Array.from(new Set(lines));
}

export function runRecoverActions(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const raw = isRecord(run?.raw) ? run?.raw : undefined;
  return Array.from(new Set([
    ...asStringList(raw?.recoverActions),
    ...contractValidationFailures(session, run).flatMap((failure) => failure.recoverActions),
    ...backendRepairStates(session, run).flatMap((state) => state.recoverActions),
    ...failedExecutionUnits(session, run).flatMap((unit) => unit.recoverActions ?? []),
    ...executionUnitsForRun(session, run).flatMap((unit) => unit.status === 'repair-needed' ? unit.recoverActions ?? [] : []),
  ]));
}

export function runAuditRefs(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const raw = isRecord(run?.raw) ? run?.raw : undefined;
  return Array.from(new Set([
    ...asStringList(raw?.refs),
    ...asStringList(raw?.auditRefs),
    ...contractValidationFailures(session, run).flatMap((failure) => [
      ...failure.relatedRefs,
      ...failure.invalidRefs,
      ...failure.unresolvedUris,
    ]),
    ...backendRepairStates(session, run).flatMap((state) => state.refs),
    ...(run?.references ?? []).map((ref) => ref.ref),
    ...executionUnitsForRun(session, run).flatMap((unit) => [unit.codeRef, unit.stdoutRef, unit.stderrRef, unit.outputRef, unit.diffRef]).filter((ref): ref is string => Boolean(ref)),
  ]));
}

const CONTRACT_VALIDATION_FAILURE_CONTRACT = 'sciforge.contract-validation-failure.v1';
const contractValidationFailureKinds: ContractValidationFailureKind[] = ['payload-schema', 'artifact-schema', 'reference', 'ui-manifest', 'work-evidence', 'verifier', 'unknown'];

export function contractValidationFailures(session: SciForgeSession, activeRun?: SciForgeRun): ContractValidationFailure[] {
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
  const raw = isRecord(run?.raw) ? run?.raw : undefined;
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
  ].filter((state): state is BackendRepairState => Boolean(state));
  const byId = new Map<string, BackendRepairState>();
  for (const state of candidates) byId.set(state.id, state);
  return Array.from(byId.values());
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
  const scopedExecutionUnits = executionUnitsForRun(session, run);
  return [
    run ? { id: `run-${run.id}`, label: `run ${run.id}`, value: JSON.stringify(run.raw ?? run, null, 2) } : undefined,
    session.artifacts.length ? { id: 'artifacts', label: `artifacts (${session.artifacts.length})`, value: JSON.stringify(session.artifacts, null, 2) } : undefined,
    scopedExecutionUnits.length ? { id: 'execution-units', label: `ExecutionUnit JSON (${scopedExecutionUnits.length})`, value: JSON.stringify(scopedExecutionUnits, null, 2) } : undefined,
    session.notebook.length ? { id: 'notebook', label: `timeline JSON (${session.notebook.length})`, value: JSON.stringify(session.notebook, null, 2) } : undefined,
    viewPlan.allItems.length ? { id: 'view-plan', label: `resolved view plan (${viewPlan.allItems.length})`, value: JSON.stringify(viewPlan.allItems, null, 2) } : undefined,
  ].filter((item): item is { id: string; label: string; value: string } => Boolean(item));
}
