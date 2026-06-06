import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COMPUTER_USE_ACTION_REQUEST_SCHEMA_VERSION,
  COMPUTER_USE_ACTION_RESULT_SCHEMA_VERSION,
  computerUseActionRequestSchema,
  computerUseActionResultSchema,
  type ComputerUseActionRequest,
  type ComputerUseActionResult,
} from './action-schema.js';

const forbiddenSchemaTerms = [
  /tools\/computer-use-next/i,
  /\bbase64\b/i,
  /\braw(?:Image|Screenshot|Payload|Data)?\b/i,
  /\bimageData\b/i,
  /\bdataUrl\b/i,
  /\bproviderPayload\b/i,
  /\bapiKey\b/i,
  /\bsecret\b/i,
  /\bprivate(?:Model|Provider)\b/i,
  /\bmodelName\b/i,
  /\bproviderOptions\b/i,
];

test('Computer Use action loop request/result schema versions are owned by the package', () => {
  assert.equal(COMPUTER_USE_ACTION_REQUEST_SCHEMA_VERSION, 'sciforge.computer-use.request.v1');
  assert.equal(COMPUTER_USE_ACTION_RESULT_SCHEMA_VERSION, 'sciforge.computer-use.result.v1');
  assert.equal(computerUseActionRequestSchema.$id, COMPUTER_USE_ACTION_REQUEST_SCHEMA_VERSION);
  assert.equal(computerUseActionResultSchema.$id, COMPUTER_USE_ACTION_RESULT_SCHEMA_VERSION);
});

test('Computer Use action loop schemas require refs-first request and result fields', () => {
  assert.deepEqual(computerUseActionRequestSchema.required, [
    'schemaVersion',
    'actionLoopId',
    'instruction',
    'traceRefs',
    'screenshotRefs',
    'artifactRefs',
  ]);
  assert.deepEqual(computerUseActionResultSchema.required, [
    'schemaVersion',
    'actionLoopId',
    'status',
    'traceRefs',
    'screenshotRefs',
    'artifactRefs',
  ]);

  for (const schema of [computerUseActionRequestSchema, computerUseActionResultSchema]) {
    assert.equal(schema.properties.traceRefs.type, 'array');
    assert.equal(schema.properties.traceRefs.items.type, 'string');
    assert.equal(schema.properties.screenshotRefs.type, 'array');
    assert.equal(schema.properties.screenshotRefs.items.type, 'string');
    assert.equal(schema.properties.artifactRefs.type, 'array');
    assert.equal(schema.properties.artifactRefs.items.type, 'string');
  }
});

test('Computer Use action loop schema JSON excludes tool-owned and raw provider payload fields', () => {
  const schemaJson = JSON.stringify([computerUseActionRequestSchema, computerUseActionResultSchema]);

  for (const forbidden of forbiddenSchemaTerms) {
    assert.doesNotMatch(schemaJson, forbidden);
  }
});

test('Computer Use action loop types expose refs-first request/result payloads', () => {
  const request = {
    schemaVersion: COMPUTER_USE_ACTION_REQUEST_SCHEMA_VERSION,
    actionLoopId: 'cu-loop-1',
    instruction: 'Summarize the selected window.',
    traceRefs: ['trace:cu-loop-1/planner.json'],
    screenshotRefs: ['image:cu-loop-1/current.png'],
    artifactRefs: ['artifact:cu-loop-1/request.json'],
    targetRefs: ['window:TextEdit/1'],
    contextRefs: ['workspace:current'],
  } satisfies ComputerUseActionRequest;

  const result = {
    schemaVersion: COMPUTER_USE_ACTION_RESULT_SCHEMA_VERSION,
    actionLoopId: request.actionLoopId,
    status: 'completed',
    traceRefs: ['trace:cu-loop-1/result.json'],
    screenshotRefs: ['image:cu-loop-1/final.png'],
    artifactRefs: ['artifact:cu-loop-1/output.md'],
    evidenceRefs: ['evidence:cu-loop-1/verification.json'],
  } satisfies ComputerUseActionResult;

  assert.equal(request.traceRefs[0], 'trace:cu-loop-1/planner.json');
  assert.equal(result.status, 'completed');
});
