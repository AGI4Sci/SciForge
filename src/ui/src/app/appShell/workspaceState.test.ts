import assert from 'node:assert/strict';
import test from 'node:test';
import type { SciForgeSession, SciForgeWorkspaceState, TimelineEventRecord } from '../../domain';
import { appendTimelineEventToWorkspace, applySessionUpdateToWorkspace, touchWorkspaceUpdatedAt } from './workspaceState';

function session(runs: SciForgeSession['runs'] = []): SciForgeSession {
  return {
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
  };
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
