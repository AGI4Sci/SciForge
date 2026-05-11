import type {
  ResultPresentationArtifactAction,
  ResultPresentationCitation,
  ResultPresentationContract,
  ResultPresentationDiagnosticsRef,
  ResultPresentationKeyFinding,
  ResultPresentationProcessItem,
  ToolPayload,
  VerificationResult,
} from '../runtime-types.js';
import { isRecord, toRecordList, toStringList, uniqueStrings } from '../gateway-utils.js';

export interface ResultPresentationAdapterOptions {
  rawPayloadRef?: string;
  schemaDiagnostics?: string[];
}

type CitationSource = ResultPresentationCitation['source'];

export function adaptToolPayloadToResultPresentation(
  payload: ToolPayload,
  options: ResultPresentationAdapterOptions = {},
): ResultPresentationContract {
  const citations = new CitationIndex();
  const keyFindings = keyFindingsFromClaims(payload, citations);
  const artifactActions = artifactActionsFromPayload(payload, citations);
  const processSummary = processSummaryFromExecutionUnits(payload);
  const diagnosticsRefs = diagnosticsFromPayload(payload, options);
  const nextActions = nextActionsFromPayload(payload);

  addObjectReferenceCitations(payload, citations);
  addWorkEvidenceCitations(payload, citations, keyFindings, diagnosticsRefs);
  addVerificationCitations(payload, citations, diagnosticsRefs);

  const answerCitationIds = primaryAnswerCitationIds(keyFindings, artifactActions, citations.values());
  const answerText = payload.message.trim();

  return {
    schemaVersion: 'sciforge.result-presentation.v1',
    status: resultStatusFromPayload(payload),
    answerBlocks: answerText ? [{
      id: 'answer-1',
      type: 'paragraph',
      text: answerText,
      citations: answerCitationIds,
    }] : [],
    keyFindings,
    inlineCitations: citations.values(),
    artifactActions,
    confidenceExplanation: confidenceExplanation(payload),
    nextActions,
    processSummary: {
      foldedByDefault: true,
      items: processSummary,
    },
    diagnosticsRefs,
    defaultExpandedSections: defaultExpandedSections({
      hasEvidence: citations.values().length > 0 || keyFindings.some((finding) => finding.citations.length > 0),
      hasArtifacts: artifactActions.length > 0,
      hasNextActions: nextActions.length > 0,
    }),
  };
}

function keyFindingsFromClaims(payload: ToolPayload, citations: CitationIndex): ResultPresentationKeyFinding[] {
  return toRecordList(payload.claims).map((claim, index) => {
    const claimId = stringField(claim.id) || `claim-${index + 1}`;
    const refs = claimRefs(claim);
    const citationIds = refs.map((ref) => citations.addRef(ref, 'claim', {
      label: refLabel(ref),
      summary: stringField(claim.summary),
      status: stringField(claim.status) || stringField(claim.verificationStatus) || stringField(claim.verdict),
    }));
    for (const objectReference of toRecordList(claim.objectReferences)) {
      citationIds.push(citations.addObjectReference(objectReference, 'claim'));
    }
    return {
      id: claimId,
      text: claimText(claim) || `Claim ${index + 1}`,
      citations: uniqueStrings(citationIds),
      confidence: numberField(claim.confidence),
      verificationStatus: stringField(claim.verificationStatus)
        || stringField(claim.status)
        || stringField(claim.verdict)
        || (citationIds.length ? undefined : 'unverified'),
    };
  }).filter((finding) => finding.text.trim().length > 0);
}

function artifactActionsFromPayload(payload: ToolPayload, citations: CitationIndex): ResultPresentationArtifactAction[] {
  return toRecordList(payload.artifacts).map((artifact, index) => {
    const id = stringField(artifact.id) || `artifact-${index + 1}`;
    const artifactType = stringField(artifact.type);
    const label = stringField(artifact.title)
      || stringField(artifact.name)
      || artifactType
      || id;
    const ref = artifactRef(artifact) || id;
    const citationId = citations.addRef(ref, 'artifact', {
      label,
      artifactType,
      summary: stringField(artifact.summary) || stringField(artifact.description),
    });
    return {
      id,
      label,
      artifactType,
      ref,
      actions: artifactActions(artifact),
      citationId,
    };
  });
}

