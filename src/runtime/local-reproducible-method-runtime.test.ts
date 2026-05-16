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
  assert.match(payload.message, /no AgentServer generation/);
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
