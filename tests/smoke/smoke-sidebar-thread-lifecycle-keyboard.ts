import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';

import { chromium, type Page } from 'playwright-core';
import { browserExecutablePath } from './browser-workflows-fixtures';
import { normalizeWorkspaceRootPath } from '../../src/ui/src/config';

const repoRoot = resolve('.');
const writerPort = 26550 + Math.floor(Math.random() * 200);
const uiPort = 27550 + Math.floor(Math.random() * 200);
const children: ChildProcess[] = [];
let tempRoot = '';

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-sidebar-thread-lifecycle-'));
  const workspacePath = join(tempRoot, 'lifecycle-project');
  const stateDir = join(tempRoot, 'state');
  const configPath = join(tempRoot, 'config.local.json');
  const instanceId = `sidebar-thread-lifecycle-${Date.now()}`;
  await mkdir(workspacePath, { recursive: true });
  await mkdir(stateDir, { recursive: true });
  await writeFile(configPath, JSON.stringify({
    sciforge: {
      workspaceWriterBaseUrl: `http://127.0.0.1:${writerPort}`,
      workspacePath: normalizeWorkspaceRootPath(workspacePath),
      peerInstances: [],
    },
  }, null, 2));

  children.push(startWriter({
    SCIFORGE_INSTANCE_ID: instanceId,
    SCIFORGE_WORKSPACE_PATH: workspacePath,
    SCIFORGE_STATE_DIR: stateDir,
    SCIFORGE_CONFIG_PATH: configPath,
  }));
  children.push(start('ui', ['npm', 'run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], {
    VITE_SCIFORGE_INSTANCE_ID: instanceId,
    VITE_SCIFORGE_DEFAULT_WORKSPACE_WRITER_URL: `http://127.0.0.1:${writerPort}`,
    VITE_SCIFORGE_DEFAULT_WORKSPACE_PATH: normalizeWorkspaceRootPath(workspacePath),
    SCIFORGE_UI_PORT: String(uiPort),
    SCIFORGE_WORKSPACE_PORT: String(writerPort),
    SCIFORGE_WORKSPACE_WRITER_URL: `http://127.0.0.1:${writerPort}`,
    SCIFORGE_WORKSPACE_PATH: normalizeWorkspaceRootPath(workspacePath),
  }));

  await waitForHttp(`http://127.0.0.1:${writerPort}/health`);
  await writeWorkspaceSnapshot(workspacePath);
  await waitForHttp(`http://127.0.0.1:${uiPort}/`);

  const browser = await chromium.launch({
    executablePath: browserExecutablePath(),
    headless: true,
    args: ['--disable-gpu', '--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('.content-shell').first().waitFor({ timeout: 20_000 });

    const group = projectGroup(page, basename(workspacePath));
    await group.waitFor({ timeout: 20_000 });
    await group.locator('[data-sidebar-thread-row="true"]').filter({ hasText: 'Running lifecycle thread' }).waitFor({ timeout: 20_000 });
    await assertThreadLifecycleRows(page, group);
    await assertThreadKeyboardNavigation(page, group);
    await assertNoSensitiveSidebarText(page, tempRoot);

    console.log('[ok] sidebar thread lifecycle rows and keyboard navigation are live');
  } finally {
    await browser.close();
  }
} finally {
  await shutdown();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}

async function writeWorkspaceSnapshot(workspacePath: string) {
  const now = new Date().toISOString();
  const response = await fetch(`http://127.0.0.1:${writerPort}/api/sciforge/workspace/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath,
      config: { workspacePath },
      state: {
        schemaVersion: 2,
        workspacePath,
        sessionsByScenario: {
          'literature-evidence-review': draftSession('literature-evidence-review', 'draft-thread', now),
          'structure-exploration': sessionState('structure-exploration', 'running-thread', 'Running lifecycle thread', minutesBefore(now, 1), {
            runs: [{
              id: 'run-running',
              scenarioId: 'structure-exploration',
              status: 'running',
              prompt: 'run lifecycle analysis',
              response: '',
              createdAt: minutesBefore(now, 1),
            }],
          }),
          'omics-differential-exploration': sessionState('omics-differential-exploration', 'blocked-thread', 'Blocked lifecycle thread', minutesBefore(now, 2), {
            executionUnits: [{
              id: 'unit-blocked',
              tool: 'analysis.task',
              params: '{}',
              status: 'needs-human',
              hash: 'blocked-hash',
            }],
          }),
          'biomedical-knowledge-graph': sessionState('biomedical-knowledge-graph', 'failed-thread', 'Failed lifecycle thread', minutesBefore(now, 3), {
            runs: [{
              id: 'run-failed',
              scenarioId: 'biomedical-knowledge-graph',
              status: 'failed',
              prompt: 'run failed lifecycle analysis',
              response: 'failed',
              createdAt: minutesBefore(now, 3),
            }],
          }),
        },
        archivedSessions: [retainedHistorySession('structure-exploration', 'done-retained-thread', 'Done lifecycle thread', minutesBefore(now, 4))],
        alignmentContracts: [],
        feedbackComments: [],
        feedbackRequests: [],
        githubSyncedOpenIssues: [],
        updatedAt: now,
      },
    }),
  });
  assert.equal(response.status, 200, await response.text());
}

function draftSession(scenarioId: string, sessionId: string, updatedAt: string) {
  return {
    schemaVersion: 2,
    sessionId,
    scenarioId,
    title: 'New chat',
    createdAt: updatedAt,
    updatedAt,
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  };
}

function sessionState(
  scenarioId: string,
  sessionId: string,
  title: string,
  updatedAt: string,
  overrides: Record<string, unknown> = {},
) {
  return {
    schemaVersion: 2,
    sessionId,
    scenarioId,
    title,
    createdAt: updatedAt,
    updatedAt,
    messages: [{
      id: `user-${sessionId}`,
      role: 'user',
      content: title,
      createdAt: updatedAt,
    }, {
      id: `assistant-${sessionId}`,
      role: 'scenario',
      content: `${title} response`,
      createdAt: updatedAt,
    }],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
    ...overrides,
  };
}

function retainedHistorySession(scenarioId: string, sessionId: string, title: string, updatedAt: string) {
  const base = sessionState(scenarioId, sessionId, title, updatedAt);
  const { versions: _versions, ...snapshot } = base;
  return {
    ...base,
    versions: [{
      id: `${sessionId}-retained-version`,
      reason: 'new chat retained previous session',
      createdAt: updatedAt,
      messageCount: 2,
      runCount: 0,
      artifactCount: 0,
      checksum: `${sessionId}-checksum`,
      snapshot,
    }],
  };
}

async function assertThreadLifecycleRows(page: Page, group: ReturnType<typeof projectGroup>) {
  const states = await group.locator('[data-sidebar-thread-row="true"]').evaluateAll((rows) => (
    rows.map((row) => row.getAttribute('data-sidebar-thread-state'))
  ));
  assert.deepEqual(new Set(states), new Set(['draft', 'running', 'blocked', 'failed', 'done']));

  for (const state of ['running', 'blocked', 'failed', 'done']) {
    const row = group.locator(`[data-sidebar-thread-row="true"][data-sidebar-thread-state="${state}"]`);
    assert.equal(await row.count(), 1, `${state} should have one visible row`);
    assert.equal(await row.locator('[data-sidebar-thread-action="archive"]').count(), 1, `${state} should expose Archive`);
    assert.equal(await row.locator('[data-sidebar-thread-action="discard"]').count(), 0, `${state} should not expose Discard`);
  }

  const draft = group.locator('[data-sidebar-thread-row="true"][data-sidebar-thread-state="draft"]');
  assert.equal(await draft.count(), 1);
  assert.equal(await draft.locator('[data-sidebar-thread-action="discard"]').count(), 1);
  assert.equal(await draft.locator('[data-sidebar-thread-action="archive"]').count(), 0);

  for (const label of ['Running', 'Blocked', 'Failed', 'Done', 'Draft']) {
    assert.equal(await page.locator(`.sidebar-thread-status-dot[aria-label="${label}"]`).count(), 1);
  }
}

async function assertThreadKeyboardNavigation(_page: Page, group: ReturnType<typeof projectGroup>) {
  const buttons = group.locator('[data-sidebar-thread-main="true"]');
  const buttonCount = await buttons.count();
  assert.ok(buttonCount >= 5, `expected at least five thread main buttons, got ${buttonCount}`);

  await buttons.nth(0).focus();
  assert.equal(await focusedThreadState(group), 'draft');
  await buttons.nth(0).press('ArrowDown');
  assert.equal(await focusedThreadState(group), 'running');
  await group.locator('[data-sidebar-thread-main="true"]').nth(1).press('End');
  assert.equal(await focusedThreadState(group), 'done');
  await group.locator('[data-sidebar-thread-main="true"]').nth(buttonCount - 1).press('Home');
  assert.equal(await focusedThreadState(group), 'draft');
  await group.locator('[data-sidebar-thread-main="true"]').nth(0).press('ArrowUp');
  assert.equal(await focusedThreadState(group), 'draft');
}

async function focusedThreadState(group: ReturnType<typeof projectGroup>) {
  return group.evaluate((element) => {
    const active = element.ownerDocument.activeElement;
    return active?.closest('[data-sidebar-thread-row="true"]')?.getAttribute('data-sidebar-thread-state') ?? '';
  });
}

async function assertNoSensitiveSidebarText(page: Page, tempRootPath: string) {
  const facts = await page.evaluate((root) => {
    const sidebarText = document.querySelector('.sidebar-project-chat-list')?.textContent ?? '';
    return {
      containsRoot: sidebarText.includes(root),
      containsSecret: /Authorization|api\s*key|secret|token|credential|password|sk-[A-Za-z0-9._-]+/i.test(sidebarText),
    };
  }, tempRootPath);
  assert.deepEqual(facts, { containsRoot: false, containsSecret: false });
}

function projectGroup(page: Page, label: string) {
  return page.locator('.sidebar-project-chat-group').filter({
    has: page.locator('.sidebar-project-chat-main').filter({ hasText: new RegExp(`^${label}\\b`) }),
  });
}

function minutesBefore(value: string, minutes: number) {
  return new Date(Date.parse(value) - minutes * 60_000).toISOString();
}

function startWriter(env: Record<string, string>) {
  return start('writer', [process.execPath, '--import', 'tsx', 'src/runtime/workspace-server.ts'], {
    SCIFORGE_WORKSPACE_PORT: String(writerPort),
    ...env,
  });
}

function start(label: string, command: string[], env: Record<string, string>) {
  const child = spawn(command[0], command.slice(1), {
    cwd: repoRoot,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', (chunk) => process.stdout.write(`[${label}] ${chunk}`));
  child.stderr?.on('data', (chunk) => process.stderr.write(`[${label}] ${chunk}`));
  return child;
}

async function waitForHttp(url: string, timeoutMs = 45_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url);
      if (response.ok || response.status === 404) return;
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function shutdown() {
  await Promise.all(children.map(async (child) => {
    if (!child.killed) child.kill('SIGTERM');
  }));
  await new Promise((resolve) => setTimeout(resolve, 500));
}
