import assert from 'node:assert/strict';

import type { SciForgeRun, SciForgeSession } from '@sciforge-ui/runtime-contract';
import type { ConversationProjection } from '../../../../src/runtime/conversation-kernel/index.js';
import {
  artifactDeliveryManifestFromSession,
  assertWebE2eContract,
  runAuditFromSession,
  verifyWebE2eContract,
  type WebE2eBrowserVisibleState,
  type WebE2eContractVerifierInput,
} from '../contract-verifier.js';
import { buildWebE2eFixtureWorkspace } from '../fixture-workspace-builder.js';
import type { WebE2eExpectedProjection, WebE2eFixtureWorkspace } from '../types.js';

export const NO_LEGACY_UI_FALLBACK_CASE_ID = 'SA-WEB-14-no-legacy-ui-fallback';

export const legacyRawTerminalText =
  'LEGACY RAW TERMINAL RESULT: completed report text that must never render in the main result.';
export const projectionWaitingText =
  '主结果等待 ConversationProjection；历史 raw 结果需迁移后才能展示。';

export interface NoLegacyUiFallbackCaseResult {
  fixture: WebE2eFixtureWorkspace;
  legacySession: SciForgeSession;
  verifierInput: WebE2eContractVerifierInput;
  auditDebugState: NoLegacyUiFallbackAuditDebugState;
}

export interface NoLegacyUiFallbackAuditDebugState {
  runId: string;
  rawResultPresentationText?: string;
  rawResponseText?: string;
  auditRefs: string[];
}

export interface NoLegacyUiFallbackVerificationResult {
  ok: boolean;
  failures: string[];
}

export async function buildNoLegacyUiFallbackCase(): Promise<NoLegacyUiFallbackCaseResult> {
  const fixture = await buildWebE2eFixtureWorkspace({
    caseId: NO_LEGACY_UI_FALLBACK_CASE_ID,
    now: '2026-05-16T00:00:00.000Z',
    title: 'No legacy UI fallback Web E2E case',
    prompt: 'Open a historical session that has raw run and legacy resultPresentation, but no ConversationProjection.',
  });
  const legacySession = buildProjectionlessLegacySession(fixture);
  const expected = buildMigrationExpectedProjection(fixture);
  const migratedSession = sessionWithMigrationProjection(legacySession, expected.conversationProjection);
  const verifierInput = verifierInputForMigrationState(fixture, expected, migratedSession);
  const auditDebugState = auditDebugStateFromLegacySession(legacySession, fixture.runId, expected.runAuditRefs);

  assertProjectionlessLegacySession(legacySession, fixture.runId);
  assertWebE2eContract(verifierInput);

  return { fixture, legacySession, verifierInput, auditDebugState };
}

export function verifyNoLegacyUiFallbackCase(result: NoLegacyUiFallbackCaseResult): NoLegacyUiFallbackVerificationResult {
  const failures = [...verifyWebE2eContract(result.verifierInput).failures];
  collectProjectionlessLegacySessionFailures(result.legacySession, result.fixture.runId, failures);
  collectNoLegacyMainResultFailures(result.verifierInput.browserVisibleState, result.auditDebugState, failures);
  collectAuditDebugFailures(result.auditDebugState, result.fixture.runId, failures);
  return { ok: failures.length === 0, failures };
}

export function noLegacyUiFallbackVerifierInput(
  result: NoLegacyUiFallbackCaseResult,
  browserOverrides: Partial<WebE2eBrowserVisibleState> = {},
): WebE2eContractVerifierInput {
  return {
    ...result.verifierInput,
    browserVisibleState: {
      ...result.verifierInput.browserVisibleState,
      ...browserOverrides,
    },
  };
}

