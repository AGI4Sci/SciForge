import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import {
  assertLongBackgroundRunEvidence,
  runLongBackgroundRunCase,
  type LongBackgroundCursorResumeEvidence,
  type LongBackgroundPage,
  type LongBackgroundRunEvidence,
} from './long-background-run.js';
import type { ProjectionOnlyRestoreEvidence } from '../refresh-reopen-helper.js';
import type { WebE2eExpectedProjection, WebE2eFixtureWorkspace } from '../types.js';

class FakePage implements LongBackgroundPage {
  readonly gotoCalls: Array<{ url: string; waitUntil?: string }> = [];
  readonly storage: Record<string, unknown[]> = {};
  readonly events: string[];
  closed = false;

  constructor(
    readonly id: string,
    events: string[],
  ) {
    this.events = events;
  }

  async goto(url: string, options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }): Promise<void> {
    this.gotoCalls.push({ url, waitUntil: options?.waitUntil });
    this.events.push(`${this.id}:goto:${url}`);
  }

  async reload(): Promise<void> {
    this.events.push(`${this.id}:reload`);
  }

  async evaluate<Result, Arg>(pageFunction: (arg: Arg) => Result | Promise<Result>, arg: Arg): Promise<Result> {
    const previousWindow = globalThis.window;
    const previousCustomEvent = globalThis.CustomEvent;
    const fakeWindow = {
      dispatchEvent: (event: Event) => {
        this.events.push(`${this.id}:event:${event.type}`);
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
    if (this.closed) return;
    this.closed = true;
    this.events.push(`${this.id}:close`);
  }
}

class FakeContext {
  readonly pages: FakePage[] = [];

  constructor(readonly events: string[]) {}

  async newPage(): Promise<FakePage> {
    const page = new FakePage(`page-${this.pages.length + 1}`, this.events);
    this.pages.push(page);
    return page;
  }
}

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-07-long-background-run-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-07 composes refresh/reopen, multi-tab clarification, cursor resume, and terminal Projection contract', async () => {
  const fixture = withLongBackgroundProjection(await buildWebE2eFixtureWorkspace({
    caseId: 'SA-WEB-07',
    baseDir,
    now: '2026-05-16T00:00:00.000Z',
  }));
  const events: string[] = [];
  const context = new FakeContext(events);
  const evidence = longBackgroundEvidence(fixture);
  const restoreEvidence = projectionEvidence(fixture.expectedProjection);
  let checkpointWaits = 0;
  let terminalWaits = 0;
  let clarificationSubmits = 0;

  const result = await runLongBackgroundRunCase({
    fixture,
    browserContext: context,
    appUrl: `http://127.0.0.1:5173/?scenario=${fixture.scenarioId}`,
    evidence,
    async submitClarification({ page, prompt }) {
      clarificationSubmits += 1;
      page.events.push(`${page.id}:clarification:${prompt}`);
    },
    async waitForBackgroundCheckpoint() {
      checkpointWaits += 1;
    },
    async waitForTerminal() {
      terminalWaits += 1;
    },
    async reopenSession() {
      const page = await context.newPage();
      page.events.push(`${page.id}:reopen:${fixture.sessionId}`);
      return page;
    },
    async readProjectionOnlyRestore({ phase }) {
      return {
        ...restoreEvidence,
        restoreSource: phase === 'after-round-refresh' ? 'conversation-event-log' : 'conversation-projection',
      };
    },
    async readBrowserVisibleState() {
      const answer = fixture.expectedProjection.conversationProjection.visibleAnswer;
      return {
        status: answer?.status,
        visibleAnswerText: answer?.text,
        visibleArtifactRefs: [
          ...fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
          ...fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
        ],
        primaryArtifactRefs: fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
        supportingArtifactRefs: fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
        auditRefs: [],
        diagnosticRefs: [],
        internalRefs: [],
      };
    },
  });

  assert.equal(result.refreshReopen.refreshedAfterRound, 2);
  assert.deepEqual(result.refreshReopen.restoreChecks.map((check) => check.phase), ['after-round-refresh', 'terminal-reopen']);
  assert.equal(result.concurrencyProjection.activeRun?.id, fixture.runId);
  assert.deepEqual(result.concurrencyProjection.backgroundRuns.map((run) => run.id), ['run-sa-web-07-background']);
  assert.equal(result.contractInput.expected.conversationProjection.backgroundState?.status, 'completed');
  assert.equal(checkpointWaits, 2);
  assert.equal(terminalWaits, 1);
  assert.equal(clarificationSubmits, 2);
  assert.ok(events.includes('page-1:reload'), 'long run must refresh while background checkpoint exists');
  assert.ok(events.some((event) => event.startsWith('page-2:clarification:')), 'second tab must submit the clarification');
});

