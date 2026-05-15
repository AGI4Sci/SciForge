import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { GatewayRequest, SkillAvailability, ToolPayload } from '../runtime-types.js';
import { validateAndNormalizePayload } from './payload-validation.js';

function request(workspacePath: string): GatewayRequest {
  return {
    workspacePath,
    skillDomain: 'knowledge',
    prompt: 'Return a small payload.',
    artifacts: [],
  } as GatewayRequest;
}

const skill = {
  id: 'payload-normalization-test',
  kind: 'builtin',
  available: true,
  checkedAt: '2026-05-15T00:00:00.000Z',
  reason: 'test',
} as unknown as SkillAvailability;

const refs = {
  taskRel: '.sciforge/tasks/payload-normalization.py',
  outputRel: '.sciforge/task-results/payload-normalization.json',
  stdoutRel: '.sciforge/logs/payload-normalization.stdout.log',
  stderrRel: '.sciforge/logs/payload-normalization.stderr.log',
  runtimeFingerprint: { language: 'python', command: 'python3' },
};

test('payload validation allows whitelisted reasoningTrace and empty uiManifest artifactRef normalization', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-payload-normalization-'));
  const payload = {
    message: 'Generated a compact result.',
    confidence: 0.8,
    claimType: 'fact',
    evidenceLevel: 'runtime',
    reasoningTrace: ['loaded input', 'wrote output'],
    claims: [],
    uiManifest: [
      { componentId: 'report-viewer', artifactRef: null, priority: 1 },
      { componentId: 'execution-unit-table', artifactRef: '', priority: 2 },
    ],
    executionUnits: [{ id: 'unit-1', status: 'done' }],
    artifacts: [],
  } as unknown as ToolPayload;

  const normalized = await validateAndNormalizePayload(payload, request(workspace), skill, refs);

  assert.match(normalized.reasoningTrace, /loaded input\nwrote output/);
  const reportSlot = normalized.uiManifest.find((slot) => slot.componentId === 'report-viewer');
  const executionSlot = normalized.uiManifest.find((slot) => slot.componentId === 'execution-unit-table');
  assert.ok(reportSlot);
  assert.ok(executionSlot);
  assert.equal('artifactRef' in reportSlot, false);
  assert.equal('artifactRef' in executionSlot, false);
  assert.equal(normalized.claimType, 'fact');
});

test('payload validation keeps structured failure diagnostics after normalization', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-payload-failure-diagnostics-'));
  const payload = {
    message: 'Generated task failed with a structured blocker.',
    confidence: 0.1,
    claimType: 'failed-with-reason',
    evidenceLevel: 'runtime',
    reasoningTrace: ['started task', 'provider returned a retryable error'],
    claims: [],
    uiManifest: [{ componentId: 'execution-unit-table', artifactRef: '' }],
    executionUnits: [{
      id: 'fetch',
      status: 'failed-with-reason',
      failureReason: 'provider 429 after bounded retries',
      diagnostics: { provider: 'example-provider', retryAfterMs: 3000 },
    }],
    artifacts: [],
    failureReason: 'provider 429 after bounded retries',
    diagnostics: { provider: 'example-provider', retryAfterMs: 3000 },
  } as unknown as ToolPayload;

  const normalized = await validateAndNormalizePayload(payload, request(workspace), skill, refs) as ToolPayload & {
    failureReason?: string;
    diagnostics?: Record<string, unknown>;
  };

  assert.equal(normalized.failureReason, 'provider 429 after bounded retries');
  assert.deepEqual(normalized.diagnostics, { provider: 'example-provider', retryAfterMs: 3000 });
  assert.equal(normalized.executionUnits[0]?.failureReason, 'provider 429 after bounded retries');
  assert.deepEqual(normalized.executionUnits[0]?.diagnostics, { provider: 'example-provider', retryAfterMs: 3000 });
});
