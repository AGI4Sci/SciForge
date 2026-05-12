import assert from 'node:assert/strict';
import test from 'node:test';

import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import {
  BACKGROUND_WORK_VERIFY_LOG_KIND,
  INTENT_FIRST_VERIFICATION_SCHEMA_VERSION,
  INTENT_FIRST_VERIFY_PROVIDER,
  INTENT_MATCH_LOG_KIND,
  attachIntentFirstVerification,
  buildIntentMatchCheck,
  buildVerifyJobs,
  runBackgroundWorkVerify,
  verifyRoutingDecision,
} from './intent-first-verification.js';
import { RELEASE_GATE_REQUIRED_COMMAND } from '@sciforge-ui/runtime-contract/release-gate';

test('intent match check is lightweight and does not imply work verification', () => {
  const check = buildIntentMatchCheck(baseRequest({
    prompt: '只给我通用建议，不需要改代码。',
  }), basePayload({
    message: '建议采用旁路验证。',
    artifacts: [],
    executionUnits: [],
  }));

  assert.equal(check.schemaVersion, INTENT_FIRST_VERIFICATION_SCHEMA_VERSION);
  assert.equal(check.verdict, 'pass');
  assert.equal(check.requestedActionType, 'advice');
  assert.ok(check.explicitConstraints.includes('negative-or-skip-instruction'));
  assert.equal(check.answerCoverage, 'covered');
});

test('verify routing keeps work verification in the background by default', () => {
  const request = baseRequest({ prompt: '实现这个小改动。' });
  const routing = verifyRoutingDecision(request);
  const jobs = buildVerifyJobs(basePayload(), routing);

  assert.equal(routing.mode, 'background');
  assert.equal(routing.level, 'work-background');
  assert.equal(routing.blockingPolicy, 'non-blocking');
  assert.equal(jobs[0]?.status, 'queued');
  assert.equal(jobs[0]?.blockingPolicy, 'non-blocking');
});

test('verify routing blocks only when user asks to wait or release risk is explicit', () => {
  assert.equal(verifyRoutingDecision(baseRequest({ prompt: '等验证完成后再给最终结论。' })).blockingPolicy, 'user-requested-wait');
  assert.equal(verifyRoutingDecision(baseRequest({ prompt: 'run release verify before merge.' })).blockingPolicy, 'release');
  assert.equal(verifyRoutingDecision(baseRequest({
    prompt: '删除生产数据。',
    riskLevel: 'high',
    actionSideEffects: ['delete external production records'],
  })).blockingPolicy, 'high-risk');
  assert.equal(verifyRoutingDecision(baseRequest({ prompt: 'skip verify, just show the draft.' })).mode, 'skip');
});

test('release routing creates a verify full gate and blocks push when evidence is missing', () => {
  const request = baseRequest({ prompt: '等完整验证通过再推 GitHub。' });
  const payload = basePayload({
    displayIntent: {
      releaseGate: {
        changeSummary: 'Prepared release summary.',
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
  });
  const routing = verifyRoutingDecision(request);
  const jobs = buildVerifyJobs(payload, routing);
  const attached = attachIntentFirstVerification(payload, request, { runWorkVerify: true });
  const envelope = attached.displayIntent?.intentFirstVerification as {
    jobs?: Array<{ command?: string; status?: string; releaseGate?: { pushAllowed?: boolean; missing?: string[] } }>;
    verdicts?: Array<{ verdict?: string }>;
  } | undefined;

  assert.equal(routing.mode, 'release');
  assert.equal(jobs[0]?.command, RELEASE_GATE_REQUIRED_COMMAND);
  assert.equal(jobs[0]?.blockingPolicy, 'release');
  assert.equal(jobs[0]?.releaseGate?.pushAllowed, false);
  assert.ok(jobs[0]?.releaseGate?.missing.includes(RELEASE_GATE_REQUIRED_COMMAND));
  assert.equal(envelope?.jobs?.[0]?.status, 'running');
  assert.equal(envelope?.jobs?.[0]?.releaseGate?.pushAllowed, false);
  assert.equal(envelope?.verdicts?.[0]?.verdict, 'pending');
});

test('release routing passes only when verify full, services, summary, git target, and audit refs are present', () => {
  const releaseGate = {
    changeSummary: 'Release verification gate shipped.',
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
      evidenceRefs: ['service:workspace-writer', 'service:agentserver'],
    }],
  };
  const payload = attachIntentFirstVerification(basePayload({
    displayIntent: { releaseGate },
  }), baseRequest({ prompt: 'run release verify before git push.' }), {
    runWorkVerify: true,
    now: () => '2026-05-13T00:00:00.000Z',
  });
  const status = payload.displayIntent?.verificationStatus as {
    work?: string;
    releaseGate?: { status?: string; pushAllowed?: boolean };
  } | undefined;
  const envelope = payload.displayIntent?.intentFirstVerification as {
    jobs?: Array<{ status?: string; releaseGate?: { status?: string; pushAllowed?: boolean } }>;
    verdicts?: Array<{ verdict?: string }>;
  } | undefined;

  assert.equal(status?.work, 'verify passed');
  assert.equal(status?.releaseGate?.status, 'passed');
  assert.equal(status?.releaseGate?.pushAllowed, true);
  assert.equal(envelope?.jobs?.[0]?.status, 'passed');
  assert.equal(envelope?.jobs?.[0]?.releaseGate?.pushAllowed, true);
  assert.equal(envelope?.verdicts?.[0]?.verdict, 'passed');
});

