import assert from 'node:assert/strict';
import test from 'node:test';
import type { SciForgeSession, ScenarioInstanceId } from '../../domain';
import {
  buildSidebarSearchMatches,
  buildSidebarThreadItems,
  sidebarThreadTitle,
} from './ShellPanels';

test('sidebar thread list stays empty for seed-only default chats', () => {
  const sessions = {
    'literature-evidence-review': session({
      sessionId: 'seed-session',
      messages: [{ id: 'seed-1', role: 'scenario', content: 'demo', createdAt: '2026-05-21T00:00:00.000Z' }],
    }),
  };

  assert.deepEqual(buildSidebarThreadItems(sessions), []);
});

test('sidebar thread title falls back from evidence refs to the user prompt', () => {
  const item = session({
    title: 'artifact:research-report',
    messages: [{ id: 'user-1', role: 'user', content: '请总结这篇论文的局限', createdAt: '2026-05-21T00:00:00.000Z' }],
  });

  assert.equal(sidebarThreadTitle(item), '请总结这篇论文的局限');
});

test('sidebar search returns concise matches and empty arrays for misses', () => {
  const sessions = {
    'structure-exploration': session({
      scenarioId: 'structure-exploration',
      sessionId: 'protein-thread',
      title: 'Protein pocket review',
      messages: [{ id: 'user-1', role: 'user', content: 'find pockets', createdAt: '2026-05-21T00:00:00.000Z' }],
    }),
  };

  assert.ok(buildSidebarSearchMatches('protein', sessions).some((match) => match.id === 'thread:protein-thread'));
  assert.ok(buildSidebarSearchMatches('timeline', sessions).some((match) => match.page === 'timeline'));
  assert.deepEqual(buildSidebarSearchMatches('zzzz-no-result', sessions), []);
});

function session(patch: Partial<SciForgeSession> = {}): SciForgeSession {
  const scenarioId = patch.scenarioId ?? 'literature-evidence-review';
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: scenarioId as ScenarioInstanceId,
    title: '默认聊天',
    createdAt: '2026-05-21T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
    updatedAt: '2026-05-21T00:01:00.000Z',
    ...patch,
  };
}
