import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { maybeWriteSkillPromotionProposal } from '../../src/runtime/skill-promotion.js';
import type { GatewayRequest, SkillAvailability, ToolPayload } from '../../src/runtime/runtime-types.js';
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

  await writeProposal(workspace, 'scvelo-velocity-report', 'scvelo velocity report api reject smoke');
  await writeProposal(workspace, 'single-cell-label-transfer-qc', 'single-cell label-transfer qc report api archive smoke');

  response = await fetch(`${baseUrl}/api/bioagent/skill-proposals/list?workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  let proposalList = await response.json() as { proposals: Array<{ id: string; status: string }> };
  assert.equal(proposalList.proposals.length, 2);

  response = await fetch(`${baseUrl}/api/bioagent/skill-proposals/reject`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, id: 'scvelo-velocity-report', reason: 'not reusable enough' }),
  });
  await assertOk(response);
  let proposalResult = await response.json() as { proposal: { status: string; statusReason?: string } };
  assert.equal(proposalResult.proposal.status, 'rejected');
  assert.equal(proposalResult.proposal.statusReason, 'not reusable enough');

  response = await fetch(`${baseUrl}/api/bioagent/skill-proposals/accept`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, id: 'scvelo-velocity-report' }),
  });
  assert.equal(response.status, 400);

  response = await fetch(`${baseUrl}/api/bioagent/skill-proposals/archive`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath: workspace, id: 'single-cell-label-transfer-qc', reason: 'reviewed later' }),
  });
  await assertOk(response);
  proposalResult = await response.json() as { proposal: { status: string; statusReason?: string } };
  assert.equal(proposalResult.proposal.status, 'archived');
  assert.equal(proposalResult.proposal.statusReason, 'reviewed later');

  response = await fetch(`${baseUrl}/api/bioagent/skill-proposals/list?workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  proposalList = await response.json() as { proposals: Array<{ id: string; status: string }> };
  assert.ok(proposalList.proposals.some((proposal) => proposal.id === 'scvelo-velocity-report' && proposal.status === 'rejected'));
  assert.ok(proposalList.proposals.some((proposal) => proposal.id === 'single-cell-label-transfer-qc' && proposal.status === 'archived'));

  console.log('[ok] workspace scenario and skill proposal APIs save, list, publish, archive, restore, reject, and archive proposals');
} finally {
  child.kill('SIGTERM');
}

async function writeProposal(workspacePath: string, id: string, prompt: string) {
  const taskRel = `.bioagent/tasks/${id}/task.py`;
  await mkdir(join(workspacePath, '.bioagent', 'tasks', id), { recursive: true });
  await writeFile(join(workspacePath, taskRel), [
    'import json',
    'import sys',
    'with open(sys.argv[2], "w", encoding="utf-8") as handle:',
    '    json.dump({"message": "ok", "claims": [], "uiManifest": [], "executionUnits": [], "artifacts": [{"id": "artifact.api", "type": "runtime-artifact"}]}, handle)',
    '',
  ].join('\n'), 'utf8');
  const proposal = await maybeWriteSkillPromotionProposal({
    workspacePath,
    request: omicsRequest(prompt, workspacePath),
    skill: generatedOmicsSkill(),
    taskId: `task-${id}`,
    taskRel,
    payload: successfulPayload(id),
  });
  assert.equal(proposal?.id, id);
}

function generatedOmicsSkill(): SkillAvailability {
  return {
    id: 'agentserver.generate.omics',
    kind: 'installed',
    available: true,
    reason: 'workspace server smoke',
    checkedAt: new Date().toISOString(),
    manifestPath: 'agentserver://generation',
    manifest: {
      id: 'agentserver.generate.omics',
      kind: 'installed',
      description: 'Generic AgentServer task generation fallback.',
      skillDomains: ['omics'],
      inputContract: { prompt: 'string' },
      outputArtifactSchema: { type: 'runtime-artifact' },
      entrypoint: { type: 'agentserver-generation' },
      environment: { runtime: 'AgentServer' },
      validationSmoke: { mode: 'delegated' },
      examplePrompts: [],
      promotionHistory: [],
    },
  };
}

function omicsRequest(prompt: string, workspacePath: string): GatewayRequest {
  return {
    skillDomain: 'omics',
    prompt,
    workspacePath,
    artifacts: [],
  };
}

function successfulPayload(id: string): ToolPayload {
  return {
    message: `${id} completed.`,
    confidence: 0.9,
    claimType: 'analysis-report',
    evidenceLevel: 'smoke',
    reasoningTrace: 'workspace server proposal API smoke',
    claims: [],
    uiManifest: [],
    executionUnits: [{ id: `unit.${id}`, status: 'done' }],
    artifacts: [{ id: `artifact.${id}`, type: 'runtime-artifact' }],
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
