import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  buildUIComponentArtifactTypeIndex,
  buildUIComponentRuntimeRegistry,
  uiComponentManifests,
  uiComponentRuntimeRegistry,
} from './index';

test('component package owns runtime registry compatibility aliases', () => {
  const registry = buildUIComponentRuntimeRegistry();
  const dataTable = registry.find((module) => module.componentId === 'data-table');
  const volcanoPlot = registry.find((module) => module.componentId === 'volcano-plot');

  assert.ok(dataTable);
  assert.equal(dataTable.moduleId, 'data-table');
  assert.equal(dataTable.packageName, '@sciforge-ui/record-table');
  assert.match(dataTable.docs.agentSummary, /compatibility alias for record-table/);
  assert.deepEqual(dataTable.acceptsArtifactTypes, registry.find((module) => module.componentId === 'record-table')?.acceptsArtifactTypes);

  assert.ok(volcanoPlot);
  assert.equal(volcanoPlot.moduleId, 'volcano-plot');
  assert.equal((volcanoPlot.fallbackModuleIds ?? []).includes('generic-data-table'), true);
});

test('component package exports a deduped runtime registry and alias artifact index', () => {
  const keys = uiComponentRuntimeRegistry.map((module) => `${module.moduleId}@${module.version}:${module.componentId}`);
  const index = buildUIComponentArtifactTypeIndex(uiComponentRuntimeRegistry);

  assert.equal(new Set(keys).size, keys.length);
  assert.ok(uiComponentRuntimeRegistry.length > uiComponentManifests.length);
  assert.deepEqual(index['data-table'], index['record-table']);
  assert.deepEqual(index['volcano-plot'], index['point-set-viewer']);
});
