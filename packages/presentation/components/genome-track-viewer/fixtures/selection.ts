import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionGenomeTrackViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'genome-track-viewer',
    props: { genome: 'GRCh38', highlightRange: { chrom: 'chr17', start: 43044500, end: 43044540 } },
  },
  artifact: {
    id: 'genome-track-brca1-selection',
    type: 'genome-track',
    producerScenario: 'variant-track-preview',
    schemaVersion: '0.1.0',
    data: {
      genome: 'GRCh38',
      range: { chrom: 'chr17', start: 43044295, end: 43045820 },
      tracks: [
        {
          id: 'clinvar-vcf',
          type: 'variant',
          variants: [
            { id: 'rs80357906', pos: 43044512, ref: 'C', alt: 'T', significance: 'pathogenic', selected: true },
          ],
        },
      ],
      metadata: { selectedVariantId: 'rs80357906', selectedRange: 'chr17:43044500-43044540' },
    },
  },
};
