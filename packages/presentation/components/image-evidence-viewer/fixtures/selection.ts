import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const selectionImageEvidenceViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'image-evidence-viewer', props: { selectedAnnotationRef: 'annotation:evidence/box-1.json' } },
  artifact: {
    id: 'image-evidence-selection',
    type: 'image-evidence',
    producerScenario: 'image-evidence-preview',
    schemaVersion: '1.0.0',
    data: {
      sourceKind: 'screen-region',
      imageRef: 'image:evidence/region-001.webp',
      mime: 'image/webp',
      width: 960,
      height: 540,
      provenanceRef: 'prov:evidence/region-001.json',
      annotationRefs: ['annotation:evidence/box-1.json'],
      cropBounds: { x: 120, y: 80, width: 420, height: 260 },
      status: 'reviewing',
    },
  },
};
