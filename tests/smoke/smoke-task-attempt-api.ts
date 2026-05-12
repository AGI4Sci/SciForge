import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { buildCompactRepairContext } from '../../src/runtime/gateway/agentserver-prompts';
import { buildContextEnvelope } from '../../src/runtime/gateway/context-envelope';
import { ensureSessionBundle } from '../../src/runtime/session-bundle';
import { appendTaskAttempt, readRecentTaskAttempts } from '../../src/runtime/task-attempt-history';
import type { GatewayRequest, SkillAvailability, TaskAttemptRecord, WorkspaceTaskRunResult } from '../../src/runtime/runtime-types';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-task-attempts-'));
const port = 20080 + Math.floor(Math.random() * 1000);
const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/workspace-server.ts'], {
  cwd: process.cwd(),
  env: {
    ...process.env,
    SCIFORGE_WORKSPACE_PORT: String(port),
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  const sessionBundleRef = '.sciforge/sessions/2026-04-25_literature-evidence-review_session-task-attempt-api';
  await ensureSessionBundle(workspace, sessionBundleRef, {
    sessionId: 'session-task-attempt-api',
    scenarioId: 'literature-evidence-review',
    title: 'Task attempt API smoke',
    createdAt: '2026-04-25T00:00:00.000Z',
  });
  await writeFileSafe(join(workspace, sessionBundleRef, 'records/session.json'), JSON.stringify({ sessionId: 'session-task-attempt-api' }));
  await writeFileSafe(join(workspace, sessionBundleRef, 'records/messages.json'), '[]');
  await writeFileSafe(join(workspace, sessionBundleRef, 'records/runs.json'), '[]');
  await writeFileSafe(join(workspace, sessionBundleRef, 'records/execution-units.json'), '[]');
  await writeFileSafe(join(workspace, sessionBundleRef, 'README.md'), '# Task attempt API smoke\n');
  await writeFileSafe(join(workspace, sessionBundleRef, 'task-results/run-literature-1.json'), JSON.stringify({
    workEvidence: [{
      kind: 'retrieval',
      status: 'success',
      provider: 'generic-provider',
      resultCount: 3,
      outputSummary: 'Retrieved three bounded records.',
      evidenceRefs: ['trace:provider'],
      recoverActions: [],
      diagnostics: ['provider status 200'],
      rawRef: 'file:.sciforge/logs/run-literature-1.raw.json',
    }],
    rawBody: 'RAW_PROVIDER_LOG_SHOULD_NOT_APPEAR',
  }));
  await writeFileSafe(join(workspace, sessionBundleRef, 'tasks/run-literature-1.py'), 'print("run")\n');
  await writeFileSafe(join(workspace, sessionBundleRef, 'task-inputs/run-literature-1.json'), '{"prompt":"CRISPR base editing review"}\n');
  await writeFileSafe(join(workspace, sessionBundleRef, 'logs/run-literature-1.stdout.log'), 'RAW_STDOUT_LOG_SHOULD_NOT_APPEAR\n');
  await writeFileSafe(join(workspace, sessionBundleRef, 'logs/run-literature-1.stderr.log'), '');

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
    codeRef: `${sessionBundleRef}/tasks/run-literature-1.py`,
    stdoutRef: `${sessionBundleRef}/logs/run-literature-1.stdout.log`,
    stderrRef: `${sessionBundleRef}/logs/run-literature-1.stderr.log`,
    outputRef: `${sessionBundleRef}/task-results/run-literature-1.json`,
    sessionId: 'session-task-attempt-api',
    sessionBundleRef,
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
  assert.equal(scopedAttempts[0].workEvidenceSummary?.items[0]?.resultCount, 3);
  const newPackageAttempts = await readRecentTaskAttempts(workspace, 'literature', 8, {
    scenarioPackageId: 'new-literature-package',
    prompt: 'CRISPR base editing review continuation',
  });
  assert.equal(newPackageAttempts.length, 0);
  await waitForHealth(port);
  const baseUrl = `http://127.0.0.1:${port}`;

  let response = await fetch(`${baseUrl}/api/sciforge/task-attempts/list?workspacePath=${encodeURIComponent(workspace)}&skillDomain=literature&scenarioPackageId=literature-evidence-review`);
  await assertOk(response);
  const listed = await response.json() as { attempts: TaskAttemptRecord[]; taskRunCards?: Array<NonNullable<TaskAttemptRecord['taskRunCard']>> };
  assert.equal(listed.attempts.length, 1);
  assert.equal(listed.attempts[0].runtimeProfileId, 'workspace-python');
  assert.equal(listed.attempts[0].routeDecision?.selectedSkill, 'literature.pubmed_search');
  assert.equal(listed.attempts[0].scenarioPackageRef?.id, 'literature-evidence-review');
  assert.equal(listed.attempts[0].workEvidenceSummary?.items[0]?.resultCount, 3);
  assert.equal(listed.attempts[0].sessionBundleAudit?.ready, true);
  assert.ok(listed.attempts[0].sessionBundleAudit?.checklist.some((item) => item.id === 'restore.entrypoints' && item.status === 'pass'));
  assert.equal(listed.attempts[0].taskRunCard?.schemaVersion, 'sciforge.task-run-card.v1');
  assert.equal(listed.taskRunCards?.[0]?.id, listed.attempts[0].taskRunCard?.id);
  assert.doesNotMatch(JSON.stringify(listed), /RAW_PROVIDER_LOG_SHOULD_NOT_APPEAR|RAW_STDOUT_LOG_SHOULD_NOT_APPEAR/);

  response = await fetch(`${baseUrl}/api/sciforge/task-attempts/get?workspacePath=${encodeURIComponent(workspace)}&id=run-literature-1`);
  await assertOk(response);
  const loaded = await response.json() as { attempts: TaskAttemptRecord[]; taskRunCards?: Array<NonNullable<TaskAttemptRecord['taskRunCard']>> };
  assert.equal(loaded.attempts.length, 1);
  assert.equal(loaded.attempts[0].stdoutRef, `${sessionBundleRef}/logs/run-literature-1.stdout.log`);
  assert.equal(loaded.attempts[0].sessionBundleAudit?.ready, true);
  assert.ok(loaded.attempts[0].taskRunCard?.refs.some((ref) => ref.kind === 'verification' && ref.ref.endsWith('/records/session-bundle-audit.json')));
  assert.equal(loaded.attempts[0].workEvidenceSummary?.items[0]?.diagnostics[0], 'provider status 200');
  assert.equal(loaded.attempts[0].taskRunCard?.goal, 'CRISPR base editing review');
  assert.equal(loaded.taskRunCards?.[0]?.taskId, 'run-literature-1');
  assert.doesNotMatch(JSON.stringify(loaded), /RAW_PROVIDER_LOG_SHOULD_NOT_APPEAR|RAW_STDOUT_LOG_SHOULD_NOT_APPEAR/);

  const repairContext = await buildCompactRepairContext({
    request: gatewayRequest(),
    workspace,
    skill: skill(),
    run: taskRunResult(),
    schemaErrors: [],
    failureReason: 'Need repair with prior WorkEvidence.',
    priorAttempts: scopedAttempts,
  });
  const repairSerialized = JSON.stringify(repairContext);
  assert.match(repairSerialized, /workEvidenceSummary/);
  assert.match(repairSerialized, /provider status 200/);
  assert.doesNotMatch(repairSerialized, /RAW_PROVIDER_LOG_SHOULD_NOT_APPEAR|RAW_STDOUT_LOG_SHOULD_NOT_APPEAR/);

  const envelope = buildContextEnvelope(gatewayRequest(), {
    workspace,
    priorAttempts: scopedAttempts,
    mode: 'delta',
  });
  const envelopeSerialized = JSON.stringify(envelope);
  assert.match(envelopeSerialized, /workEvidenceSummary/);
  assert.match(envelopeSerialized, /provider status 200/);
  assert.doesNotMatch(envelopeSerialized, /RAW_PROVIDER_LOG_SHOULD_NOT_APPEAR|RAW_STDOUT_LOG_SHOULD_NOT_APPEAR/);

  response = await fetch(`${baseUrl}/api/sciforge/task-attempts/list?workspacePath=${encodeURIComponent(workspace)}&scenarioPackageId=other`);
  await assertOk(response);
  const filtered = await response.json() as { attempts: TaskAttemptRecord[] };
  assert.equal(filtered.attempts.length, 0);

  console.log('[ok] task-attempts APIs, repair context, and context envelope expose WorkEvidence summaries without raw logs');
} finally {
  child.kill('SIGTERM');
}

