import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  auditSessionBundle,
  ensureSessionBundle,
  sessionBundleRel,
  sessionBundleRelForRequest,
  sessionBundleResourceRel,
  writeSessionBundleAudit,
} from './session-bundle.js';
import type { GatewayRequest } from './runtime-types.js';

test('session bundle paths include date, scenario, and session id', () => {
  assert.equal(
    sessionBundleRel({
      sessionId: 'session-workspace-literature-moqv3d2m',
      scenarioId: 'literature/evidence review',
      createdAt: '2026-05-11T04:00:00.000Z',
    }),
    '.sciforge/sessions/2026-05-11_literature_evidence_review_session-workspace-literature-moqv3d2m',
  );
});

test('request session bundle paths are resource roots for generated work', () => {
  const request: GatewayRequest = {
    skillDomain: 'literature',
    prompt: 'Find papers',
    artifacts: [],
    uiState: { sessionId: 'session-1', sessionCreatedAt: '2026-05-10T23:00:00.000Z' },
  };
  const bundle = sessionBundleRelForRequest(request, new Date('2026-05-11T08:00:00.000Z'));

  assert.equal(bundle, '.sciforge/sessions/2026-05-10_literature_session-1');
  assert.equal(
    sessionBundleResourceRel(bundle, 'task-results', 'generated-demo.json'),
    '.sciforge/sessions/2026-05-10_literature_session-1/task-results/generated-demo.json',
  );
});

test('session bundle manifest and audit expose pack/restore/audit checklist', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-session-bundle-audit-'));
  const bundleRel = '.sciforge/sessions/2026-05-12_demo_session-1';
  try {
    await ensureSessionBundle(workspace, bundleRel, {
      sessionId: 'session-1',
      scenarioId: 'demo',
      createdAt: '2026-05-12T00:00:00.000Z',
    });
    await writeFile(join(workspace, bundleRel, 'records', 'session.json'), '{}');
    await writeFile(join(workspace, bundleRel, 'records', 'messages.json'), '[]');
    await writeFile(join(workspace, bundleRel, 'records', 'runs.json'), '[]');
    await writeFile(join(workspace, bundleRel, 'records', 'execution-units.json'), '[]');
    await mkdir(join(workspace, bundleRel, 'verifications'), { recursive: true });
    await writeFile(join(workspace, bundleRel, 'README.md'), '# bundle\n');

    const manifest = JSON.parse(await readFile(join(workspace, bundleRel, 'manifest.json'), 'utf8'));
    assert.equal(manifest.restore.taskAttemptsRoot, `${bundleRel}/records/task-attempts/`);
    assert.ok(manifest.migrationChecklist.some((item: { id?: string }) => item.id === 'pack.generated-work'));
    assert.ok(manifest.migrationChecklist.some((item: { id?: string }) => item.id === 'restore.entrypoints'));
    assert.ok(manifest.migrationChecklist.some((item: { id?: string }) => item.id === 'audit.replay-evidence'));

    const report = await auditSessionBundle(workspace, bundleRel, new Date('2026-05-12T00:01:00.000Z'));
    assert.equal(report.ready, true);
    assert.equal(report.checklist.find((item) => item.id === 'pack.session-records')?.status, 'pass');
    assert.equal(report.checklist.find((item) => item.id === 'audit.replay-evidence')?.status, 'warn');

    const written = await writeSessionBundleAudit(workspace, bundleRel, new Date('2026-05-12T00:02:00.000Z'));
    assert.equal(written.auditRef, `${bundleRel}/records/session-bundle-audit.json`);
    const persisted = JSON.parse(await readFile(join(workspace, written.auditRef), 'utf8'));
    assert.equal(persisted.bundleRel, bundleRel);
  } finally {
    await rm(workspace, { recursive: true, force: true });
  }
});
