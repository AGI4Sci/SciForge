import assert from 'node:assert/strict';
import test from 'node:test';

import {
  SCIFORGE_ANNOTATION_COORDINATE_SPACES,
  SCIFORGE_ANNOTATION_SOURCE_KINDS,
  SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_DIAGNOSTICS,
  SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_CANDIDATES,
  SCIFORGE_ANNOTATION_WINDOW_BINDING_HIGH_CONFIDENCE_THRESHOLD,
  annotationCoordinateSpaceForSourceKind,
  boundedAnnotationWindowBindingDiagnostics,
  boundedAnnotationWindowBindingCandidates,
  compactAnnotationReferenceMetadata,
  isSciForgeAnnotationCoordinateSpace,
  isSciForgeAnnotationSourceKind,
  isAnnotationReferenceWindowOperationTarget,
  isAnnotationWindowBindingOperationTarget,
  type SciForgeAnnotationReferenceMetadata,
} from './annotation-reference-contract.js';

test('annotation source kinds and coordinate spaces are strict project-level enums', () => {
  assert.deepEqual(SCIFORGE_ANNOTATION_SOURCE_KINDS, ['browser', 'window', 'screen-region', 'image']);
  assert.deepEqual(SCIFORGE_ANNOTATION_COORDINATE_SPACES, ['browser-viewport', 'window-local', 'screen-global', 'image-local']);
  assert.equal(isSciForgeAnnotationSourceKind('browser'), true);
  assert.equal(isSciForgeAnnotationSourceKind('screenshot'), false);
  assert.equal(isSciForgeAnnotationCoordinateSpace('screen-global'), true);
  assert.equal(isSciForgeAnnotationCoordinateSpace('screen'), false);
  assert.equal(annotationCoordinateSpaceForSourceKind('browser'), 'browser-viewport');
  assert.equal(annotationCoordinateSpaceForSourceKind('window'), 'window-local');
  assert.equal(annotationCoordinateSpaceForSourceKind('screen-region'), 'screen-global');
  assert.equal(annotationCoordinateSpaceForSourceKind('image'), 'image-local');
});

test('manual-bound app window annotation refs can be later consumed as operation targets', () => {
  const metadata: SciForgeAnnotationReferenceMetadata = {
    annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed',
    targetRef: 'desktop-window:app:paper-reader:window-42',
    screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed',
    cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/capture-fixed',
    imageRef: 'desktop-annotation:workspace/workspace-a/session/session-a/image/capture-fixed',
    sourceKind: 'window',
    coordinateSpace: 'window-local',
    bounds: { x: 120, y: 80, width: 200, height: 120 },
    screenBounds: { x: 164, y: 160, width: 200, height: 120 },
    windowBounds: { x: 44, y: 80, width: 900, height: 640 },
    windowLocalBounds: { x: 120, y: 80, width: 200, height: 120 },
    windowBinding: {
      status: 'manual-bound',
      windowRef: 'desktop-window:app:paper-reader:window-42',
      appName: 'Paper Reader',
      bundleId: 'org.sciforge.paper-reader',
      pid: 4242,
      title: 'Paper Reader - Figure 1',
      windowBounds: { x: 44, y: 80, width: 900, height: 640 },
      windowLocalBounds: { x: 120, y: 80, width: 200, height: 120 },
    },
  };

  assert.equal(isAnnotationWindowBindingOperationTarget(metadata.windowBinding), true);
  assert.equal(isAnnotationReferenceWindowOperationTarget(metadata), true);
});

