import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import test from 'node:test';
import { setTimeout as sleep } from 'node:timers/promises';

import {
  BrowserHostSessionManager,
  normalizeBrowserHostUrl,
  type BrowserHostFrameCaptureResult,
  type BrowserHostSessionActionTiming,
  type BrowserHostSessionState,
} from '../../src/runtime/browser-host-session.js';

const PUBLIC_PERFORMANCE_SCHEMA = 'sciforge.browser-host-session.public-performance-lab-smoke.v1' as const;
const DEFAULT_PUBLIC_URLS = [
  'https://example.com/',
  'https://www.iana.org/help/example-domains',
];
const artifactDir = resolve(process.cwd(), 'docs', 'test-artifacts', 'browser-host-session-public-performance-lab');
const manifestPath = resolve(artifactDir, 'manifest.json');

type PublicPerformanceStatus = 'passed' | 'blocked' | 'skipped';
type PublicPerformanceOperation = 'open' | 'navigate' | 'type' | 'scroll' | 'search' | 'frame-drop-probe';

type OperationTimingRecord = {
  operation: PublicPerformanceOperation;
  status: 'ok' | 'blocked';
  elapsedMs: number;
  reason?: string;
};

type OperationTimingSummary = {
  operation: PublicPerformanceOperation;
  count: number;
  blocked: number;
  p50Ms: number;
  p95Ms: number;
  lastMs: number;
};

type DropDiagnosticsEvidence = {
  droppedFrameProbeCount: number;
  skippedReasons: Record<string, number>;
  droppedOperationCount: number;
  droppedOperations: Array<{ operation: PublicPerformanceOperation; targetHash?: string; reason: string }>;
};

type BoundedDiagnostic = {
  scope: 'browser' | 'network' | 'action' | 'search' | 'frame-drop-probe';
  targetHash?: string;
  sessionId?: string;
  action?: string;
  reason: string;
};

type TargetEvidence = {
  index: number;
  target: SanitizedUrlEvidence;
  session?: SessionEvidence;
  actions: Array<{
    action: 'navigate' | 'type' | 'scroll';
    status: BrowserHostSessionState['status'];
    timing?: ActionTimingEvidence;
    finalUrlHash: string;
  }>;
  frameDropProbes: FrameDropProbeEvidence[];
};

type SearchEvidence = {
  status: 'passed' | 'blocked';
  engine: 'duckduckgo';
  queryLength: number;
  queryHash: string;
  sessionId?: string;
  resultCount: number;
  resultRef?: string;
  finalUrlHash?: string;
  timing?: ActionTimingEvidence;
  diagnostics: string[];
};

type FrameDropProbeEvidence = {
  captured: boolean;
  skippedReason?: BrowserHostFrameCaptureResult['skippedReason'];
  sessionId: string;
  frameRef?: string;
  frameStreamRef?: string;
};

type PublicPerformanceEvidence =
  | {
    schemaVersion: typeof PUBLIC_PERFORMANCE_SCHEMA;
    status: 'skipped';
    observedAt: string;
    reason: string;
    browser: BrowserEvidence;
    requestedUrlCount: number;
    verificationCommand: string;
  }
  | {
    schemaVersion: typeof PUBLIC_PERFORMANCE_SCHEMA;
    status: 'passed' | 'blocked';
    observedAt: string;
    source: 'SCIFORGE_BROWSER_PUBLIC_SMOKE_URLS' | 'default-public-doc-urls';
    browser: BrowserEvidence;
    publicNetwork: {
      requestedUrlCount: number;
      readyUrlCount: number;
      blockedTargetCount: number;
      searchStatus: SearchEvidence['status'];
    };
    targets: TargetEvidence[];
    search: SearchEvidence;
    timingSummary: OperationTimingSummary[];
    browserActionTimingSummary: ActionTimingEvidence[];
    dropDiagnostics: DropDiagnosticsEvidence;
    blockedDiagnostics: BoundedDiagnostic[];
    refsFirst: true;
    artifactPayloadMode: 'bounded-refs-and-hashes';
    rawPayloadsInManifest: false;
    forbiddenEvidence: {
      rawDom: false;
      encodedImagePayload: false;
      screenshotBytes: false;
      iframe: false;
      proxy: false;
      secondViewer: false;
      systemPopup: false;
    };
    workspaceRetained: false;
    verificationCommand: string;
  };

