import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright-core';
import { browserRuntimeAutomationSummary } from '@sciforge-ui/runtime-contract/browser-runtime';
import type { BrowserRuntimeAutomationSummary } from '@sciforge-ui/runtime-contract/browser-runtime';
import { ensureWorkspaceBrowserProfileDir, normalizeWorkspaceRootPath } from './workspace-paths.js';
import {
  BROWSER_HOST_NATIVE_OS_UI_PROOF_SCHEMA,
  BROWSER_HOST_LOADING_PROGRESS_SCHEMA,
  BROWSER_HOST_SEARCH_SCHEMA,
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
} from './browser-host-session-types.js';
import type {
  BrowserHostFrameCaptureResult,
  BrowserHostMouseButton,
  BrowserHostMousePoint,
  BrowserHostSearchInput,
  BrowserHostSearchOutput,
  BrowserHostSearchResult,
  BrowserHostSessionActorCursor,
  BrowserHostSessionActorCursorInput,
  BrowserHostSessionAction,
  BrowserHostSessionActionInput,
  BrowserHostSessionActionRiskType,
  BrowserHostSessionCaptureMode,
  BrowserHostSessionDriver,
  BrowserHostSessionDriverFactory,
  BrowserHostSessionLoadingProgress,
  BrowserHostSessionLoadingProgressReason,
  BrowserHostSessionLoadingProgressSource,
  BrowserHostSessionLoadingProgressState,
  BrowserHostSessionLoadingProgressUrls,
  BrowserHostSessionNativeOsUiProof,
  BrowserHostSessionStartInput,
  BrowserHostSessionState,
  BrowserHostSessionStatus,
  BrowserHostSessionVisibleAction,
  BrowserHostSessionViewport,
} from './browser-host-session-types.js';
import {
  actionTimingSamplesFromSummaries,
  browserHostActionTiming,
  browserHostActionTimingSummary,
  createBrowserHostActionTiming,
  finishBrowserHostActionTiming,
  markBrowserHostActionTimingActionEnd,
  markBrowserHostActionTimingEvidenceEnd,
  markBrowserHostActionTimingEvidenceStart,
  summarizeBrowserHostActionTimings,
  type BrowserHostActionTimingBuilder,
} from './browser-host-session-timing.js';
import {
  boundedSearchResults,
  browserHostSearchUrl,
  decodeSearchRedirect,
  genericSearchResultsFromDriver,
  nativeSearchResult,
} from './browser-host-session-search.js';

export {
  BROWSER_HOST_NATIVE_OS_UI_PROOF_SCHEMA,
  BROWSER_HOST_LOADING_PROGRESS_SCHEMA,
  BROWSER_HOST_SEARCH_SCHEMA,
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
} from './browser-host-session-types.js';
export type {
  BrowserHostFrameCaptureResult,
  BrowserHostMouseButton,
  BrowserHostMousePoint,
  BrowserHostSearchEngine,
  BrowserHostSearchInput,
  BrowserHostSearchOutput,
  BrowserHostSearchResult,
  BrowserHostSessionAction,
  BrowserHostSessionActionRiskType,
  BrowserHostSessionActionInput,
  BrowserHostSessionActionTiming,
  BrowserHostSessionActionTimingSummary,
  BrowserHostSessionCaptureMode,
  BrowserHostSessionDriver,
  BrowserHostSessionDriverFactory,
  BrowserHostSessionLoadingProgress,
  BrowserHostSessionLoadingProgressReason,
  BrowserHostSessionLoadingProgressRefs,
  BrowserHostSessionLoadingProgressSource,
  BrowserHostSessionLoadingProgressState,
  BrowserHostSessionLoadingProgressUrlDigest,
  BrowserHostSessionLoadingProgressUrls,
  BrowserHostSessionNativeOsUiProof,
  BrowserHostSessionStartInput,
  BrowserHostSessionState,
  BrowserHostSessionStatus,
  BrowserHostSessionVisibleAction,
  BrowserHostSessionViewport,
} from './browser-host-session-types.js';
export {
  browserHostSearchSummary,
  browserHostSearchUrl,
} from './browser-host-session-search.js';

const BROWSER_HOST_CAPTURE_FALLBACK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=',
  'base64',
);

const BROWSER_HOST_NATIVE_OS_UI_PROOF_NAMES_BY_GROUP = {
  cursorCaret: [
    'input-caret-visible',
    'focus-blur-restore',
    'pointer-button-link',
    'pointer-default-area',
    'text-cursor-area',
  ],
  mouseContextMenu: [
    'left-click-owner',
    'right-click-context-menu-owner',
    'middle-click-owner',
    'double-click-owner',
    'mouse-down-up-owner',
    'continuous-move-owner',
    'drag-drop-owner',
    'text-selection-range-owner',
    'wheel-vertical-owner',
    'wheel-horizontal-owner',
    'scrollbar-thumb-owner',
  ],
  keyboardImeClipboardSelection: [
    'keyboard-backspace-delete-owner',
    'keyboard-enter-owner',
    'keyboard-tab-owner',
    'keyboard-arrow-home-end-page-owner',
    'keyboard-shortcuts-select-copy-paste-cut-owner',
    'keyboard-escape-owner',
    'ime-candidate-window-owner',
    'system-clipboard-round-trip-owner',
    'selection-range-owner',
  ],
  rerenderFocus: [
    'native-surface-not-detached',
    'address-bar-rerender-stable',
    'tab-state-rerender-stable',
    'diagnostic-expand-stable',
    'focus-retained-after-rerender',
    'tab-switch-resize-minimize-restore',
  ],
} as const satisfies Record<BrowserHostSessionNativeOsUiProof['proofGroup'], readonly string[]>;

const BROWSER_HOST_NATIVE_OS_UI_PROOF_NAMES = new Set(
  Object.values(BROWSER_HOST_NATIVE_OS_UI_PROOF_NAMES_BY_GROUP).flat(),
);

interface ActiveBrowserHostSession extends BrowserHostSessionState {
  driver?: BrowserHostSessionDriver;
  consoleLog: Record<string, unknown>[];
  networkLog: Record<string, unknown>[];
  actionTimingSamples: Map<BrowserHostSessionAction | 'open', number[]>;
}

type BrowserHostSessionCaptureOptions = {
  includeScreenshot?: boolean;
  includeDom?: boolean;
  includeAx?: boolean;
  includeLogs?: boolean;
};

type BrowserHostSessionPendingInputBatch = {
  workspacePath: string;
  input: BrowserHostSessionActionInput;
  hostReceivedAtMs: number;
  waiters: Array<{
    resolve: (state: BrowserHostSessionState) => void;
    reject: (error: unknown) => void;
  }>;
};

type BrowserHostSessionCompletedInputBatch = Pick<BrowserHostSessionPendingInputBatch, 'waiters'> & (
  | { state: BrowserHostSessionState; error?: undefined }
  | { state?: undefined; error: unknown }
);

type BrowserHostNavigationProgressEvent = Parameters<NonNullable<BrowserHostSessionDriver['onNavigationProgress']>>[0] extends (progress: infer Progress) => void
  ? Progress
  : never;

type BrowserHostSessionLoadingProgressUrlHints = {
  requestedUrl?: string;
  currentUrl?: string;
  finalUrl?: string;
};

export class BrowserHostSessionManager {
  private readonly sessions = new Map<string, ActiveBrowserHostSession>();
  private readonly sessionOperationQueues = new Map<string, Promise<unknown>>();
  private readonly sessionDeferredCaptureTasks = new Map<string, Promise<void>>();
  private readonly sessionInputEpochs = new Map<string, number>();
  private readonly sessionInputActivity = new Map<string, number>();
  private readonly sessionPendingInputBatches = new Map<string, BrowserHostSessionPendingInputBatch[]>();
  private readonly sessionInputFlushTasks = new Map<string, Promise<void>>();

  constructor(private readonly options: { driverFactory?: BrowserHostSessionDriverFactory } = {}) {}

  async openSession(workspacePath: string, input: BrowserHostSessionStartInput): Promise<BrowserHostSessionState> {
    const root = normalizeWorkspaceRootPath(resolve(workspacePath));
    const requestedUrl = normalizeBrowserHostUrl(input.url);
    const sessionId = safeSessionId(input.sessionId) || `browser-host-${sha1(`${requestedUrl}:${Date.now()}`).slice(0, 12)}`;
    const now = new Date().toISOString();
    const session: ActiveBrowserHostSession = {
      schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
      id: sessionId,
      owner: 'host',
      providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
      status: 'starting',
      workspacePath: root,
      requestedUrl,
      url: requestedUrl,
      startedAt: now,
      updatedAt: now,
      viewport: browserHostViewport(input.width, input.height),
      canGoBack: false,
      canGoForward: false,
      diagnostics: [],
      consoleLog: [],
      networkLog: [],
      actionTimingSamples: new Map(),
    };
    await publishBrowserHostVisibleAction(session, 'open', input.sessionId, input.actorCursor, { url: requestedUrl });
    setBrowserHostSessionLoadingProgress(session, {
      state: 'navigation-start',
      reason: 'host-starting',
      source: 'host-session',
      action: 'open',
      urlHints: browserHostNavigationControlUrlHints(session, 'open'),
    });
    this.sessions.set(session.id, session);
    await persistBrowserHostSession(session);
    const timing = createBrowserHostActionTiming(session, 'open', {
      capture: 'full',
      actionId: input.sessionId,
    });
    try {
      const profileState = await ensureWorkspaceBrowserProfileDir(root);
      session.driver = await this.driverFactory().create({
        sessionId,
        viewport: session.viewport,
        timeoutMs: timeoutMs(input.timeoutMs),
        workspacePath: root,
        workspaceProfileDir: profileState.profileDir,
      });
      attachDriverDiagnostics(session);
      session.status = 'loading';
      session.updatedAt = new Date().toISOString();
      setBrowserHostSessionLoadingProgress(session, {
        state: 'navigation-start',
        reason: 'navigation-requested',
        source: 'host-navigation',
        action: 'open',
        urlHints: browserHostNavigationControlUrlHints(session, 'open'),
      });
      await persistBrowserHostSession(session);
      await session.driver.goto(requestedUrl, timeoutMs(input.timeoutMs));
      markBrowserHostActionTimingActionEnd(timing);
      await this.refreshNavigationState(session);
      completeBrowserHostNavigationAction(session, 'open');
      await this.capture(session, { includeDom: true, includeAx: true, includeLogs: true }, timing);
      completeBrowserHostNavigationAction(session, 'open');
      finishBrowserHostActionTiming(session, timing, 'ok');
      await persistBrowserHostSession(session);
    } catch (error) {
      markBrowserHostActionTimingActionEnd(timing);
      session.status = 'failed';
      session.updatedAt = new Date().toISOString();
      session.diagnostics.push(browserHostErrorMessage(error));
      setBrowserHostSessionLoadingProgress(session, {
        state: browserHostErrorRequiresHandoff(error) ? 'handoff' : 'blocked',
        reason: 'host-error',
        source: 'host-error',
        action: 'open',
        canRetry: true,
        blocked: true,
        requiresHandoff: browserHostErrorRequiresHandoff(error),
        urlHints: browserHostNavigationControlUrlHints(session, 'open'),
      });
      finishBrowserHostActionTiming(session, timing, 'failed', browserHostErrorMessage(error));
      await persistBrowserHostSession(session);
    }
    return publicBrowserHostSessionState(session);
  }

  async sessionState(workspacePath: string, sessionId: string): Promise<BrowserHostSessionState | undefined> {
    const active = this.sessions.get(sessionId);
    if (active) {
      if (active.driver && active.status !== 'closed' && active.status !== 'failed') {
        await this.refreshNavigationState(active).catch((error) => {
          active.diagnostics.push(browserHostErrorMessage(error));
        });
      }
      return publicBrowserHostSessionState(active);
    }
    const stored = await readStoredBrowserHostSession(normalizeWorkspaceRootPath(resolve(workspacePath)), sessionId);
    return stored ? publicBrowserHostSessionState({ ...stored, consoleLog: [], networkLog: [], actionTimingSamples: actionTimingSamplesFromSummaries(stored.actionTimingSummary) }) : undefined;
  }

  async act(workspacePath: string, sessionId: string, input: BrowserHostSessionActionInput): Promise<BrowserHostSessionState> {
    const hostReceivedAtMs = Date.now();
    const isUserInput = browserHostActionIsUserInput(input.action);
    if (isUserInput) this.noteSessionInputReceived(sessionId, hostReceivedAtMs);
    if (browserHostActionUsesCoalescedInputChannel(input)) {
      return this.enqueueSessionInputOperation(workspacePath, sessionId, input, hostReceivedAtMs);
    }
    return this.enqueueSessionOperation(sessionId, async () => {
      try {
        return await this.actUnlocked(workspacePath, sessionId, input, hostReceivedAtMs);
      } finally {
        if (isUserInput) this.noteSessionInputSettled(sessionId);
      }
    });
  }

