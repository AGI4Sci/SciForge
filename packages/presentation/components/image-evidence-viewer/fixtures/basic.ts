import type { UIComponentRendererProps } from '@sciforge-ui/runtime-contract';

export const basicImageEvidenceViewerFixture: UIComponentRendererProps = {
  slot: { componentId: 'image-evidence-viewer' },
  artifact: {
    id: 'image-evidence-basic',
    type: 'image-evidence',
    producerScenario: 'image-evidence-preview',
    schemaVersion: '1.0.0',
    data: {
      sourceKind: 'annotation-crop',
      imageRef: 'image:evidence/crop-001.png',
      mime: 'image/png',
      width: 1440,
      height: 900,
      sha256: 'abc123def456',
      createdAt: '2026-06-03T08:30:00.000Z',
      provenanceRef: 'prov:evidence/crop-001.json',
      provenanceRefs: [
        'prov:evidence/crop-001.json',
        'ledger:evidence/crop-001.json',
      ],
      annotationRefs: [
        'annotation:evidence/box-1.json',
        'annotation:evidence/label-save.json',
      ],
      targetRef: 'target:ui/button-save',
      windowRef: 'window:research-app/main',
      browserSessionRef: 'browser-session:evidence-demo',
      artifactRef: 'artifact:run-output/figure.png',
      redactionRef: 'mask:evidence/crop-001.json',
      bounds: { x: 0, y: 0, width: 1440, height: 900 },
      cropBounds: { x: 40, y: 60, width: 320, height: 180 },
      status: 'ready',
    },
  },
};
