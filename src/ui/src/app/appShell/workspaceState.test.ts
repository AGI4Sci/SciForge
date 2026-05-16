import assert from 'node:assert/strict';
import test from 'node:test';
import type { SciForgeSession, SciForgeWorkspaceState, TimelineEventRecord } from '../../domain';
import { sessionWriteConflictsForState, withSessionWriteGuard } from '../../sessionStore';
import { appendTimelineEventToWorkspace, applySessionUpdateToWorkspace, recoverableRunFocusForSession, touchWorkspaceUpdatedAt, tryApplySessionUpdateToWorkspace, workspaceRecoveryFocusForState } from './workspaceState';
import { conversationProjectionMigrationAuditFixtureForRun } from '../conversation-projection-view-model';

function session(runs: SciForgeSession['runs'] = []): SciForgeSession {
  const value = {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: 'scenario-any',
    title: 'Session',
    createdAt: '2026-05-07T00:00:00.000Z',
    messages: [],
    runs,
    uiManifest: [],
    claims: [{
      id: 'claim-1',
      text: 'claim',
      type: 'fact',
      confidence: 0.9,
      evidenceLevel: 'experimental',
      supportingRefs: [],
      opposingRefs: [],
      updatedAt: '2026-05-07T00:00:00.000Z',
    }],
    executionUnits: [{ id: 'unit-1', tool: 'tool', params: '{}', status: 'done', hash: 'hash' }],
    artifacts: [{ id: 'artifact-1', type: 'markdown', producerScenario: 'scenario-any', schemaVersion: '1' }],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
    updatedAt: '2026-05-07T00:00:00.000Z',
  } as SciForgeSession;
  const projections = Object.fromEntries(value.runs.flatMap((run) => {
    const projection = conversationProjectionMigrationAuditFixtureForRun(run);
    return projection ? [[run.id, projection]] : [];
  }));
  return Object.keys(projections).length ? { ...value, materializedConversationProjections: projections } as SciForgeSession : value;
}

function workspace(active = session()): SciForgeWorkspaceState {
  return {
    schemaVersion: 2,
    workspacePath: '/tmp/workspace',
    sessionsByScenario: { [active.scenarioId]: active } as unknown as SciForgeWorkspaceState['sessionsByScenario'],
    archivedSessions: [],
    alignmentContracts: [],
    feedbackComments: [],
    feedbackRequests: [],
    githubSyncedOpenIssues: [],
    updatedAt: '2026-05-07T00:00:00.000Z',
  };
}

test('touches workspace updatedAt without changing nested state', () => {
  const state = workspace();
  const next = touchWorkspaceUpdatedAt(state, '2026-05-07T01:00:00.000Z');

  assert.equal(next.updatedAt, '2026-05-07T01:00:00.000Z');
  assert.equal(next.sessionsByScenario, state.sessionsByScenario);
});

test('applies session updates with versioning and run timeline merge', () => {
  const nextRun = {
    id: 'run-1',
    scenarioId: 'scenario-any',
    status: 'completed' as const,
    prompt: 'Summarize result',
    response: 'ok',
    createdAt: '2026-05-07T01:00:00.000Z',
    completedAt: '2026-05-07T01:01:00.000Z',
  };
  const next = applySessionUpdateToWorkspace(workspace(), session([nextRun]), 'test update');

  assert.equal(next.sessionsByScenario['scenario-any'].versions.at(-1)?.reason, 'test update');
  assert.equal(next.timelineEvents?.[0].id, 'timeline-run-1');
  assert.equal(next.timelineEvents?.[0].artifactRefs[0], 'artifact-1');
  assert.equal(next.timelineEvents?.[0].executionUnitRefs[0], 'unit-1');
});

test('detects stale base session updates without overwriting current workspace session', () => {
  const baseSession = withSessionWriteGuard(session());
  const current = applySessionUpdateToWorkspace(workspace(baseSession), {
    ...baseSession,
    messages: [{
      id: 'msg-current',
      role: 'user',
      content: 'current writer',
      createdAt: '2026-05-07T01:00:00.000Z',
    }],
  }, 'current writer');
  const staleRun = {
    id: 'run-stale',
    scenarioId: 'scenario-any',
    status: 'completed' as const,
    prompt: 'stale run',
    response: 'late',
    createdAt: '2026-05-07T01:01:00.000Z',
  };
  const result = tryApplySessionUpdateToWorkspace(current, {
    ...baseSession,
    runs: [staleRun],
  }, 'late writer');

  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.kind, 'stale-base-revision');
  assert.deepEqual(result.diagnostic.conflictingFields, []);
  assert.equal(result.state.sessionsByScenario['scenario-any'].messages[0]?.content, 'current writer');
  assert.equal(result.state.sessionsByScenario['scenario-any'].runs.length, 0);
  assert.equal(sessionWriteConflictsForState(result.state)[0]?.reason, 'late writer');
});

