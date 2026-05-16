import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { applyRuntimeVerificationPolicy, evaluateVerificationGate, normalizeRuntimeVerificationPolicy } from './verification-policy.js';

test('runtime verification artifacts are stored in the current session bundle', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-verification-session-bundle-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'verify report',
    artifacts: [],
    uiState: {
      sessionId: 'session-verify-1',
      sessionCreatedAt: '2026-05-12T01:00:00.000Z',
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };
  const payload: ToolPayload = {
    message: 'Verified content.',
    confidence: 0.8,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: 'test payload',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'unit-1', status: 'done', tool: 'test' }],
    artifacts: [],
    verificationResults: [{
      id: 'verification-known',
      verdict: 'pass',
      confidence: 0.9,
      evidenceRefs: [],
      repairHints: [],
    }],
  };

  const verified = await applyRuntimeVerificationPolicy(payload, request);
  const verificationRef = verified.verificationResults?.[0]?.id
    ? `.sciforge/sessions/2026-05-12_literature-evidence-review_session-verify-1/verifications/${verified.verificationResults[0].id}.json`
    : '';

  assert.equal(verificationRef.endsWith('/verification-known.json'), true);
  await access(join(workspace, verificationRef));
  await assert.rejects(access(join(workspace, '.sciforge/verifications/verification-known.json')));
  assert.match(verified.reasoningTrace, /\.sciforge\/sessions\/2026-05-12_literature-evidence-review_session-verify-1\/verifications\/verification-known\.json/);
});

test('direct-context non-required harness policy records visible unverified without blocking satisfaction', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Using only the selected reproduction report, tell me whether this toy reproduction is credible and list exact metrics plus one next validation step.',
    artifacts: [],
    verificationPolicy: {
      required: false,
      mode: 'lightweight',
      riskLevel: 'medium',
      reason: 'contractRef=runtime://agent-harness/contracts/balanced-default/test; direct-context answer records visible verification without requiring a blocking verifier',
    },
    uiState: {
      conversationPolicy: {
        executionModePlan: { executionMode: 'direct-context-answer' },
        responsePlan: { initialResponseMode: 'direct-context-answer' },
      },
      latencyPolicy: { blockOnVerification: false },
    },
  };
  const payload: ToolPayload = {
    message: 'Answered directly from the selected report.',
    confidence: 0.78,
    claimType: 'context-summary',
    evidenceLevel: 'current-session-context',
    reasoningTrace: 'direct-context fast path',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'EU-direct-context-report-followup', status: 'done', tool: 'sciforge.direct-context-fast-path' }],
    artifacts: [],
  };

  const policy = normalizeRuntimeVerificationPolicy(request, payload);
  const gate = evaluateVerificationGate(payload, request, policy);

  assert.equal(policy.required, false);
  assert.equal(gate.blocked, false);
  assert.equal(gate.result.verdict, 'unverified');
  assert.equal(gate.result.diagnostics?.required, false);
  assert.equal(gate.result.diagnostics?.visibleUnverified, true);
});

test('direct-context fast path payload relaxes default runtime verification to non-blocking', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-direct-context-verification-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: '反事实验收：如果新门槛改成 r error <= 1%、K error <= 1%、RMSE <= 3，这个 toy reproduction 是否仍可判成功？',
    artifacts: [],
    uiState: {
      sessionId: 'session-direct-context-verify',
      sessionCreatedAt: '2026-05-12T01:00:00.000Z',
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };
  const payload: ToolPayload = {
    message: '只基于当前选中的 selected report 做反事实门槛验收。\n\n是否仍可判成功：不能。',
    confidence: 0.74,
    claimType: 'context-summary',
    evidenceLevel: 'current-session-context',
    reasoningTrace: 'direct-context fast path',
    claims: [],
    uiManifest: [],
    executionUnits: [{
      id: 'EU-direct-context-report-followup',
      status: 'done',
      tool: 'sciforge.direct-context-fast-path',
    }],
    artifacts: [],
    displayIntent: {
      protocolStatus: 'protocol-success',
      taskOutcome: 'satisfied',
      status: 'completed',
    },
  };

  const policy = normalizeRuntimeVerificationPolicy(request, payload);
  const gate = evaluateVerificationGate(payload, request, policy);
  const verified = await applyRuntimeVerificationPolicy(payload, request);
  const displayVerification = verified.displayIntent?.verification as Record<string, unknown> | undefined;

  assert.equal(policy.required, false);
  assert.equal(gate.blocked, false);
  assert.equal(gate.result.diagnostics?.required, false);
  assert.equal(gate.result.diagnostics?.visibleUnverified, true);
  assert.equal(displayVerification?.nonBlocking, true);
  assert.equal(verified.verificationResults?.[0]?.diagnostics?.required, false);
});

