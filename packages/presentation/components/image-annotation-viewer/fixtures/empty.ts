import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const emptyImageAnnotationViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'image-annotation-viewer', props: { showLabels: true } },
  artifact: {
    id: 'image-annotation-empty',
    type: 'image-annotation',
    producerScenario: 'microscopy-roi-review',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'image-volume',
      imageId: 'empty-image-annotation',
      imageRef: 'workspace://images/if-stain-field-empty.tiff',
      dimensions: { width: 1024, height: 768, channels: ['DAPI', 'FITC'] },
      annotations: [],
      metadata: { reason: 'No annotations have been created for this image' },
    },
  },
};
