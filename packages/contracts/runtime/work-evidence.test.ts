import assert from 'node:assert/strict';
import test from 'node:test';

import {
  collectWorkEvidenceFromBackendEvent,
  parseWorkEvidence,
  summarizeWorkEvidenceForHandoff,
} from './work-evidence';
import { adaptBackendToolEventToWorkEvidence } from './work-evidence-adapter';

test('runtime contract package owns WorkEvidence parsing and handoff summaries', () => {
  const parsed = parseWorkEvidence({
    kind: 'retrieval',
    status: 'empty',
    provider: 'generic-search',
    input: { query: 'recent records' },
    resultCount: 0,
    outputSummary: 'Provider returned no records.',
    evidenceRefs: ['trace:search-1'],
    recoverActions: ['Try a broader query.'],
    diagnostics: ['provider status 200 totalResults=0'],
  });

  assert.equal(parsed.ok, true);
  const summary = summarizeWorkEvidenceForHandoff([parsed.value], { maxItems: 1 });
  assert.equal(summary?.count, 1);
  assert.equal(summary?.items[0]?.kind, 'retrieval');
  assert.deepEqual(summary?.items[0]?.recoverActions, ['Try a broader query.']);
});

test('runtime contract package adapts backend tool events to WorkEvidence', () => {
  const evidence = adaptBackendToolEventToWorkEvidence({
    type: 'tool-result',
    operation_name: 'search_documents',
    query: 'structured evidence',
    response: {
      status: 200,
      results: [{ id: 'a' }, { id: 'b' }],
    },
    trace_id: 'search-documents',
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.kind, 'retrieval');
  assert.equal(evidence[0]?.status, 'success');
  assert.equal(evidence[0]?.resultCount, 2);
  assert.deepEqual(evidence[0]?.evidenceRefs, ['trace:search-documents']);
  assert.ok(evidence[0]?.diagnostics?.includes('httpStatus=200'));
});

test('runtime contract package preserves explicit WorkEvidence over adapted event hints', () => {
  const evidence = collectWorkEvidenceFromBackendEvent({
    workEvidence: [{
      kind: 'fetch',
      status: 'success',
      evidenceRefs: ['trace:fetch'],
      recoverActions: [],
    }],
    type: 'tool-result',
    action: 'http_request',
    url: 'https://example.test/data.json',
    status: 'completed',
    traceId: 'fetch',
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0]?.kind, 'fetch');
  assert.deepEqual(evidence[0]?.evidenceRefs, ['trace:fetch']);
});
