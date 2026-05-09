import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicRecordTableFixture: UIComponentRendererProps = {
  slot: { componentId: 'record-table', transform: [{ type: 'limit', value: 10 }] },
  artifact: {
    id: 'record-table-basic',
    type: 'record-set',
    producerScenario: 'record-preview',
    schemaVersion: '0.1.0',
    data: { rows: [{ sample: 'S001', group: 'control', score: 0.42 }, { sample: 'S002', group: 'treated', score: 0.91 }] },
  },
};
