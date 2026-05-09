import test from 'node:test';
import assert from 'node:assert/strict';

import { adaptBackendToolEventToWorkEvidence } from '@sciforge-ui/runtime-contract/work-evidence-adapter';
import { collectWorkEvidenceFromBackendEvent } from './work-evidence-types.js';
import { normalizeAgentServerWorkspaceEvent } from './workspace-event-normalizer.js';

test('adapts generic search result facts into WorkEvidence without provider branches', () => {
  const evidence = adaptBackendToolEventToWorkEvidence({
    type: 'tool-result',
    toolName: 'web_search',
    provider: 'provider-a',
    query: 'agent benchmarks',
    status: 'completed',
    results: [{ title: 'a' }, { title: 'b' }],
    summary: '2 compact search hits',
    traceId: 'search-1',
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].kind, 'retrieval');
  assert.equal(evidence[0].status, 'success');
  assert.equal(evidence[0].provider, 'provider-a');
  assert.deepEqual(evidence[0].input, { query: 'agent benchmarks' });
  assert.equal(evidence[0].resultCount, 2);
  assert.deepEqual(evidence[0].evidenceRefs, ['trace:search-1']);
});

test('adapts common nested tool input and output envelopes without provider branches', () => {
  const evidence = adaptBackendToolEventToWorkEvidence({
    type: 'tool-result',
    name: 'generic_lookup',
    input: { query: 'nested query field' },
    output: { records: [{ id: 1 }, { id: 2 }, { id: 3 }] },
    outputRef: 'file:.sciforge/evidence/lookup.json',
    status: 'ok',
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].kind, 'retrieval');
  assert.equal(evidence[0].status, 'success');
  assert.deepEqual(evidence[0].input, { query: 'nested query field' });
  assert.equal(evidence[0].resultCount, 3);
  assert.deepEqual(evidence[0].evidenceRefs, ['file:.sciforge/evidence/lookup.json']);
});

test('adapts fetch failure from structured status and refs', () => {
  const evidence = adaptBackendToolEventToWorkEvidence({
    type: 'tool-result',
    action: 'http_request',
    url: 'https://example.test/data.json',
    httpStatus: 503,
    failureReason: 'upstream unavailable',
    recoverActions: ['try cached mirror'],
    rawRef: 'trace:fetch-raw',
  });

  assert.equal(evidence[0].kind, 'fetch');
  assert.equal(evidence[0].status, 'failed-with-reason');
  assert.equal(evidence[0].failureReason, 'upstream unavailable');
  assert.deepEqual(evidence[0].recoverActions, ['try cached mirror']);
  assert.deepEqual(evidence[0].evidenceRefs, ['trace:fetch-raw']);
});

test('adapts read command and validation facts from generic tool fields', () => {
  const evidence = collectWorkEvidenceFromBackendEvent({
    events: [
      {
        type: 'tool-result',
        operation: 'read_file',
        path: '/tmp/report.md',
        status: 'done',
        outputRef: 'file:/tmp/report.md',
      },
      {
        type: 'tool-result',
        operation: 'run_command',
        command: 'npm test',
        exitCode: 1,
        stderrRef: 'log:test-stderr',
        reason: 'test command exited non-zero',
      },
      {
        type: 'tool-result',
        operation: 'schema_validate',
        verdict: 'pass',
        status: 'passed',
        evidenceRefs: ['trace:validator'],
      },
    ],
  });

  assert.deepEqual(evidence.map((entry) => entry.kind), ['read', 'command', 'validate']);
  assert.equal(evidence[0].status, 'success');
  assert.equal(evidence[1].status, 'failed-with-reason');
  assert.equal(evidence[2].status, 'success');
});

test('normalizer attaches adapted WorkEvidence while preserving raw event', () => {
  const normalized = normalizeAgentServerWorkspaceEvent({
    type: 'tool-result',
    toolName: 'generic_search',
    query: 'work evidence contract',
    resultCount: 0,
    status: 'done',
    traceId: 'empty-search',
  });

  assert.equal(normalized.workEvidence?.[0]?.kind, 'retrieval');
  assert.equal(normalized.workEvidence?.[0]?.status, 'empty');
  assert.deepEqual(normalized.workEvidence?.[0]?.evidenceRefs, ['trace:empty-search']);
  assert.equal((normalized.raw as Record<string, unknown>).toolName, 'generic_search');
});

test('adapts snake_case and nested provider response fields for backend drift', () => {
  const evidence = adaptBackendToolEventToWorkEvidence({
    event_type: 'provider_result',
    tool_name: 'http_fetch',
    model_provider: 'provider-b',
    request: { endpoint: 'https://example.test/feed' },
    provider_status: { status_code: '429', provider: 'provider-b' },
    timed_out: true,
    fallback_exhausted: true,
    recovery_actions: ['wait for reset'],
    trace_id: 'fetch-drift',
    output_summary: 'primary provider rate-limited and fallback timed out',
  });

  assert.equal(evidence.length, 1);
  assert.equal(evidence[0].kind, 'fetch');
  assert.equal(evidence[0].status, 'failed-with-reason');
  assert.equal(evidence[0].provider, 'provider-b');
  assert.deepEqual(evidence[0].input, { url: 'https://example.test/feed' });
  assert.match(evidence[0].failureReason ?? '', /429|fallback/i);
  assert.deepEqual(evidence[0].recoverActions, ['wait for reset']);
  assert.deepEqual(evidence[0].evidenceRefs, ['trace:fetch-drift']);
  assert.ok(evidence[0].diagnostics?.includes('httpStatus=429'));
});

test('adapts nested response result counts and snake_case refs', () => {
  const evidence = adaptBackendToolEventToWorkEvidence({
    type: 'tool-result',
    operation_name: 'search_documents',
    query: 'structured evidence',
    response: {
      status: 200,
      results: [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
    },
    raw_ref: 'agentserver://raw/search-documents',
    event_id: 'evt-search-documents',
  });

  assert.equal(evidence[0].kind, 'retrieval');
  assert.equal(evidence[0].status, 'success');
  assert.equal(evidence[0].resultCount, 3);
  assert.deepEqual(evidence[0].evidenceRefs, ['agentserver://raw/search-documents', 'event:evt-search-documents']);
  assert.ok(evidence[0].diagnostics?.includes('httpStatus=200'));
});

test('does not create evidence from raw scenario or prompt metadata alone', () => {
  const evidence = adaptBackendToolEventToWorkEvidence({
    provider: 'provider-a',
    scenario: 'research',
    prompt: 'please search later',
    kind: 'retrieval',
    status: 'success',
    outputSummary: 'metadata only',
  });

  assert.deepEqual(evidence, []);
});
