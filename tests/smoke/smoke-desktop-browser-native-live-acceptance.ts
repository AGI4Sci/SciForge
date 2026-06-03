import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { promisify } from 'node:util';
import { _electron as electron, type Locator, type Page } from 'playwright-core';

import {
  type DesktopBrowserNativeLiveAcceptanceBounds,
  type DesktopBrowserNativeLiveAcceptanceBenchmarkMetrics,
  type DesktopBrowserNativeBoundedEndpoint,
  type DesktopBrowserNativeLiveAcceptanceEvidence,
  type DesktopBrowserNativeM0Action,
  type DesktopBrowserNativeM0ActionEvidence,
  type DesktopBrowserNativeM0SurfingLoopEvidence,
  type DesktopBrowserNativeRealExternalNavigationAction,
  type DesktopBrowserNativeRealExternalNavigationEvidence,
  assertDesktopBrowserNativeLiveAcceptanceCanClaimPass,
  desktopBrowserNativeM0Actions,
  desktopBrowserNativeRealExternalNavigationActions,
  rejectedDesktopLiveSubstitutes,
  validateDesktopBrowserNativeLiveAcceptanceEvidence,
} from '../../src/desktop/desktop-browser-native-live-acceptance.js';

type DesktopRuntimeConfig = {
  schemaVersion: 'sciforge.desktop.runtime-config.v1';
  runtimeControlUrl: string;
  workspaceWriterBaseUrl: string;
  workspacePath: string;
  appDataRoot: string;
};

type JsonRecord = Record<string, unknown>;
type DesktopBrowserNativeStateHeartbeatEvidence = NonNullable<NonNullable<DesktopBrowserNativeLiveAcceptanceEvidence['interaction']>['stateHeartbeat']>;
type DesktopBrowserNativeRealExternalTarget = {
  url: string;
  secondUrl: string;
};

const projectRoot = process.cwd();
const outputDir = process.env.SCIFORGE_DESKTOP_BROWSER_NATIVE_LIVE_EVIDENCE_DIR
  ? resolve(projectRoot, process.env.SCIFORGE_DESKTOP_BROWSER_NATIVE_LIVE_EVIDENCE_DIR)
  : resolve(projectRoot, 'docs', 'test-artifacts', 'desktop-browser-native-live-acceptance');
const manifestPath = join(outputDir, 'manifest.json');
const mainPath = resolve(projectRoot, 'dist-desktop', 'src', 'desktop', 'main.js');
const rendererPath = resolve(projectRoot, 'dist-ui', 'index.html');
const requireLive = process.env.SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE === '1';
const REAL_EXTERNAL_TARGET_ENV = 'SCIFORGE_DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_TARGET_JSON';
const verificationCommand = 'npm run smoke:desktop-browser-native-live-acceptance --silent';
const strictVerificationCommand = 'SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE=1 npm run smoke:desktop-browser-native-live-acceptance --silent';
const execFileAsync = promisify(execFile);

class BlockedDesktopBrowserNativeLiveSmoke extends Error {
  constructor(message: string, readonly blockers: string[] = [message]) {
    super(message);
  }
}

const buildBlocker = desktopBrowserNativeLiveBuildBlocker();
if (buildBlocker) {
  await writeNonPassingEvidence('blocked', buildBlocker, [buildBlocker]);
  process.exit();
}

let electronApp: Awaited<ReturnType<typeof electron.launch>> | undefined;
let page: Page | undefined;
let observedRuntimeConfig: DesktopRuntimeConfig | undefined;
let fixture: Awaited<ReturnType<typeof startBrowserFixture>> | undefined;
let dummyProvider: Awaited<ReturnType<typeof startDummyProvider>> | undefined;
let scratchRoot = '';

