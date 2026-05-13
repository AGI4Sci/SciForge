import assert from 'node:assert/strict';

import { loadCoreCapabilityManifestRegistry } from '../../src/runtime/capability-manifest-registry.js';
import {
  deriveLiteratureBilingualReport,
  deriveLiteratureCitationCorrection,
  runOfflineLiteratureRetrieval,
  validateOfflineLiteratureRetrievalOutput,
  type OfflineLiteratureRetrievalOutput,
} from '../../packages/skills/literature/index.js';

const registry = loadCoreCapabilityManifestRegistry();
const manifest = registry.getManifest('literature.retrieval');
assert.ok(manifest, 'literature.retrieval manifest must be registered');
assert.equal(manifest.kind, 'composed');
assert.deepEqual(manifest.domains, ['literature', 'research']);
assert.equal(manifest.costClass ?? 'medium', 'medium');
assert.equal(manifest.latencyClass ?? 'high', 'high');
assert.equal(manifest.sideEffectClass ?? 'external', 'external');
assert.deepEqual(manifest.metadata?.producesArtifactTypes, [
  'paper-list',
  'evidence-matrix',
  'research-report',
  'sourceProvenance',
  'workEvidence',
  'providerAttempts',
  'citationVerificationResults',
]);
assert.deepEqual(manifest.metadata?.budget, {
  maxProviders: 3,
  maxResultItems: 30,
  perProviderTimeoutMs: 10000,
  maxDownloadBytes: 25000000,
  maxRetries: 1,
  exhaustedPolicy: 'partial-payload',
});
assert.deepEqual(manifest.metadata?.fullTextBudget, {
  maxFullTextDownloads: 3,
  promptPolicy: 'refs-first-bounded-summary-only',
});
assert.deepEqual(manifest.metadata?.citationFields, ['doi', 'pmid', 'arxivId', 'title', 'year', 'journal']);

const providerIds = new Set(manifest.providers.map((provider) => provider.id));
for (const providerId of [
  'literature.retrieval.pubmed',
  'literature.retrieval.openalex',
  'literature.retrieval.arxiv',
]) {
  assert.ok(providerIds.has(providerId), `${providerId} provider should be declared`);
}

const graph = registry.projectHarnessCandidates({
  preferredCapabilityIds: ['literature.retrieval'],
  availableProviders: ['literature.retrieval.pubmed', 'literature.retrieval.openalex', 'literature.retrieval.arxiv'],
});
const candidate = graph.candidates.find((item) => item.id === 'literature.retrieval');
assert.ok(candidate, 'literature.retrieval should enter the unified capability graph');
assert.equal(candidate.kind, 'composed');
assert.equal(candidate.costClass, 'medium');
assert.equal(candidate.latencyClass, 'long');
assert.equal(candidate.sideEffectClass, 'external');
assert.equal(candidate.budget?.maxProviders, 3);
assert.equal(candidate.budget?.maxResultItems, 30);
assert.equal(candidate.budget?.perProviderTimeoutMs, 10000);
assert.equal(candidate.budget?.maxDownloadBytes, 25000000);

