import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionSequenceViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'sequence-viewer',
    props: { wrap: 60, showCoordinates: true, highlightRegions: [{ start: 43, end: 60 }] },
  },
  artifact: {
    id: 'sequence-brca1-selection',
    type: 'sequence',
    producerScenario: 'sequence-fasta-import',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'sequence-alignment',
      schemaVersion: '0.1.0',
      id: 'brca1-exon11-selection',
      title: 'BRCA1 selected codon window',
      alphabet: 'dna',
      aligned: false,
      sequences: [
        {
          id: 'NM_007294.4:exon11_fragment',
          label: 'BRCA1 transcript fragment',
          sequence: 'ATGGATTTATCTGCTCTTCGCGTTGAAGAAGTACAAAATGTCATTAATGCTATGCAGAAAATCTTAGAGTGTCCCATCTGTTCTGGAGTTGATCAAGGAACCTGTCTCCACAAAGTGTGACCACATATTTTGCAAATTTTGCATGCTGAAACTTCTCAACCAGAAGAAAGGGCCTTCACAATGTCCTTTGTGTAAGAATGA',
          annotations: [{ id: 'selected-region-demo', label: 'Selected codon window', start: 43, end: 60, kind: 'selection' }],
        },
      ],
      metadata: { selectedRegion: { sequenceId: 'NM_007294.4:exon11_fragment', start: 43, end: 60 } },
    },
  },
};
