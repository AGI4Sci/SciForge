import assert from 'node:assert/strict';

import type { Page } from 'playwright-core';

export type MultiTabRunSummary = {
  id: string;
  status: string;
};

export type MultiTabProjectionSnapshot = {
  sessionId: string;
  activeRun?: MultiTabRunSummary;
  backgroundRuns: MultiTabRunSummary[];
};

export type MultiTabConcurrencyDecisionUIAction = {
  schemaVersion: 'sciforge.web-e2e.ui-action.v1';
  kind: 'UIAction';
  type: 'concurrency-decision';
  sessionId: string;
  pageId: string;
  peerPageId: string;
  decision: string;
  activeRun?: MultiTabRunSummary;
  backgroundRuns: MultiTabRunSummary[];
  runIds: {
    activeRunId?: string;
    backgroundRunIds: string[];
  };
  timestamp: string;
};

export type MultiTabPageSlot = 'active' | 'background';

export type MultiTabPageHandle<TPage extends MultiTabPageLike = Page> = {
  pageId: string;
  slot: MultiTabPageSlot;
  page: TPage;
};

export type MultiTabSession<TPage extends MultiTabPageLike = Page> = {
  sessionId: string;
  active: MultiTabPageHandle<TPage>;
  background: MultiTabPageHandle<TPage>;
  pages: [MultiTabPageHandle<TPage>, MultiTabPageHandle<TPage>];
  close(): Promise<void>;
};

export type OpenMultiTabSessionOptions = {
  sessionId: string;
  url?: string;
  activePageId?: string;
  backgroundPageId?: string;
  waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit';
};

export type ReportConcurrencyDecisionOptions<TPage extends MultiTabPageLike = Page> = {
  session: MultiTabSession<TPage>;
  source?: MultiTabPageSlot;
  decision: string;
  activeRun: MultiTabRunSummary;
  backgroundRuns: MultiTabRunSummary[];
  timestamp?: string;
};

export type MultiTabPageLike = {
  goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }): Promise<unknown>;
  evaluate<Result, Arg>(pageFunction: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result>;
  close(): Promise<unknown>;
};

export type MultiTabBrowserContextLike<TPage extends MultiTabPageLike = Page> = {
  newPage(): Promise<TPage>;
};

const uiActionStorageKey = '__sciforgeWebE2eUiActions';

export async function openMultiTabSession<TPage extends MultiTabPageLike = Page>(
  context: MultiTabBrowserContextLike<TPage>,
  options: OpenMultiTabSessionOptions,
): Promise<MultiTabSession<TPage>> {
  assert.ok(options.sessionId.trim(), 'openMultiTabSession requires a sessionId');
  const activePage = await context.newPage();
  const backgroundPage = await context.newPage();
  const session: MultiTabSession<TPage> = {
    sessionId: options.sessionId,
    active: {
      pageId: options.activePageId ?? `${options.sessionId}:page-active`,
      slot: 'active',
      page: activePage,
    },
    background: {
      pageId: options.backgroundPageId ?? `${options.sessionId}:page-background`,
      slot: 'background',
      page: backgroundPage,
    },
    pages: undefined as never,
    async close() {
      await Promise.allSettled([activePage.close(), backgroundPage.close()]);
    },
  };
  session.pages = [session.active, session.background];

  if (options.url) {
    await Promise.all(session.pages.map(({ page }) => page.goto(options.url!, { waitUntil: options.waitUntil ?? 'domcontentloaded' })));
  }

  return session;
}

