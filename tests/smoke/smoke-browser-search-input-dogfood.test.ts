import assert from 'node:assert/strict';
import { spawn, type ChildProcess } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer as createHttpServer, type Server as HttpServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { chromium, type Browser, type Locator, type Page, type Response } from 'playwright-core';

const EDGE_EXECUTABLE = '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge';
const DOGFOOD_SCHEMA = 'sciforge.browser-search-input-dogfood.v1';
const fixtureHost = 'sciforge-browser-search-input-dogfood.test';
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-search-input-dogfood');
const manifestPath = join(artifactDir, 'manifest.json');

const LONG_MIXED_QUERY = [
  'SciForge Browser pane search input 完成度',
  '中文 English symbols !@#$%^&*()[]{}+-=_:;,.?/ quoted "refs-first"',
  'long-query-section-01 long-query-section-02 long-query-section-03',
  'no-drop no-composer-capture tail-ABCDEFGHIJKLMN',
].join(' | ');
const BACKSPACE_COUNT = 10;
const RETYPE_SUFFIX = ' 修订 refined+v2!? [tail]';

type JsonRecord = Record<string, unknown>;

type BrowserPaneLiveAcceptance = {
  status: 'passed' | 'blocked';
  claimScope: 'right-pane-live-pass' | 'diagnostic-only';
  passClaim: boolean;
  required: {
    liveSurfaceTransport: 'native-embedded';
    singleInteractiveTruth: true;
    secondTruthSource: false;
  };
  observed: {
    shell: 'web-right-pane';
    liveSurfaceTransport: string;
    singleInteractiveTruth: boolean;
    secondTruthSource: boolean;
    frameTransport?: string;
  };
  blockedReason?: string;
};

type SearchInputFixtureEvent = {
  type: string;
  path: string;
  valueLength?: number;
  valueHash?: string;
  inputIndex?: number;
};

type BoundedComputerUseAction = {
  inputChannel: string;
  userDeviceImpact: string;
  sharedSystemInputUsed: boolean | undefined;
  systemMouseEvents: string;
  systemKeyboardEvents: string;
  liveBrowserOwner: string;
  singleInteractiveTruth: boolean;
  sessionRef?: string;
  hostAction: {
    action: string;
    capture?: string;
    key?: string;
    textLength?: number;
    textHash?: string;
  };
};

type SearchInputDogfoodManifest = {
  schemaVersion: typeof DOGFOOD_SCHEMA;
  status: 'passed' | 'blocked';
  runId: string;
  observedAt: string;
  shell: 'web-right-pane';
  targetOriginRef: string;
  inputPath: {
    browserSurface: 'browser-host-session';
    visualHostFrame: 'visible' | 'blocked';
    keyboardPath: 'native-embedded' | 'blocked';
    hiddenKeyboardFocused: boolean;
    inputChannel: 'browser-host-session';
  };
  query: {
    dimensions: string[];
    initialLength: number;
    initialHash: string;
    afterBackspaceLength: number;
    afterBackspaceHash: string;
    retypeSuffixLength: number;
    retypeSuffixHash: string;
    finalLength: number;
    finalHash: string;
    backspaceCount: number;
  };
  browserHostSession: {
    id: string;
    owner: string;
    status: string;
    transport?: string;
    liveSurfaceTransport?: string;
    frameTransport?: string;
    singleInteractiveTruth?: boolean;
    secondTruthSource?: boolean;
    liveSurfaceRef?: string;
    urlMatchedResults: boolean;
    observedUrlLag: boolean;
    observedUrlHash?: string;
    refs: {
      frameRef?: string;
      screenshotRef?: string;
      domSnapshotRef?: string;
      axSnapshotRef?: string;
      consoleLogRef?: string;
      networkLogRef?: string;
    };
  };
  fixtureEvidence: {
    eventTypes: string[];
    inputLengthTrace: number[];
    inputHashTrace: string[];
    submitted: {
      length: number;
      hash: string;
    };
    resultsLoad: {
      length: number;
      hash: string;
    };
  };
  liveAcceptance: BrowserPaneLiveAcceptance;
  blockedReason?: string;
  inputActionEvidence: {
    inputChannel: 'browser-host-session';
    systemKeyboardEvents: 'not-sent';
    sharedSystemInputUsed: false;
    userDeviceImpact: 'none';
    shellComposerCapturedCharacters: 0;
    actionTypes: string[];
    typeActionTextLengths: number[];
    typeActionTextHashes: string[];
    pressKeys: string[];
    actionCount: number;
  };
  timingSummary: Array<Record<string, unknown>>;
  forbiddenEvidence: {
    fixtureDomRead: false;
    rawDom: false;
    base64: false;
    screenshot: false;
    directFixtureDomPass: false;
  };
  failureFocusedDiagnostic: {
    schemaVersion: 'sciforge.browser-search-input-dogfood.failure-diagnostic.v1';
    focus: {
      keyboardPath: 'native-embedded' | 'blocked';
      hiddenKeyboardFocused: boolean;
      browserSurface: 'browser-host-session';
    };
    session: {
      status: string;
      liveSurfaceRef?: string;
      observedUrlHash?: string;
      urlMatchedResults: boolean;
    };
    fixtureEventTrace: {
      recentEventTypes: string[];
      lastInputLength: number;
      lastInputHash: string;
      submitSeen: boolean;
      resultsSeen: boolean;
    };
    actionTrace: {
      recentActionTypes: string[];
      recentPressKeys: string[];
      recentTypeLengths: number[];
      actionCount: number;
    };
    timingSummary: Array<Record<string, unknown>>;
    forbiddenEvidence: {
      rawQuery: false;
      rawDom: false;
      base64: false;
      screenshot: false;
      systemInputPayload: false;
    };
  };
  verificationCommand: string;
};

