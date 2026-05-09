import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptySequenceViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'sequence-viewer', props: { showCoordinates: true } },
  artifact: {
    id: 'sequence-empty',
    type: 'sequence',
    producerScenario: 'sequence-fasta-import',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'sequence-alignment',
      schemaVersion: '0.1.0',
      id: 'empty-sequence',
      title: 'No sequence available',
      alphabet: 'dna',
      aligned: false,
      sequences: [],
      metadata: { reason: 'FASTA import produced no records' },
    },
  },
};