const success = checked(runOfflineLiteratureRetrieval({
  request: {
    query: 'agentic literature retrieval scientific workflows',
    databases: ['openalex', 'pubmed', 'arxiv'],
    maxResults: 30,
    includeAbstracts: true,
    fullTextPolicy: 'bounded-full-text',
  },
  providerFixtures: [
    {
      providerId: 'literature.retrieval.openalex',
      records: [{
        providerRecordId: 'openalex-w1',
        title: 'Agentic literature retrieval for scientific workflows',
        year: 2026,
        journal: 'SciForge Mock Proceedings',
        doi: '10.5555/sciforge.2026.1',
        abstract: 'A mock abstract from OpenAlex.',
        fullTextRef: 'artifact:paper-fulltext-openalex-w1',
      }],
    },
    {
      providerId: 'pubmed',
      records: [{
        providerRecordId: 'pmid-123456',
        title: 'Agentic literature retrieval for scientific workflows',
        year: 2026,
        journal: 'SciForge Mock Proceedings',
        doi: '10.5555/sciforge.2026.1',
        pmid: '123456',
        abstract: 'A duplicate mock abstract from PubMed.',
      }],
    },
    {
      providerId: 'arxiv',
      records: [{
        providerRecordId: '2605.00001',
        title: 'Offline normalizers for research agents',
        year: 2026,
        arxivId: '2605.00001',
      }],
    },
  ],
}));
assert.equal(success.status, 'success');
assert.equal(success.paperList.length, 2, 'OpenAlex/PubMed duplicate should dedupe by DOI');
assert.ok(success.sourceProvenance.some((entry) => (
  entry.paperId === 'paper:doi:10.5555/sciforge.2026.1'
  && entry.includedProviderIds.includes('literature.retrieval.openalex')
  && entry.includedProviderIds.includes('literature.retrieval.pubmed')
)));
assert.deepEqual(success.workEvidence[0]?.artifactRefs, ['artifact:paper-list', 'artifact:evidence-matrix', 'artifact:research-report']);
assert.equal(success.evidenceMatrix.length, success.paperList.length);
assert.equal(success.researchReport.ref, 'artifact:research-report');
assert.equal(success.researchReport.fullTextPolicy, 'bounded-summary');
assert.ok(success.providerAttempts.every((attempt) => attempt.status === 'success'));
assert.ok(success.citationVerificationResults.some((result) => result.status === 'verified'));
assert.equal(success.budgetDebits?.length, 1);
const successDebit = success.budgetDebits?.[0];
assert.ok(successDebit, 'normal success should emit a budget debit record');
assert.equal(successDebit.capabilityId, 'literature.retrieval');
assert.deepEqual(success.workEvidence[0]?.budgetDebitRefs, [successDebit.debitId]);
assert.ok(success.providerAttempts.every((attempt) => attempt.budgetDebitRefs?.includes(successDebit.debitId)));
assert.deepEqual(successDebit.sinkRefs.workEvidenceRefs, [success.workEvidence[0]?.id]);
assert.ok(successDebit.sinkRefs.auditRefs.includes('audit:literature-retrieval-runner'));
assert.ok(successDebit.subjectRefs.includes('artifact:paper-list'));
assert.ok(successDebit.debitLines.some((line) => line.dimension === 'providers' && line.amount === 3));
assert.ok(successDebit.debitLines.some((line) => line.dimension === 'resultItems' && line.amount === 2));

const empty = checked(runOfflineLiteratureRetrieval({
  request: { query: 'no-result control', databases: ['pubmed'] },
  providerFixtures: [{ providerId: 'pubmed', records: [] }],
}));
assert.equal(empty.status, 'failed');
assert.equal(empty.diagnostics[0]?.code, 'empty-results');
assert.equal(empty.providerAttempts[0]?.status, 'empty');

const overBudget = checked(runOfflineLiteratureRetrieval({
  request: { query: 'budgeted result list', databases: ['arxiv'], maxResults: 50 },
  providerFixtures: [{
    providerId: 'arxiv',
    records: Array.from({ length: 31 }, (_, index) => ({
      providerRecordId: `arxiv-${index}`,
      title: `Budget Paper ${index}`,
      year: 2026,
      arxivId: `2605.${String(index).padStart(5, '0')}`,
    })),
  }],
}));
assert.equal(overBudget.status, 'partial');
assert.equal(overBudget.paperList.length, 30);
assert.equal(overBudget.diagnostics[0]?.code, 'result-budget-exceeded');

const timeout = checked(runOfflineLiteratureRetrieval({
  request: { query: 'timeout fallback paper', databases: ['pubmed', 'openalex'] },
  providerFixtures: [
    {
      providerId: 'pubmed',
      status: 'timeout',
      elapsedMs: 11000,
      records: [{ title: 'Ignored timeout paper', year: 2026, pmid: '123456' }],
    },
    {
      providerId: 'openalex',
      records: [{ title: 'Timeout fallback paper', year: 2026, doi: '10.5555/timeout.fallback' }],
    },
  ],
}));
assert.equal(timeout.status, 'partial');
assert.equal(timeout.providerAttempts[0]?.status, 'timeout');
assert.equal(timeout.providerAttempts[1]?.status, 'success');
assert.equal(timeout.diagnostics[0]?.code, 'provider-timeout');
const timeoutDebit = timeout.budgetDebits?.[0];
assert.ok(timeoutDebit, 'provider timeout should emit a budget debit record');
assert.equal(timeout.providerAttempts[0]?.budgetDebitRefs?.[0], timeoutDebit.debitId);
assert.equal(timeout.workEvidence[0]?.budgetDebitRefs?.[0], timeoutDebit.debitId);
assert.equal(timeoutDebit.exceeded, true);
assert.ok(timeoutDebit.exhaustedDimensions.includes('wallMs'));
assert.ok(timeoutDebit.debitLines.some((line) => (
  line.dimension === 'wallMs'
  && line.sourceRef === `providerAttempt:${timeout.providerAttempts[0]?.id}`
  && typeof line.remaining === 'number'
  && line.remaining < 0
)));

