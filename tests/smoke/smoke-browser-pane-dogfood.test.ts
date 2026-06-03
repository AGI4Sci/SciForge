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
const REAL_EXTERNAL_DOGFOOD_SCHEMA = 'sciforge.browser-pane-real-external-dogfood.v1';
const DOGFOOD_NATIVE_ATTACH_PREFLIGHT_CAPABILITIES = [
  'browser-host-native-surface',
  'browser-host-search',
  'browser-host-session',
] as const;
const fixtureHost = 'sciforge-browser-dogfood.test';
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-pane-dogfood');
const manifestPath = join(artifactDir, 'manifest.json');
const realExternalArtifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-pane-real-external-dogfood');
const realExternalManifestPath = join(realExternalArtifactDir, 'manifest.json');

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
  blockedReasonCode?: 'missing-native-attach/preflight' | 'missing-native-attach';
};

type DogfoodNativeAttachPreflightEvidence = {
  bounded: true;
  status: 'ready' | 'blocked';
  blockedReasonCode?: 'missing-native-attach/preflight';
  writerHealth: {
    available: boolean;
    ok?: boolean;
    service?: string;
    status?: string;
    capabilitySummary: string[];
    capabilities: {
      browserHostSession: 'ready' | 'missing';
      nativeSurface: 'ready' | 'missing';
      browserHostSearch: 'ready' | 'missing';
    };
    nativeSurfaceEndpoint: 'present' | 'missing';
    endpointKeys: string[];
    errorHash?: string;
  };
  rightPaneBridge: {
    available: boolean;
    state?: string;
    hostFrameCount: number;
    nativeSurfaceCount: number;
    sessionRefCount: number;
    liveSurfaceRefCount: number;
    frameStreamRefCount: number;
    rendererHashes: string[];
    diagnosticHealthCapability?: string;
    diagnosticLiveSurfaceTransport?: string;
    writerDiagnosticStatus?: string;
  };
  nativeAttach: {
    status: 'attached' | 'missing' | 'blocked';
    liveSurfaceTransport?: string;
    singleInteractiveTruth: boolean;
    secondTruthSource: boolean;
    sessionRefs: string[];
    liveSurfaceRefs: string[];
  };
};

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
  status: 'passed' | 'blocked';
  runId: string;
  observedAt: string;
  shell: 'web-right-pane';
  targetOriginRef: string;
  targetEvidence: {
    mode: 'resolver-fixture';
    hostRef: string;
    originRef: string;
    resolverRuleApplied: true;
    realExternalSiteClaim: false;
    hardcodedSitePassClaim: false;
    rawUrlCaptured: false;
    allowedUse: 'right-pane-product-path-contract-not-external-web-pass';
  };
  browserHostSession?: {
    id: string;
    transport?: string;
    liveSurfaceTransport?: string;
    frameTransport?: string;
    singleInteractiveTruth: boolean;
    secondTruthSource: boolean;
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
  nativeAttachPreflight?: DogfoodNativeAttachPreflightEvidence;
  liveAcceptance: BrowserPaneLiveAcceptance;
  blockedReason?: string;
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
  status: 'passed' | 'blocked';
  eventTypes: string[];
  valueLengths?: number[];
  valueHashes?: string[];
  navigationPath?: string;
  maxScrollY?: number;
};

type RealExternalDogfoodTarget = {
  url: string;
  text?: string;
  backspaceCount?: number;
  retypeText?: string;
  submit?: {
    kind: 'key';
    key: 'Enter';
  };
  expectedAfterSubmitUrlLength?: number;
  expectedAfterSubmitUrlHash?: string;
  click?: {
    xRatio: number;
    yRatio: number;
  };
  scrollDeltaY?: number;
};

type BrowserPaneRealExternalDogfoodManifest = {
  schemaVersion: typeof REAL_EXTERNAL_DOGFOOD_SCHEMA;
  status: 'passed' | 'blocked';
  runId: string;
  observedAt: string;
  shell: 'web-right-pane';
  targetEvidence: {
    mode: 'real-external-url-config' | 'blocked-no-target-config' | 'blocked-real-external-url-config';
    configuredBy: 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON';
    requestedUrlLength?: number;
    requestedUrlHash?: string;
    finalUrlLength?: number;
    finalUrlHash?: string;
    realExternalSiteClaim: boolean;
    hardcodedSitePassClaim: false;
    rawUrlCaptured: false;
    rawDomCaptured: false;
  };
  browserHostSession?: BrowserPaneDogfoodManifest['browserHostSession'];
  nativeAttachPreflight?: DogfoodNativeAttachPreflightEvidence;
  liveAcceptance: BrowserPaneLiveAcceptance;
  interactionCoverage: {
    openUrl: boolean;
    liveFrameVisible: boolean;
    scrollAttempted: boolean;
    reloadAttempted: boolean;
    textInputAttempted: boolean;
    typedTextLength?: number;
    typedTextHash?: string;
    sameSessionAfterReload?: boolean;
    sameLiveSurfaceAfterReload?: boolean;
  };
  publicSearchBoxEvidence?: {
    configuredBy: 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON';
    claimScope: 'input-route-and-url-digest-only' | 'input-route-only' | 'not-attempted';
    clickRatioConfigured: boolean;
    hiddenKeyboardFocusedAfterClick?: boolean;
    cursorAtClick: 'text' | 'unknown';
    typeActionTextLengths: number[];
    typeActionTextHashes: string[];
    backspaceCount: number;
    pressKeys: string[];
    shellComposerCapturedCharacters?: number;
    submitAttempted: boolean;
    expectedAfterSubmitUrlLength?: number;
    expectedAfterSubmitUrlHash?: string;
    finalUrlLength?: number;
    finalUrlHash?: string;
    expectedFinalUrlMatched?: boolean;
    sameSessionAfterSubmit?: boolean;
    sameLiveSurfaceAfterSubmit?: boolean;
    rawTextCaptured: false;
    rawUrlCaptured: false;
    rawDomCaptured: false;
  };
  fallbackCounts: {
    iframe: number;
    proxy: number;
    systemPopup: number;
    httpFrameLiveView: number;
  };
  actionTimingSummary: Array<Record<string, unknown>>;
  blockedReason?: string;
  forbiddenFallbacks: BrowserPaneDogfoodManifest['forbiddenFallbacks'];
  verificationCommand: string;
};

