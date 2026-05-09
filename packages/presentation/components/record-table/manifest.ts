import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/record-table',
  moduleId: 'record-table',
  version: '0.1.0',
  title: 'Record table',
  description: 'Generic record-set/table renderer for row-like scientific artifacts.',
  componentId: 'record-table',
  lifecycle: 'validated',
  outputArtifactTypes: ['record-set', 'data-table'],
  acceptsArtifactTypes: ['record-set', 'data-table', 'table', 'dataframe', 'annotation-table', 'runtime-artifact', 'knowledge-graph', 'sequence-alignment'],
  requiredAnyFields: [['rows', 'records', 'items', 'papers', 'nodes', 'sequences']],
  viewParams: ['filter', 'sort', 'limit', 'group', 'columnOrder'],
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
    readmePath: 'packages/presentation/components/record-table/README.md',
    agentSummary: 'Use for safe tabular rendering of record-set/table/dataframe payloads. Historical data-table aliases should route here.',
  },
  workbenchDemo: {
    artifactType: 'record-set',
    artifactData: {
      rows: [
        { sample: 'S001', group: 'control', score: 0.42 },
        { sample: 'S002', group: 'treated', score: 0.91 },
      ],
    },
  },
};
