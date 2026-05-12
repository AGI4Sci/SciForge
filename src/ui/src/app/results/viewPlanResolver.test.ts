import assert from 'node:assert/strict';
import test from 'node:test';
import { itemsForFocusMode, resolveViewPlan, selectDefaultResultItems } from './viewPlanResolver';
import type { RuntimeArtifact, SciForgeRun, SciForgeSession } from '../../domain';

const baseSession = (overrides: Partial<SciForgeSession> = {}): SciForgeSession => ({
  schemaVersion: 2,
  sessionId: 'session-test',
  scenarioId: 'literature-evidence-review',
  title: 'Test session',
  createdAt: '2026-05-07T00:00:00.000Z',
  updatedAt: '2026-05-07T00:00:00.000Z',
  messages: [],
  runs: [],
  uiManifest: [],
  claims: [],
  executionUnits: [],
  artifacts: [],
  notebook: [],
  versions: [],
  ...overrides,
});

test('failed active run does not promote its artifacts as core results', () => {
  const staleReport: RuntimeArtifact = {
    id: 'research-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Stale report\n\nThis report belongs to an invalid failed run.' },
  };
  const activeRun: SciForgeRun = {
    id: 'run-failed-reference',
    scenarioId: 'literature-evidence-review',
    status: 'failed',
    prompt: 'Read the current referenced file and summarize it',
    response: 'failed-with-reason: current reference was not reflected',
    createdAt: '2026-05-07T00:00:01.000Z',
    completedAt: '2026-05-07T00:00:02.000Z',
    raw: {
      displayIntent: {
        primaryGoal: 'Show generated report',
        requiredArtifactTypes: ['research-report'],
        preferredModules: ['markdown-report-document'],
      },
    },
  };
  const session = baseSession({
    runs: [activeRun],
    artifacts: [staleReport],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report', title: 'Report' }],
  });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, activeRun, defaultSlots: [] });
  const { visibleItems, deferredItems } = selectDefaultResultItems(itemsForFocusMode(plan, 'all'), 'all');

  assert.equal([...visibleItems, ...deferredItems].some((item) => item.artifact?.id === 'research-report'), false);
});

test('latest failed run suppresses core artifacts after active run focus is restored empty', () => {
  const staleReport: RuntimeArtifact = {
    id: 'research-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Stale report' },
  };
  const failedRun: SciForgeRun = {
    id: 'run-latest-failed',
    scenarioId: 'literature-evidence-review',
    status: 'failed',
    prompt: 'Summarize the current referenced file',
    response: 'failed-with-reason: current reference was not reflected',
    createdAt: '2026-05-07T00:00:01.000Z',
  };
  const session = baseSession({
    runs: [failedRun],
    artifacts: [staleReport],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'research-report', title: 'Report' }],
  });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, defaultSlots: [] });
  const { visibleItems, deferredItems } = selectDefaultResultItems(itemsForFocusMode(plan, 'all'), 'all');

  assert.equal([...visibleItems, ...deferredItems].some((item) => item.artifact?.id === 'research-report'), false);
});

test('failed active run still exposes structured runtime diagnostic artifacts', () => {
  const staleReport: RuntimeArtifact = {
    id: 'research-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Stale report' },
  };
  const diagnostic: RuntimeArtifact = {
    id: 'literature-runtime-result',
    type: 'runtime-diagnostic',
    producerScenario: 'literature-evidence-review',
    schemaVersion: 'sciforge.runtime-diagnostic.v1',
    metadata: { status: 'repair-needed' },
    data: {
      status: 'repair-needed',
      message: 'AgentServer generated task failed before writing output JSON.',
      executionUnits: [{ id: 'unit-failed', status: 'repair-needed' }],
      recoverActions: ['inspect stderr'],
    },
  };
  const activeRun: SciForgeRun = {
    id: 'run-failed-diagnostic',
    scenarioId: 'literature-evidence-review',
    status: 'failed',
    prompt: 'Run task',
    response: 'failed-with-reason: task failed before output JSON',
    createdAt: '2026-05-07T00:00:01.000Z',
  };
  const session = baseSession({
    runs: [activeRun],
    executionUnits: [{
      id: 'unit-failed',
      tool: 'workspace-runtime-gateway.repair',
      params: '{}',
      status: 'repair-needed',
      hash: 'unit-failed',
    }],
    artifacts: [staleReport, diagnostic],
    uiManifest: [{ componentId: 'execution-unit-table', artifactRef: 'literature-runtime-result', title: 'Execution units' }],
  });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, activeRun, defaultSlots: [] });
  const allItems = itemsForFocusMode(plan, 'all');

  assert.equal(allItems.some((item) => item.artifact?.id === 'research-report'), false);
  assert.equal(allItems.some((item) => item.artifact?.id === 'literature-runtime-result'), true);
});