function buildProjectionlessLegacySession(fixture: WebE2eFixtureWorkspace): SciForgeSession {
  const session = structuredClone(fixture.workspaceState.sessionsByScenario[fixture.scenarioId]);
  assert.ok(session, `missing fixture session ${fixture.scenarioId}`);
  const run = runForSession(session, fixture.runId);
  run.status = 'completed';
  run.response = legacyRawTerminalText;
  run.raw = {
    status: 'completed',
    failureReason: undefined,
    legacyResponse: legacyRawTerminalText,
    displayIntent: {
      primaryGoal: 'Legacy projectionless result that may only be inspected through audit/debug.',
      resultPresentation: {
        status: 'satisfied',
        text: legacyRawTerminalText,
        artifactRefs: ['artifact:legacy-raw-terminal-report'],
      },
    },
    resultPresentation: {
      status: 'satisfied',
      text: legacyRawTerminalText,
      artifactRefs: ['artifact:legacy-raw-terminal-report'],
    },
  };
  return session;
}

function buildMigrationExpectedProjection(fixture: WebE2eFixtureWorkspace): WebE2eExpectedProjection {
  const expected = structuredClone(fixture.expectedProjection);
  expected.conversationProjection = migrationProjection(fixture);
  expected.artifactDelivery = {
    primaryArtifactRefs: [],
    supportingArtifactRefs: [],
    auditRefs: [...fixture.expectedProjection.artifactDelivery.auditRefs],
    diagnosticRefs: [...fixture.expectedProjection.artifactDelivery.diagnosticRefs],
    internalRefs: [...fixture.expectedProjection.artifactDelivery.internalRefs],
  };
  return expected;
}

function migrationProjection(fixture: WebE2eFixtureWorkspace): ConversationProjection {
  return {
    schemaVersion: 'sciforge.conversation-projection.v1',
    conversationId: fixture.sessionId,
    currentTurn: {
      id: fixture.expectedProjection.currentTask.currentTurnRef.ref,
      prompt: 'Historical session requires Projection migration before terminal rendering.',
    },
    visibleAnswer: {
      status: 'needs-human',
      text: projectionWaitingText,
      artifactRefs: [],
      diagnostic: 'missing-conversation-projection',
    },
    activeRun: {
      id: fixture.runId,
      status: 'needs-human',
    },
    artifacts: [],
    executionProcess: [{
      eventId: 'event-sa-web-14-missing-projection',
      type: 'NeedsHuman',
      summary: 'Legacy raw run/resultPresentation was quarantined to audit/debug because no ConversationProjection exists.',
      timestamp: '2026-05-16T00:00:00.000Z',
    }],
    recoverActions: ['migrate-conversation-projection', 'open-audit-debug'],
    verificationState: {
      status: 'unverified',
      verdict: 'needs-human',
    },
    auditRefs: [
      'run:legacy-raw-terminal-run',
      'artifact:fixture-run-audit',
      'artifact:fixture-diagnostic-log',
    ],
    diagnostics: [{
      severity: 'warning',
      code: 'missing-conversation-projection',
      message: 'Historical session has only raw legacy resultPresentation; main UI must wait for migration.',
      refs: [{ ref: 'run:legacy-raw-terminal-run' }, { ref: 'artifact:fixture-run-audit' }],
    }],
  };
}

function sessionWithMigrationProjection(session: SciForgeSession, projection: ConversationProjection): SciForgeSession {
  const next = structuredClone(session);
  const run = runForSession(next, projection.activeRun?.id ?? '');
  run.status = 'completed';
  run.response = projection.visibleAnswer?.text ?? '';
  const raw = isRecord(run.raw) ? run.raw : {};
  run.raw = {
    ...raw,
    displayIntent: {
      migrationState: 'missing-conversation-projection',
      conversationProjection: projection,
    },
    resultPresentation: {
      conversationProjection: projection,
    },
  };
  next.artifacts = next.artifacts.filter((artifact) => {
    const role = artifact.delivery?.role;
    return role !== 'primary-deliverable' && role !== 'supporting-evidence';
  });
  return next;
}

