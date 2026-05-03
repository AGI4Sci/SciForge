import type { UIComponentManifest } from '@sciforge-ui/runtime-contract';

export const manifest: UIComponentManifest = {
  packageName: '@sciforge-ui/image-annotation-viewer',
  moduleId: 'image-annotation-viewer',
  version: '0.1.0',
  title: 'Image annotation viewer',
  description: 'Skeleton image annotation component for scientific images with regions, masks, and comment anchors.',
  componentId: 'image-annotation-viewer',
  lifecycle: 'draft',
  outputArtifactTypes: ['image-volume', 'visual-annotation'],
  acceptsArtifactTypes: ['image-volume', 'image-annotation', 'microscopy-image', 'pathology-image', 'gel-image', 'blot-image'],
  requiredAnyFields: [['imageRef', 'image', 'path', 'filePath', 'annotations', 'regions', 'masks']],
  viewParams: ['channel', 'contrast', 'zoom', 'showMasks', 'showLabels', 'annotationMode', 'selectedAnnotationId'],
  interactionEvents: ['select-region', 'create-annotation', 'update-annotation', 'open-image-ref'],
  roleDefaults: ['experimental-biologist', 'bioinformatician', 'pi'],
  fallbackModuleIds: ['generic-artifact-inspector'],
  defaultSection: 'primary',
  priority: 26,
  safety: { sandbox: true, externalResources: 'declared-only', executesCode: false },
  presentation: {
    dedupeScope: 'entity',
    identityFields: ['imageId', 'image_id', 'annotationSetId', 'annotation_set_id', 'imageRef', 'dataRef'],
  },
  docs: {
    readmePath: 'packages/ui-components/image-annotation-viewer/README.md',
    agentSummary: 'Use for scientific image refs with bbox, polygon, mask, point, or comment-anchor annotations. It does not load unsafe remote image resources.',
  },
  workbenchDemo: {
    artifactType: 'image-annotation',
    artifactData: {
      primitive: 'image-volume',
      imageRef: 'workspace://images/if-stain-demo.tiff',
      dimensions: { width: 1024, height: 768, channels: ['DAPI', 'FITC'] },
      annotations: [{ id: 'roi-1', type: 'bbox', label: 'Ki67 positive nucleus', x: 412, y: 260, width: 88, height: 72 }],
    },
  },
};
