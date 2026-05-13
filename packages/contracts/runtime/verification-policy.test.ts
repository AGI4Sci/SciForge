import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createRuntimeVerificationArtifact,
  evaluateRuntimeVerificationGate,
  normalizeRuntimeVerificationPolicy,
  verificationIsNonBlocking,
} from './verification-policy';

const RELEASE_GATE_REQUIRED_COMMAND = 'npm run verify:full';
const RELEASE_GATE_POLICY = {
  requiredCommand: RELEASE_GATE_REQUIRED_COMMAND,
  syncActionSignals: ['git push'],
};

test('package verification policy records unverified as visible non-pass for low-risk payloads', () => {
  const policy = normalizeRuntimeVerificationPolicy({ prompt: 'summarize local notes', selectedVerifierIds: ['schema'] }, {
    executionUnits: [{ id: 'unit-1', status: 'done' }],
  });
  const gate = evaluateRuntimeVerificationGate({ executionUnits: [{ id: 'unit-1', status: 'done' }] }, { prompt: 'summarize local notes' }, policy);

  assert.equal(policy.riskLevel, 'low');
  assert.equal(gate.blocked, false);
  assert.equal(gate.result.verdict, 'unverified');
  assert.equal(gate.result.diagnostics?.visibleUnverified, true);
  assert.deepEqual(gate.result.evidenceRefs, ['execution-unit:unit-1']);
});

test('package verification policy fail-closes high-risk self-reported action success', () => {
  const payload = {
    executionUnits: [{
      id: 'send-1',
      tool: 'browser.action',
      actionProvider: true,
      actionKind: 'send',
      sideEffectClass: 'external-write',
      status: 'done',
    }],
  };
  const request = {
    prompt: 'send an approval email',
    selectedActionIds: ['send'],
    selectedVerifierIds: ['human-approval'],
  };
  const policy = normalizeRuntimeVerificationPolicy(request, payload);
  const gate = evaluateRuntimeVerificationGate(payload, request, policy);

  assert.equal(policy.riskLevel, 'high');
  assert.equal(policy.required, true);
  assert.equal(policy.humanApprovalPolicy, 'required');
  assert.equal(gate.blocked, true);
  assert.equal(gate.result.verdict, 'fail');
  assert.match(gate.reason ?? '', /passing verifier result/);
});

test('package verification policy lets explicit human approval satisfy the gate', () => {
  const payload = {
    executionUnits: [{
      id: 'publish-1',
      tool: 'external.executor',
      actionProvider: true,
      actionKind: 'publish',
      sideEffectClass: 'external-write',
      status: 'done',
    }],
  };
  const policy = normalizeRuntimeVerificationPolicy({ prompt: 'publish update', selectedActionIds: ['publish'] }, payload);
  const gate = evaluateRuntimeVerificationGate(payload, {
    prompt: 'publish update',
    selectedActionIds: ['publish'],
    humanApproval: { approved: true, ref: 'approval:1', by: 'owner' },
  }, policy, [{ id: 'verifier-1', verdict: 'needs-human', confidence: 0.8, evidenceRefs: ['trace:1'], repairHints: [] }]);

  assert.equal(gate.blocked, false);
  assert.equal(gate.result.verdict, 'pass');
  assert.deepEqual(gate.result.evidenceRefs, ['approval:1', 'trace:1']);
  assert.equal(gate.result.diagnostics?.source, 'human-approval');
});

test('package verification policy blocks completed external sync until the release gate passes', () => {
  const payload = {
    displayIntent: {
      releaseGate: {
        policy: RELEASE_GATE_POLICY,
        changeSummary: 'Prepared release notes but did not finish verify.',
        currentBranch: 'main',
        targetRemote: 'origin',
        auditRefs: ['audit:release-gate'],
        steps: [{
          kind: 'service-restart',
          status: 'passed',
          evidenceRefs: ['service:agentserver'],
        }],
      },
    },
    executionUnits: [{
      id: 'push-1',
      tool: 'git',
      command: 'git push origin main',
      syncActionSignal: 'git push',
      status: 'done',
    }],
  };
  const request = { prompt: '等完整验证通过再推 GitHub' };
  const policy = normalizeRuntimeVerificationPolicy(request, payload);
  const gate = evaluateRuntimeVerificationGate(payload, request, policy, [{
    verdict: 'pass',
    confidence: 0.9,
    evidenceRefs: ['verification:unrelated'],
    repairHints: [],
  }]);

  assert.equal(gate.blocked, true);
  assert.equal(gate.result.verdict, 'needs-human');
  assert.match(gate.reason ?? '', /Do not complete/);
  assert.equal((gate.result.diagnostics?.releaseGate as { syncAllowed?: boolean }).syncAllowed, false);
});

