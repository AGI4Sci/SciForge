import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import type { WebE2eBrowserVisibleState } from '../contract-verifier.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import type { MultiTabPageLike, MultiTabProjectionSnapshot } from '../multi-tab-helper.js';
import type { WebE2eFixtureWorkspace } from '../types.js';
import {
  assertMultiTabConflictEvidence,
  runMultiTabConflictCase,
  type MultiTabConflictEvidence,
  type MultiTabConflictStrategy,
  type MultiTabConflictSubmissionEvidence,
} from './multi-tab-conflict.js';

class FakePage implements MultiTabPageLike {
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

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-12-multi-tab-conflict-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

const strategies: MultiTabConflictStrategy[] = ['wait', 'attach', 'cancel', 'fork'];

test('SA-WEB-12 handles simultaneous same-session submissions with explicit conflict strategies', async (t) => {
  for (const strategy of strategies) {
    await t.test(strategy, async () => {
      const fixture = await buildWebE2eFixtureWorkspace({
        caseId: `SA-WEB-12-${strategy}`,
        baseDir,
        now: '2026-05-16T00:00:00.000Z',
      });
      const events: string[] = [];
      const context = new FakeContext(events);
      const evidence = conflictEvidence(fixture, strategy);
      const submitted: MultiTabConflictSubmissionEvidence[] = [];
      let conflictResolutionWaits = 0;

      const result = await runMultiTabConflictCase({
        fixture,
        browserContext: context,
        appUrl: `http://127.0.0.1:5173/?scenario=${fixture.scenarioId}`,
        evidence,
        async submitFromTab({ page, submission }) {
          submitted.push(submission);
          page.events.push(`${page.id}:submit:${submission.requestedRunId}:${submission.sessionId}`);
        },
        async waitForConflictResolution({ projection }) {
          conflictResolutionWaits += 1;
          assert.equal(projection.activeRun?.id, fixture.runId);
        },
        async readBrowserVisibleState() {
          return browserVisibleState(fixture);
        },
      });

      assert.deepEqual(submitted.map((submission) => submission.pageSlot).sort(), ['active', 'background']);
      assert.equal(conflictResolutionWaits, 1);
      assert.deepEqual(context.pages.map((page) => page.gotoCalls[0]?.waitUntil), ['domcontentloaded', 'domcontentloaded']);
      assert.deepEqual(context.pages.map((page) => page.closed), [true, true]);
      assert.equal(result.concurrencyProjection.sessionId, fixture.sessionId);
      assert.equal(result.concurrencyProjection.activeRun?.id, fixture.runId);
      assert.deepEqual(
        result.concurrencyProjection.backgroundRuns.map((run) => run.id),
        strategy === 'wait' || strategy === 'attach' ? [evidence.handledContender.id] : [],
      );
      assert.ok(
        events.includes('page-2:event:sciforge:ui-action'),
        'handled background tab must record the concurrency-decision UIAction',
      );
      assert.equal(result.contractInput.expected.caseId, fixture.caseId);
    });
  }
});

test('SA-WEB-12 rejects implicit concurrent foreground writes to the same session', async () => {
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: 'SA-WEB-12-implicit-concurrent-write',
    baseDir,
    now: '2026-05-16T00:00:00.000Z',
  });
  const evidence = {
    ...conflictEvidence(fixture, 'cancel'),
    handledContender: {
      ...conflictEvidence(fixture, 'cancel').handledContender,
      writesSessionId: fixture.sessionId,
    },
  };

  assert.throws(
    () => assertMultiTabConflictEvidence(evidence, fixture, projectionFor(fixture, evidence)),
    /implicit concurrent foreground writes/,
  );
});

test('SA-WEB-12 rejects contender evidence that is not tied to the handled tab submission', async () => {
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: 'SA-WEB-12-contender-slot-drift',
    baseDir,
    now: '2026-05-16T00:00:00.000Z',
  });
  const evidence = {
    ...conflictEvidence(fixture, 'wait'),
    handledContender: {
      ...conflictEvidence(fixture, 'wait').handledContender,
      requestedBy: 'active' as const,
    },
  };

  assert.throws(
    () => assertMultiTabConflictEvidence(evidence, fixture, projectionFor(fixture, evidence)),
    /requestedBy must match/,
  );
});

