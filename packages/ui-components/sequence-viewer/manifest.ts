import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/sequence-viewer',
  moduleId: 'sequence-viewer',
  version: '0.1.0',
  title: 'Sequence viewer',
  description: 'Skeleton sequence inspection component for FASTA-like DNA, RNA, and protein records.',
  componentId: 'sequence-viewer',
  lifecycle: 'draft',
  outputArtifactTypes: ['sequence', 'sequence-alignment'],
  acceptsArtifactTypes: ['sequence', 'sequence-record', 'fasta', 'fasta-file', 'sequence-alignment'],
  requiredAnyFields: [['sequence', 'sequences', 'fasta', 'dataRef', 'filePath', 'path']],
  viewParams: ['alphabet', 'wrap', 'showCoordinates', 'highlightRegions', 'translateFrame'],
  interactionEvents: ['select-region', 'highlight-feature', 'copy-sequence'],
  roleDefaults: ['bioinformatician', 'experimental-biologist'],
  fallbackModuleIds: ['sequence-alignment-viewer', 'generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 24,
  safety: { sandbox: false, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['sequenceId', 'sequence_id', 'accession', 'locusTag', 'geneId', 'uniprotId', 'dataRef'],
  },
  docs: {
    readmePath: 'packages/ui-components/sequence-viewer/README.md',
    agentSummary: 'Use for FASTA-like single sequence records with optional features and coordinate highlights. Do not use for dense alignments when alignment-viewer fits.',
  },
  workbenchDemo: {
    artifactType: 'sequence',
    artifactData: {
      primitive: 'sequence-alignment',
      id: 'brca1-exon-demo',
      title: 'BRCA1 exon fragment',
      alphabet: 'dna',
      aligned: false,
      sequences: [
        {
          id: 'NM_007294_exon11_fragment',
          label: 'BRCA1 exon 11 fragment',
          sequence: 'ATGGATTTATCTGCTCTTCGCGTTGAAGAAGTACAAAATGTCATTAATGCTATGCAGAAAATCTTAGAGTGTCCCATCTGTTCTGGAGTTGATCAAGGAACCTGTCTCCACAAAGTGTGACCACATATTTTGCAAATTTTGCATGCTGAAACTTCTCAACCAGAAGAAAGGGCCTTCACAATGTCCTTTGTGTAAGAATGA',
        },
      ],
    },
  },
};
