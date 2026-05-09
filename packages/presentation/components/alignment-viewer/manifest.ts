import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/alignment-viewer',
  moduleId: 'sequence-alignment-viewer',
  version: '0.1.0',
  title: 'Alignment viewer',
  description: 'Skeleton multiple sequence alignment component for aligned biological sequence rows.',
  componentId: 'alignment-viewer',
  lifecycle: 'draft',
  outputArtifactTypes: ['sequence-alignment'],
  acceptsArtifactTypes: ['sequence-alignment', 'multiple-sequence-alignment', 'pairwise-alignment', 'msa', 'alignment-file'],
  requiredAnyFields: [['sequences', 'rows', 'alignment', 'consensus', 'dataRef', 'filePath', 'path']],
  viewParams: ['alphabet', 'colorScheme', 'showConsensus', 'showGaps', 'highlightColumns', 'sortRows'],
  interactionEvents: ['select-column', 'select-region', 'select-sequence', 'highlight-residue'],
  roleDefaults: ['bioinformatician', 'experimental-biologist'],
  fallbackModuleIds: ['sequence-viewer', 'generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 23,
  safety: { sandbox: false, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['alignmentId', 'alignment_id', 'datasetId', 'dataset_id', 'dataRef', 'resultRef'],
  },
  docs: {
    readmePath: 'packages/presentation/components/alignment-viewer/README.md',
    agentSummary: 'Use for aligned DNA/RNA/protein sequence rows with gaps, consensus, and column or residue selections.',
  },
  workbenchDemo: {
    artifactType: 'sequence-alignment',
    artifactData: {
      primitive: 'sequence-alignment',
      id: 'spike-rbd-mini-alignment',
      title: 'Spike RBD motif alignment',
      alphabet: 'protein',
      aligned: true,
      sequences: [
        { id: 'ref', label: 'Reference', sequence: 'NITNLCPFGEVFNATRFASVYAWNRKRISNCV' },
        { id: 'variant_a', label: 'Variant A', sequence: 'NITNLCPFGEVFNASRFASVYAWNRKRISNCV' },
        { id: 'variant_b', label: 'Variant B', sequence: 'NITNLCPFGEVF---RFASVYAWNRKRISNCV' },
      ],
      consensus: 'NITNLCPFGEVFNATRFASVYAWNRKRISNCV',
    },
  },
};
