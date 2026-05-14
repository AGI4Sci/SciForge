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

function deliveryArtifact(artifact: RuntimeArtifact, readableRef: string, role: NonNullable<RuntimeArtifact['delivery']>['role'] = 'primary-deliverable'): RuntimeArtifact {
  const extension = readableRef.split(/[?#]/)[0]?.split('.').pop()?.toLowerCase() || 'md';
  return {
    ...artifact,
    dataRef: readableRef,
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: `artifact:${artifact.id}`,
      role,
      declaredMediaType: extension === 'md' || extension === 'markdown' ? 'text/markdown' : extension === 'csv' ? 'text/csv' : extension === 'html' ? 'text/html' : 'application/octet-stream',
      declaredExtension: extension,
      contentShape: ['pdf', 'pdb', 'cif'].includes(extension) ? 'binary-ref' : 'raw-file',
      readableRef,
      rawRef: '.sciforge/sessions/session/task-results/output.json',
      previewPolicy: ['pdf', 'pdb', 'cif'].includes(extension) ? 'open-system' : 'inline',
    },
  };
}

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

test('completed run does not promote bare file object references as main artifacts', () => {
  const completedRun: SciForgeRun = {
    id: 'run-readable-files',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'Write report',
    response: 'Report complete',
    createdAt: '2026-05-07T00:00:01.000Z',
    objectReferences: [{
      id: 'file-report',
      title: 'generated-report.md',
      kind: 'file',
      ref: 'file:.sciforge/sessions/session/task-results/generated-report.md',
      runId: 'run-readable-files',
      status: 'available',
      presentationRole: 'primary-deliverable',
      provenance: { path: '.sciforge/sessions/session/task-results/generated-report.md' },
    }],
  };
  const session = baseSession({ runs: [completedRun] });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, activeRun: completedRun, defaultSlots: [] });
  const { visibleItems, deferredItems } = selectDefaultResultItems(itemsForFocusMode(plan, 'all'), 'all');
  const items = [...visibleItems, ...deferredItems];

  assert.equal(items.some((item) => item.input?.kind === 'markdown'), false);
  assert.equal(items.some((item) => item.input?.ref === '.sciforge/sessions/session/task-results/generated-report.md'), false);
});

test('completed run promotes delivery-backed artifacts as main results', () => {
  const completedRun: SciForgeRun = {
    id: 'run-delivery-artifact',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'Write report',
    response: 'Report complete',
    createdAt: '2026-05-07T00:00:01.000Z',
    objectReferences: [{ id: 'artifact-report', title: 'Report', kind: 'artifact', ref: 'artifact:delivery-report', status: 'available' }],
  } as never;
  const session = baseSession({
    runs: [completedRun],
    artifacts: [deliveryArtifact({
      id: 'delivery-report',
      type: 'research-report',
      producerScenario: 'literature-evidence-review',
      schemaVersion: '1',
    }, '.sciforge/sessions/session/task-results/generated-report.md')],
  });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, activeRun: completedRun, defaultSlots: [] });
  const items = itemsForFocusMode(plan, 'all');

  assert.equal(items.some((item) => item.input?.kind === 'markdown'), true);
  assert.equal(items.some((item) => item.input?.ref === '.sciforge/sessions/session/task-results/generated-report.md'), true);
});

test('failed active run without projection keeps runtime diagnostic artifacts out of the main plan', () => {
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
  assert.equal(allItems.some((item) => item.artifact?.id === 'literature-runtime-result'), false);
  assert.equal(plan.allItems.length, 0);
  assert.ok(plan.diagnostics.some((line) => line.includes('没有 ConversationProjection')));
});

test('fallback display intent keeps artifact order instead of reading prompt semantics', () => {
  const matrix: RuntimeArtifact = deliveryArtifact({
    id: 'matrix-result',
    type: 'expression-matrix',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { rows: [] },
  }, '.sciforge/sessions/session/task-results/matrix.csv', 'supporting-evidence');
  const report: RuntimeArtifact = deliveryArtifact({
    id: 'report-result',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Report' },
  }, '.sciforge/sessions/session/task-results/report.md');
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
  const oldReport: RuntimeArtifact = deliveryArtifact({
    id: 'old-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Old report' },
  }, '.sciforge/sessions/session/task-results/old-report.md');
  const newReport: RuntimeArtifact = deliveryArtifact({
    id: 'new-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# New report' },
  }, '.sciforge/sessions/session/task-results/new-report.md');
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
  const pdbArtifact: RuntimeArtifact = deliveryArtifact({
    id: 'backend-selected-pdb',
    type: 'pdb-file',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: 'workspace://artifacts/backend-selected.pdb',
    metadata: { accession: 'same-structure' },
  }, '.sciforge/sessions/session/task-results/backend-selected.pdb');
  const htmlArtifact: RuntimeArtifact = deliveryArtifact({
    id: 'semantic-looking-html',
    type: 'structure-3d-html',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: 'workspace://artifacts/semantic-looking.html',
    metadata: { accession: 'same-structure' },
  }, '.sciforge/sessions/session/task-results/semantic-looking.html');
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