type BrowserEvidence = {
  engine: 'chromium';
  executableBasename?: string;
  executablePathHash?: string;
};

type SanitizedUrlEvidence = {
  origin: string;
  pathHash: string;
  urlHash: string;
};

type SessionEvidence = {
  id: string;
  status: BrowserHostSessionState['status'];
  owner: BrowserHostSessionState['owner'];
  providerId: BrowserHostSessionState['providerId'];
  requestedUrl: SanitizedUrlEvidence;
  finalUrl: SanitizedUrlEvidence;
  liveSurfaceTransport?: BrowserHostSessionState['liveSurfaceTransport'];
  singleInteractiveTruth: boolean;
  refs: {
    liveSurfaceRef?: string;
    frameStreamRef?: string;
    frameRef?: string;
    screenshotRef?: string;
    domSnapshotRef?: string;
    axSnapshotRef?: string;
    consoleLogRef?: string;
    networkLogRef?: string;
    searchResultRef?: string;
  };
  timingSummary: ActionTimingEvidence[];
  diagnostics: string[];
};

type ActionTimingEvidence = {
  action: BrowserHostSessionActionTiming['action'];
  status: BrowserHostSessionActionTiming['status'];
  capture?: BrowserHostSessionActionTiming['capture'];
  count?: number;
  p50Ms?: number;
  p95Ms?: number;
  lastMs?: number;
  totalMs?: number;
  hostActionMs?: number;
  evidenceMs?: number;
  paintAckSource?: BrowserHostSessionActionTiming['paintAckSource'];
  blockedReason?: string;
};