test('fallback display intent keeps artifact order instead of reading prompt semantics', () => {
  const matrix: RuntimeArtifact = {
    id: 'matrix-result',
    type: 'expression-matrix',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { rows: [] },
  };
  const report: RuntimeArtifact = {
    id: 'report-result',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Report' },
  };
  const activeRun: SciForgeRun = {
    id: 'run-semantic-prompt',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'Prefer a markdown report and PDB structure view',
    response: 'The answer mentions report, structure, and markdown.',
    createdAt: '2026-05-07T00:00:01.000Z',
  };
  const session = baseSession({
    runs: [activeRun],
    artifacts: [matrix, report],
  });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, activeRun, defaultSlots: [] });

  assert.deepEqual(plan.displayIntent.requiredArtifactTypes, ['expression-matrix', 'research-report']);
  assert.equal(plan.displayIntent.primaryGoal, '展示当前 session 的 runtime artifacts');
  assert.equal(plan.displayIntent.source, 'fallback-inference');
});

test('active run presentation scopes artifacts to that run', () => {
  const oldReport: RuntimeArtifact = {
    id: 'old-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Old report' },
  };
  const newReport: RuntimeArtifact = {
    id: 'new-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# New report' },
  };
  const oldRun: SciForgeRun = {
    id: 'run-old',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'old report',
    response: 'done',
    createdAt: '2026-05-07T00:00:01.000Z',
    objectReferences: [{ kind: 'artifact', ref: 'artifact:old-report', title: 'old report' }],
  } as never;
  const newRun: SciForgeRun = {
    id: 'run-new',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'new report',
    response: 'done',
    createdAt: '2026-05-07T00:00:02.000Z',
    objectReferences: [{ kind: 'artifact', ref: 'artifact:new-report', title: 'new report' }],
  } as never;
  const session = baseSession({
    runs: [oldRun, newRun],
    artifacts: [oldReport, newReport],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'new-report', title: 'Latest report' }],
  });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, activeRun: oldRun, defaultSlots: [] });

  assert.equal(plan.allItems.some((item) => item.artifact?.id === 'old-report'), true);
  assert.equal(plan.allItems.some((item) => item.artifact?.id === 'new-report'), false);
});

test('display intent and UI manifest selection outrank artifact type wording during presentation dedupe', () => {
  const pdbArtifact: RuntimeArtifact = {
    id: 'backend-selected-pdb',
    type: 'pdb-file',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: 'workspace://artifacts/backend-selected.pdb',
    metadata: { accession: 'same-structure' },
  };
  const htmlArtifact: RuntimeArtifact = {
    id: 'semantic-looking-html',
    type: 'structure-3d-html',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: 'workspace://artifacts/semantic-looking.html',
    metadata: { accession: 'same-structure' },
  };
  const activeRun: SciForgeRun = {
    id: 'run-backend-selected-artifact',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'Show the structure result',
    response: 'The backend selected a concrete artifact ref.',
    createdAt: '2026-05-07T00:00:01.000Z',
    raw: {
      displayIntent: {
        primaryGoal: 'Show backend selected PDB artifact',
        requiredArtifactTypes: ['pdb-file'],
        preferredModules: ['structure-viewer'],
      },
    },
  };
  const session = baseSession({
    runs: [activeRun],
    artifacts: [pdbArtifact, htmlArtifact],
    uiManifest: [{ componentId: 'structure-viewer', artifactRef: 'backend-selected-pdb', title: 'Backend selected structure' }],
  });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, activeRun, defaultSlots: [] });

  assert.equal(plan.allItems.some((item) => item.artifact?.id === 'backend-selected-pdb'), true);
  assert.equal(plan.allItems.some((item) => item.artifact?.id === 'semantic-looking-html'), false);
});

