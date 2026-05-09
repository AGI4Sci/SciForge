import type { SciForgeSharedSkillDomain } from './handoff';

const DEFAULT_ARTIFACT_TYPE_BY_SKILL_DOMAIN: Record<SciForgeSharedSkillDomain, string> = {
  literature: 'paper-list',
  structure: 'structure-summary',
  omics: 'omics-differential-expression',
  knowledge: 'knowledge-graph',
};

export function defaultArtifactSchemaForSkillDomain(skillDomain: SciForgeSharedSkillDomain): Record<string, unknown> {
  return { type: DEFAULT_ARTIFACT_TYPE_BY_SKILL_DOMAIN[skillDomain] };
}

export function agentServerToolPayloadProtocolContractLines() {
  return [
    'ToolPayload schema is strict: uiManifest, claims, executionUnits, and artifacts must be arrays; every uiManifest slot must be an object with componentId and a string artifactRef when present; every artifact must have non-empty id and type. Do not put result rows inside uiManifest; put data in artifacts[].data or artifacts[].dataRef.',
    'Use uiManifest only as view routing metadata. All user-visible result content, tables, lists, reports, raw provider traces, and files must be represented as artifacts with durable dataRef/path or inline data that SciForge can persist.',
    'When repairing schema failures, preserve the task-specific componentId/artifactRef/artifact type from selectedComponentIds, expectedArtifactTypes, incoming uiManifest, or generated artifacts. If none is known, use a generic unknown-artifact-inspector slot bound to a runtime-result artifact; do not force literature/report-specific components into unrelated scenarios.',
  ];
}

export function agentServerArtifactSelectionPromptPolicyLines() {
  return [
    'Only treat expectedArtifactTypes as required when the list is non-empty. If it is empty, infer the minimal output from the raw user prompt and do not add scenario-default artifacts.',
    'If expectedArtifactTypes contains multiple artifacts, generate a coordinated Python task or small Python module set that emits every requested artifact type. A partial package skill result is not enough unless the missing artifact has a clear failed-with-reason ExecutionUnit.',
  ];
}