  private async actUnlocked(workspacePath: string, sessionId: string, input: BrowserHostSessionActionInput, hostReceivedAtMs: number): Promise<BrowserHostSessionState> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`BrowserHostSession is not active: ${sessionId}`);
    if (session.status === 'closed') throw new Error(`BrowserHostSession is closed: ${sessionId}`);
    if (!session.driver) throw new Error(`BrowserHostSession has no active browser driver: ${sessionId}`);
    const timeout = timeoutMs(input.timeoutMs);
    const captureMode = input.action === 'native-os-ui-proof'
      ? 'none'
      : browserHostCaptureMode(input.capture) ?? browserHostDefaultCaptureMode(input.action);
    const timing = createBrowserHostActionTiming(session, input.action, {
      capture: captureMode,
      actionId: input.actionId,
      uiEventReceivedAt: input.uiEventReceivedAt,
      adapterSentAt: input.adapterSentAt,
      hostReceivedAtMs,
    });
    await publishBrowserHostVisibleAction(session, input.action, input.actionId, input.actorCursor, input);
    try {
      let didClose = false;
      let didCursor = false;
      const button = browserHostMouseButton(input.button);
      if (input.action === 'navigate') {
        const nextUrl = normalizeBrowserHostUrl(requiredString(input.url, 'url'));
        session.requestedUrl = nextUrl;
        session.url = nextUrl;
        session.status = 'loading';
        session.updatedAt = new Date().toISOString();
        setBrowserHostSessionLoadingProgress(session, {
          state: 'navigation-start',
          reason: 'navigation-requested',
          source: 'host-navigation',
          action: 'navigate',
          urlHints: browserHostNavigationControlUrlHints(session, 'navigate'),
        });
        await persistBrowserHostSession(session);
        await session.driver.goto(nextUrl, timeout);
        await this.refreshNavigationState(session);
        completeBrowserHostNavigationAction(session, 'navigate');
      } else if (input.action === 'back') {
        session.status = 'loading';
        session.updatedAt = new Date().toISOString();
        setBrowserHostSessionLoadingProgress(session, {
          state: 'navigation-start',
          reason: 'navigation-requested',
          source: 'host-navigation',
          action: 'back',
          urlHints: browserHostNavigationControlUrlHints(session, 'back'),
        });
        await persistBrowserHostSession(session);
        await session.driver.back(timeout);
        await this.refreshNavigationState(session);
        completeBrowserHostNavigationAction(session, 'back');
      } else if (input.action === 'forward') {
        session.status = 'loading';
        session.updatedAt = new Date().toISOString();
        setBrowserHostSessionLoadingProgress(session, {
          state: 'navigation-start',
          reason: 'navigation-requested',
          source: 'host-navigation',
          action: 'forward',
          urlHints: browserHostNavigationControlUrlHints(session, 'forward'),
        });
        await persistBrowserHostSession(session);
        await session.driver.forward(timeout);
        await this.refreshNavigationState(session);
        completeBrowserHostNavigationAction(session, 'forward');
      } else if (input.action === 'reload') {
        session.status = 'loading';
        session.updatedAt = new Date().toISOString();
        setBrowserHostSessionLoadingProgress(session, {
          state: 'navigation-start',
          reason: 'navigation-requested',
          source: 'host-navigation',
          action: 'reload',
          urlHints: browserHostNavigationControlUrlHints(session, 'reload'),
        });
        await persistBrowserHostSession(session);
        await session.driver.reload(timeout);
        await this.refreshNavigationState(session);
        completeBrowserHostNavigationAction(session, 'reload');
      } else if (input.action === 'stop') {
        session.status = 'loading';
        session.updatedAt = new Date().toISOString();
        setBrowserHostSessionLoadingProgress(session, {
          state: 'stalled',
          reason: 'navigation-stalled',
          source: 'host-action-timing',
          action: 'stop',
          canRetry: true,
          urlHints: browserHostNavigationControlUrlHints(session, 'stop'),
        });
        await persistBrowserHostSession(session);
        await session.driver.stop();
        await this.refreshNavigationState(session);
        session.status = 'ready';
        session.updatedAt = new Date().toISOString();
        setBrowserHostSessionLoadingProgress(session, {
          state: 'network-quiet',
          reason: 'host-ready',
          source: 'host-session',
          action: 'stop',
          urlHints: browserHostNavigationControlUrlHints(session, 'stop'),
        });
      } else if (input.action === 'click') {
        await session.driver.click(requiredNumber(input.x, 'x'), requiredNumber(input.y, 'y'), button);
      } else if (input.action === 'double-click') {
        await browserHostDriverDoubleClick(session.driver, requiredNumber(input.x, 'x'), requiredNumber(input.y, 'y'), button);
      } else if (input.action === 'mouse-down') {
        await browserHostDriverMouseDown(session.driver, requiredNumber(input.x, 'x'), requiredNumber(input.y, 'y'), button);
      } else if (input.action === 'mouse-move') {
        await browserHostDriverMouseMove(session.driver, requiredNumber(input.x, 'x'), requiredNumber(input.y, 'y'));
      } else if (input.action === 'mouse-up') {
        await browserHostDriverMouseUp(session.driver, requiredNumber(input.x, 'x'), requiredNumber(input.y, 'y'), button);
      } else if (input.action === 'drag') {
        await browserHostDriverDrag(session.driver, requiredMousePath(input.path), button);
      } else if (input.action === 'type') {
        await session.driver.type(requiredText(input.text, 'text'));
      } else if (input.action === 'press') {
        await session.driver.press(requiredString(input.key, 'key'));
      } else if (input.action === 'scroll') {
        await session.driver.scroll(
          numberOr(input.deltaX, 0),
          numberOr(input.deltaY, 800),
          optionalFiniteNumber(input.x),
          optionalFiniteNumber(input.y),
        );
      } else if (input.action === 'cursor') {
        const cursor = await session.driver.cursor?.(requiredNumber(input.x, 'x'), requiredNumber(input.y, 'y')).catch(() => 'default');
        session.cursor = normalizeBrowserHostCursor(cursor);
        didCursor = true;
      } else if (input.action === 'native-os-ui-proof') {
        session.nativeOsUiProof = await browserHostDriverNativeOsUiProof(session.driver, input);
      } else if (input.action === 'close') {
        await session.driver.close();
        session.status = 'closed';
        session.driver = undefined;
        didClose = true;
      } else if (input.action !== 'snapshot' && input.action !== 'state') {
        throw new Error(`Unsupported BrowserHostSession action: ${input.action}`);
      }
      markBrowserHostActionTimingActionEnd(timing);
      const captureOptions = browserHostCaptureOptions(input.action, captureMode);
      if (didCursor) {
        finishBrowserHostActionTiming(session, timing, 'ok');
        await persistBrowserHostSession(session);
      } else if (didClose) {
        session.updatedAt = new Date().toISOString();
        finishBrowserHostActionTiming(session, timing, 'ok');
        await persistBrowserHostSession(session);
      } else if (captureOptions && browserHostActionDefersEvidenceCapture(input.action, captureMode)) {
        this.scheduleDeferredEvidenceCapture(session, captureOptions);
        finishBrowserHostActionTiming(session, timing, 'ok', undefined, {
          paintAckSource: session.driver?.liveSurfaceTransport === 'native-embedded'
            ? 'native-adapter-action-state'
            : 'none',
        });
        await persistBrowserHostSession(session);
      } else if (captureOptions) {
        await this.capture(session, captureOptions, timing);
        finishBrowserHostActionTiming(session, timing, 'ok');
        await persistBrowserHostSession(session);
      } else {
        await this.refreshNavigationState(session);
        session.updatedAt = new Date().toISOString();
        finishBrowserHostActionTiming(session, timing, 'ok');
        await persistBrowserHostSession(session);
      }
    } catch (error) {
      markBrowserHostActionTimingActionEnd(timing);
      session.status = 'failed';
      session.updatedAt = new Date().toISOString();
      session.diagnostics.push(browserHostErrorMessage(error));
      setBrowserHostSessionLoadingProgress(session, {
        state: browserHostErrorRequiresHandoff(error) ? 'handoff' : 'blocked',
        reason: 'host-error',
        source: 'host-error',
        action: input.action,
        canRetry: browserHostErrorCanRetry(error) || browserHostLoadingProgressActionCanRetry(input.action),
        blocked: true,
        requiresHandoff: browserHostErrorRequiresHandoff(error),
        urlHints: browserHostNavigationControlUrlHints(session, input.action),
      });
      finishBrowserHostActionTiming(session, timing, 'failed', browserHostErrorMessage(error));
      await persistBrowserHostSession(session);
    }
    return publicBrowserHostSessionState(session);
  }

  async captureFrame(workspacePath: string, sessionId: string): Promise<BrowserHostSessionState> {
    return this.enqueueSessionOperation(sessionId, async () => {
      const session = this.sessions.get(sessionId);
      if (session?.driver && session.status !== 'closed' && session.status !== 'failed') {
        await this.capture(session, {
          includeScreenshot: false,
          includeDom: false,
          includeAx: false,
          includeLogs: false,
        });
        return publicBrowserHostSessionState(session);
      }
      const stored = await readStoredBrowserHostSession(normalizeWorkspaceRootPath(resolve(workspacePath)), sessionId);
      if (stored) return publicBrowserHostSessionState({ ...stored, consoleLog: [], networkLog: [], actionTimingSamples: actionTimingSamplesFromSummaries(stored.actionTimingSummary) });
      throw new Error(`BrowserHostSession is not active: ${sessionId}`);
    });
  }

  async captureFrameIfIdle(
    workspacePath: string,
    sessionId: string,
    input: { quietWindowMs?: number } = {},
  ): Promise<BrowserHostFrameCaptureResult> {
    if (this.sessionOperationQueues.has(sessionId) || this.sessionDeferredCaptureTasks.has(sessionId)) {
      const session = await this.sessionSnapshot(workspacePath, sessionId);
      return { session, captured: false, skippedReason: 'busy' };
    }
    const quietWindowMs = clamp(input.quietWindowMs, 80, 0, 500);
    const lastInputAt = this.sessionInputActivity.get(sessionId) ?? 0;
    if (quietWindowMs > 0 && Date.now() - lastInputAt < quietWindowMs) {
      const session = await this.sessionSnapshot(workspacePath, sessionId);
      return { session, captured: false, skippedReason: 'recent-input' };
    }
    return { session: await this.captureFrame(workspacePath, sessionId), captured: true };
  }

  async search(workspacePath: string, input: BrowserHostSearchInput): Promise<BrowserHostSearchOutput> {
    const query = requiredString(input.query, 'query').replace(/\s+/g, ' ').trim();
    const engine = input.engine === 'duckduckgo' ? 'duckduckgo' : 'bing';
    const limit = clamp(input.limit, 5, 1, 10);
    const searchUrl = browserHostSearchUrl(engine, query, input.region);
    const session = input.sessionId && this.sessions.has(input.sessionId)
      ? await this.act(workspacePath, input.sessionId, { action: 'navigate', url: searchUrl, capture: 'frame', timeoutMs: input.timeoutMs })
      : await this.openSession(workspacePath, {
          url: searchUrl,
          sessionId: input.sessionId,
          timeoutMs: input.timeoutMs,
        });
    const active = this.sessions.get(session.id);
    let results: BrowserHostSearchResult[] = [];
    if (active?.driver?.searchResults) {
      results = boundedSearchResults(await active.driver.searchResults(limit), limit);
    }
    if (!results.length && active?.driver) {
      results = boundedSearchResults(await genericSearchResultsFromDriver(active.driver, limit), limit);
    }
    const resultRef = await persistBrowserHostSearchResults(active ?? session, {
      schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
      query,
      engine,
      searchUrl,
      finalUrl: active?.url || session.url,
      results,
    });
    const automationSummary = browserHostAutomationSummary({
      kind: 'scrape',
      status: results.length ? 'completed' : 'partial',
      title: 'BrowserHostSession search scrape',
      summary: `Search automation returned ${results.length} bounded result${results.length === 1 ? '' : 's'} and materialized refs for browser evidence.`,
      itemCount: results.length,
      refs: browserHostAutomationRefs({
        searchResultRef: resultRef,
        frameRef: active?.frameRef ?? session.frameRef,
        screenshotRef: active?.screenshotRef ?? session.screenshotRef,
        domSnapshotRef: active?.domSnapshotRef ?? session.domSnapshotRef,
        axSnapshotRef: active?.axSnapshotRef ?? session.axSnapshotRef,
        consoleLogRef: active?.consoleLogRef ?? session.consoleLogRef,
        networkLogRef: active?.networkLogRef ?? session.networkLogRef,
      }),
    });
    if (active) {
      active.searchResultRef = resultRef;
      active.automationSummary = automationSummary;
      await persistBrowserHostSession(active);
    }
    const state = active ? publicBrowserHostSessionState(active) : session;
    return {
      schemaVersion: BROWSER_HOST_SEARCH_SCHEMA,
      query,
      engine,
      searchUrl,
      finalUrl: state.url,
      results,
      session: state,
      searchResultRef: resultRef,
      automationSummary,
      screenshotRef: state.screenshotRef,
      domSnapshotRef: state.domSnapshotRef,
      axSnapshotRef: state.axSnapshotRef,
      consoleLogRef: state.consoleLogRef,
      networkLogRef: state.networkLogRef,
    };
  }

  async framePath(workspacePath: string, sessionId: string): Promise<string | undefined> {
    const root = normalizeWorkspaceRootPath(resolve(workspacePath));
    const active = this.sessions.get(sessionId);
    const frameRef = active?.frameRef ?? (await readStoredBrowserHostSession(root, sessionId))?.frameRef;
    if (!frameRef) return undefined;
    const file = browserHostFileForRef(root, sessionId, frameRef);
    return file && existsSync(file) ? file : undefined;
  }

  private driverFactory(): BrowserHostSessionDriverFactory {
    return this.options.driverFactory ?? defaultNativeBrowserHostDriverFactory();
  }

  private noteSessionInputReceived(sessionId: string, atMs = Date.now()): void {
    this.sessionInputActivity.set(sessionId, atMs);
    this.sessionInputEpochs.set(sessionId, (this.sessionInputEpochs.get(sessionId) ?? 0) + 1);
  }

  private noteSessionInputSettled(sessionId: string): void {
    this.sessionInputActivity.set(sessionId, Date.now());
  }

  private enqueueSessionInputOperation(
    workspacePath: string,
    sessionId: string,
    input: BrowserHostSessionActionInput,
    hostReceivedAtMs: number,
  ): Promise<BrowserHostSessionState> {
    return new Promise<BrowserHostSessionState>((resolve, reject) => {
      const pending = this.sessionPendingInputBatches.get(sessionId) ?? [];
      const next = cloneBrowserHostActionInput(input);
      const last = pending[pending.length - 1];
      const merged = last?.workspacePath === workspacePath
        ? coalesceBrowserHostActionInput(last.input, next)
        : undefined;
      if (last && merged) {
        last.input = merged;
        last.hostReceivedAtMs = Math.min(last.hostReceivedAtMs, hostReceivedAtMs);
        last.waiters.push({ resolve, reject });
      } else {
        pending.push({
          workspacePath,
          input: next,
          hostReceivedAtMs,
          waiters: [{ resolve, reject }],
        });
        this.sessionPendingInputBatches.set(sessionId, pending);
      }
      this.ensureSessionInputFlush(sessionId);
    });
  }

  private ensureSessionInputFlush(sessionId: string): void {
    if (this.sessionInputFlushTasks.has(sessionId)) return;
    const current = this.enqueueSessionOperation(sessionId, () => this.flushSessionInputBatches(sessionId));
    const guarded = current.then((completed) => {
      for (const batch of completed) {
        if (batch.error !== undefined) {
          for (const waiter of batch.waiters) waiter.reject(batch.error);
        } else if (batch.state) {
          for (const waiter of batch.waiters) waiter.resolve(batch.state);
        } else {
          for (const waiter of batch.waiters) waiter.reject(new Error(`BrowserHostSession input channel produced no state for ${sessionId}.`));
        }
      }
    }, (error) => {
      const pending = this.sessionPendingInputBatches.get(sessionId) ?? [];
      this.sessionPendingInputBatches.delete(sessionId);
      for (const batch of pending) {
        for (const waiter of batch.waiters) waiter.reject(error);
      }
    });
    this.sessionInputFlushTasks.set(sessionId, guarded);
    void guarded.finally(() => {
      if (this.sessionInputFlushTasks.get(sessionId) === guarded) {
        this.sessionInputFlushTasks.delete(sessionId);
      }
    });
  }

  private async flushSessionInputBatches(sessionId: string): Promise<BrowserHostSessionCompletedInputBatch[]> {
    await Promise.resolve();
    const completed: BrowserHostSessionCompletedInputBatch[] = [];
    while (true) {
      const pending = this.sessionPendingInputBatches.get(sessionId);
      const batch = pending?.shift();
      if (!batch) {
        this.sessionPendingInputBatches.delete(sessionId);
        this.sessionInputFlushTasks.delete(sessionId);
        return completed;
      }
      if (!pending || pending.length === 0) this.sessionPendingInputBatches.delete(sessionId);
      try {
        const session = await this.actUnlocked(batch.workspacePath, sessionId, batch.input, batch.hostReceivedAtMs);
        this.noteSessionInputSettled(sessionId);
        completed.push({ waiters: batch.waiters, state: session });
      } catch (error) {
        this.noteSessionInputSettled(sessionId);
        completed.push({ waiters: batch.waiters, error });
      }
    }
  }

  private scheduleDeferredEvidenceCapture(
    session: ActiveBrowserHostSession,
    options: BrowserHostSessionCaptureOptions,
  ): void {
    const sessionId = session.id;
    const inputEpoch = this.sessionInputEpochs.get(sessionId) ?? 0;
    const previous = this.sessionDeferredCaptureTasks.get(sessionId) ?? Promise.resolve();
    const task = previous.catch(() => undefined).then(async () => {
      await sleep(browserHostDeferredEvidenceCaptureDelayMs());
      if ((this.sessionInputEpochs.get(sessionId) ?? 0) !== inputEpoch) return;
      if (this.sessionOperationQueues.has(sessionId)) return;
      const quietWindowMs = browserHostDeferredEvidenceCaptureQuietWindowMs();
      const lastInputAt = this.sessionInputActivity.get(sessionId) ?? 0;
      const remainingQuietMs = quietWindowMs - (Date.now() - lastInputAt);
      if (remainingQuietMs > 0) await sleep(remainingQuietMs);
      if ((this.sessionInputEpochs.get(sessionId) ?? 0) !== inputEpoch) return;
      if (this.sessionOperationQueues.has(sessionId)) return;
      const active = this.sessions.get(sessionId);
      if (active !== session || !active.driver || active.status === 'closed' || active.status === 'failed') return;
      await this.capture(active, options).catch((error) => {
        active.diagnostics.push(`BrowserHostSession deferred evidence capture skipped: ${browserHostErrorMessage(error)}`);
      });
      await persistBrowserHostSession(active).catch(() => undefined);
    });
    const guarded = task.catch(() => undefined);
    this.sessionDeferredCaptureTasks.set(sessionId, guarded);
    void guarded.finally(() => {
      if (this.sessionDeferredCaptureTasks.get(sessionId) === guarded) {
        this.sessionDeferredCaptureTasks.delete(sessionId);
      }
    });
  }

  private async sessionSnapshot(workspacePath: string, sessionId: string): Promise<BrowserHostSessionState> {
    const active = this.sessions.get(sessionId);
    if (active) return publicBrowserHostSessionState(active);
    const stored = await readStoredBrowserHostSession(normalizeWorkspaceRootPath(resolve(workspacePath)), sessionId);
    if (stored) return publicBrowserHostSessionState({ ...stored, consoleLog: [], networkLog: [], actionTimingSamples: actionTimingSamplesFromSummaries(stored.actionTimingSummary) });
    throw new Error(`BrowserHostSession is not active: ${sessionId}`);
  }

  private async enqueueSessionOperation<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.sessionOperationQueues.get(sessionId) ?? Promise.resolve();
    const current = previous.catch(() => undefined).then(operation);
    const queued = current.catch(() => undefined);
    this.sessionOperationQueues.set(sessionId, queued);
    try {
      return await current;
    } finally {
      if (this.sessionOperationQueues.get(sessionId) === queued) {
        this.sessionOperationQueues.delete(sessionId);
      }
    }
  }

  private async capture(
    session: ActiveBrowserHostSession,
    options: BrowserHostSessionCaptureOptions,
    timing?: BrowserHostActionTimingBuilder,
  ): Promise<void> {
    markBrowserHostActionTimingEvidenceStart(timing);
    await this.refreshNavigationState(session);
    if (session.driver && session.status !== 'closed') {
      const captureId = `${Date.now()}-${sha1(`${session.id}:${session.url}:${session.updatedAt}`).slice(0, 8)}`;
      const dir = browserHostSessionDir(session.workspacePath, session.id);
      await mkdir(dir, { recursive: true });
      const frameFile = join(dir, 'frame.png');
      await captureBrowserHostScreenshot(session, frameFile);
      session.frameRef = browserHostRef(session.id, 'frame.png');
      if (options.includeScreenshot !== false) {
        const screenshotFile = join(dir, `screenshot-${captureId}.png`);
        await copyFile(frameFile, screenshotFile);
        session.screenshotRef = browserHostRef(session.id, basename(screenshotFile));
      }
      if (options.includeDom) {
        const domFile = join(dir, `dom-${captureId}.html`);
        const dom = await browserHostCaptureValue(session, 'DOM snapshot', browserHostDomSnapshotTimeoutMs(), () => session.driver?.content() ?? Promise.resolve(''), () => '<!-- BrowserHostSession DOM snapshot timed out. -->');
        await writeFile(domFile, dom, 'utf8');
        session.domSnapshotRef = browserHostRef(session.id, basename(domFile));
      }
      if (options.includeAx) {
        const axFile = join(dir, `ax-${captureId}.json`);
        const ax = await browserHostCaptureValue(session, 'AX snapshot', browserHostAxSnapshotTimeoutMs(), () => session.driver?.axSnapshot?.() ?? Promise.resolve({}), () => ({ timedOut: true }));
        await writeFile(axFile, JSON.stringify(ax, null, 2), 'utf8');
        session.axSnapshotRef = browserHostRef(session.id, basename(axFile));
      }
      if (options.includeLogs) {
        const consoleFile = join(dir, `console-${captureId}.jsonl`);
        const networkFile = join(dir, `network-${captureId}.jsonl`);
        await writeFile(consoleFile, session.consoleLog.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8');
        await writeFile(networkFile, session.networkLog.map((entry) => JSON.stringify(entry)).join('\n'), 'utf8');
        session.consoleLogRef = browserHostRef(session.id, basename(consoleFile));
        session.networkLogRef = browserHostRef(session.id, basename(networkFile));
      }
    }
    markBrowserHostActionTimingEvidenceEnd(timing);
    session.updatedAt = new Date().toISOString();
    await persistBrowserHostSession(session);
  }

  private async refreshNavigationState(session: ActiveBrowserHostSession): Promise<void> {
    if (!session.driver) return;
    session.url = normalizeBrowserHostUrl(session.driver.url());
    const title = await session.driver.title().catch(() => '');
    session.title = title || undefined;
    session.canGoBack = await session.driver.canGoBack().catch(() => false);
    session.canGoForward = await session.driver.canGoForward().catch(() => false);
    session.updatedAt = new Date().toISOString();
  }
}

