import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicImageAnnotationViewerFixture: UIComponentRendererProps = {
  slot: {
    componentId: 'image-annotation-viewer',
    props: { channel: 'FITC', showMasks: true, showLabels: true },
  },
  artifact: {
    id: 'image-annotation-ki67-mini',
    type: 'image-annotation',
    producerScenario: 'microscopy-roi-review',
    schemaVersion: '0.1.0',
    data: {
      primitive: 'image-volume',
      imageId: 'if-stain-field-01',
      imageRef: 'workspace://images/if-stain-field-01.tiff',
      dimensions: { width: 1024, height: 768, channels: ['DAPI', 'FITC'] },
      annotations: [
        { id: 'bbox-ki67-001', type: 'bbox', label: 'Ki67 positive nucleus', x: 412, y: 260, width: 88, height: 72, comment: 'Bright nuclear FITC signal' },
        { id: 'poly-colony-001', type: 'polygon', label: 'cell colony boundary', points: [[210, 310], [290, 298], [340, 360], [250, 390]] },
        { id: 'mask-ref-001', type: 'mask', label: 'nuclei mask', maskRef: 'workspace://images/masks/if-stain-field-01-nuclei.png' },
      ],
    },
  },
};
