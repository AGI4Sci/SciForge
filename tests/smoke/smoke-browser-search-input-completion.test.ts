import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  BROWSER_HOST_SESSION_PROVIDER_ID,
  BROWSER_HOST_SESSION_SCHEMA,
  BrowserHostSessionManager,
  type BrowserHostMouseButton,
  type BrowserHostSessionDriver,
  type BrowserHostSessionDriverFactory,
  type BrowserHostSessionState,
} from '../../src/runtime/browser-host-session.js';
import {
  executeBrowserHostComputerUseAction,
  type BrowserHostComputerUseActionResult,
} from '../../src/runtime/browser-host-computer-use.js';

const PNG_1X1 = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
  0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
  0x08, 0x04, 0x00, 0x00, 0x00, 0xb5, 0x1c, 0x0c,
  0x02, 0x00, 0x00, 0x00, 0x0b, 0x49, 0x44, 0x41,
  0x54, 0x78, 0xda, 0x63, 0xfc, 0xff, 0x1f, 0x00,
  0x03, 0x03, 0x02, 0x00, 0xef, 0xbf, 0xa7, 0xdb,
  0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44,
  0xae, 0x42, 0x60, 0x82,
]);

const LONG_MIXED_QUERY = [
  'SciForge BrowserHostSession search input 完整度',
  '中文 English symbols !@#$%^&*()[]{}+-=_:;,.?/ quoted "refs-first"',
  'long-query-section-01 long-query-section-02 long-query-section-03',
  '低延迟 不丢字 no-premature-submit single-owner',
].join(' | ');

const RETYPE_SUFFIX = ' 修正 refined+v2?';
const BACKSPACE_COUNT = 9;

