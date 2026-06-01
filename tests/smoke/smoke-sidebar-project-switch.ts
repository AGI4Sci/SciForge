import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, type Locator, type Page } from 'playwright-core';
import { basename } from 'node:path';
import { browserExecutablePath } from './browser-workflows-fixtures';
import { normalizeWorkspaceRootPath } from '../../src/ui/src/config';

const repoRoot = resolve('.');
const mainWriterPort = 26173 + Math.floor(Math.random() * 200);
const peerWriterPort = mainWriterPort + 1;
const uiPort = 27173 + Math.floor(Math.random() * 200);
const children: ChildProcess[] = [];
let tempRoot = '';
let mainThreadTitle = '';
let peerThreadTitle = '';
let peerHiddenThreadTitle = '';

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-sidebar-project-switch-'));
  const mainPath = join(tempRoot, 'main-project');
  const peerPath = join(tempRoot, 'peer-project');
  mainThreadTitle = `${basename(mainPath)} project active thread`;
  peerThreadTitle = `${basename(peerPath)} project active thread`;
  peerHiddenThreadTitle = `${basename(peerPath)} retained history 7`;
  const p1StateDir = join(tempRoot, 'state/main');
  const p2StateDir = join(tempRoot, 'state/peer');
  const p1ConfigPath = join(tempRoot, 'config.main.json');
  const p2ConfigPath = join(tempRoot, 'config.peer.json');
  await mkdir(mainPath, { recursive: true });
  await mkdir(peerPath, { recursive: true });
  await mkdir(p1StateDir, { recursive: true });
  await mkdir(p2StateDir, { recursive: true });
  await writeFile(p1ConfigPath, JSON.stringify({
    sciforge: {
      workspaceWriterBaseUrl: `http://127.0.0.1:${mainWriterPort}`,
      workspacePath: normalizeWorkspaceRootPath(mainPath),
      peerInstances: [{
        name: basename(peerPath),
        appUrl: `http://127.0.0.1:${uiPort}`,
        workspaceWriterUrl: `http://127.0.0.1:${peerWriterPort}`,
        workspacePath: normalizeWorkspaceRootPath(peerPath),
        role: 'peer',
        trustLevel: 'readonly',
        enabled: true,
      }],
    },
  }, null, 2));
  await writeFile(p2ConfigPath, JSON.stringify({
    sciforge: {
      workspaceWriterBaseUrl: `http://127.0.0.1:${peerWriterPort}`,
      workspacePath: normalizeWorkspaceRootPath(peerPath),
      peerInstances: [{
        name: basename(mainPath),
        appUrl: `http://127.0.0.1:${uiPort}`,
        workspaceWriterUrl: `http://127.0.0.1:${mainWriterPort}`,
        workspacePath: normalizeWorkspaceRootPath(mainPath),
        role: 'peer',
        trustLevel: 'readonly',
        enabled: true,
      }],
    },
  }, null, 2));

  children.push(startWriter('main-writer', mainWriterPort, {
    SCIFORGE_INSTANCE_ID: 'main-smoke',
    SCIFORGE_WORKSPACE_PATH: mainPath,
    SCIFORGE_STATE_DIR: p1StateDir,
    SCIFORGE_CONFIG_PATH: p1ConfigPath,
  }));
  children.push(startWriter('peer-writer', peerWriterPort, {
    SCIFORGE_INSTANCE_ID: 'peer-smoke',
    SCIFORGE_WORKSPACE_PATH: peerPath,
    SCIFORGE_STATE_DIR: p2StateDir,
    SCIFORGE_CONFIG_PATH: p2ConfigPath,
  }));
  children.push(start('ui', ['npm', 'run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], {
    VITE_SCIFORGE_INSTANCE_ID: `sidebar-project-switch-${Date.now()}`,
    VITE_SCIFORGE_DEFAULT_WORKSPACE_WRITER_URL: `http://127.0.0.1:${mainWriterPort}`,
    VITE_SCIFORGE_DEFAULT_WORKSPACE_PATH: normalizeWorkspaceRootPath(mainPath),
    SCIFORGE_UI_PORT: String(uiPort),
    SCIFORGE_WORKSPACE_PORT: String(mainWriterPort),
    SCIFORGE_WORKSPACE_WRITER_URL: `http://127.0.0.1:${mainWriterPort}`,
    SCIFORGE_WORKSPACE_PATH: normalizeWorkspaceRootPath(mainPath),
  }));

  await waitForHttp(`http://127.0.0.1:${mainWriterPort}/health`);
  await waitForHttp(`http://127.0.0.1:${peerWriterPort}/health`);
  await writeWorkspaceSnapshot(mainWriterPort, mainPath, mainThreadTitle, 'main-thread', basename(mainPath));
  await writeWorkspaceSnapshot(peerWriterPort, peerPath, peerThreadTitle, 'peer-thread', basename(peerPath));
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

    const projectList = page.locator('.sidebar-project-chat-list');
    await projectList.waitFor({ timeout: 20_000 });
    const mainProjectButton = projectButton(page, basename(mainPath));
    const peerProjectButton = projectButton(page, basename(peerPath));
    await mainProjectButton.waitFor({ timeout: 20_000 });
    await peerProjectButton.waitFor({ timeout: 20_000 });

    let mainGroup = projectGroup(page, basename(mainPath));
    let peerGroup = projectGroup(page, basename(peerPath));
    await mainGroup.getByText(mainThreadTitle, { exact: false }).first().waitFor({ timeout: 20_000 });
    await peerGroup.getByText(peerThreadTitle, { exact: false }).first().waitFor({ timeout: 20_000 });

    await assertCurrentProject(page, basename(mainPath));
    assert.equal(await peerGroup.getByText(peerHiddenThreadTitle, { exact: false }).count(), 0);
    await peerGroup.locator('.sidebar-thread-more').click();
    await projectGroup(page, basename(peerPath)).getByText(peerHiddenThreadTitle, { exact: false }).first().waitFor({ timeout: 20_000 });

    await projectGroup(page, basename(peerPath)).locator('.sidebar-project-row-actions button').click();
    await assertCurrentProject(page, basename(peerPath));
    await projectGroup(page, basename(peerPath)).locator('[data-sidebar-thread-state="draft"]').first().waitFor({ timeout: 20_000 });
    await projectGroup(page, basename(peerPath)).getByText(peerHiddenThreadTitle, { exact: false }).first().waitFor({ timeout: 20_000 });
    await projectGroup(page, basename(mainPath)).getByText(mainThreadTitle, { exact: false }).first().waitFor({ timeout: 20_000 });

    mainGroup = projectGroup(page, basename(mainPath));
    const mainThreadRow = mainGroup.locator('.sidebar-thread-row').filter({ hasText: mainThreadTitle }).first();
    await mainThreadRow.hover();
    await mainThreadRow.locator('[data-sidebar-thread-action="archive"]').click();
    await expectTextHidden(projectGroup(page, basename(mainPath)), mainThreadTitle);

    await projectButton(page, basename(mainPath)).click();
    await assertCurrentProject(page, basename(mainPath));
    await expectTextHidden(projectGroup(page, basename(mainPath)), mainThreadTitle);
    await projectGroup(page, basename(peerPath)).getByText(peerHiddenThreadTitle, { exact: false }).first().waitFor({ timeout: 20_000 });

    mainGroup = projectGroup(page, basename(mainPath));
    peerGroup = projectGroup(page, basename(peerPath));
    assert.equal(await mainGroup.getByText(mainThreadTitle, { exact: false }).count(), 0);
    assert.equal(await peerGroup.getByText(peerHiddenThreadTitle, { exact: false }).count(), 1);

    await peerGroup.locator('.sidebar-thread-row').filter({ hasText: peerHiddenThreadTitle }).first().click();
    await assertCurrentProject(page, basename(peerPath));
    await page.locator('.sidebar-thread-row.active').getByText(peerHiddenThreadTitle, { exact: false }).waitFor({ timeout: 20_000 });
    await assertWorkbenchShowsThread(page, peerHiddenThreadTitle);

    await projectButton(page, basename(mainPath)).click();
    await assertCurrentProject(page, basename(mainPath));
    await expectTextHidden(projectGroup(page, basename(mainPath)), mainThreadTitle);
    await page.locator('.sidebar-project-chat-list').getByText(peerHiddenThreadTitle).first().waitFor({ timeout: 60_000 });

    await projectGroup(page, basename(peerPath)).locator('.sidebar-thread-row').filter({ hasText: peerHiddenThreadTitle }).first().click();
    await assertCurrentProject(page, basename(peerPath));
    await assertWorkbenchShowsThread(page, peerHiddenThreadTitle);

    console.log('[ok] sidebar project switch keeps New Agent target, visible counts, archive state, and peer chat opening scoped by repository');
  } finally {
    await browser.close();
  }
} finally {
  await shutdown();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}