test('SA-WEB-12 rejects a conflict decision outside the selected strategy contract', async () => {
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: 'SA-WEB-12-decision-strategy-drift',
    baseDir,
    now: '2026-05-16T00:00:00.000Z',
  });
  const evidence: MultiTabConflictEvidence = {
    ...conflictEvidence(fixture, 'wait'),
    concurrencyDecision: 'cancel-contender-run',
  };

  assert.throws(
    () => assertMultiTabConflictEvidence(evidence, fixture, projectionFor(fixture, evidence)),
    /unsupported wait multi-tab conflict decision/,
  );
});

function conflictEvidence(
  fixture: Pick<WebE2eFixtureWorkspace, 'sessionId' | 'runId'>,
  strategy: MultiTabConflictStrategy,
): MultiTabConflictEvidence {
  const submittedAt = '2026-05-16T00:00:00.000Z';
  const contenderId = `run-sa-web-12-contender-${strategy}`;
  const submissions: MultiTabConflictEvidence['submissions'] = [
    {
      pageSlot: 'active',
      prompt: 'Foreground: start the report.',
      requestedRunId: fixture.runId,
      sessionId: fixture.sessionId,
      submittedAt,
    },
    {
      pageSlot: 'background',
      prompt: 'Background: submit against the same session at the same time.',
      requestedRunId: contenderId,
      sessionId: fixture.sessionId,
      submittedAt,
    },
  ];

  if (strategy === 'wait') {
    return {
      strategy,
      concurrencyDecision: 'wait-for-foreground-run',
      foregroundRun: { id: fixture.runId, status: 'running' },
      submissions,
      handledContender: { id: contenderId, status: 'queued', requestedBy: 'background', strategy },
      foregroundWriteSessionId: fixture.sessionId,
    };
  }

  if (strategy === 'attach') {
    return {
      strategy,
      concurrencyDecision: 'attach-to-foreground-run',
      foregroundRun: { id: fixture.runId, status: 'running' },
      submissions,
      handledContender: {
        id: contenderId,
        status: 'attached',
        requestedBy: 'background',
        strategy,
        attachesToRunId: fixture.runId,
      },
      foregroundWriteSessionId: fixture.sessionId,
    };
  }

  if (strategy === 'cancel') {
    return {
      strategy,
      concurrencyDecision: 'cancel-contender-run',
      foregroundRun: { id: fixture.runId, status: 'running' },
      submissions,
      handledContender: { id: contenderId, status: 'cancelled', requestedBy: 'background', strategy },
      foregroundWriteSessionId: fixture.sessionId,
    };
  }

  return {
    strategy,
    concurrencyDecision: 'fork-contender-session',
    foregroundRun: { id: fixture.runId, status: 'running' },
    submissions,
    handledContender: {
      id: contenderId,
      status: 'running',
      requestedBy: 'background',
      strategy,
      forkSessionId: `${fixture.sessionId}:fork`,
      writesSessionId: `${fixture.sessionId}:fork`,
    },
    foregroundWriteSessionId: fixture.sessionId,
  };
}

function projectionFor(
  fixture: Pick<WebE2eFixtureWorkspace, 'sessionId'>,
  evidence: MultiTabConflictEvidence,
): MultiTabProjectionSnapshot {
  return {
    sessionId: fixture.sessionId,
    activeRun: evidence.foregroundRun,
    backgroundRuns: evidence.strategy === 'wait' || evidence.strategy === 'attach'
      ? [{ id: evidence.handledContender.id, status: evidence.handledContender.status }]
      : [],
  };
}

function browserVisibleState(fixture: WebE2eFixtureWorkspace): WebE2eBrowserVisibleState {
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
}
