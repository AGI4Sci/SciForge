import assert from 'node:assert/strict';

import { normalizeAgentResponse } from '../../src/ui/src/api/agentClient.js';
import { runRecoverActions, selectDefaultResultItems, shouldOpenRunAuditDetails } from '../../src/ui/src/app/ResultsRenderer.js';

const response = normalizeAgentResponse('omics-differential-exploration', 'UMAP 按 cell cycle 着色并 side-by-side batch 对比', {
  run: {
    id: 'view-composition-smoke',
    status: 'completed',
    output: {
      text: [
        'view composition smoke',
        '```json',
        JSON.stringify({
          message: 'View composition only; no new scientific task.',
          uiManifest: [{
            componentId: 'point-set-viewer',
            artifactRef: 'omics-differential-expression',
            encoding: { colorBy: 'cellCycle', splitBy: 'batch', syncViewport: true },
            layout: { mode: 'side-by-side', columns: 2 },
            compare: { artifactRefs: ['batch-a', 'batch-b'], mode: 'side-by-side' },
          }],
          executionUnits: [],
          artifacts: [],
          claims: [],
        }),
        '```',
      ].join('\n'),
    },
  },
});

assert.equal(response.artifacts.length, 0);
assert.equal(response.uiManifest[0].encoding?.colorBy, 'cellCycle');
assert.equal(response.uiManifest[0].layout?.mode, 'side-by-side');
assert.equal(response.uiManifest[0].compare?.mode, 'side-by-side');

const resultItems = [
  viewItem('primary-report', 'report-viewer', 'primary'),
  viewItem('primary-eu', 'execution-unit-table', 'primary'),
  viewItem('raw-json', 'unknown-artifact-inspector', 'raw'),
  viewItem('timeline', 'notebook-timeline', 'provenance'),
];
const defaultSelection = selectDefaultResultItems(resultItems as never, 'all');
assert.deepEqual(defaultSelection.visibleItems.map((item: { id: string }) => item.id), ['primary-report']);
assert.equal(defaultSelection.deferredItems.some((item: { id: string }) => item.id === 'primary-eu'), false);
assert.equal(defaultSelection.deferredItems.some((item: { id: string }) => item.id === 'raw-json'), false);

const executionSelection = selectDefaultResultItems(resultItems as never, 'execution');
assert.ok(executionSelection.visibleItems.some((item: { id: string }) => item.id === 'primary-eu'));

const failedSession = {
  schemaVersion: 2,
  sessionId: 'audit-smoke-session',
  scenarioId: 'omics-differential-exploration',
  title: 'Audit smoke',
  createdAt: '2026-05-02T00:00:00.000Z',
  messages: [],
  runs: [{
    id: 'failed-run',
    scenarioId: 'omics-differential-exploration',
    status: 'failed',
    prompt: 'run failing task',
    response: 'failed',
    createdAt: '2026-05-02T00:00:00.000Z',
    raw: {
      blocker: 'missing input matrix',
      failureReason: 'matrixRef was not readable',
      recoverActions: ['choose-readable-matrix', 'rerun-with-file-ref'],
      refs: ['stdout.log', 'stderr.log'],
    },
  }],
  uiManifest: [],
  claims: [],
  executionUnits: [{
    id: 'eu-failed',
    tool: 'workspace.python',
    params: '{"matrixRef":"missing.csv"}',
    status: 'failed-with-reason',
    hash: 'hash-failed',
    failureReason: 'matrixRef was not readable',
    recoverActions: ['choose-readable-matrix'],
    stdoutRef: 'stdout.log',
    stderrRef: 'stderr.log',
  }],
  artifacts: [],
  notebook: [],
  versions: [],
  updatedAt: '2026-05-02T00:00:00.000Z',
};
assert.equal(shouldOpenRunAuditDetails(failedSession as never), true);
assert.deepEqual(runRecoverActions(failedSession as never), ['choose-readable-matrix', 'rerun-with-file-ref']);

function viewItem(id: string, componentId: string, section: string) {
  return {
    id,
    slot: { componentId, priority: 1 },
    module: { moduleId: componentId, componentId, title: componentId, acceptsArtifactTypes: ['*'], priority: 1 },
    section,
    source: 'runtime-manifest',
    status: 'bound',
  };
}

console.log('[ok] view composition smoke preserves UMAP compare and keeps raw ExecutionUnit/timeline audit details out of default primary view');
