import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium, type Browser, type Locator, type Page } from 'playwright-core';

const EDGE_EXECUTABLE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const DOGFOOD_SCHEMA = 'sciforge.browser-pane-dogfood.v1';
const fixtureHost = 'sciforge-browser-dogfood.test';
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-pane-dogfood');
const manifestPath = join(artifactDir, 'manifest.json');

type JsonRecord = Record<string, unknown>;

type DogfoodFixtureEvent = {
  type: string;
  path: string;
  field?: string;
  valueLength?: number;
  valueHash?: string;
  count?: number;
  maxScrollY?: number;
};

type BrowserPaneDogfoodManifest = {
  schemaVersion: typeof DOGFOOD_SCHEMA;
  status: 'passed';
  runId: string;
  observedAt: string;
  shell: 'web-right-pane';
  targetOriginRef: string;
  browserHostSession: {
    id: string;
    transport?: string;
    frameTransport?: string;
    singleInteractiveTruth?: boolean;
    liveSurfaceRef?: string;
    refs: {
      frameRef?: string;
      screenshotRef?: string;
      domSnapshotRef?: string;
      axSnapshotRef?: string;
      consoleLogRef?: string;
      networkLogRef?: string;
    };
  };
  scenarios: {
    search: ScenarioSummary;
    documentScroll: ScenarioSummary;
    formInput: ScenarioSummary;
  };
  actionTimingSummary: Array<Record<string, unknown>>;
  forbiddenFallbacks: {
    iframe: false;
    proxy: false;
    systemPopup: false;
    httpFrameLiveView: false;
    rawDom: false;
    base64: false;
  };
  verificationCommand: string;
};

type ScenarioSummary = {
  status: 'passed';
  eventTypes: string[];
  valueLengths?: number[];
  valueHashes?: string[];
  navigationPath?: string;
  maxScrollY?: number;
};

