import assert from 'node:assert/strict';
import test from 'node:test';
import type { ObjectReference, RuntimeArtifact, SciForgeSession } from '../../domain';
import {
  imageEvidencePayloadFromArtifact,
  normalizeImageEvidencePayload,
  rightPaneImageEvidencePayload,
} from './imagePaneModel';

test('image pane model converts legacy computer-use virtual screen frames into refs-first replay evidence', () => {
  const artifact: RuntimeArtifact = {
    id: 'legacy-screen-frame',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      title: 'Legacy live screen',
      status: 'ready',
      surfaceMode: 'live',
      attachState: 'attached',
      currentFrameRef: 'computer-use:session/run-screen/frames/current.png',
      rawScreenshot: 'data:image/png;base64,DO_NOT_KEEP',
      width: 1440,
      height: 900,
      mime: 'image/png',
      sha256: 'a'.repeat(64),
      createdAt: '2026-06-03T08:00:00.000Z',
      replayRef: 'computer-use:session/run-screen/replay.json',
      evidenceLedgerRef: 'ledger:computer-use/run-screen/evidence.json',
      targetWindowRef: 'window:vscode/main',
      sessionRef: 'computer-use:session/run-screen/manifest.json',
      liveSurfaceRef: 'computer-use:session/run-screen/live-surface.json',
      actionAdapterRef: 'computer-use:session/run-screen/action-adapter.json',
      inputLeaseRef: 'computer-use:session/run-screen/input-lease.json',
      executorParams: { route: '/private/provider/action' },
      providerRoute: 'https://provider.example.test/private',
      providerSessionRevalidated: true,
      providerExecuted: true,
      isolationFlags: { singleInteractiveTruth: true },
    },
  };

  const payload = imageEvidencePayloadFromArtifact(artifact);

  assert.ok(payload);
  assert.equal(payload.sourceKind, 'replay');
  assert.equal(payload.imageRef, 'computer-use:session/run-screen/frames/current.png');
  assert.equal(payload.ref, 'computer-use:session/run-screen/frames/current.png');
  assert.equal(payload.mime, 'image/png');
  assert.equal(payload.width, 1440);
  assert.equal(payload.height, 900);
  assert.equal(payload.sha256, 'a'.repeat(64));
  assert.equal(payload.createdAt, '2026-06-03T08:00:00.000Z');
  assert.equal(payload.provenanceRef, 'ledger:computer-use/run-screen/evidence.json');
  assert.equal(payload.targetRef, 'window:vscode/main');
  assert.deepEqual(payload.provenanceRefs, ['computer-use:session/run-screen/replay.json', 'ledger:computer-use/run-screen/evidence.json']);

  const serialized = JSON.stringify(payload);
  assert.doesNotMatch(serialized, /rawScreenshot|data:image|base64|DO_NOT_KEEP/);
  assert.doesNotMatch(serialized, /sessionRef|liveSurfaceRef|actionAdapterRef|inputLeaseRef|executorParams|providerRoute/);
  assert.doesNotMatch(serialized, /providerSessionRevalidated|providerExecuted|singleInteractiveTruth/);
});

test('image pane model reads legacy frameRefs arrays as image evidence without live control refs', () => {
  const artifact: RuntimeArtifact = {
    id: 'legacy-frame-array',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    data: {
      status: 'ready',
      replayRef: 'computer-use:replay/run-frame-array/replay.json',
      frameRefs: [{
        ref: '.sciforge/computer-use/run-frame-array/latest.png',
        frameDataRef: 'computer-use:frame-data/run-frame-array/latest.json',
        screenRef: 'computer-use:screen/run-frame-array/screen-1.json',
        width: 100,
        height: 80,
        leaseOwnerRefs: ['computer-use:lease/run-frame-array/active.json'],
        proposalRef: 'computer-use:proposal/run-frame-array/click.json',
      }],
      screen: { width: 1280, height: 720 },
      sessionRef: 'computer-use:session/run-frame-array/session.json',
      liveSurfaceRef: 'computer-use:live/run-frame-array/surface.json',
      actionAdapterRef: 'computer-use:adapter/run-frame-array/action.json',
    },
  };

  const payload = imageEvidencePayloadFromArtifact(artifact);

  assert.ok(payload);
  assert.equal(payload.sourceKind, 'replay');
  assert.equal(payload.imageRef, '.sciforge/computer-use/run-frame-array/latest.png');
  assert.equal(payload.width, 100);
  assert.equal(payload.height, 80);
  assert.equal(payload.provenanceRef, 'computer-use:replay/run-frame-array/replay.json');
  assert.deepEqual(payload.provenanceRefs, [
    'computer-use:replay/run-frame-array/replay.json',
    'computer-use:frame-data/run-frame-array/latest.json',
  ]);
  assert.doesNotMatch(JSON.stringify(payload), /sessionRef|liveSurfaceRef|actionAdapterRef|leaseOwnerRefs|proposalRef/);
});

