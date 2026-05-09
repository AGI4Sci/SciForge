import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  allScientificPlotRequirementFixtures,
  basicPlotlyScatterLineFixture,
  distributionAndErrorBarFixture,
  heatmapCorrelationMatrixFixture,
  modelEvalFixture,
  omicsPresetFixture,
} from './fixtures/basic';
import { emptyPlotlySpecFixture } from './fixtures/empty';
import { multiPanelPublicationFigureFixture, publicationExportProfileFixture } from './fixtures/publication';
import { selectionPlotlySpecFixture } from './fixtures/selection';
import { manifest } from './manifest';
import { renderScientificPlotViewer } from './render';

test('scientific-plot-viewer exposes Plotly-first manifest contract', () => {
  assert.equal(manifest.componentId, 'scientific-plot-viewer');
  assert.deepEqual(manifest.acceptsArtifactTypes, ['plot-spec', 'point-set', 'matrix', 'record-set', 'time-series']);
  assert.ok(manifest.interactionEvents?.includes('edit-annotation'));
  assert.equal(manifest.safety?.executesCode, false);
});

test('scientific-plot-viewer renders basic Plotly trace contract', () => {
  const html = renderToStaticMarkup(<>{renderScientificPlotViewer(basicPlotlyScatterLineFixture)}</>);
  assert.match(html, /Dose response over time with confidence band/);
  assert.match(html, /treated mean: scatter, markers\+lines, 5 points/);
  assert.match(html, /control: scatter, lines, 5 points/);
});

test('scientific-plot-viewer fixtures cover T080 first-phase plot families', () => {
  assert.equal(allScientificPlotRequirementFixtures.length, 5);
  assert.match(renderToStaticMarkup(<>{renderScientificPlotViewer(distributionAndErrorBarFixture)}</>), /assay mean: bar/);
  assert.match(renderToStaticMarkup(<>{renderScientificPlotViewer(heatmapCorrelationMatrixFixture)}</>), /correlation: heatmap/);
  assert.match(renderToStaticMarkup(<>{renderScientificPlotViewer(omicsPresetFixture)}</>), /UMAP: scattergl, markers, 5 points/);
  assert.match(renderToStaticMarkup(<>{renderScientificPlotViewer(modelEvalFixture)}</>), /ROC AUC=0.91/);
});

test('scientific-plot-viewer renders selection and export metadata', () => {
  const selectionHtml = renderToStaticMarkup(<>{renderScientificPlotViewer(selectionPlotlySpecFixture)}</>);
  assert.match(selectionHtml, /Selection: 2 points/);
  assert.match(selectionHtml, /Annotations: 1/);

  const exportHtml = renderToStaticMarkup(<>{renderScientificPlotViewer(publicationExportProfileFixture)}</>);
  assert.match(exportHtml, /Export profile: renderer=plotly/);
  assert.match(exportHtml, /format=svg/);
  assert.match(exportHtml, /Fallback renderers: matplotlib:advanced-publication-export/);
});

test('scientific-plot-viewer renders publication figure metadata', () => {
  const html = renderToStaticMarkup(<>{renderScientificPlotViewer(multiPanelPublicationFigureFixture)}</>);
  assert.match(html, /Figure 1. Interferon response overview/);
  assert.match(html, /4 publication panels/);
  assert.match(html, /Panel A: plot-spec/);
  assert.match(html, /format=pdf/);
});

test('scientific-plot-viewer renders empty state through shell helper', () => {
  const html = renderToStaticMarkup(<>{renderScientificPlotViewer({
    ...emptyPlotlySpecFixture,
    helpers: {
      ComponentEmptyState: ({ componentId, title }) => <p>{title} for {componentId}</p>,
    },
  })}</>);
  assert.match(html, /No Plotly traces for scientific-plot-viewer/);
});

test('scientific plotting schemas expose Plotly source state and derived fallback metadata', () => {
  const plotSchema = JSON.parse(readFileSync(new URL('../schemas/plot-spec.schema.json', import.meta.url), 'utf8'));
  const figureSchema = JSON.parse(readFileSync(new URL('../schemas/figure-spec.schema.json', import.meta.url), 'utf8'));
  const exportSchema = JSON.parse(readFileSync(new URL('../schemas/export-artifact.schema.json', import.meta.url), 'utf8'));

  assert.ok(plotSchema.properties.plotly.properties.data);
  assert.ok(plotSchema.properties.plotly.properties.layout);
  assert.ok(plotSchema.properties.plotly.properties.config);
  assert.ok(plotSchema.properties.plotly.properties.frames);
  assert.ok(plotSchema.properties.plotly.properties.selection);
  assert.ok(plotSchema.properties.plotly.properties.annotations);
  assert.ok(plotSchema.properties.plotly.properties.exportProfile);
  assert.ok(plotSchema.properties.plotly.properties.fallbackRenderers);
  assert.equal(figureSchema.properties.exportProfile.properties.renderer.const, 'plotly');
  assert.ok(exportSchema.properties.exports.items.properties.derivedFrom);
});
