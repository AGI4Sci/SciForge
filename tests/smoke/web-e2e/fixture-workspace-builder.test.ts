import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { buildWebE2eFixtureWorkspace } from './fixture-workspace-builder.js';

const rootConfigPath = resolve('config.local.json');
const rootConfigBefore = await readFile(rootConfigPath, 'utf8').catch(() => undefined);
const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-web-e2e-builder-test-'));

try {
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: 'SA-WEB-20',
    baseDir,
    now: '2026-05-16T00:00:00.000Z',
    workspaceWriterBaseUrl: 'http://127.0.0.1:29991',
    agentServerBaseUrl: 'http://127.0.0.1:29992',
  });

  assert.notEqual(resolve(fixture.configLocalPath), rootConfigPath, 'builder must not target repo root config.local.json');
  assert.equal(await readFile(rootConfigPath, 'utf8').catch(() => undefined), rootConfigBefore, 'builder must not write repo root config.local.json');
  assert.equal(fixture.workspaceState.workspacePath, fixture.workspacePath);
  assert.equal(fixture.workspaceState.sessionsByScenario[fixture.scenarioId]?.sessionId, fixture.sessionId);
  assert.equal(fixture.expectedProjection.sessionId, fixture.sessionId);
  assert.equal(fixture.expectedProjection.conversationProjection.visibleAnswer?.status, 'satisfied');
  assert.deepEqual(fixture.expectedProjection.currentTask.explicitRefs.map((ref) => ref.ref), ['artifact:fixture-old-report']);
  assert.deepEqual(fixture.expectedProjection.artifactDelivery.primaryArtifactRefs, ['artifact:fixture-current-report']);
  assert.ok(fixture.expectedProjection.artifactDelivery.supportingArtifactRefs.includes('artifact:fixture-expression-summary'));
  assert.ok(fixture.expectedProjection.artifactDelivery.auditRefs.includes('artifact:fixture-run-audit'));
  assert.ok(fixture.expectedProjection.artifactDelivery.diagnosticRefs.includes('artifact:fixture-diagnostic-log'));
  assert.ok(fixture.expectedProjection.artifactDelivery.internalRefs.includes('artifact:fixture-provider-manifest'));

  const workspaceState = JSON.parse(await readFile(fixture.workspaceStatePath, 'utf8')) as Record<string, unknown>;
  const configLocal = JSON.parse(await readFile(fixture.configLocalPath, 'utf8')) as Record<string, unknown>;
  const providerManifest = JSON.parse(await readFile(fixture.providerManifestPath, 'utf8')) as Record<string, unknown>;
  const expectedProjection = JSON.parse(await readFile(fixture.expectedProjectionPath, 'utf8')) as Record<string, unknown>;
  assert.equal(workspaceState.schemaVersion, 2);
  assert.equal(configLocal.workspacePath, fixture.workspacePath);
  assert.equal(providerManifest.schemaVersion, 'sciforge.web-e2e.provider-manifest.v1');
  assert.equal(expectedProjection.schemaVersion, 'sciforge.web-e2e.expected-projection.v1');
  assert.deepEqual(
    fixture.seedFiles.map((file) => file.kind).sort(),
    ['csv', 'json', 'log', 'markdown', 'markdown', 'pdf', 'text'],
  );
} finally {
  await rm(baseDir, { recursive: true, force: true });
}

console.log('[ok] SA-WEB-20 fixture workspace builder creates isolated workspace, local config path, seeds, and expected Projection');
