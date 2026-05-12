import assert from 'node:assert/strict';
import test from 'node:test';

import {
  NOTEBOOK_BRANCH_CONTRACT_ID,
  NOTEBOOK_BRANCH_SCHEMA_VERSION,
  applyNotebookBranchParameterChanges,
  buildNotebookBranchReplayPlan,
  notebookBranchPlanAllowsContinuation,
} from './notebook-branch';

test('notebook branch replay retains upstream steps and invalidates changed downstream refs', () => {
  const plan = buildNotebookBranchReplayPlan({
    notebookId: 'dose-response-notebook',
    sourceBranchId: 'main',
    branchId: 'alpha-001',
    forkFromStepId: 'fit-model',
    requestedAt: '2026-05-13T00:00:00.000Z',
    reason: 'User asked to rerun the notebook from step 2 with alpha=0.01.',
    parameterChanges: [{
      key: 'model.alpha',
      before: 0.05,
      after: 0.01,
      reason: 'Sensitivity analysis branch.',
    }],
    steps: [{
      id: 'load-data',
      index: 1,
      title: 'Load raw measurements',
      status: 'completed',
      outputRefs: ['file:.sciforge/projects/dose/artifacts/1-clean.csv'],
      codeRefs: ['file:.sciforge/projects/dose/src/1-load.py'],
      executionUnitRefs: ['execution:load-data'],
    }, {
      id: 'fit-model',
      index: 2,
      title: 'Fit dose response model',
      status: 'completed',
      parameters: { model: { alpha: 0.05 }, seed: 42 },
      inputRefs: ['file:.sciforge/projects/dose/artifacts/1-clean.csv'],
      outputRefs: ['file:.sciforge/projects/dose/artifacts/2-fit.json'],
      artifactRefs: ['artifact:dose:fit-v1'],
      codeRefs: ['file:.sciforge/projects/dose/src/2-fit.py'],
      stdoutRefs: ['file:.sciforge/projects/dose/logs/2-fit.stdout.log'],
      stderrRefs: ['file:.sciforge/projects/dose/logs/2-fit.stderr.log'],
      executionUnitRefs: ['execution:fit-model'],
    }, {
      id: 'plot-result',
      index: 3,
      title: 'Plot fitted curve',
      status: 'completed',
      inputRefs: ['file:.sciforge/projects/dose/artifacts/2-fit.json'],
      outputRefs: ['file:.sciforge/projects/dose/artifacts/3-plot.png'],
      artifactRefs: ['artifact:dose:plot-v1'],
      codeRefs: ['file:.sciforge/projects/dose/src/3-plot.py'],
      executionUnitRefs: ['execution:plot-result'],
    }],
  });

  assert.equal(plan.schemaVersion, NOTEBOOK_BRANCH_SCHEMA_VERSION);
  assert.equal(plan.contract, NOTEBOOK_BRANCH_CONTRACT_ID);
  assert.equal(plan.status, 'ready');
  assert.equal(plan.sideEffectPolicy, 'fork-before-write');
  assert.equal(notebookBranchPlanAllowsContinuation(plan), true);
  assert.deepEqual(plan.retainedSteps.map((step) => step.sourceStepId), ['load-data']);
  assert.deepEqual(plan.rerunSteps.map((step) => step.sourceStepId), ['fit-model', 'plot-result']);
  assert.deepEqual(plan.invalidatedSourceSteps.map((step) => step.sourceStepId), ['fit-model', 'plot-result']);
  assert.equal(plan.rerunSteps[0]?.branchId, 'alpha-001');
  assert.equal(plan.rerunSteps[0]?.status, 'pending');
  assert.equal(plan.rerunSteps[0]?.parameterChanges?.[0]?.after, 0.01);
  assert.match(plan.rerunSteps[0]?.outputRefs[0]?.ref ?? '', /^notebook-branch:alpha-001\/fit-model\/output\//);
  assert.equal(plan.invalidatedSourceSteps[1]?.artifactRefs[0]?.invalidated, true);
  assert.ok(plan.affectedRefs.some((ref) => ref.ref === 'file:.sciforge/projects/dose/artifacts/3-plot.png'));
  assert.ok(!plan.affectedRefs.some((ref) => ref.ref === 'file:.sciforge/projects/dose/artifacts/1-clean.csv'));
});

test('notebook branch replay blocks missing parameter changes or missing fork steps', () => {
  const noChange = buildNotebookBranchReplayPlan({
    notebookId: 'empty-change',
    forkFromStepId: 'step-2',
    parameterChanges: [],
    steps: [{ id: 'step-1', index: 1 }, { id: 'step-2', index: 2 }],
  });
  assert.equal(noChange.status, 'blocked');
  assert.equal(notebookBranchPlanAllowsContinuation(noChange), false);
  assert.match(noChange.diagnostics.join('\n'), /explicit parameter change/);

  const missingFork = buildNotebookBranchReplayPlan({
    notebookId: 'missing-fork',
    forkFromStepId: 'step-9',
    parameterChanges: [{ key: 'alpha', after: 0.01 }],
    steps: [{ id: 'step-1', index: 1 }],
  });
  assert.equal(missingFork.status, 'blocked');
  assert.match(missingFork.nextActions[0] ?? '', /Do not reuse downstream/);
});

test('parameter changes support nested paths without mutating source parameters', () => {
  const source = { model: { alpha: 0.05 }, seed: 42 };
  const next = applyNotebookBranchParameterChanges(source, [
    { key: 'model.alpha', before: 0.05, after: 0.01 },
    { key: 'model.maxIter', after: 500 },
  ]);
  assert.deepEqual(source, { model: { alpha: 0.05 }, seed: 42 });
  assert.deepEqual(next, { model: { alpha: 0.01, maxIter: 500 }, seed: 42 });
});
