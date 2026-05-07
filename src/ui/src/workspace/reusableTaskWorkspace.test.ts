import assert from 'node:assert/strict';
import test from 'node:test';
import type { SciForgeSession, SciForgeWorkspaceState } from '../domain';
import { markReusableRunInWorkspace } from './reusableTaskWorkspace';

function session(): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: 'scenario-any',
    title: 'Session',
    createdAt: '2026-05-07T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-1',
      scenarioId: 'scenario-any',
      scenarioPackageRef: { id: 'pkg-1', version: '1.0.0', source: 'workspace' },
      skillPlanRef: 'skill-plan-1',
      uiPlanRef: 'ui-plan-1',
      status: 'completed',
      prompt: 'Reusable prompt',
      response: 'ok',
      createdAt: '2026-05-07T00:00:00.000Z',
    }],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
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

test('marks a run as reusable and records a project timeline event', () => {
  const next = markReusableRunInWorkspace(
    workspace(),
    'scenario-any',
    'run-1',
    '2026-05-07T01:00:00.000Z',
    'timeline-1',
  );

  assert.equal(next.reusableTaskCandidates?.[0].id, 'reusable.pkg-1.run-1');
  assert.equal(next.reusableTaskCandidates?.[0].promotionState, 'candidate');
  assert.equal(next.timelineEvents?.[0].id, 'timeline-1');
  assert.equal(next.timelineEvents?.[0].subject, 'pkg-1:run-1');
  assert.deepEqual(next.timelineEvents?.[0].executionUnitRefs, ['run-1', 'skill-plan-1', 'ui-plan-1']);
});

test('leaves workspace unchanged when the run cannot be found', () => {
  const state = workspace();
  assert.equal(markReusableRunInWorkspace(state, 'scenario-any', 'missing', '2026-05-07T01:00:00.000Z'), state);
});
