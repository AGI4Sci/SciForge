import type { EvidenceLevel } from '../../data';
import type { RuntimeArtifact, RuntimeExecutionUnit, SciForgeSession, UIManifestSlot } from '../../domain';
import { buildExecutionBundle, evaluateExecutionBundleExport } from '../../exportPolicy';
import { exportJsonFile } from '../exportUtils';
import {
  artifactProvenanceSource,
  artifactProvenanceSourceVariant,
  type ArtifactProvenanceSource,
} from '../../../../../packages/support/artifact-preview';

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

export function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

export function toRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

export function artifactMeta(artifact?: RuntimeArtifact) {
  if (!artifact) return 'empty';
  return `${artifact.type} · ${artifact.schemaVersion}`;
}

export function artifactSource(artifact?: RuntimeArtifact): 'project-tool' | 'record-only' | 'empty' {
  return artifactProvenanceSource(artifact);
}

export function sourceVariant(source: ReturnType<typeof artifactSource>): 'success' | 'muted' | 'warning' {
  return artifactProvenanceSourceVariant(source as ArtifactProvenanceSource);
}

export function executionUnitForArtifact(session: SciForgeSession, artifact?: RuntimeArtifact): RuntimeExecutionUnit | undefined {
  if (!artifact) return undefined;
  return session.executionUnits.find((unit) => {
    const refs = [...(unit.artifacts ?? []), ...(unit.outputArtifacts ?? [])];
    const metadataRefs = Object.values(artifact.metadata ?? {}).filter((value): value is string => typeof value === 'string');
    const outputRef = asString(unit.outputRef);
    return refs.includes(artifact.id)
      || refs.includes(artifact.type)
      || (artifact.dataRef ? refs.includes(artifact.dataRef) : false)
      || Boolean(outputRef && metadataRefs.some((ref) => ref === outputRef || ref.startsWith(`${outputRef.replace(/\/+$/, '')}/`)));
  });
}

export function viewCompositionSummary(slot: UIManifestSlot) {
  const encoding = slot.encoding ?? {};
  const parts = [
    encoding.colorBy ? `colorBy=${encoding.colorBy}` : undefined,
    encoding.splitBy ? `splitBy=${encoding.splitBy}` : undefined,
    encoding.overlayBy ? `overlayBy=${encoding.overlayBy}` : undefined,
    encoding.facetBy ? `facetBy=${encoding.facetBy}` : undefined,
    encoding.syncViewport ? 'syncViewport=true' : undefined,
    slot.layout?.mode ? `layout=${slot.layout.mode}` : undefined,
    slot.compare?.mode ? `compare=${slot.compare.mode}` : undefined,
  ].filter(Boolean);
  return parts.join(' · ');
}

export function asStringList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

export function pickEvidenceLevel(value: unknown): EvidenceLevel {
  const levels: EvidenceLevel[] = ['meta', 'rct', 'cohort', 'case', 'experimental', 'review', 'database', 'preprint', 'prediction'];
  return levels.includes(value as EvidenceLevel) ? value as EvidenceLevel : 'prediction';
}

export function compactParams(params: string) {
  return params.length > 128 ? `${params.slice(0, 125)}...` : params;
}

export function exportExecutionBundle(session: SciForgeSession) {
  const decision = evaluateExecutionBundleExport(session);
  if (!decision.allowed) {
    window.alert(`导出被 artifact policy 阻止：${decision.blockedArtifactIds.join(', ')}`);
    return;
  }
  exportJsonFile(`execution-units-${session.scenarioId}-${session.sessionId}.json`, buildExecutionBundle(session, decision));
}

export function formatResultFileBytes(value: number) {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}
