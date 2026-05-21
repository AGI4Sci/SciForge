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
    artifact.dataRef ? ['材料', '源文件已归档'] : undefined,
    executionUnit?.codeRef ? ['过程代码', '已归档'] : undefined,
    executionUnit?.stdoutRef ? ['过程输出', '已归档'] : undefined,
    executionUnit?.stderrRef ? ['过程诊断', '已归档'] : undefined,
    executionUnit?.outputRef ? ['结果材料', '已归档'] : undefined,
    ...downloads.map((item) => [item.name, safeDownloadValue(item.path || item.key || '可下载内容')] as [string, string]),
  ].filter((item): item is [string, string] => Boolean(item));
}

function artifactLineageRows(
  artifact: RuntimeArtifact,
  executionUnit: RuntimeExecutionUnit | undefined,
): Array<[string, string]> {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const derivation: Record<string, unknown> = isRecord(metadata.derivation) ? metadata.derivation : {};
  const sourceRefs = asStringList(derivation.sourceRefs);
  return [
    ['来源场景', artifact.producerScenario],
    ['生成能力', asStringList(artifact.metadata?.producerSkillIds).join(', ') || asString(artifact.metadata?.producerSkillId) || '未声明'],
    ['过程状态', executionUnit ? '过程材料已匹配' : '等待过程线索'],
    ['创建时间', asString(artifact.metadata?.createdAt) ?? '未声明'],
    asString(derivation.kind) ? ['衍生方式', asString(derivation.kind)!] : undefined,
    asString(derivation.parentArtifactRef) ? ['父级材料', '已保留'] : undefined,
    sourceRefs.length ? ['来源材料', `${sourceRefs.length} 条已保留`] : undefined,
  ].filter((row): row is [string, string] => Boolean(row));
}

function rowCountForReference(data: unknown) {
  if (Array.isArray(data)) return data.length;
  if (!isRecord(data)) return undefined;
  const rows = Array.isArray(data.rows) ? data.rows : Array.isArray(data.records) ? data.records : undefined;
  return rows?.length;
}

function safeDownloadValue(value: string) {
  if (/\.sciforge\/|dataRef|stdout|stderr|provider|execution-unit/i.test(value)) return '已归档';
  return value;
}
