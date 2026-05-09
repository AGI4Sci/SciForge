import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  blockedInteractiveViewDesignForIntent,
  componentMatchesInteractiveViewFocus,
  compactInteractiveViewPlanItems,
  composeRuntimeUiManifestSlots,
  directAnswerPlainTextResultPolicy,
  directAnswerResultPolicyIds,
  ensureDirectAnswerReportArtifactPolicy,
  existingArtifactFollowupPreferredView,
  existingArtifactFollowupPromptPolicy,
  existingArtifactFollowupUiManifest,
  expectedArtifactTypesForIntent,
  findBestInteractiveArtifactForModule,
  findBestInteractiveArtifactForType,
  findBestInteractiveViewModuleForArtifactType,
  findInteractiveViewModuleForObjectReference,
  findRenderableInteractiveArtifact,
  inferDisplayIntentFromInteractiveArtifacts,
  interactiveArtifactDownloadItems,
  interactiveArtifactInspectorTablePolicy,
  interactiveResultSlotSubtitle,
  interactiveUnknownComponentFallbackPolicy,
  interactiveViewComponentRank,
  interactiveViewCompatibilityAliases,
  interactiveViewManifests,
  interactiveViewPackageRendererForComponent,
  interactiveViewPlanSourceIds,
  markdownTextForDirectAnswerArtifact,
  normalizeDirectAnswerArtifacts,
  normalizeDirectAnswerUiManifest,
  paperCardListPresentationPolicy,
  preferredExistingArtifactFollowupArtifact,
  preferredInteractiveViewComponentForArtifactType,
  preferredInteractiveViewComponentForPreviewKind,
  previewPackageAutoRunPromptPolicy,
  repairDiagnosticViewSlotPolicy,
  reportRuntimeResultViewSlots,
  resolveInteractiveViewPlanSection,
  selectedViewComponentsForIntent,
  standaloneWorkspaceArtifactPayloadPolicy,
  structureSummaryMetricPresentation,
  stripDirectAnswerJsonFence,
  uiComponentCompatibilityAliases,
  uiComponentManifests,
  validateInteractiveViewModuleBinding,
  visionSenseTraceOutputViews,
} from './index';

test('interactive views alias preserves ui-components registry compatibility', () => {
  assert.equal(interactiveViewManifests, uiComponentManifests);
  assert.equal(interactiveViewCompatibilityAliases, uiComponentCompatibilityAliases);
  assert.ok(interactiveViewManifests.some((manifest) => manifest.componentId === 'record-table'));
  assert.ok(uiComponentCompatibilityAliases.some((alias) => alias.legacyComponentId === 'data-table'));
});

test('interactive view renderer mapping owns package renderer aliases and fallback labels', () => {
  const alias = interactiveViewPackageRendererForComponent('data-table');
  assert.equal(alias?.activeComponentId, 'record-table');
  assert.equal(alias?.label, 'Record table');
  assert.equal(typeof alias?.render, 'function');
  assert.equal(interactiveViewPackageRendererForComponent('scientific-plot-viewer')?.label, 'Scientific plot viewer');

  const fallback = interactiveUnknownComponentFallbackPolicy({
    componentId: 'custom-result-view',
    artifactRef: 'missing-artifact',
    artifactFound: false,
  });
  assert.equal(fallback.title, '未注册组件');
  assert.match(fallback.detail, /通用 inspector/);
  assert.match(fallback.missingArtifactDetail ?? '', /missing-artifact/);
  assert.equal(interactiveUnknownComponentFallbackPolicy({
    componentId: 'custom-view',
    slotTitle: 'Custom slot',
  }).title, 'Custom slot');
});

