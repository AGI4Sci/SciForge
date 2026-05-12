import type { RuntimeArtifact, RuntimeExecutionUnit, SciForgeRun, SciForgeSession } from '../../domain';

export function executionUnitsForRun(session: SciForgeSession, run?: SciForgeRun): RuntimeExecutionUnit[] {
  const visibleUnits = visibleExecutionUnits([
    ...session.executionUnits,
    ...(!run ? session.runs.flatMap(executionUnitsFromRunPayload) : []),
  ]);
  if (!run) return uniqueExecutionUnits(visibleUnits);
  const artifactIds = artifactIdsForRun(session, run);
  const rawUnits = visibleExecutionUnits(executionUnitsFromRunPayload(run));
  const strictMatched = visibleUnits.filter((unit) => executionUnitBelongsToRun(unit, run, artifactIds));
  const packageMatched = !strictMatched.length && session.runs.length <= 1 && run.scenarioPackageRef
    ? visibleUnits.filter((unit) => executionUnitPackageMatchesRun(unit, run))
    : [];
  const matched = uniqueExecutionUnits([...strictMatched, ...packageMatched, ...rawUnits]);
  if (matched.length) return matched;
  return session.runs.length <= 1 ? visibleUnits : [];
}

export function executionUnitBelongsToRun(unit: RuntimeExecutionUnit, run: SciForgeRun, artifactIds = artifactIdsFromRunRefs(run)) {
  const executionUnitIds = executionUnitIdsFromRunRefs(run);
  if (executionUnitIds.has(stripExecutionUnitPrefix(unit.id))) return true;
  const runNeedles = [`run:${run.id}`, run.id];
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
  if (refFields.some((field) => field && runNeedles.some((needle) => field.includes(needle)))) return true;
  if (unit.outputArtifacts?.some((artifactId) => artifactIds.has(stripArtifactPrefix(artifactId)))) return true;
  if (unit.artifacts?.some((artifactId) => artifactIds.has(stripArtifactPrefix(artifactId)))) return true;
  if (unit.outputRef && artifactIds.has(stripArtifactPrefix(unit.outputRef))) return true;
  return false;
}

export function artifactsForRun(session: SciForgeSession, run?: SciForgeRun): RuntimeArtifact[] {
  if (!run) return session.artifacts;
  const artifactIds = artifactIdsForRun(session, run);
  const matched = session.artifacts.filter((artifact) => artifactIds.has(artifact.id));
  if (matched.length) return matched;
  return session.runs.length <= 1 ? session.artifacts : [];
}

function artifactIdsForRun(session: SciForgeSession, run: SciForgeRun) {
  return new Set([
    ...artifactIdsFromRunRefs(run),
    ...executionUnitsFromRunPayload(run).flatMap(artifactIdsFromExecutionUnit),
    ...session.artifacts
      .filter((artifact) => artifact.metadata?.runId === run.id)
      .map((artifact) => artifact.id),
  ]);
}

function artifactIdsFromRunRefs(run: SciForgeRun) {
  const objectArtifactRefs = (run.objectReferences ?? [])
    .filter((reference) => reference.kind === 'artifact')
    .map((reference) => reference.ref);
  return new Set([
    ...objectArtifactRefs,
    ...runLinkedRefs(run).filter((ref) => ref.includes('artifact:')),
  ].map((reference) => stripArtifactPrefix(reference)));
}

function executionUnitIdsFromRunRefs(run: SciForgeRun) {
  return new Set(runLinkedRefs(run)
    .filter((ref) => ref.includes('execution-unit:'))
    .map((reference) => stripExecutionUnitPrefix(reference)));
}

function stripArtifactPrefix(value: string) {
  return value.replace(/^artifact::?/i, '');
}

function stripExecutionUnitPrefix(value: string) {
  return value.replace(/^execution-unit::?/i, '');
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

function executionUnitPackageMatchesRun(unit: RuntimeExecutionUnit, run: SciForgeRun) {
  const runPackageKey = packageKey(run.scenarioPackageRef);
  const unitPackageKey = packageKey(unit.scenarioPackageRef);
  return Boolean(runPackageKey && unitPackageKey === runPackageKey);
}

function packageKey(value: RuntimeExecutionUnit['scenarioPackageRef'] | SciForgeRun['scenarioPackageRef']) {
  return value ? `${value.id}@${value.version}` : '';
}

function artifactIdsFromExecutionUnit(unit: RuntimeExecutionUnit) {
  return [
    unit.outputRef,
    ...(unit.outputArtifacts ?? []),
    ...(unit.artifacts ?? []),
  ].filter((ref): ref is string => Boolean(ref)).map(stripArtifactPrefix);
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
    dataOutput?.message,
    dataOutput?.text,
    dataOutput?.error,
    rawOutput,
    rawOutput?.payload,
    rawOutput?.result,
    rawOutput?.message,
    rawOutput?.text,
    rawOutput?.error,
    parseMaybeJsonObject(run.response),
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
    record.message,
    record.text,
    record.error,
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
    ...refsFromRecord(parseMaybeJsonObject(run.response)),
  ].filter((ref): ref is string => Boolean(ref))));
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
    ...(Array.isArray(record.artifactActions) ? record.artifactActions : []),
  ];
  const resultPresentation = isRecord(record.resultPresentation) ? record.resultPresentation : undefined;
  if (resultPresentation) {
    nestedRecords.push(...(Array.isArray(resultPresentation.artifactActions) ? resultPresentation.artifactActions : []));
  }
  return [
    asString(record.ref),
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
