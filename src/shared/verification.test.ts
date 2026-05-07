import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildVerificationPolicy,
  buildVerificationRequest,
  buildVerificationResult,
  buildVerifierCapabilityBrief,
  humanVerificationEventToResult,
  isTerminalVerificationVerdict,
  isHumanVerificationInteractiveEvent,
  isVerificationSuccess,
  normalizeVerificationPolicy,
  normalizeVerificationResult,
} from './verification';

test('把 accept 交互事件转换为 human VerificationResult', () => {
  const result = humanVerificationEventToResult({
    schemaVersion: 1,
    type: 'accept',
    viewId: 'review-panel',
    targetRef: 'artifact:report',
    artifactRefs: ['artifact:report'],
    traceRefs: ['run:1'],
    comment: '结果可接受',
  }, { now: () => '2026-05-07T00:00:00.000Z' });

  assert.equal(result.providerKind, 'human');
  assert.equal(result.providerId, 'review-panel');
  assert.equal(result.verdict, 'pass');
  assert.equal(result.reward, 1);
  assert.equal(result.confidence, 0.9);
  assert.deepEqual(result.artifactRefs, ['artifact:report']);
  assert.deepEqual(result.traceRefs, ['run:1']);
  assert.equal(result.critique, '结果可接受');
});

test('把 reject 和 revise 映射为失败并保留修复提示', () => {
  const reject = humanVerificationEventToResult({
    schemaVersion: 1,
    type: 'reject',
    viewId: 'review-panel',
    comment: '证据不足',
  });
  const revise = humanVerificationEventToResult({
    schemaVersion: 1,
    type: 'revise',
    viewId: 'review-panel',
    comment: '补充实验参数',
    repairHints: ['补充 stdoutRef'],
    score: 0.8,
  });

  assert.equal(reject.verdict, 'fail');
  assert.equal(revise.verdict, 'fail');
  assert.equal(revise.reward, 0.35);
  assert.deepEqual(revise.repairHints, ['补充实验参数', '补充 stdoutRef']);
});

test('把 score 和 comment 转换为标准 verdict/reward', () => {
  assert.equal(humanVerificationEventToResult({ schemaVersion: 1, type: 'score', viewId: 'v', score: 0.9 }).verdict, 'pass');
  assert.equal(humanVerificationEventToResult({ schemaVersion: 1, type: 'score', viewId: 'v', score: 0.2 }).verdict, 'fail');
  assert.equal(humanVerificationEventToResult({ schemaVersion: 1, type: 'score', viewId: 'v', score: 0.5 }).verdict, 'uncertain');
  assert.equal(humanVerificationEventToResult({ schemaVersion: 1, type: 'comment', viewId: 'v', comment: '需要人工复核' }).verdict, 'uncertain');
});

test('校验 human verification interactive event 的最小形状', () => {
  assert.equal(isHumanVerificationInteractiveEvent({ schemaVersion: 1, type: 'accept', viewId: 'v' }), true);
  assert.equal(isHumanVerificationInteractiveEvent({ schemaVersion: 1, type: 'approve', viewId: 'v' }), false);
  assert.equal(isHumanVerificationInteractiveEvent({ type: 'accept', viewId: 'v' }), false);
});

test('构造带可见 unverified 边界的 VerificationPolicy', () => {
  const policy = buildVerificationPolicy({
    mode: 'none',
    riskLevel: 'low',
    allowUnverified: true,
    unverifiedReason: '低风险草稿，等待后续验证。',
    reason: '用户只请求初稿。',
  });

  assert.equal(policy.required, false);
  assert.equal(policy.allowUnverified, true);
  assert.equal(policy.visibility.exposeUnverified, true);
  assert.equal(policy.unverifiedReason, '低风险草稿，等待后续验证。');
});

test('VerificationResult 显式携带 reward/confidence/critique/evidenceRefs/repairHints，且 unverified 不是成功', () => {
  const result = buildVerificationResult({
    providerId: 'schema.verifier',
    verdict: 'unverified',
    reward: 3,
    confidence: -1,
    critique: 'Not checked yet.',
    evidenceRefs: ['trace://1'],
    repairHints: ['Run schema verifier.'],
  });

  assert.equal(result.reward, 1);
  assert.equal(result.confidence, 0);
  assert.equal(result.critique, 'Not checked yet.');
  assert.deepEqual(result.evidenceRefs, ['trace://1']);
  assert.deepEqual(result.repairHints, ['Run schema verifier.']);
  assert.equal(isVerificationSuccess(result), false);
  assert.equal(isTerminalVerificationVerdict('unverified'), false);
  assert.equal(isVerificationSuccess(buildVerificationResult({ verdict: 'pass', reward: 1, confidence: 0.9 })), true);
});

test('构造 verification request 时规范化 refs 并保留 policy', () => {
  const policy = buildVerificationPolicy({
    mode: 'automatic',
    riskLevel: 'medium',
    requiredVerifierIds: ['schema.verifier', 'schema.verifier'],
    reason: '需要自动校验 artifact contract。',
  });
  const request = buildVerificationRequest({
    goal: 'Validate the artifact payload.',
    artifactRefs: ['artifact://a', 'artifact://a'],
    traceRefs: ['trace://run'],
    policy,
  });

  assert.equal(request.schemaVersion, 1);
  assert.deepEqual(request.artifactRefs, ['artifact://a']);
  assert.deepEqual(request.policy.requiredVerifierIds, ['schema.verifier']);
});

test('构造 Verifier capability brief 并声明标准结果字段', () => {
  const defaultPolicy = buildVerificationPolicy({
    mode: 'hybrid',
    riskLevel: 'high',
    reason: '高风险动作需要自动验证和人工确认。',
  });
  const brief = buildVerifierCapabilityBrief({
    id: 'human.acceptance',
    providerType: 'human',
    oneLine: 'Converts human accept/reject/revise feedback into VerificationResult.',
    defaultPolicy,
    domains: ['all'],
    triggers: ['approval', 'high risk'],
    costClass: 'variable',
    latencyClass: 'variable',
  });

  assert.equal(brief.kind, 'verifier');
  assert.equal(brief.providerType, 'human');
  assert.deepEqual(brief.output.fields, ['verdict', 'reward', 'confidence', 'critique', 'evidenceRefs', 'repairHints']);
  assert.ok(brief.supportedVerdicts.includes('needs-human'));
  assert.equal(brief.safetyPrivacy.requiresHumanForHighRisk, true);
});

test('规范化不完整 verification policy 和 result payload', () => {
  const policy = normalizeVerificationPolicy({
    mode: 'automatic',
    riskLevel: 'high',
    required: true,
    visibility: { exposeCritique: false },
    reason: 'Check published artifact.',
  });
  const result = normalizeVerificationResult({
    verdict: 'not-real',
    evidenceRefs: [' evidence://1 ', 'evidence://1'],
    repairHints: ['rerun tests'],
  });

  assert.equal(policy.mode, 'automatic');
  assert.equal(policy.visibility.exposeCritique, false);
  assert.equal(result.verdict, 'unverified');
  assert.equal(result.reward, 0);
  assert.equal(result.confidence, 0);
  assert.deepEqual(result.evidenceRefs, ['evidence://1']);
});