test('interactive view renderer mapping owns artifact table, download, and subtitle policy', () => {
  const table = interactiveArtifactInspectorTablePolicy({
    rows: [
      { sample: 'A', score: 1, hidden: 'x' },
      { sample: 'B', score: 2, extra: true },
    ],
  }, { columnLimit: 2, rowLimit: 1 });
  assert.deepEqual(table.columns, ['sample', 'score']);
  assert.equal(table.rowLimit, 1);
  assert.equal(table.gridTemplateColumns, 'repeat(2, minmax(120px, 1fr))');

  assert.deepEqual(interactiveArtifactDownloadItems({
    id: 'artifact',
    type: 'record-set',
    producerScenario: 'demo',
    schemaVersion: '1',
    data: {
      downloads: [
        { filename: 'rows.csv', contentType: 'text/csv', rowCount: 2, content: 'sample,score\nA,1' },
        { filename: 'empty.txt', content: '' },
      ],
    },
  }), [{
    key: undefined,
    name: 'rows.csv',
    path: undefined,
    contentType: 'text/csv',
    rowCount: 2,
    content: 'sample,score\nA,1',
  }]);

  assert.equal(interactiveResultSlotSubtitle({
    status: 'missing-artifact',
    slot: {},
    module: { componentId: 'record-table', title: 'Record table', acceptsArtifactTypes: ['record-set'] },
  }), '等待 record-set');
});

test('runtime ui manifest policy composes package-owned view semantics', () => {
  const artifacts = [{ id: 'knowledge-graph', type: 'knowledge-graph' }];
  const manifest = composeRuntimeUiManifestSlots(
    [{ componentId: 'graph-viewer', artifactRef: 'knowledge-graph', priority: 1 }],
    artifacts,
    {
      skillDomain: 'knowledge',
      prompt: 'BRAF V600E target prioritization，只展示 data table、evidence matrix 和 execution unit，不需要网络图。',
    },
  );

  assert.deepEqual(
    manifest.map((slot) => slot.componentId),
    ['record-table', 'evidence-matrix', 'execution-unit-table'],
  );
  assert.equal(manifest[0].artifactRef, 'knowledge-graph');
});

test('runtime ui manifest policy infers package view encoding and layout', () => {
  const manifest = composeRuntimeUiManifestSlots(
    [],
    [{ id: 'omics-differential-expression', type: 'omics-differential-expression' }],
    {
      skillDomain: 'omics',
      prompt: '展示 UMAP，按 cellCycle 着色，按 batch 分组，并排对比。',
    },
  );

  assert.equal(manifest[0].componentId, 'point-set-viewer');
  assert.equal(manifest[0].artifactRef, 'omics-differential-expression');
  assert.equal((manifest[0].encoding as Record<string, unknown>).colorBy, 'cellCycle');
  assert.equal((manifest[0].encoding as Record<string, unknown>).splitBy, 'batch');
  assert.equal((manifest[0].layout as Record<string, unknown>).mode, 'side-by-side');
});

test('interactive view policy owns prompt artifact intent and component binding', () => {
  const artifactTypes = expectedArtifactTypesForIntent({
    scenarioId: 'biomedical-knowledge-graph',
    prompt: '比较 KRAS 文献证据，并联动蛋白结构和知识图谱。',
    selectedComponentIds: ['graph-viewer', 'structure-viewer', 'evidence-matrix'],
  });

  assert.deepEqual(new Set(artifactTypes), new Set(['paper-list', 'evidence-matrix', 'structure-summary', 'knowledge-graph']));
  assert.deepEqual(
    selectedViewComponentsForIntent('展示 evidence matrix 和 network graph', ['evidence-matrix', 'graph-viewer']),
    ['evidence-matrix', 'graph-viewer'],
  );
});

test('interactive view policy owns result focus and component ranking', () => {
  assert.equal(componentMatchesInteractiveViewFocus('graph-viewer', 'results'), true);
  assert.equal(componentMatchesInteractiveViewFocus('evidence-matrix', 'results'), false);
  assert.equal(interactiveViewComponentRank('report-viewer') < interactiveViewComponentRank('record-table'), true);
});

test('interactive view policy owns preview descriptor view choice', () => {
  assert.equal(preferredInteractiveViewComponentForPreviewKind('markdown'), 'report-viewer');
  assert.equal(preferredInteractiveViewComponentForPreviewKind('structure'), 'structure-viewer');
  assert.equal(preferredInteractiveViewComponentForPreviewKind('table'), 'record-table');
  assert.equal(preferredInteractiveViewComponentForPreviewKind('binary'), 'unknown-artifact-inspector');
});

