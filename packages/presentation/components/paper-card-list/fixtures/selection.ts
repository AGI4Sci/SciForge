import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';
import { basicPaperCardListFixture } from './basic';

export const selectionPaperCardListFixture: UIComponentRendererProps = {
  ...basicPaperCardListFixture,
  slot: {
    ...basicPaperCardListFixture.slot,
    props: {
      selectedPaperId: 'paper-wolf-2018-scanpy',
      selectedTarget: 'single-cell analysis',
      expectedEvents: [
        { type: 'select-paper', paperId: 'paper-wolf-2018-scanpy' },
        { type: 'select-target', target: 'single-cell analysis' },
      ],
    },
  },
};
