import type { ContractValidationFailure, ContractValidationFailureKind } from '@sciforge-ui/runtime-contract';
import { collectRuntimeRefsFromValue, runtimePayloadKeyLooksLikeBodyCarrier } from '@sciforge-ui/runtime-contract/references';
import type { RuntimeArtifact, RuntimeExecutionUnit, SciForgeRun, SciForgeSession } from '../domain';
import { artifactPresentationRole } from '../../../../packages/support/object-references';
import type { RuntimeResolvedViewPlan } from './results/viewPlanResolver';
import { asString, asStringList, isRecord } from './results/resultArtifactHelpers';
import { artifactsForRun, auditExecutionUnitsForRun, runUsesContextOnlyFastPath } from './results/executionUnitsForRun';
import {
  conversationProjectionArtifactRefs,
  conversationProjectionAuditRefs,
  conversationProjectionForRun,
  conversationProjectionIsRecoverable,
  conversationProjectionPrimaryDiagnostic,
  conversationProjectionRecoverActions,
  conversationProjectionStatus,
  conversationProjectionVisibleText,
  type UiConversationProjection,
} from './conversation-projection-view-model';

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

export function shouldOpenRunAuditDetails(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForRun(run);
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

export function runPresentationState(session: SciForgeSession, activeRun?: SciForgeRun, viewPlan?: RuntimeResolvedViewPlan): RunPresentationState {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForRun(run);
  const availableArtifacts = presentationArtifacts(session, run, viewPlan);
  if (projection) return runPresentationStateFromProjection(projection, run, availableArtifacts);
  return projectionlessRunPresentationState(session, run, availableArtifacts);
}

function projectionlessRunPresentationState(
  session: SciForgeSession,
  run: SciForgeRun | undefined,
  availableArtifacts: RunPresentationState['availableArtifacts'],
): RunPresentationState {
  const hasAuditDiagnostics = projectionlessAuditHasDiagnostics(session, run);
  const mainArtifacts = hasAuditDiagnostics ? [] : availableArtifacts;
  const refs = runAuditRefs(session, run).slice(0, 8);
  if (mainArtifacts.length) {
    return {
      kind: 'ready',
      title: '结果可展示',
      reason: `${mainArtifacts.length} 个显式 legacy/ref 产物可用于右侧展示。`,
      nextSteps: [],
      availableArtifacts: mainArtifacts,
      refs,
    };
  }
  return {
    kind: 'empty',
    title: hasAuditDiagnostics ? '主结果等待 ConversationProjection' : '本轮没有生成可展示 artifact',
    reason: hasAuditDiagnostics
      ? '没有 ConversationProjection；raw run、ExecutionUnit、validation 与 resultPresentation 已保留在审计中，不驱动主状态。'
      : '当前 run 没有 ConversationProjection 或可展示产物。',
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
  if (conversationProjectionForRun(run)) return [];
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
  const projection = conversationProjectionForRun(run);
  if (projection) {
    if (conversationProjectionStatus(projection) === 'satisfied') return [];
    return Array.from(new Set([
      conversationProjectionPrimaryDiagnostic(projection),
      ...projection.diagnostics.map((diagnostic) => diagnostic.message),
    ].filter((line): line is string => Boolean(line))));
  }
  return [];
}

export function runRecoverActions(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForRun(run);
  if (projection) return conversationProjectionRecoverActions(projection);
  return [];
}

export function runAuditRefs(session: SciForgeSession, activeRun?: SciForgeRun) {
  const run = activeRun ?? session.runs.at(-1);
  const projection = conversationProjectionForRun(run);
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
  if (conversationProjectionForRun(run)) return [];
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
  if (conversationProjectionForRun(run)) return [];
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
    run ? { id: `run-${run.id}`, label: `run ${run.id}`, value: JSON.stringify(sanitizeAuditValue(run.raw ?? run), null, 2) } : undefined,
    scopedArtifacts.length ? { id: 'artifacts', label: `artifacts (${scopedArtifacts.length})`, value: JSON.stringify(sanitizeAuditValue(scopedArtifacts), null, 2) } : undefined,
    scopedExecutionUnits.length ? { id: 'execution-units', label: `ExecutionUnit JSON (${scopedExecutionUnits.length})`, value: JSON.stringify(sanitizeAuditValue(scopedExecutionUnits), null, 2) } : undefined,
    session.notebook.length ? { id: 'notebook', label: `timeline JSON (${session.notebook.length})`, value: JSON.stringify(session.notebook, null, 2) } : undefined,
    viewPlan.allItems.length ? { id: 'view-plan', label: `resolved view plan (${viewPlan.allItems.length})`, value: JSON.stringify(viewPlan.allItems, null, 2) } : undefined,
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
    if (artifact.delivery?.previewPolicy === 'audit-only') continue;
    const role = artifactPresentationRole(artifact);
    if (role === 'audit' || role === 'diagnostic' || role === 'internal') continue;
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
  const nextSteps = conversationProjectionRecoverActions(projection).slice(0, 5);
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
  const matched = availableArtifacts.filter((artifact) => ids.has(artifact.id));
  const missing = projectionRefs
    .filter((ref) => !matched.some((artifact) => artifact.id === artifactIdFromRef(ref)))
    .map((ref) => {
      const projectionArtifact = projection.artifacts.find((artifact) => artifact.ref === ref);
      return {
        id: artifactIdFromRef(ref),
        type: projectionArtifact?.mime ?? 'artifact',
        title: projectionArtifact?.label ?? artifactIdFromRef(ref),
      };
    });
  return [...matched, ...missing];
}

function artifactIdFromRef(ref: string) {
  return ref.replace(/^artifact::?/, '');
}

function projectionPresentationKind(
  projection: UiConversationProjection,
  artifacts: RunPresentationState['availableArtifacts'],
): RunPresentationStateKind {
  const status = conversationProjectionStatus(projection);
  if (status === 'satisfied') return artifacts.length || conversationProjectionVisibleText(projection) ? 'ready' : 'empty';
  if (status === 'needs-human') return 'needs-human';
  if (status === 'external-blocked' || status === 'repair-needed') return conversationProjectionIsRecoverable(projection) ? 'recoverable' : 'failed';
  if (status === 'degraded-result' || status === 'partial-ready' || status === 'output-materialized' || status === 'background-running') return 'partial';
  if (status === 'planned' || status === 'dispatched' || status === 'validated') return 'running';
  return artifacts.length ? 'ready' : 'empty';
}

function projectionPresentationTitle(
  kind: RunPresentationStateKind,
  status: ReturnType<typeof conversationProjectionStatus>,
  artifacts: RunPresentationState['availableArtifacts'],
) {
  if (kind === 'ready') return '结果可展示';
  if (kind === 'partial') return status === 'background-running' ? '已有部分结果，后台仍在继续' : '只得到部分结果';
  if (kind === 'needs-human') return '需要人工处理后继续';
  if (kind === 'recoverable') return '运行需要恢复';
  if (kind === 'failed') return '运行失败';
  if (kind === 'running') return '运行仍在进行';
  return artifacts.length ? '结果可展示' : '本轮没有生成可展示 artifact';
}

function projectionPresentationReason(
  projection: UiConversationProjection,
  artifacts: RunPresentationState['availableArtifacts'],
  run: SciForgeRun | undefined,
) {
  const explicit = conversationProjectionPrimaryDiagnostic(projection) ?? conversationProjectionVisibleText(projection);
  if (explicit) return compactHumanReason(explicit);
  if (projection.backgroundState?.revisionPlan) return compactHumanReason(projection.backgroundState.revisionPlan);
  if (!artifacts.length && run?.status === 'completed') return '运行已结束，但 projection 没有声明可供右侧结果区渲染的 artifact。';
  if (conversationProjectionStatus(projection) === 'background-running') return '后台仍在生成结果，当前只显示 projection 已声明的产物。';
  return artifacts.length ? `${artifacts.length} 个 projection 产物可用于右侧展示。` : '当前 projection 没有可展示产物。';
}

function projectionPresentationProgress(
  projection: UiConversationProjection,
  artifacts: RunPresentationState['availableArtifacts'],
): RunPresentationProgress {
  const completedParts = artifacts.slice(0, 8).map((artifact) => ({
    id: artifact.id,
    label: artifact.title ? `${artifact.type}: ${artifact.title}` : artifact.type,
    ref: `artifact:${artifact.id}`,
    status: 'available',
  }));
  const latestEvent = [...projection.executionProcess].reverse().find((event) => event.summary || event.type);
  const nextSteps = conversationProjectionRecoverActions(projection);
  return {
    completedParts,
    currentStage: latestEvent ? {
      id: latestEvent.eventId,
      label: latestEvent.summary || latestEvent.type,
      status: latestEvent.type,
    } : undefined,
    backgroundStatus: projection.backgroundState?.status,
    safeActions: nextSteps.map((step) => ({
      kind: 'continue' as const,
      label: step,
      safe: true,
      reason: '来自 ConversationProjection 的恢复动作，不从 raw execution 状态推断。',
    })).slice(0, 6),
  };
}

function artifactTitle(artifact: RuntimeArtifact) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : undefined;
  return asString(metadata?.title) || asString(metadata?.label) || artifact.id;
}

function compactHumanReason(value: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 320 ? `${text.slice(0, 317).trim()}...` : text;
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
  if (value === undefined || value === null) return value;
  if (typeof value === 'string') {
    if (runtimePayloadKeyLooksLikeBodyCarrier(key)) return summarizeAuditBody(value);
    return value.length > 1000 ? summarizeAuditBody(value) : value;
  }
  if (typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    if (depth > 5) return { omitted: 'max-depth', length: value.length };
    return value.slice(0, 80).map((item) => sanitizeAuditValue(item, key, depth + 1));
  }
  if (depth > 5) return { omitted: 'max-depth', keys: Object.keys(value as Record<string, unknown>).slice(0, 16) };
  const record = value as Record<string, unknown>;
  if (runtimePayloadKeyLooksLikeBodyCarrier(key)) {
    return {
      omitted: 'body-carrier',
      keys: Object.keys(record).slice(0, 16),
      refs: collectRuntimeRefsFromValue(record, { maxDepth: 4, maxRefs: 16, includeIds: true }),
    };
  }
  const out: Record<string, unknown> = {};
  for (const [childKey, child] of Object.entries(record)) {
    out[childKey] = sanitizeAuditValue(child, childKey, depth + 1);
  }
  return out;
}

function summarizeAuditBody(value: string) {
  return {
    omitted: 'body-carrier',
    chars: value.length,
    refs: collectRuntimeRefsFromValue(value, { maxRefs: 12 }),
  };
}