test('interactive view policy owns preview package auto-run prompt copy', () => {
  const prompt = previewPackageAutoRunPromptPolicy({
    reference: {
      id: 'file-data',
      title: 'data.xyz',
      kind: 'file',
      ref: 'workspace://inputs/data.xyz',
      status: 'available',
    },
    descriptor: {
      kind: 'binary',
      source: 'path',
      ref: 'workspace://inputs/data.xyz',
      inlinePolicy: 'unsupported',
      mimeType: 'chemical/x-xyz',
      actions: [],
    },
  });

  assert.match(prompt, /preview package/);
  assert.match(prompt, /文件扩展名：xyz/);
  assert.match(prompt, /packages\/presentation\/components/);
});

test('interactive view policy owns structure summary metric presentation', () => {
  const metrics = structureSummaryMetricPresentation({
    pocketVolume: 42,
    pLDDT: 91.5,
    method: 'AlphaFold DB',
  });

  assert.deepEqual(metrics.rows.map((row) => row.label), ['Pocket volume', 'pLDDT mean', 'Method']);
  assert.equal(metrics.rows[0]?.value, '42 A3');
  assert.equal(metrics.emptyState, undefined);

  assert.deepEqual(structureSummaryMetricPresentation({}).emptyState, {
    title: '没有结构指标',
    detail: 'structure-summary 未提供 metrics；UI 不再填充默认分辨率或 pLDDT。',
  });
});

test('interactive view policy owns result binding, section, and presentation dedupe', () => {
  const reportViewer = interactiveViewManifests.find((module) => module.componentId === 'report-viewer');
  const structureViewer = interactiveViewManifests.find((module) => module.componentId === 'structure-viewer');
  assert.ok(reportViewer);
  assert.ok(structureViewer);

  assert.equal(validateInteractiveViewModuleBinding(reportViewer, undefined).status, 'missing-artifact');
  assert.equal(
    validateInteractiveViewModuleBinding(reportViewer, {
      id: 'report-empty',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      data: {},
    }).status,
    'missing-fields',
  );
  assert.equal(resolveInteractiveViewPlanSection({
    module: reportViewer,
    displayIntent: { primaryGoal: 'report', requiredArtifactTypes: ['research-report'] },
    artifact: {
      id: 'report-ready',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      data: { markdown: '# Ready' },
    },
  }), 'primary');

  const weakerArtifact = {
    id: 'semantic-html',
    type: 'structure-3d-html',
    producerScenario: 'structure-preview',
    schemaVersion: '1',
    dataRef: 'workspace://same.html',
    metadata: { accession: '1ABC' },
  };
  const strongerArtifact = {
    id: 'backend-pdb',
    type: 'pdb-file',
    producerScenario: 'structure-preview',
    schemaVersion: '1',
    dataRef: 'workspace://same.pdb',
    metadata: { accession: '1ABC' },
  };
  const compacted = compactInteractiveViewPlanItems([
    {
      id: 'supporting-structure-viewer-semantic-html',
      slot: { componentId: 'structure-viewer', artifactRef: weakerArtifact.id, priority: 5 },
      module: structureViewer,
      artifact: weakerArtifact,
      section: 'supporting',
      source: 'artifact-inferred',
      status: 'bound',
    },
    {
      id: 'primary-structure-viewer-backend-pdb',
      slot: { componentId: 'structure-viewer', artifactRef: strongerArtifact.id, priority: 1 },
      module: structureViewer,
      artifact: strongerArtifact,
      section: 'primary',
      source: 'display-intent',
      status: 'bound',
    },
  ]);

  assert.deepEqual(compacted.map((item) => item.artifact?.id), ['backend-pdb']);
});

