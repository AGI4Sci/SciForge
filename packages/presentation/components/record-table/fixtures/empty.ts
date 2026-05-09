import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyRecordTableFixture: UIComponentRendererProps = {
  slot: { componentId: 'record-table' },
  artifact: { id: 'record-table-empty', type: 'record-set', producerScenario: 'record-preview', schemaVersion: '0.1.0', data: { rows: [] } },
};