const downloadFailure = checked(runOfflineLiteratureRetrieval({
  request: { query: 'full text failure paper', databases: ['arxiv'], fullTextPolicy: 'bounded-full-text' },
  providerFixtures: [{
    providerId: 'arxiv',
    records: [{
      title: 'Full text unavailable paper',
      year: 2026,
      arxivId: '2605.99999',
      fullTextRef: 'artifact:fulltext-2605-99999',
      downloadFailed: true,
    }],
  }],
}));
assert.equal(downloadFailure.status, 'partial');
assert.equal(downloadFailure.diagnostics[0]?.code, 'download-failure');
assert.equal(downloadFailure.researchReport.fullTextPolicy, 'metadata-only');

const mismatch = checked(runOfflineLiteratureRetrieval({
  request: { query: 'unverified citation', databases: ['openalex'] },
  providerFixtures: [{
    providerId: 'openalex',
    records: [{
      title: 'Unverified citation',
      year: 2026,
      doi: '10.5555/mismatch',
      citationMatches: false,
    }],
  }],
}));
assert.equal(mismatch.status, 'partial');
assert.equal(mismatch.citationVerificationResults[0]?.status, 'mismatch');
assert.equal(mismatch.diagnostics[0]?.code, 'citation-mismatch');

const providerBudget = checked(runOfflineLiteratureRetrieval({
  request: { query: 'provider budget cap', databases: ['pubmed', 'openalex', 'arxiv', 'crossref'] },
  providerFixtures: [
    { providerId: 'pubmed', records: [{ title: 'PubMed Paper', year: 2026, pmid: '1' }] },
    { providerId: 'openalex', records: [{ title: 'OpenAlex Paper', year: 2026, doi: '10.5555/openalex' }] },
    { providerId: 'arxiv', records: [{ title: 'Arxiv Paper', year: 2026, arxivId: '2605.00002' }] },
    { providerId: 'crossref', records: [{ title: 'Crossref Paper', year: 2026, doi: '10.5555/crossref' }] },
  ],
}));
assert.equal(providerBudget.status, 'partial');
assert.equal(providerBudget.providerAttempts.length, 3);
assert.ok(providerBudget.diagnostics.some((diagnostic) => diagnostic.code === 'provider-budget-exceeded'));
assert.ok(!providerBudget.providerAttempts.some((attempt) => attempt.providerId === 'literature.retrieval.crossref'));

