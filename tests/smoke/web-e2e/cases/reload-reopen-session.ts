import assert from 'node:assert/strict';

import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
} from '../contract-verifier.js';
import {
  assertProjectionOnlyRestore,
  runRefreshReopenCase,
  type ProjectionOnlyRestoreEvidence,
  type RefreshReopenPage,
  type RefreshReopenRunResult,
} from '../refresh-reopen-helper.js';
import type { WebE2eExpectedProjection, WebE2eFixtureWorkspace } from '../types.js';

export const reloadReopenSessionCaseId = 'SA-WEB-11';

export interface ReloadReopenSessionRestoreEvidence extends ProjectionOnlyRestoreEvidence {
  activeRun?: {
    id?: string;
    status?: string;
  };
  terminalRun?: {
    id?: string;
    status?: string;
  };
  recoverActions?: readonly string[];
  persistedProjection?: WebE2eExpectedProjection['conversationProjection'];
  rawWrapperFailureVisible?: boolean;
}

export interface RunReloadReopenSessionCaseOptions<TPage extends RefreshReopenPage> {
  fixture: Pick<WebE2eFixtureWorkspace, 'caseId' | 'sessionId' | 'scenarioId' | 'runId' | 'expectedProjection' | 'workspaceState'>;
  page: TPage;
  sendPrompt(context: { page: TPage; prompt: string; roundNumber: number }): Promise<void>;
  waitForRoundSettled?(context: { page: TPage; roundNumber: number }): Promise<void>;
  waitForTerminal?(context: { page: TPage }): Promise<void>;
  reopenSession(context: { page: TPage; sessionId: string }): Promise<TPage>;
  readProjectionOnlyRestore(context: {
    page: TPage;
    phase: 'after-round-refresh' | 'terminal-reopen';
  }): Promise<ReloadReopenSessionRestoreEvidence>;
  readBrowserVisibleState(): Promise<WebE2eBrowserVisibleState>;
}

export interface ReloadReopenSessionCaseResult {
  refreshReopen: RefreshReopenRunResult;
  contractInput: WebE2eContractVerifierInput;
  terminalRestore: ReloadReopenSessionRestoreEvidence;
}

export async function runReloadReopenSessionCase<TPage extends RefreshReopenPage>(
  options: RunReloadReopenSessionCaseOptions<TPage>,
): Promise<ReloadReopenSessionCaseResult> {
  const refreshReopen = await runRefreshReopenCase({
    fixture: options.fixture,
    page: options.page,
    rounds: [
      { id: 'fresh-turn', prompt: 'Start the research answer from the current user turn.' },
      { id: 'follow-up', prompt: 'Continue with the selected artifact refs, then refresh.' },
      { id: 'terminal', prompt: 'Finish the terminal answer from persisted Projection.' },
    ],
    async sendRound(context) {
      await options.sendPrompt({
        page: context.page,
        prompt: context.round.prompt,
        roundNumber: context.roundNumber,
      });
    },
    async waitForRoundSettled(context) {
      await options.waitForRoundSettled?.({ page: context.page, roundNumber: context.roundNumber });
    },
    async waitForTerminal(context) {
      await options.waitForTerminal?.({ page: context.page });
    },
    async reopenSession(context) {
      return await options.reopenSession({ page: context.page, sessionId: context.sessionId });
    },
    async readProjectionOnlyRestore(context) {
      const evidence = await options.readProjectionOnlyRestore({ page: context.page, phase: context.phase });
      assertReloadReopenProjectionRestore(evidence, options.fixture.expectedProjection, context.phase);
      return evidence;
    },
  });

  const terminalRestore = refreshReopen.restoreChecks.at(-1)?.evidence as ReloadReopenSessionRestoreEvidence | undefined;
  assert.ok(terminalRestore, 'reload/reopen session must record terminal Projection restore evidence');
  assertReloadReopenProjectionRestore(terminalRestore, options.fixture.expectedProjection, 'terminal-reopen');

  const contractInput = buildReloadReopenSessionContractInput(
    options.fixture,
    await options.readBrowserVisibleState(),
  );
  assertWebE2eContract(contractInput);

  return { refreshReopen, contractInput, terminalRestore };
}

export function assertReloadReopenProjectionRestore(
  evidence: ReloadReopenSessionRestoreEvidence,
  expected: WebE2eExpectedProjection,
  label = 'reload/reopen restore',
): void {
  assertProjectionOnlyRestore(evidence, expected, label);

  const projection = expected.conversationProjection;
  const persistedProjection = evidence.persistedProjection;
  assert.ok(persistedProjection, `${label}: restored UI state must expose the persisted ConversationProjection`);
  assert.deepEqual(
    persistedProjection,
    projection,
    `${label}: restored UI state must read the persisted ConversationProjection`,
  );

  assert.deepEqual(
    evidence.visibleAnswer,
    persistedProjection.visibleAnswer,
    `${label}: visible answer must come from persisted Projection`,
  );
  assert.notEqual(
    evidence.rawWrapperFailureVisible,
    true,
    `${label}: stale raw/backend wrapper failure must not be visible after Projection restore`,
  );

  assert.equal(
    evidence.activeRun?.id,
    persistedProjection.activeRun?.id,
    `${label}: active run id must come from persisted Projection`,
  );
  assert.equal(
    evidence.activeRun?.status,
    persistedProjection.activeRun?.status,
    `${label}: active run status must come from persisted Projection`,
  );
  assert.equal(
    evidence.terminalRun?.id,
    expected.runId,
    `${label}: terminal run id must come from persisted Projection`,
  );
  assert.equal(
    evidence.terminalRun?.status,
    persistedProjection.visibleAnswer?.status,
    `${label}: terminal run status must come from persisted Projection visible answer`,
  );
  assert.deepEqual(
    evidence.recoverActions ?? [],
    persistedProjection.recoverActions,
    `${label}: recover actions must come from persisted Projection`,
  );
}

export function browserVisibleStateFromReloadReopenProjection(
  expected: WebE2eExpectedProjection,
): WebE2eBrowserVisibleState {
  const answer = expected.conversationProjection.visibleAnswer;
  return {
    status: answer?.status,
    visibleAnswerText: answer?.text,
    visibleArtifactRefs: [
      ...expected.artifactDelivery.primaryArtifactRefs,
      ...expected.artifactDelivery.supportingArtifactRefs,
    ],
    primaryArtifactRefs: expected.artifactDelivery.primaryArtifactRefs,
    supportingArtifactRefs: expected.artifactDelivery.supportingArtifactRefs,
    auditRefs: [],
    diagnosticRefs: [],
    internalRefs: [],
    recoverActions: expected.conversationProjection.recoverActions,
    nextStep: expected.conversationProjection.recoverActions[0],
  };
}

function buildReloadReopenSessionContractInput(
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
