import assert from 'node:assert/strict';
import test from 'node:test';
import type { SciForgeSession, SciForgeWorkspaceState } from '../domain';
import { createOptimisticUserTurnSession, requestPayloadForTurn } from '../app/chat/sessionTransforms';
import {
  archiveActiveSession,
  archiveAllActiveSessions,
  clearArchivedSessions,
  deleteActiveChat,
  deleteArchivedSessions,
  deleteSessionMessage,
  editSessionMessage,
  forkActiveSession,
  restoreArchivedSession,
  startNewChat,
} from './sessionWorkspace';

function session(id: string, scenarioId = 'scenario-any', messages = ['hello']): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: id,
    scenarioId,
    title: `Session ${id}`,
    createdAt: '2026-05-07T00:00:00.000Z',
    messages: messages.map((content, index) => ({
      id: `message-${id}-${index}`,
      role: 'user',
      content,
      createdAt: '2026-05-07T00:00:00.000Z',
    })),
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

function workspace(active = session('active'), archived: SciForgeSession[] = []): SciForgeWorkspaceState {
  return {
    schemaVersion: 2,
    workspacePath: '/tmp/workspace',
    sessionsByScenario: sessionsByScenario({ [active.scenarioId]: active }),
    archivedSessions: archived,
    alignmentContracts: [],
    feedbackComments: [],
    feedbackRequests: [],
    githubSyncedOpenIssues: [],
    updatedAt: '2026-05-07T00:00:00.000Z',
  };
}

function sessionsByScenario(items: Record<string, SciForgeSession>): SciForgeWorkspaceState['sessionsByScenario'] {
  return items as unknown as SciForgeWorkspaceState['sessionsByScenario'];
}

test('archives the active session from the sidebar without deleting history', () => {
  const state = workspace();
  const next = archiveActiveSession(state, 'scenario-any', 'active', 'Scenario new chat');

  assert.equal(next.archivedSessions.length, 1);
  assert.equal(next.archivedSessions[0].sessionId, 'active');
  assert.notEqual(next.sessionsByScenario['scenario-any'].sessionId, 'active');
});

test('archives all active sessions that have activity', () => {
  const active = session('active-a', 'scenario-a');
  const quiet = session('quiet-b', 'scenario-b', []);
  quiet.messages = [];
  const state = {
    ...workspace(active),
    sessionsByScenario: sessionsByScenario({
      'scenario-a': active,
      'scenario-b': quiet,
    }),
  };
  const next = archiveAllActiveSessions(state, (scenarioId) => `${scenarioId} 新聊天`);

  assert.equal(next.archivedSessions.length, 1);
  assert.equal(next.archivedSessions[0].sessionId, 'active-a');
  assert.notEqual(next.sessionsByScenario['scenario-a'].sessionId, 'active-a');
});

test('starts a new chat while retaining the previous active session in sidebar history', () => {
  const state = workspace();
  const next = startNewChat(state, 'scenario-any', 'Scenario new chat');

  assert.equal(next.archivedSessions.length, 1);
  assert.equal(next.archivedSessions[0].sessionId, 'active');
  assert.equal(next.archivedSessions[0].archiveState, undefined);
  assert.match(next.archivedSessions[0].versions[0]?.reason ?? '', /retained previous session/);
  assert.equal(next.sessionsByScenario['scenario-any'].title, 'Scenario new chat');
  assert.notEqual(next.sessionsByScenario['scenario-any'].sessionId, 'active');
});

test('forks the active chat into a new active session while retaining the source', () => {
  const state = workspace();
  const next = forkActiveSession(state, 'scenario-any');
  const forked = next.sessionsByScenario['scenario-any'];

  assert.equal(next.archivedSessions.length, 1);
  assert.equal(next.archivedSessions[0].sessionId, 'active');
  assert.match(next.archivedSessions[0].versions[0]?.reason ?? '', /forked chat retained source session/);
  assert.notEqual(forked.sessionId, 'active');
  assert.match(forked.title, /Fork/);
  assert.deepEqual(forked.messages.map((message) => message.content), ['hello']);
  assert.equal(forked.archiveState, undefined);
});

test('first request after new chat does not retain archived repair run context', () => {
  const repairSession = session('repair-session', 'literature-evidence-review', ['summarize paper']);
  repairSession.runs = [{
    id: 'run-bounded-stop',
    scenarioId: 'literature-evidence-review',
    status: 'failed',
    prompt: 'summarize paper',
    response: 'AgentServer repair generation bounded-stop after 60001 total tokens',
    createdAt: '2026-05-07T00:01:00.000Z',
    raw: {
      contextReusePolicy: { mode: 'repair' },
      executionModePlan: { executionMode: 'repair-or-continue-project' },
    },
  }];
  repairSession.executionUnits = [{
    id: 'EU-bounded-stop',
    tool: 'agentserver.repair',
    params: '{}',
    status: 'repair-needed',
    hash: 'bounded-stop',
    failureReason: 'AgentServer repair generation bounded-stop',
    stderrRef: '.sciforge/sessions/repair/logs/bounded-stop.stderr.log',
  }];
  const next = startNewChat(workspace(repairSession), 'literature-evidence-review', 'Literature new chat');
  const freshSession = next.sessionsByScenario['literature-evidence-review'];
  const firstTurn = createOptimisticUserTurnSession({
    baseSession: freshSession,
    prompt: 'fresh unrelated prompt',
    references: [],
  });
  const payload = requestPayloadForTurn(firstTurn.session, firstTurn.userMessage, []);

  assert.equal(next.archivedSessions[0].sessionId, 'repair-session');
  assert.equal(payload.runs.length, 0);
  assert.equal(payload.executionUnits.length, 0);
  assert.deepEqual(payload.messages.map((message) => message.id), [firstTurn.userMessage.id]);
});