function browserHostActionIsUserInput(action: BrowserHostSessionAction): boolean {
  return action === 'click'
    || action === 'double-click'
    || action === 'mouse-down'
    || action === 'mouse-move'
    || action === 'mouse-up'
    || action === 'drag'
    || action === 'type'
    || action === 'press'
    || action === 'scroll'
    || action === 'cursor';
}

function browserHostActionUsesCoalescedInputChannel(input: BrowserHostSessionActionInput): boolean {
  return input.action === 'type' || input.action === 'scroll' || input.action === 'mouse-move';
}

function cloneBrowserHostActionInput(input: BrowserHostSessionActionInput): BrowserHostSessionActionInput {
  return {
    ...input,
    path: input.path?.map((point) => ({ x: point.x, y: point.y })),
    expectedProofNames: input.expectedProofNames?.slice(),
  };
}

function coalesceBrowserHostActionInput(
  left: BrowserHostSessionActionInput,
  right: BrowserHostSessionActionInput,
): BrowserHostSessionActionInput | undefined {
  if (left.action !== right.action) return undefined;
  if (!browserHostActionUsesCoalescedInputChannel(left) || !browserHostActionUsesCoalescedInputChannel(right)) return undefined;
  const capture = strongerBrowserHostCaptureMode(
    browserHostCaptureMode(left.capture) ?? browserHostDefaultCaptureMode(left.action),
    browserHostCaptureMode(right.capture) ?? browserHostDefaultCaptureMode(right.action),
  );
  if (left.action === 'type') {
    if (typeof left.text !== 'string' || typeof right.text !== 'string') return undefined;
    return {
      ...left,
      text: `${left.text}${right.text}`,
      capture,
    };
  }
  if (left.action === 'scroll') {
    const x = optionalFiniteNumber(right.x) ?? optionalFiniteNumber(left.x);
    const y = optionalFiniteNumber(right.y) ?? optionalFiniteNumber(left.y);
    return {
      ...left,
      x,
      y,
      deltaX: numberOr(left.deltaX, 0) + numberOr(right.deltaX, 0),
      deltaY: numberOr(left.deltaY, 800) + numberOr(right.deltaY, 800),
      capture,
    };
  }
  const x = typeof right.x === 'number' && Number.isFinite(right.x) ? right.x : undefined;
  const y = typeof right.y === 'number' && Number.isFinite(right.y) ? right.y : undefined;
  if (x === undefined || y === undefined) return undefined;
  return {
    ...left,
    x,
    y,
    actionId: right.actionId ?? left.actionId,
    uiEventReceivedAt: right.uiEventReceivedAt ?? left.uiEventReceivedAt,
    adapterSentAt: right.adapterSentAt ?? left.adapterSentAt,
    capture,
  };
}

function strongerBrowserHostCaptureMode(
  left: BrowserHostSessionCaptureMode,
  right: BrowserHostSessionCaptureMode,
): BrowserHostSessionCaptureMode {
  if (left === 'full' || right === 'full') return 'full';
  if (left === 'frame' || right === 'frame') return 'frame';
  return 'none';
}

function browserHostActionDefersEvidenceCapture(action: BrowserHostSessionAction, captureMode: BrowserHostSessionCaptureMode): boolean {
  return captureMode !== 'none' && browserHostActionIsUserInput(action) && action !== 'cursor';
}

let defaultManager: BrowserHostSessionManager | undefined;

export function defaultBrowserHostSessionManager() {
  defaultManager = defaultManager ?? new BrowserHostSessionManager();
  return defaultManager;
}

export function normalizeBrowserHostUrl(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return 'about:blank';
  if (/^about:blank$/i.test(trimmed)) return 'about:blank';
  if (/^(?:https?:|file:|about:)/i.test(trimmed)) return trimmed;
  if (/^(?:localhost|127\.0\.0\.1|\[::1\]|0\.0\.0\.0)(?::\d+)?(?:\/|$)/i.test(trimmed)) return `http://${trimmed}`;
  return `https://${trimmed}`;
}

export function browserHostNavigationCommittedAfterTimeout(targetUrl: string, currentUrl: string): boolean {
  const rawCurrent = currentUrl.trim();
  if (!rawCurrent || rawCurrent === 'about:blank' || /^chrome-error:/i.test(rawCurrent)) return false;
  const normalizedTarget = normalizeBrowserHostUrl(targetUrl);
  const normalizedCurrent = normalizeBrowserHostUrl(rawCurrent);
  if (normalizedCurrent === 'about:blank') return false;
  if (/^about:/i.test(normalizedTarget)) return normalizedCurrent === normalizedTarget;
  try {
    const target = new URL(normalizedTarget);
    const current = new URL(normalizedCurrent);
    if (target.protocol !== current.protocol && !(target.protocol === 'https:' && current.protocol === 'http:')) return false;
    return current.hostname === target.hostname || current.hostname.endsWith(`.${target.hostname}`) || target.hostname.endsWith(`.${current.hostname}`);
  } catch {
    return normalizedCurrent === normalizedTarget;
  }
}

function browserHostNavigationProgressFromNativeState(state: Record<string, unknown>): BrowserHostNavigationProgressEvent | undefined {
  const stateUrlHints = browserHostNativeStateUrlHints(state);
  for (const candidate of [state.loadingProgress, state.progress, state.navigation]) {
    if (!isBrowserHostRecord(candidate)) continue;
    const progress = browserHostNavigationProgressFromRecord(candidate, stateUrlHints);
    if (progress) return progress;
  }
  const loading = booleanField(state.loading);
  if (loading !== undefined) {
    return {
      state: loading ? 'navigation-committed' : 'network-quiet',
      reason: loading ? 'navigation-committed' : 'network-quiet',
      source: 'host-state',
      requestedUrl: stateUrlHints.requestedUrl,
      currentUrl: stateUrlHints.currentUrl,
      finalUrl: loading ? undefined : stateUrlHints.finalUrl ?? stateUrlHints.currentUrl,
    };
  }
  return undefined;
}

function browserHostNavigationProgressFromRecord(
  record: Record<string, unknown>,
  fallbackUrlHints: BrowserHostSessionLoadingProgressUrlHints = {},
): BrowserHostNavigationProgressEvent | undefined {
  const state = browserHostLoadingProgressState(record.state ?? record.phase ?? record.stage);
  if (!state) return undefined;
  const urlHints = browserHostNativeStateUrlHints(record, fallbackUrlHints);
  return {
    state,
    reason: browserHostLoadingProgressReason(record.reason) ?? browserHostDefaultLoadingProgressReason(state),
    source: browserHostLoadingProgressSource(record.source) ?? 'host-state',
    requestedUrl: urlHints.requestedUrl,
    currentUrl: urlHints.currentUrl,
    finalUrl: urlHints.finalUrl,
    canRetry: record.canRetry === true || record.retryable === true ? true : undefined,
    blocked: record.blocked === true ? true : undefined,
    requiresHandoff: record.requiresHandoff === true ? true : undefined,
  };
}

function browserHostNavigationProgressKey(progress: BrowserHostNavigationProgressEvent): string {
  return [
    progress.state,
    progress.reason,
    progress.source ?? '',
    browserHostUrlKey(progress.requestedUrl),
    browserHostUrlKey(progress.currentUrl),
    browserHostUrlKey(progress.finalUrl),
    progress.canRetry === true ? 'retry' : '',
    progress.blocked === true ? 'blocked' : '',
    progress.requiresHandoff === true ? 'handoff' : '',
  ].join(':');
}

function browserHostNativeStateUrlHints(
  record: Record<string, unknown>,
  fallback: BrowserHostSessionLoadingProgressUrlHints = {},
): BrowserHostSessionLoadingProgressUrlHints {
  const currentUrl = browserHostUrlField(record.currentUrl ?? record.url ?? record.href) ?? fallback.currentUrl;
  return {
    requestedUrl: browserHostUrlField(record.requestedUrl ?? record.targetUrl) ?? fallback.requestedUrl,
    currentUrl,
    finalUrl: browserHostUrlField(record.finalUrl) ?? fallback.finalUrl ?? (booleanField(record.loading) === false ? currentUrl : undefined),
  };
}

function browserHostDefaultLoadingProgressReason(state: BrowserHostSessionLoadingProgressState): BrowserHostSessionLoadingProgressReason {
  if (state === 'navigation-start') return 'navigation-requested';
  if (state === 'navigation-committed') return 'navigation-committed';
  if (state === 'interactive') return 'page-interactive';
  if (state === 'load') return 'page-load';
  if (state === 'network-quiet') return 'network-quiet';
  if (state === 'stalled') return 'navigation-stalled';
  if (state === 'blocked') return 'navigation-blocked';
  if (state === 'retry') return 'navigation-retry';
  return 'user-handoff-required';
}

function isBrowserHostRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function browserHostNativeActionRequiresLoadingProgress(action: unknown): boolean {
  return action === 'back' || action === 'forward' || action === 'reload' || action === 'stop';
}

function defaultNativeBrowserHostDriverFactory(): BrowserHostSessionDriverFactory {
  const nativeAdapterUrl = browserHostNativeAdapterUrl();
  if (nativeAdapterUrl) return createNativeEmbeddedBrowserHostDriverFactory(nativeAdapterUrl);
  return {
    async create(_input) {
      throw new NativeEmbeddedBrowserHostAdapterError(
        'Native embedded BrowserHostSession adapter is required; set SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL to a loopback native adapter. Legacy host-stream fallback is disabled.',
        true,
        true,
      );
    },
  };
}

export function createNativeEmbeddedBrowserHostDriverFactory(adapterBaseUrl: string): BrowserHostSessionDriverFactory {
  const baseUrl = adapterBaseUrl.replace(/\/+$/, '');
  return {
    async create(input) {
      const driver = new NativeEmbeddedBrowserHostDriver(baseUrl, input.sessionId, input.viewport, input.timeoutMs, input.workspaceProfileDir);
      await driver.start();
      return driver;
    },
  };
}

async function createPlaywrightBrowserHostDriver(input: { viewport: BrowserHostSessionViewport; timeoutMs: number; workspaceProfileDir: string }): Promise<BrowserHostSessionDriver> {
  let chromium: Awaited<typeof import('playwright-core')>['chromium'];
  try {
    ({ chromium } = await import('playwright-core'));
  } catch (error) {
    throw new Error(`Playwright browser host is unavailable: ${browserHostErrorMessage(error)}`);
  }
  const executablePath = browserHostExecutablePath();
  await mkdir(input.workspaceProfileDir, { recursive: true });
  const context = await chromium.launchPersistentContext(input.workspaceProfileDir, {
    headless: true,
    ...(executablePath ? { executablePath } : {}),
    args: browserHostChromiumArgs(),
    viewport: input.viewport,
    locale: 'en-US',
    userAgent: 'SciForgeBrowserHostSession/1.0',
  });
  const page = await context.newPage();
  page.setDefaultTimeout(input.timeoutMs);
  page.setDefaultNavigationTimeout(input.timeoutMs);
  return new PlaywrightBrowserHostDriver(context.browser(), context, page);
}

class NativeEmbeddedBrowserHostDriver implements BrowserHostSessionDriver {
  readonly liveSurfaceTransport = 'native-embedded' as const;
  readonly nativeAdapterUrl: string;
  nativeOsUiProof?: BrowserHostSessionNativeOsUiProof;
  private readonly navigationProgressListeners = new Set<(progress: BrowserHostNavigationProgressEvent) => void>();
  private lastNavigationProgressKey?: string;

  constructor(
    private readonly adapterBaseUrl: string,
    private readonly sessionId: string,
    private readonly viewport: BrowserHostSessionViewport,
    private readonly timeoutMs: number,
    private readonly workspaceProfileDir: string,
  ) {
    this.nativeAdapterUrl = adapterBaseUrl;
  }

  async start(): Promise<void> {
    await this.post('/sessions/start', {
      sessionId: this.sessionId,
      width: this.viewport.width,
      height: this.viewport.height,
      timeoutMs: this.timeoutMs,
      workspaceProfileDir: this.workspaceProfileDir,
    });
  }

  async goto(url: string, timeoutMs: number): Promise<void> {
    const state = await this.post(`/sessions/${encodeURIComponent(this.sessionId)}/navigate`, { url, timeoutMs });
    const emittedProgress = this.cacheState(state);
    if (!emittedProgress) this.emitMissingNativeProgress('navigate', state);
  }

  url(): string {
    const cached = this.lastState?.url;
    if (cached) return cached;
    return 'about:blank';
  }

  async title(): Promise<string> {
    return cleanText((await this.state()).title ?? '');
  }

