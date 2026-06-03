import assert from 'node:assert/strict';
import test from 'node:test';
import type { RuntimeArtifact, SciForgeSession } from '../../domain';
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
