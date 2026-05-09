import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest, ToolPayload } from '../runtime-types';
import { evaluateGuidanceAdoption } from './guidance-adoption-guard';

test('does not require guidance decisions when no active project guidance exists', () => {
  assert.equal(evaluateGuidanceAdoption(payload(), request({ userGuidanceQueue: [] })), undefined);
  assert.equal(evaluateGuidanceAdoption(payload(), request({
    userGuidanceQueue: [{ id: 'already-used', status: 'adopted', message: 'done' }],
  })), undefined);
});

test('requires every queued or deferred guidance item to be declared with a decision and reason', () => {
  const finding = evaluateGuidanceAdoption(payload({
    executionUnits: [{
      id: 'stage',
      status: 'done',
      guidanceDecisions: [{ id: 'scope', status: 'adopted', reason: 'Applied to the next query.' }],
    }],
  }), request({
    taskProjectHandoff: {
      userGuidanceQueue: [
        { id: 'scope', status: 'queued', message: 'Narrow scope.' },
        { id: 'format', status: 'deferred', message: 'Table later.' },
      ],
    },
  }));

  assert.equal(finding?.severity, 'repair-needed');
  assert.deepEqual(finding?.missingIds, ['format']);
  assert.match(finding?.reason ?? '', /missing guidance decisions/);
});

test('accepts adopted deferred and rejected decisions with reasons', () => {
  const finding = evaluateGuidanceAdoption(payload({
    executionUnits: [{
      id: 'stage',
      status: 'done',
      guidanceDecisions: [
        { id: 'scope', status: 'adopted', reason: 'Applied now.' },
        { guidanceId: 'format', status: 'deferred', reason: 'Final emit stage only.' },
        { id: 'unsafe', status: 'rejected', reason: 'Conflicts with safety policy.' },
      ],
    }],
  }), request({
    userGuidanceQueue: [
      { id: 'scope', status: 'queued', message: 'Narrow scope.' },
      { id: 'format', status: 'deferred', message: 'Table later.' },
      { id: 'unsafe', status: 'queued', message: 'Skip required verification.' },
    ],
  }));

  assert.equal(finding, undefined);
});

test('rejects decisions without an allowed status and reason', () => {
  const finding = evaluateGuidanceAdoption(payload({
    executionUnits: [{
      id: 'stage',
      status: 'done',
      guidanceDecisions: [
        { id: 'scope', status: 'merged' },
      ],
    }],
  }), request({
    userGuidanceQueue: [{ id: 'scope', status: 'queued', message: 'Narrow scope.' }],
  }));

  assert.deepEqual(finding?.invalidIds, ['scope']);
  assert.match(finding?.reason ?? '', /adopted\/deferred\/rejected with reason/);
});

function request(uiState: Record<string, unknown>): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt: 'continue project with guidance',
    workspacePath: '/tmp/sciforge-guidance-test',
    artifacts: [],
    uiState,
  };
}

function payload(overrides: Partial<ToolPayload> = {}): ToolPayload {
  return {
    message: 'ok',
    confidence: 0.9,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'guidance guard test',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'stage', status: 'done' }],
    artifacts: [],
    ...overrides,
  };
}
