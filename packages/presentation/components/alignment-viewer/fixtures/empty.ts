import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyAlignmentViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'alignment-viewer', props: { showConsensus: true } },
  artifact: {
    id: 'alignment-empty',
    type: 'sequence-alignment',
    producerScenario: 'mafft-alignment-preview',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'sequence-alignment',
      schemaVersion: '0.1.0',
      id: 'empty-alignment',
      title: 'No aligned rows available',
      alphabet: 'protein',
      aligned: true,
      sequences: [],
      consensus: '',
      metadata: { reason: 'Alignment job returned no rows' },
    },
  },
};
