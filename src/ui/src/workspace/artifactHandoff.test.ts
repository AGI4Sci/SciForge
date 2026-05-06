import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeArtifact, SciForgeSession, SciForgeWorkspaceState } from '../domain';
import { applyArtifactHandoffToWorkspace, buildArtifactHandoffMessage } from './artifactHandoff';

const artifact: RuntimeArtifact = {
  id: 'artifact-1',
  type: 'markdown',
  producerScenario: 'source-scenario',
  schemaVersion: '1',
  data: '# Report',
};

const labels = {
  sourceScenarioName: 'Source Scenario',
  targetScenarioName: 'Target Scenario',
};

function session(id: string, scenarioId = 'target-scenario'): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: id,
    scenarioId,
    title: 'Target session',
    createdAt: '2026-05-07T00:00:00.000Z',
    messages: [],
    runs: [],
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

function workspace(targetSession = session('session-1')): SciForgeWorkspaceState {
  return {
    schemaVersion: 2,
    workspacePath: '/tmp/workspace',
    sessionsByScenario: { [targetSession.scenarioId]: targetSession } as unknown as SciForgeWorkspaceState['sessionsByScenario'],
    archivedSessions: [],
    alignmentContracts: [],
    feedbackComments: [],
    feedbackRequests: [],
    githubSyncedOpenIssues: [],
    updatedAt: '2026-05-07T00:00:00.000Z',
  };
}

test('builds artifact handoff messages from explicit labels', () => {
  const message = buildArtifactHandoffMessage(artifact, labels, {
    now: '2026-05-07T01:00:00.000Z',
    notebookTime: '2026/5/7 09:00:00',
    messageId: 'handoff-message',
  });

  assert.equal(message.id, 'handoff-message');
  assert.equal(message.role, 'user');
  assert.match(message.content, /Source Scenario/);
  assert.match(message.content, /artifact id: artifact-1/);
  assert.match(message.content, /Target Scenario/);
});

test('applies artifact handoff to target session, notebook, and timeline', () => {
  const next = applyArtifactHandoffToWorkspace(workspace(), 'target-scenario', artifact, labels, {
    now: '2026-05-07T01:00:00.000Z',
    notebookTime: '2026/5/7 09:00:00',
    messageId: 'handoff-message',
    noteId: 'note-1',
    timelineId: 'timeline-1',
  });
  const nextSession = next.sessionsByScenario['target-scenario'];

  assert.equal(nextSession.messages.at(-1)?.id, 'handoff-message');
  assert.equal(nextSession.artifacts[0].id, 'artifact-1');
  assert.equal(nextSession.notebook[0].id, 'note-1');
  assert.equal(nextSession.notebook[0].artifactRefs?.[0], 'artifact-1');
  assert.equal(next.timelineEvents?.[0].id, 'timeline-1');
  assert.equal(next.timelineEvents?.[0].subject, 'source-scenario:artifact-1 -> target-scenario');
  assert.equal(next.updatedAt, '2026-05-07T01:00:00.000Z');
});

test('does not duplicate artifacts that already exist in target session', () => {
  const targetSession = {
    ...session('session-1'),
    artifacts: [artifact],
  };
  const next = applyArtifactHandoffToWorkspace(workspace(targetSession), 'target-scenario', artifact, labels, {
    now: '2026-05-07T01:00:00.000Z',
    notebookTime: '2026/5/7 09:00:00',
  });

  assert.equal(next.sessionsByScenario['target-scenario'].artifacts.length, 1);
});