test('starts a new chat without archiving an inactive seed-only session', () => {
  const inactive = session('seed-only', 'scenario-any', []);
  inactive.messages = [{
    id: 'seed-scenario-any-0',
    role: 'scenario',
    content: 'Seed prompt',
    createdAt: '2026-05-07T00:00:00.000Z',
  }];
  const state = workspace(inactive);
  const next = startNewChat(state, 'scenario-any', 'Scenario new chat');

  assert.equal(next.archivedSessions.length, 0);
  assert.equal(next.sessionsByScenario['scenario-any'].title, 'Scenario new chat');
  assert.notEqual(next.sessionsByScenario['scenario-any'].sessionId, 'seed-only');
});

test('deletes active chat by archiving a marked copy and removing it from the active list', () => {
  const state = workspace();
  const next = deleteActiveChat(state, 'scenario-any', 'Fallback new chat');

  assert.match(next.archivedSessions[0].title, /已删除/);
  assert.equal(next.archivedSessions[0].archiveState, 'discarded');
  assert.equal(next.sessionsByScenario['scenario-any'], undefined);
});

test('deletes an inactive draft without creating a discarded archived row', () => {
  const state = workspace(session('draft-only', 'scenario-any', []));
  const next = deleteActiveChat(state, 'scenario-any', 'Fallback new chat');

  assert.equal(next.archivedSessions.length, 0);
  assert.equal(next.sessionsByScenario['scenario-any'], undefined);
});

test('archives and deletes retained sidebar history without touching the current draft', () => {
  const retained = startNewChat(workspace(session('active')), 'scenario-any', 'Fallback new chat');
  const retainedId = retained.archivedSessions[0].sessionId;

  const archived = archiveActiveSession(retained, 'scenario-any', retainedId, 'Fallback new chat');
  assert.equal(archived.sessionsByScenario['scenario-any'].sessionId, retained.sessionsByScenario['scenario-any'].sessionId);
  assert.equal(archived.archivedSessions[0].sessionId, retainedId);
  assert.equal(archived.archivedSessions[0].archiveState, 'archived');

  const deleted = deleteActiveChat(retained, 'scenario-any', 'Fallback new chat', undefined, retainedId);
  assert.equal(deleted.sessionsByScenario['scenario-any'].sessionId, retained.sessionsByScenario['scenario-any'].sessionId);
  assert.equal(deleted.archivedSessions[0].sessionId, retainedId);
  assert.equal(deleted.archivedSessions[0].archiveState, 'discarded');
});

test('restores a stored session and retains the active session only when it has activity', () => {
  const archived = { ...session('archived'), archiveState: 'discarded' as const };
  const state = workspace(session('active'), [archived]);
  const next = restoreArchivedSession(state, 'scenario-any', 'archived', '2026-05-07T01:00:00.000Z', 'Fallback');

  assert.equal(next.sessionsByScenario['scenario-any'].sessionId, 'archived');
  assert.equal(next.sessionsByScenario['scenario-any'].archiveState, undefined);
  assert.equal(next.sessionsByScenario['scenario-any'].updatedAt, '2026-05-07T01:00:00.000Z');
  assert.equal(next.archivedSessions[0].sessionId, 'active');
  assert.equal(next.archivedSessions[0].archiveState, undefined);
});

test('deletes selected archived sessions without touching other scenarios', () => {
  const state = workspace(session('active'), [session('a'), session('b'), session('other', 'other-scenario')]);
  const next = deleteArchivedSessions(state, 'scenario-any', ['a']);

  assert.deepEqual(next.archivedSessions.map((item) => item.sessionId), ['b', 'other']);
});

test('clears archived sessions for one scenario only', () => {
  const state = workspace(session('active'), [
    { ...session('a'), archiveState: 'archived' as const },
    { ...session('other', 'other-scenario'), archiveState: 'archived' as const },
  ]);
  const next = clearArchivedSessions(state, 'scenario-any');

  assert.deepEqual(next.archivedSessions.map((item) => item.sessionId), ['other']);
});

test('edits and deletes session messages as explicit session transforms', () => {
  const state = workspace(session('active', 'scenario-any', ['first', 'second']));
  const edited = editSessionMessage(state, 'scenario-any', 'message-active-0', 'updated', '2026-05-07T01:00:00.000Z');
  const deleted = deleteSessionMessage({
    ...state,
    sessionsByScenario: sessionsByScenario({ 'scenario-any': edited }),
  }, 'scenario-any', 'message-active-1', '2026-05-07T02:00:00.000Z');

  assert.equal(edited.messages[0].content, 'updated');
  assert.equal(edited.messages[0].updatedAt, '2026-05-07T01:00:00.000Z');
  assert.deepEqual(deleted.messages.map((message) => message.id), ['message-active-0']);
});
