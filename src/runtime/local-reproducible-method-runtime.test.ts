import assert from 'node:assert/strict';
import test from 'node:test';

import { tryRunLocalReproducibleMethodRuntime } from './local-reproducible-method-runtime.js';

test('local reproducible method runtime exports existing script refs without AgentServer', async () => {
  const payload = await tryRunLocalReproducibleMethodRuntime({
    skillDomain: 'omics',
    prompt: 'Export the reproducible method as a notebook-style script artifact and list rerun commands.',
    artifacts: [{
      id: 'analysis-script',
      type: 'notebook-timeline',
      ref: '/workspace/tasks/omics_differential_analysis.py',
    }, {
      id: 'dataset-csv',
      type: 'table',
      ref: '/workspace/task-results/simulated_experiment.csv',
    }],
    uiState: {},
  });

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.local-reproducible-method.export-existing-script');
  assert.equal(payload.artifacts[0]?.type, 'notebook-timeline');
  assert.match(payload.message, /no remote backend generation/);
  assert.match(payload.message, /omics_differential_analysis\.py/);
});

test('local reproducible method runtime includes restored bootstrap conclusion for final summary prompts', async () => {
  const payload = await tryRunLocalReproducibleMethodRuntime({
    skillDomain: 'omics',
    prompt: 'Summarize final conclusion, include bootstrap CI, and list reproducible commands.',
    artifacts: [{
      id: 'analysis-script',
      type: 'notebook-timeline',
      ref: '/workspace/tasks/omics_differential_analysis.py',
    }],
    uiState: {
      claims: [{
        text: 'Bootstrap 95% CI for the drugA-control mean difference is [4.422, 20.382].',
      }],
    },
  });

  assert.ok(payload);
  assert.match(payload.message, /Final analysis conclusion/);
  assert.match(payload.message, /\[4\.422, 20\.382\]/);
});

test('local reproducible method runtime does not hijack fresh code debugging requests', async () => {
  const payload = await tryRunLocalReproducibleMethodRuntime({
    skillDomain: 'literature',
    prompt: [
      'Debug this minimal paper-reproduction code.',
      'Read weighted_survival_auc.py and test_weighted_survival_auc.py.',
      'First run python -m pytest test_weighted_survival_auc.py -q.',
      'Modify fixed code and rerun tests; report rerun command and test result.',
    ].join(' '),
    artifacts: [{
      id: 'stale-script',
      type: 'notebook-timeline',
      ref: 'fixed_inverse_square_decay.py',
    }],
    uiState: {
      currentReferences: [{ ref: 'artifact:stale-script', title: 'fixed_inverse_square_decay.py' }],
    },
  });

  assert.equal(payload, undefined);
});

test('local reproducible method runtime ignores stale refs even with minor input prefix noise', async () => {
  const payload = await tryRunLocalReproducibleMethodRuntime({
    skillDomain: 'literature',
    prompt: 'aDebug weighted_survival_auc.py; run pytest, fix the bug, and rerun tests with evidence.',
    artifacts: [{
      id: 'stale-script',
      type: 'notebook-timeline',
      ref: 'fixed_inverse_square_decay.py',
    }],
    uiState: {
      currentReferences: [{ ref: 'artifact:stale-script', title: 'fixed_inverse_square_decay.py' }],
    },
  });

  assert.equal(payload, undefined);
});

test('local reproducible method runtime still exports scripts with fixed in the filename', async () => {
  const payload = await tryRunLocalReproducibleMethodRuntime({
    skillDomain: 'literature',
    prompt: 'Export fixed_inverse_square_decay.py as a script artifact and list rerun commands.',
    artifacts: [{
      id: 'fixed-script',
      type: 'notebook-timeline',
      ref: 'fixed_inverse_square_decay.py',
    }],
    uiState: {},
  });

  assert.ok(payload);
  assert.match(payload.message, /fixed_inverse_square_decay\.py/);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.local-reproducible-method.export-existing-script');
});