test('Browser pane dogfood blocked manifests include typed native attach preflight evidence', () => {
  const nativeAttachPreflight = buildDogfoodNativeAttachPreflightEvidence({
    writerHealth: {
      ok: true,
      service: 'sciforge-workspace-writer',
      capabilities: ['workspace-files', 'browser-host-session', 'browser-host-search'],
      endpoints: {
        browserHostSession: '/api/sciforge/browser-host/sessions/{start,state,actions,computer-use-actions}',
        browserHostSearch: '/api/sciforge/browser-host/search',
      },
    },
    rightPane: {
      state: 'blocked',
      hostFrameCount: 0,
      nativeSurfaceCount: 0,
      sessionRefs: [],
      liveSurfaceRefs: [],
      frameStreamRefs: [],
      renderers: [],
      diagnostics: {
        healthCapability: 'browser-host-session',
        liveSurfaceTransport: 'missing-native-attach',
        writerDiagnosticStatus: 'ready',
      },
    },
  });

  const manifest = buildBlockedDogfoodManifest(
    'dogfood-preflight-test',
    'http://sciforge-browser-dogfood.test:1111',
    'Browser pane dogfood did not expose native-embedded BrowserHostSession evidence.',
    { iframe: 0, proxy: 0, systemPopup: 0, httpFrameLiveView: 0 },
    nativeAttachPreflight,
  );

  assert.equal(nativeAttachPreflight.status, 'blocked');
  assert.equal(nativeAttachPreflight.blockedReasonCode, 'missing-native-attach/preflight');
  assert.equal(nativeAttachPreflight.writerHealth.capabilities.nativeSurface, 'missing');
  assert.deepEqual(nativeAttachPreflight.writerHealth.capabilitySummary, [
    'browser-host-native-surface:missing',
    'browser-host-search:ready',
    'browser-host-session:ready',
  ]);
  assert.equal(nativeAttachPreflight.rightPaneBridge.available, false);
  assert.equal(nativeAttachPreflight.nativeAttach.status, 'missing');
  assert.equal(manifest.liveAcceptance.blockedReasonCode, 'missing-native-attach/preflight');
  assertNativeAttachPreflightEvidence(manifest.nativeAttachPreflight);
  assertBrowserPaneDogfoodManifest(manifest);
  assert.doesNotMatch(JSON.stringify(manifest), /https?:\/\/|<!doctype|<html|<body|outerHTML|innerHTML|data:image|;base64,|screenshot/i);
});

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
    const nativeAttachPreflight = await collectDogfoodNativeAttachPreflightEvidence({ page, writerUrl });
    if (nativeAttachPreflight.status === 'blocked') {
      const manifest = buildBlockedDogfoodManifest(
        runId,
        fixtureOrigin,
        'missing-native-attach/preflight',
        await fallbackCounts(page),
        nativeAttachPreflight,
      );
      assertBrowserPaneDogfoodManifest(manifest);
      await mkdir(artifactDir, { recursive: true });
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return;
    }
    const hostFrame = await waitForHostFrame(surface, /^http:\/\/sciforge-browser-dogfood\.test:\d+\/search/);
    if (!hostFrame) {
      const manifest = buildBlockedDogfoodManifest(
        runId,
        fixtureOrigin,
        'Browser pane dogfood did not expose native-embedded BrowserHostSession evidence.',
        await fallbackCounts(page),
        nativeAttachPreflight,
      );
      assertBrowserPaneDogfoodManifest(manifest);
      await mkdir(artifactDir, { recursive: true });
      await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return;
    }
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
      nativeAttachPreflight,
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