test('SA-WEB-07 rejects stale cursor resume or missing checkpoint evidence', async () => {
  const fixture = withLongBackgroundProjection(await buildWebE2eFixtureWorkspace({
    caseId: 'SA-WEB-07-stale-cursor',
    baseDir,
    now: '2026-05-16T00:00:00.000Z',
  }));
  const evidence = longBackgroundEvidence(fixture);

  assert.throws(
    () => assertLongBackgroundRunEvidence({
      ...evidence,
      cursorResume: {
        ...evidence.cursorResume,
        cursorAfterRefresh: evidence.cursorResume.cursorBeforeRefresh,
        producerSeqAfterRefresh: evidence.cursorResume.producerSeqBeforeRefresh,
      },
    }, fixture.expectedProjection, {
      sessionId: fixture.sessionId,
      activeRun: evidence.foregroundRun,
      backgroundRuns: evidence.backgroundRuns,
    }),
    /producerSeq after refresh/,
  );

  assert.throws(
    () => assertLongBackgroundRunEvidence({
      ...evidence,
      cursorResume: {
        ...evidence.cursorResume,
        resumedFromCheckpointRef: 'checkpoint:missing',
      },
    }, fixture.expectedProjection, {
      sessionId: fixture.sessionId,
      activeRun: evidence.foregroundRun,
      backgroundRuns: evidence.backgroundRuns,
    }),
    /recorded checkpoint refs/,
  );
});

function withLongBackgroundProjection(fixture: WebE2eFixtureWorkspace): WebE2eFixtureWorkspace {
  const next = structuredClone(fixture) as WebE2eFixtureWorkspace;
  const projection = structuredClone(next.expectedProjection.conversationProjection);
  projection.backgroundState = {
    status: 'completed',
    checkpointRefs: checkpointRefs(),
    revisionPlan: 'Resume the foreground answer from the latest checkpoint after clarification.',
    foregroundPartialRef: 'artifact:fixture-current-report',
  };
  projection.activeRun = { id: next.runId, status: 'satisfied' };
  next.expectedProjection.conversationProjection = projection;

  const session = next.workspaceState.sessionsByScenario[next.scenarioId];
  const run = session.runs.find((candidate) => candidate.id === next.runId);
  assert.ok(run?.raw && typeof run.raw === 'object');
  const raw = run.raw as {
    displayIntent?: {
      conversationProjection?: unknown;
      taskOutcomeProjection?: { conversationProjection?: unknown };
    };
    resultPresentation?: { conversationProjection?: unknown };
  };
  if (raw.displayIntent) {
    raw.displayIntent.conversationProjection = projection;
    if (raw.displayIntent.taskOutcomeProjection) raw.displayIntent.taskOutcomeProjection.conversationProjection = projection;
  }
  if (raw.resultPresentation) raw.resultPresentation.conversationProjection = projection;
  return next;
}

function longBackgroundEvidence(fixture: WebE2eFixtureWorkspace): LongBackgroundRunEvidence {
  return {
    foregroundRun: { id: fixture.runId, status: 'background-running' },
    backgroundRuns: [{ id: 'run-sa-web-07-background', status: 'background-running' }],
    concurrencyDecision: 'attach-background-to-foreground',
    cursorResume: cursorResumeEvidence(),
    terminalProjection: fixture.expectedProjection.conversationProjection,
  };
}

function cursorResumeEvidence(): LongBackgroundCursorResumeEvidence {
  return {
    checkpointRefs: checkpointRefs(),
    cursorBeforeRefresh: 'cursor:producer:000012',
    cursorAfterRefresh: 'cursor:producer:000018',
    producerSeqBeforeRefresh: 12,
    producerSeqAfterRefresh: 18,
    resumedFromCheckpointRef: 'checkpoint:sa-web-07-background-2',
  };
}

function checkpointRefs(): string[] {
  return [
    'checkpoint:sa-web-07-background-1',
    'checkpoint:sa-web-07-background-2',
  ];
}

function projectionEvidence(expected: WebE2eExpectedProjection): ProjectionOnlyRestoreEvidence {
  return {
    sessionId: expected.sessionId,
    scenarioId: expected.scenarioId,
    runId: expected.runId,
    projectionVersion: expected.projectionVersion,
    hasConversationProjection: true,
    restoreSource: 'conversation-projection',
    rawFallbackUsed: false,
    visibleAnswer: {
      status: expected.conversationProjection.visibleAnswer?.status,
      text: expected.conversationProjection.visibleAnswer?.text,
      artifactRefs: expected.conversationProjection.visibleAnswer?.artifactRefs,
    },
    currentTask: {
      currentTurnRef: expected.currentTask.currentTurnRef.ref,
      explicitRefs: expected.currentTask.explicitRefs.map((ref) => ref.ref),
      selectedRefs: expected.currentTask.selectedRefs.map((ref) => ref.ref),
    },
    artifactDelivery: expected.artifactDelivery,
    runAuditRefs: expected.runAuditRefs,
  };
}
