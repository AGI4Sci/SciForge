import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionRecordTableFixture: UIComponentRendererProps = {
  slot: { componentId: 'record-table', props: { selectedRowId: 'S002' } },
  artifact: {
    id: 'record-table-selection',
    type: 'record-set',
    producerScenario: 'record-preview',
    schemaVersion: '0.1.0',
    data: { rows: [{ sample: 'S002', group: 'treated', score: 0.91, selected: true }] },
  },
};
