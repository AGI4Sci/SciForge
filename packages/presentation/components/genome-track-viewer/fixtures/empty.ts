import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyGenomeTrackViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'genome-track-viewer', props: { genome: 'GRCh38' } },
  artifact: {
    id: 'genome-track-empty',
    type: 'genome-track',
    producerScenario: 'variant-track-preview',
    schemaVersion: '0.1.0',
    data: {
      genome: 'GRCh38',
      range: { chrom: 'chr17', start: 43044295, end: 43045820 },
      tracks: [],
      metadata: { reason: 'No features, variants, or coverage bins in selected range' },
    },
  },
};
