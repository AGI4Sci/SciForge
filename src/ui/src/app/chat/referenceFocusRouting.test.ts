import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObjectReference, SciForgeReference } from '../../domain';
import { withCurrentObjectReferencePayload } from './composerReferences';
import { imageObjectReferenceForReferenceFocus } from './referenceFocusRouting';

test('image reference focus extracts current object references for the Image pane only', () => {
  const uploadedImage: ObjectReference = {
    id: 'obj-upload-image-1',
    kind: 'artifact',
    title: 'microscopy.png',
    ref: 'artifact:upload-image-1',
    artifactType: 'uploaded-image',
    preferredView: 'preview',
    status: 'available',
    provenance: {
      path: '.sciforge/uploads/session-1/upload-image-1-microscopy.png',
      dataRef: '.sciforge/uploads/session-1/upload-image-1-microscopy.png',
      producer: 'user-upload',
    },
  };
  const reference: SciForgeReference = withCurrentObjectReferencePayload({
    id: 'ref-upload-image-1',
    kind: 'file',
    title: 'microscopy.png',
    ref: '.sciforge/uploads/session-1/upload-image-1-microscopy.png',
  }, uploadedImage);

  assert.equal(imageObjectReferenceForReferenceFocus(reference)?.ref, 'artifact:upload-image-1');
});

test('image reference focus leaves non-image references on the existing highlight path', () => {
  const pickedFile: ObjectReference = {
    id: 'obj-picked-file',
    kind: 'file',
    title: 'methods.md',
    ref: 'file:papers/methods.md',
    status: 'available',
    provenance: {
      path: 'papers/methods.md',
      producer: 'workspace',
    },
  };
  const reference: SciForgeReference = withCurrentObjectReferencePayload({
    id: 'ref-picked-file',
    kind: 'file',
    title: 'methods.md',
    ref: 'file:papers/methods.md',
  }, pickedFile);

  assert.equal(imageObjectReferenceForReferenceFocus(reference), undefined);
});

test('image reference focus infers legacy uploaded image file refs without embedded object payloads', () => {
  const reference: SciForgeReference = {
    id: 'ref-legacy-upload-image',
    kind: 'file',
    title: 'WX20260605-091908@2x.png',
    ref: '.sciforge/uploads/session-1/upload-image-WX20260605-091908@2x.png',
    summary: '用户上传文件 · uploaded-image',
    sourceId: 'upload-image-legacy',
    payload: {
      artifactId: 'upload-image-legacy',
      type: 'uploaded-image',
    },
  };

  const focused = imageObjectReferenceForReferenceFocus(reference);

  assert.equal(focused?.kind, 'artifact');
  assert.equal(focused?.artifactType, 'image');
  assert.equal(focused?.provenance?.dataRef, '.sciforge/uploads/session-1/upload-image-WX20260605-091908@2x.png');
});