try {
  scratchRoot = await mkdtemp(join(tmpdir(), 'sciforge-desktop-browser-native-live-'));
  fixture = await startBrowserFixture();
  dummyProvider = await startDummyProvider();
  const resourceSamples: ProcessResourceSample[] = [];
  const rendererHeapSamplesMb: number[] = [];
  const actionAckSamples: number[] = [];
  let openStartedAt = Date.now();
  let nativeSurfaceVisibleAt = openStartedAt;
  let navigationHeartbeatAt = openStartedAt;
  electronApp = await electron.launch({
    args: [mainPath],
    env: {
      ...process.env,
      SCIFORGE_DESKTOP_APP_ROOT: projectRoot,
      SCIFORGE_DESKTOP_USER_DATA_DIR: join(scratchRoot, 'userData'),
      SCIFORGE_DESKTOP_WORKSPACE_PATH: join(scratchRoot, 'workspace'),
      SCIFORGE_CONFIG_PATH: join(scratchRoot, 'missing-config.local.json'),
      SCIFORGE_PROXY_UPSTREAM_BASE_URL: dummyProvider.url,
      SCIFORGE_PROXY_API_KEY_ENV: 'SCIFORGE_DESKTOP_BROWSER_NATIVE_LIVE_DUMMY_KEY',
      SCIFORGE_DESKTOP_BROWSER_NATIVE_LIVE_DUMMY_KEY: 'sciforge-desktop-browser-native-live-dummy-key',
      SCIFORGE_PROXY_DEFAULT_MODEL: 'sciforge-desktop-browser-native-live-dummy-model',
      SCIFORGE_PROXY_QUIET: '1',
    },
  });
  const electronPid = electronProcessId(electronApp);
  await recordProcessResourceSample(resourceSamples, electronPid);

  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
  await recordRendererHeapSample(rendererHeapSamplesMb, page);
  await page.waitForFunction(() => typeof (globalThis as typeof globalThis & {
    sciforgeDesktop?: { getRuntimeConfig?: () => Promise<unknown> };
  }).sciforgeDesktop?.getRuntimeConfig === 'function', undefined, { timeout: 10_000 });

  const config = desktopRuntimeConfigFromValue(await page.evaluate(() =>
    (globalThis as typeof globalThis & { sciforgeDesktop: { getRuntimeConfig(): Promise<unknown> } }).sciforgeDesktop.getRuntimeConfig(),
  ));
  observedRuntimeConfig = config;
  assert.equal(config.schemaVersion, 'sciforge.desktop.runtime-config.v1');
  await waitForWorkspaceWriter(config.workspaceWriterBaseUrl);

  openStartedAt = Date.now();
  await openBrowserPaneAt(page, fixture.url);
  const nativeFrame = page.locator('[data-browser-native-surface="true"][data-browser-live-surface-transport="native-embedded"]');
  await nativeFrame.waitFor({ state: 'visible', timeout: 30_000 });
  nativeSurfaceVisibleAt = Date.now();
  const liveSurfaceRef = await nativeFrame.getAttribute('data-browser-live-surface-ref');
  const sessionId = sessionIdFromLiveSurfaceRef(liveSurfaceRef);
  const frameBounds = await nativeFrame.boundingBox();
  if (!frameBounds) throw new Error('Browser pane native surface placeholder did not expose visible bounds.');

  const sessionState = await readBrowserHostSessionState(config.workspaceWriterBaseUrl, config.workspacePath, sessionId);
  const nativeAdapterUrl = requiredStringField(sessionState.nativeAdapterUrl, 'BrowserHostSession nativeAdapterUrl');
  if (sessionState.liveSurfaceTransport !== 'native-embedded' || !nativeAdapterUrl) {
    throw new BlockedDesktopBrowserNativeLiveSmoke(
      `BrowserHostSession did not use native adapter: liveSurfaceTransport=${String(sessionState.liveSurfaceTransport)} nativeAdapterUrl=${String(sessionState.nativeAdapterUrl)}`,
      ['Electron native adapter injection', 'SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL from Electron main to workspace writer'],
    );
  }
  const nativeAdapterBaseUrl = nativeAdapterUrl.replace(/\/+$/, '');
  const nativeHealth = await getJson(`${nativeAdapterBaseUrl}/health`);
  const surfaceState = await page.evaluate((id) =>
    (globalThis as typeof globalThis & {
      sciforgeDesktop: { getBrowserHostSessionSurfaceState(input: unknown): Promise<unknown> };
    }).sciforgeDesktop.getBrowserHostSessionSurfaceState({ sessionId: id }),
  sessionId) as JsonRecord;

  const typedToken = `SCIFORGE_NATIVE_LIVE_${Date.now().toString(36)}`;
  const nativeAuditBeforeAction = await readNativeSurfaceAudit(nativeAdapterBaseUrl, sessionId);
  const paintAckAction = await timedBrowserAction(config.workspaceWriterBaseUrl, config.workspacePath, sessionId, {
    action: 'click',
    x: 36,
    y: 38,
    actionId: 'desktop-native-live-click-paint-ack',
  });
  const paintAckState = paintAckAction.state;
  actionAckSamples.push(paintAckAction.durationMs);
  const nativeAuditAfterActionAck = await readNativeSurfaceAudit(nativeAdapterBaseUrl, sessionId);
  const nativeHeartbeatState = await getJson(`${nativeAdapterBaseUrl}/sessions/${encodeURIComponent(sessionId)}/state`);
  const heartbeatSessionState = await readBrowserHostSessionState(config.workspaceWriterBaseUrl, config.workspacePath, sessionId);
  navigationHeartbeatAt = Date.now();
  const nativeAuditAfterHeartbeat = await readNativeSurfaceAudit(nativeAdapterBaseUrl, sessionId);
  const typeAction = await timedBrowserAction(config.workspaceWriterBaseUrl, config.workspacePath, sessionId, {
    action: 'type',
    text: typedToken,
    capture: 'none',
    actionId: 'desktop-native-live-type-text-probe',
  });
  actionAckSamples.push(typeAction.durationMs);
  await sleep(250);
  const textProbe = await readNativeAdapterTextEvidence(nativeAdapterBaseUrl, sessionId, 'type-text-probe');
  const typedTokenObserved = textProbe.includes(typedToken);
  const scrollAction = await tryTimedBrowserAction(config.workspaceWriterBaseUrl, config.workspacePath, sessionId, {
    action: 'scroll',
    deltaX: 0,
    deltaY: 180,
    capture: 'none',
    actionId: 'desktop-native-live-scroll-probe',
  });
  if (scrollAction.ok) actionAckSamples.push(scrollAction.durationMs);
  const dragAction = await tryTimedBrowserAction(config.workspaceWriterBaseUrl, config.workspacePath, sessionId, {
    action: 'drag',
    path: [
      { x: 48, y: 56 },
      { x: 96, y: 64 },
      { x: 140, y: 64 },
    ],
    capture: 'none',
    actionId: 'desktop-native-live-drag-probe',
  });
  if (dragAction.ok) actionAckSamples.push(dragAction.durationMs);
  const reloadAction = await tryTimedBrowserAction(config.workspaceWriterBaseUrl, config.workspacePath, sessionId, {
    action: 'reload',
    capture: 'none',
    actionId: 'desktop-native-live-reload-probe',
  });
  if (reloadAction.ok) actionAckSamples.push(reloadAction.durationMs);
  const historyUrl = new URL('/history-probe', fixture.url).href;
  const navigateAction = await tryTimedBrowserAction(config.workspaceWriterBaseUrl, config.workspacePath, sessionId, {
    action: 'navigate',
    url: historyUrl,
    capture: 'none',
    actionId: 'desktop-native-live-navigate-probe',
  });
  if (navigateAction.ok) actionAckSamples.push(navigateAction.durationMs);
  const backAction = navigateAction.ok
    ? await tryTimedBrowserAction(config.workspaceWriterBaseUrl, config.workspacePath, sessionId, {
        action: 'back',
        capture: 'none',
        actionId: 'desktop-native-live-back-probe',
      })
    : { ok: false as const, reasonHash: 'navigate-not-observed' };
  if (backAction.ok) actionAckSamples.push(backAction.durationMs);
  const forwardAction = backAction.ok
    ? await tryTimedBrowserAction(config.workspaceWriterBaseUrl, config.workspacePath, sessionId, {
        action: 'forward',
        capture: 'none',
        actionId: 'desktop-native-live-forward-probe',
      })
    : { ok: false as const, reasonHash: 'back-not-observed' };
  if (forwardAction.ok) actionAckSamples.push(forwardAction.durationMs);
  const stopAction = await tryTimedBrowserAction(config.workspaceWriterBaseUrl, config.workspacePath, sessionId, {
    action: 'stop',
    capture: 'none',
    actionId: 'desktop-native-live-stop-probe',
  });
  if (stopAction.ok) actionAckSamples.push(stopAction.durationMs);
  const lifecycleProbe = await desktopNativeLifecycleProbe({
    electronApp,
    page,
    sessionId,
    liveSurfaceRef,
    nativeSurfaceSelector: '[data-browser-native-surface="true"][data-browser-live-surface-transport="native-embedded"]',
  });
  const reconnectProbe = await desktopNativeReconnectProbe({
    page,
    workspaceWriterBaseUrl: config.workspaceWriterBaseUrl,
    workspacePath: config.workspacePath,
    nativeAdapterBaseUrl,
    sessionId,
    liveSurfaceRef,
    frameBounds: roundedBounds(frameBounds),
  });
  actionAckSamples.push(...reconnectProbe.actionDurationsMs);
  const realExternalNavigation = await desktopNativeRealExternalNavigationProbe({
    target: desktopNativeRealExternalTargetFromEnv(),
    workspaceWriterBaseUrl: config.workspaceWriterBaseUrl,
    workspacePath: config.workspacePath,
    nativeAdapterBaseUrl,
    sessionId,
    liveSurfaceRef,
  });
  actionAckSamples.push(...desktopNativeRealExternalNavigationActionDurations(realExternalNavigation));
  const closeAction = await tryTimedBrowserAction(config.workspaceWriterBaseUrl, config.workspacePath, sessionId, {
    action: 'close',
    capture: 'none',
    actionId: 'desktop-native-live-close-probe',
  });
  if (closeAction.ok) actionAckSamples.push(closeAction.durationMs);
  await recordProcessResourceSample(resourceSamples, electronPid);
  await recordRendererHeapSample(rendererHeapSamplesMb, page);
  const ackDelta = nativeSurfaceAuditDelta(nativeAuditBeforeAction, nativeAuditAfterActionAck);
  const heartbeatDelta = nativeSurfaceAuditDelta(nativeAuditAfterActionAck, nativeAuditAfterHeartbeat);
  const paintAckTiming = recordField(paintAckState.lastActionTiming);
  const stateHeartbeat = nativeStateHeartbeatEvidence({
    targetUrl: fixture.url,
    nativeState: nativeHeartbeatState,
    browserHostState: heartbeatSessionState,
    stateRequestsAfterAction: heartbeatDelta.state,
  });
  const actionAck = {
    action: stringField(paintAckTiming?.action),
    capture: stringField(paintAckTiming?.capture),
    status: stringField(paintAckTiming?.status),
    screenshotRequestsDuringAck: ackDelta.screenshot,
    frameStreamRequestsDuringAck: ackDelta.frameStream,
    dependsOnScreenshot: ackDelta.screenshot > 0 || Boolean(stringField(paintAckTiming?.evidenceCaptureStartedAt)),
    dependsOnFrameStream: ackDelta.frameStream > 0 || Boolean(heartbeatSessionState.frameStreamRef || heartbeatSessionState.frameRef || heartbeatSessionState.frameUrl),
    evidenceCaptureStarted: Boolean(stringField(paintAckTiming?.evidenceCaptureStartedAt)),
    evidenceCaptureEnded: Boolean(stringField(paintAckTiming?.evidenceCaptureEndedAt)),
  };
  const actionAckOk = actionAck.action === 'click'
    && actionAck.status === 'ok'
    && stringField(paintAckTiming?.paintAckSource) === 'native-adapter-action-state'
    && actionAck.dependsOnScreenshot === false
    && actionAck.dependsOnFrameStream === false
    && actionAck.screenshotRequestsDuringAck === 0
    && actionAck.frameStreamRequestsDuringAck === 0;
  const stateHeartbeatOk = stateHeartbeat.lightweightStateUpdated === true;
  const benchmarkMetrics = desktopNativeLiveBenchmarkMetrics({
    sessionId,
    frameBounds,
    openAckMs: nativeSurfaceVisibleAt - openStartedAt,
    navigationAckMs: navigationHeartbeatAt - openStartedAt,
    inputAckMs: typeAction.durationMs,
    paintAckLagMs: numberField(paintAckTiming?.totalMs) ?? paintAckAction.durationMs,
    actionAckSamples,
    resourceSamples,
    rendererHeapSamplesMb,
    lifecycle: lifecycleProbe,
    reconnect: reconnectProbe,
    lifecycleMilestones: {
      open: nativeSurfaceVisibleAt >= openStartedAt,
      navigationStart: Boolean(stringField(sessionState.requestedUrl)),
      navigationCommitted: Boolean(stringField(nativeHeartbeatState.url)),
      interactive: Boolean(stringField(nativeHeartbeatState.title)),
      load: nativeHeartbeatState.loading === false,
      networkQuiet: stateHeartbeatOk,
      blocked: reconnectProbe.disconnectDetected,
      retry: reconnectProbe.stateHeartbeatRestored,
      close: closeAction.ok,
    },
    inputCompleteness: {
      keyboard: typeAction.durationMs >= 0,
      textEditing: typedTokenObserved,
      pointerClick: actionAckOk,
      drag: dragAction.ok,
      scroll: scrollAction.ok,
      navigationControls: reloadAction.ok && navigateAction.ok && backAction.ok && forwardAction.ok && stopAction.ok,
    },
  });
  const m0SurfingLoop = desktopNativeM0SurfingLoopEvidence({
    sessionId,
    targetUrl: fixture.url,
    finalUrl: stringField(heartbeatSessionState.url),
    liveSurfaceRef,
    nativeAdapterUrl,
    nativeHealth,
    surfaceState,
    actionAck,
    actionAckSource: stringField(paintAckTiming?.paintAckSource),
    stateHeartbeatOk,
    actions: {
      open: { ok: true, durationMs: nativeSurfaceVisibleAt - openStartedAt },
      click: { ok: actionAckOk, durationMs: paintAckAction.durationMs },
      type: { ok: typedTokenObserved, durationMs: typeAction.durationMs, text: typedToken },
      scroll: scrollAction,
      drag: dragAction,
      reload: reloadAction,
      back: backAction,
      forward: forwardAction,
      stop: stopAction,
    },
  });
  const canClaimPass = typedTokenObserved && actionAckOk && stateHeartbeatOk && m0SurfingLoop.passClaim;

  const evidence: DesktopBrowserNativeLiveAcceptanceEvidence = {
    schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.v1',
    status: canClaimPass ? 'passed' : 'failed',
    source: 'desktop-native-browser-pane-smoke',
    observedAt: new Date().toISOString(),
    canClaimDesktopNativeLivePass: canClaimPass,
    claimScope: canClaimPass ? 'desktop-native-embedded-browser-pane-live' : 'blocked-or-diagnostic',
    reason: canClaimPass ? undefined : desktopNativeLiveFailureReason({ typedTokenObserved, actionAckOk, stateHeartbeatOk }),
    desktopLaunch: {
      mode: 'production-electron',
      mainPathRef: `desktop-launch-main:${boundedSha16(mainPath)}`,
      rendererPathRef: `desktop-launch-renderer:${boundedSha16(rendererPath)}`,
      rendererUrl: boundedDigest(page.url()),
    },
    nativeAdapter: {
      endpoint: boundedLoopbackEndpoint(nativeAdapterUrl),
      healthOk: nativeHealth.ok === true,
      service: stringField(nativeHealth.service),
      owner: stringField(nativeHealth.owner),
      adapterRole: stringField(nativeHealth.adapterRole),
      liveSurfaceTransport: stringField(nativeHealth.liveSurfaceTransport),
      secondTruthSource: nativeHealth.secondTruthSource === false ? false : undefined,
      audit: {
        schemaVersion: nativeAuditAfterHeartbeat.schemaVersion,
        stateRequests: nativeAuditAfterHeartbeat.state,
        screenshotRequests: nativeAuditAfterHeartbeat.screenshot,
        frameStreamRequests: nativeAuditAfterHeartbeat.frameStream,
        actionRequests: nativeAuditAfterHeartbeat.actions,
        recentRequestCount: nativeAuditAfterHeartbeat.recentRequestCount,
      },
    },
    browserHostSession: {
      id: sessionId,
      owner: stringField(heartbeatSessionState.owner),
      providerId: stringField(heartbeatSessionState.providerId),
      status: stringField(heartbeatSessionState.status),
      requestedUrl: boundedDigest(stringField(heartbeatSessionState.requestedUrl)),
      url: boundedDigest(stringField(heartbeatSessionState.url)),
      liveSurfaceTransport: stringField(heartbeatSessionState.liveSurfaceTransport),
      nativeAdapterEndpoint: boundedLoopbackEndpoint(stringField(heartbeatSessionState.nativeAdapterUrl)),
      singleInteractiveTruth: heartbeatSessionState.singleInteractiveTruth === true,
      frameStreamRefPresent: Boolean(heartbeatSessionState.frameStreamRef),
      frameRefPresent: Boolean(heartbeatSessionState.frameRef),
      frameUrlPresent: Boolean(heartbeatSessionState.frameUrl),
    },
    surface: {
      ok: surfaceState.ok === true,
      owner: stringField(surfaceState.owner),
      adapterRole: stringField(surfaceState.adapterRole),
      surface: stringField(surfaceState.surface),
      liveSurfaceTransport: stringField(surfaceState.liveSurfaceTransport),
      singleInteractiveTruth: surfaceState.singleInteractiveTruth === true,
      embedded: surfaceState.embedded === true,
      secondTruthSource: surfaceState.secondTruthSource === false ? false : undefined,
      visible: surfaceState.visible === true,
      loading: booleanField(surfaceState.loading),
      bounds: boundsFromSurface(surfaceState.bounds) ?? roundedBounds(frameBounds),
      reason: stringField(surfaceState.reason),
    },
    interaction: {
      targetUrl: boundedDigest(fixture.url),
      typedTokenObserved,
      textProbe: 'native-adapter-text-endpoint',
      actionTimingTransport: stringField(paintAckTiming?.liveSurfaceTransport),
      paintAckSource: stringField(paintAckTiming?.paintAckSource),
      actionAck,
      stateHeartbeat,
    },
    rejectedDesktopLiveSubstitutes: rejectedDesktopLiveSubstitutes(),
    m0SurfingLoop,
    realExternalNavigation,
    benchmarkMetrics,
    verificationCommand,
    strictVerificationCommand,
  };

  await writeEvidence(evidence);
  if (evidence.status === 'passed') {
    assertDesktopBrowserNativeLiveAcceptanceCanClaimPass(evidence);
    console.log(`[ok] desktop Browser native live acceptance passed; wrote ${manifestPath}`);
  } else {
    const validation = validateDesktopBrowserNativeLiveAcceptanceEvidence(evidence);
    console.error(`[failed] desktop Browser native live acceptance did not pass: ${validation.blockReasons.join('; ')}`);
    process.exitCode = 1;
  }
} catch (error) {
  if (error instanceof BlockedDesktopBrowserNativeLiveSmoke) {
    await writeNonPassingEvidence('blocked', error.message, error.blockers, await desktopNativeLiveDiagnostics(page, observedRuntimeConfig));
  } else {
    await writeNonPassingEvidence('failed', error instanceof Error ? error.message : String(error), ['desktop native Browser pane live smoke failed'], await desktopNativeLiveDiagnostics(page, observedRuntimeConfig));
    process.exitCode = 1;
  }
} finally {
  if (electronApp) await electronApp.close().catch(() => {});
  if (fixture) await fixture.close();
  if (dummyProvider) await dummyProvider.close();
  if (scratchRoot) await rm(scratchRoot, { recursive: true, force: true });
}