test('BrowserHostSession search page input completion accepts long mixed queries and delete/retype without shell capture', async () => {
  const workspacePath = await mkdtemp(join(tmpdir(), 'sciforge-browser-search-input-'));
  const { factory, drivers } = deterministicSearchInputDriverFactory();
  try {
    const manager = new BrowserHostSessionManager({ driverFactory: factory });
    const opened = await manager.openSession(workspacePath, {
      url: 'http://localhost/search-input-fixture',
      sessionId: 'search-input-completion',
      width: 960,
      height: 640,
      timeoutMs: 2_000,
    });
    assert.equal(opened.owner, 'host');
    assert.equal(opened.singleInteractiveTruth, true);
    assert.equal(opened.liveSurfaceTransport, 'host-stream');

    const driver = drivers[0];
    assert.ok(driver, 'deterministic search input driver should be created');

    const focus = await executeBrowserHostComputerUseAction(manager, workspacePath, opened.id, {
      type: 'click',
      x: 160,
      y: 48,
    }, {
      capture: 'none',
      actionId: 'search-input-focus',
      adapterSentAt: recentAdapterTimestamp(),
    });
    assertBrowserHostOnly(focus, 'click');
    assert.equal(driver.focusTarget, 'searchbox');

    const typed = await executeBrowserHostComputerUseAction(manager, workspacePath, opened.id, {
      type: 'type_text',
      text: LONG_MIXED_QUERY,
    }, {
      capture: 'none',
      actionId: 'search-input-long-mixed-query',
      adapterSentAt: recentAdapterTimestamp(),
    });
    assertBrowserHostOnly(typed, 'type');
    assert.equal(driver.searchValue, LONG_MIXED_QUERY);
    assert.equal(driver.submittedQueries.length, 0, 'long query should not submit before Enter');
    assert.equal(driver.shellComposerDraft, '', 'query text must not fall through to the chat composer');
    assert.deepEqual(driver.shellComposerKeys, [], 'edit keys must not fall through to the host shell');

    for (let index = 0; index < BACKSPACE_COUNT; index += 1) {
      const backspace = await executeBrowserHostComputerUseAction(manager, workspacePath, opened.id, {
        type: 'press_key',
        key: 'Backspace',
      }, {
        capture: 'none',
        actionId: `search-input-backspace-${index + 1}`,
        adapterSentAt: recentAdapterTimestamp(),
      });
      assertBrowserHostOnly(backspace, 'press');
      assert.equal(backspace.hostAction.key, 'Backspace');
    }

    const afterDelete = LONG_MIXED_QUERY.slice(0, -BACKSPACE_COUNT);
    assert.equal(driver.searchValue, afterDelete);
    assert.equal(driver.submittedQueries.length, 0, 'delete/retype should still not submit before Enter');

    const retyped = await executeBrowserHostComputerUseAction(manager, workspacePath, opened.id, {
      type: 'type_text',
      text: RETYPE_SUFFIX,
    }, {
      capture: 'none',
      actionId: 'search-input-retype-suffix',
      adapterSentAt: recentAdapterTimestamp(),
    });
    assertBrowserHostOnly(retyped, 'type');

    const expectedFinalQuery = `${afterDelete}${RETYPE_SUFFIX}`;
    assert.equal(driver.searchValue, expectedFinalQuery);

    const enter = await executeBrowserHostComputerUseAction(manager, workspacePath, opened.id, {
      type: 'press_key',
      key: 'Enter',
    }, {
      capture: 'none',
      actionId: 'search-input-submit-enter',
      adapterSentAt: recentAdapterTimestamp(),
    });
    assertBrowserHostOnly(enter, 'press');
    assert.deepEqual(driver.submittedQueries, [expectedFinalQuery]);
    assert.equal(driver.shellComposerDraft, '');
    assert.deepEqual(driver.shellComposerKeys, []);

    const finalState = await manager.sessionState(workspacePath, opened.id);
    assert.ok(finalState, 'final BrowserHostSession state should be available');
    assert.equal(finalState.url, 'http://localhost/search-input-fixture?q=submitted');
    assertTimingSummary(finalState, 'click');
    assertTimingSummary(finalState, 'type');
    assertTimingSummary(finalState, 'press');

    const report = boundedSearchInputReport(finalState, driver, expectedFinalQuery);
    const reportText = JSON.stringify(report);
    assert.doesNotMatch(reportText, /<\s*(?:!doctype|html|body|input|form)\b/i);
    assert.doesNotMatch(reportText, /data:image|base64|iVBORw0KGgo/i);
    assert.doesNotMatch(reportText, new RegExp(escapeRegExp(LONG_MIXED_QUERY)));
    assert.equal(report.queryMatchesPageValue, true);
    assert.equal(report.shellComposerCapturedCharacters, 0);
    assert.equal(report.systemKeyboardEvents, 'not-sent');
    assert.equal(report.failureFocusedDiagnostic.focusedElement.kind, 'searchbox');
    assert.ok(report.failureFocusedDiagnostic.actionTimingSummary.some((row) => row.action === 'type'));

    console.log(`[ok] Browser search input completion ${JSON.stringify(report)}`);
  } finally {
    await rm(workspacePath, { recursive: true, force: true });
  }
});

test('BrowserHostSession search input failure diagnostic is focus/timing oriented and bounded', () => {
  const driver = new DeterministicSearchInputDriver();
  driver.focusTarget = 'shell-composer';
  driver.searchValue = LONG_MIXED_QUERY.slice(0, 24);
  driver.shellComposerDraft = 'captured-by-shell';
  driver.shellComposerKeys.push('Enter');
  driver.actions.push(
    `type:${LONG_MIXED_QUERY.length}:shell-composer`,
    'press:Enter:shell-composer',
  );

  const diagnostic = boundedSearchInputFailureDiagnostic(
    diagnosticSessionStateFixture(),
    driver,
    `${LONG_MIXED_QUERY}${RETYPE_SUFFIX}`,
  );
  const serialized = JSON.stringify(diagnostic);
  assert.equal(diagnostic.focusedElement.kind, 'shell-composer');
  assert.equal(diagnostic.query.matchesPageValue, false);
  assert.equal(diagnostic.shellComposer.capturedCharacters, 'captured-by-shell'.length);
  assert.ok(diagnostic.actionTimingSummary.some((row) => row.action === 'type' && row.count === 1));
  assert.ok(diagnostic.recentActions.includes(`type:${LONG_MIXED_QUERY.length}:shell-composer`));
  assert.doesNotMatch(serialized, /<\s*(?:!doctype|html|body|input|form)\b/i);
  assert.doesNotMatch(serialized, /data:image|base64|iVBORw0KGgo/i);
  assert.doesNotMatch(serialized, new RegExp(escapeRegExp(LONG_MIXED_QUERY)));
  assert.doesNotMatch(serialized, /captured-by-shell/);
});

