import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

const notebook = [
  {
    id: 'note-ifnb-question',
    time: '2026-05-03 09:00:00',
    scenario: 'literature-evidence-review',
    title: 'Question scoped',
    desc: 'Compare interferon-stimulated gene evidence before running a compact RNA-seq check.',
    claimType: 'fact',
    confidence: 0.9,
    artifactRefs: ['paper:ifn-signaling-review'],
    updateReason: 'user asked for an auditable mini synthesis',
  },
  {
    id: 'note-ifnb-decision',
    time: '2026-05-03 09:08:00',
    scenario: 'omics-differential-expression',
    title: 'Use adjusted p-value threshold',
    desc: 'Treat genes with adjusted p-value < 0.05 and absolute log2 fold change > 1 as demo hits.',
    claimType: 'assumption',
    confidence: 0.78,
    executionUnitRefs: ['eu-deseq2-002'],
    artifactRefs: ['de-table-mini'],
    updateReason: 'keeps fixture minimal and scientifically interpretable',
  },
];

export const basicNotebookTimelineFixture: UIComponentRendererProps = {
  slot: { componentId: 'notebook-timeline', title: 'Research decision timeline' },
  artifact: {
    id: 'notebook-timeline-mini',
    type: 'notebook-timeline',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { title: 'IFN beta mini-study timeline' },
    data: { events: notebook },
  },
  session: {
    schemaVersion: 2,
    sessionId: 'fixture-notebook-basic',
    scenarioId: 'literature-evidence-review',
    title: 'Notebook timeline fixture',
    createdAt: '2026-05-03T01:00:00.000Z',
    updatedAt: '2026-05-03T01:08:00.000Z',
    messages: [],
    runs: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    artifacts: [],
    notebook,
    versions: [],
  },
};

export default basicNotebookTimelineFixture;