test('image pane model ignores raw image bytes and data URLs without retaining provider or live action fields', () => {
  const payload = normalizeImageEvidencePayload({
    sourceKind: 'screenshot',
    imageRef: 'data:image/png;base64,DO_NOT_PROMOTE',
    screenshotRef: 'https://provider.example.test/private/screenshot.png',
    currentFrameRef: '   ',
    rawBase64: 'iVBORw0KGgo=',
    screenshotBase64: 'iVBORw0KGgo=',
    rawScreenshot: 'data:image/png;base64,DO_NOT_KEEP',
    providerRoute: 'https://provider.example.test/private/action',
    providerParams: { route: '/private/provider/action' },
    sessionRef: 'computer-use:session/raw-only/session.json',
    liveSurfaceRef: 'computer-use:session/raw-only/live-surface.json',
    actionAdapterRef: 'computer-use:session/raw-only/action-adapter.json',
  });

  assert.equal(payload, undefined);
});

test('right pane image evidence payload promotes focused feedback bundle screenshot provenance', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-feedback-screenshot',
    scenarioId: 'literature-evidence-review',
    title: 'Feedback screenshot',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    messages: [],
    runs: [],
    artifacts: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    notebook: [],
    versions: [],
  };
  const focusedReference: ObjectReference = {
    id: 'feedback-comment-feedback-1-comment-1',
    kind: 'artifact',
    ref: 'feedback-comment:feedback-1/comment-1',
    title: 'Feedback comment',
    status: 'available',
    provenance: {
      screenshotRef: 'feedback-bundle:feedback-1/screenshots/annotated.png',
      dataRef: 'feedback-bundle:feedback-1/comment.json',
      hash: 'b'.repeat(64),
    },
  };

  const payload = rightPaneImageEvidencePayload(session, undefined, focusedReference);

  assert.ok(payload);
  assert.equal(payload.imageRef, 'feedback-bundle:feedback-1/screenshots/annotated.png');
  assert.equal(payload.ref, 'feedback-bundle:feedback-1/screenshots/annotated.png');
  assert.equal(payload.status, 'available');
  assert.equal(payload.targetRef, 'feedback-comment:feedback-1/comment-1');
  assert.equal(payload.provenanceRef, 'feedback-bundle:feedback-1/comment.json');
  assert.equal(payload.sha256, 'b'.repeat(64));
});

test('right pane image evidence payload promotes desktop annotation screenshot provenance with blocked status', () => {
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-desktop-annotation',
    scenarioId: 'literature-evidence-review',
    title: 'Desktop annotation',
    createdAt: '2026-06-04T00:00:00.000Z',
    updatedAt: '2026-06-04T00:00:00.000Z',
    messages: [],
    runs: [],
    artifacts: [],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    notebook: [],
    versions: [],
  };
  const focusedReference: ObjectReference = {
    id: 'desktop-annotation-capture-fixed',
    kind: 'artifact',
    ref: 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed',
    title: 'Desktop annotation capture',
    artifactType: 'desktop-annotation-capture',
    preferredView: 'image',
    status: 'blocked',
    provenance: {
      screenshotRef: 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed',
      dataRef: 'desktop-annotation:workspace/workspace-a/session/session-a/window-capture/blocked/capture-fixed/diagnostics',
    },
  };

  const payload = rightPaneImageEvidencePayload(session, undefined, focusedReference);

  assert.ok(payload);
  assert.equal(payload.sourceKind, 'annotation-crop');
  assert.equal(payload.imageRef, 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed');
  assert.equal(payload.ref, 'desktop-annotation:workspace/workspace-a/session/session-a/screenshot/capture-fixed');
  assert.equal(payload.status, 'blocked');
  assert.equal(payload.targetRef, 'desktop-annotation:workspace/workspace-a/session/session-a/annotation/capture-fixed');
  assert.equal(payload.provenanceRef, 'desktop-annotation:workspace/workspace-a/session/session-a/window-capture/blocked/capture-fixed/diagnostics');
});

