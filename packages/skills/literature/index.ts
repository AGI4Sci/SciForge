import type { CapabilityInvocationBudgetDebitRecord } from '@sciforge-ui/runtime-contract/capability-budget';
import {
  NO_HARDCODE_REVIEW_SCHEMA_VERSION,
  SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION,
  validateScientificReproductionArtifact,
  type AnalysisPlan,
  type NoHardcodeReview,
  type RuntimeArtifactDerivation,
  type ScientificEvidenceRef,
  type ScientificReproductionArtifactType,
  type ScientificReproductionValidationResult,
  type ScientificRiskNote,
} from '@sciforge-ui/runtime-contract';
import {
  arrayStrings,
  citationVerificationForPaper,
  createLiteratureRetrievalBudgetDebitRecord,
  finalStatus,
  normalizeDifferenceValue,
  normalizeProviderId,
  normalizeRequestedProviders,
  paperKey,
  providerAttempt,
  resolveReportFullTextPolicy,
  slug,
  unique,
} from './retrieval-normalization';

export type LiteratureRetrievalStatus = 'success' | 'partial' | 'failed';
export type LiteratureProviderAttemptStatus = 'success' | 'empty' | 'timeout' | 'error' | 'skipped';
export type CitationVerificationStatus = 'verified' | 'mismatch' | 'missing-identifiers' | 'unverified';
export type LiteratureSourceTrustLevel = 'high' | 'medium' | 'low';

export interface LiteratureRetrievalArtifactRefs {
  paperList: string;
  evidenceMatrix: string;
  researchReport: string;
}

export interface LiteratureDerivedArtifactRefs {
  citationCorrection: string;
  bilingualReport: string;
  bilingualExecutiveSummary: string;
  bilingualGlossary: string;
  reproductionFeasibility: string;
}

export interface LiteratureRetrievalRequest {
  query: string;
  databases?: string[];
  dateRange?: {
    from?: string;
    to?: string;
  };
  maxResults?: number;
  includeAbstracts?: boolean;
  fullTextPolicy?: 'metadata-only' | 'abstracts' | 'bounded-full-text';
  dedupePolicy?: 'doi-pmid-arxiv-title-year' | 'provider-native' | 'none';
  excludedProviderIds?: string[];
  artifactRefs?: Partial<LiteratureRetrievalArtifactRefs>;
}

export interface LiteratureRetrievalBudget {
  maxProviders: number;
  maxResults: number;
  perProviderTimeoutMs: number;
  maxFullTextDownloads: number;
  maxDownloadBytes: number;
}

export interface OfflineLiteraturePaperRecord {
  providerRecordId?: string;
  title: string;
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  arxivId?: string;
  authors?: string[];
  abstract?: string;
  url?: string;
  fullTextRef?: string;
  citationMatches?: boolean;
  downloadFailed?: boolean;
}

export interface OfflineLiteratureProviderFixture {
  providerId: string;
  records: OfflineLiteraturePaperRecord[];
  status?: Exclude<LiteratureProviderAttemptStatus, 'skipped'>;
  elapsedMs?: number;
  errorCode?: string;
  errorMessage?: string;
  trustLevel?: LiteratureSourceTrustLevel;
  exclusionReason?: string;
}

export interface NormalizedLiteraturePaper {
  id: string;
  title: string;
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  arxivId?: string;
  authors: string[];
  abstract?: string;
  sourceProviderIds: string[];
  providerRecordRefs: string[];
  url?: string;
  fullTextRef?: string;
}

export interface LiteratureEvidenceMatrixRow {
  paperId: string;
  claim: string;
  evidenceRefs: string[];
  citationStatus: CitationVerificationStatus;
}

export interface LiteratureResearchReportArtifact {
  artifactType: 'research-report';
  ref: string;
  title: string;
  boundedSummary: string;
  fullTextPolicy: 'metadata-only' | 'abstracts' | 'bounded-summary';
  sourceRefs: string[];
  diagnostics: LiteratureRetrievalDiagnostic[];
}

export interface LiteratureSourceProvenanceValue {
  providerId: string;
  value: string;
}

export interface LiteratureSourceDifference {
  field: 'title' | 'year' | 'journal' | 'doi' | 'pmid' | 'arxivId';
  values: LiteratureSourceProvenanceValue[];
}

export interface LiteratureSourceProvenanceProviderRecord {
  providerId: string;
  providerRecordRef: string;
  trustLevel: LiteratureSourceTrustLevel;
  included: boolean;
  exclusionReason?: string;
}

export interface LiteratureSourceProvenanceRecord {
  paperId: string;
  includedProviderIds: string[];
  excludedProviderIds: string[];
  providerRecordRefs: string[];
  sourceRecords: LiteratureSourceProvenanceProviderRecord[];
  differences: LiteratureSourceDifference[];
}

export interface LiteratureWorkEvidence {
  id?: string;
  kind: 'literature-retrieval';
  capabilityId: 'literature.retrieval';
  query: string;
  artifactRefs: string[];
  providerAttemptRefs: string[];
  budget: LiteratureRetrievalBudget;
  diagnosticCodes: string[];
  budgetDebitRefs?: string[];
}

export interface LiteratureProviderAttempt {
  id: string;
  providerId: string;
  status: LiteratureProviderAttemptStatus;
  query: string;
  resultCount: number;
  normalizedCount: number;
  elapsedMs: number;
  errorCode?: string;
  errorMessage?: string;
  diagnosticCodes: string[];
  budgetDebitRefs?: string[];
}

export interface CitationVerificationResult {
  paperId: string;
  providerIds: string[];
  providerRecordRefs: string[];
  evidenceRefs: string[];
  verificationContract: 'sciforge.bibliographic-record.v1';
  checkedFields: Array<'doi' | 'pmid' | 'arxivId' | 'title' | 'year' | 'journal'>;
  status: CitationVerificationStatus;
  mismatchFields: string[];
  missingIdentifierFields: Array<'doi' | 'pmid' | 'arxivId'>;
}

export interface LiteratureRetrievalDiagnostic {
  code:
    | 'empty-results'
    | 'provider-timeout'
    | 'provider-error'
    | 'provider-budget-exceeded'
    | 'result-budget-exceeded'
    | 'download-failure'
    | 'citation-mismatch'
    | 'source-excluded';
  message: string;
  providerId?: string;
  paperId?: string;
}

export interface OfflineLiteratureRetrievalOutput {
  status: LiteratureRetrievalStatus;
  artifactRefs: LiteratureRetrievalArtifactRefs;
  paperList: NormalizedLiteraturePaper[];
  evidenceMatrix: LiteratureEvidenceMatrixRow[];
  researchReport: LiteratureResearchReportArtifact;
  sourceProvenance: LiteratureSourceProvenanceRecord[];
  workEvidence: LiteratureWorkEvidence[];
  providerAttempts: LiteratureProviderAttempt[];
  citationVerificationResults: CitationVerificationResult[];
  diagnostics: LiteratureRetrievalDiagnostic[];
  budgetDebits?: CapabilityInvocationBudgetDebitRecord[];
}

export type LiteratureCitationCorrectionStatus = 'corrected' | 'needs-review' | 'not-found' | 'ambiguous';
export type LiteratureCitationCorrectionAction = 'exclude-provider-record' | 'mark-citation-untrusted';

export interface LiteratureCitationCorrectionInput {
  output: OfflineLiteratureRetrievalOutput;
  target: {
    paperId?: string;
    providerRecordRef?: string;
    evidenceRef?: string;
  };
  reason: string;
  action?: LiteratureCitationCorrectionAction;
  artifactRefs?: Partial<Pick<LiteratureDerivedArtifactRefs, 'citationCorrection'>>;
}

