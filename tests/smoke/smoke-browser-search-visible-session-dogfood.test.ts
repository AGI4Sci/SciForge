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
const DOGFOOD_SCHEMA = 'sciforge.browser-search-visible-session-dogfood.v1';
const SCENARIO_ID = 'literature-evidence-review';
const PROJECTION_ID = 'browser-visible-session-dogfood-projection';
const SEARCH_RESULTS_ID = 'browser-visible-session-dogfood-results';
const FIXTURE_HOST = 'sciforge-browser-search-visible-session-dogfood.test';
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-search-visible-session-dogfood');
const manifestPath = join(artifactDir, 'manifest.json');

type JsonRecord = Record<string, unknown>;

type BrowserHostSessionSummary = {
  id: string;
  owner: string;
  status: string;
  transport?: string;
  singleInteractiveTruth: boolean;
  liveSurfaceRef?: string;
  refs: {
    frameStreamRef?: string;
    frameRef?: string;
    screenshotRef?: string;
    domSnapshotRef?: string;
    axSnapshotRef?: string;
    consoleLogRef?: string;
    networkLogRef?: string;
    searchResultRef?: string;
  };
};

type RightPaneBoundedEvidence = {
  state: string;
  sessionIds: string[];
  liveSurfaceRefs: string[];
  frameStreamRefs: string[];
  frameRefs: string[];
  transports: string[];
  singleInteractiveTruthValues: string[];
  hostBrowserObjects: number;
  hostFrames: number;
  imageSurfaces: number;
  canvasSurfaces: number;
  nativeSurfaces: number;
  iframeSurfaces: number;
  proxySurfaces: number;
  webviewSurfaces: number;
  systemPopupSurfaces: number;
  dataImageSurfaces: number;
  base64Attributes: number;
};

type VisibleSessionDogfoodManifest = {
  schemaVersion: typeof DOGFOOD_SCHEMA;
  status: 'passed';
  runId: string;
  observedAt: string;
  shell: 'web-right-pane';
  targetOriginRef: string;
  trigger: {
    mode: 'local-ui-payload-handoff';
    equivalentTool: 'browser_search';
    focusedVia: 'message-object-reference-click';
    projectionRef: string;
    browserSessionRef: string;
    objectReferencePreferredView: 'browser-workbench';
  };
  browserHostSession: {
    beforeHandoff: BrowserHostSessionSummary;
    afterHandoff: BrowserHostSessionSummary;
    observedStartSessionIds: string[];
    handoffStartSessionIds: string[];
    uniqueRightPaneSessionIds: string[];
  };
  rightPane: RightPaneBoundedEvidence;
  continuity: {
    sameBrowserHostSessionId: true;
    singleBrowserHostSessionId: true;
    secondOwnerOpened: false;
    hostBrowserObjectCount: 1;
  };
  forbiddenEvidence: {
    iframe: false;
    proxy: false;
    webview: false;
    systemPopup: false;
    domDump: false;
    base64: false;
    screenshotImage: false;
    screenshotBinary: false;
  };
  verificationCommand: string;
};