async function writeWorkspaceSnapshot(port: number, workspacePath: string, prompt: string, sessionId: string, label: string) {
  const now = new Date().toISOString();
  const sessionsByScenario = {
    'literature-evidence-review': sessionState('literature-evidence-review', sessionId, prompt, now),
    'structure-exploration': sessionState('structure-exploration', `${sessionId}-structure`, `${label} structure thread`, minutesBefore(now, 1)),
    'omics-differential-exploration': sessionState('omics-differential-exploration', `${sessionId}-omics`, `${label} omics thread`, minutesBefore(now, 2)),
    'biomedical-knowledge-graph': sessionState('biomedical-knowledge-graph', `${sessionId}-graph`, `${label} knowledge graph thread`, minutesBefore(now, 3)),
  };
  const archivedSessions = Array.from({ length: 5 }, (_, index) => retainedHistorySession(
    'literature-evidence-review',
    `${sessionId}-retained-${index + 4}`,
    `${label} retained history ${index + 4}`,
    minutesBefore(now, index + 4),
  ));
  const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/workspace/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath,
      config: { workspacePath },
      state: {
        schemaVersion: 2,
        workspacePath,
        sessionsByScenario,
        archivedSessions,
        alignmentContracts: [],
        updatedAt: now,
      },
    }),
  });
  assert.equal(response.status, 200, await response.text());
}