function processSummaryFromExecutionUnits(payload: ToolPayload): ResultPresentationProcessItem[] {
  return toRecordList(payload.executionUnits).map((unit, index) => {
    const id = stringField(unit.id) || `execution-unit-${index + 1}`;
    const refs = uniqueStrings([
      ...toStringList(unit.outputArtifacts),
      ...toStringList(unit.artifacts),
      stringField(unit.outputRef),
      stringField(unit.stdoutRef),
      stringField(unit.stderrRef),
      stringField(unit.diffRef),
      stringField(unit.verificationRef),
    ].filter((entry): entry is string => Boolean(entry)));
    return {
      id,
      label: stringField(unit.tool) || id,
      status: stringField(unit.status),
      refs,
    };
  });
}

function addObjectReferenceCitations(payload: ToolPayload, citations: CitationIndex) {
  for (const reference of toRecordList(payload.objectReferences)) {
    citations.addObjectReference(reference, 'object-reference');
  }
}

function addWorkEvidenceCitations(
  payload: ToolPayload,
  citations: CitationIndex,
  keyFindings: ResultPresentationKeyFinding[],
  diagnosticsRefs: ResultPresentationDiagnosticsRef[],
) {
  for (const [index, evidence] of (payload.workEvidence ?? []).entries()) {
    const id = evidence.id || `work-evidence-${index + 1}`;
    const citationIds = uniqueStrings(evidence.evidenceRefs.map((ref) => citations.addRef(ref, 'work-evidence', {
      label: refLabel(ref),
      status: evidence.status,
      summary: evidence.outputSummary || evidence.failureReason,
    })));
    if (!keyFindings.length && (evidence.outputSummary || evidence.failureReason)) {
      keyFindings.push({
        id,
        text: evidence.failureReason || evidence.outputSummary || id,
        citations: citationIds,
        verificationStatus: evidence.status,
      });
    }
    if (evidence.rawRef) {
      diagnosticsRefs.push({
        id: `${id}-raw`,
        label: 'Raw evidence reference',
        ref: evidence.rawRef,
        kind: 'work-evidence',
        summary: evidence.outputSummary || evidence.failureReason,
      });
    }
    for (const diagnostic of evidence.diagnostics ?? []) {
      diagnosticsRefs.push({
        id: `${id}-diagnostic-${diagnosticsRefs.length + 1}`,
        label: 'Work evidence diagnostic',
        kind: 'work-evidence',
        summary: diagnostic,
      });
    }
  }
}

function addVerificationCitations(
  payload: ToolPayload,
  citations: CitationIndex,
  diagnosticsRefs: ResultPresentationDiagnosticsRef[],
) {
  for (const [index, result] of (payload.verificationResults ?? []).entries()) {
    const id = result.id || `verification-${index + 1}`;
    for (const ref of result.evidenceRefs ?? []) {
      citations.addRef(ref, 'verification-result', {
        label: refLabel(ref),
        status: result.verdict,
        summary: result.critique,
      });
    }
    diagnosticsRefs.push({
      id,
      label: 'Verification result',
      kind: 'verification',
      summary: verificationSummary(result),
    });
  }
}

