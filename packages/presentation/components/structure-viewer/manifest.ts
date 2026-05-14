import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/structure-viewer',
  moduleId: 'structure-viewer',
  version: '0.1.0',
  title: 'Structure viewer',
  description: 'Declared-resource structure renderer for protein, ligand, complex, pocket, and residue-selection artifacts.',
  componentId: 'structure-viewer',
  lifecycle: 'validated',
  outputArtifactTypes: ['structure-3d', 'structure-summary'],
  acceptsArtifactTypes: ['structure-3d', 'structure-summary', 'structure-3d-html', 'pdb-file', 'structure-list', 'pdb-structure', 'protein-structure', 'mmcif-file', 'cif-file'],
  viewParams: ['colorBy', 'highlightSelection', 'highlightResidues', 'syncViewport'],
  interactionEvents: ['highlight-residue', 'select-chain'],
  roleDefaults: ['experimental-biologist', 'bioinformatician', 'pi'],
  fallbackModuleIds: ['generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 8,
  safety: { sandbox: true, externalResources: 'declared-only', executesCode: false },
  presentation: { dedupeScope: 'entity', identityFields: ['pdbId', 'pdb_id', 'pdb', 'uniprotId', 'accession', 'entityId', 'targetId', 'dataRef'] },
  docs: { readmePath: 'packages/presentation/components/structure-viewer/README.md', agentSummary: 'Use for declared structure refs and metadata. Historical molecule-viewer aliases route here.' },
  workbenchDemo: { artifactType: 'structure-summary', artifactData: { pdbId: '1CRN', ligand: 'none', dataRef: 'packages/presentation/components/structure-viewer/workbench-demo/1crn.cif', highlightResidues: ['A:22'] } },
};