test('package verification policy allows external sync after the release gate audit passes', () => {
  const payload = {
    displayIntent: {
      releaseGate: {
        policy: RELEASE_GATE_POLICY,
        changeSummary: 'Release gate contract and smoke coverage added.',
        currentBranch: 'main',
        targetRemote: 'origin',
        targetBranch: 'main',
        auditRefs: ['audit:release-gate'],
        gitRefs: ['commit:abc123'],
        steps: [{
          kind: 'release-verify',
          status: 'passed',
          command: RELEASE_GATE_REQUIRED_COMMAND,
          evidenceRefs: ['run:verify-full'],
        }, {
          kind: 'service-restart',
          status: 'passed',
          evidenceRefs: ['service:agentserver', 'service:workspace-writer'],
        }],
      },
    },
    executionUnits: [{
      id: 'push-1',
      tool: 'git',
      command: 'git push origin main',
      syncActionSignal: 'git push',
      status: 'done',
    }],
  };
  const request = { prompt: '等完整验证通过再推 GitHub' };
  const policy = normalizeRuntimeVerificationPolicy(request, payload);
  const gate = evaluateRuntimeVerificationGate(payload, request, policy);

  assert.equal(gate.blocked, false);
  assert.equal(gate.result.verdict, 'pass');
  assert.equal(gate.result.diagnostics?.source, 'release-gate');
  assert.ok(gate.result.evidenceRefs.includes('run:verify-full'));
});

test('package verification policy consumes custom release gate policy for non-git sync actions', () => {
  const customPolicy = {
    requiredCommand: 'python -m verifier.release --strict',
    syncActionLabel: 'artifact publish',
    syncActionSignals: ['publish artifact bundle'],
    requiredStepKinds: ['release-verify', 'audit-record'],
  };
  const payload = {
    displayIntent: {
      releaseGate: {
        policy: customPolicy,
        auditRefs: ['audit:artifact-publish'],
        steps: [{
          kind: 'release-verify',
          status: 'passed',
          command: customPolicy.requiredCommand,
          evidenceRefs: ['verification:artifact-publish'],
        }],
      },
    },
    executionUnits: [{
      id: 'publish-1',
      tool: 'artifact-publisher',
      command: 'publish artifact bundle',
      syncActionSignal: 'publish artifact bundle',
      status: 'done',
    }],
  };
  const request = { prompt: 'publish after release verification' };
  const policy = normalizeRuntimeVerificationPolicy(request, payload);
  const gate = evaluateRuntimeVerificationGate(payload, request, policy);

  assert.equal(gate.blocked, false);
  assert.equal(gate.result.verdict, 'pass');
  assert.equal((gate.result.diagnostics?.releaseGate as { requiredCommand?: string }).requiredCommand, customPolicy.requiredCommand);
});

test('package verification policy exposes artifact and non-blocking helpers', () => {
  const policy = normalizeRuntimeVerificationPolicy({ prompt: 'draft text', uiState: { latencyPolicy: { blockOnVerification: false } } });
  const result = { id: 'verify-1', verdict: 'unverified' as const, confidence: 0, evidenceRefs: [], repairHints: [] };
  const artifact = createRuntimeVerificationArtifact(result, policy, '.sciforge/verifications/verify-1.json', true);

  assert.equal(verificationIsNonBlocking({ uiState: { latencyPolicy: { blockOnVerification: false } } }, policy), true);
  assert.equal(artifact.type, 'verification-result');
  assert.equal(artifact.schemaVersion, 'sciforge.verification-result.v1');
  assert.deepEqual((artifact.metadata as Record<string, unknown>).unverifiedIsNotPass, true);
});
