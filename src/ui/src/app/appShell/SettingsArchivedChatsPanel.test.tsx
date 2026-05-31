import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SciForgeSession, ScenarioInstanceId } from '../../domain';
import { SettingsArchivedChatsPanel } from './SettingsArchivedChatsPanel';

test('archived chat settings exposes restore and delete without showing retained new-chat history', () => {
  const html = renderToStaticMarkup(React.createElement(SettingsArchivedChatsPanel, {
    archivedSessions: [
      session({
        scenarioId: 'literature-evidence-review',
        sessionId: 'archived-thread',
        title: 'Archived literature note',
        archiveState: 'archived',
        messages: [{ id: 'user-archived', role: 'user', content: 'archive this note', createdAt: '2026-05-21T00:00:00.000Z' }],
      }),
      session({
        scenarioId: 'paper-qa',
        sessionId: 'deleted-thread',
        title: 'Deleted scratch note',
        archiveState: 'discarded',
        messages: [{ id: 'user-deleted', role: 'user', content: 'discard this draft', createdAt: '2026-05-20T00:00:00.000Z' }],
      }),
      session({
        scenarioId: 'structure-exploration',
        sessionId: 'retained-thread',
        title: 'Retained previous visible chat',
        archiveState: 'archived',
        messages: [{ id: 'user-retained', role: 'user', content: 'keep me visible in sidebar', createdAt: '2026-05-19T00:00:00.000Z' }],
        versions: [{
          id: 'version-retained',
          reason: 'new chat retained previous session',
          createdAt: '2026-05-19T00:01:00.000Z',
          messageCount: 1,
          runCount: 0,
          artifactCount: 0,
          checksum: 'checksum',
          snapshot: {} as never,
        }],
      }),
    ],
    scenarioLabelFor: (scenarioId) => `Scenario ${scenarioId}`,
    onRestore: () => undefined,
    onDelete: () => undefined,
    onClearAll: () => undefined,
  }));

  assert.match(html, /Archived literature note/);
  assert.match(html, /Deleted scratch note/);
  assert.match(html, /Restore/);
  assert.match(html, /Delete selected/);
  assert.match(html, /Delete/);
  assert.match(html, /Clear all/);
  assert.match(html, /0 selected/);
  assert.doesNotMatch(html, /Retained previous visible chat/);
  assert.doesNotMatch(html, /provider|model|Authorization|secret|token|\/tmp|\/Applications/i);
});

function session(patch: Partial<SciForgeSession> = {}): SciForgeSession {
  const scenarioId = patch.scenarioId ?? 'literature-evidence-review';
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: scenarioId as ScenarioInstanceId,
    title: 'Default chat',
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
