import assert from 'node:assert/strict';

import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
} from '../contract-verifier.js';
import {
  openMultiTabSession,
  readConcurrencyDecisionActions,
  reportConcurrencyDecision,
  type MultiTabBrowserContextLike,
  type MultiTabPageLike,
  type MultiTabProjectionSnapshot,
  type MultiTabRunSummary,
  type MultiTabSession,
} from '../multi-tab-helper.js';
import type { WebE2eFixtureWorkspace } from '../types.js';

export const multiTabConflictCaseId = 'SA-WEB-12';

export type MultiTabConflictStrategy = 'wait' | 'attach' | 'cancel' | 'fork';
export type MultiTabConflictSubmissionSlot = 'active' | 'background';

export interface MultiTabConflictSubmissionEvidence {
  pageSlot: MultiTabConflictSubmissionSlot;
  prompt: string;
  requestedRunId: string;
  sessionId: string;
  submittedAt: string;
}

export interface MultiTabConflictContenderEvidence extends MultiTabRunSummary {
  requestedBy: MultiTabConflictSubmissionSlot;
  strategy: MultiTabConflictStrategy;
  attachesToRunId?: string;
  forkSessionId?: string;
  writesSessionId?: string;
}

export interface MultiTabConflictEvidence {
  strategy: MultiTabConflictStrategy;
  concurrencyDecision: string;
  foregroundRun: MultiTabRunSummary;
  submissions: [MultiTabConflictSubmissionEvidence, MultiTabConflictSubmissionEvidence];
  handledContender: MultiTabConflictContenderEvidence;
  foregroundWriteSessionId: string;
}

export interface RunMultiTabConflictCaseOptions<TPage extends MultiTabPageLike> {
  fixture: Pick<WebE2eFixtureWorkspace, 'caseId' | 'sessionId' | 'scenarioId' | 'runId' | 'expectedProjection' | 'workspaceState'>;
  browserContext: MultiTabBrowserContextLike<TPage>;
  appUrl: string;
  evidence: MultiTabConflictEvidence;
  submitFromTab(context: {
    session: MultiTabSession<TPage>;
    page: TPage;
    slot: MultiTabConflictSubmissionSlot;
    submission: MultiTabConflictSubmissionEvidence;
  }): Promise<void>;
  waitForConflictResolution(context: {
    session: MultiTabSession<TPage>;
    projection: MultiTabProjectionSnapshot;
    evidence: MultiTabConflictEvidence;
  }): Promise<void>;
  readBrowserVisibleState(): Promise<WebE2eBrowserVisibleState>;
}

export interface MultiTabConflictCaseResult {
  concurrencyProjection: MultiTabProjectionSnapshot;
  contractInput: WebE2eContractVerifierInput;
}

const allowedDecisionsByStrategy: Record<MultiTabConflictStrategy, readonly string[]> = {
  wait: ['wait-for-foreground-run', 'wait-for-foreground-then-submit'],
  attach: ['attach-to-foreground-run', 'attach-background-to-foreground'],
  cancel: ['cancel-contender-run', 'cancel-background-contender'],
  fork: ['fork-contender-session', 'fork-background-session'],
};

export async function runMultiTabConflictCase<TPage extends MultiTabPageLike>(
  options: RunMultiTabConflictCaseOptions<TPage>,
): Promise<MultiTabConflictCaseResult> {
  const session = await openMultiTabSession(options.browserContext, {
    sessionId: options.fixture.sessionId,
    url: options.appUrl,
    waitUntil: 'domcontentloaded',
  });

  try {
    await Promise.all(options.evidence.submissions.map(async (submission) => {
      const page = submission.pageSlot === 'active' ? session.active.page : session.background.page;
      await options.submitFromTab({ session, page, slot: submission.pageSlot, submission });
    }));

    const backgroundRuns = backgroundRunsForStrategy(options.evidence);
    const { projection: concurrencyProjection, uiAction } = await reportConcurrencyDecision({
      session,
      source: options.evidence.handledContender.requestedBy,
      decision: options.evidence.concurrencyDecision,
      activeRun: options.evidence.foregroundRun,
      backgroundRuns,
      timestamp: '2026-05-16T00:00:00.000Z',
    });

    assertMultiTabConflictEvidence(options.evidence, options.fixture, concurrencyProjection);
    await options.waitForConflictResolution({ session, projection: concurrencyProjection, evidence: options.evidence });

    const sourcePage = options.evidence.handledContender.requestedBy === 'active' ? session.active.page : session.background.page;
    const actions = await readConcurrencyDecisionActions(sourcePage);
    assert.deepEqual(actions[actions.length - 1], uiAction, 'multi-tab conflict must record the concurrency-decision UIAction on the handled tab');

    const contractInput = buildMultiTabConflictContractInput(
      options.fixture,
      await options.readBrowserVisibleState(),
    );
    assertWebE2eContract(contractInput);

    return { concurrencyProjection, contractInput };
  } finally {
    await session.close();
  }
}

