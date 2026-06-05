export const IMAGE_ANNOTATION_SCHEMA = 'sciforge.image-annotation.v1' as const;

export interface ImageAnnotationPoint {
  x: number;
  y: number;
}

export interface ImageAnnotationSize {
  width: number;
  height: number;
}

export interface ImageAnnotationRect extends ImageAnnotationPoint, ImageAnnotationSize {}

export interface ImageAnnotationExport {
  format: 'png';
  width: number;
  height: number;
}

export type ImageAnnotationType =
  | 'freehand'
  | 'arrow'
  | 'rect'
  | 'text'
  | 'pin'
  | 'highlight'
  | 'blur'
  | 'redact';

interface ImageAnnotationBase {
  id: string;
  type: ImageAnnotationType;
  opacity: number;
}

export interface FreehandImageAnnotation extends ImageAnnotationBase {
  type: 'freehand';
  points: ImageAnnotationPoint[];
  stroke: string;
  strokeWidth: number;
}

export interface ArrowImageAnnotation extends ImageAnnotationBase {
  type: 'arrow';
  start: ImageAnnotationPoint;
  end: ImageAnnotationPoint;
  stroke: string;
  strokeWidth: number;
}

export interface RectImageAnnotation extends ImageAnnotationBase {
  type: 'rect';
  rect: ImageAnnotationRect;
  stroke: string;
  strokeWidth: number;
  fill: string;
}

export interface TextImageAnnotation extends ImageAnnotationBase {
  type: 'text';
  position: ImageAnnotationPoint;
  text: string;
  color: string;
  background: string;
  fontSize: number;
}

export interface PinImageAnnotation extends ImageAnnotationBase {
  type: 'pin';
  position: ImageAnnotationPoint;
  label: string;
  color: string;
  background: string;
  radius: number;
}

export interface HighlightImageAnnotation extends ImageAnnotationBase {
  type: 'highlight';
  rect: ImageAnnotationRect;
  fill: string;
}

export interface BlurImageAnnotation extends ImageAnnotationBase {
  type: 'blur';
  rect: ImageAnnotationRect;
  radius: number;
}

export interface RedactImageAnnotation extends ImageAnnotationBase {
  type: 'redact';
  rect: ImageAnnotationRect;
  fill: string;
}

export type ImageAnnotation =
  | FreehandImageAnnotation
  | ArrowImageAnnotation
  | RectImageAnnotation
  | TextImageAnnotation
  | PinImageAnnotation
  | HighlightImageAnnotation
  | BlurImageAnnotation
  | RedactImageAnnotation;

export interface ImageAnnotationDocument {
  schema: typeof IMAGE_ANNOTATION_SCHEMA;
  sourceRef: string;
  sourceNaturalSize: ImageAnnotationSize;
  crop?: ImageAnnotationRect;
  annotations: ImageAnnotation[];
  export: ImageAnnotationExport;
  createdAt?: string;
}

export type CreateImageAnnotationDocumentInput = {
  sourceRef: string;
  sourceNaturalSize: ImageAnnotationSize;
  crop?: ImageAnnotationRect;
  annotations?: ImageAnnotation[];
  createdAt?: string;
};

export type CreateImageAnnotationInput =
  | ({
    id: string;
    type: 'freehand';
    points: ImageAnnotationPoint[];
  } & Partial<Pick<FreehandImageAnnotation, 'stroke' | 'strokeWidth' | 'opacity'>>)
  | ({
    id: string;
    type: 'arrow';
    start: ImageAnnotationPoint;
    end: ImageAnnotationPoint;
  } & Partial<Pick<ArrowImageAnnotation, 'stroke' | 'strokeWidth' | 'opacity'>>)
  | ({
    id: string;
    type: 'rect';
    rect: ImageAnnotationRect;
  } & Partial<Pick<RectImageAnnotation, 'stroke' | 'strokeWidth' | 'fill' | 'opacity'>>)
  | ({
    id: string;
    type: 'text';
    position: ImageAnnotationPoint;
    text?: string;
  } & Partial<Pick<TextImageAnnotation, 'color' | 'background' | 'fontSize' | 'opacity'>>)
  | ({
    id: string;
    type: 'pin';
    position: ImageAnnotationPoint;
    label?: string;
  } & Partial<Pick<PinImageAnnotation, 'color' | 'background' | 'radius' | 'opacity'>>)
  | ({
    id: string;
    type: 'highlight';
    rect: ImageAnnotationRect;
  } & Partial<Pick<HighlightImageAnnotation, 'fill' | 'opacity'>>)
  | ({
    id: string;
    type: 'blur';
    rect: ImageAnnotationRect;
  } & Partial<Pick<BlurImageAnnotation, 'radius' | 'opacity'>>)
  | ({
    id: string;
    type: 'redact';
    rect: ImageAnnotationRect;
  } & Partial<Pick<RedactImageAnnotation, 'fill' | 'opacity'>>);