export interface LiteratureCitationCorrectionArtifact {
  artifactType: 'citation-correction';
  ref: string;
  targetArtifactRef?: string;
  targetPaperId?: string;
  targetProviderRecordRefs: string[];
  sourceRefs: string[];
  verificationStatus?: CitationVerificationStatus;
  correctionStatus: LiteratureCitationCorrectionStatus;
  correctedSegment?: {
    paperId: string;
    claim: string;
    retainedEvidenceRefs: string[];
    removedEvidenceRefs: string[];
    correctionReason: string;
  };
  correctionReport: string;
  affectedEvidenceRows: LiteratureEvidenceMatrixRow[];
  untouchedPaperIds: string[];
  diagnostics: LiteratureRetrievalDiagnostic[];
}

export type LiteratureBilingualReportStatus = 'ready' | 'needs-review';
export type LiteratureGlossaryEntryConfidence = 'provided' | 'derived' | 'needs-review';

export interface LiteratureBilingualGlossaryTermInput {
  sourceTerm: string;
  targetTerm: string;
  sourceRefs?: string[];
  paperIds?: string[];
  note?: string;
  confidence?: LiteratureGlossaryEntryConfidence;
}

export interface LiteratureBilingualReportInput {
  output: OfflineLiteratureRetrievalOutput;
  sourceLanguage?: string;
  targetLanguage?: string;
  executiveSummary?: string | {
    text: string;
    sourceRefs?: string[];
  };
  glossaryTerms?: LiteratureBilingualGlossaryTermInput[];
  artifactRefs?: Partial<Pick<LiteratureDerivedArtifactRefs, 'bilingualReport' | 'bilingualExecutiveSummary' | 'bilingualGlossary'>>;
}

export interface LiteratureBilingualGlossaryEntry {
  sourceTerm: string;
  targetTerm: string;
  sourceRefs: string[];
  paperIds: string[];
  confidence: LiteratureGlossaryEntryConfidence;
  note?: string;
}

export interface LiteratureDerivedArtifactMetadata {
  language?: string;
  role?: string;
  derivation: RuntimeArtifactDerivation;
}

export interface LiteratureBilingualReportArtifact {
  artifactType: 'bilingual-literature-report';
  ref: string;
  parentArtifactRef: string;
  metadata: LiteratureDerivedArtifactMetadata;
  derivedArtifactRefs: string[];
  sourceArtifactRefs: string[];
  sourceLanguage: string;
  targetLanguage: string;
  status: LiteratureBilingualReportStatus;
  sourceReport: {
    ref: string;
    title: string;
    boundedSummary: string;
    sourceRefs: string[];
  };
  englishExecutiveSummary: {
    artifactType: 'bilingual-executive-summary';
    ref: string;
    parentArtifactRef: string;
    metadata: LiteratureDerivedArtifactMetadata;
    text: string;
    sourceRefs: string[];
  };
  glossary: {
    artifactType: 'bilingual-glossary';
    ref: string;
    parentArtifactRef: string;
    metadata: LiteratureDerivedArtifactMetadata;
    entries: LiteratureBilingualGlossaryEntry[];
    sourceRefs: string[];
  };
  paperIds: string[];
  sourceRefs: string[];
  lineage: string[];
  diagnostics: LiteratureRetrievalDiagnostic[];
}

export type LiteratureReproductionAvailability = 'available' | 'partial' | 'unavailable' | 'unknown';
export type LiteratureReproductionComputeCost = 'low' | 'medium' | 'high' | 'unknown';
export type LiteratureReproductionRiskLevel = 'low' | 'medium' | 'high' | 'unknown';
export type LiteratureReproductionRecommendation = 'ready' | 'promising' | 'needs-data-or-code' | 'high-risk';
export type LiteratureReproductionFeasibilityStatus = 'ready' | 'needs-review' | 'blocked';

export interface LiteratureReproductionEvidenceInput {
  paperId: string;
  codeAvailability?: LiteratureReproductionAvailability;
  datasetAvailability?: LiteratureReproductionAvailability;
  computeCost?: LiteratureReproductionComputeCost;
  reproductionRisk?: LiteratureReproductionRiskLevel;
  codeRefs?: string[];
  datasetRefs?: string[];
  computeRefs?: string[];
  riskRefs?: string[];
  notes?: string[];
}

export interface LiteratureReproductionFeasibilityInput {
  output: OfflineLiteratureRetrievalOutput;
  paperEvidence?: LiteratureReproductionEvidenceInput[];
  objective?: string;
  maxPlanSteps?: number;
  artifactRefs?: Partial<Pick<LiteratureDerivedArtifactRefs, 'reproductionFeasibility'>>;
}

export interface LiteratureReproductionFeasibilityRankedPaper {
  rank: number;
  paperId: string;
  title: string;
  score: number;
  recommendation: LiteratureReproductionRecommendation;
  codeAvailability: LiteratureReproductionAvailability;
  datasetAvailability: LiteratureReproductionAvailability;
  computeCost: LiteratureReproductionComputeCost;
  reproductionRisk: LiteratureReproductionRiskLevel;
  sourceRefs: string[];
  evidenceRefs: string[];
  codeRefs: string[];
  datasetRefs: string[];
  computeRefs: string[];
  riskRefs: string[];
  missingEvidence: string[];
  riskNotes: ScientificRiskNote[];
  planStepIds: string[];
}

export interface LiteratureReproductionFeasibilityArtifact {
  artifactType: 'literature-reproduction-feasibility';
  ref: string;
  parentArtifactRef: string;
  metadata: LiteratureDerivedArtifactMetadata;
  sourceArtifactRefs: string[];
  status: LiteratureReproductionFeasibilityStatus;
  paperIds: string[];
  rankedPapers: LiteratureReproductionFeasibilityRankedPaper[];
  analysisPlan: AnalysisPlan;
  sourceRefs: string[];
  ignoredEvidencePaperIds: string[];
  noHardcodeReview: NoHardcodeReview;
  diagnostics: LiteratureRetrievalDiagnostic[];
}

export interface OfflineLiteratureRetrievalRunnerInput {
  request: LiteratureRetrievalRequest;
  providerFixtures: OfflineLiteratureProviderFixture[];
  budget?: Partial<LiteratureRetrievalBudget>;
}

const DEFAULT_LITERATURE_RETRIEVAL_BUDGET: LiteratureRetrievalBudget = {
  maxProviders: 3,
  maxResults: 30,
  perProviderTimeoutMs: 10000,
  maxFullTextDownloads: 3,
  maxDownloadBytes: 25000000,
};

const DEFAULT_LITERATURE_RETRIEVAL_ARTIFACT_REFS: LiteratureRetrievalArtifactRefs = {
  paperList: 'artifact:paper-list',
  evidenceMatrix: 'artifact:evidence-matrix',
  researchReport: 'artifact:research-report',
};

interface LiteratureSourceRecordForProvenance extends LiteratureSourceProvenanceProviderRecord {
  title: string;
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  arxivId?: string;
}

export function literatureRetrievalArtifactRefs(overrides?: Partial<LiteratureRetrievalArtifactRefs>): LiteratureRetrievalArtifactRefs {
  return {
    ...DEFAULT_LITERATURE_RETRIEVAL_ARTIFACT_REFS,
    ...definedStringFields(overrides),
  };
}

function literatureSourceArtifactRefs(refs: LiteratureRetrievalArtifactRefs): string[] {
  return unique([
    refs.paperList,
    refs.evidenceMatrix,
    refs.researchReport,
  ]);
}

function literatureDerivedArtifactRefs(
  parentArtifactRef: string,
  overrides?: Partial<LiteratureDerivedArtifactRefs>,
): LiteratureDerivedArtifactRefs {
  return {
    citationCorrection: overrides?.citationCorrection ?? derivedLiteratureArtifactRef(parentArtifactRef, 'citation-correction'),
    bilingualReport: overrides?.bilingualReport ?? derivedLiteratureArtifactRef(parentArtifactRef, 'bilingual-literature-report'),
    bilingualExecutiveSummary: overrides?.bilingualExecutiveSummary ?? derivedLiteratureArtifactRef(parentArtifactRef, 'bilingual-executive-summary'),
    bilingualGlossary: overrides?.bilingualGlossary ?? derivedLiteratureArtifactRef(parentArtifactRef, 'bilingual-glossary'),
    reproductionFeasibility: overrides?.reproductionFeasibility ?? derivedLiteratureArtifactRef(parentArtifactRef, 'literature-reproduction-feasibility'),
  };
}