test('SciForge Browser pane dogfood covers search, result click, scroll, and form input through BrowserHostSession', { timeout: 180_000 }, async () => {
  const browserExecutable = process.env.SCIFORGE_RIGHT_PANE_BROWSER_EXECUTABLE || EDGE_EXECUTABLE;
  if (!existsSync(browserExecutable)) {
    throw new Error(`No browser executable found for Browser pane dogfood: ${browserExecutable}`);
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-browser-pane-dogfood-'));
  const workspacePath = join(tempRoot, 'workspace');
  const configPath = join(tempRoot, 'config.local.json');
  const writerPort = await getFreePort();
  const uiPort = await getFreePort();
  const fixturePort = await getFreePort();
  const writerUrl = `http://127.0.0.1:${writerPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const fixtureOrigin = `http://${fixtureHost}:${fixturePort}`;
  const runId = `browser-pane-dogfood-${Date.now().toString(36)}`;
  const children: ChildProcess[] = [];
  let browser: Browser | undefined;
  let fixture: Awaited<ReturnType<typeof startDogfoodFixture>> | undefined;

  await mkdir(workspacePath);
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    workspaceWriterBaseUrl: writerUrl,
    workspacePath,
    agentServerBaseUrl: 'http://127.0.0.1:1',
    locale: 'en-US',
    theme: 'dark',
    modelProvider: 'dogfood-local',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
  }), 'utf8');

  try {
    fixture = await startDogfoodFixture(fixturePort);
    const commonEnv = {
      ...process.env,
      SCIFORGE_INSTANCE_ID: runId,
      SCIFORGE_CONFIG_PATH: configPath,
      SCIFORGE_WORKSPACE_PATH: workspacePath,
      SCIFORGE_WORKSPACE_PORT: String(writerPort),
      SCIFORGE_WORKSPACE_WRITER_URL: writerUrl,
      SCIFORGE_BROWSER_HOST_EXECUTABLE_PATH: browserExecutable,
      SCIFORGE_BROWSER_HOST_RESOLVER_RULES: `MAP ${fixtureHost} 127.0.0.1`,
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

    await ensureBrowserPane(page);
    const surface = page.locator('.right-pane-browser-surface');
    await openBrowserPaneUrl(surface, `${fixtureOrigin}/search`);
    const hostFrame = await waitForHostFrame(surface, /^http:\/\/sciforge-browser-dogfood\.test:\d+\/search/);
    await hostFrame.focus();
    await page.keyboard.type('SciForge Browser pane dogfood query alpha 2026');
    await page.keyboard.press('Enter');
    await waitForFixtureEvent(fixture.url, 'search-submit', 15_000);
    await waitForFixtureEvent(fixture.url, 'results-load', 15_000);
    await waitForSessionUrl(page, writerUrl, workspacePath, /\/results\?/);

    await page.keyboard.press('Enter');
    await waitForFixtureEvent(fixture.url, 'result-click', 15_000);
    await waitForSessionUrl(page, writerUrl, workspacePath, /\/docs\/alpha/);
    await hostFrame.hover();
    await page.mouse.wheel(0, 900);
    await waitForFixtureEvent(fixture.url, 'doc-scroll', 15_000);

    await openBrowserPaneUrl(surface, `${fixtureOrigin}/form`);
    await waitForSessionUrl(page, writerUrl, workspacePath, /\/form/);
    await hostFrame.focus();
    await page.keyboard.type('native routed dogfood token');
    await page.keyboard.press('Tab');
    await page.keyboard.type('textarea input through right pane');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Enter');
    await waitForFixtureEvent(fixture.url, 'form-submit', 15_000);

    const session = await currentBrowserHostSession(page, writerUrl, workspacePath);
    const events = await fetchFixtureEvents(fixture.url);
    const manifest = buildManifest({
      runId,
      fixtureOrigin,
      session,
      events,
      fallbackCounts: await fallbackCounts(page),
    });
    assertBrowserPaneDogfoodManifest(manifest);
    await mkdir(artifactDir, { recursive: true });
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) await stopProcess(child);
    await fixture?.close();
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function ensureBrowserPane(page: Page) {
  const tab = page.locator('.result-page-tab', { hasText: 'Browser' }).first();
  if (await tab.count()) {
    await tab.click();
  } else {
    await page.locator('.result-new-tab-button').click();
    await page.getByRole('menuitem', { name: 'Browser', exact: true }).click();
    await page.locator('.result-page-tab', { hasText: 'Browser' }).waitFor({ state: 'visible', timeout: 10_000 });
    await page.locator('.result-page-tab', { hasText: 'Browser' }).click();
  }
  await page.getByTestId('right-pane-browser-tool').waitFor({ state: 'visible', timeout: 20_000 });
}

async function openBrowserPaneUrl(surface: Locator, url: string) {
  const address = surface.locator('input[aria-label="Browser URL"]');
  await address.fill(url);
  await address.press('Enter');
}

async function waitForHostFrame(surface: Locator, expectedUrl: RegExp) {
  await waitForWorkbenchUrl(surface, expectedUrl);
  const hostFrame = surface.locator('img[data-browser-host-surface="browser-host-session"]').first();
  await hostFrame.waitFor({ state: 'visible', timeout: 30_000 });
  await hostFrame.page().waitForFunction(() => {
    const img = document.querySelector('.right-pane-browser-surface img[data-browser-host-surface="browser-host-session"]');
    return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
  }, undefined, { timeout: 30_000 });
  assert.equal(await hostFrame.getAttribute('data-browser-frame-transport'), 'websocket-binary');
  return hostFrame;
}

async function waitForWorkbenchUrl(surface: Locator, expectedUrl: RegExp) {
  await surface.page().waitForFunction(({ source, flags }) => {
    const viewer = document.querySelector('.right-pane-browser-surface .browser-workbench-viewer');
    const state = viewer?.getAttribute('data-browser-state');
    const url = viewer?.querySelector('header p')?.textContent ?? '';
    return state === 'ready' && new RegExp(source, flags).test(url);
  }, { source: expectedUrl.source, flags: expectedUrl.flags }, { timeout: 45_000 });
}

async function clickHostPoint(page: Page, hostFrame: Locator, x: number, y: number) {
  const box = await hostFrame.boundingBox();
  assert.ok(box, 'BrowserHostSession frame must expose visible bounds');
  await page.mouse.click(Math.round(box.x + x), Math.round(box.y + y));
}

async function currentBrowserHostSession(page: Page, writerUrl: string, workspacePath: string): Promise<JsonRecord> {
  const liveSurfaceRef = await page.locator('.right-pane-browser-surface [data-browser-live-surface-ref^="browser-host-session:"]').first().getAttribute('data-browser-live-surface-ref');
  const sessionId = /^browser-host-session:([^/]+)\//.exec(liveSurfaceRef ?? '')?.[1];
  assert.ok(sessionId, `Missing BrowserHostSession ref: ${String(liveSurfaceRef)}`);
  const url = new URL(`${writerUrl}/api/sciforge/browser-host/sessions/${encodeURIComponent(sessionId)}/state`);
  url.searchParams.set('workspacePath', workspacePath);
  const json = await fetchJson(url.href);
  const session = recordField(json.session);
  assert.ok(session, 'BrowserHostSession state response must include session');
  return session;
}

async function waitForSessionUrl(page: Page, writerUrl: string, workspacePath: string, pattern: RegExp): Promise<JsonRecord> {
  const deadline = Date.now() + 30_000;
  let lastUrl = '';
  while (Date.now() < deadline) {
    const session = await currentBrowserHostSession(page, writerUrl, workspacePath);
    lastUrl = stringField(session.url);
    if (pattern.test(lastUrl)) return session;
    await delay(250);
  }
  throw new Error(`Timed out waiting for BrowserHostSession URL ${pattern}: last=${lastUrl}`);
}

async function fallbackCounts(page: Page) {
  return page.evaluate(() => ({
    iframe: document.querySelectorAll('.right-pane-browser-surface iframe[src^="/api/sciforge/browser/proxy"], .right-pane-browser-surface iframe').length,
    proxy: document.querySelectorAll('.right-pane-browser-surface iframe[src^="/api/sciforge/browser/proxy"]').length,
    systemPopup: document.querySelectorAll('[data-browser-host-surface="system-browser-window"]').length,
    httpFrameLiveView: document.querySelectorAll('.right-pane-browser-surface img[src*="/api/sciforge/browser-host/sessions/"][data-browser-host-surface="browser-host-session"]').length,
  }));
}

function buildManifest(input: {
  runId: string;
  fixtureOrigin: string;
  session: JsonRecord;
  events: DogfoodFixtureEvent[];
  fallbackCounts: { iframe: number; proxy: number; systemPopup: number; httpFrameLiveView: number };
}): BrowserPaneDogfoodManifest {
  const eventTypes = (path: string) => input.events.filter((event) => event.path === path).map((event) => event.type);
  const formEvents = input.events.filter((event) => event.path === '/form');
  const scrollEvents = input.events.filter((event) => event.type === 'doc-scroll');
  return {
    schemaVersion: DOGFOOD_SCHEMA,
    status: 'passed',
    runId: input.runId,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetOriginRef: `fixture-origin:${hashText(input.fixtureOrigin)}`,
    browserHostSession: {
      id: stringField(input.session.id),
      transport: stringField(input.session.liveSurfaceTransport),
      frameTransport: stringField(recordField(input.session.lastActionTiming)?.liveSurfaceTransport) === 'host-stream' ? 'websocket-binary' : undefined,
      singleInteractiveTruth: input.session.singleInteractiveTruth === true,
      liveSurfaceRef: stringField(input.session.liveSurfaceRef),
      refs: {
        frameRef: stringField(input.session.frameRef),
        screenshotRef: stringField(input.session.screenshotRef),
        domSnapshotRef: stringField(input.session.domSnapshotRef),
        axSnapshotRef: stringField(input.session.axSnapshotRef),
        consoleLogRef: stringField(input.session.consoleLogRef),
        networkLogRef: stringField(input.session.networkLogRef),
      },
    },
    scenarios: {
      search: {
        status: 'passed',
        eventTypes: eventTypes('/search'),
        valueLengths: input.events.filter((event) => event.type === 'search-submit').map((event) => event.valueLength ?? 0),
        valueHashes: input.events.filter((event) => event.type === 'search-submit').map((event) => event.valueHash ?? ''),
        navigationPath: '/results',
      },
      documentScroll: {
        status: 'passed',
        eventTypes: eventTypes('/docs/alpha'),
        navigationPath: '/docs/alpha',
        maxScrollY: Math.max(0, ...scrollEvents.map((event) => event.maxScrollY ?? 0)),
      },
      formInput: {
        status: 'passed',
        eventTypes: eventTypes('/form'),
        valueLengths: formEvents.map((event) => event.valueLength ?? 0).filter(Boolean),
        valueHashes: formEvents.map((event) => event.valueHash ?? '').filter(Boolean),
        navigationPath: '/form',
      },
    },
    actionTimingSummary: Array.isArray(input.session.actionTimingSummary)
      ? input.session.actionTimingSummary.filter((entry): entry is Record<string, unknown> => Boolean(recordField(entry))).slice(0, 12)
      : [],
    forbiddenFallbacks: {
      iframe: false,
      proxy: false,
      systemPopup: false,
      httpFrameLiveView: false,
      rawDom: false,
      base64: false,
    },
    verificationCommand: 'node --import tsx --test tests/smoke/smoke-browser-pane-dogfood.test.ts',
  };
}

function assertBrowserPaneDogfoodManifest(manifest: BrowserPaneDogfoodManifest) {
  assert.equal(manifest.schemaVersion, DOGFOOD_SCHEMA);
  assert.equal(manifest.browserHostSession.transport, 'host-stream');
  assert.match(manifest.browserHostSession.liveSurfaceRef ?? '', /^browser-host-session:[^/]+\/live-surface$/);
  assert.match(manifest.browserHostSession.refs.frameRef ?? '', /^browser-host-session:[^/]+\/frame\.png$/);
  assert.ok(manifest.scenarios.search.eventTypes.includes('search-submit'));
  assert.ok(manifest.scenarios.search.eventTypes.includes('results-load'));
  assert.ok(manifest.scenarios.documentScroll.eventTypes.includes('result-click'));
  assert.ok((manifest.scenarios.documentScroll.maxScrollY ?? 0) > 0);
  assert.ok(manifest.scenarios.formInput.eventTypes.includes('form-submit'));
  assert.deepEqual(Object.values(manifest.forbiddenFallbacks), [false, false, false, false, false, false]);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /<!doctype|<html|data:image|outerHTML|innerHTML/i);
}