test('raw result presentation artifact actions are audit-only without projection', () => {
  const report: RuntimeArtifact = deliveryArtifact({
    id: 'analysis-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Analysis report' },
  }, '.sciforge/sessions/session/task-results/analysis-report.md');
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

  assert.equal(plan.displayIntent.primaryGoal, '展示当前 session 的 runtime artifacts');
  assert.deepEqual(plan.displayIntent.requiredArtifactTypes, ['research-report']);
  assert.equal(displayIntentItems.some((item) => item.artifact?.id === 'analysis-report'), true);
  assert.equal(displayIntentItems.some((item) => item.slot.title === 'Open analysis report'), false);
  assert.ok(plan.diagnostics.some((line) => line.includes('没有 ConversationProjection')));
});

test('conversation projection drives result plan before raw display intent or response payloads', () => {
  const projectedReport: RuntimeArtifact = deliveryArtifact({
    id: 'projection-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Projection report' },
  }, '.sciforge/sessions/session/task-results/projection-report.md');
  const auditDiagnostic: RuntimeArtifact = {
    id: 'projection-diagnostic',
    type: 'runtime-diagnostic',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { status: 'validated', message: 'Projection audit diagnostic.' },
  };
  const rawReport: RuntimeArtifact = deliveryArtifact({
    id: 'raw-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { runId: 'run-projection-first' },
    data: { markdown: '# Raw report that should not drive the result plan' },
  }, '.sciforge/sessions/session/task-results/raw-report.md');
  const activeRun: SciForgeRun = {
    id: 'run-projection-first',
    scenarioId: 'literature-evidence-review',
    status: 'failed',
    prompt: 'Use the projection',
    response: JSON.stringify({
      displayIntent: {
        primaryGoal: 'Raw response intent',
        requiredArtifactTypes: ['paper-list'],
        preferredModules: ['paper-table'],
      },
      resultPresentation: {
        artifactActions: [{ id: 'raw-response', label: 'Open raw response report', ref: 'artifact:raw-report', artifactType: 'research-report' }],
      },
    }),
    createdAt: '2026-05-07T00:00:01.000Z',
    raw: {
      displayIntent: {
        primaryGoal: 'Raw display intent',
        requiredArtifactTypes: ['paper-list'],
        preferredModules: ['paper-table'],
        resultPresentation: {
          artifactActions: [{ id: 'raw-display', label: 'Open raw report', ref: 'artifact:raw-report', artifactType: 'research-report' }],
        },
      },
      resultPresentation: {
        conversationProjection: {
          schemaVersion: 'sciforge.conversation-projection.v1',
          conversationId: 'conversation-projection-first',
          currentTurn: { id: 'turn-projection-first', prompt: 'Use the projection' },
          visibleAnswer: {
            status: 'satisfied',
            text: 'Projection answer is the visible result.',
            artifactRefs: ['artifact:projection-report'],
          },
          artifacts: [{ ref: 'artifact:projection-report', label: 'Projection report', mime: 'research-report' }],
          executionProcess: [],
          recoverActions: [],
          verificationState: { status: 'pass', verifierRef: 'verification:projection-first' },
          auditRefs: ['artifact:projection-diagnostic', 'execution-unit:raw-legacy-unit'],
          diagnostics: [],
        },
      },
    },
  } as never;
  const session = baseSession({
    runs: [activeRun],
    artifacts: [projectedReport, auditDiagnostic, rawReport],
    executionUnits: [{
      id: 'raw-legacy-unit',
      tool: 'legacy.raw',
      params: '{}',
      status: 'repair-needed',
      hash: 'raw-legacy-unit',
      outputArtifacts: ['artifact:raw-report'],
    }],
    uiManifest: [{ componentId: 'report-viewer', artifactRef: 'raw-report', title: 'Raw report' }],
  });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, activeRun, defaultSlots: [] });
  const allItems = itemsForFocusMode(plan, 'all');

  assert.equal(plan.displayIntent.primaryGoal, 'Projection answer is the visible result.');
  assert.deepEqual(plan.displayIntent.acceptanceCriteria, ['render-from-conversation-projection']);
  assert.equal(allItems.some((item) => item.artifact?.id === 'projection-report'), true);
  assert.equal(allItems.some((item) => item.artifact?.id === 'projection-diagnostic'), false);
  assert.equal(allItems.some((item) => item.artifact?.id === 'raw-report'), false);
  assert.equal(allItems.some((item) => item.module.componentId === 'execution-unit-table'), false);
});