test('SciForge UI dogfood reuses the visible BrowserHostSession when browser_search projection is focused in the right pane', { timeout: 180_000 }, async () => {
  const browserExecutable = process.env.SCIFORGE_RIGHT_PANE_BROWSER_EXECUTABLE || EDGE_EXECUTABLE;
  if (!existsSync(browserExecutable)) {
    throw new Error(`No browser executable found for Browser search visible session dogfood: ${browserExecutable}`);
  }

  const tempRoot = await mkdtemp(join(tmpdir(), 'sciforge-browser-search-visible-session-dogfood-'));
  const workspacePath = join(tempRoot, 'workspace');
  const configPath = join(tempRoot, 'config.local.json');
  const writerPort = await getFreePort();
  const uiPort = await getFreePort();
  const fixturePort = await getFreePort();
  const writerUrl = `http://127.0.0.1:${writerPort}`;
  const uiUrl = `http://127.0.0.1:${uiPort}`;
  const fixtureOrigin = `http://${FIXTURE_HOST}:${fixturePort}`;
  const runId = `browser-search-visible-session-dogfood-${Date.now().toString(36)}`;
  const children: ChildProcess[] = [];
  let browser: Browser | undefined;
  let fixture: Awaited<ReturnType<typeof startVisibleSessionFixture>> | undefined;

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
    fixture = await startVisibleSessionFixture(fixturePort);
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
    const startRecorder = recordBrowserHostSessionStarts(page);

    await page.goto(`${uiUrl}/?page=workbench&scenarioId=${SCENARIO_ID}`, { waitUntil: 'domcontentloaded' });
    await waitForResultsPanel(page, pageDiagnostics);
    await ensureBrowserPane(page);
    const surface = page.locator('.right-pane-browser-surface');
    await openBrowserPaneUrl(surface, `${fixtureOrigin}/search`);
    await waitForVisibleHostFrame(surface, new RegExp(`^http://${escapeRegExp(FIXTURE_HOST)}:\\d+/search`));

    const sessionBefore = await currentBrowserHostSession(page, writerUrl, workspacePath);
    assert.equal(stringField(sessionBefore.owner), 'host');
    assert.equal(sessionBefore.singleInteractiveTruth, true);
    const visibleSessionId = stringField(sessionBefore.id);
    assert.ok(visibleSessionId, 'visible Browser pane must expose a BrowserHostSession id');
    await startRecorder.drain();

    const workspaceState = buildWorkspaceState({
      runId,
      workspacePath,
      writerUrl,
      fixtureOrigin,
      hostSession: sessionBefore,
    });
    await persistWorkspaceState(writerUrl, workspacePath, workspaceState, {
      workspaceWriterBaseUrl: writerUrl,
      workspacePath,
    });
    await page.evaluate((state) => {
      window.localStorage.setItem('sciforge.workspace.v2', JSON.stringify(state));
      const workspacePath = typeof state === 'object' && state && 'workspacePath' in state
        ? String((state as { workspacePath?: unknown }).workspacePath ?? '')
        : '';
      window.localStorage.removeItem(`sciforge.right-pane-state.v1.${workspacePath || 'default'}`);
      window.localStorage.removeItem('sciforge.right-pane-state.v1.default');
    }, workspaceState);

    await page.goto(`${uiUrl}/?page=workbench&scenarioId=${SCENARIO_ID}`, { waitUntil: 'domcontentloaded' });
    await waitForResultsPanel(page, pageDiagnostics);
    const projectionLink = page.locator('.message-object-link', { hasText: 'Visible session browser_search projection' }).first();
    await projectionLink.waitFor({ state: 'attached', timeout: 30_000 });
    await startRecorder.drain();
    const startSessionCountBeforeHandoff = startRecorder.sessionIds.length;
    await projectionLink.evaluate((node) => {
      if (node instanceof HTMLButtonElement) node.click();
    });

    await waitForFocusedBrowserProjection(page, visibleSessionId);
    await startRecorder.drain();
    const handoffStartSessionIds = uniqueValues(startRecorder.sessionIds.slice(startSessionCountBeforeHandoff));
    assert.deepEqual(handoffStartSessionIds, []);
    const rightPane = await collectRightPaneEvidence(page);
    assertRightPaneReusesSingleBrowserHostSession(rightPane, visibleSessionId);

    const sessionAfter = await fetchBrowserHostSessionState(writerUrl, workspacePath, visibleSessionId);
    assert.equal(stringField(sessionAfter.id), visibleSessionId);
    assert.equal(sessionAfter.singleInteractiveTruth, true);

    const manifest = buildManifest({
      runId,
      fixtureOrigin,
      sessionBefore,
      sessionAfter,
      rightPane,
      observedStartSessionIds: uniqueValues(startRecorder.sessionIds),
      handoffStartSessionIds,
    });
    assertVisibleSessionDogfoodManifest(manifest, visibleSessionId);
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

async function openBrowserPaneUrl(surface: Locator, url: string) {
  const address = surface.locator('input[aria-label="Browser URL"]');
  await address.fill(url);
}

async function waitForVisibleHostFrame(surface: Locator, expectedUrl: RegExp) {
  await waitForWorkbenchUrl(surface, expectedUrl);
  const hostFrame = surface.locator('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]').first();
  await hostFrame.waitFor({ state: 'visible', timeout: 30_000 });
  let visualFrame = hostFrame.locator('canvas[data-browser-host-surface="browser-host-session"]').first();
  if (!await visualFrame.count()) {
    visualFrame = hostFrame.locator('img[data-browser-host-surface="browser-host-session"]').first();
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
}

async function waitForWorkbenchUrl(surface: Locator, expectedUrl: RegExp) {
  await surface.page().waitForFunction(({ source, flags }) => {
    const viewer = document.querySelector('.right-pane-browser-surface .browser-workbench-viewer');
    const state = viewer?.getAttribute('data-browser-state');
    const url = viewer?.querySelector('header p')?.textContent ?? '';
    return state === 'ready' && new RegExp(source, flags).test(url);
  }, { source: expectedUrl.source, flags: expectedUrl.flags }, { timeout: 45_000 });
}

async function waitForFocusedBrowserProjection(page: Page, expectedSessionId: string) {
  await page.waitForFunction((sessionId) => {
    const root = document.querySelector('.right-pane-browser-surface');
    const viewer = root?.querySelector('.browser-workbench-viewer');
    const liveSurface = root?.querySelector(`[data-browser-live-surface-ref="browser-host-session:${sessionId}/live-surface"]`);
    const hostFrame = root?.querySelector('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]');
    return viewer?.getAttribute('data-browser-state') === 'ready' && Boolean(liveSurface && hostFrame);
  }, expectedSessionId, { timeout: 30_000 });
}

async function currentBrowserHostSession(page: Page, writerUrl: string, workspacePath: string): Promise<JsonRecord> {
  const liveSurfaceRef = await page.locator('.right-pane-browser-surface [data-browser-live-surface-ref^="browser-host-session:"]').first().getAttribute('data-browser-live-surface-ref');
  const sessionId = /^browser-host-session:([^/]+)\//.exec(liveSurfaceRef ?? '')?.[1];
  assert.ok(sessionId, `Missing BrowserHostSession ref: ${String(liveSurfaceRef)}`);
  return fetchBrowserHostSessionState(writerUrl, workspacePath, sessionId);
}

async function fetchBrowserHostSessionState(writerUrl: string, workspacePath: string, sessionId: string): Promise<JsonRecord> {
  const url = new URL(`${writerUrl}/api/sciforge/browser-host/sessions/${encodeURIComponent(sessionId)}/state`);
  url.searchParams.set('workspacePath', workspacePath);
  const json = await fetchJson(url.href);
  const session = recordField(json.session);
  assert.ok(session, 'BrowserHostSession state response must include session');
  return session;
}

function recordBrowserHostSessionStarts(page: Page): {
  sessionIds: string[];
  drain(): Promise<void>;
} {
  const sessionIds: string[] = [];
  const pending = new Set<Promise<void>>();
  const errors: Error[] = [];
  page.on('response', (response: Response) => {
    if (!response.url().endsWith('/api/sciforge/browser-host/sessions/start')) return;
    const task = response.json()
      .then((json: unknown) => {
        const sessionId = stringField(recordField(recordField(json)?.session)?.id);
        if (sessionId) sessionIds.push(sessionId);
      })
      .catch((error: unknown) => {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      });
    pending.add(task);
    task.finally(() => pending.delete(task));
  });
  return {
    sessionIds,
    async drain() {
      await Promise.allSettled([...pending]);
      if (errors.length) throw errors[0];
    },
  };
}

async function collectRightPaneEvidence(page: Page): Promise<RightPaneBoundedEvidence> {
  return page.evaluate(`(() => {
    const root = document.querySelector('.right-pane-browser-surface');
    const attrs = [];
    for (const node of Array.from(root ? root.querySelectorAll('*') : [])) {
      for (const attribute of Array.from(node.attributes)) {
        attrs.push({ name: attribute.name, value: attribute.value });
      }
    }
    const attrValues = (name) => Array.from(new Set(attrs.filter((attr) => attr.name === name).map((attr) => attr.value).filter(Boolean))).sort();
    const sessionIds = Array.from(new Set(attrs.flatMap((attr) => (
      Array.from(attr.value.matchAll(/browser-host-session:([^/"<\\s]+)/g)).map((match) => (match[1] || '').split('/')[0])
    )).filter(Boolean))).sort();
    const count = (selector) => root ? root.querySelectorAll(selector).length : 0;
    return {
      state: (root && root.querySelector('.browser-workbench-viewer') && root.querySelector('.browser-workbench-viewer').getAttribute('data-browser-state')) || '',
      sessionIds,
      liveSurfaceRefs: attrValues('data-browser-live-surface-ref'),
      frameStreamRefs: attrValues('data-browser-frame-stream-ref'),
      frameRefs: attrValues('data-browser-frame-ref'),
      transports: attrValues('data-browser-live-surface-transport'),
      singleInteractiveTruthValues: attrValues('data-browser-single-interactive-truth'),
      hostBrowserObjects: count('[data-browser-object-type="host-browser"]'),
      hostFrames: count('.browser-workbench-host-frame[data-browser-host-surface="browser-host-session"]'),
      imageSurfaces: count('img[data-browser-host-surface="browser-host-session"]'),
      canvasSurfaces: count('canvas[data-browser-host-surface="browser-host-session"]'),
      nativeSurfaces: count('[data-browser-native-surface="true"]'),
      iframeSurfaces: count('iframe'),
      proxySurfaces: count('iframe[src*="/api/sciforge/browser/proxy"], [data-browser-state-action="proxy-fallback"]'),
      webviewSurfaces: count('webview'),
      systemPopupSurfaces: count('[data-browser-host-surface="system-browser-window"], [data-browser-live-surface-transport="system-popup"]'),
      dataImageSurfaces: count('img[src^="data:"]'),
      base64Attributes: attrs.filter((attr) => /base64|;base64,/i.test(attr.value)).length,
    };
  })()`) as Promise<RightPaneBoundedEvidence>;
}

function assertRightPaneReusesSingleBrowserHostSession(evidence: RightPaneBoundedEvidence, expectedSessionId: string) {
  assert.equal(evidence.state, 'ready');
  assert.deepEqual(evidence.sessionIds, [expectedSessionId]);
  assert.deepEqual(evidence.liveSurfaceRefs, [`browser-host-session:${expectedSessionId}/live-surface`]);
  assert.deepEqual(evidence.frameStreamRefs, [`browser-host-session:${expectedSessionId}/frame-stream`]);
  assert.deepEqual(evidence.transports, ['host-stream']);
  assert.deepEqual(evidence.singleInteractiveTruthValues, ['true']);
  assert.equal(evidence.hostBrowserObjects, 1);
  assert.equal(evidence.hostFrames, 1);
  assert.equal(evidence.imageSurfaces + evidence.canvasSurfaces + evidence.nativeSurfaces, 1);
  assert.equal(evidence.iframeSurfaces, 0);
  assert.equal(evidence.proxySurfaces, 0);
  assert.equal(evidence.webviewSurfaces, 0);
  assert.equal(evidence.systemPopupSurfaces, 0);
  assert.equal(evidence.dataImageSurfaces, 0);
  assert.equal(evidence.base64Attributes, 0);
}

function buildWorkspaceState(input: {
  runId: string;
  workspacePath: string;
  writerUrl: string;
  fixtureOrigin: string;
  hostSession: JsonRecord;
}): JsonRecord {
  const now = new Date().toISOString();
  const sessionId = `session-${input.runId}`;
  const hostSession = sanitizedHostSession(input.hostSession);
  const browserSessionRef = `browser-host-session:${hostSession.id}`;
  const projectionRef = `artifact:${PROJECTION_ID}`;
  const objectReference = {
    id: 'obj-browser-search-visible-session-dogfood-projection',
    kind: 'artifact',
    title: 'Visible session browser_search projection',
    ref: projectionRef,
    artifactType: 'browser-runtime-projection',
    preferredView: 'browser-workbench',
    presentationRole: 'supporting-evidence',
    actions: ['focus-right-pane', 'copy-path', 'pin'],
    status: 'available',
    summary: `Refs-first projection reusing ${browserSessionRef}.`,
    provenance: {
      producer: 'sciforge.browser-host-session',
      dataRef: browserSessionRef,
      browserSessionRef,
      projectionRef,
    },
  };
  const projectionArtifact = {
    id: PROJECTION_ID,
    type: 'browser-runtime-projection',
    producerScenario: SCENARIO_ID,
    schemaVersion: 'sciforge.browser-runtime.projection.v1',
    metadata: {
      source: 'browser_search_visible_session_dogfood',
      providerId: 'sciforge.browser-host-session',
      browserSessionRef,
      projectionRef,
      finalUrlHash: hashText(stringField(hostSession.url)),
    },
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: projectionRef,
      role: 'supporting-evidence',
      declaredMediaType: 'application/vnd.sciforge.browser-runtime-projection+json',
      declaredExtension: 'browser-runtime-projection',
      contentShape: 'raw-file',
      readableRef: `${browserSessionRef}/projection`,
      previewPolicy: 'inline',
    },
    data: {
      session: {
        id: hostSession.id,
        mode: 'agent-headless',
        providerId: 'sciforge.browser-host-session',
        activeTabId: `${hostSession.id}:tab`,
        tabs: [{
          id: `${hostSession.id}:tab`,
          url: hostSession.url,
          title: hostSession.title || hostSession.url,
          status: hostSession.status === 'loading' || hostSession.status === 'starting' ? 'loading' : 'ready',
        }],
        updatedAt: hostSession.updatedAt,
      },
      hostSession,
      snapshot: {
        schemaVersion: 'sciforge.browser-runtime.snapshot.v1',
        url: hostSession.url,
        title: hostSession.title,
        searchResultRef: hostSession.searchResultRef,
        screenshotRef: hostSession.screenshotRef,
        domSnapshotRef: hostSession.domSnapshotRef,
        axSnapshotRef: hostSession.axSnapshotRef,
        consoleLogRef: hostSession.consoleLogRef,
        networkLogRef: hostSession.networkLogRef,
      },
      provenance: {
        browserSessionRef,
        projectionRef,
        handoff: 'local-ui-fixture',
      },
    },
  };
  const searchResultsArtifact = {
    id: SEARCH_RESULTS_ID,
    type: 'browser-search-results',
    producerScenario: SCENARIO_ID,
    schemaVersion: 'sciforge.browser-host-search.results.v1',
    metadata: {
      source: 'browser_search',
      browserSessionRef,
      projectionRef,
      finalUrlHash: hashText(stringField(hostSession.url)),
    },
    data: {
      queryHash: hashText('visible session handoff dogfood'),
      browserSessionRef,
      projectionRef,
      resultCount: 1,
      searchResultRef: hostSession.searchResultRef,
      screenshotRef: hostSession.screenshotRef,
      domSnapshotRef: hostSession.domSnapshotRef,
      axSnapshotRef: hostSession.axSnapshotRef,
      consoleLogRef: hostSession.consoleLogRef,
      networkLogRef: hostSession.networkLogRef,
    },
  };
  return {
    schemaVersion: 2,
    workspacePath: input.workspacePath,
    sessionsByScenario: {
      [SCENARIO_ID]: {
        schemaVersion: 2,
        sessionId,
        scenarioId: SCENARIO_ID,
        title: 'Browser search visible session dogfood',
        createdAt: now,
        updatedAt: now,
        messages: [{
          id: 'msg-browser-search-visible-session-dogfood',
          role: 'scenario',
          content: `Local UI payload handoff ready: ${projectionRef}`,
          confidence: 0.82,
          evidenceLevel: 'runtime',
          claimType: 'fact',
          createdAt: now,
          status: 'completed',
          objectReferences: [objectReference],
        }],
        runs: [{
          id: 'run-browser-search-visible-session-dogfood',
          status: 'completed',
          prompt: 'browser_search visible session dogfood',
          response: 'Local UI payload handoff focused a browser-runtime-projection artifact.',
          createdAt: now,
          completedAt: now,
          objectReferences: [objectReference],
        }],
        uiManifest: [],
        claims: [],
        executionUnits: [{
          id: 'EU-browser-search-visible-session-dogfood',
          tool: 'browser_search',
          status: 'done',
          params: JSON.stringify({ queryHash: hashText('visible session handoff dogfood'), sessionId: hostSession.id }),
          hash: hashText(`${hostSession.id}:${hostSession.searchResultRef ?? ''}`),
          environment: 'sciforge.browser-host-session',
          runtimeProfileId: 'browser-host-search-runtime',
          selectedRuntime: 'browser-host-search-runtime',
          outputRef: hostSession.searchResultRef,
        }],
        artifacts: [searchResultsArtifact, projectionArtifact],
        notebook: [],
        versions: [],
        hiddenResultSlotIds: [],
      },
    },
    archivedSessions: [],
    alignmentContracts: [],
    feedbackComments: [],
    feedbackRequests: [],
    githubSyncedOpenIssues: [],
    feedbackRepairActions: [],
    feedbackRepairGuidance: [],
    timelineEvents: [],
    updatedAt: now,
  };
}

function sanitizedHostSession(session: JsonRecord): JsonRecord {
  const id = stringField(session.id);
  return {
    schemaVersion: stringField(session.schemaVersion) || 'sciforge.browser-host-session.state.v1',
    id,
    owner: stringField(session.owner) || 'host',
    providerId: stringField(session.providerId) || 'sciforge.browser-host-session',
    status: stringField(session.status) || 'ready',
    workspacePath: stringField(session.workspacePath),
    workspaceWriterBaseUrl: stringField(session.workspaceWriterBaseUrl),
    requestedUrl: stringField(session.requestedUrl),
    url: stringField(session.url),
    title: stringField(session.title),
    startedAt: stringField(session.startedAt),
    updatedAt: stringField(session.updatedAt),
    viewport: recordField(session.viewport),
    canGoBack: session.canGoBack === true,
    canGoForward: session.canGoForward === true,
    liveSurfaceRef: stringField(session.liveSurfaceRef) || `browser-host-session:${id}/live-surface`,
    liveSurfaceTransport: stringField(session.liveSurfaceTransport) || 'host-stream',
    singleInteractiveTruth: session.singleInteractiveTruth === true,
    frameStreamRef: stringField(session.frameStreamRef) || `browser-host-session:${id}/frame-stream`,
    frameRef: stringField(session.frameRef),
    screenshotRef: stringField(session.screenshotRef),
    domSnapshotRef: stringField(session.domSnapshotRef),
    axSnapshotRef: stringField(session.axSnapshotRef),
    consoleLogRef: stringField(session.consoleLogRef),
    networkLogRef: stringField(session.networkLogRef),
    searchResultRef: stringField(session.searchResultRef),
    actionTimingSummary: Array.isArray(session.actionTimingSummary)
      ? session.actionTimingSummary.filter((entry) => Boolean(recordField(entry))).slice(0, 12)
      : [],
    diagnostics: Array.isArray(session.diagnostics) ? session.diagnostics.filter((entry) => typeof entry === 'string').slice(0, 8) : [],
  };
}

async function persistWorkspaceState(writerUrl: string, workspacePath: string, state: JsonRecord, config: JsonRecord) {
  const response = await fetch(`${writerUrl}/api/sciforge/workspace/snapshot`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ workspacePath, state, config }),
  });
  if (!response.ok) throw new Error(`Persist workspace state failed: HTTP ${response.status}`);
}