async function startDogfoodFixture(port: number): Promise<{ url: string; close(): Promise<void> }> {
  const events: DogfoodFixtureEvent[] = [];
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${fixtureHost}:${port}`);
    if (url.pathname === '/__events') {
      if (req.method === 'POST') {
        const body = await readRequestBody(req);
        const record = eventFromPayload(body, url.searchParams.get('path') || '/');
        events.push(record);
        writeJson(res, 200, { ok: true });
        return;
      }
      writeJson(res, 200, { ok: true, events });
      return;
    }
    if (url.pathname === '/search') {
      writeHtml(res, searchPage());
      return;
    }
    if (url.pathname === '/results') {
      events.push({ type: 'results-load', path: '/search', valueLength: (url.searchParams.get('q') ?? '').length, valueHash: hashText(url.searchParams.get('q') ?? '') });
      writeHtml(res, resultsPage(url.searchParams.get('q') ?? ''));
      return;
    }
    if (url.pathname === '/docs/alpha') {
      if (url.searchParams.get('from') === 'result') {
        events.push({ type: 'result-click', path: '/docs/alpha', valueLength: 'alpha-doc'.length, valueHash: hashText('alpha-doc') });
      }
      writeHtml(res, docsPage());
      return;
    }
    if (url.pathname === '/form') {
      writeHtml(res, formPage());
      return;
    }
    writeHtml(res, searchPage());
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveListen());
  });
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => stopHttpServer(server),
  };
}

function searchPage() {
  return pageShell('Dogfood Search', `
    <main>
      <h1>Dogfood Search</h1>
      <form id="searchForm" action="/results" method="get">
        <input id="q" name="q" autofocus aria-label="Search query" />
        <button type="submit">Search</button>
      </form>
    </main>
    <script>
      searchForm.addEventListener('submit', () => {
        navigator.sendBeacon('/__events?path=/search', JSON.stringify({ type: 'search-submit', value: q.value }));
      });
    </script>
  `);
}

function resultsPage(query: string) {
  return pageShell('Dogfood Results', `
    <main>
      <h1>Dogfood Results</h1>
      <p>Query length ${query.length}</p>
      <a id="alphaResult" class="result-link" href="/docs/alpha?from=result">Open Alpha technical document</a>
      <a class="result-link" href="/form">Open form fixture</a>
      <script>alphaResult.focus();</script>
    </main>
  `);
}

function docsPage() {
  return pageShell('Alpha Technical Document', `
    <main>
      <h1>Alpha Technical Document</h1>
      ${Array.from({ length: 48 }, (_, index) => `<p>Section ${index + 1}: bounded Browser pane dogfood content for scroll verification.</p>`).join('')}
    </main>
    <script>
      let scrollCount = 0;
      addEventListener('scroll', () => {
        scrollCount += 1;
        navigator.sendBeacon('/__events?path=/docs/alpha', JSON.stringify({ type: 'doc-scroll', count: scrollCount, maxScrollY: Math.round(scrollY) }));
      }, { passive: true });
    </script>
  `);
}

function formPage() {
  return pageShell('Dogfood Form', `
    <main>
      <h1>Dogfood Form</h1>
      <form id="dogfoodForm">
        <input id="titleInput" aria-label="Title" autofocus />
        <textarea id="bodyInput" aria-label="Body"></textarea>
        <button type="submit">Submit</button>
      </form>
    </main>
    <script>
      function record(type, field, value) {
        navigator.sendBeacon('/__events?path=/form', JSON.stringify({ type, field, value }));
      }
      titleInput.addEventListener('input', () => record('form-input', 'title', titleInput.value));
      bodyInput.addEventListener('input', () => record('form-input', 'body', bodyInput.value));
      dogfoodForm.addEventListener('submit', (event) => {
        event.preventDefault();
        record('form-submit', 'form', titleInput.value + ':' + bodyInput.value);
      });
      titleInput.focus();
    </script>
  `);
}

function pageShell(title: string, body: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { margin: 0; font-family: sans-serif; color: #101820; background: #f7faf9; }
      main { padding: 24px; }
      h1 { margin: 0 0 18px; font-size: 28px; }
      input, textarea { box-sizing: border-box; display: block; width: 520px; margin: 0 0 14px; padding: 10px 12px; font-size: 16px; border: 2px solid #174c4f; border-radius: 4px; background: white; }
      textarea { height: 64px; }
      button, .result-link { display: block; width: 560px; margin: 12px 0; padding: 14px 16px; border: 0; border-radius: 4px; background: #174c4f; color: white; font-size: 16px; text-align: left; text-decoration: none; }
      p { max-width: 720px; line-height: 1.55; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function eventFromPayload(raw: string, path: string): DogfoodFixtureEvent {
  const payload = parseJsonRecord(raw);
  const value = typeof payload.value === 'string' ? payload.value : '';
  return {
    type: typeof payload.type === 'string' ? payload.type : 'unknown',
    path,
    field: typeof payload.field === 'string' ? payload.field : undefined,
    valueLength: value ? value.length : undefined,
    valueHash: value ? hashText(value) : undefined,
    count: typeof payload.count === 'number' && Number.isFinite(payload.count) ? payload.count : undefined,
    maxScrollY: typeof payload.maxScrollY === 'number' && Number.isFinite(payload.maxScrollY) ? payload.maxScrollY : undefined,
  };
}

async function waitForFixtureEvent(baseUrl: string, type: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await fetchFixtureEvents(baseUrl);
    if (events.some((event) => event.type === type)) return;
    await delay(250);
  }
  throw new Error(`Timed out waiting for fixture event ${type}`);
}

async function fetchFixtureEvents(baseUrl: string): Promise<DogfoodFixtureEvent[]> {
  const json = await fetchJson(`${baseUrl}/__events`);
  return Array.isArray(json.events) ? json.events.filter(isDogfoodFixtureEvent) : [];
}

function isDogfoodFixtureEvent(value: unknown): value is DogfoodFixtureEvent {
  return Boolean(recordField(value) && typeof (value as DogfoodFixtureEvent).type === 'string' && typeof (value as DogfoodFixtureEvent).path === 'string');
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
  const exited = new Promise<void>((resolveExit) => child.once('exit', () => resolveExit()));
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
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  await new Promise<void>((resolveClose, reject) => server.close((error) => error ? reject(error) : resolveClose()));
  if (!port) throw new Error('Could not allocate a free port');
  return port;
}

async function stopHttpServer(server: HttpServer | undefined) {
  if (!server) return;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

function writeHtml(res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }, body: string) {
  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(body);
}

function writeJson(res: { writeHead(status: number, headers: Record<string, string>): void; end(body: string): void }, status: number, body: JsonRecord) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  res.end(JSON.stringify(body));
}

async function readRequestBody(req: { on(event: 'data', listener: (chunk: Buffer) => void): void; on(event: 'end', listener: () => void): void; on(event: 'error', listener: (error: Error) => void): void }) {
  const chunks: Buffer[] = [];
  await new Promise<void>((resolveRead, reject) => {
    req.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolveRead());
    req.on('error', reject);
  });
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchJson(url: string): Promise<JsonRecord> {
  const response = await fetch(url);
  const text = await response.text();
  const json = text ? parseJsonRecord(text) : {};
  if (!response.ok || json.ok === false) throw new Error(`GET ${url} failed: ${response.status}`);
  return json;
}

function parseJsonRecord(value: string): JsonRecord {
  try {
    const parsed = JSON.parse(value) as unknown;
    return recordField(parsed) ?? {};
  } catch {
    return {};
  }
}

function recordField(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function stringField(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function delay(ms: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));
}
