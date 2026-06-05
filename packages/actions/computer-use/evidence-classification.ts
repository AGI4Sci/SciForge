export type CuNextEvidenceKind =
  | 'fixture'
  | 'package-local'
  | 'target-bound-real'
  | 'isolated-L1'
  | 'isolated-L3';

export type CuNextCompletionTarget = 'backend' | 'l3-workflow';

export const CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF =
  'isolated-desktop-l3-workflow-evidence.json' as const;

export interface CuNextEvidenceClassificationInput {
  kind?: CuNextEvidenceKind | string;
  evidenceKind?: CuNextEvidenceKind | string;
  schemaVersion?: string;
  status?: string;
  acceptanceTier?: string;
  targetEnvironmentKind?: string;
  appWorkflow?: {
    kind?: string;
  };
  l3Workflow?: {
    completed?: boolean;
    sameSession?: boolean;
    sourceToWriterToPreviewCausality?: boolean;
  };
  sameSession?: boolean;
  sourceToWriterToPreviewCausality?: boolean;
  completionEvidenceRef?: string;
  validatorAcceptedL3?: boolean;
  userAcceptanceEligible?: boolean;
  diagnosticOnly?: boolean;
  realWindowEvidence?: boolean;
  fixture?: boolean;
  testActionFixtureMode?: boolean;
  packageLocal?: boolean;
  targetBoundReal?: boolean;
  isolatedL1?: boolean;
  isolatedL3?: boolean;
  sharedSystemInputUsed?: boolean;
  allowSharedSystemInput?: boolean;
  shellDirectArtifactWrite?: boolean;
  artifactCausality?: {
    shellDirectArtifactWrite?: boolean;
  };
  automationSubstituteUsed?: boolean;
  antiShortcutRejectedKinds?: string[];
  evidenceClaims?: Array<{
    kind?: string;
  }>;
}

export interface CuNextEvidenceClassification {
  kind: CuNextEvidenceKind;
  canCompleteBackend: boolean;
  canCompleteL3Workflow: boolean;
  blockedReasons: string[];
  rejectedShortcuts: string[];
  claimLimit: string;
}

const shortcutKinds = new Set(['dom', 'playwright', 'accessibility', 'ax', 'generated-file-only', 'api-created-artifact']);

export function classifyCuNextEvidence(input: CuNextEvidenceClassificationInput): CuNextEvidenceClassification {
  const kind = inferEvidenceKind(input);
  const rejectedShortcuts = collectRejectedShortcuts(input);
  const hasCanonicalCompletionEvidenceRef = isCanonicalCuNextCompletionEvidenceRef(input.completionEvidenceRef);
  const blockedReasons = [
    ...shortcutBlockedReasons(rejectedShortcuts),
    ...sharedInputBlockedReasons(input),
    ...shellArtifactBlockedReasons(input),
  ];
  const canCompleteBackend = kind === 'isolated-L1'
    && input.status === 'completed'
    && input.userAcceptanceEligible === true
    && input.diagnosticOnly === false
    && input.realWindowEvidence === true
    && blockedReasons.length === 0;
  const hasSameSession = input.sameSession === true || input.l3Workflow?.sameSession === true;
  const hasCausality = (
    input.sourceToWriterToPreviewCausality === true
    || input.l3Workflow?.sourceToWriterToPreviewCausality === true
  );
  const canCompleteL3Workflow = kind === 'isolated-L3'
    && input.status === 'completed'
    && input.userAcceptanceEligible === true
    && input.diagnosticOnly === false
    && input.realWindowEvidence === true
    && hasCanonicalCompletionEvidenceRef
    && input.validatorAcceptedL3 === true
    && hasSameSession
    && hasCausality
    && input.l3Workflow?.completed === true
    && blockedReasons.length === 0;

  if (kind !== 'isolated-L1' && kind !== 'isolated-L3') {
    blockedReasons.push(`${kind} evidence is diagnostic or candidate-only and cannot complete PROJECT top-level tasks.`);
  }
  if (kind === 'isolated-L1' && !canCompleteBackend) {
    blockedReasons.push('isolated-L1 evidence must be completed, real-window, user-acceptance eligible, and diagnosticOnly=false to complete backend.');
  }
  if (kind === 'isolated-L3' && !canCompleteL3Workflow) {
    if (!input.completionEvidenceRef) {
      blockedReasons.push('isolated-L3 completion requires completionEvidenceRef pointing at the validated evidence bundle.');
    } else if (!hasCanonicalCompletionEvidenceRef) {
      blockedReasons.push(`isolated-L3 completionEvidenceRef must be the same-round bundle-local ${CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF}.`);
    }
    if (input.validatorAcceptedL3 !== true) {
      blockedReasons.push('isolated-L3 completionEvidenceRef must be accepted by the completed L3 validator.');
    }
    blockedReasons.push('isolated-L3 evidence must be completed in one same session with source -> writer -> file-preview causality.');
  }

  return {
    kind,
    canCompleteBackend,
    canCompleteL3Workflow,
    blockedReasons: unique(blockedReasons),
    rejectedShortcuts,
    claimLimit: 'CU-NEXT fixture/package-local/target-bound evidence can prepare contracts only; PROJECT completion requires isolated-L1 backend evidence or same-session isolated-L3 workflow evidence.',
  };
}

