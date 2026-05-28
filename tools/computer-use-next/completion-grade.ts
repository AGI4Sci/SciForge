import {
  CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF,
  isCanonicalCuNextCompletionEvidenceRef,
  validateCuNextEvidenceForProjectCompletion,
  type CuNextEvidenceClassificationInput,
} from './evidence-classification.js';
import { projectCuNextRuntimeArtifactPresentationEvidence } from './acceptance-projection.js';
import type { CuNextTaskMapping } from './task-map.js';

export const CU_NEXT_COMPLETION_EVIDENCE_SCHEMA_VERSION =
  'sciforge.computer-use.isolated-desktop-l3-workflow-evidence.v1' as const;

export interface CuNextCompletionGradeEvidenceContext {
  refExists?: (ref: string) => boolean;
  refScopeDescription?: string;
}

export function cuNextCompletionGradeEvidenceIssues(
  data: unknown,
  mapping: CuNextTaskMapping,
  completionEvidenceData?: unknown,
  context: CuNextCompletionGradeEvidenceContext = {},
): string[] {
  if (!mapping.requirements.includes('l3-workflow-refs')) return [];
  const record = isRecord(data) ? data : {};
  const completionEvidenceRef = stringValue(record.completionEvidenceRef);
  if (!completionEvidenceRef) {
    return ['completionEvidenceRef is required and must point to validator-accepted isolated-L3 workflow evidence.'];
  }
  if (!isCanonicalCuNextCompletionEvidenceRef(completionEvidenceRef)) {
    return [`completionEvidenceRef must be the same-round bundle-local ${CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF}.`];
  }
  if (completionEvidenceData === undefined) {
    return [`completionEvidenceRef ${completionEvidenceRef} could not be loaded from the evidence bundle.`];
  }
  const evidenceRecord = isRecord(completionEvidenceData) ? completionEvidenceData : {};
  const strictIssues = cuNextCompletedL3CompletionEvidenceIssues(evidenceRecord, context);
  const bindingIssues = cuNextCompletionEvidenceTaskArtifactBindingIssues(record, evidenceRecord);
  const result = validateCuNextEvidenceForProjectCompletion(
    {
      ...cuNextCompletionClassificationInput(evidenceRecord),
      completionEvidenceRef,
      validatorAcceptedL3: strictIssues.length === 0,
    },
    'l3-workflow',
  );
  return result.ok && bindingIssues.length === 0 ? [] : uniqueStrings([...strictIssues, ...bindingIssues, ...result.reasons]);
}

