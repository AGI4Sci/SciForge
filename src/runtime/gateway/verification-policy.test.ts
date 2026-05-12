import assert from 'node:assert/strict';
import test from 'node:test';
import { access, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GatewayRequest, ToolPayload } from '../runtime-types.js';
import { applyRuntimeVerificationPolicy } from './verification-policy.js';

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