function sessionState(scenarioId: string, sessionId: string, title: string, updatedAt: string) {
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

function minutesBefore(value: string, minutes: number) {
  return new Date(Date.parse(value) - minutes * 60_000).toISOString();
}

function projectButton(page: Page, label: string) {
  return page.locator('.sidebar-project-chat-main').filter({ hasText: new RegExp(`^${label}\\b`) });
}

function projectGroup(page: Page, label: string) {
  return page.locator('.sidebar-project-chat-group').filter({ has: projectButton(page, label) });
}

async function assertCurrentProject(page: Page, label: string) {
  const group = projectGroup(page, label);
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (await group.getAttribute('data-gui-current-project') === 'true') return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(await group.getAttribute('data-gui-current-project'), 'true');
}

async function expectTextHidden(locator: Locator, text: string) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (await locator.getByText(text, { exact: false }).count() === 0) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert.equal(await locator.getByText(text, { exact: false }).count(), 0);
}

async function assertWorkbenchShowsThread(page: Page, title: string) {
  await page.locator('.content-shell').first().waitFor({ timeout: 20_000 });
  await page.getByText(title, { exact: false }).first().waitFor({ timeout: 20_000 });
}

function startWriter(label: string, port: number, env: Record<string, string>) {
  return start(label, [process.execPath, '--import', 'tsx', 'src/runtime/workspace-server.ts'], {
    SCIFORGE_WORKSPACE_PORT: String(port),
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