function diagnosticsFromPayload(payload: ToolPayload, options: ResultPresentationAdapterOptions) {
  const diagnosticsRefs: ResultPresentationDiagnosticsRef[] = [];
  if (payload.reasoningTrace.trim()) {
    diagnosticsRefs.push({
      id: 'reasoning-trace',
      label: 'Reasoning trace',
      kind: 'reasoning-trace',
      summary: payload.reasoningTrace.trim(),
    });
  }
  if (options.rawPayloadRef) {
    diagnosticsRefs.push({
      id: 'raw-payload',
      label: 'Raw payload reference',
      ref: options.rawPayloadRef,
      kind: 'raw-payload',
    });
  }
  for (const [index, diagnostic] of (options.schemaDiagnostics ?? []).entries()) {
    diagnosticsRefs.push({
      id: `schema-${index + 1}`,
      label: 'Schema diagnostic',
      kind: 'schema',
      summary: diagnostic,
    });
  }
  for (const [index, log] of toRecordList(payload.logs).entries()) {
    diagnosticsRefs.push({
      id: stringField(log.id) || `log-${index + 1}`,
      label: stringField(log.label) || stringField(log.level) || 'Log',
      ref: stringField(log.ref) || stringField(log.path),
      kind: 'log',
      summary: stringField(log.message) || stringField(log.summary),
    });
  }
  for (const [index, debit] of (payload.budgetDebits ?? []).entries()) {
    diagnosticsRefs.push({
      id: `budget-${index + 1}`,
      label: 'Budget debit',
      kind: 'budget',
      summary: stringField(debit.metadata?.reason) || debit.capabilityId,
    });
  }
  for (const [index, unit] of toRecordList(payload.executionUnits).entries()) {
    const unitId = stringField(unit.id) || `execution-unit-${index + 1}`;
    const failureReason = stringField(unit.failureReason);
    const stderrRef = stringField(unit.stderrRef);
    const stdoutRef = stringField(unit.stdoutRef);
    if (failureReason || stderrRef || stdoutRef) {
      diagnosticsRefs.push({
        id: `${unitId}-diagnostic`,
        label: 'Execution unit diagnostic',
        ref: stderrRef || stdoutRef,
        kind: stderrRef ? 'stderr' : stdoutRef ? 'stdout' : 'execution-unit',
        summary: failureReason,
      });
    }
  }
  return diagnosticsRefs;
}

function nextActionsFromPayload(payload: ToolPayload) {
  return uniqueStrings([
    ...toRecordList(payload.executionUnits).flatMap((unit) => [
      ...toStringList(unit.recoverActions),
      stringField(unit.nextStep),
    ]),
    ...(payload.workEvidence ?? []).flatMap((evidence) => [
      ...evidence.recoverActions,
      evidence.nextStep,
    ]),
    ...(payload.verificationResults ?? []).flatMap((result) => result.repairHints ?? []),
  ].filter((entry): entry is string => Boolean(entry?.trim())));
}

function confidenceExplanation(payload: ToolPayload) {
  const parts = [
    Number.isFinite(payload.confidence) ? `confidence ${Math.round(payload.confidence * 100)}%` : undefined,
    payload.evidenceLevel ? `evidence ${payload.evidenceLevel}` : undefined,
    payload.verificationResults?.length
      ? `verification ${payload.verificationResults.map((result) => result.verdict).join(', ')}`
      : undefined,
  ].filter(Boolean);
  return parts.length ? parts.join('; ') : undefined;
}

function defaultExpandedSections(input: {
  hasEvidence: boolean;
  hasArtifacts: boolean;
  hasNextActions: boolean;
}): ResultPresentationContract['defaultExpandedSections'] {
  return [
    'answer',
    input.hasEvidence ? 'evidence' : undefined,
    input.hasArtifacts ? 'artifacts' : undefined,
    input.hasNextActions ? 'next-actions' : undefined,
  ].filter((section): section is ResultPresentationContract['defaultExpandedSections'][number] => Boolean(section));
}

function resultStatusFromPayload(payload: ToolPayload): NonNullable<ResultPresentationContract['status']> {
  const text = `${payload.claimType} ${payload.evidenceLevel} ${payload.message}`.toLowerCase();
  if (/background|running|continuing/.test(text)) return 'background-running';
  if (/failed-with-reason|failed|failure|repair-needed|失败/.test(text)) return 'failed';
  if (/needs-human|human/.test(text)) return 'needs-human';
  if (/partial|insufficient|unverified|unavailable|missing/.test(text)) return 'partial';
  return 'complete';
}

function primaryAnswerCitationIds(
  keyFindings: ResultPresentationKeyFinding[],
  artifactActions: ResultPresentationArtifactAction[],
  citations: ResultPresentationCitation[],
) {
  return uniqueStrings([
    ...keyFindings.flatMap((finding) => finding.citations),
    ...artifactActions.map((action) => action.citationId).filter((id): id is string => Boolean(id)),
    ...citations
      .filter((citation) => citation.source === 'object-reference')
      .map((citation) => citation.id),
  ]).slice(0, 8);
}

function claimRefs(claim: Record<string, unknown>) {
  return uniqueStrings([
    ...toStringList(claim.evidenceRefs),
    ...toStringList(claim.supportingRefs),
    ...toStringList(claim.sourceRefs),
    ...toStringList(claim.references),
    ...toRecordList(claim.refs).map((ref) => stringField(ref.ref) || stringField(ref.id) || '').filter(Boolean),
  ]);
}

