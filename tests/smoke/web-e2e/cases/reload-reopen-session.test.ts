import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import type { ProjectionOnlyRestoreEvidence } from '../refresh-reopen-helper.js';
import type { WebE2eExpectedProjection, WebE2eFixtureWorkspace } from '../types.js';
import {
  assertReloadReopenProjectionRestore,
  browserVisibleStateFromReloadReopenProjection,
  runReloadReopenSessionCase,
  type ReloadReopenSessionRestoreEvidence,
} from './reload-reopen-session.js';

class FakePage {
  closed = false;

  constructor(
    readonly id: string,
    readonly events: string[],
  ) {}

  async reload(): Promise<void> {
    this.events.push(`${this.id}:reload`);
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

const baseDir = await mkdtemp(join(tmpdir(), 'sciforge-sa-web-11-reload-reopen-session-'));

test.after(async () => {
  await rm(baseDir, { recursive: true, force: true });
});

test('SA-WEB-11 restores visible answer, runs, artifact refs, and recover actions from persisted Projection after reload/reopen', async () => {
  const fixture = withReloadReopenProjection(await buildWebE2eFixtureWorkspace({
    caseId: 'SA-WEB-11',
    baseDir,
    now: '2026-05-16T00:00:00.000Z',
  }));
  const events: string[] = [];
  const context = new FakeContext(events);
  const page = await context.newPage();
  const prompts: string[] = [];
  const restoreReads: string[] = [];

  const result = await runReloadReopenSessionCase({
    fixture,
    page,
    async sendPrompt({ page: currentPage, prompt, roundNumber }) {
      prompts.push(prompt);
      currentPage.events.push(`${currentPage.id}:round-${roundNumber}`);
    },
    async waitForRoundSettled({ page: currentPage, roundNumber }) {
      currentPage.events.push(`${currentPage.id}:settled-${roundNumber}`);
    },
    async waitForTerminal({ page: currentPage }) {
      currentPage.events.push(`${currentPage.id}:terminal`);
    },
    async reopenSession({ sessionId }) {
      const reopenedPage = await context.newPage();
      reopenedPage.events.push(`${reopenedPage.id}:reopen:${sessionId}`);
      return reopenedPage;
    },
    async readProjectionOnlyRestore({ phase }) {
      restoreReads.push(phase);
      return projectionRestoreEvidence(
        fixture.expectedProjection,
        phase === 'after-round-refresh' ? 'conversation-event-log' : 'conversation-projection',
      );
    },
    async readBrowserVisibleState() {
      return browserVisibleStateFromReloadReopenProjection(fixture.expectedProjection);
    },
  });

  assert.equal(result.refreshReopen.refreshedAfterRound, 2);
  assert.equal(result.refreshReopen.reopenedAfterTerminal, true);
  assert.deepEqual(result.refreshReopen.restoreChecks.map((check) => check.phase), ['after-round-refresh', 'terminal-reopen']);
  assert.deepEqual(restoreReads, ['after-round-refresh', 'terminal-reopen']);
  assert.equal(prompts.length, 3);
  assert.ok(events.includes('page-1:reload'), 'SA-WEB-11 must refresh the existing page after round 2');
  assert.ok(events.includes(`page-2:reopen:${fixture.sessionId}`), 'SA-WEB-11 must reopen the old session in a new page');
  assert.ok(events.includes('page-1:close'), 'old page must be closed after the reopened page takes over');

  const expectedProjection = fixture.expectedProjection.conversationProjection;
  assert.deepEqual(result.terminalRestore.persistedProjection, expectedProjection);
  assert.deepEqual(result.terminalRestore.visibleAnswer, expectedProjection.visibleAnswer);
  assert.equal(result.terminalRestore.rawWrapperFailureVisible, false);
  assert.deepEqual(result.terminalRestore.activeRun, expectedProjection.activeRun);
  assert.deepEqual(result.terminalRestore.recoverActions, expectedProjection.recoverActions);
  assert.deepEqual(
    result.terminalRestore.artifactDelivery?.primaryArtifactRefs,
    fixture.expectedProjection.artifactDelivery.primaryArtifactRefs,
  );
  assert.deepEqual(
    result.terminalRestore.artifactDelivery?.supportingArtifactRefs,
    fixture.expectedProjection.artifactDelivery.supportingArtifactRefs,
  );
  assert.deepEqual(result.contractInput.expected, fixture.expectedProjection);
});

test('SA-WEB-11 rejects reload/reopen evidence that falls back to raw run state or drifts from persisted Projection', async () => {
  const fixture = withReloadReopenProjection(await buildWebE2eFixtureWorkspace({
    caseId: 'SA-WEB-11-raw-fallback-guard',
    baseDir,
    now: '2026-05-16T00:00:00.000Z',
  }));
  const evidence = projectionRestoreEvidence(fixture.expectedProjection, 'conversation-projection');

  assert.throws(
    () => assertReloadReopenProjectionRestore({ ...evidence, rawFallbackUsed: true }, fixture.expectedProjection, 'raw fallback guard'),
    /raw run\/resultPresentation fallback/,
  );
  assert.ok(evidence.persistedProjection);
  const driftedProjection = structuredClone(evidence.persistedProjection);
  driftedProjection.recoverActions = ['Legacy raw repair action leaked after reopen.'];
  assert.throws(
    () => assertReloadReopenProjectionRestore({
      ...evidence,
      persistedProjection: driftedProjection,
    }, fixture.expectedProjection, 'persisted Projection guard'),
    /persisted ConversationProjection/,
  );
  assert.throws(
    () => assertReloadReopenProjectionRestore({
      ...evidence,
      activeRun: { id: fixture.runId, status: 'completed' },
    }, fixture.expectedProjection, 'active run guard'),
    /active run status/,
  );
  assert.throws(
    () => assertReloadReopenProjectionRestore({
      ...evidence,
      recoverActions: ['Legacy raw repair action leaked after reopen.'],
    }, fixture.expectedProjection, 'recover actions guard'),
    /recover actions/,
  );
  assert.throws(
    () => assertReloadReopenProjectionRestore({
      ...evidence,
      rawWrapperFailureVisible: true,
    }, fixture.expectedProjection, 'stale wrapper guard'),
    /stale raw\/backend wrapper failure/,
  );
});

console.log('[ok] SA-WEB-11 reload/reopen session restores terminal UI state only from persisted Projection');

function withReloadReopenProjection(fixture: WebE2eFixtureWorkspace): WebE2eFixtureWorkspace {
  const next = structuredClone(fixture) as WebE2eFixtureWorkspace;
  const projection = structuredClone(next.expectedProjection.conversationProjection);
  projection.recoverActions = ['Open the persisted projection artifact refs before continuing.'];
  projection.activeRun = { id: next.runId, status: projection.visibleAnswer?.status ?? 'satisfied' };
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
    backendWrapper?: unknown;
    contractValidationFailure?: unknown;
  };
  if (raw.displayIntent) {
    raw.displayIntent.conversationProjection = projection;
    if (raw.displayIntent.taskOutcomeProjection) raw.displayIntent.taskOutcomeProjection.conversationProjection = projection;
  }
  if (raw.resultPresentation) raw.resultPresentation.conversationProjection = projection;
  raw.backendWrapper = {
    ok: false,
    error: 'Stale backend wrapper failure after Projection was already satisfied.',
  };
  raw.contractValidationFailure = {
    failureReason: 'Stale contract validation failure after Projection was already satisfied.',
    recoverActions: ['Legacy raw repair action leaked after reopen.'],
  };
  return next;
}

function projectionRestoreEvidence(
  expected: WebE2eExpectedProjection,
  restoreSource: ProjectionOnlyRestoreEvidence['restoreSource'],
): ReloadReopenSessionRestoreEvidence {
  const projection = expected.conversationProjection;
  return {
    sessionId: expected.sessionId,
    scenarioId: expected.scenarioId,
    runId: expected.runId,
    projectionVersion: expected.projectionVersion,
    hasConversationProjection: true,
    restoreSource,
    rawFallbackUsed: false,
    visibleAnswer: projection.visibleAnswer,
    currentTask: {
      currentTurnRef: expected.currentTask.currentTurnRef.ref,
      explicitRefs: expected.currentTask.explicitRefs.map((ref) => ref.ref),
      selectedRefs: expected.currentTask.selectedRefs.map((ref) => ref.ref),
    },
    artifactDelivery: expected.artifactDelivery,
    runAuditRefs: expected.runAuditRefs,
    activeRun: projection.activeRun,
    terminalRun: {
      id: expected.runId,
      status: projection.visibleAnswer?.status,
    },
    recoverActions: projection.recoverActions,
    persistedProjection: projection,
    rawWrapperFailureVisible: false,
  };
}
