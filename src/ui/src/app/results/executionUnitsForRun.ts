import type { RuntimeArtifact, RuntimeExecutionUnit, SciForgeRun, SciForgeSession } from '../../domain';
import { DIRECT_CONTEXT_FAST_PATH_POLICY } from '@sciforge-ui/runtime-contract/artifact-policy';

const FAILURE_BOUNDARY_STATUSES = new Set(['failed', 'repair-needed', 'needs-human']);

export function auditExecutionUnitsForRun(session: SciForgeSession, run?: SciForgeRun): RuntimeExecutionUnit[] {
  const visibleUnits = visibleExecutionUnits([
    ...session.executionUnits,
    ...(!run ? session.runs.flatMap(executionUnitsFromRunPayload) : []),
  ]);
  if (!run) return uniqueExecutionUnits(visibleUnits);
  const explicitArtifactIds = explicitlyOwnedArtifactIdsForRun(run);
  const rawUnits = visibleExecutionUnits(executionUnitsFromRunPayload(run))
    .filter((unit) => payloadExecutionUnitBelongsToRun(unit, run, explicitArtifactIds));
  const artifactIds = ownedArtifactIdsForRun(session, run, rawUnits);
  return uniqueExecutionUnits([
    ...visibleUnits.filter((unit) => executionUnitBelongsToRun(unit, run, artifactIds)),
    ...rawUnits,
  ]);
}

export function executionUnitBelongsToRun(unit: RuntimeExecutionUnit, run: SciForgeRun, artifactIds = new Set<string>()) {
  if (executionUnitRunIds(unit).includes(run.id)) return true;
  const executionUnitIds = executionUnitIdsFromRunRefs(run);
  if (executionUnitIds.has(stripExecutionUnitPrefix(unit.id))) return true;
  const refFields = [
    unit.id,
    unit.codeRef,
    unit.stdoutRef,
    unit.stderrRef,
    unit.outputRef,
    unit.diffRef,
    unit.verificationRef,
    ...(unit.inputData ?? []),
  ];
  if (refFields.some((field) => refBelongsToRun(field, run.id))) return true;
  if (unit.outputArtifacts?.some((artifactId) => artifactIds.has(stripArtifactPrefix(artifactId)))) return true;
  if (unit.artifacts?.some((artifactId) => artifactIds.has(stripArtifactPrefix(artifactId)))) return true;
  if (unit.outputRef && artifactIds.has(stripArtifactPrefix(unit.outputRef))) return true;
  return false;
}

export function artifactsForRun(session: SciForgeSession, run?: SciForgeRun): RuntimeArtifact[] {
  if (!run) return session.artifacts;
  const rawUnits = visibleExecutionUnits(executionUnitsFromRunPayload(run))
    .filter((unit) => payloadExecutionUnitBelongsToRun(unit, run, explicitlyOwnedArtifactIdsForRun(run)));
  const artifactIds = ownedArtifactIdsForRun(session, run, rawUnits);
  return session.artifacts.filter((artifact) => artifactIds.has(artifact.id));
}

function ownedArtifactIdsForRun(
  session: SciForgeSession,
  run: SciForgeRun,
  rawUnits = executionUnitsFromRunPayload(run),
) {
  return new Set([
    ...rawUnits.flatMap(artifactIdsFromExecutionUnit),
    ...session.artifacts
      .filter((artifact) => artifactBelongsToRun(artifact, run))
      .map((artifact) => artifact.id),
    ...payloadArtifactsForRun(run).map((artifact) => artifact.id),
    ...explicitlyOwnedArtifactIdsForRun(run),
    ...(runHasOwnFailureBoundaryForOwnership(run) ? artifactIdsFromFailureBoundaryRefs(run) : []),
  ].map(stripArtifactPrefix));
}

function artifactBelongsToRun(artifact: RuntimeArtifact, run: SciForgeRun) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return asString(metadata.runId) === run.id
    || asString(metadata.sourceRunId) === run.id
    || asString(metadata.producerRunId) === run.id;
}

