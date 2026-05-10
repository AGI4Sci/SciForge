import { scenarios, type ScenarioId } from '../data';
import { SCENARIO_SPECS } from '@sciforge/scenario-core/scenario-specs';
import type { RuntimeArtifact, RuntimeExecutionUnit, SciForgeReference, SciForgeSession } from '../domain';
import {
  artifactReferenceKind as packageArtifactReferenceKind,
  referenceForResultSlotLike,
} from '../../../../packages/support/object-references';
import type { ResolvedViewPlanItem } from './results/viewPlanResolver';
import { asString, asStringList, executionUnitForArtifact, isRecord } from './results/resultArtifactHelpers';

export type ArtifactInspectorDownload = {
  name: string;
  path?: string;
  key?: string;
};

export type ArtifactInspectorModel = {
  executionUnit?: RuntimeExecutionUnit;
  files: Array<[string, string]>;
  handoffTargets: ScenarioId[];
  lineage: Array<[string, string]>;
};

export function isBuiltInScenarioId(value: string): value is ScenarioId {
  return Object.prototype.hasOwnProperty.call(SCENARIO_SPECS, value);
}

export function referenceForResultSlot(item: ResolvedViewPlanItem): SciForgeReference {
  return referenceForResultSlotLike(item);
}

export function artifactReferenceKind(artifact: RuntimeArtifact, componentId = ''): SciForgeReference['kind'] {
  return packageArtifactReferenceKind(artifact, componentId, rowCountForReference(artifact.data));
}

export function artifactInspectorModel({
  artifact,
  session,
  currentScenarioId,
  downloads = [],
}: {
  artifact: RuntimeArtifact;
  session: SciForgeSession;
  currentScenarioId: ScenarioId;
  downloads?: ArtifactInspectorDownload[];
}): ArtifactInspectorModel {
  const executionUnit = executionUnitForArtifact(session, artifact);
  return {
    executionUnit,
    files: artifactInspectorFiles(artifact, executionUnit, downloads),
    handoffTargets: handoffTargetsForArtifact(artifact, currentScenarioId),
    lineage: artifactLineageRows(artifact, executionUnit),
  };
}

export function handoffTargetsForArtifact(artifact: RuntimeArtifact, currentScenarioId: ScenarioId): ScenarioId[] {
  const declaredTargets = asStringList(isRecord(artifact.metadata) ? artifact.metadata.handoffTargets : undefined)
    .filter(isBuiltInScenarioId);
  const schemaTargets = isBuiltInScenarioId(artifact.producerScenario)
    ? SCENARIO_SPECS[artifact.producerScenario].outputArtifacts
      .find((schema) => schema.type === artifact.type)
      ?.consumers ?? []
    : scenarios.flatMap((scenario) => SCENARIO_SPECS[scenario.id].outputArtifacts
      .filter((schema) => schema.type === artifact.type)
      .flatMap((schema) => schema.consumers));
  return Array.from(new Set([...declaredTargets, ...schemaTargets]))
    .filter((target) => target !== currentScenarioId);
}

function artifactInspectorFiles(
  artifact: RuntimeArtifact,
  executionUnit: RuntimeExecutionUnit | undefined,
  downloads: ArtifactInspectorDownload[],
): Array<[string, string]> {
  return [
    artifact.dataRef ? ['dataRef', artifact.dataRef] : undefined,
    executionUnit?.codeRef ? ['codeRef', executionUnit.codeRef] : undefined,
    executionUnit?.stdoutRef ? ['stdoutRef', executionUnit.stdoutRef] : undefined,
    executionUnit?.stderrRef ? ['stderrRef', executionUnit.stderrRef] : undefined,
    executionUnit?.outputRef ? ['outputRef', executionUnit.outputRef] : undefined,
    ...downloads.map((item) => [item.name, item.path || item.key || 'download payload'] as [string, string]),
  ].filter((item): item is [string, string] => Boolean(item));
}

function artifactLineageRows(
  artifact: RuntimeArtifact,
  executionUnit: RuntimeExecutionUnit | undefined,
): Array<[string, string]> {
  return [
    ['producer scenario', artifact.producerScenario],
    ['producer skill', asStringList(artifact.metadata?.producerSkillIds).join(', ') || asString(artifact.metadata?.producerSkillId) || 'unknown'],
    ['execution unit', executionUnit ? `${executionUnit.id} · ${executionUnit.tool} · ${executionUnit.status}` : 'missing'],
    ['created', asString(artifact.metadata?.createdAt) ?? 'unknown'],
  ];
}

function rowCountForReference(data: unknown) {
  if (Array.isArray(data)) return data.length;
  if (!isRecord(data)) return undefined;
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.records) ? data.records : undefined;
  return rows?.length;
}
