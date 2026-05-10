import {
  isScientificReproductionArtifactType,
  validateScientificReproductionArtifact,
} from '../../contracts/runtime/scientific-reproduction.js';

export type ScientificReproductionRuntimeVerdict = 'pass' | 'fail' | 'uncertain' | 'needs-human' | 'unverified';

export type ScientificClaimVerdict =
  | 'reproduced'
  | 'partially-reproduced'
  | 'not-reproduced'
  | 'contradicted'
  | 'insufficient-evidence'
  | 'not-tested';

export interface ScientificReproductionArtifact {
  id?: string;
  type?: string;
  data?: unknown;
  metadata?: Record<string, unknown>;
  evidenceRefs?: string[];
  traceRefs?: string[];
  [key: string]: unknown;
}

export interface ScientificReproductionVerifierRequest {
  goal?: string;
  resultRefs?: string[];
  artifactRefs?: string[];
  traceRefs?: string[];
  artifacts: ScientificReproductionArtifact[];
  providerHints?: {
    requireBibliographicVerification?: boolean;
    requireAccessionVerification?: boolean;
    requireFigureReproduction?: boolean;
    minConfidenceForPass?: number;
  } & Record<string, unknown>;
}

export interface ScientificReproductionCriterionResult {
  id: string;
  passed: boolean;
  severity: 'blocking' | 'warning';
  message: string;
  evidenceRefs: string[];
  repairHints: string[];
}

export interface ScientificReproductionVerifierResult {
  schemaVersion: 'sciforge.scientific-reproduction-verifier.v1';
  verifierId: string;
  verdict: ScientificReproductionRuntimeVerdict;
  confidence: number;
  reward: number;
  critique: string;
  evidenceRefs: string[];
  repairHints: string[];
  criterionResults: ScientificReproductionCriterionResult[];
  diagnostics: {
    artifactCount: number;
    claimCount: number;
    figureReproductionCount: number;
    identifierVerificationCount: number;
    scientificVerdicts: string[];
  };
}

export interface ScientificReproductionVerifierProvider {
  id: string;
  verify(request: ScientificReproductionVerifierRequest): Promise<ScientificReproductionVerifierResult>;
}

const SCIENTIFIC_VERDICTS = new Set<ScientificClaimVerdict>([
  'reproduced',
  'partially-reproduced',
  'not-reproduced',
  'contradicted',
  'insufficient-evidence',
  'not-tested',
]);

const REF_KEYS = [
  'ref',
  'refs',
  'evidenceRef',
  'evidenceRefs',
  'artifactRef',
  'artifactRefs',
  'traceRef',
  'traceRefs',
  'dataRef',
  'dataRefs',
  'codeRef',
  'codeRefs',
  'inputRef',
  'inputRefs',
  'inputDataRef',
  'inputDataRefs',
  'outputFigureRef',
  'outputFigureRefs',
  'stdoutRef',
  'stdoutRefs',
  'stderrRef',
  'stderrRefs',
  'logRef',
  'logRefs',
  'statisticsRef',
  'statisticsRefs',
  'methodRef',
  'methodRefs',
  'notebookRef',
  'notebookRefs',
  'outputRef',
  'outputRefs',
  'sourceRef',
  'sourceRefs',
  'locatorRef',
  'locatorRefs',
] as const;

export function createScientificReproductionVerifierProvider(
  id = 'verifier.scientific-reproduction.generic',
): ScientificReproductionVerifierProvider {
  return {
    id,
    async verify(request) {
      return verifyScientificReproduction(request, id);
    },
  };
}

