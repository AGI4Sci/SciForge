import assert from 'node:assert/strict';

import { loadCoreCapabilityManifestRegistry } from '../../src/runtime/capability-manifest-registry.js';

const registry = loadCoreCapabilityManifestRegistry();
const manifest = registry.getManifest('literature.retrieval');
assert.ok(manifest, 'literature.retrieval manifest must be registered');
assert.equal(manifest.kind, 'composed');
assert.deepEqual(manifest.domains, ['literature', 'research']);
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
assert.equal(candidate.budget?.maxProviders, 3);
assert.equal(candidate.budget?.maxResultItems, 30);
assert.equal(candidate.budget?.perProviderTimeoutMs, 10000);
assert.equal(candidate.budget?.maxDownloadBytes, 25000000);

const success = evaluateMockRetrieval({
  providerId: 'literature.retrieval.openalex',
  papers: [{
    title: 'Agentic literature retrieval for scientific workflows',
    year: 2026,
    journal: 'SciForge Mock Proceedings',
    doi: '10.5555/sciforge.2026.1',
  }],
  citationMatches: true,
});
assert.equal(success.status, 'success');
assert.equal(success.paperList.length, 1);
assert.equal(success.providerAttempts[0]?.status, 'success');
assert.equal(success.citationVerificationResults[0]?.status, 'verified');

const empty = evaluateMockRetrieval({
  providerId: 'literature.retrieval.pubmed',
  papers: [],
  citationMatches: true,
});
assert.equal(empty.status, 'failed');
assert.equal(empty.diagnostics[0]?.code, 'empty-results');

const overBudget = evaluateMockRetrieval({
  providerId: 'literature.retrieval.arxiv',
  papers: Array.from({ length: 31 }, (_, index) => ({ title: `Paper ${index}`, year: 2026 })),
  citationMatches: true,
});
assert.equal(overBudget.status, 'partial');
assert.equal(overBudget.paperList.length, 30);
assert.equal(overBudget.diagnostics[0]?.code, 'budget-exceeded');

const timeout = evaluateMockRetrieval({
  providerId: 'literature.retrieval.pubmed',
  papers: [{ title: 'Timeout fallback paper', year: 2026, pmid: '123456' }],
  citationMatches: true,
  providerTimedOut: true,
});
assert.equal(timeout.status, 'partial');
assert.equal(timeout.providerAttempts[0]?.status, 'timeout');
assert.equal(timeout.diagnostics[0]?.code, 'provider-timeout');

const downloadFailure = evaluateMockRetrieval({
  providerId: 'literature.retrieval.arxiv',
  papers: [{ title: 'Full text unavailable paper', year: 2026, arxivId: '2605.00001' }],
  citationMatches: true,
  downloadFailed: true,
});
assert.equal(downloadFailure.status, 'partial');
assert.equal(downloadFailure.diagnostics[0]?.code, 'download-failure');
assert.equal(downloadFailure.researchReport.fullTextPolicy, 'metadata-only');

const mismatch = evaluateMockRetrieval({
  providerId: 'literature.retrieval.openalex',
  papers: [{ title: 'Unverified citation', year: 2026, doi: '10.5555/mismatch' }],
  citationMatches: false,
});
assert.equal(mismatch.status, 'partial');
assert.equal(mismatch.citationVerificationResults[0]?.status, 'mismatch');
assert.equal(mismatch.diagnostics[0]?.code, 'citation-mismatch');

console.log('[ok] literature.retrieval capability declares generic providers, budgets, refs-first outputs, and structured mock failure outcomes');

interface MockPaper {
  title: string;
  year: number;
  journal?: string;
  doi?: string;
  pmid?: string;
  arxivId?: string;
}

interface MockRetrievalInput {
  providerId: string;
  papers: MockPaper[];
  citationMatches: boolean;
  providerTimedOut?: boolean;
  downloadFailed?: boolean;
}

interface MockRetrievalOutput {
  status: 'success' | 'partial' | 'failed';
  paperList: MockPaper[];
  evidenceMatrix: Array<Record<string, unknown>>;
  researchReport: Record<string, unknown>;
  workEvidence: Array<Record<string, unknown>>;
  providerAttempts: Array<Record<string, unknown>>;
  citationVerificationResults: Array<Record<string, unknown>>;
  diagnostics: Array<{ code: string; message: string }>;
}

function evaluateMockRetrieval(input: MockRetrievalInput): MockRetrievalOutput {
  const maxResults = 30;
  const diagnostics: MockRetrievalOutput['diagnostics'] = [];
  const providerAttempts = [{
    providerId: input.providerId,
    status: input.providerTimedOut ? 'timeout' : input.papers.length > 0 ? 'success' : 'empty',
    resultCount: input.papers.length,
  }];
  if (input.providerTimedOut) {
    diagnostics.push({ code: 'provider-timeout', message: 'Provider exceeded perProviderTimeoutMs=10000; return bounded partial payload.' });
  }
  if (input.papers.length === 0) {
    diagnostics.push({ code: 'empty-results', message: 'Provider returned no records; return structured failure instead of success.' });
    return output('failed', [], providerAttempts, [], diagnostics);
  }

  let papers = input.papers;
  if (papers.length > maxResults) {
    diagnostics.push({ code: 'budget-exceeded', message: 'Result count exceeded maxResults=30; return bounded partial payload.' });
    papers = papers.slice(0, maxResults);
  }

  const citationVerificationResults = papers.map((paper) => ({
    title: paper.title,
    doi: paper.doi,
    pmid: paper.pmid,
    arxivId: paper.arxivId,
    year: paper.year,
    journal: paper.journal,
    checkedFields: ['doi', 'pmid', 'arxivId', 'title', 'year', 'journal'],
    status: input.citationMatches ? 'verified' : 'mismatch',
  }));
  if (!input.citationMatches) {
    diagnostics.push({ code: 'citation-mismatch', message: 'Citation identifiers or bibliographic fields disagree; return partial payload for repair.' });
  }
  if (input.downloadFailed) {
    diagnostics.push({ code: 'download-failure', message: 'Full text retrieval failed; keep metadata refs and downgrade full text policy.' });
  }
  return output(diagnostics.length ? 'partial' : 'success', papers, providerAttempts, citationVerificationResults, diagnostics);
}

function output(
  status: MockRetrievalOutput['status'],
  paperList: MockPaper[],
  providerAttempts: Array<Record<string, unknown>>,
  citationVerificationResults: Array<Record<string, unknown>>,
  diagnostics: MockRetrievalOutput['diagnostics'],
): MockRetrievalOutput {
  return {
    status,
    paperList,
    evidenceMatrix: paperList.map((paper) => ({ title: paper.title, evidenceRefs: [`paper:${paper.title}`] })),
    researchReport: {
      ref: 'artifact:research-report',
      boundedSummary: paperList.map((paper) => paper.title).join('; '),
      fullTextPolicy: diagnostics.some((diagnostic) => diagnostic.code === 'download-failure') ? 'metadata-only' : 'bounded-summary',
    },
    workEvidence: [{ kind: 'external-retrieval', providerAttempts: providerAttempts.length, artifactRefs: ['paper-list'] }],
    providerAttempts,
    citationVerificationResults,
    diagnostics,
  };
}