test('detects same-collection ordering conflicts as recoverable diagnostics', () => {
  const baseSession = withSessionWriteGuard(session());
  const runA = {
    id: 'run-a',
    scenarioId: 'scenario-any',
    status: 'completed' as const,
    prompt: 'first run',
    response: 'A',
    createdAt: '2026-05-07T01:00:00.000Z',
  };
  const runB = {
    id: 'run-b',
    scenarioId: 'scenario-any',
    status: 'completed' as const,
    prompt: 'second run',
    response: 'B',
    createdAt: '2026-05-07T01:01:00.000Z',
  };
  const current = applySessionUpdateToWorkspace(workspace(baseSession), {
    ...baseSession,
    runs: [runA],
  }, 'first writer');
  const result = tryApplySessionUpdateToWorkspace(current, {
    ...baseSession,
    runs: [runB],
  }, 'second writer');

  assert.equal(result.ok, false);
  assert.equal(result.diagnostic.kind, 'ordering-conflict');
  assert.deepEqual(result.diagnostic.conflictingFields, ['runs']);
  assert.deepEqual(result.state.sessionsByScenario['scenario-any'].runs.map((run) => run.id), ['run-a']);
  assert.equal(sessionWriteConflictsForState(result.state)[0]?.recoverable, true);
});

test('run timeline counts only execution units, not skill or ui plan refs', () => {
  const nextRun = {
    id: 'run-1',
    scenarioId: 'scenario-any',
    status: 'completed' as const,
    prompt: 'Summarize result',
    response: 'ok',
    createdAt: '2026-05-07T01:00:00.000Z',
    completedAt: '2026-05-07T01:01:00.000Z',
    skillPlanRef: 'skill-plan.any.default',
    uiPlanRef: 'ui-plan.any.default',
    scenarioPackageRef: { id: 'pkg-any', version: '1.0.0', source: 'workspace' as const },
  };
  const nextSession = {
    ...session([nextRun]),
    executionUnits: [
      { id: 'unit-match', tool: 'tool', params: '{}', status: 'done' as const, hash: 'hash', scenarioPackageRef: { id: 'pkg-any', version: '1.0.0', source: 'workspace' as const } },
      { id: 'unit-other', tool: 'tool', params: '{}', status: 'done' as const, hash: 'hash', scenarioPackageRef: { id: 'other', version: '1.0.0', source: 'workspace' as const } },
    ],
  };
  const next = applySessionUpdateToWorkspace(workspace(), nextSession, 'test update');

  assert.deepEqual(next.timelineEvents?.[0].executionUnitRefs, ['unit-match']);
});

test('run timeline includes failed execution units from the failed run payload', () => {
  const failedRun = {
    id: 'run-failed-payload',
    scenarioId: 'scenario-any',
    status: 'failed' as const,
    prompt: 'Probe failing page',
    response: 'failed-with-reason',
    createdAt: '2026-05-07T01:00:00.000Z',
    completedAt: '2026-05-07T01:01:00.000Z',
    raw: {
      payload: {
        executionUnits: [{
          id: 'EU-failed-payload',
          tool: 'web.probe',
          params: '{}',
          status: 'failed-with-reason' as const,
          hash: 'failed-payload',
          failureReason: 'probe failed before rendering',
        }],
      },
    },
  };
  const nextSession = { ...session([failedRun]), executionUnits: [], artifacts: [] };
  const next = applySessionUpdateToWorkspace(workspace(), nextSession, 'failed update');

  assert.deepEqual(next.timelineEvents?.[0].executionUnitRefs, ['EU-failed-payload']);
});