export interface ScreenPointToImagePointInput {
  point: ImageAnnotationPoint;
  displayedImageRect: ImageAnnotationRect;
  sourceNaturalSize: ImageAnnotationSize;
  crop?: ImageAnnotationRect;
  transform?: {
    scale?: number;
    translateX?: number;
    translateY?: number;
  };
}

const DEFAULT_STROKE = '#ffcc00';
const DEFAULT_STROKE_WIDTH = 6;
const DEFAULT_OPACITY = 1;
const DEFAULT_TEXT_COLOR = '#ffffff';
const DEFAULT_TEXT_BACKGROUND = '#111827';
const DEFAULT_TEXT_SIZE = 32;
const DEFAULT_PIN_BACKGROUND = '#dc2626';
const DEFAULT_PIN_RADIUS = 18;
const DEFAULT_HIGHLIGHT_FILL = '#facc15';
const DEFAULT_HIGHLIGHT_OPACITY = 0.35;
const DEFAULT_BLUR_RADIUS = 22;
const DEFAULT_REDACT_FILL = '#000000';

export function createImageAnnotationDocument(input: CreateImageAnnotationDocumentInput): ImageAnnotationDocument {
  const document: ImageAnnotationDocument = {
    schema: IMAGE_ANNOTATION_SCHEMA,
    sourceRef: input.sourceRef,
    sourceNaturalSize: input.sourceNaturalSize,
    crop: input.crop,
    annotations: input.annotations ?? [],
    export: { format: 'png', ...exportSizeForGeometry(input.sourceNaturalSize, input.crop) },
  };

  if (input.createdAt !== undefined) {
    document.createdAt = input.createdAt;
  }

  return document;
}

export function createImageAnnotation(input: CreateImageAnnotationInput): ImageAnnotation {
  switch (input.type) {
    case 'freehand':
      return {
        id: input.id,
        type: 'freehand',
        points: input.points,
        stroke: input.stroke ?? DEFAULT_STROKE,
        strokeWidth: input.strokeWidth ?? DEFAULT_STROKE_WIDTH,
        opacity: input.opacity ?? DEFAULT_OPACITY,
      };
    case 'arrow':
      return {
        id: input.id,
        type: 'arrow',
        start: input.start,
        end: input.end,
        stroke: input.stroke ?? DEFAULT_STROKE,
        strokeWidth: input.strokeWidth ?? DEFAULT_STROKE_WIDTH,
        opacity: input.opacity ?? DEFAULT_OPACITY,
      };
    case 'rect':
      return {
        id: input.id,
        type: 'rect',
        rect: input.rect,
        stroke: input.stroke ?? DEFAULT_STROKE,
        strokeWidth: input.strokeWidth ?? DEFAULT_STROKE_WIDTH,
        fill: input.fill ?? 'transparent',
        opacity: input.opacity ?? DEFAULT_OPACITY,
      };
    case 'text':
      return {
        id: input.id,
        type: 'text',
        position: input.position,
        text: input.text ?? '',
        color: input.color ?? DEFAULT_TEXT_COLOR,
        background: input.background ?? DEFAULT_TEXT_BACKGROUND,
        fontSize: input.fontSize ?? DEFAULT_TEXT_SIZE,
        opacity: input.opacity ?? DEFAULT_OPACITY,
      };
    case 'pin':
      return {
        id: input.id,
        type: 'pin',
        position: input.position,
        label: input.label ?? '',
        color: input.color ?? DEFAULT_TEXT_COLOR,
        background: input.background ?? DEFAULT_PIN_BACKGROUND,
        radius: input.radius ?? DEFAULT_PIN_RADIUS,
        opacity: input.opacity ?? DEFAULT_OPACITY,
      };
    case 'highlight':
      return {
        id: input.id,
        type: 'highlight',
        rect: input.rect,
        fill: input.fill ?? DEFAULT_HIGHLIGHT_FILL,
        opacity: input.opacity ?? DEFAULT_HIGHLIGHT_OPACITY,
      };
    case 'blur':
      return {
        id: input.id,
        type: 'blur',
        rect: input.rect,
        radius: input.radius ?? DEFAULT_BLUR_RADIUS,
        opacity: input.opacity ?? DEFAULT_OPACITY,
      };
    case 'redact':
      return {
        id: input.id,
        type: 'redact',
        rect: input.rect,
        fill: input.fill ?? DEFAULT_REDACT_FILL,
        opacity: input.opacity ?? DEFAULT_OPACITY,
      };
  }
}

export function screenPointToImagePoint(input: ScreenPointToImagePointInput): ImageAnnotationPoint {
  const { displayedImageRect, point, sourceNaturalSize } = input;
  const transform = input.transform ?? {};
  const scale = finitePositive(transform.scale, 1);
  const translateX = finiteNumber(transform.translateX, 0);
  const translateY = finiteNumber(transform.translateY, 0);
  const activeRect = imageActiveRect(sourceNaturalSize, input.crop);

  const localX = (point.x - displayedImageRect.x - translateX) / scale;
  const localY = (point.y - displayedImageRect.y - translateY) / scale;
  const widthRatio = safeRatio(localX, displayedImageRect.width);
  const heightRatio = safeRatio(localY, displayedImageRect.height);
  const x = activeRect.x + widthRatio * activeRect.width;
  const y = activeRect.y + heightRatio * activeRect.height;

  return {
    x: clamp(x, activeRect.x, activeRect.x + activeRect.width),
    y: clamp(y, activeRect.y, activeRect.y + activeRect.height),
  };
}