  async content(): Promise<string> {
    const outputPath = this.evidenceOutputPath('dom', 'html');
    await this.post(`/sessions/${encodeURIComponent(this.sessionId)}/content`, { outputPath });
    return await readFile(outputPath, 'utf8');
  }

  async text(): Promise<string> {
    const outputPath = this.evidenceOutputPath('text', 'txt');
    await this.post(`/sessions/${encodeURIComponent(this.sessionId)}/text`, { outputPath });
    return await readFile(outputPath, 'utf8');
  }

  async screenshot(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    await this.post(`/sessions/${encodeURIComponent(this.sessionId)}/screenshot`, { outputPath: path });
  }

  async axSnapshot(): Promise<unknown> {
    const outputPath = this.evidenceOutputPath('ax', 'json');
    await this.post(`/sessions/${encodeURIComponent(this.sessionId)}/ax`, { outputPath });
    return JSON.parse(await readFile(outputPath, 'utf8'));
  }

  async searchResults(limit: number): Promise<BrowserHostSearchResult[]> {
    const json = await this.get<{ results?: unknown }>(`/sessions/${encodeURIComponent(this.sessionId)}/search-results?limit=${encodeURIComponent(String(limit))}`);
    return boundedSearchResults(Array.isArray(json.results) ? json.results.map(nativeSearchResult) : [], limit);
  }

  async canGoBack(): Promise<boolean> {
    return (await this.state()).canGoBack === true;
  }

  async canGoForward(): Promise<boolean> {
    return (await this.state()).canGoForward === true;
  }

  async back(): Promise<void> {
    await this.action({ action: 'back' });
  }

  async forward(): Promise<void> {
    await this.action({ action: 'forward' });
  }

  async reload(): Promise<void> {
    await this.action({ action: 'reload' });
  }

  async stop(): Promise<void> {
    await this.action({ action: 'stop' });
  }

  async click(x: number, y: number, button?: BrowserHostMouseButton): Promise<void> {
    await this.action({ action: 'click', x, y, button });
  }

  async doubleClick(x: number, y: number, button?: BrowserHostMouseButton): Promise<void> {
    await this.action({ action: 'double-click', x, y, button });
  }

  async mouseDown(x: number, y: number, button?: BrowserHostMouseButton): Promise<void> {
    await this.action({ action: 'mouse-down', x, y, button });
  }

  async mouseMove(x: number, y: number): Promise<void> {
    await this.action({ action: 'mouse-move', x, y });
  }

  async mouseUp(x: number, y: number, button?: BrowserHostMouseButton): Promise<void> {
    await this.action({ action: 'mouse-up', x, y, button });
  }

  async drag(path: BrowserHostMousePoint[], button?: BrowserHostMouseButton): Promise<void> {
    await this.action({ action: 'drag', path, button });
  }

  async type(text: string): Promise<void> {
    await this.action({ action: 'type', text });
  }

  async press(key: string): Promise<void> {
    await this.action({ action: 'press', key });
  }

  async scroll(deltaX: number, deltaY: number, x?: number, y?: number): Promise<void> {
    await this.action({ action: 'scroll', deltaX, deltaY, x, y });
  }

  async cursor(x: number, y: number): Promise<string> {
    const json = await this.action({ action: 'cursor', x, y });
    const diagnostic = Array.isArray(json.diagnostics)
      ? json.diagnostics.slice().reverse().find((entry): entry is string => typeof entry === 'string' && entry.startsWith('cursor:'))
      : undefined;
    return diagnostic?.slice('cursor:'.length) || 'default';
  }

  async proveNativeOsUi(input: BrowserHostSessionActionInput): Promise<BrowserHostSessionNativeOsUiProof | undefined> {
    const state = await this.action({
      action: 'native-os-ui-proof',
      proofGroup: input.proofGroup,
      probe: input.probe,
      expectedProofNames: browserHostNativeOsUiExpectedProofNames(
        input.expectedProofNames,
        browserHostNativeOsUiProofGroup(input.proofGroup),
      ),
      actionId: input.actionId,
      capture: 'none',
    });
    return browserHostNativeOsUiProofFromNativeState(state);
  }

  async close(): Promise<void> {
    await this.action({ action: 'close' });
  }

  onNavigationProgress(listener: (progress: BrowserHostNavigationProgressEvent) => void): void {
    this.navigationProgressListeners.add(listener);
  }

  private lastState?: { url?: string; title?: string; canGoBack?: boolean; canGoForward?: boolean; loading?: boolean };

  private async state(): Promise<{ url?: string; title?: string; canGoBack?: boolean; canGoForward?: boolean; loading?: boolean }> {
    const state = await this.get<{ url?: string; title?: string; canGoBack?: boolean; canGoForward?: boolean; loading?: boolean }>(`/sessions/${encodeURIComponent(this.sessionId)}/state`);
    this.cacheState(state);
    return state;
  }

  private async action(body: Record<string, unknown>): Promise<Record<string, unknown>> {
    const state = await this.post(`/sessions/${encodeURIComponent(this.sessionId)}/actions`, body);
    const proof = browserHostNativeOsUiProofFromNativeState(state);
    if (proof) this.nativeOsUiProof = proof;
    else if (body.action === 'native-os-ui-proof') this.nativeOsUiProof = undefined;
    const emittedProgress = this.cacheState(state);
    if (!emittedProgress && browserHostNativeActionRequiresLoadingProgress(body.action)) {
      this.emitMissingNativeProgress(String(body.action), state);
    }
    return state;
  }

  private cacheState(state: Record<string, unknown>): boolean {
    this.lastState = {
      url: typeof state.url === 'string' ? state.url : this.lastState?.url,
      title: typeof state.title === 'string' ? state.title : this.lastState?.title,
      canGoBack: state.canGoBack === true,
      canGoForward: state.canGoForward === true,
      loading: booleanField(state.loading) ?? this.lastState?.loading,
    };
    const progress = browserHostNavigationProgressFromNativeState(state);
    if (progress) {
      const progressKey = browserHostNavigationProgressKey(progress);
      if (this.lastNavigationProgressKey === progressKey) return true;
      this.lastNavigationProgressKey = progressKey;
      for (const listener of this.navigationProgressListeners) listener(progress);
      return true;
    }
    return false;
  }

  private emitMissingNativeProgress(action: string, state: Record<string, unknown>): void {
    const urlHints = browserHostNativeStateUrlHints(state, {
      currentUrl: this.lastState?.url,
    });
    const progress: BrowserHostNavigationProgressEvent = {
      state: 'blocked',
      reason: 'host-diagnostic',
      source: 'host-state',
      requestedUrl: urlHints.requestedUrl,
      currentUrl: urlHints.currentUrl,
      finalUrl: urlHints.finalUrl,
      canRetry: true,
      blocked: true,
    };
    const progressKey = browserHostNavigationProgressKey(progress);
    if (this.lastNavigationProgressKey === progressKey) return;
    this.lastNavigationProgressKey = progressKey;
    for (const listener of this.navigationProgressListeners) listener(progress);
  }

  private async get<T extends Record<string, unknown>>(path: string): Promise<T> {
    return nativeEmbeddedJson<T>(`${this.adapterBaseUrl}${path}`);
  }