function verifierInputForMigrationState(
  fixture: WebE2eFixtureWorkspace,
  expected: WebE2eExpectedProjection,
  session: SciForgeSession,
): WebE2eContractVerifierInput {
  return {
    caseId: fixture.caseId,
    expected,
    browserVisibleState: {
      status: 'needs-human',
      visibleAnswerText: projectionWaitingText,
      visibleArtifactRefs: [],
      primaryArtifactRefs: [],
      supportingArtifactRefs: [],
      auditRefs: [],
      diagnosticRefs: [],
      internalRefs: [],
      recoverActions: expected.conversationProjection.recoverActions,
      nextStep: expected.conversationProjection.recoverActions[0],
    },
    kernelProjection: expected.conversationProjection,
    sessionBundle: { session, workspaceState: fixture.workspaceState },
    runAudit: runAuditFromSession(session, expected),
    artifactDeliveryManifest: artifactDeliveryManifestFromSession(session, expected),
  };
}

function auditDebugStateFromLegacySession(
  session: SciForgeSession,
  runId: string,
  runAuditRefs: string[],
): NoLegacyUiFallbackAuditDebugState {
  const run = runForSession(session, runId);
  const raw = isRecord(run.raw) ? run.raw : {};
  const resultPresentation = isRecord(raw.resultPresentation) ? raw.resultPresentation : {};
  return {
    runId,
    rawResultPresentationText: typeof resultPresentation.text === 'string' ? resultPresentation.text : undefined,
    rawResponseText: typeof run.response === 'string' ? run.response : undefined,
    auditRefs: [...runAuditRefs, `run:${runId}`],
  };
}

function collectProjectionlessLegacySessionFailures(session: SciForgeSession, runId: string, failures: string[]): void {
  const run = runForSession(session, runId);
  if (!isRecord(run.raw)) {
    failures.push('legacy session must keep raw run data for audit/debug inspection');
    return;
  }
  if (containsConversationProjection(run.raw)) {
    failures.push('legacy historical session must not contain ConversationProjection');
  }
}

function collectNoLegacyMainResultFailures(
  browser: WebE2eBrowserVisibleState,
  auditDebug: NoLegacyUiFallbackAuditDebugState,
  failures: string[],
): void {
  if (browser.status !== 'needs-human') {
    failures.push('main result must show needs-human/waiting state when ConversationProjection is missing');
  }
  if (!browser.visibleAnswerText?.includes('等待 ConversationProjection')) {
    failures.push('main result must explain that ConversationProjection is missing or waiting for migration');
  }
  const visiblePayload = JSON.stringify(browser);
  for (const rawText of [auditDebug.rawResultPresentationText, auditDebug.rawResponseText]) {
    if (rawText && visiblePayload.includes(rawText)) {
      failures.push('legacy raw resultPresentation text leaked into the main browser result');
    }
  }
}

function collectAuditDebugFailures(
  auditDebug: NoLegacyUiFallbackAuditDebugState,
  runId: string,
  failures: string[],
): void {
  if (auditDebug.rawResultPresentationText !== legacyRawTerminalText) {
    failures.push('audit/debug state must retain legacy resultPresentation text');
  }
  if (auditDebug.rawResponseText !== legacyRawTerminalText) {
    failures.push('audit/debug state must retain raw run response text');
  }
  if (!auditDebug.auditRefs.includes(`run:${runId}`)) {
    failures.push('audit/debug state must include the legacy raw run ref');
  }
}

function assertProjectionlessLegacySession(session: SciForgeSession, runId: string): void {
  const failures: string[] = [];
  collectProjectionlessLegacySessionFailures(session, runId, failures);
  assert.deepEqual(failures, []);
}

function containsConversationProjection(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.schemaVersion === 'sciforge.conversation-projection.v1') return true;
  for (const child of Object.values(value)) {
    if (Array.isArray(child)) {
      if (child.some(containsConversationProjection)) return true;
    } else if (containsConversationProjection(child)) {
      return true;
    }
  }
  return false;
}

function runForSession(session: SciForgeSession, runId: string): SciForgeRun {
  const run = session.runs.find((candidate) => candidate.id === runId);
  assert.ok(run, `missing run ${runId}`);
  return run;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}
