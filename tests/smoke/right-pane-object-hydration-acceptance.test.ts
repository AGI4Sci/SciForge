import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer as createNetServer } from 'node:net';
import { test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import {
  RIGHT_PANE_OBJECT_HYDRATION_SMOKE_SELECTORS,
  createRightPaneObjectHydrationSmokeEvidence,
  createRightPaneObjectHydrationSmokeStorageSeed,
  rightPaneObjectHydrationSmokeEvidenceShowsPreviewAndFiles,
} from '../../src/ui/src/app/results/rightPaneObjectHydrationSmokeState';

const EDGE_EXECUTABLE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';

test('right pane object hydration acceptance focuses file refs into preview and Files viewer', { timeout: 180_000 }, async () => {
  const browserExecutable = process.env.SCIFORGE_RIGHT_PANE_BROWSER_EXECUTABLE || EDGE_EXECUTABLE;
  if (!existsSync(browserExecutable)) {
    throw new Error(`No browser executable found for right-pane object hydration acceptance: ${browserExecutable}`);
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-object-'));
  const workspacePath = join(tempRoot, 'workspace');
  const configPath = join(tempRoot, 'config.local.json');
  const writerPort = await getFreePort();
  const uiPort = await getFreePort();
  const writerUrl = `http://127.0.0.1:${writerPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const instanceId = `right-pane-object-hydration-${Date.now()}`;
  const filePath = 'reports/right-pane-object-preview.md';
  const children: ChildProcess[] = [];
  let browser: Browser | undefined;

  await mkdir(join(workspacePath, 'reports'), { recursive: true });
  await writeFile(join(workspacePath, filePath), [
    '# Right pane object preview',
    '',
    'This markdown fixture is safe, workspace-relative, and used only by the object hydration smoke.',
  ].join('\n'), 'utf8');
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    workspaceWriterBaseUrl: writerUrl,
    workspacePath,
    agentServerBaseUrl: 'http://127.0.0.1:1',
    locale: 'en-US',
    theme: 'dark',
    modelProvider: 'acceptance-local',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
  }), 'utf8');

  const seed = createRightPaneObjectHydrationSmokeStorageSeed({
    instanceId,
    workspacePath,
    workspaceWriterBaseUrl: writerUrl,
    agentServerBaseUrl: 'http://127.0.0.1:1',
    locale: 'en-US',
    filePath,
    fileTitle: 'Right pane object preview',
    updatedAt: '2026-06-01T00:00:00.000Z',
    activeTab: 'files',
  });
  await mkdir(join(workspacePath, '.sciforge'), { recursive: true });
  await writeFile(
    join(workspacePath, '.sciforge', 'workspace-state.json'),
    JSON.stringify(seed.workspaceState, null, 2),
    'utf8',
  );

  try {
    const commonEnv = {
      ...process.env,
      SCIFORGE_INSTANCE_ID: instanceId,
      SCIFORGE_CONFIG_PATH: configPath,
      SCIFORGE_WORKSPACE_PATH: workspacePath,
      SCIFORGE_WORKSPACE_PORT: String(writerPort),
      SCIFORGE_WORKSPACE_WRITER_URL: writerUrl,
      SCIFORGE_UI_PORT: String(uiPort),
      SCIFORGE_AGENT_SERVER_AUTOSTART: '0',
      SCIFORGE_AGENT_SERVER_URL: 'http://127.0.0.1:1',
    };
    children.push(spawnProcess('npm', ['run', 'workspace:server', '--silent'], commonEnv));
    await waitForHttp(`${writerUrl}/health`, 30_000);
    children.push(spawnProcess('npm', ['run', 'dev:ui', '--', '--host', '127.0.0.1', '--port', String(uiPort), '--strictPort'], commonEnv));
    await waitForHttp(uiUrl, 45_000);

    browser = await chromium.launch({ executablePath: browserExecutable, headless: true });
    const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
    await context.addInitScript((entries: Array<{ key: string; value: string }>) => {
      for (const entry of entries) window.localStorage.setItem(entry.key, entry.value);
    }, seed.entries);
    const page = await context.newPage();
    await page.goto(`${uiUrl}${seed.navigationPath}`, { waitUntil: 'domcontentloaded' });
    await page.locator('.results-panel').waitFor({ state: 'visible', timeout: 30_000 });

    await focusObjectReference(page);
    await page.locator(RIGHT_PANE_OBJECT_HYDRATION_SMOKE_SELECTORS.objectFocusBanner).waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator(RIGHT_PANE_OBJECT_HYDRATION_SMOKE_SELECTORS.workspaceObjectPreviewReference).waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator(RIGHT_PANE_OBJECT_HYDRATION_SMOKE_SELECTORS.filesViewer).waitFor({ state: 'visible', timeout: 20_000 });
    await page.locator(RIGHT_PANE_OBJECT_HYDRATION_SMOKE_SELECTORS.filePreviewState).waitFor({ state: 'visible', timeout: 20_000 });

    const evidence = await collectHydrationEvidence(page);
    assert.equal(rightPaneObjectHydrationSmokeEvidenceShowsPreviewAndFiles(evidence), true, JSON.stringify(evidence));
    assert.equal(evidence.blockedByClient, false);
    assert.equal(evidence.title, 'SciForge');
    assert.match(evidence.objectFocusTitle, /Right pane object preview/);
    assert.match(evidence.selectedFileRowLabel || filePath, /right-pane-object-preview\.md/);
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) await stopProcess(child);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function focusObjectReference(page: Page) {
  const objectReferenceLink = page.locator(RIGHT_PANE_OBJECT_HYDRATION_SMOKE_SELECTORS.objectReferenceLink, {
    hasText: /Right pane object preview|right-pane-object-preview\.md/,
  });
  await objectReferenceLink.first().waitFor({ state: 'visible', timeout: 30_000 });
  await objectReferenceLink.first().click();
}

async function collectHydrationEvidence(page: Page) {
  const selectors = RIGHT_PANE_OBJECT_HYDRATION_SMOKE_SELECTORS;
  const bodyText = await textContent(page, 'body');
  return createRightPaneObjectHydrationSmokeEvidence({
    blockedByClient: bodyText.includes('ERR_BLOCKED_BY_CLIENT'),
    rootMounted: await page.locator(selectors.root).count() > 0,
    title: await page.title(),
    selectedTabLabel: await textContent(page, selectors.selectedTab),
    objectReferenceLinkCount: await page.locator(selectors.objectReferenceLink).count(),
    objectFocusBannerCount: await page.locator(selectors.objectFocusBanner).count(),
    objectFocusTitle: await textContent(page, selectors.objectFocusBanner),
    workspaceObjectPreviewCount: await page.locator(selectors.workspaceObjectPreview).count(),
    workspaceObjectPreviewReferenceCount: await page.locator(selectors.workspaceObjectPreviewReference).count(),
    filesViewerCount: await page.locator(selectors.filesViewer).count(),
    fileRowCount: await page.locator(selectors.fileRows).count(),
    selectedFileRowLabel: await textContent(page, selectors.selectedFileRow),
    filePreviewState: await attributeValue(page, selectors.filePreviewState, 'data-file-preview-state'),
    fileViewModeSourceCommandCount: await page.locator(selectors.fileViewModeSourceCommand).count(),
    fileViewModePreviewCommandCount: await page.locator(selectors.fileViewModePreviewCommand).count(),
    fileViewModePreviewCount: await page.locator(selectors.fileViewModePreview).count(),
  });
}

async function textContent(page: Page, selector: string) {
  return (await page.locator(selector).first().textContent({ timeout: 1000 }).catch(() => '')) ?? '';
}

async function attributeValue(page: Page, selector: string, name: string) {
  return (await page.locator(selector).first().getAttribute(name, { timeout: 1000 }).catch(() => '')) ?? '';
}

function spawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  return child;
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null || child.signalCode) return;
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      child.kill('SIGTERM');
    }
  } else {
    child.kill('SIGTERM');
  }
  await Promise.race([exited, delay(2000)]);
  if (child.exitCode !== null || child.signalCode) return;
  if (child.pid) {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      child.kill('SIGKILL');
    }
  } else {
    child.kill('SIGKILL');
  }
  await Promise.race([exited, delay(1000)]);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

async function waitForHttp(url: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(1000) });
      if (response.ok) return;
      lastError = new Error(`HTTP ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(250);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function getFreePort() {
  const server = createNetServer();
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  if (!port) throw new Error('Could not allocate a free port');
  return port;
}
