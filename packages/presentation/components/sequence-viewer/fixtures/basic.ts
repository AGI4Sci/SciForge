import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicSequenceViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'sequence-viewer',
    props: { wrap: 60, showCoordinates: true },
  },
  artifact: {
    id: 'sequence-brca1-exon11-fragment',
    type: 'sequence',
    producerScenario: 'sequence-fasta-import',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'sequence-alignment',
      schemaVersion: '0.1.0',
      id: 'brca1-exon11-fragment',
      title: 'BRCA1 exon 11 coding fragment',
      alphabet: 'dna',
      aligned: false,
      sequences: [
        {
          id: 'NM_007294.4:exon11_fragment',
          label: 'BRCA1 transcript fragment',
          sequence: 'ATGGATTTATCTGCTCTTCGCGTTGAAGAAGTACAAAATGTCATTAATGCTATGCAGAAAATCTTAGAGTGTCCCATCTGTTCTGGAGTTGATCAAGGAACCTGTCTCCACAAAGTGTGACCACATATTTTGCAAATTTTGCATGCTGAAACTTCTCAACCAGAAGAAAGGGCCTTCACAATGTCCTTTGTGTAAGAATGA',
          annotations: [
            { id: 'domain-start', label: 'BRCT-adjacent coding region', start: 1, end: 90, kind: 'feature' },
            { id: 'selected-region-demo', label: 'Selected codon window', start: 43, end: 60, kind: 'selection' },
          ],
        },
      ],
      metadata: { source: 'minimal FASTA fixture', coordinateBase: 1 },
    },
  },
};
