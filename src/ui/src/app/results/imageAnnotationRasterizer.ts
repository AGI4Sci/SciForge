export interface ImageAnnotationPoint {
  x: number;
  y: number;
}

export interface ImageAnnotationSize {
  width: number;
  height: number;
}

export interface ImageAnnotationRect extends ImageAnnotationPoint, ImageAnnotationSize {}

export interface ImageAnnotationDocument {
  schema: 'sciforge.image-annotation.v1';
  sourceRef: string;
  sourceNaturalSize: ImageAnnotationSize;
  crop?: ImageAnnotationRect;
  annotations: ImageAnnotation[];
  export?: {
    format: 'png';
    width: number;
    height: number;
  };
}

export type ImageAnnotation =
  | {
    id: string;
    type: 'blur' | 'redact' | 'highlight';
    rect: ImageAnnotationRect;
    radius?: number;
    fill?: string;
    opacity?: number;
  }
  | {
    id: string;
    type: 'freehand';
    points: ImageAnnotationPoint[];
    stroke?: string;
    strokeWidth?: number;
    opacity?: number;
  }
  | {
    id: string;
    type: 'arrow';
    start: ImageAnnotationPoint;
    end: ImageAnnotationPoint;
    stroke?: string;
    strokeWidth?: number;
    opacity?: number;
  }
  | {
    id: string;
    type: 'rect' | 'rectangle';
    rect: ImageAnnotationRect;
    stroke?: string;
    strokeWidth?: number;
    fill?: string;
    opacity?: number;
  }
  | {
    id: string;
    type: 'pin';
    position: ImageAnnotationPoint;
    label?: string;
    color?: string;
    background?: string;
    radius?: number;
    opacity?: number;
  }
  | {
    id: string;
    type: 'text';
    position: ImageAnnotationPoint;
    text: string;
    color?: string;
    background?: string;
    fontSize?: number;
    opacity?: number;
  };

export type ImageAnnotationRenderCommand =
  | {
    kind: 'sourceImage';
    sourceRect: ImageAnnotationRect;
    destinationRect: ImageAnnotationRect;
  }
  | {
    kind: 'blurRedact';
    annotationId: string;
    effect: 'blur' | 'redact';
    rect: ImageAnnotationRect;
    radius?: number;
    fill?: string;
  }
  | {
    kind: 'highlight';
    annotationId: string;
    rect: ImageAnnotationRect;
    fill?: string;
    opacity?: number;
  }
  | {
    kind: 'freehand';
    annotationId: string;
    points: ImageAnnotationPoint[];
    stroke?: string;
    strokeWidth?: number;
  }
  | {
    kind: 'arrow';
    annotationId: string;
    start: ImageAnnotationPoint;
    end: ImageAnnotationPoint;
    stroke?: string;
    strokeWidth?: number;
  }
  | {
    kind: 'shape';
    annotationId: string;
    shape: 'rectangle';
    rect: ImageAnnotationRect;
    stroke?: string;
    strokeWidth?: number;
    fill?: string;
  }
  | {
    kind: 'pin';
    annotationId: string;
    position: ImageAnnotationPoint;
    label?: string;
    color?: string;
    background?: string;
    radius?: number;
  }
  | {
    kind: 'text';
    annotationId: string;
    position: ImageAnnotationPoint;
    text: string;
    color?: string;
    background?: string;
    fontSize?: number;
  };

export interface ImageAnnotationRenderPlan {
  outputSize: ImageAnnotationSize;
  sourceCropRect: ImageAnnotationRect;
  commands: ImageAnnotationRenderCommand[];
}

type RasterCanvas = HTMLCanvasElement;
type RasterCanvasContext = CanvasRenderingContext2D;

export function buildImageAnnotationRenderPlan(document: ImageAnnotationDocument): ImageAnnotationRenderPlan {
  const sourceCropRect = normalizedCrop(document.sourceNaturalSize, document.crop);
  const outputSize = {
    width: sourceCropRect.width,
    height: sourceCropRect.height,
  };
  const commands: ImageAnnotationRenderCommand[] = [{
    kind: 'sourceImage',
    sourceRect: sourceCropRect,
    destinationRect: { x: 0, y: 0, width: outputSize.width, height: outputSize.height },
  }];

  for (const annotation of orderedAnnotations(document.annotations)) {
    const command = renderCommandForAnnotation(annotation, sourceCropRect);
    if (command) commands.push(command);
  }

  return { outputSize, sourceCropRect, commands };
}