test('BrowserHostSession public performance lab opens configurable public URLs and records bounded timing refs', { timeout: 120_000 }, async (t) => {
  const executablePath = resolveChromiumExecutable();
  const publicUrls = configuredPublicSmokeUrls();
  const verificationCommand = 'node --import tsx --test tests/smoke/smoke-browser-host-session-public-performance-lab.test.ts';
  if (!executablePath) {
    const reason = 'No Chromium-compatible browser found. Set SCIFORGE_BROWSER_HOST_EXECUTABLE_PATH or PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH to run this smoke.';
    await writeEvidence({
      schemaVersion: PUBLIC_PERFORMANCE_SCHEMA,
      status: 'skipped',
      observedAt: new Date().toISOString(),
      reason,
      browser: { engine: 'chromium' },
      requestedUrlCount: publicUrls.length,
      verificationCommand,
    });
    t.skip(reason);
    return;
  }

  const restoreEnv = configureBrowserHostSmokeEnv(executablePath);
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-public-performance-lab-'));
  const manager = new BrowserHostSessionManager();
  const operationTimings: OperationTimingRecord[] = [];
  const browserActionTimings: BrowserHostSessionActionTiming[] = [];
  const blockedDiagnostics: BoundedDiagnostic[] = [];
  const droppedOperations: Array<{ operation: PublicPerformanceOperation; targetHash?: string; reason: string }> = [];
  const targets: TargetEvidence[] = [];
  const sessionIds: string[] = [];
  const readySessionIds: string[] = [];

  try {
    for (const [index, targetUrl] of publicUrls.entries()) {
      const target = sanitizedUrlEvidence(targetUrl);
      const sessionId = `public-performance-${index + 1}-${sha256(targetUrl).slice(0, 8)}`;
      const targetEvidence: TargetEvidence = {
        index,
        target,
        actions: [],
        frameDropProbes: [],
      };
      targets.push(targetEvidence);

      const opened = await timedOperation(operationTimings, 'open', () => manager.openSession(workspacePath, {
        url: targetUrl,
        sessionId,
        width: 960,
        height: 640,
        timeoutMs: publicSmokeTimeoutMs(),
      }));
      sessionIds.push(opened.id);
      collectActionTiming(browserActionTimings, opened.lastActionTiming);
      targetEvidence.session = sessionEvidence(opened);
      collectBlockedState(blockedDiagnostics, 'network', target.urlHash, opened);

      if (opened.status !== 'ready') {
        recordDropped(droppedOperations, 'navigate', target.urlHash, 'open did not produce a ready BrowserHostSession');
        recordDropped(droppedOperations, 'type', target.urlHash, 'open did not produce a ready BrowserHostSession');
        recordDropped(droppedOperations, 'scroll', target.urlHash, 'open did not produce a ready BrowserHostSession');
        continue;
      }
      readySessionIds.push(opened.id);

      const navigated = await timedOperation(operationTimings, 'navigate', () => manager.act(workspacePath, opened.id, {
        action: 'navigate',
        url: targetUrl,
        capture: 'frame',
        timeoutMs: publicSmokeTimeoutMs(),
        actionId: `${opened.id}:public-navigate`,
        adapterSentAt: recentAdapterTimestamp(),
      }));
      collectActionTiming(browserActionTimings, navigated.lastActionTiming);
      targetEvidence.actions.push(actionEvidence('navigate', navigated));
      collectBlockedState(blockedDiagnostics, 'action', target.urlHash, navigated);

      if (navigated.status !== 'ready') {
        recordDropped(droppedOperations, 'type', target.urlHash, 'navigate did not leave BrowserHostSession ready');
        recordDropped(droppedOperations, 'scroll', target.urlHash, 'navigate did not leave BrowserHostSession ready');
        continue;
      }

      const typed = await timedOperation(operationTimings, 'type', () => manager.act(workspacePath, opened.id, {
        action: 'type',
        text: 'SciForge public performance smoke',
        capture: 'none',
        timeoutMs: publicSmokeTimeoutMs(),
        actionId: `${opened.id}:public-type`,
        adapterSentAt: recentAdapterTimestamp(),
      }));
      collectActionTiming(browserActionTimings, typed.lastActionTiming);
      targetEvidence.actions.push(actionEvidence('type', typed));
      collectBlockedState(blockedDiagnostics, 'action', target.urlHash, typed);

      const scrolled = await timedOperation(operationTimings, 'scroll', () => manager.act(workspacePath, opened.id, {
        action: 'scroll',
        deltaX: 0,
        deltaY: 720,
        capture: 'none',
        timeoutMs: publicSmokeTimeoutMs(),
        actionId: `${opened.id}:public-scroll`,
        adapterSentAt: recentAdapterTimestamp(),
      }));
      collectActionTiming(browserActionTimings, scrolled.lastActionTiming);
      targetEvidence.actions.push(actionEvidence('scroll', scrolled));
      collectBlockedState(blockedDiagnostics, 'action', target.urlHash, scrolled);

      const recentInputProbe = await timedFrameDropProbe(operationTimings, () => manager.captureFrameIfIdle(workspacePath, opened.id, {
        quietWindowMs: 250,
      }));
      targetEvidence.frameDropProbes.push(frameDropProbeEvidence(recentInputProbe));
      if (!recentInputProbe.captured) {
        blockedDiagnostics.push({
          scope: 'frame-drop-probe',
          targetHash: target.urlHash,
          sessionId: opened.id,
          reason: `frame capture skipped: ${recentInputProbe.skippedReason ?? 'unknown'}`,
        });
      }

      await sleep(260);
      const settledProbe = await timedFrameDropProbe(operationTimings, () => manager.captureFrameIfIdle(workspacePath, opened.id, {
        quietWindowMs: 0,
      }));
      targetEvidence.frameDropProbes.push(frameDropProbeEvidence(settledProbe));
    }

    const searchEvidence = await runProviderIndependentSearch({
      manager,
      workspacePath,
      sessionId: readySessionIds[0],
      sessionIds,
      operationTimings,
      browserActionTimings,
      blockedDiagnostics,
    });
    const readyUrlCount = targets.filter((target) => target.session?.status === 'ready').length;
    const blockedTargetCount = targets.length - readyUrlCount;
    const skippedByBrowserLaunch = readyUrlCount === 0 && looksLikeBrowserLaunchFailure(blockedDiagnostics);
    const status: Exclude<PublicPerformanceStatus, 'skipped'> = readyUrlCount > 0 || searchEvidence.status === 'passed'
      ? 'passed'
      : 'blocked';

    const evidence: PublicPerformanceEvidence = {
      schemaVersion: PUBLIC_PERFORMANCE_SCHEMA,
      status,
      observedAt: new Date().toISOString(),
      source: process.env.SCIFORGE_BROWSER_PUBLIC_SMOKE_URLS?.trim() ? 'SCIFORGE_BROWSER_PUBLIC_SMOKE_URLS' : 'default-public-doc-urls',
      browser: browserEvidence(executablePath),
      publicNetwork: {
        requestedUrlCount: publicUrls.length,
        readyUrlCount,
        blockedTargetCount,
        searchStatus: searchEvidence.status,
      },
      targets,
      search: searchEvidence,
      timingSummary: summarizeOperationTimings(operationTimings),
      browserActionTimingSummary: summarizeBrowserActionTimings(browserActionTimings),
      dropDiagnostics: dropDiagnostics(targets, droppedOperations),
      blockedDiagnostics: blockedDiagnostics.slice(0, 24),
      refsFirst: true,
      artifactPayloadMode: 'bounded-refs-and-hashes',
      rawPayloadsInManifest: false,
      forbiddenEvidence: {
        rawDom: false,
        encodedImagePayload: false,
        screenshotBytes: false,
        iframe: false,
        proxy: false,
        secondViewer: false,
        systemPopup: false,
      },
      workspaceRetained: false,
      verificationCommand,
    };

    if (skippedByBrowserLaunch) {
      const reason = blockedDiagnostics[0]?.reason ?? 'Chromium-compatible browser could not launch.';
      await writeEvidence({
        schemaVersion: PUBLIC_PERFORMANCE_SCHEMA,
        status: 'skipped',
        observedAt: new Date().toISOString(),
        reason,
        browser: browserEvidence(executablePath),
        requestedUrlCount: publicUrls.length,
        verificationCommand,
      });
      t.skip(reason);
      return;
    }

    await writeEvidence(evidence);
    await assertEvidenceIsBounded(manifestPath);
    assert.equal(evidence.refsFirst, true);
    assert.equal(evidence.rawPayloadsInManifest, false);
    assert.equal(evidence.forbiddenEvidence.rawDom, false);
    assert.equal(evidence.forbiddenEvidence.encodedImagePayload, false);
    assert.ok(evidence.timingSummary.some((row) => row.operation === 'open'), 'public lab must report open timing');
    assert.ok(evidence.timingSummary.some((row) => row.operation === 'search'), 'public lab must report search timing');
    assert.equal(evidence.targets.length, publicUrls.length);
    assert.ok(status === 'passed' || evidence.blockedDiagnostics.length > 0, 'blocked evidence must include bounded diagnostics');

    console.log(`[${status}] BrowserHostSession public performance lab ${JSON.stringify({
      requestedUrlCount: evidence.publicNetwork.requestedUrlCount,
      readyUrlCount: evidence.publicNetwork.readyUrlCount,
      searchStatus: evidence.search.status,
      droppedFrameProbeCount: evidence.dropDiagnostics.droppedFrameProbeCount,
      timingSummary: evidence.timingSummary,
    })}`);
  } finally {
    for (const sessionId of [...new Set(sessionIds)].reverse()) {
      await manager.act(workspacePath, sessionId, {
        action: 'close',
        capture: 'none',
        timeoutMs: 2_000,
        actionId: `${sessionId}:public-close`,
      }).catch(() => undefined);
    }
    await rm(workspacePath, { recursive: true, force: true });
    restoreEnv();
  }
});