export async function reportConcurrencyDecision<TPage extends MultiTabPageLike = Page>(
  options: ReportConcurrencyDecisionOptions<TPage>,
): Promise<{
  projection: MultiTabProjectionSnapshot;
  uiAction: MultiTabConcurrencyDecisionUIAction;
}> {
  const source = pageForSlot(options.session, options.source ?? 'active');
  const peer = pageForSlot(options.session, source.slot === 'active' ? 'background' : 'active');
  const projection = projectionSnapshot({
    sessionId: options.session.sessionId,
    activeRun: options.activeRun,
    backgroundRuns: options.backgroundRuns,
  });
  const uiAction: MultiTabConcurrencyDecisionUIAction = {
    schemaVersion: 'sciforge.web-e2e.ui-action.v1',
    kind: 'UIAction',
    type: 'concurrency-decision',
    sessionId: projection.sessionId,
    pageId: source.pageId,
    peerPageId: peer.pageId,
    decision: options.decision,
    activeRun: projection.activeRun,
    backgroundRuns: projection.backgroundRuns,
    runIds: {
      activeRunId: projection.activeRun?.id,
      backgroundRunIds: projection.backgroundRuns.map((run) => run.id),
    },
    timestamp: options.timestamp ?? new Date().toISOString(),
  };

  await source.page.evaluate(({ key, action }) => {
    const target = window as unknown as Window & Record<string, unknown[] | undefined>;
    target[key] = [...(target[key] ?? []), action];
    window.dispatchEvent(new CustomEvent('sciforge:ui-action', { detail: action }));
  }, { key: uiActionStorageKey, action: uiAction });

  assertConcurrencyDecisionMatchesProjection(projection, uiAction);
  return { projection, uiAction };
}

export async function readConcurrencyDecisionActions<TPage extends MultiTabPageLike = Page>(
  page: TPage,
): Promise<MultiTabConcurrencyDecisionUIAction[]> {
  const actions = await page.evaluate((key) => {
    const target = window as unknown as Window & Record<string, unknown[] | undefined>;
    return target[key] ?? [];
  }, uiActionStorageKey);
  return actions.filter(isConcurrencyDecisionUIAction);
}

export function projectionSnapshot(input: MultiTabProjectionSnapshot): MultiTabProjectionSnapshot {
  return {
    sessionId: input.sessionId,
    activeRun: input.activeRun ? { ...input.activeRun } : undefined,
    backgroundRuns: input.backgroundRuns.map((run) => ({ ...run })),
  };
}

export function assertConcurrencyDecisionMatchesProjection(
  projection: MultiTabProjectionSnapshot,
  uiAction: MultiTabConcurrencyDecisionUIAction,
): void {
  assert.equal(uiAction.kind, 'UIAction', 'concurrency decision must be reported as a UIAction');
  assert.equal(uiAction.type, 'concurrency-decision', 'UIAction type must be concurrency-decision');
  assert.equal(uiAction.sessionId, projection.sessionId, 'UIAction sessionId must match projection sessionId');
  assert.deepEqual(uiAction.activeRun, projection.activeRun, 'UIAction activeRun must match projection activeRun');
  assert.deepEqual(
    normalizeRuns(uiAction.backgroundRuns),
    normalizeRuns(projection.backgroundRuns),
    'UIAction backgroundRuns must match projection backgroundRuns',
  );
  assert.equal(uiAction.runIds.activeRunId, projection.activeRun?.id, 'UIAction activeRunId must match projection activeRun id');
  assert.deepEqual(
    [...uiAction.runIds.backgroundRunIds].sort(),
    projection.backgroundRuns.map((run) => run.id).sort(),
    'UIAction backgroundRunIds must match projection backgroundRuns ids',
  );
}

function pageForSlot<TPage extends MultiTabPageLike>(
  session: MultiTabSession<TPage>,
  slot: MultiTabPageSlot,
): MultiTabPageHandle<TPage> {
  return slot === 'active' ? session.active : session.background;
}

function normalizeRuns(runs: MultiTabRunSummary[]) {
  return runs.map((run) => ({ id: run.id, status: run.status })).sort((left, right) => left.id.localeCompare(right.id));
}

function isConcurrencyDecisionUIAction(value: unknown): value is MultiTabConcurrencyDecisionUIAction {
  if (!isRecord(value)) return false;
  return value.kind === 'UIAction'
    && value.type === 'concurrency-decision'
    && typeof value.sessionId === 'string'
    && typeof value.pageId === 'string'
    && typeof value.peerPageId === 'string'
    && typeof value.decision === 'string'
    && Array.isArray(value.backgroundRuns);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
