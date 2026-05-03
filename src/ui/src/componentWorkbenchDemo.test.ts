import assert from 'node:assert/strict';
import test from 'node:test';
import {
  availableWorkbenchDemoVariants,
  buildWorkbenchArtifactShapeExample,
  buildWorkbenchDemoRenderProps,
  buildWorkbenchFigureQA,
  buildWorkbenchInteractionEventLog,
  moduleHasWorkbenchDemo,
  recommendWorkbenchComponents,
} from './componentWorkbenchDemo';
import type { RuntimeArtifact, SciForgeConfig } from './domain';
import { uiModuleRegistry, type RuntimeUIModule } from './uiModuleRegistry';

const config: SciForgeConfig = {
  schemaVersion: 1,
  agentServerBaseUrl: 'http://127.0.0.1:8765',
  workspaceWriterBaseUrl: 'http://127.0.0.1:8766',
  workspacePath: '/tmp/sciforge-workbench-test',
  agentBackend: 'mock',
  modelProvider: 'openai',
  modelBaseUrl: 'https://api.openai.com/v1',
  modelName: 'gpt-test',
  apiKey: '',
  requestTimeoutMs: 1000,
  maxContextWindowTokens: 1000,
  updatedAt: '2026-05-03T00:00:00.000Z',
};

function moduleByComponentId(componentId: string) {
  const module = uiModuleRegistry.find((candidate) => candidate.componentId === componentId);
  assert.ok(module, `missing ${componentId} module`);
  return module;
}

test('workbench prefers package fixtures over manifest workbenchDemo for basic variant', () => {
  const module = moduleByComponentId('data-table');

  assert.deepEqual(availableWorkbenchDemoVariants(module), ['basic', 'empty', 'selection']);
  const props = buildWorkbenchDemoRenderProps(module, config, 'basic');

  assert.equal(props.slot.componentId, 'data-table');
  assert.equal(props.artifact?.id, 'de-table-mini');
  assert.equal(props.artifact?.type, 'data-table');
  assert.equal(props.session.artifacts[0]?.id, 'de-table-mini');
});

test('workbench loads empty package fixture without changing normal ResultsRenderer paths', () => {
  const module = moduleByComponentId('report-viewer');

  const props = buildWorkbenchDemoRenderProps(module, config, 'empty');

  assert.equal(props.slot.componentId, 'report-viewer');
  assert.equal(props.artifact?.id, 'report-empty');
  assert.equal(props.config, config);
  assert.equal(props.session.artifacts[0]?.id, 'report-empty');
});

test('workbench uses package fixture session for stateful components', () => {
  const module = moduleByComponentId('evidence-matrix');

  const props = buildWorkbenchDemoRenderProps(module, config, 'selection');

  assert.deepEqual(availableWorkbenchDemoVariants(module), ['basic', 'empty', 'selection']);
  assert.equal(props.slot.componentId, 'evidence-matrix');
  assert.equal(props.session.claims.some((claim) => claim.id === 'claim-ifit1-marker'), true);
});

test('workbench falls back to manifest demo when package fixtures are absent', () => {
  const module: RuntimeUIModule = {
    ...moduleByComponentId('paper-card-list'),
    componentId: 'manifest-only-demo',
    moduleId: 'manifest-only-demo',
    workbenchDemo: {
      artifactType: 'manifest-demo-artifact',
      artifactData: { ok: true },
    },
  };

  assert.deepEqual(availableWorkbenchDemoVariants(module), ['basic']);
  assert.equal(moduleHasWorkbenchDemo(module), true);
  const props = buildWorkbenchDemoRenderProps(module, config, 'selection');

  assert.equal(props.slot.componentId, 'manifest-only-demo');
  assert.equal(props.artifact?.id, `workbench-demo-${module.moduleId}`);
  assert.equal(props.artifact?.type, module.workbenchDemo?.artifactType);
});

