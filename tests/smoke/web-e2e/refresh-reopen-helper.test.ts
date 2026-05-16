import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { buildWebE2eFixtureWorkspace } from './fixture-workspace-builder.js';
import {
  assertProjectionOnlyRestore,
  runRefreshReopenCase,
  type ProjectionOnlyRestoreEvidence,
  type RefreshReopenPage,
} from './refresh-reopen-helper.js';
import type { WebE2eExpectedProjection } from './types.js';

class FakePage implements RefreshReopenPage {
  readonly events: string[];

  constructor(
    readonly id: string,
    events: string[],
  ) {
    this.events = events;
  }

  async reload(): Promise<void> {
    this.events.push(`${this.id}:reload`);
  }

  async close(): Promise<void> {
    this.events.push(`${this.id}:close`);
  }
}

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-refresh-reopen-helper-test-'));

try {
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: 'SA-WEB-23',
    baseDir,
    now: '2026-05-16T00:00:00.000Z',
  });

  const events: string[] = [];
  const firstPage = new FakePage('page-1', events);
  const evidence = projectionEvidence(fixture.expectedProjection);
  const phases: string[] = [];

  const result = await runRefreshReopenCase({
    fixture,
    page: firstPage,
    rounds: [
      { prompt: 'Round 1: start the core web case.' },
      { prompt: 'Round 2: continue and then refresh.' },
      { prompt: 'Round 3: finish terminal state.' },
    ],
    async sendRound(context) {
      events.push(`${context.page.id}:round-${context.roundNumber}:${context.round.prompt}`);
    },
    async waitForRoundSettled(context) {
      events.push(`${context.page.id}:settled-${context.roundNumber}`);
    },
    async waitForTerminal(context) {
      events.push(`${context.page.id}:terminal:${context.phase}`);
    },
    async waitForRestored(context) {
      phases.push(context.phase);
      events.push(`${context.page.id}:restored:${context.phase}`);
    },
    async reopenSession(context) {
      events.push(`${context.page.id}:reopen:${context.sessionId}`);
      return new FakePage('page-2', events);
    },
    async readProjectionOnlyRestore(context) {
      events.push(`${context.page.id}:read-projection:${context.phase}`);
      return evidence;
    },
  });

  assert.equal(result.refreshedAfterRound, 2);
  assert.equal(result.reopenedAfterTerminal, true);
  assert.deepEqual(result.restoreChecks.map((check) => check.phase), ['after-round-refresh', 'terminal-reopen']);
  assert.deepEqual(phases, ['after-round-refresh', 'terminal-reopen']);
  assert.deepEqual(events, [
    'page-1:round-1:Round 1: start the core web case.',
    'page-1:settled-1',
    'page-1:round-2:Round 2: continue and then refresh.',
    'page-1:settled-2',
    'page-1:reload',
    'page-1:restored:after-round-refresh',
    'page-1:read-projection:after-round-refresh',
    'page-1:round-3:Round 3: finish terminal state.',
    'page-1:settled-3',
    'page-1:terminal:terminal-reopen',
    `page-1:reopen:${fixture.sessionId}`,
    'page-1:close',
    'page-2:restored:terminal-reopen',
    'page-2:read-projection:terminal-reopen',
  ]);

  assert.throws(
    () => assertProjectionOnlyRestore({ ...evidence, rawFallbackUsed: true }, fixture.expectedProjection, 'raw fallback guard'),
    /must not use raw run\/resultPresentation fallback/,
  );
  assert.throws(
    () => assertProjectionOnlyRestore({ ...evidence, restoreSource: 'raw-run' }, fixture.expectedProjection, 'restore source guard'),
    /restore source must be Projection-only/,
  );
  assert.throws(
    () => assertProjectionOnlyRestore({
      ...evidence,
      currentTask: { ...evidence.currentTask, explicitRefs: [] },
    }, fixture.expectedProjection, 'explicit refs guard'),
    /explicit refs: missing expected refs/,
  );
} finally {
  await rm(baseDir, { recursive: true, force: true });
}

console.log('[ok] SA-WEB-23 refresh/reopen helper refreshes after round 2, reopens after terminal, and rejects non-Projection restore');

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