function derivedLiteratureArtifactRef(parentArtifactRef: string, artifactType: string): string {
  return `${parentArtifactRef}#derived:${slug(artifactType)}`;
}

function definedStringFields<T extends Record<string, unknown>>(record: T | undefined): Partial<T> {
  if (!record) return {};
  return Object.fromEntries(Object.entries(record).filter(([, value]) => typeof value === 'string' && value.trim())) as Partial<T>;
}

export function runOfflineLiteratureRetrieval(input: OfflineLiteratureRetrievalRunnerInput): OfflineLiteratureRetrievalOutput {
  const budget = { ...DEFAULT_LITERATURE_RETRIEVAL_BUDGET, ...input.budget };
  const artifactRefs = literatureRetrievalArtifactRefs(input.request.artifactRefs);
  const requestMaxResults = input.request.maxResults ?? budget.maxResults;
  const maxResults = Math.min(requestMaxResults, budget.maxResults);
  const requestedProviders = normalizeRequestedProviders(input.request.databases);
  const selectedProviderIds = requestedProviders.slice(0, budget.maxProviders);
  const excludedProviderIds = new Set((input.request.excludedProviderIds ?? []).map(normalizeProviderId));
  const diagnostics: LiteratureRetrievalDiagnostic[] = [];
  if (requestedProviders.length > selectedProviderIds.length) {
    diagnostics.push({
      code: 'provider-budget-exceeded',
      message: `Requested ${requestedProviders.length} providers; selected first ${budget.maxProviders} for offline normalization.`,
    });
  }

  const fixtureByProvider = new Map(input.providerFixtures.map((fixture) => [normalizeProviderId(fixture.providerId), fixture]));
  const providerAttempts: LiteratureProviderAttempt[] = [];
  const normalizedPapers = new Map<string, NormalizedLiteraturePaper>();
  const sourceRecordsByPaper = new Map<string, LiteratureSourceRecordForProvenance[]>();
  const recordCitationMatches = new Map<string, boolean>();
  const downloadFailurePaperIds = new Set<string>();

  selectedProviderIds.forEach((providerId, index) => {
    const fixture = fixtureByProvider.get(providerId);
    if (!fixture) {
      providerAttempts.push(providerAttempt(providerId, 'skipped', input.request.query, [], index, ['provider-error'], {
        errorCode: 'fixture-missing',
        errorMessage: 'No offline fixture was supplied for this provider.',
      }));
      diagnostics.push({
        code: 'provider-error',
        providerId,
        message: 'No offline fixture was supplied for this provider.',
      });
      return;
    }

    const status = fixture.status ?? (fixture.records.length > 0 ? 'success' : 'empty');
    const elapsedMs = fixture.elapsedMs ?? 25;
    const attemptDiagnostics: string[] = [];
    if (status === 'timeout' || elapsedMs > budget.perProviderTimeoutMs) {
      attemptDiagnostics.push('provider-timeout');
      providerAttempts.push(providerAttempt(providerId, 'timeout', input.request.query, fixture.records, index, attemptDiagnostics, { elapsedMs }));
      diagnostics.push({
        code: 'provider-timeout',
        providerId,
        message: `Provider exceeded perProviderTimeoutMs=${budget.perProviderTimeoutMs}; returning auditable partial payload.`,
      });
      return;
    }
    if (status === 'error') {
      attemptDiagnostics.push('provider-error');
      providerAttempts.push(providerAttempt(providerId, 'error', input.request.query, fixture.records, index, attemptDiagnostics, {
        elapsedMs,
        errorCode: fixture.errorCode ?? 'provider-error',
        errorMessage: fixture.errorMessage ?? 'Offline provider fixture failed.',
      }));
      diagnostics.push({
        code: 'provider-error',
        providerId,
        message: fixture.errorMessage ?? 'Offline provider fixture failed.',
      });
      return;
    }
    if (fixture.records.length === 0) {
      attemptDiagnostics.push('empty-results');
      providerAttempts.push(providerAttempt(providerId, 'empty', input.request.query, fixture.records, index, attemptDiagnostics, { elapsedMs }));
      diagnostics.push({
        code: 'empty-results',
        providerId,
        message: 'Provider returned no records; output must be failed or partial, not successful.',
      });
      return;
    }

    let acceptedCount = 0;
    const sourceTrustLevel = fixture.trustLevel ?? 'medium';
    for (const record of fixture.records) {
      const paperId = paperKey(record, input.request.dedupePolicy ?? 'doi-pmid-arxiv-title-year', providerId);
      const providerRecordRef = `provider:${providerId}:${record.providerRecordId ?? slug(record.title)}`;
      const excluded = excludedProviderIds.has(providerId);
      const sourceRecord: LiteratureSourceRecordForProvenance = {
        providerId: `literature.retrieval.${providerId}`,
        providerRecordRef,
        trustLevel: sourceTrustLevel,
        included: !excluded,
        exclusionReason: excluded ? fixture.exclusionReason ?? 'Excluded by request before rewriting the report.' : undefined,
        title: record.title,
        year: record.year,
        journal: record.journal,
        doi: record.doi,
        pmid: record.pmid,
        arxivId: record.arxivId,
      };
      const sourceRecords = sourceRecordsByPaper.get(paperId) ?? [];
      sourceRecords.push(sourceRecord);
      sourceRecordsByPaper.set(paperId, sourceRecords);
      if (excluded) {
        if (!attemptDiagnostics.includes('source-excluded')) attemptDiagnostics.push('source-excluded');
        diagnostics.push({
          code: 'source-excluded',
          providerId: `literature.retrieval.${providerId}`,
          paperId,
          message: `${sourceRecord.providerId} was excluded by request; retained for provenance but omitted from paper-list, evidence matrix, and rewritten report.`,
        });
        continue;
      }
      const existing = normalizedPapers.get(paperId);
      if (existing) {
        existing.sourceProviderIds = unique([...existing.sourceProviderIds, providerId]);
        existing.providerRecordRefs = unique([...existing.providerRecordRefs, providerRecordRef]);
      } else {
        normalizedPapers.set(paperId, {
          id: paperId,
          title: record.title,
          year: record.year,
          journal: record.journal,
          doi: record.doi,
          pmid: record.pmid,
          arxivId: record.arxivId,
          authors: record.authors ? [...record.authors] : [],
          abstract: input.request.includeAbstracts ? record.abstract : undefined,
          sourceProviderIds: [providerId],
          providerRecordRefs: [providerRecordRef],
          url: record.url,
          fullTextRef: record.fullTextRef,
        });
      }
      recordCitationMatches.set(paperId, (recordCitationMatches.get(paperId) ?? true) && record.citationMatches !== false);
      if (record.downloadFailed) downloadFailurePaperIds.add(paperId);
      acceptedCount += 1;
    }
    providerAttempts.push(providerAttempt(providerId, 'success', input.request.query, fixture.records, index, attemptDiagnostics, {
      elapsedMs,
      normalizedCount: acceptedCount,
    }));
  });

  let paperList = [...normalizedPapers.values()];
  const normalizedResultItemCount = paperList.length;
  if (paperList.length > maxResults) {
    diagnostics.push({
      code: 'result-budget-exceeded',
      message: `Normalized ${paperList.length} papers; truncated to maxResults=${maxResults}.`,
    });
    paperList = paperList.slice(0, maxResults);
  }

  const citationVerificationResults = paperList.map((paper) => citationVerificationForPaper(paper, recordCitationMatches.get(paper.id) ?? true));
  for (const result of citationVerificationResults) {
    if (result.status === 'mismatch') {
      diagnostics.push({
        code: 'citation-mismatch',
        paperId: result.paperId,
        message: 'Citation identifiers or bibliographic fields disagree across provider records.',
      });
    }
  }
  for (const paper of paperList) {
    if (downloadFailurePaperIds.has(paper.id)) {
      diagnostics.push({
        code: 'download-failure',
        paperId: paper.id,
        message: 'Full text retrieval failed; preserving metadata refs and bounded summary only.',
      });
    }
  }

  const evidenceMatrix = paperList.map((paper) => ({
    paperId: paper.id,
    claim: `${paper.title}${paper.year ? ` (${paper.year})` : ''} is relevant to ${input.request.query}.`,
    evidenceRefs: paper.providerRecordRefs,
    citationStatus: citationVerificationResults.find((result) => result.paperId === paper.id)?.status ?? 'missing-identifiers',
  }));
  const status = finalStatus(paperList, diagnostics);
  const sourceProvenance = paperList.map((paper) => sourceProvenanceForPaper(paper, sourceRecordsByPaper.get(paper.id) ?? []));
  const workArtifactRefs: LiteratureWorkEvidence['artifactRefs'] = literatureSourceArtifactRefs(artifactRefs);
  const providerAttemptRefs = providerAttempts.map((attempt) => `providerAttempt:${attempt.id}`);
  const workEvidenceRef = `workEvidence:literature-retrieval:${slug(input.request.query)}`;
  const budgetDebitRecord = createLiteratureRetrievalBudgetDebitRecord({
    budget,
    diagnostics,
    input,
    maxResults,
    normalizedResultItemCount,
    paperList,
    providerAttemptRefs,
    providerAttempts,
    selectedProviderIds,
    status,
    workEvidenceRef,
    artifactRefs: workArtifactRefs,
    paperListArtifactRef: artifactRefs.paperList,
  });
  const budgetDebitRefs = [budgetDebitRecord.debitId];
  for (const attempt of providerAttempts) {
    attempt.budgetDebitRefs = budgetDebitRefs;
  }

  return {
    status,
    artifactRefs,
    paperList,
    evidenceMatrix,
    researchReport: {
      artifactType: 'research-report',
      ref: artifactRefs.researchReport,
      title: `Literature retrieval report: ${input.request.query}`,
      boundedSummary: paperList.length
        ? paperList.map((paper) => `${paper.title}${paper.year ? ` (${paper.year})` : ''}`).join('; ')
        : 'No papers were normalized from the selected offline providers.',
      fullTextPolicy: resolveReportFullTextPolicy(input.request.fullTextPolicy, diagnostics),
      sourceRefs: paperList.flatMap((paper) => paper.providerRecordRefs),
      diagnostics,
    },
    sourceProvenance,
    workEvidence: [{
      id: workEvidenceRef,
      kind: 'literature-retrieval',
      capabilityId: 'literature.retrieval',
      query: input.request.query,
      artifactRefs: workArtifactRefs,
      providerAttemptRefs,
      budget,
      diagnosticCodes: unique(diagnostics.map((diagnostic) => diagnostic.code)),
      budgetDebitRefs,
    }],
    providerAttempts,
    citationVerificationResults,
    diagnostics,
    budgetDebits: [budgetDebitRecord],
  };
}

