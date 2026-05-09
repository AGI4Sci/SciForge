import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyNotebookTimelineFixture: UIComponentRendererProps = {
  slot: { componentId: 'notebook-timeline', title: 'Empty research timeline' },
  artifact: {
    id: 'notebook-timeline-empty',
    type: 'notebook-timeline',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { title: 'No notebook records yet' },
    data: { events: [] },
  },
  session: {
    schemaVersion: 2,
    sessionId: 'fixture-notebook-empty',
    scenarioId: 'literature-evidence-review',
    title: 'Empty notebook fixture',
    createdAt: '2026-05-03T01:00:00.000Z',
    updatedAt: '2026-05-03T01:00:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [],
    versions: [],
  },
};

export default emptyNotebookTimelineFixture;
