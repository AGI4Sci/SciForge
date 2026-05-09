import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyPublicationFigureBuilderFixture: UIComponentRendererProps = {
  slot: { componentId: 'publication-figure-builder', props: { journalProfile: 'two-column' } },
  artifact: {
    id: 'figure-empty',
    type: 'figure-spec',
    producerScenario: 'publication-figure-draft',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'figure-spec',
      schemaVersion: '0.1.0',
      figureId: 'empty-figure',
      title: 'No panels available',
      layout: { widthMm: 180, heightMm: 120, columns: 2 },
      panels: [],
      exportProfile: { format: 'pdf', dpi: 300 },
      metadata: { reason: 'No plot panels have been added' },
    },
  },
};