export function validateOfflineLiteratureRetrievalOutput(output: OfflineLiteratureRetrievalOutput): string[] {
  const failures: string[] = [];
  const artifactRefs = output.artifactRefs;
  if (!artifactRefs?.paperList || !artifactRefs.evidenceMatrix || !artifactRefs.researchReport) {
    failures.push('artifactRefs must declare paperList, evidenceMatrix, and researchReport refs');
  }
  if (!Array.isArray(output.paperList)) failures.push('paperList must be an array');
  if (!Array.isArray(output.evidenceMatrix)) failures.push('evidenceMatrix must be an array');
  if (artifactRefs?.researchReport && output.researchReport?.ref !== artifactRefs.researchReport) {
    failures.push('researchReport.ref must match artifactRefs.researchReport');
  }
  if (output.workEvidence.some((evidence) => (
    artifactRefs
    && !literatureSourceArtifactRefs(artifactRefs).every((ref) => evidence.artifactRefs.includes(ref))
  ))) {
    failures.push('workEvidence artifactRefs must include declared retrieval artifact refs');
  }
  if (!Array.isArray(output.sourceProvenance)) failures.push('sourceProvenance must be an array');
  if (!output.workEvidence.length) failures.push('workEvidence must include at least one audit row');
  if (!output.providerAttempts.length) failures.push('providerAttempts must include selected provider outcomes');
  if (!Array.isArray(output.citationVerificationResults)) failures.push('citationVerificationResults must be an array');
  if (output.budgetDebits !== undefined && !Array.isArray(output.budgetDebits)) failures.push('budgetDebits must be an array when emitted');
  if (output.status === 'success' && output.paperList.length === 0) failures.push('success requires at least one normalized paper');
  if (output.status === 'success' && output.diagnostics.length > 0) failures.push('success cannot carry failure diagnostics');
  if (output.providerAttempts.some((attempt) => attempt.status === 'timeout') && output.status === 'success') {
    failures.push('provider timeout must produce partial or failed output');
  }
  if (output.providerAttempts.every((attempt) => attempt.status !== 'success') && output.status === 'success') {
    failures.push('success requires at least one successful provider attempt');
  }
  if (output.citationVerificationResults.some((result) => result.status === 'mismatch') && output.status === 'success') {
    failures.push('citation mismatch must produce partial or failed output');
  }
  if (output.diagnostics.some((diagnostic) => diagnostic.code === 'download-failure') && output.researchReport.fullTextPolicy !== 'metadata-only') {
    failures.push('download failure must downgrade researchReport.fullTextPolicy to metadata-only');
  }
  return failures;
}

