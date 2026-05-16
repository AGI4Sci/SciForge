import type { ViewCompare, ViewEncoding, ViewLayout, ViewSelection, ViewSync, ViewTransform } from './view';
import type { TaskRunCardConversationProjectionSummary } from './task-run-card';

export const RESULT_PRESENTATION_SCHEMA_VERSION = 'sciforge.result-presentation-contract.v1' as const;
import { artifactHasUserFacingDelivery, type RuntimeArtifactDerivation } from './artifacts';

export const RESULT_PRESENTATION_CONTRACT_ID = 'sciforge.result-presentation.v1' as const;

export type ResultPresentationSection =
  | 'answer'
  | 'evidence'
  | 'artifacts'
  | 'actions'
  | 'confidence'
  | 'next-actions'
  | 'process'
  | 'trace'
  | 'diagnostics'
  | 'raw-payload';

export const RESULT_PRESENTATION_DEFAULT_EXPANDED_SECTIONS = ['answer', 'evidence', 'artifacts', 'actions'] as const;
export const RESULT_PRESENTATION_COLLAPSED_BY_DEFAULT_SECTIONS = ['confidence', 'process', 'diagnostics', 'raw-payload'] as const;
export const RESULT_PRESENTATION_PRIMARY_SECTIONS = ['answer', 'evidence', 'artifacts', 'actions', 'confidence'] as const;
export const RESULT_PRESENTATION_RAW_DIAGNOSTIC_KINDS = ['tool-payload', 'raw-payload', 'stdout', 'stderr', 'trace', 'schema', 'backend', 'budget', 'repair'] as const;
export const RESULT_PRESENTATION_PROJECTION_RULES = [
  'Answer, evidence, artifact actions, and next actions are human-facing primary content.',
  'Every key finding must carry an inline citation or explicit uncertainty.',
  'Raw JSON, ToolPayload, stdout/stderr, backend metadata, and schema diagnostics are folded by default.',
  'UI renders this contract and must not infer semantics from prompt, scenario, or artifact names.',
] as const;

export type ResultPresentationFieldSource = 'backend' | 'runtime-adapter' | 'harness-presentation-policy' | 'validator';
export type ResultPresentationValidationSeverity = 'error' | 'warning';
export type ResultPresentationCitationKind =
  | 'artifact'
  | 'file'
  | 'url'
  | 'execution-unit'
  | 'verification'
  | 'work-evidence'
  | 'log'
  | 'data'
  | 'screenshot'
  | 'object-reference'
  | 'unknown';
export type ResultPresentationArtifactActionKind = 'preview' | 'inspect' | 'focus-right-pane' | 'export' | 'compare' | 'rerun' | 'copy-ref';
export type ResultPresentationNextActionKind = 'continue' | 'retry' | 'recover' | 'inspect' | 'export' | 'ask-user' | 'stop';
export type ResultPresentationDiagnosticKind = typeof RESULT_PRESENTATION_RAW_DIAGNOSTIC_KINDS[number] | 'log' | 'reasoning-trace' | 'work-evidence' | 'verification';
export type ResultPresentationFindingKind = 'finding' | 'partial-result' | 'failure' | 'summary';
export type ResultPresentationUncertaintyState = 'unverified' | 'partial' | 'speculative' | 'failed';
export type ResultPresentationStatus = 'complete' | 'partial' | 'needs-human' | 'background-running' | 'failed';

export interface ResultPresentationFieldOrigins {
  answerBlocks?: ResultPresentationFieldSource;
  keyFindings?: ResultPresentationFieldSource;
  inlineCitations?: ResultPresentationFieldSource;
  artifactActions?: ResultPresentationFieldSource;
  confidenceExplanation?: ResultPresentationFieldSource;
  nextActions?: ResultPresentationFieldSource;
  processSummary?: ResultPresentationFieldSource;
  diagnosticsRefs?: ResultPresentationFieldSource;
  defaultExpandedSections?: ResultPresentationFieldSource;
}

export interface ResultPresentationAnswerBlock {
  id: string;
  kind: 'paragraph' | 'bullets' | 'table' | 'code' | 'callout' | 'status';
  title?: string;
  text?: string;
  items?: string[];
  citationIds?: string[];
  citations?: string[];
  tone?: 'neutral' | 'success' | 'warning' | 'danger';
}

export interface ResultPresentationUncertainty {
  state: ResultPresentationUncertaintyState;
  reason: string;
}

