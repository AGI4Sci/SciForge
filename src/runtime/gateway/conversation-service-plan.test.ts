import assert from 'node:assert/strict';
import test from 'node:test';

import { buildConversationPolicyInput, buildConversationTurnComposition } from './conversation-service-plan.js';

test('policy input composition is runtime-owned', () => {
  const input = buildConversationPolicyInput({
    schemaVersion: 'sciforge.conversation-policy.request.v1',
    requestId: 'request-1',
    turn: { turnId: 'turn-1', text: '继续', refs: [{ kind: 'file', ref: 'report.md' }] },
    history: [{ id: 'm1', role: 'assistant', content: 'prior' }],
    session: {},
    workspace: { root: '/tmp/workspace' },
    limits: { maxInlineChars: 1200 },
    policyHints: { maxCapabilities: 4 },
    capabilities: [{ id: 'capability-1' }],
    metadata: { source: 'test' },
  });

  assert.equal(input.prompt, '继续');
  assert.deepEqual(input.references, [{ kind: 'file', ref: 'report.md' }]);
  assert.deepEqual((input.session as Record<string, unknown>).messages, [{ id: 'm1', role: 'assistant', content: 'prior' }]);
  assert.deepEqual((input.session as Record<string, unknown>).artifacts, []);
  assert.deepEqual(input.limits, { maxInlineChars: 1200, maxCapabilities: 4 });
});

test('turn composition scopes session facts for isolated turns', () => {
  const composition = buildConversationTurnComposition({
    policyInput: {
      session: {
        messages: [{ id: 'm1', content: 'prior task' }],
        artifacts: [{ id: 'old-artifact' }],
        executionUnits: [{ id: 'old-unit' }],
        runs: [{ id: 'old-run' }],
      },
      references: [],
    },
    contextPolicy: { mode: 'isolate', historyReuse: { allowed: false } },
    memoryPlan: { currentReferenceFocus: [] },
    currentReferenceDigests: [{ id: 'digest-1', path: 'file:reports/current.md' }],
  });

  assert.deepEqual(composition.contextSession.artifacts, []);
  assert.deepEqual(composition.contextSession.executionUnits, []);
  assert.deepEqual(composition.contextSession.runs, []);
  assert.deepEqual(composition.contextSession.messages, [{ id: 'm1', content: 'prior task' }]);
  assert.deepEqual(composition.currentReferences, [{
    kind: 'file',
    ref: 'reports/current.md',
    title: 'current.md',
    source: 'runtime-reference-digest',
    digestId: 'digest-1',
  }]);
});

test('turn composition owns execution and recovery turn inputs', () => {
  const composition = buildConversationTurnComposition({
    policyInput: {
      prompt: '修复上一轮',
      references: [],
      refs: [],
      policyHints: {
        selectedTools: [{ id: 'workspace.shell' }],
        failure: { code: 'silent-stream', message: 'stream was silent' },
      },
      metadata: { userGuidanceQueue: [{ text: '只修图表' }] },
      session: {
        runs: [{ id: 'failed-run', status: 'failed', stderrRef: '.sciforge/logs/run.stderr.log' }],
        executionUnits: [{ id: 'unit-1', status: 'failed-with-reason' }],
      },
    },
    goalSnapshot: { requiredArtifacts: ['research-report'] },
    contextPolicy: { mode: 'repair', historyReuse: { allowed: true } },
    memoryPlan: { currentReferenceFocus: [] },
    capabilityBrief: { selected: [{ id: 'literature.agent' }] },
    currentReferenceDigests: [{ id: 'digest-1', path: '.sciforge/artifacts/report.md' }],
  });

  assert.equal(composition.recentFailures.length, 2);
  assert.equal(composition.priorAttempts.length, 2);
  assert.deepEqual(composition.userGuidanceQueue, [{ text: '只修图表' }]);
  assert.equal(composition.recoveryPlan.action, 'digest-recovery');
  assert.deepEqual(composition.executionClassifierInput?.selectedTools, [{ id: 'workspace.shell' }]);
  assert.deepEqual(composition.executionClassifierInput?.selectedCapabilities, [{ id: 'literature.agent' }]);
});

test('turn composition keeps session for continuation and preserves explicit refs', () => {
  const session = {
    artifacts: [{ id: 'report' }],
    executionUnits: [{ id: 'unit' }],
    runs: [{ id: 'run' }],
  };
  const explicitRef = { kind: 'file', ref: 'inputs/current.csv', title: 'current.csv' };
  const composition = buildConversationTurnComposition({
    policyInput: { session, references: [explicitRef] },
    contextPolicy: { mode: 'continue', historyReuse: { allowed: true } },
    memoryPlan: { currentReferenceFocus: ['inputs/current.csv'] },
    currentReferenceDigests: [{ id: 'digest-ignored', path: 'file:reports/current.md' }],
  });

  assert.equal(composition.contextSession, session);
  assert.deepEqual(composition.currentReferences, [explicitRef]);
});
