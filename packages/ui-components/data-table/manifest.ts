import type { UIComponentManifest } from '../types';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/data-table',
  moduleId: 'generic-data-table',
  version: '1.0.0',
  title: 'Generic artifact table',
  description: 'Safe table renderer for array-like artifact payloads.',
  componentId: 'data-table',
  lifecycle: 'published',
  outputArtifactTypes: ['data-table'],
  acceptsArtifactTypes: ['paper-list', 'structure-summary', 'knowledge-graph', 'omics-differential-expression', 'sequence-alignment', 'inspection-summary', 'research-report', 'runtime-artifact'],
  viewParams: ['filter', 'sort', 'limit', 'group'],
  interactionEvents: ['select-row'],
  roleDefaults: ['bioinformatician', 'pi'],
  fallbackModuleIds: ['generic-artifact-inspector'],
  defaultSection: 'raw',
  priority: 90,
  safety: { sandbox: false, externalResources: 'none', executesCode: false },
  presentation: {
    dedupeScope: 'collection',
    identityFields: ['datasetId', 'dataset_id', 'tableId', 'table_id', 'dataRef', 'outputRef', 'resultRef'],
  },
  docs: {
    readmePath: 'packages/ui-components/data-table/README.md',
    agentSummary: 'Use for safe tabular rendering of array-like payloads. Prefer as fallback for row/record datasets.',
  },
  workbenchDemo: {
    artifactType: 'inspection-summary',
    artifactData: {
      rows: [
        { sample: 'S001', group: 'control', score: 0.42 },
        { sample: 'S002', group: 'treated', score: 0.91 },
        { sample: 'S003', group: 'treated', score: 0.73 },
      ],
    },
  },
};