test('recoverable focus selects projection-level repair-needed run and ignores timeline-only or raw history', () => {
  const oldFailedSession = session([{
    id: 'run-old-failed',
    scenarioId: 'scenario-any',
    status: 'failed',
    prompt: 'old failed',
    response: 'timeout',
    createdAt: '2026-05-07T01:00:00.000Z',
    completedAt: '2026-05-07T01:02:00.000Z',
  }]);
  const rawRepairSession = {
    ...session([{
      id: 'run-raw-repair-needed',
      scenarioId: 'scenario-raw-repair',
      status: 'completed' as const,
      prompt: 'raw repair',
      response: 'partial',
      createdAt: '2026-05-07T03:00:00.000Z',
      completedAt: '2026-05-07T03:02:00.000Z',
    }]),
    sessionId: 'session-raw-repair',
    scenarioId: 'scenario-raw-repair',
    executionUnits: [{
      id: 'unit-raw-repair',
      tool: 'validator',
      params: '{}',
      status: 'repair-needed' as const,
      hash: 'repair',
      outputRef: 'run:run-raw-repair-needed/result.json',
      failureReason: 'legacy raw repair state remains audit-only',
      recoverActions: ['resume failed run with existing refs'],
    }],
  };
  const recentRepairSession = {
    ...session([{
      id: 'run-repair-needed',
      scenarioId: 'scenario-repair',
      status: 'completed' as const,
      prompt: 'recent repair',
      response: 'partial',
      createdAt: '2026-05-07T02:00:00.000Z',
      completedAt: '2026-05-07T02:02:00.000Z',
      raw: {
        resultPresentation: {
          conversationProjection: {
            schemaVersion: 'sciforge.conversation-projection.v1',
            conversationId: 'conversation-repair',
            visibleAnswer: { status: 'satisfied', text: 'Partial result is available.', artifactRefs: [] },
            activeRun: { id: 'run-repair-needed', status: 'repair-needed' },
            artifacts: [],
            executionProcess: [],
            recoverActions: [],
            verificationState: { status: 'unverified' },
            auditRefs: ['audit:projection-repair'],
            diagnostics: [],
          },
        },
      },
    }]),
    sessionId: 'session-repair',
    scenarioId: 'scenario-repair',
    materializedConversationProjection: {
      schemaVersion: 'sciforge.conversation-projection.v1',
      conversationId: 'conversation-repair',
      visibleAnswer: { status: 'satisfied', text: 'Partial result is available.', artifactRefs: [] },
      activeRun: { id: 'run-repair-needed', status: 'repair-needed' },
      artifacts: [],
      executionProcess: [],
      recoverActions: [],
      verificationState: { status: 'unverified' },
      auditRefs: ['audit:projection-repair'],
      diagnostics: [],
    },
  };
  const state = {
    ...workspace(oldFailedSession),
    sessionsByScenario: {
      [oldFailedSession.scenarioId]: oldFailedSession,
      [rawRepairSession.scenarioId]: rawRepairSession,
      [recentRepairSession.scenarioId]: recentRepairSession,
    } as SciForgeWorkspaceState['sessionsByScenario'],
    timelineEvents: [{
      id: 'timeline-only-failed',
      actor: 'runtime',
      action: 'run.failed',
      subject: 'timeline-only',
      artifactRefs: [],
      executionUnitRefs: [],
      beliefRefs: [],
      visibility: 'project-record' as const,
      decisionStatus: 'not-a-decision' as const,
      createdAt: '2026-05-07T03:00:00.000Z',
    }],
  };

  assert.equal(recoverableRunFocusForSession(oldFailedSession), undefined);
  assert.equal(recoverableRunFocusForSession(rawRepairSession), undefined);
  assert.equal(recoverableRunFocusForSession(recentRepairSession)?.activeRunId, 'run-repair-needed');
  assert.deepEqual(workspaceRecoveryFocusForState(state), {
    scenarioId: 'scenario-repair',
    sessionId: 'session-repair',
    activeRunId: 'run-repair-needed',
    reason: 'repair-needed-run',
    updatedAt: '2026-05-07T02:02:00.000Z',
  });
  assert.equal(workspaceRecoveryFocusForState({
    ...workspace(),
    sessionsByScenario: {} as SciForgeWorkspaceState['sessionsByScenario'],
    timelineEvents: state.timelineEvents,
  }), undefined);
});