export function deriveLiteratureBilingualReport(input: LiteratureBilingualReportInput): LiteratureBilingualReportArtifact {
  const output = input.output;
  const sourceArtifactRefs = literatureSourceArtifactRefs(output.artifactRefs);
  const parentArtifactRef = output.artifactRefs.researchReport;
  const derivedRefs = literatureDerivedArtifactRefs(parentArtifactRef, input.artifactRefs);
  const paperIds = output.paperList.map((paper) => paper.id);
  const sourceRefs = unique([
    parentArtifactRef,
    ...output.researchReport.sourceRefs,
    ...output.paperList.flatMap((paper) => paper.providerRecordRefs),
  ]);
  const executiveSummary = normalizeExecutiveSummary(input.executiveSummary, output);
  const executiveSummaryRefs = unique([
    ...sourceRefs,
    ...arrayStrings(typeof input.executiveSummary === 'object' ? input.executiveSummary.sourceRefs : undefined),
  ]);
  const glossaryEntries = normalizeBilingualGlossaryTerms(input.glossaryTerms ?? [], sourceRefs, paperIds);
  const glossaryRefs = unique(glossaryEntries.flatMap((entry) => entry.sourceRefs));
  const rootDerivation = artifactDerivationMetadata({
    kind: 'rewrite',
    role: 'bilingual-report',
    language: `${input.sourceLanguage ?? 'source'}-${input.targetLanguage ?? 'en'}`,
    parentArtifactRef,
    sourceRefs,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage ?? 'en',
    verificationStatus: glossaryEntries.length ? 'unverified' : 'needs-review',
  });
  const summaryDerivation = artifactDerivationMetadata({
    kind: 'summary',
    role: 'executive-summary',
    language: input.targetLanguage ?? 'en',
    parentArtifactRef,
    sourceRefs: executiveSummaryRefs,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage ?? 'en',
    verificationStatus: 'unverified',
  });
  const glossaryDerivation = artifactDerivationMetadata({
    kind: 'glossary',
    role: 'glossary',
    language: `${input.sourceLanguage ?? 'source'}-${input.targetLanguage ?? 'en'}`,
    parentArtifactRef,
    sourceRefs: glossaryRefs.length ? glossaryRefs : sourceRefs,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage ?? 'en',
    verificationStatus: glossaryEntries.length ? 'unverified' : 'needs-review',
  });
  return {
    artifactType: 'bilingual-literature-report',
    ref: derivedRefs.bilingualReport,
    parentArtifactRef,
    metadata: rootDerivation,
    derivedArtifactRefs: [derivedRefs.bilingualExecutiveSummary, derivedRefs.bilingualGlossary],
    sourceArtifactRefs,
    sourceLanguage: input.sourceLanguage ?? 'source',
    targetLanguage: input.targetLanguage ?? 'en',
    status: glossaryEntries.length ? 'ready' : 'needs-review',
    sourceReport: {
      ref: output.researchReport.ref,
      title: output.researchReport.title,
      boundedSummary: output.researchReport.boundedSummary,
      sourceRefs: output.researchReport.sourceRefs,
    },
    englishExecutiveSummary: {
      artifactType: 'bilingual-executive-summary',
      ref: derivedRefs.bilingualExecutiveSummary,
      parentArtifactRef,
      metadata: summaryDerivation,
      text: executiveSummary,
      sourceRefs: executiveSummaryRefs,
    },
    glossary: {
      artifactType: 'bilingual-glossary',
      ref: derivedRefs.bilingualGlossary,
      parentArtifactRef,
      metadata: glossaryDerivation,
      entries: glossaryEntries,
      sourceRefs: glossaryRefs.length ? glossaryRefs : sourceRefs,
    },
    paperIds,
    sourceRefs,
    lineage: [
      `${parentArtifactRef} -> ${derivedRefs.bilingualExecutiveSummary}`,
      `${parentArtifactRef} -> ${derivedRefs.bilingualGlossary}`,
      `${derivedRefs.bilingualExecutiveSummary} + ${derivedRefs.bilingualGlossary} -> ${derivedRefs.bilingualReport}`,
    ],
    diagnostics: output.diagnostics,
  };
}

export function deriveLiteratureReproductionFeasibility(
  input: LiteratureReproductionFeasibilityInput,
): LiteratureReproductionFeasibilityArtifact {
  const output = input.output;
  const sourceArtifactRefs = literatureSourceArtifactRefs(output.artifactRefs);
  const parentArtifactRef = output.artifactRefs.researchReport;
  const derivedRefs = literatureDerivedArtifactRefs(parentArtifactRef, input.artifactRefs);
  const paperIds = output.paperList.map((paper) => paper.id);
  const evidenceByPaper = mergeReproductionEvidence(input.paperEvidence ?? []);
  const ignoredEvidencePaperIds = [...evidenceByPaper.keys()].filter((paperId) => !paperIds.includes(paperId));
  const sourceRefs = unique([
    ...sourceArtifactRefs,
    ...output.researchReport.sourceRefs,
    ...output.paperList.flatMap((paper) => paper.providerRecordRefs),
    ...output.evidenceMatrix.flatMap((row) => row.evidenceRefs),
    ...[...evidenceByPaper.values()].flatMap(reproductionEvidenceRefs),
  ]);
  const planStepLimit = Math.max(1, Math.min(input.maxPlanSteps ?? 3, output.paperList.length || 1));
  const rankedPapers = output.paperList
    .map((paper) => rankReproductionPaper(output, paper, evidenceByPaper.get(paper.id)))
    .sort((a, b) => b.score - a.score || a.paperId.localeCompare(b.paperId))
    .map((paper, index) => ({ ...paper, rank: index + 1 }));
  const selectedPapers = rankedPapers.slice(0, planStepLimit);
  const analysisPlan = buildLiteratureReproductionAnalysisPlan({
    objective: input.objective ?? 'Rank retrieved papers by reproducibility and export a refs-first reproduction plan.',
    sourceRefs,
    rankedPapers: selectedPapers,
  });
  const selectedStepIds = new Map(analysisPlan.steps.map((step) => [step.id.replace(/^reproduce-/, ''), step.id]));
  const rankedWithPlanSteps = rankedPapers.map((paper) => {
    const stepId = selectedStepIds.get(slug(paper.paperId));
    return stepId ? { ...paper, planStepIds: [stepId] } : paper;
  });
  const status: LiteratureReproductionFeasibilityStatus = output.paperList.length === 0
    ? 'blocked'
    : rankedWithPlanSteps.some((paper) => paper.recommendation === 'ready' || paper.recommendation === 'promising')
      ? 'ready'
      : 'needs-review';

  return {
    artifactType: 'literature-reproduction-feasibility',
    ref: derivedRefs.reproductionFeasibility,
    parentArtifactRef,
    metadata: artifactDerivationMetadata({
      kind: 'analysis-plan',
      role: 'reproduction-feasibility-ranking',
      language: 'source',
      parentArtifactRef,
      sourceRefs,
      verificationStatus: status === 'ready' ? 'unverified' : 'needs-review',
    }),
    sourceArtifactRefs,
    status,
    paperIds,
    rankedPapers: rankedWithPlanSteps,
    analysisPlan,
    sourceRefs,
    ignoredEvidencePaperIds,
    noHardcodeReview: {
      schemaVersion: NO_HARDCODE_REVIEW_SCHEMA_VERSION,
      appliesGenerally: true,
      generalityStatement: 'Literature reproduction feasibility is ranked from structured paper ids, retrieval refs, and explicit code/data/compute/risk evidence; it does not select papers by title text, array index, provider name, or current prompt wording.',
      counterExamples: [
        'A paper with available code and data should rank well regardless of its title wording.',
        'Evidence for a paper id absent from the retrieval output is ignored and reported instead of being forced into the ranking.',
        'The exported analysis plan uses scientific reproduction refs instead of embedding full text or executing reproduction work.',
      ],
      forbiddenSpecialCases: [
        'title-or-array-index candidate selection',
        'provider-name-specific availability shortcut',
        'paper-title-specific reproduction score',
        'prompt-phrase-specific ranking rule',
      ],
      ownerLayer: 'harness',
      status: 'pass',
    },
    diagnostics: output.diagnostics,
  };
}

export function validateLiteratureReproductionFeasibilityArtifact(
  artifact: LiteratureReproductionFeasibilityArtifact,
): string[] {
  const failures: string[] = [];
  if (artifact.artifactType !== 'literature-reproduction-feasibility') failures.push('artifactType must be literature-reproduction-feasibility');
  if (!artifact.ref) failures.push('ref must be a non-empty artifact ref');
  if (!artifact.parentArtifactRef) failures.push('parentArtifactRef must be a non-empty source artifact ref');
  if (!artifact.sourceArtifactRefs.includes(artifact.parentArtifactRef)) {
    failures.push('sourceArtifactRefs must include parentArtifactRef');
  }
  if (!artifact.sourceRefs.length) failures.push('sourceRefs must include retrieval and evidence refs');
  if (artifact.rankedPapers.some((paper) => !artifact.paperIds.includes(paper.paperId))) {
    failures.push('rankedPapers must only reference paperIds from the source retrieval output');
  }
  if (artifact.rankedPapers.some((paper) => paper.evidenceRefs.length === 0)) {
    failures.push('each ranked paper must carry auditable evidenceRefs');
  }
  const ranks = artifact.rankedPapers.map((paper) => paper.rank);
  if (new Set(ranks).size !== ranks.length) failures.push('rankedPapers ranks must be unique');
  const scores = artifact.rankedPapers.map((paper) => paper.score);
  if (scores.some((score) => score < 0 || score > 100)) failures.push('rankedPapers scores must stay in [0, 100]');
  if (scores.some((score, index) => index > 0 && score > scores[index - 1])) {
    failures.push('rankedPapers must be sorted by descending score');
  }
  const planValidation: ScientificReproductionValidationResult = validateScientificReproductionArtifact(artifact.analysisPlan);
  if (!planValidation.ok) {
    failures.push(`analysisPlan must satisfy scientific reproduction contract: ${planValidation.issues.map((issue) => issue.path).join(', ')}`);
  }
  if (artifact.noHardcodeReview.schemaVersion !== NO_HARDCODE_REVIEW_SCHEMA_VERSION) {
    failures.push('noHardcodeReview must carry sciforge.no-hardcode-review.v1');
  }
  if (artifact.noHardcodeReview.status === 'pass' && artifact.noHardcodeReview.appliesGenerally !== true) {
    failures.push('passing noHardcodeReview must apply generally');
  }
  if (!artifact.noHardcodeReview.forbiddenSpecialCases.includes('title-or-array-index candidate selection')) {
    failures.push('noHardcodeReview must forbid title/index based selection');
  }
  return failures;
}