export function runUsesContextOnlyFastPath(run: SciForgeRun) {
  return runLinkedRefs(run).some((ref) =>
    refMatchesDirectContextOutput(ref)
    || normalizeLooseRefId(stripArtifactPrefix(ref)) === DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactId
    || normalizeLooseRefId(stripArtifactPrefix(ref)).startsWith(`${DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactId}-`)
  )
    || executionUnitsFromRunPayload(run).some((unit) =>
      unit.tool === DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId
      || refMatchesDirectContextOutput(unit.outputRef)
    )
    || artifactsFromRunPayload(run).some((artifact) =>
      artifact.id === DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactId
      || artifact.id.startsWith(`${DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactId}-`)
      || artifact.metadata?.source === DIRECT_CONTEXT_FAST_PATH_POLICY.source
    );
}

function payloadExecutionUnitBelongsToRun(unit: RuntimeExecutionUnit, run: SciForgeRun, artifactIds = new Set<string>()) {
  if (isDirectContextExecutionUnit(unit)) return true;
  return executionUnitBelongsToRun(unit, run, artifactIds);
}

function isDirectContextExecutionUnit(unit: RuntimeExecutionUnit) {
  return unit.tool === DIRECT_CONTEXT_FAST_PATH_POLICY.executionToolId
    || refMatchesDirectContextOutput(unit.outputRef);
}

function refMatchesDirectContextOutput(ref: string | undefined) {
  return ref === DIRECT_CONTEXT_FAST_PATH_POLICY.outputRef
    || Boolean(ref?.startsWith(`${DIRECT_CONTEXT_FAST_PATH_POLICY.outputRef}/`));
}

function executionUnitIdsFromRunRefs(run: SciForgeRun) {
  return new Set(runOwnedExecutionUnitRefs(run)
    .filter((ref) => ref.includes('execution-unit:'))
    .map((reference) => stripExecutionUnitPrefix(reference)));
}

function stripArtifactPrefix(value: string) {
  return value.replace(/^artifact::?/i, '');
}

function stripExecutionUnitPrefix(value: string) {
  return value.replace(/^execution-unit::?/i, '');
}

function normalizeLooseRefId(value: string) {
  return value.trim().replace(/[)\]）】,.;，。；;:：]+$/g, '');
}

function visibleExecutionUnits(units: RuntimeExecutionUnit[]) {
  return uniqueExecutionUnits(units.filter((unit) => unit.status !== 'planned'));
}

function uniqueExecutionUnits(units: RuntimeExecutionUnit[]) {
  const byId = new Map<string, RuntimeExecutionUnit>();
  for (const unit of units) {
    if (!unit.id || byId.has(unit.id)) continue;
    byId.set(unit.id, unit);
  }
  return Array.from(byId.values());
}

function artifactIdsFromExecutionUnit(unit: RuntimeExecutionUnit) {
  return [
    unit.outputRef,
    ...(unit.outputArtifacts ?? []),
    ...(unit.artifacts ?? []),
  ].filter((ref): ref is string => Boolean(ref)).map(stripArtifactPrefix);
}

function artifactIdsFromRunUiManifest(run: SciForgeRun) {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const data = isRecord(raw?.data) ? raw.data : undefined;
  const rawOutput = isRecord(raw?.output) ? raw.output : undefined;
  const dataOutput = isRecord(data?.output) ? data.output : undefined;
  const roots = [
    raw,
    raw?.payload,
    raw?.toolPayload,
    raw?.structured,
    data,
    data?.payload,
    data?.toolPayload,
    dataOutput,
    dataOutput?.payload,
    dataOutput?.result,
    rawOutput,
    rawOutput?.payload,
    rawOutput?.result,
  ];
  return roots.flatMap((root) => uiManifestArtifactRefsFromCandidate(root));
}

function explicitlyOwnedArtifactIdsForRun(run: SciForgeRun) {
  return new Set([
    ...artifactIdsFromRunUiManifest(run),
    ...runOwnedArtifactRefs(run),
  ].map(stripArtifactPrefix));
}