const multiSourceRewrite = checked(runOfflineLiteratureRetrieval({
  request: {
    query: 'agentic scientific workflow planning',
    databases: ['pubmed', 'semantic-scholar', 'arxiv', 'web-search'],
    includeAbstracts: true,
    excludedProviderIds: ['web-search'],
  },
  budget: { maxProviders: 4 },
  providerFixtures: [
    {
      providerId: 'pubmed',
      trustLevel: 'high',
      records: [{
        providerRecordId: 'pmid-777',
        title: 'Agentic scientific workflow planning',
        year: 2026,
        journal: 'Journal of Scientific Agents',
        doi: '10.5555/multisource.1',
        pmid: '777',
        abstract: 'PubMed fixture abstract.',
      }],
    },
    {
      providerId: 'semantic-scholar',
      trustLevel: 'medium',
      records: [{
        providerRecordId: 's2-777',
        title: 'Agentic Scientific Workflow Planning: Evidence and Benchmarks',
        year: 2026,
        journal: 'Journal of Scientific Agents',
        doi: '10.5555/multisource.1',
        abstract: 'Semantic Scholar duplicate with a title variant.',
      }],
    },
    {
      providerId: 'arxiv',
      trustLevel: 'medium',
      records: [{
        providerRecordId: '2605.42424',
        title: 'Offline planning agents for lab workflows',
        year: 2026,
        arxivId: '2605.42424',
      }],
    },
    {
      providerId: 'web-search',
      trustLevel: 'low',
      exclusionReason: 'User removed low-trust web source before rewriting the conclusion.',
      records: [{
        providerRecordId: 'blog-777',
        title: 'Agentic scientific workflow planning will replace all lab software',
        year: 2025,
        doi: '10.5555/multisource.1',
        url: 'https://example.test/low-trust-blog',
      }],
    },
  ],
}));
assert.equal(multiSourceRewrite.status, 'partial');
assert.equal(multiSourceRewrite.paperList.length, 2, 'PubMed/Semantic Scholar/Web duplicate should dedupe by DOI, with low-trust web excluded');
assert.ok(!multiSourceRewrite.paperList.some((paper) => paper.sourceProviderIds.includes('web-search')));
assert.doesNotMatch(multiSourceRewrite.researchReport.boundedSummary, /replace all lab software/i);
const duplicateProvenance = multiSourceRewrite.sourceProvenance.find((entry) => entry.paperId === 'paper:doi:10.5555/multisource.1');
assert.ok(duplicateProvenance, 'duplicate DOI paper should carry provenance');
assert.deepEqual(duplicateProvenance.includedProviderIds.sort(), [
  'literature.retrieval.pubmed',
  'literature.retrieval.semantic-scholar',
]);
assert.deepEqual(duplicateProvenance.excludedProviderIds, ['literature.retrieval.web-search']);
assert.ok(duplicateProvenance.differences.some((difference) => difference.field === 'title'));
assert.ok(multiSourceRewrite.diagnostics.some((diagnostic) => diagnostic.code === 'source-excluded' && diagnostic.providerId === 'literature.retrieval.web-search'));

const citationCorrectionSeed = checked(runOfflineLiteratureRetrieval({
  request: {
    query: 'citation correction target',
    databases: ['web-search', 'pubmed', 'arxiv'],
    includeAbstracts: true,
  },
  providerFixtures: [
    {
      providerId: 'web-search',
      trustLevel: 'low',
      records: [{
        providerRecordId: 'blog-777',
        title: 'Overclaimed citation',
        year: 2026,
        doi: '10.5555/correct.1',
        citationMatches: false,
      }],
    },
    {
      providerId: 'pubmed',
      trustLevel: 'high',
      records: [{
        providerRecordId: 'pmid-777',
        title: 'Careful citation',
        year: 2026,
        journal: 'Journal of Scientific Agents',
        doi: '10.5555/correct.1',
        pmid: '777',
      }],
    },
    {
      providerId: 'arxiv',
      records: [{
        providerRecordId: '2605.11111',
        title: 'Control paper',
        year: 2026,
        arxivId: '2605.11111',
      }],
    },
  ],
}));
const correction = deriveLiteratureCitationCorrection({
  output: citationCorrectionSeed,
  target: { providerRecordRef: 'provider:web-search:blog-777' },
  reason: 'User flagged the web-search citation as untrusted.',
  action: 'exclude-provider-record',
});
assert.equal(correction.artifactType, 'citation-correction');
assert.equal(correction.correctionStatus, 'corrected');
assert.equal(correction.targetPaperId, 'paper:doi:10.5555/correct.1');
assert.ok(correction.sourceRefs.includes('provider:web-search:blog-777'));
assert.ok(correction.correctedSegment?.removedEvidenceRefs.includes('provider:web-search:blog-777'));
assert.ok(correction.correctedSegment?.retainedEvidenceRefs.includes('provider:pubmed:pmid-777'));
assert.ok(correction.untouchedPaperIds.includes('paper:arxiv:2605.11111'));
assert.equal(correction.affectedEvidenceRows.some((row) => row.paperId === 'paper:arxiv:2605.11111'), false);
assert.match(correction.correctionReport, /paper:doi:10\.5555\/correct\.1/);
assert.deepEqual(
  citationCorrectionSeed.evidenceMatrix.find((row) => row.paperId === 'paper:doi:10.5555/correct.1')?.evidenceRefs.sort(),
  ['provider:pubmed:pmid-777', 'provider:web-search:blog-777'],
  'citation correction must be derived without mutating the original retrieval output',
);

