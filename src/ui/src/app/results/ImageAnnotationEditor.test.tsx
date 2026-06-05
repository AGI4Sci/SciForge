import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ImageAnnotationEditor } from './ImageAnnotationEditor';

const baseDocument = {
  schema: 'sciforge.image-annotation.v1' as const,
  sourceRef: '.sciforge/uploads/session-a/source.png',
  sourceNaturalSize: { width: 1200, height: 800 },
  annotations: [{
    id: 'ann-freehand-1',
    type: 'freehand' as const,
    points: [{ x: 10, y: 20 }, { x: 80, y: 90 }],
    stroke: '#facc15',
    strokeWidth: 5,
    opacity: 1,
  }, {
    id: 'ann-pin-1',
    type: 'pin' as const,
    position: { x: 240, y: 160 },
    label: '1',
    color: '#02111f',
    background: '#00e5a0',
    radius: 20,
    opacity: 1,
  }, {
    id: 'ann-blur-1',
    type: 'blur' as const,
    rect: { x: 300, y: 220, width: 120, height: 80 },
    radius: 22,
    opacity: 1,
  }, {
    id: 'ann-redact-1',
    type: 'redact' as const,
    rect: { x: 520, y: 360, width: 180, height: 72 },
    fill: '#020617',
    opacity: 1,
  }],
  export: { format: 'png' as const, width: 1200, height: 800 },
};

test('ImageAnnotationEditor renders review editing tools over a source-pixel SVG overlay', () => {
  const html = renderToStaticMarkup(createElement(ImageAnnotationEditor, {
    imageUrl: '/api/sciforge/preview/raw?ref=source.png',
    imageRef: '.sciforge/uploads/session-a/source.png',
    document: baseDocument,
    mode: 'editing',
    saveState: 'idle',
    onChange: () => undefined,
    onCancel: () => undefined,
    onSave: () => undefined,
    onOpenOriginal: () => undefined,
  }));

  assert.match(html, /class="image-annotation-editor"/);
  assert.match(html, /data-editor-mode="editing"/);
  assert.match(html, /data-source-image-ref="\.sciforge\/uploads\/session-a\/source\.png"/);
  assert.match(html, /class="image-annotation-editor-toolbar"/);
  for (const tool of ['select', 'crop', 'pen', 'arrow', 'rect', 'text', 'pin', 'highlight', 'blur', 'redact']) {
    assert.match(html, new RegExp(`data-editor-tool="${tool}"`), tool);
  }
  assert.match(html, /data-editor-action="save"/);
  assert.match(html, /data-editor-action="cancel"/);
  assert.match(html, /data-editor-action="open-original"/);
  assert.match(html, /data-editor-color-control="true"/);
  assert.match(html, /type="color"/);
  assert.match(html, /data-editor-color-swatch="#facc15"/);
  assert.match(html, /class="image-annotation-editor-stage"/);
  assert.match(html, /<img[^>]+class="image-annotation-editor-image"/);
  assert.match(html, /<svg[^>]+class="image-annotation-editor-overlay"[^>]+viewBox="0 0 1200 800"/);
  assert.match(html, /data-annotation-id="ann-freehand-1"/);
  assert.match(html, /data-annotation-id="ann-pin-1"/);
  assert.match(html, /data-annotation-id="ann-blur-1"/);
  assert.match(html, /data-annotation-id="ann-redact-1"/);
  assert.match(html, /data-annotation-type="freehand"/);
  assert.match(html, /data-annotation-type="pin"/);
  assert.match(html, /data-annotation-effect="blur-source"/);
  assert.match(html, /pointer-events="none"/);
  assert.match(html, /image-annotation-blur-outline/);
  assert.match(html, /id="image-annotation-blur-filter"/);
});

test('ImageAnnotationEditor keeps read-only original opening separate from editing pointer input', () => {
  const html = renderToStaticMarkup(createElement(ImageAnnotationEditor, {
    imageUrl: '/api/sciforge/preview/raw?ref=source.png',
    imageRef: '.sciforge/uploads/session-a/source.png',
    document: baseDocument,
    mode: 'readonly',
    saveState: 'idle',
    onChange: () => undefined,
    onCancel: () => undefined,
    onSave: () => undefined,
    onOpenOriginal: () => undefined,
  }));

  assert.match(html, /data-editor-mode="readonly"/);
  assert.match(html, /data-readonly-image-open="true"/);
  assert.match(html, /data-editor-action="edit"/);
  assert.match(html, /data-editor-action="save"[^>]*disabled=""/);
  assert.match(html, /data-editor-pointer-role="open-original"/);
  assert.doesNotMatch(html, /data-editor-pointer-role="draw"/);
});

test('ImageAnnotationEditor source declares keyboard shortcuts and avoids heavy canvas libraries', () => {
  const source = readFileSync(new URL('./ImageAnnotationEditor.tsx', import.meta.url), 'utf8');

  assert.match(source, /onKeyDown=\{handleEditorKeyDown\}/);
  assert.match(source, /event\.key === 'Escape'/);
  assert.match(source, /event\.key === 'Delete'/);
  assert.match(source, /event\.key === 'Backspace'/);
  assert.match(source, /metaKey|ctrlKey/);
  assert.match(source, /undo/i);
  assert.match(source, /redo/i);
  assert.doesNotMatch(source, /from ['"](?:fabric|konva|react-konva|@?svg\.js|paper)['"]/i);
});

test('ImageAnnotationEditor source wires selection, dragging, delete, redo, and historical label editing', () => {
  const source = readFileSync(new URL('./ImageAnnotationEditor.tsx', import.meta.url), 'utf8');

  assert.match(source, /moveImageAnnotation/);
  assert.match(source, /updateImageAnnotationLabel/);
  assert.match(source, /interface DragState/);
  assert.match(source, /handleAnnotationPointerDown/);
  assert.match(source, /handleAnnotationPointerMove/);
  assert.match(source, /handleAnnotationPointerUp/);
  assert.match(source, /data-editor-action="delete"/);
  assert.match(source, /data-editor-action="redo"/);
  assert.match(source, /data-editor-selection-id/);
  assert.match(source, /data-editor-can-move-selected/);
});

test('ImageAnnotationEditor source wires user color selection and click-to-edit text focus', () => {
  const source = readFileSync(new URL('./ImageAnnotationEditor.tsx', import.meta.url), 'utf8');

  assert.match(source, /COLOR_SWATCHES/);
  assert.match(source, /data-editor-color-control/);
  assert.match(source, /handleColorChange/);
  assert.match(source, /recolorImageAnnotation/);
  assert.match(source, /textInputRef/);
  assert.match(source, /focusEditableTextInput/);
  assert.match(source, /requestAnimationFrame/);
});
