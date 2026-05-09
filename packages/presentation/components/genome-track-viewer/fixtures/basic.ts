import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicGenomeTrackViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'genome-track-viewer',
    props: { genome: 'GRCh38', range: 'chr17:43044295-43045820', showGenes: true, showVariants: true },
  },
  artifact: {
    id: 'genome-track-brca1-mini',
    type: 'genome-track',
    producerScenario: 'variant-track-preview',
    schemaVersion: '0.1.0',
    data: {
      genome: 'GRCh38',
      range: { chrom: 'chr17', start: 43044295, end: 43045820 },
      tracks: [
        {
          id: 'brca1-gff',
          type: 'gene-model',
          features: [
            { id: 'BRCA1', type: 'gene', start: 43044295, end: 43045820, strand: '-', geneName: 'BRCA1' },
            { id: 'BRCA1-exon-1', type: 'exon', start: 43045000, end: 43045280, strand: '-' },
          ],
        },
        {
          id: 'clinvar-vcf',
          type: 'variant',
          variants: [
            { id: 'rs80357906', pos: 43044512, ref: 'C', alt: 'T', consequence: 'stop_gained', significance: 'pathogenic' },
          ],
        },
        {
          id: 'rna-seq-coverage',
          type: 'coverage',
          coverage: [
            { start: 43044295, end: 43044600, value: 18 },
            { start: 43044600, end: 43045000, value: 31 },
            { start: 43045000, end: 43045820, value: 24 },
          ],
        },
      ],
    },
  },
};
