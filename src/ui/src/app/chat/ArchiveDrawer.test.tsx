import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { SciForgeSession } from '../../domain';
import { ArchiveDrawer } from './ArchiveDrawer';

test('archive drawer shows compact run boundary, refs, and restore impact', () => {
  const html = renderToStaticMarkup(createElement(ArchiveDrawer, {
    currentSession: session({ sessionId: 'current', title: 'current' }),
    archivedSessions: [session({
      sessionId: 'failed-session',
      title: 'failed literature run',
      runs: [{
        id: 'run-literature-abcdef123456',
        scenarioId: 'literature-evidence-review',
        status: 'failed',
        prompt: 'fetch papers',
        response: 'failed',
        createdAt: '2026-05-12T00:00:00.000Z',
        raw: {
          failureReason: 'External retrieval returned zero results while the task marked itself completed.',
          recoverActions: ['expand provider-neutral query and rerun retrieval'],
          refs: ['execution-unit:EU-literature', 'stdout:.sciforge/stdout.log'],
        },
      }],
      executionUnits: [{
        id: 'EU-literature',
        tool: 'literature.search',
        params: '{}',
        status: 'repair-needed',
        hash: 'hash',
        stdoutRef: '.sciforge/stdout.log',
        outputRef: '.sciforge/output.json',
      }],
      artifacts: [{
        id: 'research-report',
        type: 'research-report',
        producerScenario: 'literature-evidence-review',
        schemaVersion: '1',
      }],
    })],
    onRestore: () => undefined,
    onDelete: () => undefined,
    onClear: () => undefined,
  }));

  assert.match(html, /literature-abcdef1/);
  assert.match(html, /External retrieval returned zero results/);
  assert.match(html, /execution-unit:EU-literature/);
  assert.match(html, /expand provider-neutral query/);
  assert.match(html, /恢复后当前工作台会切换到该历史会话/);
});

function session(overrides: Partial<SciForgeSession> = {}): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: 'literature-evidence-review',
    title: 'session',
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
    ...overrides,
  };
}