test('image pane model ignores non-image text and report artifacts that only expose data or delivery refs', () => {
  const textArtifact: RuntimeArtifact = {
    id: 'analysis-note',
    type: 'text/plain',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: 'artifact:analysis-note/content.txt',
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:analysis-note',
      role: 'supporting-evidence',
      declaredMediaType: 'text/plain',
      declaredExtension: 'txt',
      contentShape: 'raw-file',
      readableRef: 'artifact:analysis-note/readable.txt',
      previewPolicy: 'inline',
    },
    data: {
      title: 'Analysis note',
      dataRef: 'artifact:analysis-note/data.txt',
      deliveryRef: 'artifact:analysis-note/delivery.txt',
      mime: 'text/plain',
    },
  };
  const reportArtifact: RuntimeArtifact = {
    id: 'final-report',
    type: 'report',
    producerScenario: 'literature-evidence-review',
    schemaVersion: '1',
    dataRef: 'artifact:final-report/report.md',
    delivery: {
      contractId: 'sciforge.artifact-delivery.v1',
      ref: 'artifact:final-report',
      role: 'primary-deliverable',
      declaredMediaType: 'text/markdown',
      declaredExtension: 'md',
      contentShape: 'raw-file',
      readableRef: 'artifact:final-report/readable.md',
      previewPolicy: 'inline',
    },
    data: {
      preferredView: 'report',
      deliveryRef: 'artifact:final-report/delivery.md',
      contentType: 'text/markdown',
    },
  };

  assert.equal(imageEvidencePayloadFromArtifact(textArtifact), undefined);
  assert.equal(imageEvidencePayloadFromArtifact(reportArtifact), undefined);
});

test('right pane image evidence payload is scoped to the active run', () => {
  const oldArtifact: RuntimeArtifact = {
    id: 'old-screen',
    type: 'computer-use-virtual-screen',
    producerScenario: 'computer-use',
    schemaVersion: 'sciforge.computer-use.virtual-screen.v1',
    metadata: { runId: 'run-old' },
    data: {
      frameRefs: ['.sciforge/computer-use/run-old/latest.png'],
      replayRef: 'computer-use:replay/run-old/replay.json',
    },
  };
  const session: SciForgeSession = {
    schemaVersion: 2,
    sessionId: 'session-image-scope',
    scenarioId: 'literature-evidence-review',
    title: 'Image scope',
    createdAt: '2026-06-03T00:00:00.000Z',
    updatedAt: '2026-06-03T00:00:00.000Z',
    messages: [],
    runs: [{
      id: 'run-old',
      scenarioId: 'literature-evidence-review',
      status: 'completed',
      prompt: 'old',
      response: 'old',
      createdAt: '2026-06-03T00:00:00.000Z',
    }, {
      id: 'run-current',
      scenarioId: 'literature-evidence-review',
      status: 'running',
      prompt: 'current',
      response: '',
      createdAt: '2026-06-03T00:00:00.000Z',
    }],
    artifacts: [oldArtifact],
    uiManifest: [],
    claims: [],
    executionUnits: [],
    notebook: [],
    versions: [],
  };

  const currentRun = session.runs.find((run) => run.id === 'run-current');

  assert.equal(rightPaneImageEvidencePayload(session, currentRun), undefined);
});

