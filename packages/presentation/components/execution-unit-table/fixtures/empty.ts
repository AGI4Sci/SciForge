import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyExecutionUnitTableFixture: UIComponentRendererProps = {
  slot: { componentId: 'execution-unit-table', title: 'No execution units' },
  artifact: {
    id: 'workflow-provenance-empty',
    type: 'workflow-provenance',
    producerScenario: 'omics-differential-expression',
    schemaVersion: '1',
    metadata: { title: 'No runtime provenance captured' },
    data: { executionUnits: [] },
  },
  session: {
    schemaVersion: 2,
    sessionId: 'fixture-execution-empty',
    scenarioId: 'omics-differential-expression',
    title: 'Empty execution fixture',
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

export default emptyExecutionUnitTableFixture;
