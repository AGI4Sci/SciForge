import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';

import { buildSilentStreamDecisionRecord } from '@sciforge-ui/runtime-contract';
import type { GatewayRequest } from '../runtime-types.js';
import {
  backendGenerationTokenGuardLimit,
  backendSilentStreamGuardAudit,
  currentReferenceDigestSilentGuardMs,
  currentReferenceDigestSilentGuardPolicy,
  readBackendRunStream,
  type BackendSilentStreamGuardAudit,
} from './backend-run-stream.js';
import { backendRequestFailureMessage } from './backend-run-output.js';
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
  let capturedAudit: BackendSilentStreamGuardAudit | undefined;
  const response = new Response(new ReadableStream<Uint8Array>({ start() {} }));
  await assert.rejects(
    readBackendRunStream(response, () => {}, {
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

test('generation token guard allows large streams up to a bounded fallback ceiling', async () => {
  const request = {
    skillDomain: 'literature',
    prompt: 'guard runaway generation',
    artifacts: [],
    maxContextWindowTokens: 200_000,
    uiState: {},
  } satisfies GatewayRequest;
  assert.equal(backendGenerationTokenGuardLimit(request), 400_000);
  assert.equal(backendGenerationTokenGuardLimit({
    ...request,
    uiState: { currentReferenceDigests: [{ ref: 'refs/current/a.json' }] },
  }), 400_000);

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
  const result = await readBackendRunStream(response, () => {}, {
    maxTotalUsage: backendGenerationTokenGuardLimit(request),
    convergenceGuardMode: 'generation',
  });
  assert.equal(result.run.id, 'run-large-total-usage');
});

test('AgentServer stream bridges capability discovery tool calls into audited tool-result events', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-agentserver-discovery-tool-'));
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify({
        event: {
          type: 'tool-call',
          id: 'call-discovery-search',
          toolName: 'capability_discovery.search',
          input: {
            goal: 'Need to find tools for recent paper search and PDF full text extraction.',
            desiredArtifacts: ['research-report'],
            constraints: { maxCandidates: 2 },
          },
        },
      })}\n`));
      controller.enqueue(encoder.encode(`${JSON.stringify({
        result: {
          data: {
            run: {
              id: 'run-discovery-tool-call',
              status: 'completed',
            },
          },
        },
      })}\n`));
      controller.close();
    },
  }));
  const events: unknown[] = [];

  const result = await readBackendRunStream(response, (event) => events.push(event), {
    capabilityDiscoveryToolTransport: {
      workspace,
      sessionBundleRel: '.sciforge/sessions/test-session',
      auditSeed: 'stream-test',
    },
  });

  const toolResult = events.find((event): event is Record<string, unknown> => {
    return typeof event === 'object'
      && event !== null
      && (event as Record<string, unknown>).type === 'tool-result'
      && (event as Record<string, unknown>).toolName === 'capability_discovery.search';
  });
  assert.ok(toolResult);
  assert.equal(toolResult.status, 'done');
  assert.equal(toolResult.completionEvidence, 'not-evidence');
  assert.equal(toolResult.callId, 'call-discovery-search');
  assert.deepEqual(result.run, { id: 'run-discovery-tool-call', status: 'completed' });

  const auditRefs = toolResult.auditRefs as string[];
  const persistedRef = auditRefs.find((ref) => ref.includes('records/capability-discovery/search-'));
  assert.ok(persistedRef);
  const auditRecord = JSON.parse(await readFile(join(workspace, persistedRef), 'utf8')) as Record<string, unknown>;
  assert.equal(auditRecord.schemaVersion, 'sciforge.capability-discovery.audit-record.v1');
  assert.equal(auditRecord.method, 'search');
  assert.equal(auditRecord.completionEvidence, 'not-evidence');
  assert.doesNotMatch(JSON.stringify(auditRecord), /endpoint|baseUrl|auth|token|secret|\/Applications\/workspace/i);
});

test('bounded harness generation token guard stops runaway streams before projectionless waits', async () => {
  const request = {
    skillDomain: 'literature',
    prompt: 'bounded repair should not consume unlimited generation tokens',
    artifacts: [],
    maxContextWindowTokens: 200_000,
    uiState: {
      agentHarness: {
        contract: {
          toolBudget: {
            maxWallMs: 30_000,
            maxToolCalls: 2,
            costUnits: 2,
          },
        },
      },
    },
  } satisfies GatewayRequest;
  assert.equal(backendGenerationTokenGuardLimit(request), 180_000);

  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify({
        event: {
          type: 'usage-update',
          usage: { input: 181_000, output: 5_001, total: 186_001, provider: 'codex' },
        },
      })}\n`));
      controller.close();
    },
  }));
  await assert.rejects(
    readBackendRunStream(response, () => {}, {
      maxTotalUsage: backendGenerationTokenGuardLimit(request),
      convergenceGuardMode: 'generation',
    }),
    /convergence guard after 186001 total tokens/,
  );
});

test('repair continuation token guard keeps repair loops bounded while stream silence guard handles stalls', async () => {
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
        failureReason: 'prior backend generation stopped by convergence guard',
      }],
    },
  } satisfies GatewayRequest;
  assert.equal(backendGenerationTokenGuardLimit(request, { repairContinuation: true }), 100_000);

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
  const result = await readBackendRunStream(response, () => {}, {
    maxTotalUsage: backendGenerationTokenGuardLimit(request, { repairContinuation: true }),
    convergenceGuardMode: 'repair-continuation',
  });
  assert.deepEqual(result.run, {});
});