test('interactive view policy owns resolver artifact and module selection semantics', () => {
  const reportViewer = interactiveViewManifests.find((module) => module.componentId === 'report-viewer');
  assert.ok(reportViewer);

  const reportArtifact = {
    id: 'report-ready',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    path: '/workspace/report.md',
    data: { markdown: '# Ready' },
  };
  const opaqueArtifact = {
    id: 'opaque-result',
    type: 'opaque-result',
    producerScenario: 'custom-runner',
    schemaVersion: '1',
    dataRef: 'workspace://artifacts/opaque.json',
  };

  const displayIntent = inferDisplayIntentFromInteractiveArtifacts([reportArtifact], interactiveViewManifests);
  assert.deepEqual(displayIntent.requiredArtifactTypes, ['research-report']);
  assert.deepEqual(displayIntent.preferredModules, [reportViewer.moduleId]);
  assert.equal(displayIntent.source, 'fallback-inference');

  assert.equal(
    findBestInteractiveViewModuleForArtifactType(interactiveViewManifests, 'research-report')?.componentId,
    'report-viewer',
  );
  assert.equal(findBestInteractiveArtifactForModule([reportArtifact], reportViewer)?.id, 'report-ready');
  assert.equal(findBestInteractiveArtifactForType([reportArtifact], 'report-ready')?.type, 'research-report');
  assert.equal(findRenderableInteractiveArtifact([reportArtifact], '/workspace/report.md')?.id, 'report-ready');
  assert.equal(
    findInteractiveViewModuleForObjectReference({
      reference: { preferredView: 'report-viewer' },
      artifact: reportArtifact,
      modules: interactiveViewManifests,
    })?.componentId,
    'report-viewer',
  );

  const blocked = blockedInteractiveViewDesignForIntent({
    displayIntent: { primaryGoal: 'custom result', requiredArtifactTypes: ['opaque-result'] },
    artifacts: [opaqueArtifact],
    items: [],
    modules: [reportViewer],
    resumeRunId: 'run-custom',
  });
  assert.equal(blocked?.requiredModuleCapability, 'render opaque-result as primary result');
  assert.equal(blocked?.resumeRunId, 'run-custom');
  assert.equal(interactiveViewPlanSourceIds.runtimeManifest, 'runtime-manifest');
});

test('paper-card-list component policy owns paper-list presentation semantics', () => {
  const papers = paperCardListPresentationPolicy({
    slot: {
      componentId: 'paper-card-list',
      transform: [{ type: 'limit', value: 1 }],
    },
    artifact: {
      id: 'paper-list-result',
      type: 'paper-list',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
      data: {
        rows: [
          { name: 'Rows fallback paper', venue: 'Package Policy Conf', year: 2026, evidenceLevel: 'review' },
          { title: 'Hidden by limit', source: 'Overflow' },
        ],
      },
    },
  });

  assert.deepEqual(papers, [{
    title: 'Rows fallback paper',
    source: 'Package Policy Conf',
    year: '2026',
    url: undefined,
    evidenceLevel: 'review',
  }]);
});

test('interactive view policy owns report runtime result slots', () => {
  assert.deepEqual(
    reportRuntimeResultViewSlots('digest-report', 'knowledge-runtime-result'),
    [
      { componentId: 'report-viewer', artifactRef: 'digest-report', priority: 1 },
      { componentId: 'execution-unit-table', artifactRef: 'knowledge-runtime-result', priority: 2 },
    ],
  );
  assert.deepEqual(repairDiagnosticViewSlotPolicy({ skillDomain: 'literature' }), {
    componentId: 'execution-unit-table',
    title: 'Execution units',
    artifactRef: 'literature-runtime-result',
    priority: 1,
  });
});

test('direct answer result policy owns report artifact and view selection semantics', () => {
  assert.equal(directAnswerResultPolicyIds.directTextTool, 'agentserver.direct-text');
  assert.equal(directAnswerResultPolicyIds.workspaceArtifactJsonTool, 'workspace-task.artifact-json');
  const plain = directAnswerPlainTextResultPolicy('Final markdown report', {
    skillDomain: 'literature',
    prompt: '请总结成报告',
    expectedArtifactTypes: [],
  });
  assert.equal(plain.artifacts[0].type, 'research-report');
  assert.equal(plain.uiManifest[0].componentId, 'report-viewer');

  const runtimeOnly = directAnswerPlainTextResultPolicy('Done', {
    skillDomain: 'knowledge',
    prompt: 'quick answer',
    expectedArtifactTypes: [],
  });
  assert.deepEqual(
    runtimeOnly.uiManifest.map((slot) => slot.componentId),
    ['execution-unit-table', 'execution-unit-table'],
  );

  const ensured = ensureDirectAnswerReportArtifactPolicy({
    message: 'Updated answer',
    artifacts: [{ id: 'old', type: 'research-report', status: 'repair-needed' }],
    uiManifest: [{ componentId: 'execution-unit-table', artifactRef: 'run', priority: 1 }],
  }, {
    skillDomain: 'literature',
    prompt: 'summary please',
    expectedArtifactTypes: [],
  }, 'agentserver-structured-answer');
  assert.equal(ensured.artifacts.length, 1);
  assert.equal(ensured.artifacts[0].type, 'research-report');
  assert.equal(ensured.uiManifest[0].componentId, 'report-viewer');
  assert.equal(ensured.uiManifest[1].priority, 2);
});

