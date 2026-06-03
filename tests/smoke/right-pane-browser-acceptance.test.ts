import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';

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
  const externalFixturePort = await getFreePort();
  const writerUrl = `http://127.0.0.1:${writerPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const externalTargets = {
    first: `http://sciforge-right-pane-a.test:${externalFixturePort}/alpha`,
    second: `http://sciforge-right-pane-b.test:${externalFixturePort}/beta`,
  };
  const children: ChildProcess[] = [];
  let browser: Browser | undefined;
  let externalFixture: HttpServer | undefined;

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
    externalFixture = await startExternalBrowserFixture(externalFixturePort);
    const commonEnv = {
      ...process.env,
      SCIFORGE_INSTANCE_ID: `right-pane-acceptance-${Date.now()}`,
      SCIFORGE_CONFIG_PATH: configPath,
      SCIFORGE_WORKSPACE_PATH: workspacePath,
      SCIFORGE_WORKSPACE_PORT: String(writerPort),
      SCIFORGE_WORKSPACE_WRITER_URL: writerUrl,
      SCIFORGE_BROWSER_HOST_EXECUTABLE_PATH: browserExecutable,
      SCIFORGE_BROWSER_HOST_RESOLVER_RULES: 'MAP sciforge-right-pane-a.test 127.0.0.1, MAP sciforge-right-pane-b.test 127.0.0.1',
      SCIFORGE_BROWSER_HOST_PROXY_SERVER: 'direct://',
      SCIFORGE_BROWSER_HOST_PROXY_BYPASS_LIST: '*',
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
    await assertNewClosePersistAndBrowserHost(page, externalTargets);
    await assertPaneSurfaces(page);
    await assertFilesReadEditSave(page, workspacePath);
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) await stopProcess(child);
    await stopHttpServer(externalFixture);
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

async function assertNewClosePersistAndBrowserHost(page: Page, externalTargets: { first: string; second: string }) {
  await page.locator('.result-new-tab-button').click();
  await page.getByRole('menuitem', { name: 'Browser', exact: true }).click();
  await page.locator('.result-page-tab', { hasText: 'Browser 2' }).waitFor({ state: 'visible', timeout: 10_000 });
  await page.locator('.result-page-tab', { hasText: 'Browser 2' }).click();
  await page.locator('.right-pane-browser-surface input[aria-label="Browser URL"]').waitFor({ state: 'visible' });
  await expectSelectedTabText(page, /Browser 2/);
  await page.waitForFunction(() => document.activeElement?.id.startsWith('result-tab-custom-browser') === true, undefined, { timeout: 2000 });
  assert.equal(await page.evaluate(() => document.activeElement?.id.startsWith('result-tab-custom-browser')), true);

  const browserSurface = page.locator('.right-pane-browser-surface');
  await assertExternalBrowserHostSession(page, browserSurface, externalTargets.first, /^http:\/\/sciforge-right-pane-a\.test:\d+\/alpha/);
  await assertExternalBrowserHostSession(page, browserSurface, externalTargets.second, /^http:\/\/sciforge-right-pane-b\.test:\d+\/beta/);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.locator('.right-pane-browser-surface input[aria-label="Browser URL"]').waitFor({ state: 'visible', timeout: 30_000 });
  await expectSelectedTabText(page, /Browser 2/);
  assert.equal(await page.locator('.right-pane-browser-surface input[aria-label="Browser URL"]').inputValue(), externalTargets.second);

  for (let guard = 0; guard < 10; guard += 1) {
    const tabCount = await page.locator('.result-page-tab[role="tab"]').count();
    if (tabCount === 0) break;
    await page.locator('.result-active-tab-close').click();
  }
  await page.locator('[data-testid="right-pane-empty-workspace"]').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.result-page-tab[role="tab"]').count(), 0);

  await ensurePane(page, 'Terminal', '[data-component-id="terminal-session-viewer"]');
}

