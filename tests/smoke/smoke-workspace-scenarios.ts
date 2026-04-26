import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildBuiltInScenarioPackage } from '../../src/ui/src/scenarioCompiler/scenarioPackage';
import { buildScenarioQualityReport } from '../../src/ui/src/scenarioCompiler/scenarioQualityGate';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-scenarios-'));
const port = 19080 + Math.floor(Math.random() * 1000);
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
  const validationReport = { ok: true, issues: [], checkedAt: '2026-04-25T00:00:00.000Z' };
  const qualityReport = buildScenarioQualityReport({ package: { ...pkg, validationReport }, validationReport, checkedAt: '2026-04-25T00:00:00.000Z' });
  const draftPkg = { ...pkg, status: 'draft' as const, validationReport, qualityReport };

  let response = await fetch(`${baseUrl}/api/bioagent/scenarios/save`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, package: draftPkg }),
  });
  await assertOk(response);

  response = await fetch(`${baseUrl}/api/bioagent/scenarios/list?workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  let list = await response.json() as { scenarios: Array<{ id: string; status: string }> };
  assert.equal(list.scenarios.length, 1);
  assert.equal(list.scenarios[0].id, pkg.id);
  assert.equal(list.scenarios[0].status, 'draft');

  response = await fetch(`${baseUrl}/api/bioagent/scenarios/library?workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const library = await response.json() as {
    library: {
      items: Array<{ id: string; packageRef: { version: string } }>;
      viewPresetCandidates: Array<{ uiPlanRef: string }>;
    };
  };
  assert.equal(library.library.items[0].id, pkg.id);
  assert.equal(library.library.items[0].packageRef.version, pkg.version);
  assert.equal(library.library.viewPresetCandidates[0].uiPlanRef, pkg.uiPlan.id);

  response = await fetch(`${baseUrl}/api/bioagent/scenarios/get?workspacePath=${encodeURIComponent(workspace)}&id=${encodeURIComponent(pkg.id)}`);
  await assertOk(response);
  const loaded = await response.json() as { package: typeof pkg };
  assert.equal(loaded.package.scenario.title, pkg.scenario.title);
  assert.equal(loaded.package.uiPlan.slots[0].componentId, 'paper-card-list');
  assert.deepEqual(loaded.package.validationReport, validationReport);
  assert.equal(loaded.package.qualityReport?.ok, true);

  response = await fetch(`${baseUrl}/api/bioagent/scenarios/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, id: pkg.id }),
  });
  await assertOk(response);
  const scenarioJson = JSON.parse(await readFile(join(workspace, '.bioagent', 'scenarios', pkg.id, 'scenario.json'), 'utf8'));
  const validationJson = JSON.parse(await readFile(join(workspace, '.bioagent', 'scenarios', pkg.id, 'validation-report.json'), 'utf8'));
  const qualityJson = JSON.parse(await readFile(join(workspace, '.bioagent', 'scenarios', pkg.id, 'quality-report.json'), 'utf8'));
  assert.equal(scenarioJson.status, 'published');
  assert.deepEqual(validationJson, validationReport);
  assert.equal(qualityJson.ok, true);

  response = await fetch(`${baseUrl}/api/bioagent/scenarios/publish`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      package: {
        ...pkg,
        id: 'blocked-quality-package',
        status: 'draft',
        qualityReport: {
          ok: false,
          checkedAt: '2026-04-25T00:00:00.000Z',
          packageRef: { id: 'blocked-quality-package', version: '1.0.0', status: 'draft' },
          items: [{ severity: 'blocking', code: 'missing-selected-producer', message: 'No producer.' }],
          validationReport: { ok: false, issues: [], checkedAt: '2026-04-25T00:00:00.000Z' },
        },
      },
    }),
  });
  assert.equal(response.status, 400);

  response = await fetch(`${baseUrl}/api/bioagent/scenarios/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, id: pkg.id }),
  });
  await assertOk(response);

  response = await fetch(`${baseUrl}/api/bioagent/scenarios/list?workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  list = await response.json() as { scenarios: Array<{ id: string; status: string }> };
  assert.equal(list.scenarios[0].status, 'archived');

  response = await fetch(`${baseUrl}/api/bioagent/scenarios/restore`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, id: pkg.id, status: 'draft' }),
  });
  await assertOk(response);

  response = await fetch(`${baseUrl}/api/bioagent/scenarios/list?workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  list = await response.json() as { scenarios: Array<{ id: string; status: string }> };
  assert.equal(list.scenarios[0].status, 'draft');

  console.log('[ok] workspace scenario package APIs save, list, get, publish, archive, and restore');
} finally {
  child.kill('SIGTERM');
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
  const stderr = await readStream(child.stderr);
  throw new Error(`workspace server did not start on ${portNumber}\n${stderr}`);
}

async function assertOk(response: Response) {
  if (response.status !== 200) {
    assert.equal(response.status, 200, await response.text());
  }
}

async function readStream(stream: NodeJS.ReadableStream | null) {
  if (!stream) return '';
  const chunks: Buffer[] = [];
  stream.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
  await new Promise((resolve) => setTimeout(resolve, 50));
  return Buffer.concat(chunks).toString('utf8');
}