export function cuNextCompletionClassificationInput(data: unknown): CuNextEvidenceClassificationInput {
  const record = isRecord(data) ? data : {};
  const completionEvidence = recordValue(record.completionEvidence);
  const l3Workflow = isRecord(completionEvidence.l3Workflow)
    ? completionEvidence.l3Workflow
    : recordValue(record.l3Workflow);
  const projectedPresentation = projectCuNextRuntimeArtifactPresentationEvidence({
    traceRef: stringValue(record.traceRef),
    finalArtifactRef: stringValue(record.finalArtifactRef),
    finalVisibleScreenshotRef: stringValue(record.finalVisibleScreenshotRef),
    guiPresentRecordRef: stringValue(recordValue(record.guiPresent).recordRef),
    guiPresentPayloadRef: stringValue(recordValue(record.guiPresent).payloadRef),
    guiPresentRecords: [record.guiPresent, record],
  });
  const evidenceClaimKinds = records(record.evidenceClaims).map((claim) => ({ kind: stringValue(claim.kind) }));
  if (
    projectedPresentation.finalArtifactRef
    && projectedPresentation.guiPresentEvidenceClaim
    && !evidenceClaimKinds.some((claim) => claim.kind === 'gui-present-record')
  ) {
    evidenceClaimKinds.push({ kind: 'gui-present-record' });
  }
  return {
    kind: stringValue(completionEvidence.kind) ?? stringValue(record.kind),
    evidenceKind: stringValue(completionEvidence.evidenceKind) ?? stringValue(record.evidenceKind),
    schemaVersion: stringValue(record.schemaVersion),
    status: stringValue(completionEvidence.status) ?? stringValue(l3Workflow.status) ?? stringValue(record.completionStatus) ?? stringValue(record.status),
    acceptanceTier: stringValue(completionEvidence.acceptanceTier) ?? stringValue(record.acceptanceTier),
    targetEnvironmentKind: stringValue(completionEvidence.targetEnvironmentKind) ?? stringValue(record.targetEnvironmentKind),
    appWorkflow: isRecord(record.appWorkflow) ? { kind: stringValue(record.appWorkflow.kind) } : undefined,
    l3Workflow: {
      completed: booleanValue(l3Workflow.completed),
      sameSession: booleanValue(l3Workflow.sameSession) ?? booleanValue(l3Workflow.sameVirtualSession),
      sourceToWriterToPreviewCausality: booleanValue(l3Workflow.sourceToWriterToPreviewCausality),
    },
    sameSession: booleanValue(completionEvidence.sameSession) ?? booleanValue(record.sameSession),
    sourceToWriterToPreviewCausality: booleanValue(completionEvidence.sourceToWriterToPreviewCausality) ?? booleanValue(record.sourceToWriterToPreviewCausality),
    completionEvidenceRef: stringValue(record.completionEvidenceRef),
    validatorAcceptedL3: booleanValue(record.validatorAcceptedL3),
    userAcceptanceEligible: booleanValue(completionEvidence.userAcceptanceEligible) ?? booleanValue(record.userAcceptanceEligible),
    diagnosticOnly: booleanValue(completionEvidence.diagnosticOnly) ?? booleanValue(record.diagnosticOnly),
    realWindowEvidence: booleanValue(completionEvidence.realWindowEvidence) ?? booleanValue(record.realWindowEvidence),
    fixture: booleanValue(record.fixture),
    testActionFixtureMode: booleanValue(record.testActionFixtureMode),
    packageLocal: booleanValue(record.packageLocal),
    targetBoundReal: booleanValue(record.targetBoundReal),
    isolatedL1: booleanValue(record.isolatedL1),
    isolatedL3: booleanValue(record.isolatedL3),
    sharedSystemInputUsed: booleanValue(record.sharedSystemInputUsed),
    allowSharedSystemInput: booleanValue(record.allowSharedSystemInput),
    shellDirectArtifactWrite: booleanValue(record.shellDirectArtifactWrite),
    artifactCausality: isRecord(record.artifactCausality)
      ? { shellDirectArtifactWrite: booleanValue(record.artifactCausality.shellDirectArtifactWrite) }
      : undefined,
    automationSubstituteUsed: booleanValue(record.automationSubstituteUsed),
    antiShortcutRejectedKinds: stringArray(record.antiShortcutRejectedKinds),
    evidenceClaims: evidenceClaimKinds,
  };
}

export function cuNextCompletedL3CompletionEvidenceIssues(
  data: unknown,
  context: CuNextCompletionGradeEvidenceContext = {},
): string[] {
  return strictReferencedCompletionEvidenceIssues(isRecord(data) ? data : {}, context);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim().length > 0 ? value : undefined;
}

function booleanValue(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function recordValue(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function records(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item))
    : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}

function cuNextCompletionEvidenceTaskArtifactBindingIssues(
  acceptance: Record<string, unknown>,
  completionEvidence: Record<string, unknown>,
): string[] {
  const issues: string[] = [];
  const finalArtifactRef = stringValue(acceptance.finalArtifactRef);
  if (!finalArtifactRef) return issues;
  const completionArtifactRefs = uniqueStrings([
    stringValue(completionEvidence.finalArtifactRef),
    stringValue(recordValue(completionEvidence.artifactCausality).finalArtifactRef),
    stringValue(recordValue(completionEvidence.taskArtifactBinding).finalArtifactRef),
    ...stringArray(recordValue(completionEvidence.taskArtifactBinding).finalArtifactRefs),
    ...stringArray(completionEvidence.taskFinalArtifactRefs),
    ...stringArray(recordValue(completionEvidence.presentationEvidence).artifactRefs),
    ...stringArray(recordValue(completionEvidence.guiPresent).artifactRefs),
  ].filter((value): value is string => Boolean(value)));
  if (!completionArtifactRefs.includes(finalArtifactRef)) {
    issues.push('completionEvidenceRef evidence must bind to acceptance finalArtifactRef through finalArtifactRef, artifactCausality, presentationEvidence.artifactRefs, or taskArtifactBinding.');
  }
  const guiPresentArtifactRefs = uniqueStrings([
    ...stringArray(recordValue(acceptance.guiPresent).artifactRefs),
    ...stringArray(recordValue(acceptance.guiPresent).displayedRefs),
    ...records(acceptance.evidenceClaims)
      .filter((claim) => stringValue(claim.kind) === 'gui-present-record')
      .flatMap((claim) => stringArray(claim.artifactRefs)),
  ]);
  if (!guiPresentArtifactRefs.includes(finalArtifactRef)) {
    issues.push('acceptance gui.present evidence must display the same finalArtifactRef bound by completionEvidenceRef.');
  }
  return issues;
}

