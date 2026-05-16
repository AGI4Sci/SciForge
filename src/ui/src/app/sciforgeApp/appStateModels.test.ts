import assert from 'node:assert/strict';
import test from 'node:test';
import { createBuiltInScenarioRecord } from '@sciforge/scenario-core/scenario-routing-policy';
import type { SciForgeSession } from '../../domain';
import {
  buildArchivedSessionCountsByScenario,
  buildArchivedSessionsByScenario,
  defaultPublishedRuntimeComponentIds,
  updateDraftRecord,
} from './appStateModels';

function session(scenarioId: string, sessionId: string, updatedAt: string): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId,
    scenarioId,
    title: sessionId,
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

test('selects unique published runtime component ids by default', () => {
  assert.deepEqual(defaultPublishedRuntimeComponentIds([
    { componentId: 'beta', lifecycle: 'published' },
    { componentId: 'alpha', lifecycle: 'draft' },
    { componentId: 'beta', lifecycle: 'published' },
    { componentId: 'alpha', lifecycle: 'published' },
  ]), ['alpha', 'beta']);
});

test('draft updates preserve identity when textarea value is unchanged', () => {
  const current = { ...createBuiltInScenarioRecord(''), 'literature-evidence-review': 'long prompt' };

  assert.equal(updateDraftRecord(current, 'literature-evidence-review', 'long prompt'), current);
  assert.equal(updateDraftRecord(current, 'literature-evidence-review', 'new prompt')['literature-evidence-review'], 'new prompt');
});