  private async post<T extends Record<string, unknown> = Record<string, unknown>>(path: string, body: Record<string, unknown>): Promise<T> {
    return nativeEmbeddedJson<T>(`${this.adapterBaseUrl}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  private evidenceOutputPath(kind: string, extension: string): string {
    return join(
      dirname(this.workspaceProfileDir),
      'native-evidence',
      this.sessionId,
      `${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}.${extension}`,
    );
  }
}

async function nativeEmbeddedJson<T extends Record<string, unknown>>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const text = await response.text();
  const json = text ? JSON.parse(text) as Record<string, unknown> : {};
  if (!response.ok || json.ok === false) {
    const reason = typeof json.reason === 'string' ? json.reason : typeof json.error === 'string' ? json.error : response.statusText;
    throw new NativeEmbeddedBrowserHostAdapterError(`Native embedded BrowserHostSession adapter failed: ${reason}`, json.retryable === true);
  }
  return json as T;
}

class NativeEmbeddedBrowserHostAdapterError extends Error {
  constructor(message: string, readonly retryable: boolean, readonly requiresHandoff = false) {
    super(message);
    this.name = 'NativeEmbeddedBrowserHostAdapterError';
  }
}

function browserHostNativeAdapterUrl(): string | undefined {
  const value = process.env.SCIFORGE_BROWSER_HOST_NATIVE_ADAPTER_URL?.trim();
  if (!value) return undefined;
  try {
    const url = new URL(value);
    if (url.protocol !== 'http:' || !/^(?:127\.0\.0\.1|localhost|::1)$/i.test(url.hostname)) return undefined;
    return value.replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function browserHostChromiumArgs() {
  const args = ['--disable-dev-shm-usage', '--no-sandbox'];
  const resolverRules = process.env.SCIFORGE_BROWSER_HOST_RESOLVER_RULES?.trim();
  if (resolverRules) args.push(`--host-resolver-rules=${resolverRules}`);
  const proxyServer = process.env.SCIFORGE_BROWSER_HOST_PROXY_SERVER?.trim();
  if (proxyServer) args.push(`--proxy-server=${proxyServer}`);
  const proxyBypassList = process.env.SCIFORGE_BROWSER_HOST_PROXY_BYPASS_LIST?.trim();
  if (proxyBypassList) args.push(`--proxy-bypass-list=${proxyBypassList}`);
  return args;
}

class PlaywrightBrowserHostDriver implements BrowserHostSessionDriver {
  private readonly consoleListeners = new Set<(entry: Record<string, unknown>) => void>();
  private readonly networkListeners = new Set<(entry: Record<string, unknown>) => void>();
  private readonly navigationProgressListeners = new Set<(progress: BrowserHostNavigationProgressEvent) => void>();
  private readonly history: string[] = [];
  private historyIndex = -1;
  private activeMouseDown?: { x: number; y: number; button: BrowserHostMouseButton; clickCount: number; moved: boolean };
  private lastMouseUp?: { x: number; y: number; button: BrowserHostMouseButton; at: number; clickCount: number };

  constructor(
    private readonly browser: Browser | null,
    private readonly context: BrowserContext,
    private readonly page: Page,
  ) {
    page.on('console', (message) => {
      this.emitConsole({
        ts: new Date().toISOString(),
        type: message.type(),
        text: clip(message.text(), 2000),
        location: message.location(),
      });
    });
    page.on('request', (request) => {
      this.emitNetwork({
        ts: new Date().toISOString(),
        event: 'request',
        method: request.method(),
        url: request.url(),
        resourceType: request.resourceType(),
      });
    });
    page.on('response', (response) => {
      this.emitNetwork({
        ts: new Date().toISOString(),
        event: 'response',
        status: response.status(),
        url: response.url(),
      });
    });
    page.on('requestfailed', (request) => {
      this.emitNetwork({
        ts: new Date().toISOString(),
        event: 'requestfailed',
        method: request.method(),
        url: request.url(),
        failure: request.failure()?.errorText,
      });
    });
  }

  async goto(url: string, timeoutMs: number): Promise<void> {
    const targetUrl = normalizeBrowserHostUrl(url);
    try {
      await this.page.goto(targetUrl, { waitUntil: 'commit', timeout: timeoutMs });
      this.emitNavigationProgress({ state: 'navigation-committed', reason: 'navigation-committed' });
    } catch (error) {
      if (!browserHostNavigationCommittedAfterTimeout(targetUrl, this.page.url())) throw error;
      await this.page.evaluate(() => window.stop()).catch(() => undefined);
      this.emitNavigationProgress({ state: 'stalled', reason: 'navigation-stalled', source: 'host-progress', canRetry: true });
    }
    const domReady = await this.waitForDomContentLoaded();
    this.emitNavigationProgress(domReady
      ? { state: 'interactive', reason: 'page-interactive' }
      : { state: 'stalled', reason: 'navigation-stalled', source: 'host-progress', canRetry: true });
    const loaded = await this.waitForLoad();
    if (loaded) this.emitNavigationProgress({ state: 'load', reason: 'page-load' });
    const settled = await this.waitForSettle(timeoutMs);
    this.emitNavigationProgress(settled
      ? { state: 'network-quiet', reason: 'network-quiet', source: 'host-progress' }
      : { state: 'stalled', reason: 'navigation-stalled', source: 'host-progress', canRetry: true });
    this.recordNavigation();
  }

  url(): string {
    return this.page.url();
  }

  async title(): Promise<string> {
    return cleanText(await this.page.title().catch(() => ''));
  }

  async content(): Promise<string> {
    return this.page.content();
  }

  async text(): Promise<string> {
    return cleanText(await this.page.locator('body').innerText({ timeout: 3000 }).catch(async () => htmlToText(await this.page.content())));
  }

  async screenshot(path: string): Promise<void> {
    await mkdir(dirname(path), { recursive: true });
    const previousNoFontsReady = process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
    process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = '1';
    try {
      await this.page.screenshot({
        path,
        fullPage: false,
        type: 'png',
        timeout: browserHostScreenshotTimeoutMs(),
      });
    } finally {
      if (previousNoFontsReady === undefined) {
        delete process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY;
      } else {
        process.env.PW_TEST_SCREENSHOT_NO_FONTS_READY = previousNoFontsReady;
      }
    }
  }

  async axSnapshot(): Promise<unknown> {
    try {
      const session = await this.context.newCDPSession(this.page);
      return await session.send('Accessibility.getFullAXTree');
    } catch {
      return this.page.locator('body').evaluate((body) => ({
        role: 'document',
        name: document.title,
        text: (body.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 4000),
      })).catch(() => ({}));
    }
  }

  async searchResults(limit: number): Promise<BrowserHostSearchResult[]> {
    const rows = await this.page.$$eval('a[href]', (nodes) => nodes.map((node) => {
      const anchor = node as HTMLAnchorElement;
      const container = anchor.closest('li, article, div') as HTMLElement | null;
      return {
        title: (anchor.textContent ?? '').replace(/\s+/g, ' ').trim(),
        url: anchor.href,
        snippet: (container?.innerText ?? '').replace(/\s+/g, ' ').trim(),
      };
    }));
    return boundedSearchResults(rows.map((row) => ({
      title: cleanText(row.title),
      url: decodeSearchRedirect(row.url),
      snippet: cleanText(row.snippet).replace(cleanText(row.title), '').trim(),
    })), limit);
  }

  async canGoBack(): Promise<boolean> {
    return this.historyIndex > 0;
  }

  async canGoForward(): Promise<boolean> {
    return this.historyIndex >= 0 && this.historyIndex < this.history.length - 1;
  }

  async back(timeoutMs: number): Promise<void> {
    if (this.historyIndex > 0) this.historyIndex -= 1;
    await this.page.goBack({ waitUntil: 'commit', timeout: timeoutMs }).catch(() => undefined);
    const domReady = await this.waitForDomContentLoaded();
    if (domReady) this.emitNavigationProgress({ state: 'interactive', reason: 'page-interactive' });
    const loaded = await this.waitForLoad();
    if (loaded) this.emitNavigationProgress({ state: 'load', reason: 'page-load' });
    const settled = await this.waitForSettle(timeoutMs);
    this.emitNavigationProgress(settled
      ? { state: 'network-quiet', reason: 'network-quiet', source: 'host-progress' }
      : { state: 'stalled', reason: 'navigation-stalled', source: 'host-progress', canRetry: true });
    this.syncHistoryPosition();
  }

  async forward(timeoutMs: number): Promise<void> {
    if (this.historyIndex < this.history.length - 1) this.historyIndex += 1;
    await this.page.goForward({ waitUntil: 'commit', timeout: timeoutMs }).catch(() => undefined);
    const domReady = await this.waitForDomContentLoaded();
    if (domReady) this.emitNavigationProgress({ state: 'interactive', reason: 'page-interactive' });
    const loaded = await this.waitForLoad();
    if (loaded) this.emitNavigationProgress({ state: 'load', reason: 'page-load' });
    const settled = await this.waitForSettle(timeoutMs);
    this.emitNavigationProgress(settled
      ? { state: 'network-quiet', reason: 'network-quiet', source: 'host-progress' }
      : { state: 'stalled', reason: 'navigation-stalled', source: 'host-progress', canRetry: true });
    this.syncHistoryPosition();
  }

  async reload(timeoutMs: number): Promise<void> {
    await this.page.reload({ waitUntil: 'commit', timeout: timeoutMs }).catch(() => undefined);
    const domReady = await this.waitForDomContentLoaded();
    if (domReady) this.emitNavigationProgress({ state: 'interactive', reason: 'page-interactive' });
    const loaded = await this.waitForLoad();
    if (loaded) this.emitNavigationProgress({ state: 'load', reason: 'page-load' });
    const settled = await this.waitForSettle(timeoutMs);
    this.emitNavigationProgress(settled
      ? { state: 'network-quiet', reason: 'network-quiet', source: 'host-progress' }
      : { state: 'stalled', reason: 'navigation-stalled', source: 'host-progress', canRetry: true });
    this.syncHistoryPosition();
  }

  async stop(): Promise<void> {
    await this.page.evaluate(() => window.stop()).catch(() => undefined);
  }

  async click(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    const beforeUrl = this.page.url();
    await this.page.mouse.click(x, y, { button });
    await this.waitForInteractiveNavigationOrSettle(beforeUrl);
    this.recordNavigation();
  }

  async doubleClick(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    const beforeUrl = this.page.url();
    await this.page.mouse.dblclick(x, y, { button });
    await this.waitForInteractiveNavigationOrSettle(beforeUrl);
    this.recordNavigation();
  }

  async mouseDown(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    const clickCount = this.nextMouseClickCount(x, y, button);
    await this.page.mouse.move(x, y);
    await this.page.mouse.down({ button, clickCount });
    this.activeMouseDown = { x, y, button, clickCount, moved: false };
  }

  async mouseMove(x: number, y: number): Promise<void> {
    if (this.activeMouseDown && Math.hypot(x - this.activeMouseDown.x, y - this.activeMouseDown.y) > 4) {
      this.activeMouseDown.moved = true;
    }
    await this.page.mouse.move(x, y);
  }

  async mouseUp(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    const beforeUrl = this.page.url();
    const active = this.activeMouseDown;
    const moved = !active || active.moved || Math.hypot(x - active.x, y - active.y) > 4 || active.button !== button;
    const clickCount = active && active.button === button ? active.clickCount : 1;
    await this.page.mouse.move(x, y);
    await this.page.mouse.up({ button, clickCount });
    this.activeMouseDown = undefined;
    this.lastMouseUp = moved ? undefined : { x, y, button, at: Date.now(), clickCount };
    await this.waitForInteractiveNavigationOrSettle(beforeUrl);
    this.recordNavigation();
  }

  async drag(path: BrowserHostMousePoint[], button: BrowserHostMouseButton = 'left'): Promise<void> {
    const beforeUrl = this.page.url();
    const [first, ...rest] = path;
    this.activeMouseDown = undefined;
    this.lastMouseUp = undefined;
    await this.page.mouse.move(first.x, first.y);
    await this.page.mouse.down({ button });
    for (const point of rest) {
      await this.page.mouse.move(point.x, point.y);
    }
    await this.page.mouse.up({ button });
    await this.waitForInteractiveNavigationOrSettle(beforeUrl);
    this.recordNavigation();
  }

  private nextMouseClickCount(x: number, y: number, button: BrowserHostMouseButton): number {
    const last = this.lastMouseUp;
    if (!last || last.button !== button) return 1;
    if (Date.now() - last.at > 500) return 1;
    if (Math.hypot(x - last.x, y - last.y) > 4) return 1;
    return Math.min(last.clickCount + 1, 3);
  }

  async type(text: string): Promise<void> {
    await this.page.keyboard.insertText(text);
    this.recordNavigation();
  }

  async press(key: string): Promise<void> {
    const beforeUrl = this.page.url();
    await this.page.keyboard.press(key);
    await this.waitForInteractiveNavigationOrSettle(beforeUrl);
    this.recordNavigation();
  }

  async scroll(deltaX: number, deltaY: number, x?: number, y?: number): Promise<void> {
    if (x !== undefined && y !== undefined) await this.page.mouse.move(x, y);
    await this.page.mouse.wheel(deltaX, deltaY);
  }

  async cursor(x: number, y: number): Promise<string> {
    return this.page.evaluate(({ x, y }) => {
      const element = document.elementFromPoint(x, y);
      if (!(element instanceof HTMLElement) && !(element instanceof SVGElement)) return 'default';
      const target = element as Element;
      const cursor = getComputedStyle(target).cursor;
      if (cursor && cursor !== 'auto' && cursor !== 'default') return cursor;
      if (target.closest('input:not([type="button"]):not([type="submit"]):not([type="reset"]):not([type="checkbox"]):not([type="radio"]), textarea, [contenteditable="true"], [contenteditable=""]')) {
        return 'text';
      }
      if (target.closest('a[href], button:not(:disabled), summary, select, label, [role="button"], [role="link"], [role="menuitem"], input[type="button"], input[type="submit"], input[type="reset"], input[type="checkbox"], input[type="radio"]')) {
        return 'pointer';
      }
      return 'default';
    }, { x, y }).catch(() => 'default');
  }

  async close(): Promise<void> {
    await this.context.close().catch(() => undefined);
    await this.browser?.close().catch(() => undefined);
  }

  onConsole(listener: (entry: Record<string, unknown>) => void): void {
    this.consoleListeners.add(listener);
  }

  onNetwork(listener: (entry: Record<string, unknown>) => void): void {
    this.networkListeners.add(listener);
  }

  onNavigationProgress(listener: (progress: BrowserHostNavigationProgressEvent) => void): void {
    this.navigationProgressListeners.add(listener);
  }

  private async waitForSettle(timeoutMs: number, maxSettleMs = browserHostNavigationSettleMs(timeoutMs)): Promise<boolean> {
    const settleMs = Math.min(timeoutMs, maxSettleMs);
    if (settleMs <= 0) return false;
    return this.page.waitForLoadState('networkidle', { timeout: settleMs }).then(() => true, () => false);
  }

  private async waitForInteractiveNavigationOrSettle(beforeUrl: string): Promise<void> {
    await this.page.waitForTimeout(browserHostInteractiveNavigationGraceMs()).catch(() => undefined);
    const afterUrl = this.page.url();
    const navigated = normalizeBrowserHostUrl(afterUrl) !== normalizeBrowserHostUrl(beforeUrl);
    if (!navigated) return;
    const domReady = await this.waitForDomContentLoaded(browserHostInteractiveDomContentLoadedSettleMs());
    if (domReady) this.emitNavigationProgress({ state: 'interactive', reason: 'page-interactive' });
    const settleMs = normalizeBrowserHostUrl(afterUrl) === normalizeBrowserHostUrl(beforeUrl)
      ? browserHostInteractiveSettleMs()
      : browserHostInteractiveNavigationSettleMs();
    const settled = await this.waitForSettle(8000, settleMs);
    if (settled) {
      this.emitNavigationProgress({ state: 'network-quiet', reason: 'network-quiet', source: 'host-progress' });
    }
  }

  private async waitForDomContentLoaded(maxSettleMs = browserHostDomContentLoadedSettleMs()): Promise<boolean> {
    if (maxSettleMs <= 0) return false;
    return this.page.waitForLoadState('domcontentloaded', { timeout: maxSettleMs }).then(() => true, () => false);
  }

  private async waitForLoad(maxSettleMs = browserHostLoadSettleMs()): Promise<boolean> {
    if (maxSettleMs <= 0) return false;
    return this.page.waitForLoadState('load', { timeout: maxSettleMs }).then(() => true, () => false);
  }

  private recordNavigation(url = this.page.url()) {
    const normalized = normalizeBrowserHostUrl(url);
    if (this.history[this.historyIndex] === normalized) return;
    if (this.historyIndex < this.history.length - 1) this.history.splice(this.historyIndex + 1);
    this.history.push(normalized);
    this.historyIndex = this.history.length - 1;
  }

  private syncHistoryPosition() {
    const normalized = normalizeBrowserHostUrl(this.page.url());
    const knownIndex = this.history.lastIndexOf(normalized);
    if (knownIndex >= 0) {
      this.historyIndex = knownIndex;
      return;
    }
    this.recordNavigation(normalized);
  }

  private emitConsole(entry: Record<string, unknown>) {
    for (const listener of this.consoleListeners) listener(entry);
  }

  private emitNetwork(entry: Record<string, unknown>) {
    for (const listener of this.networkListeners) listener(entry);
  }

  private emitNavigationProgress(progress: BrowserHostNavigationProgressEvent) {
    for (const listener of this.navigationProgressListeners) listener(progress);
  }
}

async function browserHostDriverDoubleClick(driver: BrowserHostSessionDriver, x: number, y: number, button?: BrowserHostMouseButton): Promise<void> {
  if (driver.doubleClick) {
    await driver.doubleClick(x, y, button);
    return;
  }
  await driver.click(x, y, button);
  await driver.click(x, y, button);
}

async function browserHostDriverMouseDown(driver: BrowserHostSessionDriver, x: number, y: number, button?: BrowserHostMouseButton): Promise<void> {
  if (!driver.mouseDown) throw new Error('BrowserHostSession driver does not support mouse-down.');
  await driver.mouseDown(x, y, button);
}

async function browserHostDriverMouseMove(driver: BrowserHostSessionDriver, x: number, y: number): Promise<void> {
  if (!driver.mouseMove) throw new Error('BrowserHostSession driver does not support mouse-move.');
  await driver.mouseMove(x, y);
}

async function browserHostDriverMouseUp(driver: BrowserHostSessionDriver, x: number, y: number, button?: BrowserHostMouseButton): Promise<void> {
  if (!driver.mouseUp) throw new Error('BrowserHostSession driver does not support mouse-up.');
  await driver.mouseUp(x, y, button);
}

async function browserHostDriverDrag(driver: BrowserHostSessionDriver, path: BrowserHostMousePoint[], button?: BrowserHostMouseButton): Promise<void> {
  if (driver.mouseDown && driver.mouseMove && driver.mouseUp) {
    const [first, ...rest] = path;
    await driver.mouseDown(first.x, first.y, button);
    for (const point of rest) await driver.mouseMove(point.x, point.y);
    const last = path[path.length - 1];
    await driver.mouseUp(last.x, last.y, button);
    return;
  }
  if (driver.drag) {
    await driver.drag(path, button);
    return;
  }
  throw new Error('BrowserHostSession driver does not support streamed drag pointer events.');
}

async function browserHostDriverNativeOsUiProof(
  driver: BrowserHostSessionDriver,
  input: BrowserHostSessionActionInput,
): Promise<BrowserHostSessionNativeOsUiProof | undefined> {
  if (!driver.proveNativeOsUi) throw new Error('BrowserHostSession driver does not support bounded native OS UI proof actions.');
  return browserHostNativeOsUiProofFromUnknown(await driver.proveNativeOsUi(input));
}

function attachDriverDiagnostics(session: ActiveBrowserHostSession) {
  session.driver?.onConsole?.((entry) => {
    session.consoleLog.push(scrubBrowserHostLogEntry(entry));
    if (session.consoleLog.length > 200) session.consoleLog.splice(0, session.consoleLog.length - 200);
  });
  session.driver?.onNetwork?.((entry) => {
    session.networkLog.push(scrubBrowserHostLogEntry(entry));
    if (session.networkLog.length > 400) session.networkLog.splice(0, session.networkLog.length - 400);
  });
  session.driver?.onNavigationProgress?.((progress) => {
    if (session.status === 'closed' || session.status === 'failed') return;
    const existingAction = session.loadingProgress?.action;
    applyBrowserHostNavigationProgressUrls(session, progress);
    session.status = browserHostSessionStatusForNavigationProgress(session, progress);
    session.updatedAt = new Date().toISOString();
    setBrowserHostSessionLoadingProgress(session, {
      state: progress.state,
      reason: progress.reason,
      source: progress.source ?? 'host-lifecycle',
      action: existingAction,
      canRetry: progress.canRetry,
      blocked: progress.blocked,
      requiresHandoff: progress.requiresHandoff,
      urlHints: browserHostUrlHintsForNavigationProgress(session, progress),
    });
    void persistBrowserHostSession(session).catch(() => undefined);
  });
}

function applyBrowserHostNavigationProgressUrls(
  session: ActiveBrowserHostSession,
  progress: BrowserHostNavigationProgressEvent,
): void {
  const requestedUrl = browserHostUrlField(progress.requestedUrl);
  const currentUrl = browserHostUrlField(progress.currentUrl);
  const finalUrl = browserHostUrlField(progress.finalUrl);
  if (requestedUrl) session.requestedUrl = requestedUrl;
  if (finalUrl) session.url = finalUrl;
  else if (currentUrl) session.url = currentUrl;
}

function browserHostUrlHintsForNavigationProgress(
  session: ActiveBrowserHostSession,
  progress: BrowserHostNavigationProgressEvent,
): BrowserHostSessionLoadingProgressUrlHints {
  return {
    requestedUrl: browserHostUrlField(progress.requestedUrl) ?? session.requestedUrl,
    currentUrl: browserHostUrlField(progress.currentUrl) ?? session.url,
    finalUrl: browserHostUrlField(progress.finalUrl) ?? (progress.state === 'network-quiet' ? browserHostUrlField(progress.currentUrl) ?? session.url : undefined),
  };
}

function browserHostSessionStatusForNavigationProgress(
  session: ActiveBrowserHostSession,
  progress: BrowserHostNavigationProgressEvent,
): BrowserHostSessionStatus {
  if (progress.state === 'blocked' || progress.state === 'handoff') return 'failed';
  if (progress.state === 'network-quiet') return 'ready';
  if ((progress.state === 'interactive' || progress.state === 'load') && session.status === 'ready') {
    const sessionUrl = normalizeBrowserHostUrl(session.url);
    const driverUrl = session.driver ? normalizeBrowserHostUrl(session.driver.url()) : sessionUrl;
    if (driverUrl === sessionUrl) return 'ready';
  }
  return 'loading';
}

function browserHostCaptureOptions(
  action: BrowserHostSessionAction,
  requested: BrowserHostSessionCaptureMode | undefined,
): BrowserHostSessionCaptureOptions | undefined {
  const mode = browserHostCaptureMode(requested) ?? browserHostDefaultCaptureMode(action);
  if (mode === 'none') return undefined;
  if (mode === 'frame') {
    return {
      includeScreenshot: false,
      includeDom: false,
      includeAx: false,
      includeLogs: false,
    };
  }
  return {
    includeScreenshot: true,
    includeDom: true,
    includeAx: true,
    includeLogs: true,
  };
}

function browserHostDefaultCaptureMode(action: BrowserHostSessionAction): BrowserHostSessionCaptureMode {
  if (action === 'cursor') return 'none';
  if (action === 'native-os-ui-proof') return 'none';
  if (action === 'mouse-down' || action === 'mouse-move') return 'none';
  if (action === 'type' || action === 'press' || action === 'scroll') return 'none';
  if (action === 'click' || action === 'double-click' || action === 'mouse-up' || action === 'drag') return 'frame';
  return 'full';
}

function browserHostCaptureMode(value: unknown): BrowserHostSessionCaptureMode | undefined {
  return value === 'full' || value === 'frame' || value === 'none' ? value : undefined;
}

async function persistBrowserHostSession(session: ActiveBrowserHostSession): Promise<void> {
  const path = browserHostSessionManifestPath(session.workspacePath, session.id);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(publicBrowserHostSessionState(session), null, 2), 'utf8');
}

async function readStoredBrowserHostSession(workspacePath: string, sessionId: string): Promise<BrowserHostSessionState | undefined> {
  try {
    const parsed = JSON.parse(await readFile(browserHostSessionManifestPath(workspacePath, sessionId), 'utf8'));
    if (!parsed || typeof parsed !== 'object') return undefined;
    const record = parsed as Record<string, unknown>;
    return {
      schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
      id: safeSessionId(String(record.id ?? sessionId)) || sessionId,
      owner: 'host',
      providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
      status: browserHostStatus(record.status),
      workspacePath,
      requestedUrl: typeof record.requestedUrl === 'string' ? record.requestedUrl : 'about:blank',
      url: typeof record.url === 'string' ? record.url : 'about:blank',
      title: typeof record.title === 'string' ? record.title : undefined,
      startedAt: typeof record.startedAt === 'string' ? record.startedAt : new Date(0).toISOString(),
      updatedAt: typeof record.updatedAt === 'string' ? record.updatedAt : new Date(0).toISOString(),
      viewport: browserHostViewport(record.viewport && typeof record.viewport === 'object' ? Number((record.viewport as { width?: unknown }).width) : undefined, record.viewport && typeof record.viewport === 'object' ? Number((record.viewport as { height?: unknown }).height) : undefined),
      canGoBack: record.canGoBack === true,
      canGoForward: record.canGoForward === true,
      liveSurfaceRef: stringField(record.liveSurfaceRef),
      liveSurfaceTransport: record.liveSurfaceTransport === 'native-embedded' ? 'native-embedded' : undefined,
      nativeAdapterUrl: localHttpUrlField(record.nativeAdapterUrl),
      singleInteractiveTruth: record.singleInteractiveTruth === true ? true : undefined,
      frameStreamRef: stringField(record.frameStreamRef),
      frameRef: stringField(record.frameRef),
      screenshotRef: stringField(record.screenshotRef),
      domSnapshotRef: stringField(record.domSnapshotRef),
      axSnapshotRef: stringField(record.axSnapshotRef),
      consoleLogRef: stringField(record.consoleLogRef),
      networkLogRef: stringField(record.networkLogRef),
      searchResultRef: stringField(record.searchResultRef),
      cursor: normalizeBrowserHostCursor(record.cursor),
      loadingProgress: browserHostSessionLoadingProgress(record.loadingProgress),
      nativeOsUiProof: browserHostNativeOsUiProofFromUnknown(record.nativeOsUiProof),
      actorCursor: browserHostActorCursorFromUnknown(record.actorCursor),
      actorCursors: browserHostActorCursorsFromUnknown(record.actorCursors),
      visibleAction: browserHostVisibleActionFromUnknown(record.visibleAction),
      riskLedger: browserHostRiskLedgerFromUnknown(record.riskLedger),
      automationSummary: browserHostAutomationSummary(record.automationSummary),
      lastActionTiming: browserHostActionTiming(record.lastActionTiming),
      actionTimingSummary: browserHostActionTimingSummary(record.actionTimingSummary),
      diagnostics: Array.isArray(record.diagnostics) ? record.diagnostics.filter((item): item is string => typeof item === 'string') : [],
    };
  } catch {
    return undefined;
  }
}

async function persistBrowserHostSearchResults(
  session: Pick<ActiveBrowserHostSession, 'workspacePath' | 'id'>,
  output: Omit<BrowserHostSearchOutput, 'session' | 'searchResultRef' | 'screenshotRef' | 'domSnapshotRef' | 'axSnapshotRef' | 'consoleLogRef' | 'networkLogRef'>,
) {
  const fileName = `search-results-${Date.now()}-${sha1(output.query).slice(0, 8)}.json`;
  const path = join(browserHostSessionDir(session.workspacePath, session.id), fileName);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(output, null, 2), 'utf8');
  return browserHostRef(session.id, fileName);
}

async function captureBrowserHostScreenshot(session: ActiveBrowserHostSession, filePath: string): Promise<void> {
  if (!session.driver) return;
  try {
    await session.driver.screenshot(filePath);
  } catch (error) {
    session.diagnostics.push(`BrowserHostSession screenshot capture placeholder: ${browserHostErrorMessage(error)}`);
    await writeFile(filePath, BROWSER_HOST_CAPTURE_FALLBACK_PNG);
  }
}

async function browserHostCaptureValue<T>(
  session: ActiveBrowserHostSession,
  label: string,
  timeoutMs: number,
  producer: () => Promise<T>,
  fallback: () => T,
): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let didTimeout = false;
  try {
    return await Promise.race([
      producer().catch((error) => {
        session.diagnostics.push(`BrowserHostSession ${label} capture placeholder: ${browserHostErrorMessage(error)}`);
        return fallback();
      }),
      new Promise<T>((resolve) => {
        timeout = setTimeout(() => {
          didTimeout = true;
          resolve(fallback());
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
    if (didTimeout) session.diagnostics.push(`BrowserHostSession ${label} capture timed out after ${timeoutMs}ms; using timeout placeholder evidence ref.`);
  }
}

function publicBrowserHostSessionState(session: ActiveBrowserHostSession): BrowserHostSessionState {
  const liveSurfaceTransport = browserHostNativeLiveSurfaceTransport(session.driver?.liveSurfaceTransport ?? session.liveSurfaceTransport);
  const state: BrowserHostSessionState = {
    schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
    id: session.id,
    owner: 'host',
    providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
    status: session.status,
    workspacePath: session.workspacePath,
    requestedUrl: session.requestedUrl,
    url: session.url,
    title: session.title,
    startedAt: session.startedAt,
    updatedAt: session.updatedAt,
    viewport: session.viewport,
    canGoBack: session.canGoBack,
    canGoForward: session.canGoForward,
    liveSurfaceRef: browserHostLiveSurfaceRef(session.id),
    liveSurfaceTransport,
    nativeAdapterUrl: localHttpUrlField(session.driver?.nativeAdapterUrl ?? session.nativeAdapterUrl),
    singleInteractiveTruth: true,
    secondTruthSource: liveSurfaceTransport === 'native-embedded' ? false : undefined,
    frameStreamRef: undefined,
    frameRef: undefined,
    screenshotRef: session.screenshotRef,
    domSnapshotRef: session.domSnapshotRef,
    axSnapshotRef: session.axSnapshotRef,
    consoleLogRef: session.consoleLogRef,
    networkLogRef: session.networkLogRef,
    searchResultRef: session.searchResultRef,
    cursor: normalizeBrowserHostCursor(session.cursor),
    actorCursor: browserHostActorCursorFromUnknown(session.actorCursor),
    actorCursors: browserHostActorCursorsFromUnknown(session.actorCursors),
    visibleAction: browserHostVisibleActionFromUnknown(session.visibleAction),
    riskLedger: browserHostRiskLedgerFromUnknown(session.riskLedger),
    automationSummary: browserHostAutomationSummary(session.automationSummary),
    lastActionTiming: session.lastActionTiming,
    actionTimingSummary: session.actionTimingSummary ?? summarizeBrowserHostActionTimings(session.actionTimingSamples),
    diagnostics: session.diagnostics.slice(-20),
  };
  state.nativeOsUiProof = browserHostNativeOsUiProofFromUnknown(session.nativeOsUiProof);
  state.loadingProgress = publicBrowserHostSessionLoadingProgress(session, state);
  return state;
}

type BrowserHostSessionLoadingProgressInput = {
  state: BrowserHostSessionLoadingProgressState;
  reason: BrowserHostSessionLoadingProgressReason;
  source: BrowserHostSessionLoadingProgressSource;
  action?: BrowserHostSessionAction | 'open';
  canRetry?: boolean;
  blocked?: boolean;
  requiresHandoff?: boolean;
  urlHints?: BrowserHostSessionLoadingProgressUrlHints;
};

const BROWSER_HOST_LOADING_PROGRESS_STATES = new Set<BrowserHostSessionLoadingProgressState>([
  'navigation-start',
  'navigation-committed',
  'interactive',
  'load',
  'network-quiet',
  'stalled',
  'blocked',
  'retry',
  'handoff',
]);

const BROWSER_HOST_LOADING_PROGRESS_REASONS = new Set<BrowserHostSessionLoadingProgressReason>([
  'navigation-requested',
  'navigation-committed',
  'page-interactive',
  'page-load',
  'network-quiet',
  'navigation-stalled',
  'navigation-blocked',
  'navigation-retry',
  'user-handoff-required',
  'host-starting',
  'host-loading',
  'host-ready',
  'host-error',
  'host-diagnostic',
]);

const BROWSER_HOST_LOADING_PROGRESS_SOURCES = new Set<BrowserHostSessionLoadingProgressSource>([
  'host-lifecycle',
  'host-progress',
  'host-navigation',
  'host-action-timing',
  'host-state',
  'host-session',
  'host-error',
]);

function setBrowserHostSessionLoadingProgress(
  session: ActiveBrowserHostSession,
  input: BrowserHostSessionLoadingProgressInput,
): void {
  session.loadingProgress = buildBrowserHostSessionLoadingProgress(session, input);
}

function completeBrowserHostNavigationAction(session: ActiveBrowserHostSession, action: BrowserHostSessionAction | 'open'): void {
  const progress = browserHostSessionLoadingProgress(session.loadingProgress);
  const onlyInitialHostNavigation = progress?.state === 'navigation-start' && progress.source === 'host-navigation';
  if (progress?.state && progress.state !== 'network-quiet' && !onlyInitialHostNavigation) {
    const status = browserHostNavigationProgressHasCommittedSurface(session, progress)
      ? 'ready'
      : progress.state === 'blocked' || progress.state === 'handoff'
        ? 'failed'
        : 'loading';
    session.status = status;
    session.updatedAt = new Date().toISOString();
    setBrowserHostSessionLoadingProgress(session, {
      state: progress.state,
      reason: progress.reason,
      source: progress.source,
      action,
      canRetry: progress.canRetry,
      blocked: progress.blocked,
      requiresHandoff: progress.requiresHandoff,
      urlHints: browserHostNavigationControlUrlHints(session, action, status === 'ready'),
    });
    return;
  }
  session.status = 'ready';
  session.updatedAt = new Date().toISOString();
  setBrowserHostSessionLoadingProgress(session, {
    state: 'network-quiet',
    reason: progress?.reason === 'network-quiet' ? 'network-quiet' : 'host-ready',
    source: progress?.reason === 'network-quiet' ? progress.source : 'host-session',
    action,
    urlHints: browserHostNavigationControlUrlHints(session, action, true),
  });
}

function browserHostNavigationProgressHasCommittedSurface(
  session: Pick<ActiveBrowserHostSession, 'requestedUrl' | 'url'>,
  progress: Pick<BrowserHostSessionLoadingProgress, 'state' | 'blocked' | 'requiresHandoff'>,
): boolean {
  if (progress.blocked || progress.requiresHandoff) return false;
  if (progress.state === 'blocked' || progress.state === 'handoff' || progress.state === 'retry' || progress.state === 'navigation-start') return false;
  const currentUrl = browserHostUrlField(session.url);
  if (!currentUrl || currentUrl === 'about:blank') return false;
  return true;
}

function buildBrowserHostSessionLoadingProgress(
  session: Pick<ActiveBrowserHostSession, 'id' | 'status' | 'requestedUrl' | 'url' | 'updatedAt' | 'driver' | 'liveSurfaceTransport' | 'frameRef' | 'screenshotRef' | 'domSnapshotRef' | 'axSnapshotRef' | 'consoleLogRef' | 'networkLogRef' | 'searchResultRef'>,
  input: BrowserHostSessionLoadingProgressInput,
): BrowserHostSessionLoadingProgress {
  return {
    schemaVersion: BROWSER_HOST_LOADING_PROGRESS_SCHEMA,
    state: input.state,
    reason: input.reason,
    source: input.source,
    status: session.status,
    action: input.action,
    updatedAt: session.updatedAt,
    refs: browserHostLoadingProgressRefs(session),
    urls: browserHostLoadingProgressUrls(session, input),
    canRetry: input.canRetry || input.state === 'retry' ? true : undefined,
    blocked: input.blocked || input.state === 'blocked' ? true : undefined,
    requiresHandoff: input.requiresHandoff || input.state === 'handoff' ? true : undefined,
  };
}

function browserHostNavigationControlUrlHints(
  session: Pick<ActiveBrowserHostSession, 'requestedUrl' | 'url'>,
  action: BrowserHostSessionAction | 'open' | undefined,
  final = false,
): BrowserHostSessionLoadingProgressUrlHints {
  const currentUrl = browserHostUrlField(session.url) ?? browserHostUrlField(session.requestedUrl);
  const requestedUrl = action === 'reload' || action === 'stop' || action === 'back' || action === 'forward'
    ? currentUrl
    : browserHostUrlField(session.requestedUrl) ?? currentUrl;
  return {
    requestedUrl,
    currentUrl,
    finalUrl: final ? currentUrl : undefined,
  };
}

function publicBrowserHostSessionLoadingProgress(
  session: ActiveBrowserHostSession,
  state: BrowserHostSessionState,
): BrowserHostSessionLoadingProgress | undefined {
  if (state.status === 'closed') return undefined;
  const existing = browserHostSessionLoadingProgress(session.loadingProgress);
  const existingAction = existing?.action ?? browserHostLoadingProgressActionFromTiming(state.lastActionTiming);
  const input = browserHostLoadingProgressInputForPublicState(state, existing, existingAction);
  return input ? buildBrowserHostSessionLoadingProgress({ ...session, ...state }, input) : undefined;
}

function browserHostLoadingProgressInputForPublicState(
  state: BrowserHostSessionState,
  existing: BrowserHostSessionLoadingProgress | undefined,
  action: BrowserHostSessionAction | 'open' | undefined,
): BrowserHostSessionLoadingProgressInput | undefined {
  if (state.status === 'failed') {
    const requiresHandoff = existing?.requiresHandoff === true || existing?.state === 'handoff';
    if (existing?.state === 'blocked' || existing?.state === 'handoff' || existing?.state === 'retry') {
      return {
        state: existing.state,
        reason: existing.reason,
        source: existing.source,
        action: existing.action ?? action,
        canRetry: existing.canRetry === true || browserHostLoadingProgressActionCanRetry(action),
        blocked: existing.blocked ?? (existing.state === 'blocked' ? true : undefined),
        requiresHandoff,
      };
    }
    return {
      state: requiresHandoff ? 'handoff' : 'blocked',
      reason: 'host-error',
      source: 'host-error',
      action,
      canRetry: existing?.canRetry === true || browserHostLoadingProgressActionCanRetry(action),
      blocked: true,
      requiresHandoff,
    };
  }
  if (state.status === 'ready') {
    if (existing && browserHostReadyStateKeepsExistingProgress(existing)) {
      return {
        state: existing.state,
        reason: existing.reason,
        source: existing.source,
        action: existing.action ?? action,
        canRetry: existing.canRetry,
        blocked: existing.blocked,
        requiresHandoff: existing.requiresHandoff,
        urlHints: browserHostNavigationControlUrlHints(state, existing.action ?? action, true),
      };
    }
    return {
      state: 'network-quiet',
      reason: existing?.state === 'network-quiet' ? existing.reason : 'host-ready',
      source: existing?.state === 'network-quiet' ? existing.source : 'host-session',
      action: existing?.action ?? action,
      urlHints: browserHostNavigationControlUrlHints(state, action, true),
    };
  }
  if (existing) {
    return {
      state: existing.state,
      reason: existing.reason,
      source: existing.source,
      action: existing.action,
      canRetry: existing.canRetry,
      blocked: existing.blocked,
      requiresHandoff: existing.requiresHandoff,
    };
  }
  if (state.status === 'starting') {
    return {
      state: 'navigation-start',
      reason: 'host-starting',
      source: 'host-session',
      action: 'open',
      urlHints: browserHostNavigationControlUrlHints(state, 'open'),
    };
  }
  if (state.status === 'loading') {
    return {
      state: 'navigation-start',
      reason: 'host-loading',
      source: 'host-session',
      action,
      urlHints: browserHostNavigationControlUrlHints(state, action),
    };
  }
  return undefined;
}

function browserHostReadyStateKeepsExistingProgress(existing: BrowserHostSessionLoadingProgress): boolean {
  return existing.state === 'stalled';
}

function browserHostSessionLoadingProgress(value: unknown): BrowserHostSessionLoadingProgress | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const state = browserHostLoadingProgressState(record.state);
  const reason = browserHostLoadingProgressReason(record.reason);
  const source = browserHostLoadingProgressSource(record.source);
  const status = browserHostLoadingProgressStatus(record.status);
  const updatedAt = safeIsoTimestampField(record.updatedAt);
  if (!state || !reason || !source || !status || !updatedAt) return undefined;
  return {
    schemaVersion: BROWSER_HOST_LOADING_PROGRESS_SCHEMA,
    state,
    reason,
    source,
    status,
    action: browserHostLoadingProgressAction(record.action),
    updatedAt,
    refs: browserHostLoadingProgressRefsFromUnknown(record.refs),
    urls: browserHostLoadingProgressUrlsFromUnknown(record.urls),
    canRetry: record.canRetry === true ? true : undefined,
    blocked: record.blocked === true ? true : undefined,
    requiresHandoff: record.requiresHandoff === true ? true : undefined,
  };
}

function browserHostNativeOsUiProofFromNativeState(state: unknown): BrowserHostSessionNativeOsUiProof | undefined {
  const record = objectRecord(state);
  return browserHostNativeOsUiProofFromUnknown(record.nativeOsUiProof)
    ?? browserHostNativeOsUiProofFromUnknown(objectRecord(record.session).nativeOsUiProof);
}

function browserHostNativeOsUiProofFromUnknown(value: unknown): BrowserHostSessionNativeOsUiProof | undefined {
  const record = objectRecord(value);
  if (record.schemaVersion !== BROWSER_HOST_NATIVE_OS_UI_PROOF_SCHEMA) return undefined;
  if (record.boundedEvidenceOnly !== true) return undefined;
  if (
    record.rawDomRecorded !== false ||
    record.rawTextRecorded !== false ||
    record.rawUrlRecorded !== false ||
    record.rawTitleRecorded !== false ||
    record.rawSelectorRecorded !== false ||
    record.rawCoordsRecorded !== false ||
    record.rawPayloadRecorded !== false
  ) {
    return undefined;
  }
  if (record.source !== 'native-embedded-action-state') return undefined;
  const proofGroup = browserHostNativeOsUiProofGroup(record.proofGroup);
  const actionId = browserHostNativeOsUiToken(record.actionId);
  if (!proofGroup || !actionId) return undefined;
  return {
    schemaVersion: BROWSER_HOST_NATIVE_OS_UI_PROOF_SCHEMA,
    boundedEvidenceOnly: true,
    rawDomRecorded: false,
    rawTextRecorded: false,
    rawUrlRecorded: false,
    rawTitleRecorded: false,
    rawSelectorRecorded: false,
    rawCoordsRecorded: false,
    rawPayloadRecorded: false,
    source: 'native-embedded-action-state',
    proofGroup,
    actionId,
    observedProofNames: browserHostNativeOsUiExpectedProofNames(record.observedProofNames, proofGroup),
    evidenceTokens: uniqueBoundedNativeOsUiTokens(record.evidenceTokens),
    diagnostics: uniqueBoundedNativeOsUiTokens(record.diagnostics),
  };
}

function browserHostNativeOsUiProofGroup(value: unknown): BrowserHostSessionNativeOsUiProof['proofGroup'] | undefined {
  return value === 'cursorCaret' ||
    value === 'mouseContextMenu' ||
    value === 'keyboardImeClipboardSelection' ||
    value === 'rerenderFocus'
    ? value
    : undefined;
}

function browserHostNativeOsUiExpectedProofNames(
  value: unknown,
  proofGroup?: BrowserHostSessionNativeOsUiProof['proofGroup'],
): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map((entry) => browserHostNativeOsUiProofName(entry, proofGroup)).filter((entry): entry is string => Boolean(entry)))]
    : [];
}

function browserHostNativeOsUiProofName(
  value: unknown,
  proofGroup?: BrowserHostSessionNativeOsUiProof['proofGroup'],
): string | undefined {
  if (typeof value !== 'string') return undefined;
  const proofName = value.trim();
  const allowed = proofGroup
    ? new Set<string>(BROWSER_HOST_NATIVE_OS_UI_PROOF_NAMES_BY_GROUP[proofGroup])
    : BROWSER_HOST_NATIVE_OS_UI_PROOF_NAMES;
  return allowed.has(proofName) ? proofName : undefined;
}

function uniqueBoundedNativeOsUiTokens(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(browserHostNativeOsUiToken).filter((entry): entry is string => Boolean(entry)))]
    : [];
}

function browserHostNativeOsUiToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const token = value.trim();
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._:/-]{0,127}$/.test(token)) return undefined;
  if (browserHostNativeOsUiRawTextForbidden(token)) return undefined;
  return token;
}

function browserHostNativeOsUiRawTextForbidden(value: string): boolean {
  return /https?:|file:|data:|blob:|javascript:|<html|<input|endpoint|url:|title:|selector|coords?|payload|provider|secret|api[-_]?key|raw-leak/i.test(value)
    || /"x"\s*:|"y"\s*:/.test(value);
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function browserHostAutomationSummary(value: unknown): BrowserRuntimeAutomationSummary | undefined {
  const record = objectRecord(value);
  return browserRuntimeAutomationSummary({
    kind: stringField(record.kind),
    status: stringField(record.status),
    title: stringField(record.title),
    summary: stringField(record.summary),
    itemCount: Number(record.itemCount),
    refs: Array.isArray(record.refs) ? record.refs as BrowserRuntimeAutomationSummary['refs'] : [],
    diagnostics: Array.isArray(record.diagnostics) ? record.diagnostics.filter((item): item is string => typeof item === 'string') : [],
  });
}

function browserHostAutomationRefs(input: {
  searchResultRef?: string;
  frameRef?: string;
  screenshotRef?: string;
  domSnapshotRef?: string;
  axSnapshotRef?: string;
  consoleLogRef?: string;
  networkLogRef?: string;
}): BrowserRuntimeAutomationSummary['refs'] {
  const refs: BrowserRuntimeAutomationSummary['refs'] = [];
  pushBrowserHostAutomationRef(refs, 'search-result', input.searchResultRef);
  pushBrowserHostAutomationRef(refs, 'browser-frame', input.frameRef);
  pushBrowserHostAutomationRef(refs, 'screenshot', input.screenshotRef);
  pushBrowserHostAutomationRef(refs, 'dom-snapshot', input.domSnapshotRef);
  pushBrowserHostAutomationRef(refs, 'ax-snapshot', input.axSnapshotRef);
  pushBrowserHostAutomationRef(refs, 'console-log', input.consoleLogRef);
  pushBrowserHostAutomationRef(refs, 'network-log', input.networkLogRef);
  return refs;
}

function pushBrowserHostAutomationRef(
  refs: BrowserRuntimeAutomationSummary['refs'],
  kind: BrowserRuntimeAutomationSummary['refs'][number]['kind'],
  ref: string | undefined,
): void {
  if (ref) refs.push({ kind, ref });
}

async function publishBrowserHostVisibleAction(
  session: ActiveBrowserHostSession,
  action: BrowserHostSessionAction | 'open',
  requestedActionId: string | undefined,
  actorCursorInput?: BrowserHostSessionActorCursorInput,
  riskInput?: {
    riskType?: BrowserHostSessionActionRiskType;
    url?: string;
    text?: string;
    key?: string;
    actionId?: string;
  },
): Promise<void> {
  const actionId = browserHostActionId(requestedActionId, action);
  const riskType = browserHostActionRiskType(action, { ...riskInput, actionId });
  const visibleAction: BrowserHostSessionVisibleAction = {
    actionId,
    action,
    riskType,
    ...(action === 'cursor'
      ? { actorCursorRef: browserHostRef(session.id, `actor-cursors/${actionId}.json`) }
      : { visibleActionRef: browserHostRef(session.id, `visible-actions/${actionId}.json`) }),
  };
  session.visibleAction = visibleAction;
  session.riskLedger = [
    ...(session.riskLedger ?? []),
    {
      ...visibleAction,
      recordedAt: new Date().toISOString(),
    },
  ].slice(-50);
  await persistBrowserHostVisibleActionRef(session, visibleAction);
  await publishBrowserHostActorCursor(session, action, visibleAction, actorCursorInput);
}

async function persistBrowserHostVisibleActionRef(
  session: Pick<ActiveBrowserHostSession, 'workspacePath' | 'id'>,
  visibleAction: BrowserHostSessionVisibleAction,
): Promise<void> {
  const ref = visibleAction.actorCursorRef ?? visibleAction.visibleActionRef;
  if (!ref) return;
  const file = browserHostFileForRef(session.workspacePath, session.id, ref);
  if (!file) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(visibleAction, null, 2), 'utf8');
}

function browserHostActionId(value: string | undefined, action: BrowserHostSessionAction | 'open'): string {
  const safe = safeSessionId(value);
  return safe || `${action}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

async function publishBrowserHostActorCursor(
  session: ActiveBrowserHostSession,
  action: BrowserHostSessionAction | 'open',
  visibleAction: BrowserHostSessionVisibleAction,
  input?: BrowserHostSessionActorCursorInput,
): Promise<void> {
  const agentId = safeActorCursorId(input?.agentId);
  const cursorId = safeActorCursorId(input?.cursorId);
  if (!agentId || !cursorId) return;
  const actorCursorRef = browserHostRef(session.id, `actor-cursors/${cursorId}.json`);
  const actionEvidenceRef = visibleAction.visibleActionRef ?? visibleAction.actorCursorRef;
  const publicCursor: BrowserHostSessionActorCursor = {
    agentId,
    cursorId,
    color: safeActorCursorColor(input?.color),
    label: safeActorCursorLabel(input?.label) || agentId,
    status: 'acting',
    target: {
      type: 'browser-pane',
      sessionId: session.id,
      windowRef: `browser-host-session:${session.id}`,
    },
    lastAction: {
      action: browserHostWindowActionKind(action),
      status: 'completed',
      evidenceRefs: actionEvidenceRef ? [actionEvidenceRef] : [],
    },
    evidenceRefs: [actorCursorRef],
  };
  session.actorCursor = publicCursor;
  session.actorCursors = [publicCursor];
  const file = browserHostFileForRef(session.workspacePath, session.id, actorCursorRef);
  if (!file) return;
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(publicCursor, null, 2), 'utf8');
}

function safeActorCursorId(value: string | undefined) {
  if (typeof value !== 'string') return undefined;
  const safe = value.trim().replace(/[^a-z0-9._:-]+/gi, '-').replace(/^-+|-+$/g, '').slice(0, 96);
  return safe || undefined;
}

function safeActorCursorColor(value: string | undefined) {
  return typeof value === 'string' && /^#[a-f0-9]{6}$/i.test(value.trim()) ? value.trim().toLowerCase() : '#00d5ff';
}

function safeActorCursorLabel(value: string | undefined) {
  if (typeof value !== 'string') return undefined;
  const label = value.trim().replace(/\s+/g, ' ').slice(0, 80);
  return browserHostNativeOsUiRawTextForbidden(label) ? undefined : label;
}

function browserHostActorCursorFromUnknown(value: unknown): BrowserHostSessionActorCursor | undefined {
  const record = objectRecord(value);
  const agentId = safeActorCursorId(stringField(record.agentId));
  const cursorId = safeActorCursorId(stringField(record.cursorId));
  if (!agentId || !cursorId || record.status !== 'acting') return undefined;
  const target = objectRecord(record.target);
  const lastAction = objectRecord(record.lastAction);
  const action = browserHostWindowActorAction(lastAction.action);
  const evidenceRefs = browserHostActionEvidenceRefs(lastAction.evidenceRefs);
  const cursorRefs = browserHostActionEvidenceRefs(record.evidenceRefs);
  if (
    target.type !== 'browser-pane' ||
    target.sessionId !== stringField(target.sessionId) ||
    target.windowRef !== `browser-host-session:${target.sessionId}` ||
    !action ||
    lastAction.status !== 'completed' ||
    cursorRefs.length === 0
  ) {
    return undefined;
  }
  return {
    agentId,
    cursorId,
    color: safeActorCursorColor(stringField(record.color)),
    label: safeActorCursorLabel(stringField(record.label)) || agentId,
    status: 'acting',
    target: {
      type: 'browser-pane',
      sessionId: String(target.sessionId),
      windowRef: String(target.windowRef),
    },
    lastAction: {
      action,
      status: 'completed',
      evidenceRefs,
    },
    evidenceRefs: cursorRefs,
  };
}

function browserHostActorCursorsFromUnknown(value: unknown): BrowserHostSessionActorCursor[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const cursors = value.map(browserHostActorCursorFromUnknown).filter((cursor): cursor is BrowserHostSessionActorCursor => Boolean(cursor));
  return cursors.length ? cursors.slice(-8) : undefined;
}

function browserHostActionEvidenceRefs(value: unknown): string[] {
  return Array.isArray(value)
    ? [...new Set(value.map(browserHostRefField).filter((ref): ref is string => Boolean(ref)))]
    : [];
}

function browserHostWindowActorAction(value: unknown): BrowserHostSessionActorCursor['lastAction']['action'] | undefined {
  return value === 'observe' || value === 'click' || value === 'type' || value === 'scroll' || value === 'wait'
    ? value
    : undefined;
}

function browserHostWindowActionKind(action: BrowserHostSessionAction | 'open'): BrowserHostSessionActorCursor['lastAction']['action'] {
  if (action === 'click' || action === 'double-click' || action === 'mouse-down' || action === 'mouse-move' || action === 'mouse-up' || action === 'drag' || action === 'cursor') return 'click';
  if (action === 'type' || action === 'press') return 'type';
  if (action === 'scroll') return 'scroll';
  if (
    action === 'open' ||
    action === 'navigate' ||
    action === 'back' ||
    action === 'forward' ||
    action === 'reload' ||
    action === 'stop' ||
    action === 'state' ||
    action === 'snapshot' ||
    action === 'native-os-ui-proof'
  ) {
    return 'observe';
  }
  return 'wait';
}

function browserHostActionRiskType(
  action: BrowserHostSessionAction | 'open',
  input: {
    riskType?: BrowserHostSessionActionRiskType;
    url?: string;
    text?: string;
    key?: string;
    actionId?: string;
  } = {},
): BrowserHostSessionActionRiskType {
  const explicit = browserHostRiskType(input.riskType);
  if (explicit) return explicit;
  const signal = [input.url, input.text, input.key, input.actionId].filter(Boolean).join(' ');
  if (/\b(?:delete|remove|destroy|drop|revoke|wipe|erase|cancel\s+account|删除|移除|销毁|撤销)\b/i.test(signal)) return 'destructive';
  if (/\b(?:pay|payment|purchase|checkout|card|billing|invoice|order|subscribe|支付|付款|购买|下单|银行卡)\b/i.test(signal)) return 'payment';
  if (/\b(?:password|passwd|passcode|token|api[_-]?key|secret|credential|login|sign\s*in|oauth|authorize|2fa|otp|captcha|验证码|密码|密钥|登录|授权)\b/i.test(signal)) return 'credential';
  if (/\b(?:submit|send|post|publish|form|保存|提交|发送|发布)\b/i.test(signal)) return 'form-submit';
  if (action === 'open' || action === 'navigate' || action === 'back' || action === 'forward' || action === 'reload') return 'navigation-external';
  if (action === 'type' || action === 'press') return 'low-risk-input';
  if (action === 'scroll') return 'scroll';
  if (
    action === 'click' ||
    action === 'double-click' ||
    action === 'mouse-down' ||
    action === 'mouse-move' ||
    action === 'mouse-up' ||
    action === 'drag' ||
    action === 'cursor'
  ) {
    return 'click';
  }
  return 'low-risk-input';
}

function browserHostVisibleActionFromUnknown(value: unknown): BrowserHostSessionVisibleAction | undefined {
  const record = objectRecord(value);
  const actionId = browserHostNativeOsUiToken(record.actionId);
  const action = browserHostLoadingProgressAction(record.action);
  const riskType = browserHostRiskType(record.riskType);
  if (!actionId || !action || !riskType) return undefined;
  const actorCursorRef = browserHostBoundedActionRef(record.actorCursorRef, 'actor-cursors');
  const visibleActionRef = browserHostBoundedActionRef(record.visibleActionRef, 'visible-actions');
  if (!actorCursorRef && !visibleActionRef) return undefined;
  return {
    actionId,
    action,
    riskType,
    ...(actorCursorRef ? { actorCursorRef } : {}),
    ...(visibleActionRef ? { visibleActionRef } : {}),
  };
}

function browserHostRiskLedgerFromUnknown(value: unknown): BrowserHostSessionState['riskLedger'] {
  if (!Array.isArray(value)) return undefined;
  const entries = value.map((entry) => {
    const visibleAction = browserHostVisibleActionFromUnknown(entry);
    const recordedAt = safeIsoTimestampField(objectRecord(entry).recordedAt);
    return visibleAction && recordedAt ? { ...visibleAction, recordedAt } : undefined;
  }).filter((entry): entry is NonNullable<BrowserHostSessionState['riskLedger']>[number] => Boolean(entry));
  return entries.length ? entries.slice(-50) : undefined;
}

function browserHostRiskType(value: unknown): BrowserHostSessionActionRiskType | undefined {
  return value === 'navigation-external' ||
    value === 'form-submit' ||
    value === 'credential' ||
    value === 'payment' ||
    value === 'destructive' ||
    value === 'low-risk-input' ||
    value === 'scroll' ||
    value === 'click'
    ? value
    : undefined;
}

function browserHostBoundedActionRef(value: unknown, directory: 'actor-cursors' | 'visible-actions'): string | undefined {
  const ref = browserHostRefField(value);
  return ref && new RegExp(`/${directory}/[a-z0-9._:-]+\\.json$`, 'i').test(ref) ? ref : undefined;
}

function browserHostLoadingProgressRefs(
  session: Pick<ActiveBrowserHostSession, 'id' | 'driver' | 'liveSurfaceTransport' | 'frameRef' | 'screenshotRef' | 'domSnapshotRef' | 'axSnapshotRef' | 'consoleLogRef' | 'networkLogRef' | 'searchResultRef'>,
): BrowserHostSessionLoadingProgress['refs'] {
  const liveSurfaceTransport = browserHostNativeLiveSurfaceTransport(session.driver?.liveSurfaceTransport ?? session.liveSurfaceTransport);
  return {
    session: browserHostRef(session.id, 'session.json'),
    liveSurface: browserHostLiveSurfaceRef(session.id),
    frameStream: undefined,
    frame: undefined,
    screenshot: session.screenshotRef,
    domSnapshot: session.domSnapshotRef,
    axSnapshot: session.axSnapshotRef,
    consoleLog: session.consoleLogRef,
    networkLog: session.networkLogRef,
    searchResult: session.searchResultRef,
  };
}

function browserHostLoadingProgressRefsFromUnknown(value: unknown): BrowserHostSessionLoadingProgress['refs'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const record = value as Record<string, unknown>;
  return {
    session: browserHostRefField(record.session),
    liveSurface: browserHostRefField(record.liveSurface),
    frameStream: browserHostRefField(record.frameStream),
    frame: browserHostRefField(record.frame),
    screenshot: browserHostRefField(record.screenshot),
    domSnapshot: browserHostRefField(record.domSnapshot),
    axSnapshot: browserHostRefField(record.axSnapshot),
    consoleLog: browserHostRefField(record.consoleLog),
    networkLog: browserHostRefField(record.networkLog),
    searchResult: browserHostRefField(record.searchResult),
  };
}

function browserHostLoadingProgressUrls(
  session: Pick<ActiveBrowserHostSession, 'requestedUrl' | 'url' | 'status'>,
  input: Pick<BrowserHostSessionLoadingProgressInput, 'state' | 'urlHints'>,
): BrowserHostSessionLoadingProgressUrls | undefined {
  const requested = browserHostUrlDigest(input.urlHints?.requestedUrl ?? session.requestedUrl);
  const current = browserHostUrlDigest(input.urlHints?.currentUrl ?? session.url);
  const final = browserHostUrlDigest(input.urlHints?.finalUrl)
    ?? (input.state === 'network-quiet' && session.status === 'ready' ? current : undefined);
  if (!requested && !current && !final) return undefined;
  return { requested, current, final };
}

function browserHostLoadingProgressUrlsFromUnknown(value: unknown): BrowserHostSessionLoadingProgressUrls | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const urls = {
    requested: browserHostUrlDigestFromUnknown(record.requested),
    current: browserHostUrlDigestFromUnknown(record.current),
    final: browserHostUrlDigestFromUnknown(record.final),
  };
  return urls.requested || urls.current || urls.final ? urls : undefined;
}

function browserHostUrlDigest(value: unknown): BrowserHostSessionLoadingProgressUrls['requested'] {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  const normalized = normalizeBrowserHostUrl(value);
  return {
    length: normalized.length,
    sha1: sha1(normalized),
  };
}

function browserHostUrlDigestFromUnknown(value: unknown): BrowserHostSessionLoadingProgressUrls['requested'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const length = typeof record.length === 'number' && Number.isFinite(record.length) ? Math.max(0, Math.round(record.length)) : undefined;
  const hash = typeof record.sha1 === 'string' && /^[a-f0-9]{40}$/i.test(record.sha1.trim()) ? record.sha1.trim().toLowerCase() : undefined;
  return length !== undefined && hash ? { length, sha1: hash } : undefined;
}

function browserHostLoadingProgressState(value: unknown): BrowserHostSessionLoadingProgressState | undefined {
  return typeof value === 'string' && BROWSER_HOST_LOADING_PROGRESS_STATES.has(value as BrowserHostSessionLoadingProgressState)
    ? value as BrowserHostSessionLoadingProgressState
    : undefined;
}

function browserHostLoadingProgressReason(value: unknown): BrowserHostSessionLoadingProgressReason | undefined {
  return typeof value === 'string' && BROWSER_HOST_LOADING_PROGRESS_REASONS.has(value as BrowserHostSessionLoadingProgressReason)
    ? value as BrowserHostSessionLoadingProgressReason
    : undefined;
}

function browserHostLoadingProgressSource(value: unknown): BrowserHostSessionLoadingProgressSource | undefined {
  return typeof value === 'string' && BROWSER_HOST_LOADING_PROGRESS_SOURCES.has(value as BrowserHostSessionLoadingProgressSource)
    ? value as BrowserHostSessionLoadingProgressSource
    : undefined;
}

function browserHostLoadingProgressStatus(value: unknown): BrowserHostSessionStatus | undefined {
  return value === 'starting' || value === 'loading' || value === 'ready' || value === 'failed' || value === 'closed'
    ? value
    : undefined;
}

function browserHostLoadingProgressAction(value: unknown): BrowserHostSessionAction | 'open' | undefined {
  return value === 'open' || value === 'navigate' || value === 'back' || value === 'forward' || value === 'reload' || value === 'stop'
    || value === 'click' || value === 'double-click' || value === 'mouse-down' || value === 'mouse-move' || value === 'mouse-up'
    || value === 'drag' || value === 'type' || value === 'press' || value === 'scroll' || value === 'cursor'
    || value === 'native-os-ui-proof'
    || value === 'snapshot' || value === 'state' || value === 'close'
    ? value
    : undefined;
}

function browserHostLoadingProgressActionFromTiming(timing: BrowserHostSessionState['lastActionTiming']): BrowserHostSessionAction | 'open' | undefined {
  return browserHostLoadingProgressAction(timing?.action);
}

function browserHostLoadingProgressActionCanRetry(action: BrowserHostSessionAction | 'open' | undefined): boolean {
  return action === 'open' || action === 'navigate' || action === 'back' || action === 'forward' || action === 'reload';
}

function browserHostRefField(value: unknown): string | undefined {
  const ref = stringField(value);
  return ref?.startsWith('browser-host-session:') ? ref : undefined;
}

function safeIsoTimestampField(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : undefined;
}

function normalizeBrowserHostCursor(value: unknown): string {
  const cursor = typeof value === 'string' ? value.trim() : '';
  const allowed = new Set([
    'default',
    'auto',
    'pointer',
    'text',
    'vertical-text',
    'crosshair',
    'move',
    'grab',
    'grabbing',
    'help',
    'wait',
    'progress',
    'not-allowed',
    'copy',
    'alias',
    'zoom-in',
    'zoom-out',
    'cell',
    'context-menu',
    'col-resize',
    'row-resize',
    'ew-resize',
    'ns-resize',
    'nesw-resize',
    'nwse-resize',
    'all-scroll',
  ]);
  return allowed.has(cursor) ? cursor : 'default';
}

function localHttpUrlField(value: unknown): string | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== 'http:' || !/^(?:127\.0\.0\.1|localhost|::1)$/i.test(url.hostname)) return undefined;
    return url.toString().replace(/\/+$/, '');
  } catch {
    return undefined;
  }
}