export interface ResultPresentationKeyFinding {
  id: string;
  kind?: ResultPresentationFindingKind;
  text?: string;
  statement?: string;
  citationIds?: string[];
  citations?: string[];
  verificationState?: 'supported' | 'partial' | 'unverified' | 'speculative' | 'failed' | string;
  status?: 'supported' | 'partial' | 'unverified' | 'speculative' | 'failed' | string;
  confidence?: number;
  uncertainty?: ResultPresentationUncertainty;
}

export interface ResultPresentationInlineCitation {
  id: string;
  label: string;
  ref: string;
  kind: ResultPresentationCitationKind;
  source?: string;
  locator?: unknown;
  summary?: string;
  status?: string;
  verificationState?: 'verified' | 'unverified' | 'failed' | 'not-applicable';
}

export type ResultPresentationCitation = ResultPresentationInlineCitation;

export interface ResultPresentationArtifactAction {
  id: string;
  label: string;
  ref: string;
  action?: ResultPresentationArtifactActionKind;
  kind?: ResultPresentationArtifactActionKind;
  actions?: string[];
  artifactType?: string;
  citationId?: string;
  primary?: boolean;
  presentationKey?: string;
  parentArtifactRef?: string;
  sourceRefs?: string[];
  derivationKind?: string;
  derivation?: RuntimeArtifactDerivation;
  revision?: string | number;
  revisionRef?: string;
  encoding?: ViewEncoding;
  layout?: ViewLayout;
  selection?: ViewSelection;
  sync?: ViewSync;
  transform?: ViewTransform[];
  compare?: ViewCompare;
  exportProfile?: Record<string, unknown>;
}

export interface ResultPresentationConfidenceExplanation {
  level: 'high' | 'medium' | 'low' | 'unverified';
  summary?: string;
  explanation?: string;
  citationIds?: string[];
}

export interface ResultPresentationNextAction {
  id: string;
  label: string;
  kind: ResultPresentationNextActionKind;
  ref?: string;
  primary?: boolean;
}

export interface ResultPresentationProcessStep {
  id: string;
  label: string;
  status?: string;
  refs?: string[];
}

export interface ResultPresentationProcessSummary {
  status: 'completed' | 'partial' | 'failed' | 'needs-human' | 'running';
  summary: string;
  foldedByDefault?: true;
  refs?: string[];
  items?: ResultPresentationProcessStep[];
}

export interface ResultPresentationDiagnosticsRef {
  id: string;
  label: string;
  kind: ResultPresentationDiagnosticKind;
  ref?: string;
  summary?: string;
  primary?: boolean;
  defaultVisible?: boolean;
  foldedByDefault?: true;
}

export interface ResultPresentationContract {
  schemaVersion: typeof RESULT_PRESENTATION_SCHEMA_VERSION;
  contractId: typeof RESULT_PRESENTATION_CONTRACT_ID;
  id: string;
  status: ResultPresentationStatus;
  answerBlocks: ResultPresentationAnswerBlock[];
  keyFindings: ResultPresentationKeyFinding[];
  inlineCitations: ResultPresentationInlineCitation[];
  artifactActions: ResultPresentationArtifactAction[];
  confidenceExplanation?: ResultPresentationConfidenceExplanation;
  nextActions: ResultPresentationNextAction[];
  processSummary?: ResultPresentationProcessSummary;
  diagnosticsRefs: ResultPresentationDiagnosticsRef[];
  defaultExpandedSections: ResultPresentationSection[];
  conversationProjectionRef?: string;
  conversationProjectionSummary?: TaskRunCardConversationProjectionSummary;
  fieldOrigins?: ResultPresentationFieldOrigins;
  generatedBy?: ResultPresentationFieldSource;
}

export interface ResultPresentationValidationIssue {
  code: string;
  path: string;
  message: string;
  severity: ResultPresentationValidationSeverity;
}

export interface ResultPresentationValidationResult {
  ok: boolean;
  issues: ResultPresentationValidationIssue[];
}

export interface ResultPresentationVisibilityProjection {
  expandedSections: ResultPresentationSection[];
  collapsedSections: ResultPresentationSection[];
  primarySections: ResultPresentationSection[];
  secondarySections: ResultPresentationSection[];
}

