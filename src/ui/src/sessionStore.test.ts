import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ALIGNMENT_CONTRACT_ARTIFACT_TYPE,
  ALIGNMENT_CONTRACT_SCHEMA_VERSION,
} from './domain';
import { compactWorkspaceStateForStorage, parseWorkspaceState, saveWorkspaceState, sessionWriteConflictsForState, shouldUsePersistedWorkspaceState } from './sessionStore';

test('parseWorkspaceState preserves built-in and workspace scenario sessions', () => {
  const state = parseWorkspaceState({
    schemaVersion: 2,
    workspacePath: '/tmp/sciforge-workspace',
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
    workspacePath: '/Applications/workspace/ailab/research/app/SciForge/workspace',
    sessionsByScenario: {
      'literature-evidence-review': sessionFixture('local-browser', ['local-only', 'local-extra']),
    },
    archivedSessions: [],
    updatedAt: '2026-04-25T02:00:00.000Z',
  });
  const sharedWorkspaceState = parseWorkspaceState({
    schemaVersion: 2,
    workspacePath: '/Applications/workspace/ailab/research/app/SciForge/workspace',
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
    workspacePath: '/tmp/sciforge-workspace',
    sessionsByScenario: {},
    archivedSessions: [],
    hiddenOfficialPackageIds: ['structure-exploration', 'structure-exploration', 42],
    updatedAt: '2026-04-25T00:00:00.000Z',
  });

  assert.deepEqual(state.hiddenOfficialPackageIds, ['structure-exploration']);
});

test('parseWorkspaceState preserves package-owned alignment contract records', () => {
  const state = parseWorkspaceState({
    schemaVersion: 2,
    workspacePath: '/tmp/sciforge-workspace',
    sessionsByScenario: {},
    archivedSessions: [],
    alignmentContracts: [{
      id: 'alignment-contract-legacy',
      type: ALIGNMENT_CONTRACT_ARTIFACT_TYPE,
      schemaVersion: ALIGNMENT_CONTRACT_SCHEMA_VERSION,
      title: 'Legacy alignment',
      createdAt: '2026-04-25T00:00:00.000Z',
      updatedAt: '2026-04-25T00:00:00.000Z',
      reason: 'legacy state load',
      checksum: 'abc123',
      sourceRefs: [],
      assumptionRefs: [],
      decisionAuthority: 'researcher',
      confirmationStatus: 'needs-data',
      data: { researchGoal: 'align assumptions' },
    }],
    updatedAt: '2026-04-25T00:00:00.000Z',
  });

  assert.equal(state.alignmentContracts.length, 1);
  assert.equal(state.alignmentContracts[0]?.type, ALIGNMENT_CONTRACT_ARTIFACT_TYPE);
  assert.equal(state.alignmentContracts[0]?.schemaVersion, ALIGNMENT_CONTRACT_SCHEMA_VERSION);
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
      workspacePath: '/tmp/sciforge-workspace',
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
    workspacePath: '/tmp/sciforge-workspace',
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

test('compactWorkspaceStateForStorage keeps recent repair-needed execution refs', () => {
  const state = parseWorkspaceState({
    schemaVersion: 2,
    workspacePath: '/tmp/sciforge-workspace',
    sessionsByScenario: {
      'literature-evidence-review': {
        ...sessionFixture('compact-repair-session', ['recent failed run']),
        executionUnits: Array.from({ length: 12 }, (_, index) => ({
          id: index === 11 ? 'unit-recent-repair' : `unit-old-${index}`,
          tool: 'validator',
          params: '{}',
          status: index === 11 ? 'repair-needed' : 'done',
          hash: `unit-${index}`,
          outputRef: index === 11 ? 'run:run-recent/failed-output.json' : undefined,
        })),
        artifacts: Array.from({ length: 12 }, (_, index) => ({
          id: index === 11 ? 'artifact-recent-diagnostic' : `artifact-old-${index}`,
          type: 'diagnostic',
          producerScenario: 'literature-evidence-review',
          schemaVersion: '1',
        })),
      },
    },
    archivedSessions: [],
    updatedAt: '2026-04-25T00:00:00.000Z',
  });

  const compact = compactWorkspaceStateForStorage(state, 'minimal');
  const compactSession = compact.sessionsByScenario['literature-evidence-review'];

  assert.equal(compactSession.executionUnits.some((unit) => unit.id === 'unit-old-0'), false);
  assert.equal(compactSession.executionUnits.at(-1)?.id, 'unit-recent-repair');
  assert.equal(compactSession.artifacts.at(-1)?.id, 'artifact-recent-diagnostic');
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
      dataRef: '.sciforge/uploads/binary-session/upload.pdf',
      data: { fileName: 'upload.pdf', dataUrl },
    }],
  };
  const state = parseWorkspaceState({
    schemaVersion: 2,
    workspacePath: '/tmp/sciforge-workspace',
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

test('saveWorkspaceState records stale localStorage session writes without overwriting current state', () => {
  const base = parseWorkspaceState({
    schemaVersion: 2,
    workspacePath: '/tmp/sciforge-workspace',
    sessionsByScenario: {
      'literature-evidence-review': sessionFixture('shared-session', ['base']),
    },
    archivedSessions: [],
    updatedAt: '2026-04-25T00:00:00.000Z',
  });
  const baseSession = base.sessionsByScenario['literature-evidence-review'];
  const firstWriter = {
    ...base,
    sessionsByScenario: {
      ...base.sessionsByScenario,
      'literature-evidence-review': {
        ...baseSession,
        messages: [...baseSession.messages, {
          id: 'msg-writer-a',
          role: 'user' as const,
          content: 'writer A',
          createdAt: '2026-04-25T00:01:00.000Z',
        }],
      },
    },
    updatedAt: '2026-04-25T00:01:00.000Z',
  };
  const secondWriter = {
    ...base,
    sessionsByScenario: {
      ...base.sessionsByScenario,
      'literature-evidence-review': {
        ...baseSession,
        messages: [...baseSession.messages, {
          id: 'msg-writer-b',
          role: 'user' as const,
          content: 'writer B',
          createdAt: '2026-04-25T00:02:00.000Z',
        }],
      },
    },
    updatedAt: '2026-04-25T00:02:00.000Z',
  };

  let stored: string | null = JSON.stringify(compactWorkspaceStateForStorage(base));
  const previousWindow = globalThis.window;
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: {
      localStorage: {
        getItem: () => stored,
        setItem: (_key: string, value: string) => {
          stored = value;
        },
      },
    },
  });
  try {
    saveWorkspaceState(firstWriter);
    saveWorkspaceState(secondWriter);

    assert.ok(stored);
    const saved = parseWorkspaceState(JSON.parse(stored));
    const savedMessages = saved.sessionsByScenario['literature-evidence-review'].messages.map((message) => message.content);
    assert.deepEqual(savedMessages, ['base', 'writer A']);
    assert.equal(sessionWriteConflictsForState(saved).length, 1);
    assert.equal(sessionWriteConflictsForState(saved)[0]?.kind, 'ordering-conflict');
    assert.deepEqual(sessionWriteConflictsForState(saved)[0]?.conflictingFields, ['messages']);
    assert.equal(JSON.stringify(compactWorkspaceStateForStorage(saved)).includes('__sciforgeSessionRevision'), false);
  } finally {
    Object.defineProperty(globalThis, 'window', { configurable: true, value: previousWindow });
  }
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