test('recoverable focus does not steal focus from newer healthy workspace activity', () => {
  const repairSession = {
    ...session([{
      id: 'run-repair-needed',
      scenarioId: 'scenario-repair',
      status: 'failed' as const,
      prompt: 'old failed run',
      response: 'repair needed',
      createdAt: '2026-05-07T02:00:00.000Z',
      completedAt: '2026-05-07T02:02:00.000Z',
    }]),
    sessionId: 'session-repair',
    scenarioId: 'scenario-repair',
    updatedAt: '2026-05-07T02:02:00.000Z',
  };
  const healthySession = {
    ...session([{
      id: 'run-completed',
      scenarioId: 'scenario-healthy',
      status: 'completed' as const,
      prompt: 'new data analysis',
      response: 'done',
      createdAt: '2026-05-07T02:03:00.000Z',
      completedAt: '2026-05-07T02:04:00.000Z',
    }]),
    sessionId: 'session-healthy',
    scenarioId: 'scenario-healthy',
    updatedAt: '2026-05-07T02:04:00.000Z',
  };

  assert.equal(workspaceRecoveryFocusForState({
    ...workspace(repairSession),
    sessionsByScenario: {
      [repairSession.scenarioId]: repairSession,
      [healthySession.scenarioId]: healthySession,
    } as SciForgeWorkspaceState['sessionsByScenario'],
  }), undefined);
});

test('recoverable focus follows conversation projection before raw run status', () => {
  const projectedSatisfied = {
    ...session([{
    id: 'run-projected-satisfied',
    scenarioId: 'scenario-any',
    status: 'failed' as const,
    prompt: 'legacy failed but projected satisfied',
    response: 'legacy failure',
    createdAt: '2026-05-07T01:00:00.000Z',
    raw: {
      resultPresentation: {
        conversationProjection: {
          schemaVersion: 'sciforge.conversation-projection.v1',
          conversationId: 'conversation-projected-satisfied',
          visibleAnswer: { status: 'satisfied', text: 'Done.', artifactRefs: [] },
          artifacts: [],
          executionProcess: [],
          recoverActions: [],
          verificationState: { status: 'not-required' },
          auditRefs: [],
          diagnostics: [],
        },
      },
    },
    }]),
    materializedConversationProjection: {
      schemaVersion: 'sciforge.conversation-projection.v1',
      conversationId: 'conversation-projected-satisfied',
      visibleAnswer: { status: 'satisfied', text: 'Done.', artifactRefs: [] },
      artifacts: [],
      executionProcess: [],
      recoverActions: [],
      verificationState: { status: 'not-required' },
      auditRefs: [],
      diagnostics: [],
    },
  } as SciForgeSession;
  const projectedRepair = {
    ...session([{
    id: 'run-projected-repair',
    scenarioId: 'scenario-any',
    status: 'completed' as const,
    prompt: 'projected repair',
    response: 'legacy complete',
    createdAt: '2026-05-07T02:00:00.000Z',
    raw: {
      resultPresentation: {
        conversationProjection: {
          schemaVersion: 'sciforge.conversation-projection.v1',
          conversationId: 'conversation-projected-repair',
          visibleAnswer: { status: 'repair-needed', diagnostic: 'repair from projection', artifactRefs: [] },
          artifacts: [],
          executionProcess: [],
          recoverActions: ['continue from projection refs'],
          verificationState: { status: 'failed' },
          auditRefs: ['audit:projection'],
          diagnostics: [],
        },
      },
    },
    }]),
    materializedConversationProjection: {
      schemaVersion: 'sciforge.conversation-projection.v1',
      conversationId: 'conversation-projected-repair',
      visibleAnswer: { status: 'repair-needed', diagnostic: 'repair from projection', artifactRefs: [] },
      artifacts: [],
      executionProcess: [],
      recoverActions: ['continue from projection refs'],
      verificationState: { status: 'failed' },
      auditRefs: ['audit:projection'],
      diagnostics: [],
    },
  } as SciForgeSession;

  assert.equal(recoverableRunFocusForSession(projectedSatisfied), undefined);
  assert.equal(recoverableRunFocusForSession(projectedRepair)?.activeRunId, 'run-projected-repair');
  assert.equal(recoverableRunFocusForSession(projectedRepair)?.reason, 'repair-needed-run');
});