export function assertMultiTabConflictEvidence(
  evidence: MultiTabConflictEvidence,
  fixture: Pick<WebE2eFixtureWorkspace, 'sessionId' | 'runId'>,
  concurrencyProjection: MultiTabProjectionSnapshot,
): void {
  assert.equal(evidence.foregroundRun.id, fixture.runId, 'default foreground active run must be the expected run');
  assert.equal(evidence.foregroundWriteSessionId, fixture.sessionId, 'foreground run must write the original session');
  assert.equal(concurrencyProjection.sessionId, fixture.sessionId, 'Projection snapshot must describe the contested session');
  assert.equal(concurrencyProjection.activeRun?.id, evidence.foregroundRun.id, 'Projection activeRun must stay the accepted foreground run');
  assert.equal(
    countOriginalSessionForegroundWriters(evidence),
    1,
    'multi-tab conflict must not allow implicit concurrent foreground writes to one session',
  );
  assert.ok(
    allowedDecisionsByStrategy[evidence.strategy].includes(evidence.concurrencyDecision),
    `unsupported ${evidence.strategy} multi-tab conflict decision: ${evidence.concurrencyDecision}`,
  );

  const submittedSessionIds = new Set(evidence.submissions.map((submission) => submission.sessionId));
  assert.deepEqual([...submittedSessionIds], [fixture.sessionId], 'both tab submissions must target the same original session');
  assert.deepEqual(
    new Set(evidence.submissions.map((submission) => submission.pageSlot)),
    new Set<MultiTabConflictSubmissionSlot>(['active', 'background']),
    'conflict evidence must include one active tab and one background tab submission',
  );
  assert.notEqual(
    evidence.submissions[0].requestedRunId,
    evidence.submissions[1].requestedRunId,
    'simultaneous submissions must be distinct run requests',
  );
  assert.ok(
    evidence.submissions.some((submission) => submission.requestedRunId === evidence.foregroundRun.id),
    'one tab submission must become the foreground active run',
  );
  assert.ok(
    evidence.submissions.some((submission) => submission.requestedRunId === evidence.handledContender.id),
    'one tab submission must become the handled contender',
  );
  assert.equal(
    submissionForRun(evidence, evidence.handledContender.id)?.pageSlot,
    evidence.handledContender.requestedBy,
    'handled contender requestedBy must match the tab submission slot',
  );
  assert.equal(
    evidence.submissions[0].submittedAt,
    evidence.submissions[1].submittedAt,
    'multi-tab conflict submissions must be captured as simultaneous',
  );

  assertHandledContender(evidence, fixture.sessionId, concurrencyProjection);
}

function assertHandledContender(
  evidence: MultiTabConflictEvidence,
  sessionId: string,
  concurrencyProjection: MultiTabProjectionSnapshot,
): void {
  const contender = evidence.handledContender;
  assert.notEqual(contender.id, evidence.foregroundRun.id, 'handled contender must not replace the active foreground run');

  if (evidence.strategy === 'wait') {
    assert.ok(['queued', 'waiting', 'blocked'].includes(contender.status), 'wait strategy must queue or block the contender');
    assert.equal(contender.writesSessionId, undefined, 'waiting contender must not write the session before the foreground run settles');
    assert.deepEqual(concurrencyProjection.backgroundRuns, [runSummary(contender)], 'wait strategy must expose the waiting contender as background');
    return;
  }

  if (evidence.strategy === 'attach') {
    assert.equal(contender.attachesToRunId, evidence.foregroundRun.id, 'attach strategy must attach the contender to the foreground run');
    assert.equal(contender.writesSessionId, undefined, 'attached contender must not independently write the original session');
    assert.deepEqual(concurrencyProjection.backgroundRuns, [runSummary(contender)], 'attach strategy must expose the attached contender as background');
    return;
  }

  if (evidence.strategy === 'cancel') {
    assert.ok(['cancelled', 'canceled'].includes(contender.status), 'cancel strategy must cancel the contender');
    assert.equal(contender.writesSessionId, undefined, 'cancelled contender must not write the original session');
    assert.deepEqual(concurrencyProjection.backgroundRuns, [], 'cancel strategy must not leave a background writer on the original session');
    return;
  }

  assert.ok(contender.forkSessionId, 'fork strategy must name the forked session');
  assert.notEqual(contender.forkSessionId, sessionId, 'fork strategy must write to a separate session');
  assert.equal(contender.writesSessionId, contender.forkSessionId, 'forked contender must write only to the fork session');
  assert.deepEqual(concurrencyProjection.backgroundRuns, [], 'fork strategy must not report the fork as a background run on the original session');
}

function backgroundRunsForStrategy(evidence: MultiTabConflictEvidence): MultiTabRunSummary[] {
  if (evidence.strategy === 'cancel' || evidence.strategy === 'fork') return [];
  return [runSummary(evidence.handledContender)];
}

function runSummary(run: MultiTabRunSummary): MultiTabRunSummary {
  return { id: run.id, status: run.status };
}

function countOriginalSessionForegroundWriters(evidence: MultiTabConflictEvidence): number {
  const contenderWritesOriginal = evidence.handledContender.writesSessionId === evidence.foregroundWriteSessionId;
  return 1 + (contenderWritesOriginal ? 1 : 0);
}

function submissionForRun(
  evidence: MultiTabConflictEvidence,
  runId: string,
): MultiTabConflictSubmissionEvidence | undefined {
  return evidence.submissions.find((submission) => submission.requestedRunId === runId);
}

function buildMultiTabConflictContractInput(
  fixture: Pick<WebE2eFixtureWorkspace, 'caseId' | 'scenarioId' | 'expectedProjection' | 'workspaceState'>,
  browserVisibleState: WebE2eBrowserVisibleState,
): WebE2eContractVerifierInput {
  const session = fixture.workspaceState.sessionsByScenario[fixture.scenarioId];
  assert.ok(session, `missing session for ${fixture.scenarioId}`);
  return {
    caseId: fixture.caseId,
    expected: fixture.expectedProjection,
    browserVisibleState,
    kernelProjection: fixture.expectedProjection.conversationProjection,
    sessionBundle: { session, workspaceState: fixture.workspaceState },
    runAudit: runAuditFromSession(session, fixture.expectedProjection),
    artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, fixture.expectedProjection),
  };
}
