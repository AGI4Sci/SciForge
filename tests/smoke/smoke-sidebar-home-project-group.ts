import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, type Page } from 'playwright-core';
import { browserExecutablePath } from './browser-workflows-fixtures';
import { defaultSciForgeConfig } from '../../src/ui/src/config';

const repoRoot = resolve('.');
const uiPort = 27650 + Math.floor(Math.random() * 200);
const screenshotPath = join(repoRoot, 'docs/test-artifacts/sidebar-parity/sciforge-home-project-group-context-2026-06-01.png');
const children: ChildProcess[] = [];
let tempRoot = '';

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-sidebar-home-group-'));
  await mkdir(tempRoot, { recursive: true });
  children.push(start('ui', ['npm', 'run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], {
    VITE_SCIFORGE_INSTANCE_ID: 'sidebar-home-project-group',
    VITE_SCIFORGE_DEFAULT_WORKSPACE_WRITER_URL: 'http://127.0.0.1:9',
    VITE_SCIFORGE_DEFAULT_WORKSPACE_PATH: '',
    SCIFORGE_UI_PORT: String(uiPort),
    SCIFORGE_WORKSPACE_WRITER_URL: 'http://127.0.0.1:9',
    SCIFORGE_WORKSPACE_PATH: '',
  }));
  await waitForHttp(`http://127.0.0.1:${uiPort}/`);

  const browser = await chromium.launch({
    executablePath: browserExecutablePath(),
    headless: true,
    args: ['--disable-gpu', '--no-sandbox'],
  });
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 960 } });
    await context.addInitScript(({ config, workspaceState }) => {
      window.localStorage.setItem('sciforge.config.v1.sidebar-home-project-group', JSON.stringify(config));
      window.localStorage.setItem('sciforge.workspace.v2.sidebar-home-project-group', JSON.stringify(workspaceState));
      window.localStorage.setItem('sciforge.config.v1', JSON.stringify(config));
      window.localStorage.setItem('sciforge.workspace.v2', JSON.stringify(workspaceState));
    }, {
      config: {
        ...defaultSciForgeConfig,
        workspaceWriterBaseUrl: 'http://127.0.0.1:9',
        workspacePath: '',
        peerInstances: [],
        updatedAt: new Date().toISOString(),
      },
      workspaceState: homeWorkspaceState(),
    });
    const page = await context.newPage();
    await page.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    await page.locator('.content-shell').first().waitFor({ timeout: 20_000 });

    const home = projectGroup(page, 'Home');
    await waitForHomeProject(page, home);
    assert.equal(await home.getAttribute('data-gui-current-project'), 'true');
    assert.match(await home.getAttribute('data-gui-region-ref') ?? '', /^gui:\/gui\/regions\/sidebar\/workspaces\/workspace-/);
    assert.equal(await home.locator('.sidebar-project-status-row').count(), 1);
    assert.equal(await home.getByLabel('New Agent in Home').count(), 1);
    assert.equal(await page.getByText('Current project', { exact: false }).count(), 0);
    assert.equal(await page.getByText('Untitled project', { exact: false }).count(), 0);

    const hiddenTitle = 'Home retained history 8';
    assert.equal(await home.getByText(hiddenTitle, { exact: false }).count(), 0);
    await home.locator('.sidebar-thread-more').click();
    await projectGroup(page, 'Home').getByText(hiddenTitle, { exact: false }).first().waitFor({ timeout: 20_000 });

    await home.getByLabel('New Agent in Home').click();
    await projectGroup(page, 'Home').locator('[data-sidebar-thread-state="draft"]').first().waitFor({ timeout: 20_000 });

    await projectGroup(page, 'Home').locator('.sidebar-project-chat-head').click({ button: 'right' });
    const menu = page.locator('.context-menu[role="menu"]');
    await menu.waitFor({ timeout: 20_000 });
    const menuText = await menu.innerText();
    for (const label of ['Mark All as Read', 'Archive All', 'Remove from Sidebar']) {
      assert.ok(menuText.includes(label), `missing Home project context menu item: ${label}`);
    }
    for (const forbidden of ['Open in Finder', 'Copy path', 'Add to chat', '/tmp', '/Applications', 'token', 'secret']) {
      assert.ok(!menuText.includes(forbidden), `Home project context menu leaked ${forbidden}`);
    }

    await assertNoSensitiveSidebarText(page);
    await mkdir(join(repoRoot, 'docs/test-artifacts/sidebar-parity'), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log('[ok] Home project group supports current marker, status, New Agent, See more, and context menu without local path leakage');
  } finally {
    await browser.close();
  }
} finally {
  await shutdown();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}

function homeWorkspaceState() {
  const now = new Date().toISOString();
  return {
    schemaVersion: 2,
    workspacePath: '',
    sessionsByScenario: {
      'literature-evidence-review': sessionState('literature-evidence-review', 'home-thread', 'Home active thread', now),
      'structure-exploration': sessionState('structure-exploration', 'home-structure', 'Home structure thread', minutesBefore(now, 1)),
      'omics-differential-exploration': sessionState('omics-differential-exploration', 'home-omics', 'Home omics thread', minutesBefore(now, 2)),
      'biomedical-knowledge-graph': sessionState('biomedical-knowledge-graph', 'home-graph', 'Home knowledge graph thread', minutesBefore(now, 3)),
    },
    archivedSessions: Array.from({ length: 5 }, (_, index) => retainedHistorySession(
      'literature-evidence-review',
      `home-retained-${index + 4}`,
      `Home retained history ${index + 4}`,
      minutesBefore(now, index + 4),
    )),
    alignmentContracts: [],
    feedbackComments: [],
    feedbackRequests: [],
    githubSyncedOpenIssues: [],
    updatedAt: now,
  };
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

async function assertNoSensitiveSidebarText(page: Page) {
  const facts = await page.evaluate(() => {
    const sidebarText = document.querySelector('.sidebar-project-chat-list')?.textContent ?? '';
    return {
      containsPath: /(?:^|\s)(?:\/Users|\/Applications|\/Volumes|\/private|\/var\/folders|\/tmp)\//.test(sidebarText),
      containsSecret: /Authorization|api\s*key|secret|token|credential|password|sk-[A-Za-z0-9._-]+/i.test(sidebarText),
    };
  });
  assert.deepEqual(facts, { containsPath: false, containsSecret: false });
}

function projectGroup(page: Page, label: string) {
  return page.locator('.sidebar-project-chat-group').filter({
    has: page.locator('.sidebar-project-chat-main').filter({ hasText: new RegExp(`^${label}\\b`) }),
  });
}

async function waitForHomeProject(page: Page, home: ReturnType<typeof projectGroup>) {
  const started = Date.now();
  while (Date.now() - started < 20_000) {
    if (await home.count()) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const facts = await page.evaluate(() => ({
    storageKeys: Object.keys(window.localStorage).sort(),
    sidebarText: document.querySelector('.sidebar-project-chat-list')?.textContent ?? document.body.textContent ?? '',
  }));
  assert.fail(`Home project group did not render: ${JSON.stringify(facts)}`);
}

function minutesBefore(value: string, minutes: number) {
  return new Date(Date.parse(value) - minutes * 60_000).toISOString();
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