function artifactDerivationMetadata(input: {
  kind: RuntimeArtifactDerivation['kind'];
  role: string;
  language: string;
  parentArtifactRef: string;
  sourceRefs: string[];
  sourceLanguage?: string;
  targetLanguage?: string;
  verificationStatus: NonNullable<RuntimeArtifactDerivation['verificationStatus']>;
}): LiteratureDerivedArtifactMetadata {
  return {
    language: input.language,
    role: input.role,
    derivation: {
      schemaVersion: 'sciforge.artifact-derivation.v1',
      kind: input.kind,
      parentArtifactRef: input.parentArtifactRef,
      sourceRefs: input.sourceRefs,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      verificationStatus: input.verificationStatus,
    },
  };
}

function mergeReproductionEvidence(
  evidenceRows: LiteratureReproductionEvidenceInput[],
): Map<string, LiteratureReproductionEvidenceInput> {
  const merged = new Map<string, LiteratureReproductionEvidenceInput>();
  for (const evidence of evidenceRows) {
    if (!evidence.paperId) continue;
    const existing = merged.get(evidence.paperId);
    merged.set(evidence.paperId, existing ? {
      paperId: evidence.paperId,
      codeAvailability: strongerAvailability(existing.codeAvailability, evidence.codeAvailability),
      datasetAvailability: strongerAvailability(existing.datasetAvailability, evidence.datasetAvailability),
      computeCost: lowerComputeCost(existing.computeCost, evidence.computeCost),
      reproductionRisk: lowerRisk(existing.reproductionRisk, evidence.reproductionRisk),
      codeRefs: unique([...arrayStrings(existing.codeRefs), ...arrayStrings(evidence.codeRefs)]),
      datasetRefs: unique([...arrayStrings(existing.datasetRefs), ...arrayStrings(evidence.datasetRefs)]),
      computeRefs: unique([...arrayStrings(existing.computeRefs), ...arrayStrings(evidence.computeRefs)]),
      riskRefs: unique([...arrayStrings(existing.riskRefs), ...arrayStrings(evidence.riskRefs)]),
      notes: unique([...arrayStrings(existing.notes), ...arrayStrings(evidence.notes)]),
    } : {
      ...evidence,
      codeRefs: arrayStrings(evidence.codeRefs),
      datasetRefs: arrayStrings(evidence.datasetRefs),
      computeRefs: arrayStrings(evidence.computeRefs),
      riskRefs: arrayStrings(evidence.riskRefs),
      notes: arrayStrings(evidence.notes),
    });
  }
  return merged;
}

function rankReproductionPaper(
  output: OfflineLiteratureRetrievalOutput,
  paper: NormalizedLiteraturePaper,
  evidence: LiteratureReproductionEvidenceInput | undefined,
): LiteratureReproductionFeasibilityRankedPaper {
  const evidenceRows = output.evidenceMatrix.filter((row) => row.paperId === paper.id);
  const provenance = output.sourceProvenance.find((entry) => entry.paperId === paper.id);
  const codeAvailability = evidence?.codeAvailability ?? 'unknown';
  const datasetAvailability = evidence?.datasetAvailability ?? 'unknown';
  const computeCost = evidence?.computeCost ?? 'unknown';
  const reproductionRisk = evidence?.reproductionRisk ?? 'unknown';
  const codeRefs = arrayStrings(evidence?.codeRefs);
  const datasetRefs = arrayStrings(evidence?.datasetRefs);
  const computeRefs = arrayStrings(evidence?.computeRefs);
  const riskRefs = arrayStrings(evidence?.riskRefs);
  const sourceRefs = unique([
    ...paper.providerRecordRefs,
    ...evidenceRows.flatMap((row) => row.evidenceRefs),
    ...(provenance?.providerRecordRefs ?? []),
  ]);
  const allEvidenceRefs = unique([
    ...sourceRefs,
    ...codeRefs,
    ...datasetRefs,
    ...computeRefs,
    ...riskRefs,
  ]);
  const score = Math.min(100, Math.max(0,
    availabilityScore(codeAvailability)
    + availabilityScore(datasetAvailability)
    + computeCostScore(computeCost)
    + reproductionRiskScore(reproductionRisk),
  ));
  const missingEvidence = missingReproductionEvidence({
    codeAvailability,
    datasetAvailability,
    computeCost,
    reproductionRisk,
    codeRefs,
    datasetRefs,
    computeRefs,
    riskRefs,
  });
  const riskNotes = reproductionRiskNotes({
    codeAvailability,
    datasetAvailability,
    computeCost,
    reproductionRisk,
    notes: arrayStrings(evidence?.notes),
    refs: allEvidenceRefs,
    codeRefs,
    datasetRefs,
    computeRefs,
    riskRefs,
  });
  return {
    rank: 0,
    paperId: paper.id,
    title: paper.title,
    score,
    recommendation: reproductionRecommendation({ score, codeAvailability, datasetAvailability, computeCost, reproductionRisk }),
    codeAvailability,
    datasetAvailability,
    computeCost,
    reproductionRisk,
    sourceRefs,
    evidenceRefs: allEvidenceRefs,
    codeRefs,
    datasetRefs,
    computeRefs,
    riskRefs,
    missingEvidence,
    riskNotes,
    planStepIds: [],
  };
}

function buildLiteratureReproductionAnalysisPlan(input: {
  objective: string;
  sourceRefs: string[];
  rankedPapers: LiteratureReproductionFeasibilityRankedPaper[];
}): AnalysisPlan {
  const expectedArtifacts: ScientificReproductionArtifactType[] = ['analysis-notebook', 'evidence-matrix', 'figure-reproduction-report'];
  return {
    schemaVersion: SCIENTIFIC_REPRODUCTION_SCHEMA_VERSION,
    artifactType: 'analysis-plan',
    sourceRefs: toScientificRefs(input.sourceRefs, 'source'),
    evidenceRefs: toScientificRefs(input.rankedPapers.flatMap((paper) => paper.evidenceRefs), 'source'),
    objective: input.objective,
    claimIds: input.rankedPapers.map((paper) => paper.paperId),
    steps: input.rankedPapers.map((paper) => {
      const stepId = `reproduce-${slug(paper.paperId)}`;
      return {
        id: stepId,
        title: `Reproduce ${paper.paperId}`,
        purpose: `Run a bounded reproduction attempt for ${paper.paperId} after checking code, dataset, compute, and risk evidence.`,
        inputRefs: toScientificRefs(paper.evidenceRefs, 'source'),
        outputRefs: [
          { ref: `artifact:analysis-notebook:${paper.paperId}`, kind: 'notebook', summary: 'Expected runnable reproduction notebook or dry-run log.' },
          { ref: `artifact:evidence-matrix:${paper.paperId}`, kind: 'artifact', summary: 'Expected claim/evidence matrix for reproduced outputs.' },
        ],
        methodRefs: toScientificRefs(paper.codeRefs, 'code'),
        expectedArtifacts,
        verifierRefs: [{ ref: 'verifier:scientific-reproduction', kind: 'verifier' }],
      };
    }),
    fallbackPolicy: input.rankedPapers.flatMap((paper) => paper.missingEvidence.map((missing) => ({
      condition: `${paper.paperId} missing ${missing}`,
      action: 'Keep the paper ranked but block live reproduction until the missing ref is attached or an explicit dry-run fixture is approved.',
      refs: toScientificRefs(paper.evidenceRefs, 'source'),
    }))),
  };
}

