import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyImageEvidenceViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'image-evidence-viewer' },
  artifact: {
    id: 'image-evidence-empty',
    type: 'image-evidence',
    producerScenario: 'image-evidence-preview',
    schemaVersion: '1.0.0',
    data: {
      sourceKind: 'artifact',
      status: 'missing-ref',
    },
  },
};
