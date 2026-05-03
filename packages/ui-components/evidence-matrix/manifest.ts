import type { UIComponentManifest } from '../types';

export const manifest: UIComponentManifest = {
  packageName: '@bioagent-ui/evidence-matrix',
  moduleId: 'evidence-matrix-panel',
  version: '1.0.0',
  title: 'Evidence matrix panel',
  description: 'Claim/evidence matrix bound to session claims and supporting artifacts.',
  componentId: 'evidence-matrix',
  lifecycle: 'published',
  outputArtifactTypes: ['evidence-matrix'],
  acceptsArtifactTypes: ['evidence-matrix', 'paper-list', 'structure-summary', 'knowledge-graph', 'omics-differential-expression', 'research-report'],
  viewParams: ['filter', 'sort', 'limit'],
  interactionEvents: ['select-claim'],
  roleDefaults: ['experimental-biologist', 'pi', 'clinical'],
  fallbackModuleIds: ['generic-artifact-inspector'],
  defaultSection: 'supporting',
  priority: 30,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: {
    dedupeScope: 'collection',
    identityFields: ['matrixId', 'matrix_id', 'evidenceSetId', 'evidence_set_id', 'claimSetId', 'claim_set_id', 'dataRef', 'outputRef', 'resultRef'],
  },
  docs: {
    readmePath: 'packages/ui-components/evidence-matrix/README.md',
    agentSummary: 'Use only when claims/evidence comparison is explicitly useful. Accepts evidence-matrix and related artifact types.',
  },
};
