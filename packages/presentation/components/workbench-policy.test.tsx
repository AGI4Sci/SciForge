import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createElement, Fragment } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';

import {
  defaultWorkbenchRecommendationInput,
  defaultWorkbenchDemoContext,
  normalizeWorkbenchFixtureArtifact,
  renderPackageWorkbenchPreview,
  shouldBuildWorkbenchFigureQA,
  workbenchComponentFixtures,
  workbenchComponentRecommendationBoost,
  workbenchListEmptyLabels,
  workbenchModuleDisplayLabels,
} from './index';
import { uiComponentRuntimeRegistry } from './index';

test('component package owns workbench defaults and empty labels', () => {
  assert.equal(defaultWorkbenchRecommendationInput.artifactType, 'omics-differential-expression');
  assert.equal(defaultWorkbenchRecommendationInput.artifactSchemaText, 'points logFC negLogP gene');
  assert.equal(defaultWorkbenchDemoContext.scenarioId, 'literature-evidence-review');
  assert.equal(defaultWorkbenchDemoContext.fallbackArtifactType, 'runtime-artifact');
  assert.equal(workbenchListEmptyLabels.backendDecides, 'backend-decides');
  assert.equal(workbenchListEmptyLabels.noInteractionEvents, 'no interaction events declared');
});

test('component package owns workbench fixture and alias artifact policy', () => {
  const plotFixture = workbenchComponentFixtures['scientific-plot-viewer']?.basic;
  assert.equal(plotFixture?.artifact?.type, 'plot-spec');

  const normalized = normalizeWorkbenchFixtureArtifact('data-table', {
    id: 'record-table-basic',
    type: 'record-set',
    producerScenario: 'fixture',
    schemaVersion: '1',
    data: {},
  });

  assert.equal(normalized.id, 'de-table-mini');
  assert.equal(normalized.type, 'data-table');
});

test('component package owns workbench recommendation boosts and display labels', () => {
  const volcanoBoost = workbenchComponentRecommendationBoost({
    componentId: 'volcano-plot',
    fields: ['gene', 'logFC'],
  });
  const plotBoost = workbenchComponentRecommendationBoost({
    componentId: 'scientific-plot-viewer',
    artifactType: 'plot-spec',
    fields: [],
  });

  assert.equal(volcanoBoost.score, 3);
  assert.deepEqual(volcanoBoost.reasons, ['volcano fields matched']);
  assert.equal(plotBoost.score, 6);
  assert.deepEqual(
    workbenchModuleDisplayLabels(uiComponentRuntimeRegistry, ['scientific-plot-viewer', 'missing-package-module']),
    ['Scientific plot viewer', 'missing-package-module'],
  );
  assert.equal(shouldBuildWorkbenchFigureQA('publication-figure-builder'), true);
});

test('component package owns special workbench renderer selection', () => {
  const fixture = workbenchComponentFixtures['scientific-plot-viewer']?.basic;
  assert.ok(fixture);

  const html = renderToStaticMarkup(createElement(
    Fragment,
    null,
    renderPackageWorkbenchPreview(fixture, () => createElement('div', null, 'fallback renderer')),
  ));

  assert.match(html, /scientific-plot-viewer/);
  assert.doesNotMatch(html, /fallback renderer/);
});
