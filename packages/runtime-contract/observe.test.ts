import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildObserveProviderCapabilityBrief,
  buildObserveRequest,
  normalizeObserveInputModality,
  normalizeObserveResponse,
} from './observe.js';

test('builds a reusable observe provider capability brief', () => {
  const brief = buildObserveProviderCapabilityBrief({
    id: 'local.example-observe',
    oneLine: 'Turns referenced screenshots and documents into bounded text observations.',
    domains: ['gui', 'gui', 'literature'],
    triggers: ['screenshot', 'ocr'],
    antiTriggers: ['environment mutation'],
    inputModalities: [
      {
        kind: 'screenshot',
        required: true,
        acceptedMimeTypes: ['image/png'],
        refRequired: true,
      },
    ],
    costClass: 'medium',
    latencyClass: 'high',
  });

  assert.equal(brief.schemaVersion, 1);
  assert.equal(brief.kind, 'observe');
  assert.deepEqual(brief.domains, ['gui', 'literature']);
  assert.equal(brief.output.kind, 'text-response');
  assert.equal(brief.repeatedInvocation.repeatedInvocationExpected, true);
  assert.match(brief.repeatedInvocation.reason, /observe provider/);
  assert.equal(brief.safetyPrivacy.contextPolicy, 'refs-and-bounded-summaries');
  assert.equal(brief.safetyPrivacy.storesRawModalities, false);
  assert.ok(brief.failureModes.includes('timeout'));
});

test('normalizes observe modalities and drops invalid modal inputs', () => {
  assert.deepEqual(normalizeObserveInputModality({
    kind: 'image',
    ref: ' artifact://image-1 ',
    mimeType: 'image/png',
    sensitivity: 'private',
  }), {
    kind: 'image',
    ref: 'artifact://image-1',
    mimeType: 'image/png',
    title: undefined,
    summary: undefined,
    sensitivity: 'private',
    metadata: undefined,
  });

  assert.equal(normalizeObserveInputModality({ kind: 'unknown', ref: 'x' }), undefined);
  assert.equal(normalizeObserveInputModality({ kind: 'image', ref: '' }), undefined);
});

test('builds instruction plus modalities to text-response observe requests', () => {
  const request = buildObserveRequest({
    providerId: 'local.example-observe',
    instruction: '  Describe the visible table headers. ',
    preferredFormat: 'json',
    modalities: [
      { kind: 'screenshot', ref: 'artifact://screen-1', summary: 'Full window' },
      { kind: 'bad', ref: 'ignored' },
    ],
  });

  assert.equal(request.providerId, 'local.example-observe');
  assert.equal(request.instruction, 'Describe the visible table headers.');
  assert.equal(request.expectedResponse.kind, 'text-response');
  assert.equal(request.expectedResponse.preferredFormat, 'json');
  assert.deepEqual(request.modalities.map((item) => item.ref), ['artifact://screen-1']);
});

test('normalizes observe responses without inlining modality payloads', () => {
  const response = normalizeObserveResponse({
    status: 'ok',
    textResponse: 'The panel contains three rows.',
    confidence: 2,
    artifactRefs: ['artifact://trace-1', 'artifact://trace-1'],
    diagnostics: ['bounded summary only'],
    latencyMs: -1,
  });

  assert.equal(response.status, 'ok');
  assert.equal(response.textResponse, 'The panel contains three rows.');
  assert.equal(response.confidence, 1);
  assert.deepEqual(response.artifactRefs, ['artifact://trace-1']);
  assert.equal(response.latencyMs, 0);
});