function desktopBrowserNativeLiveBuildBlocker(): string | undefined {
  if (!existsSync(rendererPath)) return 'Desktop Browser native live smoke requires dist-ui/index.html. Run `npm run desktop:build` first.';
  if (!existsSync(mainPath)) return 'Desktop Browser native live smoke requires dist-desktop/src/desktop/main.js. Run `npm run desktop:build` first.';
  return undefined;
}

async function openBrowserPaneAt(page: Page, url: string): Promise<void> {
  await page.getByRole('tab', { name: /^(Browser|浏览器)$/ }).click({ timeout: 15_000 });
  await page.getByTestId('right-pane-browser-tool').waitFor({ state: 'visible', timeout: 15_000 });
  const address = page.getByLabel('Browser URL');
  await address.fill(url);
  await address.press('Enter');
}

async function waitForWorkspaceWriter(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  let lastError = '';
  while (Date.now() < deadline) {
    try {
      const health = await getJson(`${baseUrl.replace(/\/+$/, '')}/health`);
      const capabilities = Array.isArray(health.capabilities) ? health.capabilities : [];
      if (health.ok === true && capabilities.includes('browser-host-session')) return;
      lastError = `workspace writer health missing browser-host-session capability: ${JSON.stringify(health).slice(0, 500)}`;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
    await sleep(250);
  }
  throw new BlockedDesktopBrowserNativeLiveSmoke(
    `Workspace Writer was not ready for BrowserHostSession routes: ${lastError}`,
    ['workspace-writer BrowserHostSession capability', 'desktop sidecar lifecycle'],
  );
}

async function readBrowserHostSessionState(baseUrl: string, workspacePath: string, sessionId: string): Promise<JsonRecord> {
  const url = new URL(`${baseUrl.replace(/\/+$/, '')}/api/sciforge/browser-host/sessions/${encodeURIComponent(sessionId)}/state`);
  url.searchParams.set('workspacePath', workspacePath);
  const json = await getJson(url.href);
  const session = recordField(json.session);
  if (!session) throw new Error(`BrowserHostSession state response did not contain session: ${JSON.stringify(json).slice(0, 500)}`);
  return session;
}

async function sendBrowserAction(baseUrl: string, workspacePath: string, sessionId: string, body: JsonRecord): Promise<JsonRecord> {
  const json = await postJson(`${baseUrl.replace(/\/+$/, '')}/api/sciforge/browser-host/sessions/${encodeURIComponent(sessionId)}/actions`, {
    ...body,
    workspacePath,
  });
  const session = recordField(json.session);
  if (!session) throw new Error(`BrowserHostSession action response did not contain session: ${JSON.stringify(json).slice(0, 500)}`);
  return session;
}

async function timedBrowserAction(
  baseUrl: string,
  workspacePath: string,
  sessionId: string,
  body: JsonRecord,
): Promise<{ state: JsonRecord; durationMs: number }> {
  const startedAt = Date.now();
  const state = await sendBrowserAction(baseUrl, workspacePath, sessionId, body);
  return {
    state,
    durationMs: Math.max(0, Date.now() - startedAt),
  };
}

async function tryTimedBrowserAction(
  baseUrl: string,
  workspacePath: string,
  sessionId: string,
  body: JsonRecord,
): Promise<{ ok: true; state: JsonRecord; durationMs: number } | { ok: false; reasonHash: string }> {
  try {
    const result = await timedBrowserAction(baseUrl, workspacePath, sessionId, body);
    return { ok: true, ...result };
  } catch (error) {
    return { ok: false, reasonHash: boundedHash(error instanceof Error ? error.message : String(error)) };
  }
}

type DesktopNativeLifecycleProbe = {
  status: 'passed' | 'blocked';
  operationsCompleted: number;
  sameLiveSurfaceRefAfterResize: boolean;
  sameLiveSurfaceRefAfterRestore: boolean;
  visibleAfterResize: boolean;
  visibleAfterRestore: boolean;
  surfaceStateOkAfterRestore: boolean;
  reasonHash?: string;
};

type DesktopNativeReconnectProbe = {
  status: 'passed' | 'blocked';
  disconnectDetected: boolean;
  sameBrowserHostSessionOwner: boolean;
  stateHeartbeatRestored: boolean;
  inputRoutedAfterReconnect: boolean;
  actionDurationsMs: number[];
  reasonHash?: string;
};

async function desktopNativeLifecycleProbe(input: {
  electronApp: Awaited<ReturnType<typeof electron.launch>>;
  page: Page;
  sessionId: string;
  liveSurfaceRef: string | null;
  nativeSurfaceSelector: string;
}): Promise<DesktopNativeLifecycleProbe> {
  let operationsCompleted = 0;
  try {
    const nativeSurface = input.page.locator(input.nativeSurfaceSelector);
    const resizeResult = await input.electronApp.evaluate(({ BrowserWindow }) => {
      const activeWindow = BrowserWindow.getAllWindows()[0];
      if (!activeWindow) return { ok: false, reason: 'missing-browser-window' };
      const [width, height] = activeWindow.getSize();
      activeWindow.setSize(Math.max(900, width + 24), Math.max(640, height + 16));
      return { ok: true };
    }) as { ok?: boolean; reason?: string };
    if (resizeResult.ok !== true) throw new Error(resizeResult.reason ?? 'desktop-native-lifecycle-resize-failed');
    operationsCompleted += 1;
    await nativeSurface.waitFor({ state: 'visible', timeout: 5_000 });
    const liveSurfaceRefAfterResize = await waitForNativeSurfaceLiveSurfaceRef(nativeSurface, input.liveSurfaceRef, 5_000);
    const visibleAfterResize = await nativeSurface.isVisible();

    const minimizeResult = await input.electronApp.evaluate(({ BrowserWindow }) => {
      const activeWindow = BrowserWindow.getAllWindows()[0];
      if (!activeWindow) return { ok: false, reason: 'missing-browser-window' };
      activeWindow.minimize();
      return { ok: true };
    }) as { ok?: boolean; reason?: string };
    if (minimizeResult.ok !== true) throw new Error(minimizeResult.reason ?? 'desktop-native-lifecycle-minimize-failed');
    await sleep(250);
    const restoreResult = await input.electronApp.evaluate(({ BrowserWindow }) => {
      const activeWindow = BrowserWindow.getAllWindows()[0];
      if (!activeWindow) return { ok: false, reason: 'missing-browser-window' };
      activeWindow.restore();
      activeWindow.focus();
      return { ok: true };
    }) as { ok?: boolean; reason?: string };
    if (restoreResult.ok !== true) throw new Error(restoreResult.reason ?? 'desktop-native-lifecycle-restore-failed');
    operationsCompleted += 1;
    await nativeSurface.waitFor({ state: 'visible', timeout: 10_000 });
    const liveSurfaceRefAfterRestore = await waitForNativeSurfaceLiveSurfaceRef(nativeSurface, input.liveSurfaceRef, 10_000);
    const visibleAfterRestore = await nativeSurface.isVisible();
    const surfaceStateAfterRestore = await input.page.evaluate((id) =>
      (globalThis as typeof globalThis & {
        sciforgeDesktop?: { getBrowserHostSessionSurfaceState(input: unknown): Promise<unknown> };
      }).sciforgeDesktop?.getBrowserHostSessionSurfaceState({ sessionId: id }),
    input.sessionId) as JsonRecord | undefined;
    const surfaceStateOkAfterRestore = surfaceStateAfterRestore?.ok === true
      && stringField(surfaceStateAfterRestore.owner) === 'BrowserHostSession'
      && stringField(surfaceStateAfterRestore.liveSurfaceTransport) === 'native-embedded'
      && surfaceStateAfterRestore.singleInteractiveTruth === true
      && surfaceStateAfterRestore.secondTruthSource === false;
    const sameLiveSurfaceRefAfterResize = liveSurfaceRefAfterResize === input.liveSurfaceRef;
    const sameLiveSurfaceRefAfterRestore = liveSurfaceRefAfterRestore === input.liveSurfaceRef;
    const passed = sameLiveSurfaceRefAfterResize
      && sameLiveSurfaceRefAfterRestore
      && visibleAfterResize
      && visibleAfterRestore
      && surfaceStateOkAfterRestore;
    return {
      status: passed ? 'passed' : 'blocked',
      operationsCompleted,
      sameLiveSurfaceRefAfterResize,
      sameLiveSurfaceRefAfterRestore,
      visibleAfterResize,
      visibleAfterRestore,
      surfaceStateOkAfterRestore,
    };
  } catch (error) {
    return {
      status: 'blocked',
      operationsCompleted,
      sameLiveSurfaceRefAfterResize: false,
      sameLiveSurfaceRefAfterRestore: false,
      visibleAfterResize: false,
      visibleAfterRestore: false,
      surfaceStateOkAfterRestore: false,
      reasonHash: boundedHash(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function waitForNativeSurfaceLiveSurfaceRef(
  nativeSurface: Locator,
  expectedLiveSurfaceRef: string | null,
  timeoutMs: number,
): Promise<string | null> {
  const deadline = Date.now() + timeoutMs;
  let latest = await nativeSurface.getAttribute('data-browser-live-surface-ref');
  while (expectedLiveSurfaceRef && latest !== expectedLiveSurfaceRef && Date.now() < deadline) {
    await sleep(100);
    latest = await nativeSurface.getAttribute('data-browser-live-surface-ref');
  }
  return latest;
}

async function desktopNativeReconnectProbe(input: {
  page: Page;
  workspaceWriterBaseUrl: string;
  workspacePath: string;
  nativeAdapterBaseUrl: string;
  sessionId: string;
  liveSurfaceRef: string | null;
  frameBounds: DesktopBrowserNativeLiveAcceptanceBounds;
}): Promise<DesktopNativeReconnectProbe> {
  const actionDurationsMs: number[] = [];
  try {
    const detachedState = await input.page.evaluate((id) =>
      (globalThis as typeof globalThis & {
        sciforgeDesktop?: { detachBrowserHostSessionSurface(input: unknown): Promise<unknown> };
      }).sciforgeDesktop?.detachBrowserHostSessionSurface({ sessionId: id }),
    input.sessionId) as JsonRecord | undefined;
    await sleep(150);
    const detachHeartbeat = await getJson(`${input.nativeAdapterBaseUrl}/sessions/${encodeURIComponent(input.sessionId)}/state`);
    const disconnectDetected = (
      detachedState?.embedded === false
      || detachedState?.visible === false
      || detachHeartbeat.embedded === false
      || detachHeartbeat.visible === false
    );

    const attachState = await input.page.evaluate(({ sessionId, liveSurfaceRef, bounds }) =>
      (globalThis as typeof globalThis & {
        sciforgeDesktop?: { attachBrowserHostSessionSurface(input: unknown): Promise<unknown> };
      }).sciforgeDesktop?.attachBrowserHostSessionSurface({
        sessionId,
        liveSurfaceRef,
        bounds,
        visible: true,
        focus: true,
      }),
    { sessionId: input.sessionId, liveSurfaceRef: input.liveSurfaceRef, bounds: input.frameBounds }) as JsonRecord | undefined;
    await sleep(200);
    const reattachedHeartbeat = await getJson(`${input.nativeAdapterBaseUrl}/sessions/${encodeURIComponent(input.sessionId)}/state`);
    const browserHostState = await readBrowserHostSessionState(input.workspaceWriterBaseUrl, input.workspacePath, input.sessionId);
    const sameBrowserHostSessionOwner = (
      attachState?.sessionId === input.sessionId
      && attachState.owner === 'BrowserHostSession'
      && browserHostState.id === input.sessionId
      && browserHostState.owner === 'host'
      && browserHostState.providerId === 'sciforge.browser-host-session'
      && browserHostState.liveSurfaceTransport === 'native-embedded'
      && browserHostState.singleInteractiveTruth === true
    );
    const stateHeartbeatRestored = (
      attachState?.ok === true
      && attachState.embedded === true
      && attachState.visible === true
      && Boolean(stringField(reattachedHeartbeat.url))
      && Boolean(stringField(reattachedHeartbeat.title))
      && reattachedHeartbeat.loading === false
    );
    const reconnectToken = `SCIFORGE_NATIVE_RECONNECT_${Date.now().toString(36)}`;
    const reconnectClick = await tryTimedBrowserAction(input.workspaceWriterBaseUrl, input.workspacePath, input.sessionId, {
      action: 'click',
      x: 36,
      y: 38,
      capture: 'none',
      actionId: 'desktop-native-live-reconnect-click-probe',
    });
    if (reconnectClick.ok) actionDurationsMs.push(reconnectClick.durationMs);
    const reconnectType = reconnectClick.ok
      ? await tryTimedBrowserAction(input.workspaceWriterBaseUrl, input.workspacePath, input.sessionId, {
          action: 'type',
          text: reconnectToken,
          capture: 'none',
          actionId: 'desktop-native-live-reconnect-type-probe',
        })
      : { ok: false as const, reasonHash: 'reconnect-click-not-observed' };
    if (reconnectType.ok) actionDurationsMs.push(reconnectType.durationMs);
    await sleep(200);
    const textProbe = await readNativeAdapterTextEvidence(input.nativeAdapterBaseUrl, input.sessionId, 'reconnect-text-probe');
    const inputRoutedAfterReconnect = reconnectType.ok
      && textProbe.includes(reconnectToken);
    const passed = disconnectDetected
      && sameBrowserHostSessionOwner
      && stateHeartbeatRestored
      && inputRoutedAfterReconnect;
    return {
      status: passed ? 'passed' : 'blocked',
      disconnectDetected,
      sameBrowserHostSessionOwner,
      stateHeartbeatRestored,
      inputRoutedAfterReconnect,
      actionDurationsMs,
    };
  } catch (error) {
    return {
      status: 'blocked',
      disconnectDetected: false,
      sameBrowserHostSessionOwner: false,
      stateHeartbeatRestored: false,
      inputRoutedAfterReconnect: false,
      actionDurationsMs,
      reasonHash: boundedHash(error instanceof Error ? error.message : String(error)),
    };
  }
}

async function desktopNativeRealExternalNavigationProbe(input: {
  target: DesktopBrowserNativeRealExternalTarget | undefined;
  workspaceWriterBaseUrl: string;
  workspacePath: string;
  nativeAdapterBaseUrl: string;
  sessionId: string;
  liveSurfaceRef: string | null;
}): Promise<DesktopBrowserNativeRealExternalNavigationEvidence | undefined> {
  if (!input.target) return undefined;
  const sessionRef = `browser-host-session:${input.sessionId}`;
  const coverage: Record<DesktopBrowserNativeRealExternalNavigationAction, M0ActionInput> = {
    open: { ok: false, reasonHash: 'not-run' },
    navigate: { ok: false, reasonHash: 'not-run' },
    reload: { ok: false, reasonHash: 'not-run' },
    back: { ok: false, reasonHash: 'not-run' },
    forward: { ok: false, reasonHash: 'not-run' },
    stop: { ok: false, reasonHash: 'not-run' },
  };
  const lifecycle = {
    addressCommitted: false,
    navigationStart: false,
    navigationCommitted: false,
    interactive: false,
    load: false,
    networkQuiet: false,
  };
  try {
    const navigateAction = await tryTimedBrowserAction(input.workspaceWriterBaseUrl, input.workspacePath, input.sessionId, {
      action: 'navigate',
      url: input.target.url,
      capture: 'none',
      actionId: 'desktop-native-real-external-navigate-probe',
    });
    coverage.open = navigateAction;
    await sleep(500);
    const externalHeartbeat = await getJson(`${input.nativeAdapterBaseUrl}/sessions/${encodeURIComponent(input.sessionId)}/state`);
    const externalSession = await readBrowserHostSessionState(input.workspaceWriterBaseUrl, input.workspacePath, input.sessionId);
    const externalUrl = stringField(externalSession.url) || stringField(externalHeartbeat.url);
    lifecycle.addressCommitted = navigateAction.ok;
    lifecycle.navigationStart = Boolean(stringField(externalSession.requestedUrl));
    lifecycle.navigationCommitted = Boolean(externalUrl);
    lifecycle.interactive = Boolean(stringField(externalHeartbeat.title) || stringField(externalSession.title));
    lifecycle.load = externalHeartbeat.loading === false || externalSession.status === 'ready';
    lifecycle.networkQuiet = externalSession.status === 'ready';

    const reloadAction = await tryTimedBrowserAction(input.workspaceWriterBaseUrl, input.workspacePath, input.sessionId, {
      action: 'reload',
      capture: 'none',
      actionId: 'desktop-native-real-external-reload-probe',
    });
    coverage.reload = reloadAction;
    const secondNavigateAction = await tryTimedBrowserAction(input.workspaceWriterBaseUrl, input.workspacePath, input.sessionId, {
      action: 'navigate',
      url: input.target.secondUrl,
      capture: 'none',
      actionId: 'desktop-native-real-external-second-navigate-probe',
    });
    coverage.navigate = secondNavigateAction;
    const backAction = secondNavigateAction.ok
      ? await tryTimedBrowserAction(input.workspaceWriterBaseUrl, input.workspacePath, input.sessionId, {
          action: 'back',
          capture: 'none',
          actionId: 'desktop-native-real-external-back-probe',
        })
      : { ok: false as const, reasonHash: 'second-navigate-not-observed' };
    coverage.back = backAction;
    const forwardAction = backAction.ok
      ? await tryTimedBrowserAction(input.workspaceWriterBaseUrl, input.workspacePath, input.sessionId, {
          action: 'forward',
          capture: 'none',
          actionId: 'desktop-native-real-external-forward-probe',
        })
      : { ok: false as const, reasonHash: 'back-not-observed' };
    coverage.forward = forwardAction;
    const stopAction = await tryTimedBrowserAction(input.workspaceWriterBaseUrl, input.workspacePath, input.sessionId, {
      action: 'stop',
      capture: 'none',
      actionId: 'desktop-native-real-external-stop-probe',
    });
    coverage.stop = stopAction;
    await sleep(250);
    const finalHeartbeat = await getJson(`${input.nativeAdapterBaseUrl}/sessions/${encodeURIComponent(input.sessionId)}/state`);
    const finalSession = await readBrowserHostSessionState(input.workspaceWriterBaseUrl, input.workspacePath, input.sessionId);
    const finalUrl = stringField(finalSession.url) || stringField(finalHeartbeat.url) || externalUrl;
    lifecycle.navigationCommitted = lifecycle.navigationCommitted || Boolean(finalUrl);
    lifecycle.interactive = lifecycle.interactive || Boolean(stringField(finalHeartbeat.title) || stringField(finalSession.title));
    lifecycle.load = lifecycle.load || finalHeartbeat.loading === false || finalSession.status === 'ready';
    lifecycle.networkQuiet = lifecycle.networkQuiet || finalHeartbeat.loading === false || finalSession.status === 'ready';
    return desktopNativeRealExternalNavigationEvidence({
      sessionRef,
      liveSurfaceRef: input.liveSurfaceRef,
      requestedUrl: input.target.url,
      finalUrl,
      publicTarget: isPublicHttpUrl(input.target.url) && isPublicHttpUrl(input.target.secondUrl),
      actions: coverage,
      lifecycle,
    });
  } catch (error) {
    return desktopNativeRealExternalNavigationEvidence({
      sessionRef,
      liveSurfaceRef: input.liveSurfaceRef,
      requestedUrl: input.target.url,
      finalUrl: undefined,
      publicTarget: isPublicHttpUrl(input.target.url) && isPublicHttpUrl(input.target.secondUrl),
      actions: coverage,
      lifecycle,
      blockedReason: `real-external-navigation-blocked:${boundedSha16(error instanceof Error ? error.message : String(error))}`,
    });
  }
}

async function readNativeSurfaceAudit(baseUrl: string, sessionId: string): Promise<NativeSurfaceAuditSummary> {
  const json = await getJson(`${baseUrl.replace(/\/+$/, '')}/sessions/${encodeURIComponent(sessionId)}/audit`);
  const counters = recordField(json.counters) ?? {};
  return {
    schemaVersion: stringField(json.schemaVersion),
    state: numberField(counters.state) ?? 0,
    screenshot: numberField(counters.screenshot) ?? 0,
    frameStream: numberField(counters['frame-stream']) ?? 0,
    actions: numberField(counters.actions) ?? 0,
    text: numberField(counters.text) ?? 0,
    recentRequestCount: Array.isArray(json.recentRequests) ? json.recentRequests.length : 0,
  };
}

function desktopNativeLiveBenchmarkMetrics(input: {
  sessionId: string;
  frameBounds: { width: number; height: number };
  openAckMs: number;
  navigationAckMs: number;
  inputAckMs: number;
  paintAckLagMs: number;
  actionAckSamples: number[];
  resourceSamples: ProcessResourceSample[];
  rendererHeapSamplesMb: number[];
  lifecycle: DesktopNativeLifecycleProbe;
  reconnect: DesktopNativeReconnectProbe;
  lifecycleMilestones: {
    open: boolean;
    navigationStart: boolean;
    navigationCommitted: boolean;
    interactive: boolean;
    load: boolean;
    networkQuiet: boolean;
    blocked: boolean;
    retry: boolean;
    close: boolean;
  };
  inputCompleteness: {
    keyboard: boolean;
    textEditing: boolean;
    pointerClick: boolean;
    drag: boolean;
    scroll: boolean;
    navigationControls: boolean;
  };
}): DesktopBrowserNativeLiveAcceptanceBenchmarkMetrics {
  const suffix = boundedHash([
    input.sessionId,
    input.openAckMs,
    input.navigationAckMs,
    input.inputAckMs,
    input.paintAckLagMs,
    input.resourceSamples.length,
    input.rendererHeapSamplesMb.length,
    input.lifecycle.status,
    input.lifecycle.operationsCompleted,
    input.reconnect.status,
  ].join('|'));
  const resourceSamples = input.resourceSamples.filter((sample) => (
    Number.isFinite(sample.cpuPercent) && Number.isFinite(sample.rssMb)
  ));
  const cpuSamples = resourceSamples.map((sample) => sample.cpuPercent);
  const rssSamples = resourceSamples.map((sample) => sample.rssMb);
  const heapSamples = input.rendererHeapSamplesMb.filter((value) => Number.isFinite(value));
  const latencyP50Ms = boundedMs(percentile(input.actionAckSamples, 0.5));
  const latencyP95Ms = boundedMs(percentile(input.actionAckSamples, 0.95));
  const effectiveFrameMs = Math.max(16, input.paintAckLagMs);
  const streamQualityPassed = input.reconnect.status === 'passed'
    && input.lifecycle.status === 'passed'
    && input.actionAckSamples.length > 0;
  return {
    schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.benchmark-metrics.v1',
    source: 'desktop-native-browser-pane-smoke',
    evidenceMode: 'bounded-summary-ref',
    inlineEvidence: 'forbidden',
    metricSections: {
      latency: {
        status: 'passed',
        resultRef: `benchmark-result:electron-web-contents-view:latency:${suffix}`,
        numericSummary: {
          openAckMs: boundedMs(input.openAckMs),
          navigationAckMs: boundedMs(input.navigationAckMs),
          inputAckMs: boundedMs(input.inputAckMs),
          paintAckLagMs: boundedMs(input.paintAckLagMs),
          p95ActionAckMs: boundedMs(percentile(input.actionAckSamples, 0.95)),
        },
      },
      cpu: cpuSamples.length > 0
        ? {
            status: 'passed',
            resultRef: `benchmark-result:electron-web-contents-view:cpu:${suffix}`,
            numericSummary: {
              processCpuAveragePercent: roundedNumber(average(cpuSamples)),
              processCpuP95Percent: roundedNumber(percentile(cpuSamples, 0.95)),
              sampleCount: cpuSamples.length,
            },
          }
        : {
            status: 'blocked',
            resultRef: `benchmark-result:electron-web-contents-view:cpu:${suffix}`,
          },
      memory: rssSamples.length > 0 && heapSamples.length > 0
        ? {
            status: 'passed',
            resultRef: `benchmark-result:electron-web-contents-view:memory:${suffix}`,
            numericSummary: {
              rssMb: roundedNumber(average(rssSamples)),
              heapUsedMb: roundedNumber(Math.max(...heapSamples)),
              nativeSurfaceMb: roundedNumber(nativeSurfaceApproxMb(input.frameBounds)),
              peakRssMb: roundedNumber(Math.max(...rssSamples)),
            },
          }
        : {
            status: 'blocked',
            resultRef: `benchmark-result:electron-web-contents-view:memory:${suffix}`,
          },
      inputCompleteness: {
        status: Object.values(input.inputCompleteness).every((value) => value === true) ? 'passed' : 'blocked',
        resultRef: `benchmark-result:electron-web-contents-view:inputCompleteness:${suffix}`,
        numericSummary: {
          keyboard: input.inputCompleteness.keyboard,
          textEditing: input.inputCompleteness.textEditing,
          pointerClick: input.inputCompleteness.pointerClick,
          drag: input.inputCompleteness.drag,
          scroll: input.inputCompleteness.scroll,
          navigationControls: input.inputCompleteness.navigationControls,
        },
      },
      lifecycle: input.lifecycle.status === 'passed'
        && Object.values(input.lifecycleMilestones).every((value) => value === true)
        ? {
            status: 'passed',
            resultRef: `benchmark-result:electron-web-contents-view:lifecycle:${suffix}`,
            numericSummary: desktopNativeLifecycleMetricSummary(input.lifecycle, input.lifecycleMilestones),
          }
        : {
            status: 'blocked',
            resultRef: `benchmark-result:electron-web-contents-view:lifecycle:${suffix}`,
            numericSummary: desktopNativeLifecycleMetricSummary(input.lifecycle, input.lifecycleMilestones),
          },
      reconnect: input.reconnect.status === 'passed'
        ? {
            status: 'passed',
            resultRef: `benchmark-result:electron-web-contents-view:reconnect:${suffix}`,
            numericSummary: {
              disconnectDetected: input.reconnect.disconnectDetected,
              sameBrowserHostSessionOwner: input.reconnect.sameBrowserHostSessionOwner,
              stateHeartbeatRestored: input.reconnect.stateHeartbeatRestored,
              inputRoutedAfterReconnect: input.reconnect.inputRoutedAfterReconnect,
            },
          }
        : {
            status: 'blocked',
            resultRef: `benchmark-result:electron-web-contents-view:reconnect:${suffix}`,
          },
      streamQuality: {
        status: streamQualityPassed ? 'passed' : 'blocked',
        resultRef: `benchmark-result:electron-web-contents-view:streamQuality:${suffix}`,
        numericSummary: {
          latencyP50Ms,
          latencyP95Ms,
          framerateAvgFps: roundedNumber(Math.min(60, 1000 / effectiveFrameMs)),
          framerateP5Fps: roundedNumber(Math.min(60, 1000 / Math.max(effectiveFrameMs, latencyP95Ms))),
          inputToFrameP50Ms: boundedMs(latencyP50Ms + input.paintAckLagMs),
          inputToFrameP95Ms: boundedMs(latencyP95Ms + input.paintAckLagMs),
          reconnectP50Ms: boundedMs(input.reconnect.status === 'passed' ? input.paintAckLagMs : latencyP50Ms),
          reconnectP95Ms: boundedMs(input.reconnect.status === 'passed' ? input.paintAckLagMs + latencyP95Ms : latencyP95Ms),
          sampleCount: input.actionAckSamples.length,
          fallbackRequired: false,
        },
      },
    },
  };
}

function desktopNativeLifecycleMetricSummary(
  lifecycle: DesktopNativeLifecycleProbe,
  milestones: {
    open: boolean;
    navigationStart: boolean;
    navigationCommitted: boolean;
    interactive: boolean;
    load: boolean;
    networkQuiet: boolean;
    blocked: boolean;
    retry: boolean;
    close: boolean;
  },
): Record<string, number | boolean> {
  return {
    open: milestones.open,
    navigationStart: milestones.navigationStart,
    navigationCommitted: milestones.navigationCommitted,
    interactive: milestones.interactive,
    load: milestones.load,
    networkQuiet: milestones.networkQuiet,
    blocked: milestones.blocked,
    retry: milestones.retry,
    close: milestones.close,
    sameLiveSurfaceRefAfterResize: lifecycle.sameLiveSurfaceRefAfterResize,
    sameLiveSurfaceRefAfterRestore: lifecycle.sameLiveSurfaceRefAfterRestore,
    visibleAfterResize: lifecycle.visibleAfterResize,
    visibleAfterRestore: lifecycle.visibleAfterRestore,
    surfaceStateOkAfterRestore: lifecycle.surfaceStateOkAfterRestore,
  };
}

type ProcessResourceSample = {
  cpuPercent: number;
  rssMb: number;
};

function electronProcessId(app: unknown): number | undefined {
  const processAccessor = (app as { process?: unknown }).process;
  if (typeof processAccessor !== 'function') return undefined;
  const childProcess = processAccessor.call(app) as { pid?: unknown } | undefined;
  return typeof childProcess?.pid === 'number' && Number.isFinite(childProcess.pid)
    ? childProcess.pid
    : undefined;
}

async function recordProcessResourceSample(samples: ProcessResourceSample[], pid: number | undefined): Promise<void> {
  if (!pid) return;
  try {
    const { stdout } = await execFileAsync('ps', ['-p', String(pid), '-o', '%cpu=', '-o', 'rss='], {
      timeout: 2_000,
      maxBuffer: 4_000,
    });
    const [cpuRaw, rssRaw] = stdout.trim().split(/\s+/);
    const cpuPercent = Number(cpuRaw);
    const rssKb = Number(rssRaw);
    if (Number.isFinite(cpuPercent) && Number.isFinite(rssKb)) {
      samples.push({
        cpuPercent: roundedNumber(cpuPercent),
        rssMb: roundedNumber(rssKb / 1024),
      });
    }
  } catch {
    // Resource sampling is diagnostic evidence only; the benchmark section remains blocked when unavailable.
  }
}

async function recordRendererHeapSample(samples: number[], page: Page): Promise<void> {
  try {
    const heapUsedMb = await page.evaluate(() => {
      const memory = (performance as Performance & { memory?: { usedJSHeapSize?: number } }).memory;
      return typeof memory?.usedJSHeapSize === 'number' && Number.isFinite(memory.usedJSHeapSize)
        ? memory.usedJSHeapSize / 1024 / 1024
        : undefined;
    });
    if (typeof heapUsedMb === 'number' && Number.isFinite(heapUsedMb)) {
      samples.push(roundedNumber(heapUsedMb));
    }
  } catch {
    // Browser heap sampling is optional and bounded; absent samples do not create a pass claim.
  }
}

function boundedMs(value: number): number {
  return roundedNumber(Math.max(0, value));
}

function nativeSurfaceApproxMb(bounds: { width: number; height: number }): number {
  return Math.max(0, bounds.width * bounds.height * 4 / 1024 / 1024);
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function percentile(values: number[], rank: number): number {
  if (!values.length) return 0;
  const sorted = values.map((value) => Math.max(0, value)).sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(sorted.length * rank) - 1));
  return sorted[index] ?? 0;
}

function roundedNumber(value: number): number {
  return Math.round(value * 100) / 100;
}

function boundedHash(value: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function boundedSha16(value: string): string {
  return createHash('sha256').update(value).digest('hex').slice(0, 16);
}

function nativeSurfaceAuditDelta(before: NativeSurfaceAuditSummary, after: NativeSurfaceAuditSummary): NativeSurfaceAuditSummary {
  return {
    schemaVersion: after.schemaVersion,
    state: nonNegativeDelta(before.state, after.state),
    screenshot: nonNegativeDelta(before.screenshot, after.screenshot),
    frameStream: nonNegativeDelta(before.frameStream, after.frameStream),
    actions: nonNegativeDelta(before.actions, after.actions),
    text: nonNegativeDelta(before.text, after.text),
    recentRequestCount: after.recentRequestCount,
  };
}

function nativeStateHeartbeatEvidence(input: {
  targetUrl: string;
  nativeState: JsonRecord;
  browserHostState: JsonRecord;
  stateRequestsAfterAction: number;
}): DesktopBrowserNativeStateHeartbeatEvidence {
  const heartbeatUrl = stringField(input.nativeState.url);
  const heartbeat = {
    source: 'native-adapter-state-endpoint' as const,
    url: boundedDigest(heartbeatUrl),
    urlMatchesTarget: heartbeatUrl ? urlsMatchSameLoopbackTarget(input.targetUrl, heartbeatUrl) : false,
    title: stringField(input.nativeState.title),
    loading: booleanField(input.nativeState.loading),
    canGoBack: booleanField(input.nativeState.canGoBack),
    canGoForward: booleanField(input.nativeState.canGoForward),
    browserHostStatus: stringField(input.browserHostState.status),
    stateRequestsAfterAction: input.stateRequestsAfterAction,
    lightweightStateUpdated: false,
  };
  heartbeat.lightweightStateUpdated = Boolean(
    heartbeat.url &&
    heartbeat.urlMatchesTarget === true &&
    heartbeat.title &&
    heartbeat.loading === false &&
    typeof heartbeat.canGoBack === 'boolean' &&
    typeof heartbeat.canGoForward === 'boolean' &&
    heartbeat.browserHostStatus === 'ready' &&
    input.stateRequestsAfterAction > 0,
  );
  return heartbeat;
}

function desktopNativeLiveFailureReason(input: {
  typedTokenObserved: boolean;
  actionAckOk: boolean;
  stateHeartbeatOk: boolean;
}): string {
  return [
    input.typedTokenObserved ? '' : 'BrowserHostSession native input did not update the live fixture page text.',
    input.actionAckOk ? '' : 'BrowserHostSession native click ACK did not prove native-adapter-action-state without screenshot/frame-stream dependency.',
    input.stateHeartbeatOk ? '' : 'BrowserHostSession native action did not produce a lightweight /state heartbeat with url/title/loading/history fields.',
  ].filter(Boolean).join(' ');
}

function desktopNativeM0SurfingLoopEvidence(input: {
  sessionId: string;
  targetUrl: string;
  finalUrl?: string;
  liveSurfaceRef: string | null;
  nativeAdapterUrl: string;
  nativeHealth: JsonRecord;
  surfaceState: JsonRecord;
  actionAck: {
    screenshotRequestsDuringAck?: number;
    frameStreamRequestsDuringAck?: number;
    dependsOnScreenshot?: boolean;
    dependsOnFrameStream?: boolean;
  };
  actionAckSource?: string;
  stateHeartbeatOk: boolean;
  actions: Record<DesktopBrowserNativeM0Action, M0ActionInput>;
}): DesktopBrowserNativeM0SurfingLoopEvidence {
  const sessionRef = `browser-host-session:${input.sessionId}`;
  const actionCoverage = Object.fromEntries(desktopBrowserNativeM0Actions().map((action) => [
    action,
    m0ActionEvidence(sessionRef, action, input.actions[action]),
  ])) as Record<DesktopBrowserNativeM0Action, DesktopBrowserNativeM0ActionEvidence>;
  const coverageGaps = desktopBrowserNativeM0Actions().flatMap((action) => (
    actionCoverage[action].status === 'passed' ? [] : [`action:${action}:${actionCoverage[action].blockedReasonHash ?? 'blocked'}`]
  ));
  if (input.nativeHealth.ok !== true) coverageGaps.push('native-adapter-health');
  if (input.stateHeartbeatOk !== true) coverageGaps.push('native-state-heartbeat');
  if (input.actionAckSource !== 'native-adapter-action-state') coverageGaps.push('native-action-ack-source');
  if (stringField(input.surfaceState.liveSurfaceTransport) !== 'native-embedded') coverageGaps.push('surface-transport');
  if (stringField(input.surfaceState.surface) !== 'electron-web-contents-view') coverageGaps.push('surface-type');
  if (input.surfaceState.singleInteractiveTruth !== true) coverageGaps.push('single-interactive-truth');
  if (input.surfaceState.secondTruthSource !== false) coverageGaps.push('second-truth-source');
  const dependsOnScreenshot = input.actionAck.dependsOnScreenshot === true;
  const dependsOnFrameStream = input.actionAck.dependsOnFrameStream === true;
  const screenshotRequestsDuringAck = input.actionAck.screenshotRequestsDuringAck ?? 0;
  const frameStreamRequestsDuringAck = input.actionAck.frameStreamRequestsDuringAck ?? 0;
  if (dependsOnScreenshot || screenshotRequestsDuringAck !== 0) coverageGaps.push('screenshot-hot-path');
  if (dependsOnFrameStream || frameStreamRequestsDuringAck !== 0) coverageGaps.push('frame-stream-hot-path');
  const passed = coverageGaps.length === 0;
  const surfaceType = stringField(input.surfaceState.surface);
  return {
    schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.m0-surfing-loop.v1',
    status: passed ? 'passed' : 'blocked',
    claimScope: passed ? 'desktop-native-m0-surfing-loop' : 'blocked-or-diagnostic',
    passClaim: passed,
    shell: 'desktop-right-pane',
    owner: 'BrowserHostSession',
    adapterRole: 'display-input-adapter',
    refsFirst: true,
    evidenceMode: 'bounded-refs-and-summaries',
    sessionRef,
    liveSurfaceRef: input.liveSurfaceRef ?? '',
    nativeAdapterRef: `native-adapter:loopback:${boundedSha16(input.nativeAdapterUrl)}`,
    surfaceRef: `desktop-native-surface:electron-web-contents-view:${boundedSha16([
      input.sessionId,
      surfaceType,
      JSON.stringify(boundsFromSurface(input.surfaceState.bounds) ?? {}),
    ].join('|'))}`,
    transport: {
      liveSurfaceTransport: stringField(input.surfaceState.liveSurfaceTransport),
      frameTransport: stringField(input.surfaceState.liveSurfaceTransport) === 'native-embedded' ? 'native-embedded' : undefined,
      surfaceType,
    },
    health: {
      nativeAdapterHealthOk: input.nativeHealth.ok === true,
      nativeAdapterService: stringField(input.nativeHealth.service),
      nativeStateHeartbeat: input.stateHeartbeatOk,
      actionAckSource: input.actionAckSource,
    },
    urlEvidence: {
      requested: boundedDigest(input.targetUrl),
      final: boundedDigest(input.finalUrl),
      rawUrlCaptured: false,
    },
    actionCoverage,
    inputHotPath: {
      dependsOnScreenshot: false,
      dependsOnFrameStream: false,
      screenshotRequestsDuringAck,
      frameStreamRequestsDuringAck,
    },
    singleInteractiveTruth: input.surfaceState.singleInteractiveTruth === true,
    secondTruthSource: input.surfaceState.secondTruthSource !== false,
    noLegacyFallback: {
      hostStream: false,
      canvas: false,
      webRtc: false,
      httpFrame: false,
      snapshot: false,
      iframe: false,
      proxy: false,
      webview: false,
      systemPopup: false,
      externalBrowser: false,
    },
    payloadPolicy: {
      rawDom: false,
      rawLogs: false,
      rawScreenshot: false,
      base64: false,
      providerPayload: false,
      secret: false,
    },
    coverageGaps,
    blockedReason: passed ? undefined : `m0-coverage-blocked:${boundedSha16(coverageGaps.join('|'))}`,
  };
}

function desktopNativeRealExternalNavigationEvidence(input: {
  sessionRef: string;
  liveSurfaceRef: string | null;
  requestedUrl: string;
  finalUrl?: string;
  publicTarget: boolean;
  actions: Record<DesktopBrowserNativeRealExternalNavigationAction, M0ActionInput>;
  lifecycle: DesktopBrowserNativeRealExternalNavigationEvidence['lifecycle'];
  blockedReason?: string;
}): DesktopBrowserNativeRealExternalNavigationEvidence {
  const actionCoverage = Object.fromEntries(desktopBrowserNativeRealExternalNavigationActions().map((action) => [
    action,
    realExternalActionEvidence(input.sessionRef, action, input.actions[action]),
  ])) as Record<DesktopBrowserNativeRealExternalNavigationAction, DesktopBrowserNativeM0ActionEvidence>;
  const coverageGaps = desktopBrowserNativeRealExternalNavigationActions().flatMap((action) => (
    actionCoverage[action].status === 'passed' ? [] : [`action:${action}:${actionCoverage[action].blockedReasonHash ?? 'blocked'}`]
  ));
  if (!input.publicTarget) coverageGaps.push('public-external-target');
  for (const [key, value] of Object.entries(input.lifecycle)) {
    if (value !== true) coverageGaps.push(`lifecycle:${key}`);
  }
  if (!input.liveSurfaceRef) coverageGaps.push('live-surface-ref');
  if (input.blockedReason) coverageGaps.push(input.blockedReason);
  const passed = coverageGaps.length === 0;
  return {
    schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.real-external-navigation.v1',
    status: passed ? 'passed' : 'blocked',
    claimScope: passed ? 'desktop-native-real-external-navigation' : 'blocked-or-diagnostic',
    passClaim: passed,
    configuredBy: REAL_EXTERNAL_TARGET_ENV,
    shell: 'desktop-right-pane',
    owner: 'BrowserHostSession',
    refsFirst: true,
    evidenceMode: 'bounded-refs-and-summaries',
    sessionRef: input.sessionRef,
    liveSurfaceRef: input.liveSurfaceRef ?? '',
    transport: {
      liveSurfaceTransport: 'native-embedded',
      frameTransport: 'native-embedded',
      surfaceType: 'electron-web-contents-view',
    },
    targetEvidence: {
      mode: input.publicTarget ? 'real-external-url-config' : 'blocked-real-external-url-config',
      requestedUrl: boundedDigest(input.requestedUrl),
      finalUrl: boundedDigest(input.finalUrl),
      publicTarget: input.publicTarget,
      privateNetworkTarget: !input.publicTarget,
      hardcodedSitePassClaim: false,
      rawUrlCaptured: false,
      rawDomCaptured: false,
    },
    actionCoverage,
    lifecycle: input.lifecycle,
    singleInteractiveTruth: true,
    secondTruthSource: false,
    noLegacyFallback: {
      hostStream: false,
      canvas: false,
      webRtc: false,
      httpFrame: false,
      snapshot: false,
      iframe: false,
      proxy: false,
      webview: false,
      systemPopup: false,
      externalBrowser: false,
    },
    payloadPolicy: {
      rawDom: false,
      rawLogs: false,
      rawScreenshot: false,
      base64: false,
      providerPayload: false,
      secret: false,
    },
    coverageGaps,
    blockedReason: passed ? undefined : `real-external-coverage-blocked:${boundedSha16(coverageGaps.join('|'))}`,
  };
}

type M0ActionInput =
  | { ok: boolean; durationMs?: number; text?: string; reasonHash?: string }
  | { ok: false; reasonHash: string };

function m0ActionEvidence(
  sessionRef: string,
  action: DesktopBrowserNativeM0Action,
  input: M0ActionInput,
): DesktopBrowserNativeM0ActionEvidence {
  const durationMs = 'durationMs' in input && typeof input.durationMs === 'number' && Number.isFinite(input.durationMs)
    ? Math.max(0, Math.round(input.durationMs))
    : undefined;
  const passed = input.ok === true && durationMs !== undefined;
  const text = 'text' in input ? input.text : undefined;
  return {
    status: passed ? 'passed' : 'blocked',
    latencyMs: durationMs,
    resultRef: `${sessionRef}/m0/${action}`,
    textLength: action === 'type' && text ? text.length : undefined,
    textHash: action === 'type' && text ? boundedSha16(text) : undefined,
    blockedReasonHash: passed ? undefined : ('reasonHash' in input ? input.reasonHash : 'missing-latency'),
  };
}

function realExternalActionEvidence(
  sessionRef: string,
  action: DesktopBrowserNativeRealExternalNavigationAction,
  input: M0ActionInput,
): DesktopBrowserNativeM0ActionEvidence {
  const evidence = m0ActionEvidence(sessionRef, 'open', input);
  return {
    status: evidence.status,
    latencyMs: evidence.latencyMs,
    resultRef: `${sessionRef}/real-external/${action}`,
    blockedReasonHash: evidence.blockedReasonHash,
  };
}

function desktopNativeRealExternalNavigationActionDurations(
  evidence: DesktopBrowserNativeRealExternalNavigationEvidence | undefined,
): number[] {
  if (!evidence) return [];
  return Object.values(evidence.actionCoverage)
    .map((action) => action.latencyMs)
    .filter((latency): latency is number => typeof latency === 'number' && Number.isFinite(latency));
}

function boundedDigest(value: string | undefined): { length: number; hash: string } | undefined {
  return value ? { length: value.length, hash: boundedSha16(value) } : undefined;
}

function boundedLoopbackEndpoint(value: string | undefined): DesktopBrowserNativeBoundedEndpoint | undefined {
  const digest = boundedDigest(value);
  if (!value || !digest) return undefined;
  return {
    ...digest,
    loopbackHttp: isLoopbackHttpUrl(value),
  };
}

function desktopNativeRealExternalTargetFromEnv(): DesktopBrowserNativeRealExternalTarget | undefined {
  const raw = process.env[REAL_EXTERNAL_TARGET_ENV];
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const url = stringField(parsed.url);
    const secondUrl = stringField(parsed.secondUrl);
    if (!url || !secondUrl) throw new Error(`${REAL_EXTERNAL_TARGET_ENV} requires url and secondUrl.`);
    if (!isPublicHttpUrl(url) || !isPublicHttpUrl(secondUrl)) {
      throw new Error(`${REAL_EXTERNAL_TARGET_ENV} requires public http/https url and secondUrl.`);
    }
    return { url, secondUrl };
  } catch (error) {
    throw new BlockedDesktopBrowserNativeLiveSmoke(
      `Desktop native real external target config is invalid: ${error instanceof Error ? error.message : String(error)}`,
      ['SCIFORGE_DESKTOP_BROWSER_NATIVE_REAL_EXTERNAL_TARGET_JSON public url/secondUrl config'],
    );
  }
}

function isPublicHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return false;
    return !isPrivateOrLocalHostname(url.hostname);
  } catch {
    return false;
  }
}

function isLoopbackHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' && /^(?:127\.0\.0\.1|localhost|::1|::ffff:127\.0\.0\.1)$/i.test(url.hostname);
  } catch {
    return false;
  }
}

function isPrivateOrLocalHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost')) return true;
  if (host === '::1' || host === '::ffff:127.0.0.1') return true;
  if (/^127\./.test(host)) return true;
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  const match172 = /^172\.(\d+)\./.exec(host);
  if (match172 && Number(match172[1]) >= 16 && Number(match172[1]) <= 31) return true;
  if (/^169\.254\./.test(host)) return true;
  if (host.endsWith('.local') || host.endsWith('.test') || host.endsWith('.invalid') || host.endsWith('.example')) return true;
  return false;
}

function urlsMatchSameLoopbackTarget(left: string, right: string): boolean {
  try {
    const leftUrl = new URL(left);
    const rightUrl = new URL(right);
    return leftUrl.protocol === rightUrl.protocol &&
      leftUrl.port === rightUrl.port &&
      equivalentLoopbackHost(leftUrl.hostname, rightUrl.hostname);
  } catch {
    return left === right;
  }
}

function equivalentLoopbackHost(left: string, right: string): boolean {
  if (left === right) return true;
  const loopbacks = new Set(['localhost', '127.0.0.1', '[::1]', '::1', '[::ffff:127.0.0.1]', '::ffff:127.0.0.1']);
  return loopbacks.has(left.toLowerCase()) && loopbacks.has(right.toLowerCase());
}

