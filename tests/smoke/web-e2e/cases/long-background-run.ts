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
import {
  runRefreshReopenCase,
  type ProjectionOnlyRestoreEvidence,
  type RefreshReopenPage,
  type RefreshReopenRunResult,
} from '../refresh-reopen-helper.js';
import type { WebE2eExpectedProjection, WebE2eFixtureWorkspace } from '../types.js';

export const longBackgroundRunCaseId = 'SA-WEB-07';

export type LongBackgroundPage = MultiTabPageLike & RefreshReopenPage;

export interface LongBackgroundCursorResumeEvidence {
  checkpointRefs: string[];
  cursorBeforeRefresh: string;
  cursorAfterRefresh: string;
  producerSeqBeforeRefresh: number;
  producerSeqAfterRefresh: number;
  resumedFromCheckpointRef: string;
}

export interface LongBackgroundRunEvidence {
  foregroundRun: MultiTabRunSummary;
  backgroundRuns: MultiTabRunSummary[];
  concurrencyDecision: string;
  cursorResume: LongBackgroundCursorResumeEvidence;
  terminalProjection: WebE2eExpectedProjection['conversationProjection'];
}

export interface RunLongBackgroundRunCaseOptions<TPage extends LongBackgroundPage> {
  fixture: Pick<WebE2eFixtureWorkspace, 'caseId' | 'sessionId' | 'scenarioId' | 'runId' | 'expectedProjection' | 'workspaceState'>;
  browserContext: MultiTabBrowserContextLike<TPage>;
  appUrl: string;
  evidence: LongBackgroundRunEvidence;
  submitClarification(context: {
    session: MultiTabSession<TPage>;
    page: TPage;
    prompt: string;
  }): Promise<void>;
  waitForBackgroundCheckpoint(context: { session: MultiTabSession<TPage>; projection: MultiTabProjectionSnapshot }): Promise<void>;
  waitForTerminal(context: { session: MultiTabSession<TPage> }): Promise<void>;
  reopenSession(context: {
    session: MultiTabSession<TPage>;
    phase: 'terminal-reopen';
  }): Promise<TPage>;
  readProjectionOnlyRestore(context: {
    session: MultiTabSession<TPage>;
    page: TPage;
    phase: 'after-round-refresh' | 'terminal-reopen';
  }): Promise<ProjectionOnlyRestoreEvidence>;
  readBrowserVisibleState(): Promise<WebE2eBrowserVisibleState>;
}

export interface LongBackgroundRunCaseResult {
  concurrencyProjection: MultiTabProjectionSnapshot;
  refreshReopen: RefreshReopenRunResult;
  contractInput: WebE2eContractVerifierInput;
}

export async function runLongBackgroundRunCase<TPage extends LongBackgroundPage>(
  options: RunLongBackgroundRunCaseOptions<TPage>,
): Promise<LongBackgroundRunCaseResult> {
  const session = await openMultiTabSession(options.browserContext, {
    sessionId: options.fixture.sessionId,
    url: options.appUrl,
    waitUntil: 'domcontentloaded',
  });

  try {
    const { projection: concurrencyProjection, uiAction } = await reportConcurrencyDecision({
      session,
      decision: options.evidence.concurrencyDecision,
      activeRun: options.evidence.foregroundRun,
      backgroundRuns: options.evidence.backgroundRuns,
      timestamp: '2026-05-16T00:00:00.000Z',
    });
    assertLongBackgroundRunEvidence(options.evidence, options.fixture.expectedProjection, concurrencyProjection);

    await options.waitForBackgroundCheckpoint({ session, projection: concurrencyProjection });
    await options.submitClarification({
      session,
      page: session.background.page,
      prompt: 'Clarification: keep the foreground run attached, resume from the latest checkpoint, and finish from Projection.',
    });

    const actions = await readConcurrencyDecisionActions(session.active.page);
    assert.deepEqual(actions.at(-1), uiAction, 'long/background run must record the foreground/background concurrency UIAction');

    const refreshReopen = await runRefreshReopenCase({
      fixture: options.fixture,
      page: session.active.page,
      rounds: [
        { id: 'start-long-run', prompt: 'Start long foreground task.' },
        { id: 'background-checkpoint', prompt: 'Background checkpoint is available before refresh.' },
        { id: 'clarification-terminal', prompt: 'Apply clarification and finish terminal Projection.' },
      ],
      async sendRound(context) {
        if (context.round.id === 'clarification-terminal') {
          await options.submitClarification({ session, page: context.page, prompt: context.round.prompt });
        }
      },
      async waitForRoundSettled(context) {
        if (context.round.id === 'background-checkpoint') {
          await options.waitForBackgroundCheckpoint({ session, projection: concurrencyProjection });
        }
      },
      async waitForTerminal() {
        await options.waitForTerminal({ session });
      },
      async reopenSession() {
        return await options.reopenSession({ session, phase: 'terminal-reopen' });
      },
      async readProjectionOnlyRestore(context) {
        return await options.readProjectionOnlyRestore({ session, page: context.page, phase: context.phase });
      },
    });

    const contractInput = buildLongBackgroundRunContractInput(
      options.fixture,
      await options.readBrowserVisibleState(),
    );
    assertWebE2eContract(contractInput);

    return { concurrencyProjection, refreshReopen, contractInput };
  } finally {
    await session.close();
  }
}

export function assertLongBackgroundRunEvidence(
  evidence: LongBackgroundRunEvidence,
  expected: WebE2eExpectedProjection,
  concurrencyProjection: MultiTabProjectionSnapshot,
): void {
  assert.equal(evidence.foregroundRun.id, expected.runId, 'foreground active run must be the expected run');
  assert.equal(concurrencyProjection.activeRun?.id, expected.runId, 'Projection activeRun must stay foreground');
  assert.ok(
    ['attach-background-to-foreground', 'wait-for-foreground-attach-background', 'keep-current-active-run-and-background-peer-runs'].includes(
      evidence.concurrencyDecision,
    ),
    `unsupported foreground/background concurrency decision: ${evidence.concurrencyDecision}`,
  );
  assert.ok(evidence.backgroundRuns.length > 0, 'long/background run must track at least one background run');
  assert.deepEqual(concurrencyProjection.backgroundRuns, evidence.backgroundRuns, 'backgroundRuns must match Projection snapshot');

  const backgroundState = evidence.terminalProjection.backgroundState;
  assert.equal(backgroundState?.status, 'completed', 'terminal Projection must record completed background state');
  assert.deepEqual(
    backgroundState?.checkpointRefs,
    evidence.cursorResume.checkpointRefs,
    'terminal Projection checkpoint refs must match cursor resume evidence',
  );
  assert.ok(
    evidence.cursorResume.checkpointRefs.includes(evidence.cursorResume.resumedFromCheckpointRef),
    'cursor resume must name one of the recorded checkpoint refs',
  );
  assert.ok(
    evidence.cursorResume.producerSeqAfterRefresh > evidence.cursorResume.producerSeqBeforeRefresh,
    'cursor resume must advance producerSeq after refresh',
  );
  assert.notEqual(
    evidence.cursorResume.cursorAfterRefresh,
    evidence.cursorResume.cursorBeforeRefresh,
    'cursor resume must advance cursor after refresh',
  );

  assert.equal(evidence.terminalProjection.visibleAnswer?.status, 'satisfied', 'Projection terminal state must be satisfied');
  assert.equal(
    evidence.terminalProjection.visibleAnswer?.text,
    expected.conversationProjection.visibleAnswer?.text,
    'terminal visible answer must come from expected Projection',
  );
}

function buildLongBackgroundRunContractInput(
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