test('attaches intent-first verification status without blocking payload delivery', () => {
  const payload = attachIntentFirstVerification(basePayload(), baseRequest({
    prompt: '修改报告文件，后台验证即可。',
  }));
  const status = payload.displayIntent?.verificationStatus as Record<string, unknown> | undefined;
  const envelope = payload.displayIntent?.intentFirstVerification as Record<string, unknown> | undefined;

  assert.equal(payload.logs?.some((log) => log.kind === INTENT_MATCH_LOG_KIND), true);
  assert.equal(payload.logs?.some((log) => log.kind === BACKGROUND_WORK_VERIFY_LOG_KIND), true);
  assert.equal(payload.workEvidence?.some((entry) =>
    entry.provider === INTENT_FIRST_VERIFY_PROVIDER
    && entry.status === 'partial'
  ), true);
  assert.equal(status?.response, 'intent checked');
  assert.equal(status?.work, 'background verify queued');
  assert.equal(status?.blocking, false);
  assert.equal(envelope?.schemaVersion, INTENT_FIRST_VERIFICATION_SCHEMA_VERSION);
});

test('skip route records an intent-only verification job instead of heavy checks', () => {
  const payload = attachIntentFirstVerification(basePayload(), baseRequest({
    prompt: 'skip verify and give me the draft.',
  }));
  const envelope = payload.displayIntent?.intentFirstVerification as {
    routing?: { mode?: string; level?: string };
    jobs?: Array<{ status?: string; level?: string }>;
  } | undefined;

  assert.equal(envelope?.routing?.mode, 'skip');
  assert.equal(envelope?.routing?.level, 'intent');
  assert.equal(envelope?.jobs?.[0]?.status, 'skipped');
});

test('background work verify completes lightweight jobs and emits lineage event', () => {
  const events: unknown[] = [];
  const routing = verifyRoutingDecision(baseRequest({ prompt: '修改报告文件，后台验证即可。' }));
  const jobs = buildVerifyJobs(basePayload(), routing);
  const result = runBackgroundWorkVerify(basePayload(), baseRequest({
    prompt: '修改报告文件，后台验证即可。',
    uiState: { sessionId: 'session-verify', activeRunId: 'run-verify' },
  }), jobs, routing, {
    callbacks: { onEvent: (event) => events.push(event) },
    now: () => '2026-05-12T00:00:00.000Z',
  });

  assert.equal(result.jobs[0]?.status, 'passed');
  assert.equal(result.verdicts[0]?.verdict, 'passed');
  assert.equal(result.lineage[0]?.verdictRef, `verification:${result.jobs[0]?.id}`);
  assert.equal(result.lineage[0]?.eventRef, `run:run-verify#${result.jobs[0]?.id}`);
  const raw = (events[0] as { raw?: { contract?: string; status?: string; verificationResults?: Array<{ verdict?: string }> } }).raw;
  assert.equal(raw?.contract, 'sciforge.background-completion.v1');
  assert.equal(raw?.status, 'completed');
  assert.equal(raw?.verificationResults?.[0]?.verdict, 'pass');
});