export function verifyScientificReproduction(
  request: ScientificReproductionVerifierRequest,
  verifierId = 'verifier.scientific-reproduction.generic',
): ScientificReproductionVerifierResult {
  const artifactContexts = request.artifacts.map((artifact, index) => artifactContext(artifact, index));
  const claims = artifactContexts.flatMap(extractClaims);
  const figureReproductions = artifactContexts.flatMap(extractFigureReproductions);
  const identifierVerifications = artifactContexts.flatMap(extractIdentifierVerifications);
  const scientificVerdicts = artifactContexts.flatMap(extractScientificVerdicts);
  const negativeResults = artifactContexts.flatMap(extractNegativeResults);

  const criterionResults = [
    checkContractCompliance(artifactContexts),
    checkClaimEvidenceCoverage(claims),
    checkFigureReproductionEvidence(figureReproductions, Boolean(request.providerHints?.requireFigureReproduction)),
    checkIdentifierVerification(identifierVerifications, request),
    checkVerdictVocabulary(scientificVerdicts),
    checkRefsFirstEvidence(artifactContexts),
    checkNegativeResultSemantics(negativeResults, scientificVerdicts),
  ];

  const blockingFailures = criterionResults.filter((result) => !result.passed && result.severity === 'blocking');
  const warningFailures = criterionResults.filter((result) => !result.passed && result.severity === 'warning');
  const reward = criterionResults.filter((result) => result.passed).length / Math.max(1, criterionResults.length);
  const minConfidenceForPass = finiteNumber(request.providerHints?.minConfidenceForPass) ?? 0.72;
  const confidence = Math.max(0.2, Math.min(0.96, 0.42 + reward * 0.5 - blockingFailures.length * 0.08));
  const verdict: ScientificReproductionRuntimeVerdict = blockingFailures.length
    ? 'fail'
    : confidence < minConfidenceForPass || warningFailures.length
      ? 'uncertain'
      : 'pass';

  return {
    schemaVersion: 'sciforge.scientific-reproduction-verifier.v1',
    verifierId,
    verdict,
    confidence,
    reward,
    critique: criterionResults.map((result) => `${result.passed ? 'PASS' : result.severity.toUpperCase()}: ${result.message}`).join('\n'),
    evidenceRefs: uniqueStrings([
      ...(request.resultRefs ?? []),
      ...(request.artifactRefs ?? []),
      ...(request.traceRefs ?? []),
      ...criterionResults.flatMap((result) => result.evidenceRefs),
    ]),
    repairHints: uniqueStrings(criterionResults.flatMap((result) => result.repairHints)),
    criterionResults,
    diagnostics: {
      artifactCount: request.artifacts.length,
      claimCount: claims.length,
      figureReproductionCount: figureReproductions.length,
      identifierVerificationCount: identifierVerifications.length,
      scientificVerdicts,
    },
  };
}

type ArtifactContext = {
  artifact: ScientificReproductionArtifact;
  root: Record<string, unknown>;
  id: string;
  type: string;
  contractIssues: string[];
};

type NormalizedClaim = {
  id: string;
  artifactId: string;
  evidenceRefs: string[];
  hasInlineEvidence: boolean;
  hasMissingEvidenceReason: boolean;
};

type NormalizedFigureReproduction = {
  id: string;
  artifactId: string;
  evidenceRefs: string[];
  hasCode: boolean;
  hasInputData: boolean;
  hasParameters: boolean;
  hasStdoutOrStderr: boolean;
  hasStatistics: boolean;
};

type NormalizedIdentifierVerification = {
  id: string;
  artifactId: string;
  kind: 'bibliographic' | 'accession' | 'unknown';
  verified: boolean;
  complete: boolean;
  evidenceRefs: string[];
};

type NormalizedNegativeResult = {
  id: string;
  artifactId: string;
  evidenceRefs: string[];
  hasScientificVerdict: boolean;
  hasMotivation: boolean;
  hasData: boolean;
  hasCode: boolean;
  hasStatistics: boolean;
  hasConclusionImpact: boolean;
  looksLikeOperationalFailureOnly: boolean;
};

function checkContractCompliance(contexts: ArtifactContext[]): ScientificReproductionCriterionResult {
  const invalid = contexts.filter((context) => context.contractIssues.length > 0);
  return {
    id: 'scientific-reproduction-contract-compliance',
    passed: invalid.length === 0,
    severity: 'blocking',
    message: invalid.length === 0
      ? 'All known scientific reproduction artifacts conform to the runtime contract before verifier-specific checks.'
      : `${invalid.length} known scientific reproduction artifact(s) fail the runtime contract before verifier-specific checks.`,
    evidenceRefs: uniqueStrings(contexts.flatMap((context) => collectRefs(context.root))),
    repairHints: invalid.length
      ? [
        'Emit contract-valid scientific reproduction artifacts with schemaVersion, artifactType, sourceRefs, and type-specific required refs before verifier review.',
        ...uniqueStrings(invalid.flatMap((context) => context.contractIssues)).slice(0, 6),
      ]
      : [],
  };
}

