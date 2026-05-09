import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionImageAnnotationViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'image-annotation-viewer',
    props: { selectedAnnotationId: 'bbox-ki67-001', showLabels: true },
  },
  artifact: {
    id: 'image-annotation-ki67-selection',
    type: 'image-annotation',
    producerScenario: 'microscopy-roi-review',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'image-volume',
      imageId: 'if-stain-field-01',
      imageRef: 'workspace://images/if-stain-field-01.tiff',
      dimensions: { width: 1024, height: 768, channels: ['DAPI', 'FITC'] },
      annotations: [
        { id: 'bbox-ki67-001', type: 'bbox', label: 'Ki67 positive nucleus', x: 412, y: 260, width: 88, height: 72, selected: true, commentAnchor: { x: 456, y: 296 } },
      ],
      metadata: { selectedAnnotationId: 'bbox-ki67-001' },
    },
  },
};
