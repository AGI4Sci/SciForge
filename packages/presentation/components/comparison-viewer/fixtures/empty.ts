import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyComparisonViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'comparison-viewer', props: { mode: 'structured' } },
  artifact: {
    id: 'comparison-empty',
    type: 'artifact-diff',
    producerScenario: 'protocol-revision-compare',
    schemaVersion: '0.1.0',
    data: {
      comparisonId: 'empty-comparison',
      title: 'No differences available',
      left: { label: 'Left artifact' },
      right: { label: 'Right artifact' },
      summary: { added: 0, removed: 0, changed: 0, unchanged: 0 },
      changes: [],
      metadata: { reason: 'Comparison has not run or artifacts are identical' },
    },
  },
};