function strictReferencedCompletionEvidenceIssues(
  data: Record<string, unknown>,
  context: CuNextCompletionGradeEvidenceContext,
): string[] {
  const issues: string[] = [];
  const workflow = recordValue(data.l3Workflow);
  if (data.schemaVersion !== CU_NEXT_COMPLETION_EVIDENCE_SCHEMA_VERSION) {
    issues.push(`completionEvidenceRef must use ${CU_NEXT_COMPLETION_EVIDENCE_SCHEMA_VERSION}.`);
  }
  if (data.evidenceKind !== 'isolated-L3') {
    issues.push('completionEvidenceRef evidenceKind must be isolated-L3.');
  }
  if (data.status !== 'completed') issues.push('completionEvidenceRef evidence status must be completed.');
  if (data.acceptanceTier !== 'l3-multi-app-workflow') {
    issues.push('completionEvidenceRef evidence acceptanceTier must be l3-multi-app-workflow.');
  }
  if (data.targetEnvironmentKind !== 'linux-isolated-desktop-session') {
    issues.push('completionEvidenceRef targetEnvironmentKind must be linux-isolated-desktop-session.');
  }
  if (data.userAcceptanceEligible !== true) issues.push('completionEvidenceRef evidence must be userAcceptanceEligible=true.');
  if (data.diagnosticOnly !== false) issues.push('completionEvidenceRef evidence must be diagnosticOnly=false.');
  if (data.realWindowEvidence !== true) issues.push('completionEvidenceRef evidence must be realWindowEvidence=true.');
  if (workflow.status !== 'completed') issues.push('completionEvidenceRef l3Workflow.status must be completed.');
  if (workflow.completed !== true) issues.push('completionEvidenceRef l3Workflow.completed must be true.');
  if (workflow.sameSession !== true && workflow.sameVirtualSession !== true) {
    issues.push('completionEvidenceRef l3Workflow must prove same-session execution.');
  }
  if (workflow.sourceToWriterToPreviewCausality !== true) {
    issues.push('completionEvidenceRef l3Workflow must prove source -> writer -> file-preview causality.');
  }
  if (!Array.isArray(data.errors) || data.errors.length > 0) {
    issues.push('completionEvidenceRef evidence must include validator errors=[] from the completed L3 evidence assembler.');
  }
  issues.push(...completedL3SemanticEvidenceIssues(data));
  issues.push(...completionEvidenceLocalRefIssues(data));
  for (const field of requiredCompletedL3RefFields) {
    if (!stringValue(data[field])) {
      issues.push(`completionEvidenceRef evidence missing completed L3 ref field ${field}.`);
    }
  }
  if (!nonEmptyStringArray(data.screenshotRefs)) {
    issues.push('completionEvidenceRef evidence must include current screenshotRefs from the completed L3 workflow.');
  }
  if (!nonEmptyStringArray(data.traceRefs)) {
    issues.push('completionEvidenceRef evidence must include traceRefs from the completed L3 workflow.');
  }
  for (const ref of completionEvidenceRequiredRefs(data)) {
    if (context.refExists && !context.refExists(ref)) {
      issues.push(`completionEvidenceRef evidence ref ${ref} must exist as a regular file inside ${context.refScopeDescription ?? 'the current evidence bundle'}.`);
    }
  }
  if ('partialRunRef' in data || 'partialRuntimeRefs' in data) {
    issues.push('partial L3 runtime refs cannot be promoted as completionEvidenceRef evidence.');
  }
  return issues;
}

function completionEvidenceRequiredRefs(data: Record<string, unknown>): string[] {
  return uniqueStrings(
    completionEvidenceRefCandidates(data)
      .filter((candidate) => !nonRegularCompletionEvidenceRefKeys.has(candidate.key))
      .map((candidate) => regularFileRefFromCompletionEvidenceRef(candidate.ref))
      .filter((ref): ref is string => Boolean(ref)),
  );
}

