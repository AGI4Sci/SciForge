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
  verifyRoutingDecision,
} from './intent-first-verification.js';

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
