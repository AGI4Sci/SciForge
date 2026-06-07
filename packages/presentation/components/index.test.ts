import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

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
  assert.ok(uiComponentManifests.some((module) => module.componentId === 'computer-use-control-plane'));
  assert.ok(uiComponentManifests.some((module) => module.componentId === 'image-evidence-viewer'));
  assert.equal(uiComponentManifests.some((module) => module.componentId === 'virtual-screen-viewer'), false);
  assert.deepEqual(index['computer-use-control-plane'], ['computer-use-control-plane', 'computer-use-user-control-plane', 'computer-use-session-control', 'computer-use-replay-control']);
  assert.deepEqual(index['image-evidence-viewer'], [
    'image-evidence',
    'annotation-crop',
    'screenshot',
    'browser-evidence',
    'window-capture',
    'screen-region',
    'artifact-image',
    'replay-frame',
    'computer-use-virtual-screen',
    'virtual-desktop-session',
    'computer-use-screen',
    'computer-use-replay',
  ]);
  assert.deepEqual(index['data-table'], index['record-table']);
  assert.deepEqual(index['volcano-plot'], index['point-set-viewer']);
});

test('component package public barrel does not expose retired VirtualAppScreen viewer', () => {
  const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /virtual-screen-viewer\/render/);
  assert.doesNotMatch(source, /renderVirtualScreenViewer|buildVirtualScreenInputIntentCommand|VirtualScreenPayload/);
});
