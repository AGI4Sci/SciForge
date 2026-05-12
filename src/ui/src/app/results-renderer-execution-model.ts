import type { ContractValidationFailure, ContractValidationFailureKind } from '@sciforge-ui/runtime-contract';
import type { RuntimeArtifact, SciForgeRun, SciForgeSession } from '../domain';
import type { RuntimeResolvedViewPlan } from './results/viewPlanResolver';
import { asString, asStringList, isRecord } from './results/resultArtifactHelpers';
import { artifactsForRun, executionUnitsForRun } from './results/executionUnitsForRun';

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
  nextSteps: string[];
  availableArtifacts: Array<{ id: string; type: string; title?: string }>;
  refs: string[];
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

export function runPresentationState(session: SciForgeSession, activeRun?: SciForgeRun, viewPlan?: RuntimeResolvedViewPlan): RunPresentationState {
  const run = activeRun ?? session.runs.at(-1);
  const blockers = runAuditBlockers(session, run);
  const recoverActions = runRecoverActions(session, run);
  const validationFailures = contractValidationFailures(session, run);
  const repairStates = backendRepairStates(session, run);
  const units = executionUnitsForRun(session, run);
  const presentation = resultPresentationForRun(run);
  const availableArtifacts = presentationArtifacts(session, run, viewPlan);
  const needsHuman = runNeedsHuman(run) || units.some((unit) => unit.status === 'needs-human' || unit.verificationVerdict === 'needs-human') || textHasNeedsHuman(presentation);
  const partial = textHasPartial(presentation) || units.some((unit) => String(unit.status) === 'partial') || textHasPartial(run?.response);
  const failed = run?.status === 'failed' || blockers.length > 0 || validationFailures.length > 0;
  const recoverable = recoverActions.length > 0
    || repairStates.some((state) => state.status || state.failureReason || state.recoverActions.length)
    || units.some((unit) => unit.status === 'repair-needed' || unit.status === 'failed-with-reason');
  const refs = runAuditRefs(session, run).slice(0, 8);
  const nextSteps = Array.from(new Set([
    ...recoverActions,
    ...resultPresentationNextActions(presentation),
    ...validationFailures.map((failure) => failure.nextStep).filter((step): step is string => Boolean(step)),
    ...units.map((unit) => unit.nextStep).filter((step): step is string => Boolean(step)),
    ...(needsHuman ? ['补充缺失输入或确认下一步后继续。'] : []),
    ...(!recoverActions.length && failed ? ['查看运行细节中的失败单元，修复后重新运行。'] : []),
    ...(!availableArtifacts.length && !failed && !needsHuman && !partial && run?.status === 'completed' ? ['重新运行或要求生成可展示 artifact。'] : []),
  ])).slice(0, 5);
  const reason = primaryPresentationReason({
    presentation,
    blockers,
    validationFailures,
    repairStates,
    units,
    run,
    availableArtifacts,
  });
  if (failed) {
    return {
      kind: recoverable ? 'recoverable' : 'failed',
      title: recoverable ? '运行失败，但可恢复' : '运行失败',
      reason,
      nextSteps,
      availableArtifacts,
      refs,
    };
  }
  if (needsHuman) {
    return {
      kind: 'needs-human',
      title: '需要人工处理后继续',
      reason,
      nextSteps,
      availableArtifacts,
      refs,
    };
  }
  if (run?.status === 'running') {
    return {
      kind: 'running',
      title: '运行仍在进行',
      reason,
      nextSteps,
      availableArtifacts,
      refs,
    };
  }
  if (partial) {
    return {
      kind: 'partial',
      title: availableArtifacts.length ? '只得到部分结果' : '部分结果尚不可展示',
      reason,
      nextSteps,
      availableArtifacts,
      refs,
    };
  }
  if (!availableArtifacts.length) {
    return {
      kind: recoverable ? 'recoverable' : 'empty',
      title: recoverable ? '结果需要恢复后展示' : '本轮没有生成可展示 artifact',
      reason,
      nextSteps,
      availableArtifacts,
      refs,
    };
  }
  return {
    kind: 'ready',
    title: '结果可展示',
    reason,
    nextSteps,
    availableArtifacts,
    refs,
  };
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

function resultPresentationForRun(run?: SciForgeRun): Record<string, unknown> | undefined {
  const raw = isRecord(run?.raw) ? run?.raw : undefined;
  const displayIntent = isRecord(raw?.displayIntent) ? raw.displayIntent : undefined;
  const payload = isRecord(raw?.payload) ? raw.payload : undefined;
  const parsedResponse = parseMaybeJsonObject(run?.response ?? '');
  return firstRecord(
    raw?.resultPresentation,
    displayIntent?.resultPresentation,
    payload?.resultPresentation,
    parsedResponse?.resultPresentation,
  );
}

function firstRecord(...values: unknown[]): Record<string, unknown> | undefined {
  return values.find(isRecord);
}

function resultPresentationNextActions(presentation?: Record<string, unknown>) {
  if (!presentation) return [];
  return recordList(presentation.nextActions)
    .map((action) => asString(action.label) || asString(action.action) || asString(action.nextStep))
    .filter((action): action is string => Boolean(action));
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
    byId.set(artifact.id, artifact);
  }
  return Array.from(byId.values()).map((artifact) => ({
    id: artifact.id,
    type: artifact.type,
    title: artifactTitle(artifact),
  }));
}