function uiManifestArtifactRefsFromCandidate(value: unknown) {
  const record = parseMaybeJsonObject(value);
  if (!record || !Array.isArray(record.uiManifest)) return [];
  return record.uiManifest
    .filter(isRecord)
    .map((slot) => asString(slot.artifactRef))
    .filter((ref): ref is string => Boolean(ref))
    .map(stripArtifactPrefix);
}

function artifactIdsFromFailureBoundaryRefs(run: SciForgeRun) {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  return [
    raw?.contractValidationFailure,
    raw?.validationFailure,
    raw?.failure,
    ...(Array.isArray(raw?.contractValidationFailures) ? raw.contractValidationFailures : []),
    ...(Array.isArray(raw?.validationFailures) ? raw.validationFailures : []),
    ...(Array.isArray(raw?.failures) ? raw.failures : []),
  ].flatMap(refsFromRecord)
    .filter((ref) => ref.includes('artifact:'))
    .map(stripArtifactPrefix);
}

function payloadArtifactsForRun(run: SciForgeRun) {
  const units = visibleExecutionUnits(executionUnitsFromRunPayload(run))
    .filter((unit) => payloadExecutionUnitBelongsToRun(unit, run, explicitlyOwnedArtifactIdsForRun(run)));
  return artifactsFromRunPayload(run).filter((artifact) =>
    payloadArtifactBelongsToRun(artifact, run, units)
  );
}

function runHasOwnFailureBoundaryForOwnership(run: SciForgeRun) {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  if (runUsesContextOnlyFastPath(run)) return false;
  return run.status === 'failed'
    || Boolean(asString(raw?.failureReason))
    || FAILURE_BOUNDARY_STATUSES.has(String(raw?.status ?? '').trim().toLowerCase());
}

function artifactsFromRunPayload(run: SciForgeRun): RuntimeArtifact[] {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const data = isRecord(raw?.data) ? raw.data : undefined;
  const rawOutput = isRecord(raw?.output) ? raw.output : undefined;
  const dataOutput = isRecord(data?.output) ? data.output : undefined;
  const roots = [
    raw,
    raw?.payload,
    raw?.toolPayload,
    raw?.structured,
    data,
    data?.payload,
    data?.toolPayload,
    dataOutput,
    dataOutput?.payload,
    dataOutput?.result,
    rawOutput,
    rawOutput?.payload,
    rawOutput?.result,
  ];
  return uniqueArtifacts(roots.flatMap((root) => artifactsFromCandidate(root, run.scenarioId)));
}

function payloadArtifactBelongsToRun(
  artifact: RuntimeArtifact,
  run: SciForgeRun,
  units: RuntimeExecutionUnit[],
) {
  if (artifactBelongsToRun(artifact, run)) return true;
  if (isDirectContextArtifact(artifact)) return true;
  if (units.some((unit) => artifactIdsFromExecutionUnit(unit).some((id) => stripArtifactPrefix(id) === artifact.id))) return true;
  return explicitlyOwnedArtifactIdsForRun(run).has(artifact.id);
}

function isDirectContextArtifact(artifact: RuntimeArtifact) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return artifact.id === DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactId
    || artifact.id.startsWith(`${DIRECT_CONTEXT_FAST_PATH_POLICY.reportArtifactId}-`)
    || asString(metadata.source) === DIRECT_CONTEXT_FAST_PATH_POLICY.source;
}

function artifactsFromCandidate(value: unknown, fallbackScenario: RuntimeArtifact['producerScenario']): RuntimeArtifact[] {
  const record = parseMaybeJsonObject(value);
  if (!record) return [];
  const direct = normalizeArtifactList(record.artifacts, fallbackScenario);
  if (direct.length) return direct;
  return [
    record.payload,
    record.toolPayload,
    record.result,
  ].flatMap((candidate) => normalizeArtifactList(parseMaybeJsonObject(candidate)?.artifacts, fallbackScenario));
}