function browserHostLiveSurfaceRef(sessionId: string) {
  return `browser-host-session:${sessionId}/live-surface`;
}

function browserHostFrameStreamRef(sessionId: string) {
  return `browser-host-session:${sessionId}/frame-stream`;
}

export function browserHostSessionDir(workspacePath: string, sessionId: string) {
  return join(workspacePath, '.sciforge', 'browser-host', 'sessions', safeSessionId(sessionId) || 'invalid-session');
}

function browserHostSessionManifestPath(workspacePath: string, sessionId: string) {
  return join(browserHostSessionDir(workspacePath, sessionId), 'session.json');
}

function browserHostRef(sessionId: string, fileName: string) {
  return `browser-host-session:${safeSessionId(sessionId)}/${fileName}`;
}

function browserHostFileForRef(workspacePath: string, sessionId: string, ref: string) {
  const match = /^browser-host-session:([^/]+)\/(.+)$/.exec(ref);
  if (!match || match[1] !== (safeSessionId(sessionId) || sessionId)) return undefined;
  if (!/^[a-zA-Z0-9._:-]+(?:\/[a-zA-Z0-9._:-]+)*$/.test(match[2])) return undefined;
  return join(browserHostSessionDir(workspacePath, sessionId), match[2]);
}

function browserHostExecutablePath(): string | undefined {
  const candidates = [
    process.env.SCIFORGE_BROWSER_HOST_EXECUTABLE_PATH,
    process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH,
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/microsoft-edge',
  ].filter((value): value is string => Boolean(value?.trim()));
  return candidates.find((candidate) => existsSync(candidate));
}