function buildManifest(input: {
  runId: string;
  fixtureOrigin: string;
  sessionBefore: JsonRecord;
  sessionAfter: JsonRecord;
  rightPane: RightPaneBoundedEvidence;
  observedStartSessionIds: string[];
  handoffStartSessionIds: string[];
}): VisibleSessionDogfoodManifest {
  const before = browserHostSessionSummary(input.sessionBefore);
  const after = browserHostSessionSummary(input.sessionAfter);
  return {
    schemaVersion: DOGFOOD_SCHEMA,
    status: 'passed',
    runId: input.runId,
    observedAt: new Date().toISOString(),
    shell: 'web-right-pane',
    targetOriginRef: `fixture-origin:${hashText(input.fixtureOrigin)}`,
    trigger: {
      mode: 'local-ui-payload-handoff',
      equivalentTool: 'browser_search',
      focusedVia: 'message-object-reference-click',
      projectionRef: `artifact:${PROJECTION_ID}`,
      browserSessionRef: `browser-host-session:${before.id}`,
      objectReferencePreferredView: 'browser-workbench',
    },
    browserHostSession: {
      beforeHandoff: before,
      afterHandoff: after,
      observedStartSessionIds: input.observedStartSessionIds,
      handoffStartSessionIds: input.handoffStartSessionIds,
      uniqueRightPaneSessionIds: input.rightPane.sessionIds,
    },
    rightPane: input.rightPane,
    continuity: {
      sameBrowserHostSessionId: true,
      singleBrowserHostSessionId: true,
      secondOwnerOpened: false,
      hostBrowserObjectCount: 1,
    },
    forbiddenEvidence: {
      iframe: false,
      proxy: false,
      webview: false,
      systemPopup: false,
      domDump: false,
      base64: false,
      screenshotImage: false,
      screenshotBinary: false,
    },
    verificationCommand: 'node --import tsx --test tests/smoke/smoke-browser-search-visible-session-dogfood.test.ts',
  };
}

