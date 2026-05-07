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