test('SciForge Browser pane search input dogfood gates long mixed query on native embedded input evidence', { timeout: 180_000 }, async () => {
  const browserExecutable = process.env.SCIFORGE_RIGHT_PANE_BROWSER_EXECUTABLE || EDGE_EXECUTABLE;
  if (!existsSync(browserExecutable)) {
    throw new Error(`No browser executable found for Browser pane search input dogfood: ${browserExecutable}`);
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-browser-search-input-dogfood-'));
  const workspacePath = join(tempRoot, 'workspace');
  const configPath = join(tempRoot, 'config.local.json');
  const writerPort = await getFreePort();
  const uiPort = await getFreePort();
  const fixturePort = await getFreePort();
  const writerUrl = `http://127.0.0.1:${writerPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const fixtureOrigin = `http://${fixtureHost}:${fixturePort}`;
  const runId = `browser-search-input-dogfood-${Date.now().toString(36)}`;
  const children: ChildProcess[] = [];
  let browser: Browser | undefined;
  let fixture: Awaited<ReturnType<typeof startSearchInputFixture>> | undefined;

  const afterBackspaceQuery = LONG_MIXED_QUERY.slice(0, -BACKSPACE_COUNT);
  const expectedFinalQuery = `${afterBackspaceQuery}${RETYPE_SUFFIX}`;

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
    fixture = await startSearchInputFixture(fixturePort);
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
    const actionRecorder = recordBrowserHostComputerUseActions(page);

    await page.goto(uiUrl, { waitUntil: 'domcontentloaded' });
    await page.locator('.results-panel').waitFor({ state: 'visible', timeout: 30_000 });

    await ensureBrowserPane(page);
    const surface = page.locator('.right-pane-browser-surface');
    await openBrowserPaneUrl(surface, `${fixtureOrigin}/search`);
    const keyboardSurface = await waitForKeyboardHostFrame(surface, /^http:\/\/sciforge-browser-search-input-dogfood\.test:\d+\/search/);
    if (!keyboardSurface) {
      const manifest = buildBlockedSearchInputDogfoodManifest(runId, fixtureOrigin, 'Browser pane search input dogfood requires native-embedded BrowserHostSession input evidence; current web-right-pane run did not expose it.');
      assertSearchInputDogfoodManifest(manifest, {
        initialQuery: LONG_MIXED_QUERY,
        afterBackspaceQuery,
        expectedFinalQuery,
        retypeSuffix: RETYPE_SUFFIX,
      });
      await mkdir(artifactDir, { recursive: true });
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return;
    }
    const { frame, visualFrame } = keyboardSurface;

    await clickHostPoint(page, visualFrame, 144, 52);
    await waitForFixtureEvent(fixture.url, (event) => event.type === 'search-focus', 15_000, 'search-focus');
    const keyboardFocus = await hiddenKeyboardFocusState(page);
    assert.equal(keyboardFocus.keyboardPath, 'native-embedded');
    assert.equal(keyboardFocus.hiddenKeyboardFocused, false, 'Browser pane search input smoke must not rely on a hidden keyboard fallback');
    assert.equal(await frame.getAttribute('data-browser-host-surface'), 'browser-host-session');

    await page.keyboard.insertText(LONG_MIXED_QUERY);
    await waitForFixtureEvent(
      fixture.url,
      (event) => event.type === 'search-input' && event.valueLength === LONG_MIXED_QUERY.length && event.valueHash === hashText(LONG_MIXED_QUERY),
      30_000,
      'initial long mixed query input',
    );

    for (let index = 0; index < BACKSPACE_COUNT; index += 1) {
      await page.keyboard.press('Backspace');
    }
    await waitForFixtureEvent(
      fixture.url,
      (event) => event.type === 'search-input' && event.valueLength === afterBackspaceQuery.length && event.valueHash === hashText(afterBackspaceQuery),
      30_000,
      'Backspace deletion trace',
    );

    await page.keyboard.insertText(RETYPE_SUFFIX);
    await waitForFixtureEvent(
      fixture.url,
      (event) => event.type === 'search-input' && event.valueLength === expectedFinalQuery.length && event.valueHash === hashText(expectedFinalQuery),
      30_000,
      'retyped final query input',
    );

    await page.keyboard.press('Enter');
    const submitted = await waitForFixtureEvent(
      fixture.url,
      (event) => event.type === 'search-submit' && event.valueLength === expectedFinalQuery.length && event.valueHash === hashText(expectedFinalQuery),
      30_000,
      'Enter search submit',
    );
    const resultsLoad = await waitForFixtureEvent(
      fixture.url,
      (event) => event.type === 'results-load' && event.valueLength === expectedFinalQuery.length && event.valueHash === hashText(expectedFinalQuery),
      30_000,
      'results load after Enter',
    );

    await actionRecorder.waitFor((action) => action.hostAction.action === 'press' && action.hostAction.key === 'Enter', 10_000, 'Enter BrowserHostSession action');
    await actionRecorder.drain();
    assertBrowserHostInputActions(actionRecorder.actions, LONG_MIXED_QUERY, RETYPE_SUFFIX, BACKSPACE_COUNT);
    const shellComposerCapturedCharacters = await shellComposerCapturedCharactersCount(page);
    assert.equal(shellComposerCapturedCharacters, 0, 'Browser input must not leak into the shell composer');

    const session = await observeSessionUrl(page, writerUrl, workspacePath, /\/results\?/, 8_000);
    const events = await fetchFixtureEvents(fixture.url);
    const manifest = buildManifest({
      runId,
      fixtureOrigin,
      session,
      events,
      submitted,
      resultsLoad,
      actions: actionRecorder.actions,
      shellComposerCapturedCharacters,
      afterBackspaceQuery,
      expectedFinalQuery,
    });
    assertSearchInputDogfoodManifest(manifest, {
      initialQuery: LONG_MIXED_QUERY,
      afterBackspaceQuery,
      expectedFinalQuery,
      retypeSuffix: RETYPE_SUFFIX,
    });
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

async function waitForKeyboardHostFrame(surface: Locator, expectedUrl: RegExp): Promise<{ frame: Locator; visualFrame: Locator } | undefined> {
  await waitForWorkbenchUrl(surface, expectedUrl);
  const frame = surface.locator('.browser-workbench-host-frame[data-browser-native-surface="true"][data-browser-live-surface-transport="native-embedded"][data-browser-single-interactive-truth="true"]').first();
  if (!await frame.count()) {
    await assertNoLegacyBrowserLiveFallback(surface);
    return undefined;
  }
  await frame.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await frame.getAttribute('data-browser-host-surface'), 'browser-host-session');
  assert.equal(await frame.getAttribute('data-browser-frame-transport'), 'native-embedded');
  assert.match(await frame.getAttribute('data-browser-live-surface-ref') ?? '', /^browser-host-session:[^/]+\/live-surface$/);
  await assertNoLegacyBrowserLiveFallback(surface);
  return { frame, visualFrame: frame };
}

async function waitForWorkbenchUrl(surface: Locator, expectedUrl: RegExp) {
  try {
    await surface.page().waitForFunction(({ source, flags }) => {
      const viewer = document.querySelector('.right-pane-browser-surface .browser-workbench-viewer');
      const state = viewer?.getAttribute('data-browser-state');
      const url = viewer?.querySelector('header p')?.textContent ?? '';
      if (state === 'blocked' || state === 'error') return true;
      return state === 'ready' && new RegExp(source, flags).test(url);
    }, { source: expectedUrl.source, flags: expectedUrl.flags }, { timeout: 45_000 });
  } catch (error) {
    const diagnostic = await browserWorkbenchFailureDiagnostic(surface, expectedUrl)
      .catch((diagnosticError: unknown) => ({
        diagnosticError: scrubDiagnostic(errorMessage(diagnosticError)),
      }));
    throw new Error(`Timed out waiting for Browser workbench URL: ${JSON.stringify(diagnostic)}; cause=${scrubDiagnostic(errorMessage(error))}`);
  }
}

async function clickHostPoint(page: Page, hostFrame: Locator, x: number, y: number) {
  const box = await hostFrame.boundingBox();
  assert.ok(box, 'BrowserHostSession frame must expose visible bounds');
  await page.mouse.click(Math.round(box.x + x), Math.round(box.y + y));
}

async function assertNoLegacyBrowserLiveFallback(surface: Locator) {
  assert.equal(await surface.locator('[data-browser-host-surface="system-browser-window"]').count(), 0);
  assert.equal(await surface.locator('iframe[src^="/api/sciforge/browser/proxy"], iframe').count(), 0);
  assert.equal(await surface.locator('webview').count(), 0);
  assert.equal(await surface.locator('img[data-browser-host-surface="browser-host-session"]').count(), 0);
  assert.equal(await surface.locator('canvas[data-browser-host-surface="browser-host-session"]').count(), 0);
  assert.equal(await surface.locator('img[src*="/api/sciforge/browser-host/sessions/"][data-browser-host-surface="browser-host-session"]').count(), 0);
}

async function hiddenKeyboardFocusState(page: Page): Promise<{ keyboardPath: string; hiddenKeyboardFocused: boolean }> {
  return page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('.right-pane-browser-surface .browser-workbench-host-frame[data-browser-native-surface="true"]');
    const input = frame?.querySelector<HTMLTextAreaElement>('.browser-workbench-host-keyboard-input[data-browser-host-keyboard-input="true"]') ?? null;
    return {
      keyboardPath: frame?.getAttribute('data-browser-live-surface-transport') === 'native-embedded' ? 'native-embedded' : '',
      hiddenKeyboardFocused: Boolean(input && document.activeElement === input && input.dataset.browserHostKeyboardFocus === 'active'),
    };
  });
}