function normalizeArtifactList(value: unknown, fallbackScenario: RuntimeArtifact['producerScenario']): RuntimeArtifact[] {
  if (!Array.isArray(value)) return [];
  return value.map((artifact) => normalizeArtifact(artifact, fallbackScenario)).filter((artifact): artifact is RuntimeArtifact => Boolean(artifact));
}

function normalizeArtifact(value: unknown, fallbackScenario: RuntimeArtifact['producerScenario']): RuntimeArtifact | undefined {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id) ?? asString(value.artifactId);
  const type = asString(value.type) ?? asString(value.artifactType);
  if (!id || !type) return undefined;
  return {
    id: stripArtifactPrefix(id),
    type,
    producerScenario: (asString(value.producerScenario) ?? fallbackScenario) as RuntimeArtifact['producerScenario'],
    schemaVersion: asString(value.schemaVersion) ?? 'unknown',
    dataRef: asString(value.dataRef),
    data: value.data,
    metadata: isRecord(value.metadata) ? value.metadata : undefined,
  };
}

function uniqueArtifacts(artifacts: RuntimeArtifact[]) {
  const byId = new Map<string, RuntimeArtifact>();
  for (const artifact of artifacts) {
    if (!artifact.id || byId.has(artifact.id)) continue;
    byId.set(artifact.id, artifact);
  }
  return Array.from(byId.values());
}

function executionUnitsFromRunPayload(run: SciForgeRun): RuntimeExecutionUnit[] {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const data = isRecord(raw?.data) ? raw.data : undefined;
  const rawOutput = isRecord(raw?.output) ? raw.output : undefined;
  const dataOutput = isRecord(data?.output) ? data.output : undefined;
  const roots = [
    raw,
    raw?.payload,
    raw?.toolPayload,
    raw?.structured,
    data,
    data?.payload,
    data?.toolPayload,
    dataOutput,
    dataOutput?.payload,
    dataOutput?.result,
    rawOutput,
    rawOutput?.payload,
    rawOutput?.result,
  ];
  return uniqueExecutionUnits(roots.flatMap((root) => executionUnitsFromCandidate(root)));
}

function executionUnitsFromCandidate(value: unknown): RuntimeExecutionUnit[] {
  const record = parseMaybeJsonObject(value);
  if (!record) return [];
  const direct = normalizeExecutionUnitList(record.executionUnits);
  if (direct.length) return direct;
  return [
    record.payload,
    record.toolPayload,
    record.result,
  ].flatMap((candidate) => normalizeExecutionUnitList(parseMaybeJsonObject(candidate)?.executionUnits));
}

function normalizeExecutionUnitList(value: unknown): RuntimeExecutionUnit[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeExecutionUnit).filter((unit): unit is RuntimeExecutionUnit => Boolean(unit));
}

function normalizeExecutionUnit(value: unknown): RuntimeExecutionUnit | undefined {
  if (!isRecord(value)) return undefined;
  const id = asString(value.id);
  const status = asExecutionUnitStatus(value.status);
  if (!id || !status) return undefined;
  return {
    id,
    tool: asString(value.tool) || asString(value.name) || 'runtime.execution-unit',
    params: asString(value.params) || JSON.stringify(value.params ?? value.input ?? {}),
      status,
      hash: asString(value.hash) || id,
      runId: asString(value.runId),
      sourceRunId: asString(value.sourceRunId),
      producerRunId: asString(value.producerRunId),
      agentServerRunId: asString(value.agentServerRunId),
      code: asString(value.code) || asString(value.command),
    language: asString(value.language),
    codeRef: asString(value.codeRef),
    entrypoint: asString(value.entrypoint),
    stdoutRef: asString(value.stdoutRef),
    stderrRef: asString(value.stderrRef),
    outputRef: asString(value.outputRef),
    attempt: asNumber(value.attempt),
    parentAttempt: asNumber(value.parentAttempt),
    selfHealReason: asString(value.selfHealReason),
    patchSummary: asString(value.patchSummary),
    diffRef: asString(value.diffRef),
    failureReason: asString(value.failureReason),
    seed: asNumber(value.seed),
    time: asString(value.time),
    environment: asString(value.environment),
    inputData: asStringArray(value.inputData) ?? asStringArray(value.inputs),
    dataFingerprint: asString(value.dataFingerprint),
    databaseVersions: asStringArray(value.databaseVersions),
    artifacts: asStringArray(value.artifacts),
    outputArtifacts: asStringArray(value.outputArtifacts),
    scenarioPackageRef: isScenarioPackageRef(value.scenarioPackageRef) ? value.scenarioPackageRef : undefined,
    skillPlanRef: asString(value.skillPlanRef),
    uiPlanRef: asString(value.uiPlanRef),
    runtimeProfileId: asString(value.runtimeProfileId),
    requiredInputs: asStringArray(value.requiredInputs),
    recoverActions: asStringArray(value.recoverActions),
    nextStep: asString(value.nextStep),
    verificationRef: asString(value.verificationRef),
    verificationVerdict: asVerificationVerdict(value.verificationVerdict),
  };
}