function checkClaimEvidenceCoverage(claims: NormalizedClaim[]): ScientificReproductionCriterionResult {
  const uncovered = claims.filter((claim) => !claim.evidenceRefs.length && !claim.hasInlineEvidence && !claim.hasMissingEvidenceReason);
  const evidenceRefs = uniqueStrings(claims.flatMap((claim) => claim.evidenceRefs));
  return {
    id: 'claim-evidence-coverage',
    passed: claims.length > 0 && uncovered.length === 0,
    severity: 'blocking',
    message: claims.length === 0
      ? 'No claim records were found in claim graph, evidence matrix, or verdict artifacts.'
      : uncovered.length === 0
        ? `All ${claims.length} claims have evidence refs, inline evidence, or explicit missing-evidence reasons.`
        : `${uncovered.length} of ${claims.length} claims lack evidence and explicit missing-evidence reasons.`,
    evidenceRefs,
    repairHints: uncovered.length || claims.length === 0
      ? ['Add claim records with evidenceRefs/supportingRefs/opposingRefs, or add missingEvidence.reason for claims that cannot be checked.']
      : [],
  };
}

function checkFigureReproductionEvidence(
  figures: NormalizedFigureReproduction[],
  requireFigureReproduction: boolean,
): ScientificReproductionCriterionResult {
  const incomplete = figures.filter((figure) =>
    !figure.hasCode ||
    !figure.hasInputData ||
    !figure.hasParameters ||
    !figure.hasStdoutOrStderr ||
    !figure.hasStatistics
  );
  const passed = figures.length > 0 ? incomplete.length === 0 : !requireFigureReproduction;
  return {
    id: 'figure-reproduction-evidence',
    passed,
    severity: requireFigureReproduction ? 'blocking' : 'warning',
    message: figures.length === 0
      ? 'No figure reproduction records were found.'
      : incomplete.length === 0
        ? `All ${figures.length} figure reproduction records include code, input data, parameters, logs, and statistics.`
        : `${incomplete.length} of ${figures.length} figure reproduction records are missing code, input data, parameters, logs, or statistics.`,
    evidenceRefs: uniqueStrings(figures.flatMap((figure) => figure.evidenceRefs)),
    repairHints: incomplete.length || (figures.length === 0 && requireFigureReproduction)
      ? ['For each reproduced figure, include codeRef/code, inputDataRefs, parameters, stdoutRef/stderrRef or log refs, and statistical method/results.']
      : [],
  };
}

function checkIdentifierVerification(
  verifications: NormalizedIdentifierVerification[],
  request: ScientificReproductionVerifierRequest,
): ScientificReproductionCriterionResult {
  const requireBibliographic = request.providerHints?.requireBibliographicVerification !== false;
  const requireAccession = Boolean(request.providerHints?.requireAccessionVerification);
  const bibliographic = verifications.filter((verification) => verification.kind === 'bibliographic');
  const accessions = verifications.filter((verification) => verification.kind === 'accession');
  const unverified = verifications.filter((verification) => !verification.verified || !verification.complete || verification.evidenceRefs.length === 0);
  const missingBibliographic = requireBibliographic && bibliographic.length === 0;
  const missingAccession = requireAccession && accessions.length === 0;
  return {
    id: 'citation-accession-verification',
    passed: !missingBibliographic && !missingAccession && unverified.length === 0,
    severity: 'blocking',
    message: missingBibliographic
      ? 'No verified bibliographic identity record was found for DOI, PMID, title, year, or journal.'
      : missingAccession
        ? 'No verified dataset accession record was found.'
        : unverified.length
          ? `${unverified.length} citation or accession records are present but lack verified status, required identifier fields, or evidence refs.`
          : `Found ${verifications.length} verified citation/accession records.`,
    evidenceRefs: uniqueStrings(verifications.flatMap((verification) => verification.evidenceRefs)),
    repairHints: missingBibliographic || missingAccession || unverified.length
      ? ['Add identifier verification records with kind, verified/status, checkedAt, evidenceRefs, DOI/PMID/title/year/journal for bibliographic records, and accession/database for dataset records.']
      : [],
  };
}