async function assertExternalBrowserHostSession(page: Page, browserSurface: Locator, externalUrl: string, expectedUrl: RegExp, expectedAddress = externalUrl) {
  await browserSurface.locator('input[aria-label="Browser URL"]').fill(externalUrl);
  const legacyPopupPromise = page.waitForEvent('popup', { timeout: 1500 }).catch(() => undefined);
  await browserSurface.locator('button', { hasText: /^Open$/ }).first().click();
  const legacyPopup = await legacyPopupPromise;
  if (legacyPopup) {
    await legacyPopup.close().catch(() => undefined);
    assert.fail('Right pane Open must use BrowserHostSession, not a system popup.');
  }

  const workbench = browserSurface.locator('.browser-workbench-viewer').first();
  const surfaceState = await page.waitForFunction(({ source, flags }) => {
    const viewer = document.querySelector('.right-pane-browser-surface .browser-workbench-viewer');
    const state = viewer?.getAttribute('data-browser-state');
    const url = viewer?.querySelector('header p')?.textContent ?? '';
    const nativeSurface = document.querySelector('.right-pane-browser-surface .browser-workbench-host-frame[data-browser-native-surface="true"][data-browser-live-surface-transport="native-embedded"][data-browser-single-interactive-truth="true"]');
    if ((state === 'blocked' || state === 'error') && !nativeSurface) return state;
    if ((state === 'ready' || state === 'loading') && nativeSurface && new RegExp(source, flags).test(url)) return 'native';
    return false;
  }, { source: expectedUrl.source, flags: expectedUrl.flags }, { timeout: 60_000 });
  assert.equal(await browserSurface.locator('input[aria-label="Browser URL"]').inputValue(), expectedAddress);
  await assertNoLegacyBrowserLiveFallback(browserSurface);
  if (await surfaceState.jsonValue() !== 'native') {
    const state = await workbench.getAttribute('data-browser-state');
    assert.ok(state === 'blocked' || state === 'error', await browserSurface.textContent() ?? undefined);
    return;
  }

  assert.equal(await workbench.getAttribute('data-browser-state'), 'ready', await browserSurface.textContent() ?? undefined);
  const nativeSurface = browserSurface.locator('.browser-workbench-host-frame[data-browser-native-surface="true"][data-browser-live-surface-transport="native-embedded"][data-browser-single-interactive-truth="true"]').first();
  await nativeSurface.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await nativeSurface.getAttribute('data-browser-host-surface'), 'browser-host-session');
  assert.equal(await nativeSurface.getAttribute('data-browser-frame-transport'), 'native-embedded');
  assert.match(await nativeSurface.getAttribute('data-browser-live-surface-ref') ?? '', /^browser-host-session:[^/]+\/live-surface$/);
  assert.match(await workbench.locator('header p').textContent() ?? '', expectedUrl);
  assert.equal(await browserSurface.locator(`a[href^="${expectedAddress}"]`).count(), 0);
  assert.ok(await browserSurface.locator('[data-browser-command-id="open"][data-command-text*="--surface workbench"]').count() >= 1);
  assert.equal(await browserSurface.locator('[data-browser-command-id="open-external"], [data-command-text^="/browser open-external"]').count(), 0);
  for (const refKind of ['browser-frame', 'screenshot', 'dom-snapshot', 'ax-snapshot', 'console-log', 'network-log']) {
    assert.ok(
      await browserSurface.locator(`[data-browser-ref-kind="${refKind}"][data-browser-ref^="browser-host-session:"]`).count() >= 1,
      `missing BrowserHostSession ${refKind} ref`,
    );
  }
}

async function assertNoLegacyBrowserLiveFallback(browserSurface: Locator) {
  assert.equal(await browserSurface.locator('[data-browser-host-surface="system-browser-window"]').count(), 0);
  assert.equal(await browserSurface.locator('iframe[src^="/api/sciforge/browser/proxy"], iframe').count(), 0);
  assert.equal(await browserSurface.locator('webview').count(), 0);
  assert.equal(await browserSurface.locator('img[data-browser-host-surface="browser-host-session"]').count(), 0);
  assert.equal(await browserSurface.locator('canvas[data-browser-host-surface="browser-host-session"]').count(), 0);
  assert.equal(await browserSurface.locator('img[src*="/api/sciforge/browser-host/sessions/"][data-browser-host-surface="browser-host-session"]').count(), 0);
}

async function assertPaneSurfaces(page: Page) {
  await ensurePane(page, 'Image / Evidence', '[data-component-id="image-evidence-viewer"]');
  const imageStatus = await page.locator('[data-component-id="image-evidence-viewer"]').first().getAttribute('data-status');
  assert.ok(
    imageStatus === 'missing-ref' || imageStatus === 'empty' || imageStatus === 'blocked',
    `Image / Evidence pane should be empty or typed blocked in this acceptance shell, observed ${String(imageStatus)}`,
  );

  await ensurePane(page, 'Terminal', '[data-component-id="terminal-session-viewer"]');
  await expectAttribute(page, '[data-component-id="terminal-session-viewer"]', 'data-mode', 'live');
  assert.equal(await page.locator('[data-terminal-live-pty-exception="host-owned-workspace-writer"]').count(), 1);
  assert.equal(await page.locator('[data-terminal-live-surface="host-owned"]').count(), 1);
  await page.locator('[data-testid="right-pane-terminal-tool"][data-terminal-connected="true"]').waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await page.locator('[data-terminal-action="input"][disabled]').count(), 0);
  const terminalMarker = `SCIFORGE_ACCEPTANCE_TERMINAL_${Date.now()}`;
  await page.locator('[data-terminal-live-surface="host-owned"]').click();
  await page.keyboard.type(`printf "${terminalMarker}\\n"`);
  await page.keyboard.press('Enter');
  await page.waitForFunction((marker) => {
    const terminal = document.querySelector('[data-testid="right-pane-terminal-tool"]');
    return terminal?.textContent?.includes(marker);
  }, terminalMarker, { timeout: 30_000 });

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

async function startExternalBrowserFixture(port: number): Promise<HttpServer> {
  const server = createHttpServer((req, res) => {
    const host = req.headers.host ?? '';
    const label = host.includes('right-pane-b') ? 'External fixture beta' : 'External fixture alpha';
    res.writeHead(200, {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    });
    res.end(`<!doctype html><html><head><title>${label}</title></head><body><main><h1>${label}</h1><p>${req.url ?? '/'}</p></main></body></html>`);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolve());
  });
  return server;
}

async function stopHttpServer(server: HttpServer | undefined) {
  if (!server) return;
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
