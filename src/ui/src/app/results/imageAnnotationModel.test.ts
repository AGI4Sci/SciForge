import assert from 'node:assert/strict';
import test from 'node:test';
import {
  IMAGE_ANNOTATION_SCHEMA,
  annotationRasterOrder,
  createImageAnnotation,
  createImageAnnotationDocument,
  exportSizeForAnnotationDocument,
  moveImageAnnotation,
  screenPointToImagePoint,
  sortAnnotationsForRaster,
  updateImageAnnotationLabel,
} from './imageAnnotationModel';

test('annotation documents default to the versioned schema and source pixel coordinates', () => {
  const document = createImageAnnotationDocument({
    sourceRef: 'artifact:image-1',
    sourceNaturalSize: { width: 3024, height: 1964 },
  });

  assert.equal(IMAGE_ANNOTATION_SCHEMA, 'sciforge.image-annotation.v1');
  assert.equal(document.schema, 'sciforge.image-annotation.v1');
  assert.equal(document.sourceRef, 'artifact:image-1');
  assert.deepEqual(document.sourceNaturalSize, { width: 3024, height: 1964 });
  assert.deepEqual(document.annotations, []);
  assert.deepEqual(document.export, { format: 'png', width: 3024, height: 1964 });
  assert.equal(document.crop, undefined);
});

test('createImageAnnotation supplies deterministic defaults for each supported annotation type', () => {
  const freehand = createImageAnnotation({
    id: 'freehand-1',
    type: 'freehand',
    points: [{ x: 10, y: 20 }],
  });
  const arrow = createImageAnnotation({
    id: 'arrow-1',
    type: 'arrow',
    start: { x: 20, y: 30 },
    end: { x: 80, y: 90 },
  });
  const rect = createImageAnnotation({
    id: 'rect-1',
    type: 'rect',
    rect: { x: 1, y: 2, width: 30, height: 40 },
  });
  const text = createImageAnnotation({
    id: 'text-1',
    type: 'text',
    position: { x: 15, y: 25 },
    text: 'Findings',
  });
  const pin = createImageAnnotation({
    id: 'pin-1',
    type: 'pin',
    position: { x: 100, y: 120 },
    label: '1',
  });
  const highlight = createImageAnnotation({
    id: 'highlight-1',
    type: 'highlight',
    rect: { x: 40, y: 50, width: 60, height: 70 },
  });
  const blur = createImageAnnotation({
    id: 'blur-1',
    type: 'blur',
    rect: { x: 5, y: 6, width: 7, height: 8 },
  });
  const redact = createImageAnnotation({
    id: 'redact-1',
    type: 'redact',
    rect: { x: 9, y: 10, width: 11, height: 12 },
  });

  assert.deepEqual(freehand, {
    id: 'freehand-1',
    type: 'freehand',
    points: [{ x: 10, y: 20 }],
    stroke: '#ffcc00',
    strokeWidth: 6,
    opacity: 1,
  });
  assert.deepEqual(arrow, {
    id: 'arrow-1',
    type: 'arrow',
    start: { x: 20, y: 30 },
    end: { x: 80, y: 90 },
    stroke: '#ffcc00',
    strokeWidth: 6,
    opacity: 1,
  });
  assert.deepEqual(rect, {
    id: 'rect-1',
    type: 'rect',
    rect: { x: 1, y: 2, width: 30, height: 40 },
    stroke: '#ffcc00',
    strokeWidth: 6,
    fill: 'transparent',
    opacity: 1,
  });
  assert.deepEqual(text, {
    id: 'text-1',
    type: 'text',
    position: { x: 15, y: 25 },
    text: 'Findings',
    color: '#ffffff',
    background: '#111827',
    fontSize: 32,
    opacity: 1,
  });
  assert.deepEqual(pin, {
    id: 'pin-1',
    type: 'pin',
    position: { x: 100, y: 120 },
    label: '1',
    color: '#ffffff',
    background: '#dc2626',
    radius: 18,
    opacity: 1,
  });
  assert.deepEqual(highlight, {
    id: 'highlight-1',
    type: 'highlight',
    rect: { x: 40, y: 50, width: 60, height: 70 },
    fill: '#facc15',
    opacity: 0.35,
  });
  assert.deepEqual(blur, {
    id: 'blur-1',
    type: 'blur',
    rect: { x: 5, y: 6, width: 7, height: 8 },
    radius: 22,
    opacity: 1,
  });
  assert.deepEqual(redact, {
    id: 'redact-1',
    type: 'redact',
    rect: { x: 9, y: 10, width: 11, height: 12 },
    fill: '#000000',
    opacity: 1,
  });
});