test('direct answer result policy owns loose artifact component binding and normalization', () => {
  assert.equal(preferredInteractiveViewComponentForArtifactType('knowledge-graph'), 'graph-viewer');
  assert.equal(preferredInteractiveViewComponentForArtifactType('unregistered-result'), 'unknown-artifact-inspector');

  const artifacts = normalizeDirectAnswerArtifacts(undefined, 'Structured answer');
  assert.equal(artifacts[0].type, 'research-report');
  assert.equal((artifacts[0].data as Record<string, unknown>).markdown, 'Structured answer');

  const manifest = normalizeDirectAnswerUiManifest(
    { components: ['report-viewer', 'unknown-artifact-inspector'] },
    [{ id: 'updated-research-report', type: 'research-report' }],
  );
  assert.deepEqual(
    manifest.map((slot) => slot.artifactRef),
    ['updated-research-report', 'updated-research-report'],
  );

  const loosePayload = standaloneWorkspaceArtifactPayloadPolicy({
    id: 'kg-result',
    type: 'knowledge-graph',
    nodes: [{ id: 'BRAF' }],
  });
  assert.equal(loosePayload?.claimType, 'artifact-generation');
  assert.equal(loosePayload?.evidenceLevel, 'workspace-artifact');
  assert.equal(loosePayload?.uiManifest[0].componentId, 'graph-viewer');
  assert.equal(loosePayload?.executionUnits[0].tool, directAnswerResultPolicyIds.workspaceArtifactJsonTool);
  assert.deepEqual((loosePayload?.artifacts[0].data as Record<string, unknown>).nodes, [{ id: 'BRAF' }]);
  assert.equal(standaloneWorkspaceArtifactPayloadPolicy({ type: 'tool-payload' }), undefined);
  assert.equal(stripDirectAnswerJsonFence('```markdown\n# Report\n```'), '# Report');
});

test('direct answer result policy owns existing artifact follow-up semantics', () => {
  assert.equal(existingArtifactFollowupPromptPolicy('给我刚才报告的 markdown 格式'), true);
  assert.equal(existingArtifactFollowupPromptPolicy('重新检索最新论文'), false);

  const artifacts = [
    { id: 'table', type: 'data-table', data: { markdown: 'table markdown' } },
    { id: 'report', type: 'research-report', data: { markdown: '# Report' } },
  ];
  const preferred = preferredExistingArtifactFollowupArtifact(artifacts);
  assert.equal(preferred?.id, 'report');
  assert.equal(markdownTextForDirectAnswerArtifact(preferred ?? {}), '# Report');
  assert.deepEqual(existingArtifactFollowupUiManifest([], preferred ?? {}).map((slot) => slot.componentId), ['report-viewer']);
  assert.equal(existingArtifactFollowupPreferredView(preferred ?? {}), 'report-viewer');
});

test('interactive view policy owns vision-sense trace output views', () => {
  const views = visionSenseTraceOutputViews({
    includeTrace: true,
    refs: { execution: 'execution-ref', trace: 'trace-ref' },
  });

  assert.deepEqual(
    views.map((view) => view.componentId),
    ['execution-unit-table', 'unknown-artifact-inspector'],
  );
  assert.deepEqual(
    views.map((view) => view.artifactRef),
    ['execution-ref', 'trace-ref'],
  );
});