function checkVerdictVocabulary(verdicts: string[]): ScientificReproductionCriterionResult {
  const invalid = verdicts.filter((verdict) => !SCIENTIFIC_VERDICTS.has(verdict as ScientificClaimVerdict));
  return {
    id: 'scientific-verdict-vocabulary',
    passed: verdicts.length > 0 && invalid.length === 0,
    severity: 'blocking',
    message: verdicts.length === 0
      ? 'No scientific reproduction verdicts were found.'
      : invalid.length === 0
        ? 'Scientific verdicts use the required reproduction vocabulary.'
        : `Invalid scientific verdicts found: ${uniqueStrings(invalid).join(', ')}.`,
    evidenceRefs: [],
    repairHints: invalid.length || verdicts.length === 0
      ? ['Use exactly reproduced, partially-reproduced, not-reproduced, contradicted, insufficient-evidence, or not-tested for claim/figure/report scientific verdicts.']
      : [],
  };
}

function checkRefsFirstEvidence(contexts: ArtifactContext[]): ScientificReproductionCriterionResult {
  const refCount = uniqueStrings(contexts.flatMap((context) => collectRefs(context.root))).length;
  const inlineOnlyEvidence = contexts.flatMap((context) => findInlineEvidenceWithoutRefs(context.root, context.id));
  return {
    id: 'refs-first-evidence',
    passed: refCount > 0 && inlineOnlyEvidence.length === 0,
    severity: 'blocking',
    message: refCount === 0
      ? 'No evidence refs were found; verifier requires refs-first evidence rather than report prose only.'
      : inlineOnlyEvidence.length === 0
        ? `Refs-first evidence is present with ${refCount} unique refs and no bulky inline-only evidence blocks.`
        : `${inlineOnlyEvidence.length} evidence blocks contain bulky inline content without artifact/data/trace refs.`,
    evidenceRefs: uniqueStrings(contexts.flatMap((context) => collectRefs(context.root))),
    repairHints: refCount === 0 || inlineOnlyEvidence.length
      ? ['Store large evidence, source text, tables, code, logs, figures, and datasets as workspace/object refs; keep inline payloads bounded summaries with locators.']
      : [],
  };
}

function checkNegativeResultSemantics(
  negativeResults: NormalizedNegativeResult[],
  scientificVerdicts: string[],
): ScientificReproductionCriterionResult {
  const needsNegativeSemantics = scientificVerdicts.some((verdict) => verdict === 'not-reproduced' || verdict === 'contradicted');
  const incomplete = negativeResults.filter((result) =>
    !result.hasScientificVerdict ||
    !result.hasMotivation ||
    !result.hasData ||
    !result.hasCode ||
    !result.hasStatistics ||
    !result.hasConclusionImpact ||
    result.looksLikeOperationalFailureOnly
  );
  return {
    id: 'negative-result-semantics',
    passed: !needsNegativeSemantics || (negativeResults.length > 0 && incomplete.length === 0),
    severity: 'blocking',
    message: !needsNegativeSemantics
      ? 'No not-reproduced or contradicted verdict requires negative-result semantics.'
      : negativeResults.length === 0
        ? 'A negative scientific verdict is present, but no negative-result report was found.'
        : incomplete.length === 0
          ? 'Negative result reports distinguish scientific conclusions from operational failures and include motivation, data, code, statistics, and conclusion impact.'
          : `${incomplete.length} negative result reports lack required scientific negative-result fields or look like operational failures only.`,
    evidenceRefs: uniqueStrings(negativeResults.flatMap((result) => result.evidenceRefs)),
    repairHints: needsNegativeSemantics && (negativeResults.length === 0 || incomplete.length)
      ? ['For not-reproduced/contradicted outcomes, add a negative-result-report with check motivation, data refs, code refs, statistical evidence, conclusion impact, and product/tool failure separation.']
      : [],
  };
}

function artifactContext(artifact: ScientificReproductionArtifact, index: number): ArtifactContext {
  const data = isRecord(artifact.data) ? artifact.data : {};
  const root = { ...artifact, ...data };
  const type = normalizeType(artifact.type || root.artifactType);
  const contractValidation = isScientificReproductionArtifactType(type)
    ? validateScientificReproductionArtifact(root)
    : { issues: [] };
  return {
    artifact,
    root,
    id: stringValue(artifact.id) || `artifact-${index + 1}`,
    type,
    contractIssues: contractValidation.issues.map((issue) => `${issue.path}: ${issue.message}`),
  };
}