test('screenPointToImagePoint maps displayed stage coordinates to source image pixels', () => {
  assert.deepEqual(
    screenPointToImagePoint({
      point: { x: 260, y: 220 },
      displayedImageRect: { x: 100, y: 80, width: 800, height: 400 },
      sourceNaturalSize: { width: 1600, height: 800 },
    }),
    { x: 320, y: 280 },
  );
});

test('screenPointToImagePoint accounts for crop offsets and clamps to the crop bounds', () => {
  assert.deepEqual(
    screenPointToImagePoint({
      point: { x: 1000, y: 30 },
      displayedImageRect: { x: 100, y: 80, width: 800, height: 400 },
      sourceNaturalSize: { width: 1600, height: 800 },
      crop: { x: 200, y: 100, width: 1000, height: 500 },
    }),
    { x: 1200, y: 100 },
  );
});

test('screenPointToImagePoint can invert pan and zoom transforms before image mapping', () => {
  assert.deepEqual(
    screenPointToImagePoint({
      point: { x: 470, y: 360 },
      displayedImageRect: { x: 50, y: 40, width: 400, height: 300 },
      sourceNaturalSize: { width: 800, height: 600 },
      transform: { scale: 2, translateX: 120, translateY: 80 },
    }),
    { x: 300, y: 240 },
  );
});

test('exportSizeForAnnotationDocument uses natural size unless crop is present', () => {
  const uncropped = createImageAnnotationDocument({
    sourceRef: 'artifact:image-1',
    sourceNaturalSize: { width: 400, height: 300 },
  });
  const cropped = createImageAnnotationDocument({
    sourceRef: 'artifact:image-1',
    sourceNaturalSize: { width: 400, height: 300 },
    crop: { x: 100, y: 40, width: 125.6, height: 50.2 },
  });
  const tinyCrop = createImageAnnotationDocument({
    sourceRef: 'artifact:image-1',
    sourceNaturalSize: { width: 400, height: 300 },
    crop: { x: 100, y: 40, width: 0.2, height: -9 },
  });

  assert.deepEqual(exportSizeForAnnotationDocument(uncropped), { width: 400, height: 300 });
  assert.deepEqual(exportSizeForAnnotationDocument(cropped), { width: 126, height: 50 });
  assert.deepEqual(exportSizeForAnnotationDocument(tinyCrop), { width: 1, height: 1 });
});

test('annotation raster order is deterministic by layer and original order', () => {
  const annotations = [
    createImageAnnotation({ id: 'text-1', type: 'text', position: { x: 1, y: 1 }, text: 'late' }),
    createImageAnnotation({ id: 'highlight-1', type: 'highlight', rect: { x: 1, y: 1, width: 2, height: 2 } }),
    createImageAnnotation({ id: 'rect-1', type: 'rect', rect: { x: 1, y: 1, width: 2, height: 2 } }),
    createImageAnnotation({ id: 'blur-1', type: 'blur', rect: { x: 1, y: 1, width: 2, height: 2 } }),
    createImageAnnotation({ id: 'pin-1', type: 'pin', position: { x: 1, y: 1 } }),
    createImageAnnotation({ id: 'freehand-1', type: 'freehand', points: [{ x: 1, y: 1 }] }),
    createImageAnnotation({ id: 'arrow-1', type: 'arrow', start: { x: 1, y: 1 }, end: { x: 2, y: 2 } }),
    createImageAnnotation({ id: 'redact-1', type: 'redact', rect: { x: 1, y: 1, width: 2, height: 2 } }),
    createImageAnnotation({ id: 'text-2', type: 'text', position: { x: 2, y: 2 }, text: 'later' }),
  ];

  assert.deepEqual(annotations.map(annotationRasterOrder), [7, 2, 4, 1, 6, 3, 5, 1, 7]);
  assert.deepEqual(sortAnnotationsForRaster(annotations).map((annotation) => annotation.id), [
    'blur-1',
    'redact-1',
    'highlight-1',
    'freehand-1',
    'rect-1',
    'arrow-1',
    'pin-1',
    'text-1',
    'text-2',
  ]);
});