test('image pane model normalizes browser and artifact preview image refs without provider routes', () => {
  const browserPayload = normalizeImageEvidencePayload({
    sourceKind: 'browser-evidence',
    screenshotRef: 'browser-session:abc/screenshots/0001.png',
    screenshotBase64: 'iVBORw0KGgo=',
    mimeType: 'image/png',
    dimensions: { width: 1280, height: 720 },
    capturedAt: '2026-06-03T09:15:00.000Z',
    browserSessionRef: 'browser-session:abc',
    domSnapshotRef: 'browser-session:abc/dom.json',
    providerParams: { url: 'https://private.example.test' },
  });

  assert.ok(browserPayload);
  assert.equal(browserPayload.sourceKind, 'browser-evidence');
  assert.equal(browserPayload.imageRef, 'browser-session:abc/screenshots/0001.png');
  assert.equal(browserPayload.mime, 'image/png');
  assert.equal(browserPayload.width, 1280);
  assert.equal(browserPayload.height, 720);
  assert.equal(browserPayload.createdAt, '2026-06-03T09:15:00.000Z');
  assert.equal(browserPayload.browserSessionRef, 'browser-session:abc');
  assert.deepEqual(browserPayload.provenanceRefs, ['browser-session:abc/dom.json']);
  assert.doesNotMatch(JSON.stringify(browserPayload), /screenshotBase64|providerParams|private/);

  const artifactPayload = normalizeImageEvidencePayload({
    type: 'artifact-preview-image',
    imageRef: 'artifact:figure-1/preview.png',
    artifactRef: 'artifact:figure-1',
    previewUrl: '/api/sciforge/preview/raw?ref=artifact%3Afigure-1%2Fpreview.png',
    bounds: { x: 10, y: 20, width: 300, height: 160 },
    cropBounds: { x: 20, y: 30, width: 120, height: 90 },
    annotationRefs: ['annotation:figure-1/highlight'],
    redactionRef: 'redaction:figure-1/private-regions.json',
    provenanceRefs: ['artifact:figure-1/manifest.json'],
  });

  assert.ok(artifactPayload);
  assert.equal(artifactPayload.sourceKind, 'artifact');
  assert.equal(artifactPayload.imageRef, 'artifact:figure-1/preview.png');
  assert.equal(artifactPayload.artifactRef, 'artifact:figure-1');
  assert.deepEqual(artifactPayload.bounds, { x: 10, y: 20, width: 300, height: 160 });
  assert.deepEqual(artifactPayload.cropBounds, { x: 20, y: 30, width: 120, height: 90 });
  assert.deepEqual(artifactPayload.annotationRefs, ['annotation:figure-1/highlight']);
  assert.equal(artifactPayload.redactionRef, 'redaction:figure-1/private-regions.json');
  assert.doesNotMatch(JSON.stringify(artifactPayload), /previewUrl|api\/sciforge\/preview/);
});

test('image pane model normalizes SciForge page annotation DOM target selector evidence', () => {
  const payload = normalizeImageEvidencePayload({
    type: 'browser-page-annotation',
    screenshotRef: 'browser-session:abc/screenshots/annotation-1.png',
    domTarget: {
      selector: '#paper-title',
      stableSelector: '[data-testid="paper-title"]',
      domPath: 'main > article > h1',
      role: 'heading',
      label: 'Paper title',
      textSnippet: 'Attention Is All You Need',
      rect: { x: 80, y: 120, width: 420, height: 48 },
      outerHTML: '<h1 data-secret="do-not-keep">Attention Is All You Need</h1>',
    },
    selector: 'h1[data-testid="paper-title"]',
    domPath: 'html > body > main > article > h1',
    selectedText: 'Attention Is All You Need',
    domSnapshotRef: 'browser-session:abc/dom.json',
    providerRoute: '/api/provider/private',
  });

  assert.ok(payload);
  assert.equal(payload.sourceKind, 'annotation-crop');
  assert.equal(payload.imageRef, 'browser-session:abc/screenshots/annotation-1.png');
  assert.deepEqual(payload.domTarget, {
    selector: '#paper-title',
    stableSelector: '[data-testid="paper-title"]',
    domPath: 'main > article > h1',
    role: 'heading',
    label: 'Paper title',
    textSnippet: 'Attention Is All You Need',
    rect: { x: 80, y: 120, width: 420, height: 48 },
  });
  assert.equal(payload.selector, 'h1[data-testid="paper-title"]');
  assert.equal(payload.domPath, 'html > body > main > article > h1');
  assert.equal(payload.selectedText, 'Attention Is All You Need');
  assert.deepEqual(payload.provenanceRefs, ['browser-session:abc/dom.json']);
  assert.doesNotMatch(JSON.stringify(payload), /outerHTML|data-secret|providerRoute|private/);
});

