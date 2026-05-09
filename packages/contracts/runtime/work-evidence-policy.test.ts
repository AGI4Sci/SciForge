import assert from 'node:assert/strict';
import test from 'node:test';

import { evaluateWorkEvidencePolicy } from './work-evidence-policy';

test('package WorkEvidence policy flags completed external retrieval with zero results and no diagnostics', () => {
  const finding = evaluateWorkEvidencePolicy({
    message: 'Completed search. Retrieved 0 papers from the provider.',
    confidence: 0.92,
    claimType: 'fact',
    evidenceLevel: 'high',
    reasoningTrace: 'Search completed successfully with 0 records.',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'search', status: 'done' }],
    artifacts: [],
  }, {
    prompt: 'Retrieve recent literature about contract-aware agents.',
  });

  assert.equal(finding?.kind, 'external-empty-result-without-diagnostics');
  assert.equal(finding?.severity, 'repair-needed');
});

test('package WorkEvidence policy allows external retrieval when WorkEvidence carries provider diagnostics', () => {
  const finding = evaluateWorkEvidencePolicy({
    message: 'Completed search with no matching records.',
    confidence: 0.82,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'Provider status 200 totalResults=0 after fallback.',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'search', status: 'done' }],
    artifacts: [],
    workEvidence: [{
      kind: 'retrieval',
      status: 'empty',
      provider: 'provider.fixture',
      resultCount: 0,
      outputSummary: 'Provider status 200 totalResults=0.',
      evidenceRefs: ['trace:provider-fixture'],
      recoverActions: ['Fallback query was attempted.'],
    }],
  }, {
    prompt: 'Retrieve recent public records.',
  });

  assert.equal(finding, undefined);
});

test('package WorkEvidence policy flags successful external WorkEvidence without durable refs', () => {
  const finding = evaluateWorkEvidencePolicy({
    message: 'Fetch completed successfully.',
    confidence: 0.9,
    claimType: 'fact',
    evidenceLevel: 'high',
    reasoningTrace: 'Fetched a source and summarized it.',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'fetch', status: 'done' }],
    artifacts: [],
    workEvidence: [{
      kind: 'fetch',
      status: 'success',
      provider: 'http.fixture',
      input: 'https://example.test/source',
      outputSummary: 'Fetched source successfully.',
      evidenceRefs: [],
      recoverActions: [],
    }],
  }, {
    prompt: 'Fetch and summarize a public page.',
  });

  assert.equal(finding?.kind, 'external-io-without-durable-evidence-ref');
});