function artifactTitle(artifact: RuntimeArtifact) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : undefined;
  return asString(metadata?.title) || asString(metadata?.label) || artifact.id;
}

function primaryPresentationReason({
  presentation,
  blockers,
  validationFailures,
  repairStates,
  units,
  run,
  availableArtifacts,
}: {
  presentation?: Record<string, unknown>;
  blockers: string[];
  validationFailures: ContractValidationFailure[];
  repairStates: BackendRepairState[];
  units: ReturnType<typeof executionUnitsForRun>;
  run?: SciForgeRun;
  availableArtifacts: RunPresentationState['availableArtifacts'];
}) {
  const processSummary = isRecord(presentation?.processSummary) ? presentation?.processSummary : undefined;
  const explicit = asString(presentation?.summary)
    || asString(presentation?.message)
    || asString(processSummary?.summary)
    || asString(presentation?.reason)
    || asString(presentation?.failureReason)
    || asString((run?.raw as Record<string, unknown> | undefined)?.failureReason);
  if (explicit) return compactHumanReason(explicit);
  const validationReason = validationFailures[0]?.failureReason;
  if (validationReason) return compactHumanReason(validationReason);
  const repairReason = repairStates.find((state) => state.failureReason)?.failureReason;
  if (repairReason) return compactHumanReason(repairReason);
  const unitReason = units.find((unit) => unit.failureReason || unit.selfHealReason)?.failureReason
    || units.find((unit) => unit.selfHealReason)?.selfHealReason;
  if (unitReason) return compactHumanReason(unitReason);
  if (blockers[0]) return compactHumanReason(blockers[0]);
  if (!availableArtifacts.length && run?.status === 'completed') return '运行已结束，但没有写入可供右侧结果区渲染的 artifact。';
  if (run?.status === 'running') return '后台仍在生成结果，当前只显示已经落盘的产物。';
  return availableArtifacts.length ? `${availableArtifacts.length} 个产物可用于右侧展示。` : '当前 run 没有可展示产物。';
}

function compactHumanReason(value: string) {
  const text = value.replace(/\s+/g, ' ').trim();
  return text.length > 320 ? `${text.slice(0, 317).trim()}...` : text;
}

function runNeedsHuman(run?: SciForgeRun) {
  const text = [
    run?.status,
    run?.response,
    isRecord(run?.raw) ? run.raw.status : undefined,
    isRecord(run?.raw) ? run.raw.reason : undefined,
  ].map((value) => String(value ?? '').toLowerCase()).join(' ');
  return /needs-human|need human|human input|人工|需要用户|需要人工/.test(text);
}

function textHasNeedsHuman(value: unknown) {
  return /needs-human|need human|human input|人工|需要用户|需要人工/.test(JSON.stringify(value ?? '').toLowerCase());
}

function textHasPartial(value: unknown) {
  return /partial|partially|incomplete|insufficient|unverified|missing|部分|不完整/.test(JSON.stringify(value ?? '').toLowerCase());
}
