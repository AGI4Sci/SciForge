import {
  createCapabilityBudgetDebitRecord,
  type CapabilityBudgetDebitLine,
  type CapabilityInvocationBudgetDebitRecord,
} from '@sciforge-ui/runtime-contract/capability-budget';
import type {
  CitationVerificationResult,
  CitationVerificationStatus,
  LiteratureProviderAttempt,
  LiteratureProviderAttemptStatus,
  LiteratureResearchReportArtifact,
  LiteratureRetrievalBudget,
  LiteratureRetrievalDiagnostic,
  LiteratureRetrievalRequest,
  LiteratureRetrievalStatus,
  LiteratureWorkEvidence,
  NormalizedLiteraturePaper,
  OfflineLiteraturePaperRecord,
  OfflineLiteratureRetrievalRunnerInput,
} from './index';

const DEFAULT_PROVIDER_IDS = ['pubmed', 'crossref', 'semantic-scholar', 'openalex', 'arxiv', 'web-search', 'scp-biomedical-search'];
const CITATION_FIELDS: CitationVerificationResult['checkedFields'] = ['doi', 'pmid', 'arxivId', 'title', 'year', 'journal'];

export function createLiteratureRetrievalBudgetDebitRecord(input: {
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
  paperListArtifactRef: string;
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
      sourceRef: input.paperListArtifactRef,
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

export function normalizeRequestedProviders(databases: string[] | undefined): string[] {
  const providers = databases?.length ? databases : DEFAULT_PROVIDER_IDS;
  return unique(providers.map(normalizeProviderId));
}

export function normalizeProviderId(providerId: string): string {
  return providerId.startsWith('literature.retrieval.') ? providerId.slice('literature.retrieval.'.length) : providerId;
}

export function providerAttempt(
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

export function paperKey(
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

export function citationVerificationForPaper(
  paper: NormalizedLiteraturePaper,
  citationMatches: boolean,
): CitationVerificationResult {
  const missingIdentifierFields = (['doi', 'pmid', 'arxivId'] as const).filter((field) => !paper[field]);
  const hasStableIdentifier = missingIdentifierFields.length < 3;
  const hasRecordScopedEvidence = paper.providerRecordRefs.length > 1;
  const status: CitationVerificationStatus = !citationMatches
    ? 'mismatch'
    : hasStableIdentifier && hasRecordScopedEvidence
      ? 'verified'
      : hasStableIdentifier
        ? 'unverified'
        : 'missing-identifiers';
  return {
    paperId: paper.id,
    providerIds: [...paper.sourceProviderIds],
    providerRecordRefs: [...paper.providerRecordRefs],
    evidenceRefs: [...paper.providerRecordRefs],
    verificationContract: 'sciforge.bibliographic-record.v1',
    checkedFields: CITATION_FIELDS,
    status,
    mismatchFields: citationMatches ? [] : ['doi', 'pmid', 'arxivId', 'title', 'year', 'journal'],
    missingIdentifierFields,
  };
}

export function finalStatus(paperList: NormalizedLiteraturePaper[], diagnostics: LiteratureRetrievalDiagnostic[]): LiteratureRetrievalStatus {
  if (paperList.length === 0) return 'failed';
  return diagnostics.length > 0 ? 'partial' : 'success';
}

export function resolveReportFullTextPolicy(
  requested: LiteratureRetrievalRequest['fullTextPolicy'] | undefined,
  diagnostics: LiteratureRetrievalDiagnostic[],
): LiteratureResearchReportArtifact['fullTextPolicy'] {
  if (diagnostics.some((diagnostic) => diagnostic.code === 'download-failure')) return 'metadata-only';
  if (requested === 'bounded-full-text') return 'bounded-summary';
  return requested ?? 'metadata-only';
}

export function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function arrayStrings(items: string[] | undefined): string[] {
  return Array.isArray(items) ? items.map((item) => item.trim()).filter(Boolean) : [];
}

export function normalizeDifferenceValue(value: string): string {
  return value.toLowerCase().replace(/\s+/g, ' ').trim();
}

export function slug(value: string): string {
  return value.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'untitled';
}