test('result presentation artifact actions can drive Results view selection', () => {
  const report: RuntimeArtifact = {
    id: 'analysis-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Analysis report' },
  };
  const activeRun: SciForgeRun = {
    id: 'run-result-presentation',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'Analyze data',
    response: 'Raw backend text should not decide the result pane.',
    createdAt: '2026-05-07T00:00:01.000Z',
    raw: {
      displayIntent: {
        resultPresentation: {
          answerBlocks: [{ id: 'answer-1', text: 'The report is ready.' }],
          artifactActions: [{ id: 'artifact-1', label: 'Open analysis report', artifactType: 'research-report', ref: 'artifact:analysis-report' }],
        },
      },
    },
  };
  const session = baseSession({
    runs: [activeRun],
    artifacts: [report],
  });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, activeRun, defaultSlots: [] });
  const displayIntentItems = plan.allItems.filter((item) => item.source === 'display-intent');

  assert.equal(plan.displayIntent.primaryGoal, 'Open analysis report');
  assert.deepEqual(plan.displayIntent.requiredArtifactTypes, ['research-report']);
  assert.equal(displayIntentItems.some((item) => item.artifact?.id === 'analysis-report'), true);
});

test('result presentation artifact actions preserve chart revision identity and view transforms', () => {
  const plot: RuntimeArtifact = {
    id: 'base-plot',
    type: 'plot-spec',
    producerScenario: 'data-analysis',
    schemaVersion: '1',
    data: {
      plotId: 'ifnb-response',
      data: [{ type: 'scatter', x: [0, 1], y: [1.2, 2.4] }],
      layout: { title: { text: 'IFNB response' } },
    },
  };
  const activeRun: SciForgeRun = {
    id: 'run-chart-revisions',
    scenarioId: 'omics-differential-exploration',
    status: 'completed',
    prompt: 'Revise chart axes and export',
    response: 'Chart revisions ready.',
    createdAt: '2026-05-07T00:00:01.000Z',
    raw: {
      displayIntent: {
        resultPresentation: {
          answerBlocks: [{ id: 'answer-1', text: 'Two chart revisions are ready.' }],
          artifactActions: [
            {
              id: 'axis-revision',
              label: 'Open axis revision',
              ref: 'artifact:base-plot',
              artifactType: 'plot-spec',
              componentId: 'scientific-plot-viewer',
              parentArtifactRef: 'artifact:base-plot',
              revision: 'r2',
              revisionRef: 'artifact:base-plot#r2',
              encoding: { x: 'time_hours', y: 'signal' },
              transform: [{ type: 'filter', field: 'condition', op: '=', value: 'treated' }],
              exportProfile: { format: 'png', renderer: 'plotly' },
            },
            {
              id: 'color-revision',
              label: 'Open color revision',
              ref: 'artifact:base-plot',
              artifactType: 'plot-spec',
              componentId: 'scientific-plot-viewer',
              parentArtifactRef: 'artifact:base-plot',
              revision: 'r3',
              revisionRef: 'artifact:base-plot#r3',
              encoding: { x: 'time_hours', y: 'signal', colorBy: 'replicate' },
              transform: [{ type: 'filter', field: 'condition', op: '=', value: 'control' }],
              exportProfile: { format: 'svg', renderer: 'plotly' },
            },
          ],
        },
      },
    },
  } as never;
  const session = baseSession({
    scenarioId: 'omics-differential-exploration',
    runs: [activeRun],
    artifacts: [plot],
  });

  const plan = resolveViewPlan({ scenarioId: 'omics-differential-exploration', session, activeRun, defaultSlots: [] });
  const chartItems = plan.allItems.filter((item) => item.source === 'display-intent' && item.artifact?.id === 'base-plot');

  assert.equal(chartItems.length, 2);
  const axisRevision = chartItems.find((item) => item.slot.title === 'Open axis revision');
  const colorRevision = chartItems.find((item) => item.slot.title === 'Open color revision');
  assert.ok(axisRevision);
  assert.ok(colorRevision);
  assert.deepEqual(axisRevision.slot.encoding, { x: 'time_hours', y: 'signal' });
  assert.deepEqual(colorRevision.slot.encoding, { x: 'time_hours', y: 'signal', colorBy: 'replicate' });
  assert.deepEqual(axisRevision.slot.transform, [{ type: 'filter', field: 'condition', op: '=', value: 'treated' }]);
  assert.equal((axisRevision.slot.props?.artifactIdentity as Record<string, unknown>).parentArtifactRef, 'artifact:base-plot');
  assert.equal((axisRevision.slot.props?.artifactIdentity as Record<string, unknown>).revisionRef, 'artifact:base-plot#r2');
  const transformParams = (axisRevision.slot.props?.artifactIdentity as Record<string, unknown>).transformParams as Record<string, unknown>;
  assert.deepEqual(transformParams.exportProfile, { format: 'png', renderer: 'plotly' });
});