async function runProviderIndependentSearch(input: {
  manager: BrowserHostSessionManager;
  workspacePath: string;
  sessionId?: string;
  sessionIds: string[];
  operationTimings: OperationTimingRecord[];
  browserActionTimings: BrowserHostSessionActionTiming[];
  blockedDiagnostics: BoundedDiagnostic[];
}): Promise<SearchEvidence> {
  const query = process.env.SCIFORGE_BROWSER_PUBLIC_SMOKE_SEARCH_QUERY?.trim() || 'SciForge BrowserHostSession public performance smoke';
  try {
    const search = await timedOperation(input.operationTimings, 'search', () => input.manager.search(input.workspacePath, {
      sessionId: input.sessionId,
      query,
      engine: 'duckduckgo',
      limit: 3,
      timeoutMs: publicSmokeTimeoutMs(),
    }));
    input.sessionIds.push(search.session.id);
    collectActionTiming(input.browserActionTimings, search.session.lastActionTiming);
    collectBlockedState(input.blockedDiagnostics, 'search', undefined, search.session);
    return {
      status: search.session.status === 'ready' ? 'passed' : 'blocked',
      engine: 'duckduckgo',
      queryLength: query.length,
      queryHash: sha256(query),
      sessionId: search.session.id,
      resultCount: search.results.length,
      resultRef: search.searchResultRef,
      finalUrlHash: sha256(search.finalUrl),
      timing: actionTimingEvidence(search.session.lastActionTiming),
      diagnostics: search.session.diagnostics.map(scrubDiagnostic).slice(-8),
    };
  } catch (error) {
    const reason = scrubDiagnostic(errorMessage(error));
    input.blockedDiagnostics.push({ scope: 'search', reason });
    return {
      status: 'blocked',
      engine: 'duckduckgo',
      queryLength: query.length,
      queryHash: sha256(query),
      resultCount: 0,
      diagnostics: [reason],
    };
  }
}

