import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest } from '../runtime-types.js';
import {
  expectedArtifactTypesForGeneratedRun,
  supplementScopeForGeneratedRun,
} from './generated-task-runner-supplement-lifecycle.js';

const baseRequest: GatewayRequest = {
  skillDomain: 'literature',
  prompt: 'Find papers about KRAS G12D and build an evidence matrix.',
  agentServerBaseUrl: 'http://agentserver.example.test',
  artifacts: [],
};

test('generated run keeps scenario research artifacts for research prompts', () => {
  assert.deepEqual(
    expectedArtifactTypesForGeneratedRun(baseRequest, ['paper-list', 'evidence-matrix']),
    ['paper-list', 'evidence-matrix'],
  );
  assert.deepEqual(
    supplementScopeForGeneratedRun(baseRequest, ['paper-list']),
    ['paper-list'],
  );
});

test('generated run filters scenario-default research artifacts for workspace coding prompts', () => {
  const codingRequest: GatewayRequest = {
    ...baseRequest,
    prompt: [
      'RCG-004 Round 1 fresh.',
      'Treat this as a SciForge self-improvement coding task.',
      'Analyze packages/contracts/runtime/capability-manifest.ts and propose a small runtime preflight patch.',
      'Include module boundary, likely tests, and why the plan is not prompt/provider/port/session specific.',
    ].join(' '),
  };

  assert.deepEqual(
    expectedArtifactTypesForGeneratedRun(codingRequest, [
      'research-report',
      'paper-list',
      'evidence-matrix',
      'notebook-timeline',
      'runtime-context-summary',
    ]),
    ['research-report', 'runtime-context-summary'],
  );
  assert.deepEqual(
    supplementScopeForGeneratedRun(codingRequest, ['paper-list', 'runtime-context-summary']),
    ['runtime-context-summary'],
  );
});

test('explicit expected artifacts remain authoritative for coding prompts', () => {
  const explicitRequest: GatewayRequest = {
    ...baseRequest,
    prompt: 'Build a test helper for a repository module.',
    expectedArtifactTypes: ['paper-list'],
  };

  assert.deepEqual(
    expectedArtifactTypesForGeneratedRun(explicitRequest, ['evidence-matrix']),
    ['paper-list', 'evidence-matrix'],
  );
});