test('image pane model normalizes screen region bounds display scale hash and provenance', () => {
  const payload = normalizeImageEvidencePayload({
    kind: 'screen-region',
    currentFrameRef: 'computer-use:run-1/frame/current.png',
    hash: `sha256:${'c'.repeat(64)}`,
    screenId: 'display-main',
    displayScale: 2,
    screenBounds: { x: 0, y: 0, width: 1512, height: 982 },
    windowBounds: { x: 44, y: 72, width: 900, height: 620 },
    windowLocalBounds: { x: 120, y: 180, width: 300, height: 220 },
    evidenceRef: 'ledger:screen-region/run-1/evidence.json',
    verificationRefs: ['verification:screen-region/run-1/check.json'],
    rawScreenshot: 'data:image/png;base64,DO_NOT_KEEP',
  });

  assert.ok(payload);
  assert.equal(payload.sourceKind, 'screen-region');
  assert.equal(payload.imageRef, 'computer-use:run-1/frame/current.png');
  assert.equal(payload.sha256, 'c'.repeat(64));
  assert.equal(payload.displayId, 'display-main');
  assert.equal(payload.scale, 2);
  assert.deepEqual(payload.screenBounds, { x: 0, y: 0, width: 1512, height: 982 });
  assert.deepEqual(payload.windowBounds, { x: 44, y: 72, width: 900, height: 620 });
  assert.deepEqual(payload.windowLocalBounds, { x: 120, y: 180, width: 300, height: 220 });
  assert.equal(payload.provenanceRef, 'ledger:screen-region/run-1/evidence.json');
  assert.deepEqual(payload.provenanceRefs, [
    'ledger:screen-region/run-1/evidence.json',
    'verification:screen-region/run-1/check.json',
  ]);
  assert.doesNotMatch(JSON.stringify(payload), /rawScreenshot|data:image|DO_NOT_KEEP/);
});

test('image pane model preserves auto-bound window binding summary and window-local bounds', () => {
  const payload = normalizeImageEvidencePayload({
    sourceKind: 'window-capture',
    imageRef: 'desktop-annotation:workspace/a/session/b/screenshot/window-auto',
    windowBinding: {
      status: 'auto-bound',
      confidence: 0.92,
      reason: 'Selected region overlapped the active window.',
      windowRef: 'desktop-window:app:paper-reader:window-42',
      appName: 'Paper Reader',
      bundleId: 'com.example.paper-reader',
      pid: 4242,
      title: 'Attention Is All You Need.pdf',
      windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
      windowLocalBounds: { x: 120, y: 160, width: 320, height: 240 },
      candidates: [{
        windowRef: 'desktop-window:app:paper-reader:window-42',
        appName: 'Paper Reader',
        confidence: 0.92,
        windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
        windowLocalBounds: { x: 120, y: 160, width: 320, height: 240 },
      }],
      privateRoute: '/api/private/action',
    },
  });

  assert.ok(payload);
  assert.equal(payload.windowRef, 'desktop-window:app:paper-reader:window-42');
  assert.deepEqual(payload.windowLocalBounds, { x: 120, y: 160, width: 320, height: 240 });
  assert.deepEqual(payload.windowBinding, {
    status: 'auto-bound',
    confidence: 0.92,
    reason: 'Selected region overlapped the active window.',
    windowRef: 'desktop-window:app:paper-reader:window-42',
    appName: 'Paper Reader',
    bundleId: 'com.example.paper-reader',
    pid: 4242,
    title: 'Attention Is All You Need.pdf',
    windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
    windowLocalBounds: { x: 120, y: 160, width: 320, height: 240 },
    candidates: [{
      windowRef: 'desktop-window:app:paper-reader:window-42',
      appName: 'Paper Reader',
      confidence: 0.92,
      windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
      windowLocalBounds: { x: 120, y: 160, width: 320, height: 240 },
    }],
  });
  assert.doesNotMatch(JSON.stringify(payload), /privateRoute|api\/private/);
});

