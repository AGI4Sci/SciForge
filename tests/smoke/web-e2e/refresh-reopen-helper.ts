import assert from 'node:assert/strict';

import type { WebE2eExpectedProjection, WebE2eFixtureWorkspace } from './types.js';

export const defaultRefreshAfterRound = 2;

export type RefreshReopenPhase = 'after-round-refresh' | 'terminal-reopen';

export interface RefreshReopenPage {
  reload(options?: { waitUntil?: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' }): Promise<unknown>;
  close?(): Promise<unknown>;
}

export interface RefreshReopenRound {
  id?: string;
  prompt: string;
}

export interface RefreshReopenRunContext<TPage extends RefreshReopenPage = RefreshReopenPage> {
  caseId: string;
  sessionId: string;
  scenarioId: string;
  runId: string;
  page: TPage;
  round: RefreshReopenRound;
  roundIndex: number;
  roundNumber: number;
}

export interface RefreshReopenCheckpointContext<TPage extends RefreshReopenPage = RefreshReopenPage> {
  caseId: string;
  sessionId: string;
  scenarioId: string;
  runId: string;
  page: TPage;
  phase: RefreshReopenPhase;
}

export interface ProjectionOnlyRestoreEvidence {
  sessionId: string;
  scenarioId?: string;
  runId?: string;
  projectionVersion?: string;
  hasConversationProjection?: boolean;
  restoreSource: 'projection' | 'conversation-projection' | 'conversation-event-log' | string;
  rawFallbackUsed?: boolean;
  visibleAnswer?: {
    status?: string;
    text?: string;
    artifactRefs?: readonly string[];
    diagnostic?: string;
  };
  currentTask?: {
    currentTurnRef?: string;
    explicitRefs?: readonly string[];
    selectedRefs?: readonly string[];
  };
  artifactDelivery?: {
    primaryArtifactRefs?: readonly string[];
    supportingArtifactRefs?: readonly string[];
    auditRefs?: readonly string[];
    diagnosticRefs?: readonly string[];
    internalRefs?: readonly string[];
  };
  runAuditRefs?: readonly string[];
}

export interface RunRefreshReopenCaseOptions<TPage extends RefreshReopenPage = RefreshReopenPage> {
  fixture: Pick<WebE2eFixtureWorkspace, 'caseId' | 'sessionId' | 'scenarioId' | 'runId' | 'expectedProjection'>;
  page: TPage;
  rounds: readonly RefreshReopenRound[];
  refreshAfterRound?: number;
  sendRound(context: RefreshReopenRunContext<TPage>): Promise<void>;
  waitForRoundSettled?(context: RefreshReopenRunContext<TPage>): Promise<void>;
  waitForTerminal?(context: RefreshReopenCheckpointContext<TPage>): Promise<void>;
  waitForRestored?(context: RefreshReopenCheckpointContext<TPage>): Promise<void>;
  reopenSession(context: RefreshReopenCheckpointContext<TPage>): Promise<TPage>;
  readProjectionOnlyRestore(context: RefreshReopenCheckpointContext<TPage>): Promise<ProjectionOnlyRestoreEvidence>;
}

export interface RefreshReopenRunResult {
  refreshedAfterRound: number;
  reopenedAfterTerminal: boolean;
  restoreChecks: Array<{
    phase: RefreshReopenPhase;
    evidence: ProjectionOnlyRestoreEvidence;
  }>;
}

export async function runRefreshReopenCase<TPage extends RefreshReopenPage>(
  options: RunRefreshReopenCaseOptions<TPage>,
): Promise<RefreshReopenRunResult> {
  const refreshAfterRound = options.refreshAfterRound ?? defaultRefreshAfterRound;
  assert.ok(Number.isInteger(refreshAfterRound) && refreshAfterRound > 0, 'refreshAfterRound must be a positive integer');
  assert.ok(options.rounds.length >= refreshAfterRound, `refresh/reopen helper requires at least ${refreshAfterRound} rounds`);

  let page = options.page;
  const restoreChecks: RefreshReopenRunResult['restoreChecks'] = [];

  for (let roundIndex = 0; roundIndex < options.rounds.length; roundIndex += 1) {
    const round = options.rounds[roundIndex];
    const context = runContext(options, page, round, roundIndex);
    await options.sendRound(context);
    await options.waitForRoundSettled?.(context);

    if (context.roundNumber === refreshAfterRound) {
      await page.reload({ waitUntil: 'domcontentloaded' });
      const checkpoint = checkpointContext(options, page, 'after-round-refresh');
      await options.waitForRestored?.(checkpoint);
      const evidence = await options.readProjectionOnlyRestore(checkpoint);
      assertProjectionOnlyRestore(evidence, options.fixture.expectedProjection, 'after round refresh');
      restoreChecks.push({ phase: 'after-round-refresh', evidence });
    }
  }

  const terminalContext = checkpointContext(options, page, 'terminal-reopen');
  await options.waitForTerminal?.(terminalContext);
  const reopenedPage = await options.reopenSession(terminalContext);
  if (reopenedPage !== page) {
    await page.close?.();
  }
  page = reopenedPage;

  const reopenedContext = checkpointContext(options, page, 'terminal-reopen');
  await options.waitForRestored?.(reopenedContext);
  const terminalEvidence = await options.readProjectionOnlyRestore(reopenedContext);
  assertProjectionOnlyRestore(terminalEvidence, options.fixture.expectedProjection, 'terminal reopen');
  restoreChecks.push({ phase: 'terminal-reopen', evidence: terminalEvidence });

  return {
    refreshedAfterRound: refreshAfterRound,
    reopenedAfterTerminal: true,
    restoreChecks,
  };
}

export function assertProjectionOnlyRestore(
  evidence: ProjectionOnlyRestoreEvidence,
  expected: WebE2eExpectedProjection,
  label = 'projection restore',
): void {
  assert.equal(evidence.sessionId, expected.sessionId, `${label}: restored session id must match expected Projection`);
  if (evidence.scenarioId !== undefined) {
    assert.equal(evidence.scenarioId, expected.scenarioId, `${label}: restored scenario id must match expected Projection`);
  }
  if (evidence.runId !== undefined) {
    assert.equal(evidence.runId, expected.runId, `${label}: restored run id must match expected Projection`);
  }
  assert.notEqual(evidence.rawFallbackUsed, true, `${label}: UI must not use raw run/resultPresentation fallback`);
  assert.ok(isProjectionRestoreSource(evidence.restoreSource), `${label}: restore source must be Projection-only, got ${evidence.restoreSource}`);
  assert.notEqual(evidence.hasConversationProjection, false, `${label}: ConversationProjection must be present`);
  if (evidence.projectionVersion !== undefined) {
    assert.equal(evidence.projectionVersion, expected.projectionVersion, `${label}: projection version`);
  }

  const expectedAnswer = expected.conversationProjection.visibleAnswer;
  if (!expectedAnswer) {
    throw new Error(`${label}: expected Projection fixture must declare a visible answer`);
  }
  assert.equal(evidence.visibleAnswer?.status, expectedAnswer.status, `${label}: visible answer status must come from Projection`);
  if (evidence.visibleAnswer?.text !== undefined && expectedAnswer.text !== undefined) {
    assert.equal(evidence.visibleAnswer.text, expectedAnswer.text, `${label}: visible answer text must come from Projection`);
  }
  assertContainsAll(
    evidence.visibleAnswer?.artifactRefs,
    expectedAnswer.artifactRefs ?? [],
    `${label}: visible answer artifact refs`,
  );

  assert.equal(
    evidence.currentTask?.currentTurnRef,
    expected.currentTask.currentTurnRef.ref,
    `${label}: current task turn ref must be restored from Projection`,
  );
  assertContainsAll(
    evidence.currentTask?.explicitRefs,
    expected.currentTask.explicitRefs.map((ref) => ref.ref),
    `${label}: explicit refs`,
  );
  assertContainsAll(
    evidence.currentTask?.selectedRefs,
    expected.currentTask.selectedRefs.map((ref) => ref.ref),
    `${label}: selected refs`,
  );

  assertContainsAll(
    evidence.artifactDelivery?.primaryArtifactRefs,
    expected.artifactDelivery.primaryArtifactRefs,
    `${label}: primary ArtifactDelivery refs`,
  );
  assertContainsAll(
    evidence.artifactDelivery?.supportingArtifactRefs,
    expected.artifactDelivery.supportingArtifactRefs,
    `${label}: supporting ArtifactDelivery refs`,
  );
  assertContainsAll(
    evidence.artifactDelivery?.auditRefs,
    expected.artifactDelivery.auditRefs,
    `${label}: audit ArtifactDelivery refs`,
  );
  assertContainsAll(
    evidence.artifactDelivery?.diagnosticRefs,
    expected.artifactDelivery.diagnosticRefs,
    `${label}: diagnostic ArtifactDelivery refs`,
  );
  assertContainsAll(
    evidence.runAuditRefs,
    expected.runAuditRefs,
    `${label}: RunAudit refs`,
  );
}

function runContext<TPage extends RefreshReopenPage>(
  options: RunRefreshReopenCaseOptions<TPage>,
  page: TPage,
  round: RefreshReopenRound,
  roundIndex: number,
): RefreshReopenRunContext<TPage> {
  return {
    caseId: options.fixture.caseId,
    sessionId: options.fixture.sessionId,
    scenarioId: options.fixture.scenarioId,
    runId: options.fixture.runId,
    page,
    round,
    roundIndex,
    roundNumber: roundIndex + 1,
  };
}

function checkpointContext<TPage extends RefreshReopenPage>(
  options: RunRefreshReopenCaseOptions<TPage>,
  page: TPage,
  phase: RefreshReopenPhase,
): RefreshReopenCheckpointContext<TPage> {
  return {
    caseId: options.fixture.caseId,
    sessionId: options.fixture.sessionId,
    scenarioId: options.fixture.scenarioId,
    runId: options.fixture.runId,
    page,
    phase,
  };
}

function isProjectionRestoreSource(source: string): boolean {
  return source === 'projection' || source === 'conversation-projection' || source === 'conversation-event-log';
}

function assertContainsAll(actual: readonly string[] | undefined, expected: readonly string[], label: string): void {
  if (!expected.length) return;
  assert.ok(actual, `${label}: missing restored refs`);
  const actualRefs = new Set(actual);
  const missing = expected.filter((ref) => !actualRefs.has(ref));
  assert.deepEqual(missing, [], `${label}: missing expected refs`);
}