test('request failure message preserves silent stream guard diagnostics', () => {
  const message = backendRequestFailureMessage(
    'generation',
    new Error('backend generation stopped by silent stream guard after 5001ms without stream events; silencePolicy decision=visible-status, timeoutMs=5000, retry=0/0.'),
    900_000,
  );

  assert.match(message, /silent stream guard after 5001ms/);
  assert.doesNotMatch(message, /900000ms/);
});

test('conversation recovery uses silent stream policy retry budget and decision', () => {
  const audit = backendSilentStreamGuardAudit({
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

test('AgentServer stream executes capability discovery tool-call and persists sanitized audit ref', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-discovery-stream-'));
  const events: unknown[] = [];
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify({
        event: {
          type: 'tool-call',
          id: 'call-search-1',
          toolName: 'capability_discovery.search',
          arguments: JSON.stringify({
            goal: 'Need recent paper search, PDF reading, and evidence matrix. token=abc123 http://127.0.0.1:18080 /Applications/workspace/private-root',
            desiredArtifacts: ['research-report', 'evidence-matrix'],
            constraints: { maxCandidates: 3, latencyTier: 'bounded' },
          }),
        },
      })}\n`));
      controller.enqueue(encoder.encode(`${JSON.stringify({
        result: { data: { run: { id: 'run-discovery-stream', status: 'completed', output: {} } } },
      })}\n`));
      controller.close();
    },
  }));

  const stream = await readBackendRunStream(response, (event) => events.push(event), {
    capabilityDiscoveryToolTransport: {
      workspace,
      sessionBundleRel: '.sciforge/sessions/session-discovery',
      auditSeed: 'stream-test',
    },
  });

  assert.equal(stream.run.id, 'run-discovery-stream');
  const toolResult = events.find((event): event is Record<string, unknown> => {
    return typeof event === 'object'
      && event !== null
      && (event as Record<string, unknown>).type === 'tool-result'
      && (event as Record<string, unknown>).toolName === 'capability_discovery.search';
  });
  assert.ok(toolResult, 'discovery tool-call should emit a tool-result event');
  assert.equal(toolResult.status, 'done');
  assert.equal(toolResult.completionEvidence, 'not-evidence');
  const result = toolResult.result as Record<string, unknown>;
  assert.equal(result.contract, 'sciforge.capability-discovery.v1');
  assert.ok(Array.isArray(result.candidates));
  assert.match(String(toolResult.discoveryRef), /^capability-discovery:search:/);
  const auditRefs = toolResult.auditRefs as string[];
  const persistedRef = auditRefs.find((ref) => ref.endsWith('.json'));
  assert.ok(persistedRef, `tool result should include persisted audit ref: ${JSON.stringify(auditRefs)}`);
  const auditText = await readFile(join(workspace, persistedRef), 'utf8');
  assert.match(auditText, /sciforge\.capability-discovery\.audit-record\.v1/);
  assert.match(auditText, /not-evidence/);
  assert.doesNotMatch(auditText, /127\.0\.0\.1|abc123|\/Applications\/workspace|baseUrl|endpoint|token/i);
  const ledgerRef = auditRefs.find((ref) => ref.endsWith('/ledger/events.jsonl'));
  assert.ok(ledgerRef, `tool result should include replay ledger ref: ${JSON.stringify(auditRefs)}`);
  const ledgerEvents = (await readFile(join(workspace, ledgerRef), 'utf8')).trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
  assert.equal(ledgerEvents.length, 1);
  assert.equal(ledgerEvents[0]?.schemaVersion, 'sciforge.workspace-ledger-event.v1');
  assert.equal(ledgerEvents[0]?.kind, 'decision-recorded');
  assert.match(String(ledgerEvents[0]?.summary), /not-evidence/);
  assert.doesNotMatch(JSON.stringify(ledgerEvents), /127\.0\.0\.1|abc123|\/Applications\/workspace|baseUrl|endpoint|token/i);
});

test('AgentServer stream reports malformed capability discovery calls as not-evidence tool results', async () => {
  const events: unknown[] = [];
  const encoder = new TextEncoder();
  const response = new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(`${JSON.stringify({
        event: {
          type: 'tool-call',
          id: 'call-plan-1',
          name: 'capability_discovery.plan',
          args: { goal: 'plan without candidates' },
        },
      })}\n`));
      controller.close();
    },
  }));

  await readBackendRunStream(response, (event) => events.push(event), {
    capabilityDiscoveryToolTransport: { auditSeed: 'malformed-stream-test' },
  });

  const toolResult = events.find((event): event is Record<string, unknown> => {
    return typeof event === 'object'
      && event !== null
      && (event as Record<string, unknown>).type === 'tool-result'
      && (event as Record<string, unknown>).toolName === 'capability_discovery.plan';
  });
  assert.ok(toolResult);
  assert.equal(toolResult.status, 'failed-with-reason');
  assert.equal(toolResult.completionEvidence, 'not-evidence');
  assert.match(String(toolResult.error), /requires candidateIds/);
});