test('result presentation artifact actions keep active run scope across mixed artifacts', () => {
  const oldReport: RuntimeArtifact = {
    id: 'old-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Old scoped report' },
  };
  const oldPapers: RuntimeArtifact = {
    id: 'old-papers',
    type: 'paper-list',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { papers: [{ title: 'Scoped paper' }] },
  };
  const oldDiagnostic: RuntimeArtifact = {
    id: 'old-diagnostic',
    type: 'runtime-diagnostic',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { status: 'partial', message: 'verification is partial' },
  };
  const oldVerification: RuntimeArtifact = {
    id: 'old-verification',
    type: 'verification-result',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { verdict: 'uncertain' },
  };
  const newReport: RuntimeArtifact = {
    id: 'new-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# New report' },
  };
  const oldRun: SciForgeRun = {
    id: 'run-old-mixed',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'old mixed artifacts',
    response: 'done',
    createdAt: '2026-05-07T00:00:01.000Z',
    objectReferences: [
      { kind: 'artifact', ref: 'artifact:old-report', title: 'old report' },
      { kind: 'artifact', ref: 'artifact:old-papers', title: 'old papers' },
      { kind: 'artifact', ref: 'artifact:old-diagnostic', title: 'old diagnostic' },
      { kind: 'artifact', ref: 'artifact:old-verification', title: 'old verification' },
    ],
    raw: {
      displayIntent: {
        resultPresentation: {
          answerBlocks: [{ id: 'answer-1', text: 'Mixed artifacts are available.' }],
          artifactActions: [
            { id: 'papers', label: 'Compare paper list', ref: 'artifact:old-papers', artifactType: 'paper-list' },
            { id: 'report', label: 'Open report', ref: 'artifact:old-report', artifactType: 'research-report' },
            { id: 'diagnostic', label: 'Inspect diagnostic', ref: 'artifact:old-diagnostic', artifactType: 'runtime-diagnostic' },
            { id: 'verification', label: 'Inspect verification', ref: 'artifact:old-verification', artifactType: 'verification-result' },
          ],
        },
      },
    },
  } as never;
  const newRun: SciForgeRun = {
    id: 'run-new-mixed',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'new report',
    response: 'done',
    createdAt: '2026-05-07T00:00:02.000Z',
    objectReferences: [{ kind: 'artifact', ref: 'artifact:new-report', title: 'new report' }],
  } as never;
  const session = baseSession({
    runs: [oldRun, newRun],
    artifacts: [oldReport, oldPapers, oldDiagnostic, oldVerification, newReport],
  });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, activeRun: oldRun, defaultSlots: [] });
  const allItems = itemsForFocusMode(plan, 'all');
  const visualItems = itemsForFocusMode(plan, 'visual');

  assert.equal(allItems.some((item) => item.artifact?.id === 'new-report'), false);
  assert.ok(allItems.some((item) => item.artifact?.id === 'old-papers'));
  assert.ok(allItems.some((item) => item.artifact?.id === 'old-report'));
  assert.ok(allItems.some((item) => item.artifact?.id === 'old-diagnostic'));
  assert.ok(allItems.some((item) => item.artifact?.id === 'old-verification'));
  assert.deepEqual(
    allItems.filter((item) => item.source === 'display-intent').map((item) => item.artifact?.id),
    ['old-report', 'old-papers', 'old-diagnostic', 'old-verification'],
  );
  assert.equal(visualItems.some((item) => item.artifact?.id === 'new-report'), false);
  assert.ok(visualItems.some((item) => item.artifact?.id === 'old-report'));
});

test('required artifact type matching is exact and does not invent structure-family aliases', () => {
  const pdbArtifact: RuntimeArtifact = {
    id: 'pdb-result',
    type: 'pdb-file',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: 'workspace://artifacts/result.pdb',
    metadata: { accession: '1abc' },
  };
  const activeRun: SciForgeRun = {
    id: 'run-exact-artifact-type',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'Show the structure',
    response: 'The backend requested an artifact type that was not produced.',
    createdAt: '2026-05-07T00:00:01.000Z',
    raw: {
      displayIntent: {
        primaryGoal: 'Show required structure artifact',
        requiredArtifactTypes: ['structure'],
        preferredModules: [],
      },
    },
  };
  const session = baseSession({
    runs: [activeRun],
    artifacts: [pdbArtifact],
  });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, activeRun, defaultSlots: [] });
  const displayIntentItems = plan.allItems.filter((item) => item.source === 'display-intent');

  assert.equal(displayIntentItems.some((item) => item.artifact?.id === 'pdb-result'), false);
  assert.equal(displayIntentItems.length, 0);
});