const requiredCompletedL3RefFields = [
  'resultRef',
  'inputEventLogRef',
  'pointerEventLogRef',
  'keyboardEventLogRef',
  'executorCommandEventLogRef',
  'backendReadinessProofRef',
  'processRef',
  'resourceAllocationRef',
  'targetWindowRef',
  'windowBoundPointerProofRef',
  'finalArtifactRef',
  'artifactValidationRef',
  'fileListArtifactRef',
  'fileListDataRef',
  'guiPresentRef',
  'viewerManifestRef',
  'evidenceLogRef',
  'evidenceSnapshotRef',
  'evidenceIndexRef',
] as const;

function nonEmptyStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.some((item) => typeof item === 'string' && item.trim().length > 0);
}

function completedL3SemanticEvidenceIssues(data: Record<string, unknown>): string[] {
  const issues: string[] = [];
  const workflowRequirements = requiredRecordBlock(data, 'workflowRequirements', issues);
  if (workflowRequirements) {
    if (numberValue(workflowRequirements.minimumAppCount) === undefined || Number(workflowRequirements.minimumAppCount) < 3) {
      issues.push('completionEvidenceRef workflowRequirements.minimumAppCount must require at least 3 apps.');
    }
    if (numberValue(workflowRequirements.minimumActionCount) === undefined || Number(workflowRequirements.minimumActionCount) < 6) {
      issues.push('completionEvidenceRef workflowRequirements.minimumActionCount must require a completed multi-step L3 workflow.');
    }
    const modalities = stringArray(workflowRequirements.requiredInputModalities).map((value) => value.toLowerCase());
    if (!modalities.includes('pointer') || !modalities.includes('keyboard')) {
      issues.push('completionEvidenceRef workflowRequirements.requiredInputModalities must include pointer and keyboard.');
    }
    for (const field of requiredTrueWorkflowRequirementFields) {
      if (workflowRequirements[field] !== true) {
        issues.push(`completionEvidenceRef workflowRequirements.${field} must be true.`);
      }
    }
  }

  const applications = Array.isArray(data.applicationEvidence)
    ? records(data.applicationEvidence)
    : undefined;
  if (!applications) {
    issues.push('completionEvidenceRef evidence missing critical L3 semantic block applicationEvidence.');
  } else {
    if (applications.length < 3) {
      issues.push('completionEvidenceRef applicationEvidence must include source, writer, and file-preview app evidence.');
    }
    const roles = new Set(applications.map((app) => l3ApplicationRole(app.appKind)).filter(Boolean));
    for (const role of ['source', 'writer', 'file-preview']) {
      if (!roles.has(role)) {
        issues.push(`completionEvidenceRef applicationEvidence missing required ${role} app role.`);
        break;
      }
    }
    applications.forEach((app, index) => {
      if (!stringValue(app.sessionManifestRef) && !stringValue(app.sessionRef)) {
        issues.push(`completionEvidenceRef applicationEvidence[${index}] must cite sessionManifestRef.`);
      }
      if (!stringValue(app.firstScreenshotRef) || !stringValue(app.lastScreenshotRef)) {
        issues.push(`completionEvidenceRef applicationEvidence[${index}] must include firstScreenshotRef and lastScreenshotRef.`);
      }
      if (!nonEmptyStringArray(app.windowEvidenceRefs)) {
        issues.push(`completionEvidenceRef applicationEvidence[${index}] must include windowEvidenceRefs.`);
      }
    });
  }

  const transitions = Array.isArray(data.crossAppTransitions)
    ? records(data.crossAppTransitions)
    : undefined;
  if (!transitions) {
    issues.push('completionEvidenceRef evidence missing critical L3 semantic block crossAppTransitions.');
  } else if (transitions.length < 2) {
    issues.push('completionEvidenceRef crossAppTransitions must include current source->writer and writer->preview transitions.');
  }

  const sourceEvidence = requiredRecordBlock(data, 'sourceEvidence', issues);
  const sourceFactRefs = sourceEvidence ? stringArray(sourceEvidence.sourceFactRefs) : [];
  if (sourceEvidence) {
    if (!nonEmptyStringArray(sourceEvidence.sourceObservationRefs)) {
      issues.push('completionEvidenceRef sourceEvidence.sourceObservationRefs must cite current source observations.');
    }
    if (sourceFactRefs.length === 0) {
      issues.push('completionEvidenceRef sourceEvidence.sourceFactRefs must cite source facts.');
    }
  }

  const derivedContentEvidence = requiredRecordBlock(data, 'derivedContentEvidence', issues);
  if (derivedContentEvidence) {
    const supportedFactRefs = stringArray(derivedContentEvidence.supportedFactRefs);
    if (supportedFactRefs.length === 0) {
      issues.push('completionEvidenceRef derivedContentEvidence.supportedFactRefs must cite source-backed facts.');
    } else if (sourceFactRefs.length > 0 && !supportedFactRefs.every((ref) => sourceFactRefs.includes(ref))) {
      issues.push('completionEvidenceRef derivedContentEvidence.supportedFactRefs must be backed by sourceEvidence.sourceFactRefs.');
    }
  }

  const artifactCausality = requiredRecordBlock(data, 'artifactCausality', issues);
  if (artifactCausality) {
    if (!Number.isInteger(artifactCausality.savedByActionIndex)) {
      issues.push('completionEvidenceRef artifactCausality.savedByActionIndex must identify the GUI save action.');
    }
    if (artifactCausality.savedByInputModality !== 'keyboard') {
      issues.push('completionEvidenceRef artifactCausality.savedByInputModality must be keyboard.');
    }
    if (!stringValue(artifactCausality.savedByCommandEventRef)) {
      issues.push('completionEvidenceRef artifactCausality.savedByCommandEventRef must cite the isolated executor command event.');
    }
    if (artifactCausality.savedThroughGui !== true) {
      issues.push('completionEvidenceRef artifactCausality.savedThroughGui must be true.');
    }
    if (artifactCausality.shellDirectArtifactWrite !== false) {
      issues.push('completionEvidenceRef artifactCausality.shellDirectArtifactWrite must be false.');
    }
    if (stringValue(artifactCausality.finalArtifactRef) !== stringValue(data.finalArtifactRef)) {
      issues.push('completionEvidenceRef artifactCausality.finalArtifactRef must match top-level finalArtifactRef.');
    }
    if (stringValue(artifactCausality.artifactValidationRef) !== stringValue(data.artifactValidationRef)) {
      issues.push('completionEvidenceRef artifactCausality.artifactValidationRef must match top-level artifactValidationRef.');
    }
  }

  const directoryEvidence = requiredRecordBlock(data, 'directoryEvidence', issues);
  if (directoryEvidence) {
    for (const field of ['fileListArtifactRef', 'fileListDataRef', 'previewObservationRef', 'directoryObservationAfterSaveRef']) {
      if (!stringValue(directoryEvidence[field])) {
        issues.push(`completionEvidenceRef directoryEvidence.${field} is required.`);
      }
    }
    if (directoryEvidence.previewedThroughGui !== true) {
      issues.push('completionEvidenceRef directoryEvidence.previewedThroughGui must be true.');
    }
    if (directoryEvidence.shellDirectoryListingOnly !== false) {
      issues.push('completionEvidenceRef directoryEvidence.shellDirectoryListingOnly must be false.');
    }
    if (!Number.isInteger(directoryEvidence.previewedByActionIndex)) {
      issues.push('completionEvidenceRef directoryEvidence.previewedByActionIndex must identify the GUI preview action.');
    }
    if (directoryEvidence.previewedByInputModality !== 'pointer') {
      issues.push('completionEvidenceRef directoryEvidence.previewedByInputModality must be pointer.');
    }
    for (const field of ['fileListArtifactRef', 'fileListDataRef']) {
      if (stringValue(directoryEvidence[field]) !== stringValue(data[field])) {
        issues.push(`completionEvidenceRef directoryEvidence.${field} must match top-level ${field}.`);
      }
    }
  }

  const presentationEvidence = requiredRecordBlock(data, 'presentationEvidence', issues);
  if (presentationEvidence) {
    if (!stringValue(presentationEvidence.guiPresentRef) && !stringValue(presentationEvidence.toolPayloadRef)) {
      issues.push('completionEvidenceRef presentationEvidence must cite guiPresentRef or toolPayloadRef.');
    }
    if (stringValue(presentationEvidence.guiPresentRef) && stringValue(presentationEvidence.guiPresentRef) !== stringValue(data.guiPresentRef)) {
      issues.push('completionEvidenceRef presentationEvidence.guiPresentRef must match top-level guiPresentRef.');
    }
  }

  return issues;
}

