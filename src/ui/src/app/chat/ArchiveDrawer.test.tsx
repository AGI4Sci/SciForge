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
  assert.match(html, /不会自动重跑历史任务/);
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

test('archive drawer prefers conversation projection summary over legacy raw run boundary', () => {
  const html = renderToStaticMarkup(createElement(ArchiveDrawer, {
    currentSession: session({ sessionId: 'current', title: 'current' }),
    archivedSessions: [session({
      sessionId: 'projection-session',
      title: 'projection-backed run',
      runs: [{
        id: 'run-projection-abcdef123456',
        scenarioId: 'literature-evidence-review',
        status: 'failed',
        prompt: 'summarize projected run',
        response: 'legacy response',
        createdAt: '2026-05-12T00:00:00.000Z',
        raw: {
          failureReason: 'LEGACY_RAW_FAILURE_SHOULD_NOT_RENDER',
          recoverActions: ['legacy raw action should not render'],
          resultPresentation: {
            conversationProjection: {
              schemaVersion: 'sciforge.conversation-projection.v1',
              conversationId: 'conversation-archive-projection',
              visibleAnswer: {
                status: 'repair-needed',
                diagnostic: 'Projection repair boundary is authoritative.',
                artifactRefs: ['artifact:projection-report'],
              },
              artifacts: [{ ref: 'artifact:projection-report', label: 'projection report' }],
              executionProcess: [],
              recoverActions: ['Continue from projection refs.'],
              verificationState: { status: 'failed', verifierRef: 'verification:projection' },
              auditRefs: ['execution-unit:EU-projection'],
              diagnostics: [],
            },
          },
        },
      }],
    })],
    onRestore: () => undefined,
    onDelete: () => undefined,
    onClear: () => undefined,
  }));

  assert.match(html, /需恢复：Projection repair boundary is authoritative/);
  assert.match(html, /projection 需恢复/);
  assert.match(html, /execution-unit:EU-projection/);
  assert.match(html, /Continue from projection refs/);
  assert.doesNotMatch(html, /last run failed/);
  assert.doesNotMatch(html, /LEGACY_RAW_FAILURE_SHOULD_NOT_RENDER/);
  assert.doesNotMatch(html, /legacy raw action should not render/);
});

test('archive drawer shows diagnostic-only boundary for historical literature download failures', () => {
  const taskRunCard = createTaskRunCard({
    id: 'task-card:run-lit-history:1',
    taskId: 'run-lit-history',
    goal: 'Download 10 PDFs, preserve successful full text, and continue with metadata when some downloads fail.',
    protocolStatus: 'protocol-failed',
    taskOutcome: 'needs-human',
    refs: [
      { kind: 'artifact', ref: 'artifact:partial-literature-report', status: 'partial' },
      { kind: 'file', ref: 'file:.sciforge/task-results/pdfs/downloaded-paper.pdf', label: 'downloaded full text' },
      { kind: 'file', ref: 'file:.sciforge/data/downloaded-paper.metadata.json', label: 'metadata' },
      { kind: 'log', ref: 'file:.sciforge/logs/literature.stderr.log', label: 'stderr' },
    ],
    failureSignatures: [{
      message: 'PDF retrieval partially failed: one timeout, one HTTP 403, one file exceeded max download bytes.',
      operation: 'pdf-download',
      refs: ['file:.sciforge/logs/literature.stderr.log'],
    }],
    nextStep: 'Open diagnostics and reuse retained refs first; rerun PDF downloads only after an explicit continue/retry request.',
  });
  const html = renderToStaticMarkup(createElement(ArchiveDrawer, {
    currentSession: session({ sessionId: 'current', title: 'current' }),
    archivedSessions: [session({
      sessionId: 'history-lit-session',
      title: 'history literature diagnostics',
      runs: [{
        id: 'run-lit-history',
        scenarioId: 'literature-evidence-review',
        status: 'failed',
        prompt: 'download 10 PDFs',
        response: 'partial failure',
        createdAt: '2026-05-12T00:00:00.000Z',
        raw: {
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

  assert.match(html, /PDF retrieval partially failed/);
  assert.match(html, /file:.sciforge\/task-results\/pdfs\/downloaded-paper.pdf/);
  assert.match(html, /Open diagnostics and reuse retained refs first/);
  assert.match(html, /不会自动重跑历史任务/);
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
