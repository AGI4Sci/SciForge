import type { UIComponentManifest } from '../types';

export const manifest: UIComponentManifest = {
  packageName: '@bioagent-ui/molecule-viewer',
  moduleId: 'protein-structure-viewer',
  version: '1.0.0',
  title: 'Protein structure viewer',
  description: 'PDB/mmCIF/dataRef/HTML structure visualization bound to structure artifacts.',
  componentId: 'molecule-viewer',
  lifecycle: 'published',
  outputArtifactTypes: ['structure-summary'],
  acceptsArtifactTypes: ['structure-summary', 'structure-3d-html', 'pdb-file', 'structure-list', 'pdb-structure', 'protein-structure', 'mmcif-file', 'cif-file'],
  requiredAnyFields: [['pdbId', 'pdb_id', 'pdb', 'uniprotId', 'dataRef', 'structureUrl', 'html', 'htmlRef', 'structureHtml', 'path', 'filePath']],
  viewParams: ['colorBy', 'highlightSelection', 'highlightResidues', 'syncViewport'],
  interactionEvents: ['highlight-residue', 'select-chain'],
  roleDefaults: ['experimental-biologist', 'bioinformatician', 'pi'],
  fallbackModuleIds: ['generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 8,
  safety: { sandbox: true, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['pdbId', 'pdb_id', 'pdb', 'uniprotId', 'uniprot_id', 'accession', 'entityId', 'entity_id', 'targetId', 'target_id'],
  },
  docs: {
    readmePath: 'packages/ui-components/molecule-viewer/README.md',
    agentSummary: 'Use for structure artifacts with PDB/mmCIF identifiers, dataRef, structureUrl, HTML refs, path, or filePath. Prefer for molecular inspection.',
  },
};
