import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildImageAnnotationRenderPlan,
  rasterizeImageAnnotationToPngBlob,
  type ImageAnnotationDocument,
} from './imageAnnotationRasterizer';

const baseDocument: ImageAnnotationDocument = {
  schema: 'sciforge.image-annotation.v1',
  sourceRef: 'image:source/demo.png',
  sourceNaturalSize: { width: 640, height: 480 },
  annotations: [],
};

test('image annotation rasterizer plans an uncropped source image as the base command', () => {
  const plan = buildImageAnnotationRenderPlan(baseDocument);

  assert.deepEqual(plan.outputSize, { width: 640, height: 480 });
  assert.deepEqual(plan.sourceCropRect, { x: 0, y: 0, width: 640, height: 480 });
  assert.deepEqual(plan.commands, [{
    kind: 'sourceImage',
    sourceRect: { x: 0, y: 0, width: 640, height: 480 },
    destinationRect: { x: 0, y: 0, width: 640, height: 480 },
  }]);
});

test('image annotation rasterizer uses crop pixels for output size and translated draw geometry', () => {
  const plan = buildImageAnnotationRenderPlan({
    ...baseDocument,
    crop: { x: 100, y: 50, width: 320, height: 240 },
    annotations: [
      {
        id: 'blur-1',
        type: 'blur',
        rect: { x: 120, y: 70, width: 30, height: 40 },
        radius: 8,
      },
      {
        id: 'freehand-1',
        type: 'freehand',
        points: [{ x: 110, y: 60 }, { x: 180, y: 100 }],
        stroke: '#ffcc00',
        strokeWidth: 6,
      },
      {
        id: 'text-1',
        type: 'text',
        position: { x: 190, y: 120 },
        text: 'Review',
        color: '#111827',
        fontSize: 18,
      },
    ],
  });

  assert.deepEqual(plan.outputSize, { width: 320, height: 240 });
  assert.deepEqual(plan.sourceCropRect, { x: 100, y: 50, width: 320, height: 240 });
  assert.deepEqual(plan.commands[0], {
    kind: 'sourceImage',
    sourceRect: { x: 100, y: 50, width: 320, height: 240 },
    destinationRect: { x: 0, y: 0, width: 320, height: 240 },
  });
  assert.deepEqual(plan.commands.slice(1), [
    {
      kind: 'blurRedact',
      annotationId: 'blur-1',
      effect: 'blur',
      rect: { x: 20, y: 20, width: 30, height: 40 },
      radius: 8,
    },
    {
      kind: 'freehand',
      annotationId: 'freehand-1',
      points: [{ x: 10, y: 10 }, { x: 80, y: 50 }],
      stroke: '#ffcc00',
      strokeWidth: 6,
    },
    {
      kind: 'text',
      annotationId: 'text-1',
      position: { x: 90, y: 70 },
      text: 'Review',
      color: '#111827',
      fontSize: 18,
    },
  ]);
});

test('image annotation rasterizer orders draw commands by export layer', () => {
  const plan = buildImageAnnotationRenderPlan({
    ...baseDocument,
    annotations: [
      { id: 'text-1', type: 'text', position: { x: 80, y: 70 }, text: 'Label' },
      { id: 'pin-1', type: 'pin', position: { x: 72, y: 64 }, label: '1' },
      { id: 'arrow-1', type: 'arrow', start: { x: 20, y: 20 }, end: { x: 70, y: 40 } },
      { id: 'rect-1', type: 'rectangle', rect: { x: 16, y: 18, width: 100, height: 44 } },
      { id: 'freehand-1', type: 'freehand', points: [{ x: 8, y: 8 }, { x: 12, y: 12 }] },
      { id: 'highlight-1', type: 'highlight', rect: { x: 10, y: 10, width: 40, height: 20 } },
      { id: 'blur-1', type: 'blur', rect: { x: 14, y: 16, width: 30, height: 18 } },
      { id: 'redact-1', type: 'redact', rect: { x: 100, y: 90, width: 50, height: 30 } },
    ],
  });

  assert.deepEqual(plan.commands.map((command) => {
    if (command.kind === 'blurRedact') return `${command.kind}:${command.effect}`;
    if (command.kind === 'shape') return `${command.kind}:${command.shape}`;
    return command.kind;
  }), [
    'sourceImage',
    'blurRedact:blur',
    'blurRedact:redact',
    'highlight',
    'freehand',
    'shape:rectangle',
    'arrow',
    'pin',
    'text',
  ]);
});

test('image annotation rasterizer does not require a canvas runtime until rasterization', async () => {
  buildImageAnnotationRenderPlan(baseDocument);

  await assert.rejects(
    () => rasterizeImageAnnotationToPngBlob('image:source/demo.png', baseDocument),
    /browser canvas runtime/i,
  );
});
