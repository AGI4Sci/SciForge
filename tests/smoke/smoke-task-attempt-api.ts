import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { appendTaskAttempt, readRecentTaskAttempts } from '../../src/runtime/task-attempt-history';
import type { TaskAttemptRecord } from '../../src/runtime/runtime-types';

const workspace = await mkdtemp(join(tmpdir(), 'bioagent-task-attempts-'));
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
  const record: TaskAttemptRecord = {
    id: 'run-literature-1',
    prompt: 'CRISPR base editing review',
    skillDomain: 'literature',
    skillId: 'literature.pubmed_search',
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'workspace' },
    skillPlanRef: 'skill-plan/literature-evidence-review@1.0.0',
    uiPlanRef: 'ui-plan/literature-evidence-review@1.0.0',
    runtimeProfileId: 'workspace-python',
    routeDecision: {
      selectedSkill: 'literature.pubmed_search',
      selectedRuntime: 'workspace-python',
      fallbackReason: 'package skill matched',
      selectedAt: '2026-04-25T00:00:00.000Z',
    },
    attempt: 1,
    status: 'done',
    codeRef: '.bioagent/tasks/run-literature-1.py',
    stdoutRef: '.bioagent/logs/run-literature-1.stdout.log',
    stderrRef: '.bioagent/logs/run-literature-1.stderr.log',
    outputRef: '.bioagent/task-results/run-literature-1.json',
    createdAt: '2026-04-25T00:00:01.000Z',
  };
  await appendTaskAttempt(workspace, record);
  await appendTaskAttempt(workspace, {
    ...record,
    id: 'run-literature-other-package',
    prompt: 'unrelated old literature task',
    scenarioPackageRef: { id: 'other-literature-package', version: '1.0.0', source: 'workspace' },
    createdAt: '2026-04-25T00:00:02.000Z',
  });
  const scopedAttempts = await readRecentTaskAttempts(workspace, 'literature', 8, {
    scenarioPackageId: 'literature-evidence-review',
    prompt: 'CRISPR base editing review continuation',
  });
  assert.equal(scopedAttempts.length, 1);
  assert.equal(scopedAttempts[0].id, 'run-literature-1');
  const newPackageAttempts = await readRecentTaskAttempts(workspace, 'literature', 8, {
    scenarioPackageId: 'new-literature-package',
    prompt: 'CRISPR base editing review continuation',
  });
  assert.equal(newPackageAttempts.length, 0);
  await waitForHealth(port);
  const baseUrl = `http://127.0.0.1:${port}`;

  let response = await fetch(`${baseUrl}/api/bioagent/task-attempts/list?workspacePath=${encodeURIComponent(workspace)}&skillDomain=literature&scenarioPackageId=literature-evidence-review`);
  await assertOk(response);
  const listed = await response.json() as { attempts: TaskAttemptRecord[] };
  assert.equal(listed.attempts.length, 1);
  assert.equal(listed.attempts[0].runtimeProfileId, 'workspace-python');
  assert.equal(listed.attempts[0].routeDecision?.selectedSkill, 'literature.pubmed_search');
  assert.equal(listed.attempts[0].scenarioPackageRef?.id, 'literature-evidence-review');

  response = await fetch(`${baseUrl}/api/bioagent/task-attempts/get?workspacePath=${encodeURIComponent(workspace)}&id=run-literature-1`);
  await assertOk(response);
  const loaded = await response.json() as { attempts: TaskAttemptRecord[] };
  assert.equal(loaded.attempts.length, 1);
  assert.equal(loaded.attempts[0].stdoutRef, '.bioagent/logs/run-literature-1.stdout.log');

  response = await fetch(`${baseUrl}/api/bioagent/task-attempts/list?workspacePath=${encodeURIComponent(workspace)}&scenarioPackageId=other`);
  await assertOk(response);
  const filtered = await response.json() as { attempts: TaskAttemptRecord[] };
  assert.equal(filtered.attempts.length, 0);

  console.log('[ok] task-attempts APIs list, filter, and get runtime diagnostics');
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
