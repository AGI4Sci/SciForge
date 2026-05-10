import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSilentStreamDecisionRecord } from '@sciforge-ui/runtime-contract';
import type { GatewayRequest } from '../runtime-types.js';
import {
  agentServerSilentStreamGuardAudit,
  currentReferenceDigestSilentGuardMs,
  currentReferenceDigestSilentGuardPolicy,
  readAgentServerRunStream,
  type AgentServerSilentStreamGuardAudit,
} from './agentserver-stream.js';
import { planConversationRecovery } from './conversation-recovery-policy.js';

test('silent stream guard consumes harness progressPlan silencePolicy for timeout and audit fields', async () => {
  const request = {
    skillDomain: 'literature',
    prompt: 'stream guard should use harness silence policy',
    artifacts: [],
    uiState: {
      currentReferenceDigests: [{ ref: 'refs/current/digest-a.json' }],
      agentHarness: {
        contractRef: 'runtime://agent-harness/contracts/test-silence-policy',
        contract: {
          contractRef: 'runtime://agent-harness/contracts/test-silence-policy',
          progressPlan: {
            silenceTimeoutMs: 99_999,
            silencePolicy: {
              timeoutMs: 7,
              decision: 'retry',
              status: 'Retrying compact AgentServer stream',
              maxRetries: 2,
              auditRequired: true,
            },
          },
        },
      },
    },
  } satisfies GatewayRequest;

  const policy = currentReferenceDigestSilentGuardPolicy(request);
  assert.equal(currentReferenceDigestSilentGuardMs(request), 7);
  assert.equal(policy.source, 'request.uiState.agentHarness.contract.progressPlan.silencePolicy');
  assert.equal(policy.timeoutMs, 7);
  assert.equal(policy.decision, 'retry');
  assert.equal(policy.maxRetries, 2);
  assert.equal(policy.digestRefCount, 1);
  assert.equal(policy.contractRef, 'runtime://agent-harness/contracts/test-silence-policy');

  const transportDecision = buildSilentStreamDecisionRecord({
    runId: 'session-a:turn-silent',
    source: 'ui.transport.silenceWatchdog',
    layer: 'transport-watchdog',
    decision: 'retry',
    timeoutMs: 7,
    elapsedMs: 8,
    detail: 'transport retry after silent stream',
  });
  let capturedAudit: AgentServerSilentStreamGuardAudit | undefined;
  const response = new Response(new ReadableStream<Uint8Array>({ start() {} }));
  await assert.rejects(
    readAgentServerRunStream(response, () => {}, {
      maxSilentMs: policy.timeoutMs,
      silencePolicy: policy,
      silentRetryCount: 1,
      silentRunId: 'session-a:turn-silent',
      silentStreamDecision: transportDecision,
      onSilentTimeout: (_message, audit) => {
        capturedAudit = audit;
      },
    }),
    /silencePolicy decision=retry/,
  );

  assert.ok(capturedAudit);
  assert.equal(capturedAudit.schemaVersion, 'sciforge.agentserver-silent-stream-guard-audit.v1');
  assert.equal(capturedAudit.silentStreamDecision.decisionId, transportDecision.decisionId);
  assert.deepEqual(capturedAudit.silentStreamDecision.layers, ['transport-watchdog', 'backend-stream']);
  assert.equal(capturedAudit.silentStreamDecision.termination.reason, 'timeout');
  assert.equal(capturedAudit.timeoutMs, 7);
  assert.equal(capturedAudit.decision, 'retry');
  assert.equal(capturedAudit.retryCount, 1);
  assert.equal(capturedAudit.maxRetries, 2);
  assert.equal(capturedAudit.retryable, true);
  assert.equal(capturedAudit.recoveryAction, 'retry-compact-context');
  assert.equal(capturedAudit.auditRequired, true);
  assert.ok(capturedAudit.detail.includes('status=Retrying compact AgentServer stream'));
});

test('conversation recovery uses silent stream policy retry budget and decision', () => {
  const audit = agentServerSilentStreamGuardAudit({
    schemaVersion: 'sciforge.agentserver-silent-stream-policy.v1',
    source: 'request.uiState.agentHarness.contract.progressPlan.silencePolicy',
    timeoutMs: 11,
    decision: 'retry',
    status: 'Retrying compact AgentServer stream',
    maxRetries: 1,
    auditRequired: true,
    digestRefCount: 0,
    fallbackTimeoutMs: 30_000,
  }, { elapsedMs: 12, retryCount: 1, runId: 'session-a:turn-policy' });

  const exhausted = planConversationRecovery({
    failure: {
      code: 'silent-stream',
      message: audit.message,
      silentStreamGuard: audit,
    },
    attempts: [{ action: 'repair' }],
  });

  assert.equal(exhausted.status, 'failed-with-reason');
  assert.equal(exhausted.retryable, false);
  assert.ok(exhausted.reason.message.includes('after 1 attempt'));
  assert.equal(audit.silentStreamDecision.decisionId, 'session-a:turn-policy:silent-stream');
});