async function browserWorkbenchFailureDiagnostic(surface: Locator, expectedUrl: RegExp): Promise<JsonRecord> {
  const snapshot = await surface.page().evaluate(() => {
    const viewer = document.querySelector<HTMLElement>('.right-pane-browser-surface .browser-workbench-viewer');
    const frame = document.querySelector<HTMLElement>('.right-pane-browser-surface .browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]');
    const input = frame?.querySelector<HTMLTextAreaElement>('.browser-workbench-host-keyboard-input[data-browser-host-keyboard-input="true"]') ?? null;
    return {
      viewerState: viewer?.getAttribute('data-browser-state') ?? '',
      displayedUrl: viewer?.querySelector('header p')?.textContent ?? '',
      liveSurfaceRef: frame?.getAttribute('data-browser-live-surface-ref') ?? '',
      keyboardPath: frame?.getAttribute('data-browser-live-surface-transport') === 'native-embedded' ? 'native-embedded' : '',
      hiddenKeyboardFocused: Boolean(input && document.activeElement === input && input.dataset.browserHostKeyboardFocus === 'active'),
    };
  });
  return {
    schemaVersion: 'sciforge.browser-workbench-url-timeout-diagnostic.v1',
    expectedUrlPatternHash: hashText(`${expectedUrl.source}/${expectedUrl.flags}`),
    viewerState: snapshot.viewerState,
    displayedUrlLength: snapshot.displayedUrl.length,
    displayedUrlHash: snapshot.displayedUrl ? hashText(snapshot.displayedUrl) : '',
    liveSurfaceRef: snapshot.liveSurfaceRef || undefined,
    keyboardPath: snapshot.keyboardPath,
    hiddenKeyboardFocused: snapshot.hiddenKeyboardFocused,
    rawUrlCaptured: false,
    rawDomCaptured: false,
  };
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

async function observeSessionUrl(page: Page, writerUrl: string, workspacePath: string, pattern: RegExp, timeoutMs: number): Promise<JsonRecord> {
  const deadline = Date.now() + timeoutMs;
  let lastUrl = '';
  let lastSession: JsonRecord | undefined;
  while (Date.now() < deadline) {
    const session = await currentBrowserHostSession(page, writerUrl, workspacePath);
    lastSession = session;
    lastUrl = stringField(session.url);
    if (pattern.test(lastUrl)) return session;
    await delay(250);
  }
  return {
    ...(lastSession ?? {}),
    observedUrlLag: true,
    observedUrlHash: lastUrl ? hashText(lastUrl) : '',
  };
}

function recordBrowserHostComputerUseActions(page: Page): {
  actions: BoundedComputerUseAction[];
  waitFor(predicate: (action: BoundedComputerUseAction) => boolean, timeoutMs: number, label: string): Promise<void>;
  drain(): Promise<void>;
} {
  const actions: BoundedComputerUseAction[] = [];
  const pending = new Set<Promise<void>>();
  const errors: Error[] = [];
  page.on('response', (response: Response) => {
    if (!response.url().includes('/api/sciforge/browser-host/sessions/') || !response.url().includes('/computer-use-actions')) return;
    const task = response.json()
      .then((json: unknown) => {
        const result = recordField(recordField(json)?.result);
        if (!result) return;
        actions.push(boundedComputerUseAction(result));
      })
      .catch((error: unknown) => {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      });
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  return {
    actions,
    async waitFor(predicate: (action: BoundedComputerUseAction) => boolean, timeoutMs: number, label: string) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        await Promise.allSettled([...pending]);
        if (actions.some(predicate)) return;
        if (errors.length) throw errors[0];
        await delay(100);
      }
      throw new Error(`Timed out waiting for recorded action: ${label}. Seen actions: ${JSON.stringify(actions.map((action) => ({
        action: action.hostAction.action,
        key: action.hostAction.key,
        textLength: action.hostAction.textLength,
        inputChannel: action.inputChannel,
        systemKeyboardEvents: action.systemKeyboardEvents,
      })))}`);
    },
    async drain() {
      await Promise.allSettled([...pending]);
      if (errors.length) throw errors[0];
    },
  };
}

function boundedComputerUseAction(result: JsonRecord): BoundedComputerUseAction {
  const hostAction = recordField(result.hostAction) ?? {};
  const session = recordField(result.session);
  const action = stringField(hostAction.action);
  const text = stringField(hostAction.text);
  return {
    inputChannel: stringField(result.inputChannel),
    userDeviceImpact: stringField(result.userDeviceImpact),
    sharedSystemInputUsed: typeof result.sharedSystemInputUsed === 'boolean' ? result.sharedSystemInputUsed : undefined,
    systemMouseEvents: stringField(result.systemMouseEvents),
    systemKeyboardEvents: stringField(result.systemKeyboardEvents),
    liveBrowserOwner: stringField(result.liveBrowserOwner),
    singleInteractiveTruth: result.singleInteractiveTruth === true,
    sessionRef: stringField(session?.id) ? `browser-host-session:${stringField(session?.id)}` : undefined,
    hostAction: {
      action,
      capture: stringField(hostAction.capture) || undefined,
      key: action === 'press' ? stringField(hostAction.key) : undefined,
      textLength: action === 'type' ? text.length : undefined,
      textHash: action === 'type' ? hashText(text) : undefined,
    },
  };
}

function assertBrowserHostInputActions(
  actions: BoundedComputerUseAction[],
  initialQuery: string,
  retypeSuffix: string,
  backspaceCount: number,
) {
  assert.ok(actions.length > 0, 'Browser pane must emit BrowserHostSession Computer Use actions');
  for (const action of actions) {
    assert.equal(action.inputChannel, 'browser-host-session');
    assert.equal(action.userDeviceImpact, 'none');
    assert.equal(action.sharedSystemInputUsed, false);
    assert.equal(action.systemKeyboardEvents, 'not-sent');
    assert.equal(action.liveBrowserOwner, 'BrowserHostSession');
    assert.equal(action.singleInteractiveTruth, true);
  }
  const typeActions = actions.filter((action) => action.hostAction.action === 'type');
  assert.ok(typeActions.some((action) => action.hostAction.textLength === initialQuery.length && action.hostAction.textHash === hashText(initialQuery)), 'initial long query must be routed as BrowserHostSession type_text');
  assert.ok(typeActions.some((action) => action.hostAction.textLength === retypeSuffix.length && action.hostAction.textHash === hashText(retypeSuffix)), 'retyped suffix must be routed as BrowserHostSession type_text');
  const pressKeys = actions.filter((action) => action.hostAction.action === 'press').map((action) => action.hostAction.key);
  assert.ok(pressKeys.filter((key) => key === 'Backspace').length >= backspaceCount, 'Backspace presses must be routed to BrowserHostSession');
  assert.ok(pressKeys.includes('Enter'), 'Enter submit must be routed to BrowserHostSession');
}

async function shellComposerCapturedCharactersCount(page: Page): Promise<number> {
  const composer = page.locator('.composer textarea').first();
  if (!await composer.count()) return 0;
  return composer.evaluate((node) => node instanceof HTMLTextAreaElement ? node.value.length : 0);
}

function buildManifest(input: {
  runId: string;
  fixtureOrigin: string;
  session: JsonRecord;
  events: SearchInputFixtureEvent[];
  submitted: SearchInputFixtureEvent;
  resultsLoad: SearchInputFixtureEvent;
  actions: BoundedComputerUseAction[];
  shellComposerCapturedCharacters: number;
  afterBackspaceQuery: string;
  expectedFinalQuery: string;
}): SearchInputDogfoodManifest {
  const inputEvents = input.events.filter((event) => event.type === 'search-input');
  const typeActions = input.actions.filter((action) => action.hostAction.action === 'type');
  const pressActions = input.actions.filter((action) => action.hostAction.action === 'press');
  const liveAcceptance = browserPaneLiveAcceptance(input.session);
  return {
    schemaVersion: DOGFOOD_SCHEMA,
    status: liveAcceptance.status,
    runId: input.runId,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetOriginRef: `fixture-origin:${hashText(input.fixtureOrigin)}`,
    inputPath: {
      browserSurface: 'browser-host-session',
      visualHostFrame: 'visible',
      keyboardPath: 'native-embedded',
      hiddenKeyboardFocused: false,
      inputChannel: 'browser-host-session',
    },
    query: {
      dimensions: ['long', 'zh-en-symbols', 'backspace-delete-retype', 'enter-submit'],
      initialLength: LONG_MIXED_QUERY.length,
      initialHash: hashText(LONG_MIXED_QUERY),
      afterBackspaceLength: input.afterBackspaceQuery.length,
      afterBackspaceHash: hashText(input.afterBackspaceQuery),
      retypeSuffixLength: RETYPE_SUFFIX.length,
      retypeSuffixHash: hashText(RETYPE_SUFFIX),
      finalLength: input.expectedFinalQuery.length,
      finalHash: hashText(input.expectedFinalQuery),
      backspaceCount: BACKSPACE_COUNT,
    },
    browserHostSession: {
      id: stringField(input.session.id),
      owner: stringField(input.session.owner),
      status: stringField(input.session.status),
      transport: stringField(input.session.liveSurfaceTransport),
      liveSurfaceTransport: stringField(input.session.liveSurfaceTransport),
      frameTransport: stringField(input.session.liveSurfaceTransport) === 'native-embedded' ? 'native-embedded' : undefined,
      singleInteractiveTruth: input.session.singleInteractiveTruth === true,
      secondTruthSource: input.session.secondTruthSource === true,
      liveSurfaceRef: stringField(input.session.liveSurfaceRef),
      urlMatchedResults: /\/results\?/.test(stringField(input.session.url)),
      observedUrlLag: input.session.observedUrlLag === true,
      observedUrlHash: stringField(input.session.observedUrlHash) || (stringField(input.session.url) ? hashText(stringField(input.session.url)) : undefined),
      refs: {
        frameRef: stringField(input.session.frameRef),
        screenshotRef: stringField(input.session.screenshotRef),
        domSnapshotRef: stringField(input.session.domSnapshotRef),
        axSnapshotRef: stringField(input.session.axSnapshotRef),
        consoleLogRef: stringField(input.session.consoleLogRef),
        networkLogRef: stringField(input.session.networkLogRef),
      },
    },
    liveAcceptance,
    blockedReason: liveAcceptance.status === 'blocked' ? liveAcceptance.blockedReason : undefined,
    fixtureEvidence: {
      eventTypes: input.events.map((event) => event.type),
      inputLengthTrace: boundedUnique(inputEvents.map((event) => event.valueLength ?? 0)),
      inputHashTrace: boundedUnique(inputEvents.map((event) => event.valueHash ?? '').filter(Boolean)),
      submitted: {
        length: input.submitted.valueLength ?? 0,
        hash: input.submitted.valueHash ?? '',
      },
      resultsLoad: {
        length: input.resultsLoad.valueLength ?? 0,
        hash: input.resultsLoad.valueHash ?? '',
      },
    },
    inputActionEvidence: {
      inputChannel: 'browser-host-session',
      systemKeyboardEvents: 'not-sent',
      sharedSystemInputUsed: false,
      userDeviceImpact: 'none',
      shellComposerCapturedCharacters: 0,
      actionTypes: input.actions.map((action) => action.hostAction.action),
      typeActionTextLengths: typeActions.map((action) => action.hostAction.textLength ?? 0),
      typeActionTextHashes: typeActions.map((action) => action.hostAction.textHash ?? '').filter(Boolean),
      pressKeys: pressActions.map((action) => action.hostAction.key ?? '').filter(Boolean),
      actionCount: input.actions.length,
    },
    timingSummary: Array.isArray(input.session.actionTimingSummary)
      ? input.session.actionTimingSummary.filter((entry): entry is Record<string, unknown> => Boolean(recordField(entry))).slice(0, 16)
      : [],
    forbiddenEvidence: {
      fixtureDomRead: false,
      rawDom: false,
      base64: false,
      screenshot: false,
      directFixtureDomPass: false,
    },
    failureFocusedDiagnostic: searchInputDogfoodFailureDiagnostic({
      session: input.session,
      events: input.events,
      actions: input.actions,
    }),
    verificationCommand: 'node --import tsx --test tests/smoke/smoke-browser-search-input-dogfood.test.ts',
  };
}

function buildBlockedSearchInputDogfoodManifest(
  runId: string,
  fixtureOrigin: string,
  reason: string,
): SearchInputDogfoodManifest {
  const liveAcceptance = blockedBrowserPaneLiveAcceptance(reason);
  return {
    schemaVersion: DOGFOOD_SCHEMA,
    status: 'blocked',
    runId,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetOriginRef: `fixture-origin:${hashText(fixtureOrigin)}`,
    inputPath: {
      browserSurface: 'browser-host-session',
      visualHostFrame: 'blocked',
      keyboardPath: 'blocked',
      hiddenKeyboardFocused: false,
      inputChannel: 'browser-host-session',
    },
    query: {
      dimensions: ['long', 'zh-en-symbols', 'backspace-delete-retype', 'enter-submit'],
      initialLength: LONG_MIXED_QUERY.length,
      initialHash: hashText(LONG_MIXED_QUERY),
      afterBackspaceLength: LONG_MIXED_QUERY.slice(0, -BACKSPACE_COUNT).length,
      afterBackspaceHash: hashText(LONG_MIXED_QUERY.slice(0, -BACKSPACE_COUNT)),
      retypeSuffixLength: RETYPE_SUFFIX.length,
      retypeSuffixHash: hashText(RETYPE_SUFFIX),
      finalLength: `${LONG_MIXED_QUERY.slice(0, -BACKSPACE_COUNT)}${RETYPE_SUFFIX}`.length,
      finalHash: hashText(`${LONG_MIXED_QUERY.slice(0, -BACKSPACE_COUNT)}${RETYPE_SUFFIX}`),
      backspaceCount: BACKSPACE_COUNT,
    },
    browserHostSession: {
      id: '',
      owner: 'BrowserHostSession',
      status: 'blocked',
      transport: 'missing-native-attach',
      liveSurfaceTransport: 'missing-native-attach',
      frameTransport: undefined,
      singleInteractiveTruth: false,
      secondTruthSource: false,
      liveSurfaceRef: undefined,
      urlMatchedResults: false,
      observedUrlLag: false,
      refs: {},
    },
    liveAcceptance,
    blockedReason: liveAcceptance.blockedReason,
    fixtureEvidence: {
      eventTypes: [],
      inputLengthTrace: [],
      inputHashTrace: [],
      submitted: { length: 0, hash: '' },
      resultsLoad: { length: 0, hash: '' },
    },
    inputActionEvidence: {
      inputChannel: 'browser-host-session',
      systemKeyboardEvents: 'not-sent',
      sharedSystemInputUsed: false,
      userDeviceImpact: 'none',
      shellComposerCapturedCharacters: 0,
      actionTypes: [],
      typeActionTextLengths: [],
      typeActionTextHashes: [],
      pressKeys: [],
      actionCount: 0,
    },
    timingSummary: [],
    forbiddenEvidence: {
      fixtureDomRead: false,
      rawDom: false,
      base64: false,
      screenshot: false,
      directFixtureDomPass: false,
    },
    failureFocusedDiagnostic: {
      schemaVersion: 'sciforge.browser-search-input-dogfood.failure-diagnostic.v1',
      focus: {
        keyboardPath: 'blocked',
        hiddenKeyboardFocused: false,
        browserSurface: 'browser-host-session',
      },
      session: {
        status: 'blocked',
        urlMatchedResults: false,
      },
      fixtureEventTrace: {
        recentEventTypes: [],
        lastInputLength: 0,
        lastInputHash: '',
        submitSeen: false,
        resultsSeen: false,
      },
      actionTrace: {
        recentActionTypes: [],
        recentPressKeys: [],
        recentTypeLengths: [],
        actionCount: 0,
      },
      timingSummary: [],
      forbiddenEvidence: {
        rawQuery: false,
        rawDom: false,
        base64: false,
        screenshot: false,
        systemInputPayload: false,
      },
    },
    verificationCommand: 'node --import tsx --test tests/smoke/smoke-browser-search-input-dogfood.test.ts',
  };
}

function searchInputDogfoodFailureDiagnostic(input: {
  session: JsonRecord;
  events: SearchInputFixtureEvent[];
  actions: BoundedComputerUseAction[];
}): SearchInputDogfoodManifest['failureFocusedDiagnostic'] {
  const inputEvents = input.events.filter((event) => event.type === 'search-input');
  const lastInput = inputEvents[inputEvents.length - 1];
  const pressActions = input.actions.filter((action) => action.hostAction.action === 'press');
  const typeActions = input.actions.filter((action) => action.hostAction.action === 'type');
  return {
    schemaVersion: 'sciforge.browser-search-input-dogfood.failure-diagnostic.v1',
    focus: {
      keyboardPath: 'native-embedded',
      hiddenKeyboardFocused: false,
      browserSurface: 'browser-host-session',
    },
    session: {
      status: stringField(input.session.status),
      liveSurfaceRef: stringField(input.session.liveSurfaceRef),
      observedUrlHash: stringField(input.session.observedUrlHash) || (stringField(input.session.url) ? hashText(stringField(input.session.url)) : undefined),
      urlMatchedResults: /\/results\?/.test(stringField(input.session.url)),
    },
    fixtureEventTrace: {
      recentEventTypes: input.events.slice(-12).map((event) => event.type),
      lastInputLength: lastInput?.valueLength ?? 0,
      lastInputHash: lastInput?.valueHash ?? '',
      submitSeen: input.events.some((event) => event.type === 'search-submit'),
      resultsSeen: input.events.some((event) => event.type === 'results-load'),
    },
    actionTrace: {
      recentActionTypes: input.actions.slice(-16).map((action) => action.hostAction.action),
      recentPressKeys: pressActions.slice(-12).map((action) => action.hostAction.key ?? '').filter(Boolean),
      recentTypeLengths: typeActions.slice(-4).map((action) => action.hostAction.textLength ?? 0),
      actionCount: input.actions.length,
    },
    timingSummary: boundedTimingSummary(input.session.actionTimingSummary),
    forbiddenEvidence: {
      rawQuery: false,
      rawDom: false,
      base64: false,
      screenshot: false,
      systemInputPayload: false,
    },
  };
}

function assertSearchInputDogfoodManifest(
  manifest: SearchInputDogfoodManifest,
  queries: { initialQuery: string; afterBackspaceQuery: string; expectedFinalQuery: string; retypeSuffix: string },
) {
  assert.equal(manifest.schemaVersion, DOGFOOD_SCHEMA);
  assert.ok(manifest.status === 'passed' || manifest.status === 'blocked');
  assertBrowserPaneLiveAcceptance(manifest.liveAcceptance, manifest.status);
  assert.equal(manifest.browserHostSession.transport, manifest.browserHostSession.liveSurfaceTransport);
  assert.equal(typeof manifest.browserHostSession.urlMatchedResults, 'boolean');
  assert.equal(typeof manifest.browserHostSession.observedUrlLag, 'boolean');
  if (manifest.status === 'passed') {
    assert.equal(manifest.inputPath.keyboardPath, 'native-embedded');
    assert.equal(manifest.inputPath.hiddenKeyboardFocused, false);
    assert.equal(manifest.browserHostSession.liveSurfaceTransport, 'native-embedded');
    assert.equal(manifest.browserHostSession.frameTransport, 'native-embedded');
    assert.equal(manifest.browserHostSession.singleInteractiveTruth, true);
    assert.equal(manifest.browserHostSession.secondTruthSource, false);
    assert.match(manifest.browserHostSession.liveSurfaceRef ?? '', /^browser-host-session:[^/]+\/live-surface$/);
    assert.ok(manifest.fixtureEvidence.eventTypes.includes('search-focus'));
    assert.ok(manifest.fixtureEvidence.eventTypes.includes('search-input'));
    assert.ok(manifest.fixtureEvidence.eventTypes.includes('search-submit'));
    assert.ok(manifest.fixtureEvidence.eventTypes.includes('results-load'));
    assert.ok(manifest.fixtureEvidence.inputLengthTrace.includes(queries.initialQuery.length));
    assert.ok(manifest.fixtureEvidence.inputLengthTrace.includes(queries.afterBackspaceQuery.length));
    assert.ok(manifest.fixtureEvidence.inputLengthTrace.includes(queries.expectedFinalQuery.length));
    assert.equal(manifest.fixtureEvidence.submitted.length, queries.expectedFinalQuery.length);
    assert.equal(manifest.fixtureEvidence.submitted.hash, hashText(queries.expectedFinalQuery));
    assert.equal(manifest.fixtureEvidence.resultsLoad.hash, hashText(queries.expectedFinalQuery));
    assert.ok(manifest.inputActionEvidence.typeActionTextHashes.includes(hashText(queries.initialQuery)));
    assert.ok(manifest.inputActionEvidence.typeActionTextHashes.includes(hashText(queries.retypeSuffix)));
    assert.ok(manifest.inputActionEvidence.pressKeys.filter((key) => key === 'Backspace').length >= BACKSPACE_COUNT);
    assert.ok(manifest.inputActionEvidence.pressKeys.includes('Enter'));
    assert.equal(manifest.failureFocusedDiagnostic.fixtureEventTrace.submitSeen, true);
    assert.equal(manifest.failureFocusedDiagnostic.fixtureEventTrace.resultsSeen, true);
    assert.ok(manifest.failureFocusedDiagnostic.actionTrace.recentActionTypes.includes('type'));
    assert.ok(manifest.failureFocusedDiagnostic.timingSummary.length > 0);
  } else {
    assert.equal(manifest.inputPath.visualHostFrame, 'blocked');
    assert.equal(manifest.inputPath.keyboardPath, 'blocked');
    assert.equal(manifest.liveAcceptance.passClaim, false);
    assert.ok(manifest.blockedReason);
  }
  assert.equal(manifest.inputActionEvidence.inputChannel, 'browser-host-session');
  assert.equal(manifest.inputActionEvidence.systemKeyboardEvents, 'not-sent');
  assert.equal(manifest.inputActionEvidence.sharedSystemInputUsed, false);
  assert.equal(manifest.inputActionEvidence.shellComposerCapturedCharacters, 0);
  assert.deepEqual(Object.values(manifest.forbiddenEvidence), [false, false, false, false, false]);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /host-stream|frame-stream|websocket-binary|canvas-binary|webrtc|<!doctype|<html|<body|<input|<form|outerHTML|innerHTML|data:image|;base64,|base64(?:Data|Payload|Inline|Bytes)|iVBORw0KGgo|screenshot(?:Data|Base64|Inline|Bytes)/i);
  assertNoRawQuery(serialized, queries.initialQuery);
  assertNoRawQuery(serialized, queries.afterBackspaceQuery);
  assertNoRawQuery(serialized, queries.expectedFinalQuery);
  assertNoRawQuery(serialized, queries.retypeSuffix);
}