const requiredTrueWorkflowRequirementFields = [
  'requiresCurrentStepScreenshots',
  'forbidPriorRoundCompletionEvidence',
  'requiresDirectoryEvidence',
  'requiresArtifactPreview',
  'requiresWindowBoundPointerProof',
] as const;

function requiredRecordBlock(
  data: Record<string, unknown>,
  field: string,
  issues: string[],
): Record<string, unknown> | undefined {
  if (!isRecord(data[field])) {
    issues.push(`completionEvidenceRef evidence missing critical L3 semantic block ${field}.`);
    return undefined;
  }
  return data[field];
}

function numberValue(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function l3ApplicationRole(value: unknown): string | undefined {
  const appKind = stringValue(value)?.toLowerCase();
  if (!appKind) return undefined;
  if (appKind.includes('source')) return 'source';
  if (appKind.includes('writer') || appKind.includes('word')) return 'writer';
  if (appKind.includes('file-preview') || (appKind.includes('file') && appKind.includes('preview'))) {
    return 'file-preview';
  }
  return undefined;
}

interface CompletionEvidenceRefCandidate {
  ref: string;
  path: string;
  key: string;
}

function completionEvidenceLocalRefIssues(data: Record<string, unknown>): string[] {
  return uniqueStrings(completionEvidenceRefCandidates(data).flatMap((candidate) => {
    const reason = invalidCompletionEvidenceLocalRefReason(candidate.ref);
    return reason
      ? [`completionEvidenceRef evidence ref ${candidate.path} (${candidate.ref}) must be a bundle-local file ref: ${reason}.`]
      : [];
  }));
}

function completionEvidenceRefCandidates(value: unknown): CompletionEvidenceRefCandidate[] {
  return collectCompletionEvidenceRefCandidates(value, '$', new Set<unknown>());
}

function collectCompletionEvidenceRefCandidates(
  value: unknown,
  path: string,
  seen: Set<unknown>,
): CompletionEvidenceRefCandidate[] {
  if (!value || typeof value !== 'object') return [];
  if (seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => collectCompletionEvidenceRefCandidates(item, `${path}[${index}]`, seen));
  }
  return Object.entries(value).flatMap(([key, child]) => {
    const childPath = jsonPath(path, key);
    if (isCompletionEvidenceRefKey(key)) return refCandidatesFromValue(child, childPath, key);
    return collectCompletionEvidenceRefCandidates(child, childPath, seen);
  });
}

