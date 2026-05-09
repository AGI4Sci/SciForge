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

export function agentServerCurrentReferencePromptPolicyLines() {
  return [
    'Current-reference contract: if uiStateSummary.currentReferences or contextEnvelope.sessionFacts.currentReferences is non-empty, treat those refs as explicit current-turn inputs. The final message, claims, or artifact content must reflect that each non-UI ref was actually read/used. Merely echoing it as objectReferences or preserving a file chip is not enough.',
    'If the current refs cannot be read or do not contain enough information to answer, return executionUnits.status="failed-with-reason" with the missing/unreadable refs and a precise nextStep. Do not answer from old session memory, priorAttempts, or broad scenario defaults.',
    'Current-reference digest contract: when uiStateSummary.currentReferenceDigests or contextEnvelope.sessionFacts.currentReferenceDigests exists, use those bounded digests first. Do not run generation-stage shell/browser loops that print full PDFs, long documents, or large logs into context; if more evidence is needed, return taskFiles for a workspace task that reads refs by path and writes bounded artifacts.',
  ];
}

export function agentServerBibliographicVerificationPromptPolicyLines() {
  return [
    'Bibliographic verification contract: never mark a PMID, DOI, trial id, citation, or paper record as corrected/verified unless the returned title, year, journal, and identifier correspond to the same work as the source claim.',
    'If an identifier lookup returns a title mismatch, topic mismatch, unrelated journal, or only a broad review when the source claim is a trial/cohort/paper, preserve the original claim and mark it needs-verification with the mismatch reason and search terms. Do not substitute the unrelated record as a correction.',
    'For literature artifacts, keep original_title, verified_title, title_match, identifier_match, verification_status, and verification_notes fields when correcting references so SciForge and users can audit the match.',
  ];
}
