import assert from 'node:assert/strict';
import test from 'node:test';

import { compactWorkspaceStateForStorage, parseWorkspaceState, saveWorkspaceState, shouldUsePersistedWorkspaceState } from './sessionStore';

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

test('saveWorkspaceState compacts instead of crashing on localStorage quota', () => {
  const writes: string[] = [];
  const previousWindow = globalThis.window;
  let first = true;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => null,
        setItem: (_key: string, value: string) => {
          if (first) {
            first = false;
            throw new DOMException('quota exceeded', 'QuotaExceededError');
          }
          writes.push(value);
        },
      },
    },
  });
  try {
    const largeState = parseWorkspaceState({
      schemaVersion: 2,
      workspacePath: '/tmp/bioagent-workspace',
      sessionsByScenario: {
        'literature-evidence-review': {
          ...sessionFixture('quota-session', Array.from({ length: 40 }, (_, index) => `message ${index} ${'x'.repeat(1000)}`)),
          runs: Array.from({ length: 20 }, (_, index) => ({
            id: `run-${index}`,
            scenarioId: 'literature-evidence-review',
            status: 'completed',
            prompt: 'p'.repeat(2000),
            response: 'r'.repeat(5000),
            createdAt: '2026-04-25T00:00:00.000Z',
            completedAt: '2026-04-25T00:00:00.000Z',
          })),
        },
      },
      archivedSessions: [],
      updatedAt: '2026-04-25T00:00:00.000Z',
    });

    saveWorkspaceState(largeState);

    assert.equal(writes.length, 1);
    const saved = parseWorkspaceState(JSON.parse(writes[0]));
    assert.ok(saved.sessionsByScenario['literature-evidence-review'].messages.length <= 16);
    assert.ok(saved.sessionsByScenario['literature-evidence-review'].runs.length <= 8);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
});

test('compactWorkspaceStateForStorage keeps recent session records', () => {
  const state = parseWorkspaceState({
    schemaVersion: 2,
    workspacePath: '/tmp/bioagent-workspace',
    sessionsByScenario: {
      'literature-evidence-review': sessionFixture('compact-session', Array.from({ length: 10 }, (_, index) => `message-${index}`)),
    },
    archivedSessions: [],
    updatedAt: '2026-04-25T00:00:00.000Z',
  });

  const compact = compactWorkspaceStateForStorage(state, 'minimal');

  assert.deepEqual(
    compact.sessionsByScenario['literature-evidence-review'].messages.map((message) => message.content),
    ['message-6', 'message-7', 'message-8', 'message-9'],
  );
});

test('compactWorkspaceStateForStorage strips binary dataUrls from artifacts and versions', () => {
  const dataUrl = `data:application/pdf;base64,${Buffer.from('pdf-binary'.repeat(80_000)).toString('base64')}`;
  const session = {
    ...sessionFixture('binary-session', ['uploaded pdf']),
    artifacts: [{
      id: 'upload-pdf',
      type: 'uploaded-pdf',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      dataRef: '.bioagent/uploads/binary-session/upload.pdf',
      data: { fileName: 'upload.pdf', dataUrl },
    }],
  };
  const state = parseWorkspaceState({
    schemaVersion: 2,
    workspacePath: '/tmp/bioagent-workspace',
    sessionsByScenario: {
      'literature-evidence-review': {
        ...session,
        versions: [{
          id: 'version-binary',
          reason: 'upload',
          createdAt: '2026-04-25T00:00:00.000Z',
          messageCount: 1,
          runCount: 0,
          artifactCount: 1,
          checksum: 'abc',
          snapshot: session,
        }],
      },
    },
    archivedSessions: [session],
    updatedAt: '2026-04-25T00:00:00.000Z',
  });

  const compact = compactWorkspaceStateForStorage(state);
  const serialized = JSON.stringify(compact);
  assert.ok(!serialized.includes(dataUrl.slice(0, 50_000)));
  assert.ok(serialized.includes('binary-or-data-url'));
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
