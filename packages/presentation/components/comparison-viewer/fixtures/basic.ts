import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicComparisonViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'comparison-viewer',
    props: { mode: 'structured', granularity: 'field', highlightSeverity: 'high' },
  },
  artifact: {
    id: 'comparison-protocol-dose-update',
    type: 'artifact-diff',
    producerScenario: 'protocol-revision-compare',
    schemaVersion: '0.1.0',
    data: {
      comparisonId: 'protocol-dose-update',
      title: 'CRISPR screen protocol update',
      left: { ref: 'workspace://protocols/screen-v1.json', label: 'Protocol v1' },
      right: { ref: 'workspace://protocols/screen-v2.json', label: 'Protocol v2' },
      summary: { added: 1, removed: 0, changed: 3, unchanged: 8 },
      changes: [
        { path: '/selectionDays', kind: 'changed', before: 10, after: 14, severity: 'medium' },
        { path: '/treatment', kind: 'changed', before: 'vehicle', after: 'vemurafenib 1 uM', severity: 'high', selected: true },
        { path: '/readouts/2', kind: 'added', after: 'drug-response viability at day 21', severity: 'low' },
      ],
      metadata: { diffAlgorithm: 'json-pointer-field-diff' },
    },
  },
};