function browserHostSessionSummary(session: JsonRecord): BrowserHostSessionSummary {
  return {
    id: stringField(session.id),
    owner: stringField(session.owner),
    status: stringField(session.status),
    transport: stringField(session.liveSurfaceTransport),
    singleInteractiveTruth: session.singleInteractiveTruth === true,
    liveSurfaceRef: stringField(session.liveSurfaceRef),
    refs: {
      frameStreamRef: stringField(session.frameStreamRef),
      frameRef: stringField(session.frameRef),
      screenshotRef: stringField(session.screenshotRef),
      domSnapshotRef: stringField(session.domSnapshotRef),
      axSnapshotRef: stringField(session.axSnapshotRef),
      consoleLogRef: stringField(session.consoleLogRef),
      networkLogRef: stringField(session.networkLogRef),
      searchResultRef: stringField(session.searchResultRef),
    },
  };
}

function assertVisibleSessionDogfoodManifest(manifest: VisibleSessionDogfoodManifest, expectedSessionId: string) {
  assert.equal(manifest.schemaVersion, DOGFOOD_SCHEMA);
  assert.equal(manifest.status, 'passed');
  assert.equal(manifest.trigger.browserSessionRef, `browser-host-session:${expectedSessionId}`);
  assert.equal(manifest.trigger.objectReferencePreferredView, 'browser-workbench');
  assert.equal(manifest.browserHostSession.beforeHandoff.id, expectedSessionId);
  assert.equal(manifest.browserHostSession.afterHandoff.id, expectedSessionId);
  assert.deepEqual(manifest.browserHostSession.observedStartSessionIds, [expectedSessionId]);
  assert.deepEqual(manifest.browserHostSession.handoffStartSessionIds, []);
  assert.deepEqual(manifest.browserHostSession.uniqueRightPaneSessionIds, [expectedSessionId]);
  assert.equal(manifest.browserHostSession.beforeHandoff.transport, 'host-stream');
  assert.equal(manifest.browserHostSession.afterHandoff.transport, 'host-stream');
  assert.equal(manifest.browserHostSession.beforeHandoff.singleInteractiveTruth, true);
  assert.equal(manifest.browserHostSession.afterHandoff.singleInteractiveTruth, true);
  assert.equal(manifest.continuity.sameBrowserHostSessionId, true);
  assert.equal(manifest.continuity.singleBrowserHostSessionId, true);
  assert.equal(manifest.continuity.secondOwnerOpened, false);
  assert.equal(manifest.continuity.hostBrowserObjectCount, 1);
  assertRightPaneReusesSingleBrowserHostSession(manifest.rightPane, expectedSessionId);
  assert.deepEqual(Object.values(manifest.forbiddenEvidence), [false, false, false, false, false, false, false, false]);
  const serialized = JSON.stringify(manifest);
  assert.doesNotMatch(serialized, /<!doctype|<html|<body|outerHTML|innerHTML|data:image|;base64,|base64(?:Data|Payload|Inline|Bytes)|iVBORw0KGgo|screenshot(?:Data|Base64|Inline|Bytes)|raw(?:Dom|DOM|Html|HTML|Screenshot|Payload)/i);
}