function runLinkedRefs(run: SciForgeRun) {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  return Array.from(new Set([
    ...(run.objectReferences ?? []).flatMap((reference) => [reference.ref, reference.executionUnitId].filter((ref): ref is string => Boolean(ref))),
    ...(run.references ?? []).map((reference) => reference.ref),
    ...refsFromRecord(raw),
  ].filter((ref): ref is string => Boolean(ref))));
}

function runOwnedExecutionUnitRefs(run: SciForgeRun) {
  const raw = isRecord(run.raw) ? run.raw : undefined;
  const displayIntent = isRecord(raw?.displayIntent) ? raw.displayIntent : undefined;
  const presentation = isRecord(raw?.resultPresentation)
    ? raw.resultPresentation
    : isRecord(displayIntent?.resultPresentation)
      ? displayIntent.resultPresentation
      : undefined;
  const taskRunCard = isRecord(presentation?.taskRunCard) ? presentation.taskRunCard : undefined;
  const runHasOwnFailureBoundary = !runUsesContextOnlyFastPath(run)
    && (run.status === 'failed'
      || asString(raw?.failureReason)
      || FAILURE_BOUNDARY_STATUSES.has(String(raw?.status ?? '').trim().toLowerCase()));
  return Array.from(new Set([
    ...(run.objectReferences ?? [])
      .filter((reference) => executionUnitReferenceIsOwnedByRun(reference, run))
      .flatMap((reference) => [reference.ref, reference.executionUnitId].filter((ref): ref is string => Boolean(ref))),
    ...(run.references ?? [])
      .filter((reference) => reference.runId === run.id || refBelongsToRun(reference.ref, run.id))
      .map((reference) => reference.ref),
    ...(asStringArray(raw?.executionUnitRefs) ?? []),
    ...(asStringArray(taskRunCard?.executionUnitRefs) ?? []),
    ...(runHasOwnFailureBoundary ? (asStringArray(raw?.refs) ?? []).filter((ref) => ref.includes('execution-unit:')) : []),
  ]));
}

function runOwnedArtifactRefs(run: SciForgeRun) {
  return [
    ...(run.objectReferences ?? [])
      .filter((reference) => reference.kind === 'artifact' && reference.runId === run.id)
      .map((reference) => reference.ref),
    ...(run.references ?? [])
      .filter((reference) => reference.runId === run.id && reference.ref.includes('artifact:'))
      .map((reference) => reference.ref),
  ];
}

function executionUnitReferenceIsOwnedByRun(reference: NonNullable<SciForgeRun['objectReferences']>[number], run: SciForgeRun) {
  if (reference.kind !== 'execution-unit') return false;
  if (reference.runId) return reference.runId === run.id;
  return refBelongsToRun(reference.ref, run.id) || refFragmentEqualsRun(reference.ref, run.id);
}