function deterministicSearchInputDriverFactory(): {
  factory: BrowserHostSessionDriverFactory;
  drivers: DeterministicSearchInputDriver[];
} {
  const drivers: DeterministicSearchInputDriver[] = [];
  return {
    drivers,
    factory: {
      async create() {
        const driver = new DeterministicSearchInputDriver();
        drivers.push(driver);
        return driver;
      },
    },
  };
}

class DeterministicSearchInputDriver implements BrowserHostSessionDriver {
  currentUrl = 'about:blank';
  focusTarget: 'page' | 'searchbox' | 'shell-composer' = 'page';
  searchValue = '';
  submittedQueries: string[] = [];
  shellComposerDraft = '';
  shellComposerKeys: string[] = [];
  actions: string[] = [];
  readonly liveSurfaceTransport = 'host-stream' as const;

  url(): string {
    return this.currentUrl;
  }

  async goto(url: string): Promise<void> {
    this.currentUrl = url;
    this.focusTarget = 'searchbox';
    this.actions.push(`goto:${url}`);
  }

  async title(): Promise<string> {
    return 'Deterministic search input fixture';
  }

  async content(): Promise<string> {
    return '<!-- deterministic BrowserHostSession search input fixture; raw values stay out of evidence -->';
  }

  async text(): Promise<string> {
    return `searchLength=${this.searchValue.length} submitted=${this.submittedQueries.length}`;
  }

  async screenshot(path: string): Promise<void> {
    await writeFile(path, PNG_1X1);
  }

  async axSnapshot(): Promise<unknown> {
    return { role: 'searchbox', name: 'Search query', valueLength: this.searchValue.length };
  }

  async canGoBack(): Promise<boolean> {
    return false;
  }

  async canGoForward(): Promise<boolean> {
    return false;
  }

  async back(): Promise<void> {}

  async forward(): Promise<void> {}

  async reload(): Promise<void> {}

  async stop(): Promise<void> {}

  async click(x: number, y: number, button: BrowserHostMouseButton = 'left'): Promise<void> {
    this.focusTarget = button === 'left' && x >= 24 && x <= 720 && y >= 20 && y <= 84
      ? 'searchbox'
      : 'page';
    this.actions.push(`click:${button}:${x},${y}:${this.focusTarget}`);
  }

  async type(text: string): Promise<void> {
    if (this.focusTarget === 'searchbox') {
      this.searchValue += text;
    } else {
      this.shellComposerDraft += text;
    }
    this.actions.push(`type:${text.length}:${this.focusTarget}`);
  }

  async press(key: string): Promise<void> {
    if (this.focusTarget !== 'searchbox') {
      this.shellComposerKeys.push(key);
      this.actions.push(`press:${key}:${this.focusTarget}`);
      return;
    }
    if (key === 'Backspace') {
      this.searchValue = Array.from(this.searchValue).slice(0, -1).join('');
    } else if (key === 'Delete') {
      this.searchValue = Array.from(this.searchValue).slice(1).join('');
    } else if (key === 'Enter') {
      this.submittedQueries.push(this.searchValue);
      this.currentUrl = 'http://localhost/search-input-fixture?q=submitted';
    }
    this.actions.push(`press:${key}:searchbox`);
  }

