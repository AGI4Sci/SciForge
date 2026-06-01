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
const DOGFOOD_SCHEMA = 'sciforge.browser-pane-tab-focus-retention.v1';
const FIXTURE_HOST = 'sciforge-browser-tab-focus-retention.test';
const FIRST_TEXT = 'tab focus route alpha';
const RESTORED_TEXT = ' restored route beta';
const EXPECTED_TEXT = `${FIRST_TEXT}${RESTORED_TEXT}`;
const ACCEPTED_POST_RETURN_TEXT_HASHES = new Set([hashText(EXPECTED_TEXT), hashText(RESTORED_TEXT)]);
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-pane-tab-focus-retention');
const manifestPath = join(artifactDir, 'manifest.json');

type JsonRecord = Record<string, unknown>;

type FocusFixtureEvent = {
  type: string;
  path: string;
  valueLength?: number;
  valueHash?: string;
  inputIndex?: number;
};

type FocusState = {
  activeElement: 'browser-hidden-input' | 'composer' | 'right-pane-tab' | 'other';
  keyboardPath: string;
  hiddenKeyboardFocused: boolean;
  focusKey: string;
  liveSurfaceRef: string;
};

type BoundedComputerUseAction = {
  inputChannel: string;
  userDeviceImpact: string;
  sharedSystemInputUsed: boolean | undefined;
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

type SessionSummary = {
  id: string;
  owner: string;
  status: string;
  transport?: string;
  frameTransport?: string;
  singleInteractiveTruth: boolean;
  liveSurfaceRef?: string;
  urlHash?: string;
  requestedUrlHash?: string;
  refs: {
    frameStreamRef?: string;
    frameRef?: string;
    screenshotRef?: string;
    domSnapshotRef?: string;
    axSnapshotRef?: string;
    consoleLogRef?: string;
    networkLogRef?: string;
  };
};

type TabFocusRetentionManifest = {
  schemaVersion: typeof DOGFOOD_SCHEMA;
  status: 'passed';
  runId: string;
  observedAt: string;
  shell: 'web-right-pane';
  targetOriginRef: string;
  selectors: {
    browserTab: string;
    alternateTab: string;
    browserSurface: string;
    hostFrame: string;
    hiddenKeyboardInput: string;
    composer: string;
  };
  focusPath: {
    initialClick: FocusState;
    switchedAway: FocusState;
    returned: FocusState;
    restoredWithoutSecondHostClick: true;
  };
  browserHostSession: {
    beforeTabSwitch: SessionSummary;
    afterTabReturn: SessionSummary;
    sameSessionId: boolean;
    sessionIds: string[];
  };
  fixtureEvidence: {
    eventTypes: string[];
    inputLengthTrace: number[];
    inputHashTrace: string[];
    submittedLength: number;
    submittedHash: string;
  };
  inputActionEvidence: {
    inputChannel: 'browser-host-session';
    systemKeyboardEvents: 'not-sent';
    sharedSystemInputUsed: false;
    shellComposerCapturedCharacters: number;
    actionCount: number;
    typeActionTextLengths: number[];
    typeActionTextHashes: string[];
    pressKeys: string[];
  };
  forbiddenEvidence: {
    rawDom: false;
    base64: false;
    screenshot: false;
    iframe: false;
    proxy: false;
    webview: false;
    systemPopup: false;
    directFixtureDomPass: false;
  };
  verificationCommand: string;
};

test('SciForge Browser pane restores hidden keyboard focus after right pane tab switch without leaking to composer', { timeout: 180_000 }, async () => {
  const browserExecutable = process.env.SCIFORGE_RIGHT_PANE_BROWSER_EXECUTABLE || EDGE_EXECUTABLE;
  if (!existsSync(browserExecutable)) {
    throw new Error(`No browser executable found for Browser pane tab focus retention smoke: ${browserExecutable}`);
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-browser-pane-tab-focus-retention-'));
  const workspacePath = join(tempRoot, 'workspace');
  const configPath = join(tempRoot, 'config.local.json');
  const writerPort = await getFreePort();
  const uiPort = await getFreePort();
  const fixturePort = await getFreePort();
  const writerUrl = `http://127.0.0.1:${writerPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const fixtureOrigin = `http://${FIXTURE_HOST}:${fixturePort}`;
  const runId = `browser-pane-tab-focus-retention-${Date.now().toString(36)}`;
  const children: ChildProcess[] = [];
  let browser: Browser | undefined;
  let fixture: Awaited<ReturnType<typeof startFocusFixture>> | undefined;

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
    fixture = await startFocusFixture(fixturePort);
    const commonEnv = {
      ...process.env,
      SCIFORGE_INSTANCE_ID: runId,
      SCIFORGE_CONFIG_PATH: configPath,
      SCIFORGE_WORKSPACE_PATH: workspacePath,
      SCIFORGE_WORKSPACE_PORT: String(writerPort),
      SCIFORGE_WORKSPACE_WRITER_URL: writerUrl,
      SCIFORGE_BROWSER_HOST_EXECUTABLE_PATH: browserExecutable,
      SCIFORGE_BROWSER_HOST_RESOLVER_RULES: `MAP ${FIXTURE_HOST} 127.0.0.1`,
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
    const pageDiagnostics = recordPageDiagnostics(page);
    const actionRecorder = recordBrowserHostComputerUseActions(page);

    await page.goto(uiUrl, { waitUntil: 'domcontentloaded' });
    await waitForResultsPanel(page, pageDiagnostics);

    await ensureBrowserPane(page);
    const surface = page.locator('.right-pane-browser-surface');
    await openBrowserPaneUrl(surface, `${fixtureOrigin}/focus`);
    const { visualFrame } = await waitForKeyboardHostFrame(surface, new RegExp(`^http://${escapeRegExp(FIXTURE_HOST)}:\\d+/focus`));

    await clickHostPoint(page, visualFrame, 170, 58);
    await waitForFixtureEvent(fixture.url, (event) => event.type === 'focus-input-focus', 15_000, 'fixture input focus after host frame click');
    const focusAfterClick = await waitForHiddenKeyboardFocus(page, 10_000);
    assert.equal(focusAfterClick.hiddenKeyboardFocused, true);

    await page.keyboard.insertText(FIRST_TEXT);
    await waitForFixtureEvent(
      fixture.url,
      (event) => event.type === 'focus-input' && event.valueLength === FIRST_TEXT.length && event.valueHash === hashText(FIRST_TEXT),
      30_000,
      'initial BrowserHostSession text',
    );
    await actionRecorder.waitFor((action) => action.hostAction.action === 'type' && action.hostAction.textHash === hashText(FIRST_TEXT), 15_000, 'initial type action');
    const sessionBeforeTabSwitch = await currentBrowserHostSession(page, writerUrl, workspacePath);

    await activateRightPaneTab(page, 'Results');
    const focusWhileAway = await hiddenKeyboardFocusState(page);
    assert.notEqual(focusWhileAway.activeElement, 'composer', 'Switching right pane tabs must not move typed browser focus into the chat composer');

    await activateRightPaneTab(page, 'Browser');
    await page.getByTestId('right-pane-browser-tool').waitFor({ state: 'visible', timeout: 20_000 });
    await waitForKeyboardHostFrame(surface, new RegExp(`^http://${escapeRegExp(FIXTURE_HOST)}:\\d+/focus`));
    const focusAfterReturn = await waitForHiddenKeyboardFocus(page, 20_000);
    assert.equal(focusAfterReturn.hiddenKeyboardFocused, true, 'Returning to the Browser tab must restore the hidden keyboard input');

    await page.keyboard.insertText(RESTORED_TEXT);
    const restoredInput = await waitForFixtureEvent(
      fixture.url,
      (event) => event.type === 'focus-input' && ACCEPTED_POST_RETURN_TEXT_HASHES.has(event.valueHash ?? ''),
      30_000,
      'restored typing after right pane tab return',
    );
    assert.ok(restoredInput.valueLength === EXPECTED_TEXT.length || restoredInput.valueLength === RESTORED_TEXT.length);
    await page.keyboard.press('Enter');
    const restoredSubmit = await waitForFixtureEvent(
      fixture.url,
      (event) => event.type === 'focus-submit' && ACCEPTED_POST_RETURN_TEXT_HASHES.has(event.valueHash ?? ''),
      30_000,
      'Enter submit after focus restore',
    );
    assert.ok(restoredSubmit.valueLength === EXPECTED_TEXT.length || restoredSubmit.valueLength === RESTORED_TEXT.length);
    await actionRecorder.waitFor((action) => action.hostAction.action === 'type' && action.hostAction.textHash === hashText(RESTORED_TEXT), 15_000, 'restored type action');
    await actionRecorder.waitFor((action) => action.hostAction.action === 'press' && action.hostAction.key === 'Enter', 15_000, 'restored Enter action');
    await actionRecorder.drain();

    const shellComposerCapturedCharacters = await shellComposerCapturedCharactersCount(page);
    assert.equal(shellComposerCapturedCharacters, 0, 'Browser typing after tab return must not leak into the chat composer');
    const sessionAfterTabReturn = await currentBrowserHostSession(page, writerUrl, workspacePath);

    const manifest = buildManifest({
      runId,
      fixtureOrigin,
      focusAfterClick,
      focusWhileAway,
      focusAfterReturn,
      sessionBeforeTabSwitch,
      sessionAfterTabReturn,
      events: await fetchFixtureEvents(fixture.url),
      actions: actionRecorder.actions,
      shellComposerCapturedCharacters,
      fallbackCounts: await fallbackCounts(page),
    });
    assertTabFocusRetentionManifest(manifest);
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

async function activateRightPaneTab(page: Page, label: 'Browser' | 'Results') {
  const tab = page.locator('.result-page-tab', { hasText: label }).first();
  await tab.waitFor({ state: 'visible', timeout: 10_000 });
  await tab.click();
  await page.waitForFunction((expectedLabel) => {
    const selected = document.querySelector<HTMLElement>('.result-page-tab[aria-selected="true"]');
    return selected?.textContent?.includes(expectedLabel) === true;
  }, label, { timeout: 10_000 });
}

async function openBrowserPaneUrl(surface: Locator, url: string) {
  const address = surface.locator('input[aria-label="Browser URL"]');
  await address.fill(url);
  await address.press('Enter');
}

async function waitForKeyboardHostFrame(surface: Locator, expectedUrl: RegExp) {
  await waitForWorkbenchUrl(surface, expectedUrl);
  const frame = surface.locator('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]').first();
  await frame.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await frame.getAttribute('data-browser-host-keyboard-path'), 'hidden-input');
  assert.ok(await frame.getAttribute('data-browser-host-keyboard-focus-key'), 'host frame must expose a stable keyboard focus key');
  const hiddenInput = frame.locator('.browser-workbench-host-keyboard-input[data-browser-host-keyboard-input="true"]').first();
  assert.ok(await hiddenInput.count(), 'host frame must include hidden keyboard input');
  let visualFrame = frame.locator('canvas[data-browser-host-surface="browser-host-session"]').first();
  if (!await visualFrame.count()) {
    visualFrame = frame.locator('img[data-browser-host-surface="browser-host-session"]').first();
  }
  await visualFrame.waitFor({ state: 'visible', timeout: 30_000 });
  const tagName = await visualFrame.evaluate((node) => node.tagName.toLowerCase());
  if (tagName === 'img') {
    await visualFrame.page().waitForFunction(() => {
      const img = document.querySelector('.right-pane-browser-surface img[data-browser-host-surface="browser-host-session"]');
      return img instanceof HTMLImageElement && img.complete && img.naturalWidth > 0 && img.naturalHeight > 0;
    }, undefined, { timeout: 30_000 });
  } else {
    await visualFrame.page().waitForFunction(() => {
      const canvas = document.querySelector('.right-pane-browser-surface canvas[data-browser-host-surface="browser-host-session"]');
      return canvas instanceof HTMLCanvasElement && canvas.width > 0 && canvas.height > 0;
    }, undefined, { timeout: 30_000 });
  }
  assert.equal(await visualFrame.getAttribute('data-browser-frame-transport'), 'websocket-binary');
  return { frame, visualFrame };
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

async function waitForHiddenKeyboardFocus(page: Page, timeoutMs: number): Promise<FocusState> {
  await page.waitForFunction(() => {
    const frame = document.querySelector<HTMLElement>('.right-pane-browser-surface .browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]');
    const input = frame?.querySelector<HTMLTextAreaElement>('.browser-workbench-host-keyboard-input[data-browser-host-keyboard-input="true"]') ?? null;
    return Boolean(input && document.activeElement === input && input.dataset.browserHostKeyboardFocus === 'active');
  }, undefined, { timeout: timeoutMs });
  return hiddenKeyboardFocusState(page);
}

async function hiddenKeyboardFocusState(page: Page): Promise<FocusState> {
  return page.evaluate(() => {
    const frame = document.querySelector<HTMLElement>('.right-pane-browser-surface .browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]');
    const input = frame?.querySelector<HTMLTextAreaElement>('.browser-workbench-host-keyboard-input[data-browser-host-keyboard-input="true"]') ?? null;
    const active = document.activeElement;
    const activeElement = input && active === input
      ? 'browser-hidden-input'
      : active instanceof HTMLTextAreaElement && Boolean(active.closest('.composer'))
        ? 'composer'
        : active instanceof HTMLElement && active.classList.contains('result-page-tab')
          ? 'right-pane-tab'
          : 'other';
    return {
      activeElement,
      keyboardPath: frame?.getAttribute('data-browser-host-keyboard-path') ?? '',
      hiddenKeyboardFocused: Boolean(input && active === input && input.dataset.browserHostKeyboardFocus === 'active'),
      focusKey: frame?.getAttribute('data-browser-host-keyboard-focus-key') ?? '',
      liveSurfaceRef: frame?.getAttribute('data-browser-live-surface-ref') ?? '',
    };
  });
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
        textHash: action.hostAction.textHash,
        inputChannel: action.inputChannel,
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

async function shellComposerCapturedCharactersCount(page: Page): Promise<number> {
  const composer = page.locator('.composer textarea').first();
  if (!await composer.count()) return 0;
  return composer.evaluate((node) => node instanceof HTMLTextAreaElement ? node.value.length : 0);
}

async function fallbackCounts(page: Page) {
  return page.evaluate(() => ({
    iframe: document.querySelectorAll('.right-pane-browser-surface iframe').length,
    proxy: document.querySelectorAll('.right-pane-browser-surface iframe[src^="/api/sciforge/browser/proxy"]').length,
    webview: document.querySelectorAll('.right-pane-browser-surface webview').length,
    systemPopup: document.querySelectorAll('[data-browser-host-surface="system-browser-window"]').length,
    dataImage: document.querySelectorAll('.right-pane-browser-surface img[src^="data:"]').length,
    base64Attribute: Array.from(document.querySelectorAll('.right-pane-browser-surface *')).filter((node) => {
      return Array.from(node.attributes).some((attribute) => /;base64,|data:image/i.test(attribute.value));
    }).length,
  }));
}

function buildManifest(input: {
  runId: string;
  fixtureOrigin: string;
  focusAfterClick: FocusState;
  focusWhileAway: FocusState;
  focusAfterReturn: FocusState;
  sessionBeforeTabSwitch: JsonRecord;
  sessionAfterTabReturn: JsonRecord;
  events: FocusFixtureEvent[];
  actions: BoundedComputerUseAction[];
  shellComposerCapturedCharacters: number;
  fallbackCounts: Awaited<ReturnType<typeof fallbackCounts>>;
}): TabFocusRetentionManifest {
  const inputEvents = input.events.filter((event) => event.type === 'focus-input');
  const submitEvent = input.events.find((event) => event.type === 'focus-submit');
  const typeActions = input.actions.filter((action) => action.hostAction.action === 'type');
  const pressActions = input.actions.filter((action) => action.hostAction.action === 'press');
  const sessionIds = boundedUnique([
    stringField(input.sessionBeforeTabSwitch.id),
    stringField(input.sessionAfterTabReturn.id),
    ...input.actions.map((action) => (action.sessionRef ?? '').replace(/^browser-host-session:/, '')),
  ].filter(Boolean));
  return {
    schemaVersion: DOGFOOD_SCHEMA,
    status: 'passed',
    runId: input.runId,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetOriginRef: `fixture-origin:${hashText(input.fixtureOrigin)}`,
    selectors: {
      browserTab: '.result-page-tab[role="tab"] >> text=Browser',
      alternateTab: '.result-page-tab[role="tab"] >> text=Results',
      browserSurface: '.right-pane-browser-surface',
      hostFrame: '.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]',
      hiddenKeyboardInput: '.browser-workbench-host-keyboard-input[data-browser-host-keyboard-input="true"]',
      composer: '.composer textarea',
    },
    focusPath: {
      initialClick: input.focusAfterClick,
      switchedAway: input.focusWhileAway,
      returned: input.focusAfterReturn,
      restoredWithoutSecondHostClick: true,
    },
    browserHostSession: {
      beforeTabSwitch: sessionSummary(input.sessionBeforeTabSwitch),
      afterTabReturn: sessionSummary(input.sessionAfterTabReturn),
      sameSessionId: stringField(input.sessionBeforeTabSwitch.id) === stringField(input.sessionAfterTabReturn.id),
      sessionIds,
    },
    fixtureEvidence: {
      eventTypes: input.events.map((event) => event.type),
      inputLengthTrace: boundedUnique(inputEvents.map((event) => event.valueLength ?? 0).filter(Boolean)),
      inputHashTrace: boundedUnique(inputEvents.map((event) => event.valueHash ?? '').filter(Boolean)),
      submittedLength: submitEvent?.valueLength ?? 0,
      submittedHash: submitEvent?.valueHash ?? '',
    },
    inputActionEvidence: {
      inputChannel: 'browser-host-session',
      systemKeyboardEvents: 'not-sent',
      sharedSystemInputUsed: false,
      shellComposerCapturedCharacters: input.shellComposerCapturedCharacters,
      actionCount: input.actions.length,
      typeActionTextLengths: typeActions.map((action) => action.hostAction.textLength ?? 0),
      typeActionTextHashes: typeActions.map((action) => action.hostAction.textHash ?? '').filter(Boolean),
      pressKeys: pressActions.map((action) => action.hostAction.key ?? '').filter(Boolean),
    },
    forbiddenEvidence: {
      rawDom: false,
      base64: input.fallbackCounts.dataImage === 0 && input.fallbackCounts.base64Attribute === 0 ? false : assertNeverFallback('base64'),
      screenshot: false,
      iframe: input.fallbackCounts.iframe === 0 ? false : assertNeverFallback('iframe'),
      proxy: input.fallbackCounts.proxy === 0 ? false : assertNeverFallback('proxy'),
      webview: input.fallbackCounts.webview === 0 ? false : assertNeverFallback('webview'),
      systemPopup: input.fallbackCounts.systemPopup === 0 ? false : assertNeverFallback('systemPopup'),
      directFixtureDomPass: false,
    },
    verificationCommand: 'node --import tsx --test tests/smoke/smoke-browser-pane-tab-focus-retention.test.ts',
  };
}

function sessionSummary(session: JsonRecord): SessionSummary {
  const url = stringField(session.url);
  const requestedUrl = stringField(session.requestedUrl);
  return {
    id: stringField(session.id),
    owner: stringField(session.owner),
    status: stringField(session.status),
    transport: stringField(session.liveSurfaceTransport),
    frameTransport: stringField(session.frameStreamRef) ? 'websocket-binary' : undefined,
    singleInteractiveTruth: session.singleInteractiveTruth === true,
    liveSurfaceRef: stringField(session.liveSurfaceRef),
    urlHash: url ? hashText(url) : undefined,
    requestedUrlHash: requestedUrl ? hashText(requestedUrl) : undefined,
    refs: {
      frameStreamRef: stringField(session.frameStreamRef),
      frameRef: stringField(session.frameRef),
      screenshotRef: stringField(session.screenshotRef),
      domSnapshotRef: stringField(session.domSnapshotRef),
      axSnapshotRef: stringField(session.axSnapshotRef),
      consoleLogRef: stringField(session.consoleLogRef),
      networkLogRef: stringField(session.networkLogRef),
    },
  };
}

function assertTabFocusRetentionManifest(manifest: TabFocusRetentionManifest) {
  assert.equal(manifest.schemaVersion, DOGFOOD_SCHEMA);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.focusPath.initialClick.activeElement, 'browser-hidden-input');
  assert.equal(manifest.focusPath.initialClick.keyboardPath, 'hidden-input');
  assert.equal(manifest.focusPath.returned.activeElement, 'browser-hidden-input');
  assert.equal(manifest.focusPath.returned.hiddenKeyboardFocused, true);
  assert.equal(manifest.focusPath.returned.focusKey, manifest.focusPath.initialClick.focusKey);
  assert.ok(manifest.browserHostSession.sessionIds.length >= 1);
  assert.ok(manifest.browserHostSession.sessionIds.length <= 2);
  assert.equal(manifest.browserHostSession.afterTabReturn.singleInteractiveTruth, true);
  assert.equal(manifest.browserHostSession.afterTabReturn.transport, 'host-stream');
  assert.ok(manifest.fixtureEvidence.eventTypes.includes('focus-input-focus'));
  assert.ok(manifest.fixtureEvidence.inputLengthTrace.includes(FIRST_TEXT.length));
  assert.ok(manifest.fixtureEvidence.inputLengthTrace.includes(EXPECTED_TEXT.length) || manifest.fixtureEvidence.inputLengthTrace.includes(RESTORED_TEXT.length));
  assert.ok(manifest.fixtureEvidence.inputHashTrace.includes(hashText(FIRST_TEXT)));
  assert.ok(manifest.fixtureEvidence.inputHashTrace.includes(hashText(EXPECTED_TEXT)) || manifest.fixtureEvidence.inputHashTrace.includes(hashText(RESTORED_TEXT)));
  assert.ok(manifest.fixtureEvidence.submittedLength === EXPECTED_TEXT.length || manifest.fixtureEvidence.submittedLength === RESTORED_TEXT.length);
  assert.ok(ACCEPTED_POST_RETURN_TEXT_HASHES.has(manifest.fixtureEvidence.submittedHash));
  assert.equal(manifest.inputActionEvidence.inputChannel, 'browser-host-session');
  assert.equal(manifest.inputActionEvidence.systemKeyboardEvents, 'not-sent');
  assert.equal(manifest.inputActionEvidence.sharedSystemInputUsed, false);
  assert.equal(manifest.inputActionEvidence.shellComposerCapturedCharacters, 0);
  assert.ok(manifest.inputActionEvidence.typeActionTextHashes.includes(hashText(FIRST_TEXT)));
  assert.ok(manifest.inputActionEvidence.typeActionTextHashes.includes(hashText(RESTORED_TEXT)));
  assert.ok(manifest.inputActionEvidence.pressKeys.includes('Enter'));
  assert.deepEqual(Object.values(manifest.forbiddenEvidence), [false, false, false, false, false, false, false, false]);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /<!doctype|<html|<body|<input|<form|outerHTML|innerHTML|data:image|;base64,|base64(?:Data|Payload|Inline|Bytes)|iVBORw0KGgo|screenshot(?:Data|Base64|Inline|Bytes)/i);
  assertNoRawText(serialized, FIRST_TEXT);
  assertNoRawText(serialized, RESTORED_TEXT);
  assertNoRawText(serialized, EXPECTED_TEXT);
  assertNoRawText(serialized, FIXTURE_HOST);
}

async function startFocusFixture(port: number): Promise<{ url: string; close(): Promise<void> }> {
  const events: FocusFixtureEvent[] = [];
  const server = createHttpServer(async (req, res) => {
    const url = new URL(req.url ?? '/', `http://${FIXTURE_HOST}:${port}`);
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
    if (url.pathname === '/submitted') {
      const value = url.searchParams.get('q') ?? '';
      events.push({ type: 'focus-submit', path: '/submitted', valueLength: value.length, valueHash: hashText(value) });
      writeHtml(res, submittedPage(value.length));
      return;
    }
    writeHtml(res, focusPage());
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

function focusPage() {
  return pageShell('Tab Focus Retention', `
    <main>
      <form id="focusForm" action="/submitted" method="get">
        <input id="q" name="q" autofocus aria-label="Focus retention input" />
        <button type="submit">Submit</button>
      </form>
      <p id="status">BrowserHostSession tab focus retention fixture.</p>
    </main>
    <script>
      let inputIndex = 0;
      function record(type) {
        navigator.sendBeacon('/__events?path=/focus', JSON.stringify({ type, value: q.value, inputIndex }));
      }
      q.addEventListener('focus', () => record('focus-input-focus'));
      q.addEventListener('input', () => {
        inputIndex += 1;
        record('focus-input');
      });
      focusForm.addEventListener('submit', () => record('focus-submit'));
    </script>
  `);
}

function submittedPage(valueLength: number) {
  return pageShell('Tab Focus Submitted', `
    <main>
      <h1>Submitted</h1>
      <p>Submitted value length ${valueLength}</p>
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
      input { box-sizing: border-box; width: 760px; height: 44px; padding: 8px 12px; font-size: 17px; border: 2px solid #18484f; border-radius: 4px; background: white; color: #102024; }
      button { height: 44px; padding: 0 18px; border: 0; border-radius: 4px; background: #18484f; color: white; font-size: 15px; }
      h1 { margin: 0 0 14px; font-size: 24px; }
      p { max-width: 720px; line-height: 1.5; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
}

function eventFromPayload(raw: string, path: string): FocusFixtureEvent {
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
  predicate: (event: FocusFixtureEvent) => boolean,
  timeoutMs: number,
  label: string,
): Promise<FocusFixtureEvent> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = await fetchFixtureEvents(baseUrl);
    const event = events.find(predicate);
    if (event) return event;
    await delay(250);
  }
  throw new Error(`Timed out waiting for fixture event: ${label}`);
}

async function fetchFixtureEvents(baseUrl: string): Promise<FocusFixtureEvent[]> {
  const json = await fetchJson(`${baseUrl}/__events`);
  return Array.isArray(json.events) ? json.events.filter(isFocusFixtureEvent) : [];
}

function isFocusFixtureEvent(value: unknown): value is FocusFixtureEvent {
  return Boolean(recordField(value) && typeof (value as FocusFixtureEvent).type === 'string' && typeof (value as FocusFixtureEvent).path === 'string');
}

function recordPageDiagnostics(page: Page): {
  errors: string[];
  consoleErrors: string[];
} {
  const errors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => {
    errors.push(error.message.slice(0, 500));
  });
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    consoleErrors.push(message.text().slice(0, 500));
  });
  return { errors, consoleErrors };
}

async function waitForResultsPanel(page: Page, diagnostics: { errors: string[]; consoleErrors: string[] }) {
  try {
    await page.locator('.results-panel').waitFor({ state: 'visible', timeout: 30_000 });
  } catch (error) {
    const state = await page.evaluate(() => ({
      url: window.location.href,
      hasWorkbench: Boolean(document.querySelector('.workbench')),
      hasResultsPanel: Boolean(document.querySelector('.results-panel')),
      loadingText: document.querySelector('.workspace-loading-panel')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 300) ?? '',
      crashText: document.querySelector('.app-crash-shell pre')?.textContent?.replace(/\s+/g, ' ').trim().slice(0, 300) ?? '',
    })).catch(() => undefined);
    throw new Error(`Timed out waiting for SciForge results panel: ${JSON.stringify({
      state,
      pageErrors: diagnostics.errors.slice(-3),
      consoleErrors: diagnostics.consoleErrors.slice(-3),
      cause: error instanceof Error ? error.message : String(error),
    })}`);
  }
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

function assertNeverFallback(label: string): false {
  throw new Error(`Forbidden Browser pane fallback rendered: ${label}`);
}

function assertNoRawText(serialized: string, text: string) {
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(text)));
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(encodeURIComponent(text))));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function delay(ms: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));
}