test('moveImageAnnotation translates every editable annotation geometry without mutating the source', () => {
  const annotations = [
    createImageAnnotation({ id: 'freehand-1', type: 'freehand', points: [{ x: 10, y: 20 }, { x: 30, y: 40 }] }),
    createImageAnnotation({ id: 'arrow-1', type: 'arrow', start: { x: 50, y: 60 }, end: { x: 70, y: 80 } }),
    createImageAnnotation({ id: 'rect-1', type: 'rect', rect: { x: 90, y: 100, width: 110, height: 120 } }),
    createImageAnnotation({ id: 'pin-1', type: 'pin', position: { x: 130, y: 140 }, label: '1' }),
    createImageAnnotation({ id: 'text-1', type: 'text', position: { x: 150, y: 160 }, text: 'Before' }),
    createImageAnnotation({ id: 'highlight-1', type: 'highlight', rect: { x: 170, y: 180, width: 50, height: 60 } }),
    createImageAnnotation({ id: 'blur-1', type: 'blur', rect: { x: 190, y: 200, width: 20, height: 30 } }),
    createImageAnnotation({ id: 'redact-1', type: 'redact', rect: { x: 210, y: 220, width: 25, height: 35 } }),
  ];

  const moved = annotations.map((annotation) => moveImageAnnotation(annotation, { x: 7, y: -5 }));

  assert.deepEqual(moved.map((annotation) => {
    if (annotation.type === 'freehand') return annotation.points;
    if (annotation.type === 'arrow') return [annotation.start, annotation.end];
    if (annotation.type === 'pin' || annotation.type === 'text') return annotation.position;
    return annotation.rect;
  }), [
    [{ x: 17, y: 15 }, { x: 37, y: 35 }],
    [{ x: 57, y: 55 }, { x: 77, y: 75 }],
    { x: 97, y: 95, width: 110, height: 120 },
    { x: 137, y: 135 },
    { x: 157, y: 155 },
    { x: 177, y: 175, width: 50, height: 60 },
    { x: 197, y: 195, width: 20, height: 30 },
    { x: 217, y: 215, width: 25, height: 35 },
  ]);
  assert.deepEqual(
    annotations[0]?.type === 'freehand' ? annotations[0].points : undefined,
    [{ x: 10, y: 20 }, { x: 30, y: 40 }],
  );
});

test('updateImageAnnotationLabel edits historical text and pin content only', () => {
  const text = createImageAnnotation({ id: 'text-1', type: 'text', position: { x: 10, y: 20 }, text: 'Before' });
  const pin = createImageAnnotation({ id: 'pin-1', type: 'pin', position: { x: 30, y: 40 }, label: '1' });
  const rect = createImageAnnotation({ id: 'rect-1', type: 'rect', rect: { x: 1, y: 2, width: 3, height: 4 } });

  const updatedText = updateImageAnnotationLabel(text, 'After');
  const updatedPin = updateImageAnnotationLabel(pin, 'A');

  assert.equal(updatedText.type === 'text' ? updatedText.text : undefined, 'After');
  assert.equal(updatedPin.type === 'pin' ? updatedPin.label : undefined, 'A');
  assert.equal(updateImageAnnotationLabel(rect, 'Ignored'), rect);
});