test('raw result presentation chart revisions do not create multiple main plan items without projection', () => {
  const plot: RuntimeArtifact = deliveryArtifact({
    id: 'base-plot',
    type: 'plot-spec',
    producerScenario: 'data-analysis',
    schemaVersion: '1',
    data: {
      plotId: 'ifnb-response',
      data: [{ type: 'scatter', x: [0, 1], y: [1.2, 2.4] }],
      layout: { title: { text: 'IFNB response' } },
    },
  }, '.sciforge/sessions/session/task-results/base-plot.json');
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

  assert.equal(chartItems.length, 1);
  assert.equal(chartItems[0]?.slot.title, 'Scientific plot viewer');
  assert.equal(chartItems[0]?.slot.encoding, undefined);
  assert.equal(chartItems[0]?.slot.transform, undefined);
  assert.ok(plan.diagnostics.some((line) => line.includes('没有 ConversationProjection')));
});

test('result presentation artifact actions keep active run scope across mixed artifacts', () => {
  const oldReport: RuntimeArtifact = deliveryArtifact({
    id: 'old-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# Old scoped report' },
  }, '.sciforge/sessions/session/task-results/old-report.md');
  const oldPapers: RuntimeArtifact = deliveryArtifact({
    id: 'old-papers',
    type: 'paper-list',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { papers: [{ title: 'Scoped paper' }] },
  }, '.sciforge/sessions/session/task-results/old-papers.csv', 'supporting-evidence');
  const oldDiagnostic: RuntimeArtifact = deliveryArtifact({
    id: 'old-diagnostic',
    type: 'runtime-diagnostic',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { status: 'partial', message: 'verification is partial' },
  }, '.sciforge/sessions/session/task-results/old-diagnostic.md', 'supporting-evidence');
  const oldVerification: RuntimeArtifact = deliveryArtifact({
    id: 'old-verification',
    type: 'verification-result',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { verdict: 'uncertain' },
  }, '.sciforge/sessions/session/task-results/old-verification.md', 'supporting-evidence');
  const newReport: RuntimeArtifact = deliveryArtifact({
    id: 'new-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: { markdown: '# New report' },
  }, '.sciforge/sessions/session/task-results/new-report.md');
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

test('raw required artifact type is ignored without projection', () => {
  const pdbArtifact: RuntimeArtifact = deliveryArtifact({
    id: 'pdb-result',
    type: 'pdb-file',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: 'workspace://artifacts/result.pdb',
    metadata: { accession: '1abc' },
  }, '.sciforge/sessions/session/task-results/result.pdb');
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

  assert.deepEqual(plan.displayIntent.requiredArtifactTypes, ['pdb-file']);
  assert.equal(displayIntentItems.some((item) => item.artifact?.id === 'pdb-result'), true);
  assert.ok(plan.diagnostics.some((line) => line.includes('没有 ConversationProjection')));
});

test('artifact delivery audit-only refs stay out of primary projection result plan', () => {
  const report: RuntimeArtifact = {
    id: 'readable-report',
    type: 'research-report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: '.sciforge/sessions/session/task-results/report.md',
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:readable-report',
      role: 'primary-deliverable',
      declaredMediaType: 'text/markdown',
      declaredExtension: 'md',
      contentShape: 'raw-file',
      readableRef: '.sciforge/sessions/session/task-results/report.md',
      rawRef: '.sciforge/sessions/session/task-results/output.json',
      previewPolicy: 'inline',
    },
  };
  const rawPayload: RuntimeArtifact = {
    id: 'raw-payload',
    type: 'runtime-payload',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: '.sciforge/sessions/session/task-results/output.json',
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:raw-payload',
      role: 'internal',
      declaredMediaType: 'application/json',
      declaredExtension: 'json',
      contentShape: 'json-envelope',
      rawRef: '.sciforge/sessions/session/task-results/output.json',
      previewPolicy: 'audit-only',
    },
  };
  const activeRun: SciForgeRun = {
    id: 'run-delivery',
    scenarioId: 'literature-evidence-review',
    status: 'completed',
    prompt: 'write report',
    response: 'Done',
    createdAt: '2026-05-07T00:00:01.000Z',
    raw: {
      restoredConversationProjection: {
        schemaVersion: 'sciforge.conversation-projection.v1',
        runId: 'run-delivery',
        visibleAnswer: { status: 'satisfied', text: 'Report ready', artifactRefs: ['artifact:readable-report', 'artifact:raw-payload'] },
        artifacts: [
          { ref: 'artifact:readable-report', label: 'Report' },
          { ref: 'artifact:raw-payload', label: 'Raw payload' },
        ],
        executionProcess: [],
        diagnostics: [],
        auditRefs: ['artifact:raw-payload'],
      },
    },
  };
  const session = baseSession({ runs: [activeRun], artifacts: [report, rawPayload] });

  const plan = resolveViewPlan({ scenarioId: 'literature-evidence-review', session, activeRun, defaultSlots: [] });

  assert.ok(plan.allItems.some((item) => item.artifact?.id === 'readable-report'));
  assert.equal(plan.allItems.some((item) => item.artifact?.id === 'raw-payload'), false);
});