  async scroll(): Promise<void> {}

  async close(): Promise<void> {}
}

function assertBrowserHostOnly(result: BrowserHostComputerUseActionResult, expectedAction: string): void {
  assert.equal(result.inputChannel, 'browser-host-session');
  assert.equal(result.userDeviceImpact, 'none');
  assert.equal(result.sharedSystemInputUsed, false);
  assert.equal(result.systemMouseEvents, 'not-sent');
  assert.equal(result.systemKeyboardEvents, 'not-sent');
  assert.equal(result.liveBrowserOwner, 'BrowserHostSession');
  assert.equal(result.singleInteractiveTruth, true);
  assert.equal(result.hostAction.action, expectedAction);
  assert.equal(result.hostAction.capture, 'none');
  assert.equal(result.session.singleInteractiveTruth, true);
}

function assertTimingSummary(state: BrowserHostSessionState, action: string): void {
  const summary = state.actionTimingSummary?.find((row) => row.action === action);
  assert.ok(summary, `missing timing summary for ${action}`);
  assert.ok(summary.count >= 1, `${action} should have at least one timing sample`);
  assert.ok(Number.isFinite(summary.lastMs), `${action} lastMs should be finite`);
}

function boundedSearchInputReport(
  state: BrowserHostSessionState,
  driver: DeterministicSearchInputDriver,
  expectedFinalQuery: string,
) {
  return {
    schemaVersion: 'sciforge.browser-search-input-completion-smoke.v1',
    source: 'local-deterministic-browser-host-session-searchbox',
    publicNetworkUsed: false,
    refsOnly: true,
    inputChannel: 'browser-host-session',
    liveBrowserOwner: 'BrowserHostSession',
    singleInteractiveTruth: true,
    systemKeyboardEvents: 'not-sent',
    queryDimensions: ['long', 'zh-en-symbols', 'delete-retype'],
    queryLength: expectedFinalQuery.length,
    queryHash: sha256(expectedFinalQuery),
    queryMatchesPageValue: driver.searchValue === expectedFinalQuery,
    submittedQueryCount: driver.submittedQueries.length,
    prematureSubmitCount: Math.max(0, driver.submittedQueries.length - 1),
    shellComposerCapturedCharacters: driver.shellComposerDraft.length,
    shellComposerCapturedKeys: driver.shellComposerKeys.length,
    failureFocusedDiagnostic: boundedSearchInputFailureDiagnostic(state, driver, expectedFinalQuery),
    session: {
      id: state.id,
      owner: state.owner,
      status: state.status,
      finalUrl: state.url,
      liveSurfaceTransport: state.liveSurfaceTransport,
      frameStreamRef: state.frameStreamRef,
      frameRef: state.frameRef,
    },
    timingSummary: state.actionTimingSummary?.filter((row) => row.action === 'click' || row.action === 'type' || row.action === 'press') ?? [],
  };
}