test('image pane model normalizes manual-bound app window annotation evidence', () => {
  const payload = normalizeImageEvidencePayload({
    sourceKind: 'window-capture',
    imageRef: 'desktop-annotation:workspace/a/session/b/screenshot/window-1',
    windowBinding: {
      status: 'manual-bound',
      confidence: 1,
      reason: 'User selected the app window while annotating.',
      windowRef: 'desktop-window:app:paper-reader:window-42',
      appName: 'Paper Reader',
      bundleId: 'com.example.paper-reader',
      pid: 4242,
      title: 'Attention Is All You Need.pdf',
      windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
      windowLocalBounds: { x: 120, y: 160, width: 320, height: 240 },
      windowActionSessionRef: 'window-action-session:should-not-project',
      actionRef: 'window-action-ref:should-not-project',
      guiExecutable: true,
    },
  });

  assert.ok(payload);
  assert.equal(payload.windowRef, 'desktop-window:app:paper-reader:window-42');
  assert.deepEqual(payload.windowBounds, { x: 40, y: 80, width: 1024, height: 768 });
  assert.deepEqual(payload.windowLocalBounds, { x: 120, y: 160, width: 320, height: 240 });
  assert.deepEqual(payload.windowBinding, {
    status: 'manual-bound',
    confidence: 1,
    reason: 'User selected the app window while annotating.',
    windowRef: 'desktop-window:app:paper-reader:window-42',
    appName: 'Paper Reader',
    bundleId: 'com.example.paper-reader',
    pid: 4242,
    title: 'Attention Is All You Need.pdf',
    windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
    windowLocalBounds: { x: 120, y: 160, width: 320, height: 240 },
  });
  assert.doesNotMatch(JSON.stringify(payload), /WindowActionSession|window-action-session|window-action-ref|actionRef|guiExecutable/);
});

test('image pane model keeps low-confidence window binding unbound without promoting candidate refs', () => {
  const payload = normalizeImageEvidencePayload({
    sourceKind: 'screen-region',
    imageRef: 'screen-region:capture/low-confidence.png',
    windowBinding: {
      status: 'unbound',
      confidence: 0.36,
      reason: 'Top candidate was below the automatic binding threshold.',
      windowRef: 'desktop-window:should-not-bind',
      candidates: [{
        windowRef: 'desktop-window:app:paper-reader:window-42',
        appName: 'Paper Reader',
        bundleId: 'com.example.paper-reader',
        pid: 4242,
        title: 'Attention Is All You Need.pdf',
        confidence: 0.36,
        reason: 'Partial overlap with selected region.',
        windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
        windowLocalBounds: { x: 700, y: 60, width: 120, height: 90 },
        windowActionSessionRef: 'window-action-session:should-not-project',
        actionRef: 'window-action-ref:should-not-project',
      }],
    },
  });

  assert.ok(payload);
  assert.equal(payload.windowRef, undefined);
  assert.deepEqual(payload.windowBinding, {
    status: 'unbound',
    confidence: 0.36,
    reason: 'Top candidate was below the automatic binding threshold.',
    candidates: [{
      windowRef: 'desktop-window:app:paper-reader:window-42',
      appName: 'Paper Reader',
      bundleId: 'com.example.paper-reader',
      pid: 4242,
      title: 'Attention Is All You Need.pdf',
      confidence: 0.36,
      reason: 'Partial overlap with selected region.',
      windowBounds: { x: 40, y: 80, width: 1024, height: 768 },
      windowLocalBounds: { x: 700, y: 60, width: 120, height: 90 },
    }],
  });
  assert.doesNotMatch(JSON.stringify(payload), /WindowActionSession|window-action-session|window-action-ref|actionRef/);
});
