import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
  type CapabilityInvocationBudgetDebitRecord,
} from '@sciforge-ui/runtime-contract/capability-budget';
import type { RuntimeArtifactDerivation } from '@sciforge-ui/runtime-contract';

export type LiteratureRetrievalStatus = 'success' | 'partial' | 'failed';
export type LiteratureProviderAttemptStatus = 'success' | 'empty' | 'timeout' | 'error' | 'skipped';
export type CitationVerificationStatus = 'verified' | 'mismatch' | 'missing-identifiers';
export type LiteratureSourceTrustLevel = 'high' | 'medium' | 'low';

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
  ref: 'artifact:research-report';
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
  artifactRefs: Array<'artifact:paper-list' | 'artifact:evidence-matrix' | 'artifact:research-report'>;
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
}

export interface LiteratureCitationCorrectionArtifact {
  artifactType: 'citation-correction';
  ref: 'artifact:citation-correction';
  targetArtifactRef?: 'artifact:paper-list' | 'artifact:evidence-matrix' | 'artifact:research-report';
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
  ref: 'artifact:bilingual-literature-report';
  parentArtifactRef: 'artifact:research-report';
  metadata: LiteratureDerivedArtifactMetadata;
  derivedArtifactRefs: Array<'artifact:bilingual-executive-summary' | 'artifact:bilingual-glossary'>;
  sourceArtifactRefs: Array<'artifact:research-report' | 'artifact:paper-list' | 'artifact:evidence-matrix'>;
  sourceLanguage: string;
  targetLanguage: string;
  status: LiteratureBilingualReportStatus;
  sourceReport: {
    ref: 'artifact:research-report';
    title: string;
    boundedSummary: string;
    sourceRefs: string[];
  };
  englishExecutiveSummary: {
    artifactType: 'bilingual-executive-summary';
    ref: 'artifact:bilingual-executive-summary';
    parentArtifactRef: 'artifact:research-report';
    metadata: LiteratureDerivedArtifactMetadata;
    text: string;
    sourceRefs: string[];
  };
  glossary: {
    artifactType: 'bilingual-glossary';
    ref: 'artifact:bilingual-glossary';
    parentArtifactRef: 'artifact:research-report';
    metadata: LiteratureDerivedArtifactMetadata;
    entries: LiteratureBilingualGlossaryEntry[];
    sourceRefs: string[];
  };
  paperIds: string[];
  sourceRefs: string[];
  lineage: string[];
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

const DEFAULT_PROVIDER_IDS = ['pubmed', 'crossref', 'semantic-scholar', 'openalex', 'arxiv', 'web-search', 'scp-biomedical-search'];
const CITATION_FIELDS: CitationVerificationResult['checkedFields'] = ['doi', 'pmid', 'arxivId', 'title', 'year', 'journal'];

interface LiteratureSourceRecordForProvenance extends LiteratureSourceProvenanceProviderRecord {
  title: string;
  year?: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  arxivId?: string;
}

export function runOfflineLiteratureRetrieval(input: OfflineLiteratureRetrievalRunnerInput): OfflineLiteratureRetrievalOutput {
  const budget = { ...DEFAULT_LITERATURE_RETRIEVAL_BUDGET, ...input.budget };
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
  const artifactRefs: LiteratureWorkEvidence['artifactRefs'] = ['artifact:paper-list', 'artifact:evidence-matrix', 'artifact:research-report'];
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
    artifactRefs,
  });
  const budgetDebitRefs = [budgetDebitRecord.debitId];
  for (const attempt of providerAttempts) {
    attempt.budgetDebitRefs = budgetDebitRefs;
  }

  return {
    status,
    paperList,
    evidenceMatrix,
    researchReport: {
      artifactType: 'research-report',
      ref: 'artifact:research-report',
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
      artifactRefs,
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
  if (!Array.isArray(output.paperList)) failures.push('paperList must be an array');
  if (!Array.isArray(output.evidenceMatrix)) failures.push('evidenceMatrix must be an array');
  if (output.researchReport?.ref !== 'artifact:research-report') failures.push('researchReport must expose artifact:research-report');
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
  const paperIds = output.paperList.map((paper) => paper.id);
  const sourceRefs = unique([
    output.researchReport.ref,
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
    sourceRefs,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage ?? 'en',
    verificationStatus: glossaryEntries.length ? 'unverified' : 'needs-review',
  });
  const summaryDerivation = artifactDerivationMetadata({
    kind: 'summary',
    role: 'executive-summary',
    language: input.targetLanguage ?? 'en',
    sourceRefs: executiveSummaryRefs,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage ?? 'en',
    verificationStatus: 'unverified',
  });
  const glossaryDerivation = artifactDerivationMetadata({
    kind: 'glossary',
    role: 'glossary',
    language: `${input.sourceLanguage ?? 'source'}-${input.targetLanguage ?? 'en'}`,
    sourceRefs: glossaryRefs.length ? glossaryRefs : sourceRefs,
    sourceLanguage: input.sourceLanguage,
    targetLanguage: input.targetLanguage ?? 'en',
    verificationStatus: glossaryEntries.length ? 'unverified' : 'needs-review',
  });
  return {
    artifactType: 'bilingual-literature-report',
    ref: 'artifact:bilingual-literature-report',
    parentArtifactRef: 'artifact:research-report',
    metadata: rootDerivation,
    derivedArtifactRefs: ['artifact:bilingual-executive-summary', 'artifact:bilingual-glossary'],
    sourceArtifactRefs: ['artifact:research-report', 'artifact:paper-list', 'artifact:evidence-matrix'],
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
      ref: 'artifact:bilingual-executive-summary',
      parentArtifactRef: 'artifact:research-report',
      metadata: summaryDerivation,
      text: executiveSummary,
      sourceRefs: executiveSummaryRefs,
    },
    glossary: {
      artifactType: 'bilingual-glossary',
      ref: 'artifact:bilingual-glossary',
      parentArtifactRef: 'artifact:research-report',
      metadata: glossaryDerivation,
      entries: glossaryEntries,
      sourceRefs: glossaryRefs.length ? glossaryRefs : sourceRefs,
    },
    paperIds,
    sourceRefs,
    lineage: [
      'artifact:research-report -> artifact:bilingual-executive-summary',
      'artifact:research-report -> artifact:bilingual-glossary',
      'artifact:bilingual-executive-summary + artifact:bilingual-glossary -> artifact:bilingual-literature-report',
    ],
    diagnostics: output.diagnostics,
  };
}