async function timedOperation<T>(
  records: OperationTimingRecord[],
  operation: PublicPerformanceOperation,
  producer: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await producer();
    records.push({ operation, status: 'ok', elapsedMs: Date.now() - startedAt });
    return result;
  } catch (error) {
    records.push({
      operation,
      status: 'blocked',
      elapsedMs: Date.now() - startedAt,
      reason: scrubDiagnostic(errorMessage(error)),
    });
    throw error;
  }
}

async function timedFrameDropProbe(
  records: OperationTimingRecord[],
  producer: () => Promise<BrowserHostFrameCaptureResult>,
): Promise<BrowserHostFrameCaptureResult> {
  return timedOperation(records, 'frame-drop-probe', producer);
}

function configuredPublicSmokeUrls(): string[] {
  const raw = process.env.SCIFORGE_BROWSER_PUBLIC_SMOKE_URLS?.trim();
  const candidates = raw ? parseUrlList(raw) : DEFAULT_PUBLIC_URLS;
  const normalized = candidates
    .map((value) => normalizeBrowserHostUrl(value))
    .filter((value) => /^https?:\/\//i.test(value));
  const unique = [...new Set(normalized)];
  const maxUrls = clampNumber(Number(process.env.SCIFORGE_BROWSER_PUBLIC_SMOKE_MAX_URLS), 3, 1, 8);
  return (unique.length ? unique : DEFAULT_PUBLIC_URLS).slice(0, maxUrls);
}

function parseUrlList(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
    }
  } catch {
    // Plain comma/newline configuration is the common path.
  }
  return raw.split(/[\n,]+/).map((item) => item.trim()).filter(Boolean);
}

function publicSmokeTimeoutMs(): number {
  return clampNumber(Number(process.env.SCIFORGE_BROWSER_PUBLIC_SMOKE_TIMEOUT_MS), 12_000, 4_000, 60_000);
}

function configureBrowserHostSmokeEnv(executablePath: string): () => void {
  const updates: Record<string, string> = {
    SCIFORGE_BROWSER_HOST_EXECUTABLE_PATH: executablePath,
    SCIFORGE_BROWSER_HOST_NAVIGATION_SETTLE_MS: '450',
    SCIFORGE_BROWSER_HOST_DOMCONTENTLOADED_SETTLE_MS: '1200',
    SCIFORGE_BROWSER_HOST_INTERACTIVE_SETTLE_MS: '80',
    SCIFORGE_BROWSER_HOST_INTERACTIVE_DOMCONTENTLOADED_SETTLE_MS: '1200',
    SCIFORGE_BROWSER_HOST_INTERACTIVE_NAVIGATION_SETTLE_MS: '450',
    SCIFORGE_BROWSER_HOST_DOM_SNAPSHOT_TIMEOUT_MS: '750',
    SCIFORGE_BROWSER_HOST_AX_SNAPSHOT_TIMEOUT_MS: '750',
  };
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(updates)) {
    previous.set(key, process.env[key]);
    if (!process.env[key]?.trim()) process.env[key] = value;
  }
  return () => {
    for (const [key, value] of previous) {
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  };
}

