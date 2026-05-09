import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionComparisonViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'comparison-viewer',
    props: { mode: 'structured', selectedChangePath: '/treatment', highlightSeverity: 'high' },
  },
  artifact: {
    id: 'comparison-protocol-selected-change',
    type: 'artifact-diff',
    producerScenario: 'protocol-revision-compare',
    schemaVersion: '0.1.0',
    data: {
      comparisonId: 'protocol-dose-selected-change',
      title: 'Selected protocol change',
      left: { ref: 'workspace://protocols/screen-v1.json', label: 'Protocol v1' },
      right: { ref: 'workspace://protocols/screen-v2.json', label: 'Protocol v2' },
      summary: { added: 1, removed: 0, changed: 3, unchanged: 8 },
      changes: [
        { path: '/treatment', kind: 'changed', before: 'vehicle', after: 'vemurafenib 1 uM', severity: 'high', selected: true },
      ],
      metadata: { selectedChangePath: '/treatment' },
    },
  },
};