function extractClaims(context: ArtifactContext): NormalizedClaim[] {
  const candidates = [
    ...arrayRecords(context.root.claims),
    ...arrayRecords(context.root.rows),
    ...arrayRecords(context.root.claimVerdicts),
    ...arrayRecords(context.root.verdicts),
  ];
  if (['claim-verdict', 'evidence-matrix'].includes(context.type) && candidates.length === 0) candidates.push(context.root);
  if (isRecord(context.root.claim)) candidates.push(context.root.claim);
  return candidates
    .filter((record) => stringValue(record.claimId) || stringValue(record.id) || stringValue(record.text) || stringValue(record.claim))
    .map((record, index) => ({
      id: stringValue(record.claimId) || stringValue(record.id) || `${context.id}:claim-${index + 1}`,
      artifactId: context.id,
      evidenceRefs: collectRefs(record),
      hasInlineEvidence: hasAnyKey(record, ['evidence', 'supportingEvidence', 'opposingEvidence', 'rationale']),
      hasMissingEvidenceReason: hasMissingEvidenceReason(record),
    }));
}

function extractFigureReproductions(context: ArtifactContext): NormalizedFigureReproduction[] {
  const candidatePools = [
    ...arrayRecords(context.root.figureReproductions),
    ...arrayRecords(context.root.reproductions),
    ...arrayRecords(context.root.reproductionReports),
  ];
  const candidates = context.type === 'figure-reproduction-report'
    ? [...(isFigureReproductionRecord(context.root) ? [context.root] : []), ...arrayRecords(context.root.figures), ...candidatePools]
    : candidatePools.filter(isFigureReproductionRecord);
  return candidates.map((record, index) => ({
    id: stringValue(record.figureId) || stringValue(record.id) || `${context.id}:figure-${index + 1}`,
    artifactId: context.id,
    evidenceRefs: collectRefs(record),
    hasCode: hasAnyKey(record, ['code', 'codeRef', 'codeRefs', 'script', 'scriptRef', 'notebookRef', 'analysisNotebookRef']),
    hasInputData: hasAnyKey(record, ['inputRefs', 'inputData', 'inputDataRef', 'inputDataRefs', 'dataRef', 'dataRefs', 'datasetRef', 'datasetRefs']),
    hasParameters: hasAnyKey(record, ['parameters', 'params', 'parameterRef', 'parameterRefs', 'thresholds', 'settings']),
    hasStdoutOrStderr: hasAnyKey(record, ['stdout', 'stderr', 'stdoutRef', 'stdoutRefs', 'stderrRef', 'stderrRefs', 'logRef', 'logRefs', 'executionLogRef']),
    hasStatistics: hasAnyKey(record, ['statistics', 'statisticsRef', 'statisticsRefs', 'statisticalMethod', 'statisticalMethods', 'pValue', 'effectSize', 'testName', 'method']),
  }));
}

function extractIdentifierVerifications(context: ArtifactContext): NormalizedIdentifierVerification[] {
  const candidates = [
    ...arrayRecords(context.root.identifierVerifications),
    ...arrayRecords(context.root.citationVerifications),
    ...arrayRecords(context.root.accessionVerifications),
    ...arrayRecords(context.root.references),
    ...arrayRecords(context.root.citations),
    ...arrayRecords(context.root.accessions),
    ...arrayRecords(context.root.datasets).filter(isDatasetIdentifierVerificationRecord),
  ];
  if (hasAnyKey(context.root, ['doi', 'pmid', 'title', 'year', 'journal', 'accession'])) candidates.push(context.root);
  return candidates
    .filter((record) => hasAnyKey(record, ['doi', 'pmid', 'title', 'year', 'journal', 'accession', 'accessionId', 'identifier']))
    .map((record, index) => ({
      id: stringValue(record.id) || stringValue(record.identifier) || stringValue(record.accession) || `${context.id}:identifier-${index + 1}`,
      artifactId: context.id,
      kind: identifierKind(record),
      verified: isVerified(record),
      complete: hasCompleteIdentifierVerification(record),
      evidenceRefs: collectRefs(record),
    }));
}