test('high-confidence screen-region auto-bound refs can be later consumed as operation targets', () => {
  const metadata: SciForgeAnnotationReferenceMetadata = {
    annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/screen-region-1',
    targetRef: 'desktop-annotation:workspace/workspace-a/session/session-a/target/screen-region-1',
    screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/screen-region-1',
    cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/screen-region-1',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    bounds: { x: 260, y: 190, width: 260, height: 180 },
    screenBounds: { x: 260, y: 190, width: 260, height: 180 },
    windowBinding: {
      status: 'auto-bound',
      confidence: SCIFORGE_ANNOTATION_WINDOW_BINDING_HIGH_CONFIDENCE_THRESHOLD,
      reason: 'single containing window matched the selected region',
      windowRef: 'desktop-window:app:plotter:window-7',
      appName: 'Plotter',
      bundleId: 'org.sciforge.plotter',
      windowBounds: { x: 20, y: 30, width: 1000, height: 700 },
      windowLocalBounds: { x: 240, y: 160, width: 260, height: 180 },
      candidates: [{
        windowRef: 'desktop-window:app:plotter:window-7',
        confidence: 0.94,
        reason: 'contains-region',
        windowBounds: { x: 20, y: 30, width: 1000, height: 700 },
      }],
    },
  };

  assert.equal(isAnnotationWindowBindingOperationTarget(metadata.windowBinding), true);
  assert.equal(isAnnotationReferenceWindowOperationTarget(metadata), true);
});

test('unbound blocked low-confidence and image-only refs are not operation targets', () => {
  const rejected: SciForgeAnnotationReferenceMetadata[] = [
    {
      annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/low-confidence',
      targetRef: 'desktop-annotation:workspace/workspace-a/session/session-a/target/low-confidence',
      screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/low-confidence',
      cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/low-confidence',
      sourceKind: 'screen-region',
      coordinateSpace: 'screen-global',
      bounds: { x: 10, y: 20, width: 100, height: 80 },
      screenBounds: { x: 10, y: 20, width: 100, height: 80 },
      windowBinding: {
        status: 'auto-bound',
        confidence: 0.61,
        windowRef: 'desktop-window:app:wrong:window-1',
        candidates: [{ windowRef: 'desktop-window:app:wrong:window-1', confidence: 0.61 }],
      },
    },
    {
      annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/unbound',
      targetRef: 'desktop-annotation:workspace/workspace-a/session/session-a/target/unbound',
      screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/unbound',
      cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/unbound',
      sourceKind: 'screen-region',
      coordinateSpace: 'screen-global',
      bounds: { x: 20, y: 30, width: 100, height: 80 },
      screenBounds: { x: 20, y: 30, width: 100, height: 80 },
      windowBinding: {
        status: 'unbound',
        reason: 'low-confidence',
        candidates: [{ windowRef: 'desktop-window:app:candidate:window-1', confidence: 0.55 }],
      },
    },
    {
      annotationRef: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/blocked',
      targetRef: 'desktop-annotation:workspace/workspace-a/session/session-a/target/blocked',
      screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/blocked',
      cropRef: 'desktop-annotation:workspace/workspace-a/session/session-a/crop/blocked',
      sourceKind: 'screen-region',
      coordinateSpace: 'screen-global',
      bounds: { x: 30, y: 40, width: 100, height: 80 },
      screenBounds: { x: 30, y: 40, width: 100, height: 80 },
      windowBinding: {
        status: 'blocked',
        reason: 'window-enumeration-blocked',
      },
    },
    {
      annotationRef: 'image-annotation:figure-1/annotation/label-a',
      targetRef: 'image:figure-1',
      screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/screenshot-only',
      cropRef: 'image-annotation:figure-1/crop/label-a',
      sourceKind: 'image',
      coordinateSpace: 'image-local',
      bounds: { x: 10, y: 20, width: 100, height: 80 },
    },
  ];

  for (const metadata of rejected) {
    assert.equal(isAnnotationReferenceWindowOperationTarget(metadata), false);
  }
});

test('window binding candidates are bounded for refs-first consumers', () => {
  const candidates = Array.from({ length: SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_CANDIDATES + 2 }, (_, index) => ({
    windowRef: `desktop-window:app:candidate:window-${index}`,
    confidence: 0.5 + index / 100,
  }));

  assert.deepEqual(
    boundedAnnotationWindowBindingCandidates({ status: 'unbound', candidates }).map((candidate) => candidate.windowRef),
    candidates.slice(0, SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_CANDIDATES).map((candidate) => candidate.windowRef),
  );
});