async function writeFileSafe(path: string, value: string) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, value, 'utf8');
}

function gatewayRequest(): GatewayRequest {
  return {
    skillDomain: 'literature',
    prompt: 'CRISPR base editing review continuation',
    scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'workspace' },
    skillPlanRef: 'skill-plan/literature-evidence-review@1.0.0',
    uiPlanRef: 'ui-plan/literature-evidence-review@1.0.0',
    artifacts: [],
    uiState: {},
  } as GatewayRequest;
}

function skill(): SkillAvailability {
  return {
    id: 'literature.pubmed_search',
    kind: 'workspace',
    available: true,
    reason: 'smoke fixture',
    checkedAt: '2026-04-25T00:00:00.000Z',
    manifestPath: '.sciforge/skills/literature.pubmed_search/skill.json',
    manifest: {
      id: 'literature.pubmed_search',
      name: 'PubMed Search',
      domain: 'literature',
      entrypoint: { type: 'python', command: 'main' },
    },
  } as unknown as SkillAvailability;
}

function taskRunResult(): WorkspaceTaskRunResult {
  return {
    spec: {
      id: 'run-literature-1',
      language: 'python',
      entrypoint: 'main',
      taskRel: '.sciforge/tasks/run-literature-1.py',
      input: {},
      outputRel: '.sciforge/task-results/run-literature-1.json',
      stdoutRel: '.sciforge/logs/run-literature-1.stdout.log',
      stderrRel: '.sciforge/logs/run-literature-1.stderr.log',
    },
    workspace,
    command: 'python',
    args: [],
    exitCode: 0,
    stdoutRef: '.sciforge/logs/run-literature-1.stdout.log',
    stderrRef: '.sciforge/logs/run-literature-1.stderr.log',
    outputRef: '.sciforge/task-results/run-literature-1.json',
    stdout: '',
    stderr: '',
    runtimeFingerprint: {},
  } as WorkspaceTaskRunResult;
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