function extractScientificVerdicts(context: ArtifactContext): string[] {
  const verdictKeys = context.type === 'negative-result-report'
    ? ['verdict', 'claimVerdict', 'figureVerdict', 'reproductionVerdict', 'result']
    : ['verdict', 'claimVerdict', 'figureVerdict', 'reproductionVerdict'];
  const values = findValuesByKey(context.root, (key) => verdictKeys.includes(key))
    .map((value) => stringValue(value).toLowerCase())
    .filter(Boolean);
  return values.filter((value) =>
    SCIENTIFIC_VERDICTS.has(value as ScientificClaimVerdict) ||
    ['partial', 'partially reproduced', 'supported', 'failed', 'success', 'inconclusive'].includes(value)
  );
}

function extractNegativeResults(context: ArtifactContext): NormalizedNegativeResult[] {
  const candidates = [
    ...arrayRecords(context.root.negativeResults),
    ...arrayRecords(context.root.negativeResultReports),
  ];
  if (context.type === 'negative-result-report') candidates.push(context.root);
  return candidates.map((record, index) => {
    const text = JSON.stringify(record).toLowerCase();
    const checks = arrayRecords(record.checks);
    const checkVerdicts = checks.map((check) => stringValue(check.result).toLowerCase()).filter(Boolean);
    const checkRefs = checks.flatMap((check) => collectRefs(check));
    return {
      id: stringValue(record.id) || `${context.id}:negative-${index + 1}`,
      artifactId: context.id,
      evidenceRefs: collectRefs(record),
      hasScientificVerdict: ['not-reproduced', 'contradicted'].includes(stringValue(record.verdict).toLowerCase()) ||
        checkVerdicts.some((verdict) => verdict === 'not-reproduced' || verdict === 'contradicted'),
      hasMotivation: hasAnyKey(record, ['motivation', 'checkMotivation', 'hypothesis', 'rationale']),
      hasData: hasAnyKey(record, ['data', 'dataRef', 'dataRefs', 'inputRefs', 'inputDataRefs', 'datasetRefs']) ||
        checks.some((check) => hasAnyKey(check, ['inputRefs', 'dataRefs', 'outputRefs'])),
      hasCode: hasAnyKey(record, ['code', 'codeRef', 'codeRefs', 'notebookRef', 'executionRef']) ||
        checks.some((check) => hasAnyKey(check, ['codeRef', 'codeRefs', 'notebookRef', 'executionRef'])),
      hasStatistics: hasAnyKey(record, ['statistics', 'statisticsRef', 'statisticsRefs', 'statisticalMethod', 'statisticalResults', 'pValue', 'effectSize']) ||
        checks.some((check) => hasAnyKey(check, ['statisticsRef', 'statisticsRefs', 'statisticalMethod', 'statisticalResults', 'pValue', 'effectSize'])),
      hasConclusionImpact: hasAnyKey(record, ['conclusionImpact', 'claimImpact', 'interpretation', 'impact']),
      looksLikeOperationalFailureOnly: /timeout|exception|stack trace|permission denied|tool failed/.test(text) &&
        !/claim|scientific|statistic|effect|evidence|conclusion/.test(text) && checkRefs.length === 0,
    };
  });
}

function normalizeType(value: unknown) {
  return stringValue(value).toLowerCase();
}

function identifierKind(record: Record<string, unknown>): NormalizedIdentifierVerification['kind'] {
  const kind = stringValue(record.kind || record.type || record.identifierKind).toLowerCase();
  if (kind.includes('accession') || hasAnyKey(record, ['accession', 'accessionId'])) return 'accession';
  if (kind.includes('citation') || kind.includes('bibliographic') || hasAnyKey(record, ['doi', 'pmid', 'title', 'year', 'journal'])) return 'bibliographic';
  return 'unknown';
}

function isFigureReproductionRecord(record: Record<string, unknown>) {
  return hasAnyKey(record, [
    'figureId',
    'code',
    'codeRef',
    'codeRefs',
    'inputRefs',
    'inputDataRef',
    'inputDataRefs',
    'outputFigureRef',
    'outputFigureRefs',
    'stdoutRef',
    'stdoutRefs',
    'stderrRef',
    'stderrRefs',
    'statistics',
    'statisticsRefs',
    'statisticalMethod',
  ]);
}

