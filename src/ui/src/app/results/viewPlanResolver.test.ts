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
