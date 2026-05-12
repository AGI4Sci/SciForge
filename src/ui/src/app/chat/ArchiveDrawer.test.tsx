import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTaskRunCard } from '@sciforge-ui/runtime-contract/task-run-card';
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

test('archive drawer prefers TaskRunCard contract over legacy raw compact summary', () => {
  const taskRunCard = createTaskRunCard({
    id: 'task-card:run-code-abcdef:1',
    taskId: 'run-code-abcdef123456',
    goal: 'fix bug and run tests',
    protocolStatus: 'protocol-failed',
    taskOutcome: 'needs-work',
    refs: [
      { kind: 'artifact', ref: '.sciforge/task-results/report.md', label: 'report' },
      { kind: 'execution-unit', ref: 'execution-unit:EU-code', status: 'repair-needed' },
      { kind: 'log', ref: '.sciforge/logs/run-code.stderr.log', label: 'stderr' },
    ],
    failureSignatures: [{
      kind: 'schema-drift',
      layer: 'payload-normalization',
      message: 'schema drift while validating task payload',
      refs: ['.sciforge/task-results/report.md'],
    }],
    nextStep: 'Continue from preserved task refs and repair payload normalization.',
  });
  const html = renderToStaticMarkup(createElement(ArchiveDrawer, {
    currentSession: session({ sessionId: 'current', title: 'current' }),
    archivedSessions: [session({
      sessionId: 'card-session',
      title: 'card-backed run',
      runs: [{
        id: 'run-code-abcdef123456',
        scenarioId: 'literature-evidence-review',
        status: 'failed',
        prompt: 'fix bug and run tests',
        response: 'legacy response',
        createdAt: '2026-05-12T00:00:00.000Z',
        raw: {
          failureReason: 'LEGACY_RAW_FAILURE_SHOULD_NOT_RENDER',
          displayIntent: {
            taskRunCard,
          },
        },
      }],
    })],
    onRestore: () => undefined,
    onDelete: () => undefined,
    onClear: () => undefined,
  }));

  assert.match(html, /code-abcdef1234/);
  assert.match(html, /schema drift while validating task payload/);
  assert.match(html, /artifact:.sciforge\/task-results\/report.md/);
  assert.match(html, /Continue from preserved task refs/);
  assert.doesNotMatch(html, /LEGACY_RAW_FAILURE_SHOULD_NOT_RENDER/);
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