function isDatasetIdentifierVerificationRecord(record: Record<string, unknown>) {
  return hasAnyKey(record, ['accession', 'accessionId', 'identifier', 'identifierVerifications', 'verified', 'isVerified', 'verificationStatus', 'checkStatus']);
}

function isVerified(record: Record<string, unknown>) {
  const verified = record.verified ?? record.isVerified;
  if (typeof verified === 'boolean') return verified;
  const status = stringValue(record.status || record.verificationStatus || record.checkStatus).toLowerCase();
  return ['verified', 'matched', 'confirmed', 'pass', 'ok'].includes(status);
}

function hasCompleteIdentifierVerification(record: Record<string, unknown>) {
  const kind = identifierKind(record);
  if (collectRefs(record).length === 0) return false;
  if (kind === 'bibliographic') {
    return (hasAnyKey(record, ['doi', 'pmid']))
      && hasAnyKey(record, ['title'])
      && hasAnyKey(record, ['year'])
      && hasAnyKey(record, ['journal']);
  }
  if (kind === 'accession') {
    return hasAnyKey(record, ['accession', 'accessionId', 'identifier']) && hasAnyKey(record, ['database', 'source', 'repository']);
  }
  return false;
}

function hasMissingEvidenceReason(record: Record<string, unknown>) {
  const missingEvidence = record.missingEvidence;
  if (typeof missingEvidence === 'string') return missingEvidence.trim().length > 0;
  if (isRecord(missingEvidence)) return Boolean(stringValue(missingEvidence.reason) || stringValue(missingEvidence.status));
  return hasAnyKey(record, ['missingEvidenceReason', 'unavailableReason', 'notCheckedReason']);
}

function hasAnyKey(record: Record<string, unknown>, keys: string[]) {
  return keys.some((key) => hasMeaningfulValue(record[key]));
}

function hasMeaningfulValue(value: unknown): boolean {
  if (Array.isArray(value)) return value.length > 0;
  if (isRecord(value)) return Object.keys(value).length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== undefined && value !== null;
}

function collectRefs(value: unknown): string[] {
  const refs: string[] = [];
  walk(value, (node, key) => {
    if (!key || !REF_KEYS.includes(key as typeof REF_KEYS[number])) return;
    if (typeof node === 'string') refs.push(node);
    if (isRecord(node) && typeof node.ref === 'string') refs.push(node.ref);
    if (Array.isArray(node)) {
      refs.push(...node.flatMap((entry) => {
        if (typeof entry === 'string') return [entry];
        if (isRecord(entry) && typeof entry.ref === 'string') return [entry.ref];
        return [];
      }));
    }
  });
  return uniqueStrings(refs);
}

function findInlineEvidenceWithoutRefs(value: unknown, artifactId: string): string[] {
  const findings: string[] = [];
  walk(value, (node, key, path) => {
    if (!key || !/evidence|sourceText|fullText|table|figure|rawData|pdfText|sourceExcerpt/i.test(key)) return;
    if (isRecord(node)) {
      if (collectRefs(node).length > 0 && JSON.stringify(node).length <= 2400) return;
      const textLength = JSON.stringify(node).length;
      if (textLength > 800) findings.push(`${artifactId}:${path.join('.')}`);
      return;
    }
    if (typeof node === 'string' && node.length > 800) findings.push(`${artifactId}:${path.join('.')}`);
  });
  return findings;
}

function findValuesByKey(value: unknown, predicate: (key: string) => boolean): unknown[] {
  const values: unknown[] = [];
  walk(value, (node, key) => {
    if (key && predicate(key)) values.push(node);
  });
  return values;
}

function walk(value: unknown, visit: (node: unknown, key: string | undefined, path: string[]) => void, key?: string, path: string[] = []) {
  visit(value, key, path);
  if (Array.isArray(value)) {
    value.forEach((entry, index) => walk(entry, visit, String(index), [...path, String(index)]));
    return;
  }
  if (!isRecord(value)) return;
  for (const [childKey, childValue] of Object.entries(value)) {
    walk(childValue, visit, childKey, [...path, childKey]);
  }
}

function arrayRecords(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function uniqueStrings(values: string[]): string[] {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
