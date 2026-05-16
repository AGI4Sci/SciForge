import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { tryRunLocalDataSensitivityRuntime } from './local-data-sensitivity-runtime.js';

test('local data sensitivity runtime computes bootstrap CI from an existing CSV artifact', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'sciforge-local-bootstrap-'));
  await writeFile(join(workspace, 'dataset.csv'), [
    'sample_id,treatment,batch,timepoint,measurement',
    's1,control,B1,0h,100',
    's2,control,B1,24h,104',
    's3,control,B2,48h,108',
    's4,drugA,B1,0h,115',
    's5,drugA,B1,24h,119',
    's6,drugA,B2,48h,123',
  ].join('\n'));

  const payload = await tryRunLocalDataSensitivityRuntime({
    skillDomain: 'omics',
    workspacePath: workspace,
    prompt: 'Add a bootstrap confidence interval sensitivity analysis for drugA-control treatment effect.',
    artifacts: [{
      id: 'dataset-csv',
      type: 'table',
      dataRef: 'dataset.csv',
    }],
    uiState: {},
  });

  assert.ok(payload);
  assert.equal(payload.executionUnits[0]?.tool, 'sciforge.local-data-sensitivity.bootstrap-ci');
  assert.equal(payload.artifacts[0]?.type, 'research-report');
  assert.match(payload.message, /Bootstrap 95% CI/);
  assert.match(payload.message, /no AgentServer generation/);
});