export async function rasterizeImageAnnotationToPngBlob(
  imageSource: string | Blob | CanvasImageSource,
  document: ImageAnnotationDocument,
): Promise<Blob> {
  if (!globalThis.document?.createElement) {
    throw new Error('A browser canvas runtime is required to rasterize image annotations to PNG.');
  }
  const plan = buildImageAnnotationRenderPlan(document);
  const canvas = createRasterCanvas(plan.outputSize.width, plan.outputSize.height);
  const context = canvas.getContext('2d');
  if (!context) throw new Error('A browser canvas runtime is required to rasterize image annotations to PNG.');
  const image = await loadCanvasImageSource(imageSource);
  context.drawImage(
    image,
    plan.sourceCropRect.x,
    plan.sourceCropRect.y,
    plan.sourceCropRect.width,
    plan.sourceCropRect.height,
    0,
    0,
    plan.outputSize.width,
    plan.outputSize.height,
  );
  for (const command of plan.commands.slice(1)) drawCommand(context, canvas, command);
  return canvasToPngBlob(canvas);
}

function orderedAnnotations(annotations: ImageAnnotation[]): ImageAnnotation[] {
  return [...annotations].sort((left, right) => annotationLayer(left) - annotationLayer(right));
}

function annotationLayer(annotation: ImageAnnotation): number {
  if (annotation.type === 'blur' || annotation.type === 'redact') return 10;
  if (annotation.type === 'highlight') return 20;
  if (annotation.type === 'freehand') return 30;
  if (annotation.type === 'rect' || annotation.type === 'rectangle') return 40;
  if (annotation.type === 'arrow') return 50;
  if (annotation.type === 'pin') return 60;
  return 70;
}

function renderCommandForAnnotation(
  annotation: ImageAnnotation,
  crop: ImageAnnotationRect,
): ImageAnnotationRenderCommand | undefined {
  if (annotation.type === 'blur' || annotation.type === 'redact') {
    return compactCommand<ImageAnnotationRenderCommand>({
      kind: 'blurRedact',
      annotationId: annotation.id,
      effect: annotation.type,
      rect: translateRect(annotation.rect, crop),
      radius: annotation.radius,
      fill: annotation.fill,
    });
  }
  if (annotation.type === 'highlight') {
    return compactCommand<ImageAnnotationRenderCommand>({
      kind: 'highlight',
      annotationId: annotation.id,
      rect: translateRect(annotation.rect, crop),
      fill: annotation.fill,
      opacity: annotation.opacity,
    });
  }
  if (annotation.type === 'freehand') {
    return compactCommand<ImageAnnotationRenderCommand>({
      kind: 'freehand',
      annotationId: annotation.id,
      points: annotation.points.map((point) => translatePoint(point, crop)),
      stroke: annotation.stroke,
      strokeWidth: annotation.strokeWidth,
    });
  }
  if (annotation.type === 'arrow') {
    return compactCommand<ImageAnnotationRenderCommand>({
      kind: 'arrow',
      annotationId: annotation.id,
      start: translatePoint(annotation.start, crop),
      end: translatePoint(annotation.end, crop),
      stroke: annotation.stroke,
      strokeWidth: annotation.strokeWidth,
    });
  }
  if (annotation.type === 'rect' || annotation.type === 'rectangle') {
    return compactCommand<ImageAnnotationRenderCommand>({
      kind: 'shape',
      annotationId: annotation.id,
      shape: 'rectangle',
      rect: translateRect(annotation.rect, crop),
      stroke: annotation.stroke,
      strokeWidth: annotation.strokeWidth,
      fill: annotation.fill,
    });
  }
  if (annotation.type === 'pin') {
    return compactCommand<ImageAnnotationRenderCommand>({
      kind: 'pin',
      annotationId: annotation.id,
      position: translatePoint(annotation.position, crop),
      label: annotation.label,
      color: annotation.color,
      background: annotation.background,
      radius: annotation.radius,
    });
  }
  if (annotation.type === 'text') {
    return compactCommand<ImageAnnotationRenderCommand>({
      kind: 'text',
      annotationId: annotation.id,
      position: translatePoint(annotation.position, crop),
      text: annotation.text,
      color: annotation.color,
      background: annotation.background,
      fontSize: annotation.fontSize,
    });
  }
  return undefined;
}

function normalizedCrop(sourceSize: ImageAnnotationSize, crop?: ImageAnnotationRect): ImageAnnotationRect {
  if (!crop) return { x: 0, y: 0, width: sourceSize.width, height: sourceSize.height };
  return {
    x: crop.x,
    y: crop.y,
    width: Math.max(1, Math.min(crop.width, sourceSize.width - crop.x)),
    height: Math.max(1, Math.min(crop.height, sourceSize.height - crop.y)),
  };
}

function translateRect(rect: ImageAnnotationRect, crop: ImageAnnotationRect): ImageAnnotationRect {
  return {
    x: rect.x - crop.x,
    y: rect.y - crop.y,
    width: rect.width,
    height: rect.height,
  };
}

function translatePoint(point: ImageAnnotationPoint, crop: ImageAnnotationRect): ImageAnnotationPoint {
  return {
    x: point.x - crop.x,
    y: point.y - crop.y,
  };
}

