import { nowIso, type SciForgeRun, type SciForgeSession, type RuntimeArtifact, type RuntimeExecutionUnit } from './domain';

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