test('recoverable focus does not restore stale partial run after newer satisfied run in same session', () => {
  const stalePartialRun = {
    id: 'run-stale-partial',
    scenarioId: 'scenario-any',
    status: 'completed' as const,
    prompt: 'old selected report follow-up',
    response: 'partial',
    createdAt: '2026-05-07T02:00:00.000Z',
    raw: {
      resultPresentation: {
        conversationProjection: {
          schemaVersion: 'sciforge.conversation-projection.v1',
          conversationId: 'conversation-stale-partial',
          visibleAnswer: { status: 'degraded-result', diagnostic: 'old partial result', artifactRefs: [] },
          activeRun: { id: 'run-stale-partial', status: 'degraded-result' },
          artifacts: [],
          executionProcess: [],
          recoverActions: ['rerun required verifier'],
          verificationState: { status: 'required' },
          auditRefs: [],
          diagnostics: [],
        },
      },
    },
  };
  const newerSatisfiedRun = {
    id: 'run-newer-satisfied',
    scenarioId: 'scenario-any',
    status: 'completed' as const,
    prompt: 'new selected report follow-up',
    response: 'answered',
    createdAt: '2026-05-07T02:05:00.000Z',
    raw: {
      resultPresentation: {
        conversationProjection: {
          schemaVersion: 'sciforge.conversation-projection.v1',
          conversationId: 'conversation-newer-satisfied',
          visibleAnswer: { status: 'satisfied', text: 'Answered latest user intent.', artifactRefs: [] },
          activeRun: { id: 'run-newer-satisfied', status: 'satisfied' },
          artifacts: [],
          executionProcess: [],
          recoverActions: [],
          verificationState: { status: 'not-required' },
          auditRefs: [],
          diagnostics: [],
        },
      },
    },
  };
  const projectedSession = session([stalePartialRun, newerSatisfiedRun] as never);

  assert.equal(recoverableRunFocusForSession(projectedSession), undefined);
});

test('recoverable focus can be driven by projection verification and background state', () => {
  const projectedVerification = {
    ...session([{
    id: 'run-projected-verification',
    scenarioId: 'scenario-any',
    status: 'completed' as const,
    prompt: 'projected verification',
    response: 'legacy complete',
    createdAt: '2026-05-07T01:00:00.000Z',
    raw: {
      resultPresentation: {
        conversationProjection: {
          schemaVersion: 'sciforge.conversation-projection.v1',
          conversationId: 'conversation-projected-verification',
          visibleAnswer: { status: 'satisfied', text: 'Visible result is ready.', artifactRefs: [] },
          activeRun: { id: 'run:run-projected-verification', status: 'satisfied' },
          artifacts: [],
          executionProcess: [],
          recoverActions: [],
          verificationState: { status: 'failed', verifierRef: 'verification:projection' },
          auditRefs: [],
          diagnostics: [],
        },
      },
    },
    }]),
    materializedConversationProjection: {
      schemaVersion: 'sciforge.conversation-projection.v1',
      conversationId: 'conversation-projected-verification',
      visibleAnswer: { status: 'satisfied', text: 'Visible result is ready.', artifactRefs: [] },
      activeRun: { id: 'run:run-projected-verification', status: 'satisfied' },
      artifacts: [],
      executionProcess: [],
      recoverActions: [],
      verificationState: { status: 'failed', verifierRef: 'verification:projection' },
      auditRefs: [],
      diagnostics: [],
    },
  } as SciForgeSession;
  const projectedBackground = {
    ...session([{
    id: 'run-projected-background',
    scenarioId: 'scenario-any',
    status: 'completed' as const,
    prompt: 'projected background',
    response: 'legacy complete',
    createdAt: '2026-05-07T02:00:00.000Z',
    raw: {
      displayIntent: {
        conversationProjection: {
          schemaVersion: 'sciforge.conversation-projection.v1',
          conversationId: 'conversation-projected-background',
          visibleAnswer: { status: 'satisfied', text: 'Foreground partial is ready.', artifactRefs: [] },
          activeRun: { id: 'run-projected-background', status: 'satisfied' },
          artifacts: [],
          executionProcess: [],
          recoverActions: [],
          verificationState: { status: 'unverified' },
          backgroundState: {
            status: 'running',
            checkpointRefs: ['checkpoint:background'],
            revisionPlan: 'Merge the background revision when it completes.',
          },
          auditRefs: [],
          diagnostics: [],
        },
      },
    },
    }]),
    materializedConversationProjection: {
      schemaVersion: 'sciforge.conversation-projection.v1',
      conversationId: 'conversation-projected-background',
      visibleAnswer: { status: 'satisfied', text: 'Foreground partial is ready.', artifactRefs: [] },
      activeRun: { id: 'run-projected-background', status: 'satisfied' },
      artifacts: [],
      executionProcess: [],
      recoverActions: [],
      verificationState: { status: 'unverified' },
      backgroundState: {
        status: 'running',
        checkpointRefs: ['checkpoint:background'],
        revisionPlan: 'Merge the background revision when it completes.',
      },
      auditRefs: [],
      diagnostics: [],
    },
  } as SciForgeSession;

  assert.equal(recoverableRunFocusForSession(projectedVerification)?.activeRunId, 'run-projected-verification');
  assert.equal(recoverableRunFocusForSession(projectedBackground)?.activeRunId, 'run-projected-background');
});

