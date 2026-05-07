import assert from 'node:assert/strict';
import test from 'node:test';
import { scenarios } from '../../data';
import { resolveSearchNavigation, workbenchNavigationForScenario } from './navigation';

test('routes search queries matching scenario metadata to that scenario workbench', () => {
  assert.deepEqual(resolveSearchNavigation('run protein-structure pocket analysis', scenarios), {
    page: 'workbench',
    scenarioId: 'structure-exploration',
  });
});

test('routes timeline search aliases to the timeline page', () => {
  assert.deepEqual(resolveSearchNavigation('打开 notebook 时间线', scenarios), { page: 'timeline' });
  assert.deepEqual(resolveSearchNavigation('alignment history', scenarios), { page: 'timeline' });
});

test('keeps unknown non-empty searches on the workbench', () => {
  assert.deepEqual(resolveSearchNavigation('new experiment', scenarios), { page: 'workbench' });
  assert.equal(resolveSearchNavigation('   ', scenarios), undefined);
});

test('builds workbench navigation targets for a scenario', () => {
  assert.deepEqual(workbenchNavigationForScenario('custom-scenario'), {
    page: 'workbench',
    scenarioId: 'custom-scenario',
  });
});
