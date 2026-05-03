import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/genome-track-viewer',
  moduleId: 'genome-track-viewer',
  version: '0.1.0',
  title: 'Genome track viewer',
  description: 'Skeleton genomic range track component for gene models, variants, and coverage summaries.',
  componentId: 'genome-track-viewer',
  lifecycle: 'draft',
  outputArtifactTypes: ['genome-track', 'visual-annotation', 'record-set'],
  acceptsArtifactTypes: ['genome-track', 'genomic-range', 'bed-track', 'gff-track', 'vcf-variants', 'coverage-track'],
  requiredAnyFields: [['genome', 'range', 'tracks', 'features', 'variants', 'coverage', 'dataRef']],
  viewParams: ['genome', 'range', 'trackOrder', 'showGenes', 'showVariants', 'coverageScale', 'highlightRange'],
  interactionEvents: ['select-genomic-range', 'select-feature', 'select-variant', 'open-track-ref'],
  roleDefaults: ['bioinformatician', 'experimental-biologist'],
  fallbackModuleIds: ['generic-data-table', 'generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 25,
  safety: { sandbox: false, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['trackId', 'track_id', 'genome', 'range', 'geneId', 'variantId', 'dataRef'],
  },
  docs: {
    readmePath: 'packages/ui-components/genome-track-viewer/README.md',
    agentSummary: 'Use for genomic range tracks with gene models, variants, and coverage previews. Keep large BED/GFF/VCF/BAM data behind declared refs.',
  },
  workbenchDemo: {
    artifactType: 'genome-track',
    artifactData: {
      genome: 'GRCh38',
      range: { chrom: 'chr17', start: 43044295, end: 43045820 },
      tracks: [
        { id: 'brca1-model', type: 'gene-model', features: [{ id: 'BRCA1', start: 43044295, end: 43045820, strand: '-' }] },
        { id: 'clinvar', type: 'variant', variants: [{ id: 'rs80357906', pos: 43044512, ref: 'C', alt: 'T', significance: 'pathogenic' }] },
      ],
    },
  },
};