function browserHostViewport(width: unknown, height: unknown): BrowserHostSessionViewport {
  return {
    width: clamp(typeof width === 'number' ? width : undefined, 1365, 640, 2400),
    height: clamp(typeof height === 'number' ? height : undefined, 900, 480, 1800),
  };
}

function timeoutMs(value: unknown) {
  return clamp(typeof value === 'number' ? value : undefined, 25_000, 2_000, 120_000);
}

function browserHostNavigationSettleMs(timeoutMs: number) {
  return Math.min(timeoutMs, browserHostEnvNumber('SCIFORGE_BROWSER_HOST_NAVIGATION_SETTLE_MS', 1200, 0, 5000));
}

function browserHostDomContentLoadedSettleMs() {
  return browserHostEnvNumber('SCIFORGE_BROWSER_HOST_DOMCONTENTLOADED_SETTLE_MS', 1500, 0, 10_000);
}

function browserHostLoadSettleMs() {
  return browserHostEnvNumber('SCIFORGE_BROWSER_HOST_LOAD_SETTLE_MS', 1500, 0, 10_000);
}

function browserHostInteractiveSettleMs() {
  return browserHostEnvNumber('SCIFORGE_BROWSER_HOST_INTERACTIVE_SETTLE_MS', 160, 0, 2000);
}