test('workbench exposes package fixture variants and artifact shape for scientific plot viewer', () => {
  const module = moduleByComponentId('scientific-plot-viewer');

  assert.deepEqual(availableWorkbenchDemoVariants(module), ['basic']);
  const props = buildWorkbenchDemoRenderProps(module, config, 'basic');
  const shape = buildWorkbenchArtifactShapeExample(module, 'basic');
  const eventLog = buildWorkbenchInteractionEventLog(module, 'basic');

  assert.equal(props.artifact?.id, 'plot-basic-scatter-line');
  assert.equal(shape.artifactType, 'plot-spec');
  assert.equal(shape.requiredAnyFields[0]?.includes('plotSpec'), true);
  assert.equal(shape.requiredAnyFields[0]?.includes('exportProfile'), true);
  assert.match(eventLog.join('\n'), /select-point/);
});

test('workbench recommends components from artifact type and schema fields', () => {
  const recommendations = recommendWorkbenchComponents(uiModuleRegistry, {
    artifactType: 'omics-differential-expression',
    artifactSchema: { required: ['points', 'logFC', 'negLogP', 'gene'] },
  });

  assert.equal(recommendations[0]?.componentId, 'volcano-plot');
  assert.equal(recommendations[0]?.fallbackModuleIds.includes('generic-data-table'), true);
  assert.equal(recommendations.some((item) => item.componentId === 'scientific-plot-viewer'), false);

  const plotRecommendations = recommendWorkbenchComponents(uiModuleRegistry, {
    artifactType: 'plot-spec',
    artifactSchema: { required: ['data', 'layout', 'config'] },
  });
  assert.equal(plotRecommendations[0]?.componentId, 'scientific-plot-viewer');
});

test('workbench extracts figure QA for Plotly publication export artifacts', () => {
  const module = moduleByComponentId('scientific-plot-viewer');
  const publicationArtifact: RuntimeArtifact = {
    id: 'plot-publication-export',
    type: 'plot-spec',
    producerScenario: 'scientific-plot-smoke',
    schemaVersion: 'plotly-compatible.v1',
    metadata: { source: 'assay-results.csv' },
    data: {
      plotId: 'publication-export-profile',
      data: [
        { type: 'box', name: 'control', y: [1.1, 1.3, 1.4, 1.8], marker: { color: '#2563eb' } },
        { type: 'box', name: 'treated', y: [2.0, 2.2, 2.7, 3.1], marker: { color: '#dc2626' } },
      ],
      layout: {
        title: { text: 'Publication export profile demo' },
        font: { family: 'Arial', size: 9 },
        width: 720,
        height: 480,
        annotations: [{ text: 'A' }],
      },
      exportProfile: {
        renderer: 'plotly',
        format: 'svg',
        width: 720,
        height: 480,
        scale: 2,
        colorblindSafe: true,
      },
      statistics: { method: 'Welch t-test' },
    },
  };
  const qa = buildWorkbenchFigureQA(module, 'basic', publicationArtifact);
  const publicationModule: RuntimeUIModule = {
    ...module,
    componentId: 'publication-figure-builder',
    moduleId: 'publication-figure-builder',
    title: 'Publication figure builder',
  };
  const publicationQa = buildWorkbenchFigureQA(publicationModule, 'basic', publicationArtifact);

  assert.ok(qa);
  assert.deepEqual(publicationQa, qa);
  assert.equal(qa.size, '720 x 480px');
  assert.equal(qa.dpi, '2x export scale');
  assert.equal(qa.font, 'Arial, 9px');
  assert.equal(qa.palette, '#2563eb, #dc2626');
  assert.equal(qa.colorblindSafety, 'declared safe');
  assert.equal(qa.panelLabels, 'A');
  assert.equal(qa.vectorRasterStatus, 'vector (svg)');
  assert.equal(qa.dataSource, 'assay-results.csv');
  assert.equal(qa.statisticalMethod, 'Welch t-test');
});
