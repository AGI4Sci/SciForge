import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import type { RuntimeExecutionUnit, SciForgeSession } from '../../domain';
import { RunExecutionProcess } from './RunExecutionProcess';

test('execution process renders blocking execution units without Checked success state', () => {
  const html = renderProcess([
    executionUnit({ id: 'failed-with-reason', status: 'failed-with-reason', failureReason: 'contract validation failed' }),
    executionUnit({
      id: 'repair-needed',
      status: 'repair-needed',
      params: 'large params should not hide recovery details',
      codeRef: 'src/report.ts',
      code: 'emitReport({ schemaVersion: 0 })',
      diffRef: 'diffs/report.patch',
      stdoutRef: 'logs/stdout.log',
      stderrRef: 'logs/stderr.log',
      outputRef: 'artifacts/report.json',
      patchSummary: 'report schema mismatch',
      failureReason: 'artifact payload is missing markdownRef',
      recoverActions: ['Regenerate the report artifact with schemaVersion=1.'],
      nextStep: 'Retry artifact materialization before presenting success.',
    }),
    executionUnit({ id: 'needs-human', status: 'needs-human' }),
  ]);

  assert.match(html, /<span class="cursor-step-kind">Failed<\/span>/);
  assert.match(html, /<span class="cursor-step-kind">Repair<\/span>/);
  assert.match(html, /<span class="cursor-step-kind">Needs Human<\/span>/);
  assert.doesNotMatch(html, /<span class="cursor-step-kind">Checked<\/span>/);
  assert.match(html, /恢复动作：Regenerate the report artifact with schemaVersion=1\./);
  assert.match(html, /下一步：Retry artifact materialization before presenting success\./);
  assert.doesNotMatch(html, /标准输出：/);
});

test('execution process scopes execution units to the selected run artifact refs', () => {
  const html = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-old',
    session: {
      ...session([]),
      runs: [
        {
          id: 'run-old',
          scenarioId: 'literature-evidence-review',
          status: 'completed',
          prompt: 'old report',
          response: 'done',
          createdAt: '2026-05-12T00:00:00.000Z',
          objectReferences: [{ kind: 'artifact', ref: 'artifact:old-report', title: 'old report' }],
        },
        {
          id: 'run-new',
          scenarioId: 'literature-evidence-review',
          status: 'completed',
          prompt: 'new report',
          response: 'done',
          createdAt: '2026-05-12T00:05:00.000Z',
          objectReferences: [{ kind: 'artifact', ref: 'artifact:new-report', title: 'new report' }],
        },
      ] as never,
      executionUnits: [
        executionUnit({ id: 'EU-old', tool: 'old.tool', outputRef: 'artifact:old-report' }),
        executionUnit({ id: 'EU-new', tool: 'new.tool', outputRef: 'artifact:new-report' }),
      ],
    },
    onObjectFocus: () => undefined,
  }));

  assert.match(html, /old\.tool/);
  assert.doesNotMatch(html, /new\.tool/);
});

test('execution process does not fall back to same-package units from another run', () => {
  const html = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-old',
    session: {
      ...session([]),
      runs: [
        { id: 'run-old', scenarioId: 'literature-evidence-review', status: 'completed', prompt: 'old', response: 'done', createdAt: '2026-05-12T00:00:00.000Z' },
        { id: 'run-new', scenarioId: 'literature-evidence-review', status: 'completed', prompt: 'new', response: 'done', createdAt: '2026-05-12T00:05:00.000Z' },
      ],
      executionUnits: [executionUnit({
        id: 'EU-new-only',
        tool: 'new.tool',
        outputRef: 'run:run-new#output',
        scenarioPackageRef: { id: 'literature-evidence-review', version: '1.0.0', source: 'built-in' },
      })],
    },
    onObjectFocus: () => undefined,
  }));

  assert.match(html, /接收任务：old/);
  assert.doesNotMatch(html, /new\.tool/);
});

test('execution process renders failed execution units preserved in run raw payload', () => {
  const html = renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-failed-payload',
    session: {
      ...session([]),
      runs: [{
        id: 'run-failed-payload',
        scenarioId: 'literature-evidence-review',
        status: 'failed',
        prompt: 'probe page',
        response: 'failed-with-reason',
        createdAt: '2026-05-12T00:00:00.000Z',
        raw: {
          payload: {
            executionUnits: [{
              id: 'EU-failed-payload',
              tool: 'web.probe',
              params: '{}',
              status: 'failed-with-reason',
              hash: 'failed-payload',
              outputRef: 'run:run-failed-payload#EU-failed-payload',
              failureReason: 'probe failed before rendering',
            }],
          },
        },
      }],
      executionUnits: [],
    },
    onObjectFocus: () => undefined,
  }));

  assert.match(html, /EU-failed-payload/);
  assert.match(html, /web\.probe/);
  assert.match(html, /probe failed before rendering/);
});

function renderProcess(executionUnits: RuntimeExecutionUnit[]) {
  return renderToStaticMarkup(createElement(RunExecutionProcess, {
    runId: 'run-1',
    session: session(executionUnits),
    onObjectFocus: () => undefined,
  }));
}

function session(executionUnits: RuntimeExecutionUnit[]): SciForgeSession {
  return {
    schemaVersion: 2,
    sessionId: 'session-1',
    scenarioId: 'literature-evidence-review',
    title: 'test session',
    createdAt: '2026-05-12T00:00:00.000Z',
    updatedAt: '2026-05-12T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-1',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'make report',
      response: 'done',
      createdAt: '2026-05-12T00:00:00.000Z',
    }],
    uiManifest: [],
    claims: [],
    executionUnits,
    artifacts: [],
    notebook: [],
    versions: [],
    hiddenResultSlotIds: [],
  };
}

function executionUnit(overrides: Partial<RuntimeExecutionUnit>): RuntimeExecutionUnit {
  return {
    id: 'unit',
    tool: 'validator',
    params: '',
    status: 'done',
    hash: 'hash',
    ...overrides,
  };
}