function browserHostInteractiveNavigationGraceMs() {
  return browserHostEnvNumber('SCIFORGE_BROWSER_HOST_INTERACTIVE_NAVIGATION_GRACE_MS', 80, 0, 500);
}

function browserHostInteractiveDomContentLoadedSettleMs() {
  return browserHostEnvNumber('SCIFORGE_BROWSER_HOST_INTERACTIVE_DOMCONTENTLOADED_SETTLE_MS', 2500, 0, 10_000);
}

function browserHostInteractiveNavigationSettleMs() {
  return browserHostEnvNumber('SCIFORGE_BROWSER_HOST_INTERACTIVE_NAVIGATION_SETTLE_MS', 1200, 0, 5000);
}

function browserHostScreenshotTimeoutMs() {
  return browserHostEnvNumber('SCIFORGE_BROWSER_HOST_SCREENSHOT_TIMEOUT_MS', 5000, 500, 30_000);
}

function browserHostDomSnapshotTimeoutMs() {
  return browserHostEnvNumber('SCIFORGE_BROWSER_HOST_DOM_SNAPSHOT_TIMEOUT_MS', 3000, 500, 30_000);
}

function browserHostAxSnapshotTimeoutMs() {
  return browserHostEnvNumber('SCIFORGE_BROWSER_HOST_AX_SNAPSHOT_TIMEOUT_MS', 3000, 500, 30_000);
}

function browserHostDeferredEvidenceCaptureDelayMs() {
  return browserHostEnvNumber('SCIFORGE_BROWSER_HOST_DEFERRED_EVIDENCE_CAPTURE_DELAY_MS', 16, 0, 500);
}

function browserHostDeferredEvidenceCaptureQuietWindowMs() {
  return browserHostEnvNumber('SCIFORGE_BROWSER_HOST_DEFERRED_EVIDENCE_CAPTURE_QUIET_WINDOW_MS', 48, 0, 1000);
}

function browserHostEnvNumber(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name];
  const parsed = raw === undefined || raw.trim() === '' ? undefined : Number(raw);
  return clamp(Number.isFinite(parsed) ? parsed : undefined, fallback, min, max);
}

function clamp(value: number | undefined, fallback: number, min: number, max: number) {
  return Math.max(min, Math.min(max, Number.isFinite(value) ? Number(value) : fallback));
}

function safeSessionId(value: string | undefined) {
  return value?.trim().toLowerCase().replace(/[^a-z0-9._:-]+/g, '-').replace(/^-+|-+$/g, '') || '';
}

function sha1(value: string) {
  return createHash('sha1').update(value).digest('hex');
}

function requiredString(value: unknown, field: string) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`BrowserHostSession requires ${field}`);
  return value.trim();
}

function requiredText(value: unknown, field: string) {
  if (typeof value !== 'string' || value.length === 0) throw new Error(`BrowserHostSession requires ${field}`);
  return value;
}

function requiredNumber(value: unknown, field: string) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`BrowserHostSession requires numeric ${field}`);
  return value;
}

function requiredMousePath(value: unknown): BrowserHostMousePoint[] {
  if (!Array.isArray(value) || value.length < 2) throw new Error('BrowserHostSession requires a mouse path with at least two points.');
  return value.map((point, index) => {
    if (!point || typeof point !== 'object') throw new Error(`BrowserHostSession requires numeric mouse path point ${index}.`);
    const record = point as Record<string, unknown>;
    return {
      x: requiredNumber(record.x, `path[${index}].x`),
      y: requiredNumber(record.y, `path[${index}].y`),
    };
  });
}

function numberOr(value: unknown, fallback: number) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function optionalFiniteNumber(value: unknown) {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function browserHostMouseButton(value: unknown): BrowserHostMouseButton {
  return value === 'right' || value === 'middle' ? value : 'left';
}

function browserHostStatus(value: unknown): BrowserHostSessionStatus {
  return value === 'starting' || value === 'loading' || value === 'ready' || value === 'failed' || value === 'closed' ? value : 'failed';
}

function stringField(value: unknown) {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function booleanField(value: unknown): boolean | undefined {
  return value === true ? true : value === false ? false : undefined;
}

function browserHostUrlField(value: unknown): string | undefined {
  const field = stringField(value);
  return field ? normalizeBrowserHostUrl(field) : undefined;
}

function browserHostUrlKey(value: unknown): string {
  const url = browserHostUrlField(value);
  return url ? sha1(url).slice(0, 12) : '';
}

function sleep(ms: number): Promise<void> {
  return ms <= 0 ? Promise.resolve() : new Promise((resolve) => setTimeout(resolve, ms));
}

function browserHostErrorMessage(error: unknown) {
  return scrubBrowserHostText(error instanceof Error ? error.message : String(error));
}

function browserHostErrorCanRetry(error: unknown) {
  return error instanceof NativeEmbeddedBrowserHostAdapterError && error.retryable === true;
}

function browserHostErrorRequiresHandoff(error: unknown) {
  return error instanceof NativeEmbeddedBrowserHostAdapterError && error.requiresHandoff === true;
}

function browserHostNativeLiveSurfaceTransport(value: unknown): BrowserHostSessionState['liveSurfaceTransport'] {
  return value === 'native-embedded' ? 'native-embedded' : undefined;
}

function scrubBrowserHostLogEntry(entry: Record<string, unknown>) {
  const scrubbed: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(entry)) {
    if (/authorization|api[-_]?key|token|secret|password|credential/i.test(key)) {
      scrubbed[key] = '[redacted]';
    } else if (typeof value === 'string') {
      scrubbed[key] = scrubBrowserHostText(value);
    } else {
      scrubbed[key] = value;
    }
  }
  return scrubbed;
}

function scrubBrowserHostText(value: string) {
  return clip(value, 4000)
    .replace(/\b(authorization|api[-_]?key|token|secret|password|credential)(=|:)\s*[^&\s"']+/gi, '$1$2[redacted]');
}

function cleanText(value: string) {
  return value.replace(/\s+/g, ' ').trim();
}

function htmlToText(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ');
}

function clip(value: string, max: number) {
  return value.length > max ? `${value.slice(0, max)}...` : value;
}