test('background work verify failure returns follow-up instead of silently passing', () => {
  const events: unknown[] = [];
  const payload = basePayload({
    executionUnits: [{
      id: 'unit-failed',
      tool: 'sciforge.work',
      status: 'failed-with-reason',
      outputRef: 'file:.sciforge/task-results/result.json',
      failureReason: 'schema validation failed',
    }],
  });
  const routing = verifyRoutingDecision(baseRequest({ prompt: '实现这个改动。' }));
  const jobs = buildVerifyJobs(payload, routing);
  const result = runBackgroundWorkVerify(payload, baseRequest({
    prompt: '实现这个改动。',
    uiState: { sessionId: 'session-verify', activeRunId: 'run-verify-fail' },
  }), jobs, routing, {
    callbacks: { onEvent: (event) => events.push(event) },
    now: () => '2026-05-12T00:00:00.000Z',
  });

  assert.equal(result.jobs[0]?.status, 'failed');
  assert.equal(result.verdicts[0]?.verdict, 'failed');
  assert.match(result.verdicts[0]?.failureSummary ?? '', /schema validation failed/);
  assert.equal(result.lineage[0]?.followUpRequired, true);
  const raw = (events[0] as {
    raw?: {
      status?: string;
      failureReason?: string;
      recoverActions?: string[];
      workEvidence?: Array<{ status?: string; failureReason?: string }>;
    };
  }).raw;
  assert.equal(raw?.status, 'failed');
  assert.equal(raw?.failureReason, 'schema validation failed');
  assert.match(raw?.recoverActions?.[0] ?? '', /unit-failed/);
  assert.equal(raw?.workEvidence?.[0]?.status, 'failed-with-reason');
});

test('attach can run sidecar work verify and expose passed or failed status in display intent', () => {
  const passed = attachIntentFirstVerification(basePayload(), baseRequest({
    prompt: '修改报告文件，后台验证即可。',
  }), { runWorkVerify: true, now: () => '2026-05-12T00:00:00.000Z' });
  const passedStatus = passed.displayIntent?.verificationStatus as Record<string, unknown> | undefined;
  const passedEnvelope = passed.displayIntent?.intentFirstVerification as {
    jobs?: Array<{ status?: string }>;
    verdicts?: Array<{ verdict?: string }>;
    lineage?: Array<{ verdictRef?: string }>;
  } | undefined;

  assert.equal(passedStatus?.work, 'verify passed');
  assert.equal(passedEnvelope?.jobs?.[0]?.status, 'passed');
  assert.equal(passedEnvelope?.verdicts?.[0]?.verdict, 'passed');
  assert.equal(typeof passedEnvelope?.lineage?.[0]?.verdictRef, 'string');

  const failed = attachIntentFirstVerification(basePayload({
    executionUnits: [{
      id: 'unit-failed',
      tool: 'sciforge.work',
      status: 'failed',
      outputRef: 'file:.sciforge/task-results/result.json',
    }],
  }), baseRequest({ prompt: '实现这个改动。' }), { runWorkVerify: true });
  const failedStatus = failed.displayIntent?.verificationStatus as Record<string, unknown> | undefined;

  assert.equal(failedStatus?.work, 'verify failed');
  assert.equal(failed.workEvidence?.some((entry) =>
    entry.provider === INTENT_FIRST_VERIFY_PROVIDER
    && entry.status === 'failed-with-reason'
    && entry.recoverActions.length > 0
  ), true);
});

function baseRequest(overrides: Partial<GatewayRequest> = {}): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt: 'Summarize the current result.',
    artifacts: [],
    uiState: { sessionId: 'session-verify' },
    ...overrides,
  };
}

function basePayload(overrides: Partial<ToolPayload> = {}): ToolPayload {
  return {
    message: 'Completed the requested work.',
    confidence: 0.82,
    claimType: 'result',
    evidenceLevel: 'runtime',
    reasoningTrace: 'intent-first verification attached.',
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: 'unit-1',
      tool: 'sciforge.work',
      status: 'done',
      outputRef: 'file:.sciforge/task-results/result.json',
    }],
    artifacts: [{
      id: 'artifact-1',
      type: 'report',
      dataRef: 'file:.sciforge/artifacts/report.md',
    }],
    ...overrides,
  };
}