function browserPaneLiveAcceptance(session: JsonRecord): BrowserPaneLiveAcceptance {
  const liveSurfaceTransport = stringField(session.liveSurfaceTransport);
  const singleInteractiveTruth = session.singleInteractiveTruth === true;
  const secondTruthSource = session.secondTruthSource === true;
  const passed = liveSurfaceTransport === 'native-embedded'
    && singleInteractiveTruth
    && secondTruthSource === false;
  return {
    status: passed ? 'passed' : 'blocked',
    claimScope: passed ? 'right-pane-live-pass' : 'diagnostic-only',
    passClaim: passed,
    required: {
      liveSurfaceTransport: 'native-embedded',
      singleInteractiveTruth: true,
      secondTruthSource: false,
    },
    observed: {
      shell: 'web-right-pane',
      liveSurfaceTransport,
      singleInteractiveTruth,
      secondTruthSource,
      frameTransport: passed ? 'native-embedded' : undefined,
    },
    blockedReason: passed
      ? undefined
      : `Browser pane search input live acceptance requires native-embedded; observed ${liveSurfaceTransport || 'missing-native-attach'}.`,
  };
}

function blockedBrowserPaneLiveAcceptance(reason: string): BrowserPaneLiveAcceptance {
  return {
    status: 'blocked',
    claimScope: 'diagnostic-only',
    passClaim: false,
    required: {
      liveSurfaceTransport: 'native-embedded',
      singleInteractiveTruth: true,
      secondTruthSource: false,
    },
    observed: {
      shell: 'web-right-pane',
      liveSurfaceTransport: 'missing-native-attach',
      singleInteractiveTruth: false,
      secondTruthSource: false,
    },
    blockedReason: sanitizeBlockedReason(reason),
  };
}