test('run timeline scopes artifact refs to the run that produced them', () => {
  const oldRun = {
    id: 'run-old',
    scenarioId: 'scenario-any',
    status: 'completed' as const,
    prompt: 'old report',
    response: 'ok',
    createdAt: '2026-05-07T01:00:00.000Z',
    objectReferences: [{ kind: 'artifact', ref: 'artifact:old-report', title: 'old report' }],
  };
  const newRun = {
    id: 'run-new',
    scenarioId: 'scenario-any',
    status: 'completed' as const,
    prompt: 'new report',
    response: 'ok',
    createdAt: '2026-05-07T01:05:00.000Z',
    objectReferences: [{ kind: 'artifact', ref: 'artifact:new-report', title: 'new report' }],
  };
  const nextSession = {
    ...session([oldRun, newRun] as never),
    artifacts: [
      { id: 'old-report', type: 'markdown', producerScenario: 'scenario-any', schemaVersion: '1' },
      { id: 'new-report', type: 'markdown', producerScenario: 'scenario-any', schemaVersion: '1' },
    ],
  };
  const next = applySessionUpdateToWorkspace(workspace(), nextSession, 'multi-run update');

  const oldEvent = next.timelineEvents?.find((event) => event.id === 'timeline-run-old');
  const newEvent = next.timelineEvents?.find((event) => event.id === 'timeline-run-new');
  assert.deepEqual(oldEvent?.artifactRefs, ['old-report']);
  assert.deepEqual(newEvent?.artifactRefs, ['new-report']);
});

test('persists background run updates as versioned state and timeline status transitions', () => {
  const runningRun = {
    id: 'run-bg',
    scenarioId: 'scenario-any',
    status: 'running' as const,
    prompt: 'Long task',
    response: 'initial response',
    createdAt: '2026-05-07T01:00:00.000Z',
  };
  const completedRun = {
    ...runningRun,
    status: 'completed' as const,
    response: 'final response',
    completedAt: '2026-05-07T01:05:00.000Z',
  };
  const state = applySessionUpdateToWorkspace(workspace(), session([runningRun]), 'background initial');
  const final = applySessionUpdateToWorkspace(state, session([completedRun]), 'background finalized');

  assert.equal(final.sessionsByScenario['scenario-any'].runs[0].response, 'final response');
  assert.equal(final.sessionsByScenario['scenario-any'].versions.at(-1)?.reason, 'background finalized');
  assert.deepEqual(final.timelineEvents?.slice(0, 2).map((item) => item.id), ['timeline-run-bg-completed', 'timeline-run-bg']);
  assert.equal(final.timelineEvents?.[0].action, 'run.completed');
});

test('appends timeline events newest-first and keeps existing events', () => {
  const event: TimelineEventRecord = {
    id: 'timeline-1',
    actor: 'tester',
    action: 'run.completed',
    subject: 'scenario-any:run-1',
    artifactRefs: [],
    executionUnitRefs: [],
    beliefRefs: [],
    visibility: 'project-record',
    decisionStatus: 'not-a-decision',
    createdAt: '2026-05-07T01:00:00.000Z',
  };
  const state = { ...workspace(), timelineEvents: [{ ...event, id: 'timeline-0' }] };
  const next = appendTimelineEventToWorkspace(state, event);

  assert.deepEqual(next.timelineEvents?.map((item) => item.id), ['timeline-1', 'timeline-0']);
});
