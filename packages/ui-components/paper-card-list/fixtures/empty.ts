import type { UIComponentRendererProps } from '../../types';

export const emptyPaperCardListFixture: UIComponentRendererProps = {
  slot: { componentId: 'paper-card-list', props: { papers: [] } },
  artifact: {
    id: 'paper-list-empty',
    type: 'paper-list',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    data: {
      query: 'No matching peer-reviewed papers after filters',
      papers: [],
    },
  },
};
