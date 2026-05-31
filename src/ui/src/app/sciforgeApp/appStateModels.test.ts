import assert from 'node:assert/strict';
import test from 'node:test';
import { createBuiltInScenarioRecord } from '@sciforge/scenario-core/scenario-routing-policy';
import type { SciForgeSession, SciForgeWorkspaceState } from '../../domain';
import {
  buildArchivedSessionCountsByScenario,
  buildArchivedSessionsByScenario,
  defaultPublishedRuntimeComponentIds,
  updateDraftRecord,
  workspaceCanDiscardSidebarChat,
  workspaceHasArchivableSidebarChat,
  workspaceHasArchivableSidebarChats,
} from './appStateModels';

function session(scenarioId: string, sessionId: string, updatedAt: string): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId,
    scenarioId,
    title: sessionId,
    archiveState: 'archived',
    createdAt: '2026-05-01T00:00:00.000Z',
    updatedAt,
    messages: [],
    runs: [],
    artifacts: [],
    claims: [],
    executionUnits: [],
    notebook: [],
    uiManifest: [],
    versions: [],
    hiddenResultSlotIds: [],
  };
}

function workspace(
  sessionsByScenario: SciForgeWorkspaceState['sessionsByScenario'],
  archivedSessions: SciForgeSession[] = [],
): SciForgeWorkspaceState {
  return {
    schemaVersion: 2,
    workspacePath: '/tmp/workspace',
    sessionsByScenario,
    archivedSessions,
    alignmentContracts: [],
    feedbackComments: [],
    feedbackRequests: [],
    githubSyncedOpenIssues: [],
    updatedAt: '2026-05-01T00:00:00.000Z',
  };
}

test('groups archived sessions by scenario and keeps newest first', () => {
  const grouped = buildArchivedSessionsByScenario([
    session('workspace-custom', 'older', '2026-05-01T00:00:00.000Z'),
    session('workspace-custom', 'newer', '2026-05-03T00:00:00.000Z'),
    session('knowledge', 'knowledge-session', '2026-05-02T00:00:00.000Z'),
  ]);

  assert.deepEqual(grouped['workspace-custom'].map((item) => item.sessionId), ['newer', 'older']);
  assert.deepEqual(grouped.knowledge.map((item) => item.sessionId), ['knowledge-session']);
});

test('counts archived sessions by scenario', () => {
  const grouped = buildArchivedSessionsByScenario([
    session('workspace-custom', 'one', '2026-05-01T00:00:00.000Z'),
    session('workspace-custom', 'two', '2026-05-02T00:00:00.000Z'),
  ]);

  assert.equal(buildArchivedSessionCountsByScenario(grouped)['workspace-custom'], 2);
});

test('does not count retained sidebar history as archived sessions', () => {
  const retained = session('workspace-custom', 'retained-history', '2026-05-02T00:00:00.000Z');
  delete retained.archiveState;
  retained.versions = [{
    id: 'version-retained',
    reason: 'new chat retained previous session',
    createdAt: '2026-05-02T00:01:00.000Z',
    messageCount: 1,
    runCount: 0,
    artifactCount: 0,
    checksum: 'checksum',
    snapshot: {} as never,
  }];
  const grouped = buildArchivedSessionsByScenario([
    session('workspace-custom', 'archived', '2026-05-01T00:00:00.000Z'),
    retained,
  ]);

  assert.deepEqual(grouped['workspace-custom'].map((item) => item.sessionId), ['archived']);
});

test('selects unique published runtime component ids by default', () => {
  assert.deepEqual(defaultPublishedRuntimeComponentIds([
    { componentId: 'beta', lifecycle: 'published' },
    { componentId: 'alpha', lifecycle: 'draft' },
    { componentId: 'beta', lifecycle: 'published' },
    { componentId: 'alpha', lifecycle: 'published' },
  ]), ['alpha', 'beta']);
});

test('right pane browser terminal and file modules are published runtime defaults', () => {
  const ids = defaultPublishedRuntimeComponentIds();

  assert.equal(ids.includes('browser-workbench'), true);
  assert.equal(ids.includes('terminal-session-viewer'), true);
  assert.equal(ids.includes('workspace-file-viewer'), true);
});

test('draft updates preserve identity when textarea value is unchanged', () => {
  const current = { ...createBuiltInScenarioRecord(''), 'literature-evidence-review': 'long prompt' };

  assert.equal(updateDraftRecord(current, 'literature-evidence-review', 'long prompt'), current);
  assert.equal(updateDraftRecord(current, 'literature-evidence-review', 'new prompt')['literature-evidence-review'], 'new prompt');
});

test('sidebar chat action guards allow deleting drafts while keeping archive activity-based', () => {
  const draft = session('workspace-custom', 'draft-chat', '2026-05-01T00:00:00.000Z');
  draft.messages = [];
  const state = workspace({ 'workspace-custom': draft } as unknown as SciForgeWorkspaceState['sessionsByScenario']);

  assert.equal(workspaceHasArchivableSidebarChats(state), false);
  assert.equal(workspaceHasArchivableSidebarChat(state, 'workspace-custom', 'draft-chat'), false);
  assert.equal(workspaceCanDiscardSidebarChat(state, 'workspace-custom', 'draft-chat'), true);
});

test('sidebar chat action guards handle retained history separately from archived settings rows', () => {
  const active = session('workspace-custom', 'active-chat', '2026-05-03T00:00:00.000Z');
  active.messages = [{ id: 'user-active', role: 'user', content: 'current prompt', createdAt: '2026-05-03T00:00:00.000Z' }];
  const retained = session('workspace-custom', 'retained-chat', '2026-05-02T00:00:00.000Z');
  delete retained.archiveState;
  retained.messages = [{ id: 'user-retained', role: 'user', content: 'previous prompt', createdAt: '2026-05-02T00:00:00.000Z' }];
  retained.versions = [{
    id: 'version-retained-action',
    reason: 'new chat retained previous session',
    createdAt: '2026-05-02T00:01:00.000Z',
    messageCount: 1,
    runCount: 0,
    artifactCount: 0,
    checksum: 'checksum',
    snapshot: {} as never,
  }];
  const archived = session('workspace-custom', 'archived-chat', '2026-05-01T00:00:00.000Z');
  const state = workspace({ 'workspace-custom': active } as unknown as SciForgeWorkspaceState['sessionsByScenario'], [retained, archived]);

  assert.equal(workspaceHasArchivableSidebarChats(state), true);
  assert.equal(workspaceHasArchivableSidebarChat(state, 'workspace-custom', 'active-chat'), true);
  assert.equal(workspaceHasArchivableSidebarChat(state, 'workspace-custom', 'retained-chat'), true);
  assert.equal(workspaceCanDiscardSidebarChat(state, 'workspace-custom', 'retained-chat'), true);
  assert.equal(workspaceHasArchivableSidebarChat(state, 'workspace-custom', 'archived-chat'), false);
  assert.equal(workspaceCanDiscardSidebarChat(state, 'workspace-custom', 'archived-chat'), false);
});