test('window binding diagnostics are bounded and expose no raw capture or provider payload', () => {
  const diagnostics = Array.from({ length: SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_DIAGNOSTICS + 2 }, (_, index) => ({
    code: `candidate-${index}`,
    reason: 'candidate-window',
    message: `candidate ${index} was considered`,
    confidence: 0.5 + index / 100,
    rawWindowList: [{ title: 'Do not leak raw window list' }],
    rawScreenshot: 'data:image/png;base64,DO_NOT_KEEP',
    providerPayload: { route: '/private/provider/window-list' },
  }));

  const bounded = boundedAnnotationWindowBindingDiagnostics({ diagnostics });

  assert.equal(bounded.length, SCIFORGE_ANNOTATION_WINDOW_BINDING_MAX_DIAGNOSTICS);
  assert.deepEqual(Object.keys(bounded[0]).sort(), ['code', 'confidence', 'message', 'reason']);
  assert.doesNotMatch(JSON.stringify(bounded), /rawWindowList|rawScreenshot|providerPayload|base64|DO_NOT_KEEP/);
});

test('compact annotation metadata requires minimum refs and strips raw payload fields', () => {
  assert.equal(compactAnnotationReferenceMetadata({
    annotationRef: 'annotation:missing-target',
    screenshotRef: 'screenshot:missing-target',
    cropRef: 'crop:missing-target',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    bounds: { x: 0, y: 0, width: 10, height: 10 },
  }), undefined);

  assert.equal(compactAnnotationReferenceMetadata({
    annotationRef: 'annotation:bad-source',
    targetRef: 'target:bad-source',
    screenshotRef: 'screenshot:bad-source',
    cropRef: 'crop:bad-source',
    sourceKind: 'screenshot',
    coordinateSpace: 'screen-global',
    bounds: { x: 0, y: 0, width: 10, height: 10 },
  }), undefined);

  const metadata = compactAnnotationReferenceMetadata({
    annotationRef: 'annotation:screen-region-2',
    targetRef: 'target:screen-region-2',
    screenshotRef: 'screenshot:screen-region-2',
    cropRef: 'crop:screen-region-2',
    imageRef: 'image:screen-region-2',
    sourceKind: 'screen-region',
    coordinateSpace: 'screen-global',
    bounds: { x: 44, y: 55, width: 300, height: 180 },
    screenBounds: { x: 44, y: 55, width: 300, height: 180 },
    rawScreenshot: 'data:image/png;base64,DO_NOT_KEEP',
    screenshotBase64: 'DO_NOT_KEEP',
    providerPayload: { url: 'https://provider.example.test/private' },
    rawWindowList: [{ title: 'Do not leak' }],
    windowBinding: {
      status: 'unbound',
      reason: 'low-confidence',
      candidates: [{
        windowRef: 'desktop-window:app:candidate:window-1',
        appName: 'Candidate',
        confidence: 0.55,
        rawWindowList: [{ title: 'Do not leak candidate internals' }],
        screenshotBase64: 'DO_NOT_KEEP',
      }],
      diagnostics: [{
        code: 'low-confidence',
        reason: 'insufficient-overlap',
        message: 'candidate score was below threshold',
        providerPayload: { route: '/private/provider' },
      }],
    },
  });

  assert.ok(metadata);
  assert.deepEqual(metadata.windowBinding?.candidates, [{
    windowRef: 'desktop-window:app:candidate:window-1',
    appName: 'Candidate',
    confidence: 0.55,
  }]);
  assert.deepEqual(metadata.windowBinding?.diagnostics, [{
    code: 'low-confidence',
    reason: 'insufficient-overlap',
    message: 'candidate score was below threshold',
  }]);
  assert.doesNotMatch(JSON.stringify(metadata), /rawScreenshot|screenshotBase64|providerPayload|rawWindowList|base64|DO_NOT_KEEP/);
});