function boundedSearchInputFailureDiagnostic(
  state: BrowserHostSessionState,
  driver: DeterministicSearchInputDriver,
  expectedFinalQuery: string,
) {
  return {
    schemaVersion: 'sciforge.browser-search-input-completion-failure-diagnostic.v1',
    source: 'bounded-browser-host-session-driver-state',
    focusedElement: {
      kind: driver.focusTarget,
      source: 'driver-focus-target',
    },
    query: {
      expectedLength: expectedFinalQuery.length,
      expectedHash: sha256(expectedFinalQuery),
      pageValueLength: driver.searchValue.length,
      pageValueHash: sha256(driver.searchValue),
      matchesPageValue: driver.searchValue === expectedFinalQuery,
      submittedQueryCount: driver.submittedQueries.length,
      prematureSubmitCount: Math.max(0, driver.submittedQueries.length - 1),
    },
    shellComposer: {
      capturedCharacters: driver.shellComposerDraft.length,
      capturedKeys: driver.shellComposerKeys.length,
    },
    actionTimingSummary: (state.actionTimingSummary ?? [])
      .filter((row) => row.action === 'click' || row.action === 'type' || row.action === 'press')
      .map((row) => ({
        action: row.action,
        count: row.count,
        p95Ms: row.p95Ms,
        lastMs: row.lastMs,
      })),
    lastActionTiming: state.lastActionTiming
      ? {
        action: state.lastActionTiming.action,
        status: state.lastActionTiming.status,
        capture: state.lastActionTiming.capture,
        totalMs: state.lastActionTiming.totalMs,
        hostActionMs: state.lastActionTiming.hostActionMs,
        paintAckSource: state.lastActionTiming.paintAckSource,
      }
      : undefined,
    recentActions: driver.actions.slice(-12).map(boundedDriverAction),
    diagnostics: state.diagnostics.map(scrubDiagnostic).slice(-8),
    forbiddenEvidence: {
      rawQuery: false,
      rawDom: false,
      encodedImagePayload: false,
      screenshot: false,
      systemInputPayload: false,
    },
  };
}

function diagnosticSessionStateFixture(): BrowserHostSessionState {
  return {
    schemaVersion: BROWSER_HOST_SESSION_SCHEMA,
    id: 'search-input-completion',
    owner: 'host',
    providerId: BROWSER_HOST_SESSION_PROVIDER_ID,
    status: 'ready',
    workspacePath: '/tmp/sciforge-browser-search-input-diagnostic',
    requestedUrl: 'http://localhost/search-input-fixture',
    url: 'http://localhost/search-input-fixture',
    title: 'Deterministic search input fixture',
    startedAt: '2026-06-02T00:00:00.000Z',
    updatedAt: '2026-06-02T00:00:01.000Z',
    viewport: { width: 960, height: 640 },
    canGoBack: false,
    canGoForward: false,
    liveSurfaceRef: 'browser-host-session:search-input-completion/live-surface',
    liveSurfaceTransport: 'host-stream',
    singleInteractiveTruth: true,
    frameStreamRef: 'browser-host-session:search-input-completion/frame-stream',
    frameRef: 'browser-host-session:search-input-completion/frame.png',
    screenshotRef: 'browser-host-session:search-input-completion/screenshot.png',
    domSnapshotRef: 'browser-host-session:search-input-completion/dom.html',
    axSnapshotRef: 'browser-host-session:search-input-completion/ax.json',
    consoleLogRef: 'browser-host-session:search-input-completion/console.jsonl',
    networkLogRef: 'browser-host-session:search-input-completion/network.jsonl',
    diagnostics: ['focus target remained outside the searchbox'],
    actionTimingSummary: [{
      action: 'click',
      count: 1,
      p50Ms: 4,
      p95Ms: 4,
      lastMs: 4,
    }, {
      action: 'type',
      count: 1,
      p50Ms: 12,
      p95Ms: 12,
      lastMs: 12,
    }, {
      action: 'press',
      count: 1,
      p50Ms: 3,
      p95Ms: 3,
      lastMs: 3,
    }],
  };
}

function boundedDriverAction(action: string): string {
  if (action.startsWith('goto:')) return `goto-url-hash:${sha256(action.slice('goto:'.length)).slice(0, 16)}`;
  if (/^(?:type:\d+|press:[^:]+|click:[^:]+:\d+,\d+|scroll:|drag:)/.test(action)) {
    return action.slice(0, 96);
  }
  return `action-hash:${sha256(action).slice(0, 16)}`;
}

function scrubDiagnostic(value: string): string {
  return value
    .replace(/https?:\/\/[^\s"'<>]+/g, (url) => `[url:${sha256(url).slice(0, 12)}]`)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 240);
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function recentAdapterTimestamp(): string {
  return new Date(Date.now() - 1).toISOString();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