test('SciForge Browser pane real external dogfood records configurable refs-first public-page evidence', { timeout: 180_000 }, async () => {
  const target = realExternalDogfoodTargetFromEnv();
  const runId = `browser-pane-real-external-${Date.now().toString(36)}`;
  if (!target.ok) {
    const manifest = buildBlockedRealExternalDogfoodManifest(runId, target.reason);
    assertBrowserPaneRealExternalDogfoodManifest(manifest);
    await mkdir(realExternalArtifactDir, { recursive: true });
    await writeFile(realExternalManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return;
  }

  const browserExecutable = process.env.SCIFORGE_RIGHT_PANE_BROWSER_EXECUTABLE || EDGE_EXECUTABLE;
  if (!existsSync(browserExecutable)) {
    const manifest = buildBlockedRealExternalDogfoodManifest(runId, `No browser executable found for Browser pane real external dogfood: ${browserExecutable}`);
    assertBrowserPaneRealExternalDogfoodManifest(manifest);
    await mkdir(realExternalArtifactDir, { recursive: true });
    await writeFile(realExternalManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    return;
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-browser-pane-real-external-'));
  const workspacePath = join(tempRoot, 'workspace');
  const configPath = join(tempRoot, 'config.local.json');
  const writerPort = await getFreePort();
  const uiPort = await getFreePort();
  const writerUrl = `http://127.0.0.1:${writerPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const children: ChildProcess[] = [];
  let browser: Browser | undefined;

  await mkdir(workspacePath);
  await writeFile(configPath, JSON.stringify({
    schemaVersion: 1,
    workspaceWriterBaseUrl: writerUrl,
    workspacePath,
    agentServerBaseUrl: 'http://127.0.0.1:1',
    locale: 'en-US',
    theme: 'dark',
    modelProvider: 'dogfood-real-external',
    modelBaseUrl: '',
    modelName: '',
    apiKey: '',
  }), 'utf8');

  try {
    const commonEnv = {
      ...process.env,
      SCIFORGE_INSTANCE_ID: runId,
      SCIFORGE_CONFIG_PATH: configPath,
      SCIFORGE_WORKSPACE_PATH: workspacePath,
      SCIFORGE_WORKSPACE_PORT: String(writerPort),
      SCIFORGE_WORKSPACE_WRITER_URL: writerUrl,
      SCIFORGE_BROWSER_HOST_EXECUTABLE_PATH: browserExecutable,
      SCIFORGE_BROWSER_HOST_PROXY_SERVER: 'direct://',
      SCIFORGE_BROWSER_HOST_PROXY_BYPASS_LIST: '<-loopback>',
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
    await openBrowserPaneUrl(surface, target.value.url);
    const nativeAttachPreflight = await collectDogfoodNativeAttachPreflightEvidence({ page, writerUrl });
    if (nativeAttachPreflight.status === 'blocked') {
      const manifest = buildBlockedRealExternalDogfoodManifest(
        runId,
        'missing-native-attach/preflight',
        target.value,
        nativeAttachPreflight,
      );
      assertBrowserPaneRealExternalDogfoodManifest(manifest);
      await mkdir(realExternalArtifactDir, { recursive: true });
      await writeFile(realExternalManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return;
    }
    const hostFrame = await waitForReadyHostFrame(surface);
    if (!hostFrame) {
      const manifest = buildBlockedRealExternalDogfoodManifest(
        runId,
        'Browser pane real external dogfood did not expose native-embedded BrowserHostSession evidence.',
        target.value,
        nativeAttachPreflight,
      );
      assertBrowserPaneRealExternalDogfoodManifest(manifest);
      await mkdir(realExternalArtifactDir, { recursive: true });
      await writeFile(realExternalManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return;
    }
    const sessionAfterOpen = await currentBrowserHostSession(page, writerUrl, workspacePath);
    const liveSurfaceBeforeReload = stringField(sessionAfterOpen.liveSurfaceRef);

    await hostFrame.hover();
    await page.mouse.wheel(0, target.value.scrollDeltaY ?? 900);
    await delay(1200);

    let textInputAttempted = false;
    let publicSearchBoxEvidence: BrowserPaneRealExternalDogfoodManifest['publicSearchBoxEvidence'] | undefined;
    if (target.value.text && target.value.click) {
      const box = await hostFrame.boundingBox();
      assert.ok(box, 'real external host frame must expose visible bounds for configured text input');
      await page.mouse.click(
        Math.round(box.x + box.width * target.value.click.xRatio),
        Math.round(box.y + box.height * target.value.click.yRatio),
      );
      const hiddenKeyboardFocusedAfterClick = await browserPaneHiddenKeyboardFocused(surface);
      await page.keyboard.type(target.value.text);
      textInputAttempted = true;
      const typeActionTextLengths = [target.value.text.length];
      const typeActionTextHashes = [hashText(target.value.text)];
      for (let index = 0; index < (target.value.backspaceCount ?? 0); index += 1) {
        await page.keyboard.press('Backspace');
      }
      if (target.value.retypeText) {
        await page.keyboard.type(target.value.retypeText);
        typeActionTextLengths.push(target.value.retypeText.length);
        typeActionTextHashes.push(hashText(target.value.retypeText));
      }
      let sessionAfterSubmit: JsonRecord | undefined;
      let liveSurfaceAfterSubmit = '';
      const pressKeys: string[] = [];
      if (target.value.submit?.kind === 'key') {
        await page.keyboard.press(target.value.submit.key);
        pressKeys.push(target.value.submit.key);
        await delay(1500);
        sessionAfterSubmit = await currentBrowserHostSession(page, writerUrl, workspacePath);
        liveSurfaceAfterSubmit = stringField(sessionAfterSubmit.liveSurfaceRef);
      }
      const finalUrl = stringField(sessionAfterSubmit?.url);
      const expectedFinalUrlMatched = target.value.expectedAfterSubmitUrlHash
        ? target.value.expectedAfterSubmitUrlHash === hashText(finalUrl)
          && target.value.expectedAfterSubmitUrlLength === finalUrl.length
        : undefined;
      publicSearchBoxEvidence = {
        configuredBy: 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON',
        claimScope: expectedFinalUrlMatched === true ? 'input-route-and-url-digest-only' : 'input-route-only',
        clickRatioConfigured: true,
        hiddenKeyboardFocusedAfterClick,
        cursorAtClick: 'unknown',
        typeActionTextLengths,
        typeActionTextHashes,
        backspaceCount: target.value.backspaceCount ?? 0,
        pressKeys,
        shellComposerCapturedCharacters: await shellComposerCapturedCharactersCount(page),
        submitAttempted: pressKeys.length > 0,
        expectedAfterSubmitUrlLength: target.value.expectedAfterSubmitUrlLength,
        expectedAfterSubmitUrlHash: target.value.expectedAfterSubmitUrlHash,
        finalUrlLength: finalUrl ? finalUrl.length : undefined,
        finalUrlHash: finalUrl ? hashText(finalUrl) : undefined,
        expectedFinalUrlMatched,
        sameSessionAfterSubmit: sessionAfterSubmit ? stringField(sessionAfterOpen.id) === stringField(sessionAfterSubmit.id) : undefined,
        sameLiveSurfaceAfterSubmit: liveSurfaceAfterSubmit ? liveSurfaceBeforeReload === liveSurfaceAfterSubmit : undefined,
        rawTextCaptured: false,
        rawUrlCaptured: false,
        rawDomCaptured: false,
      };
      await delay(500);
    }

    await clickBrowserCommand(surface, 'Reload');
    if (!await waitForReadyHostFrame(surface)) {
      const manifest = buildBlockedRealExternalDogfoodManifest(
        runId,
        'Browser pane real external dogfood lost native-embedded BrowserHostSession evidence after reload.',
        target.value,
        await collectDogfoodNativeAttachPreflightEvidence({ page, writerUrl }),
      );
      assertBrowserPaneRealExternalDogfoodManifest(manifest);
      await mkdir(realExternalArtifactDir, { recursive: true });
      await writeFile(realExternalManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
      return;
    }
    const sessionAfterReload = await currentBrowserHostSession(page, writerUrl, workspacePath);
    const manifest = buildPassedRealExternalDogfoodManifest({
      runId,
      target: target.value,
      session: sessionAfterReload,
      sessionAfterOpen,
      fallbackCounts: await fallbackCounts(page),
      textInputAttempted,
      liveSurfaceBeforeReload,
      publicSearchBoxEvidence,
      nativeAttachPreflight,
    });
    assertBrowserPaneRealExternalDogfoodManifest(manifest);
    await mkdir(realExternalArtifactDir, { recursive: true });
    await writeFile(realExternalManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  } catch (error) {
    const manifest = buildBlockedRealExternalDogfoodManifest(runId, error instanceof Error ? error.message : String(error), target.value);
    assertBrowserPaneRealExternalDogfoodManifest(manifest);
    await mkdir(realExternalArtifactDir, { recursive: true });
    await writeFile(realExternalManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
    for (const child of children.reverse()) await stopProcess(child);
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
  return waitForNativeHostSurface(surface);
}

async function waitForReadyHostFrame(surface: Locator) {
  await surface.page().waitForFunction(() => {
    const viewer = document.querySelector('.right-pane-browser-surface .browser-workbench-viewer');
    const state = viewer?.getAttribute('data-browser-state');
    const frame = document.querySelector('.right-pane-browser-surface .browser-workbench-host-frame[data-browser-native-surface="true"][data-browser-live-surface-transport="native-embedded"][data-browser-single-interactive-truth="true"]');
    return state === 'ready' || state === 'blocked' || state === 'error' || Boolean(frame);
  }, undefined, { timeout: 60_000 });
  return waitForNativeHostSurface(surface);
}

async function waitForNativeHostSurface(surface: Locator): Promise<Locator | undefined> {
  const nativeSurface = surface.locator('.browser-workbench-host-frame[data-browser-native-surface="true"][data-browser-live-surface-transport="native-embedded"][data-browser-single-interactive-truth="true"]').first();
  if (!await nativeSurface.count()) {
    await assertNoLegacyBrowserLiveFallback(surface);
    return undefined;
  }
  await nativeSurface.waitFor({ state: 'visible', timeout: 30_000 });
  assert.equal(await nativeSurface.getAttribute('data-browser-host-surface'), 'browser-host-session');
  assert.equal(await nativeSurface.getAttribute('data-browser-frame-transport'), 'native-embedded');
  assert.match(await nativeSurface.getAttribute('data-browser-live-surface-ref') ?? '', /^browser-host-session:[^/]+\/live-surface$/);
  await assertNoLegacyBrowserLiveFallback(surface);
  return nativeSurface;
}

async function waitForWorkbenchUrl(surface: Locator, expectedUrl: RegExp) {
  await surface.page().waitForFunction(({ source, flags }) => {
    const viewer = document.querySelector('.right-pane-browser-surface .browser-workbench-viewer');
    const state = viewer?.getAttribute('data-browser-state');
    const url = viewer?.querySelector('header p')?.textContent ?? '';
    if (state === 'blocked' || state === 'error') return true;
    return state === 'ready' && new RegExp(source, flags).test(url);
  }, { source: expectedUrl.source, flags: expectedUrl.flags }, { timeout: 45_000 });
}

async function clickBrowserCommand(surface: Locator, label: 'Reload') {
  const id = label.toLowerCase();
  await surface.page().waitForFunction((commandId) => {
    const button = document.querySelector<HTMLButtonElement>(`.right-pane-browser-surface .browser-workbench-viewer-actions button[data-browser-command-id="${commandId}"]`);
    return Boolean(button && !button.disabled);
  }, id, { timeout: 20_000 });
  await surface.page().evaluate((commandId) => {
    const button = document.querySelector<HTMLButtonElement>(`.right-pane-browser-surface .browser-workbench-viewer-actions button[data-browser-command-id="${commandId}"]`);
    button?.click();
  }, id);
}

async function browserPaneHiddenKeyboardFocused(surface: Locator) {
  return surface.page().evaluate(() => {
    const active = document.activeElement;
    return active instanceof HTMLElement
      && active.matches('.right-pane-browser-surface .browser-workbench-host-keyboard-input[data-browser-host-keyboard-input="true"]');
  });
}

async function shellComposerCapturedCharactersCount(page: Page): Promise<number> {
  const composer = page.locator('.composer textarea').first();
  if (!await composer.count()) return 0;
  return composer.evaluate((node) => node instanceof HTMLTextAreaElement ? node.value.length : 0);
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

async function assertNoLegacyBrowserLiveFallback(surface: Locator) {
  assert.equal(await surface.locator('[data-browser-host-surface="system-browser-window"]').count(), 0);
  assert.equal(await surface.locator('iframe[src^="/api/sciforge/browser/proxy"], iframe').count(), 0);
  assert.equal(await surface.locator('webview').count(), 0);
  assert.equal(await surface.locator('img[data-browser-host-surface="browser-host-session"]').count(), 0);
  assert.equal(await surface.locator('canvas[data-browser-host-surface="browser-host-session"]').count(), 0);
  assert.equal(await surface.locator('img[src*="/api/sciforge/browser-host/sessions/"][data-browser-host-surface="browser-host-session"]').count(), 0);
}

async function collectDogfoodNativeAttachPreflightEvidence(input: {
  page: Page;
  writerUrl: string;
}): Promise<DogfoodNativeAttachPreflightEvidence> {
  const [writerHealthResult, rightPane] = await Promise.all([
    fetchWorkspaceWriterHealth(input.writerUrl),
    collectDogfoodRightPanePreflightEvidence(input.page).catch(() => undefined),
  ]);
  return buildDogfoodNativeAttachPreflightEvidence({
    writerHealth: writerHealthResult.health,
    writerHealthError: writerHealthResult.error,
    rightPane,
  });
}

async function fetchWorkspaceWriterHealth(writerUrl: string): Promise<{ health?: JsonRecord; error?: unknown }> {
  try {
    const response = await fetch(`${writerUrl}/health`, { signal: AbortSignal.timeout(3_000) });
    const text = await response.text();
    const health = text ? parseJsonRecord(text) : {};
    if (!response.ok || health.ok === false) return { error: new Error(`workspace-writer-health:${response.status}`) };
    return { health };
  } catch (error) {
    return { error };
  }
}

async function collectDogfoodRightPanePreflightEvidence(page: Page): Promise<{
  state: string;
  hostFrameCount: number;
  nativeSurfaceCount: number;
  sessionRefs: string[];
  liveSurfaceRefs: string[];
  frameStreamRefs: string[];
  renderers: string[];
  diagnostics?: {
    healthCapability?: string;
    liveSurfaceTransport?: string;
    writerDiagnosticStatus?: string;
  };
}> {
  const snapshot = await page.evaluate(() => {
    const root = document.querySelector('.right-pane-browser-surface');
    const attrValues = (name: string) => Array.from(new Set(Array.from(root?.querySelectorAll('*') ?? [])
      .map((node) => node.getAttribute(name) ?? '')
      .filter(Boolean))).sort();
    const liveSurfaceRefs = attrValues('data-browser-live-surface-ref');
    const diagnostics = root?.querySelector<HTMLElement>('.browser-workbench-viewer-diagnostics');
    return {
      state: root?.querySelector('.browser-workbench-viewer')?.getAttribute('data-browser-state') ?? '',
      hostFrameCount: root?.querySelectorAll('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]').length ?? 0,
      nativeSurfaceCount: root?.querySelectorAll('[data-browser-native-surface="true"]').length ?? 0,
      liveSurfaceRefs,
      frameStreamRefs: attrValues('data-browser-frame-stream-ref'),
      renderers: attrValues('data-browser-frame-renderer'),
      diagnostics: {
        healthCapability: diagnostics?.getAttribute('data-browser-health-capability') ?? '',
        liveSurfaceTransport: diagnostics?.getAttribute('data-browser-diagnostic-live-surface-transport') ?? '',
        writerDiagnosticStatus: diagnostics?.getAttribute('data-browser-writer-diagnostic') ?? '',
      },
    };
  });
  const liveSurfaceRefs = boundedUnique(snapshot.liveSurfaceRefs, 24);
  return {
    state: boundedDiagnosticString(snapshot.state) ?? '',
    hostFrameCount: snapshot.hostFrameCount,
    nativeSurfaceCount: snapshot.nativeSurfaceCount,
    sessionRefs: boundedUnique(liveSurfaceRefs.flatMap((ref) => {
      const match = /^browser-host-session:([^/]+)/.exec(ref);
      return match ? [`browser-host-session:${match[1]}`] : [];
    }), 24),
    liveSurfaceRefs,
    frameStreamRefs: boundedUnique(snapshot.frameStreamRefs, 24),
    renderers: boundedUnique(snapshot.renderers, 8),
    diagnostics: {
      healthCapability: boundedDiagnosticString(snapshot.diagnostics.healthCapability) ?? '',
      liveSurfaceTransport: boundedDiagnosticString(snapshot.diagnostics.liveSurfaceTransport) ?? '',
      writerDiagnosticStatus: boundedDiagnosticString(snapshot.diagnostics.writerDiagnosticStatus) ?? '',
    },
  };
}

function buildDogfoodNativeAttachPreflightEvidence(input: {
  writerHealth?: JsonRecord;
  writerHealthError?: unknown;
  rightPane?: {
    state: string;
    hostFrameCount: number;
    nativeSurfaceCount: number;
    sessionRefs: string[];
    liveSurfaceRefs: string[];
    frameStreamRefs: string[];
    renderers: string[];
    diagnostics?: {
      healthCapability?: string;
      liveSurfaceTransport?: string;
      writerDiagnosticStatus?: string;
    };
  };
}): DogfoodNativeAttachPreflightEvidence {
  const capabilities = Array.isArray(input.writerHealth?.capabilities)
    ? input.writerHealth.capabilities.filter((capability): capability is string => typeof capability === 'string')
    : [];
  const capabilitySet = new Set(capabilities);
  const endpoints = recordField(input.writerHealth?.endpoints);
  const endpointKeys = endpoints ? boundedUnique(Object.keys(endpoints).sort(), 16) : [];
  const capabilityState = (capability: string): 'ready' | 'missing' => capabilitySet.has(capability) ? 'ready' : 'missing';
  const nativeSurfaceEndpoint = typeof endpoints?.browserHostNativeSurface === 'string' ? 'present' : 'missing';
  const liveSurfaceRefs = boundedUnique(input.rightPane?.liveSurfaceRefs ?? [], 24);
  const sessionRefs = boundedUnique(input.rightPane?.sessionRefs ?? [], 24);
  const attached = input.rightPane?.hostFrameCount === 1
    && input.rightPane.nativeSurfaceCount === 1
    && liveSurfaceRefs.some((ref) => /^browser-host-session:[^/]+\/live-surface$/.test(ref))
    && input.rightPane.renderers.includes('native-embedded');
  const missingWriterNativeSurface = capabilityState('browser-host-native-surface') === 'missing'
    || nativeSurfaceEndpoint === 'missing';
  const blocked = missingWriterNativeSurface || !attached;
  const nativeAttachStatus: DogfoodNativeAttachPreflightEvidence['nativeAttach']['status'] = attached
    ? 'attached'
    : (input.rightPane?.hostFrameCount ?? 0) > 0 || (input.rightPane?.nativeSurfaceCount ?? 0) > 0
      ? 'blocked'
      : 'missing';
  return {
    bounded: true,
    status: blocked ? 'blocked' : 'ready',
    blockedReasonCode: blocked ? 'missing-native-attach/preflight' : undefined,
    writerHealth: {
      available: Boolean(input.writerHealth),
      ok: typeof input.writerHealth?.ok === 'boolean' ? input.writerHealth.ok : undefined,
      service: boundedDiagnosticString(stringField(input.writerHealth?.service)),
      status: boundedDiagnosticString(stringField(input.writerHealth?.status)),
      capabilitySummary: DOGFOOD_NATIVE_ATTACH_PREFLIGHT_CAPABILITIES
        .map((capability) => `${capability}:${capabilityState(capability)}`),
      capabilities: {
        browserHostSession: capabilityState('browser-host-session'),
        nativeSurface: capabilityState('browser-host-native-surface'),
        browserHostSearch: capabilityState('browser-host-search'),
      },
      nativeSurfaceEndpoint,
      endpointKeys,
      errorHash: input.writerHealthError
        ? hashText(input.writerHealthError instanceof Error ? input.writerHealthError.message : String(input.writerHealthError))
        : undefined,
    },
    rightPaneBridge: {
      available: (input.rightPane?.hostFrameCount ?? 0) > 0,
      state: boundedDiagnosticString(input.rightPane?.state ?? ''),
      hostFrameCount: input.rightPane?.hostFrameCount ?? 0,
      nativeSurfaceCount: input.rightPane?.nativeSurfaceCount ?? 0,
      sessionRefCount: sessionRefs.length,
      liveSurfaceRefCount: liveSurfaceRefs.length,
      frameStreamRefCount: input.rightPane?.frameStreamRefs.length ?? 0,
      rendererHashes: boundedUnique((input.rightPane?.renderers ?? []).filter(Boolean).map(hashText), 8),
      diagnosticHealthCapability: boundedDiagnosticString(input.rightPane?.diagnostics?.healthCapability ?? ''),
      diagnosticLiveSurfaceTransport: boundedDiagnosticString(input.rightPane?.diagnostics?.liveSurfaceTransport ?? ''),
      writerDiagnosticStatus: boundedDiagnosticString(input.rightPane?.diagnostics?.writerDiagnosticStatus ?? ''),
    },
    nativeAttach: {
      status: nativeAttachStatus,
      liveSurfaceTransport: attached
        ? 'native-embedded'
        : boundedDiagnosticString(input.rightPane?.diagnostics?.liveSurfaceTransport ?? ''),
      singleInteractiveTruth: attached,
      secondTruthSource: false,
      sessionRefs,
      liveSurfaceRefs: boundedUnique(liveSurfaceRefs.filter((ref) => /^browser-host-session:[^/]+\/live-surface$/.test(ref)), 24),
    },
  };
}

function buildManifest(input: {
  runId: string;
  fixtureOrigin: string;
  session: JsonRecord;
  events: DogfoodFixtureEvent[];
  fallbackCounts: { iframe: number; proxy: number; systemPopup: number; httpFrameLiveView: number };
  nativeAttachPreflight?: DogfoodNativeAttachPreflightEvidence;
}): BrowserPaneDogfoodManifest {
  const eventTypes = (path: string) => input.events.filter((event) => event.path === path).map((event) => event.type);
  const formEvents = input.events.filter((event) => event.path === '/form');
  const scrollEvents = input.events.filter((event) => event.type === 'doc-scroll');
  const frameTransport = stringField(input.session.liveSurfaceTransport) === 'native-embedded' ? 'native-embedded' : undefined;
  const liveAcceptance = browserPaneLiveAcceptance(input.session, frameTransport);
  return {
    schemaVersion: DOGFOOD_SCHEMA,
    status: liveAcceptance.status,
    runId: input.runId,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetOriginRef: `fixture-origin:${hashText(input.fixtureOrigin)}`,
    targetEvidence: {
      mode: 'resolver-fixture',
      hostRef: `fixture-host:${hashText(fixtureHost)}`,
      originRef: `fixture-origin:${hashText(input.fixtureOrigin)}`,
      resolverRuleApplied: true,
      realExternalSiteClaim: false,
      hardcodedSitePassClaim: false,
      rawUrlCaptured: false,
      allowedUse: 'right-pane-product-path-contract-not-external-web-pass',
    },
    browserHostSession: {
      id: stringField(input.session.id),
      transport: stringField(input.session.liveSurfaceTransport),
      liveSurfaceTransport: stringField(input.session.liveSurfaceTransport),
      frameTransport,
      singleInteractiveTruth: input.session.singleInteractiveTruth === true,
      secondTruthSource: input.session.secondTruthSource === true,
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
    nativeAttachPreflight: input.nativeAttachPreflight,
    liveAcceptance,
    blockedReason: liveAcceptance.status === 'blocked' ? liveAcceptance.blockedReason : undefined,
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

function buildBlockedDogfoodManifest(
  runId: string,
  fixtureOrigin: string,
  reason: string,
  fallbackCounts: { iframe: number; proxy: number; systemPopup: number; httpFrameLiveView: number },
  nativeAttachPreflight?: DogfoodNativeAttachPreflightEvidence,
): BrowserPaneDogfoodManifest {
  assert.equal(fallbackCounts.iframe, 0);
  assert.equal(fallbackCounts.proxy, 0);
  assert.equal(fallbackCounts.systemPopup, 0);
  assert.equal(fallbackCounts.httpFrameLiveView, 0);
  const liveAcceptance = blockedBrowserPaneLiveAcceptance(reason, nativeAttachPreflight);
  return {
    schemaVersion: DOGFOOD_SCHEMA,
    status: 'blocked',
    runId,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetOriginRef: `fixture-origin:${hashText(fixtureOrigin)}`,
    targetEvidence: {
      mode: 'resolver-fixture',
      hostRef: `fixture-host:${hashText(fixtureHost)}`,
      originRef: `fixture-origin:${hashText(fixtureOrigin)}`,
      resolverRuleApplied: true,
      realExternalSiteClaim: false,
      hardcodedSitePassClaim: false,
      rawUrlCaptured: false,
      allowedUse: 'right-pane-product-path-contract-not-external-web-pass',
    },
    nativeAttachPreflight,
    liveAcceptance,
    blockedReason: liveAcceptance.blockedReason,
    scenarios: {
      search: { status: 'blocked', eventTypes: [], navigationPath: '/search' },
      documentScroll: { status: 'blocked', eventTypes: [], navigationPath: '/docs/alpha' },
      formInput: { status: 'blocked', eventTypes: [], navigationPath: '/form' },
    },
    actionTimingSummary: [],
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
  assert.ok(manifest.status === 'passed' || manifest.status === 'blocked');
  assert.equal(manifest.targetOriginRef, manifest.targetEvidence.originRef);
  assert.equal(manifest.targetEvidence.mode, 'resolver-fixture');
  assert.equal(manifest.targetEvidence.resolverRuleApplied, true);
  assert.equal(manifest.targetEvidence.realExternalSiteClaim, false);
  assert.equal(manifest.targetEvidence.hardcodedSitePassClaim, false);
  assert.equal(manifest.targetEvidence.rawUrlCaptured, false);
  assert.equal(manifest.targetEvidence.allowedUse, 'right-pane-product-path-contract-not-external-web-pass');
  assertBrowserPaneLiveAcceptance(manifest.liveAcceptance, manifest.status);
  if (manifest.status === 'passed') {
    assert.ok(manifest.browserHostSession, 'passed dogfood manifest requires BrowserHostSession native evidence');
    assert.equal(manifest.browserHostSession.transport, manifest.browserHostSession.liveSurfaceTransport);
    assert.equal(manifest.browserHostSession.liveSurfaceTransport, 'native-embedded');
    assert.match(manifest.browserHostSession.liveSurfaceRef ?? '', /^browser-host-session:[^/]+\/live-surface$/);
    assert.match(manifest.browserHostSession.refs.frameRef ?? '', /^browser-host-session:[^/]+\/frame\.png$/);
    assert.equal(manifest.browserHostSession.singleInteractiveTruth, manifest.liveAcceptance.observed.singleInteractiveTruth);
    assert.equal(manifest.browserHostSession.secondTruthSource, false);
    assert.ok(manifest.scenarios.search.eventTypes.includes('search-submit'));
    assert.ok(manifest.scenarios.search.eventTypes.includes('results-load'));
    assert.ok(manifest.scenarios.documentScroll.eventTypes.includes('result-click'));
    assert.ok((manifest.scenarios.documentScroll.maxScrollY ?? 0) > 0);
    assert.ok(manifest.scenarios.formInput.eventTypes.includes('form-submit'));
  } else {
    assert.ok(manifest.blockedReason, 'web shell diagnostic manifest must include a blocked reason');
    assert.equal(manifest.liveAcceptance.passClaim, false);
    assert.equal(manifest.targetEvidence.realExternalSiteClaim, false);
    assert.equal(manifest.scenarios.search.status, 'blocked');
    assert.equal(manifest.scenarios.documentScroll.status, 'blocked');
    assert.equal(manifest.scenarios.formInput.status, 'blocked');
    if (manifest.nativeAttachPreflight) {
      assertNativeAttachPreflightEvidence(manifest.nativeAttachPreflight);
      assert.equal(manifest.liveAcceptance.blockedReasonCode, 'missing-native-attach/preflight');
    }
  }
  assert.deepEqual(Object.values(manifest.forbiddenFallbacks), [false, false, false, false, false, false]);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /<!doctype|<html|data:image|outerHTML|innerHTML/i);
}

function realExternalDogfoodTargetFromEnv():
  | { ok: true; value: RealExternalDogfoodTarget }
  | { ok: false; reason: string } {
  const raw = process.env.SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON?.trim();
  if (!raw) {
    return { ok: false, reason: 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON is not set; real external dogfood evidence was not attempted.' };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    return { ok: false, reason: `SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON is invalid JSON: ${error instanceof Error ? error.message : String(error)}` };
  }
  const record = recordField(parsed);
  const url = typeof record?.url === 'string' ? record.url.trim() : '';
  if (!url) return { ok: false, reason: 'real external dogfood target must include url.' };
  const validation = validateRealExternalUrl(url);
  if (!validation.ok) return { ok: false, reason: validation.reason };
  const click = recordField(record?.click);
  const text = typeof record?.text === 'string' && record.text.trim() ? record.text : undefined;
  const retypeText = typeof record?.retypeText === 'string' && record.retypeText.trim() ? record.retypeText : undefined;
  const hasClickConfig = record?.click !== undefined;
  const xRatio = typeof click?.xRatio === 'number' && Number.isFinite(click.xRatio) ? click.xRatio : undefined;
  const yRatio = typeof click?.yRatio === 'number' && Number.isFinite(click.yRatio) ? click.yRatio : undefined;
  if (hasClickConfig && (xRatio === undefined || yRatio === undefined)) {
    return { ok: false, reason: 'real external dogfood click config must include finite xRatio and yRatio numbers.' };
  }
  if (text && !hasClickConfig) {
    return { ok: false, reason: 'real external dogfood text input requires click xRatio/yRatio so input is explicitly attempted.' };
  }
  const backspaceCount = typeof record?.backspaceCount === 'number' && Number.isInteger(record.backspaceCount)
    ? Math.max(0, Math.min(40, record.backspaceCount))
    : undefined;
  const submit = recordField(record?.submit);
  const submitTarget = submit?.kind === 'key' && submit.key === 'Enter'
    ? { kind: 'key' as const, key: 'Enter' as const }
    : undefined;
  if (record?.submit !== undefined && !submitTarget) {
    return { ok: false, reason: 'real external dogfood submit config currently supports only {"kind":"key","key":"Enter"}.' };
  }
  if ((backspaceCount || retypeText || submitTarget) && !text) {
    return { ok: false, reason: 'real external dogfood edit/submit config requires text and click so the input route is explicitly attempted.' };
  }
  const expectedAfterSubmitUrlLength = typeof record?.expectedAfterSubmitUrlLength === 'number' && Number.isInteger(record.expectedAfterSubmitUrlLength) && record.expectedAfterSubmitUrlLength > 0
    ? record.expectedAfterSubmitUrlLength
    : undefined;
  const expectedAfterSubmitUrlHash = typeof record?.expectedAfterSubmitUrlHash === 'string' && /^[a-f0-9]{16}$/.test(record.expectedAfterSubmitUrlHash)
    ? record.expectedAfterSubmitUrlHash
    : undefined;
  if ((expectedAfterSubmitUrlLength !== undefined || expectedAfterSubmitUrlHash !== undefined) && !(expectedAfterSubmitUrlLength && expectedAfterSubmitUrlHash)) {
    return { ok: false, reason: 'real external dogfood expectedAfterSubmitUrlLength and expectedAfterSubmitUrlHash must be provided together.' };
  }
  return {
    ok: true,
    value: {
      url,
      text,
      backspaceCount,
      retypeText,
      submit: submitTarget,
      expectedAfterSubmitUrlLength,
      expectedAfterSubmitUrlHash,
      click: xRatio === undefined || yRatio === undefined
        ? undefined
        : {
          xRatio: Math.max(0, Math.min(1, xRatio)),
          yRatio: Math.max(0, Math.min(1, yRatio)),
        },
      scrollDeltaY: typeof record?.scrollDeltaY === 'number' && Number.isFinite(record.scrollDeltaY)
        ? Math.max(0, Math.min(4000, record.scrollDeltaY))
        : undefined,
    },
  };
}

function validateRealExternalUrl(rawUrl: string): { ok: true } | { ok: false; reason: string } {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return { ok: false, reason: 'real external dogfood target URL must be an absolute URL.' };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    return { ok: false, reason: 'real external dogfood target URL must use http or https.' };
  }
  const host = parsed.hostname.toLowerCase();
  const normalizedHost = host.replace(/^\[/, '').replace(/\]$/, '');
  if (
    normalizedHost === 'localhost'
    || normalizedHost === '127.0.0.1'
    || normalizedHost === '0.0.0.0'
    || normalizedHost === '::'
    || normalizedHost === '::1'
    || normalizedHost.endsWith('.localhost')
    || normalizedHost.endsWith('.test')
    || normalizedHost.endsWith('.local')
    || /^10\./.test(normalizedHost)
    || /^192\.168\./.test(normalizedHost)
    || /^172\.(1[6-9]|2\d|3[0-1])\./.test(normalizedHost)
    || /^169\.254\./.test(normalizedHost)
    || /^(fc|fd)[0-9a-f]*:/i.test(normalizedHost)
    || /^fe80:/i.test(normalizedHost)
  ) {
    return { ok: false, reason: 'real external dogfood target URL must not be localhost, fixture, or private-network scoped.' };
  }
  return { ok: true };
}

function buildBlockedRealExternalDogfoodManifest(
  runId: string,
  reason: string,
  target?: RealExternalDogfoodTarget,
  nativeAttachPreflight?: DogfoodNativeAttachPreflightEvidence,
): BrowserPaneRealExternalDogfoodManifest {
  const liveAcceptance = blockedBrowserPaneLiveAcceptance(reason, nativeAttachPreflight);
  return {
    schemaVersion: REAL_EXTERNAL_DOGFOOD_SCHEMA,
    status: 'blocked',
    runId,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetEvidence: {
      mode: target ? 'blocked-real-external-url-config' : 'blocked-no-target-config',
      configuredBy: 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON',
      requestedUrlLength: target?.url.length,
      requestedUrlHash: target ? hashText(target.url) : undefined,
      realExternalSiteClaim: false,
      hardcodedSitePassClaim: false,
      rawUrlCaptured: false,
      rawDomCaptured: false,
    },
    nativeAttachPreflight,
    liveAcceptance,
    interactionCoverage: {
      openUrl: false,
      liveFrameVisible: false,
      scrollAttempted: false,
      reloadAttempted: false,
      textInputAttempted: false,
    },
    fallbackCounts: {
      iframe: 0,
      proxy: 0,
      systemPopup: 0,
      httpFrameLiveView: 0,
    },
    actionTimingSummary: [],
    blockedReason: sanitizeExternalBlockedReason(reason),
    forbiddenFallbacks: dogfoodForbiddenFallbacks(),
    verificationCommand: 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON=<json> npm run smoke:browser-pane-real-external-dogfood --silent',
  };
}

function buildPassedRealExternalDogfoodManifest(input: {
  runId: string;
  target: RealExternalDogfoodTarget;
  session: JsonRecord;
  sessionAfterOpen: JsonRecord;
  fallbackCounts: { iframe: number; proxy: number; systemPopup: number; httpFrameLiveView: number };
  textInputAttempted: boolean;
  liveSurfaceBeforeReload: string;
  publicSearchBoxEvidence?: BrowserPaneRealExternalDogfoodManifest['publicSearchBoxEvidence'];
  nativeAttachPreflight?: DogfoodNativeAttachPreflightEvidence;
}): BrowserPaneRealExternalDogfoodManifest {
  const frameTransport = stringField(input.session.liveSurfaceTransport) === 'native-embedded' ? 'native-embedded' : undefined;
  const liveAcceptance = browserPaneLiveAcceptance(input.session, frameTransport);
  const canClaimLivePass = liveAcceptance.status === 'passed';
  return {
    schemaVersion: REAL_EXTERNAL_DOGFOOD_SCHEMA,
    status: liveAcceptance.status,
    runId: input.runId,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetEvidence: {
      mode: canClaimLivePass ? 'real-external-url-config' : 'blocked-real-external-url-config',
      configuredBy: 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON',
      requestedUrlLength: input.target.url.length,
      requestedUrlHash: hashText(input.target.url),
      finalUrlLength: stringField(input.session.url).length,
      finalUrlHash: hashText(stringField(input.session.url)),
      realExternalSiteClaim: canClaimLivePass,
      hardcodedSitePassClaim: false,
      rawUrlCaptured: false,
      rawDomCaptured: false,
    },
    browserHostSession: {
      id: stringField(input.session.id),
      transport: stringField(input.session.liveSurfaceTransport),
      liveSurfaceTransport: stringField(input.session.liveSurfaceTransport),
      frameTransport,
      singleInteractiveTruth: input.session.singleInteractiveTruth === true,
      secondTruthSource: input.session.secondTruthSource === true,
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
    nativeAttachPreflight: input.nativeAttachPreflight,
    liveAcceptance,
    interactionCoverage: {
      openUrl: true,
      liveFrameVisible: true,
      scrollAttempted: true,
      reloadAttempted: true,
      textInputAttempted: input.textInputAttempted,
      typedTextLength: input.textInputAttempted ? input.target.text?.length ?? 0 : undefined,
      typedTextHash: input.textInputAttempted && input.target.text ? hashText(input.target.text) : undefined,
      sameSessionAfterReload: stringField(input.sessionAfterOpen.id) === stringField(input.session.id),
      sameLiveSurfaceAfterReload: input.liveSurfaceBeforeReload === stringField(input.session.liveSurfaceRef),
    },
    publicSearchBoxEvidence: input.publicSearchBoxEvidence ?? {
      configuredBy: 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON',
      claimScope: 'not-attempted',
      clickRatioConfigured: false,
      cursorAtClick: 'unknown',
      typeActionTextLengths: [],
      typeActionTextHashes: [],
      backspaceCount: 0,
      pressKeys: [],
      submitAttempted: false,
      rawTextCaptured: false,
      rawUrlCaptured: false,
      rawDomCaptured: false,
    },
    fallbackCounts: input.fallbackCounts,
    actionTimingSummary: Array.isArray(input.session.actionTimingSummary)
      ? input.session.actionTimingSummary.filter((entry): entry is Record<string, unknown> => Boolean(recordField(entry))).slice(0, 12)
      : [],
    blockedReason: canClaimLivePass ? undefined : liveAcceptance.blockedReason,
    forbiddenFallbacks: dogfoodForbiddenFallbacks(),
    verificationCommand: 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON=<json> npm run smoke:browser-pane-real-external-dogfood --silent',
  };
}

function assertBrowserPaneRealExternalDogfoodManifest(manifest: BrowserPaneRealExternalDogfoodManifest) {
  assert.equal(manifest.schemaVersion, REAL_EXTERNAL_DOGFOOD_SCHEMA);
  assert.equal(manifest.shell, 'web-right-pane');
  assert.equal(manifest.targetEvidence.configuredBy, 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON');
  assert.equal(manifest.targetEvidence.hardcodedSitePassClaim, false);
  assert.equal(manifest.targetEvidence.rawUrlCaptured, false);
  assert.equal(manifest.targetEvidence.rawDomCaptured, false);
  assert.deepEqual(Object.values(manifest.forbiddenFallbacks), [false, false, false, false, false, false]);
  assertBrowserPaneLiveAcceptance(manifest.liveAcceptance, manifest.status);
  if (manifest.status === 'passed') {
    assert.equal(manifest.targetEvidence.mode, 'real-external-url-config');
    assert.equal(manifest.targetEvidence.realExternalSiteClaim, true);
    assert.ok((manifest.targetEvidence.requestedUrlLength ?? 0) > 0);
    assert.match(manifest.targetEvidence.requestedUrlHash ?? '', /^[a-f0-9]{16}$/);
    assert.ok((manifest.targetEvidence.finalUrlLength ?? 0) > 0);
    assert.match(manifest.targetEvidence.finalUrlHash ?? '', /^[a-f0-9]{16}$/);
    assert.equal(manifest.browserHostSession?.liveSurfaceTransport, 'native-embedded');
    assert.match(manifest.browserHostSession?.liveSurfaceRef ?? '', /^browser-host-session:[^/]+\/live-surface$/);
    assert.equal(manifest.browserHostSession?.singleInteractiveTruth, true);
    assert.equal(manifest.browserHostSession?.secondTruthSource, false);
    assert.equal(manifest.interactionCoverage.openUrl, true);
    assert.equal(manifest.interactionCoverage.liveFrameVisible, true);
    assert.equal(manifest.interactionCoverage.reloadAttempted, true);
    assert.equal(manifest.interactionCoverage.sameSessionAfterReload, true);
    assert.equal(manifest.interactionCoverage.sameLiveSurfaceAfterReload, true);
    assertPublicSearchBoxEvidence(manifest.publicSearchBoxEvidence);
  } else {
    assert.ok(manifest.targetEvidence.mode === 'blocked-no-target-config' || manifest.targetEvidence.mode === 'blocked-real-external-url-config');
    assert.equal(manifest.targetEvidence.realExternalSiteClaim, false);
    assert.ok(manifest.blockedReason);
    assert.equal(manifest.liveAcceptance.passClaim, false);
    if (manifest.nativeAttachPreflight) {
      assertNativeAttachPreflightEvidence(manifest.nativeAttachPreflight);
      assert.equal(manifest.liveAcceptance.blockedReasonCode, 'missing-native-attach/preflight');
    }
  }
  assert.equal(manifest.fallbackCounts.iframe, 0);
  assert.equal(manifest.fallbackCounts.proxy, 0);
  assert.equal(manifest.fallbackCounts.systemPopup, 0);
  assert.equal(manifest.fallbackCounts.httpFrameLiveView, 0);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /https?:\/\/|<!doctype|<html|<body|data:image|;base64,|outerHTML|innerHTML/i);
}

function browserPaneLiveAcceptance(session: JsonRecord, frameTransport?: string): BrowserPaneLiveAcceptance {
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
      frameTransport,
    },
    blockedReason: passed
      ? undefined
      : `Browser pane live acceptance requires native-embedded; observed ${liveSurfaceTransport || 'missing-native-attach'}.`,
  };
}

function blockedBrowserPaneLiveAcceptance(reason: string, nativeAttachPreflight?: DogfoodNativeAttachPreflightEvidence): BrowserPaneLiveAcceptance {
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
    blockedReason: sanitizeExternalBlockedReason(reason),
    blockedReasonCode: nativeAttachPreflight?.status === 'blocked'
      ? 'missing-native-attach/preflight'
      : reason === 'missing-native-attach/preflight'
        ? 'missing-native-attach/preflight'
        : undefined,
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
  } else {
    assert.equal(liveAcceptance.claimScope, 'diagnostic-only');
    assert.equal(liveAcceptance.passClaim, false);
    assert.ok(liveAcceptance.blockedReason);
    if (liveAcceptance.blockedReasonCode) {
      assert.ok(['missing-native-attach/preflight', 'missing-native-attach'].includes(liveAcceptance.blockedReasonCode));
    }
  }
}

function assertNativeAttachPreflightEvidence(preflight: DogfoodNativeAttachPreflightEvidence | undefined): asserts preflight is DogfoodNativeAttachPreflightEvidence {
  assert.ok(preflight, 'native attach preflight evidence is required for native attach blocked dogfood manifests');
  assert.equal(preflight.bounded, true);
  assert.ok(['ready', 'blocked'].includes(preflight.status));
  if (preflight.status === 'blocked') assert.equal(preflight.blockedReasonCode, 'missing-native-attach/preflight');
  assert.equal(typeof preflight.writerHealth.available, 'boolean');
  assert.ok(['ready', 'missing'].includes(preflight.writerHealth.capabilities.browserHostSession));
  assert.ok(['ready', 'missing'].includes(preflight.writerHealth.capabilities.nativeSurface));
  assert.ok(['ready', 'missing'].includes(preflight.writerHealth.capabilities.browserHostSearch));
  assert.ok(['present', 'missing'].includes(preflight.writerHealth.nativeSurfaceEndpoint));
  assert.ok(preflight.writerHealth.capabilitySummary.length <= DOGFOOD_NATIVE_ATTACH_PREFLIGHT_CAPABILITIES.length);
  assert.ok(preflight.writerHealth.endpointKeys.length <= 16);
  assert.equal(typeof preflight.rightPaneBridge.available, 'boolean');
  assert.ok(preflight.rightPaneBridge.hostFrameCount >= 0);
  assert.ok(preflight.rightPaneBridge.nativeSurfaceCount >= 0);
  assert.ok(preflight.rightPaneBridge.sessionRefCount >= 0);
  assert.ok(preflight.rightPaneBridge.liveSurfaceRefCount >= 0);
  assert.ok(preflight.rightPaneBridge.frameStreamRefCount >= 0);
  assert.ok(preflight.rightPaneBridge.rendererHashes.length <= 8);
  for (const hash of preflight.rightPaneBridge.rendererHashes) assert.match(hash, /^[a-f0-9]{16}$/);
  assert.ok(['attached', 'missing', 'blocked'].includes(preflight.nativeAttach.status));
  assert.equal(typeof preflight.nativeAttach.singleInteractiveTruth, 'boolean');
  assert.equal(typeof preflight.nativeAttach.secondTruthSource, 'boolean');
  assert.ok(preflight.nativeAttach.sessionRefs.length <= 24);
  assert.ok(preflight.nativeAttach.liveSurfaceRefs.length <= 24);
  for (const ref of preflight.nativeAttach.sessionRefs) assert.match(ref, /^browser-host-session:[^/]+$/);
  for (const ref of preflight.nativeAttach.liveSurfaceRefs) assert.match(ref, /^browser-host-session:[^/]+\/live-surface$/);
  const serialized = JSON.stringify(preflight);
  assert.doesNotMatch(serialized, /https?:\/\/|<!doctype|<html|<body|outerHTML|innerHTML|data:image|;base64,|screenshot/i);
}

function assertPublicSearchBoxEvidence(evidence: BrowserPaneRealExternalDogfoodManifest['publicSearchBoxEvidence']) {
  assert.ok(evidence, 'real external dogfood manifest must include public search box evidence scope');
  assert.equal(evidence.configuredBy, 'SCIFORGE_BROWSER_PANE_REAL_EXTERNAL_TARGET_JSON');
  assert.equal(evidence.rawTextCaptured, false);
  assert.equal(evidence.rawUrlCaptured, false);
  assert.equal(evidence.rawDomCaptured, false);
  assert.ok(['input-route-and-url-digest-only', 'input-route-only', 'not-attempted'].includes(evidence.claimScope));
  assert.ok(evidence.typeActionTextHashes.every((hash) => /^[a-f0-9]{16}$/.test(hash)));
  assert.ok(evidence.typeActionTextLengths.every((length) => Number.isInteger(length) && length > 0));
  assert.ok(evidence.pressKeys.every((key) => key === 'Enter'));
  if (evidence.shellComposerCapturedCharacters !== undefined) assert.equal(evidence.shellComposerCapturedCharacters, 0);
  if (evidence.expectedAfterSubmitUrlHash !== undefined) {
    assert.match(evidence.expectedAfterSubmitUrlHash, /^[a-f0-9]{16}$/);
    assert.ok((evidence.expectedAfterSubmitUrlLength ?? 0) > 0);
    assert.match(evidence.finalUrlHash ?? '', /^[a-f0-9]{16}$/);
    assert.ok((evidence.finalUrlLength ?? 0) > 0);
    assert.equal(evidence.expectedFinalUrlMatched, evidence.claimScope === 'input-route-and-url-digest-only');
  }
}

function dogfoodForbiddenFallbacks(): BrowserPaneDogfoodManifest['forbiddenFallbacks'] {
  return {
    iframe: false,
    proxy: false,
    systemPopup: false,
    httpFrameLiveView: false,
    rawDom: false,
    base64: false,
  };
}

function sanitizeExternalBlockedReason(reason: string) {
  const bounded = reason.replace(/https?:\/\/[^\s"'<>]+/gi, (url) => `url:${hashText(url)}`);
  return bounded.slice(0, 240) || 'blocked';
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

function boundedUnique(values: string[], limit: number): string[] {
  return Array.from(new Set(values.filter(Boolean))).slice(0, limit);
}

function boundedDiagnosticString(value: string): string | undefined {
  const normalized = value
    .replace(/https?:\/\/[^\s"'<>]+/gi, (url) => `url:${hashText(url)}`)
    .replace(/<!doctype|<html|<body|outerHTML|innerHTML|data:image|;base64,|screenshot/gi, 'redacted')
    .slice(0, 160);
  return normalized || undefined;
}

function hashText(value: string) {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function delay(ms: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));
}