function resolveChromiumExecutable(): string | undefined {
  const candidates = [
    process.env.SCIFORGE_BROWSER_HOST_EXECUTABLE_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    process.env.SCIFORGE_BROWSER_EXECUTABLE,
    ...playwrightChromiumCandidates(),
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/Applications/Brave Browser.app/Contents/MacOS/Brave Browser',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ].filter((value): value is string => Boolean(value?.trim()));
  return candidates.find((candidate) => existsSync(candidate));
}

function playwrightChromiumCandidates(): string[] {
  const home = process.env.HOME;
  if (!home) return [];
  const cacheDirs = [
    `${home}/Library/Caches/ms-playwright`,
    `${home}/.cache/ms-playwright`,
  ];
  const candidates: string[] = [];
  for (const cacheDir of cacheDirs) {
    try {
      candidates.push(
        ...readdirSync(cacheDir)
          .filter((entry) => /^chromium-\d+$/.test(entry))
          .sort()
          .reverse()
          .flatMap((entry) => [
            `${cacheDir}/${entry}/chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing`,
            `${cacheDir}/${entry}/chrome-mac/Chromium.app/Contents/MacOS/Chromium`,
            `${cacheDir}/${entry}/chrome-linux/chrome`,
          ]),
      );
    } catch {
      // Missing Playwright cache is reported as a typed skipped smoke by the caller.
    }
  }
  return candidates;
}

function browserEvidence(executablePath: string): BrowserEvidence {
  return {
    engine: 'chromium',
    executableBasename: basename(executablePath),
    executablePathHash: sha256(executablePath),
  };
}

function sessionEvidence(state: BrowserHostSessionState): SessionEvidence {
  return {
    id: state.id,
    status: state.status,
    owner: state.owner,
    providerId: state.providerId,
    requestedUrl: sanitizedUrlEvidence(state.requestedUrl),
    finalUrl: sanitizedUrlEvidence(state.url),
    liveSurfaceTransport: state.liveSurfaceTransport,
    singleInteractiveTruth: state.singleInteractiveTruth === true,
    refs: {
      liveSurfaceRef: state.liveSurfaceRef,
      frameStreamRef: state.frameStreamRef,
      frameRef: state.frameRef,
      screenshotRef: state.screenshotRef,
      domSnapshotRef: state.domSnapshotRef,
      axSnapshotRef: state.axSnapshotRef,
      consoleLogRef: state.consoleLogRef,
      networkLogRef: state.networkLogRef,
      searchResultRef: state.searchResultRef,
    },
    timingSummary: (state.actionTimingSummary ?? []).map((row) => ({
      action: row.action,
      status: 'ok',
      capture: row.action === 'open' ? 'full' : 'none',
      count: row.count,
      p50Ms: row.p50Ms,
      p95Ms: row.p95Ms,
      lastMs: row.lastMs,
    })),
    diagnostics: state.diagnostics.map(scrubDiagnostic).slice(-8),
  };
}

function actionEvidence(action: 'navigate' | 'type' | 'scroll', state: BrowserHostSessionState): TargetEvidence['actions'][number] {
  return {
    action,
    status: state.status,
    timing: actionTimingEvidence(state.lastActionTiming),
    finalUrlHash: sha256(state.url),
  };
}

function actionTimingEvidence(timing: BrowserHostSessionActionTiming | undefined): ActionTimingEvidence | undefined {
  if (!timing) return undefined;
  return {
    action: timing.action,
    status: timing.status,
    capture: timing.capture,
    totalMs: timing.totalMs,
    hostActionMs: timing.hostActionMs,
    evidenceMs: timing.evidenceMs,
    paintAckSource: timing.paintAckSource,
    blockedReason: timing.blockedReason ? scrubDiagnostic(timing.blockedReason) : undefined,
  };
}

function frameDropProbeEvidence(result: BrowserHostFrameCaptureResult): FrameDropProbeEvidence {
  return {
    captured: result.captured,
    skippedReason: result.skippedReason,
    sessionId: result.session.id,
    frameRef: result.session.frameRef,
    frameStreamRef: result.session.frameStreamRef,
  };
}

function collectActionTiming(records: BrowserHostSessionActionTiming[], timing: BrowserHostSessionActionTiming | undefined): void {
  if (timing) records.push(timing);
}

function collectBlockedState(
  blockedDiagnostics: BoundedDiagnostic[],
  scope: BoundedDiagnostic['scope'],
  targetHash: string | undefined,
  state: BrowserHostSessionState,
): void {
  if (state.status !== 'failed' && state.lastActionTiming?.status !== 'failed') return;
  const reason = state.lastActionTiming?.blockedReason
    ?? state.diagnostics.at(-1)
    ?? `BrowserHostSession ${state.id} is ${state.status}`;
  blockedDiagnostics.push({
    scope,
    targetHash,
    sessionId: state.id,
    action: state.lastActionTiming?.action,
    reason: scrubDiagnostic(reason),
  });
}

function recordDropped(
  droppedOperations: Array<{ operation: PublicPerformanceOperation; targetHash?: string; reason: string }>,
  operation: PublicPerformanceOperation,
  targetHash: string | undefined,
  reason: string,
): void {
  droppedOperations.push({ operation, targetHash, reason });
}

function summarizeOperationTimings(records: OperationTimingRecord[]): OperationTimingSummary[] {
  const operations: PublicPerformanceOperation[] = ['open', 'navigate', 'type', 'scroll', 'search', 'frame-drop-probe'];
  return operations
    .map((operation) => {
      const rows = records.filter((row) => row.operation === operation);
      if (!rows.length) return undefined;
      const elapsed = rows.map((row) => row.elapsedMs);
      return {
        operation,
        count: rows.length,
        blocked: rows.filter((row) => row.status === 'blocked').length,
        p50Ms: percentile(elapsed, 0.5),
        p95Ms: percentile(elapsed, 0.95),
        lastMs: rows[rows.length - 1].elapsedMs,
      };
    })
    .filter((row): row is OperationTimingSummary => Boolean(row));
}

function summarizeBrowserActionTimings(records: BrowserHostSessionActionTiming[]): ActionTimingEvidence[] {
  return records.map((timing) => actionTimingEvidence(timing)).filter((row): row is ActionTimingEvidence => Boolean(row)).slice(-32);
}

function dropDiagnostics(
  targets: TargetEvidence[],
  droppedOperations: Array<{ operation: PublicPerformanceOperation; targetHash?: string; reason: string }>,
): DropDiagnosticsEvidence {
  const skippedReasons: Record<string, number> = {};
  let droppedFrameProbeCount = 0;
  for (const target of targets) {
    for (const probe of target.frameDropProbes) {
      if (probe.captured) continue;
      droppedFrameProbeCount += 1;
      const reason = probe.skippedReason ?? 'unknown';
      skippedReasons[reason] = (skippedReasons[reason] ?? 0) + 1;
    }
  }
  return {
    droppedFrameProbeCount,
    skippedReasons,
    droppedOperationCount: droppedOperations.length,
    droppedOperations: droppedOperations.slice(0, 24),
  };
}

function sanitizedUrlEvidence(value: string): SanitizedUrlEvidence {
  try {
    const url = new URL(normalizeBrowserHostUrl(value));
    const pathKey = `${url.pathname}${url.search ? '?query' : ''}${url.hash ? '#hash' : ''}`;
    return {
      origin: url.origin,
      pathHash: sha256(pathKey),
      urlHash: sha256(url.toString()),
    };
  } catch {
    return {
      origin: 'invalid-url',
      pathHash: sha256(value),
      urlHash: sha256(value),
    };
  }
}

function looksLikeBrowserLaunchFailure(blockedDiagnostics: BoundedDiagnostic[]): boolean {
  return blockedDiagnostics.some((item) => /executable|browser.*launch|playwright.*browser|spawn|enoent/i.test(item.reason));
}

async function writeEvidence(evidence: PublicPerformanceEvidence): Promise<void> {
  await mkdir(artifactDir, { recursive: true });
  const text = `${JSON.stringify(evidence, null, 2)}\n`;
  assertNoRawPayloads(text);
  await writeFile(manifestPath, text, 'utf8');
}

async function assertEvidenceIsBounded(path: string): Promise<void> {
  const text = await readFile(path, 'utf8');
  assertNoRawPayloads(text);
}

function assertNoRawPayloads(text: string): void {
  assert.doesNotMatch(text, /data:image|base64|iVBORw0KGgo/i);
  assert.doesNotMatch(text, /<\s*(?:!doctype|html|body|canvas|iframe|webview|script|style)\b/i);
  assert.doesNotMatch(text, /\/api\/sciforge\/browser\/proxy|system-browser-window|html2canvas/i);
}

function scrubDiagnostic(value: string): string {
  return clip(value
    .replace(/https?:\/\/[^\s"'<>]+/g, (url) => `[url:${sha256(url).slice(0, 12)}]`)
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/ig, '[data-image-redacted]')
    .replace(/\s+/g, ' ')
    .trim(), 360);
}

function recentAdapterTimestamp(): string {
  return new Date(Date.now() - 1).toISOString();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function percentile(values: number[], quantile: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil(sorted.length * quantile) - 1);
  return sorted[index];
}

function clampNumber(value: number, fallback: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? value : fallback));
}

function clip(value: string, maxLength: number): string {
  return value.length <= maxLength ? value : `${value.slice(0, maxLength - 3)}...`;
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}