test('direct-context fast-path payload relaxes harness verification without canonical request hints', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-direct-context-verification-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: '只基于当前选中的 reproduction-report，报告里的 Random seed 是几？Optimizer 是什么？',
    artifacts: [],
    verificationPolicy: {
      required: true,
      mode: 'lightweight',
      riskLevel: 'medium',
      reason: 'contractRef=runtime://agent-harness/contracts/balanced-default/test; intensity=light',
    },
    uiState: {
      sessionId: 'session-direct-context-verification',
      sessionCreatedAt: '2026-05-12T01:00:00.000Z',
    },
  };
  const payload: ToolPayload = {
    message: '只基于当前选中的 reproduction-report 回答，不给可信度总结。\n\n- Random seed: 42\n- Optimizer: differential_evolution',
    confidence: 0.78,
    claimType: 'context-summary',
    evidenceLevel: 'current-session-context',
    reasoningTrace: 'direct-context fast path',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'EU-direct-context-report-followup', status: 'done', tool: 'sciforge.direct-context-fast-path' }],
    artifacts: [],
  };

  const verified = await applyRuntimeVerificationPolicy(payload, request);
  const displayVerification = verified.displayIntent?.verification as Record<string, unknown> | undefined;

  assert.equal(verified.claimType, 'context-summary');
  assert.equal(displayVerification?.nonBlocking, true);
  assert.equal(verified.verificationPolicy?.required, false);
  assert.equal(verified.verificationResults?.[0]?.diagnostics?.required, false);
  assert.doesNotMatch(verified.message, /required verification is still unverified|Partial result artifacts/i);
});

test('harness light verification is visible non-blocking for generated work when latency allows it', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-generated-background-verification-'));
  const request: GatewayRequest = {
    workspacePath: workspace,
    skillDomain: 'literature',
    prompt: 'Generate a mini grant research package with brief, decision log, risk register, timeline, and budget.',
    artifacts: [],
    verificationPolicy: {
      required: true,
      mode: 'lightweight',
      riskLevel: 'medium',
      reason: 'contractRef=runtime://agent-harness/contracts/balanced-default/test; profileId=balanced-default; intensity=light',
    },
    uiState: {
      sessionId: 'session-generated-background-verify',
      sessionCreatedAt: '2026-05-12T01:00:00.000Z',
      conversationPolicy: {
        latencyPolicy: { blockOnVerification: false },
      },
    },
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
  };
  const payload: ToolPayload = {
    message: 'Research package generated successfully. See artifacts for full details.',
    confidence: 0.86,
    claimType: 'research-package',
    evidenceLevel: 'generated',
    reasoningTrace: 'workspace task completed',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: 'generate-mini-grant', status: 'done', tool: 'workspace-task' }],
    artifacts: [{
      id: 'mini-grant-package',
      type: 'markdown',
      kind: 'research-report',
      title: 'Mini Grant Research Package',
      dataRef: '.sciforge/task-results/mini-grant-package.md',
    }],
  };

  const policy = normalizeRuntimeVerificationPolicy(request, payload);
  const gate = evaluateVerificationGate(payload, request, policy);
  const verified = await applyRuntimeVerificationPolicy(payload, request);
  const displayVerification = verified.displayIntent?.verification as Record<string, unknown> | undefined;
  const budgetDebit = verified.budgetDebits?.find((entry) => entry.capabilityId === 'sciforge.runtime-verification-gate');

  assert.equal(policy.required, false);
  assert.equal(gate.blocked, false);
  assert.equal(gate.result.diagnostics?.required, false);
  assert.equal(displayVerification?.nonBlocking, true);
  assert.equal(verified.verificationPolicy?.required, false);
  assert.equal(verified.verificationResults?.[0]?.diagnostics?.required, false);
  assert.equal((budgetDebit?.metadata as Record<string, unknown> | undefined)?.nonBlocking, true);
});