export function exportSizeForAnnotationDocument(document: Pick<ImageAnnotationDocument, 'sourceNaturalSize' | 'crop'>): ImageAnnotationSize {
  return exportSizeForGeometry(document.sourceNaturalSize, document.crop);
}

export function annotationRasterOrder(annotation: Pick<ImageAnnotation, 'type'>): number {
  switch (annotation.type) {
    case 'blur':
    case 'redact':
      return 1;
    case 'highlight':
      return 2;
    case 'freehand':
      return 3;
    case 'rect':
      return 4;
    case 'arrow':
      return 5;
    case 'pin':
      return 6;
    case 'text':
      return 7;
  }
}

export function sortAnnotationsForRaster<T extends Pick<ImageAnnotation, 'type'>>(annotations: readonly T[]): T[] {
  return annotations
    .map((annotation, index) => ({ annotation, index }))
    .sort((left, right) => {
      const orderDelta = annotationRasterOrder(left.annotation) - annotationRasterOrder(right.annotation);
      return orderDelta === 0 ? left.index - right.index : orderDelta;
    })
    .map(({ annotation }) => annotation);
}

export function moveImageAnnotation<T extends ImageAnnotation>(annotation: T, delta: ImageAnnotationPoint): T {
  const offset = {
    x: finiteNumber(delta.x, 0),
    y: finiteNumber(delta.y, 0),
  };
  switch (annotation.type) {
    case 'freehand':
      return {
        ...annotation,
        points: annotation.points.map((point) => movePoint(point, offset)),
      } as T;
    case 'arrow':
      return {
        ...annotation,
        start: movePoint(annotation.start, offset),
        end: movePoint(annotation.end, offset),
      } as T;
    case 'rect':
    case 'highlight':
    case 'blur':
    case 'redact':
      return {
        ...annotation,
        rect: moveRect(annotation.rect, offset),
      } as T;
    case 'pin':
    case 'text':
      return {
        ...annotation,
        position: movePoint(annotation.position, offset),
      } as T;
  }
}

export function updateImageAnnotationLabel<T extends ImageAnnotation>(annotation: T, label: string): T {
  if (annotation.type === 'text') {
    return { ...annotation, text: label } as T;
  }
  if (annotation.type === 'pin') {
    return { ...annotation, label } as T;
  }
  return annotation;
}

function exportSizeForGeometry(sourceNaturalSize: ImageAnnotationSize, crop?: ImageAnnotationRect): ImageAnnotationSize {
  const size = crop ?? sourceNaturalSize;
  return {
    width: positiveInteger(size.width),
    height: positiveInteger(size.height),
  };
}

function imageActiveRect(sourceNaturalSize: ImageAnnotationSize, crop?: ImageAnnotationRect): ImageAnnotationRect {
  if (!crop) {
    return {
      x: 0,
      y: 0,
      width: Math.max(0, finiteNumber(sourceNaturalSize.width, 0)),
      height: Math.max(0, finiteNumber(sourceNaturalSize.height, 0)),
    };
  }

  const sourceWidth = Math.max(0, finiteNumber(sourceNaturalSize.width, 0));
  const sourceHeight = Math.max(0, finiteNumber(sourceNaturalSize.height, 0));
  const minX = clamp(finiteNumber(crop.x, 0), 0, sourceWidth);
  const minY = clamp(finiteNumber(crop.y, 0), 0, sourceHeight);
  const maxX = clamp(finiteNumber(crop.x + crop.width, minX), minX, sourceWidth);
  const maxY = clamp(finiteNumber(crop.y + crop.height, minY), minY, sourceHeight);

  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
}

function positiveInteger(value: number): number {
  const rounded = Math.round(finiteNumber(value, 1));
  return Math.max(1, rounded);
}

function safeRatio(numerator: number, denominator: number): number {
  const safeDenominator = finiteNumber(denominator, 0);
  return safeDenominator <= 0 ? 0 : numerator / safeDenominator;
}

function finitePositive(value: number | undefined, fallback: number): number {
  const finite = finiteNumber(value, fallback);
  return finite > 0 ? finite : fallback;
}

function finiteNumber(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function movePoint(point: ImageAnnotationPoint, delta: ImageAnnotationPoint): ImageAnnotationPoint {
  return {
    x: point.x + delta.x,
    y: point.y + delta.y,
  };
}

function moveRect(rect: ImageAnnotationRect, delta: ImageAnnotationPoint): ImageAnnotationRect {
  return {
    ...rect,
    x: rect.x + delta.x,
    y: rect.y + delta.y,
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
