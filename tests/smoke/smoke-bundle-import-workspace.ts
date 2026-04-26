import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { BioAgentSession } from '../../src/ui/src/domain';
import { buildExecutionBundle, evaluateExecutionBundleExport } from '../../src/ui/src/exportPolicy';
import { runScenarioRuntimeSmoke } from '../../src/ui/src/scenarioCompiler/runtimeSmoke';
import { buildBuiltInScenarioPackage } from '../../src/ui/src/scenarioCompiler/scenarioPackage';

const sourceWorkspace = await mkdtemp(join(tmpdir(), 'bioagent-bundle-source-'));
const targetWorkspace = await mkdtemp(join(tmpdir(), 'bioagent-bundle-target-'));
const port = 20080 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/workspace-server.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    BIOAGENT_WORKSPACE_PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await waitForHealth(port);
  const baseUrl = `http://127.0.0.1:${port}`;
  const pkg = buildBuiltInScenarioPackage('literature-evidence-review', '2026-04-25T00:00:00.000Z');
  const session = bundleFixtureSession();
  const decision = evaluateExecutionBundleExport(session);
  const bundle = buildExecutionBundle(session, decision);

  await writeFile(join(sourceWorkspace, 'bioagent-execution-bundle.json'), JSON.stringify({
    package: pkg,
    executionBundle: bundle,
  }, null, 2));

  let response = await fetch(`${baseUrl}/api/bioagent/scenarios/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: targetWorkspace, package: pkg }),
  });
  await assertOk(response);

  response = await fetch(`${baseUrl}/api/bioagent/scenarios/get?workspacePath=${encodeURIComponent(targetWorkspace)}&id=${encodeURIComponent(pkg.id)}`);
  await assertOk(response);
  const loaded = await response.json() as { package: typeof pkg };
  assert.equal(loaded.package.id, pkg.id);
  assert.equal(loaded.package.uiPlan.slots[0].componentId, 'paper-card-list');
  assert.deepEqual(bundle.runs[0].scenarioPackageRef, { id: pkg.id, version: pkg.version, source: 'built-in' });

  const smoke = await runScenarioRuntimeSmoke({ package: loaded.package, mode: 'dry-run' });
  assert.equal(smoke.ok, true, JSON.stringify(smoke.validationReport.issues, null, 2));

  console.log('[ok] execution bundle exports, imports package into a new workspace, opens it, and dry-runs the scenario');
} finally {
  child.kill('SIGTERM');
}

function bundleFixtureSession(): BioAgentSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-bundle-import',
    scenarioId: 'literature-evidence-review',
    title: 'Bundle import smoke',
    createdAt: '2026-04-25T00:00:00.000Z',
    updatedAt: '2026-04-25T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-bundle-import',
      scenarioId: 'literature-evidence-review',
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
      skillPlanRef: 'skill-plan.literature-evidence-review.default',
      uiPlanRef: 'ui-plan.literature-evidence-review.default',
      status: 'completed',
      prompt: 'KRAS G12D evidence',
      response: 'done',
      createdAt: '2026-04-25T00:00:00.000Z',
      completedAt: '2026-04-25T00:00:01.000Z',
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [{
      id: 'EU-bundle-import',
      tool: 'literature.pubmed_search',
      params: '{"query":"KRAS G12D"}',
      status: 'done',
      hash: 'bundle-import-hash',
      outputArtifacts: ['artifact-bundle-paper-list'],
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
    }],
    artifacts: [{
      id: 'artifact-bundle-paper-list',
      type: 'paper-list',
      producerScenario: 'literature-evidence-review',
      scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
      schemaVersion: '1',
      data: { papers: [] },
      visibility: 'project-record',
      exportPolicy: 'allowed',
    }],
    notebook: [],
    versions: [],
  };
}

async function waitForHealth(portNumber: number) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${portNumber}/health`);
      if (response.ok) return;
    } catch {
      // Server is still starting.
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`workspace server did not start on ${portNumber}`);
}

async function assertOk(response: Response) {
  if (response.status !== 200) {
    assert.equal(response.status, 200, await response.text());
  }
}