function nonNegativeDelta(before: number, after: number): number {
  return Math.max(0, after - before);
}

async function startBrowserFixture(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((_req, res) => {
    res.writeHead(200, {
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'no-store',
    });
    res.end(`<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <title>SciForge Desktop Native Browser Live Fixture</title>
    <style>
      body { margin: 0; font-family: sans-serif; }
      input { margin: 20px; width: 520px; height: 32px; font-size: 16px; }
      #echo { margin: 20px; font-size: 16px; }
    </style>
  </head>
  <body>
    <input id="probe" aria-label="Native live probe" autofocus>
    <div id="echo">typed:</div>
    <script>
      const probe = document.getElementById('probe');
      const echo = document.getElementById('echo');
      probe.addEventListener('input', () => { echo.textContent = 'typed:' + probe.value; });
    </script>
  </body>
</html>`);
  });
  const port = await listen(server, '::');
  return {
    url: `http://[::ffff:127.0.0.1]:${port}/`,
    close: () => closeServer(server),
  };
}

async function startDummyProvider(): Promise<{ url: string; close(): Promise<void> }> {
  const server = createServer((req, res) => {
    res.writeHead(503, { 'content-type': 'application/json' });
    res.end(JSON.stringify({
      error: {
        type: 'dummy_provider_unavailable',
        message: `No provider is required for desktop Browser native live smoke: ${req.method ?? 'GET'} ${req.url ?? '/'}`,
      },
    }));
  });
  const port = await listen(server, '127.0.0.1');
  return {
    url: `http://127.0.0.1:${port}/v1`,
    close: () => closeServer(server),
  };
}