function claimText(claim: Record<string, unknown>) {
  return stringField(claim.text)
    || stringField(claim.claim)
    || stringField(claim.summary)
    || stringField(claim.message)
    || stringField(claim.title);
}

function artifactRef(artifact: Record<string, unknown>) {
  const metadata = isRecord(artifact.metadata) ? artifact.metadata : {};
  return stringField(artifact.dataRef)
    || stringField(artifact.path)
    || stringField(artifact.ref)
    || stringField(artifact.outputRef)
    || stringField(metadata.artifactRef)
    || stringField(metadata.outputRef)
    || stringField(metadata.path);
}

function artifactActions(artifact: Record<string, unknown>) {
  const actions = toStringList(artifact.actions);
  if (actions.length) return actions;
  return artifactRef(artifact) ? ['inspect', 'focus-right-pane'] : ['inspect'];
}

function verificationSummary(result: VerificationResult) {
  return [
    `verdict ${result.verdict}`,
    Number.isFinite(result.confidence) ? `confidence ${Math.round(result.confidence * 100)}%` : undefined,
    result.critique,
  ].filter(Boolean).join('; ');
}

function refLabel(ref: string) {
  const normalized = ref.trim();
  if (!normalized) return 'Reference';
  const withoutQuery = normalized.split(/[?#]/)[0] || normalized;
  const last = withoutQuery.split('/').filter(Boolean).pop();
  return last || normalized;
}

function citationKind(ref: string): ResultPresentationCitation['kind'] {
  if (/^https?:\/\//i.test(ref)) return 'url';
  if (/^execution-unit:/i.test(ref)) return 'execution-unit';
  if (/^workEvidence:/i.test(ref)) return 'work-evidence';
  if (/^verification:/i.test(ref)) return 'verification';
  if (/^artifact:/i.test(ref)) return 'artifact';
  if (/^file:|^\.[\w/-]+|^[\w-]+\/|\/[\w-]+/i.test(ref)) return 'file';
  return 'unknown';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function numberField(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

class CitationIndex {
  private readonly entries = new Map<string, ResultPresentationCitation>();

  addRef(ref: string, source: CitationSource, options: {
    label?: string;
    artifactType?: string;
    summary?: string;
    status?: string;
    locator?: Record<string, unknown>;
  } = {}) {
    const normalized = ref.trim();
    const key = `${source}:${normalized}`;
    const existing = this.entries.get(key);
    if (existing) return existing.id;
    const id = `citation-${this.entries.size + 1}`;
    this.entries.set(key, {
      id,
      label: options.label || refLabel(normalized),
      ref: normalized,
      kind: options.artifactType ? 'artifact' : citationKind(normalized),
      source,
      summary: options.summary,
      status: options.status,
      locator: options.locator,
    });
    return id;
  }

  addObjectReference(reference: Record<string, unknown>, source: CitationSource) {
    const ref = stringField(reference.ref) || stringField(reference.id);
    if (!ref) {
      const id = `citation-${this.entries.size + 1}`;
      this.entries.set(`${source}:object:${id}`, {
        id,
        label: stringField(reference.title) || 'Object reference',
        kind: 'object-reference',
        source,
        summary: stringField(reference.summary),
        status: stringField(reference.status),
        locator: isRecord(reference.locator) ? reference.locator : undefined,
      });
      return id;
    }
    const id = this.addRef(ref, source, {
      label: stringField(reference.title) || refLabel(ref),
      artifactType: stringField(reference.artifactType),
      summary: stringField(reference.summary),
      status: stringField(reference.status),
      locator: isRecord(reference.locator) ? reference.locator : undefined,
    });
    const existing = this.entries.get(`${source}:${ref.trim()}`);
    const kind = stringField(reference.kind);
    if (existing && !stringField(reference.artifactType) && kind) {
      existing.kind = referenceKind(kind);
    }
    return id;
  }

  values() {
    return Array.from(this.entries.values());
  }
}

function referenceKind(value: string): ResultPresentationCitation['kind'] {
  if (value === 'artifact') return 'artifact';
  if (value === 'file' || value === 'folder') return 'file';
  if (value === 'url') return 'url';
  if (value === 'execution-unit') return 'execution-unit';
  return 'object-reference';
}