function refCandidatesFromValue(value: unknown, path: string, key: string): CompletionEvidenceRefCandidate[] {
  const single = stringValue(value);
  if (single) return [{ ref: single, path, key }];
  if (!Array.isArray(value)) return [];
  return value.flatMap((item, index) => {
    const ref = stringValue(item);
    return ref ? [{ ref, path: `${path}[${index}]`, key }] : [];
  });
}

function isCompletionEvidenceRefKey(key: string): boolean {
  return /Ref(?:s)?$/.test(key);
}

const nonRegularCompletionEvidenceRefKeys = new Set([
  'filesystemRootRef',
]);

function jsonPath(parent: string, key: string): string {
  return /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)
    ? `${parent}.${key}`
    : `${parent}[${JSON.stringify(key)}]`;
}

function regularFileRefFromCompletionEvidenceRef(ref: string): string | undefined {
  if (invalidCompletionEvidenceLocalRefReason(ref)) return undefined;
  return ref.trim().split('#', 1)[0];
}

function invalidCompletionEvidenceLocalRefReason(ref: string): string | undefined {
  const trimmed = ref.trim();
  if (!trimmed) return 'empty refs are not allowed';
  if (trimmed.includes('\0')) return 'reserved or pseudo refs are not allowed';
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed) || /^\\\\/.test(trimmed)) {
    return 'absolute paths are not allowed';
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
    return 'URLs, schemes, reserved refs, and pseudo refs are not allowed';
  }
  if (trimmed.startsWith('~') || trimmed.includes('?')) return 'reserved or pseudo refs are not allowed';
  const fileRef = trimmed.split('#', 1)[0];
  if (!fileRef) return 'fragment-only refs are not allowed';
  if (fileRef.split(/[\\/]+/).some((segment) => segment === '..')) {
    return 'parent-directory escapes are not allowed';
  }
  if (fileRef === '.' || fileRef === '..') return 'reserved or pseudo refs are not allowed';
  return undefined;
}
