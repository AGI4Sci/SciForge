import assert from 'node:assert/strict';

import { loadCoreCapabilityManifestRegistry } from '../../src/runtime/capability-manifest-registry.js';
import {
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

console.log('[ok] literature.retrieval capability has offline provider runner/normalizer contract with auditable outputs and failure outcomes');

function checked(output: OfflineLiteratureRetrievalOutput): OfflineLiteratureRetrievalOutput {
  assert.deepEqual(validateOfflineLiteratureRetrievalOutput(output), []);
  assert.ok(output.paperList, 'paper-list output should be emitted');
  assert.ok(output.evidenceMatrix, 'evidence-matrix output should be emitted');
  assert.ok(output.researchReport, 'research-report output should be emitted');
  assert.ok(output.workEvidence, 'workEvidence output should be emitted');
  assert.ok(output.providerAttempts, 'providerAttempts output should be emitted');
  assert.ok(output.citationVerificationResults, 'citationVerificationResults output should be emitted');
  assert.ok(output.budgetDebits, 'budgetDebits audit output should be emitted');
  return output;
}
