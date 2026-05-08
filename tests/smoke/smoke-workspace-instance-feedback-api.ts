import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const workspace = await mkdtemp(join(tmpdir(), 'sciforge-instance-feedback-api-'));
const port = 24200 + Math.floor(Math.random() * 1000);
const configPath = join(workspace, 'config.local.json');
const child = spawn(process.execPath, ['--import', 'tsx', 'src/runtime/workspace-server.ts'], {
  cwd: process.cwd(),
  env: { ...process.env, SCIFORGE_WORKSPACE_PORT: String(port), SCIFORGE_CONFIG_PATH: configPath },
  stdio: ['ignore', 'pipe', 'pipe'],
});

try {
  await mkdir(join(workspace, '.sciforge'), { recursive: true });
  await writeFile(join(workspace, '.sciforge', 'workspace-state.json'), JSON.stringify(workspaceState(workspace), null, 2));
  await waitForHealth(port);
  const baseUrl = `http://127.0.0.1:${port}`;

  let response = await fetch(`${baseUrl}/api/sciforge/instance/manifest?workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const manifestJson = await response.json() as { manifest: { schemaVersion: number; instance: { id: string; name: string }; workspacePath: string; repo: { detected: boolean }; capabilities: string[] } };
  assert.equal(manifestJson.manifest.schemaVersion, 1);
  assert.ok(manifestJson.manifest.instance.id.startsWith('sciforge-'));
  assert.equal(manifestJson.manifest.workspacePath, workspace);
  assert.equal(manifestJson.manifest.repo.detected, false);
  assert.ok(manifestJson.manifest.capabilities.includes('feedback-issue-handoff-bundle'));

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues?workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const listJson = await response.json() as { issues: Array<{ id: string; status: string; github?: { issueNumber?: number }; screenshot?: { hasDataUrl: boolean; dataUrlBytes: number } }> };
  assert.deepEqual(listJson.issues.map((issue) => issue.id), ['feedback-open']);
  assert.equal(listJson.issues[0].github?.issueNumber, 42);
  assert.equal(listJson.issues[0].screenshot?.hasDataUrl, true);
  assert.ok((listJson.issues[0].screenshot?.dataUrlBytes ?? 0) > 20);

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open?workspacePath=${encodeURIComponent(workspace)}`);
  await assertOk(response);
  const bundleJson = await response.json() as { issue: { id: string; comment: { comment: string }; target: { selector: string }; runtime: { sessionId: string }; request: { id: string }; github?: { openIssue?: { htmlUrl: string } } } };
  assert.equal(bundleJson.issue.id, 'feedback-open');
  assert.equal(bundleJson.issue.comment.comment, 'Fix the chart legend handoff.');
  assert.equal(bundleJson.issue.target.selector, '[data-testid="legend"]');
  assert.equal(bundleJson.issue.runtime.sessionId, 'session-1');
  assert.equal(bundleJson.issue.request.id, 'request-1');
  assert.equal(bundleJson.issue.github?.openIssue?.htmlUrl, 'https://github.com/org/repo/issues/42');

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-runs`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      id: 'repair-run-1',
      externalInstanceId: 'external-alpha',
      actor: 'agent',
      startedAt: '2026-05-07T01:00:00.000Z',
    }),
  });
  await assertOk(response);
  const runJson = await response.json() as { run: { id: string; status: string; issueId: string } };
  assert.equal(runJson.run.id, 'repair-run-1');
  assert.equal(runJson.run.status, 'running');
  assert.equal(runJson.run.issueId, 'feedback-open');

  response = await fetch(`${baseUrl}/api/sciforge/feedback/issues/feedback-open/repair-result`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath: workspace,
      result: {
        id: 'repair-result-1',
        repairRunId: 'repair-run-1',
        verdict: 'fixed',
        summary: 'Legend labels are now structured for sync.',
        changedFiles: ['src/runtime/workspace-server.ts'],
        evidenceRefs: ['tests/smoke/smoke-workspace-instance-feedback-api.ts'],
        completedAt: '2026-05-07T01:05:00.000Z',
      },
    }),
  });
  await assertOk(response);
  const resultJson = await response.json() as { result: { id: string; verdict: string; changedFiles: string[]; githubSyncStatus?: string; githubSyncError?: string } };
  assert.equal(resultJson.result.id, 'repair-result-1');
  assert.equal(resultJson.result.verdict, 'fixed');
  assert.deepEqual(resultJson.result.changedFiles, ['src/runtime/workspace-server.ts']);
  assert.equal(resultJson.result.githubSyncStatus, 'skipped');
  assert.match(resultJson.result.githubSyncError ?? '', /token is not configured/i);

  const savedState = JSON.parse(await readFile(join(workspace, '.sciforge', 'workspace-state.json'), 'utf8')) as Record<string, unknown>;
  assert.equal(Array.isArray(savedState.feedbackRepairRuns) ? savedState.feedbackRepairRuns.length : 0, 1);
  assert.equal(Array.isArray(savedState.feedbackRepairResults) ? savedState.feedbackRepairResults.length : 0, 1);
  assert.equal(await exists(join(workspace, '.sciforge', 'feedback', 'repair-runs', 'repair-run-1.json')), true);
  assert.equal(await exists(join(workspace, '.sciforge', 'feedback', 'repair-results', 'repair-result-1.json')), true);

  console.log('[ok] workspace instance manifest and feedback handoff repair APIs expose structured contracts');
} finally {
  child.kill('SIGTERM');
  await rm(workspace, { recursive: true, force: true });
}

function workspaceState(workspacePath: string) {
  return {
    schemaVersion: 2,
    workspacePath,
    sessionsByScenario: {},
    archivedSessions: [],
    alignmentContracts: [],
    feedbackComments: [
      feedbackComment('feedback-open', 'open'),
      feedbackComment('feedback-fixed', 'fixed'),
    ],
    feedbackRequests: [{
      id: 'request-1',
      schemaVersion: 1,
      title: 'Legend repair',
      status: 'ready',
      feedbackIds: ['feedback-open'],
      summary: 'Chart legend is confusing.',
      acceptanceCriteria: ['Legend is readable.'],
      githubIssueUrl: 'https://github.com/org/repo/issues/42',
      createdAt: '2026-05-07T00:00:00.000Z',
      updatedAt: '2026-05-07T00:01:00.000Z',
    }],
    githubSyncedOpenIssues: [{
      schemaVersion: 1,
      number: 42,
      title: 'Legend repair',
      body: 'Imported issue',
      htmlUrl: 'https://github.com/org/repo/issues/42',
      updatedAt: '2026-05-07T00:02:00.000Z',
      labels: ['feedback'],
      syncedAt: '2026-05-07T00:03:00.000Z',
    }],
    updatedAt: '2026-05-07T00:04:00.000Z',
  };
}

function feedbackComment(id: string, status: string) {
  return {
    id,
    schemaVersion: 1,
    authorId: 'u1',
    authorName: 'Researcher',
    comment: id === 'feedback-open' ? 'Fix the chart legend handoff.' : 'Already fixed.',
    status,
    priority: 'high',
    tags: ['handoff'],
    createdAt: '2026-05-07T00:00:00.000Z',
    updatedAt: id === 'feedback-open' ? '2026-05-07T00:05:00.000Z' : '2026-05-07T00:04:00.000Z',
    requestId: id === 'feedback-open' ? 'request-1' : undefined,
    target: {
      selector: '[data-testid="legend"]',
      path: 'body > div',
      text: 'legend',
      tagName: 'div',
      rect: { x: 1, y: 2, width: 3, height: 4 },
    },
    viewport: { width: 1280, height: 720, devicePixelRatio: 2, scrollX: 0, scrollY: 12 },
    runtime: { page: 'results', url: 'http://localhost:5173', scenarioId: 'omics', sessionId: 'session-1', activeRunId: 'run-1' },
    screenshot: {
      schemaVersion: 1,
      dataUrl: 'data:image/png;base64,aGVsbG8=',
      mediaType: 'image/png',
      width: 320,
      height: 200,
      capturedAt: '2026-05-07T00:00:30.000Z',
      targetRect: { x: 1, y: 2, width: 3, height: 4 },
      includeForAgent: true,
    },
    githubIssueNumber: id === 'feedback-open' ? 42 : undefined,
    githubIssueUrl: id === 'feedback-open' ? 'https://github.com/org/repo/issues/42' : undefined,
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
  if (response.status !== 200) assert.equal(response.status, 200, await response.text());
}

async function exists(path: string) {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}
