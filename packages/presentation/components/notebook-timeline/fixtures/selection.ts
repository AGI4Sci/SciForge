import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

const selectedEvent = {
  id: 'note-ifnb-decision',
  time: '2026-05-03 09:08:00',
  scenario: 'omics-differential-expression',
  title: 'Use adjusted p-value threshold',
  desc: 'Treat genes with adjusted p-value < 0.05 and absolute log2 fold change > 1 as demo hits.',
  claimType: 'assumption',
  confidence: 0.78,
  executionUnitRefs: ['eu-deseq2-002'],
  artifactRefs: ['de-table-mini'],
  updateReason: 'selected for provenance inspection',
};

export const selectionNotebookTimelineFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'notebook-timeline',
    title: 'Selected notebook event',
    props: {
      selectedTimelineEventId: selectedEvent.id,
      selectionEvent: { type: 'select-timeline-event', eventId: selectedEvent.id },
    },
  },
  artifact: {
    id: 'notebook-timeline-selection',
    type: 'notebook-timeline',
    producerScenario: 'omics-differential-expression',
    schemaVersion: '1',
    metadata: { title: 'Selected threshold decision' },
    data: { events: [selectedEvent] },
  },
  session: {
    schemaVersion: 2,
    sessionId: 'fixture-notebook-selection',
    scenarioId: 'omics-differential-expression',
    title: 'Notebook selection fixture',
    createdAt: '2026-05-03T01:00:00.000Z',
    updatedAt: '2026-05-03T01:08:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook: [selectedEvent],
    versions: [],
  },
};

export default selectionNotebookTimelineFixture;