export function createResultPresentationContract(input: Partial<ResultPresentationContract> = {}): ResultPresentationContract {
  const contract: ResultPresentationContract = {
    schemaVersion: RESULT_PRESENTATION_SCHEMA_VERSION,
    contractId: RESULT_PRESENTATION_CONTRACT_ID,
    id: stringField(input.id) ?? `result-presentation-${hashText(JSON.stringify(input)).slice(0, 10)}`,
    status: input.status ?? resultStatusFromProcess(input.processSummary?.status),
    answerBlocks: input.answerBlocks ?? [],
    keyFindings: input.keyFindings ?? [],
    inlineCitations: input.inlineCitations ?? [],
    artifactActions: input.artifactActions ?? [],
    confidenceExplanation: input.confidenceExplanation,
    nextActions: input.nextActions ?? [],
    processSummary: input.processSummary,
    diagnosticsRefs: input.diagnosticsRefs ?? [],
    defaultExpandedSections: input.defaultExpandedSections ?? [...RESULT_PRESENTATION_DEFAULT_EXPANDED_SECTIONS],
    conversationProjectionRef: stringField(input.conversationProjectionRef),
    conversationProjectionSummary: input.conversationProjectionSummary,
    fieldOrigins: input.fieldOrigins,
    generatedBy: input.generatedBy ?? 'runtime-adapter',
  };
  return applyDefaultResultPresentationPolicy(contract);
}

export function applyDefaultResultPresentationPolicy(contract: ResultPresentationContract): ResultPresentationContract {
  const expanded = (contract.defaultExpandedSections.length ? contract.defaultExpandedSections : [...RESULT_PRESENTATION_DEFAULT_EXPANDED_SECTIONS])
    .filter((section) => !['process', 'trace', 'diagnostics', 'raw-payload'].includes(section));
  const nextExpanded = orderedSections(expanded.length ? expanded : [...RESULT_PRESENTATION_DEFAULT_EXPANDED_SECTIONS]);
  return {
    ...contract,
    defaultExpandedSections: nextExpanded,
    diagnosticsRefs: contract.diagnosticsRefs.map((diagnostic) => ({
      ...diagnostic,
      defaultVisible: diagnosticIsRawPayload(diagnostic) ? false : diagnostic.defaultVisible,
      primary: diagnosticIsRawPayload(diagnostic) ? false : diagnostic.primary,
      foldedByDefault: true,
    })),
    fieldOrigins: {
      ...contract.fieldOrigins,
      defaultExpandedSections: contract.fieldOrigins?.defaultExpandedSections ?? 'harness-presentation-policy',
    },
  };
}

export function validateResultPresentationContract(value: unknown): ResultPresentationValidationResult {
  if (!isRecord(value) || value.schemaVersion !== RESULT_PRESENTATION_SCHEMA_VERSION) {
    return {
      ok: false,
      issues: [issue('', 'invalid-schema-version', `Result presentation must use ${RESULT_PRESENTATION_SCHEMA_VERSION}.`)],
    };
  }
  const contract = value as unknown as ResultPresentationContract;
  const issues: ResultPresentationValidationIssue[] = [];
  const citationIds = new Set((contract.inlineCitations ?? []).map((citation) => citation.id));
  (contract.keyFindings ?? []).forEach((finding, index) => {
    if (!findingText(finding)) issues.push(issue(`keyFindings.${index}.text`, 'finding-missing-text', 'Key finding text is required.'));
    if (!findingHasCitationOrUncertainty(finding)) {
      issues.push(issue(`keyFindings.${index}.citationIds`, 'finding-missing-citation-or-uncertainty', 'Key finding needs citation or uncertainty.'));
    }
    for (const citationId of findingCitationIds(finding)) {
      if (!citationIds.has(citationId)) issues.push(issue(`keyFindings.${index}.citationIds`, 'finding-unknown-citation', `Unknown citation id: ${citationId}.`));
    }
  });
  (contract.diagnosticsRefs ?? []).forEach((diagnostic, index) => {
    if (diagnosticIsRawPayload(diagnostic) && diagnostic.primary) issues.push(issue(`diagnosticsRefs.${index}.primary`, 'raw-diagnostic-primary', 'Raw diagnostics cannot be primary.'));
    if (diagnosticIsRawPayload(diagnostic) && diagnostic.defaultVisible) issues.push(issue(`diagnosticsRefs.${index}.defaultVisible`, 'raw-diagnostic-default-visible', 'Raw diagnostics cannot be default-visible.'));
  });
  if ((contract.defaultExpandedSections ?? []).includes('diagnostics')) issues.push(issue('defaultExpandedSections', 'diagnostics-expanded-by-default', 'Diagnostics must be collapsed by default.'));
  if ((contract.defaultExpandedSections ?? []).includes('process')) issues.push(issue('defaultExpandedSections', 'process-expanded-by-default', 'Process must be collapsed by default.'));
  if ((contract.defaultExpandedSections ?? []).includes('raw-payload')) issues.push(issue('defaultExpandedSections', 'raw-expanded-by-default', 'Raw payload must be collapsed by default.'));
  return { ok: issues.length === 0, issues };
}