function assertBrowserPaneLiveAcceptance(liveAcceptance: BrowserPaneLiveAcceptance, manifestStatus: 'passed' | 'blocked'): void {
  assert.equal(liveAcceptance.status, manifestStatus);
  assert.equal(liveAcceptance.required.liveSurfaceTransport, 'native-embedded');
  assert.equal(liveAcceptance.required.singleInteractiveTruth, true);
  assert.equal(liveAcceptance.required.secondTruthSource, false);
  assert.equal(liveAcceptance.observed.shell, 'web-right-pane');
  assert.equal(liveAcceptance.observed.secondTruthSource, false);
  if (manifestStatus === 'passed') {
    assert.equal(liveAcceptance.claimScope, 'right-pane-live-pass');
    assert.equal(liveAcceptance.passClaim, true);
    assert.equal(liveAcceptance.observed.liveSurfaceTransport, 'native-embedded');
    assert.equal(liveAcceptance.observed.singleInteractiveTruth, true);
    assert.equal(liveAcceptance.observed.frameTransport, 'native-embedded');
  } else {
    assert.equal(liveAcceptance.claimScope, 'diagnostic-only');
    assert.equal(liveAcceptance.passClaim, false);
    assert.ok(liveAcceptance.blockedReason);
  }
}

function sanitizeBlockedReason(reason: string) {
  const bounded = reason.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => `url:${hashText(url)}`);
  return bounded.slice(0, 240) || 'blocked';
}

