import type { RuntimeExecutionUnit, SciForgeRun, SciForgeSession } from '../../domain';

export function executionUnitsForRun(session: SciForgeSession, run?: SciForgeRun): RuntimeExecutionUnit[] {
  const visibleUnits = session.executionUnits.filter((unit) => unit.status !== 'planned');
  if (!run) return visibleUnits;
  const artifactIds = artifactIdsForRun(session, run);
  const matched = visibleUnits.filter((unit) => executionUnitBelongsToRun(unit, run, artifactIds));
  if (matched.length) return matched;
  return session.runs.length <= 1 ? visibleUnits : [];
}

export function executionUnitBelongsToRun(unit: RuntimeExecutionUnit, run: SciForgeRun, artifactIds = artifactIdsFromRunRefs(run)) {
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

function artifactIdsForRun(session: SciForgeSession, run: SciForgeRun) {
  return new Set([
    ...artifactIdsFromRunRefs(run),
    ...session.artifacts
      .filter((artifact) => artifact.metadata?.runId === run.id)
      .map((artifact) => artifact.id),
  ]);
}

function artifactIdsFromRunRefs(run: SciForgeRun) {
  return new Set((run.objectReferences ?? [])
    .filter((reference) => reference.kind === 'artifact')
    .map((reference) => stripArtifactPrefix(reference.ref)));
}

function stripArtifactPrefix(value: string) {
  return value.replace(/^artifact:/i, '');
}
