import type { SciForgeSharedSkillDomain } from './handoff';

export type ArtifactReferencePolicyRecord = Record<string, unknown>;

export interface ArtifactReferenceScope {
  skillDomain: SciForgeSharedSkillDomain;
}

const ARTIFACT_TYPE_TERMS_BY_SKILL_DOMAIN: Record<SciForgeSharedSkillDomain, RegExp> = {
  literature: /paper|literature|evidence|research-report/,
  structure: /structure|molecule|pdb|protein|research-report/,
  omics: /omics|expression|volcano|heatmap|umap|research-report/,
  knowledge: /knowledge|graph|network|sequence|research-report/,
};

export function artifactMatchesReferenceScope(
  artifact: ArtifactReferencePolicyRecord,
  scope: ArtifactReferenceScope,
) {
  const producer = artifactReferenceProducerText(artifact);
  if (producer) return producer.includes(scope.skillDomain);
  const type = String(artifact.type || artifact.id || '').toLowerCase();
  return ARTIFACT_TYPE_TERMS_BY_SKILL_DOMAIN[scope.skillDomain]?.test(type) ?? true;
}

function artifactReferenceProducerText(artifact: ArtifactReferencePolicyRecord) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return [
    stringField(artifact.producerScenario),
    stringField(artifact.producerScenarioId),
    stringField(metadata.producerScenario),
    stringField(metadata.skillDomain),
  ].filter(Boolean).join(' ').toLowerCase();
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