function artifactDerivationMetadata(input: {
  kind: RuntimeArtifactDerivation['kind'];
  role: string;
  language: string;
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
      parentArtifactRef: 'artifact:research-report',
      sourceRefs: input.sourceRefs,
      sourceLanguage: input.sourceLanguage,
      targetLanguage: input.targetLanguage,
      verificationStatus: input.verificationStatus,
    },
  };
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
  if (targetMatches.length === 0) {
    return {
      artifactType: 'citation-correction',
      ref: 'artifact:citation-correction',
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
      ref: 'artifact:citation-correction',
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
    ref: 'artifact:citation-correction',
    targetArtifactRef: 'artifact:research-report',
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

function createLiteratureRetrievalBudgetDebitRecord(input: {
  budget: LiteratureRetrievalBudget;
  diagnostics: LiteratureRetrievalDiagnostic[];
  input: OfflineLiteratureRetrievalRunnerInput;
  maxResults: number;
  normalizedResultItemCount: number;
  paperList: NormalizedLiteraturePaper[];
  providerAttemptRefs: string[];
  providerAttempts: LiteratureProviderAttempt[];
  selectedProviderIds: string[];
  status: LiteratureRetrievalStatus;
  workEvidenceRef: string;
  artifactRefs: LiteratureWorkEvidence['artifactRefs'];
}): CapabilityInvocationBudgetDebitRecord {
  const invocationSlug = slug(input.input.request.query);
  const providerAttemptWallLines: CapabilityBudgetDebitLine[] = input.providerAttempts.map((attempt) => ({
    dimension: 'wallMs',
    amount: attempt.elapsedMs,
    limit: input.budget.perProviderTimeoutMs,
    remaining: input.budget.perProviderTimeoutMs - attempt.elapsedMs,
    reason: 'offline literature provider attempt wall time',
    sourceRef: `providerAttempt:${attempt.id}`,
  }));
  const debitLines: CapabilityBudgetDebitLine[] = [
    {
      dimension: 'providers',
      amount: input.selectedProviderIds.length,
      limit: input.budget.maxProviders,
      remaining: input.budget.maxProviders - input.selectedProviderIds.length,
      reason: 'selected literature retrieval providers',
      sourceRef: 'capability:literature.retrieval',
    },
    {
      dimension: 'networkCalls',
      amount: input.providerAttempts.filter((attempt) => attempt.status !== 'skipped').length,
      reason: 'offline provider request attempts',
      sourceRef: 'capability:literature.retrieval',
    },
    {
      dimension: 'resultItems',
      amount: input.normalizedResultItemCount,
      limit: input.maxResults,
      remaining: input.maxResults - input.normalizedResultItemCount,
      reason: 'normalized literature result items before emission truncation',
      sourceRef: 'artifact:paper-list',
    },
    ...providerAttemptWallLines,
  ];

  return createCapabilityBudgetDebitRecord({
    debitId: `budgetDebit:literature-retrieval:${invocationSlug}`,
    invocationId: `capabilityInvocation:literature-retrieval:${invocationSlug}`,
    capabilityId: 'literature.retrieval',
    candidateId: 'literature.retrieval',
    manifestRef: 'capability:literature.retrieval',
    subjectRefs: [
      ...input.artifactRefs,
      ...input.providerAttemptRefs,
      ...input.paperList.map((paper) => paper.id),
    ],
    debitLines,
    sinkRefs: {
      executionUnitRef: 'executionUnit:literature-retrieval-offline',
      workEvidenceRefs: [input.workEvidenceRef],
      auditRefs: ['audit:literature-retrieval-runner', ...input.providerAttemptRefs],
    },
    metadata: {
      diagnosticCodes: unique(input.diagnostics.map((diagnostic) => diagnostic.code)),
      emittedResultItems: input.paperList.length,
      normalizedResultItems: input.normalizedResultItemCount,
      requestedProviderCount: normalizeRequestedProviders(input.input.request.databases).length,
      selectedProviderIds: input.selectedProviderIds.map((providerId) => `literature.retrieval.${providerId}`),
      status: input.status,
    },
  });
}

function normalizeRequestedProviders(databases: string[] | undefined): string[] {
  const providers = databases?.length ? databases : DEFAULT_PROVIDER_IDS;
  return unique(providers.map(normalizeProviderId));
}

function normalizeProviderId(providerId: string): string {
  return providerId.startsWith('literature.retrieval.') ? providerId.slice('literature.retrieval.'.length) : providerId;
}

function providerAttempt(
  providerId: string,
  status: LiteratureProviderAttemptStatus,
  query: string,
  records: OfflineLiteraturePaperRecord[],
  index: number,
  diagnosticCodes: string[],
  overrides: Partial<LiteratureProviderAttempt> = {},
): LiteratureProviderAttempt {
  return {
    id: `attempt-${index + 1}-${providerId}`,
    providerId: `literature.retrieval.${providerId}`,
    status,
    query,
    resultCount: records.length,
    normalizedCount: status === 'success' ? records.length : 0,
    elapsedMs: 25,
    diagnosticCodes,
    ...overrides,
  };
}

function paperKey(
  record: OfflineLiteraturePaperRecord,
  dedupePolicy: NonNullable<LiteratureRetrievalRequest['dedupePolicy']>,
  providerId: string,
): string {
  if (dedupePolicy === 'provider-native') return `paper:${providerId}:${record.providerRecordId ?? slug(record.title)}`;
  if (dedupePolicy === 'none') return `paper:${providerId}:${record.providerRecordId ?? slug(`${record.title}-${record.year ?? 'unknown'}`)}`;
  if (record.doi) return `paper:doi:${record.doi.toLowerCase()}`;
  if (record.pmid) return `paper:pmid:${record.pmid}`;
  if (record.arxivId) return `paper:arxiv:${record.arxivId.toLowerCase()}`;
  return `paper:title-year:${slug(record.title)}:${record.year ?? 'unknown'}`;
}

function citationVerificationForPaper(paper: NormalizedLiteraturePaper, citationMatches: boolean): CitationVerificationResult {
  const missingIdentifierFields = (['doi', 'pmid', 'arxivId'] as const).filter((field) => !paper[field]);
  const hasStableIdentifier = missingIdentifierFields.length < 3;
  return {
    paperId: paper.id,
    providerIds: [...paper.sourceProviderIds],
    checkedFields: CITATION_FIELDS,
    status: citationMatches ? (hasStableIdentifier ? 'verified' : 'missing-identifiers') : 'mismatch',
    mismatchFields: citationMatches ? [] : ['doi', 'pmid', 'arxivId', 'title', 'year', 'journal'],
    missingIdentifierFields,
  };
}

function finalStatus(paperList: NormalizedLiteraturePaper[], diagnostics: LiteratureRetrievalDiagnostic[]): LiteratureRetrievalStatus {
  if (paperList.length === 0) return 'failed';
  return diagnostics.length > 0 ? 'partial' : 'success';
}

function resolveReportFullTextPolicy(
  requested: LiteratureRetrievalRequest['fullTextPolicy'] | undefined,
  diagnostics: LiteratureRetrievalDiagnostic[],
): LiteratureResearchReportArtifact['fullTextPolicy'] {
  if (diagnostics.some((diagnostic) => diagnostic.code === 'download-failure')) return 'metadata-only';
  if (requested === 'bounded-full-text') return 'bounded-summary';
  return requested ?? 'metadata-only';
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

function arrayStrings(items: string[] | undefined): string[] {
  return Array.isArray(items) ? items.map((item) => item.trim()).filter(Boolean) : [];
}

function normalizeDifferenceValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}