export function validateCuNextEvidenceForProjectCompletion(
  input: CuNextEvidenceClassificationInput,
  target: CuNextCompletionTarget,
): { ok: boolean; classification: CuNextEvidenceClassification; reasons: string[] } {
  const classification = classifyCuNextEvidence(input);
  const ok = target === 'backend'
    ? classification.canCompleteBackend
    : classification.canCompleteL3Workflow;
  return {
    ok,
    classification,
    reasons: ok ? [] : classification.blockedReasons,
  };
}

function inferEvidenceKind(input: CuNextEvidenceClassificationInput): CuNextEvidenceKind {
  if (input.fixture || input.testActionFixtureMode || input.kind === 'fixture' || input.evidenceKind === 'fixture') return 'fixture';
  if (input.packageLocal || input.kind === 'package-local' || input.evidenceKind === 'package-local') return 'package-local';
  if (input.targetBoundReal || input.kind === 'target-bound-real' || input.evidenceKind === 'target-bound-real') return 'target-bound-real';
  if (input.schemaVersion?.includes('fixture')) return 'fixture';
  if (input.targetEnvironmentKind?.includes('package-local')) return 'package-local';
  if (input.targetEnvironmentKind?.includes('target-bound')) return 'target-bound-real';
  if (input.isolatedL3 || input.kind === 'isolated-L3' || input.evidenceKind === 'isolated-L3') return 'isolated-L3';
  if (input.acceptanceTier === 'l3-multi-app-workflow' && input.targetEnvironmentKind === 'linux-isolated-desktop-session') return 'isolated-L3';
  if (input.isolatedL1 || input.kind === 'isolated-L1' || input.evidenceKind === 'isolated-L1' || input.acceptanceTier === 'l1-isolated-smoke') return 'isolated-L1';
  return 'package-local';
}

function collectRejectedShortcuts(input: CuNextEvidenceClassificationInput): string[] {
  const claims = input.evidenceClaims?.map((claim) => claim.kind ?? '') ?? [];
  return unique([
    ...(input.antiShortcutRejectedKinds ?? []),
    ...claims.filter((kind) => shortcutKinds.has(kind.toLowerCase())),
    ...(input.automationSubstituteUsed ? ['automation-substitute'] : []),
  ].map((kind) => kind.toLowerCase()));
}

function shortcutBlockedReasons(rejectedShortcuts: string[]): string[] {
  return rejectedShortcuts.map((kind) => `${kind} shortcut evidence cannot satisfy CU-NEXT or PROJECT completion.`);
}

function sharedInputBlockedReasons(input: CuNextEvidenceClassificationInput): string[] {
  return input.sharedSystemInputUsed || input.allowSharedSystemInput
    ? ['shared system input cannot satisfy isolated Computer Use completion evidence.']
    : [];
}

function shellArtifactBlockedReasons(input: CuNextEvidenceClassificationInput): string[] {
  return input.shellDirectArtifactWrite || input.artifactCausality?.shellDirectArtifactWrite
    ? ['shell direct artifact write cannot satisfy GUI artifact causality.']
    : [];
}

export function isCanonicalCuNextCompletionEvidenceRef(ref: string | undefined): boolean {
  return ref?.trim() === CU_NEXT_CANONICAL_COMPLETION_EVIDENCE_REF;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter((value) => value.trim().length > 0))];
}
