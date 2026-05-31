import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium, type Browser, type Page } from 'playwright-core';
import { createServer } from 'node:net';

const EDGE_EXECUTABLE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';

test('right pane browser acceptance covers tabs, panes, persistence, and file edit flow', { timeout: 180_000 }, async () => {
  const browserExecutable = process.env.SCIFORGE_RIGHT_PANE_BROWSER_EXECUTABLE || EDGE_EXECUTABLE;
  if (!existsSync(browserExecutable)) {
    throw new Error(`No browser executable found for right-pane acceptance: ${browserExecutable}`);
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-right-pane-'));
  const workspacePath = join(tempRoot, 'workspace');
  const configPath = join(tempRoot, 'config.local.json');
  const writerPort = await getFreePort();
  const uiPort = await getFreePort();
  const writerUrl = `http://127.0.0.1:${writerPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const children: ChildProcess[] = [];
  let browser: Browser | undefined;

  await writeFile(join(tempRoot, 'placeholder'), 'ready\n', 'utf8');
  await mkdir(workspacePath);
  await writeFile(join(workspacePath, 'sample.txt'), 'initial file\n', 'utf8');
  await writeFile(join(workspacePath, 'large.log'), `${'x'.repeat(2048)}\n`, 'utf8');
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

  try {
    const commonEnv = {
      ...process.env,
      SCIFORGE_INSTANCE_ID: `right-pane-acceptance-${Date.now()}`,
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
    const page = await context.newPage();
    await page.goto(uiUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('.results-panel').waitFor({ state: 'visible', timeout: 30_000 });

    await assertBaseShellAccessibility(page);
    await assertNewClosePersistAndBrowserFallback(page);
    await assertPaneSurfaces(page);
    await assertFilesReadEditSave(page, workspacePath);
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) child.kill('SIGTERM');
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function assertBaseShellAccessibility(page: Page) {
  await expectAttribute(page, '.result-tabstrip', 'role', 'tablist');
  await expectAttribute(page, '.result-tabstrip', 'aria-orientation', 'horizontal');
  await expectAttribute(page, '.result-tabstrip', 'data-overflow-policy', 'horizontal-scroll');
  assert.equal(await page.locator('.result-page-tab[role="tab"]').count(), 6);
  assert.equal(await page.locator('.result-content[role="tabpanel"]').count(), 1);
  assert.equal(await page.locator('.result-active-tab-close[aria-label^="Close"]').count(), 1);
}

async function assertNewClosePersistAndBrowserFallback(page: Page) {
  await page.locator('.result-new-tab-button').click();
  await page.getByRole('menuitem', { name: 'Browser', exact: true }).click();
  await page.locator('.result-page-tab', { hasText: 'Browser 2' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('.result-page-tab', { hasText: 'Browser 2' }).click();
  await page.locator('.right-pane-browser-surface input[aria-label="Browser URL"]').waitFor({ state: 'visible' });
  await expectSelectedTabText(page, /Browser 2/);
  await page.waitForFunction(() => document.activeElement?.id.startsWith('result-tab-custom-browser') === true, undefined, { timeout: 2000 });
  assert.equal(await page.evaluate(() => document.activeElement?.id.startsWith('result-tab-custom-browser')), true);

  const browserSurface = page.locator('.right-pane-browser-surface');
  await browserSurface.locator('input[aria-label="Browser URL"]').fill('https://www.baidu.com');
  await browserSurface.locator('button', { hasText: /^Open$/ }).first().click();
  await browserSurface.locator('.browser-workbench-viewer[data-browser-state="blocked"]').waitFor({ state: 'visible', timeout: 10_000 });
  assert.equal(await browserSurface.locator('iframe').count(), 0);
  assert.equal(await browserSurface.locator('[data-browser-state-action="open-external"]').count(), 1);
  assert.equal(await browserSurface.locator('[data-browser-state-action="proxy-fallback"]').count(), 1);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.right-pane-browser-surface input[aria-label="Browser URL"]').waitFor({ state: 'visible', timeout: 30_000 });
  await expectSelectedTabText(page, /Browser 2/);
  assert.equal(await page.locator('.right-pane-browser-surface input[aria-label="Browser URL"]').inputValue(), 'https://www.baidu.com');

  for (let guard = 0; guard < 10; guard += 1) {
    const tabCount = await page.locator('.result-page-tab[role="tab"]').count();
    if (tabCount === 0) break;
    await page.locator('.result-active-tab-close').click();
  }
  await page.locator('[data-testid="right-pane-empty-workspace"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.result-page-tab[role="tab"]').count(), 0);

  await ensurePane(page, 'Terminal', '[data-component-id="terminal-session-viewer"]');
}

async function assertPaneSurfaces(page: Page) {
  await ensurePane(page, 'Screen', '[data-component-id="virtual-screen-viewer"]');
  await expectAttribute(page, '[data-component-id="virtual-screen-viewer"]', 'data-status', 'empty');

  await ensurePane(page, 'Terminal', '[data-component-id="terminal-session-viewer"]');
  await expectAttribute(page, '[data-component-id="terminal-session-viewer"]', 'data-mode', 'transcript');
  assert.equal(await page.locator('[data-terminal-action="input"][disabled]').count() > 0, true);

  await ensurePane(page, 'References', '[data-testid="right-pane-references-tool"]');
  await expectAttribute(page, '[data-testid="right-pane-references-tool"]', 'data-state', 'empty');
}

async function assertFilesReadEditSave(page: Page, workspacePath: string) {
  await ensurePane(page, 'Files', '[data-component-id="workspace-file-viewer"]');
  await page.locator('.workspace-file-viewer-row', { hasText: 'sample.txt' }).click();
  await page.locator('.workspace-file-viewer-editor textarea').waitFor({ state: 'visible', timeout: 15_000 });
  assert.match(await page.locator('.workspace-file-viewer-editor').textContent() ?? '', /Read only/);
  await page.locator('.workspace-file-viewer-editor-actions button[aria-label="Edit"]').click();
  const textarea = page.locator('.workspace-file-viewer-editor textarea');
  await textarea.fill('edited from right-pane acceptance\n');
  await page.locator('.workspace-file-viewer-editor-actions button[aria-label="Save file"]').click();
  const saved = await waitForFileText(join(workspacePath, 'sample.txt'), /edited from right-pane acceptance/, 10_000);
  assert.match(saved, /edited from right-pane acceptance/);
}

async function ensurePane(page: Page, tabLabel: string, expectedSelector: string) {
  const tab = page.locator('.result-page-tab', { hasText: tabLabel }).first();
  if (await tab.count()) {
    await tab.click();
  } else {
    await page.locator('.result-new-tab-button').click();
    await page.getByRole('menuitem', { name: tabLabel, exact: true }).click();
    await page.locator('.result-page-tab', { hasText: tabLabel }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('.result-page-tab', { hasText: tabLabel }).click();
  }
  await page.locator(expectedSelector).waitFor({ state: 'visible', timeout: 20_000 });
}

async function expectSelectedTabText(page: Page, pattern: RegExp) {
  const text = await page.locator('.result-page-tab[aria-selected="true"]').textContent();
  assert.match(text ?? '', pattern);
}

async function expectAttribute(page: Page, selector: string, name: string, expected: string) {
  assert.equal(await page.locator(selector).first().getAttribute(name), expected);
}

function spawnProcess(command: string, args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  child.stdout?.on('data', () => undefined);
  child.stderr?.on('data', () => undefined);
  return child;
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
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

async function waitForFileText(path: string, pattern: RegExp, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  let text = '';
  while (Date.now() < deadline) {
    text = await readFile(path, 'utf8');
    if (pattern.test(text)) return text;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  return text;
}

async function getFreePort() {
  const server = createServer();
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
