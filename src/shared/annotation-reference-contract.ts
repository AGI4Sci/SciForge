export const SCIFORGE_ANNOTATION_REFERENCE_DISPLAY_MODEL =
  'sciforge.annotation-reference.v1' as const;

export type SciForgeAnnotationSourceKind =
  | 'browser'
  | 'window'
  | 'screen-region'
  | 'image';

export type SciForgeAnnotationCoordinateSpace =
  | 'browser-viewport'
  | 'window-local'
  | 'screen-global'
  | 'image-local';

export type SciForgeAnnotationBounds = {
  x: number;
  y: number;
  width: number;
  height: number;
};
