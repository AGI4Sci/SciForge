import assert from 'node:assert/strict';
import test from 'node:test';

import { buildSilentStreamDecisionRecord } from '@sciforge-ui/runtime-contract';
import type { GatewayRequest } from '../runtime-types.js';
import {
  AgentServerRepairContinuationBoundedStopError,
  agentServerGenerationTokenGuardLimit,
  agentServerSilentStreamGuardAudit,
  currentReferenceDigestSilentGuardMs,
  currentReferenceDigestSilentGuardPolicy,
  isAgentServerRepairContinuationBoundedStopError,
  readAgentServerRunStream,
  type AgentServerSilentStreamGuardAudit,
} from './agentserver-stream.js';
import { agentServerRequestFailureMessage } from './agentserver-run-output.js';
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
          traceRef: 'runtime://agent-harness/traces/test-silence-policy',
        },
        traceRef: 'runtime://agent-harness/traces/test-silence-policy',
      },
    },
  } satisfies GatewayRequest;

  const policy = currentReferenceDigestSilentGuardPolicy(request);
  assert.equal(currentReferenceDigestSilentGuardMs(request), 45_000);
  assert.equal(policy.source, 'request.uiState.agentHarness.contract.progressPlan.silencePolicy');
  assert.equal(policy.timeoutMs, 45_000);
  assert.equal(policy.decision, 'retry');
  assert.equal(policy.maxRetries, 2);
  assert.equal(policy.digestRefCount, 1);
  assert.equal(policy.contractRef, 'runtime://agent-harness/contracts/test-silence-policy');
  assert.equal(policy.traceRef, 'runtime://agent-harness/traces/test-silence-policy');
  assert.equal(policy.harnessSignals.harnessStage, 'onStreamGuardTrip');
  assert.equal(policy.harnessSignals.externalHook.schemaVersion, 'sciforge.agent-harness-external-hook-trace.v1');
  assert.equal(policy.harnessSignals.externalHook.declared, true);

  const shortPolicy = { ...policy, timeoutMs: 7 };
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
      maxSilentMs: shortPolicy.timeoutMs,
      silencePolicy: shortPolicy,
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
  assert.equal(capturedAudit.harnessSignals.harnessStage, 'onStreamGuardTrip');
  assert.equal(capturedAudit.harnessSignals.externalHook.stage, 'onStreamGuardTrip');
  assert.ok(capturedAudit.detail.includes('status=Retrying compact AgentServer stream'));
});

test('generation token budget is advisory for normal AgentServer streams and tightens when digest refs exist', async () => {
  const request = {
    skillDomain: 'literature',
    prompt: 'guard runaway generation',
    artifacts: [],
    maxContextWindowTokens: 200_000,
    uiState: {},
  } satisfies GatewayRequest;
  assert.equal(agentServerGenerationTokenGuardLimit(request), 300_000);
  assert.equal(agentServerGenerationTokenGuardLimit({
    ...request,
    uiState: { currentReferenceDigests: [{ ref: 'refs/current/a.json' }] },
  }), 80_000);

  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify({
        event: {
          type: 'usage-update',
          usage: { input: 260_000, output: 50_001, total: 310_001, provider: 'codex' },
        },
      })}\n`));
      controller.enqueue(encoder.encode(`${JSON.stringify({
        result: {
          data: {
            run: {
              id: 'run-large-total-usage',
              status: 'completed',
            },
          },
        },
      })}\n`));
      controller.close();
    },
  }));
  let guardMessage = '';
  const result = await readAgentServerRunStream(response, () => {}, {
    maxTotalUsage: agentServerGenerationTokenGuardLimit(request),
    onGuardTrip: (message) => {
      guardMessage = message;
    },
  });
  assert.equal(result.run.id, 'run-large-total-usage');
  assert.equal(result.run.status, 'completed');
  assert.equal(guardMessage, '');
});

test('repair continuation generation guard fails before broad convergence loop budget', async () => {
  const request = {
    skillDomain: 'literature',
    prompt: 'continue the failed run using compact repair refs',
    artifacts: [],
    maxContextWindowTokens: 200_000,
    uiState: {
      contextReusePolicy: { mode: 'repair' },
      recentExecutionRefs: [{
        id: 'EU-literature-failed',
        status: 'failed-with-reason',
        outputRef: '.sciforge/task-results/failed.json',
        stderrRef: '.sciforge/task-results/failed.stderr.txt',
        failureReason: 'prior AgentServer generation stopped by convergence guard',
      }],
    },
  } satisfies GatewayRequest;
  assert.equal(agentServerGenerationTokenGuardLimit(request, { repairContinuation: true }), 60_000);
  assert.ok(agentServerGenerationTokenGuardLimit(request, { repairContinuation: true }) < agentServerGenerationTokenGuardLimit(request));

  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify({
        event: {
          type: 'usage-update',
          usage: { input: 55_000, output: 5_001, total: 60_001, provider: 'codex' },
        },
      })}\n`));
      controller.close();
    },
  }));
  let guardMessage = '';
  let thrown: unknown;
  await assert.rejects(
    async () => {
      try {
        await readAgentServerRunStream(response, () => {}, {
          maxTotalUsage: agentServerGenerationTokenGuardLimit(request, { repairContinuation: true }),
          convergenceGuardMode: 'repair-continuation',
          onGuardTrip: (message) => {
            guardMessage = message;
          },
        });
      } catch (error) {
        thrown = error;
        throw error;
      }
    },
    /repair generation bounded-stop after 60001 total tokens/,
  );
  assert.ok(thrown instanceof AgentServerRepairContinuationBoundedStopError);
  assert.equal(isAgentServerRepairContinuationBoundedStopError(thrown), true);
  assert.equal(thrown.totalUsage, 60_001);
  assert.equal(thrown.limit, 60_000);
  assert.match(guardMessage, /limit 60000/);
  assert.match(guardMessage, /failed-with-reason ToolPayload/);
  assert.match(guardMessage, /refs\/digests-only follow-up/);
});

test('request failure message preserves silent stream guard diagnostics', () => {
  const message = agentServerRequestFailureMessage(
    'generation',
    new Error('AgentServer generation stopped by silent stream guard after 5001ms without stream events; silencePolicy decision=visible-status, timeoutMs=5000, retry=0/0.'),
    900_000,
  );

  assert.match(message, /silent stream guard after 5001ms/);
  assert.doesNotMatch(message, /900000ms/);
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
    harnessSignals: {
      profileId: undefined,
      contractRef: undefined,
      traceRef: undefined,
      harnessStage: 'onStreamGuardTrip',
      externalHook: {
        schemaVersion: 'sciforge.agent-harness-external-hook-trace.v1',
        stage: 'onStreamGuardTrip',
        stageGroup: 'external-hook',
        declaredBy: 'HARNESS_EXTERNAL_HOOK_STAGES',
        declared: true,
      },
      sourceCallbackId: 'harness.runtime.onStreamGuardTrip',
    },
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
