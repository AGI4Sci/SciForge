import assert from 'node:assert/strict';
import test from 'node:test';

import { parseWorkspaceState, shouldUsePersistedWorkspaceState } from './sessionStore';

test('parseWorkspaceState preserves built-in and workspace scenario sessions', () => {
  const state = parseWorkspaceState({
    schemaVersion: 2,
    workspacePath: '/tmp/bioagent-workspace',
    sessionsByScenario: {
      'literature-evidence-review': {
        schemaVersion: 2,
        sessionId: 'session-built-in',
        scenarioId: 'literature-evidence-review',
        title: 'Built-in literature',
        createdAt: '2026-04-25T00:00:00.000Z',
        messages: [],
        runs: [],
        uiManifest: [],
        claims: [],
        executionUnits: [],
        artifacts: [],
        notebook: [],
        versions: [],
        updatedAt: '2026-04-25T00:00:00.000Z',
      },
      'workspace-literature-review': {
        schemaVersion: 2,
        sessionId: 'session-workspace',
        scenarioId: 'workspace-literature-review',
        title: 'Workspace literature',
        createdAt: '2026-04-25T00:00:00.000Z',
        messages: [{ id: 'msg-1', role: 'user', content: 'hello', createdAt: '2026-04-25T00:00:00.000Z' }],
        runs: [],
        uiManifest: [],
        claims: [],
        executionUnits: [],
        artifacts: [],
        notebook: [],
        versions: [],
        updatedAt: '2026-04-25T00:00:00.000Z',
      },
      'workspace-literature-review-alt': {
        schemaVersion: 2,
        sessionId: 'session-workspace-alt',
        scenarioId: 'workspace-literature-review-alt',
        title: 'Workspace literature alt',
        createdAt: '2026-04-25T00:00:00.000Z',
        messages: [{ id: 'msg-alt', role: 'user', content: 'alt hello', createdAt: '2026-04-25T00:00:00.000Z' }],
        runs: [],
        uiManifest: [],
        claims: [],
        executionUnits: [],
        artifacts: [],
        notebook: [],
        versions: [],
        updatedAt: '2026-04-25T00:00:00.000Z',
      },
    },
    archivedSessions: [{
      schemaVersion: 2,
      sessionId: 'archived-workspace',
      scenarioId: 'workspace-literature-review',
      title: 'Archived workspace',
      createdAt: '2026-04-25T00:00:00.000Z',
      messages: [],
      runs: [],
      uiManifest: [],
      claims: [],
      executionUnits: [],
      artifacts: [],
      notebook: [],
      versions: [],
      updatedAt: '2026-04-25T00:00:00.000Z',
    }],
    alignmentContracts: [],
    updatedAt: '2026-04-25T00:00:00.000Z',
  });

  assert.equal(state.sessionsByScenario['literature-evidence-review'].sessionId, 'session-built-in');
  assert.equal(state.sessionsByScenario['workspace-literature-review'].sessionId, 'session-workspace');
  assert.equal(state.sessionsByScenario['workspace-literature-review'].messages[0]?.content, 'hello');
  assert.equal(state.sessionsByScenario['workspace-literature-review-alt'].sessionId, 'session-workspace-alt');
  assert.equal(state.sessionsByScenario['workspace-literature-review-alt'].messages[0]?.content, 'alt hello');
  assert.equal(state.archivedSessions[0]?.scenarioId, 'workspace-literature-review');
});

test('explicit workspace path treats workspace snapshot as canonical across browsers', () => {
  const localBrowserState = parseWorkspaceState({
    schemaVersion: 2,
    workspacePath: '/Applications/workspace/ailab/research/app/BioAgent/workspace',
    sessionsByScenario: {
      'literature-evidence-review': sessionFixture('local-browser', ['local-only', 'local-extra']),
    },
    archivedSessions: [],
    updatedAt: '2026-04-25T02:00:00.000Z',
  });
  const sharedWorkspaceState = parseWorkspaceState({
    schemaVersion: 2,
    workspacePath: '/Applications/workspace/ailab/research/app/BioAgent/workspace',
    sessionsByScenario: {
      'literature-evidence-review': sessionFixture('shared-workspace', ['shared-history']),
    },
    archivedSessions: [],
    updatedAt: '2026-04-25T01:00:00.000Z',
  });

  assert.equal(shouldUsePersistedWorkspaceState(localBrowserState, sharedWorkspaceState), false);
  assert.equal(shouldUsePersistedWorkspaceState(localBrowserState, sharedWorkspaceState, { explicitWorkspacePath: true }), true);
});

test('parseWorkspaceState preserves hidden official package preferences', () => {
  const state = parseWorkspaceState({
    schemaVersion: 2,
    workspacePath: '/tmp/bioagent-workspace',
    sessionsByScenario: {},
    archivedSessions: [],
    hiddenOfficialPackageIds: ['structure-exploration', 'structure-exploration', 42],
    updatedAt: '2026-04-25T00:00:00.000Z',
  });

  assert.deepEqual(state.hiddenOfficialPackageIds, ['structure-exploration']);
});

function sessionFixture(sessionId: string, messages: string[]) {
  return {
    schemaVersion: 2,
    sessionId,
    scenarioId: 'literature-evidence-review',
    title: sessionId,
    createdAt: '2026-04-25T00:00:00.000Z',
    messages: messages.map((content, index) => ({
      id: `msg-${sessionId}-${index}`,
      role: 'user',
      content,
      createdAt: '2026-04-25T00:00:00.000Z',
    })),
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    updatedAt: '2026-04-25T00:00:00.000Z',
  };
}