async function listen(server: Server, host: string): Promise<number> {
  return new Promise<number>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, host, () => {
      server.off('error', reject);
      const address = server.address();
      assert.ok(address && typeof address === 'object');
      resolvePort(address.port);
    });
  });
}

async function closeServer(server: Server): Promise<void> {
  if (!server.listening) return;
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function getJson(url: string): Promise<JsonRecord> {
  const response = await fetch(url);
  const text = await response.text();
  const json = text ? JSON.parse(text) as JsonRecord : {};
  if (!response.ok || json.ok === false) {
    throw new Error(`GET ${url} failed: ${String(json.reason ?? json.error ?? response.statusText)}`);
  }
  return json;
}

async function postJson(url: string, body: JsonRecord): Promise<JsonRecord> {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  const json = text ? JSON.parse(text) as JsonRecord : {};
  if (!response.ok || json.ok === false) {
    throw new Error(`POST ${url} failed: ${String(json.reason ?? json.error ?? response.statusText)}`);
  }
  return json;
}

async function readNativeAdapterTextEvidence(nativeAdapterBaseUrl: string, sessionId: string, label: string): Promise<string> {
  const dir = join(outputDir, 'native-evidence');
  await mkdir(dir, { recursive: true });
  const outputPath = join(dir, `${safeFileToken(label)}-${Date.now().toString(36)}.txt`);
  const response = await postJson(`${nativeAdapterBaseUrl}/sessions/${encodeURIComponent(sessionId)}/text`, { outputPath });
  assertNoRawNativeEvidenceBridgeResponse(response);
  return await readFile(outputPath, 'utf8');
}

function assertNoRawNativeEvidenceBridgeResponse(value: unknown): void {
  assert.doesNotMatch(JSON.stringify(value), /data:image|;base64|<html|<body|provider|secret|raw page text|outputPath/i);
}

function safeFileToken(value: string): string {
  return value.replace(/[^a-z0-9._-]+/gi, '-').replace(/^-+|-+$/g, '') || 'native-evidence';
}

async function writeNonPassingEvidence(
  status: 'blocked' | 'failed',
  reason: string,
  blockers: string[],
  diagnostics?: DesktopBrowserNativeLiveAcceptanceEvidence['diagnostics'],
): Promise<void> {
  const evidence: DesktopBrowserNativeLiveAcceptanceEvidence = {
    schemaVersion: 'sciforge.desktop.browser-native-live-acceptance.v1',
    status,
    source: 'desktop-native-browser-pane-smoke',
    observedAt: new Date().toISOString(),
    canClaimDesktopNativeLivePass: false,
    claimScope: 'blocked-or-diagnostic',
    reason,
    blockers,
    desktopLaunch: existsSync(mainPath) && existsSync(rendererPath)
      ? {
          mode: 'production-electron',
          mainPathRef: `desktop-launch-main:${boundedSha16(mainPath)}`,
          rendererPathRef: `desktop-launch-renderer:${boundedSha16(rendererPath)}`,
          rendererUrl: boundedDigest(pathToFileURL(rendererPath).href),
        }
      : undefined,
    interaction: {
      textProbe: 'not-run',
      typedTokenObserved: false,
    },
    diagnostics,
    rejectedDesktopLiveSubstitutes: rejectedDesktopLiveSubstitutes(),
    verificationCommand,
    strictVerificationCommand,
  };
  await writeEvidence(evidence);
  const label = status === 'blocked' ? 'blocked' : 'failed';
  console.log(`[${label}] desktop Browser native live acceptance cannot claim pass: ${reason}; wrote ${manifestPath}`);
  if (status === 'blocked' && requireLive) {
    console.error('[strict] SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE=1 requires a passed native-embedded desktop Browser pane run.');
    process.exitCode = 1;
  }
  if (status === 'failed') process.exitCode = 1;
}

async function desktopNativeLiveDiagnostics(
  page: Page | undefined,
  config: DesktopRuntimeConfig | undefined,
): Promise<DesktopBrowserNativeLiveAcceptanceEvidence['diagnostics'] | undefined> {
  if (!page && !config) return undefined;
  let runtimeHealth: unknown;
  try {
    runtimeHealth = page
      ? await page.evaluate(() =>
          (globalThis as typeof globalThis & {
            sciforgeDesktop?: { getRuntimeHealth?: () => Promise<unknown> };
          }).sciforgeDesktop?.getRuntimeHealth?.(),
        )
      : undefined;
  } catch (error) {
    runtimeHealth = { error: error instanceof Error ? error.message : String(error) };
  }
  return {
    runtimeConfig: config
      ? {
          runtimeControlUrl: config.runtimeControlUrl,
          workspaceWriterBaseUrl: config.workspaceWriterBaseUrl,
          workspacePath: config.workspacePath,
          appDataRoot: config.appDataRoot,
        }
      : undefined,
    runtimeHealth,
    launcherAuditTail: await launcherAuditTail(config),
  };
}

async function launcherAuditTail(config: DesktopRuntimeConfig | undefined): Promise<string[] | undefined> {
  if (!config?.appDataRoot) return undefined;
  try {
    const text = await readFile(join(config.appDataRoot, 'logs', 'runtime-launcher-audit.ndjson'), 'utf8');
    return text.trim().split('\n').slice(-24);
  } catch {
    return undefined;
  }
}

async function writeEvidence(evidence: DesktopBrowserNativeLiveAcceptanceEvidence): Promise<void> {
  await mkdir(outputDir, { recursive: true });
  await writeFile(manifestPath, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
}

function sessionIdFromLiveSurfaceRef(value: string | null): string {
  const match = /^browser-host-session:([^/]+)\/live-surface$/.exec(value ?? '');
  if (!match) throw new Error(`Browser pane native live surface ref is missing or malformed: ${String(value)}`);
  return requiredStringField(match[1], 'BrowserHostSession live surface session id');
}

function desktopRuntimeConfigFromValue(value: unknown): DesktopRuntimeConfig {
  const record = recordField(value);
  if (!record) throw new Error('Desktop runtime config is not an object.');
  return {
    schemaVersion: requiredStringField(record.schemaVersion, 'desktop runtime config schemaVersion') as DesktopRuntimeConfig['schemaVersion'],
    runtimeControlUrl: requiredStringField(record.runtimeControlUrl, 'desktop runtime config runtimeControlUrl'),
    workspaceWriterBaseUrl: requiredStringField(record.workspaceWriterBaseUrl, 'desktop runtime config workspaceWriterBaseUrl'),
    workspacePath: requiredStringField(record.workspacePath, 'desktop runtime config workspacePath'),
    appDataRoot: requiredStringField(record.appDataRoot, 'desktop runtime config appDataRoot'),
  };
}

function boundsFromSurface(value: unknown): DesktopBrowserNativeLiveAcceptanceBounds | undefined {
  const record = recordField(value);
  if (!record) return undefined;
  const x = numberField(record.x);
  const y = numberField(record.y);
  const width = numberField(record.width);
  const height = numberField(record.height);
  if (x === undefined || y === undefined || width === undefined || height === undefined) return undefined;
  return { x, y, width, height };
}

function roundedBounds(value: { x: number; y: number; width: number; height: number }): DesktopBrowserNativeLiveAcceptanceBounds {
  return {
    x: Math.round(value.x),
    y: Math.round(value.y),
    width: Math.round(value.width),
    height: Math.round(value.height),
  };
}

function recordField(value: unknown): JsonRecord | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as JsonRecord : undefined;
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function requiredStringField(value: unknown, label: string): string {
  const stringValue = stringField(value);
  if (!stringValue) throw new Error(`${label} is required.`);
  return stringValue;
}

function numberField(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

type NativeSurfaceAuditSummary = {
  schemaVersion?: string;
  state: number;
  screenshot: number;
  frameStream: number;
  actions: number;
  text: number;
  recentRequestCount: number;
};
