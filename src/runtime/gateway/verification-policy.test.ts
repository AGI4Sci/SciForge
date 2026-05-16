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
