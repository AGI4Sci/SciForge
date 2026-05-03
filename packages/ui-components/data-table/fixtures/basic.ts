import type { UIComponentRendererProps } from '../../types';

export const emptyDataTableFixture: UIComponentRendererProps = {
  slot: { componentId: 'data-table', props: { rows: [] } },
};

export const basicDataTableFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'data-table',
    transform: [{ type: 'limit', value: 2 }],
  },
  artifact: {
    id: 'table-1',
    type: 'data-table',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: {
      rows: [
        { gene: 'TP53', score: 0.91, source: 'curated' },
        { gene: 'EGFR', score: 0.78, source: 'curated' },
        { gene: 'BRCA1', score: 0.71, source: 'computed' },
      ],
    },
  },
};