function compactCommand<T extends ImageAnnotationRenderCommand>(command: T): T {
  return Object.fromEntries(Object.entries(command).filter(([, value]) => value !== undefined)) as T;
}

async function loadCanvasImageSource(imageSource: string | Blob | CanvasImageSource): Promise<CanvasImageSource> {
  if (typeof imageSource === 'string') return loadImage(imageSource);
  if (typeof Blob !== 'undefined' && imageSource instanceof Blob) {
    if (typeof createImageBitmap === 'function') return createImageBitmap(imageSource);
    const objectUrl = globalThis.URL.createObjectURL(imageSource);
    try {
      return await loadImage(objectUrl);
    } finally {
      globalThis.URL.revokeObjectURL(objectUrl);
    }
  }
  return imageSource as CanvasImageSource;
}

function loadImage(sourceImageUrl: string): Promise<HTMLImageElement> {
  if (typeof Image !== 'function') {
    throw new Error('Browser image loading support is required to rasterize image annotations to PNG.');
  }
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'anonymous';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error(`Failed to load image for annotation export: ${sourceImageUrl}`));
    image.src = sourceImageUrl;
  });
}

function createRasterCanvas(width: number, height: number): RasterCanvas {
  const canvasWidth = Math.max(1, Math.ceil(width));
  const canvasHeight = Math.max(1, Math.ceil(height));
  const canvas = globalThis.document.createElement('canvas');
  canvas.width = canvasWidth;
  canvas.height = canvasHeight;
  return canvas;
}

async function canvasToPngBlob(canvas: RasterCanvas): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Canvas PNG export returned no blob.'));
    }, 'image/png');
  });
}

function drawCommand(context: RasterCanvasContext, canvas: RasterCanvas, command: ImageAnnotationRenderCommand) {
  if (command.kind === 'highlight') {
    context.save();
    context.globalAlpha = command.opacity ?? 0.35;
    context.fillStyle = command.fill ?? '#facc15';
    context.fillRect(command.rect.x, command.rect.y, command.rect.width, command.rect.height);
    context.restore();
    return;
  }
  if (command.kind === 'freehand') {
    drawPolyline(context, command.points, command.stroke ?? '#ffcc00', command.strokeWidth ?? 6);
    return;
  }
  if (command.kind === 'arrow') {
    drawPolyline(context, [command.start, command.end], command.stroke ?? '#ffcc00', command.strokeWidth ?? 6);
    return;
  }
  if (command.kind === 'shape') {
    context.save();
    context.strokeStyle = command.stroke ?? '#ffcc00';
    context.lineWidth = command.strokeWidth ?? 6;
    if (command.fill && command.fill !== 'transparent') {
      context.fillStyle = command.fill;
      context.fillRect(command.rect.x, command.rect.y, command.rect.width, command.rect.height);
    }
    context.strokeRect(command.rect.x, command.rect.y, command.rect.width, command.rect.height);
    context.restore();
    return;
  }
  if (command.kind === 'pin') {
    context.save();
    context.fillStyle = command.background ?? '#dc2626';
    context.beginPath();
    context.arc(command.position.x, command.position.y, command.radius ?? 18, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = command.color ?? '#ffffff';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(command.label ?? '', command.position.x, command.position.y);
    context.restore();
    return;
  }
  if (command.kind === 'text') {
    context.save();
    context.fillStyle = command.color ?? '#ffffff';
    context.font = `${command.fontSize ?? 32}px sans-serif`;
    context.fillText(command.text, command.position.x, command.position.y);
    context.restore();
    return;
  }
  if (command.kind === 'blurRedact' && command.effect === 'redact') {
    context.save();
    context.fillStyle = command.fill ?? '#000000';
    context.fillRect(command.rect.x, command.rect.y, command.rect.width, command.rect.height);
    context.restore();
    return;
  }
  if (command.kind === 'blurRedact') {
    const scratch = createRasterCanvas(command.rect.width, command.rect.height);
    const scratchContext = scratch.getContext('2d');
    if (!scratchContext) return;
    scratchContext.drawImage(
      canvas,
      command.rect.x,
      command.rect.y,
      command.rect.width,
      command.rect.height,
      0,
      0,
      command.rect.width,
      command.rect.height,
    );
    context.save();
    context.filter = `blur(${command.radius ?? 12}px)`;
    context.drawImage(scratch, command.rect.x, command.rect.y);
    context.restore();
  }
}

function drawPolyline(
  context: CanvasRenderingContext2D,
  points: ImageAnnotationPoint[],
  stroke: string,
  strokeWidth: number,
) {
  if (!points.length) return;
  context.save();
  context.strokeStyle = stroke;
  context.lineWidth = strokeWidth;
  context.lineCap = 'round';
  context.lineJoin = 'round';
  context.beginPath();
  context.moveTo(points[0].x, points[0].y);
  for (const point of points.slice(1)) context.lineTo(point.x, point.y);
  context.stroke();
  context.restore();
}