async function startVisibleSessionFixture(port: number): Promise<{ close(): Promise<void> }> {
  const server = createHttpServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://${FIXTURE_HOST}:${port}`);
    if (url.pathname === '/search') {
      writeHtml(res, pageShell('Visible Session Dogfood', `
        <main>
          <h1>Visible Session Dogfood</h1>
          <form action="/results" method="get">
            <input name="q" autofocus aria-label="Search query" value="visible session handoff" />
            <button type="submit">Search</button>
          </form>
          <p>BrowserHostSession visible page for refs-first handoff verification.</p>
        </main>
      `));
      return;
    }
    if (url.pathname === '/results') {
      writeHtml(res, pageShell('Visible Session Results', `
        <main>
          <h1>Visible Session Results</h1>
          <p>Bounded result page for BrowserHostSession continuity.</p>
        </main>
      `));
      return;
    }
    writeHtml(res, pageShell('Visible Session Dogfood', '<main><h1>Visible Session Dogfood</h1></main>'));
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => resolveListen());
  });
  return {
    close: () => stopHttpServer(server),
  };
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
      input { box-sizing: border-box; width: 520px; height: 42px; padding: 8px 12px; font-size: 17px; border: 2px solid #18484f; border-radius: 4px; background: white; color: #102024; }
      button { height: 42px; padding: 0 18px; border: 0; border-radius: 4px; background: #18484f; color: white; font-size: 15px; }
      h1 { margin: 0 0 14px; font-size: 24px; }
      p { max-width: 720px; line-height: 1.5; }
    </style>
  </head>
  <body>${body}</body>
</html>`;
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

function uniqueValues(values: string[]) {
  return [...new Set(values)].sort();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function delay(ms: number) {
  return new Promise<void>((resolveDelay) => setTimeout(resolveDelay, ms));
}
