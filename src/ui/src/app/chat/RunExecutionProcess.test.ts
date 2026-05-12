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
