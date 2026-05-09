import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyEvidenceMatrixFixture: UIComponentRendererProps = {
  slot: { componentId: 'evidence-matrix', title: 'Empty evidence matrix' },
  artifact: {
    id: 'evidence-matrix-empty',
    type: 'evidence-matrix',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    metadata: { title: 'No evidence claims captured yet' },
    data: { claimSetId: 'empty-claim-set', rows: [] },
  },
  session: {
    schemaVersion: 2,
    sessionId: 'fixture-evidence-empty',
    scenarioId: 'literature-evidence-review',
    title: 'Empty evidence matrix fixture',
    createdAt: '2026-05-03T00:00:00.000Z',
    updatedAt: '2026-05-03T00:00:00.000Z',
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

export default emptyEvidenceMatrixFixture;
