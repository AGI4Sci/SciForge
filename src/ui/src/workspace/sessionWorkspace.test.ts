import assert from 'node:assert/strict';
import test from 'node:test';
import type { SciForgeSession, SciForgeWorkspaceState } from '../domain';
import {
  clearArchivedSessions,
  deleteActiveChat,
  deleteArchivedSessions,
  deleteSessionMessage,
  editSessionMessage,
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

test('starts a new chat while archiving the previous active session', () => {
  const state = workspace();
  const next = startNewChat(state, 'scenario-any', 'Scenario new chat');

  assert.equal(next.archivedSessions.length, 1);
  assert.equal(next.archivedSessions[0].sessionId, 'active');
  assert.equal(next.sessionsByScenario['scenario-any'].title, 'Scenario new chat');
  assert.notEqual(next.sessionsByScenario['scenario-any'].sessionId, 'active');
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

test('deletes active chat by archiving a marked copy and resetting the active session', () => {
  const state = workspace();
  const next = deleteActiveChat(state, 'scenario-any', 'Fallback new chat');

  assert.match(next.archivedSessions[0].title, /已删除/);
  assert.notEqual(next.sessionsByScenario['scenario-any'].sessionId, 'active');
});

test('restores an archived session and archives the active session only when it has activity', () => {
  const archived = session('archived');
  const state = workspace(session('active'), [archived]);
  const next = restoreArchivedSession(state, 'scenario-any', 'archived', '2026-05-07T01:00:00.000Z', 'Fallback');

  assert.equal(next.sessionsByScenario['scenario-any'].sessionId, 'archived');
  assert.equal(next.sessionsByScenario['scenario-any'].updatedAt, '2026-05-07T01:00:00.000Z');
  assert.equal(next.archivedSessions[0].sessionId, 'active');
});

test('deletes selected archived sessions without touching other scenarios', () => {
  const state = workspace(session('active'), [session('a'), session('b'), session('other', 'other-scenario')]);
  const next = deleteArchivedSessions(state, 'scenario-any', ['a']);

  assert.deepEqual(next.archivedSessions.map((item) => item.sessionId), ['b', 'other']);
});

test('clears archived sessions for one scenario only', () => {
  const state = workspace(session('active'), [session('a'), session('other', 'other-scenario')]);
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