function toScientificRefs(refs: string[], role: ScientificEvidenceRef['role']): ScientificEvidenceRef[] {
  return unique(refs).map((ref) => ({ ref, role }));
}

function reproductionEvidenceRefs(evidence: LiteratureReproductionEvidenceInput): string[] {
  return unique([
    ...arrayStrings(evidence.codeRefs),
    ...arrayStrings(evidence.datasetRefs),
    ...arrayStrings(evidence.computeRefs),
    ...arrayStrings(evidence.riskRefs),
  ]);
}

function availabilityScore(value: LiteratureReproductionAvailability): number {
  return { available: 30, partial: 18, unknown: 6, unavailable: 0 }[value];
}

function computeCostScore(value: LiteratureReproductionComputeCost): number {
  return { low: 20, medium: 12, unknown: 6, high: 0 }[value];
}

function reproductionRiskScore(value: LiteratureReproductionRiskLevel): number {
  return { low: 20, medium: 12, unknown: 6, high: 0 }[value];
}

function reproductionRecommendation(input: {
  score: number;
  codeAvailability: LiteratureReproductionAvailability;
  datasetAvailability: LiteratureReproductionAvailability;
  computeCost: LiteratureReproductionComputeCost;
  reproductionRisk: LiteratureReproductionRiskLevel;
}): LiteratureReproductionRecommendation {
  if (input.computeCost === 'high' || input.reproductionRisk === 'high' || input.score < 50) return 'high-risk';
  if (input.codeAvailability === 'unavailable' || input.datasetAvailability === 'unavailable') return 'needs-data-or-code';
  if (input.codeAvailability === 'unknown' || input.datasetAvailability === 'unknown') return 'needs-data-or-code';
  return input.score >= 80 ? 'ready' : 'promising';
}

function missingReproductionEvidence(input: {
  codeAvailability: LiteratureReproductionAvailability;
  datasetAvailability: LiteratureReproductionAvailability;
  computeCost: LiteratureReproductionComputeCost;
  reproductionRisk: LiteratureReproductionRiskLevel;
  codeRefs: string[];
  datasetRefs: string[];
  computeRefs: string[];
  riskRefs: string[];
}): string[] {
  const missing: string[] = [];
  if (input.codeAvailability !== 'available' || input.codeRefs.length === 0) missing.push('code availability');
  if (input.datasetAvailability !== 'available' || input.datasetRefs.length === 0) missing.push('dataset availability');
  if (input.computeCost === 'unknown' || input.computeRefs.length === 0) missing.push('compute cost');
  if (input.reproductionRisk === 'unknown' || input.riskRefs.length === 0) missing.push('risk assessment');
  return unique(missing);
}

function reproductionRiskNotes(input: {
  codeAvailability: LiteratureReproductionAvailability;
  datasetAvailability: LiteratureReproductionAvailability;
  computeCost: LiteratureReproductionComputeCost;
  reproductionRisk: LiteratureReproductionRiskLevel;
  notes: string[];
  refs: string[];
  codeRefs: string[];
  datasetRefs: string[];
  computeRefs: string[];
  riskRefs: string[];
}): ScientificRiskNote[] {
  const notes: ScientificRiskNote[] = [];
  if (input.codeAvailability !== 'available') {
    notes.push({
      risk: 'method-incomplete',
      summary: `Code availability is ${input.codeAvailability}; method reconstruction may be required.`,
      refs: toScientificRefs(input.codeRefs.length ? input.codeRefs : input.refs, 'code'),
    });
  }
  if (input.datasetAvailability !== 'available') {
    notes.push({
      risk: 'data-missing',
      summary: `Dataset availability is ${input.datasetAvailability}; live reproduction is blocked until data refs are resolved.`,
      refs: toScientificRefs(input.datasetRefs.length ? input.datasetRefs : input.refs, 'data'),
    });
  }
  if (input.computeCost === 'high' || input.computeCost === 'unknown') {
    notes.push({
      risk: 'compute-budget',
      summary: `Compute cost is ${input.computeCost}; require a bounded budget or dry-run fixture before execution.`,
      refs: toScientificRefs(input.computeRefs.length ? input.computeRefs : input.refs, 'source'),
    });
  }
  if (input.reproductionRisk === 'high' || input.reproductionRisk === 'unknown') {
    notes.push({
      risk: 'other',
      summary: `Reproduction risk is ${input.reproductionRisk}; keep the plan gated until risk refs are reviewed.`,
      refs: toScientificRefs(input.riskRefs.length ? input.riskRefs : input.refs, 'source'),
    });
  }
  for (const note of input.notes) {
    notes.push({
      risk: input.reproductionRisk === 'high' ? 'other' : input.reproductionRisk,
      summary: note,
      refs: toScientificRefs(input.riskRefs.length ? input.riskRefs : input.refs, 'source'),
    });
  }
  return notes;
}

function strongerAvailability(
  left: LiteratureReproductionAvailability | undefined,
  right: LiteratureReproductionAvailability | undefined,
): LiteratureReproductionAvailability | undefined {
  const order: LiteratureReproductionAvailability[] = ['unavailable', 'unknown', 'partial', 'available'];
  if (!left) return right;
  if (!right) return left;
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}

function lowerComputeCost(
  left: LiteratureReproductionComputeCost | undefined,
  right: LiteratureReproductionComputeCost | undefined,
): LiteratureReproductionComputeCost | undefined {
  const order: LiteratureReproductionComputeCost[] = ['high', 'unknown', 'medium', 'low'];
  if (!left) return right;
  if (!right) return left;
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}

function lowerRisk(
  left: LiteratureReproductionRiskLevel | undefined,
  right: LiteratureReproductionRiskLevel | undefined,
): LiteratureReproductionRiskLevel | undefined {
  const order: LiteratureReproductionRiskLevel[] = ['high', 'unknown', 'medium', 'low'];
  if (!left) return right;
  if (!right) return left;
  return order.indexOf(right) > order.indexOf(left) ? right : left;
}

function normalizeExecutiveSummary(
  executiveSummary: LiteratureBilingualReportInput['executiveSummary'],
  output: OfflineLiteratureRetrievalOutput,
): string {
  const supplied = typeof executiveSummary === 'string'
    ? executiveSummary.trim()
    : executiveSummary?.text.trim();
  if (supplied) return supplied;
  return output.paperList.length
    ? `English executive summary derived from ${output.researchReport.ref}: ${output.researchReport.boundedSummary}`
    : `English executive summary derived from ${output.researchReport.ref}: no normalized papers were available.`;
}

function normalizeBilingualGlossaryTerms(
  terms: LiteratureBilingualGlossaryTermInput[],
  defaultSourceRefs: string[],
  defaultPaperIds: string[],
): LiteratureBilingualGlossaryEntry[] {
  const entries: LiteratureBilingualGlossaryEntry[] = [];
  for (const term of terms) {
    const sourceTerm = term.sourceTerm.trim();
    const targetTerm = term.targetTerm.trim();
    if (!sourceTerm || !targetTerm) continue;
    const entry: LiteratureBilingualGlossaryEntry = {
      sourceTerm,
      targetTerm,
      sourceRefs: unique([...arrayStrings(term.sourceRefs), ...defaultSourceRefs]),
      paperIds: arrayStrings(term.paperIds).length ? arrayStrings(term.paperIds) : defaultPaperIds,
      confidence: term.confidence ?? 'provided',
    };
    if (term.note) entry.note = term.note;
    entries.push(entry);
  }
  return entries;
}

