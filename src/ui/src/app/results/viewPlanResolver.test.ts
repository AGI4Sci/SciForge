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