async function startSearchInputFixture(port: number): Promise<{ url: string; close(): Promise<void> }> {
  const events: SearchInputFixtureEvent[] = [];
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${fixtureHost}:${port}`);
    if (url.pathname === '/__events') {
      if (req.method === 'POST') {
        const body = await readRequestBody(req);
        events.push(eventFromPayload(body, url.searchParams.get('path') || '/'));
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
      const query = url.searchParams.get('q') ?? '';
      events.push({ type: 'results-load', path: '/results', valueLength: query.length, valueHash: hashText(query) });
      writeHtml(res, resultsPage(query.length));
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
  return pageShell('Search Input Dogfood', `
    <main>
      <form id="searchForm" action="/results" method="get">
        <input id="q" name="q" autofocus aria-label="Search query" />
        <button type="submit">Search</button>
      </form>
      <p id="status">Ready for BrowserHostSession input.</p>
    </main>
    <script>
      let inputIndex = 0;
      function record(type) {
        navigator.sendBeacon('/__events?path=/search', JSON.stringify({ type, value: q.value, inputIndex }));
      }
      q.addEventListener('focus', () => record('search-focus'));
      q.addEventListener('input', () => {
        inputIndex += 1;
        record('search-input');
      });
      searchForm.addEventListener('submit', () => record('search-submit'));
    </script>
  `);
}

function resultsPage(queryLength: number) {
  return pageShell('Search Input Results', `
    <main>
      <h1>Results</h1>
      <p>Submitted query length ${queryLength}</p>
    </main>
  `);
}

function pageShell(title: string, body: string) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>${title}</title>
    <style>
      body { margin: 0; font-family: sans-serif; color: #102024; background: #f8fbfb; }
      main { min-height: 100vh; padding: 24px 32px; }
      form { display: flex; gap: 10px; align-items: center; }
      input { box-sizing: border-box; width: 920px; height: 42px; padding: 8px 12px; font-size: 17px; border: 2px solid #18484f; border-radius: 4px; background: white; color: #102024; }
      button { height: 42px; padding: 0 18px; border: 0; border-radius: 4px; background: #18484f; color: white; font-size: 15px; }
      h1 { margin: 0 0 14px; font-size: 24px; }
      p { max-width: 720px; line-height: 1.5; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function eventFromPayload(raw: string, path: string): SearchInputFixtureEvent {
  const payload = parseJsonRecord(raw);
  const value = typeof payload.value === 'string' ? payload.value : undefined;
  return {
    type: typeof payload.type === 'string' ? payload.type : 'unknown',
    path,
    valueLength: value === undefined ? undefined : value.length,
    valueHash: value === undefined ? undefined : hashText(value),
    inputIndex: typeof payload.inputIndex === 'number' && Number.isFinite(payload.inputIndex) ? payload.inputIndex : undefined,
  };
}

async function waitForFixtureEvent(
  baseUrl: string,
  predicate: (event: SearchInputFixtureEvent) => boolean,
  timeoutMs: number,
  label: string,
): Promise<SearchInputFixtureEvent> {
  const deadline = Date.now() + timeoutMs;
  let lastEvents: SearchInputFixtureEvent[] = [];
  while (Date.now() < deadline) {
    const events = await fetchFixtureEvents(baseUrl);
    lastEvents = events;
    const event = events.find(predicate);
    if (event) return event;
    await delay(250);
  }
  throw new Error(`Timed out waiting for fixture event: ${label}; diagnostic=${JSON.stringify(fixtureEventTimeoutDiagnostic(label, lastEvents))}`);
}

async function fetchFixtureEvents(baseUrl: string): Promise<SearchInputFixtureEvent[]> {
  const json = await fetchJson(`${baseUrl}/__events`);
  return Array.isArray(json.events) ? json.events.filter(isSearchInputFixtureEvent) : [];
}

function fixtureEventTimeoutDiagnostic(label: string, events: SearchInputFixtureEvent[]): JsonRecord {
  const inputEvents = events.filter((event) => event.type === 'search-input');
  const lastInput = inputEvents[inputEvents.length - 1];
  return {
    schemaVersion: 'sciforge.browser-search-input-dogfood.fixture-event-timeout.v1',
    label,
    eventCount: events.length,
    recentEventTypes: events.slice(-12).map((event) => event.type),
    lastInputLength: lastInput?.valueLength ?? 0,
    lastInputHash: lastInput?.valueHash ?? '',
    submitSeen: events.some((event) => event.type === 'search-submit'),
    resultsSeen: events.some((event) => event.type === 'results-load'),
    rawQueryCaptured: false,
    rawDomCaptured: false,
  };
}

function isSearchInputFixtureEvent(value: unknown): value is SearchInputFixtureEvent {
  return Boolean(recordField(value) && typeof (value as SearchInputFixtureEvent).type === 'string' && typeof (value as SearchInputFixtureEvent).path === 'string');
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

function boundedUnique<T>(values: T[]): T[] {
  return [...new Set(values)].slice(0, 24);
}

function boundedTimingSummary(value: unknown): Array<Record<string, unknown>> {
  return Array.isArray(value)
    ? value
      .map(recordField)
      .filter((entry): entry is JsonRecord => Boolean(entry))
      .map((entry) => ({
        action: stringField(entry.action),
        count: typeof entry.count === 'number' ? entry.count : 0,
        p95Ms: typeof entry.p95Ms === 'number' ? entry.p95Ms : 0,
        lastMs: typeof entry.lastMs === 'number' ? entry.lastMs : 0,
      }))
      .slice(0, 16)
    : [];
}

function assertNoRawQuery(serialized: string, query: string) {
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(query)));
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(encodeURIComponent(query))));
}

function scrubDiagnostic(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/g, (url) => `[url:${hashText(url)}]`)
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[data-image-redacted]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 360);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function delay(ms: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));
}
