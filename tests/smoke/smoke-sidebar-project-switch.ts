import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { chromium, type Page } from 'playwright-core';
import { basename, join } from 'node:path';
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

try {
  tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-sidebar-project-switch-'));
  const mainPath = join(tempRoot, 'main-project');
  const peerPath = join(tempRoot, 'peer-project');
  mainThreadTitle = `${basename(mainPath)} 项目专属对话`;
  peerThreadTitle = `${basename(peerPath)} 项目专属对话`;
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
    SCIFORGE_UI_PORT: String(uiPort),
    SCIFORGE_WORKSPACE_PORT: String(mainWriterPort),
    SCIFORGE_WORKSPACE_WRITER_URL: `http://127.0.0.1:${mainWriterPort}`,
    SCIFORGE_WORKSPACE_PATH: normalizeWorkspaceRootPath(mainPath),
  }));

  await waitForHttp(`http://127.0.0.1:${mainWriterPort}/health`);
  await waitForHttp(`http://127.0.0.1:${peerWriterPort}/health`);
  await writeWorkspaceSnapshot(mainWriterPort, mainPath, mainThreadTitle, 'main-thread');
  await writeWorkspaceSnapshot(peerWriterPort, peerPath, peerThreadTitle, 'peer-thread');
  await waitForHttp(`http://127.0.0.1:${uiPort}/`);

  const browser = await chromium.launch({
    executablePath: browserExecutablePath(),
    headless: true,
    args: ['--disable-gpu', '--no-sandbox'],
  });
  try {
    const page = await browser.newPage({ viewport: { width: 1440, height: 960 } });
    await page.goto(`http://127.0.0.1:${uiPort}/`, { waitUntil: 'domcontentloaded' });
    await page.getByLabel('聊天工作台').waitFor({ timeout: 20_000 });

    const projectList = page.locator('.sidebar-project-chat-list');
    await projectList.waitFor({ timeout: 20_000 });
    const mainProjectButton = projectList.locator('.sidebar-project-chat-main').filter({ hasText: new RegExp(`^${basename(mainPath)}\\b`) });
    const peerProjectButton = projectList.locator('.sidebar-project-chat-main').filter({ hasText: new RegExp(`^${basename(peerPath)}\\b`) });
    await mainProjectButton.waitFor({ timeout: 20_000 });
    await peerProjectButton.waitFor({ timeout: 20_000 });

    const mainGroup = projectList.locator('.sidebar-project-chat-group').filter({ has: mainProjectButton });
    const peerGroup = projectList.locator('.sidebar-project-chat-group').filter({ has: peerProjectButton });
    await mainGroup.getByText(mainThreadTitle, { exact: false }).first().waitFor({ timeout: 20_000 });
    await peerGroup.getByText(peerThreadTitle, { exact: false }).first().waitFor({ timeout: 20_000 });

    await peerGroup.locator('.sidebar-thread-row').filter({ hasText: peerThreadTitle }).first().click();
    await peerProjectButton.filter({ hasText: '当前' }).waitFor({ timeout: 20_000 });
    await page.locator('.sidebar-thread-row.active').getByText(peerThreadTitle, { exact: false }).waitFor({ timeout: 20_000 });
    await assertWorkbenchShowsThread(page, peerThreadTitle);

    await mainProjectButton.click();
    await mainProjectButton.filter({ hasText: '当前' }).waitFor({ timeout: 60_000 });
    await page.locator('.sidebar-project-chat-list').getByText(mainThreadTitle).first().waitFor({ timeout: 60_000 });
    await page.locator('.sidebar-project-chat-list').getByText(peerThreadTitle).first().waitFor({ timeout: 60_000 });

    await peerGroup.locator('.sidebar-thread-row').filter({ hasText: peerThreadTitle }).first().click();
    await peerProjectButton.filter({ hasText: '当前' }).waitFor({ timeout: 20_000 });
    await assertWorkbenchShowsThread(page, peerThreadTitle);

    console.log('[ok] sidebar project switch keeps per-project threads and opens peer chat after switch');
  } finally {
    await browser.close();
  }
} finally {
  await shutdown();
  if (tempRoot) await rm(tempRoot, { recursive: true, force: true });
}

async function writeWorkspaceSnapshot(port: number, workspacePath: string, prompt: string, sessionId: string) {
  const now = new Date().toISOString();
  const response = await fetch(`http://127.0.0.1:${port}/api/sciforge/workspace/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      workspacePath,
      config: { workspacePath },
      state: {
        schemaVersion: 2,
        workspacePath,
        sessionsByScenario: {
          'literature-evidence-review': {
            schemaVersion: 2,
            sessionId,
            scenarioId: 'literature-evidence-review',
            title: prompt,
            createdAt: now,
            updatedAt: now,
            messages: [{
              id: `user-${sessionId}`,
              role: 'user',
              content: prompt,
              createdAt: now,
            }, {
              id: `assistant-${sessionId}`,
              role: 'scenario',
              content: `${prompt} 的回复`,
              createdAt: now,
            }],
            runs: [],
            uiManifest: [],
            claims: [],
            executionUnits: [],
            artifacts: [],
            notebook: [],
            versions: [],
            hiddenResultSlotIds: [],
          },
        },
        archivedSessions: [],
        alignmentContracts: [],
        updatedAt: now,
      },
    }),
  });
  assert.equal(response.status, 200, await response.text());
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