function executionUnitRunIds(unit: RuntimeExecutionUnit) {
  const record = unit as RuntimeExecutionUnit & Record<string, unknown>;
  return [
    asString(record.runId),
    asString(record.sourceRunId),
    asString(record.producerRunId),
    asString(record.agentServerRunId),
  ].filter((value): value is string => Boolean(value));
}

function refBelongsToRun(ref: string | undefined, runId: string) {
  if (!ref) return false;
  const text = normalizeLooseRefId(ref);
  const prefix = `run:${runId}`;
  return text === prefix || text.startsWith(`${prefix}/`) || text.startsWith(`${prefix}#`);
}

function refFragmentEqualsRun(ref: string | undefined, runId: string) {
  if (!ref) return false;
  const fragment = normalizeLooseRefId(ref).split('#').at(-1);
  return fragment === runId;
}

function refsFromRecord(value: unknown): string[] {
  const record = parseMaybeJsonObject(value);
  if (!record) return [];
  const nestedRecords = [
    record.contractValidationFailure,
    record.validationFailure,
    record.failure,
    record.backendRepair,
    record.acceptanceRepair,
    record.repairState,
    record.backgroundCompletion,
    ...(Array.isArray(record.contractValidationFailures) ? record.contractValidationFailures : []),
    ...(Array.isArray(record.validationFailures) ? record.validationFailures : []),
    ...(Array.isArray(record.failures) ? record.failures : []),
    ...(Array.isArray(record.stages) ? record.stages : []),
    ...(Array.isArray(record.objectReferences) ? record.objectReferences : []),
    ...(Array.isArray(record.uiManifest) ? record.uiManifest : []),
    ...(Array.isArray(record.artifactActions) ? record.artifactActions : []),
  ];
  const resultPresentation = isRecord(record.resultPresentation) ? record.resultPresentation : undefined;
  if (resultPresentation) {
    nestedRecords.push(...(Array.isArray(resultPresentation.artifactActions) ? resultPresentation.artifactActions : []));
  }
  return [
    asString(record.ref),
    asString(record.artifactRef),
    asString(record.outputRef),
    asString(record.dataRef),
    ...(asStringArray(record.refs) ?? []),
    ...(asStringArray(record.auditRefs) ?? []),
    ...(asStringArray(record.relatedRefs) ?? []),
    ...(asStringArray(record.invalidRefs) ?? []),
    ...(asStringArray(record.unresolvedUris) ?? []),
    ...(asStringArray(record.artifactRefs) ?? []),
    ...(asStringArray(record.executionUnitRefs) ?? []),
    ...(asStringArray(record.verificationRefs) ?? []),
    ...(asStringArray(record.workEvidenceRefs) ?? []),
    ...nestedRecords.flatMap(refsFromRecord),
  ].filter((ref): ref is string => Boolean(ref));
}

function parseMaybeJsonObject(value: unknown): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('{') || !trimmed.endsWith('}')) return undefined;
  try {
    const parsed = JSON.parse(trimmed);
    return isRecord(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
  return entries.length ? entries : undefined;
}

function asExecutionUnitStatus(value: unknown): RuntimeExecutionUnit['status'] | undefined {
  if (value === 'planned'
    || value === 'running'
    || value === 'done'
    || value === 'failed'
    || value === 'record-only'
    || value === 'repair-needed'
    || value === 'self-healed'
    || value === 'failed-with-reason'
    || value === 'needs-human') return value;
  return undefined;
}

function asVerificationVerdict(value: unknown): RuntimeExecutionUnit['verificationVerdict'] | undefined {
  if (value === 'pass' || value === 'fail' || value === 'uncertain' || value === 'needs-human' || value === 'unverified') return value;
  return undefined;
}

function isScenarioPackageRef(value: unknown): value is RuntimeExecutionUnit['scenarioPackageRef'] {
  return isRecord(value)
    && typeof value.id === 'string'
    && typeof value.version === 'string'
    && (value.source === 'built-in' || value.source === 'workspace' || value.source === 'generated');
}
