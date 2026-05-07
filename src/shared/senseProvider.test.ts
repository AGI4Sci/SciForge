import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildSenseProviderCapabilityBrief,
  buildSenseRequest,
  normalizeSenseInputModality,
  normalizeSenseResponse,
} from './senseProvider';

test('builds a reusable sense provider capability brief', () => {
  const brief = buildSenseProviderCapabilityBrief({
    id: 'local.example-sense',
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
  assert.equal(brief.kind, 'sense');
  assert.deepEqual(brief.domains, ['gui', 'literature']);
  assert.equal(brief.output.kind, 'text-response');
  assert.equal(brief.repeatedInvocation.repeatedInvocationExpected, true);
  assert.equal(brief.safetyPrivacy.contextPolicy, 'refs-and-bounded-summaries');
  assert.equal(brief.safetyPrivacy.storesRawModalities, false);
  assert.ok(brief.failureModes.includes('timeout'));
});

test('normalizes sense modalities and drops invalid modal inputs', () => {
  assert.deepEqual(normalizeSenseInputModality({
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

  assert.equal(normalizeSenseInputModality({ kind: 'unknown', ref: 'x' }), undefined);
  assert.equal(normalizeSenseInputModality({ kind: 'image', ref: '' }), undefined);
});

test('builds instruction plus modalities to text-response requests', () => {
  const request = buildSenseRequest({
    providerId: 'local.example-sense',
    instruction: '  Describe the visible table headers. ',
    preferredFormat: 'json',
    modalities: [
      { kind: 'screenshot', ref: 'artifact://screen-1', summary: 'Full window' },
      { kind: 'bad', ref: 'ignored' },
    ],
  });

  assert.equal(request.providerId, 'local.example-sense');
  assert.equal(request.instruction, 'Describe the visible table headers.');
  assert.equal(request.expectedResponse.kind, 'text-response');
  assert.equal(request.expectedResponse.preferredFormat, 'json');
  assert.deepEqual(request.modalities.map((item) => item.ref), ['artifact://screen-1']);
});

test('normalizes sense responses without inlining modality payloads', () => {
  const response = normalizeSenseResponse({
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
