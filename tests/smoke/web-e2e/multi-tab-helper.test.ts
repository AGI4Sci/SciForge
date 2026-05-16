import assert from 'node:assert/strict';

import {
  assertConcurrencyDecisionMatchesProjection,
  openMultiTabSession,
  readConcurrencyDecisionActions,
  reportConcurrencyDecision,
  type MultiTabPageLike,
} from './multi-tab-helper.js';

class FakePage implements MultiTabPageLike {
  readonly gotoCalls: Array<{ url: string; waitUntil?: string }> = [];
  readonly dispatchedEvents: string[] = [];
  readonly storage: Record<string, unknown[]> = {};
  closed = false;

  async goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }): Promise<void> {
    this.gotoCalls.push({ url, waitUntil: options?.waitUntil });
  }

  async evaluate<Result, Arg>(pageFunction: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result> {
    const previousWindow = globalThis.window;
    const previousCustomEvent = globalThis.CustomEvent;
    const fakeWindow = {
      dispatchEvent: (event: Event) => {
        this.dispatchedEvents.push(event.type);
        return true;
      },
    } as Window & typeof globalThis & Record<string, unknown>;
    Object.assign(fakeWindow, this.storage);
    globalThis.window = fakeWindow;
    if (typeof globalThis.CustomEvent !== 'function') {
      globalThis.CustomEvent = class TestCustomEvent<T = unknown> extends Event {
        readonly detail: T;

        constructor(type: string, eventInitDict?: CustomEventInit<T>) {
          super(type, eventInitDict);
          this.detail = eventInitDict?.detail as T;
        }
      } as unknown as typeof CustomEvent;
    }
    try {
      const result = await pageFunction(arg);
      for (const [key, value] of Object.entries(fakeWindow)) {
        if (Array.isArray(value)) this.storage[key] = value;
      }
      return result;
    } finally {
      globalThis.window = previousWindow;
      globalThis.CustomEvent = previousCustomEvent;
    }
  }

  async close(): Promise<void> {
    this.closed = true;
  }
}

class FakeContext {
  readonly pages: FakePage[] = [];

  async newPage(): Promise<FakePage> {
    const page = new FakePage();
    this.pages.push(page);
    return page;
  }
}

const context = new FakeContext();
const session = await openMultiTabSession(context, {
  sessionId: 'session-sa-web-24',
  url: 'http://127.0.0.1:5173/?scenario=sa-web-24',
  waitUntil: 'domcontentloaded',
});

assert.equal(context.pages.length, 2, 'helper should open exactly two pages');
assert.deepEqual(context.pages.map((page) => page.gotoCalls[0]?.url), [
  'http://127.0.0.1:5173/?scenario=sa-web-24',
  'http://127.0.0.1:5173/?scenario=sa-web-24',
]);
assert.equal(session.active.pageId, 'session-sa-web-24:page-active');
assert.equal(session.background.pageId, 'session-sa-web-24:page-background');

const activeRun = { id: 'run-foreground', status: 'dispatched' };
const backgroundRuns = [
  { id: 'run-background-search', status: 'background-running' },
  { id: 'run-background-fetch', status: 'background-running' },
];
const { projection, uiAction } = await reportConcurrencyDecision({
  session,
  decision: 'keep-current-active-run-and-background-peer-runs',
  activeRun,
  backgroundRuns,
  timestamp: '2026-05-16T00:00:00.000Z',
});

assert.deepEqual(projection.activeRun, activeRun);
assert.deepEqual(projection.backgroundRuns, backgroundRuns);
assert.equal(uiAction.type, 'concurrency-decision');
assert.equal(uiAction.pageId, session.active.pageId);
assert.equal(uiAction.peerPageId, session.background.pageId);
assert.deepEqual(uiAction.runIds, {
  activeRunId: 'run-foreground',
  backgroundRunIds: ['run-background-search', 'run-background-fetch'],
});

const recordedActions = await readConcurrencyDecisionActions(session.active.page);
assert.equal(recordedActions.length, 1, 'source page should record one concurrency-decision UIAction');
assert.deepEqual(recordedActions[0], uiAction);
assert.deepEqual(session.active.page.dispatchedEvents, ['sciforge:ui-action']);
assert.deepEqual(await readConcurrencyDecisionActions(session.background.page), [], 'peer page should not duplicate source UIAction reports');

assert.throws(() => {
  assertConcurrencyDecisionMatchesProjection(projection, {
    ...uiAction,
    backgroundRuns: [{ id: 'run-background-search', status: 'background-running' }],
    runIds: { ...uiAction.runIds, backgroundRunIds: ['run-background-search'] },
  });
}, /backgroundRuns/);

await session.close();
assert.deepEqual(context.pages.map((page) => page.closed), [true, true], 'session.close should close both pages');

console.log('[ok] SA-WEB-24 multi-tab helper opens two pages for one session and keeps concurrency-decision UIAction aligned with activeRun/backgroundRuns');