export function findingHasCitationOrUncertainty(finding: ResultPresentationKeyFinding): boolean {
  return findingCitationIds(finding).length > 0
    || Boolean(finding.uncertainty?.reason)
    || ['unverified', 'speculative'].includes(String(finding.verificationState ?? finding.status ?? ''));
}

export function diagnosticIsRawPayload(diagnostic: ResultPresentationDiagnosticsRef): boolean {
  return (RESULT_PRESENTATION_RAW_DIAGNOSTIC_KINDS as readonly string[]).includes(diagnostic.kind)
    || /raw|payload|toolpayload|stdout|stderr|trace|schema|backend|budget|repair/i.test(`${diagnostic.kind} ${diagnostic.label}`);
}

export function resultPresentationTextLooksLikeRawJson(text: string): boolean {
  const trimmed = text.trim();
  if (!/^[{[]/.test(trimmed)) return false;
  return /"(raw|trace|tool|toolOutput|executionUnits|uiManifest|artifacts|stdout|stderr|auditRefs|recoverActions|failureReason|claimType|claims|objects|verificationResults|diagnosticsRefs|processSummary|defaultExpandedSections)"\s*:/.test(trimmed);
}

export function resultPresentationPrimaryDiagnostics(contract: Pick<ResultPresentationContract, 'diagnosticsRefs'>) {
  return (contract.diagnosticsRefs ?? []).filter((diagnostic) => diagnostic.primary);
}

export function projectResultPresentationVisibility(contract: ResultPresentationContract): ResultPresentationVisibilityProjection {
  const expandedSections = orderedSections(contract.defaultExpandedSections);
  const collapsedSections = orderedSections([...RESULT_PRESENTATION_COLLAPSED_BY_DEFAULT_SECTIONS]);
  const secondarySections: ResultPresentationSection[] = [];
  if (contract.processSummary) secondarySections.push('process');
  if (contract.diagnosticsRefs.length) secondarySections.push('diagnostics');
  return {
    expandedSections,
    collapsedSections,
    primarySections: orderedSections([...RESULT_PRESENTATION_PRIMARY_SECTIONS]),
    secondarySections: orderedSections(secondarySections),
  };
}

export function resultPresentationFromPayload(input: {
  payload: unknown;
  objectReferences?: Array<Record<string, unknown>>;
  fallbackTitle?: string;
}): ResultPresentationContract {
  const payload = isRecord(input.payload) ? input.payload : {};
  const citations = citationsFromPayload(payload, input.objectReferences ?? []);
  const claims = recordList(payload.claims);
  const findings = claims.length
    ? claims.slice(0, 8).map((claim, index) => findingFromClaim(claim, index, citations))
    : [findingFromMessage(stringField(payload.message) ?? input.fallbackTitle ?? 'Result completed.', citations)];
  const diagnosticsRefs = diagnosticsRefsFromPayload(payload);
  const recoverActions = recoverActionsFromPayload(payload);
  const status = resultStatusFromPayload(payload);
  const conversationProjection = conversationProjectionFromPayload(payload);
  return createResultPresentationContract({
    status,
    answerBlocks: [{
      id: 'answer-summary',
      kind: 'paragraph',
      text: compactHumanText(stringField(payload.message) ?? input.fallbackTitle ?? 'Result completed.'),
      citationIds: citations.slice(0, 4).map((citation) => citation.id),
    }],
    keyFindings: findings,
    inlineCitations: citations,
    artifactActions: artifactActionsFromPayload(payload, citations),
    confidenceExplanation: confidenceFromPayload(payload, citations),
    nextActions: recoverActions.length
      ? recoverActions.slice(0, 5).map((label, index) => ({
          id: `next-${index + 1}`,
          label,
          kind: /retry|rerun|重试/i.test(label) ? 'retry' : 'inspect',
        }))
      : [{ id: 'next-inspect', label: 'Inspect generated artifacts and evidence.', kind: 'inspect' }],
    processSummary: {
      status: processStatusFromPayload(payload),
      summary: stringField(payload.reasoningTrace) ? 'Execution trace and runtime evidence are available for audit.' : 'Runtime evidence is available for audit.',
      foldedByDefault: true,
      refs: diagnosticsRefs.map((ref) => ref.ref).filter((ref): ref is string => Boolean(ref)),
    },
    diagnosticsRefs,
    defaultExpandedSections: ['answer', 'evidence', 'artifacts', 'actions', 'next-actions'],
    conversationProjectionRef: conversationProjection.ref,
    conversationProjectionSummary: conversationProjection.summary,
  });
}

function conversationProjectionFromPayload(payload: Record<string, unknown>): {
  ref?: string;
  summary?: TaskRunCardConversationProjectionSummary;
} {
  const displayIntent = isRecord(payload.displayIntent) ? payload.displayIntent : {};
  const explicitRef = stringField(displayIntent.conversationProjectionRef);
  const projection = isRecord(displayIntent.conversationProjection)
    ? displayIntent.conversationProjection
    : isRecord(displayIntent.taskOutcomeProjection) && isRecord(displayIntent.taskOutcomeProjection.conversationProjection)
      ? displayIntent.taskOutcomeProjection.conversationProjection
      : undefined;
  if (!projection) return { ref: explicitRef };
  const conversationId = stringField(projection.conversationId);
  if (!conversationId) return { ref: explicitRef };
  const visibleAnswer = isRecord(projection.visibleAnswer) ? projection.visibleAnswer : {};
  const activeRun = isRecord(projection.activeRun) ? projection.activeRun : {};
  const diagnostics = recordList(projection.diagnostics);
  const recoverActions = stringList(projection.recoverActions);
  const failureDiagnostic = diagnostics.find((diagnostic) => {
    const severity = stringField(diagnostic.severity);
    return severity === 'error' || stringField(diagnostic.code);
  });
  const verificationState = isRecord(projection.verificationState) ? projection.verificationState : undefined;
  const backgroundState = isRecord(projection.backgroundState) ? projection.backgroundState : undefined;
  return {
    ref: explicitRef,
    summary: {
      schemaVersion: 'sciforge.task-run-card.conversation-projection-summary.v1',
      conversationId,
      status: stringField(visibleAnswer.status) ?? stringField(activeRun.status) ?? 'idle',
      activeRunId: stringField(activeRun.id),
      failureOwner: failureDiagnostic
        ? {
            ownerLayer: stringField(failureDiagnostic.code) ?? 'unknown',
            reason: stringField(failureDiagnostic.message) ?? 'Conversation projection reported a failure.',
            evidenceRefs: stringList(failureDiagnostic.refs),
            nextStep: recoverActions[0],
          }
        : undefined,
      recoverActions,
      verificationState: verificationState
        ? {
            status: stringField(verificationState.status) ?? 'unverified',
            verifierRef: stringField(verificationState.verifierRef),
            verdict: stringField(verificationState.verdict),
          }
        : undefined,
      backgroundState: backgroundState
        ? {
            status: stringField(backgroundState.status) ?? 'running',
            checkpointRefs: stringList(backgroundState.checkpointRefs),
            revisionPlan: stringField(backgroundState.revisionPlan),
          }
        : undefined,
    },
  };
}

function findingFromClaim(claim: Record<string, unknown>, index: number, citations: ResultPresentationInlineCitation[]): ResultPresentationKeyFinding {
  const refs = uniqueStrings([...stringList(claim.supportingRefs), ...stringList(claim.evidenceRefs), ...stringList(claim.refs)]);
  const citationIds = citations.filter((citation) => refs.includes(citation.ref) || refs.includes(citation.id)).map((citation) => citation.id);
  const statement = compactHumanText(stringField(claim.statement) ?? stringField(claim.text) ?? stringField(claim.claim) ?? `Finding ${index + 1}`);
  const verificationState = stringField(claim.verificationState) ?? stringField(claim.status) ?? (citationIds.length ? 'supported' : 'unverified');
  return {
    id: stringField(claim.id) ?? `finding-${index + 1}`,
    kind: verificationState === 'failed' ? 'failure' : verificationState === 'partial' ? 'partial-result' : 'finding',
    statement,
    text: statement,
    citationIds,
    verificationState,
    confidence: numberField(claim.confidence),
    uncertainty: citationIds.length ? uncertaintyFromClaim(claim) : { state: verificationState === 'partial' ? 'partial' : 'unverified', reason: stringField(claim.uncertaintyReason) ?? 'No direct citation was attached to this finding.' },
  };
}

function findingFromMessage(message: string, citations: ResultPresentationInlineCitation[]): ResultPresentationKeyFinding {
  return {
    id: 'finding-summary',
    kind: 'summary',
    statement: compactHumanText(message).split(/\n+/)[0] ?? compactHumanText(message),
    text: compactHumanText(message).split(/\n+/)[0] ?? compactHumanText(message),
    citationIds: citations.slice(0, 4).map((citation) => citation.id),
    verificationState: citations.length ? 'supported' : 'unverified',
    uncertainty: citations.length ? undefined : { state: 'unverified', reason: 'No direct citation was attached to this result.' },
  };
}

function citationsFromPayload(payload: Record<string, unknown>, objectReferences: Array<Record<string, unknown>>) {
  const allReferences = [...objectReferences, ...recordList(payload.objectReferences)];
  const fromObjects = allReferences.flatMap((reference, index): ResultPresentationInlineCitation[] => {
    const ref = stringField(reference.ref) ?? stringField(reference.id);
    if (!ref) return [];
    return [{
      id: safeId(stringField(reference.id) ?? ref ?? `ref-${index + 1}`),
      label: stringField(reference.title) ?? ref,
      ref,
      kind: citationKind(stringField(reference.kind), ref),
      source: 'object-reference',
      summary: stringField(reference.summary),
      status: stringField(reference.status),
    }];
  });
  const fromArtifacts = recordList(payload.artifacts).filter(artifactIsUserFacingPresentationArtifact).flatMap((artifact, index): ResultPresentationInlineCitation[] => {
    const ref = artifactRef(artifact);
    if (!ref) return [];
    const type = stringField(artifact.type) ?? stringField(artifact.artifactType) ?? 'artifact';
    const id = stringField(artifact.id) ?? `${type}-${index + 1}`;
    return [{
      id: safeId(`artifact-${id}`),
      label: stringField(artifact.title) ?? id,
      ref,
      kind: 'artifact',
      source: 'artifact',
      summary: type,
      status: 'available',
    }];
  });
  const fromClaimRefs = recordList(payload.claims).flatMap((claim): ResultPresentationInlineCitation[] => {
    return uniqueStrings([...stringList(claim.evidenceRefs), ...stringList(claim.supportingRefs), ...stringList(claim.sourceRefs)])
      .map((ref) => ({
        id: safeId(`citation-${ref}`),
        label: refLabel(ref),
        ref,
        kind: citationKind(undefined, ref),
        source: 'claim',
        status: stringField(claim.verificationState) ?? stringField(claim.status),
      }));
  });
  return dedupeCitations([...fromObjects, ...fromArtifacts, ...fromClaimRefs]);
}

function artifactActionsFromPayload(payload: Record<string, unknown>, citations: ResultPresentationInlineCitation[]): ResultPresentationArtifactAction[] {
  return recordList(payload.artifacts).filter(artifactIsUserFacingPresentationArtifact).slice(0, 12).map((artifact, index) => {
    const id = stringField(artifact.id) ?? `artifact-${index + 1}`;
    const ref = artifactRef(artifact) ?? `artifact:${id}`;
    const citation = citations.find((item) => item.ref === ref);
    const derivation = artifactDerivation(artifact);
    const sourceRefs = uniqueStrings([
      ...stringList(artifact.sourceRefs),
      ...stringList(isRecord(artifact.metadata) ? artifact.metadata.sourceRefs : undefined),
      ...(derivation?.sourceRefs ?? []),
    ]);
    return {
      id,
      label: stringField(artifact.title) ?? stringField(artifact.type) ?? id,
      ref,
      action: 'inspect',
      kind: 'inspect',
      actions: ['inspect', 'focus-right-pane'],
      artifactType: stringField(artifact.type),
      citationId: citation?.id,
      primary: index === 0,
      parentArtifactRef: derivation?.parentArtifactRef
        ?? stringField(artifact.parentArtifactRef)
        ?? stringField(isRecord(artifact.metadata) ? artifact.metadata.parentArtifactRef : undefined),
      sourceRefs: sourceRefs.length ? sourceRefs : undefined,
      derivationKind: derivation?.kind,
      derivation,
    };
  });
}

function artifactIsUserFacingPresentationArtifact(artifact: Record<string, unknown>): boolean {
  if (!isRecord(artifact.delivery)) return true;
  return artifactHasUserFacingDelivery(artifact);
}

function diagnosticsRefsFromPayload(payload: Record<string, unknown>): ResultPresentationDiagnosticsRef[] {
  const refs: ResultPresentationDiagnosticsRef[] = [];
  if (stringField(payload.reasoningTrace)) refs.push({ id: 'reasoning-trace', label: 'Reasoning trace', kind: 'reasoning-trace', summary: stringField(payload.reasoningTrace), foldedByDefault: true });
  for (const [index, log] of recordList(payload.logs).entries()) {
    refs.push({ id: stringField(log.id) ?? `log-${index + 1}`, label: stringField(log.label) ?? stringField(log.kind) ?? 'Log', kind: stringField(log.kind) === 'stderr' ? 'stderr' : 'log', ref: stringField(log.ref), summary: stringField(log.message), foldedByDefault: true });
  }
  for (const [index, unit] of recordList(payload.executionUnits).entries()) {
    const unitId = stringField(unit.id) ?? `execution-${index + 1}`;
    pushDiagnostic(refs, 'stdout', stringField(unit.stdoutRef), unitId);
    pushDiagnostic(refs, 'stderr', stringField(unit.stderrRef), unitId);
    pushDiagnostic(refs, 'trace', stringField(unit.traceRef), unitId);
    if (stringField(unit.failureReason)) refs.push({ id: safeId(`${unitId}-failure`), label: `${unitId} failure`, kind: 'backend', summary: stringField(unit.failureReason), foldedByDefault: true });
  }
  return dedupeDiagnostics(refs);
}

function pushDiagnostic(refs: ResultPresentationDiagnosticsRef[], kind: ResultPresentationDiagnosticKind, ref: string | undefined, label: string) {
  if (!ref) return;
  refs.push({ id: safeId(`${label}-${kind}`), label: `${label} ${kind}`, kind, ref, foldedByDefault: true });
}

function confidenceFromPayload(payload: Record<string, unknown>, citations: ResultPresentationInlineCitation[]): ResultPresentationConfidenceExplanation | undefined {
  const confidence = numberField(payload.confidence);
  const evidenceLevel = stringField(payload.evidenceLevel);
  const level = confidence === undefined
    ? evidenceLevel === 'unverified' ? 'unverified' : undefined
    : confidence >= 0.82 ? 'high' : confidence >= 0.55 ? 'medium' : 'low';
  if (!level) return undefined;
  return {
    level,
    summary: evidenceLevel ? `Evidence level: ${evidenceLevel}; confidence ${confidence ?? 'not provided'}.` : `Confidence ${confidence}.`,
    explanation: evidenceLevel ? `Evidence level: ${evidenceLevel}; confidence ${confidence ?? 'not provided'}.` : `Confidence ${confidence}.`,
    citationIds: citations.slice(0, 3).map((citation) => citation.id),
  };
}

function processStatusFromPayload(payload: Record<string, unknown>): ResultPresentationProcessSummary['status'] {
  const text = `${payload.claimType ?? ''} ${payload.evidenceLevel ?? ''} ${payload.message ?? ''}`.toLowerCase();
  if (/failed-with-reason|failed|failure|repair-needed|失败/.test(text)) return 'failed';
  if (/needs-human|human/.test(text)) return 'needs-human';
  if (/partial|insufficient|unverified|unavailable|missing/.test(text)) return 'partial';
  return 'completed';
}

function resultStatusFromPayload(payload: Record<string, unknown>): ResultPresentationStatus {
  const text = `${payload.status ?? ''} ${payload.claimType ?? ''} ${payload.evidenceLevel ?? ''} ${payload.message ?? ''}`.toLowerCase();
  if (/background|running|continuing/.test(text)) return 'background-running';
  if (/failed-with-reason|failed|failure|repair-needed|失败/.test(text)) return 'failed';
  if (/needs-human|human/.test(text)) return 'needs-human';
  if (/partial|insufficient|unverified|unavailable|missing/.test(text)) return 'partial';
  return 'complete';
}

function resultStatusFromProcess(status?: ResultPresentationProcessSummary['status']): ResultPresentationStatus {
  if (status === 'failed') return 'failed';
  if (status === 'needs-human') return 'needs-human';
  if (status === 'partial') return 'partial';
  if (status === 'running') return 'background-running';
  return 'complete';
}

function recoverActionsFromPayload(payload: Record<string, unknown>) {
  return uniqueStrings([
    ...stringList(payload.recoverActions),
    ...recordList(payload.executionUnits).flatMap((unit) => [...stringList(unit.recoverActions), stringField(unit.nextStep)].filter(Boolean) as string[]),
    ...recordList(payload.verificationResults).flatMap((result) => stringList(result.repairHints)),
  ]);
}

function uncertaintyFromClaim(claim: Record<string, unknown>): ResultPresentationUncertainty | undefined {
  const reason = stringField(claim.uncertaintyReason);
  if (!reason) return undefined;
  return { state: 'unverified', reason };
}

function findingCitationIds(finding: ResultPresentationKeyFinding) {
  return [...(finding.citationIds ?? []), ...(finding.citations ?? [])];
}

function findingText(finding: ResultPresentationKeyFinding) {
  return stringField(finding.statement) ?? stringField(finding.text);
}

function artifactRef(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return stringField(artifact.dataRef)
    || stringField(artifact.path)
    || stringField(artifact.ref)
    || stringField(artifact.outputRef)
    || stringField(artifact.imageRef)
    || stringField(metadata.artifactRef)
    || stringField(metadata.outputRef);
}

function artifactDerivation(artifact: Record<string, unknown>): RuntimeArtifactDerivation | undefined {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  const derivation = isRecord(metadata.derivation) ? metadata.derivation : undefined;
  if (!derivation) return undefined;
  const kind = stringField(derivation.kind);
  if (!kind) return undefined;
  return {
    schemaVersion: 'sciforge.artifact-derivation.v1',
    kind,
    parentArtifactRef: stringField(derivation.parentArtifactRef),
    sourceRefs: stringList(derivation.sourceRefs),
    sourceLanguage: stringField(derivation.sourceLanguage),
    targetLanguage: stringField(derivation.targetLanguage),
    verificationStatus: stringField(derivation.verificationStatus) as RuntimeArtifactDerivation['verificationStatus'],
  };
}

function citationKind(kind: string | undefined, ref: string): ResultPresentationCitationKind {
  if (kind === 'artifact' || /^artifact[:]/i.test(ref)) return 'artifact';
  if (kind === 'url' || /^https?:\/\//i.test(ref)) return 'url';
  if (kind === 'execution-unit' || /^execution-unit:/i.test(ref)) return 'execution-unit';
  if (kind === 'verification' || /^verification:/i.test(ref)) return 'verification';
  if (kind === 'log' || /^log:/i.test(ref)) return 'log';
  if (kind === 'file' || kind === 'folder' || /^file:|^\./i.test(ref)) return 'file';
  if (kind === 'screenshot' || kind === 'screenshot-region') return 'screenshot';
  if (kind === 'data' || kind === 'data-row' || kind === 'dataset') return 'data';
  return 'object-reference';
}

function issue(path: string, code: string, message: string): ResultPresentationValidationIssue {
  return { path, code, message, severity: 'error' };
}

function orderedSections(values: readonly ResultPresentationSection[]) {
  const order: ResultPresentationSection[] = ['answer', 'evidence', 'artifacts', 'actions', 'confidence', 'next-actions', 'process', 'trace', 'diagnostics', 'raw-payload'];
  const set = new Set(values);
  return order.filter((item) => set.has(item));
}

function dedupeCitations(citations: ResultPresentationInlineCitation[]) {
  const byRef = new Map<string, ResultPresentationInlineCitation>();
  for (const citation of citations) byRef.set(citation.ref, citation);
  return [...byRef.values()];
}

function dedupeDiagnostics(refs: ResultPresentationDiagnosticsRef[]) {
  const byKey = new Map<string, ResultPresentationDiagnosticsRef>();
  for (const ref of refs) byKey.set(ref.ref ?? `${ref.kind}:${ref.id}`, ref);
  return [...byKey.values()];
}

function compactHumanText(text: string) {
  const stripped = text.replace(/```(?:json)?[\s\S]*?```/gi, '').replace(/\bRAW_TOOL_PAYLOAD_SHOULD_NOT_RENDER\b:?[^.\n]*/g, '').trim();
  return stripped.length > 1600 ? `${stripped.slice(0, 1600)}...` : stripped || 'Result completed.';
}

function refLabel(ref: string) {
  const last = ref.split(/[?#]/)[0]?.split('/').filter(Boolean).pop();
  return last || ref;
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function stringList(value: unknown) {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0) : [];
}

function recordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function uniqueStrings(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function safeId(value: string) {
  return value.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 120) || 'item';
}

function hashText(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) hash = Math.imul(31, hash) + value.charCodeAt(index) | 0;
  return Math.abs(hash).toString(36);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