const originalSuccessReportSummary = success.researchReport.boundedSummary;
const bilingualReport = deriveLiteratureBilingualReport({
  output: success,
  sourceLanguage: 'zh',
  targetLanguage: 'en',
  executiveSummary: {
    text: 'English executive summary: retrieval agents can normalize provider records while keeping evidence refs auditable.',
    sourceRefs: ['artifact:research-report', 'provider:openalex:openalex-w1'],
  },
  glossaryTerms: [
    {
      sourceTerm: '证据矩阵',
      targetTerm: 'evidence matrix',
      sourceRefs: ['artifact:evidence-matrix', 'provider:openalex:openalex-w1'],
      paperIds: ['paper:doi:10.5555/sciforge.2026.1'],
      note: 'Term is derived from the retrieval artifact contract.',
    },
    {
      sourceTerm: '全文预算',
      targetTerm: 'full-text budget',
      sourceRefs: ['artifact:research-report'],
      confidence: 'derived',
    },
  ],
});
assert.equal(bilingualReport.artifactType, 'bilingual-literature-report');
assert.equal(bilingualReport.parentArtifactRef, 'artifact:research-report');
assert.equal(bilingualReport.metadata.derivation.schemaVersion, 'sciforge.artifact-derivation.v1');
assert.equal(bilingualReport.metadata.derivation.kind, 'rewrite');
assert.ok(bilingualReport.metadata.derivation.sourceRefs.includes('artifact:research-report'));
assert.deepEqual(bilingualReport.derivedArtifactRefs, [
  'artifact:research-report#derived:bilingual-executive-summary',
  'artifact:research-report#derived:bilingual-glossary',
]);
assert.deepEqual(bilingualReport.sourceArtifactRefs, ['artifact:paper-list', 'artifact:evidence-matrix', 'artifact:research-report']);
assert.equal(bilingualReport.sourceLanguage, 'zh');
assert.equal(bilingualReport.targetLanguage, 'en');
assert.equal(bilingualReport.status, 'ready');
assert.equal(bilingualReport.sourceReport.boundedSummary, originalSuccessReportSummary);
assert.match(bilingualReport.englishExecutiveSummary.text, /English executive summary/);
assert.equal(bilingualReport.englishExecutiveSummary.metadata.derivation.kind, 'summary');
assert.equal(bilingualReport.englishExecutiveSummary.metadata.derivation.targetLanguage, 'en');
assert.ok(bilingualReport.englishExecutiveSummary.sourceRefs.includes('artifact:research-report'));
assert.ok(bilingualReport.englishExecutiveSummary.sourceRefs.includes('provider:openalex:openalex-w1'));
assert.equal(bilingualReport.glossary.entries.length, 2);
assert.equal(bilingualReport.glossary.metadata.derivation.kind, 'glossary');
assert.ok(bilingualReport.glossary.entries.some((entry) => (
  entry.sourceTerm === '证据矩阵'
  && entry.targetTerm === 'evidence matrix'
  && entry.paperIds.includes('paper:doi:10.5555/sciforge.2026.1')
  && entry.sourceRefs.includes('artifact:evidence-matrix')
)));
assert.ok(bilingualReport.lineage.includes('artifact:research-report -> artifact:research-report#derived:bilingual-executive-summary'));
assert.ok(bilingualReport.lineage.includes('artifact:research-report -> artifact:research-report#derived:bilingual-glossary'));
assert.equal(success.researchReport.boundedSummary, originalSuccessReportSummary, 'bilingual report must be derived without mutating the original report');

console.log('[ok] literature.retrieval capability has offline provider runner/normalizer contract with auditable outputs and failure outcomes');

function checked(output: OfflineLiteratureRetrievalOutput): OfflineLiteratureRetrievalOutput {
  assert.deepEqual(validateOfflineLiteratureRetrievalOutput(output), []);
  assert.ok(output.paperList, 'paper-list output should be emitted');
  assert.ok(output.evidenceMatrix, 'evidence-matrix output should be emitted');
  assert.ok(output.researchReport, 'research-report output should be emitted');
  assert.ok(output.sourceProvenance, 'sourceProvenance output should be emitted');
  assert.ok(output.workEvidence, 'workEvidence output should be emitted');
  assert.ok(output.providerAttempts, 'providerAttempts output should be emitted');
  assert.ok(output.citationVerificationResults, 'citationVerificationResults output should be emitted');
  assert.ok(output.budgetDebits, 'budgetDebits audit output should be emitted');
  return output;
}