export function deriveLiteratureCitationCorrection(input: LiteratureCitationCorrectionInput): LiteratureCitationCorrectionArtifact {
  const targetMatches = findCitationCorrectionTargets(input.output, input.target);
  const allPaperIds = input.output.paperList.map((paper) => paper.id);
  const derivedRefs = literatureDerivedArtifactRefs(input.output.artifactRefs.researchReport, input.artifactRefs);
  if (targetMatches.length === 0) {
    return {
      artifactType: 'citation-correction',
      ref: derivedRefs.citationCorrection,
      targetProviderRecordRefs: unique([input.target.providerRecordRef, input.target.evidenceRef].filter((ref): ref is string => Boolean(ref))),
      sourceRefs: [],
      correctionStatus: 'not-found',
      correctionReport: `No citation target matched the supplied refs. reason=${input.reason}`,
      affectedEvidenceRows: [],
      untouchedPaperIds: allPaperIds,
      diagnostics: [{
        code: 'citation-mismatch',
        message: 'Citation correction target was not found from paperId, providerRecordRef, or evidenceRef.',
      }],
    };
  }

  if (targetMatches.length > 1) {
    return {
      artifactType: 'citation-correction',
      ref: derivedRefs.citationCorrection,
      targetProviderRecordRefs: unique(targetMatches.flatMap((match) => match.providerRecordRefs)),
      sourceRefs: unique(targetMatches.flatMap((match) => match.providerRecordRefs)),
      correctionStatus: 'ambiguous',
      correctionReport: `Citation correction target is ambiguous across ${targetMatches.length} papers; provide paperId or providerRecordRef. reason=${input.reason}`,
      affectedEvidenceRows: targetMatches.flatMap((match) => match.evidenceRows),
      untouchedPaperIds: allPaperIds.filter((paperId) => !targetMatches.some((match) => match.paper.id === paperId)),
      diagnostics: [{
        code: 'citation-mismatch',
        message: 'Citation correction target matched more than one paper.',
      }],
    };
  }

  const target = targetMatches[0];
  const providerRecordRefsToRemove = unique([
    input.target.providerRecordRef,
    input.target.evidenceRef,
  ].filter((ref): ref is string => typeof ref === 'string' && target.providerRecordRefs.includes(ref)));
  const removedEvidenceRefs = providerRecordRefsToRemove.length
    ? providerRecordRefsToRemove
    : input.action === 'mark-citation-untrusted'
      ? []
      : target.providerRecordRefs;
  const affectedEvidenceRows = target.evidenceRows.map((row) => ({
    ...row,
    evidenceRefs: row.evidenceRefs.filter((ref) => !removedEvidenceRefs.includes(ref)),
    citationStatus: row.citationStatus === 'verified' ? 'mismatch' as CitationVerificationStatus : row.citationStatus,
  }));
  const retainedEvidenceRefs = unique(target.evidenceRows.flatMap((row) => row.evidenceRefs).filter((ref) => !removedEvidenceRefs.includes(ref)));
  const verificationStatus = target.citationVerificationResult?.status ?? target.evidenceRows[0]?.citationStatus;
  const correctionStatus: LiteratureCitationCorrectionStatus = removedEvidenceRefs.length || verificationStatus === 'mismatch'
    ? 'corrected'
    : 'needs-review';

  return {
    artifactType: 'citation-correction',
    ref: derivedRefs.citationCorrection,
    targetArtifactRef: input.output.artifactRefs.researchReport,
    targetPaperId: target.paper.id,
    targetProviderRecordRefs: target.providerRecordRefs,
    sourceRefs: unique([...target.providerRecordRefs, ...target.evidenceRows.flatMap((row) => row.evidenceRefs)]),
    verificationStatus,
    correctionStatus,
    correctedSegment: {
      paperId: target.paper.id,
      claim: target.evidenceRows[0]?.claim ?? target.paper.title,
      retainedEvidenceRefs,
      removedEvidenceRefs,
      correctionReason: input.reason,
    },
    correctionReport: [
      `Citation correction for ${target.paper.id}.`,
      `Reason: ${input.reason}`,
      removedEvidenceRefs.length ? `Removed evidence refs: ${removedEvidenceRefs.join(', ')}` : 'No evidence refs removed; citation remains flagged for review.',
      retainedEvidenceRefs.length ? `Retained evidence refs: ${retainedEvidenceRefs.join(', ')}` : 'No retained evidence refs remain for this paper.',
    ].join('\n'),
    affectedEvidenceRows,
    untouchedPaperIds: allPaperIds.filter((paperId) => paperId !== target.paper.id),
    diagnostics: [{
      code: 'citation-mismatch',
      paperId: target.paper.id,
      message: `Derived citation correction from refs without mutating original retrieval output. reason=${input.reason}`,
    }],
  };
}

function findCitationCorrectionTargets(
  output: OfflineLiteratureRetrievalOutput,
  target: LiteratureCitationCorrectionInput['target'],
) {
  const targetRefs = unique([target.providerRecordRef, target.evidenceRef].filter((ref): ref is string => Boolean(ref)));
  return output.paperList
    .map((paper) => {
      const sourceProvenance = output.sourceProvenance.find((entry) => entry.paperId === paper.id);
      const evidenceRows = output.evidenceMatrix.filter((row) => row.paperId === paper.id);
      const citationVerificationResult = output.citationVerificationResults.find((result) => result.paperId === paper.id);
      const providerRecordRefs = unique([
        ...paper.providerRecordRefs,
        ...evidenceRows.flatMap((row) => row.evidenceRefs),
        ...(sourceProvenance?.providerRecordRefs ?? []),
        ...(sourceProvenance?.sourceRecords.map((record) => record.providerRecordRef) ?? []),
      ]);
      return { paper, sourceProvenance, evidenceRows, citationVerificationResult, providerRecordRefs };
    })
    .filter((candidate) => {
      if (target.paperId && candidate.paper.id === target.paperId) return true;
      return targetRefs.some((ref) => candidate.providerRecordRefs.includes(ref));
    });
}

function sourceProvenanceForPaper(
  paper: NormalizedLiteraturePaper,
  sourceRecords: LiteratureSourceRecordForProvenance[],
): LiteratureSourceProvenanceRecord {
  return {
    paperId: paper.id,
    includedProviderIds: unique(sourceRecords.filter((record) => record.included).map((record) => record.providerId)),
    excludedProviderIds: unique(sourceRecords.filter((record) => !record.included).map((record) => record.providerId)),
    providerRecordRefs: unique(sourceRecords.map((record) => record.providerRecordRef)),
    sourceRecords: sourceRecords.map((record) => ({
      providerId: record.providerId,
      providerRecordRef: record.providerRecordRef,
      trustLevel: record.trustLevel,
      included: record.included,
      exclusionReason: record.exclusionReason,
    })),
    differences: sourceDifferences(sourceRecords),
  };
}

function sourceDifferences(sourceRecords: LiteratureSourceRecordForProvenance[]): LiteratureSourceDifference[] {
  const fields: LiteratureSourceDifference['field'][] = ['title', 'year', 'journal', 'doi', 'pmid', 'arxivId'];
  return fields.flatMap((field) => {
    const values = sourceRecords
      .map((record) => {
        const value = record[field];
        return value === undefined ? undefined : { providerId: record.providerId, value: String(value) };
      })
      .filter((entry): entry is LiteratureSourceProvenanceValue => Boolean(entry));
    const uniqueValues = unique(values.map((entry) => normalizeDifferenceValue(entry.value)));
    return uniqueValues.length > 1 ? [{ field, values }] : [];
  });
}
