import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { _electron as electron, type Page } from 'playwright-core';

import {
  type DesktopBrowserNativeLiveAcceptanceBounds,
  type DesktopBrowserNativeLiveAcceptanceEvidence,
  assertDesktopBrowserNativeLiveAcceptanceCanClaimPass,
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

const projectRoot = process.cwd();
const outputDir = process.env.SCIFORGE_DESKTOP_BROWSER_NATIVE_LIVE_EVIDENCE_DIR
  ? resolve(projectRoot, process.env.SCIFORGE_DESKTOP_BROWSER_NATIVE_LIVE_EVIDENCE_DIR)
  : resolve(projectRoot, 'docs', 'test-artifacts', 'desktop-browser-native-live-acceptance');
const manifestPath = join(outputDir, 'manifest.json');
const mainPath = resolve(projectRoot, 'dist-desktop', 'src', 'desktop', 'main.js');
const rendererPath = resolve(projectRoot, 'dist-ui', 'index.html');
const requireLive = process.env.SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE === '1';
const verificationCommand = 'npm run smoke:desktop-browser-native-live-acceptance --silent';
const strictVerificationCommand = 'SCIFORGE_REQUIRE_DESKTOP_BROWSER_NATIVE_LIVE_ACCEPTANCE=1 npm run smoke:desktop-browser-native-live-acceptance --silent';

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

  page = await electronApp.firstWindow();
  await page.waitForLoadState('domcontentloaded', { timeout: 30_000 });
  await page.waitForFunction(() => typeof (globalThis as typeof globalThis & {
    sciforgeDesktop?: { getRuntimeConfig?: () => Promise<unknown> };
  }).sciforgeDesktop?.getRuntimeConfig === 'function', undefined, { timeout: 10_000 });

  const config = desktopRuntimeConfigFromValue(await page.evaluate(() =>
    (globalThis as typeof globalThis & { sciforgeDesktop: { getRuntimeConfig(): Promise<unknown> } }).sciforgeDesktop.getRuntimeConfig(),
  ));
  observedRuntimeConfig = config;
  assert.equal(config.schemaVersion, 'sciforge.desktop.runtime-config.v1');
  await waitForWorkspaceWriter(config.workspaceWriterBaseUrl);

  await openBrowserPaneAt(page, fixture.url);
  const nativeFrame = page.locator('[data-browser-native-surface="true"][data-browser-live-surface-transport="native-embedded"]');
  await nativeFrame.waitFor({ state: 'visible', timeout: 30_000 });
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
  const paintAckState = await sendBrowserAction(config.workspaceWriterBaseUrl, config.workspacePath, sessionId, {
    action: 'click',
    x: 36,
    y: 38,
    actionId: 'desktop-native-live-click-paint-ack',
  });
  const nativeAuditAfterActionAck = await readNativeSurfaceAudit(nativeAdapterBaseUrl, sessionId);
  const nativeHeartbeatState = await getJson(`${nativeAdapterBaseUrl}/sessions/${encodeURIComponent(sessionId)}/state`);
  const heartbeatSessionState = await readBrowserHostSessionState(config.workspaceWriterBaseUrl, config.workspacePath, sessionId);
  const nativeAuditAfterHeartbeat = await readNativeSurfaceAudit(nativeAdapterBaseUrl, sessionId);
  await sendBrowserAction(config.workspaceWriterBaseUrl, config.workspacePath, sessionId, {
    action: 'type',
    text: typedToken,
    capture: 'none',
    actionId: 'desktop-native-live-type-text-probe',
  });
  await sleep(250);
  const textProbe = await getJson(`${nativeAdapterBaseUrl}/sessions/${encodeURIComponent(sessionId)}/text`);
  const typedTokenObserved = typeof textProbe.text === 'string' && textProbe.text.includes(typedToken);
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
  const canClaimPass = typedTokenObserved && actionAckOk && stateHeartbeatOk;

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
      mainPath,
      rendererPath,
      rendererUrl: page.url(),
    },
    nativeAdapter: {
      url: nativeAdapterUrl,
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
      requestedUrl: stringField(heartbeatSessionState.requestedUrl),
      url: stringField(heartbeatSessionState.url),
      liveSurfaceTransport: stringField(heartbeatSessionState.liveSurfaceTransport),
      nativeAdapterUrl: stringField(heartbeatSessionState.nativeAdapterUrl),
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
      targetUrl: fixture.url,
      typedTokenObserved,
      textProbe: 'native-adapter-text-endpoint',
      actionTimingTransport: stringField(paintAckTiming?.liveSurfaceTransport),
      paintAckSource: stringField(paintAckTiming?.paintAckSource),
      actionAck,
      stateHeartbeat,
    },
    rejectedDesktopLiveSubstitutes: rejectedDesktopLiveSubstitutes(),
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
  const heartbeat = {
    source: 'native-adapter-state-endpoint' as const,
    url: stringField(input.nativeState.url),
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
    heartbeat.title &&
    heartbeat.loading === false &&
    typeof heartbeat.canGoBack === 'boolean' &&
    typeof heartbeat.canGoForward === 'boolean' &&
    heartbeat.browserHostStatus === 'ready' &&
    input.stateRequestsAfterAction > 0 &&
    urlsMatchSameLoopbackTarget(input.targetUrl, heartbeat.url),
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
          mainPath,
          rendererPath,
          rendererUrl: pathToFileURL(rendererPath).href,
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
